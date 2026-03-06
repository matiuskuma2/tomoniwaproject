/**
 * CardsPane
 * Right pane: displays status cards + calendar cards (Phase Next-3 Day4)
 * Uses GET /api/threads/:id/status + Calendar API
 * 
 * P1-3: viewerTz is passed down so all time rendering uses users/me.timezone
 * 
 * PR-UX-6: early return spinner 廃止
 *   pane は常に箱を描画し、中身だけ skeleton にする
 *   全画面スピナーで pane ごと消すのは禁止
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
// SSOT: topology/mode に基づいたカード分岐を有効化（2026-02-05）
const USE_THREAD_CARDS_SWITCH = true;

interface CardsPaneProps {
  status: ThreadStatus_API | null;
  initialLoading: boolean;  // PR-UX-2: 初回ロードのみ true
  refreshing?: boolean;  // PR-UX-2: バックグラウンド再取得中
  calendarData?: {
    today?: CalendarTodayResponse;
    week?: CalendarWeekResponse;
    freebusy?: CalendarFreeBusyResponse;
  };
  viewerTz?: string; // P1-3: user timezone
}

/**
 * PR-UX-6: カード skeleton コンポーネント
 * pane全体をスピナーで潰さず、カード形状の skeleton を表示
 */
function CardsSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Thread Status Card skeleton */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-3"></div>
        <div className="space-y-2">
          <div className="h-3 bg-gray-200 rounded w-full"></div>
          <div className="h-3 bg-gray-200 rounded w-2/3"></div>
        </div>
      </div>
      {/* Invites Card skeleton */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="h-4 bg-gray-200 rounded w-1/4 mb-3"></div>
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 bg-gray-200 rounded-full"></div>
            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 bg-gray-200 rounded-full"></div>
            <div className="h-3 bg-gray-200 rounded w-2/5"></div>
          </div>
        </div>
      </div>
      {/* Slots Card skeleton */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-3"></div>
        <div className="space-y-2">
          <div className="h-8 bg-gray-200 rounded w-full"></div>
          <div className="h-8 bg-gray-200 rounded w-full"></div>
        </div>
      </div>
    </div>
  );
}

export function CardsPane({ status, initialLoading, refreshing = false, calendarData, viewerTz }: CardsPaneProps) {
  const hasCalendarData = calendarData?.today || calendarData?.week || calendarData?.freebusy;

  // PR-UX-6: pane は常に描画。中身だけ条件分岐。
  return (
    <div className="h-full bg-gray-50 border-l border-gray-200 overflow-y-auto p-4">
      {/* PR-UX-6: バックグラウンド同期中の極小インジケーター */}
      {refreshing && (status || hasCalendarData) && (
        <div className="flex items-center justify-center py-0.5 mb-2">
          <div className="flex items-center space-x-1 text-[10px] text-gray-300">
            <div className="animate-spin rounded-full h-2 w-2 border-b border-gray-300"></div>
            <span>同期中</span>
          </div>
        </div>
      )}

      {/* Phase Next-3 (Day4): Calendar Cards (show when data exists) */}
      {calendarData?.today && <CalendarTodayCard data={calendarData.today} viewerTz={viewerTz} />}
      {calendarData?.week && <CalendarWeekCard data={calendarData.week} viewerTz={viewerTz} />}
      {calendarData?.freebusy && <FreeBusyCard data={calendarData.freebusy} viewerTz={viewerTz} />}
      
      {/* PR-UX-6: status ロード中は skeleton、ロード済みなら実カード */}
      {status ? (
        <>
          {/* Phase Next-2: Thread Status Cards (show when thread is selected) */}
          {/* SSOT: ThreadCardsSwitch で topology/mode に基づいてカードを出し分け */}
          {USE_THREAD_CARDS_SWITCH ? (
            <ThreadCardsSwitch status={status} viewerTz={viewerTz} />
          ) : (
            <>
              <ThreadStatusCard status={status} viewerTz={viewerTz} />
              <InvitesCard status={status} />
              <SlotsCard status={status} viewerTz={viewerTz} />
              <MeetCard status={status} />
            </>
          )}
        </>
      ) : initialLoading ? (
        /* PR-UX-6: status 取得中はカード形状の skeleton */
        <CardsSkeleton />
      ) : !hasCalendarData ? (
        /* スレッド未選択 & カレンダーデータなし → ガイドメッセージ */
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-gray-500">スレッドを選択するか、カレンダーを確認してください</p>
        </div>
      ) : null}
    </div>
  );
}
