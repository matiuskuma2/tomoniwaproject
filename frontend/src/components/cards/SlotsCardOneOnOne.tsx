/**
 * SlotsCardOneOnOne
 * 1対1調整モード用のスロットカード
 * 
 * 表示内容:
 * - 候補日時リスト
 * - 相手の回答状態
 * - 確定された日時（あれば）
 */

import { useState } from 'react';
// ThreadStatus_API import removed - vm provides all needed data
import type { ThreadViewModel, SlotViewModel } from '../../core/models/threadViewModel';
import { formatDateTimeForViewer } from '../../utils/datetime';

interface SlotsCardOneOnOneProps {
  vm: ThreadViewModel;
  viewerTz?: string;
}

export function SlotsCardOneOnOne({ vm, viewerTz }: SlotsCardOneOnOneProps) {
  const [showLatestOnly, setShowLatestOnly] = useState(true);
  
  if (vm.slots.length === 0) {
    return null;
  }

  const formatDateTime = (dateStr: string) => formatDateTimeForViewer(dateStr, viewerTz);

  // 相手の情報
  const invitee = vm.invitees[0];
  const inviteeStatus = invitee?.status;
  
  // 複数世代があるかチェック
  const hasMultipleVersions = vm.slots.some(s => !s.isLatest);
  
  // 表示するスロットをフィルタ
  const displaySlots = showLatestOnly && hasMultipleVersions
    ? vm.slots.filter(s => s.isLatest)
    : vm.slots;
  
  const oldSlotsCount = vm.slots.length - displaySlots.length;

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900">
          候補日時
          <span className="ml-2 text-xs font-normal text-blue-600">（1対1）</span>
        </h3>
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
      
      {/* 相手の回答状態 */}
      {invitee && (
        <div className={`mb-3 p-2 rounded text-xs ${
          inviteeStatus === 'accepted' ? 'bg-green-50 text-green-700' :
          inviteeStatus === 'declined' ? 'bg-red-50 text-red-700' :
          invitee.needsResponse ? 'bg-orange-50 text-orange-700' :
          'bg-gray-50 text-gray-700'
        }`}>
          <span className="font-medium">{invitee.name || invitee.email}</span>
          {inviteeStatus === 'accepted' && ' - 回答済み ✓'}
          {inviteeStatus === 'declined' && ' - 辞退'}
          {invitee.needsResponse && ' - 再回答待ち'}
          {!inviteeStatus && !invitee.needsResponse && ' - 回答待ち'}
        </div>
      )}
      
      {/* 古い候補を非表示中の場合のインジケーター */}
      {showLatestOnly && oldSlotsCount > 0 && (
        <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
          <span>📋</span>
          <span>v{vm.proposalVersion} 以前の候補 {oldSlotsCount}件を非表示中</span>
        </div>
      )}
      
      <div className="space-y-2">
        {displaySlots.map((slot: SlotViewModel) => {
          const isSelected = slot.votes && slot.votes > 0;
          const isFinal = vm.finalSlotId === slot.id;
          
          // バージョンバッジの色
          const versionBadgeColor = {
            1: 'bg-gray-100 text-gray-700',
            2: 'bg-blue-100 text-blue-700',
            3: 'bg-purple-100 text-purple-700',
          }[slot.proposalVersion as 1 | 2 | 3] || 'bg-gray-100 text-gray-700';
          
          return (
            <div 
              key={slot.id} 
              className={`p-3 rounded-lg border-2 ${
                isFinal ? 'bg-green-50 border-green-500' :
                isSelected ? 'bg-blue-50 border-blue-300' :
                'bg-gray-50 border-transparent'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-gray-900">
                      {formatDateTime(slot.startAt)}
                    </div>
                    {slot.proposalVersion > 1 && (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${versionBadgeColor}`}>
                        v{slot.proposalVersion}
                      </span>
                    )}
                    {isFinal && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                        確定
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
                  {isSelected && !isFinal && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                      希望あり
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* 確定可能な場合のヒント */}
      {vm.canFinalize && inviteeStatus === 'accepted' && (
        <div className="mt-3 p-2 bg-blue-50 rounded text-xs text-blue-700 border border-blue-100">
          ヒント: 「〇〇で確定して」とチャットで指示すると日程を確定できます
        </div>
      )}
    </div>
  );
}
