/**
 * CardsPane
 * Right pane: displays status cards + calendar cards (Phase Next-3 Day4)
 * Uses GET /api/threads/:id/status + Calendar API
 * 
 * P1-3: viewerTz is passed down so all time rendering uses users/me.timezone
 * 
 * SSOT更新:
 * - ThreadCardsSwitch を使用して topology/mode に基づいてカードを出し分け
 * - USE_THREAD_CARDS_SWITCH フラグで段階的移行
 */

import { ThreadCardsSwitch } from '../cards/ThreadCardsSwitch';
import { ThreadStatusCard } from '../cards/ThreadStatusCard';
import { InvitesCard } from '../cards/InvitesCard';
import { SlotsCard } from '../cards/SlotsCard';
import { MeetCard } from '../cards/MeetCard';
import { CalendarTodayCard } from '../cards/CalendarTodayCard';
import { CalendarWeekCard } from '../cards/CalendarWeekCard';
import { FreeBusyCard } from '../cards/FreeBusyCard';
import type { 
  ThreadStatus_API, 
  CalendarTodayResponse, 
  CalendarWeekResponse, 
  CalendarFreeBusyResponse 
} from '../../core/models';

// 段階的移行フラグ: true で ThreadCardsSwitch を使用
// TODO: ExecutionResult型の統一後に true に切り替え
const USE_THREAD_CARDS_SWITCH = false;

interface CardsPaneProps {
  status: ThreadStatus_API | null;
  loading: boolean;
  calendarData?: {
    today?: CalendarTodayResponse;
    week?: CalendarWeekResponse;
    freebusy?: CalendarFreeBusyResponse;
  };
  viewerTz?: string; // P1-3: user timezone
}

export function CardsPane({ status, loading, calendarData, viewerTz }: CardsPaneProps) {
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Show calendar cards only (when data exists but no thread selected)
  const hasCalendarData = calendarData?.today || calendarData?.week || calendarData?.freebusy;
  
  if (!status && !hasCalendarData) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">スレッドを選択するか、カレンダーを確認してください</p>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-50 border-l border-gray-200 overflow-y-auto p-4">
      {/* Phase Next-3 (Day4): Calendar Cards (show when data exists) */}
      {calendarData?.today && <CalendarTodayCard data={calendarData.today} viewerTz={viewerTz} />}
      {calendarData?.week && <CalendarWeekCard data={calendarData.week} viewerTz={viewerTz} />}
      {calendarData?.freebusy && <FreeBusyCard data={calendarData.freebusy} viewerTz={viewerTz} />}
      
      {/* Phase Next-2: Thread Status Cards (show when thread is selected) */}
      {/* SSOT: ThreadCardsSwitch で topology/mode に基づいてカードを出し分け */}
      {status && USE_THREAD_CARDS_SWITCH && (
        <ThreadCardsSwitch status={status} viewerTz={viewerTz} />
      )}
      
      {/* Legacy: 段階的移行中のフォールバック */}
      {status && !USE_THREAD_CARDS_SWITCH && (
        <>
          <ThreadStatusCard status={status} viewerTz={viewerTz} />
          <InvitesCard status={status} />
          <SlotsCard status={status} viewerTz={viewerTz} />
          <MeetCard status={status} />
        </>
      )}
    </div>
  );
}
