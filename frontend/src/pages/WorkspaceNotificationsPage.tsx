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
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Slack Form state
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('');

  // Slack Validation state
  const [urlError, setUrlError] = useState<string | null>(null);

  // P2-E2: SMS Form state
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [smsFromNumber, setSmsFromNumber] = useState('');
  const [smsError, setSmsError] = useState<string | null>(null);
  const [smsSaving, setSmsSaving] = useState(false);

  // Setup guide state
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [showChatworkGuide, setShowChatworkGuide] = useState(false);

  // Chatwork Form state
  const [chatworkEnabled, setChatworkEnabled] = useState(false);
  const [chatworkApiToken, setChatworkApiToken] = useState('');
  const [chatworkRoomId, setChatworkRoomId] = useState('');
  const [chatworkError, setChatworkError] = useState<string | null>(null);
  const [chatworkSaving, setChatworkSaving] = useState(false);
  const [chatworkTesting, setChatworkTesting] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await workspaceNotificationsApi.get();
      setSettings(data);
      setSlackEnabled(data.slack_enabled);
      // Chatwork初期値
      setChatworkEnabled(data.chatwork_enabled);
      // P2-E2: SMS初期値
      setSmsEnabled(data.sms_enabled);
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
      return true;
    }
    if (!url.startsWith('https://hooks.slack.com/services/')) {
      setUrlError('URLは https://hooks.slack.com/services/ で始まる必要があります');
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
    // 変更があるかどうかをチェック
    const enabledChanged = slackEnabled !== settings?.slack_enabled;
    const urlEntered = slackWebhookUrl.length > 0;
    
    // 変更がない場合は保存不可
    if (!enabledChanged && !urlEntered) return false;
    
    // ON にする場合、URLが必要（既存設定がない場合）
    if (slackEnabled && !settings?.slack_webhook_configured && !urlEntered) return false;
    
    // URL入力がある場合、バリデーションエラーがないこと
    if (urlEntered && urlError) return false;
    
    return true;
  };

  // Chatwork保存可否
  const canSaveChatwork = (): boolean => {
    if (!settings) return false;

    const enabledChanged = chatworkEnabled !== settings.chatwork_enabled;
    const tokenEntered = chatworkApiToken.trim().length > 0;
    const roomIdEntered = chatworkRoomId.trim().length > 0;

    // 変更なし → 保存不可
    if (!enabledChanged && !tokenEntered && !roomIdEntered) return false;

    // ONにする場合、既に設定済みでなければAPI TokenとRoom IDが必要
    if (chatworkEnabled && !settings.chatwork_configured && (!tokenEntered || !roomIdEntered)) return false;

    return true;
  };

  // Chatwork保存処理
  const handleSaveChatwork = async () => {
    if (!settings) return;

    // ONにするのにトークン/Room IDがない場合
    if (chatworkEnabled && !settings.chatwork_configured && (!chatworkApiToken.trim() || !chatworkRoomId.trim())) {
      setChatworkError('Chatwork通知を有効にするにはAPI TokenとRoom IDを入力してください');
      return;
    }

    setChatworkSaving(true);
    setMessage(null);
    try {
      const res = await workspaceNotificationsApi.updateChatwork({
        enabled: chatworkEnabled,
        api_token: chatworkApiToken.trim() || undefined,
        room_id: chatworkRoomId.trim() || undefined,
      });

      if (res.success) {
        setSettings(prev =>
          prev
            ? {
                ...prev,
                chatwork_enabled: res.chatwork_enabled,
                chatwork_configured: res.chatwork_configured,
              }
            : null
        );
        setChatworkApiToken(''); // 保存後は空に戻す（秘匿）
        setChatworkRoomId('');
        setChatworkError(null);
        setMessage({ type: 'success', text: '✅ Chatwork設定を保存しました' });
      } else {
        setMessage({ type: 'error', text: res.error || 'Chatwork設定の保存に失敗しました' });
      }
    } catch (e) {
      console.error('[WorkspaceNotifications] Chatwork save failed:', e);
      setMessage({
        type: 'error',
        text: e instanceof Error ? `❌ ${e.message}` : '❌ Chatwork設定の保存に失敗しました'
      });
    } finally {
      setChatworkSaving(false);
    }
  };

  // Chatworkテスト送信
  const handleTestChatwork = async () => {
    setChatworkTesting(true);
    setMessage(null);
    try {
      const response = await workspaceNotificationsApi.testChatwork();
      if (response.success) {
        setMessage({ type: 'success', text: '✅ テストメッセージを送信しました。Chatworkを確認してください。' });
      } else {
        setMessage({ type: 'error', text: response.error || 'テスト送信に失敗しました' });
      }
    } catch (err) {
      console.error('[WorkspaceNotifications] Chatwork test failed:', err);
      setMessage({
        type: 'error',
        text: err instanceof Error ? `❌ ${err.message}` : '❌ テスト送信に失敗しました'
      });
    } finally {
      setChatworkTesting(false);
    }
  };

  // P2-E2: SMS E.164 バリデーション
  const validateSmsFrom = (v: string): boolean => {
    if (!v) {
      setSmsError(null);
      return true;
    }
    const ok = /^\+[1-9]\d{9,14}$/.test(v);
    setSmsError(ok ? null : 'E.164形式で入力してください（例: +819012345678）');
    return ok;
  };

  // P2-E2: SMS保存可否（Slackと同じ思想）
  const canSaveSms = (): boolean => {
    if (!settings) return false;

    const enabledChanged = smsEnabled !== settings.sms_enabled;
    const fromEntered = smsFromNumber.trim().length > 0;

    // 変更なし → 保存不可
    if (!enabledChanged && !fromEntered) return false;

    // ONにする場合、既に設定済みでなければ from が必要
    if (smsEnabled && !settings.sms_configured && !fromEntered) return false;

    // 入力があるならバリデーション必須
    if (fromEntered && smsError) return false;

    return true;
  };

  // P2-E2: SMS保存処理
  const handleSaveSms = async () => {
    if (!settings) return;
    
    // ONにするのにfrom番号がない場合
    if (smsEnabled && !settings.sms_configured && !smsFromNumber.trim()) {
      setSmsError('SMS通知を有効にするには送信元番号を入力してください');
      return;
    }

    if (smsFromNumber.trim() && !validateSmsFrom(smsFromNumber.trim())) {
      return;
    }

    setSmsSaving(true);
    setMessage(null);
    try {
      const res = await workspaceNotificationsApi.updateSms({
        enabled: smsEnabled,
        from_number: smsFromNumber.trim() || undefined,
      });

      if (res.success) {
        setSettings(prev =>
          prev
            ? {
                ...prev,
                sms_enabled: res.sms_enabled,
                sms_configured: res.sms_configured,
              }
            : null
        );
        setSmsFromNumber(''); // 保存後は空に戻す（秘匿）
        setMessage({ type: 'success', text: '✅ SMS設定を保存しました' });
      } else {
        setMessage({ type: 'error', text: res.error || 'SMS設定の保存に失敗しました' });
      }
    } catch (e) {
      console.error('[WorkspaceNotifications] SMS save failed:', e);
      setMessage({ 
        type: 'error', 
        text: e instanceof Error ? `❌ ${e.message}` : '❌ SMS設定の保存に失敗しました' 
      });
    } finally {
      setSmsSaving(false);
    }
  };

  const handleSave = async () => {
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
      const response = await workspaceNotificationsApi.updateSlack({
        enabled: slackEnabled,
        webhook_url: slackWebhookUrl || undefined,
      });

      if (response.success) {
        setSettings(prev => prev ? {
          ...prev,
          slack_enabled: response.slack_enabled,
          slack_webhook_configured: response.slack_webhook_configured,
        } : null);
        setSlackWebhookUrl('');
        setMessage({ type: 'success', text: '✅ 設定を保存しました' });
      } else {
        setMessage({ type: 'error', text: response.error || '保存に失敗しました' });
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

  const handleTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const response = await workspaceNotificationsApi.testSlack();
      if (response.success) {
        setMessage({ type: 'success', text: '✅ テストメッセージを送信しました。Slackを確認してください。' });
      } else {
        setMessage({ type: 'error', text: response.error || 'テスト送信に失敗しました' });
      }
    } catch (err) {
      console.error('[WorkspaceNotifications] Test failed:', err);
      setMessage({ 
        type: 'error', 
        text: err instanceof Error ? `❌ ${err.message}` : '❌ テスト送信に失敗しました' 
      });
    } finally {
      setTesting(false);
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
            
            {/* Toggle Switch - 改善版 */}
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={slackEnabled}
                onChange={(e) => handleSlackEnabledChange(e.target.checked)}
                className="sr-only peer"
                data-testid="slack-enabled-toggle"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              <span className="ml-2 text-sm font-medium text-gray-700">
                {slackEnabled ? 'ON' : 'OFF'}
              </span>
            </label>
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
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                ⚠️ 未設定
              </span>
            )}
          </div>

          {/* Setup Guide Toggle */}
          <button
            onClick={() => setShowSetupGuide(!showSetupGuide)}
            className="w-full text-left mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <span className="text-lg mr-2">📖</span>
                <span className="text-sm font-medium text-blue-800">
                  Webhook URLの取得方法（クリックで{showSetupGuide ? '閉じる' : '開く'}）
                </span>
              </div>
              <svg 
                className={`w-5 h-5 text-blue-600 transition-transform ${showSetupGuide ? 'rotate-180' : ''}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          {/* Setup Guide Content */}
          {showSetupGuide && (
            <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">🔧 Slack Webhook URLの取得手順</h3>
              
              <div className="space-y-4 text-sm text-gray-700">
                <div className="flex items-start">
                  <span className="flex-shrink-0 w-6 h-6 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center text-xs font-bold mr-3">1</span>
                  <div>
                    <p className="font-medium">Slack APIページを開く</p>
                    <a 
                      href="https://api.slack.com/apps" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-emerald-600 hover:underline"
                    >
                      https://api.slack.com/apps →
                    </a>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <span className="flex-shrink-0 w-6 h-6 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center text-xs font-bold mr-3">2</span>
                  <div>
                    <p className="font-medium">「Create New App」をクリック</p>
                    <p className="text-gray-500">→ <strong>「From scratch」を選択</strong>（※「From manifest」ではありません）</p>
                    <p className="text-gray-500">→ アプリ名（例：Tomoniwao通知）とワークスペースを選択して「Create App」</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <span className="flex-shrink-0 w-6 h-6 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center text-xs font-bold mr-3">3</span>
                  <div>
                    <p className="font-medium">左メニューから「Incoming Webhooks」をクリック</p>
                    <p className="text-gray-500">→ 右上の「Activate Incoming Webhooks」スイッチを <strong>On（緑色）</strong> に変更</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <span className="flex-shrink-0 w-6 h-6 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center text-xs font-bold mr-3">4</span>
                  <div>
                    <p className="font-medium">「Add New Webhook to Workspace」をクリック</p>
                    <p className="text-gray-500">→ 通知を送信したいチャンネルを選択 → 「許可する（Allow）」</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <span className="flex-shrink-0 w-6 h-6 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center text-xs font-bold mr-3">5</span>
                  <div>
                    <p className="font-medium">Webhook URLをコピー</p>
                    <p className="text-gray-500">ページ下部の「Webhook URLs for Your Workspace」に表示されるURLの「Copy」ボタンをクリック</p>
                    <code className="block mt-1 p-2 bg-gray-100 rounded text-xs break-all">
                      https://hooks.slack.com/services/T.../B.../xxx...
                    </code>
                  </div>
                </div>
              </div>
              
              {/* 重要な注意事項 */}
              <div className="mt-4 space-y-2">
                <div className="p-3 bg-red-50 rounded border border-red-200">
                  <p className="text-xs text-red-800">
                    <strong>🚨 「Please contact an administrator」と表示される場合</strong>
                  </p>
                  <p className="text-xs text-red-700 mt-1">
                    Slackワークスペースの管理者権限が必要です。以下のいずれかで解決できます：
                  </p>
                  <ul className="text-xs text-red-700 mt-1 ml-4 list-disc">
                    <li>ワークスペースの管理者にアプリのインストール許可を依頼</li>
                    <li>自分が管理者のワークスペースを使用する</li>
                    <li>テスト用に新しいワークスペースを作成（<a href="https://slack.com/create" target="_blank" rel="noopener noreferrer" className="underline">slack.com/create</a>）</li>
                  </ul>
                </div>
                
                <div className="p-3 bg-yellow-50 rounded border border-yellow-200">
                  <p className="text-xs text-yellow-800">
                    <strong>⚠️ セキュリティ注意:</strong> Webhook URLは秘密情報です。他の人と共有しないでください。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Webhook URL Input */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Webhook URL
              {settings?.slack_webhook_configured && (
                <span className="text-xs text-gray-500 ml-2">（変更する場合のみ入力）</span>
              )}
            </label>
            <input
              type="text"
              data-testid="slack-webhook-input"
              value={slackWebhookUrl}
              onChange={(e) => handleWebhookUrlChange(e.target.value)}
              placeholder={
                settings?.slack_webhook_configured 
                  ? '設定済み（変更する場合は新しいURLを入力）' 
                  : 'https://hooks.slack.com/services/...'
              }
              className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 text-sm ${
                urlError 
                  ? 'border-red-300 focus:ring-red-500 focus:border-red-500' 
                  : 'border-gray-300 focus:ring-emerald-500 focus:border-emerald-500'
              }`}
            />
            {urlError && (
              <p className="mt-1 text-sm text-red-600">{urlError}</p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <button
              onClick={handleSave}
              disabled={saving || !canSave()}
              data-testid="slack-save-button"
              className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? '保存中...' : '💾 保存'}
            </button>

            {settings?.slack_webhook_configured && (
              <button
                onClick={handleTest}
                disabled={testing || saving}
                data-testid="slack-test-button"
                className="px-5 py-2.5 bg-white text-gray-700 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {testing ? 'テスト中...' : '🔔 テスト送信'}
              </button>
            )}
          </div>

          {/* Message */}
          {message && (
            <div className={`p-3 rounded-lg text-sm ${
              message.type === 'success' 
                ? 'bg-green-50 text-green-800 border border-green-200' 
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {message.text}
            </div>
          )}
        </div>

        {/* SMS Settings Card (P2-E2) */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <span className="text-2xl mr-2">📲</span>
              <h2 className="text-base font-semibold text-gray-900">SMS通知</h2>
            </div>
            {settings?.sms_configured ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                ✅ 設定済み
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                未設定
              </span>
            )}
          </div>

          <p className="text-sm text-gray-500 mb-4">
            招待送信時に、contactsに登録された電話番号宛へSMS通知を送信します（Twilio必須）。
          </p>

          {/* ON/OFF Toggle */}
          <div className="flex items-center justify-between mb-4 p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-900">SMS通知を有効にする</p>
              <p className="text-xs text-gray-500">
                招待送信時にSMSを送ります（電話番号がある招待者のみ）
              </p>
            </div>
            <button
              onClick={() => {
                setSmsEnabled(v => !v);
                setMessage(null);
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                smsEnabled ? 'bg-emerald-600' : 'bg-gray-200'
              }`}
              data-testid="sms-enabled-toggle"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  smsEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* From Number Input */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              送信元電話番号（Twilio番号 / E.164形式）
              {settings?.sms_configured && (
                <span className="text-xs text-gray-500 ml-2">（変更する場合のみ入力）</span>
              )}
            </label>
            <input
              type="text"
              placeholder={settings?.sms_configured ? '設定済み（変更する場合は新しい番号を入力）' : '+819012345678'}
              value={smsFromNumber}
              onChange={(e) => {
                const v = e.target.value.trim();
                setSmsFromNumber(v);
                setMessage(null);
                validateSmsFrom(v);
              }}
              data-testid="sms-from-input"
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 ${
                smsError 
                  ? 'border-red-300 focus:ring-red-500' 
                  : 'border-gray-300 focus:ring-emerald-500'
              }`}
            />
            {smsError && <p className="text-xs text-red-600 mt-1">{smsError}</p>}
            <p className="text-xs text-gray-500 mt-1">
              ※ セキュリティ上、保存済み番号は表示しません（必要なら再入力して更新）
            </p>
          </div>

          {/* Save Button */}
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={handleSaveSms}
              disabled={smsSaving || !canSaveSms()}
              data-testid="sms-save-button"
              className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {smsSaving ? '保存中...' : '💾 保存'}
            </button>
          </div>

          {/* Setup Guide */}
          <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
            <p className="text-sm text-amber-800 font-medium">📋 SMS送信に必要なもの:</p>
            <ul className="text-sm text-amber-700 mt-2 ml-4 list-disc">
              <li>Twilioアカウント（<a href="https://www.twilio.com" target="_blank" rel="noopener noreferrer" className="text-amber-900 underline">twilio.com</a>）</li>
              <li>Account SID と Auth Token（サーバー管理者が設定済み）</li>
              <li>送信元電話番号（上で入力）</li>
              <li>招待者の電話番号（チャットで <code className="bg-amber-100 px-1">email +819012345678</code> 形式で入力）</li>
            </ul>
          </div>
        </div>

        {/* Chatwork Settings Card */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <span className="text-2xl mr-2">💼</span>
              <h2 className="text-base font-semibold text-gray-900">Chatwork通知</h2>
            </div>
            
            {/* Toggle Switch */}
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={chatworkEnabled}
                onChange={(e) => {
                  setChatworkEnabled(e.target.checked);
                  setMessage(null);
                  setChatworkError(null);
                }}
                className="sr-only peer"
                data-testid="chatwork-enabled-toggle"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              <span className="ml-2 text-sm font-medium text-gray-700">
                {chatworkEnabled ? 'ON' : 'OFF'}
              </span>
            </label>
          </div>

          <p className="text-sm text-gray-500 mb-4">
            日程調整の招待送信・追加候補・リマインド時にChatworkルームへ通知します。
          </p>

          {/* Status Badge */}
          <div className="flex items-center mb-4">
            <span className="text-sm text-gray-600 mr-2">ステータス:</span>
            {settings?.chatwork_configured ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                ✅ 設定済み
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                ⚠️ 未設定
              </span>
            )}
          </div>

          {/* Setup Guide Toggle */}
          <button
            onClick={() => setShowChatworkGuide(!showChatworkGuide)}
            className="w-full text-left mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <span className="text-lg mr-2">📖</span>
                <span className="text-sm font-medium text-blue-800">
                  API TokenとRoom IDの取得方法（クリックで{showChatworkGuide ? '閉じる' : '開く'}）
                </span>
              </div>
              <svg 
                className={`w-5 h-5 text-blue-600 transition-transform ${showChatworkGuide ? 'rotate-180' : ''}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          {/* Setup Guide Content */}
          {showChatworkGuide && (
            <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">🔧 Chatwork API設定の取得手順</h3>
              
              <div className="space-y-4 text-sm text-gray-700">
                <div className="flex items-start">
                  <span className="flex-shrink-0 w-6 h-6 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center text-xs font-bold mr-3">1</span>
                  <div>
                    <p className="font-medium">API Tokenを取得</p>
                    <p className="text-gray-500">Chatwork画面右上の「利用者名」→「サービス連携」→ 左メニュー「APIトークン」</p>
                    <a 
                      href="https://www.chatwork.com/service/packages/chatwork/subpackages/api/token.php" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-emerald-600 hover:underline"
                    >
                      直接リンク →
                    </a>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <span className="flex-shrink-0 w-6 h-6 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center text-xs font-bold mr-3">2</span>
                  <div>
                    <p className="font-medium">Room IDを取得</p>
                    <p className="text-gray-500">通知を送信したいチャットルームをブラウザで開き、URLの末尾の数字を確認</p>
                    <code className="block mt-1 p-2 bg-gray-100 rounded text-xs break-all">
                      https://www.chatwork.com/#!rid<strong>123456789</strong> ← この数字がRoom ID
                    </code>
                  </div>
                </div>
              </div>
              
              {/* 重要な注意事項 */}
              <div className="mt-4 p-3 bg-yellow-50 rounded border border-yellow-200">
                <p className="text-xs text-yellow-800">
                  <strong>⚠️ セキュリティ注意:</strong> API Tokenは秘密情報です。他の人と共有しないでください。
                </p>
              </div>
            </div>
          )}

          {/* API Token Input */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              API Token
              {settings?.chatwork_configured && (
                <span className="text-xs text-gray-500 ml-2">（変更する場合のみ入力）</span>
              )}
            </label>
            <input
              type="password"
              data-testid="chatwork-token-input"
              value={chatworkApiToken}
              onChange={(e) => {
                setChatworkApiToken(e.target.value);
                setMessage(null);
                setChatworkError(null);
              }}
              placeholder={
                settings?.chatwork_configured 
                  ? '設定済み（変更する場合は新しいTokenを入力）' 
                  : 'API Tokenを入力'
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
            />
          </div>

          {/* Room ID Input */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Room ID
              {settings?.chatwork_configured && (
                <span className="text-xs text-gray-500 ml-2">（変更する場合のみ入力）</span>
              )}
            </label>
            <input
              type="text"
              data-testid="chatwork-roomid-input"
              value={chatworkRoomId}
              onChange={(e) => {
                setChatworkRoomId(e.target.value);
                setMessage(null);
                setChatworkError(null);
              }}
              placeholder={
                settings?.chatwork_configured 
                  ? '設定済み（変更する場合は新しいRoom IDを入力）' 
                  : '例: 123456789'
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
            />
            {chatworkError && (
              <p className="mt-1 text-sm text-red-600">{chatworkError}</p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <button
              onClick={handleSaveChatwork}
              disabled={chatworkSaving || !canSaveChatwork()}
              data-testid="chatwork-save-button"
              className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {chatworkSaving ? '保存中...' : '💾 保存'}
            </button>

            {settings?.chatwork_configured && (
              <button
                onClick={handleTestChatwork}
                disabled={chatworkTesting || chatworkSaving}
                data-testid="chatwork-test-button"
                className="px-5 py-2.5 bg-white text-gray-700 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {chatworkTesting ? 'テスト中...' : '🔔 テスト送信'}
              </button>
            )}
          </div>
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
