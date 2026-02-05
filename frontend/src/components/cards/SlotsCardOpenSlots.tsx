/**
 * SlotsCardOpenSlots
 * 申込式（先着順）モード用のスロットカード
 * 
 * 表示内容:
 * - 予約枠のリスト
 * - 各枠の状態（空き/予約済み/キャンセル）
 * - 予約者情報
 */

// ThreadStatus_API import removed - vm provides all needed data
import type { ThreadViewModel, SlotViewModel } from '../../core/models/threadViewModel';
import { formatDateTimeForViewer } from '../../utils/datetime';

interface SlotsCardOpenSlotsProps {
  vm: ThreadViewModel;
  viewerTz?: string;
}

export function SlotsCardOpenSlots({ vm, viewerTz }: SlotsCardOpenSlotsProps) {
  if (vm.slots.length === 0) {
    return null;
  }

  const formatDateTime = (dateStr: string) => formatDateTimeForViewer(dateStr, viewerTz);

  // 枠の状態サマリー
  const openCount = vm.slots.filter(s => s.slotStatus === 'open').length;
  const bookedCount = vm.slots.filter(s => s.slotStatus === 'booked' || s.slotStatus === 'reserved').length;

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900">
          予約枠
          <span className="ml-2 text-xs font-normal text-green-600">（申込式）</span>
        </h3>
        <div className="text-xs text-gray-500">
          空き: {openCount} / 予約: {bookedCount}
        </div>
      </div>
      
      {/* サマリー */}
      <div className="mb-3 p-2 bg-gray-50 rounded text-xs">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            <span className="text-gray-600">空き</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            <span className="text-gray-600">予約済み</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-gray-400"></span>
            <span className="text-gray-600">キャンセル</span>
          </span>
        </div>
      </div>
      
      <div className="space-y-2">
        {vm.slots.map((slot: SlotViewModel) => {
          const statusConfig = {
            open: {
              bg: 'bg-green-50',
              border: 'border-green-200',
              badge: 'bg-green-100 text-green-700',
              label: '空き',
            },
            reserved: {
              bg: 'bg-yellow-50',
              border: 'border-yellow-200',
              badge: 'bg-yellow-100 text-yellow-700',
              label: '仮予約',
            },
            booked: {
              bg: 'bg-blue-50',
              border: 'border-blue-200',
              badge: 'bg-blue-100 text-blue-700',
              label: '予約済み',
            },
            cancelled: {
              bg: 'bg-gray-50',
              border: 'border-gray-200',
              badge: 'bg-gray-100 text-gray-500',
              label: 'キャンセル',
            },
          }[slot.slotStatus || 'open'] || {
            bg: 'bg-gray-50',
            border: 'border-transparent',
            badge: 'bg-gray-100 text-gray-600',
            label: '不明',
          };
          
          return (
            <div 
              key={slot.id} 
              className={`p-3 rounded-lg border ${statusConfig.bg} ${statusConfig.border}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium text-gray-900">
                      {formatDateTime(slot.startAt)}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">
                    〜 {formatDateTime(slot.endAt)}
                  </div>
                  {slot.label && (
                    <div className="text-xs text-gray-600 mt-1">{slot.label}</div>
                  )}
                  
                  {/* 予約者情報 */}
                  {(slot.slotStatus === 'booked' || slot.slotStatus === 'reserved') && slot.requesterName && (
                    <div className="mt-2 text-xs text-gray-600">
                      予約者: {slot.requesterName}
                    </div>
                  )}
                </div>
                <div className="ml-3 flex items-center">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusConfig.badge}`}>
                    {statusConfig.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* 空き枠がある場合のヒント */}
      {openCount > 0 && (
        <div className="mt-3 p-2 bg-green-50 rounded text-xs text-green-700 border border-green-100">
          招待リンクを共有すると、相手が空き枠から予約できます
        </div>
      )}
    </div>
  );
}
