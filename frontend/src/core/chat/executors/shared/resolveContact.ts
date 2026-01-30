/**
 * resolveContact.ts
 * Phase 2: 名前→連絡先解決ユーティリティ
 * 
 * 入力: { name?: string; email?: string }
 * 出力: ResolveContactResult
 * 
 * ルール:
 * - email がある → contacts 検索せずそのまま使う（type: 'resolved'）
 * - name のみ → contacts を検索
 *   - 1件ヒット＆email あり → 確定（type: 'resolved'）
 *   - 1件ヒット＆email なし → 送信不可（type: 'not_found'）
 *   - 複数ヒット → 候補提示（type: 'needs_selection'）
 *   - 0件 → 見つからない（type: 'not_found'）
 * 
 * 例外ルール:
 * - 複数ヒット時、email が空の候補は候補リストから除外（送れないので）
 * - 1件ヒットでも email が無い場合は not_found 扱い
 */

import { contactsApi } from '../../../api/contacts';
import type { Contact } from '../../../models';
import { log } from '../../../platform';

// ============================================================
// Types
// ============================================================

export interface PersonInput {
  name?: string;
  email?: string;
}

export interface ResolvedContact {
  contact_id: string;
  display_name: string;
  email: string;  // 必須（送信可能な連絡先のみ resolved にする）
}

export interface ContactCandidate {
  contact_id: string;
  display_name: string;
  email?: string;  // 表示用（email なしでも候補として見せる場合がある）
}

export type ResolveContactResult =
  | { type: 'resolved'; contact: ResolvedContact }
  | { type: 'needs_selection'; candidates: ContactCandidate[]; query_name: string }
  | { type: 'not_found'; query_name: string; reason: 'no_match' | 'no_email' }
  | { type: 'invalid'; reason: string };

// ============================================================
// Constants
// ============================================================

/** 敬称パターン（名前から除去する） */
const HONORIFIC_PATTERN = /(さん|くん|氏|様|先生|殿)$/;

/** 候補の最大数 */
const MAX_CANDIDATES = 5;

// ============================================================
// Helper Functions
// ============================================================

/**
 * 敬称を除去して名前を正規化
 * 「大島くん」→「大島」
 * 「田中様」→「田中」
 */
export function normalizePersonName(name: string): string {
  return name.trim().replace(HONORIFIC_PATTERN, '').trim();
}

/**
 * email 形式かどうかを判定
 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ============================================================
// Main Function
// ============================================================

/**
 * 名前/email から連絡先を解決する
 * 
 * @param person - { name?, email? }
 * @returns ResolveContactResult
 */
export async function resolveContact(person: PersonInput): Promise<ResolveContactResult> {
  log.debug('[resolveContact] Input', { person });

  // Case 1: email が直接指定されている場合
  if (person.email) {
    if (!isValidEmail(person.email)) {
      return { type: 'invalid', reason: `無効なメールアドレス形式: ${person.email}` };
    }
    
    // email がある場合は contacts 検索せずそのまま resolved として返す
    // ※ contacts に存在しない外部メールでも送信可能にするため
    return {
      type: 'resolved',
      contact: {
        contact_id: '', // 新規外部メールの場合は空
        display_name: person.name || person.email.split('@')[0],
        email: person.email,
      },
    };
  }

  // Case 2: name のみの場合 → contacts 検索
  if (!person.name) {
    return { type: 'invalid', reason: '名前またはメールアドレスが必要です' };
  }

  const normalizedName = normalizePersonName(person.name);
  log.debug('[resolveContact] Searching contacts', { originalName: person.name, normalizedName });

  try {
    // contacts API で検索
    const response = await contactsApi.list({ q: normalizedName, limit: 10 });
    
    // API レスポンスの形式を確認（contacts または items）
    const contacts: Contact[] = (response as any).contacts || (response as any).items || [];
    
    log.debug('[resolveContact] Search result', { 
      query: normalizedName, 
      hitCount: contacts.length,
      contacts: contacts.map(c => ({ id: c.id, name: c.display_name, email: c.email }))
    });

    // Case 2a: 0件ヒット
    if (contacts.length === 0) {
      return {
        type: 'not_found',
        query_name: person.name,
        reason: 'no_match',
      };
    }

    // email がある連絡先のみをフィルタリング（送信可能な連絡先）
    const contactsWithEmail = contacts.filter(c => c.email && isValidEmail(c.email));

    // Case 2b: email を持つ連絡先が0件
    if (contactsWithEmail.length === 0) {
      return {
        type: 'not_found',
        query_name: person.name,
        reason: 'no_email',
      };
    }

    // Case 2c: 1件のみヒット → 確定
    if (contactsWithEmail.length === 1) {
      const contact = contactsWithEmail[0];
      return {
        type: 'resolved',
        contact: {
          contact_id: contact.id,
          display_name: contact.display_name || person.name,
          email: contact.email!,
        },
      };
    }

    // Case 2d: 複数件ヒット → 候補提示
    const candidates: ContactCandidate[] = contactsWithEmail
      .slice(0, MAX_CANDIDATES)
      .map(c => ({
        contact_id: c.id,
        display_name: c.display_name || '名前なし',
        email: c.email,
      }));

    return {
      type: 'needs_selection',
      candidates,
      query_name: person.name,
    };

  } catch (error) {
    log.error('[resolveContact] API error', { error });
    return {
      type: 'invalid',
      reason: `連絡先の検索中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================
// Utility for Executor Integration
// ============================================================

/**
 * ResolveContactResult から pending 用のメッセージを生成
 */
export function formatResolveContactMessage(result: ResolveContactResult): string {
  switch (result.type) {
    case 'resolved':
      return `${result.contact.display_name}さん（${result.contact.email}）を選択しました。`;

    case 'needs_selection': {
      const candidateList = result.candidates
        .map((c, i) => `${i + 1}. ${c.display_name}${c.email ? ` (${c.email})` : ''}`)
        .join('\n');
      return `「${result.query_name}」に該当する連絡先が複数見つかりました。番号で選んでください：\n\n${candidateList}`;
    }

    case 'not_found':
      if (result.reason === 'no_email') {
        return `「${result.query_name}」さんが見つかりましたが、メールアドレスが登録されていません。連絡先にメールアドレスを追加するか、別の方を指定してください。`;
      }
      return `「${result.query_name}」さんが連絡先に見つかりませんでした。正確な名前を入力するか、連絡先に登録してください。`;

    case 'invalid':
      return result.reason;
  }
}
