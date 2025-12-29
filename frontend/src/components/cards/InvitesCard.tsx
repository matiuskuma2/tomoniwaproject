/**
 * InvitesCard
 * Displays invitees, status, and selected candidate dates
 */

import type { ThreadStatus_API } from '../../core/models';

interface InvitesCardProps {
  status: ThreadStatus_API;
}

export function InvitesCard({ status }: InvitesCardProps) {
  if (status.invites.length === 0) {
    return null;
  }

  const getInviteStatusBadge = (inviteStatus: string | null) => {
    if (inviteStatus === 'accepted') {
      return 'bg-green-100 text-green-800';
    } else if (inviteStatus === 'declined') {
      return 'bg-red-100 text-red-800';
    } else {
      return 'bg-gray-100 text-gray-800';
    }
  };

  const getInviteStatusText = (inviteStatus: string | null) => {
    if (inviteStatus === 'accepted') return '回答済み';
    if (inviteStatus === 'declined') return '辞退';
    return '未回答';
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-3">招待者</h3>
      
      <div className="space-y-2">
        {status.invites.map((invite) => (
          <div key={invite.invite_id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">
                {invite.candidate_name || invite.email}
              </p>
              {invite.candidate_name && (
                <p className="text-xs text-gray-500">{invite.email}</p>
              )}
            </div>
            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getInviteStatusBadge(invite.status)}`}>
              {getInviteStatusText(invite.status)}
            </span>
          </div>
        ))}
      </div>

      {status.selections && status.selections.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-medium text-gray-700 mb-2">選択された候補日時</h4>
          <div className="space-y-1">
            {status.selections.slice(0, 3).map((selection: any, idx: number) => (
              <div key={idx} className="text-xs text-gray-600">
                {selection.invitee_key}: {selection.slot_id}
              </div>
            ))}
            {status.selections.length > 3 && (
              <div className="text-xs text-gray-500">他 {status.selections.length - 3} 件</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
