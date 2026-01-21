/**
 * Settings Page
 * P3-TZ1: ユーザー設定（タイムゾーン等）
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usersMeApi, type UserProfile } from '../core/api';
import { getMe, setMe } from '../core/cache';
import { SUPPORTED_TIMEZONES, getBrowserTimeZone } from '../utils/datetime';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [timezone, setTimezone] = useState('Asia/Tokyo');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const loadUser = async () => {
      try {
        // P1-3: キャッシュ経由で取得（TTL 60秒、inflight共有）
        const cachedUser = await getMe();
        setUser(cachedUser);
        setTimezone(cachedUser.timezone || getBrowserTimeZone());
      } catch (err) {
        console.error('[Settings] Failed to load user:', err);
        setTimezone(getBrowserTimeZone());
      } finally {
        setLoading(false);
      }
    };
    loadUser();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await usersMeApi.updateTimezone(timezone);
      if (response.success && response.user) {
        setUser(response.user);
        // P1-3: キャッシュも更新（他コンポーネントで即時反映）
        setMe(response.user);
        setMessage({ type: 'success', text: '✅ 設定を保存しました' });
      } else {
        setMessage({ type: 'error', text: '❌ 保存に失敗しました' });
      }
    } catch (err) {
      console.error('[Settings] Failed to save:', err);
      setMessage({ type: 'error', text: '❌ 保存に失敗しました' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center">
          <button
            onClick={() => navigate('/chat')}
            className="mr-4 text-gray-500 hover:text-gray-700"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-gray-900">設定</h1>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-2xl mx-auto p-4">
        {/* User Info Card */}
        {user && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
            <div className="flex items-center">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.display_name || user.email}
                  className="w-12 h-12 rounded-full mr-4"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mr-4">
                  <span className="text-emerald-600 font-semibold text-lg">
                    {(user.display_name || user.email)[0].toUpperCase()}
                  </span>
                </div>
              )}
              <div>
                <p className="font-medium text-gray-900">{user.display_name || 'ユーザー'}</p>
                <p className="text-sm text-gray-500">{user.email}</p>
              </div>
            </div>
          </div>
        )}

        {/* Timezone Settings Card */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="text-base font-semibold text-gray-900 mb-4">
            🌍 タイムゾーン設定
          </h2>

          <p className="text-sm text-gray-500 mb-4">
            日程調整の候補日やメール通知の時刻表示に使用されます。
          </p>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              タイムゾーン
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            >
              {SUPPORTED_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label} ({tz.offset})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? '保存中...' : '保存'}
            </button>

            {message && (
              <p className={`text-sm ${message.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
                {message.text}
              </p>
            )}
          </div>
        </div>

        {/* Workspace Settings Link */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mt-4">
          <h2 className="text-base font-semibold text-gray-900 mb-2">
            🏢 ワークスペース設定
          </h2>
          <p className="text-sm text-gray-500 mb-3">
            チーム全体の通知設定を管理できます。
          </p>
          <button
            onClick={() => navigate('/settings/workspace-notifications')}
            className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors flex items-center justify-between"
          >
            <span>💬 Slack/Chatwork通知設定</span>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Info */}
        <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <h3 className="text-sm font-medium text-blue-800 mb-2">📌 ヒント</h3>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• 日程調整の候補日は選択したタイムゾーンで表示されます</li>
            <li>• メール通知の時刻もこの設定に基づいて送信されます</li>
            <li>• 外部ユーザーには、スレッド作成者のタイムゾーンで表示されます</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
