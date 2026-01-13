/**
 * SlotsCard
 * Displays slots with start_at, end_at, and vote counts
 */

import type { ThreadStatus_API, Slot } from '../../core/models';
import { formatDateTimeForViewer } from '../../utils/datetime';

interface SlotsCardProps {
  status: ThreadStatus_API;
}

export function SlotsCard({ status }: SlotsCardProps) {
  if (status.slots.length === 0) {
    return null;
  }

  // Phase Next-6 Day2: Vote counts are now server-side (負債ゼロ)
  // No need to calculate - use slot.votes directly

  // ⚠️ toLocaleString 直書き禁止: datetime.ts の関数を使用
  const formatDateTime = (dateStr: string) => formatDateTimeForViewer(dateStr);

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-3">候補日時</h3>
      
      <div className="space-y-2">
        {status.slots.map((slot: Slot) => {
          const voteCount = slot.votes ?? 0; // Phase Next-6 Day2: Server-side votes
          
          // Phase2: バージョンバッジの色を世代に応じて変更
          const versionBadgeColor = {
            1: 'bg-gray-100 text-gray-700',
            2: 'bg-blue-100 text-blue-700',
            3: 'bg-purple-100 text-purple-700',
          }[(slot.proposal_version || 1) as 1 | 2 | 3] || 'bg-gray-100 text-gray-700';
          
          return (
            <div key={slot.slot_id} className="p-3 bg-gray-50 rounded-lg">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-gray-900">
                      {formatDateTime(slot.start_at)}
                    </div>
                    {/* Phase2: バージョンバッジ（v2以上のみ表示） */}
                    {slot.proposal_version && slot.proposal_version > 1 && (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${versionBadgeColor}`}>
                        v{slot.proposal_version}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    〜 {formatDateTime(slot.end_at)}
                  </div>
                  {slot.label && (
                    <div className="text-xs text-gray-600 mt-1">{slot.label}</div>
                  )}
                </div>
                <div className="ml-3 flex items-center">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {voteCount} 票
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
