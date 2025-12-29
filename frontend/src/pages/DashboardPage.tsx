/**
 * Dashboard Page
 * Shows list of threads (scheduling sessions)
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { threadsApi } from '../core/api';
import { clearAuth } from '../core/auth';
import type { Thread } from '../core/models';

export function DashboardPage() {
  const navigate = useNavigate();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadThreads();
  }, []);

  const loadThreads = async () => {
    try {
      setLoading(true);
      const response = await threadsApi.list();
      setThreads(response.threads || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load threads');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      // Call backend logout endpoint to clear session
      await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'include', // Include cookies
      });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Clear local token regardless of backend response
      clearAuth();
      navigate('/login');
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
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="md:flex md:items-center md:justify-between mb-8">
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:text-3xl sm:truncate">
            スレッド一覧
          </h2>
        </div>
        <div className="mt-4 flex md:mt-0 md:ml-4 gap-3">
          <button
            onClick={handleLogout}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            ログアウト
          </button>
          <Link
            to="/threads/new"
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            新規作成
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Phase Next-1: Chat UI Beta Link */}
      <div className="mb-6 p-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg shadow-sm">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-semibold text-blue-900">
              🚀 新しいチャットUIを試す（Phase Next-1 Beta）
            </h3>
            <p className="mt-1 text-sm text-blue-800">
              音声操作に向けた新しいチャット画面が利用できます。スレッドを選択してカード形式で確認できます。
            </p>
            <div className="mt-4">
              <Link
                to="/chat"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
              >
                <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Chat（β）を開く
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        {threads.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-sm">スレッドがありません</p>
            <Link
              to="/threads/new"
              className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-blue-600 bg-blue-100 hover:bg-blue-200"
            >
              最初のスレッドを作成
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {threads.map((thread) => (
              <li key={thread.id}>
                <Link
                  to={`/threads/${thread.id}`}
                  className="block hover:bg-gray-50 transition duration-150 ease-in-out"
                >
                  <div className="px-4 py-4 sm:px-6">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-blue-600 truncate">
                          {thread.title}
                        </p>
                        {thread.description && (
                          <p className="mt-1 text-sm text-gray-500 truncate">
                            {thread.description}
                          </p>
                        )}
                      </div>
                      <div className="ml-4 flex-shrink-0">
                        <span
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadge(
                            thread.status
                          )}`}
                        >
                          {thread.status}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 sm:flex sm:justify-between">
                      <div className="sm:flex">
                        <p className="flex items-center text-sm text-gray-500">
                          <svg
                            className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                          </svg>
                          {new Date(thread.created_at).toLocaleDateString('ja-JP')}
                        </p>
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
