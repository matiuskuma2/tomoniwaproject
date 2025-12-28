/**
 * Thread Detail Page
 * Shows thread status, invites, slots, and actions (remind/finalize)
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { threadsApi } from '../core/api';
import type { ThreadStatus_API, Slot } from '../core/models';

export function ThreadDetailPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  
  const [status, setStatus] = useState<ThreadStatus_API | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reminding, setReminding] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  useEffect(() => {
    if (threadId) {
      loadStatus();
    }
  }, [threadId]);

  const loadStatus = async () => {
    if (!threadId) return;
    
    try {
      setLoading(true);
      const data = await threadsApi.getStatus(threadId);
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load thread status');
    } finally {
      setLoading(false);
    }
  };

  const handleRemind = async () => {
    if (!threadId) return;
    
    try {
      setReminding(true);
      await threadsApi.sendReminder(threadId);
      alert('リマインダーを送信しました');
      await loadStatus();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'リマインダー送信に失敗しました');
    } finally {
      setReminding(false);
    }
  };

  const handleFinalize = async () => {
    if (!threadId || !selectedSlotId) return;
    
    if (!confirm('この日程で確定しますか？')) return;
    
    try {
      setFinalizing(true);
      const result = await threadsApi.finalize(threadId, {
        selected_slot_id: selectedSlotId,
      });
      
      // Show success message with Meet URL if available
      if (result.meeting?.url) {
        alert(`確定しました！\n\nGoogle Meet: ${result.meeting.url}`);
      } else {
        alert('確定しました！');
      }
      
      await loadStatus();
    } catch (err) {
      alert(err instanceof Error ? err.message : '確定に失敗しました');
    } finally {
      setFinalizing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
          {error || 'スレッドが見つかりません'}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate('/dashboard')}
          className="text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          ← 一覧に戻る
        </button>
        <h2 className="text-2xl font-bold text-gray-900">{status.thread.title}</h2>
        <span className="mt-2 inline-block px-3 py-1 text-sm font-semibold rounded-full bg-blue-100 text-blue-800">
          {status.thread.status}
        </span>
      </div>

      {/* Progress Summary */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">進捗状況</h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-gray-50 p-4 rounded">
            <p className="text-sm text-gray-500">招待数</p>
            <p className="text-2xl font-bold text-gray-900">{status.invites?.length || 0}</p>
          </div>
          <div className="bg-yellow-50 p-4 rounded">
            <p className="text-sm text-gray-500">未回答</p>
            <p className="text-2xl font-bold text-yellow-600">
              {status.invites?.filter((inv: any) => inv.status === 'pending' || !inv.status).length || 0}
            </p>
          </div>
          <div className="bg-green-50 p-4 rounded">
            <p className="text-sm text-gray-500">承諾</p>
            <p className="text-2xl font-bold text-green-600">
              {status.invites?.filter((inv: any) => inv.status === 'accepted').length || 0}
            </p>
          </div>
          <div className="bg-red-50 p-4 rounded">
            <p className="text-sm text-gray-500">辞退</p>
            <p className="text-2xl font-bold text-red-600">
              {status.invites?.filter((inv: any) => inv.status === 'declined').length || 0}
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      {status.thread.status === 'draft' || status.thread.status === 'active' ? (
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">アクション</h3>
          <div className="flex gap-4">
            <button
              onClick={handleRemind}
              disabled={reminding || (status.invites?.filter((inv: any) => inv.status === 'pending' || !inv.status).length || 0) === 0}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {reminding ? '送信中...' : 'リマインダー送信'}
            </button>
          </div>
        </div>
      ) : null}

      {/* Slots (for finalization) */}
      {status.thread.status === 'draft' || status.thread.status === 'active' ? (
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">候補日時</h3>
          <div className="space-y-2">
            {status.slots.map((slot: Slot) => (
              <label
                key={slot.slot_id}
                className="flex items-center p-4 border rounded-lg cursor-pointer hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="slot"
                  value={slot.slot_id}
                  checked={selectedSlotId === slot.slot_id}
                  onChange={(e) => setSelectedSlotId(e.target.value)}
                  className="mr-3"
                />
                <div className="flex-1">
                  <p className="font-medium text-gray-900">
                    {new Date(slot.start_at).toLocaleString('ja-JP')} 〜{' '}
                    {new Date(slot.end_at).toLocaleString('ja-JP')}
                  </p>
                  {slot.label && (
                    <p className="text-sm text-gray-500">{slot.label}</p>
                  )}
                </div>
              </label>
            ))}
          </div>
          {selectedSlotId && (
            <button
              onClick={handleFinalize}
              disabled={finalizing}
              className="mt-4 px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {finalizing ? '確定中...' : 'この日程で確定'}
            </button>
          )}
        </div>
      ) : null}

      {/* Invites */}
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">招待リスト</h3>
        
        {/* Pending */}
        {status.invites && status.invites.filter((inv: any) => inv.status === 'pending' || !inv.status).length > 0 && (
          <div className="mb-6">
            <h4 className="text-sm font-medium text-gray-700 mb-2">未回答</h4>
            <ul className="divide-y divide-gray-200">
              {status.invites.filter((inv: any) => inv.status === 'pending' || !inv.status).map((invite: any) => (
                <li key={invite.invite_id} className="py-3">
                  <div className="flex justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {invite.candidate_name || invite.email}
                      </p>
                      {invite.candidate_name && (
                        <p className="text-sm text-gray-500">{invite.email}</p>
                      )}
                    </div>
                    <span className="text-sm text-yellow-600">未回答</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Accepted */}
        {status.invites && status.invites.filter((inv: any) => inv.status === 'accepted').length > 0 && (
          <div className="mb-6">
            <h4 className="text-sm font-medium text-gray-700 mb-2">承諾</h4>
            <ul className="divide-y divide-gray-200">
              {status.invites.filter((inv: any) => inv.status === 'accepted').map((invite: any) => (
                <li key={invite.invite_id} className="py-3">
                  <div className="flex justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {invite.candidate_name || invite.email}
                      </p>
                      {invite.candidate_name && (
                        <p className="text-sm text-gray-500">{invite.email}</p>
                      )}
                    </div>
                    <span className="text-sm text-green-600">承諾</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Declined */}
        {status.invites && status.invites.filter((inv: any) => inv.status === 'declined').length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">辞退</h4>
            <ul className="divide-y divide-gray-200">
              {status.invites.filter((inv: any) => inv.status === 'declined').map((invite: any) => (
                <li key={invite.invite_id} className="py-3">
                  <div className="flex justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {invite.candidate_name || invite.email}
                      </p>
                      {invite.candidate_name && (
                        <p className="text-sm text-gray-500">{invite.email}</p>
                      )}
                    </div>
                    <span className="text-sm text-red-600">辞退</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
