/**
 * External Invite Routes (Ticket 10) - v2 固定1枠最適化版
 * 
 * PR-C: 1対1AI秘書の外部招待体験
 * - 固定1枠モード：「この日時でOKですか？」に最適化
 * - 複数候補モード：従来の候補選択UI
 * - 承諾後サンキューページ：Googleカレンダー追加 + 成長導線
 */

import { Hono } from 'hono';
import { ThreadsRepository } from '../repositories/threadsRepository';
import { InboxRepository } from '../repositories/inboxRepository';
import type { Env } from '../../../../packages/shared/src/types/env';
import { createLogger } from '../utils/logger';

const app = new Hono<{ Bindings: Env }>();

/**
 * 日本語日時フォーマット
 */
function formatDateTimeJP(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = weekdays[date.getDay()];
  
  return `${year}年${month}月${day}日（${weekday}）${hours}:${minutes}`;
}

/**
 * 終了時刻のみフォーマット
 */
function formatTimeJP(dateStr: string): string {
  const date = new Date(dateStr);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Googleカレンダー追加用URL生成
 */
function generateGoogleCalendarUrl(params: {
  title: string;
  startAt: string;
  endAt: string;
  description?: string;
}): string {
  const start = new Date(params.startAt).toISOString().replace(/[-:]/g, '').replace('.000', '');
  const end = new Date(params.endAt).toISOString().replace(/[-:]/g, '').replace('.000', '');
  
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', params.title);
  url.searchParams.set('dates', `${start}/${end}`);
  if (params.description) {
    url.searchParams.set('details', params.description);
  }
  
  return url.toString();
}

/**
 * 共通HTMLヘッダー
 */
function getHtmlHead(title: string): string {
  return `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <title>${title}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
      <style>
        body {
          font-family: 'Noto Sans JP', sans-serif;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        .fade-in {
          animation: fadeIn 0.4s ease-out;
        }
        .slot-card {
          transition: all 0.2s ease;
        }
        .slot-card:hover {
          border-color: #3B82F6;
          background-color: #EFF6FF;
        }
        .slot-card.selected {
          border-color: #3B82F6;
          background-color: #DBEAFE;
          border-width: 3px;
        }
        .spinner {
          border: 3px solid rgba(255,255,255,.3);
          border-radius: 50%;
          border-top-color: #fff;
          width: 20px;
          height: 20px;
          animation: spin 0.6s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .btn-primary {
          background: linear-gradient(135deg, #10B981 0%, #059669 100%);
          transition: all 0.2s ease;
        }
        .btn-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
        }
        .btn-secondary {
          background: #F3F4F6;
          transition: all 0.2s ease;
        }
        .btn-secondary:hover {
          background: #E5E7EB;
        }
        .calendar-btn {
          background: linear-gradient(135deg, #4285F4 0%, #3367D6 100%);
          transition: all 0.2s ease;
        }
        .calendar-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(66, 133, 244, 0.4);
        }
        .success-icon {
          animation: fadeIn 0.5s ease-out, pulse 2s ease-in-out infinite;
        }
      </style>
    </head>
  `;
}

/**
 * エラー画面HTML生成
 */
function errorPage(type: 'not-found' | 'expired' | 'already-responded', details?: { expires_at?: string; status?: string }): string {
  const configs = {
    'not-found': {
      icon: '⚠️',
      title: 'この招待リンクは無効です',
      message: 'このリンクは削除されたか、正しくありません。<br>招待元にお問い合わせください。',
      color: 'red'
    },
    'expired': {
      icon: '⌛',
      title: 'この招待は期限切れです',
      message: `有効期限: ${details?.expires_at ? formatDateTimeJP(details.expires_at) : '不明'}<br><br>新しい招待リンクが必要な場合は、<br>主催者にお問い合わせください。`,
      color: 'amber'
    },
    'already-responded': {
      icon: '✓',
      title: 'すでに回答済みです',
      message: `あなたの回答: ${details?.status === 'accepted' ? '参加' : '辞退'}<br><br>変更が必要な場合は、主催者にお問い合わせください。`,
      color: 'blue'
    }
  };

  const config = configs[type];
  
  return `
    ${getHtmlHead(config.title)}
    <body class="bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center fade-in">
        <div class="text-6xl mb-4">${config.icon}</div>
        <h1 class="text-2xl font-bold text-${config.color}-600 mb-4">${config.title}</h1>
        <p class="text-gray-700 leading-relaxed">${config.message}</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * 固定1枠モードのUI（シンプル・直感的）
 */
function singleSlotUI(slot: { slot_id: string; start_at: string; end_at: string }, thread: { title?: string | null; description?: string | null } | null, invite: { candidate_name: string; candidate_reason?: string | null; expires_at: string }, token: string): string {
  const startTime = formatDateTimeJP(slot.start_at);
  const endTime = formatTimeJP(slot.end_at);
  
  return `
    ${getHtmlHead('日程確認')}
    <body class="bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white p-6 sm:p-8 rounded-2xl shadow-xl max-w-lg w-full fade-in">
        
        <!-- ヘッダー -->
        <div class="text-center mb-6">
          <div class="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
            <svg class="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
          </div>
          <h1 class="text-2xl font-bold text-gray-800">日程確認</h1>
          <p class="text-gray-600 mt-1">${thread?.title || '打ち合わせ'}</p>
        </div>

        <!-- 日時カード（メイン） -->
        <div class="bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl p-6 mb-6 text-center">
          <div class="text-lg opacity-90 mb-2">ご提案の日時</div>
          <div class="text-2xl sm:text-3xl font-bold mb-1">${startTime}</div>
          <div class="text-lg opacity-90">〜 ${endTime}</div>
        </div>

        ${invite.candidate_reason ? `
        <div class="bg-gray-50 rounded-lg p-4 mb-6">
          <p class="text-gray-700 text-sm">"${invite.candidate_reason}"</p>
        </div>
        ` : ''}

        <!-- CTAボタン -->
        <div class="space-y-3 mb-6">
          <button 
            id="acceptBtn"
            onclick="acceptInvite()"
            class="w-full btn-primary text-white font-bold py-4 px-6 rounded-xl flex items-center justify-center text-lg"
          >
            <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
            </svg>
            <span id="acceptText">この日程で承諾する</span>
            <div id="acceptSpinner" class="spinner ml-2 hidden"></div>
          </button>
          
          <button 
            id="declineBtn"
            onclick="declineInvite()"
            class="w-full btn-secondary text-gray-700 font-semibold py-3 px-6 rounded-xl flex items-center justify-center"
          >
            <span id="declineText">別の日程を希望する</span>
            <div id="declineSpinner" class="spinner ml-2 hidden" style="border-top-color: #374151;"></div>
          </button>
        </div>

        <!-- エラーメッセージ -->
        <div id="errorMessage" class="hidden bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          <div class="flex items-center">
            <span class="text-xl mr-2">❌</span>
            <div>
              <div class="font-semibold">送信に失敗しました</div>
              <div class="text-sm error-detail">インターネット接続を確認して、もう一度お試しください。</div>
            </div>
          </div>
        </div>

        <!-- フッター -->
        <p class="text-xs text-gray-500 text-center">
          この招待は ${formatDateTimeJP(invite.expires_at)} まで有効です
        </p>
      </div>

      <script>
        const TOKEN = '${token}';
        const SLOT_ID = '${slot.slot_id}';
        const SLOT_START = '${slot.start_at}';
        const SLOT_END = '${slot.end_at}';
        const THREAD_TITLE = '${(thread?.title || '打ち合わせ').replace(/'/g, "\\'")}';

        function setLoading(btnId, loading) {
          const btn = document.getElementById(btnId);
          const text = document.getElementById(btnId.replace('Btn', 'Text'));
          const spinner = document.getElementById(btnId.replace('Btn', 'Spinner'));
          
          btn.disabled = loading;
          document.getElementById('acceptBtn').disabled = loading;
          document.getElementById('declineBtn').disabled = loading;
          
          if (loading) {
            spinner.classList.remove('hidden');
          } else {
            spinner.classList.add('hidden');
          }
        }

        function showError(message) {
          const errorDiv = document.getElementById('errorMessage');
          errorDiv.querySelector('.error-detail').textContent = message;
          errorDiv.classList.remove('hidden');
          setTimeout(() => errorDiv.classList.add('hidden'), 5000);
        }

        async function acceptInvite() {
          try {
            setLoading('acceptBtn', true);
            
            const response = await fetch('/i/' + TOKEN + '/respond', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                status: 'selected',
                selected_slot_id: SLOT_ID
              })
            });
            
            if (response.ok) {
              // サンキューページへ遷移
              window.location.href = '/i/' + TOKEN + '/thank-you?slot_id=' + SLOT_ID;
            } else {
              const error = await response.json();
              showError(error.error || '送信に失敗しました。もう一度お試しください。');
              setLoading('acceptBtn', false);
            }
          } catch (error) {
            showError('ネットワークエラーが発生しました。接続を確認してください。');
            setLoading('acceptBtn', false);
          }
        }

        async function declineInvite() {
          if (!confirm('別の日程をご希望ですか？\\n\\n「OK」を押すと、主催者に別日希望の連絡が届きます。')) {
            return;
          }

          try {
            setLoading('declineBtn', true);
            
            const response = await fetch('/i/' + TOKEN + '/respond', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                status: 'declined'
              })
            });

            if (response.ok) {
              document.body.innerHTML = \`
                <div class="bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center min-h-screen p-4">
                  <div class="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center fade-in">
                    <div class="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                      <svg class="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                      </svg>
                    </div>
                    <h1 class="text-2xl font-bold text-gray-800 mb-4">別日希望を送信しました</h1>
                    <p class="text-gray-600 mb-2">主催者に別の日程をご希望であることが伝わりました。</p>
                    <p class="text-gray-600 mb-6">新しい候補が届くまでお待ちください。</p>
                    <p class="text-sm text-gray-500">このページは閉じて構いません</p>
                  </div>
                </div>
              \`;
            } else {
              const error = await response.json();
              showError(error.error || '送信に失敗しました。もう一度お試しください。');
              setLoading('declineBtn', false);
            }
          } catch (error) {
            showError('ネットワークエラーが発生しました。接続を確認してください。');
            setLoading('declineBtn', false);
          }
        }
      </script>
    </body>
    </html>
  `;
}

/**
 * 複数候補モードのUI（従来版を改良）
 */
function multiSlotUI(slots: Array<{ slot_id: string; start_at: string; end_at: string; timezone?: string }>, thread: { title?: string | null; description?: string | null } | null, invite: { candidate_name: string; candidate_reason?: string | null; expires_at: string }, token: string): string {
  const slotsHtml = slots.map((slot, index) => {
    const startTime = formatDateTimeJP(slot.start_at);
    const endTime = formatTimeJP(slot.end_at);
    return `
      <label class="slot-card block p-4 border-2 border-gray-200 rounded-xl cursor-pointer ${index === 0 ? 'selected' : ''}">
        <input 
          type="radio" 
          name="slot" 
          value="${slot.slot_id}" 
          data-start="${slot.start_at}"
          data-end="${slot.end_at}"
          class="hidden"
          ${index === 0 ? 'checked' : ''}
          onchange="updateSelection(this)"
        />
        <div class="flex items-center">
          <div class="flex-shrink-0 w-6 h-6 rounded-full border-2 border-gray-300 flex items-center justify-center mr-3 check-circle">
            <div class="w-3 h-3 rounded-full bg-blue-500 ${index === 0 ? '' : 'hidden'} check-inner"></div>
          </div>
          <div class="flex-1">
            <div class="font-semibold text-gray-900">${startTime}</div>
            <div class="text-sm text-gray-600">〜 ${endTime}</div>
          </div>
        </div>
      </label>
    `;
  }).join('');

  return `
    ${getHtmlHead('日程調整')}
    <body class="bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white p-6 sm:p-8 rounded-2xl shadow-xl max-w-lg w-full fade-in">
        
        <div class="text-center mb-6">
          <div class="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
            <svg class="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
          </div>
          <h1 class="text-2xl font-bold text-gray-800">日程調整</h1>
          <p class="text-gray-600 mt-1">${thread?.title || '打ち合わせ'}</p>
        </div>

        ${invite.candidate_reason ? `
        <div class="bg-gray-50 rounded-lg p-4 mb-6">
          <p class="text-gray-700 text-sm">"${invite.candidate_reason}"</p>
        </div>
        ` : ''}

        <div class="mb-6">
          <h3 class="font-semibold text-gray-800 mb-3">ご都合の良い日時を選択してください：</h3>
          <div id="slots" class="space-y-3">
            ${slotsHtml}
          </div>
        </div>

        <div class="space-y-3 mb-6">
          <button 
            id="acceptBtn"
            onclick="selectSlot()"
            class="w-full btn-primary text-white font-bold py-4 px-6 rounded-xl flex items-center justify-center text-lg"
          >
            <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
            </svg>
            <span id="acceptText">この日程で参加する</span>
            <div id="acceptSpinner" class="spinner ml-2 hidden"></div>
          </button>
          
          <button 
            id="declineBtn"
            onclick="declineInvite()"
            class="w-full btn-secondary text-gray-700 font-semibold py-3 px-6 rounded-xl flex items-center justify-center"
          >
            <span id="declineText">辞退する</span>
            <div id="declineSpinner" class="spinner ml-2 hidden" style="border-top-color: #374151;"></div>
          </button>
        </div>

        <div id="errorMessage" class="hidden bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
          <div class="flex items-center">
            <span class="text-xl mr-2">❌</span>
            <div>
              <div class="font-semibold">送信に失敗しました</div>
              <div class="text-sm error-detail">インターネット接続を確認して、もう一度お試しください。</div>
            </div>
          </div>
        </div>

        <p class="text-xs text-gray-500 text-center">
          この招待は ${formatDateTimeJP(invite.expires_at)} まで有効です
        </p>
      </div>

      <script>
        const TOKEN = '${token}';

        function updateSelection(radio) {
          document.querySelectorAll('.slot-card').forEach(card => {
            card.classList.remove('selected');
            card.querySelector('.check-inner').classList.add('hidden');
          });
          
          const card = radio.closest('.slot-card');
          card.classList.add('selected');
          card.querySelector('.check-inner').classList.remove('hidden');
        }

        function setLoading(btnId, loading) {
          const btn = document.getElementById(btnId);
          const spinner = document.getElementById(btnId.replace('Btn', 'Spinner'));
          
          btn.disabled = loading;
          document.getElementById('acceptBtn').disabled = loading;
          document.getElementById('declineBtn').disabled = loading;
          
          if (loading) {
            spinner.classList.remove('hidden');
          } else {
            spinner.classList.add('hidden');
          }
        }

        function showError(message) {
          const errorDiv = document.getElementById('errorMessage');
          errorDiv.querySelector('.error-detail').textContent = message;
          errorDiv.classList.remove('hidden');
          setTimeout(() => errorDiv.classList.add('hidden'), 5000);
        }

        async function selectSlot() {
          try {
            setLoading('acceptBtn', true);
            
            const selectedRadio = document.querySelector('input[name="slot"]:checked');
            const selectedSlotId = selectedRadio ? selectedRadio.value : null;

            const response = await fetch('/i/' + TOKEN + '/respond', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                status: 'selected',
                selected_slot_id: selectedSlotId
              })
            });
            
            if (response.ok) {
              window.location.href = '/i/' + TOKEN + '/thank-you?slot_id=' + selectedSlotId;
            } else {
              const error = await response.json();
              showError(error.error || '送信に失敗しました。もう一度お試しください。');
              setLoading('acceptBtn', false);
            }
          } catch (error) {
            showError('ネットワークエラーが発生しました。接続を確認してください。');
            setLoading('acceptBtn', false);
          }
        }

        async function declineInvite() {
          if (!confirm('本当に辞退しますか？\\n\\n主催者には自動で通知されます。')) {
            return;
          }

          try {
            setLoading('declineBtn', true);
            
            const response = await fetch('/i/' + TOKEN + '/respond', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                status: 'declined'
              })
            });

            if (response.ok) {
              document.body.innerHTML = \`
                <div class="bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center min-h-screen p-4">
                  <div class="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center fade-in">
                    <div class="text-gray-600 text-6xl mb-4">✗</div>
                    <h1 class="text-2xl font-bold text-gray-800 mb-4">参加を辞退しました</h1>
                    <p class="text-gray-600 mb-2">ご都合が合わなかったようで残念です。</p>
                    <p class="text-gray-600 mb-4">主催者には自動で通知されます。</p>
                    <p class="text-sm text-gray-500">このページは閉じて構いません</p>
                  </div>
                </div>
              \`;
            } else {
              const error = await response.json();
              showError(error.error || '送信に失敗しました。もう一度お試しください。');
              setLoading('declineBtn', false);
            }
          } catch (error) {
            showError('ネットワークエラーが発生しました。接続を確認してください。');
            setLoading('declineBtn', false);
          }
        }

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
          const firstRadio = document.querySelector('input[name="slot"]:checked');
          if (firstRadio) {
            updateSelection(firstRadio);
          }
        });
      </script>
    </body>
    </html>
  `;
}

/**
 * View invite (for /i/:token page)
 * 
 * @route GET /:token
 */
app.get('/:token', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Invite', handler: 'get' });
  const token = c.req.param('token');

  try {
    const threadsRepo = new ThreadsRepository(env.DB);
    const invite = await threadsRepo.getInviteByToken(token);

    // 無効なトークン
    if (!invite) {
      return c.html(errorPage('not-found'), 404);
    }

    // 既に回答済み
    if (invite.status !== 'pending') {
      return c.html(errorPage('already-responded', invite));
    }

    // 期限切れ
    if (new Date(invite.expires_at) < new Date()) {
      return c.html(errorPage('expired', invite));
    }

    const thread = await threadsRepo.getById(invite.thread_id);

    // Get available slots
    const { results: slots } = await env.DB.prepare(`
      SELECT slot_id, start_at, end_at, timezone FROM scheduling_slots 
      WHERE thread_id = ? 
      ORDER BY start_at ASC
    `).bind(invite.thread_id).all();

    // 固定1枠 vs 複数候補で分岐
    if (slots && slots.length === 1) {
      // 固定1枠モード - シンプルなUI
      const slot = slots[0] as { slot_id: string; start_at: string; end_at: string };
      return c.html(singleSlotUI(slot, thread, invite, token));
    } else if (slots && slots.length > 1) {
      // 複数候補モード - 選択UI
      return c.html(multiSlotUI(slots as Array<{ slot_id: string; start_at: string; end_at: string; timezone?: string }>, thread, invite, token));
    } else {
      // スロットなし - エラー
      log.warn('No slots found for invite', { token, thread_id: invite.thread_id });
      return c.html(errorPage('not-found'), 404);
    }
  } catch (error) {
    log.error('Error', { error: error instanceof Error ? error.message : String(error) });
    return c.html(errorPage('not-found'), 500);
  }
});

/**
 * Thank you page (after accepting)
 * 
 * @route GET /:token/thank-you
 */
app.get('/:token/thank-you', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Invite', handler: 'thank-you' });
  const token = c.req.param('token');
  const slotId = c.req.query('slot_id');

  try {
    const threadsRepo = new ThreadsRepository(env.DB);
    const invite = await threadsRepo.getInviteByToken(token);

    if (!invite) {
      return c.html(errorPage('not-found'), 404);
    }

    const thread = await threadsRepo.getById(invite.thread_id);

    // スロット情報取得
    let slot: { slot_id: string; start_at: string; end_at: string } | null = null;
    if (slotId) {
      const slotResult = await env.DB.prepare(`
        SELECT slot_id, start_at, end_at FROM scheduling_slots WHERE slot_id = ?
      `).bind(slotId).first<{ slot_id: string; start_at: string; end_at: string }>();
      slot = slotResult || null;
    }

    // Googleカレンダー追加URL生成
    const calendarUrl = slot ? generateGoogleCalendarUrl({
      title: thread?.title || '打ち合わせ',
      startAt: slot.start_at,
      endAt: slot.end_at,
      description: thread?.description || undefined
    }) : '';

    const startTime = slot ? formatDateTimeJP(slot.start_at) : '';
    const endTime = slot ? formatTimeJP(slot.end_at) : '';

    return c.html(`
      ${getHtmlHead('予定が確定しました')}
      <body class="bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center min-h-screen p-4">
        <div class="bg-white p-6 sm:p-8 rounded-2xl shadow-xl max-w-lg w-full fade-in">
          
          <!-- 成功アイコン -->
          <div class="text-center mb-6">
            <div class="success-icon inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-4">
              <svg class="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
              </svg>
            </div>
            <h1 class="text-2xl font-bold text-gray-800">予定が確定しました！</h1>
          </div>

          <!-- 確定した日時 -->
          ${slot ? `
          <div class="bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl p-6 mb-6 text-center">
            <div class="text-lg opacity-90 mb-2">${thread?.title || '打ち合わせ'}</div>
            <div class="text-2xl sm:text-3xl font-bold mb-1">${startTime}</div>
            <div class="text-lg opacity-90">〜 ${endTime}</div>
          </div>
          ` : ''}

          <!-- Googleカレンダー追加ボタン -->
          ${calendarUrl ? `
          <a 
            href="${calendarUrl}"
            target="_blank"
            rel="noopener noreferrer"
            class="calendar-btn w-full text-white font-bold py-4 px-6 rounded-xl flex items-center justify-center text-lg mb-4 no-underline"
          >
            <svg class="w-6 h-6 mr-2" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.5 3h-3V1.5h-1.5V3h-6V1.5H7.5V3h-3C3.675 3 3 3.675 3 4.5v15c0 .825.675 1.5 1.5 1.5h15c.825 0 1.5-.675 1.5-1.5v-15c0-.825-.675-1.5-1.5-1.5zm0 16.5h-15V9h15v10.5zm0-12h-15v-3h15v3z"/>
            </svg>
            Googleカレンダーに追加
          </a>
          ` : ''}

          <!-- リマインド案内 -->
          <div class="bg-blue-50 rounded-lg p-4 mb-6">
            <div class="flex items-start">
              <svg class="w-5 h-5 text-blue-600 mt-0.5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
              </svg>
              <div>
                <p class="text-sm text-blue-800 font-medium">前日にリマインドが届きます</p>
                <p class="text-xs text-blue-600 mt-1">お忘れのないようご参加ください</p>
              </div>
            </div>
          </div>

          <!-- 成長導線 -->
          <div class="border-t border-gray-200 pt-6">
            <div class="text-center mb-4">
              <p class="text-gray-600 text-sm mb-2">あなたも予定調整を楽にしませんか？</p>
              <p class="text-gray-800 font-medium">AI秘書が日程調整を自動化します</p>
            </div>
            <a 
              href="https://app.tomoniwao.jp"
              target="_blank"
              rel="noopener noreferrer"
              class="block w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold py-3 px-6 rounded-xl text-center no-underline hover:opacity-90 transition"
            >
              無料で始める →
            </a>
          </div>

          <p class="text-xs text-gray-500 text-center mt-6">このページは閉じて構いません</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    log.error('Thank you page error', { error: error instanceof Error ? error.message : String(error) });
    return c.html(errorPage('not-found'), 500);
  }
});

/**
 * Respond to invite
 * 
 * @route POST /:token/respond
 * @body { status: 'selected' | 'declined', selected_slot_id?: string }
 */
app.post('/:token/respond', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Invite', handler: 'respond' });
  const token = c.req.param('token');

  try {
    const body = await c.req.json();
    const { status, selected_slot_id } = body;

    if (!status || !['selected', 'declined'].includes(status)) {
      return c.json({ error: 'Invalid status' }, 400);
    }

    const threadsRepo = new ThreadsRepository(env.DB);
    const invite = await threadsRepo.getInviteByToken(token);

    if (!invite) {
      return c.json({ error: 'Invitation not found' }, 404);
    }

    if (invite.status !== 'pending') {
      return c.json({ error: 'Invitation already processed' }, 400);
    }

    if (new Date(invite.expires_at) < new Date()) {
      return c.json({ error: 'Invitation expired' }, 400);
    }

    // Update invite status
    const newStatus = status === 'selected' ? 'accepted' : 'declined';
    await threadsRepo.updateInviteStatus(invite.id, newStatus);

    // Phase2: Get current proposal_version from thread
    const threadResult = await env.DB.prepare(`
      SELECT COALESCE(proposal_version, 1) as proposal_version FROM scheduling_threads WHERE id = ?
    `).bind(invite.thread_id).first<{ proposal_version: number }>();
    const currentProposalVersion = threadResult?.proposal_version ?? 1;

    // Record slot selection if accepted
    if (status === 'selected' && selected_slot_id) {
      const selectionId = `sel-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      await env.DB.prepare(`
        INSERT OR REPLACE INTO thread_selections (
          selection_id, thread_id, invite_id, invitee_key, selected_slot_id, status, 
          proposal_version_at_response, responded_at, created_at
        ) VALUES (?, ?, ?, ?, ?, 'selected', ?, datetime('now'), datetime('now'))
      `).bind(selectionId, invite.thread_id, invite.id, invite.invitee_key, selected_slot_id, currentProposalVersion).run();
    }

    // Phase2: Record decline with proposal_version_at_response
    if (status === 'declined') {
      const selectionId = `sel-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      await env.DB.prepare(`
        INSERT OR REPLACE INTO thread_selections (
          selection_id, thread_id, invite_id, invitee_key, selected_slot_id, status, 
          proposal_version_at_response, responded_at, created_at
        ) VALUES (?, ?, ?, ?, NULL, 'declined', ?, datetime('now'), datetime('now'))
      `).bind(selectionId, invite.thread_id, invite.id, invite.invitee_key, currentProposalVersion).run();
    }

    // Send notification to organizer (via inbox)
    const schedulingThread = await threadsRepo.getSchedulingThreadById(invite.thread_id);
    if (schedulingThread) {
      const inboxRepo = new InboxRepository(env.DB);
      const message = status === 'selected' 
        ? `${invite.candidate_name}さんが日程を承諾しました`
        : `${invite.candidate_name}さんが別日を希望しています`;

      await inboxRepo.create({
        user_id: schedulingThread.organizer_user_id,
        type: 'system_message',
        priority: 'normal',
        title: `${schedulingThread.title || 'スレッド'} - 返信がありました`,
        message,
        action_type: 'view_thread',
        action_target_id: invite.thread_id,
        action_url: `/scheduling/threads/${invite.thread_id}`,
        data: { thread_id: invite.thread_id, invite_id: invite.id }
      });
    }

    return c.json({ 
      success: true,
      status: newStatus,
      message: status === 'selected' ? 'Slot selected' : 'Invitation declined'
    });
  } catch (error) {
    log.error('Respond error', { error: error instanceof Error ? error.message : String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;
