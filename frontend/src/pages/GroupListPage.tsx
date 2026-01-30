/**
 * Group List Page (1対N スレッド一覧)
 * 
 * @see docs/plans/G1-PLAN.md
 */

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { oneToManyApi, type OneToManyThread } from '../core/api/oneToMany';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: '下書き', color: 'bg-gray-100 text-gray-800' },
  sent: { label: '送信済み', color: 'bg-blue-100 text-blue-800' },
  confirmed: { label: '確定', color: 'bg-green-100 text-green-800' },
  cancelled: { label: 'キャンセル', color: 'bg-red-100 text-red-800' },
};

const MODE_LABELS: Record<string, string> = {
  fixed: '固定日時',
  candidates: '候補から選択',
  open_slots: '申込カレンダー',
  range_auto: '自動候補生成',
};

export function GroupListPage() {
  const [threads, setThreads] = useState<OneToManyThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');

  const loadThreads = useCallback(async () => {
    try {
      setLoading(true);
      const response = await oneToManyApi.list({
        status: filter || undefined,
        limit: 50,
      });
      setThreads(response.threads);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load threads');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="md:flex md:items-center md:justify-between mb-8">
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:text-3xl sm:truncate">
            グループ予定調整
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            1対N（複数人への予定調整）
          </p>
        </div>
        <div className="mt-4 flex gap-3 md:mt-0 md:ml-4">
          <Link
            to="/chat"
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            ← チャットへ
          </Link>
          <Link
            to="/group/new"
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            新規作成
          </Link>
        </div>
      </div>

      {/* Filter */}
      <div className="mb-6">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">すべて</option>
          <option value="draft">下書き</option>
          <option value="sent">送信済み</option>
          <option value="confirmed">確定</option>
          <option value="cancelled">キャンセル</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Threads List */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        {threads.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-sm mb-4">グループ予定調整がありません</p>
            <Link
              to="/group/new"
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              新規作成
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {threads.map((thread) => {
              const status = STATUS_LABELS[thread.status] || STATUS_LABELS.draft;
              return (
                <li key={thread.id}>
                  <Link
                    to={`/group/${thread.id}`}
                    className="block hover:bg-gray-50"
                  >
                    <div className="px-4 py-4 sm:px-6">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-blue-600 truncate">
                            {thread.title}
                          </p>
                          <p className="mt-1 text-xs text-gray-500">
                            {thread.mode && MODE_LABELS[thread.mode]}
                            {' • '}
                            {new Date(thread.created_at).toLocaleDateString('ja-JP')}
                          </p>
                        </div>
                        <div className="ml-4 flex-shrink-0">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}
                          >
                            {status.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
