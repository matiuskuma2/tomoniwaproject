/**
 * ThreadsList
 * Left pane: displays threads list
 * Uses GET /api/threads
 *
 * PR-UX-7: early-return spinner 全廃 — skeleton 常設型
 *   ペインは常に箱(コンテナ)を描画し、中身だけ list skeleton に。
 *   白画面 / 全画面スピナーが発生しない設計。
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getThreadsList, subscribeThreadsList } from '../../core/cache';
import type { Thread } from '../../core/models';

/* ─── Skeleton: 初回ロード中に表示するリスト風プレースホルダー ─── */
function ThreadsListSkeleton() {
  return (
    <div className="divide-y divide-gray-200">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="p-4 animate-pulse">
          {/* title placeholder */}
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-3" />
          {/* badge + date placeholder */}
          <div className="flex items-center justify-between">
            <div className="h-5 bg-gray-200 rounded-full w-16" />
            <div className="h-3 bg-gray-200 rounded w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ThreadsList() {
  const navigate = useNavigate();
  const { threadId } = useParams<{ threadId: string }>();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  const loadThreads = useCallback(async () => {
    try {
      setLoading(true);
      // P1-1: キャッシュ経由で取得（TTL 30秒 + inflight共有）
      const threads = await getThreadsList();
      setThreads(threads || []);
    } catch (error) {
      console.error('Failed to load threads:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadThreads();
    
    // P1-1: キャッシュ更新をsubscribe（refreshAfterWrite後の自動更新）
    const unsubscribe = subscribeThreadsList((updatedThreads) => {
      setThreads(updatedThreads || []);
    });
    
    return unsubscribe;
  }, [loadThreads]);

  const getStatusBadge = (status: string) => {
    const styles = {
      draft: 'bg-gray-100 text-gray-800',
      active: 'bg-blue-100 text-blue-800',
      confirmed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    return styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800';
  };

  /* ─── PR-UX-7: 常にコンテナを描画。中身だけ切り替え ─── */
  return (
    <div data-testid="threads-list" className="h-full bg-gray-50 border-r border-gray-200 overflow-y-auto">
      <div className="p-4 border-b border-gray-200 bg-white">
        <h2 className="text-lg font-semibold text-gray-900">スレッド一覧</h2>
      </div>

      {/* ロード中: skeleton、ロード後: 実データ */}
      {loading && threads.length === 0 ? (
        <ThreadsListSkeleton />
      ) : (
        <div className="divide-y divide-gray-200">
          {threads.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              スレッドがありません
            </div>
          ) : (
            threads.map((thread) => (
              <div
                key={thread.id}
                data-testid="thread-item"
                data-thread-id={thread.id}
                onClick={() => navigate(`/chat/${thread.id}`)}
                className={`p-4 cursor-pointer hover:bg-gray-100 transition-colors ${
                  threadId === thread.id ? 'bg-blue-50 border-l-4 border-blue-600' : ''
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-900 line-clamp-2 flex-1">
                    {thread.title}
                  </h3>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(thread.status)}`}>
                    {thread.status}
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(thread.updated_at).toLocaleDateString('ja-JP')}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
