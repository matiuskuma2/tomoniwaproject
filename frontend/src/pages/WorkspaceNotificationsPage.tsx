/**
 * Workspace Notifications Settings Page
 * P2-E1: Slack/Chatwork送達設定
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  workspaceNotificationsApi, 
  type WorkspaceNotificationSettings 
} from '../core/api';

export default function WorkspaceNotificationsPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<WorkspaceNotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('');

  // Validation state
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await workspaceNotificationsApi.get();
      setSettings(data);
      setSlackEnabled(data.slack_enabled);
      // webhook URL は保存済みでも返却されない（セキュリティ）
    } catch (err) {
      console.error('[WorkspaceNotifications] Failed to load settings:', err);
      setMessage({ type: 'error', text: '設定の読み込みに失敗しました' });
    } finally {
      setLoading(false);
    }
  };

  const validateWebhookUrl = (url: string): boolean => {
    if (!url) {
      setUrlError(null);
      return true; // 空は許可（OFFにする場合）
    }
    if (!url.startsWith('https://hooks.slack.com/services/')) {
      setUrlError('Slack Incoming Webhook URLは https://hooks.slack.com/services/ で始まる必要があります');
      return false;
    }
    setUrlError(null);
    return true;
  };

  const handleSlackEnabledChange = (enabled: boolean) => {
    setSlackEnabled(enabled);
    setMessage(null);
    if (!enabled) {
      setUrlError(null);
    }
  };

  const handleWebhookUrlChange = (url: string) => {
    setSlackWebhookUrl(url);
    setMessage(null);
    validateWebhookUrl(url);
  };

  const canSave = (): boolean => {
    // OFF → 常に保存可能
    if (!slackEnabled) return true;
    // ON + 設定済み + URL未入力 → 保存可能（既存設定を維持）
    if (settings?.slack_webhook_configured && !slackWebhookUrl) return true;
    // ON + URL入力あり + バリデーションOK → 保存可能
    if (slackWebhookUrl && !urlError) return true;
    // ON + 未設定 + URL未入力 → 保存不可
    return false;
  };

  const handleSave = async () => {
    // 追加バリデーション
    if (slackEnabled && !settings?.slack_webhook_configured && !slackWebhookUrl) {
      setUrlError('Slack通知を有効にするにはWebhook URLを入力してください');
      return;
    }

    if (!validateWebhookUrl(slackWebhookUrl)) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const response = await workspaceNotificationsApi.update({
        slack_enabled: slackEnabled,
        // 空文字の場合は null（URL変更なし）
        slack_webhook_url: slackWebhookUrl || null,
      });

      if (response.success) {
        setSettings(response.settings);
        setSlackWebhookUrl(''); // 保存後はクリア
        setMessage({ type: 'success', text: '✅ 設定を保存しました' });
      } else {
        setMessage({ type: 'error', text: response.message || '保存に失敗しました' });
      }
    } catch (err) {
      console.error('[WorkspaceNotifications] Failed to save:', err);
      setMessage({ 
        type: 'error', 
        text: err instanceof Error ? `❌ ${err.message}` : '❌ 保存に失敗しました' 
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen bg-gray-50">
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
            aria-label="戻る"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-gray-900">ワークスペース通知設定</h1>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-2xl mx-auto p-4">
        {/* Slack Settings Card */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <span className="text-2xl mr-2">💬</span>
              <h2 className="text-base font-semibold text-gray-900">Slack通知</h2>
            </div>
            
            {/* Toggle Switch */}
            <button
              type="button"
              role="switch"
              aria-checked={slackEnabled}
              data-testid="slack-enabled-toggle"
              onClick={() => handleSlackEnabledChange(!slackEnabled)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${
                slackEnabled ? 'bg-emerald-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  slackEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <p className="text-sm text-gray-500 mb-4">
            日程調整の招待送信・追加候補・リマインド時にSlackチャンネルへ通知します。
          </p>

          {/* Status Badge */}
          <div className="flex items-center mb-4">
            <span className="text-sm text-gray-600 mr-2">ステータス:</span>
            {settings?.slack_webhook_configured ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                ✅ 設定済み
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                未設定
              </span>
            )}
          </div>

          {/* Webhook URL Input */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Incoming Webhook URL
              {settings?.slack_webhook_configured && (
                <span className="text-xs text-gray-500 ml-2">（変更する場合のみ入力）</span>
              )}
            </label>
            <input
              type="password"
              data-testid="slack-webhook-input"
              value={slackWebhookUrl}
              onChange={(e) => handleWebhookUrlChange(e.target.value)}
              placeholder={
                settings?.slack_webhook_configured 
                  ? '••••••••（変更する場合は新しいURLを入力）' 
                  : 'https://hooks.slack.com/services/...'
              }
              className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 ${
                urlError 
                  ? 'border-red-300 focus:ring-red-500 focus:border-red-500' 
                  : 'border-gray-300 focus:ring-emerald-500 focus:border-emerald-500'
              }`}
            />
            {urlError && (
              <p className="mt-1 text-sm text-red-600">{urlError}</p>
            )}
          </div>

          {/* Help Link */}
          <div className="mb-4">
            <a
              href="https://api.slack.com/messaging/webhooks"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-emerald-600 hover:text-emerald-700 hover:underline"
            >
              📖 Slack Incoming Webhookの設定方法 →
            </a>
          </div>

          {/* Save Button */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleSave}
              disabled={saving || !canSave()}
              data-testid="slack-save-button"
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

        {/* Chatwork Card (Coming Soon) */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 opacity-60">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              <span className="text-2xl mr-2">📱</span>
              <h2 className="text-base font-semibold text-gray-900">Chatwork通知</h2>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
              Coming Soon
            </span>
          </div>
          <p className="text-sm text-gray-500">
            Chatwork通知は近日対応予定です。
          </p>
        </div>

        {/* Info */}
        <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <h3 className="text-sm font-medium text-blue-800 mb-2">📌 通知が送信されるタイミング</h3>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• 招待送信時（〇〇さんが日程調整を開始）</li>
            <li>• 追加候補追加時（新しい候補日が追加されました）</li>
            <li>• リマインド送信時（リマインドをN名に送信しました）</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
