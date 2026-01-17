/**
 * FreeBusyCard
 * Displays busy time slots (calendar free/busy information)
 * Phase Next-3 (Day4)
 * 
 * P1-3: viewerTz for consistent timezone display
 */

import type { CalendarFreeBusyResponse } from '../../core/models';
import { formatDateTimeForViewer } from '../../utils/datetime';

interface FreeBusyCardProps {
  data: CalendarFreeBusyResponse;
  viewerTz?: string;
}

export function FreeBusyCard({ data, viewerTz }: FreeBusyCardProps) {
  const rangeLabel = data.range === 'today' ? '今日' : '今週';
  
  // P1-3: Use viewerTz for consistent timezone display
  const fmt = (iso: string) => formatDateTimeForViewer(iso, viewerTz);
  
  // Warning state
  if (data.warning) {
    return (
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">📊 {rangeLabel}の空き状況</h3>
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
          <p className="text-sm text-yellow-800">
            {data.warning === 'google_calendar_permission_missing' && '⚠️ 権限が不足しています'}
            {data.warning === 'google_account_not_linked' && '⚠️ Google アカウントが未連携です'}
          </p>
        </div>
      </div>
    );
  }
  
  // No busy slots
  if (data.busy.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">📊 {rangeLabel}の空き状況</h3>
        <div className="bg-green-50 border border-green-200 rounded p-3">
          <p className="text-sm text-green-800">✅ {rangeLabel}は終日空いています</p>
        </div>
      </div>
    );
  }
  
  // Busy slots list
  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-3">📊 {rangeLabel}の予定が入っている時間</h3>
      
      <div className="space-y-2">
        {data.busy.map((slot, index) => (
          <div key={index} className="border-l-4 border-red-500 pl-3 py-1">
            <p className="text-xs text-gray-500">
              {fmt(slot.start)} - {fmt(slot.end)}
            </p>
          </div>
        ))}
      </div>
      
      <div className="mt-3 pt-3 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          💡 上記以外の時間は空いています
        </p>
      </div>
    </div>
  );
}
