/**
 * Invite Executors - Phase 1-1
 * 
 * apiExecutor.ts から invite 系ロジックを分離
 * - executeInvitePrepareEmails: メール入力 → prepare API
 * - executeInvitePrepareList: リスト選択 → prepare API
 * - parseInviteLines: email + phone 抽出ヘルパー
 * - savePhonesToContacts: phone を contacts に保存
 */

import { threadsApi } from '../../api/threads';
import { listsApi } from '../../api/lists';
import { contactsApi } from '../../api/contacts';
import type { PrepareSendResponse } from '../../api/pendingActions';
import type { IntentResult } from '../intentClassifier';
import type { ExecutionResult } from './types';
import { log } from '../../platform';
// Phase 1-3b: buildPrepareMessage を shared から import
import { buildPrepareMessage } from './shared/prepareMessage';

// ============================================================
// Types
// ============================================================

/**
 * P2-E2: 招待者情報（email + optional phone）
 */
export interface ParsedInvitee {
  email: string;
  phone?: string;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * P2-E2: 入力行から email と phone を抽出
 * - 1行に email + phone を書ける（例: tanaka@example.com +819012345678）
 * - phone は E.164 形式のみ抽出（+81...）
 * - email のみの行も対応
 */
export function parseInviteLines(input: string): ParsedInvitee[] {
  const lines = input
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const e164Re = /\+[1-9]\d{9,14}/;

  const map = new Map<string, ParsedInvitee>();

  for (const line of lines) {
    // 1行内のすべてのメールアドレスを抽出
    const emailMatches = line.match(emailRe);
    if (!emailMatches) continue;

    // E.164電話番号を抽出（1行につき1つのみ）
    const phoneMatch = line.match(e164Re);
    const phone = phoneMatch?.[0];

    // 各メールアドレスに対して処理
    for (const rawEmail of emailMatches) {
      const email = rawEmail.toLowerCase();
      // 重複は後勝ち（phone付きで上書き）
      if (!map.has(email) || phone) {
        map.set(email, { email, phone });
      }
    }
  }

  return Array.from(map.values());
}

/**
 * P2-E2: phone があるものを contacts に保存
 * - 失敗しても invite フローは止めない
 */
export async function savePhonesToContacts(invitees: ParsedInvitee[]): Promise<void> {
  const withPhone = invitees.filter(i => !!i.phone);
  if (withPhone.length === 0) return;

  try {
    await Promise.all(
      withPhone.map(i =>
        contactsApi.upsertByEmail({
          email: i.email,
          phone: i.phone!,
        })
      )
    );
    log.info('[P2-E2] Saved phone numbers to contacts', { 
      module: 'invite', 
      count: withPhone.length 
    });
  } catch (e) {
    // 失敗しても invite は続行
    log.warn('[P2-E2] contacts phone upsert failed (ignored)', { 
      module: 'invite', 
      err: e 
    });
  }
}

// Phase 1-3b: buildPrepareMessage は shared/prepareMessage.ts に移動
// re-export for backward compatibility
export { buildPrepareMessage } from './shared/prepareMessage';

// ============================================================
// Executors
// ============================================================

/**
 * Beta A: メール入力 → prepare API
 * - スレッド未選択: prepareSend (新規スレッド)
 * - スレッド選択中: prepareInvites (追加招待)
 * P2-E2: email + phone の同時入力に対応（SMS送信用）
 */
export async function executeInvitePrepareEmails(intentResult: IntentResult): Promise<ExecutionResult> {
  const { emails, threadId, mode, rawText } = intentResult.params;
  
  if (!emails || emails.length === 0) {
    return {
      success: false,
      message: '送信先のメールアドレスを入力してください。',
      needsClarification: {
        field: 'emails',
        message: '送信先のメールアドレスを貼ってください。\n\n例:\n• tanaka@example.com\n• tanaka@example.com +819012345678 (SMS送信する場合)',
      },
    };
  }
  
  // P2-E2: rawText から email + phone を抽出し、contacts に保存
  if (rawText) {
    const invitees = parseInviteLines(rawText);
    await savePhonesToContacts(invitees);
  }
  
  try {
    let response: PrepareSendResponse;
    
    if (threadId && mode === 'add_to_thread') {
      // スレッド選択中: 追加招待
      response = await threadsApi.prepareInvites(threadId, {
        source_type: 'emails',
        emails,
      });
    } else {
      // スレッド未選択: 新規作成
      response = await threadsApi.prepareSend({
        source_type: 'emails',
        emails,
        title: '日程調整',
      });
    }
    
    // Build message from response
    const message = response.message_for_chat || buildPrepareMessage(response);
    
    return {
      success: true,
      message,
      data: {
        kind: 'pending.action.created',
        payload: {
          confirmToken: response.confirm_token,
          expiresAt: response.expires_at,
          summary: response.summary,
          mode: threadId ? 'add_to_thread' : 'new_thread',
          threadId: response.thread_id,
          threadTitle: response.thread_title,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * Beta A: リスト選択 → prepare API
 */
export async function executeInvitePrepareList(intentResult: IntentResult): Promise<ExecutionResult> {
  const { listName, threadId } = intentResult.params;
  
  if (!listName) {
    return {
      success: false,
      message: 'リスト名を指定してください。',
      needsClarification: {
        field: 'listName',
        message: 'どのリストに招待を送りますか？\n\n例: 「営業部リストに招待」',
      },
    };
  }
  
  try {
    // リストIDを取得
    const listsResponse = await listsApi.list() as any;
    const lists = listsResponse.lists || listsResponse.items || [];
    const targetList = lists.find((l: any) => l.name === listName || l.name.includes(listName));
    
    if (!targetList) {
      return {
        success: false,
        message: `❌ リスト「${listName}」が見つかりませんでした。\n\n利用可能なリスト:\n${lists.map((l: any) => `- ${l.name}`).join('\n')}`,
      };
    }
    
    let response: PrepareSendResponse;
    
    if (threadId) {
      // スレッド選択中: 追加招待
      response = await threadsApi.prepareInvites(threadId, {
        source_type: 'list',
        list_id: targetList.id,
      });
    } else {
      // スレッド未選択: 新規作成
      response = await threadsApi.prepareSend({
        source_type: 'list',
        list_id: targetList.id,
        title: '日程調整',
      });
    }
    
    const message = response.message_for_chat || buildPrepareMessage(response);
    
    return {
      success: true,
      message,
      data: {
        kind: 'pending.action.created',
        payload: {
          confirmToken: response.confirm_token,
          expiresAt: response.expires_at,
          summary: response.summary,
          mode: threadId ? 'add_to_thread' : 'new_thread',
          threadId: response.thread_id,
          threadTitle: response.thread_title,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}
