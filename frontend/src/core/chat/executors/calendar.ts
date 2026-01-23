/**
 * Calendar Executors
 * 
 * P1-1: apiExecutor.ts から分離
 * P3-SLOTGEN1: freebusy に空き枠表示を追加
 * 
 * - schedule.today
 * - schedule.week
 * - schedule.freebusy
 */

import { calendarApi } from '../../api/calendar';
import type { FreeBusyParams, TimePreference } from '../../api/calendar';
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
