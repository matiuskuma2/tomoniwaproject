/**
 * NotificationBell
 * Displays inbox icon with unread count and drawer
 * 
 * P1-1: uses inbox cache
 * P1-3: uses viewerTz for consistent timezone display
 * D-1: relationship request approve/decline actions
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getInbox, subscribeInbox, refreshInbox } from '../../core/cache';
import type { InboxNotification } from '../../core/models';
import { formatDateTimeForViewer } from '../../utils/datetime';
import { useViewerTimezone } from '../../core/hooks/useViewerTimezone';
import { relationshipsApi } from '../../core/api';
import { invalidateRelationships } from '../../core/cache/relationshipsCache';

// Inbox notification types for relationships
const INBOX_TYPE_RELATIONSHIP_REQUEST = 'relationship_request';
const INBOX_TYPE_RELATIONSHIP_ACCEPTED = 'relationship_accepted';
const INBOX_TYPE_RELATIONSHIP_DECLINED = 'relationship_declined';

// Notification item with relationship actions
interface NotificationItemProps {
  notification: InboxNotification;
  viewerTz: string;
  onAction: () => void;
  onClick: () => void;
}

function NotificationItem({ notification, viewerTz, onAction, onClick }: NotificationItemProps) {
  const [processing, setProcessing] = useState(false);
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // Parse payload
  let payload: any = {};
  try {
    payload = notification.payload || JSON.parse(notification.payload_json || '{}');
  } catch (e) {
    console.error('Failed to parse notification payload:', e);
  }
  
  const isRelationshipRequest = notification.kind === INBOX_TYPE_RELATIONSHIP_REQUEST;
  const isRelationshipAccepted = notification.kind === INBOX_TYPE_RELATIONSHIP_ACCEPTED;
  const isRelationshipDeclined = notification.kind === INBOX_TYPE_RELATIONSHIP_DECLINED;
  
  // Get token for relationship request
  const token = payload.token;
  
  const handleAccept = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!token || processing) return;
    
    setProcessing(true);
    setActionResult(null);
    
    try {
      await relationshipsApi.accept(token);
      setActionResult({ type: 'success', message: '承認しました' });
      // Invalidate relationships cache
      invalidateRelationships();
      // Refresh inbox
      await refreshInbox();
      onAction();
    } catch (error: any) {
      console.error('Failed to accept relationship request:', error);
      setActionResult({ 
        type: 'error', 
        message: error?.response?.data?.error || '承認に失敗しました'
      });
    } finally {
      setProcessing(false);
    }
  };
  
  const handleDecline = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!token || processing) return;
    
    setProcessing(true);
    setActionResult(null);
    
    try {
      await relationshipsApi.decline(token);
      setActionResult({ type: 'success', message: '辞退しました' });
      // Refresh inbox
      await refreshInbox();
      onAction();
    } catch (error: any) {
      console.error('Failed to decline relationship request:', error);
      setActionResult({ 
        type: 'error', 
        message: error?.response?.data?.error || '辞退に失敗しました'
      });
    } finally {
      setProcessing(false);
    }
  };
  
  // Display label based on notification type
  const getDisplayInfo = () => {
    if (isRelationshipRequest) {
      const relationLabel = payload.requested_type === 'family' ? '家族' : '仕事仲間';
      const inviterName = payload.inviter_name || payload.inviter_email || '不明なユーザー';
      return {
        title: `${inviterName} さんから「${relationLabel}」申請`,
        icon: '👋',
        showActions: !actionResult,
      };
    }
    if (isRelationshipAccepted) {
      const accepterName = payload.accepted_by_name || '不明なユーザー';
      return {
        title: `${accepterName} さんが関係申請を承認しました`,
        icon: '✅',
        showActions: false,
      };
    }
    if (isRelationshipDeclined) {
      const declinerName = payload.declined_by_name || '不明なユーザー';
      return {
        title: `${declinerName} さんが関係申請を辞退しました`,
        icon: '❌',
        showActions: false,
      };
    }
    return {
      title: notification.kind,
      icon: '📬',
      showActions: false,
    };
  };
  
  const displayInfo = getDisplayInfo();

  return (
    <div
      onClick={onClick}
      className={`p-4 cursor-pointer hover:bg-gray-50 ${
        !notification.read ? 'bg-blue-50' : ''
      }`}
    >
      <div className="flex items-start">
        <span className="text-xl mr-3">{displayInfo.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 break-words">
            {displayInfo.title}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {formatDateTimeForViewer(notification.created_at, viewerTz)}
          </p>
          
          {/* Action Result */}
          {actionResult && (
            <div className={`mt-2 text-xs ${
              actionResult.type === 'success' ? 'text-green-600' : 'text-red-600'
            }`}>
              {actionResult.message}
            </div>
          )}
          
          {/* Relationship Request Actions */}
          {isRelationshipRequest && displayInfo.showActions && token && (
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleAccept}
                disabled={processing}
                className="px-3 py-1 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processing ? '処理中...' : '承認'}
              </button>
              <button
                onClick={handleDecline}
                disabled={processing}
                className="px-3 py-1 text-xs font-medium text-gray-700 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {processing ? '処理中...' : '辞退'}
              </button>
            </div>
          )}
        </div>
        {!notification.read && (
          <span className="ml-2 w-2 h-2 bg-blue-600 rounded-full flex-shrink-0"></span>
        )}
      </div>
    </div>
  );
}

export function NotificationBell() {
  const navigate = useNavigate();
  const viewerTz = useViewerTimezone(); // P1-3
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const loadNotifications = useCallback(async () => {
    try {
      setLoading(true);
      // P1-1: キャッシュ経由で取得（TTL 10秒 + inflight共有）
      const items = await getInbox();
      setNotifications(items || []);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    
    // P1-1: キャッシュ更新をsubscribe（refreshAfterWrite後の自動更新）
    const unsubscribe = subscribeInbox((updatedItems) => {
      setNotifications(updatedItems || []);
    });
    
    return unsubscribe;
  }, [loadNotifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleNotificationClick = (notification: InboxNotification) => {
    // Parse payload
    let payload: any = {};
    try {
      payload = notification.payload || JSON.parse(notification.payload_json || '{}');
    } catch (error) {
      console.error('Failed to parse notification payload:', error);
    }
    
    // Relationship notifications: navigate to contacts
    if (notification.kind === INBOX_TYPE_RELATIONSHIP_ACCEPTED ||
        notification.kind === INBOX_TYPE_RELATIONSHIP_DECLINED) {
      navigate('/contacts');
      setIsOpen(false);
      return;
    }
    
    // Relationship request: don't navigate (actions are inline)
    if (notification.kind === INBOX_TYPE_RELATIONSHIP_REQUEST) {
      return;
    }
    
    // If payload contains thread_id, navigate to /chat/:threadId
    if (payload.thread_id) {
      navigate(`/chat/${payload.thread_id}`);
      setIsOpen(false);
    }
  };

  const handleAction = () => {
    // Reload notifications after action
    loadNotifications();
  };

  return (
    <div className="relative">
      {/* Bell Icon */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white transform translate-x-1/2 -translate-y-1/2 bg-red-600 rounded-full">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Drawer */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-40 bg-black bg-opacity-25"
            onClick={() => setIsOpen(false)}
          />

          {/* Drawer Panel */}
          <div className="absolute right-0 top-12 w-96 max-h-[80vh] bg-white rounded-lg shadow-xl z-50 overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">通知</h3>
              {unreadCount > 0 && (
                <span className="text-sm text-gray-500">{unreadCount}件の未読</span>
              )}
            </div>

            <div className="overflow-y-auto max-h-[calc(80vh-60px)]">
              {loading ? (
                <div className="p-4 text-center text-gray-500">読み込み中...</div>
              ) : notifications.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                  <p className="mt-2">通知はありません</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {notifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      viewerTz={viewerTz}
                      onAction={handleAction}
                      onClick={() => handleNotificationClick(notification)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
