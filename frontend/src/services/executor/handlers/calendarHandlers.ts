/**
 * Calendar Handlers - カレンダー関連の実行ハンドラ
 * 
 * 対応Intent:
 * - schedule.today
 * - schedule.week  
 * - schedule.freebusy
 */

import { calendarApi } from '../../../core/api/calendar';
import type { IntentResult } from '../../../core/chat/intentClassifier';
import type { ExecutionResult } from '../types';
import { formatTimeRange, formatDateTimeRange, getWarningMessage } from '../utils';

// ============================================================
// schedule.today
// ============================================================

export async function executeToday(): Promise<ExecutionResult> {
  try {
    const response = await calendarApi.getToday();
    
    // Handle warnings
    if (response.warning) {
      return {
        success: true,
        message: getWarningMessage(response.warning),
        data: { kind: 'calendar.today', payload: response },
      };
    }
    
    // No events
    if (response.events.length === 0) {
      return {
        success: true,
        message: '今日の予定はありません。',
        data: { kind: 'calendar.today', payload: response },
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
      data: { kind: 'calendar.today', payload: response },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

// ============================================================
// schedule.week
// ============================================================

export async function executeWeek(): Promise<ExecutionResult> {
  try {
    const response = await calendarApi.getWeek();
    
    // Handle warnings
    if (response.warning) {
      return {
        success: true,
        message: getWarningMessage(response.warning),
        data: { kind: 'calendar.week', payload: response },
      };
    }
    
    // No events
    if (response.events.length === 0) {
      return {
        success: true,
        message: '今週の予定はありません。',
        data: { kind: 'calendar.week', payload: response },
      };
    }
    
    // Build message grouped by day
    let message = `📅 今週の予定（${response.events.length}件）\n\n`;
    
    // Group events by date
    const eventsByDate: Record<string, typeof response.events> = {};
    response.events.forEach((event) => {
      const date = new Date(event.start).toLocaleDateString('ja-JP', {
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      });
      if (!eventsByDate[date]) {
        eventsByDate[date] = [];
      }
      eventsByDate[date].push(event);
    });
    
    Object.entries(eventsByDate).forEach(([date, events]) => {
      message += `📆 ${date}\n`;
      events.forEach((event) => {
        message += `  • ${event.summary} (${formatTimeRange(event.start, event.end)})\n`;
      });
      message += '\n';
    });
    
    return {
      success: true,
      message,
      data: { kind: 'calendar.week', payload: response },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

// ============================================================
// schedule.freebusy
// ============================================================

export async function executeFreeBusy(intentResult: IntentResult): Promise<ExecutionResult> {
  try {
    const duration = intentResult.params.duration || 60;
    const response = await calendarApi.getFreeBusy({ days: 7, duration });
    
    // Handle warnings
    if (response.warning) {
      return {
        success: true,
        message: getWarningMessage(response.warning),
        data: { kind: 'calendar.freebusy', payload: response },
      };
    }
    
    // No free slots
    if (response.free_slots.length === 0) {
      return {
        success: true,
        message: `${duration}分以上の空き時間が見つかりませんでした。`,
        data: { kind: 'calendar.freebusy', payload: response },
      };
    }
    
    // Build message with free slots
    let message = `🕐 空き時間（${response.free_slots.length}件）\n`;
    message += `（${duration}分以上の空き）\n\n`;
    
    // Group by date
    const slotsByDate: Record<string, typeof response.free_slots> = {};
    response.free_slots.forEach((slot) => {
      const date = new Date(slot.start).toLocaleDateString('ja-JP', {
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      });
      if (!slotsByDate[date]) {
        slotsByDate[date] = [];
      }
      slotsByDate[date].push(slot);
    });
    
    Object.entries(slotsByDate).forEach(([date, slots]) => {
      message += `📆 ${date}\n`;
      slots.forEach((slot) => {
        message += `  • ${formatTimeRange(slot.start, slot.end)}\n`;
      });
      message += '\n';
    });
    
    return {
      success: true,
      message,
      data: { kind: 'calendar.freebusy', payload: response },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}
