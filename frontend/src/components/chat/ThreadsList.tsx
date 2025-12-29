/**
 * ThreadsList
 * Left pane: displays threads list
 * Uses GET /api/threads
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { threadsApi } from '../../core/api';
import type { Thread } from '../../core/models';

export function ThreadsList() {
  const navigate = useNavigate();
  const { threadId } = useParams<{ threadId: string }>();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadThreads();
  }, []);

  const loadThreads = async () => {
    try {
      setLoading(true);
      const response = await threadsApi.list();
      setThreads(response.threads || []);
    } catch (error) {
      console.error('Failed to load threads:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      draft: 'bg-gray-100 text-gray-800',
      active: 'bg-blue-100 text-blue-800',
      confirmed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    return styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800';
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gray-50 border-r border-gray-200 overflow-y-auto">
      <div className="p-4 border-b border-gray-200 bg-white">
        <h2 className="text-lg font-semibold text-gray-900">スレッド一覧</h2>
      </div>

      <div className="divide-y divide-gray-200">
        {threads.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            スレッドがありません
          </div>
        ) : (
          threads.map((thread) => (
            <div
              key={thread.id}
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
    </div>
  );
}
