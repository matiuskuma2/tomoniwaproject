/**
 * Lists Page
 * Manage lists (segments) for bulk invitation
 * 
 * P1-3(C): uses listsCache for TTL + inflight sharing
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listsApi, threadsApi } from '../core/api';
import { getLists, subscribeLists, refreshLists } from '../core/cache';
import type { List, ListMember } from '../core/models';

export function ListsPage() {
  const navigate = useNavigate();
  const [lists, setLists] = useState<List[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [members, setMembers] = useState<ListMember[]>([]);

  // P1-3(C): Load lists via cache
  const loadLists = useCallback(async () => {
    try {
      setLoading(true);
      const items = await getLists();
      setLists(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lists');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLists();
    
    // P1-3(C): Subscribe to cache updates
    const unsubscribe = subscribeLists((updatedLists) => {
      if (updatedLists) {
        setLists(updatedLists);
      }
    });
    
    return unsubscribe;
  }, [loadLists]);

  const loadMembers = async (listId: string) => {
    try {
      const response = await listsApi.getMembers(listId);
      setMembers(response.items || []);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to load members');
    }
  };

  const handleCreateList = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    try {
      await listsApi.create({
        name: formData.get('name') as string,
        description: formData.get('description') as string || undefined,
      });
      
      setShowCreateModal(false);
      // P1-3(C): Force refresh cache after create
      await refreshLists();
      e.currentTarget.reset();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create list');
    }
  };

  const handleBulkInvite = async (listId: string) => {
    const list = lists.find((l) => l.id === listId);
    if (!list) return;
    
    if (!confirm(`「${list.name}」のメンバーに一括招待を送信しますか？`)) return;
    
    try {
      const result = await threadsApi.create({
        title: `${list.name} - 日程調整`,
        description: `${list.name}のメンバーへの一括招待`,
        target_list_id: listId,
      });
      
      alert(
        `招待を送信しました！\n\n招待数: ${result.candidates?.length || 0}\nスキップ: ${
          result.skipped_count || 0
        }`
      );
      
      // Navigate to thread detail
      navigate(`/threads/${result.thread.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to send bulk invite');
    }
  };

  const handleViewMembers = (listId: string) => {
    setSelectedList(listId);
    loadMembers(listId);
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
      {/* P0-NAV: People Hub 誘導バナー */}
      <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <span className="text-2xl mr-3">👥</span>
            <div>
              <p className="text-sm font-medium text-blue-800">
                People Hub に統合されました
              </p>
              <p className="text-xs text-blue-600">
                連絡先・リスト・つながりを1画面で管理できます
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/people')}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
          >
            People Hub へ →
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="md:flex md:items-center md:justify-between mb-8">
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:text-3xl sm:truncate">
            リスト管理（旧画面）
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            送信セグメント（一括招待用）
          </p>
        </div>
        <div className="mt-4 flex md:mt-0 md:ml-4">
          <button
            onClick={() => setShowCreateModal(true)}
            className="ml-3 inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            新規作成
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Lists Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {lists.map((list) => (
          <div
            key={list.id}
            className="bg-white shadow rounded-lg p-6 hover:shadow-md transition"
          >
            <h3 className="text-lg font-medium text-gray-900 mb-2">{list.name}</h3>
            {list.description && (
              <p className="text-sm text-gray-500 mb-4">{list.description}</p>
            )}
            
            <div className="flex gap-2">
              <button
                onClick={() => handleViewMembers(list.id)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                メンバー確認
              </button>
              <button
                onClick={() => handleBulkInvite(list.id)}
                className="flex-1 px-3 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
              >
                一括招待
              </button>
            </div>
          </div>
        ))}

        {lists.length === 0 && (
          <div className="col-span-full text-center py-12 bg-white rounded-lg">
            <p className="text-gray-500 text-sm">リストがありません</p>
          </div>
        )}
      </div>

      {/* Create List Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">新規リスト作成</h3>
            <form onSubmit={handleCreateList}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    リスト名 *
                  </label>
                  <input
                    type="text"
                    name="name"
                    required
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    説明
                  </label>
                  <textarea
                    name="description"
                    rows={3}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
                >
                  作成
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Members Modal */}
      {selectedList && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">メンバー一覧</h3>
              <button
                onClick={() => setSelectedList(null)}
                className="text-gray-400 hover:text-gray-500"
              >
                ✕
              </button>
            </div>

            {members.length === 0 ? (
              <p className="text-center text-gray-500 py-8">メンバーがいません</p>
            ) : (
              <ul className="divide-y divide-gray-200">
                {members.map((member) => (
                  <li key={member.id} className="py-3">
                    <div className="flex justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {member.contact_display_name}
                        </p>
                        {member.contact_email && (
                          <p className="text-sm text-gray-500">{member.contact_email}</p>
                        )}
                      </div>
                      <span className="text-sm text-gray-500">
                        {member.contact_relationship_type || member.contact_kind}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
