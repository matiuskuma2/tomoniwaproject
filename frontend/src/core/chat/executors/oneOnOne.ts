/**
 * oneOnOne.ts
 * v1.0: 1対1予定調整（固定日時スタート）の Executor
 * v1.1: Phase B-1 候補3つ提示対応
 * v1.2: Phase B-2 freebusy から候補生成
 * v1.3: Phase B-4 Open Slots（TimeRex型公開枠）
 * 
 * ユーザーが「Aさんと来週木曜17時から1時間打ち合わせ」と言うと:
 * 1. classifyOneOnOne で Intent 判定
 * 2. executeOneOnOneFixed で API 呼び出し
 * 3. message_for_chat をそのままユーザーに返す
 * 
 * Phase B-1: 「田中さんと来週月曜10時か火曜14時で打ち合わせ」と言うと:
 * 1. classifyOneOnOne で 'schedule.1on1.candidates3' と判定
 * 2. executeOneOnOneCandidates で /candidates/prepare API 呼び出し
 * 3. message_for_chat をそのままユーザーに返す
 * 
 * Phase B-2: 「田中さんと来週の空いてるところから候補出して」と言うと:
 * 1. classifyOneOnOne で 'schedule.1on1.freebusy' と判定
 * 2. executeOneOnOneFreebusy で /freebusy/prepare API 呼び出し
 * 3. message_for_chat をそのままユーザーに返す
 * 
 * Phase B-4: 「田中さんに私の空いてる枠を共有して選んでもらって」と言うと:
 * 1. classifyOneOnOne で 'schedule.1on1.open_slots' と判定
 * 2. executeOneOnOneOpenSlots で /open-slots/prepare API 呼び出し
 * 3. message_for_chat をそのままユーザーに返す
 */

import type { IntentResult } from '../intentClassifier';
import type { ExecutionResult, ExecutionResultData } from './types';
import { log } from '../../platform';
import { getToken } from '../../auth';

// ============================================================
// Types
// ============================================================

interface OneOnOnePrepareRequest {
  invitee: {
    name: string;
    email?: string;
    contact_id?: string;
  };
  slot: {
    start_at: string;
    end_at: string;
  };
  title?: string;
  message_hint?: string;
  send_via?: 'email' | 'share_link';
}

interface OneOnOnePrepareResponse {
  success: boolean;
  thread_id: string;
  invite_token: string;
  share_url: string;
  message_for_chat: string;
  mode: 'email' | 'share_link';
  request_id: string;
}

// ExecutionResultData に 1on1 用の型を追加
export type OneOnOneResultData = {
  kind: '1on1.fixed.prepared';
  payload: {
    threadId: string;
    inviteToken: string;
    shareUrl: string;
    mode: 'email' | 'share_link';
    person: { name?: string; email?: string };
    slot: { start_at: string; end_at: string };
  };
};

// ============================================================
// Types - 候補3つ（Phase B-1）
// ============================================================

interface OneOnOneCandidatesPrepareRequest {
  invitee: {
    name: string;
    email?: string;
    contact_id?: string;
  };
  slots: Array<{
    start_at: string;  // ISO8601
    end_at: string;    // ISO8601
  }>;
  title?: string;
  message_hint?: string;
  send_via?: 'email' | 'share_link';
}

interface OneOnOneCandidatesPrepareResponse {
  success: boolean;
  thread_id: string;
  invite_token: string;
  share_url: string;
  slots: Array<{
    slot_id: string;
    start_at: string;
    end_at: string;
  }>;
  message_for_chat: string;
  mode: 'email' | 'share_link';
  email_queued?: boolean;
  request_id: string;
}

// ExecutionResultData 拡張
export type OneOnOneCandidatesResultData = {
  kind: '1on1.candidates.prepared';
  payload: {
    threadId: string;
    inviteToken: string;
    shareUrl: string;
    mode: 'email' | 'share_link';
    person: { name?: string; email?: string };
    slots: Array<{ slot_id: string; start_at: string; end_at: string }>;
  };
};

// ============================================================
// Types - freebusy 候補生成（Phase B-2）
// ============================================================

interface OneOnOneFreebusyPrepareRequest {
  invitee: {
    name: string;
    email?: string;
    contact_id?: string;
  };
  constraints?: {
    time_min?: string;      // ISO8601
    time_max?: string;      // ISO8601
    prefer?: 'morning' | 'afternoon' | 'evening' | 'business' | 'any';
    days?: string[];        // ['mon','tue','wed','thu','fri']
    duration?: number;      // minutes
  };
  candidate_count?: number; // default: 3
  title?: string;
  message_hint?: string;
  send_via?: 'email' | 'share_link';
}

interface OneOnOneFreebusyPrepareResponse {
  success: boolean;
  thread_id: string;
  invite_token: string;
  share_url: string;
  slots: Array<{
    slot_id: string;
    start_at: string;
    end_at: string;
  }>;
  message_for_chat: string;
  mode: 'email' | 'share_link';
  email_queued?: boolean;
  constraints_used: {
    time_min: string;
    time_max: string;
    prefer: string;
    duration: number;
    days: string[];
  };
  request_id: string;
}

// ExecutionResultData 拡張 - freebusy
export type OneOnOneFreebusyResultData = {
  kind: '1on1.freebusy.prepared';
  payload: {
    threadId: string;
    inviteToken: string;
    shareUrl: string;
    mode: 'email' | 'share_link';
    person: { name?: string; email?: string };
    slots: Array<{ slot_id: string; start_at: string; end_at: string }>;
    constraintsUsed: {
      time_min: string;
      time_max: string;
      prefer: string;
      duration: number;
      days: string[];
    };
  };
};

// ============================================================
// Types - Open Slots（Phase B-4）
// ============================================================

interface OneOnOneOpenSlotsPrepareRequest {
  invitee: {
    name: string;
    email?: string;
    contact_id?: string;
  };
  constraints?: {
    time_min?: string;      // ISO8601
    time_max?: string;      // ISO8601
    prefer?: 'morning' | 'afternoon' | 'evening' | 'business' | 'any';
    days?: string[];        // ['mon','tue','wed','thu','fri']
    duration?: number;      // minutes
    slot_interval?: number; // minutes (default: 30)
  };
  title?: string;
  message_hint?: string;
  send_via?: 'email' | 'share_link';
  expires_in_days?: number; // default: 14
}

interface OneOnOneOpenSlotsPrepareResponse {
  success: boolean;
  token: string;
  thread_id: string;
  share_url: string;
  slots_count: number;
  slots: Array<{
    slot_id: string;
    start_at: string;
    end_at: string;
  }>;
  time_range: {
    time_min: string;
    time_max: string;
  };
  constraints_used: {
    time_min: string;
    time_max: string;
    prefer: string;
    duration: number;
    days: string[];
    slot_interval: number;
  };
  message_for_chat: string;
  expires_at: string;
  request_id: string;
}

// ExecutionResultData 拡張 - open_slots
export type OneOnOneOpenSlotsResultData = {
  kind: '1on1.open_slots.prepared';
  payload: {
    threadId: string;
    openSlotsToken: string;
    shareUrl: string;
    person: { name?: string; email?: string };
    slotsCount: number;
    slots: Array<{ slot_id: string; start_at: string; end_at: string }>;
    timeRange: {
      time_min: string;
      time_max: string;
    };
    constraintsUsed: {
      time_min: string;
      time_max: string;
      prefer: string;
      duration: number;
      days: string[];
      slot_interval: number;
    };
    expiresAt: string;
  };
};

// ============================================================
// API Client
// ============================================================

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * POST /api/one-on-one/fixed/prepare を呼び出す
 */
async function callOneOnOnePrepareApi(
  request: OneOnOnePrepareRequest,
  token: string
): Promise<OneOnOnePrepareResponse> {
  const response = await fetch(`${API_BASE_URL}/api/one-on-one/fixed/prepare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || error.details || `API error: ${response.status}`);
  }

  return response.json();
}

/**
 * POST /api/one-on-one/candidates/prepare を呼び出す（Phase B-1）
 */
async function callOneOnOneCandidatesPrepareApi(
  request: OneOnOneCandidatesPrepareRequest,
  token: string
): Promise<OneOnOneCandidatesPrepareResponse> {
  const response = await fetch(`${API_BASE_URL}/api/one-on-one/candidates/prepare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || error.details || `API error: ${response.status}`);
  }

  return response.json();
}

/**
 * POST /api/one-on-one/freebusy/prepare を呼び出す（Phase B-2）
 */
async function callOneOnOneFreebusyPrepareApi(
  request: OneOnOneFreebusyPrepareRequest,
  token: string
): Promise<OneOnOneFreebusyPrepareResponse> {
  const response = await fetch(`${API_BASE_URL}/api/one-on-one/freebusy/prepare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || error.details || `API error: ${response.status}`);
  }

  return response.json();
}

/**
 * POST /api/one-on-one/open-slots/prepare を呼び出す（Phase B-4）
 */
async function callOneOnOneOpenSlotsPrepareApi(
  request: OneOnOneOpenSlotsPrepareRequest,
  token: string
): Promise<OneOnOneOpenSlotsPrepareResponse> {
  const response = await fetch(`${API_BASE_URL}/api/one-on-one/open-slots/prepare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || error.details || `API error: ${response.status}`);
  }

  return response.json();
}

// ============================================================
// Executor
// ============================================================

/**
 * 1対1固定日時の招待リンク発行
 * 
 * @param intentResult - classifyOneOnOne の結果
 * @returns ExecutionResult
 */
export async function executeOneOnOneFixed(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  // 認証トークンを取得
  const token = getToken();
  if (!token) {
    return {
      success: false,
      message: 'ログインが必要です。再度ログインしてください。',
    };
  }
  const { params } = intentResult;

  log.debug('[OneOnOne] executeOneOnOneFixed called', { params });

  // clarification が必要な場合は早期リターン
  if (intentResult.needsClarification) {
    return {
      success: true,
      message: intentResult.needsClarification.message,
    };
  }

  // 必須パラメータのバリデーション
  if (!params.person) {
    return {
      success: false,
      message: '相手の名前かメールアドレスを教えてください。',
    };
  }

  if (!params.start_at || !params.end_at) {
    return {
      success: false,
      message: '日時を教えてください。（例: 来週木曜17時から1時間）',
    };
  }

  try {
    // API リクエストを組み立て
    const request: OneOnOnePrepareRequest = {
      invitee: {
        name: params.person.name || params.person.email || '相手',
        email: params.person.email,
      },
      slot: {
        start_at: params.start_at,
        end_at: params.end_at,
      },
      title: params.title || '打ち合わせ',
      message_hint: params.rawInput,
      // メールアドレスがある場合は email モード、なければ share_link
      send_via: params.person.email ? 'email' : 'share_link',
    };

    log.debug('[OneOnOne] Calling API', { request });

    // API 呼び出し
    const response = await callOneOnOnePrepareApi(request, token);

    log.debug('[OneOnOne] API response', { response });

    // 成功レスポンス
    return {
      success: true,
      message: response.message_for_chat,
      data: {
        kind: '1on1.fixed.prepared',
        payload: {
          threadId: response.thread_id,
          inviteToken: response.invite_token,
          shareUrl: response.share_url,
          mode: response.mode,
          person: params.person,
          slot: {
            start_at: params.start_at,
            end_at: params.end_at,
          },
        },
      } as unknown as ExecutionResultData,
    };

  } catch (error) {
    log.error('[OneOnOne] API call failed', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // ユーザーフレンドリーなエラーメッセージ
    if (errorMessage.includes('Unauthorized')) {
      return {
        success: false,
        message: 'ログインが必要です。再度ログインしてください。',
      };
    }

    if (errorMessage.includes('validation_error')) {
      return {
        success: false,
        message: '入力内容に問題があります。日時と相手の情報を確認してください。',
      };
    }

    return {
      success: false,
      message: `予定調整の準備中にエラーが発生しました: ${errorMessage}`,
    };
  }
}

// ============================================================
// Helper: フォーマッター
// ============================================================

/**
 * 日時を日本語フォーマット
 */
export function formatDateTimeJP(dateStr: string): string {
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[date.getDay()];
  return `${month}/${day}（${weekday}）${hours}:${minutes}`;
}

// ============================================================
// Executor - 候補3つ（Phase B-1）
// ============================================================

/**
 * 1対1候補3つの招待リンク発行
 * 
 * @param intentResult - classifyOneOnOne の結果（intent: 'schedule.1on1.candidates3'）
 * @returns ExecutionResult
 */
export async function executeOneOnOneCandidates(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  // 認証トークンを取得
  const token = getToken();
  if (!token) {
    return {
      success: false,
      message: 'ログインが必要です。再度ログインしてください。',
    };
  }

  const { params } = intentResult;

  log.debug('[OneOnOne] executeOneOnOneCandidates called', { params });

  // clarification が必要な場合は早期リターン
  if (intentResult.needsClarification) {
    return {
      success: true,
      message: intentResult.needsClarification.message,
    };
  }

  // 必須パラメータのバリデーション
  if (!params.person) {
    return {
      success: false,
      message: '相手の名前かメールアドレスを教えてください。',
    };
  }

  if (!params.slots || params.slots.length === 0) {
    return {
      success: false,
      message: '候補日時を教えてください。（例: 来週月曜10時、火曜14時、水曜16時）',
    };
  }

  try {
    // API リクエストを組み立て
    const request: OneOnOneCandidatesPrepareRequest = {
      invitee: {
        name: params.person.name || params.person.email || '相手',
        email: params.person.email,
      },
      slots: params.slots,
      title: params.title || '打ち合わせ',
      message_hint: params.rawInput,
      // メールアドレスがある場合は email モード、なければ share_link
      send_via: params.person.email ? 'email' : 'share_link',
    };

    log.debug('[OneOnOne] Calling candidates API', { request });

    // API 呼び出し
    const response = await callOneOnOneCandidatesPrepareApi(request, token);

    log.debug('[OneOnOne] Candidates API response', { response });

    // 成功レスポンス
    return {
      success: true,
      message: response.message_for_chat,
      data: {
        kind: '1on1.candidates.prepared',
        payload: {
          threadId: response.thread_id,
          inviteToken: response.invite_token,
          shareUrl: response.share_url,
          mode: response.mode,
          person: params.person,
          slots: response.slots,
        },
      } as unknown as ExecutionResultData,
    };

  } catch (error) {
    log.error('[OneOnOne] Candidates API call failed', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // ユーザーフレンドリーなエラーメッセージ
    if (errorMessage.includes('Unauthorized')) {
      return {
        success: false,
        message: 'ログインが必要です。再度ログインしてください。',
      };
    }

    if (errorMessage.includes('validation_error')) {
      return {
        success: false,
        message: '候補日時の形式に問題があります。日時を確認してください。',
      };
    }

    return {
      success: false,
      message: `予定調整の準備中にエラーが発生しました: ${errorMessage}`,
    };
  }
}

// ============================================================
// Executor - freebusy から候補生成（Phase B-2）
// ============================================================

/**
 * 1対1 freebusy から候補生成の招待リンク発行
 * 
 * @param intentResult - classifyOneOnOne の結果（intent: 'schedule.1on1.freebusy'）
 * @returns ExecutionResult
 */
export async function executeOneOnOneFreebusy(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  // 認証トークンを取得
  const token = getToken();
  if (!token) {
    return {
      success: false,
      message: 'ログインが必要です。再度ログインしてください。',
    };
  }

  const { params } = intentResult;

  log.debug('[OneOnOne] executeOneOnOneFreebusy called', { params });

  // clarification が必要な場合は早期リターン
  if (intentResult.needsClarification) {
    return {
      success: true,
      message: intentResult.needsClarification.message,
    };
  }

  // 必須パラメータのバリデーション
  if (!params.person) {
    return {
      success: false,
      message: '相手の名前かメールアドレスを教えてください。',
    };
  }

  try {
    // API リクエストを組み立て
    const request: OneOnOneFreebusyPrepareRequest = {
      invitee: {
        name: params.person.name || params.person.email || '相手',
        email: params.person.email,
      },
      constraints: params.constraints,
      candidate_count: 3,
      title: params.title || '打ち合わせ',
      message_hint: params.rawInput,
      // メールアドレスがある場合は email モード、なければ share_link
      send_via: params.person.email ? 'email' : 'share_link',
    };

    log.debug('[OneOnOne] Calling freebusy API', { request });

    // API 呼び出し
    const response = await callOneOnOneFreebusyPrepareApi(request, token);

    log.debug('[OneOnOne] Freebusy API response', { response });

    // 成功レスポンス
    return {
      success: true,
      message: response.message_for_chat,
      data: {
        kind: '1on1.freebusy.prepared',
        payload: {
          threadId: response.thread_id,
          inviteToken: response.invite_token,
          shareUrl: response.share_url,
          mode: response.mode,
          person: params.person,
          slots: response.slots,
          constraintsUsed: response.constraints_used,
        },
      } as unknown as ExecutionResultData,
    };

  } catch (error) {
    log.error('[OneOnOne] Freebusy API call failed', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // ユーザーフレンドリーなエラーメッセージ
    if (errorMessage.includes('Unauthorized')) {
      return {
        success: false,
        message: 'ログインが必要です。再度ログインしてください。',
      };
    }

    if (errorMessage.includes('calendar_unavailable')) {
      return {
        success: false,
        message: 'カレンダーに接続できませんでした。\nGoogle カレンダー連携を確認してください。',
      };
    }

    if (errorMessage.includes('no_available_slots')) {
      return {
        success: false,
        message: '指定期間に空きが見つかりませんでした。\n期間を広げるか、時間帯を変えてお試しください。',
      };
    }

    return {
      success: false,
      message: `予定調整の準備中にエラーが発生しました: ${errorMessage}`,
    };
  }
}

// ============================================================
// Executor - Open Slots（Phase B-4）
// ============================================================

/**
 * 1対1 Open Slots（TimeRex型公開枠）の招待リンク発行
 * 
 * @param intentResult - classifyOneOnOne の結果（intent: 'schedule.1on1.open_slots'）
 * @returns ExecutionResult
 */
export async function executeOneOnOneOpenSlots(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  // 認証トークンを取得
  const token = getToken();
  if (!token) {
    return {
      success: false,
      message: 'ログインが必要です。再度ログインしてください。',
    };
  }

  const { params } = intentResult;

  log.debug('[OneOnOne] executeOneOnOneOpenSlots called', { params });

  // clarification が必要な場合は早期リターン
  if (intentResult.needsClarification) {
    return {
      success: true,
      message: intentResult.needsClarification.message,
    };
  }

  // 必須パラメータのバリデーション
  if (!params.person) {
    return {
      success: false,
      message: '相手の名前かメールアドレスを教えてください。',
    };
  }

  try {
    // API リクエストを組み立て
    const request: OneOnOneOpenSlotsPrepareRequest = {
      invitee: {
        name: params.person.name || params.person.email || '相手',
        email: params.person.email,
      },
      constraints: params.constraints,
      title: params.title || '打ち合わせ',
      message_hint: params.rawInput,
      // メールアドレスがある場合は email モード、なければ share_link
      send_via: params.person.email ? 'email' : 'share_link',
      expires_in_days: params.expires_in_days || 14,
    };

    log.debug('[OneOnOne] Calling open-slots API', { request });

    // API 呼び出し
    const response = await callOneOnOneOpenSlotsPrepareApi(request, token);

    log.debug('[OneOnOne] Open-slots API response', { response });

    // 成功レスポンス
    return {
      success: true,
      message: response.message_for_chat,
      data: {
        kind: '1on1.open_slots.prepared',
        payload: {
          threadId: response.thread_id,
          openSlotsToken: response.token,
          shareUrl: response.share_url,
          person: params.person,
          slotsCount: response.slots_count,
          slots: response.slots,
          timeRange: response.time_range,
          constraintsUsed: response.constraints_used,
          expiresAt: response.expires_at,
        },
      } as unknown as ExecutionResultData,
    };

  } catch (error) {
    log.error('[OneOnOne] Open-slots API call failed', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // ユーザーフレンドリーなエラーメッセージ
    if (errorMessage.includes('Unauthorized')) {
      return {
        success: false,
        message: 'ログインが必要です。再度ログインしてください。',
      };
    }

    if (errorMessage.includes('calendar_unavailable')) {
      return {
        success: false,
        message: 'カレンダーに接続できませんでした。\nGoogle カレンダー連携を確認してください。',
      };
    }

    if (errorMessage.includes('no_available_slots')) {
      return {
        success: false,
        message: '指定期間に空きが見つかりませんでした。\n期間を広げるか、時間帯を変えてお試しください。',
      };
    }

    return {
      success: false,
      message: `予定調整の準備中にエラーが発生しました: ${errorMessage}`,
    };
  }
}
