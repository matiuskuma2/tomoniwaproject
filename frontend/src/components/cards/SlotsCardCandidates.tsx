/**
 * SlotsCardCandidates
 * 候補日時選択（投票型）モード用のスロットカード
 * 
 * 表示内容:
 * - 候補日時リスト
 * - 各候補の投票数
 * - 投票者リスト（オプション）
 * - 最新候補のみ表示トグル（P2-B1）
 */

import { useState } from 'react';
// ThreadStatus_API import removed - vm provides all needed data
import type { ThreadViewModel, SlotViewModel } from '../../core/models/threadViewModel';
import { formatDateTimeForViewer } from '../../utils/datetime';

interface SlotsCardCandidatesProps {
  vm: ThreadViewModel;
  viewerTz?: string;
}

export function SlotsCardCandidates({ vm, viewerTz }: SlotsCardCandidatesProps) {
  // P2-B1: 最新候補のみ表示トグル（デフォルトON）
  const [showLatestOnly, setShowLatestOnly] = useState(true);
  
  if (vm.slots.length === 0) {
    return null;
  }

  // P1-3: Use viewerTz for consistent timezone display
  const formatDateTime = (dateStr: string) => formatDateTimeForViewer(dateStr, viewerTz);

  // P2-B1: 複数世代があるかチェック
  const hasMultipleVersions = vm.slots.some(s => !s.isLatest);
  
  // P2-B1: 表示するスロットをフィルタ
  const displaySlots = showLatestOnly && hasMultipleVersions
    ? vm.slots.filter(s => s.isLatest)
    : vm.slots;
  
  // P2-B1: 古い候補の数
  const oldSlotsCount = vm.slots.length - displaySlots.length;

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900">
          候補日時
          <span className="ml-2 text-xs font-normal text-gray-500">（投票）</span>
        </h3>
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
          <span>v{vm.proposalVersion} 以前の候補 {oldSlotsCount}件を非表示中</span>
        </div>
      )}
      
      {/* 投票サマリー */}
      <div className="mb-3 p-2 bg-green-50 rounded text-xs text-green-700">
        回答済み: {vm.respondedCount}名 / {vm.totalInvitees}名
        {vm.pendingCount > 0 && (
          <span className="ml-2 text-orange-600">（未回答: {vm.pendingCount}名）</span>
        )}
      </div>
      
      <div className="space-y-2">
        {displaySlots.map((slot: SlotViewModel) => {
          const voteCount = slot.votes ?? 0;
          
          // バージョンバッジの色を世代に応じて変更
          const versionBadgeColor = {
            1: 'bg-gray-100 text-gray-700',
            2: 'bg-blue-100 text-blue-700',
            3: 'bg-purple-100 text-purple-700',
          }[slot.proposalVersion as 1 | 2 | 3] || 'bg-gray-100 text-gray-700';
          
          return (
            <div key={slot.id} className="p-3 bg-gray-50 rounded-lg">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-gray-900">
                      {formatDateTime(slot.startAt)}
                    </div>
                    {/* バージョンバッジ（v2以上のみ表示） */}
                    {slot.proposalVersion > 1 && (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${versionBadgeColor}`}>
                        v{slot.proposalVersion}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    〜 {formatDateTime(slot.endAt)}
                  </div>
                  {slot.label && (
                    <div className="text-xs text-gray-600 mt-1">{slot.label}</div>
                  )}
                </div>
                <div className="ml-3 flex items-center">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                    voteCount > 0 ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {voteCount} 票
                  </span>
                </div>
              </div>
              
              {/* 投票者リスト（オプション） */}
              {slot.voters && slot.voters.length > 0 && (
                <div className="mt-2 text-xs text-gray-500">
                  <span className="text-gray-400">投票者:</span>{' '}
                  {slot.voters.slice(0, 3).join(', ')}
                  {slot.voters.length > 3 && ` 他${slot.voters.length - 3}名`}
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {/* 確定可能な場合のヒント */}
      {vm.canFinalize && (
        <div className="mt-3 p-2 bg-blue-50 rounded text-xs text-blue-700 border border-blue-100">
          ヒント: 「〇〇で確定して」とチャットで指示すると日程を確定できます
        </div>
      )}
    </div>
  );
}
