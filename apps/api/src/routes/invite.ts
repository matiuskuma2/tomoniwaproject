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
import { createOpenSlotsInternal } from '../services/openSlotsService';

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
        /* B-3: 別日希望モーダル */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 50;
          padding: 1rem;
        }
        .modal-content {
          background: white;
          border-radius: 1rem;
          max-width: 28rem;
          width: 100%;
          max-height: 90vh;
          overflow-y: auto;
          animation: fadeIn 0.3s ease-out;
        }
        .option-card {
          border: 2px solid #E5E7EB;
          border-radius: 0.5rem;
          padding: 0.75rem 1rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .option-card:hover {
          border-color: #3B82F6;
          background: #EFF6FF;
        }
        .option-card.selected {
          border-color: #3B82F6;
          background: #DBEAFE;
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
            onclick="showAlternateModal()"
            class="w-full btn-secondary text-gray-700 font-semibold py-3 px-6 rounded-xl flex items-center justify-center"
          >
            <span id="declineText">別日を希望する</span>
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

      <!-- B-3: 別日希望モーダル -->
      <div id="alternateModal" class="modal-overlay hidden">
        <div class="modal-content p-6">
          <h2 class="text-xl font-bold text-gray-800 mb-4 text-center">別日のご希望を教えてください</h2>
          
          <!-- 希望期間 -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">📅 希望期間</label>
            <div class="grid grid-cols-3 gap-2">
              <label class="option-card selected" onclick="selectOption(this, 'range')">
                <input type="radio" name="range" value="next_week" checked class="hidden" />
                <div class="text-center text-sm font-medium">来週</div>
              </label>
              <label class="option-card" onclick="selectOption(this, 'range')">
                <input type="radio" name="range" value="next_next_week" class="hidden" />
                <div class="text-center text-sm font-medium">再来週</div>
              </label>
              <label class="option-card" onclick="selectOption(this, 'range')">
                <input type="radio" name="range" value="any" class="hidden" />
                <div class="text-center text-sm font-medium">指定なし</div>
              </label>
            </div>
          </div>
          
          <!-- 時間帯 -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">🕒 時間帯</label>
            <div class="grid grid-cols-4 gap-2">
              <label class="option-card" onclick="selectOption(this, 'prefer')">
                <input type="radio" name="prefer" value="morning" class="hidden" />
                <div class="text-center text-sm font-medium">午前</div>
              </label>
              <label class="option-card selected" onclick="selectOption(this, 'prefer')">
                <input type="radio" name="prefer" value="afternoon" checked class="hidden" />
                <div class="text-center text-sm font-medium">午後</div>
              </label>
              <label class="option-card" onclick="selectOption(this, 'prefer')">
                <input type="radio" name="prefer" value="evening" class="hidden" />
                <div class="text-center text-sm font-medium">夕方</div>
              </label>
              <label class="option-card" onclick="selectOption(this, 'prefer')">
                <input type="radio" name="prefer" value="any" class="hidden" />
                <div class="text-center text-sm font-medium">指定なし</div>
              </label>
            </div>
          </div>
          
          <!-- 補足 -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-2">📝 補足（任意）</label>
            <input 
              type="text" 
              id="alternateComment" 
              placeholder="例: 火曜はNG、15時以降だと助かります"
              class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <!-- モーダルエラーメッセージ -->
          <div id="modalError" class="hidden bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm"></div>
          
          <!-- ボタン -->
          <div class="flex space-x-3">
            <button 
              onclick="hideAlternateModal()"
              class="flex-1 btn-secondary text-gray-700 font-semibold py-3 px-4 rounded-xl"
            >
              やっぱりやめる
            </button>
            <button 
              id="submitAlternateBtn"
              onclick="submitAlternateRequest()"
              class="flex-1 btn-primary text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center"
            >
              <span id="submitAlternateText">この条件で再提案する</span>
              <div id="submitAlternateSpinner" class="spinner ml-2 hidden"></div>
            </button>
          </div>
        </div>
      </div>

      <script>
        const TOKEN = '${token}';
        const SLOT_ID = '${slot.slot_id}';
        const SLOT_START = '${slot.start_at}';
        const SLOT_END = '${slot.end_at}';
        const THREAD_TITLE = '${(thread?.title || '打ち合わせ').replace(/'/g, "\\'")}';

        function selectOption(element, group) {
          document.querySelectorAll(\`input[name="\${group}"]\`).forEach(input => {
            input.closest('.option-card').classList.remove('selected');
          });
          element.classList.add('selected');
          element.querySelector('input').checked = true;
        }

        function showAlternateModal() {
          document.getElementById('alternateModal').classList.remove('hidden');
        }

        function hideAlternateModal() {
          document.getElementById('alternateModal').classList.add('hidden');
          document.getElementById('modalError').classList.add('hidden');
        }

        async function submitAlternateRequest() {
          const submitBtn = document.getElementById('submitAlternateBtn');
          const submitSpinner = document.getElementById('submitAlternateSpinner');
          const modalError = document.getElementById('modalError');
          
          const range = document.querySelector('input[name="range"]:checked')?.value || 'next_week';
          const prefer = document.querySelector('input[name="prefer"]:checked')?.value || 'afternoon';
          const comment = document.getElementById('alternateComment').value.trim();
          
          submitBtn.disabled = true;
          submitSpinner.classList.remove('hidden');
          modalError.classList.add('hidden');
          
          try {
            const response = await fetch('/i/' + TOKEN + '/request-alternate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ range, prefer, comment })
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
              if (data.max_reached) {
                document.body.innerHTML = \`
                  <div class="bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center min-h-screen p-4">
                    <div class="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center fade-in">
                      <div class="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full mb-4">
                        <svg class="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                        </svg>
                      </div>
                      <h1 class="text-2xl font-bold text-gray-800 mb-4">\${data.message}</h1>
                      <p class="text-gray-600 mb-6">主催者に連絡して、空き時間一覧を送ってもらうようお願いしてください。</p>
                      <p class="text-sm text-gray-500">このページは閉じて構いません</p>
                    </div>
                  </div>
                \`;
              } else {
                window.location.reload();
              }
            } else {
              modalError.textContent = data.error || data.message || '送信に失敗しました。もう一度お試しください。';
              modalError.classList.remove('hidden');
              submitBtn.disabled = false;
              submitSpinner.classList.add('hidden');
            }
          } catch (error) {
            modalError.textContent = 'ネットワークエラーが発生しました。接続を確認してください。';
            modalError.classList.remove('hidden');
            submitBtn.disabled = false;
            submitSpinner.classList.add('hidden');
          }
        }

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
            onclick="showAlternateModal()"
            class="w-full btn-secondary text-gray-700 font-semibold py-3 px-6 rounded-xl flex items-center justify-center"
          >
            <span id="declineText">別日を希望する</span>
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

      <!-- B-3: 別日希望モーダル -->
      <div id="alternateModal" class="modal-overlay hidden">
        <div class="modal-content p-6">
          <h2 class="text-xl font-bold text-gray-800 mb-4 text-center">別日のご希望を教えてください</h2>
          
          <!-- 希望期間 -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">📅 希望期間</label>
            <div class="grid grid-cols-3 gap-2">
              <label class="option-card selected" onclick="selectOption(this, 'range')">
                <input type="radio" name="range" value="next_week" checked class="hidden" />
                <div class="text-center text-sm font-medium">来週</div>
              </label>
              <label class="option-card" onclick="selectOption(this, 'range')">
                <input type="radio" name="range" value="next_next_week" class="hidden" />
                <div class="text-center text-sm font-medium">再来週</div>
              </label>
              <label class="option-card" onclick="selectOption(this, 'range')">
                <input type="radio" name="range" value="any" class="hidden" />
                <div class="text-center text-sm font-medium">指定なし</div>
              </label>
            </div>
          </div>
          
          <!-- 時間帯 -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">🕒 時間帯</label>
            <div class="grid grid-cols-4 gap-2">
              <label class="option-card" onclick="selectOption(this, 'prefer')">
                <input type="radio" name="prefer" value="morning" class="hidden" />
                <div class="text-center text-sm font-medium">午前</div>
              </label>
              <label class="option-card selected" onclick="selectOption(this, 'prefer')">
                <input type="radio" name="prefer" value="afternoon" checked class="hidden" />
                <div class="text-center text-sm font-medium">午後</div>
              </label>
              <label class="option-card" onclick="selectOption(this, 'prefer')">
                <input type="radio" name="prefer" value="evening" class="hidden" />
                <div class="text-center text-sm font-medium">夕方</div>
              </label>
              <label class="option-card" onclick="selectOption(this, 'prefer')">
                <input type="radio" name="prefer" value="any" class="hidden" />
                <div class="text-center text-sm font-medium">指定なし</div>
              </label>
            </div>
          </div>
          
          <!-- 補足 -->
          <div class="mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-2">📝 補足（任意）</label>
            <input 
              type="text" 
              id="alternateComment" 
              placeholder="例: 火曜はNG、15時以降だと助かります"
              class="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <!-- モーダルエラーメッセージ -->
          <div id="modalError" class="hidden bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm"></div>
          
          <!-- ボタン -->
          <div class="flex space-x-3">
            <button 
              onclick="hideAlternateModal()"
              class="flex-1 btn-secondary text-gray-700 font-semibold py-3 px-4 rounded-xl"
            >
              やっぱりやめる
            </button>
            <button 
              id="submitAlternateBtn"
              onclick="submitAlternateRequest()"
              class="flex-1 btn-primary text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center"
            >
              <span id="submitAlternateText">この条件で再提案する</span>
              <div id="submitAlternateSpinner" class="spinner ml-2 hidden"></div>
            </button>
          </div>
        </div>
      </div>

      <script>
        const TOKEN = '${token}';

        function selectOption(element, group) {
          document.querySelectorAll(\`input[name="\${group}"]\`).forEach(input => {
            input.closest('.option-card').classList.remove('selected');
          });
          element.classList.add('selected');
          element.querySelector('input').checked = true;
        }

        function showAlternateModal() {
          document.getElementById('alternateModal').classList.remove('hidden');
        }

        function hideAlternateModal() {
          document.getElementById('alternateModal').classList.add('hidden');
          document.getElementById('modalError').classList.add('hidden');
        }

        async function submitAlternateRequest() {
          const submitBtn = document.getElementById('submitAlternateBtn');
          const submitText = document.getElementById('submitAlternateText');
          const submitSpinner = document.getElementById('submitAlternateSpinner');
          const modalError = document.getElementById('modalError');
          
          // 選択値取得
          const range = document.querySelector('input[name="range"]:checked')?.value || 'next_week';
          const prefer = document.querySelector('input[name="prefer"]:checked')?.value || 'afternoon';
          const comment = document.getElementById('alternateComment').value.trim();
          
          submitBtn.disabled = true;
          submitSpinner.classList.remove('hidden');
          modalError.classList.add('hidden');
          
          try {
            const response = await fetch('/i/' + TOKEN + '/request-alternate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ range, prefer, comment })
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
              if (data.max_reached) {
                // 再提案上限到達
                document.body.innerHTML = \`
                  <div class="bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center min-h-screen p-4">
                    <div class="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center fade-in">
                      <div class="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full mb-4">
                        <svg class="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                        </svg>
                      </div>
                      <h1 class="text-2xl font-bold text-gray-800 mb-4">\${data.message}</h1>
                      <p class="text-gray-600 mb-6">主催者に連絡して、空き時間一覧を送ってもらうようお願いしてください。</p>
                      <p class="text-sm text-gray-500">このページは閉じて構いません</p>
                    </div>
                  </div>
                \`;
              } else {
                // 再提案成功 → ページリロードで新しい候補を表示
                window.location.reload();
              }
            } else {
              modalError.textContent = data.error || data.message || '送信に失敗しました。もう一度お試しください。';
              modalError.classList.remove('hidden');
              submitBtn.disabled = false;
              submitSpinner.classList.add('hidden');
            }
          } catch (error) {
            modalError.textContent = 'ネットワークエラーが発生しました。接続を確認してください。';
            modalError.classList.remove('hidden');
            submitBtn.disabled = false;
            submitSpinner.classList.add('hidden');
          }
        }

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
      
      // ============================================================
      // v1.2: 前日リマインダー予約
      // ============================================================
      try {
        // 選択されたスロットの情報を取得
        const slotInfo = await env.DB.prepare(`
          SELECT start_at, end_at, timezone FROM scheduling_slots WHERE slot_id = ?
        `).bind(selected_slot_id).first<{ start_at: string; end_at: string; timezone: string | null }>();
        
        if (slotInfo) {
          // 前日 09:00 JST を計算
          const slotDate = new Date(slotInfo.start_at);
          const remindDate = new Date(slotDate);
          remindDate.setDate(remindDate.getDate() - 1);  // 前日
          remindDate.setUTCHours(0, 0, 0, 0);  // JST 09:00 = UTC 00:00
          
          const now = new Date();
          // リマインド日時が未来の場合のみ予約
          if (remindDate > now) {
            const reminderId = `rem-${Date.now()}-${Math.random().toString(36).substring(7)}`;
            const dedupeKey = `${invite.thread_id}:${invite.id}:${remindDate.toISOString()}`;
            
            // スレッド情報取得（metadata用）
            const threadInfo = await env.DB.prepare(`
              SELECT title, organizer_user_id FROM scheduling_threads WHERE id = ?
            `).bind(invite.thread_id).first<{ title: string | null; organizer_user_id: string }>();
            
            // オーガナイザー名取得
            let organizerName = 'ユーザー';
            if (threadInfo?.organizer_user_id) {
              const organizer = await env.DB.prepare(`
                SELECT display_name, email FROM users WHERE id = ?
              `).bind(threadInfo.organizer_user_id).first<{ display_name: string | null; email: string }>();
              organizerName = organizer?.display_name || organizer?.email?.split('@')[0] || 'ユーザー';
            }
            
            const metadata = JSON.stringify({
              title: threadInfo?.title || '打ち合わせ',
              slot_start_at: slotInfo.start_at,
              slot_end_at: slotInfo.end_at,
              organizer_name: organizerName,
            });
            
            // scheduled_reminders に INSERT (dedupe_key のユニーク制約で二重作成を防止)
            await env.DB.prepare(`
              INSERT OR IGNORE INTO scheduled_reminders (
                id, thread_id, invite_id, token, to_email, to_name,
                remind_at, remind_type, status, dedupe_key, metadata, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'day_before', 'scheduled', ?, ?, datetime('now'), datetime('now'))
            `).bind(
              reminderId,
              invite.thread_id,
              invite.id,
              token,
              invite.email,
              invite.candidate_name,
              remindDate.toISOString(),
              dedupeKey,
              metadata
            ).run();
            
            log.debug('Scheduled day-before reminder', { 
              inviteId: invite.id, 
              remindAt: remindDate.toISOString(),
              slotStartAt: slotInfo.start_at
            });
          }
        }
      } catch (reminderError) {
        // リマインダー予約失敗は承諾処理自体を失敗させない（warn ログのみ）
        log.warn('Failed to schedule reminder', { 
          inviteId: invite.id, 
          error: reminderError instanceof Error ? reminderError.message : String(reminderError)
        });
      }
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

/**
 * Request alternate dates (B-3: 別日希望 → 再提案)
 * 
 * @route POST /:token/request-alternate
 * @body { range: 'next_week' | 'next_next_week' | 'any', prefer: 'morning' | 'afternoon' | 'evening' | 'any', comment?: string }
 */
app.post('/:token/request-alternate', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'Invite', handler: 'request-alternate' });
  const token = c.req.param('token');

  try {
    const body = await c.req.json();
    const { range = 'next_week', prefer = 'afternoon', comment } = body as {
      range?: 'next_week' | 'next_next_week' | 'any';
      prefer?: 'morning' | 'afternoon' | 'evening' | 'any';
      comment?: string;
    };

    const threadsRepo = new ThreadsRepository(env.DB);
    const invite = await threadsRepo.getInviteByToken(token);

    if (!invite) {
      return c.json({ error: 'Invitation not found' }, 404);
    }

    if (new Date(invite.expires_at) < new Date()) {
      return c.json({ error: 'Invitation expired' }, 400);
    }

    // Get thread info
    const thread = await env.DB.prepare(`
      SELECT id, proposal_version, additional_propose_count, constraints_json, organizer_user_id, title
      FROM scheduling_threads WHERE id = ?
    `).bind(invite.thread_id).first<{
      id: string;
      proposal_version: number;
      additional_propose_count: number;
      constraints_json: string | null;
      organizer_user_id: string;
      title: string | null;
    }>();

    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    const currentProposeCount = thread.additional_propose_count || 0;
    const MAX_REPROPOSALS = 2;

    // Check if max reproposals reached - B-5: 自動で Open Slots を生成
    if (currentProposeCount >= MAX_REPROPOSALS) {
      log.debug('Max reproposals reached, auto-creating Open Slots', { thread_id: thread.id, count: currentProposeCount });
      
      // 既存の constraints から時間範囲を計算
      const existingConstraints = thread.constraints_json ? JSON.parse(thread.constraints_json) : {};
      const now = new Date();
      
      // リクエストの range/prefer を使って新しい constraints を作成
      let timeMin: Date;
      let timeMax: Date;
      
      if (range === 'next_week') {
        const daysUntilNextMonday = (8 - now.getDay()) % 7 || 7;
        timeMin = new Date(now);
        timeMin.setDate(timeMin.getDate() + daysUntilNextMonday);
        timeMin.setHours(9, 0, 0, 0);
        timeMax = new Date(timeMin);
        timeMax.setDate(timeMax.getDate() + 5);
        timeMax.setHours(18, 0, 0, 0);
      } else if (range === 'next_next_week') {
        const daysUntilNextMonday = (8 - now.getDay()) % 7 || 7;
        timeMin = new Date(now);
        timeMin.setDate(timeMin.getDate() + daysUntilNextMonday + 7);
        timeMin.setHours(9, 0, 0, 0);
        timeMax = new Date(timeMin);
        timeMax.setDate(timeMax.getDate() + 5);
        timeMax.setHours(18, 0, 0, 0);
      } else {
        // 'any' - 2週間
        timeMin = new Date(now);
        timeMin.setDate(timeMin.getDate() + 1);
        timeMin.setHours(9, 0, 0, 0);
        timeMax = new Date(now);
        timeMax.setDate(timeMax.getDate() + 14);
        timeMax.setHours(18, 0, 0, 0);
      }

      // workspace_id を取得
      const workspaceResult = await env.DB.prepare(`
        SELECT workspace_id FROM scheduling_threads WHERE id = ?
      `).bind(thread.id).first<{ workspace_id: string }>();
      
      const workspaceId = workspaceResult?.workspace_id || 'default';

      // Open Slots を自動生成
      const openSlotsResult = await createOpenSlotsInternal({
        env: { DB: env.DB, ENVIRONMENT: env.ENVIRONMENT },
        userId: thread.organizer_user_id,
        workspaceId,
        threadId: thread.id,
        invitee: {
          name: invite.candidate_name || '招待者',
          email: invite.email || undefined,
        },
        constraints: {
          time_min: timeMin.toISOString(),
          time_max: timeMax.toISOString(),
          prefer: prefer === 'any' ? 'afternoon' : prefer as 'morning' | 'afternoon' | 'evening',
          duration: existingConstraints.duration || 60,
        },
        title: thread.title || '打ち合わせ',
        source: 'auto_from_alternate',
      });

      if (!openSlotsResult.success) {
        // Open Slots 生成に失敗した場合はエラーを返す
        log.error('Failed to auto-create Open Slots', { error: openSlotsResult });
        return c.json({
          success: true,
          max_reached: true,
          auto_open_slots: false,
          message: `候補を${MAX_REPROPOSALS}回出しました。空き時間の生成に失敗しました。`,
          error: (openSlotsResult as { error?: string }).error,
          current_count: currentProposeCount
        });
      }

      // 成功時: Open Slots URL を返す
      log.info('Auto-created Open Slots', { 
        thread_id: thread.id, 
        open_slots_token: openSlotsResult.token,
        slots_count: openSlotsResult.slotsCount 
      });

      // 主催者に通知
      const inboxRepo = new InboxRepository(env.DB);
      await inboxRepo.create({
        user_id: thread.organizer_user_id,
        type: 'system_message',
        priority: 'normal',
        title: `${thread.title || 'スレッド'} - 空き時間共有リンク作成`,
        message: `${invite.candidate_name}さんとの調整で自動的に空き時間共有リンクを作成しました。${openSlotsResult.slotsCount}枠から選択可能です。`,
        action_type: 'view_open_slots',
        action_target_id: openSlotsResult.openSlotsId,
        action_url: `/open/${openSlotsResult.token}`,
        data: { thread_id: thread.id, open_slots_id: openSlotsResult.openSlotsId }
      });

      return c.json({
        success: true,
        max_reached: true,
        auto_open_slots: true,
        open_slots_url: openSlotsResult.shareUrl,
        open_slots_token: openSlotsResult.token,
        slots_count: openSlotsResult.slotsCount,
        expires_at: openSlotsResult.expiresAt,
        message: '何度も調整ありがとうございます。空き時間から直接選んでいただけるようにしました。',
        current_count: currentProposeCount
      });
    }

    // Update invite status to 'pending' again (allow re-selection)
    await threadsRepo.updateInviteStatus(invite.id, 'pending');

    // Update thread: increment proposal_version and additional_propose_count
    const newProposalVersion = (thread.proposal_version || 1) + 1;
    const newProposeCount = currentProposeCount + 1;

    // Update constraints_json with new preferences
    const existingConstraints = thread.constraints_json ? JSON.parse(thread.constraints_json) : {};
    const newConstraints = {
      ...existingConstraints,
      prefer,
      range,
      comment,
      updated_at: new Date().toISOString(),
      source: 'alternate_request'
    };

    // Calculate new time range based on 'range' selection
    const now = new Date();
    let timeMin: Date;
    let timeMax: Date;

    if (range === 'next_week') {
      // Next week (Mon-Sun)
      const daysUntilNextMonday = (8 - now.getDay()) % 7 || 7;
      timeMin = new Date(now);
      timeMin.setDate(timeMin.getDate() + daysUntilNextMonday);
      timeMin.setHours(9, 0, 0, 0);
      timeMax = new Date(timeMin);
      timeMax.setDate(timeMax.getDate() + 5); // Friday
      timeMax.setHours(18, 0, 0, 0);
    } else if (range === 'next_next_week') {
      // Week after next
      const daysUntilNextMonday = (8 - now.getDay()) % 7 || 7;
      timeMin = new Date(now);
      timeMin.setDate(timeMin.getDate() + daysUntilNextMonday + 7);
      timeMin.setHours(9, 0, 0, 0);
      timeMax = new Date(timeMin);
      timeMax.setDate(timeMax.getDate() + 5);
      timeMax.setHours(18, 0, 0, 0);
    } else {
      // 'any' - 2 weeks from now
      timeMin = new Date(now);
      timeMin.setDate(timeMin.getDate() + 1);
      timeMin.setHours(9, 0, 0, 0);
      timeMax = new Date(now);
      timeMax.setDate(timeMax.getDate() + 14);
      timeMax.setHours(18, 0, 0, 0);
    }

    newConstraints.time_min = timeMin.toISOString();
    newConstraints.time_max = timeMax.toISOString();

    await env.DB.prepare(`
      UPDATE scheduling_threads 
      SET proposal_version = ?, additional_propose_count = ?, constraints_json = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(newProposalVersion, newProposeCount, JSON.stringify(newConstraints), thread.id).run();

    // Delete old slots (from previous proposal)
    await env.DB.prepare(`DELETE FROM scheduling_slots WHERE thread_id = ?`).bind(thread.id).run();

    // Generate new slots (simplified: 3 fixed slots for now)
    // TODO: In PR-B3-API, this should use slotGenerator with freebusy
    const duration = 60; // 60 minutes
    const slotsToCreate: Array<{ slot_id: string; start_at: string; end_at: string }> = [];

    // Determine time window based on prefer
    const getHourRange = (p: string): [number, number] => {
      switch (p) {
        case 'morning': return [9, 12];
        case 'afternoon': return [13, 17];
        case 'evening': return [17, 20];
        default: return [9, 18];
      }
    };
    const [startHour, endHour] = getHourRange(prefer);

    // Create 3 slots within the time range
    const slotDate = new Date(timeMin);
    for (let i = 0; i < 3; i++) {
      // Skip weekends
      while (slotDate.getDay() === 0 || slotDate.getDay() === 6) {
        slotDate.setDate(slotDate.getDate() + 1);
      }
      
      if (slotDate > timeMax) break;

      const hour = startHour + Math.floor((endHour - startHour) / 3) * i;
      const slotStart = new Date(slotDate);
      slotStart.setHours(hour, 0, 0, 0);
      const slotEnd = new Date(slotStart);
      slotEnd.setMinutes(slotEnd.getMinutes() + duration);

      const slotId = `slot-${Date.now()}-${i}-${Math.random().toString(36).substring(7)}`;
      slotsToCreate.push({
        slot_id: slotId,
        start_at: slotStart.toISOString(),
        end_at: slotEnd.toISOString()
      });

      slotDate.setDate(slotDate.getDate() + 1);
    }

    // Insert new slots
    for (const slot of slotsToCreate) {
      await env.DB.prepare(`
        INSERT INTO scheduling_slots (slot_id, thread_id, start_at, end_at, timezone, label, proposal_version, created_at)
        VALUES (?, ?, ?, ?, 'Asia/Tokyo', ?, ?, datetime('now'))
      `).bind(slot.slot_id, thread.id, slot.start_at, slot.end_at, thread.title || '打ち合わせ', newProposalVersion).run();
    }

    // Notify organizer
    const inboxRepo = new InboxRepository(env.DB);
    await inboxRepo.create({
      user_id: thread.organizer_user_id,
      type: 'system_message',
      priority: 'normal',
      title: `${thread.title || 'スレッド'} - 別日希望`,
      message: `${invite.candidate_name}さんが別日を希望しています。希望: ${range === 'next_week' ? '来週' : range === 'next_next_week' ? '再来週' : '指定なし'}, ${prefer === 'morning' ? '午前' : prefer === 'afternoon' ? '午後' : prefer === 'evening' ? '夕方' : '指定なし'}${comment ? ` (補足: ${comment})` : ''}`,
      action_type: 'view_thread',
      action_target_id: thread.id,
      action_url: `/scheduling/threads/${thread.id}`,
      data: { thread_id: thread.id, invite_id: invite.id, alternate_request: { range, prefer, comment } }
    });

    log.debug('Alternate request processed', { 
      thread_id: thread.id, 
      new_proposal_version: newProposalVersion,
      new_propose_count: newProposeCount,
      slots_created: slotsToCreate.length
    });

    return c.json({
      success: true,
      new_proposal_version: newProposalVersion,
      slots: slotsToCreate,
      message: `新しい候補を${slotsToCreate.length}件生成しました`
    });

  } catch (error) {
    log.error('Request alternate error', { error: error instanceof Error ? error.message : String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;
