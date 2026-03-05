/**
 * executors/reverseAvailability.ts
 * PR-B6: 逆アベイラビリティ（ご都合伺い）Executor
 *
 * チャットから起動:
 * 1. classifyReverseAvailability → 'schedule.1on1.reverse_availability'
 * 2. executeReverseAvailability → POST /api/reverse-availability/prepare
 * 3. message_for_chat をユーザーに返す
 *
 * 確定フロー:
 * 1. 相手が候補を送信 → チャットメッセージ + Inbox通知
 * 2. 主催者が番号選択 → executeReverseAvailabilityFinalize
 * 3. → POST /api/reverse-availability/:id/finalize
 */

import type { IntentResult } from '../intentClassifier';
import type { ExecutionResult } from './types';
import { log } from '../../platform';
import { getToken } from '../../auth';

// ============================================================
// Types
// ============================================================

interface RAPrepareRequest {
  target: {
    name?: string;
    email: string;
  };
  title?: string;
  duration_minutes?: number;
  time_range?: {
    time_min?: string;
    time_max?: string;
  };
  preferred_slots_count?: number;
  send_email?: boolean;
}

interface RAPrepareResponse {
  success: boolean;
  thread_id: string;
  reverse_availability_id: string;
  token: string;
  share_url: string;
  expires_at: string;
  message_for_chat: string;
  email_queued: boolean;
  request_id: string;
}

interface RAFinalizeResponse {
  success: boolean;
  thread_id: string;
  finalized_slot: {
    start: string;
    end: string;
    label: string;
  };
  meet_url: string | null;
  calendar_event_id: string | null;
  message_for_chat: string;
  request_id: string;
}

// ============================================================
// Main Executor: prepare
// ============================================================

/**
 * 逆アベイラビリティの準備実行
 * POST /api/reverse-availability/prepare を呼び出す
 */
export async function executeReverseAvailability(
  intentResult: IntentResult,
): Promise<ExecutionResult> {
  const params = intentResult.params || {};
  log.debug('[RA] executeReverseAvailability called', params);

  // clarification が必要な場合はそのまま返す
  if (intentResult.needsClarification) {
    return {
      success: true,
      message: intentResult.needsClarification.message,
    };
  }

  const target = params.target as { name?: string; email?: string } | undefined;

  // メールアドレスが必要
  if (!target?.email) {
    return {
      success: true,
      message: [
        '🙏 ご都合伺いモードですね。',
        '',
        target?.name
          ? `${target.name}さんのメールアドレスを教えてください。`
          : '相手のお名前とメールアドレスを教えてください。',
      ].join('\n'),
    };
  }

  // API呼び出し
  try {
    const token = getToken();
    if (!token) {
      return {
        success: false,
        message: 'ログインが必要です。ログインしてからもう一度お試しください。',
      };
    }

    const requestBody: RAPrepareRequest = {
      target: {
        name: target.name || undefined,
        email: target.email,
      },
      title: params.title || '打ち合わせ',
      duration_minutes: params.duration_minutes || 60,
      send_email: true,
    };

    log.debug('[RA] Calling prepare API', requestBody);

    const response = await fetch('/api/reverse-availability/prepare', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (response.status === 401) {
      return {
        success: false,
        message: 'セッションが切れています。再ログインしてください。',
      };
    }

    const data = (await response.json()) as RAPrepareResponse;

    if (!data.success) {
      log.error('[RA] Prepare failed', data);
      return {
        success: false,
        message: 'ご都合伺いの作成に失敗しました。もう一度お試しください。',
      };
    }

    log.info('[RA] Prepare succeeded', {
      thread_id: data.thread_id,
      ra_id: data.reverse_availability_id,
      share_url: data.share_url,
    });

    return {
      success: true,
      message: data.message_for_chat,
      data: {
        kind: 'reverse_availability.prepare',
        thread_id: data.thread_id,
        reverse_availability_id: data.reverse_availability_id,
        share_url: data.share_url,
        token: data.token,
        expires_at: data.expires_at,
        email_queued: data.email_queued,
      } as any,
    };

  } catch (error) {
    log.error('[RA] Prepare error', { error: error instanceof Error ? error.message : String(error) });
    return {
      success: false,
      message: '通信エラーが発生しました。しばらく経ってからお試しください。',
    };
  }
}

// ============================================================
// Finalize Executor
// ============================================================

/**
 * 逆アベイラビリティの確定実行
 * POST /api/reverse-availability/:id/finalize を呼び出す
 *
 * Note: 確定フローは pending.action 経由で番号選択を受け取る。
 * このexecutorはapiExecutorから直接呼ばれる想定。
 */
export async function executeReverseAvailabilityFinalize(
  raId: string,
  slotIndex: number,
): Promise<ExecutionResult> {
  log.debug('[RA] executeReverseAvailabilityFinalize called', { raId, slotIndex });

  try {
    const token = getToken();
    if (!token) {
      return {
        success: false,
        message: 'ログインが必要です。ログインしてからもう一度お試しください。',
      };
    }

    const response = await fetch(`/api/reverse-availability/${raId}/finalize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ slot_index: slotIndex }),
    });

    if (response.status === 401) {
      return {
        success: false,
        message: 'セッションが切れています。再ログインしてください。',
      };
    }

    const data = (await response.json()) as RAFinalizeResponse;

    if (!data.success) {
      log.error('[RA] Finalize failed', data);
      return {
        success: false,
        message: '日程の確定に失敗しました。もう一度お試しください。',
      };
    }

    log.info('[RA] Finalize succeeded', {
      thread_id: data.thread_id,
      finalized_slot: data.finalized_slot,
      meet_url: data.meet_url,
    });

    return {
      success: true,
      message: data.message_for_chat,
      data: {
        kind: 'reverse_availability.finalize',
        thread_id: data.thread_id,
        finalized_slot: data.finalized_slot,
        meet_url: data.meet_url,
        calendar_event_id: data.calendar_event_id,
      } as any,
    };

  } catch (error) {
    log.error('[RA] Finalize error', { error: error instanceof Error ? error.message : String(error) });
    return {
      success: false,
      message: '通信エラーが発生しました。しばらく経ってからお試しください。',
    };
  }
}
