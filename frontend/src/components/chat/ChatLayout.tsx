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

// Beta A / Phase2: Pending action state for decision flow
interface PendingActionState {
  confirmToken: string;
  expiresAt: string;
  summary: any;
  mode: 'new_thread' | 'add_to_thread' | 'add_slots'; // Phase2: add_slots 追加
  threadId?: string;
  threadTitle?: string;
  actionType?: 'send_invites' | 'add_invites' | 'add_slots'; // Phase2: action_type
}

export function ChatLayout() {
  const navigate = useNavigate();
  const { threadId } = useParams<{ threadId: string }>();
  const [status, setStatus] = useState<ThreadStatus_API | null>(null);
  const [loading, setLoading] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('threads');
  
  // P0-1: Settings dropdown state (ホバー前提UI修正 - タップ対応)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
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

  // Phase2 P2-D1: Pending remind need response state (per thread)
  type PendingRemindNeedResponse = {
    threadId: string;
    targetInvitees: Array<{ email: string; name?: string; inviteeKey: string }>;
    count: number;
  }
  const [pendingRemindNeedResponseByThreadId, setPendingRemindNeedResponseByThreadId] = useState<Record<string, PendingRemindNeedResponse | null>>({});

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
    
    // Phase2 P2-D1: Handle remind need response state updates
    else if (kind === 'remind.need_response.generated') {
      // Set pending remind need response for this thread
      if (payload.threadId) {
        setPendingRemindNeedResponseByThreadId(prev => ({
          ...prev,
          [payload.threadId]: {
            threadId: payload.threadId,
            targetInvitees: payload.targetInvitees,
            count: payload.count,
          },
        }));
      }
    } else if (kind === 'remind.need_response.cancelled' || kind === 'remind.need_response.sent') {
      // Clear pending remind need response for current thread
      if (threadId) {
        setPendingRemindNeedResponseByThreadId(prev => ({
          ...prev,
          [threadId]: null,
        }));
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
          
          {/* Settings Dropdown - P0-1: タップ対応に修正 */}
          <div className="relative">
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              aria-expanded={isSettingsOpen}
              aria-haspopup="true"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
            </button>
            
            {/* Dropdown Menu - state駆動で表示/非表示 */}
            {isSettingsOpen && (
              <>
                {/* 外側クリックで閉じるオーバーレイ */}
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setIsSettingsOpen(false)}
                  aria-hidden="true"
                />
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-50">
                  <div className="py-1">
                    <button
                      onClick={() => { navigate('/settings'); setIsSettingsOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <span className="mr-2">🌐</span>タイムゾーン設定
                    </button>
                    <button
                      onClick={() => { navigate('/settings/billing'); setIsSettingsOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <span className="mr-2">💳</span>課金設定
                    </button>
                    <button
                      onClick={() => { navigate('/contacts'); setIsSettingsOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <span className="mr-2">📇</span>連絡先管理
                    </button>
                    <button
                      onClick={() => { navigate('/lists'); setIsSettingsOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <span className="mr-2">📋</span>リスト管理
                    </button>
                    <div className="border-t border-gray-100 my-1"></div>
                    <button
                      onClick={() => { handleLogout(); setIsSettingsOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      <span className="mr-2">🚪</span>ログアウト
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* P0-2: localStorage 永続化失敗警告 */}
      {!persistEnabled && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center text-sm text-yellow-800">
            <span className="mr-2">⚠️</span>
            チャット履歴の保存に失敗しました。履歴は一時的に保持されますが、ページを閉じると失われます。
          </div>
          <button
            onClick={() => { setPersistEnabled(true); setSaveFailCount(0); }}
            className="text-xs text-yellow-700 underline hover:text-yellow-900"
          >
            再試行
          </button>
        </div>
      )}

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
              pendingRemindNeedResponse={threadId ? (pendingRemindNeedResponseByThreadId[threadId] || null) : null}
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
              pendingRemindNeedResponse={threadId ? (pendingRemindNeedResponseByThreadId[threadId] || null) : null}
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
