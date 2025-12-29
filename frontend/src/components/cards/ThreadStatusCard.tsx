/**
 * ThreadStatusCard
 * Displays thread status, title, and updated_at
 */

import type { ThreadStatus_API } from '../../core/models';

interface ThreadStatusCardProps {
  status: ThreadStatus_API;
}

export function ThreadStatusCard({ status }: ThreadStatusCardProps) {
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
            {new Date(status.thread.updated_at).toLocaleString('ja-JP')}
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
      </div>
    </div>
  );
}
