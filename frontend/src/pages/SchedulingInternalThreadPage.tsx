/**
 * Scheduling Internal Thread Page
 * 
 * R1: Internal scheduling thread detail page
 * - Shows thread details (title, participants, slots)
 * - Allows invitee to select a slot and confirm
 * - Shows confirmed status with selected slot
 * 
 * URL: /scheduling/:threadId
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { schedulingInternalApi } from '../core/api';
import type { 
  InternalThreadResponse, 
  ThreadParticipant,
  CalendarStatus
} from '../core/api/schedulingInternal';
import { formatDateTimeRangeForViewer } from '../utils/datetime';
import { useViewerTimezone } from '../core/hooks/useViewerTimezone';
import { useMe } from '../core/hooks/useMe';

export function SchedulingInternalThreadPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const viewerTz = useViewerTimezone();
  const { me } = useMe();
  
  const [threadData, setThreadData] = useState<InternalThreadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus | null>(null);
  const [meetingUrl, setMeetingUrl] = useState<string | null>(null);

  // Format date range for display
  const formatRange = useCallback((start: string, end: string) => {
    return formatDateTimeRangeForViewer(start, end, viewerTz);
  }, [viewerTz]);

  // Load thread details
  const loadThread = useCallback(async () => {
    if (!threadId) return;
    
    try {
      setLoading(true);
      setError(null);
      const data = await schedulingInternalApi.getThread(threadId);
      setThreadData(data);
    } catch (err) {
      console.error('Failed to load thread:', err);
      setError(err instanceof Error ? err.message : 'スレッドの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  // Handle slot selection and confirmation
  const handleConfirm = async () => {
    if (!threadId || !selectedSlotId) return;
    
    const selectedSlot = threadData?.slots.find(s => s.slot_id === selectedSlotId);
    if (!selectedSlot) return;
    
    const confirmMessage = `以下の日程で確定します。\n\n${formatRange(selectedSlot.start_at, selectedSlot.end_at)}\n\nよろしいですか？`;
    
    if (!confirm(confirmMessage)) return;
    
    try {
      setSubmitting(true);
      const response = await schedulingInternalApi.respond(threadId, {
        selected_slot_id: selectedSlotId,
      });
      
      // Save calendar status and meeting URL from response (R1.1)
      if (response.calendar_status) {
        setCalendarStatus(response.calendar_status);
      }
      if (response.meeting_url) {
        setMeetingUrl(response.meeting_url);
      }
      
      // Reload to show confirmed status
      await loadThread();
      
      alert('✅ 日程を確定しました！');
    } catch (err) {
      console.error('Failed to confirm:', err);
      alert(err instanceof Error ? err.message : '確定に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  // Check if current user is the organizer
  const isOrganizer = me?.id === threadData?.thread.organizer_user_id;
  
  // Check if thread is already confirmed
  const isConfirmed = threadData?.thread.status === 'confirmed';
  
  // Get participant display name
  const getParticipantName = (participant: ThreadParticipant) => {
    return participant.display_name || participant.email || '不明なユーザー';
  };

  // Get other participant (for 1:1)
  const getOtherParticipant = () => {
    if (!threadData || !me) return null;
    return threadData.participants.find(p => p.user_id !== me.id);
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-2xl mx-auto">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            <p className="font-medium">エラー</p>
            <p className="text-sm">{error}</p>
          </div>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 text-blue-600 hover:text-blue-800"
          >
            ← 戻る
          </button>
        </div>
      </div>
    );
  }

  // No data state
  if (!threadData) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-2xl mx-auto">
          <p className="text-gray-500">スレッドが見つかりません</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 text-blue-600 hover:text-blue-800"
          >
            ← 戻る
          </button>
        </div>
      </div>
    );
  }

  const { thread, participants, slots, confirmed_slot } = threadData;
  const otherParticipant = getOtherParticipant();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <button
            onClick={() => navigate(-1)}
            className="text-gray-500 hover:text-gray-700 text-sm mb-4 flex items-center"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            戻る
          </button>
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                📅 {thread.title}
              </h1>
              {otherParticipant && (
                <p className="text-gray-600 mt-1">
                  {isOrganizer ? `${getParticipantName(otherParticipant)} さんとの日程調整` : '日程調整の依頼'}
                </p>
              )}
            </div>
            
            {/* Status Badge */}
            <div>
              {isConfirmed ? (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                  ✅ 確定済み
                </span>
              ) : (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                  🕐 回答待ち
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Confirmed Section */}
        {isConfirmed && confirmed_slot && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-green-800 mb-2">
              ✅ 日程が確定しました
            </h2>
            <div className="bg-white rounded-lg p-4 border border-green-200">
              <p className="text-lg font-medium text-gray-900">
                {formatRange(confirmed_slot.start_at, confirmed_slot.end_at)}
              </p>
              {confirmed_slot.label && (
                <p className="text-sm text-gray-500 mt-1">{confirmed_slot.label}</p>
              )}
            </div>
            
            {/* Meeting URL (R1.1) */}
            {meetingUrl && (
              <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-sm font-medium text-blue-800 mb-1">
                  🎥 Google Meet
                </p>
                <a 
                  href={meetingUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 underline break-all text-sm"
                >
                  {meetingUrl}
                </a>
              </div>
            )}
            
            {/* Calendar Status (R1.1) */}
            {calendarStatus && (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-medium text-gray-700">カレンダー連携状況:</p>
                
                {/* Organizer status */}
                <div className="flex items-center text-sm">
                  <span className="text-gray-600 w-20">主催者:</span>
                  {calendarStatus.organizer.registered ? (
                    <span className="text-green-600 flex items-center">
                      <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Googleカレンダーに登録済み
                    </span>
                  ) : (
                    <span className="text-gray-500 flex items-center">
                      <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      {calendarStatus.organizer.error === 'no_calendar_connected' 
                        ? 'カレンダー未連携' 
                        : '登録失敗'}
                    </span>
                  )}
                </div>
                
                {/* Invitee status */}
                <div className="flex items-center text-sm">
                  <span className="text-gray-600 w-20">あなた:</span>
                  {calendarStatus.invitee.registered ? (
                    <span className="text-green-600 flex items-center">
                      <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Googleカレンダーに登録済み
                    </span>
                  ) : (
                    <span className="text-gray-500 flex items-center">
                      <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      {calendarStatus.invitee.error === 'no_calendar_connected' 
                        ? 'カレンダー未連携' 
                        : '登録失敗'}
                    </span>
                  )}
                </div>
                
                {/* R1.2: Calendar connection CTA for invitee */}
                {!calendarStatus.invitee.registered && calendarStatus.invitee.error === 'no_calendar_connected' && (
                  <div className="mt-4 p-4 bg-amber-50 rounded-lg border border-amber-200">
                    <p className="text-sm text-amber-800 mb-3">
                      📅 Googleカレンダーを連携すると、確定した予定が自動で登録されます。
                    </p>
                    <button
                      onClick={() => navigate('/settings')}
                      className="inline-flex items-center px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      設定でカレンダーを連携する
                    </button>
                  </div>
                )}
              </div>
            )}
            
            {/* Fallback message if no calendar status */}
            {!calendarStatus && (
              <p className="text-sm text-gray-500 mt-4">
                ※ Googleカレンダー連携状況は設定から確認できます
              </p>
            )}
          </div>
        )}

        {/* Participants Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            参加者
          </h2>
          <div className="space-y-3">
            {participants.map((participant) => (
              <div 
                key={participant.id}
                className="flex items-center justify-between"
              >
                <div className="flex items-center">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                    <span className="text-blue-600 font-medium">
                      {(participant.display_name || participant.email || '?')[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="ml-3">
                    <p className="font-medium text-gray-900">
                      {getParticipantName(participant)}
                      {participant.user_id === me?.id && (
                        <span className="ml-2 text-xs text-gray-500">(あなた)</span>
                      )}
                    </p>
                    {participant.email && (
                      <p className="text-sm text-gray-500">{participant.email}</p>
                    )}
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${
                  participant.role === 'owner' 
                    ? 'bg-blue-100 text-blue-700' 
                    : 'bg-gray-100 text-gray-700'
                }`}>
                  {participant.role === 'owner' ? '主催者' : '参加者'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Slots Section - Only show if not confirmed OR user is organizer */}
        {(!isConfirmed || isOrganizer) && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              {isConfirmed ? '提案された候補日程' : '候補日程を選択してください'}
            </h2>
            
            {slots.length === 0 ? (
              <p className="text-gray-500">候補日程がありません</p>
            ) : (
              <div className="space-y-3">
                {slots.map((slot) => {
                  const isSelected = selectedSlotId === slot.slot_id;
                  const isConfirmedSlot = confirmed_slot?.slot_id === slot.slot_id;
                  
                  return (
                    <div
                      key={slot.slot_id}
                      onClick={() => !isConfirmed && setSelectedSlotId(slot.slot_id)}
                      className={`
                        p-4 rounded-lg border-2 transition-all
                        ${isConfirmedSlot
                          ? 'border-green-500 bg-green-50'
                          : isSelected
                            ? 'border-blue-500 bg-blue-50 cursor-pointer'
                            : isConfirmed
                              ? 'border-gray-200 bg-gray-50'
                              : 'border-gray-200 hover:border-blue-300 cursor-pointer'
                        }
                      `}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          {!isConfirmed && (
                            <div className={`
                              w-5 h-5 rounded-full border-2 mr-3 flex items-center justify-center
                              ${isSelected 
                                ? 'border-blue-500 bg-blue-500' 
                                : 'border-gray-300'
                              }
                            `}>
                              {isSelected && (
                                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-gray-900">
                              {formatRange(slot.start_at, slot.end_at)}
                            </p>
                            {slot.label && (
                              <p className="text-sm text-gray-500">{slot.label}</p>
                            )}
                          </div>
                        </div>
                        {isConfirmedSlot && (
                          <span className="text-green-600 text-sm font-medium">
                            ✓ 確定
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Confirm Button - Only for invitee when not confirmed */}
            {!isConfirmed && !isOrganizer && (
              <div className="mt-6">
                <button
                  onClick={handleConfirm}
                  disabled={!selectedSlotId || submitting}
                  className={`
                    w-full py-3 px-4 rounded-lg font-medium text-white
                    ${selectedSlotId && !submitting
                      ? 'bg-blue-600 hover:bg-blue-700'
                      : 'bg-gray-400 cursor-not-allowed'
                    }
                  `}
                >
                  {submitting ? (
                    <span className="flex items-center justify-center">
                      <svg className="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      確定中...
                    </span>
                  ) : (
                    'この日程で確定する'
                  )}
                </button>
              </div>
            )}

            {/* Message for organizer */}
            {!isConfirmed && isOrganizer && (
              <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <p className="text-blue-800 text-sm">
                  📨 {otherParticipant ? getParticipantName(otherParticipant) : '相手'} さんに日程調整の依頼を送信しました。
                  相手が候補を選択すると確定されます。
                </p>
              </div>
            )}
          </div>
        )}

        {/* Description Section */}
        {thread.description && (
          <div className="bg-white rounded-lg shadow p-6 mt-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              説明
            </h2>
            <p className="text-gray-700 whitespace-pre-wrap">{thread.description}</p>
          </div>
        )}
      </div>
    </div>
  );
}
