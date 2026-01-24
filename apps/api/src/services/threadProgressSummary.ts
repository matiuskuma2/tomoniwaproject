/**
 * threadProgressSummary.ts
 * PROG-1: スレッド進捗要約サービス（read-only）
 * 
 * 目的: AIが「今どうなってる？」に答えるための状態要約を生成
 * 
 * 設計方針:
 * - 外部送信なし（side_effect: read-only）
 * - 既存のthreadsStatusと共存（破壊しない）
 * - 会話向けの要約を純関数で生成
 */

import type { D1Database } from '@cloudflare/workers-types';

// ============================================================
// Types
// ============================================================

export type ThreadStatusLabel = 'draft' | 'active' | 'confirmed' | 'cancelled';

export type NextRecommendedAction = 
  | 'remind'              // 未回答者にリマインド
  | 'remind_need_response' // 再回答必要者にリマインド
  | 'propose_more'        // 追加候補を出す
  | 'finalize'            // 確定可能
  | 'reschedule'          // 再調整が必要
  | 'wait'                // 待機中
  | 'none';               // 完了/キャンセル

export interface ThreadProgressSummary {
  thread: {
    id: string;
    title: string;
    status: ThreadStatusLabel;
    created_at: string;
  };
  proposal: {
    current_version: number;
    remaining_proposals: number;
    total_slots: number;
  };
  counts: {
    total: number;           // 総招待者数
    pending: number;         // 未回答（selection無し & declined以外）
    responded_latest: number; // 最新版で回答済み
    responded_old: number;   // 旧世代で回答済み（再回答必要）
    declined: number;        // 辞退
    accepted: number;        // 参加可能（回答した人のうちdeclined以外）
  };
  last_actions: {
    last_invite_sent_at?: string;
    last_remind_at?: string;
    last_additional_propose_at?: string;
    finalized_at?: string;
  };
  failure: {
    propose_retry_count: number;
    // 将来: reschedule_count, last_failure_reason
  };
  next_recommended_action: NextRecommendedAction;
  recommendation_reason: string;
  notes: string[];
}

// ============================================================
// Main Function
// ============================================================

/**
 * スレッドの進捗要約を生成（read-only）
 */
export async function getThreadProgressSummary(
  db: D1Database,
  workspaceId: string,
  ownerUserId: string,
  threadId: string
): Promise<ThreadProgressSummary | null> {
  // 1. スレッド取得（tenant isolation）
  const thread = await db.prepare(`
    SELECT 
      id, title, status, created_at, updated_at,
      COALESCE(proposal_version, 1) as proposal_version,
      COALESCE(additional_propose_count, 0) as additional_propose_count
    FROM scheduling_threads
    WHERE id = ?
      AND workspace_id = ?
      AND organizer_user_id = ?
  `).bind(threadId, workspaceId, ownerUserId).first<{
    id: string;
    title: string;
    status: string;
    created_at: string;
    updated_at: string;
    proposal_version: number;
    additional_propose_count: number;
  }>();

  if (!thread) {
    return null;
  }

  // 2. スロット数取得
  const slotsCount = await db.prepare(`
    SELECT COUNT(*) as count FROM scheduling_slots WHERE thread_id = ?
  `).bind(threadId).first<{ count: number }>();

  // 3. 招待者取得
  const invitesResult = await db.prepare(`
    SELECT 
      id, invitee_key, email, candidate_name, status, created_at
    FROM thread_invites
    WHERE thread_id = ?
  `).bind(threadId).all<{
    id: string;
    invitee_key: string;
    email: string;
    candidate_name: string;
    status: string | null;
    created_at: string;
  }>();
  const invites = invitesResult.results || [];

  // 4. 回答（selection）取得
  const selectionsResult = await db.prepare(`
    SELECT 
      invitee_key, status, selected_slot_id,
      COALESCE(proposal_version_at_response, 1) as proposal_version_at_response,
      responded_at
    FROM thread_selections
    WHERE thread_id = ?
  `).bind(threadId).all<{
    invitee_key: string;
    status: string;
    selected_slot_id: string | null;
    proposal_version_at_response: number;
    responded_at: string;
  }>();
  const selections = selectionsResult.results || [];

  // 5. 確定情報取得
  const finalize = await db.prepare(`
    SELECT finalized_at FROM thread_finalize WHERE thread_id = ? LIMIT 1
  `).bind(threadId).first<{ finalized_at: string }>();

  // 6. リマインドログ取得（最新）
  const lastRemind = await db.prepare(`
    SELECT created_at FROM remind_log 
    WHERE thread_id = ? 
    ORDER BY created_at DESC LIMIT 1
  `).bind(threadId).first<{ created_at: string }>();

  // 7. カウント計算
  const currentVersion = thread.proposal_version;
  const selectionByKey = new Map(selections.map(s => [s.invitee_key, s]));
  
  let pending = 0;
  let respondedLatest = 0;
  let respondedOld = 0;
  let declined = 0;
  let accepted = 0;

  for (const invite of invites) {
    const sel = selectionByKey.get(invite.invitee_key);
    
    if (!sel) {
      // 回答なし
      pending++;
    } else if (sel.status === 'declined') {
      declined++;
    } else {
      // 回答あり（declined以外）
      accepted++;
      if (sel.proposal_version_at_response >= currentVersion) {
        respondedLatest++;
      } else {
        respondedOld++;
      }
    }
  }

  // 8. 次のアクション推奨を計算
  const { action, reason } = calculateNextAction({
    status: thread.status as ThreadStatusLabel,
    pending,
    respondedOld,
    respondedLatest,
    declined,
    remainingProposals: 2 - thread.additional_propose_count,
    isFinalized: !!finalize,
    totalInvites: invites.length,
  });

  // 9. 注意点メモ
  const notes: string[] = [];
  if (respondedOld > 0) {
    notes.push(`${respondedOld}名が旧候補で回答済み（再回答リマインド推奨）`);
  }
  if (pending > 0 && pending === invites.length) {
    notes.push('まだ誰も回答していません');
  }
  if (thread.additional_propose_count >= 2) {
    notes.push('追加候補の上限（2回）に達しています');
  }

  // 10. 結果を構築
  return {
    thread: {
      id: thread.id,
      title: thread.title,
      status: thread.status as ThreadStatusLabel,
      created_at: thread.created_at,
    },
    proposal: {
      current_version: currentVersion,
      remaining_proposals: Math.max(0, 2 - thread.additional_propose_count),
      total_slots: slotsCount?.count || 0,
    },
    counts: {
      total: invites.length,
      pending,
      responded_latest: respondedLatest,
      responded_old: respondedOld,
      declined,
      accepted,
    },
    last_actions: {
      last_invite_sent_at: invites.length > 0 
        ? invites.reduce((latest, inv) => 
            inv.created_at > latest ? inv.created_at : latest, 
            invites[0].created_at
          )
        : undefined,
      last_remind_at: lastRemind?.created_at,
      last_additional_propose_at: thread.additional_propose_count > 0 
        ? thread.updated_at 
        : undefined,
      finalized_at: finalize?.finalized_at,
    },
    failure: {
      propose_retry_count: thread.additional_propose_count,
    },
    next_recommended_action: action,
    recommendation_reason: reason,
    notes,
  };
}

// ============================================================
// Helper Functions
// ============================================================

interface NextActionInput {
  status: ThreadStatusLabel;
  pending: number;
  respondedOld: number;
  respondedLatest: number;
  declined: number;
  remainingProposals: number;
  isFinalized: boolean;
  totalInvites: number;
}

function calculateNextAction(input: NextActionInput): { action: NextRecommendedAction; reason: string } {
  const { status, pending, respondedOld, respondedLatest, declined, remainingProposals, isFinalized, totalInvites } = input;

  // 確定済み or キャンセル → none
  if (isFinalized || status === 'confirmed') {
    return { action: 'none', reason: '日程は確定済みです' };
  }
  if (status === 'cancelled') {
    return { action: 'none', reason: 'キャンセル済みです' };
  }
  if (status === 'draft') {
    return { action: 'wait', reason: '下書き状態です。招待を送信してください' };
  }

  // 全員辞退 → reschedule
  if (declined === totalInvites && totalInvites > 0) {
    return { action: 'reschedule', reason: '全員が辞退しました。再調整をおすすめします' };
  }

  // 再回答必要者がいる → remind_need_response
  if (respondedOld > 0) {
    return { 
      action: 'remind_need_response', 
      reason: `${respondedOld}名が旧候補で回答済みです。再回答リマインドをおすすめします` 
    };
  }

  // 未回答者がいる → remind
  if (pending > 0) {
    return { 
      action: 'remind', 
      reason: `${pending}名が未回答です。リマインドをおすすめします` 
    };
  }

  // 全員回答済み → finalize
  if (pending === 0 && respondedOld === 0 && respondedLatest > 0) {
    return { action: 'finalize', reason: '全員回答済みです。日程を確定できます' };
  }

  // 追加候補が出せる状態で、まだ確定できない
  if (remainingProposals > 0 && respondedLatest === 0 && pending === 0) {
    return { action: 'propose_more', reason: '追加候補を出すことができます' };
  }

  // その他 → wait
  return { action: 'wait', reason: '回答を待っています' };
}

// ============================================================
// 会話向け要約テキスト生成（pure function）
// ============================================================

/**
 * 会話向けの要約テキストを生成
 */
export function formatProgressSummaryForChat(summary: ThreadProgressSummary): string {
  const { thread, proposal, counts, next_recommended_action, recommendation_reason, notes } = summary;

  // ステータスラベル
  const statusLabels: Record<ThreadStatusLabel, string> = {
    draft: '下書き',
    active: '募集中',
    confirmed: '確定済み',
    cancelled: 'キャンセル',
  };

  let message = `📌 **進捗: ${thread.title}**\n\n`;
  message += `状態: ${statusLabels[thread.status]}（v${proposal.current_version}`;
  if (proposal.remaining_proposals > 0) {
    message += ` / 追加候補あと${proposal.remaining_proposals}回可`;
  }
  message += `）\n`;
  message += `候補数: ${proposal.total_slots}件\n\n`;

  // 招待者カウント
  message += `👥 **招待者: ${counts.total}名**\n`;
  if (counts.pending > 0) {
    message += `• 未回答: ${counts.pending}名\n`;
  }
  if (counts.responded_old > 0) {
    message += `• 再回答必要: ${counts.responded_old}名\n`;
  }
  if (counts.responded_latest > 0) {
    message += `• 回答済み: ${counts.responded_latest}名\n`;
  }
  if (counts.declined > 0) {
    message += `• 辞退: ${counts.declined}名\n`;
  }

  // 次のアクション
  message += `\n✅ **次のおすすめ:**\n`;
  message += `${recommendation_reason}\n`;

  // アクションヒント
  const actionHints: Record<NextRecommendedAction, string> = {
    remind: '「リマインドして」と入力してください',
    remind_need_response: '「再回答リマインドして」と入力してください',
    propose_more: '「追加候補出して」と入力してください',
    finalize: '「確定して」と入力してください',
    reschedule: '「再調整して」と入力してください',
    wait: '回答をお待ちください',
    none: '',
  };

  const hint = actionHints[next_recommended_action];
  if (hint) {
    message += `\n💡 ${hint}`;
  }

  // 注意点
  if (notes.length > 0) {
    message += `\n\n⚠️ 注意:\n`;
    for (const note of notes) {
      message += `• ${note}\n`;
    }
  }

  return message;
}
