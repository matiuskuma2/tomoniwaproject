/**
 * Group Invite Routes - 1対N 参加者向け回答ページ
 * 
 * /g/:token - 招待トークンから回答ページを表示
 * 
 * @see docs/plans/G1-PLAN.md
 */

import { Hono } from 'hono';
import { OneToManyRepository } from '../repositories/oneToManyRepository';
import { ThreadsRepository } from '../repositories/threadsRepository';
import type { Env } from '../../../../packages/shared/src/types/env';
import { createLogger } from '../utils/logger';

const app = new Hono<{ Bindings: Env }>();

// ============================================================
// ユーティリティ
// ============================================================

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

function formatTimeJP(dateStr: string): string {
  const date = new Date(dateStr);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

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
        .btn-primary {
          background: linear-gradient(135deg, #10B981 0%, #059669 100%);
          transition: all 0.2s ease;
        }
        .btn-primary:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
        }
        .btn-secondary {
          background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%);
          transition: all 0.2s ease;
        }
        .btn-secondary:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
        }
        .btn-maybe {
          background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);
          transition: all 0.2s ease;
        }
        .btn-maybe:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
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

function errorPage(type: 'not-found' | 'expired' | 'already-responded' | 'confirmed', details?: { expires_at?: string; response?: string }): string {
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
      message: `あなたの回答: ${details?.response === 'ok' ? '参加可能' : details?.response === 'no' ? '参加不可' : '未定'}<br><br>変更が必要な場合は、主催者にお問い合わせください。`,
      color: 'blue'
    },
    'confirmed': {
      icon: '✅',
      title: 'この予定は確定済みです',
      message: '主催者により日程が確定されました。<br>詳細は別途ご連絡があります。',
      color: 'green'
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

function successPage(response: 'ok' | 'no' | 'maybe', threadTitle: string): string {
  const messages = {
    ok: { icon: '✅', title: '参加可能と回答しました', color: 'green' },
    no: { icon: '❌', title: '参加不可と回答しました', color: 'red' },
    maybe: { icon: '🤔', title: '未定と回答しました', color: 'amber' },
  };
  const msg = messages[response];

  return `
    ${getHtmlHead('回答完了')}
    <body class="bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center fade-in">
        <div class="text-6xl mb-4">${msg.icon}</div>
        <h1 class="text-2xl font-bold text-${msg.color}-600 mb-4">${msg.title}</h1>
        <p class="text-gray-700 mb-6">「${threadTitle}」への回答を受け付けました。</p>
        <p class="text-sm text-gray-500">このページを閉じても問題ありません。</p>
      </div>
    </body>
    </html>
  `;
}

// ============================================================
// GET /g/:token - 回答フォーム表示
// ============================================================

app.get('/:token', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'GroupInvite', handler: 'getForm' });
  const token = c.req.param('token');

  try {
    // 招待を取得
    const threadsRepo = new ThreadsRepository(env.DB);
    const invite = await threadsRepo.getInviteByToken(token);

    if (!invite) {
      return c.html(errorPage('not-found'));
    }

    // 期限チェック
    if (new Date(invite.expires_at) < new Date()) {
      return c.html(errorPage('expired', { expires_at: invite.expires_at }));
    }

    // スレッドを取得
    const oneToManyRepo = new OneToManyRepository(env.DB);
    const thread = await oneToManyRepo.getById(invite.thread_id);

    if (!thread) {
      return c.html(errorPage('not-found'));
    }

    // 確定済みチェック
    if (thread.status === 'confirmed') {
      return c.html(errorPage('confirmed'));
    }

    // 既存の回答をチェック
    const existingResponse = await oneToManyRepo.getResponseByInvitee(
      thread.id, 
      invite.invitee_key || `e:${token.substring(0, 16)}`
    );

    if (existingResponse) {
      return c.html(errorPage('already-responded', { response: existingResponse.response }));
    }

    // スロットを取得
    const { results: slots } = await env.DB.prepare(`
      SELECT * FROM scheduling_slots WHERE thread_id = ? ORDER BY start_at ASC
    `).bind(thread.id).all<any>();

    const groupPolicy = thread.group_policy_json ? JSON.parse(thread.group_policy_json) : null;

    // 回答フォームを表示
    return c.html(renderResponseForm(
      thread,
      invite,
      slots || [],
      groupPolicy,
      token
    ));
  } catch (error) {
    log.error('Error in GET /g/:token', error);
    return c.html(errorPage('not-found'));
  }
});

// ============================================================
// POST /g/:token/respond - 回答送信
// ============================================================

app.post('/:token/respond', async (c) => {
  const { env } = c;
  const log = createLogger(env, { module: 'GroupInvite', handler: 'respond' });
  const token = c.req.param('token');

  try {
    const body = await c.req.parseBody();
    const response = body.response as 'ok' | 'no' | 'maybe';
    const selectedSlotId = body.selected_slot_id as string | undefined;

    if (!response || !['ok', 'no', 'maybe'].includes(response)) {
      return c.text('Invalid response', 400);
    }

    // 招待を取得
    const threadsRepo = new ThreadsRepository(env.DB);
    const invite = await threadsRepo.getInviteByToken(token);

    if (!invite) {
      return c.html(errorPage('not-found'));
    }

    // スレッドを取得
    const oneToManyRepo = new OneToManyRepository(env.DB);
    const thread = await oneToManyRepo.getById(invite.thread_id);

    if (!thread) {
      return c.html(errorPage('not-found'));
    }

    // 回答を登録
    const inviteeKey = invite.invitee_key || `e:${token.substring(0, 16)}`;
    await oneToManyRepo.addResponse({
      thread_id: thread.id,
      invitee_key: inviteeKey,
      response,
      selected_slot_id: selectedSlotId,
    });

    // thread_invites のステータスも更新
    await env.DB.prepare(`
      UPDATE thread_invites SET status = 'accepted', accepted_at = datetime('now') WHERE token = ?
    `).bind(token).run();

    log.info('Group invite response recorded', { threadId: thread.id, inviteeKey, response });

    return c.html(successPage(response, thread.title || '予定調整'));
  } catch (error) {
    log.error('Error in POST /g/:token/respond', error);
    return c.html(errorPage('not-found'));
  }
});

// ============================================================
// 回答フォーム HTML
// ============================================================

function renderResponseForm(
  thread: any,
  invite: any,
  slots: any[],
  groupPolicy: any,
  token: string
): string {
  const mode = groupPolicy?.mode || 'candidates';
  const deadline = groupPolicy?.deadline_at 
    ? formatDateTimeJP(groupPolicy.deadline_at)
    : null;

  const slotsHtml = slots.map((slot, index) => `
    <label class="slot-card block border-2 border-gray-200 rounded-xl p-4 cursor-pointer mb-3">
      <div class="flex items-center">
        <input type="radio" name="selected_slot_id" value="${slot.slot_id}" class="mr-3 w-5 h-5 text-blue-600" ${index === 0 ? 'checked' : ''}>
        <div class="flex-1">
          <div class="font-medium text-gray-800">
            ${formatDateTimeJP(slot.start_at)}
          </div>
          <div class="text-sm text-gray-500">
            〜 ${formatTimeJP(slot.end_at)}
          </div>
          ${slot.label ? `<div class="text-xs text-gray-400 mt-1">${slot.label}</div>` : ''}
        </div>
      </div>
    </label>
  `).join('');

  return `
    ${getHtmlHead('日程調整への回答')}
    <body class="bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center min-h-screen p-4">
      <div class="bg-white p-6 sm:p-8 rounded-2xl shadow-xl max-w-lg w-full fade-in">
        
        <!-- ヘッダー -->
        <div class="text-center mb-6">
          <div class="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
            <svg class="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
            </svg>
          </div>
          <h1 class="text-2xl font-bold text-gray-800">日程調整への回答</h1>
          <p class="text-gray-600 mt-1">${thread.title || '予定調整'}</p>
          ${thread.description ? `<p class="text-sm text-gray-500 mt-2">${thread.description}</p>` : ''}
        </div>

        <!-- 招待情報 -->
        <div class="bg-gray-50 rounded-xl p-4 mb-6">
          <p class="text-sm text-gray-600">
            <span class="font-medium">${invite.candidate_name}</span> 様への招待
          </p>
          ${deadline ? `<p class="text-xs text-gray-500 mt-1">回答期限: ${deadline}</p>` : ''}
        </div>

        <form action="/g/${token}/respond" method="POST" id="responseForm">
          <input type="hidden" name="response" id="responseInput" value="">
          ${slots.length > 0 ? `
            <!-- 候補日時 -->
            <div class="mb-6">
              <h2 class="text-sm font-medium text-gray-700 mb-3">希望日時を選択</h2>
              ${slotsHtml}
            </div>
          ` : ''}

          <!-- 回答ボタン -->
          <div class="space-y-3">
            <button type="button" data-response="ok" class="btn-primary w-full py-4 rounded-xl text-white font-bold text-lg shadow-lg response-btn">
              ✓ 参加可能
            </button>
            <button type="button" data-response="maybe" class="btn-maybe w-full py-3 rounded-xl text-white font-medium response-btn">
              🤔 未定（後で決める）
            </button>
            <button type="button" data-response="no" class="btn-secondary w-full py-3 rounded-xl text-white font-medium response-btn">
              ✕ 参加不可
            </button>
          </div>
        </form>

      </div>

      <script>
        // 候補選択時のハイライト
        document.querySelectorAll('.slot-card').forEach(card => {
          const radio = card.querySelector('input[type="radio"]');
          radio.addEventListener('change', () => {
            document.querySelectorAll('.slot-card').forEach(c => c.classList.remove('selected'));
            if (radio.checked) {
              card.classList.add('selected');
            }
          });
          // 初期状態
          if (radio.checked) {
            card.classList.add('selected');
          }
        });

        // 回答ボタンのクリックハンドラー
        document.querySelectorAll('.response-btn').forEach(btn => {
          btn.addEventListener('click', function() {
            const responseValue = this.getAttribute('data-response');
            document.getElementById('responseInput').value = responseValue;
            
            // ローディング表示
            document.querySelectorAll('.response-btn').forEach(b => b.disabled = true);
            this.innerHTML = '<span class="spinner inline-block mr-2"></span>送信中...';
            
            // フォーム送信
            document.getElementById('responseForm').submit();
          });
        });
      </script>
    </body>
    </html>
  `;
}

export default app;
