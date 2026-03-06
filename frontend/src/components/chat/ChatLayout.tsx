/**
 * ChatLayout
 * 3-column layout: Left (ThreadsList) + Center (ChatPane) + Right (CardsPane)
 * Desktop: 3 columns side-by-side
 * Mobile: Tabs for Threads/Chat/Cards
 * 
 * P1-B: useReducer で状態管理を一元化（運用インシデント対策）
 * PERF-S1: Status取得のキャッシュ（1万人同時接続対策）
 */

import { useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { clearAuth } from '../../core/auth';
import { useThreadStatus } from '../../core/cache';
import { ThreadsList } from './ThreadsList';
import { ChatPane } from './ChatPane';
import { CardsPane } from './CardsPane';
import { NotificationBell } from './NotificationBell';
import { useChatReducer } from './useChatReducer';
import { useViewerTimezone } from '../../core/hooks/useViewerTimezone';

export function ChatLayout() {
  const navigate = useNavigate();
  const { threadId } = useParams<{ threadId: string }>();
  
  // P1-B: 全ての状態管理を useReducer に移行
  // NOTE: status/loading はキャッシュが単一ソース（二重管理防止）
  // P0-1: pendingForThread で正規化された pending にアクセス
  const {
    state,
    appendMessage,
    seedIfEmpty,
    setMobileTab,
    setSettingsOpen,
    setMode,
    handleExecutionResult,
    pendingForThread,
  } = useChatReducer(threadId, navigate);

  // PERF-S1: Status取得のキャッシュ（TTL 10秒・inflight共有）
  // キャッシュが単一ソース（reducer には status を持たせない）
  const { 
    status, 
    initialLoading,
    refreshing,
    // PR-UX-4: refresh (refreshThreadStatus) は不要
    // status 更新は executor 内 refreshAfterWrite → threadStatusCache → subscribe で自動反映
  } = useThreadStatus(threadId);

  // P1-3: Viewer timezone from users/me (fallback to browser TZ)
  const viewerTz = useViewerTimezone();

  // Destructure state for easy access
  // P0-1: pending 系は pendingForThread / globalPendingAction に正規化
  const {
    mobileTab,
    isSettingsOpen,
    messagesByThreadId,
    calendarData,
    globalPendingAction,
    additionalProposeCountByThreadId,
    remindCountByThreadId,
    persistEnabled,
    selectedMode,
  } = state;

  // Auto-switch to chat on mobile when thread selected
  useEffect(() => {
    if (threadId) {
      setMobileTab('chat');
    }
  }, [threadId, setMobileTab]);

  // PR-UX-4: handleThreadUpdate 削除
  // status 更新は executor 内 refreshAfterWrite → threadStatusCache → subscribe 経由で自動反映
  // ChatPane からの二重 refresh は不要（ネットワーク負荷 + 不必要な re-render の原因）

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
  // FIX: threadId=null の場合は 'temp' キーからメッセージを取得
  // (ChatPane は threadId || 'temp' でメッセージを保存するため)
  const currentMessages = messagesByThreadId[threadId || 'temp'] || [];

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
          
          {/* Settings Dropdown - P0-1: タップ対応 */}
          <div className="relative">
            <button
              onClick={() => setSettingsOpen(!isSettingsOpen)}
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
                  onClick={() => setSettingsOpen(false)}
                  aria-hidden="true"
                />
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-50">
                  <div className="py-1">
                    <button
                      onClick={() => { navigate('/settings'); setSettingsOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <span className="mr-2">🌐</span>タイムゾーン設定
                    </button>
                    <button
                      onClick={() => { navigate('/settings/workspace-notifications'); setSettingsOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <span className="mr-2">💬</span>Slack/Chatwork通知
                    </button>
                    <button
                      onClick={() => { navigate('/settings/billing'); setSettingsOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <span className="mr-2">💳</span>課金設定
                    </button>
                    <button
                      onClick={() => { navigate('/people'); setSettingsOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <span className="mr-2">👥</span>People Hub
                    </button>
                    <div className="border-t border-gray-100 my-1"></div>
                    <button
                      onClick={() => { handleLogout(); setSettingsOpen(false); }}
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
              initialLoading={initialLoading}
              refreshing={refreshing}
              messages={currentMessages}
              onAppend={appendMessage}
              onSeedIfEmpty={seedIfEmpty}
              onExecutionResult={handleExecutionResult}
              pendingForThread={pendingForThread}
              globalPendingAction={globalPendingAction}
              additionalProposeCount={threadId ? (additionalProposeCountByThreadId[threadId] || 0) : 0}
              remindCount={threadId ? (remindCountByThreadId[threadId] || 0) : 0}
              selectedMode={selectedMode}
              onModeChange={setMode}
            />
          </div>

          {/* Right: CardsPane (~400px) */}
          <div className="w-96 flex-shrink-0">
            <CardsPane 
              status={status} 
              initialLoading={initialLoading}
              refreshing={refreshing}
              calendarData={calendarData}
              viewerTz={viewerTz}
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
              initialLoading={initialLoading}
              refreshing={refreshing}
              messages={currentMessages}
              onAppend={appendMessage}
              onSeedIfEmpty={seedIfEmpty}
              onExecutionResult={handleExecutionResult}
              pendingForThread={pendingForThread}
              globalPendingAction={globalPendingAction}
              additionalProposeCount={threadId ? (additionalProposeCountByThreadId[threadId] || 0) : 0}
              remindCount={threadId ? (remindCountByThreadId[threadId] || 0) : 0}
              selectedMode={selectedMode}
              onModeChange={setMode}
            />
          )}
          {mobileTab === 'cards' && (
            <CardsPane 
              status={status} 
              initialLoading={initialLoading}
              refreshing={refreshing}
              calendarData={calendarData}
              viewerTz={viewerTz}
            />
          )}
        </div>
      </div>
    </div>
  );
}
