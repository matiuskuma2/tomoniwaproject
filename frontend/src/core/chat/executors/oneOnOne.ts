/**
 * oneOnOne.ts
 * v1.0: 1対1予定調整（固定日時スタート）の Executor
 * v1.1: Phase B-1 候補3つ提示対応
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
