/**
 * executors/oneToMany.ts
 * FE-6: 1対N (Broadcast) スケジューリング Executor
 * 
 * チャットの自然言語入力から直接 1対N 日程調整を起動する。
 * 
 * フロー:
 * 1. classifier が schedule.1toN.prepare を判定
 * 2. 本 executor が params から参加者・制約を取得
 * 3. 名前→メール解決（contacts API経由）
 * 4. generateDefaultSlots でデフォルト候補を生成（constraints 付き対応）
 * 5. oneToManyApi.prepare でスレッド作成
 * 6. oneToManyApi.send で招待送信
 * 7. チャットに結果メッセージを返す
 * 
 * 設計思想（PRD v2.0 B-strategy）:
 * - 止めない。聞き直さない。再入力を求めない。
 * - 名前解決失敗 → メールなしでも prepare にメール付き参加者だけで続行
 * - send 失敗 → orphan thread のIDを返してリトライ可能に
 * 
 * postImportBridge との違い:
 * - postImportBridge: import 後の pending 経由。emails は確定済み。
 * - oneToMany executor: チャット経由。名前→メール解決が必要。constraints あり。
 */

import type { IntentResult } from '../intentClassifier';
import type { ExecutionResult } from './types';
import { oneToManyApi } from '../../api/oneToMany';
import type { PrepareRequest, PrepareResponse, SendResponse } from '../../api/oneToMany';
import { generateDefaultSlots } from './postImportBridge';
import { log } from '../../platform';
import { getToken } from '../../auth';

// ============================================================
// Types
// ============================================================

interface PersonParam {
  name?: string;
  email?: string;
}

interface ResolvedParticipant {
  name: string;
  email: string;
}

// ============================================================
// Main Executor
// ============================================================

/**
 * 1対N 日程調整 Executor
 * 
 * @param intentResult - classifier の分類結果
 * @returns ExecutionResult
 */
export async function executeOneToManySchedule(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  const { params } = intentResult;

  const persons: PersonParam[] = params.persons || [];
  const emailsFromInput: string[] = params.emails || [];
  const mode = params.mode || 'candidates';
  const title = params.title || '打ち合わせ';
  const durationMinutes = params.duration_minutes || 60;
  const constraints = params.constraints || null;

  log.info('[FE-6] oneToMany executor', {
    module: 'oneToMany',
    personsCount: persons.length,
    emailsCount: emailsFromInput.length,
    mode,
    title,
  });

  // ============================================================
  // Step 1: 名前→メール解決
  // ============================================================
  const resolved = await resolveParticipants(persons, emailsFromInput);

  if (resolved.length === 0) {
    return {
      success: false,
      message: '❌ 参加者のメールアドレスが見つかりませんでした。\n名前かメールアドレスを指定してください。',
      needsClarification: {
        field: 'participants',
        message: '参加者のメールアドレスか名前を教えてください。',
      },
    };
  }

  if (resolved.length === 1) {
    // 1名しか解決できなかった → 1対1にフォールバック案内
    return {
      success: false,
      message: `📌 ${resolved[0].name}さんのみ特定できました。\n1対1の日程調整をする場合は「${resolved[0].name}さんと日程調整して」と入力してください。\n複数名の場合はメールアドレスを追加してください。`,
      needsClarification: {
        field: 'participants',
        message: '他の参加者のメールアドレスを追加してください。',
      },
    };
  }

  // ============================================================
  // Step 2: デフォルト候補スロットを生成
  // ============================================================
  const slotsCount = mode === 'fixed' ? 1 : 3;
  const defaultSlots = generateDefaultSlots(slotsCount, durationMinutes, constraints);

  if (defaultSlots.length === 0) {
    return {
      success: false,
      message: '❌ 指定された条件で候補日時が生成できませんでした。\n期間を広げるか、条件を変更してみてください。',
    };
  }

  // ============================================================
  // Step 3: oneToMany.prepare
  // ============================================================
  try {
    const prepareReq: PrepareRequest = {
      title,
      mode: mode as PrepareRequest['mode'],
      kind: 'external',
      emails: resolved.map(r => r.email),
      slots: defaultSlots,
      deadline_hours: 72,
      finalize_policy: 'organizer_decides',
    };

    log.debug('[FE-6] oneToMany.prepare', {
      module: 'oneToMany',
      emailCount: resolved.length,
      slotsCount: defaultSlots.length,
      mode,
    });

    const prepared: PrepareResponse = await oneToManyApi.prepare(prepareReq);

    if (!prepared.thread?.id) {
      return {
        success: false,
        message: '❌ 日程調整スレッドの作成に失敗しました。\nもう一度お試しください。',
      };
    }

    // ============================================================
    // Step 4: oneToMany.send
    // ============================================================
    log.debug('[FE-6] oneToMany.send', {
      module: 'oneToMany',
      threadId: prepared.thread.id,
      inviteesCount: prepared.invitees?.length ?? 0,
    });

    let sendResult: SendResponse;
    try {
      sendResult = await oneToManyApi.send(prepared.thread.id, {
        invitees: prepared.invitees,
        channel_type: 'email',
      });
    } catch (sendError) {
      // prepare 成功 + send 失敗 → orphan thread 保護
      log.error('[FE-6] oneToMany.send failed', {
        module: 'oneToMany',
        threadId: prepared.thread.id,
        error: sendError instanceof Error ? sendError.message : String(sendError),
      });
      return {
        success: false,
        message: [
          '⚠️ 日程調整スレッドは作成されましたが、招待メールの送信に失敗しました。',
          `スレッドID: ${prepared.thread.id}`,
          'チャットで「招待を送信して」と入力してリトライしてください。',
        ].join('\n'),
        data: {
          kind: '1toN.prepared',
          payload: {
            threadId: prepared.thread.id,
            mode: mode as any,
            inviteesCount: resolved.length,
            slotsCount: defaultSlots.length,
            title,
          },
        },
      };
    }

    // ============================================================
    // Step 5: 成功メッセージ
    // ============================================================
    const message = buildSuccessMessage(resolved, defaultSlots, sendResult, title);

    return {
      success: true,
      message,
      data: {
        kind: '1toN.sent',
        payload: {
          threadId: prepared.thread.id,
          sentCount: sendResult.sent_count,
          total: sendResult.total,
          channel: sendResult.channel,
        },
      },
    };

  } catch (error) {
    log.error('[FE-6] oneToMany executor failed', {
      module: 'oneToMany',
      error: error instanceof Error ? error.message : String(error),
    });

    // 認証エラーの判定
    if (error instanceof Error && (error.message.includes('401') || error.message.includes('auth'))) {
      return {
        success: false,
        message: '❌ ログインが必要です。ページを再読み込みしてログインしてください。',
      };
    }

    const nameHint = resolved.length > 0
      ? resolved.map(r => r.name).slice(0, 3).join('、')
      : persons.map(p => p.name).filter(Boolean).slice(0, 3).join('、');

    return {
      success: false,
      message: `❌ ${nameHint || '参加者'}との日程調整に失敗しました。\nもう一度お試しください。`,
    };
  }
}

// ============================================================
// Participant Resolution
// ============================================================

/**
 * 名前→メール解決
 * 
 * フロー:
 * 1. emails 直接指定 → そのまま使用
 * 2. persons[i].email あり → そのまま使用
 * 3. persons[i].name のみ → contacts API で解決を試みる
 * 
 * 解決できなかった参加者はスキップ（エラーにしない）
 */
async function resolveParticipants(
  persons: PersonParam[],
  directEmails: string[]
): Promise<ResolvedParticipant[]> {
  const resolved: ResolvedParticipant[] = [];
  const seen = new Set<string>();

  // 1. 直接指定のメールアドレス
  for (const email of directEmails) {
    const lower = email.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      resolved.push({ name: email.split('@')[0], email: lower });
    }
  }

  // 2. persons から解決
  for (const person of persons) {
    if (person.email) {
      const lower = person.email.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        resolved.push({ name: person.name || person.email.split('@')[0], email: lower });
      }
    } else if (person.name) {
      // 名前→メール解決を試みる
      const email = await resolveNameToEmail(person.name);
      if (email) {
        const lower = email.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          resolved.push({ name: person.name, email: lower });
        }
      } else {
        log.warn('[FE-6] Could not resolve name to email', {
          module: 'oneToMany',
          name: person.name,
        });
      }
    }
  }

  return resolved;
}

/**
 * 名前→メール解決（contacts API 経由）
 * 失敗時は null を返す（エラーにしない）
 */
async function resolveNameToEmail(name: string): Promise<string | null> {
  try {
    const token = await getToken();
    if (!token) return null;

    const response = await fetch(`/api/contacts?search=${encodeURIComponent(name)}&limit=1`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) return null;

    const data = await response.json() as { contacts?: Array<{ email?: string }> };
    const contact = data.contacts?.[0];
    return contact?.email || null;
  } catch {
    return null;
  }
}

// ============================================================
// Message Builders
// ============================================================

function buildSuccessMessage(
  participants: ResolvedParticipant[],
  slots: Array<{ start_at: string; end_at: string; label?: string }>,
  sendResult: SendResponse,
  title: string
): string {
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

  const nameList = participants.slice(0, 5).map(p => p.name).join('、');
  const more = participants.length > 5 ? ` 他${participants.length - 5}名` : '';

  const slotLines = slots.map((s, i) => {
    if (s.label) {
      return `  ${i + 1}. ${s.label}`;
    }
    const d = new Date(s.start_at);
    const day = dayNames[d.getDay()];
    const m = d.getMonth() + 1;
    const dd = d.getDate();
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    const eDate = new Date(s.end_at);
    const ehh = eDate.getHours().toString().padStart(2, '0');
    const emm = eDate.getMinutes().toString().padStart(2, '0');
    return `  ${i + 1}. ${m}/${dd}(${day}) ${hh}:${mm}〜${ehh}:${emm}`;
  }).join('\n');

  const lines = [
    '✅ 日程調整スレッドを作成しました',
    `📋 ${title}（${participants.length}名参加）`,
    '📅 候補日時:',
    slotLines,
    `📧 ${nameList}${more} に招待メールを送信しました。`,
    `📊 送信: ${sendResult.sent_count}/${sendResult.total}名`,
    '⏰ 回答期限: 72時間',
  ];

  return lines.join('\n');
}
