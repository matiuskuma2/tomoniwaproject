/**
 * nlRouter/policyGate.ts
 * CONV-1: 安全ゲート
 * 
 * 設計原則:
 * - write_external は必ず requires_confirm
 * - pending 中は AI フォールバックを原則無効
 * - AI が直接 confirm intent を返さない
 */

import type { ActionPlan, NlRouterContext, PolicyGateResult } from './types';
import type { IntentType } from '../classifier/types';
import type { PendingState } from '../pendingTypes';

// ============================================================
// Intent ごとの side_effect マッピング
// ============================================================

type SideEffect = 'none' | 'read' | 'write_local' | 'write_external';

/**
 * Intent の side_effect マッピング
 * intent_catalog.json と同期すること
 */
const INTENT_SIDE_EFFECTS: Record<string, SideEffect> = {
  // calendar.read（安全）
  'schedule.today': 'read',
  'schedule.week': 'read',
  'schedule.freebusy': 'read',
  'schedule.freebusy.batch': 'read',
  'schedule.status.check': 'read',
  'schedule.invite.list': 'read',
  
  // invite.prepare（確認必要）
  'invite.prepare.emails': 'write_local',
  'invite.prepare.list': 'write_local',
  
  // pending.decide
  'pending.action.decide': 'write_local',
  
  // schedule.propose
  'schedule.auto_propose': 'write_local',
  'schedule.auto_propose.confirm': 'write_local',
  'schedule.auto_propose.cancel': 'none',
  'schedule.additional_propose': 'write_local',
  
  // schedule.remind（確認フローあり）
  'schedule.remind.pending': 'write_local',
  'schedule.remind.pending.confirm': 'write_external',
  'schedule.remind.pending.cancel': 'none',
  'schedule.need_response.list': 'read',
  'schedule.remind.need_response': 'write_local',
  'schedule.remind.need_response.confirm': 'write_external',
  'schedule.remind.need_response.cancel': 'none',
  'schedule.remind.responded': 'write_local',
  'schedule.remind.responded.confirm': 'write_external',
  'schedule.remind.responded.cancel': 'none',
  
  // schedule.notify
  'schedule.notify.confirmed': 'write_local',
  'schedule.notify.confirmed.confirm': 'write_external',
  'schedule.notify.confirmed.cancel': 'none',
  
  // schedule.propose_for_split
  'schedule.propose_for_split': 'write_local',
  'schedule.propose_for_split.confirm': 'write_local',
  'schedule.propose_for_split.cancel': 'none',
  
  // schedule.commit
  'schedule.finalize': 'write_local',
  
  // schedule.reschedule
  'schedule.reschedule': 'write_local',
  'schedule.reschedule.confirm': 'write_local',
  'schedule.reschedule.cancel': 'none',
  
  // preference（安全）
  'preference.set': 'write_local',
  'preference.show': 'read',
  'preference.clear': 'write_local',
  
  // list（安全）
  'list.create': 'write_local',
  'list.list': 'read',
  'list.members': 'read',
  'list.add_member': 'write_local',
  
  // fallback
  'unknown': 'none',
};

/**
 * Intent の side_effect を取得
 */
function getSideEffect(intent: string): SideEffect {
  return INTENT_SIDE_EFFECTS[intent] || 'none';
}

// ============================================================
// 確認必須 Intent リスト
// ============================================================

/**
 * 確認が必須な Intent のリスト
 * これらは requires_confirm を強制的に true にする
 */
const REQUIRES_CONFIRM_INTENTS: string[] = [
  'invite.prepare.emails',
  'invite.prepare.list',
  'schedule.auto_propose',
  'schedule.additional_propose',
  'schedule.remind.pending',
  'schedule.remind.need_response',
  'schedule.remind.responded',
  'schedule.notify.confirmed',
  'schedule.propose_for_split',
  'schedule.finalize',
  'schedule.reschedule',
];

/**
 * AI が直接返してはいけない Intent（.confirm 系）
 * これらは pending.action のフローで自動的に呼ばれる
 */
const BLOCKED_INTENTS_FOR_AI: string[] = [
  'schedule.auto_propose.confirm',
  'schedule.remind.pending.confirm',
  'schedule.remind.need_response.confirm',
  'schedule.remind.responded.confirm',
  'schedule.notify.confirmed.confirm',
  'schedule.propose_for_split.confirm',
  'schedule.reschedule.confirm',
];

// ============================================================
// Policy Gate メイン関数
// ============================================================

/**
 * Policy Gate: AI 出力の安全性を検証し、必要に応じて修正
 * 
 * @param actionPlan - AI が生成した ActionPlan
 * @param context - 現在の文脈
 * @returns PolicyGateResult
 */
export function applyPolicyGate(
  actionPlan: ActionPlan,
  context: NlRouterContext
): PolicyGateResult {
  const intent = actionPlan.intent;
  const sideEffect = getSideEffect(intent);

  // ============================================================
  // 1. ブロック対象のチェック
  // ============================================================

  // .confirm 系は AI が直接返すことを禁止
  if (BLOCKED_INTENTS_FOR_AI.includes(intent)) {
    return {
      allowed: false,
      requiresConfirm: false,
      blockReason: `Intent "${intent}" は AI が直接返すことはできません。確認フローを経由してください。`,
      fallbackQuestion: 'この操作を実行しますか？（はい/いいえ）',
    };
  }

  // write_external は AI が直接返すことを禁止
  if (sideEffect === 'write_external') {
    return {
      allowed: false,
      requiresConfirm: false,
      blockReason: `Intent "${intent}" は外部送信を伴うため、AI が直接返すことはできません。`,
      fallbackQuestion: '送信を実行しますか？（はい/いいえ）',
    };
  }

  // ============================================================
  // 2. Pending 中のルール
  // ============================================================

  const activePending = context.pendingForThread || context.globalPendingAction;
  
  if (activePending) {
    // Pending 中に許可される Intent は限定的
    const allowedDuringPending: string[] = [
      'pending.action.decide',
      'schedule.today',
      'schedule.week',
      'schedule.freebusy',
      'schedule.status.check',
      'unknown',
    ];

    if (!allowedDuringPending.includes(intent)) {
      return {
        allowed: false,
        requiresConfirm: false,
        blockReason: `保留中のアクション（${activePending.kind}）があります。先に「送る」「キャンセル」を選んでください。`,
        fallbackQuestion: '「送る」「キャンセル」「別スレッドで」のいずれかを選んでください。',
      };
    }
  }

  // ============================================================
  // 3. 確認要否の判定
  // ============================================================

  let requiresConfirm = actionPlan.requires_confirm || false;

  // 確認必須 Intent リストに含まれる場合は強制的に true
  if (REQUIRES_CONFIRM_INTENTS.includes(intent)) {
    requiresConfirm = true;
  }

  // write_local で外部影響がある可能性がある場合
  if (sideEffect === 'write_local' && !requiresConfirm) {
    // invite 系は常に確認
    if (intent.startsWith('invite.')) {
      requiresConfirm = true;
    }
    // reschedule 系は常に確認
    if (intent.startsWith('schedule.reschedule')) {
      requiresConfirm = true;
    }
  }

  // ============================================================
  // 4. 結果を返す
  // ============================================================

  return {
    allowed: true,
    requiresConfirm,
  };
}

// ============================================================
// ヘルパー関数
// ============================================================

/**
 * AI フォールバックを呼ぶべきか判定
 * 
 * @param input - ユーザー入力
 * @param ruleResult - ルールベース分類の結果
 * @param context - 文脈
 * @returns true なら AI フォールバックを呼ぶべき
 */
export function shouldUseAiFallback(
  input: string,
  ruleResult: { intent: string; confidence: number } | null,
  context: NlRouterContext
): boolean {
  // 空入力は AI に渡さない
  if (!input || input.trim().length === 0) {
    return false;
  }

  // ルール分類が成功した場合は呼ばない
  if (ruleResult && ruleResult.intent !== 'unknown' && ruleResult.confidence >= 0.5) {
    return false;
  }

  // Pending 中は基本的に呼ばない
  // （はい/いいえ/送る/キャンセル はルールベースで処理）
  const activePending = context.pendingForThread || context.globalPendingAction;
  if (activePending) {
    // ただし、カレンダー参照系は許可
    const allowedPatterns = [
      /今日の予定/,
      /今週の予定/,
      /空き/,
      /スケジュール/,
    ];
    const normalizedInput = input.toLowerCase();
    const isCalendarQuery = allowedPatterns.some(p => p.test(normalizedInput));
    if (!isCalendarQuery) {
      return false;
    }
  }

  // 短すぎる入力は AI に渡さない（ルールベースで十分）
  if (input.trim().length < 3) {
    return false;
  }

  return true;
}

/**
 * PolicyGateResult に基づいて ActionPlan を修正
 */
export function applyPolicyToActionPlan(
  actionPlan: ActionPlan,
  gateResult: PolicyGateResult
): ActionPlan {
  if (!gateResult.allowed) {
    // ブロックされた場合は unknown に変更
    return {
      ...actionPlan,
      intent: 'unknown',
      requires_confirm: false,
      clarifications: [
        {
          field: 'intent',
          question: gateResult.fallbackQuestion || gateResult.blockReason || '操作を確認してください。',
        },
      ],
    };
  }

  // 確認要否を更新
  return {
    ...actionPlan,
    requires_confirm: gateResult.requiresConfirm,
  };
}
