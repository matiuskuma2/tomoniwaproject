/**
 * ChatLayout
 * 3-column layout: Left (ThreadsList) + Center (ChatPane) + Right (CardsPane)
 * Desktop: 3 columns side-by-side
 * Mobile: Tabs for Threads/Chat/Cards
 * 
 * Phase Next-2: Manages per-thread conversation history
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { threadsApi } from '../../core/api';
import { clearAuth } from '../../core/auth';
import { ThreadsList } from './ThreadsList';
import { ChatPane, type ChatMessage } from './ChatPane';
import { CardsPane } from './CardsPane';
import { NotificationBell } from './NotificationBell';
import type { 
  ThreadStatus_API, 
  CalendarTodayResponse, 
  CalendarWeekResponse, 
  CalendarFreeBusyResponse 
} from '../../core/models';
import type { ExecutionResult } from '../../core/chat/apiExecutor';

type MobileTab = 'threads' | 'chat' | 'cards';

// Phase Next-3 (Day4): Calendar data state
interface CalendarData {
  today?: CalendarTodayResponse;
  week?: CalendarWeekResponse;
  freebusy?: CalendarFreeBusyResponse;
}

// Phase Next-5 Day2: Auto-propose pending state
interface PendingAutoPropose {
  emails: string[];
  duration: number;
  range: string;
  proposals: Array<{ start_at: string; end_at: string; label: string }>;
}

// Beta A: Pending action state for 3-word decision
interface PendingActionState {
  confirmToken: string;
  expiresAt: string;
  summary: any;
  mode: 'new_thread' | 'add_to_thread';
  threadId?: string;
  threadTitle?: string;
}

export function ChatLayout() {
  const navigate = useNavigate();
  const { threadId } = useParams<{ threadId: string }>();
  const [status, setStatus] = useState<ThreadStatus_API | null>(null);
  const [loading, setLoading] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('threads');
  
  // NEW: Per-thread message history (Phase P0-3: localStorage persistence)
  const [messagesByThreadId, setMessagesByThreadId] = useState<Record<string, ChatMessage[]>>(() => {
    // Load from localStorage on mount
    try {
      const saved = localStorage.getItem('tomoniwao_messages');
      if (!saved) return {};
      
      const parsed = JSON.parse(saved);
      
      // Validate parsed data
      if (typeof parsed !== 'object' || parsed === null) {
        console.warn('[ChatLayout] Invalid messages format in localStorage, clearing');
        localStorage.removeItem('tomoniwao_messages');
        return {};
      }
      
      return parsed;
    } catch (error) {
      console.error('[ChatLayout] Failed to load messages from localStorage:', error);
      // Clear corrupted data
      localStorage.removeItem('tomoniwao_messages');
      return {};
    }
  });
  
  // NEW (Day4): Calendar data state
  const [calendarData, setCalendarData] = useState<CalendarData>({});
  
  // NEW (Phase Next-5 Day2): Pending auto-propose state
  const [pendingAutoPropose, setPendingAutoPropose] = useState<PendingAutoPropose | null>(null);
  
  // NEW (Phase Next-5 Day3): Additional propose execution count (max 2 per thread)
  const [additionalProposeCountByThreadId, setAdditionalProposeCountByThreadId] = useState<Record<string, number>>({});
  
  // NEW (Phase Next-6 Day1): Pending remind state
  interface PendingRemind {
    threadId: string;
    pendingInvites: Array<{ email: string; name?: string }>;
    count: number;
  }
  const [pendingRemindByThreadId, setPendingRemindByThreadId] = useState<Record<string, PendingRemind | null>>({});
  
  // NEW (Phase Next-6 Day1): Remind execution count (max 2 per thread)
  const [remindCountByThreadId, setRemindCountByThreadId] = useState<Record<string, number>>({});
  
  // NEW (Phase Next-6 Day3): Pending notify state (per thread)
  type PendingNotify = {
    threadId: string;
    invites: Array<{ email: string; name?: string }>;
    finalSlot: { start_at: string; end_at: string; label?: string };
    meetingUrl?: string;
  }
  const [pendingNotifyByThreadId, setPendingNotifyByThreadId] = useState<Record<string, PendingNotify | null>>({});
  
  // NEW (Phase Next-6 Day2): Pending split state (per thread)
  type PendingSplit = {
    threadId: string;
  }
  const [pendingSplitByThreadId, setPendingSplitByThreadId] = useState<Record<string, PendingSplit | null>>({});
  
  // Beta A: Pending action state for 3-word decision (per thread or global)
  const [pendingAction, setPendingAction] = useState<PendingActionState | null>(null);

  // Phase P0-3: Track seeded threads to prevent double-seeding
  const [seededThreads, setSeededThreads] = useState<Set<string>>(new Set());

  // Phase P1: localStorage save fail counter (auto-disable on repeated failures)
  const [saveFailCount, setSaveFailCount] = useState(0);
  const [persistEnabled, setPersistEnabled] = useState(true);
  const MAX_FAIL_COUNT = 3;

  // Phase P1: Persist messages to localStorage with debounce (500ms)
  useEffect(() => {
    // Skip if persistence is disabled (after repeated failures)
    if (!persistEnabled) {
      console.warn('[ChatLayout] localStorage persistence disabled due to repeated failures');
      return;
    }

    // Skip localStorage on mobile if it causes issues
    if (typeof window === 'undefined') return;
    
    // Debounce: wait 500ms before saving
    const timer = setTimeout(() => {
      try {
        const serialized = JSON.stringify(messagesByThreadId);
        
        // Check size (localStorage limit is typically 5-10MB)
        if (serialized.length > 5 * 1024 * 1024) {
          console.warn('[ChatLayout] Messages too large for localStorage, clearing old threads');
          // Keep only recent threads (last 10)
          const threadIds = Object.keys(messagesByThreadId);
          if (threadIds.length > 10) {
            const recentThreads = threadIds.slice(-10);
            const trimmed: Record<string, ChatMessage[]> = {};
            recentThreads.forEach(tid => {
              trimmed[tid] = messagesByThreadId[tid];
            });
            setMessagesByThreadId(trimmed);
            return; // Will retry on next effect
          }
        }
        
        // Try to save to localStorage
        try {
          localStorage.setItem('tomoniwao_messages', serialized);
          // Reset fail count on success
          if (saveFailCount > 0) {
            setSaveFailCount(0);
          }
        } catch (storageError) {
          console.error('[ChatLayout] localStorage.setItem failed:', storageError);
          
          // Increment fail count
          const newFailCount = saveFailCount + 1;
          setSaveFailCount(newFailCount);
          
          // Disable persistence after MAX_FAIL_COUNT failures
          if (newFailCount >= MAX_FAIL_COUNT) {
            console.error(`[ChatLayout] localStorage failed ${MAX_FAIL_COUNT} times, disabling persistence`);
            setPersistEnabled(false);
          }
        }
      } catch (error) {
        console.error('[ChatLayout] Failed to serialize messages:', error);
        // If serialization fails, clear the problematic data
        if (error instanceof TypeError) {
          console.warn('[ChatLayout] Clearing messagesByThreadId due to serialization error');
          setMessagesByThreadId({});
        }
      }
    }, 500); // 500ms debounce

    // Cleanup timer on unmount or before next effect
    return () => clearTimeout(timer);
  }, [messagesByThreadId, saveFailCount, persistEnabled]);

  useEffect(() => {
    if (threadId) {
      loadThreadStatus(threadId);
      setMobileTab('chat'); // Auto-switch to chat on mobile when thread selected
    } else {
      setStatus(null);
    }
  }, [threadId]);

  const loadThreadStatus = async (id: string) => {
    try {
      setLoading(true);
      const response = await threadsApi.getStatus(id);
      setStatus(response);
    } catch (error) {
      console.error('Failed to load thread status:', error);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  const handleThreadUpdate = () => {
    if (threadId) {
      loadThreadStatus(threadId);
    }
  };

  // NEW: Append message to specific thread
  const appendMessage = (tid: string, msg: ChatMessage) => {
    setMessagesByThreadId((prev) => {
      const next = { ...prev };
      const arr = next[tid] ? [...next[tid]] : [];
      arr.push(msg);
      next[tid] = arr;
      return next;
    });
  };

  // NEW: Seed template messages if thread is empty (once per thread)
  const seedIfEmpty = (tid: string, seed: ChatMessage[]) => {
    // Phase P0-3: Prevent double-seeding
    if (seededThreads.has(tid)) {
      return; // Already seeded, skip
    }

    setMessagesByThreadId((prev) => {
      // If thread already has messages, don't overwrite
      if (prev[tid] && prev[tid].length > 0) return prev;
      
      // Mark as seeded
      setSeededThreads(prevSeeded => new Set(prevSeeded).add(tid));
      
      return { ...prev, [tid]: seed };
    });
  };

  // Phase Next-5 Day2.1: Unified execution result handler (type-safe)
  const handleExecutionResult = (result: ExecutionResult) => {
    if (!result.data) return;
    
    const { kind, payload } = result.data;
    
    // Handle calendar data updates
    if (kind === 'calendar.today') {
      setCalendarData(prev => ({ ...prev, today: payload }));
    } else if (kind === 'calendar.week') {
      setCalendarData(prev => ({ ...prev, week: payload }));
    } else if (kind === 'calendar.freebusy') {
      setCalendarData(prev => ({ ...prev, freebusy: payload }));
    }
    
    // Handle auto-propose state updates
    else if (kind === 'auto_propose.generated') {
      setPendingAutoPropose(payload);
      
      // Phase Next-5 Day3: Increment additional propose count
      // 明示フラグ source === 'additional' で判定（事故防止）
      // threadId は payload から取得（今見てるスレッドではなく提案生成時のスレッド）
      if (payload.source === 'additional' && payload.threadId) {
        const targetThreadId = payload.threadId; // 型安全のため一度変数に入れる
        setAdditionalProposeCountByThreadId(prev => ({
          ...prev,
          [targetThreadId]: (prev[targetThreadId] || 0) + 1,
        }));
      }
    } else if (kind === 'auto_propose.cancelled' || kind === 'auto_propose.created') {
      setPendingAutoPropose(null);
    }
    
    // Phase Next-6 Day1: Handle remind state updates
    else if (kind === 'remind.pending.generated') {
      // Set pending remind for this thread
      if (payload.threadId) {
        setPendingRemindByThreadId(prev => ({
          ...prev,
          [payload.threadId]: {
            threadId: payload.threadId,
            pendingInvites: payload.pendingInvites,
            count: payload.count,
          },
        }));
        
        // Increment remind count
        setRemindCountByThreadId(prev => ({
          ...prev,
          [payload.threadId]: (prev[payload.threadId] || 0) + 1,
        }));
      }
    } else if (kind === 'remind.pending.cancelled' || kind === 'remind.pending.sent') {
      // Clear pending remind for current thread
      if (threadId) {
        setPendingRemindByThreadId(prev => ({
          ...prev,
          [threadId]: null,
        }));
      }
    }
    
    // Phase Next-6 Day3: Handle notify state updates
    else if (kind === 'notify.confirmed.generated') {
      // Set pending notify for this thread
      if (payload.threadId) {
        setPendingNotifyByThreadId(prev => ({
          ...prev,
          [payload.threadId]: {
            threadId: payload.threadId,
            invites: payload.invites,
            finalSlot: payload.finalSlot,
            meetingUrl: payload.meetingUrl,
          },
        }));
      }
    } else if (kind === 'notify.confirmed.cancelled' || kind === 'notify.confirmed.sent') {
      // Clear pending notify for current thread
      if (threadId) {
        setPendingNotifyByThreadId(prev => ({
          ...prev,
          [threadId]: null,
        }));
      }
    }
    
    // Phase Next-6 Day2: Handle split state updates
    else if (kind === 'split.propose.generated') {
      // Set pending split for this thread
      if (payload.threadId) {
        setPendingSplitByThreadId(prev => ({
          ...prev,
          [payload.threadId]: {
            threadId: payload.threadId,
          },
        }));
      }
    } else if (kind === 'split.propose.cancelled') {
      // Clear pending split for current thread
      if (threadId) {
        setPendingSplitByThreadId(prev => ({
          ...prev,
          [threadId]: null,
        }));
      }
    }
    
    // Phase Next-6 Day2: Clear split when moving to additional propose
    if (kind === 'auto_propose.generated' && threadId) {
      setPendingSplitByThreadId(prev => ({
        ...prev,
        [threadId]: null,
      }));
    }
    
    // Beta A: Handle pending action state updates
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
      setPendingAction(null);
      
      // If executed with threadId, navigate to that thread
      if (kind === 'pending.action.executed' && payload.threadId) {
        setTimeout(() => {
          navigate(`/chat/${payload.threadId}`);
        }, 100);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      clearAuth();
      navigate('/');
    }
  };

  // Get current thread's messages
  const currentMessages = threadId ? (messagesByThreadId[threadId] || []) : [];

  return (
    <div className="h-screen flex flex-col">
      {/* Top Bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h1 className="text-xl font-bold text-gray-900">ToMoniWao Chat</h1>
          <span className="text-xs text-gray-500 bg-green-100 px-2 py-1 rounded">Phase Next-2 (P0)</span>
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
        <button
          onClick={() => setMobileTab('threads')}
          className={`flex-1 py-3 text-sm font-medium ${
            mobileTab === 'threads' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'
          }`}
        >
          スレッド
        </button>
        <button
          onClick={() => setMobileTab('chat')}
          className={`flex-1 py-3 text-sm font-medium ${
            mobileTab === 'chat' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'
          }`}
        >
          チャット
        </button>
        <button
          onClick={() => setMobileTab('cards')}
          className={`flex-1 py-3 text-sm font-medium ${
            mobileTab === 'cards' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'
          }`}
        >
          カード
        </button>
      </div>

      {/* Main Content - Desktop: 3 columns, Mobile: Selected tab */}
      <div className="flex-1 overflow-hidden">
        {/* Desktop Layout */}
        <div className="hidden lg:flex h-full">
          {/* Left: ThreadsList (~300px) */}
          <div className="w-80 flex-shrink-0">
            <ThreadsList />
          </div>

          {/* Center: ChatPane (flexible) */}
          <div className="flex-1">
            <ChatPane 
              threadId={threadId || null}
              status={status} 
              loading={loading} 
              messages={currentMessages}
              onAppend={appendMessage}
              onSeedIfEmpty={seedIfEmpty}
              onThreadUpdate={handleThreadUpdate}
              onExecutionResult={handleExecutionResult}
              pendingAutoPropose={pendingAutoPropose}
              additionalProposeCount={threadId ? (additionalProposeCountByThreadId[threadId] || 0) : 0}
              pendingRemind={threadId ? (pendingRemindByThreadId[threadId] || null) : null}
              remindCount={threadId ? (remindCountByThreadId[threadId] || 0) : 0}
              pendingNotify={threadId ? (pendingNotifyByThreadId[threadId] || null) : null}
              pendingSplit={threadId ? (pendingSplitByThreadId[threadId] || null) : null}
              pendingAction={pendingAction}
            />
          </div>

          {/* Right: CardsPane (~400px) */}
          <div className="w-96 flex-shrink-0">
            <CardsPane 
              status={status} 
              loading={loading} 
              calendarData={calendarData}
            />
          </div>
        </div>

        {/* Mobile Layout */}
        <div className="lg:hidden h-full">
          {mobileTab === 'threads' && <ThreadsList />}
          {mobileTab === 'chat' && (
            <ChatPane 
              threadId={threadId || null}
              status={status} 
              loading={loading} 
              messages={currentMessages}
              onAppend={appendMessage}
              onSeedIfEmpty={seedIfEmpty}
              onThreadUpdate={handleThreadUpdate}
              onExecutionResult={handleExecutionResult}
              pendingAutoPropose={pendingAutoPropose}
              additionalProposeCount={threadId ? (additionalProposeCountByThreadId[threadId] || 0) : 0}
              pendingRemind={threadId ? (pendingRemindByThreadId[threadId] || null) : null}
              remindCount={threadId ? (remindCountByThreadId[threadId] || 0) : 0}
              pendingNotify={threadId ? (pendingNotifyByThreadId[threadId] || null) : null}
              pendingSplit={threadId ? (pendingSplitByThreadId[threadId] || null) : null}
              pendingAction={pendingAction}
            />
          )}
          {mobileTab === 'cards' && (
            <CardsPane 
              status={status} 
              loading={loading} 
              calendarData={calendarData}
            />
          )}
        </div>
      </div>
    </div>
  );
}
