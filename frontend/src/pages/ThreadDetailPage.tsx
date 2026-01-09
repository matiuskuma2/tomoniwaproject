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
    
    // Improved confirmation message
    const selectedSlot = status?.slots.find((s: Slot) => s.slot_id === selectedSlotId);
    const confirmMessage = selectedSlot
      ? `以下の日程で確定します。\nGoogle Meet URL が自動的に生成されます。\n\n${new Date(selectedSlot.start_at).toLocaleString('ja-JP')} 〜 ${new Date(selectedSlot.end_at).toLocaleString('ja-JP')}\n\nよろしいですか？`
      : 'この日程で確定しますか？Google Meet URL が生成されます。';
    
    if (!confirm(confirmMessage)) return;
    
    try {
      setFinalizing(true);
      await threadsApi.finalize(threadId, {
        selected_slot_id: selectedSlotId,
      });
      
      // Reload status to show Meet URL
      await loadStatus();
      
      // Success message (Meet URL will be shown in the page)
      alert('✅ 確定しました！\n\nGoogle Meet URL が生成されました。\n下にスクロールして「日程が確定しました」セクションをご確認ください。');
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
          onClick={() => navigate('/chat')}
          className="text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          ← チャットに戻る
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

      {/* Google Meet (shown after finalization) */}
      {status.thread.status === 'confirmed' && status.evaluation?.meeting?.url && (
        <div className="bg-green-50 border-2 border-green-200 shadow rounded-lg p-6 mb-6">
          <h3 className="text-lg font-medium text-green-900 mb-4 flex items-center">
            <svg className="w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            日程が確定しました
          </h3>
          
          <div className="space-y-4">
            {/* Selected Date/Time */}
            {status.evaluation.final_slot_id && status.slots.find((s: Slot) => s.slot_id === status.evaluation.final_slot_id) && (
              <div className="bg-white rounded-lg p-4">
                <p className="text-sm text-gray-500 mb-1">確定日時</p>
                <p className="text-lg font-bold text-gray-900">
                  {new Date(status.slots.find((s: Slot) => s.slot_id === status.evaluation.final_slot_id)!.start_at).toLocaleString('ja-JP', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    weekday: 'short',
                  })}
                  {' 〜 '}
                  {new Date(status.slots.find((s: Slot) => s.slot_id === status.evaluation.final_slot_id)!.end_at).toLocaleString('ja-JP', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            )}

            {/* Google Meet URL */}
            <div className="bg-white rounded-lg p-4">
              <p className="text-sm text-gray-500 mb-2">Google Meet</p>
              <div className="flex items-center gap-3">
                <a
                  href={status.evaluation?.meeting?.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-blue-600 hover:text-blue-800 font-medium break-all"
                >
                  {status.evaluation?.meeting?.url}
                </a>
                <button
                  onClick={() => {
                    if (status.evaluation?.meeting?.url) {
                      navigator.clipboard.writeText(status.evaluation.meeting.url);
                      alert('Google Meet URL をコピーしました');
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium whitespace-nowrap"
                >
                  📋 コピー
                </button>
                <a
                  href={status.evaluation?.meeting?.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium whitespace-nowrap"
                >
                  参加する
                </a>
              </div>
            </div>

            {/* Calendar Button */}
            {status.evaluation.final_slot_id && status.slots.find((s: Slot) => s.slot_id === status.evaluation.final_slot_id) && (
              <div className="flex gap-3">
                <a
                  href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(status.thread.title)}&dates=${new Date(status.slots.find((s: Slot) => s.slot_id === status.evaluation.final_slot_id)!.start_at).toISOString().replace(/[-:]/g, '').split('.')[0]}Z/${new Date(status.slots.find((s: Slot) => s.slot_id === status.evaluation.final_slot_id)!.end_at).toISOString().replace(/[-:]/g, '').split('.')[0]}Z&details=${encodeURIComponent(`Google Meet: ${status.evaluation?.meeting?.url || ''}\n\n${status.thread.description || ''}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 px-4 py-2 bg-white border-2 border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 text-sm font-medium text-center"
                >
                  📅 Google カレンダーに追加
                </a>
              </div>
            )}
          </div>
        </div>
      )}

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
          <h3 className="text-lg font-medium text-gray-900 mb-4">候補日時と回答状況</h3>
          <p className="text-sm text-gray-600 mb-4">
            主催者は全員の回答状況を確認し、最適な日程を選択して確定できます。
          </p>
          <div className="space-y-2">
            {status.slots.map((slot: Slot) => {
              // Count how many people selected this slot
              // Note: selections may have different status values or null
              const selectedCount = status.selections?.filter((sel: any) => 
                sel.selected_slot_id === slot.slot_id
              ).length || 0;
              
              return (
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
                    {/* Show selection count */}
                    <p className="text-sm text-blue-600 mt-1">
                      {selectedCount > 0 ? `${selectedCount}名が選択` : '未選択'}
                    </p>
                  </div>
                </label>
              );
            })}
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
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {invite.candidate_name || invite.email}
                      </p>
                      {invite.candidate_name && (
                        <p className="text-sm text-gray-500">{invite.email}</p>
                      )}
                      {invite.invite_url && (
                        <div className="mt-2">
                          <a 
                            href={invite.invite_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:text-blue-800 break-all"
                          >
                            {invite.invite_url}
                          </a>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(invite.invite_url);
                              alert('招待リンクをコピーしました');
                            }}
                            className="ml-2 text-xs text-gray-500 hover:text-gray-700"
                          >
                            📋 コピー
                          </button>
                        </div>
                      )}
                    </div>
                    <span className="text-sm text-yellow-600 ml-4">未回答</span>
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
              {status.invites.filter((inv: any) => inv.status === 'accepted').map((invite: any) => {
                // Find the selection for this invite
                const selection = status.selections?.find((sel: any) => 
                  sel.invitee_key === invite.invitee_key
                );
                
                // Find the selected slot
                const selectedSlot = selection 
                  ? status.slots.find((s: Slot) => s.slot_id === selection.selected_slot_id)
                  : null;
                
                return (
                  <li key={invite.invite_id} className="py-3">
                    <div className="flex justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {invite.candidate_name || invite.email}
                        </p>
                        {invite.candidate_name && (
                          <p className="text-sm text-gray-500">{invite.email}</p>
                        )}
                        {/* Show selected slot */}
                        {selectedSlot && (
                          <p className="text-sm text-blue-600 mt-1">
                            → {new Date(selectedSlot.start_at).toLocaleString('ja-JP', {
                              month: 'numeric',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })} 〜 {new Date(selectedSlot.end_at).toLocaleString('ja-JP', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })} を選択
                          </p>
                        )}
                      </div>
                      <span className="text-sm text-green-600 ml-4">承諾</span>
                    </div>
                  </li>
                );
              })}
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
