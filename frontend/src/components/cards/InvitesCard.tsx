/**
 * InvitesCard
 * Displays invitees, status, selected candidate dates, and invite links
 * Phase Next-2: Added invite link copy functionality
 */

import { useState } from 'react';
import type { ThreadStatus_API } from '../../core/models';

interface InvitesCardProps {
  status: ThreadStatus_API;
}

export function InvitesCard({ status }: InvitesCardProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // SSOT: Show empty state for new threads (no invites yet)
  if (status.invites.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">招待者</h3>
        <div className="text-center py-6 text-gray-500">
          <div className="text-3xl mb-2">👥</div>
          <p className="text-sm">招待者はまだいません</p>
          <p className="text-xs text-gray-400 mt-1">
            メールアドレスを入力するか、連絡先リストから追加してください
          </p>
        </div>
      </div>
    );
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

  const handleCopyInviteUrl = (invite: any) => {
    navigator.clipboard.writeText(invite.invite_url);
    setCopiedId(invite.invite_id);
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-3">招待者</h3>
      
      <div className="space-y-3">
        {status.invites.map((invite) => (
          <div key={invite.invite_id} className="p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
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
            
            {/* Invite Link (Phase Next-2: Copy button added) */}
            {invite.invite_url && (
              <div className="mt-2 flex items-center space-x-2">
                <input
                  type="text"
                  value={invite.invite_url}
                  readOnly
                  className="flex-1 text-xs px-2 py-1 bg-white border border-gray-300 rounded text-gray-600 truncate"
                />
                <button
                  onClick={() => handleCopyInviteUrl(invite)}
                  className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  {copiedId === invite.invite_id ? '✓ コピー済み' : 'コピー'}
                </button>
              </div>
            )}
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
