/**
 * ThreadCardsSwitch
 * 
 * ThreadViewModel の topology/mode に基づいてカードを出し分ける
 * SSOT: 表示ロジックをここに集約
 * 
 * トポロジー別の表示:
 * - one_on_one: ThreadStatusCard + InvitesCard + SlotsCardOneOnOne + MeetCard
 * - one_to_many (candidates): ThreadStatusCard + InvitesCard + SlotsCardCandidates + MeetCard
 * - one_to_many (open_slots): ThreadStatusCard + InvitesCard + SlotsCardOpenSlots + MeetCard
 * - many_to_one (pool): PoolStatusCard + PoolSlotsCard + PoolBookingsCard
 */

import { useMemo } from 'react';
import type { ThreadStatus_API } from '../../core/models';
import { createThreadViewModel, type ThreadViewModel } from '../../core/models/threadViewModel';

// 既存カード
import { ThreadStatusCard } from './ThreadStatusCard';
import { InvitesCard } from './InvitesCard';
import { MeetCard } from './MeetCard';

// 新規カード（mode別）
import { SlotsCardCandidates } from './SlotsCardCandidates';
import { SlotsCardOneOnOne } from './SlotsCardOneOnOne';
import { SlotsCardOpenSlots } from './SlotsCardOpenSlots';

interface ThreadCardsSwitchProps {
  status: ThreadStatus_API;
  viewerTz?: string;
}

/**
 * トポロジー・モードに基づいてカードを出し分ける
 */
export function ThreadCardsSwitch({ status, viewerTz }: ThreadCardsSwitchProps) {
  // ThreadViewModel を生成（メモ化）
  const vm = useMemo(() => createThreadViewModel(status), [status]);
  
  return (
    <div data-testid="thread-cards-switch" data-topology={vm.topology} data-mode={vm.mode}>
      {/* トポロジー・モードバッジ */}
      <TopologyModeBadge vm={vm} />
      
      {/* トポロジー別カード表示 */}
      {vm.topology === 'one_on_one' && (
        <OneOnOneCards status={status} vm={vm} viewerTz={viewerTz} />
      )}
      
      {vm.topology === 'one_to_many' && (
        <OneToManyCards status={status} vm={vm} viewerTz={viewerTz} />
      )}
      
      {vm.topology === 'many_to_one' && (
        <ManyToOneCards status={status} viewerTz={viewerTz} />
      )}
    </div>
  );
}

/**
 * トポロジー・モードバッジ
 */
function TopologyModeBadge({ vm }: { vm: ThreadViewModel }) {
  const topologyLabels: Record<string, { label: string; color: string }> = {
    one_on_one: { label: '1対1', color: 'bg-blue-100 text-blue-800' },
    one_to_many: { label: '1対N', color: 'bg-green-100 text-green-800' },
    many_to_one: { label: 'N対1', color: 'bg-purple-100 text-purple-800' },
    many_to_many: { label: 'N対N', color: 'bg-gray-100 text-gray-800' },
  };
  
  const modeLabels: Record<string, string> = {
    fixed: '確定',
    candidates: '候補選択',
    open_slots: '申込式',
    range_auto: '自動',
    pool_booking: 'プール',
  };
  
  const topology = topologyLabels[vm.topology] || { label: vm.topology, color: 'bg-gray-100 text-gray-800' };
  const modeLabel = modeLabels[vm.mode] || vm.mode;
  
  return (
    <div className="flex items-center gap-2 mb-3 px-1">
      <span 
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${topology.color}`}
        data-testid="topology-badge"
      >
        {topology.label}
      </span>
      <span 
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600"
        data-testid="mode-badge"
      >
        {modeLabel}
      </span>
    </div>
  );
}

/**
 * 1対1 カード群
 */
function OneOnOneCards({ 
  status, 
  vm, 
  viewerTz 
}: { 
  status: ThreadStatus_API; 
  vm: ThreadViewModel; 
  viewerTz?: string;
}) {
  return (
    <>
      <ThreadStatusCard status={status} viewerTz={viewerTz} />
      <InvitesCard status={status} />
      <SlotsCardOneOnOne vm={vm} viewerTz={viewerTz} />
      <MeetCard status={status} />
    </>
  );
}

/**
 * 1対N カード群
 */
function OneToManyCards({ 
  status, 
  vm, 
  viewerTz 
}: { 
  status: ThreadStatus_API; 
  vm: ThreadViewModel; 
  viewerTz?: string;
}) {
  return (
    <>
      <ThreadStatusCard status={status} viewerTz={viewerTz} />
      <InvitesCard status={status} />
      
      {/* モード別スロットカード */}
      {vm.mode === 'candidates' && (
        <SlotsCardCandidates vm={vm} viewerTz={viewerTz} />
      )}
      {vm.mode === 'open_slots' && (
        <SlotsCardOpenSlots vm={vm} viewerTz={viewerTz} />
      )}
      
      <MeetCard status={status} />
    </>
  );
}

/**
 * N対1（Pool）カード群
 * TODO: Pool専用カードを実装後に置き換え
 */
function ManyToOneCards({ 
  status, 
  viewerTz 
}: { 
  status: ThreadStatus_API; 
  viewerTz?: string;
}) {
  // TODO: PoolStatusCard, PoolSlotsCard, PoolBookingsCard を実装
  // vm is available in parent if needed in the future
  return (
    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
      <h3 className="text-lg font-semibold text-purple-900 mb-2">
        プール予約 (N対1)
      </h3>
      <p className="text-sm text-purple-700">
        このスレッドはプール予約モードです。
      </p>
      <p className="text-xs text-purple-500 mt-2">
        Pool専用カードは今後追加予定です。
      </p>
      
      {/* 暫定: 既存カードを表示 */}
      <div className="mt-4 opacity-75">
        <ThreadStatusCard status={status} viewerTz={viewerTz} />
      </div>
    </div>
  );
}
