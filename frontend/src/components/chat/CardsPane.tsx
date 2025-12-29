/**
 * CardsPane
 * Right pane: displays status cards
 * Uses GET /api/threads/:id/status
 */

import { ThreadStatusCard } from '../cards/ThreadStatusCard';
import { InvitesCard } from '../cards/InvitesCard';
import { SlotsCard } from '../cards/SlotsCard';
import { MeetCard } from '../cards/MeetCard';
import type { ThreadStatus_API } from '../../core/models';

interface CardsPaneProps {
  status: ThreadStatus_API | null;
  loading: boolean;
}

export function CardsPane({ status, loading }: CardsPaneProps) {
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">スレッドを選択してください</p>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-50 border-l border-gray-200 overflow-y-auto p-4">
      {/* Always show ThreadStatusCard */}
      <ThreadStatusCard status={status} />

      {/* Show InvitesCard if invites exist */}
      <InvitesCard status={status} />

      {/* Show SlotsCard if slots exist */}
      <SlotsCard status={status} />

      {/* Show MeetCard if confirmed and meeting exists */}
      <MeetCard status={status} />
    </div>
  );
}
