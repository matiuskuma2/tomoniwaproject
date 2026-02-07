/**
 * chat.ts
 * CONV-CHAT: AI秘書との会話API
 * 
 * POST /api/chat/message - 会話メッセージ送信
 * GET /api/chat/history - 会話履歴取得
 * 
 * 設計原則:
 * - 雑談を含む全ての会話に応答
 * - 会話履歴はDBに永続化
 * - コスト最適化（直近5ターンのみLLMに送信）
 * - 機能意図を検出したら既存intentへ誘導
 */

import { Hono } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import type { Variables } from '../middleware/auth';
import { getTenant } from '../utils/workspaceContext';

// ============================================================
// 定数
// ============================================================

const CHAT_CONFIG = {
  max_history_turns: 5,      // 直近5ターンのみLLMに送信
  max_tokens_response: 200,  // 応答は短く
  model: 'gpt-4o-mini',      // 低コストモデル
  temperature: 0.7,          // やや創造的
};

// 定型応答パターン（LLM呼び出しスキップ）
const QUICK_RESPONSES: Record<string, string> = {
  'こんにちは': 'こんにちは！今日は何かお手伝いできることはありますか？\n\n💡 「今日の予定」「来週の空き」「日程調整を送って」などと話しかけてください。',
  'こんばんは': 'こんばんは！今日は何かお手伝いできることはありますか？\n\n💡 「今日の予定」「来週の空き」「日程調整を送って」などと話しかけてください。',
  'おはよう': 'おはようございます！今日は何かお手伝いできることはありますか？\n\n💡 「今日の予定」「来週の空き」「日程調整を送って」などと話しかけてください。',
  'ありがとう': 'どういたしまして！他にお手伝いできることがあれば、いつでも声をかけてくださいね。',
  'お疲れ様': 'お疲れ様です！何かお手伝いできることがあれば教えてください。',
  'ヘルプ': '以下のようなことができます：\n\n📅 **予定確認**\n• 「今日の予定」\n• 「来週の空き」\n\n📨 **日程調整**\n• 「〇〇さんに日程調整送って」\n• 「状況教えて」\n\n👥 **連絡先登録**\n• 「〇〇さんを連絡先に追加」\n• テキストを貼り付けて登録\n\n⚙️ **好み設定**\n• 「午後がいい」\n• 「好み見せて」',
  'help': '以下のようなことができます：\n\n📅 **予定確認**\n• 「今日の予定」\n• 「来週の空き」\n\n📨 **日程調整**\n• 「〇〇さんに日程調整送って」\n• 「状況教えて」\n\n👥 **連絡先登録**\n• 「〇〇さんを連絡先に追加」\n• テキストを貼り付けて登録\n\n⚙️ **好み設定**\n• 「午後がいい」\n• 「好み見せて」',
  '使い方': '以下のようなことができます：\n\n📅 **予定確認**\n• 「今日の予定」\n• 「来週の空き」\n\n📨 **日程調整**\n• 「〇〇さんに日程調整送って」\n• 「状況教えて」\n\n👥 **連絡先登録**\n• 「〇〇さんを連絡先に追加」\n• テキストを貼り付けて登録\n\n⚙️ **好み設定**\n• 「午後がいい」\n• 「好み見せて」',
  '何ができる': '以下のようなことができます：\n\n📅 **予定確認**\n• 「今日の予定」\n• 「来週の空き」\n\n📨 **日程調整**\n• 「〇〇さんに日程調整送って」\n• 「状況教えて」\n\n👥 **連絡先登録**\n• 「〇〇さんを連絡先に追加」\n• テキストを貼り付けて登録\n\n⚙️ **好み設定**\n• 「午後がいい」\n• 「好み見せて」',
};

// ============================================================
// PR-D-1: インテント検出（contact.import）
// ============================================================

/**
 * contact.import インテントの検出パターン
 */
const CONTACT_IMPORT_PATTERNS = [
  // 明示的な登録指示
  /(?:連絡先|アドレス帳|コンタクト).*(?:追加|登録|取り込|インポート)/,
  /(?:追加|登録|取り込|インポート).*(?:連絡先|アドレス帳|コンタクト)/,
  // 名前とメールの組み合わせ検出
  /[\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+\s*[\w.-]+@[\w.-]+\.\w+/,
  // 複数行のメールリスト
  /(?:[\w.-]+@[\w.-]+\.\w+.*[\r\n]){2,}/,
  // 「〇〇を追加」パターン
  /(?:[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+さん|[\w\s]+)(?:を|は)?(?:連絡先に)?(?:追加|登録)/,
];

/**
 * テキストがcontact.importインテントかどうかを判定
 */
function detectContactImportIntent(text: string): {
  isMatch: boolean;
  confidence: number;
  source: 'text' | 'email';
  extractedText?: string;
} {
  // 複数行のメールリストを含む場合は高確度
  if (/(?:[\w.-]+@[\w.-]+\.\w+.*[\r\n]){2,}/.test(text)) {
    return { isMatch: true, confidence: 0.95, source: 'text', extractedText: text };
  }

  // 明示的な登録指示 + メールアドレスを含む
  const hasExplicitIntent = CONTACT_IMPORT_PATTERNS.slice(0, 2).some(p => p.test(text));
  const hasEmail = /[\w.-]+@[\w.-]+\.\w+/.test(text);
  
  if (hasExplicitIntent && hasEmail) {
    return { isMatch: true, confidence: 0.9, source: 'text', extractedText: text };
  }

  // 「〇〇 email@example.com を追加」パターン
  const singleContactPattern = /(.+?)\s*([\w.-]+@[\w.-]+\.\w+)\s*(?:を|は)?(?:連絡先に)?(?:追加|登録)/;
  const match = text.match(singleContactPattern);
  if (match) {
    const name = match[1].trim().replace(/さん$/, '');
    const email = match[2];
    return { 
      isMatch: true, 
      confidence: 0.85, 
      source: 'text', 
      extractedText: `${name} ${email}` 
    };
  }

  // 名前とメールが1行に含まれる場合
  if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+.*[\w.-]+@[\w.-]+\.\w+/.test(text)) {
    return { isMatch: true, confidence: 0.7, source: 'text', extractedText: text };
  }

  return { isMatch: false, confidence: 0, source: 'text' };
}

/**
 * contact.import のレスポンス生成
 */
interface ContactImportResponse {
  intent: 'contact.import.text';
  preview?: {
    candidates: Array<{
      raw_line: string;
      display_name: string | null;
      email: string | null;
      status: 'ok' | 'missing_email' | 'invalid_email' | 'parse_error';
    }>;
    valid_count: number;
    missing_email_count: number;
  };
  confirmation_token?: string;
  requires_confirmation: boolean;
  message: string;
}

// ============================================================
// System Prompt
// ============================================================

const SYSTEM_PROMPT = `あなたは「ともにわ」のAI秘書です。

## 役割
- ユーザーの予定調整をサポートする秘書
- 雑談にも自然に応答し、親しみやすい存在

## 応答ルール
1. 簡潔に応答する（2-3文以内）
2. 雑談でも「何かお手伝いできることはありますか？」で誘導
3. 予定調整に関する話題が出たら、具体的な機能を案内

## できること案内（ユーザーが困っていそうな場合）
- 今日の予定確認 → 「今日の予定」と言ってください
- 来週の空き時間確認 → 「来週の空き」と言ってください  
- 日程調整の送信 → 「〇〇さんに日程調整送って」と言ってください
- 好みの時間帯設定 → 「午後がいい」と言ってください

## 禁止事項
- 予定の確定や送信を勝手に行う約束をしない
- 個人情報や機密情報について言及しない
- 医療・法律・金融のアドバイスをしない
- 長文で応答しない（3文以内）

## 人格
- 名前: ともにわAI秘書
- 性格: 親切、簡潔、プロフェッショナル
- 口調: 丁寧語、フレンドリー`;

// ============================================================
// LLM呼び出し
// ============================================================

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

async function callLLM(
  messages: ChatMessage[],
  apiKey: string | undefined
): Promise<string> {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CHAT_CONFIG.model,
      temperature: CHAT_CONFIG.temperature,
      max_tokens: CHAT_CONFIG.max_tokens_response,
      messages,
    }),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`OpenAI API error: ${resp.status} - ${errorText}`);
  }

  const json = await resp.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json?.choices?.[0]?.message?.content;
  
  if (!text) {
    throw new Error('LLM returned empty content');
  }
  
  return text;
}

// ============================================================
// DB操作
// ============================================================

interface DbChatMessage {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  thread_id: string | null;
  intent: string | null;
  metadata: string | null;
  created_at: string;
}

/**
 * メッセージをDBに保存
 * テーブルが存在しない場合は警告ログを出力して処理を継続
 */
async function saveMessage(
  db: D1Database,
  workspaceId: string,
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  threadId?: string | null,
  intent?: string | null
): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO chat_messages (workspace_id, user_id, role, content, thread_id, intent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(workspaceId, userId, role, content, threadId ?? null, intent ?? null).run();
  } catch (e) {
    // テーブルが存在しない等のDBエラーは警告ログを出力して処理を継続
    // チャット機能自体は動作を継続する（履歴保存失敗は許容）
    console.warn('[chat] saveMessage failed (table may not exist)', e);
  }
}

/**
 * 直近の会話履歴を取得
 * テーブルが存在しない場合は空配列を返す
 */
async function getRecentHistory(
  db: D1Database,
  userId: string,
  limit: number = CHAT_CONFIG.max_history_turns * 2
): Promise<DbChatMessage[]> {
  try {
    const result = await db.prepare(`
      SELECT id, workspace_id, user_id, role, content, thread_id, intent, metadata, created_at
      FROM chat_messages
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(userId, limit).all<DbChatMessage>();
    
    // 古い順に並び替え
    return (result.results || []).reverse();
  } catch (e) {
    // テーブルが存在しない等のDBエラーは警告ログを出力して空配列を返す
    console.warn('[chat] getRecentHistory failed (table may not exist)', e);
    return [];
  }
}

// ============================================================
// Routes
// ============================================================

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /message
 * 
 * Request:
 * {
 *   "text": "こんにちは",
 *   "context": {
 *     "thread_id": "thread_xxx"
 *   }
 * }
 * 
 * Response:
 * {
 *   "message": "こんにちは！今日は何かお手伝いできることはありますか？"
 * }
 */
app.post('/message', async (c) => {
  const { env } = c;
  const { workspaceId } = getTenant(c);
  const userId = c.get('userId');
  
  if (!userId) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const body = await c.req.json<{
    text?: string;
    context?: {
      thread_id?: string | null;
    };
  }>();

  const text = (body.text || '').trim();
  const threadId = body.context?.thread_id ?? null;

  if (!text) {
    return c.json({
      message: '何かお手伝いできることはありますか？',
    });
  }

  // ユーザーメッセージを保存
  await saveMessage(env.DB, workspaceId, userId, 'user', text, threadId);

  // ============================================================
  // PR-D-1: contact.import インテント検出
  // ============================================================
  const importIntent = detectContactImportIntent(text);
  if (importIntent.isMatch && importIntent.confidence >= 0.7) {
    // contact.import インテントとして処理
    const extractedText = importIntent.extractedText || text;
    
    try {
      // /api/contacts/import を内部呼び出し
      const importResponse = await fetch(`${c.req.url.replace('/chat/message', '/contacts/import')}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': c.req.header('Authorization') || '',
          'Cookie': c.req.header('Cookie') || '',
        },
        body: JSON.stringify({
          text: extractedText,
          source: importIntent.source,
        }),
      });

      if (importResponse.ok) {
        const importResult = await importResponse.json() as {
          preview: {
            candidates: Array<{
              raw_line: string;
              display_name: string | null;
              email: string | null;
              status: string;
            }>;
            valid_count: number;
            missing_email_count: number;
            ambiguous_matches: Array<{
              candidate_name: string | null;
              candidate_email: string | null;
              reason: string;
            }>;
          };
          confirmation_token: string;
          message: string;
        };

        // 結果に基づいてメッセージを生成
        let responseMessage: string;
        
        if (importResult.preview.valid_count === 0) {
          responseMessage = '📋 連絡先の取り込みを試みましたが、有効なデータが見つかりませんでした。\n\n' +
            '以下の形式で入力してください：\n' +
            '• 「名前 メールアドレス」（例: 田中太郎 tanaka@example.com）\n' +
            '• 複数人は改行で区切ってください';
        } else if (importResult.preview.ambiguous_matches?.length > 0) {
          const ambiguousNames = importResult.preview.ambiguous_matches
            .map(m => m.candidate_name || m.candidate_email)
            .slice(0, 3)
            .join('、');
          responseMessage = `📋 ${importResult.preview.valid_count}件の連絡先を検出しました。\n\n` +
            `⚠️ **要確認**: ${importResult.preview.ambiguous_matches.length}件の曖昧な一致があります（${ambiguousNames}など）\n\n` +
            `この連絡先を登録しますか？ People Hub で確認して登録できます。`;
        } else {
          const candidates = importResult.preview.candidates
            .filter(c => c.status === 'ok')
            .slice(0, 5)
            .map(c => `• ${c.display_name || '(名前なし)'} <${c.email}>`)
            .join('\n');
          responseMessage = `📋 ${importResult.preview.valid_count}件の連絡先を検出しました：\n\n${candidates}` +
            (importResult.preview.valid_count > 5 ? `\n...他${importResult.preview.valid_count - 5}件` : '') +
            '\n\nこの連絡先を登録しますか？ People Hub で確認して登録できます。';
        }

        // アシスタント応答を保存
        await saveMessage(env.DB, workspaceId, userId, 'assistant', responseMessage, threadId, 'contact.import.text');

        return c.json({
          message: responseMessage,
          intent: 'contact.import.text',
          import_preview: importResult.preview,
          confirmation_token: importResult.confirmation_token,
          requires_confirmation: true,
        });
      }
    } catch (importError) {
      console.warn('[chat] contact.import internal call failed', importError);
      // インポート処理が失敗した場合は、通常のLLM処理にフォールバック
    }
  }

  // 定型応答チェック（LLMスキップ）
  const normalizedInput = text.toLowerCase().replace(/[！？。、]/g, '');
  for (const [pattern, response] of Object.entries(QUICK_RESPONSES)) {
    if (normalizedInput.includes(pattern.toLowerCase())) {
      // アシスタント応答も保存
      await saveMessage(env.DB, workspaceId, userId, 'assistant', response, threadId);
      return c.json({ message: response });
    }
  }

  try {
    // 過去の会話履歴を取得
    const history = await getRecentHistory(env.DB, userId);
    
    // LLM用メッセージを構築
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    // 現在のメッセージは既に履歴に含まれているので追加不要
    // （saveMessageで先に保存済み）

    // LLM呼び出し
    const response = await callLLM(messages, env.OPENAI_API_KEY);

    // アシスタント応答を保存
    await saveMessage(env.DB, workspaceId, userId, 'assistant', response, threadId);

    return c.json({ message: response });
  } catch (e) {
    console.error('[chat] LLM error', e, { workspaceId, userId, text });
    
    // エラー時のフォールバック応答
    const fallbackResponse = '申し訳ありません、少し問題が発生しました。\n\n以下のような指示ができます：\n• 「今日の予定」\n• 「来週の空き」\n• 「〇〇さんに日程調整送って」\n• 「〇〇さんを連絡先に追加」';
    
    await saveMessage(env.DB, workspaceId, userId, 'assistant', fallbackResponse, threadId);
    
    return c.json({ message: fallbackResponse });
  }
});

/**
 * GET /history
 * 
 * Response:
 * {
 *   "messages": [
 *     { "role": "user", "content": "...", "created_at": "..." },
 *     { "role": "assistant", "content": "...", "created_at": "..." }
 *   ]
 * }
 */
app.get('/history', async (c) => {
  const { env } = c;
  const userId = c.get('userId');
  
  if (!userId) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const limit = Number(c.req.query('limit')) || 20;
  
  const history = await getRecentHistory(env.DB, userId, limit);
  
  return c.json({
    messages: history.map(m => ({
      role: m.role,
      content: m.content,
      thread_id: m.thread_id,
      created_at: m.created_at,
    })),
  });
});

export default app;
