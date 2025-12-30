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
import type { ThreadStatus_API } from '../../core/models';

type MobileTab = 'threads' | 'chat' | 'cards';

export function ChatLayout() {
  const navigate = useNavigate();
  const { threadId } = useParams<{ threadId: string }>();
  const [status, setStatus] = useState<ThreadStatus_API | null>(null);
  const [loading, setLoading] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('threads');
  
  // NEW: Per-thread message history
  const [messagesByThreadId, setMessagesByThreadId] = useState<Record<string, ChatMessage[]>>({});

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
    setMessagesByThreadId((prev) => {
      // If thread already has messages, don't overwrite
      if (prev[tid] && prev[tid].length > 0) return prev;
      return { ...prev, [tid]: seed };
    });
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
            />
          </div>

          {/* Right: CardsPane (~400px) */}
          <div className="w-96 flex-shrink-0">
            <CardsPane status={status} loading={loading} />
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
            />
          )}
          {mobileTab === 'cards' && <CardsPane status={status} loading={loading} />}
        </div>
      </div>
    </div>
  );
}
