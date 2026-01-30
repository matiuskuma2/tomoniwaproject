/**
 * Group Thread Page (1対N スレッド詳細)
 * 
 * @see docs/plans/G1-PLAN.md
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  oneToManyApi, 
  type ThreadDetailResponse,
  type ResponseSummary,
  type FinalizationCheck,
} from '../core/api/oneToMany';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: '下書き', color: 'bg-gray-100 text-gray-800' },
  sent: { label: '送信済み', color: 'bg-blue-100 text-blue-800' },
  confirmed: { label: '確定', color: 'bg-green-100 text-green-800' },
  cancelled: { label: 'キャンセル', color: 'bg-red-100 text-red-800' },
};

const MODE_LABELS: Record<string, string> = {
  fixed: '固定日時',
  candidates: '候補から選択',
  open_slots: '申込カレンダー',
  range_auto: '自動候補生成',
};

export function GroupThreadPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const [data, setData] = useState<ThreadDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<string>('');

  const loadThread = useCallback(async () => {
    if (!threadId) return;
    try {
      setLoading(true);
      const response = await oneToManyApi.get(threadId);
      setData(response);
      
      // デフォルトで推奨スロットを選択
      if (response.finalization.recommended_slot_id) {
        setSelectedSlotId(response.finalization.recommended_slot_id);
      } else if (response.slots.length > 0) {
        setSelectedSlotId(response.slots[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load thread');
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  // 手動確定
  const handleFinalize = async () => {
    if (!threadId || !selectedSlotId) {
      alert('確定する日時を選択してください');
      return;
    }

    if (!confirm('この日時で確定しますか？参加者全員に通知されます。')) {
      return;
    }

    try {
      setActionLoading(true);
      await oneToManyApi.finalize(threadId, {
        selected_slot_id: selectedSlotId,
        reason: 'manual',
      });
      await loadThread();
      alert('確定しました');
    } catch (err) {
      alert(err instanceof Error ? err.message : '確定に失敗しました');
    } finally {
      setActionLoading(false);
    }
  };

  // リフレッシュ
  const handleRefresh = async () => {
    await loadThread();
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
          {error || 'スレッドが見つかりません'}
        </div>
        <Link
          to="/group"
          className="mt-4 inline-block text-blue-600 hover:text-blue-700"
        >
          ← 一覧に戻る
        </Link>
      </div>
    );
  }

  const { thread, group_policy, slots, invites, summary, finalization } = data;
  const status = STATUS_LABELS[thread.status] || STATUS_LABELS.draft;
  const isConfirmed = thread.status === 'confirmed';
  const isSent = thread.status === 'sent';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          to="/group"
          className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block"
        >
          ← グループ予定調整一覧
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{thread.title}</h2>
            {thread.description && (
              <p className="mt-1 text-sm text-gray-500">{thread.description}</p>
            )}
          </div>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${status.color}`}>
            {status.label}
          </span>
        </div>
      </div>

      {/* 基本情報 */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">基本情報</h3>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-gray-500">方式</dt>
            <dd className="font-medium">{group_policy?.mode && MODE_LABELS[group_policy.mode]}</dd>
          </div>
          <div>
            <dt className="text-gray-500">締切</dt>
            <dd className="font-medium">
              {group_policy?.deadline_at && new Date(group_policy.deadline_at).toLocaleString('ja-JP')}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">成立条件</dt>
            <dd className="font-medium">主催者が決定</dd>
          </div>
          <div>
            <dt className="text-gray-500">作成日</dt>
            <dd className="font-medium">
              {new Date(thread.created_at).toLocaleString('ja-JP')}
            </dd>
          </div>
        </dl>
      </div>

      {/* 回答状況 */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900">回答状況</h3>
          <button
            onClick={handleRefresh}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            更新
          </button>
        </div>

        <SummaryStats summary={summary} />

        {/* 成立条件チェック */}
        <FinalizationStatus finalization={finalization} isConfirmed={isConfirmed} />
      </div>

      {/* 日時候補 */}
      {slots.length > 0 && (
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">日時候補</h3>
          <div className="space-y-2">
            {slots.map((slot: any) => {
              const slotStats = summary.by_slot.find(s => s.slot_id === slot.id);
              const isSelected = selectedSlotId === slot.id;
              const isRecommended = finalization.recommended_slot_id === slot.id;
              
              return (
                <label
                  key={slot.id}
                  className={`flex items-center justify-between p-3 border rounded-md cursor-pointer ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center">
                    {!isConfirmed && (
                      <input
                        type="radio"
                        name="slot"
                        checked={isSelected}
                        onChange={() => setSelectedSlotId(slot.id)}
                        className="mr-3"
                      />
                    )}
                    <div>
                      <span className="font-medium">
                        {new Date(slot.start_time).toLocaleString('ja-JP')}
                      </span>
                      <span className="text-gray-500 mx-2">〜</span>
                      <span className="font-medium">
                        {new Date(slot.end_time).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {isRecommended && (
                        <span className="ml-2 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
                          推奨
                        </span>
                      )}
                    </div>
                  </div>
                  {slotStats && (
                    <div className="text-sm text-gray-500">
                      <span className="text-green-600">OK: {slotStats.ok_count}</span>
                      <span className="mx-2">|</span>
                      <span className="text-amber-600">未定: {slotStats.maybe_count}</span>
                      <span className="mx-2">|</span>
                      <span className="text-red-600">NG: {slotStats.no_count}</span>
                    </div>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* 招待者一覧 */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          招待者 ({invites.length}名)
        </h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  名前
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  メール
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  ステータス
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {invites.map((invite: any) => (
                <tr key={invite.id}>
                  <td className="px-4 py-2 text-sm text-gray-900">
                    {invite.candidate_name}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500">
                    {invite.email}
                  </td>
                  <td className="px-4 py-2">
                    <InviteStatusBadge status={invite.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* アクションボタン */}
      {isSent && !isConfirmed && (
        <div className="flex justify-end gap-3">
          <button
            onClick={handleFinalize}
            disabled={actionLoading || !selectedSlotId}
            className="px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
          >
            {actionLoading ? '処理中...' : 'この日時で確定'}
          </button>
        </div>
      )}
    </div>
  );
}

// サブコンポーネント
function SummaryStats({ summary }: { summary: ResponseSummary }) {
  return (
    <div className="grid grid-cols-4 gap-4 mb-4">
      <div className="text-center p-3 bg-gray-50 rounded-lg">
        <div className="text-2xl font-bold text-gray-900">{summary.total_invited}</div>
        <div className="text-xs text-gray-500">招待</div>
      </div>
      <div className="text-center p-3 bg-green-50 rounded-lg">
        <div className="text-2xl font-bold text-green-600">{summary.ok_count}</div>
        <div className="text-xs text-gray-500">OK</div>
      </div>
      <div className="text-center p-3 bg-amber-50 rounded-lg">
        <div className="text-2xl font-bold text-amber-600">{summary.maybe_count}</div>
        <div className="text-xs text-gray-500">未定</div>
      </div>
      <div className="text-center p-3 bg-red-50 rounded-lg">
        <div className="text-2xl font-bold text-red-600">{summary.no_count}</div>
        <div className="text-xs text-gray-500">NG</div>
      </div>
    </div>
  );
}

function FinalizationStatus({ 
  finalization, 
  isConfirmed 
}: { 
  finalization: FinalizationCheck; 
  isConfirmed: boolean;
}) {
  if (isConfirmed) {
    return (
      <div className="p-3 bg-green-50 border border-green-200 rounded-md">
        <span className="text-green-700 font-medium">✓ 確定済み</span>
      </div>
    );
  }

  return (
    <div className={`p-3 rounded-md ${
      finalization.met 
        ? 'bg-green-50 border border-green-200' 
        : 'bg-gray-50 border border-gray-200'
    }`}>
      <span className={finalization.met ? 'text-green-700' : 'text-gray-600'}>
        {finalization.met ? '✓ 確定可能' : '回答を待っています...'}
      </span>
      <p className="text-xs text-gray-500 mt-1">{finalization.reason}</p>
    </div>
  );
}

function InviteStatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, { label: string; color: string }> = {
    pending: { label: '未回答', color: 'bg-gray-100 text-gray-800' },
    accepted: { label: '回答済', color: 'bg-green-100 text-green-800' },
    declined: { label: '辞退', color: 'bg-red-100 text-red-800' },
  };

  const s = statusMap[status] || statusMap.pending;
  
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${s.color}`}>
      {s.label}
    </span>
  );
}
