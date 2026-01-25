/**
 * Calendar Executors
 * 
 * P1-1: apiExecutor.ts から分離
 * P3-SLOTGEN1: freebusy に空き枠表示を追加
 * P3-INTERSECT1: 共通空き（複数参加者）
 * 
 * - schedule.today
 * - schedule.week
 * - schedule.freebusy
 * - schedule.freebusy.batch
 */

import { calendarApi } from '../../api/calendar';
import type { FreeBusyParams, TimePreference, BatchFreeBusyParams, ScoredSlot, ScoreReason, ScoreReasonKind } from '../../api/calendar';
import type { IntentResult } from '../intentClassifier';
import type { ExecutionResult } from './types';
import { formatDateTimeForViewer, formatDateTimeRangeForViewer, DEFAULT_TIMEZONE } from '../../../utils/datetime';

/**
 * Format time range (time only, same day assumed)
 */
function formatTimeRange(start: string, end: string): string {
  const startTime = formatDateTimeForViewer(start, DEFAULT_TIMEZONE);
  const endTime = formatDateTimeForViewer(end, DEFAULT_TIMEZONE);
  return `${startTime} - ${endTime}`;
}

/**
 * Format date-time range (with date)
 * ⚠️ toLocaleString 直書き禁止: datetime.ts の関数を使用
 */
function formatDateTimeRange(start: string, end: string): string {
  return formatDateTimeRangeForViewer(start, end, DEFAULT_TIMEZONE);
}

/**
 * Get warning message for calendar API
 */
function getWarningMessage(warning: string): string {
  switch (warning) {
    case 'google_calendar_permission_missing':
      return '⚠️ Google カレンダーへのアクセス権限がありません。設定画面から権限を付与してください。';
    case 'google_account_not_linked':
      return '⚠️ Google アカウントが連携されていません。設定画面から連携してください。';
    default:
      return `⚠️ ${warning}`;
  }
}

/**
 * P1-1: schedule.today
 */
export async function executeToday(): Promise<ExecutionResult> {
  try {
    const response = await calendarApi.getToday();
    
    // Handle warnings
    if (response.warning) {
      return {
        success: true,
        message: getWarningMessage(response.warning),
        data: {
          kind: 'calendar.today',
          payload: response,
        },
      };
    }
    
    // No events
    if (response.events.length === 0) {
      return {
        success: true,
        message: '今日の予定はありません。',
        data: {
          kind: 'calendar.today',
          payload: response,
        },
      };
    }
    
    // Build message with events
    let message = `📅 今日の予定（${response.events.length}件）\n\n`;
    response.events.forEach((event, index) => {
      message += `${index + 1}. ${event.summary}\n`;
      message += `   ${formatTimeRange(event.start, event.end)}\n`;
      if (event.meet_url) {
        message += `   🎥 Meet: ${event.meet_url}\n`;
      }
      message += '\n';
    });
    
    return {
      success: true,
      message,
      data: {
        kind: 'calendar.today',
        payload: response,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * P1-2: schedule.week
 */
export async function executeWeek(): Promise<ExecutionResult> {
  try {
    const response = await calendarApi.getWeek();
    
    // Handle warnings
    if (response.warning) {
      return {
        success: true,
        message: getWarningMessage(response.warning),
        data: {
          kind: 'calendar.week',
          payload: response,
        },
      };
    }
    
    // No events
    if (response.events.length === 0) {
      return {
        success: true,
        message: '今週の予定はありません。',
        data: {
          kind: 'calendar.week',
          payload: response,
        },
      };
    }
    
    // Build message with events
    let message = `📅 今週の予定（${response.events.length}件）\n\n`;
    response.events.forEach((event, index) => {
      message += `${index + 1}. ${event.summary}\n`;
      message += `   ${formatDateTimeRange(event.start, event.end)}\n`;
      if (event.meet_url) {
        message += `   🎥 Meet: ${event.meet_url}\n`;
      }
      message += '\n';
    });
    
    return {
      success: true,
      message,
      data: {
        kind: 'calendar.week',
        payload: response,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * P3-SLOTGEN1: Range label helper
 */
function getRangeLabel(range: string): string {
  switch (range) {
    case 'today':
      return '今日';
    case 'week':
      return '今週';
    case 'next_week':
      return '来週';
    default:
      return range;
  }
}

/**
 * P3-SLOTGEN1: Prefer label helper
 */
function getPreferLabel(prefer: string | undefined): string | null {
  switch (prefer) {
    case 'morning':
      return '午前（9:00-12:00）';
    case 'afternoon':
      return '午後（14:00-18:00）';
    case 'evening':
      return '夜（18:00-21:00）';
    case 'business':
      return '営業時間（9:00-18:00）';
    default:
      return null;
  }
}

/**
 * P3-SCORE1: 理由を参加者別に圧縮して返す
 */
interface CompressedReason {
  participant_label: string;
  rule_label: string;
  delta: number;
  kind: ScoreReasonKind;
}

function compressReasons(reasons: ScoreReason[], maxReasons: number = 3): CompressedReason[] {
  if (!reasons || reasons.length === 0) return [];
  
  // tiebreakを除外
  const filtered = reasons.filter(r => r.kind !== 'tiebreak');
  
  // 参加者+ルール別に合算
  const aggregated = new Map<string, CompressedReason>();
  
  for (const r of filtered) {
    const key = `${r.participant_label}:${r.rule_label}`;
    const existing = aggregated.get(key);
    if (existing) {
      existing.delta += r.delta;
    } else {
      aggregated.set(key, {
        participant_label: r.participant_label,
        rule_label: r.rule_label,
        delta: r.delta,
        kind: r.kind,
      });
    }
  }
  
  // deltaの絶対値でソートして上位を取得
  const sorted = [...aggregated.values()].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return sorted.slice(0, maxReasons);
}

/**
 * P3-SCORE1: 圧縮した理由を表示用文字列にフォーマット
 * 例: "- 田中さん: 午後(14:00-18:00)に合致 (+10)"
 */
function formatCompressedReasons(reasons: CompressedReason[]): string {
  if (reasons.length === 0) return '';
  
  return reasons.map(r => {
    const sign = r.delta >= 0 ? '+' : '';
    const actionWord = r.kind === 'avoid' ? 'に該当' : 'に合致';
    return `- ${r.participant_label}: ${r.rule_label}${actionWord} (${sign}${r.delta})`;
  }).join('\n');
}

/**
 * P3-GEN1: Format score reasons for display (後方互換)
 * @deprecated compressReasons + formatCompressedReasons を使用
 */
function _formatScoreReasons(reasons: ScoreReason[], maxReasons: number = 2): string {
  const compressed = compressReasons(reasons, maxReasons);
  if (compressed.length === 0) return '';
  
  return compressed.map(r => {
    const sign = r.delta >= 0 ? '+' : '';
    return `${sign}${r.delta} ${r.rule_label}`;
  }).join(', ');
}

/**
 * P1-3 + P3-SLOTGEN1: schedule.freebusy
 * 空き枠候補を表示するように拡張
 */
export async function executeFreeBusy(intentResult: IntentResult): Promise<ExecutionResult> {
  // P3-SLOTGEN1: Extract params from intent
  const range = (intentResult.params.range as FreeBusyParams['range']) || 'today';
  const prefer = intentResult.params.prefer as TimePreference | undefined;
  const meetingLength = intentResult.params.meeting_length as number | undefined;
  
  try {
    // P3-SLOTGEN1: Use enhanced API with full params
    const response = await calendarApi.getFreeBusy({
      range,
      prefer,
      meetingLength,
    });
    
    // Handle warnings
    if (response.warning) {
      return {
        success: true,
        message: getWarningMessage(response.warning),
        data: {
          kind: 'calendar.freebusy',
          payload: response,
        },
      };
    }
    
    const rangeLabel = getRangeLabel(range);
    const preferLabel = getPreferLabel(prefer);
    
    // P3-SLOTGEN1: Build message with available slots (primary) + busy slots (secondary)
    let message = '';
    
    // 1. 空き枠候補（メイン表示）
    if (response.available_slots && response.available_slots.length > 0) {
      const durationLabel = meetingLength ? `${meetingLength}分` : '60分';
      message += `✅ ${rangeLabel}の空いている候補（${durationLabel}枠）:\n\n`;
      
      if (preferLabel) {
        message += `📌 ${preferLabel}で絞り込み\n\n`;
      }
      
      response.available_slots.forEach((slot, index) => {
        message += `${index + 1}. ${slot.label}\n`;
      });
      
      // 候補数が多い場合のヒント
      if (response.coverage && response.coverage.slot_count >= 8) {
        message += `\n💡 他にも候補があります。条件を変えて再検索できます。`;
      }
    } else {
      // 空き枠がない場合
      if (preferLabel) {
        message += `⚠️ ${rangeLabel}の${preferLabel}では${meetingLength || 60}分の空きが見つかりませんでした。\n`;
        message += `💡 条件（時間帯/日付/ミーティング時間）を変えて再検索してください。`;
      } else {
        message += `⚠️ ${rangeLabel}は${meetingLength || 60}分の空きが見つかりませんでした。\n`;
        message += `💡 別の期間を指定して再検索してください。`;
      }
    }
    
    // 2. 埋まっている時間（補助表示）
    if (response.busy.length > 0) {
      message += `\n\n📊 ${rangeLabel}の予定が入っている時間:\n`;
      const busyToShow = response.busy.slice(0, 5); // 最大5件
      busyToShow.forEach((slot, index) => {
        message += `${index + 1}. ${formatDateTimeRange(slot.start, slot.end)}\n`;
      });
      if (response.busy.length > 5) {
        message += `他${response.busy.length - 5}件...\n`;
      }
    }
    
    return {
      success: true,
      message,
      data: {
        kind: 'calendar.freebusy',
        payload: response,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * P3-INTERSECT1: schedule.freebusy.batch
 * 複数参加者の共通空き枠を表示
 */
export async function executeFreeBusyBatch(intentResult: IntentResult): Promise<ExecutionResult> {
  // Extract params from intent
  const range = (intentResult.params.range as BatchFreeBusyParams['range']) || 'week';
  const prefer = intentResult.params.prefer as TimePreference | undefined;
  const meetingLength = intentResult.params.meeting_length as number | undefined;
  const threadId = intentResult.params.threadId as string | undefined;
  
  try {
    // Call batch freebusy API
    const response = await calendarApi.getBatchFreeBusy({
      threadId,
      range,
      prefer,
      meetingLength,
    });
    
    const rangeLabel = getRangeLabel(range);
    const preferLabel = getPreferLabel(prefer);
    
    // Build message
    let message = '';
    
    // Warning handling
    if (response.warning === 'google_calendar_not_linked_all') {
      return {
        success: true,
        message: '⚠️ Google カレンダーが連携されているユーザーがいません。設定画面から連携してください。',
        data: {
          kind: 'calendar.freebusy.batch',
          payload: response,
        },
      };
    }
    
    // 1. 参加者情報
    const linkedCount = response.linked_count;
    const excludedCount = response.excluded_count;
    const totalCount = linkedCount + excludedCount;
    
    if (totalCount > 1) {
      message += `👥 ${totalCount}名中${linkedCount}名のカレンダーを参照\n`;
      if (excludedCount > 0) {
        message += `⚠️ ${excludedCount}名は未連携のため共通空き計算から除外\n`;
      }
      message += '\n';
    }
    
    // 2. 共通空き枠（メイン表示）
    // P3-GEN1: スコア付きスロットを優先表示
    const slotsToDisplay = response.scored_slots && response.scored_slots.length > 0
      ? response.scored_slots
      : response.available_slots;
    const hasScoring = response.has_preferences && response.scored_slots && response.scored_slots.length > 0;
    
    if (slotsToDisplay && slotsToDisplay.length > 0) {
      const durationLabel = meetingLength ? `${meetingLength}分` : '60分';
      message += `✅ ${rangeLabel}の共通空き候補（${durationLabel}枠）:\n\n`;
      
      if (preferLabel) {
        message += `📌 ${preferLabel}で絞り込み\n\n`;
      }
      
      if (hasScoring) {
        // P3-SCORE1: スコア付きで表示（理由は上位3件のみ表示）
        message += `⭐ 好みに基づいてスコア順で表示:\n\n`;
        (response.scored_slots as ScoredSlot[]).forEach((slot, index) => {
          const compressed = compressReasons(slot.reasons, 3);
          const reasonsStr = formatCompressedReasons(compressed);
          
          // スロット行
          message += `${index + 1}. ${slot.label}`;
          if (slot.score !== 0) {
            message += ` [スコア: ${slot.score}]`;
          }
          message += '\n';
          
          // P3-SCORE1: 理由行（上位3件のみ、インデント付き）
          if (reasonsStr) {
            const indentedReasons = reasonsStr.split('\n').map(line => `   ${line}`).join('\n');
            message += `${indentedReasons}\n`;
          }
        });
      } else {
        // 通常表示
        slotsToDisplay.forEach((slot, index) => {
          message += `${index + 1}. ${slot.label}\n`;
        });
      }
      
      // 候補数が多い場合のヒント
      if (response.coverage && response.coverage.slot_count >= 8) {
        message += `\n💡 他にも候補があります。条件を変えて再検索できます。`;
      }
    } else {
      // 共通空きがない場合
      if (preferLabel) {
        message += `⚠️ ${rangeLabel}の${preferLabel}では${meetingLength || 60}分の共通空きが見つかりませんでした。\n`;
        message += `💡 条件（時間帯/日付/ミーティング時間）を変えて再検索してください。`;
      } else {
        message += `⚠️ ${rangeLabel}は${meetingLength || 60}分の共通空きが見つかりませんでした。\n`;
        message += `💡 別の期間を指定して再検索してください。`;
      }
    }
    
    // 3. 全体のbusy（補助表示）
    if (response.busy_union && response.busy_union.length > 0) {
      message += `\n\n📊 ${rangeLabel}の誰かが埋まっている時間:\n`;
      const busyToShow = response.busy_union.slice(0, 5); // 最大5件
      busyToShow.forEach((slot, index) => {
        message += `${index + 1}. ${formatDateTimeRange(slot.start, slot.end)}\n`;
      });
      if (response.busy_union.length > 5) {
        message += `他${response.busy_union.length - 5}件...\n`;
      }
    }
    
    return {
      success: true,
      message,
      data: {
        kind: 'calendar.freebusy.batch',
        payload: response,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}
