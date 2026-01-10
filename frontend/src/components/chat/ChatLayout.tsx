/**
 * ChatLayout (Refactored)
 * 3-column layout using Zustand for state management
 * 
 * Before: 529 lines, 16 useState
 * After: ~250 lines, 0 useState (all in Zustand)
 */

import { useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { threadsApi } from '../../core/api';
import { ThreadsList } from './ThreadsList';
import { ChatPane } from './ChatPane';
import { CardsPane } from './CardsPane';
import { NotificationBell } from './NotificationBell';
import type { ExecutionResult } from '../../core/chat/apiExecutor';

// Zustand Store
import { 
  useStore, 
  useAuth, 
  useMessages, 
  useChatActions, 
  useThreadStatus, 
  usePendingAction,
  useAutoPropose,
  useUI,
  useCalendar,
} from '../../store';

// ============================================================
// Component
// ============================================================

export function ChatLayout() {
  const navigate = useNavigate();
  const { threadId } = useParams<{ threadId: string }>();
  
  // Zustand selectors (optimized re-renders)
  const { logout } = useAuth();
  const messages = useMessages(threadId || null);
  const { appendMessage, markThreadSeeded, isThreadSeeded } = useChatActions();
  const { currentStatus, isLoading, setCurrentStatus, setLoading, setError } = useThreadStatus();
  const { pendingAction, setPendingAction, clearPendingAction } = usePendingAction();
  const { pendingAutoPropose, setPendingAutoPropose, incrementAdditionalProposeCount, getAdditionalProposeCount } = useAutoPropose();
  const { mobileTab, setMobileTab } = useUI();
  const { today, week, freebusy, setToday, setWeek, setFreebusy } = useCalendar();
  
  // Direct store access for per-thread states
  const store = useStore();

  // ============================================================
  // Effects
  // ============================================================

  // Load thread status when threadId changes
  useEffect(() => {
    if (threadId) {
      loadThreadStatus(threadId);
      setMobileTab('chat');
    } else {
      setCurrentStatus(null);
    }
  }, [threadId]);

  // ============================================================
  // Handlers
  // ============================================================

  const loadThreadStatus = async (id: string) => {
    try {
      setLoading(true);
      const response = await threadsApi.getStatus(id);
      setCurrentStatus(response);
    } catch (error) {
      console.error('Failed to load thread status:', error);
      setCurrentStatus(null);
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleThreadUpdate = useCallback(() => {
    if (threadId) {
      loadThreadStatus(threadId);
    }
  }, [threadId]);

  const handleAppendMessage = useCallback((tid: string, msg: any) => {
    appendMessage(tid, msg);
  }, [appendMessage]);

  const handleSeedIfEmpty = useCallback((tid: string, seed: any[]) => {
    if (isThreadSeeded(tid)) return;
    
    const existingMessages = store.messagesByThreadId[tid];
    if (existingMessages && existingMessages.length > 0) return;
    
    markThreadSeeded(tid);
    seed.forEach(msg => appendMessage(tid, msg));
  }, [isThreadSeeded, markThreadSeeded, appendMessage, store.messagesByThreadId]);

  // Unified execution result handler
  const handleExecutionResult = useCallback((result: ExecutionResult) => {
    if (!result.data) return;
    
    const { kind, payload } = result.data;
    
    // Calendar updates
    if (kind === 'calendar.today') {
      setToday(payload);
    } else if (kind === 'calendar.week') {
      setWeek(payload);
    } else if (kind === 'calendar.freebusy') {
      setFreebusy(payload);
    }
    
    // Auto-propose updates
    else if (kind === 'auto_propose.generated') {
      setPendingAutoPropose(payload);
      if (payload.source === 'additional' && payload.threadId) {
        incrementAdditionalProposeCount(payload.threadId);
      }
    } else if (kind === 'auto_propose.cancelled' || kind === 'auto_propose.created') {
      setPendingAutoPropose(null);
    }
    
    // Remind updates
    else if (kind === 'remind.pending.generated' && payload.threadId) {
      store.setPendingRemind(payload.threadId, {
        threadId: payload.threadId,
        pendingInvites: payload.pendingInvites,
        count: payload.count,
      });
      store.incrementRemindCount(payload.threadId);
    } else if ((kind === 'remind.pending.cancelled' || kind === 'remind.pending.sent') && threadId) {
      store.setPendingRemind(threadId, null);
    }
    
    // Notify updates
    else if (kind === 'notify.confirmed.generated' && payload.threadId) {
      store.setPendingNotify(payload.threadId, {
        threadId: payload.threadId,
        invites: payload.invites,
        finalSlot: payload.finalSlot,
        meetingUrl: payload.meetingUrl,
      });
    } else if ((kind === 'notify.confirmed.cancelled' || kind === 'notify.confirmed.sent') && threadId) {
      store.setPendingNotify(threadId, null);
    }
    
    // Split updates
    else if (kind === 'split.propose.generated' && payload.threadId) {
      store.setPendingSplit(payload.threadId, { threadId: payload.threadId });
    } else if (kind === 'split.propose.cancelled' && threadId) {
      store.setPendingSplit(threadId, null);
    }
    
    // Clear split when auto-propose generated
    if (kind === 'auto_propose.generated' && threadId) {
      store.setPendingSplit(threadId, null);
    }
    
    // Beta A: Pending action updates
    else if (kind === 'pending.action.created') {
      setPendingAction({
        confirmToken: payload.confirmToken,
        expiresAt: payload.expiresAt,
        summary: payload.summary,
        mode: payload.mode,
        threadId: payload.threadId,
        threadTitle: payload.threadTitle,
      });
    } else if (kind === 'pending.action.cleared' || kind === 'pending.action.executed') {
      clearPendingAction();
      if (kind === 'pending.action.executed' && payload.threadId) {
        setTimeout(() => navigate(`/chat/${payload.threadId}`), 100);
      }
    }
  }, [threadId, navigate, setToday, setWeek, setFreebusy, setPendingAutoPropose, 
      incrementAdditionalProposeCount, setPendingAction, clearPendingAction, store]);

  const handleLogout = async () => {
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      logout();
      navigate('/');
    }
  };

  // ============================================================
  // Computed values
  // ============================================================

  const pendingRemind = threadId ? store.pendingRemindByThreadId[threadId] || null : null;
  const pendingNotify = threadId ? store.pendingNotifyByThreadId[threadId] || null : null;
  const pendingSplit = threadId ? store.pendingSplitByThreadId[threadId] || null : null;
  const additionalProposeCount = threadId ? getAdditionalProposeCount(threadId) : 0;
  const remindCount = threadId ? store.getRemindCount(threadId) : 0;

  // Convert null to undefined for CardsPane compatibility
  const calendarData = { 
    today: today ?? undefined, 
    week: week ?? undefined, 
    freebusy: freebusy ?? undefined 
  };

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="h-screen flex flex-col">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-bold text-gray-900">ToMoniWao Chat</h1>
          <span className="text-xs text-gray-500 bg-green-100 px-2 py-1 rounded">v2.0</span>
        </div>
        <div className="flex items-center space-x-4">
          <NotificationBell />
          <button
            onClick={handleLogout}
            className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            ログアウト
          </button>
        </div>
      </div>

      {/* Mobile Tabs */}
      <div className="lg:hidden bg-white border-b border-gray-200 flex">
        {(['threads', 'chat', 'cards'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            className={`flex-1 py-3 text-sm font-medium ${
              mobileTab === tab ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'
            }`}
          >
            {tab === 'threads' ? 'スレッド' : tab === 'chat' ? 'チャット' : 'カード'}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {/* Desktop Layout */}
        <div className="hidden lg:flex h-full">
          <div className="w-80 flex-shrink-0">
            <ThreadsList />
          </div>
          <div className="flex-1">
            <ChatPane 
              threadId={threadId || null}
              status={currentStatus} 
              loading={isLoading} 
              messages={messages}
              onAppend={handleAppendMessage}
              onSeedIfEmpty={handleSeedIfEmpty}
              onThreadUpdate={handleThreadUpdate}
              onExecutionResult={handleExecutionResult}
              pendingAutoPropose={pendingAutoPropose}
              additionalProposeCount={additionalProposeCount}
              pendingRemind={pendingRemind}
              remindCount={remindCount}
              pendingNotify={pendingNotify}
              pendingSplit={pendingSplit}
              pendingAction={pendingAction}
            />
          </div>
          <div className="w-96 flex-shrink-0">
            <CardsPane status={currentStatus} loading={isLoading} calendarData={calendarData} />
          </div>
        </div>

        {/* Mobile Layout */}
        <div className="lg:hidden h-full">
          {mobileTab === 'threads' && <ThreadsList />}
          {mobileTab === 'chat' && (
            <ChatPane 
              threadId={threadId || null}
              status={currentStatus} 
              loading={isLoading} 
              messages={messages}
              onAppend={handleAppendMessage}
              onSeedIfEmpty={handleSeedIfEmpty}
              onThreadUpdate={handleThreadUpdate}
              onExecutionResult={handleExecutionResult}
              pendingAutoPropose={pendingAutoPropose}
              additionalProposeCount={additionalProposeCount}
              pendingRemind={pendingRemind}
              remindCount={remindCount}
              pendingNotify={pendingNotify}
              pendingSplit={pendingSplit}
              pendingAction={pendingAction}
            />
          )}
          {mobileTab === 'cards' && (
            <CardsPane status={currentStatus} loading={isLoading} calendarData={calendarData} />
          )}
        </div>
      </div>
    </div>
  );
}
