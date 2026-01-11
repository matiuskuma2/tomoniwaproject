/**
 * External Invite Routes (Ticket 10)
 * 
 * TimeRex/Spear型の外部招待体験
 * - モバイルファースト
 * - 視覚フィードバック豊富
 * - エラー状態を明確に伝える
 */

import { Hono } from 'hono';
import { ThreadsRepository } from '../repositories/threadsRepository';
import { InboxRepository } from '../repositories/inboxRepository';
import type { Env } from '../../../../packages/shared/src/types/env';

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
      <style>
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-in {
          animation: fadeIn 0.3s ease-out;
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
      </style>
    </head>
  `;
}

/**
 * エラー画面HTML生成
 */
function errorPage(type: 'not-found' | 'expired' | 'already-responded', details?: any): string {
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
    <body class="bg-gray-100 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white p-8 rounded-lg shadow-lg max-w-md w-full text-center fade-in">
        <div class="text-6xl mb-4">${config.icon}</div>
        <h1 class="text-2xl font-bold text-${config.color}-600 mb-4">${config.title}</h1>
        <p class="text-gray-700 leading-relaxed">${config.message}</p>
      </div>
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

    // Get available slots（カラム名修正: start_time → start_at）
    const { results: slots } = await env.DB.prepare(`
      SELECT slot_id, start_at, end_at, timezone FROM scheduling_slots 
      WHERE thread_id = ? 
      ORDER BY start_at ASC
    `).bind(invite.thread_id).all();

    const slotsHtml = slots && slots.length > 0 ? `
      <div class="mb-6">
        <h3 class="font-semibold text-gray-800 mb-3">候補日時を選択してください：</h3>
        <div id="slots" class="space-y-3">
          ${slots.map((slot: any, index: number) => {
            const startTime = formatDateTimeJP(slot.start_at);
            const endTime = new Date(slot.end_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
            return `
            <label class="slot-card block p-4 border-2 border-gray-200 rounded-lg cursor-pointer ${index === 0 ? 'selected' : ''}">
              <input 
                type="radio" 
                name="slot" 
                value="${slot.slot_id}" 
                class="hidden"
                ${index === 0 ? 'checked' : ''}
                onchange="updateSelection(this)"
              />
              <div class="flex items-center">
                <div class="flex-shrink-0 w-6 h-6 rounded-full border-2 border-gray-300 flex items-center justify-center mr-3 check-circle">
                  <div class="w-3 h-3 rounded-full bg-blue-500 hidden check-inner"></div>
                </div>
                <div class="flex-1">
                  <div class="font-semibold text-gray-900">${startTime}</div>
                  <div class="text-sm text-gray-600">${endTime}まで</div>
                  ${slot.timezone ? `<div class="text-xs text-gray-500 mt-1">${slot.timezone}</div>` : ''}
                </div>
              </div>
            </label>
          `}).join('')}
        </div>
      </div>
    ` : '';

    return c.html(`
      ${getHtmlHead('日程調整のご案内')}
      <body class="bg-gray-100 flex items-center justify-center min-h-screen p-4">
        <div class="bg-white p-6 sm:p-8 rounded-lg shadow-lg max-w-2xl w-full fade-in">
          <h1 class="text-2xl sm:text-3xl font-bold text-gray-800 mb-4">日程調整のご案内</h1>
          
          <div class="bg-blue-50 p-4 rounded-lg mb-6">
            <h2 class="text-lg sm:text-xl font-semibold text-blue-900 mb-2">${thread?.title || '会議'}</h2>
            ${thread?.description ? `<p class="text-gray-700 text-sm sm:text-base">${thread.description}</p>` : ''}
          </div>

          <div class="mb-6 bg-gray-50 p-4 rounded-lg">
            <h3 class="font-semibold text-gray-800 mb-2">招待理由：</h3>
            <p class="text-gray-700 text-sm sm:text-base italic">"${invite.candidate_reason || 'あなたに参加していただきたく、ご案内しています。'}"</p>
          </div>

          ${slotsHtml}

          <div class="flex flex-col sm:flex-row gap-3 mb-4">
            <button 
              id="acceptBtn"
              onclick="selectSlot()"
              class="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition flex items-center justify-center"
            >
              <span id="acceptText">${slots && slots.length > 0 ? 'この日程で参加する' : '参加する'}</span>
              <div id="acceptSpinner" class="spinner ml-2 hidden"></div>
            </button>
            <button 
              id="declineBtn"
              onclick="declineInvite()"
              class="flex-1 bg-gray-300 hover:bg-gray-400 disabled:bg-gray-200 text-gray-800 font-semibold py-3 px-6 rounded-lg transition flex items-center justify-center"
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
                <div class="text-sm">インターネット接続を確認して、もう一度お試しください。</div>
              </div>
            </div>
          </div>

          <p class="text-xs sm:text-sm text-gray-500 text-center">
            この招待は <strong>${formatDateTimeJP(invite.expires_at)}</strong> まで有効です
          </p>
        </div>

        <script>
          function updateSelection(radio) {
            // Update visual feedback
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
            const text = document.getElementById(btnId.replace('Btn', 'Text'));
            const spinner = document.getElementById(btnId.replace('Btn', 'Spinner'));
            
            btn.disabled = loading;
            if (loading) {
              spinner.classList.remove('hidden');
            } else {
              spinner.classList.add('hidden');
            }
          }

          function showError(message) {
            const errorDiv = document.getElementById('errorMessage');
            if (message) {
              errorDiv.querySelector('div.text-sm').textContent = message;
              errorDiv.classList.remove('hidden');
              setTimeout(() => errorDiv.classList.add('hidden'), 5000);
            }
          }

          async function selectSlot() {
            try {
              setLoading('acceptBtn', true);
              setLoading('declineBtn', true);
              
              const selectedSlotRadio = document.querySelector('input[name="slot"]:checked');
              const selectedSlotId = selectedSlotRadio ? selectedSlotRadio.value : null;

              const response = await fetch('/i/${token}/respond', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  status: 'selected',
                  selected_slot_id: selectedSlotId
                })
              });
              
              if (response.ok) {
                const data = await response.json();
                const selectedSlotLabel = selectedSlotRadio 
                  ? selectedSlotRadio.closest('.slot-card').querySelector('.font-semibold').textContent
                  : '';
                
                document.body.innerHTML = \`
                  <div class="bg-gray-100 flex items-center justify-center min-h-screen p-4">
                    <div class="bg-white p-8 rounded-lg shadow-lg max-w-md w-full text-center fade-in">
                      <div class="text-green-600 text-6xl mb-4">✓</div>
                      <h1 class="text-2xl font-bold text-gray-800 mb-4">日程を選択しました</h1>
                      <div class="bg-green-50 p-4 rounded-lg mb-4">
                        <p class="text-sm text-gray-600 mb-1">選択した日程：</p>
                        <p class="font-semibold text-gray-900">\${selectedSlotLabel}</p>
                      </div>
                      <p class="text-gray-700 mb-2">主催者が確定すると、メールで通知が届きます。</p>
                      <p class="text-gray-700 mb-4">しばらくお待ちください。</p>
                      <p class="text-sm text-gray-500">このページは閉じて構いません</p>
                    </div>
                  </div>
                \`;
              } else {
                const error = await response.json();
                showError(error.error || '送信に失敗しました。もう一度お試しください。');
                setLoading('acceptBtn', false);
                setLoading('declineBtn', false);
              }
            } catch (error) {
              console.error('Network error:', error);
              showError('ネットワークエラーが発生しました。接続を確認してください。');
              setLoading('acceptBtn', false);
              setLoading('declineBtn', false);
            }
          }

          async function declineInvite() {
            if (!confirm('本当に辞退しますか？\\n\\n主催者には自動で通知されます。')) {
              return;
            }

            try {
              setLoading('acceptBtn', true);
              setLoading('declineBtn', true);
              
              const response = await fetch('/i/${token}/respond', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  status: 'declined'
                })
              });

              if (response.ok) {
                document.body.innerHTML = \`
                  <div class="bg-gray-100 flex items-center justify-center min-h-screen p-4">
                    <div class="bg-white p-8 rounded-lg shadow-lg max-w-md w-full text-center fade-in">
                      <div class="text-gray-600 text-6xl mb-4">✗</div>
                      <h1 class="text-2xl font-bold text-gray-800 mb-4">参加を辞退しました</h1>
                      <p class="text-gray-700 mb-2">ご都合が合わなかったようで残念です。</p>
                      <p class="text-gray-700 mb-4">主催者には自動で通知されます。</p>
                      <p class="text-gray-600">またの機会にご参加ください。</p>
                    </div>
                  </div>
                \`;
              } else {
                const error = await response.json();
                showError(error.error || '送信に失敗しました。もう一度お試しください。');
                setLoading('acceptBtn', false);
                setLoading('declineBtn', false);
              }
            } catch (error) {
              console.error('Network error:', error);
              showError('ネットワークエラーが発生しました。接続を確認してください。');
              setLoading('acceptBtn', false);
              setLoading('declineBtn', false);
            }
          }

          // Initialize first slot selection
          document.addEventListener('DOMContentLoaded', () => {
            const firstRadio = document.querySelector('input[name="slot"]:checked');
            if (firstRadio) {
              updateSelection(firstRadio);
            }
          });
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('[Invite] Error:', error);
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
      // Phase2: proposal_version_at_response を書き込む
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
        ? `${invite.candidate_name}さんが日程候補を選択しました`
        : `${invite.candidate_name}さんが辞退しました`;

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
    console.error('[Invite] Respond error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;
