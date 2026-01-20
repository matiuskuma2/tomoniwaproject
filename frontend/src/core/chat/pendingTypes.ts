/**
 * pendingTypes.ts
 * P0-1: PendingState 正規化 - threadId必須・単一辞書
 * 
 * 目的:
 * - pending系を1つの辞書に統合: pendingByThreadId: Record<string, PendingState>
 * - confirm/キャンセルの判定は「今のthreadIdの pending を見る」だけにする
 * - ChatLayout / ChatPane / intentClassifier / apiExecutor の "pending受け渡し" を一本化
 */

// ============================================================
// Pending Kind (確認待ち操作の種類)
// ============================================================

export type PendingKind =
  | 'pending.action'           // Beta A: send/add_invites/add_slots
  | 'remind.pending'           // Phase Next-6 Day1: 未回答者リマインド
  | 'remind.need_response'     // Phase2 P2-D1: 再回答依頼リマインド
  | 'remind.responded'         // Phase2 P2-D2: 最新回答済み者リマインド
  | 'notify.confirmed'         // Phase Next-6 Day3: 確定通知
  | 'split.propose'            // Phase Next-6 Day2: 票割れ追加提案
  | 'auto_propose';            // Phase Next-5 Day2: 自動候補提案

// ============================================================
// Base Interface (全 PendingState 共通)
// ============================================================

export interface PendingBase {
  kind: PendingKind;
  threadId: string;           // 必須: どのスレッドに紐づくか
  createdAt: number;          // Date.now() - 作成時刻
}

// ============================================================
// PendingState Union (各種確認待ち状態)
// ============================================================

export type PendingState =
  // Beta A: 招待送信 / 招待追加 / 候補追加
  | (PendingBase & {
      kind: 'pending.action';
      confirmToken: string;
      expiresAt: string;
      summary: {
        action?: string;
        emails?: string[];
        slots?: Array<{ start_at: string; end_at: string; label?: string }>;
        thread_title?: string;
        [key: string]: unknown;
      };
      mode: 'new_thread' | 'add_to_thread' | 'add_slots';
      threadTitle?: string;
      actionType?: 'send_invites' | 'add_invites' | 'add_slots';
    })
  
  // Phase Next-6 Day1: 未回答者へのリマインド
  | (PendingBase & {
      kind: 'remind.pending';
      pendingInvites: Array<{ email: string; name?: string }>;
      count: number;
    })
  
  // Phase2 P2-D1: 再回答が必要な人へのリマインド
  | (PendingBase & {
      kind: 'remind.need_response';
      targetInvitees: Array<{ email: string; name?: string; inviteeKey: string }>;
      count: number;
      threadTitle?: string;  // TD-REMIND-UNIFY: classifier から渡す用
    })
  
  // Phase2 P2-D2: 最新回答済みの人へのリマインド
  | (PendingBase & {
      kind: 'remind.responded';
      targetInvitees: Array<{ email: string; name?: string; inviteeKey: string }>;
      count: number;
      threadTitle?: string;  // TD-REMIND-UNIFY: classifier から渡す用
    })
  
  // Phase Next-6 Day3: 確定通知
  | (PendingBase & {
      kind: 'notify.confirmed';
      invites: Array<{ email: string; name?: string }>;
      finalSlot: { start_at: string; end_at: string; label?: string };
      meetingUrl?: string;
    })
  
  // Phase Next-6 Day2: 票割れ時の追加候補提案
  | (PendingBase & {
      kind: 'split.propose';
      voteSummary: Array<{ label: string; votes: number }>;
    })
  
  // Phase Next-5 Day2: 自動候補日時提案
  | (PendingBase & {
      kind: 'auto_propose';
      source: 'initial' | 'additional';
      emails?: string[];
      duration?: number;
      range?: string;
      proposals: Array<{ start_at: string; end_at: string; label: string }>;
    });

// ============================================================
// Utility Functions
// ============================================================

/**
 * 現在のthreadIdで pending を取得
 * 
 * @param pendingByThreadId - pending状態の辞書
 * @param threadId - 現在選択中のスレッドID
 * @returns 該当するPendingState、なければnull
 */
export function getPendingForThread(
  pendingByThreadId: Record<string, PendingState | null>,
  threadId?: string | null
): PendingState | null {
  if (!threadId) return null;
  return pendingByThreadId[threadId] ?? null;
}

/**
 * pending の種類を判定するヘルパー
 */
export function isPendingAction(pending: PendingState | null): pending is PendingState & { kind: 'pending.action' } {
  return pending?.kind === 'pending.action';
}

export function isPendingRemind(pending: PendingState | null): pending is PendingState & { kind: 'remind.pending' } {
  return pending?.kind === 'remind.pending';
}

export function isPendingRemindNeedResponse(pending: PendingState | null): pending is PendingState & { kind: 'remind.need_response' } {
  return pending?.kind === 'remind.need_response';
}

export function isPendingRemindResponded(pending: PendingState | null): pending is PendingState & { kind: 'remind.responded' } {
  return pending?.kind === 'remind.responded';
}

export function isPendingNotify(pending: PendingState | null): pending is PendingState & { kind: 'notify.confirmed' } {
  return pending?.kind === 'notify.confirmed';
}

export function isPendingSplit(pending: PendingState | null): pending is PendingState & { kind: 'split.propose' } {
  return pending?.kind === 'split.propose';
}

export function isPendingAutoPropose(pending: PendingState | null): pending is PendingState & { kind: 'auto_propose' } {
  return pending?.kind === 'auto_propose';
}

/**
 * pending が確認待ち（はい/いいえ対象）かどうか
 */
export function hasPendingConfirmation(pending: PendingState | null): boolean {
  if (!pending) return false;
  return [
    'pending.action',
    'remind.pending',
    'remind.need_response',
    'remind.responded',
    'notify.confirmed',
    'split.propose',
    'auto_propose',
  ].includes(pending.kind);
}

/**
 * pending の説明文を生成（デバッグ・ログ用）
 */
export function describePending(pending: PendingState | null): string {
  if (!pending) return 'なし';
  
  switch (pending.kind) {
    case 'pending.action':
      return `招待操作待ち (${pending.actionType ?? pending.mode})`;
    case 'remind.pending':
      return `未回答リマインド待ち (${pending.count}名)`;
    case 'remind.need_response':
      return `再回答リマインド待ち (${pending.count}名)`;
    case 'remind.responded':
      return `回答済みリマインド待ち (${pending.count}名)`;
    case 'notify.confirmed':
      return `確定通知待ち (${pending.invites.length}名)`;
    case 'split.propose':
      return `追加候補提案待ち`;
    case 'auto_propose':
      return `自動提案待ち (${pending.proposals.length}件)`;
    default:
      return `不明な状態`;
  }
}
