/**
 * Thread Create Page
 * Create new thread with title and description
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { threadsApi } from '../core/api';

export function ThreadCreatePage() {
  const navigate = useNavigate();
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim()) {
      setError('タイトルを入力してください');
      return;
    }
    
    try {
      setCreating(true);
      setError(null);
      
      // SSOT: Always create empty thread - slots and invites added via separate actions
      const result = await threadsApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        seed_mode: 'empty',
      });
      
      // Navigate to the created thread
      navigate(`/threads/${result.thread.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Thread作成に失敗しました');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate('/chat')}
          className="text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          ← チャットに戻る
        </button>
        <h2 className="text-2xl font-bold text-gray-900">新規スレッド作成</h2>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6">
        <div className="space-y-6">
          {/* Title */}
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700">
              タイトル <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-4 py-2 border"
              placeholder="例：来週の打ち合わせ"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700">
              説明（任意）
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-4 py-2 border"
              placeholder="例：プロジェクト進捗確認"
            />
          </div>

          {/* Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
            <p className="text-sm text-blue-700">
              💡 スレッドを作成後、Thread詳細ページで招待リンクを確認できます
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-4">
            <button
              type="button"
              onClick={() => navigate('/chat')}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? '作成中...' : '作成'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
