/**
 * executors/postImportBridge.ts
 * FE-5: Post-Import Auto-Connect Bridge
 * 
 * 設計思想: 「止めない。聞き直さない。再入力を求めない。」
 * 
 * post_import.next_step.selected の結果を受けて
 * 人数に関係なく適切な executor / API を自動起動する。
 * 
 * 分岐ルール:
 * - send_invite (人数問わず) → executeInvitePrepareEmails
 * - schedule + 1名            → executeOneOnOneFreebusy
 * - schedule + 2名+           → oneToManyApi.prepare + send
 * 
 * 事故ゼロ設計:
 * - この関数自体は pending を作成しない
 * - 既存 executor / API クライアントをそのまま呼ぶ (delegate)
 * - 全パスで try-catch、失敗時は手動入力ガイダンス
 * 
 * FE-6b: generateSlotsWithFreeBusy — 主催者カレンダー空き時間ベースのスロット生成。
 * FreeBusy API 取得失敗時は generateDefaultSlots にフォールバック（事故ゼロ）。
 */

import type { ExecutionResult } from './types';
import { executeOneOnOneFreebusy } from './oneOnOne';
import { executeInvitePrepareEmails } from './invite';
import { oneToManyApi } from '../../api/oneToMany';
import type { PrepareRequest, PrepareResponse, SendResponse } from '../../api/oneToMany';
import { calendarApi } from '../../api/calendar';
import type { FreeBusyParams, AvailableSlot } from '../../api/calendar';
import { log } from '../../platform';

// ============================================================
// Types
// ============================================================

export interface PostImportAutoConnectParams {
  action: 'send_invite' | 'schedule';
  emails: string[];
  names: string[];
}

interface DefaultSlotsConstraints {
  time_min?: string;      // ISO8601
  time_max?: string;      // ISO8601
  prefer?: 'morning' | 'afternoon' | 'evening' | 'business';
  days?: number[];        // 0=日, 1=月, ...
}

// ============================================================
// Main Entry Point
// ============================================================

/**
 * Post-Import 自動接続のメイン関数
 * 
 * useChatReducer から呼ばれ、action に応じて適切な
 * executor / API を自動起動する。
 * 
 * @param params - action, emails, names
 * @returns ExecutionResult
 */
export async function executePostImportAutoConnect(
  params: PostImportAutoConnectParams
): Promise<ExecutionResult> {
  const { action, emails, names } = params;

  log.info('[FE-5] Post-import auto-connect', {
    module: 'postImportBridge',
    action,
    emailCount: emails.length,
  });

  // ============================================================
  // send_invite: 人数問わず → invite prepare
  // v2.1: prepare のみ、送信は確認ステップを経る (不可逆操作ガード)
  // ============================================================
  if (action === 'send_invite') {
    try {
      return await executeInvitePrepareEmails({
        intent: 'invite.prepare.emails',
        confidence: 1.0,
        params: {
          emails,
          mode: 'new_thread',
          rawText: emails.join('\n'),
        },
      });
    } catch (error) {
      log.error('[FE-5] invite prepare failed', {
        module: 'postImportBridge',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        message: '❌ 招待の準備に失敗しました。\nチャットで「○○に招待送って」と入力してください。',
      };
    }
  }

  // ============================================================
  // schedule: 1名 → oneOnOne.freebusy
  // ============================================================
  if (action === 'schedule' && emails.length === 1) {
    try {
      const name = names[0] || emails[0].split('@')[0];
      return await executeOneOnOneFreebusy({
        intent: 'schedule.1on1.freebusy',
        confidence: 1.0,
        params: {
          person: { name, email: emails[0] },
          constraints: { duration: 60 },
          duration_minutes: 60,
          title: '打ち合わせ',
          rawInput: `${name}さんと日程調整`,
        },
      });
    } catch (error) {
      log.error('[FE-5] oneOnOne freebusy failed', {
        module: 'postImportBridge',
        error: error instanceof Error ? error.message : String(error),
      });
      const nameHint = names[0] || emails[0]?.split('@')[0] || '';
      return {
        success: false,
        message: `❌ 日程調整の準備に失敗しました。\nチャットで「${nameHint}さんと日程調整して」と入力してください。`,
      };
    }
  }

  // ============================================================
  // schedule: 2名+ → oneToMany.prepare + send
  // v2.1: prepare → send 一気通貫 (可逆操作なので確認不要)
  // ============================================================
  if (action === 'schedule' && emails.length >= 2) {
    return executeOneToManyFromBridge(emails, names);
  }

  // ============================================================
  // Fallback: 不明なアクション
  // ============================================================
  log.warn('[FE-5] Unknown action or empty emails', {
    module: 'postImportBridge',
    action,
    emailCount: emails.length,
  });
  return {
    success: false,
    message: '❌ 不明なアクションです。',
  };
}

// ============================================================
// OneToMany Bridge (1対N 自動実行)
// ============================================================

/**
 * 1対N 日程調整の自動実行
 * 
 * フロー:
 * 1. generateSlotsWithFreeBusy で主催者カレンダーベースの候補日時を生成（FE-6b）
 * 2. oneToMany.prepare でスレッド作成 (mode: candidates)
 * 3. oneToMany.send で招待送信
 * 4. 結果をチャットメッセージとして返す
 * 
 * TODO(FE-6): この関数を oneToMany executor に移行。
 * classifier 経由の自然言語呼び出しに対応する。
 */
async function executeOneToManyFromBridge(
  emails: string[],
  names: string[]
): Promise<ExecutionResult> {
  try {
    // Step 1: 主催者カレンダーから候補日時を生成（FE-6b: FreeBusy優先）
    const defaultSlots = await generateSlotsWithFreeBusy(3, 60, null);

    // Step 2: oneToMany.prepare
    const prepareReq: PrepareRequest = {
      title: '打ち合わせ',
      mode: 'candidates',
      kind: 'external',
      emails,
      slots: defaultSlots,
      deadline_hours: 72,
      finalize_policy: 'organizer_decides',
    };

    log.debug('[FE-5] oneToMany.prepare request', {
      module: 'postImportBridge',
      emailCount: emails.length,
      slotsCount: defaultSlots.length,
    });

    const prepared: PrepareResponse = await oneToManyApi.prepare(prepareReq);

    if (!prepared.thread?.id) {
      return {
        success: false,
        message: '❌ 日程調整スレッドの作成に失敗しました。\nチャットで「○○さんと日程調整して」と入力してください。',
      };
    }

    // Step 3: send (招待送信)
    log.debug('[FE-5] oneToMany.send', {
      module: 'postImportBridge',
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
      // prepare は成功したが send が失敗 → orphan thread 対策: スレッドURLを返す
      log.error('[FE-5] oneToMany.send failed (prepare succeeded)', {
        module: 'postImportBridge',
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
      };
    }

    // Step 4: 結果メッセージ組み立て
    const message = buildOneToManySuccessMessage(
      emails.length,
      names,
      defaultSlots,
      sendResult,
    );

    return {
      success: true,
      message,
      data: {
        kind: 'thread.create',
        payload: { threadId: prepared.thread.id },
      },
    };

  } catch (error) {
    log.error('[FE-5] oneToMany auto-connect failed', {
      module: 'postImportBridge',
      error: error instanceof Error ? error.message : String(error),
    });

    const nameHint = names[0] || emails[0]?.split('@')[0] || '';
    return {
      success: false,
      message: `❌ 日程調整の準備に失敗しました。\nチャットで「${nameHint}さんと日程調整して」と入力してください。`,
    };
  }
}

// ============================================================
// FE-6b: FreeBusy-aware Slot Generation
// ============================================================

/**
 * 主催者のカレンダー空き時間ベースで候補スロットを生成する。
 * FreeBusy API 取得失敗時は generateDefaultSlots にフォールバック。
 * 
 * @param count - 生成する枠数
 * @param durationMinutes - 各枠の長さ（分）
 * @param constraints - 条件指定（null = デフォルト）
 * @returns 候補スロットの配列
 */
export async function generateSlotsWithFreeBusy(
  count: number,
  durationMinutes: number,
  constraints: DefaultSlotsConstraints | null
): Promise<Array<{ start_at: string; end_at: string; label?: string }>> {
  try {
    // FreeBusy API の range を constraints から決定
    const range = resolveFreeBusyRange(constraints);
    const prefer = constraints?.prefer;

    log.debug('[FE-6b] Fetching host FreeBusy', {
      module: 'slotGeneration',
      range,
      prefer,
      durationMinutes,
    });

    const response = await calendarApi.getFreeBusy({
      range,
      prefer,
      meetingLength: durationMinutes,
    });

    // warning がある場合（カレンダー未連携等）→ フォールバック
    if (response.warning) {
      log.warn('[FE-6b] FreeBusy warning, falling back to default slots', {
        module: 'slotGeneration',
        warning: response.warning,
      });
      return generateDefaultSlots(count, durationMinutes, constraints);
    }

    // available_slots が空 → フォールバック
    if (!response.available_slots || response.available_slots.length === 0) {
      log.warn('[FE-6b] No available slots from FreeBusy, falling back', {
        module: 'slotGeneration',
        busyCount: response.busy?.length ?? 0,
      });
      return generateDefaultSlots(count, durationMinutes, constraints);
    }

    // available_slots から上位 count 件を取得
    // API がスコア順で返すのでそのまま slice
    const selected = response.available_slots.slice(0, count);

    log.info('[FE-6b] Generated slots from host FreeBusy', {
      module: 'slotGeneration',
      totalAvailable: response.available_slots.length,
      selected: selected.length,
    });

    return selected.map(slot => ({
      start_at: slot.start_at,
      end_at: slot.end_at,
      label: slot.label,
    }));

  } catch (error) {
    // API エラー → フォールバック（事故ゼロ）
    log.warn('[FE-6b] FreeBusy API failed, falling back to default slots', {
      module: 'slotGeneration',
      error: error instanceof Error ? error.message : String(error),
    });
    return generateDefaultSlots(count, durationMinutes, constraints);
  }
}

/**
 * constraints から FreeBusy API の range パラメータを決定する
 */
function resolveFreeBusyRange(
  constraints: DefaultSlotsConstraints | null
): FreeBusyParams['range'] {
  if (!constraints?.time_min && !constraints?.time_max) {
    return 'next_week'; // デフォルト: 来週まで見る
  }

  if (constraints.time_max) {
    const now = new Date();
    const max = new Date(constraints.time_max);
    const diffDays = (max.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays <= 1) return 'today';
    if (diffDays <= 7) return 'week';
  }

  return 'next_week';
}

// ============================================================
// Default Slots Generation (Fallback)
// ============================================================

/**
 * デフォルト候補日時を生成（FreeBusy フォールバック用）
 * 
 * constraints なし → 次の営業日から3枠、14:00 / 15:00 / 16:00
 * constraints あり → 指定に従う
 * 
 * @param count - 生成する枠数
 * @param durationMinutes - 各枠の長さ（分）
 * @param constraints - 条件指定（null = デフォルト）
 * @returns 候補スロットの配列
 */
export function generateDefaultSlots(
  count: number,
  durationMinutes: number,
  constraints: DefaultSlotsConstraints | null
): Array<{ start_at: string; end_at: string; label?: string }> {
  const slots: Array<{ start_at: string; end_at: string; label?: string }> = [];
  const now = new Date();
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

  // 営業時間の候補時刻（v2.1: 午後集中がビジネスに合う）
  const businessHours = constraints?.prefer === 'morning'
    ? [9, 10, 11]
    : constraints?.prefer === 'evening'
    ? [17, 18, 19]
    : [14, 15, 16]; // default: afternoon / business

  // 許可する曜日（0=日, 1=月, ... 6=土）
  const allowedDays = constraints?.days || [1, 2, 3, 4, 5]; // default: 月〜金

  let currentDate = new Date(now);
  currentDate.setDate(currentDate.getDate() + 1); // 明日から
  currentDate.setHours(0, 0, 0, 0);

  // constraints の time_min がある場合、開始日を調整
  if (constraints?.time_min) {
    const minDate = new Date(constraints.time_min);
    if (minDate > currentDate) {
      currentDate = new Date(minDate);
      currentDate.setHours(0, 0, 0, 0);
    }
  }

  // constraints の time_max がある場合の上限
  const maxDate = constraints?.time_max ? new Date(constraints.time_max) : null;

  let hourIndex = 0;
  let safetyCounter = 0;
  const MAX_ITERATIONS = 100; // 無限ループ防止

  while (slots.length < count && safetyCounter < MAX_ITERATIONS) {
    safetyCounter++;
    const dayOfWeek = currentDate.getDay();

    // 上限日を超えたら打ち切り
    if (maxDate && currentDate > maxDate) {
      break;
    }

    // 許可された曜日か
    if (allowedDays.includes(dayOfWeek)) {
      const hour = businessHours[hourIndex % businessHours.length];
      const startAt = new Date(currentDate);
      startAt.setHours(hour, 0, 0, 0);
      const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

      const m = startAt.getMonth() + 1;
      const d = startAt.getDate();
      const day = dayNames[startAt.getDay()];
      const hh = hour.toString().padStart(2, '0');
      const ehh = endAt.getHours().toString().padStart(2, '0');
      const emm = endAt.getMinutes().toString().padStart(2, '0');

      slots.push({
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        label: `${m}/${d}(${day}) ${hh}:00〜${ehh}:${emm}`,
      });

      hourIndex++;

      // 同日の次の時刻へ。全時刻使い切ったら翌日へ
      if (hourIndex % businessHours.length === 0) {
        currentDate.setDate(currentDate.getDate() + 1);
      }
    } else {
      // 対象外の曜日はスキップ
      currentDate.setDate(currentDate.getDate() + 1);
      hourIndex = 0;
    }
  }

  return slots;
}

// ============================================================
// Message Builders
// ============================================================

/**
 * 1対N 成功時のチャットメッセージを組み立てる
 */
function buildOneToManySuccessMessage(
  participantCount: number,
  names: string[],
  slots: Array<{ start_at: string; end_at: string; label?: string }>,
  sendResult: SendResponse
): string {
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

  const nameList = names.slice(0, 5).join('、');
  const more = names.length > 5 ? ` 他${names.length - 5}名` : '';

  const slotLines = slots.map((s, i) => {
    if (s.label) {
      return `  ${i + 1}. ${s.label}`;
    }
    // label がない場合は start_at/end_at から生成
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
    `📋 打ち合わせ（${participantCount}名参加）`,
    '📅 候補日時:',
    slotLines,
    `📧 ${nameList}${more} に招待メールを送信しました。`,
    '⏰ 回答期限: 72時間',
  ];

  return lines.join('\n');
}
