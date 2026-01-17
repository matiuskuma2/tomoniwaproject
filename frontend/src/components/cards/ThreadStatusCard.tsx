/**
 * ThreadStatusCard
 * Displays thread status, title, and updated_at
 * 
 * P1-3: viewerTz for consistent timezone display
 */

import type { ThreadStatus_API } from '../../core/models';
import { formatDateTimeForViewer } from '../../utils/datetime';

interface ThreadStatusCardProps {
  status: ThreadStatus_API;
  viewerTz?: string;
}

export function ThreadStatusCard({ status, viewerTz }: ThreadStatusCardProps) {
  const getStatusBadge = (statusValue: string) => {
    const styles = {
      draft: 'bg-gray-100 text-gray-800',
      active: 'bg-blue-100 text-blue-800',
      confirmed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    return styles[statusValue as keyof typeof styles] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-3">スレッド状態</h3>
      
      <div className="space-y-2">
        <div>
          <span className="text-sm text-gray-500">タイトル:</span>
          <p className="text-sm font-medium text-gray-900">{status.thread.title}</p>
        </div>
        
        <div>
          <span className="text-sm text-gray-500">状態:</span>
          <div className="mt-1">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(status.thread.status)}`}>
              {status.thread.status}
            </span>
          </div>
        </div>
        
        <div>
          <span className="text-sm text-gray-500">更新日時:</span>
          <p className="text-sm text-gray-900">
            {formatDateTimeForViewer(status.thread.updated_at, viewerTz)}
          </p>
        </div>
        
        <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-gray-200">
          <div>
            <span className="text-xs text-gray-500">招待数</span>
            <p className="text-lg font-semibold text-gray-900">{status.invites.length}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">未返信</span>
            <p className="text-lg font-semibold text-orange-600">{status.pending.count}</p>
          </div>
        </div>
        
        {/* Phase2: 再回答必要カウントと世代情報 */}
        {status.proposal_info && status.proposal_info.current_version > 1 && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">候補の世代</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                v{status.proposal_info.current_version}
              </span>
            </div>
            {status.proposal_info.invitees_needing_response_count > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-md p-2">
                <div className="flex items-center">
                  <span className="text-orange-500 mr-2">⚠️</span>
                  <span className="text-sm text-orange-700 font-medium">
                    再回答が必要: {status.proposal_info.invitees_needing_response_count}名
                  </span>
                </div>
                <p className="text-xs text-orange-600 mt-1">
                  追加候補に対して未回答の招待者がいます
                </p>
              </div>
            )}
            {status.proposal_info.remaining_proposals > 0 && (
              <div className="text-xs text-gray-500 mt-2">
                追加候補: あと{status.proposal_info.remaining_proposals}回可能
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
