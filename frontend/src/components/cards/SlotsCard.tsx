/**
 * SlotsCard
 * Displays slots with start_at, end_at, and vote counts
 * 
 * P1-3: viewerTz for consistent timezone display
 * P2-B1: 「最新候補のみ表示」トグル追加
 */

import { useState } from 'react';
import type { ThreadStatus_API, Slot } from '../../core/models';
import { formatDateTimeForViewer } from '../../utils/datetime';

interface SlotsCardProps {
  status: ThreadStatus_API;
  viewerTz?: string;
}

export function SlotsCard({ status, viewerTz }: SlotsCardProps) {
  // P2-B1: 最新候補のみ表示トグル（デフォルトON）
  const [showLatestOnly, setShowLatestOnly] = useState(true);
  
  // SSOT: Show empty state for new threads (no slots yet)
  if (status.slots.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">候補日時</h3>
        <div className="text-center py-6 text-gray-500">
          <div className="text-3xl mb-2">📅</div>
          <p className="text-sm">候補日時はまだありません</p>
          <p className="text-xs text-gray-400 mt-1">
            チャットで「候補出して」または「来週の午後で」などと入力してください
          </p>
        </div>
      </div>
    );
  }

  // Phase Next-6 Day2: Vote counts are now server-side (負債ゼロ)
  // No need to calculate - use slot.votes directly

  // P1-3: Use viewerTz for consistent timezone display
  const formatDateTime = (dateStr: string) => formatDateTimeForViewer(dateStr, viewerTz);

  // P2-B1: 最新世代を特定
  const currentVersion = status.proposal_info?.current_version ?? 1;
  const hasMultipleVersions = status.slots.some(s => (s.proposal_version ?? 1) !== currentVersion);
  
  // P2-B1: 表示するスロットをフィルタ
  const displaySlots = showLatestOnly && hasMultipleVersions
    ? status.slots.filter(s => (s.proposal_version ?? 1) === currentVersion)
    : status.slots;
  
  // P2-B1: 古い候補の数
  const oldSlotsCount = status.slots.length - displaySlots.length;

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900">候補日時</h3>
        {/* P2-B1: 世代が複数ある場合のみトグル表示 */}
        {hasMultipleVersions && (
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-gray-500">最新のみ</span>
            <div 
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                showLatestOnly ? 'bg-blue-600' : 'bg-gray-200'
              }`}
              onClick={() => setShowLatestOnly(!showLatestOnly)}
              data-testid="slots-latest-only-toggle"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  showLatestOnly ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </div>
          </label>
        )}
      </div>
      
      {/* P2-B1: 古い候補を非表示中の場合のインジケーター */}
      {showLatestOnly && oldSlotsCount > 0 && (
        <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
          <span>📋</span>
          <span>v{currentVersion} 以前の候補 {oldSlotsCount}件を非表示中</span>
        </div>
      )}
      
      <div className="space-y-2">
        {displaySlots.map((slot: Slot) => {
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
