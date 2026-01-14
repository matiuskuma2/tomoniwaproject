/**
 * refreshMap.ts
 * P0-2: Write 操作後の必須 refresh を型で強制
 * 
 * 目的:
 * - write操作のたびに必ず必要なrefreshが実行される
 * - 「書いたのにUIが古い」「メール送ったのにカードが古い」を根絶
 */

// ============================================================
// Write Operations (API 書き込み操作)
// ============================================================

export type WriteOp =
  | 'THREAD_CREATE'           // スレッド作成
  | 'INVITE_SEND'             // 招待送信
  | 'INVITE_ADD_SLOTS'        // 候補追加（旧名、互換性のため残す）
  | 'ADD_SLOTS'               // 候補追加（pending_actions execute）
  | 'REMIND_PENDING'          // 未返信リマインド送信
  | 'REMIND_NEED_RESPONSE'    // 再回答リマインド送信
  | 'FINALIZE'                // 日程確定
  | 'NOTIFY_CONFIRMED'        // 確定通知送信
  | 'USERS_ME_UPDATE_TZ'      // タイムゾーン更新
  | 'LIST_CREATE'             // リスト作成
  | 'LIST_ADD_MEMBER';        // リストメンバー追加

// ============================================================
// Refresh Actions (必要な再取得操作)
// ============================================================

export type RefreshAction =
  | { type: 'STATUS'; threadId: string }   // 特定スレッドのステータス
  | { type: 'THREADS_LIST' }               // スレッド一覧
  | { type: 'INBOX' }                      // 受信箱
  | { type: 'ME' }                         // ユーザー情報
  | { type: 'LISTS' };                     // リスト一覧

// ============================================================
// Refresh Map (Write操作 → 必要なRefresh)
// ============================================================

/**
 * Write操作に対して必要なRefreshアクションを返す
 * 
 * @param op - 実行したWrite操作
 * @param args - 操作に関連する引数（threadId等）
 * @returns 実行すべきRefreshアクションの配列
 */
export function getRefreshActions(
  op: WriteOp, 
  args: { threadId?: string } = {}
): RefreshAction[] {
  switch (op) {
    // スレッド作成: ステータス + 一覧
    case 'THREAD_CREATE':
      return args.threadId 
        ? [{ type: 'STATUS', threadId: args.threadId }, { type: 'THREADS_LIST' }]
        : [{ type: 'THREADS_LIST' }];

    // 招待送信: ステータス + 受信箱
    case 'INVITE_SEND':
      return args.threadId 
        ? [{ type: 'STATUS', threadId: args.threadId }, { type: 'INBOX' }]
        : [{ type: 'INBOX' }];

    // 候補追加: ステータス
    case 'INVITE_ADD_SLOTS':
    case 'ADD_SLOTS':
      return args.threadId 
        ? [{ type: 'STATUS', threadId: args.threadId }]
        : [];

    // リマインド送信: ステータス + 受信箱
    case 'REMIND_PENDING':
    case 'REMIND_NEED_RESPONSE':
      return args.threadId 
        ? [{ type: 'STATUS', threadId: args.threadId }, { type: 'INBOX' }]
        : [{ type: 'INBOX' }];

    // 日程確定: ステータス + 受信箱 + 一覧
    case 'FINALIZE':
      return args.threadId 
        ? [
            { type: 'STATUS', threadId: args.threadId }, 
            { type: 'INBOX' },
            { type: 'THREADS_LIST' },
          ]
        : [{ type: 'INBOX' }, { type: 'THREADS_LIST' }];

    // 確定通知: ステータス
    case 'NOTIFY_CONFIRMED':
      return args.threadId 
        ? [{ type: 'STATUS', threadId: args.threadId }]
        : [];

    // タイムゾーン更新: ユーザー情報
    case 'USERS_ME_UPDATE_TZ':
      return [{ type: 'ME' }];

    // リスト操作: リスト一覧
    case 'LIST_CREATE':
    case 'LIST_ADD_MEMBER':
      return [{ type: 'LISTS' }];

    default:
      return [];
  }
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * RefreshAction の説明文を生成（デバッグ用）
 */
export function describeRefreshAction(action: RefreshAction): string {
  switch (action.type) {
    case 'STATUS':
      return `スレッドステータス (${action.threadId})`;
    case 'THREADS_LIST':
      return 'スレッド一覧';
    case 'INBOX':
      return '受信箱';
    case 'ME':
      return 'ユーザー情報';
    case 'LISTS':
      return 'リスト一覧';
    default:
      return '不明';
  }
}

/**
 * Write操作が status refresh を必要とするかどうか
 */
export function requiresStatusRefresh(op: WriteOp): boolean {
  return [
    'THREAD_CREATE',
    'INVITE_SEND',
    'INVITE_ADD_SLOTS',
    'ADD_SLOTS',
    'REMIND_PENDING',
    'REMIND_NEED_RESPONSE',
    'FINALIZE',
    'NOTIFY_CONFIRMED',
  ].includes(op);
}
