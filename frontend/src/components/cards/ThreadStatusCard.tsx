/**
 * ThreadStatusCard
 * Displays thread status, title, and updated_at
 * 
 * P1-3: viewerTz for consistent timezone display
 * P2-B1: 再回答必要者の名前一覧を表示
 */

import { useState } from 'react';
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
        <ProposalInfoSection status={status} />
      </div>
    </div>
  );
}

/**
 * P2-B1: ProposalInfoSection
 * 世代情報と再回答必要者の詳細を表示
 */
function ProposalInfoSection({ status }: { status: ThreadStatus_API }) {
  const [showDetails, setShowDetails] = useState(false);
  
  // Phase2 情報がない、または v1 の場合は非表示
  if (!status.proposal_info || status.proposal_info.current_version <= 1) {
    return null;
  }
  
  const { 
    current_version, 
    invitees_needing_response_count, 
    invitees_needing_response,
    remaining_proposals 
  } = status.proposal_info;
  
  return (
    <div className="mt-3 pt-3 border-t border-gray-200" data-testid="proposal-info-section">
      {/* 世代バッジ */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500">候補の世代</span>
        <span 
          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800"
          data-testid="proposal-version-badge"
        >
          v{current_version}
        </span>
      </div>
      
      {/* 再回答必要者セクション */}
      {invitees_needing_response_count > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-md p-2" data-testid="need-response-alert">
          <div 
            className="flex items-center justify-between cursor-pointer"
            onClick={() => setShowDetails(!showDetails)}
          >
            <div className="flex items-center">
              <span className="text-orange-500 mr-2">⚠️</span>
              <span className="text-sm text-orange-700 font-medium">
                再回答が必要: {invitees_needing_response_count}名
              </span>
            </div>
            {/* P2-B1: 詳細展開ボタン */}
            {invitees_needing_response && invitees_needing_response.length > 0 && (
              <button 
                className="text-orange-600 hover:text-orange-800 text-xs"
                data-testid="need-response-toggle"
              >
                {showDetails ? '▲ 閉じる' : '▼ 詳細'}
              </button>
            )}
          </div>
          
          <p className="text-xs text-orange-600 mt-1">
            追加候補 (v{current_version}) に対して未回答の招待者がいます
          </p>
          
          {/* P2-B1: 再回答必要者の名前一覧 */}
          {showDetails && invitees_needing_response && invitees_needing_response.length > 0 && (
            <div className="mt-2 pt-2 border-t border-orange-200" data-testid="need-response-list">
              <p className="text-xs text-orange-700 font-medium mb-1">対象者:</p>
              <ul className="space-y-1">
                {invitees_needing_response.map((invitee, index) => (
                  <li 
                    key={invitee.invitee_key || index} 
                    className="text-xs text-orange-600 flex items-center gap-1"
                  >
                    <span className="w-1.5 h-1.5 bg-orange-400 rounded-full"></span>
                    <span>{invitee.name || invitee.email}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      
      {/* 追加候補残り回数 */}
      {remaining_proposals > 0 && (
        <div className="text-xs text-gray-500 mt-2">
          追加候補: あと{remaining_proposals}回可能
        </div>
      )}
    </div>
  );
}
