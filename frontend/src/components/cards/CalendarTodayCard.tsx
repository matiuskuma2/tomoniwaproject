/**
 * CalendarTodayCard
 * Displays today's events from Google Calendar
 * Phase Next-3 (Day4)
 * 
 * P1-3: viewerTz for consistent timezone display
 */

import type { CalendarTodayResponse } from '../../core/models';
import { formatTimeForViewer } from '../../utils/datetime';

interface CalendarTodayCardProps {
  data: CalendarTodayResponse;
  viewerTz?: string;
}

export function CalendarTodayCard({ data, viewerTz }: CalendarTodayCardProps) {
  // P1-3: Use viewerTz for consistent timezone display
  const formatTime = (ts: string) => formatTimeForViewer(ts, viewerTz);

  // Warning state
  if (data.warning) {
    return (
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">📅 今日の予定</h3>
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
          <p className="text-sm text-yellow-800">
            {data.warning === 'google_calendar_permission_missing' && '⚠️ 権限が不足しています'}
            {data.warning === 'google_account_not_linked' && '⚠️ Google アカウントが未連携です'}
          </p>
        </div>
      </div>
    );
  }
  
  // No events
  if (data.events.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">📅 今日の予定</h3>
        <p className="text-sm text-gray-500">今日の予定はありません</p>
      </div>
    );
  }
  
  // Events list
  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-3">📅 今日の予定（{data.events.length}件）</h3>
      
      <div className="space-y-3">
        {data.events.map((event) => (
          <div key={event.id} className="border-l-4 border-blue-500 pl-3">
            <p className="text-sm font-medium text-gray-900">{event.summary}</p>
            <p className="text-xs text-gray-500">
              {formatTime(event.start)} - {formatTime(event.end)}
            </p>
            {event.location && (
              <p className="text-xs text-gray-500">📍 {event.location}</p>
            )}
            {event.meet_url && (
              <a 
                href={event.meet_url} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-xs text-blue-600 hover:underline block mt-1"
              >
                🎥 Meet に参加
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
