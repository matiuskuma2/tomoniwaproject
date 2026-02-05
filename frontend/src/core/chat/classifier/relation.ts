/**
 * classifier/relation.ts
 * D0: 関係性管理（仕事仲間申請/承諾/拒否）の分類
 * 
 * 優先順位:
 * - pendingDecision より後（pending.action の判定優先）
 * - confirmCancel より後（はい/いいえ優先）
 */

import type { IntentResult, IntentContext, ClassifierFn } from './types';
import type { PendingState } from '../pendingTypes';
import { extractEmails, extractNames } from './utils';

/**
 * D0 関係性分類器
 * 
 * 対応パターン:
 * - 「〇〇さんを仕事仲間に追加」「〇〇と仕事仲間になりたい」
 * - 「〇〇@example.com を仕事仲間に」
 * - 「承諾」「承認」「はい」（inbox pending がある場合）
 * - 「拒否」「お断り」「いいえ」（inbox pending がある場合）
 */
export const classifyRelation: ClassifierFn = (
  input: string,
  normalizedInput: string,
  _context: IntentContext | undefined, // Prefixed: may be used in future for context-aware classification
  _activePending: PendingState | null
): IntentResult | null => {
  // ----------------------------------------------------------------
  // 1. 仕事仲間申請パターン
  // ----------------------------------------------------------------
  const workmateRequestPatterns = [
    /(.+?)を?仕事仲間に(追加|する|なりたい|申請)/,
    /(.+?)と仕事仲間になりたい/,
    /(.+?)に(仕事仲間)?申請/,
    /仕事仲間に(.+?)を?(追加|する)/,
    /(.+?)をワークメイトに/i,
    /(.+?)とつながりたい/,
    /(.+?)を(連絡先|知り合い)に(追加|登録)/,
  ];

  for (const pattern of workmateRequestPatterns) {
    const match = input.match(pattern);
    if (match) {
      const targetText = match[1]?.trim();
      
      // メールアドレス抽出
      const emails = extractEmails(targetText || input);
      if (emails.length > 0) {
        return {
          intent: 'relation.request.workmate',
          confidence: 0.9,
          params: {
            email: emails[0],
            rawInput: input,
          },
        };
      }
      
      // 名前抽出
      const names = extractNames(targetText || input);
      if (names.length > 0) {
        return {
          intent: 'relation.request.workmate',
          confidence: 0.85,
          params: {
            name: names[0],
            rawInput: input,
          },
        };
      }
      
      // ターゲットが特定できない場合
      if (targetText && targetText.length > 0 && targetText.length < 50) {
        return {
          intent: 'relation.request.workmate',
          confidence: 0.8,
          params: {
            name: targetText,
            rawInput: input,
          },
        };
      }
    }
  }

  // シンプルなパターン: 「仕事仲間申請」「workmate request」など
  if (/仕事仲間(を?)申請|仕事仲間(に?)追加|workmate\s*request/i.test(normalizedInput)) {
    // ターゲットを抽出
    const emails = extractEmails(input);
    const names = extractNames(input);
    
    return {
      intent: 'relation.request.workmate',
      confidence: 0.75,
      params: {
        email: emails[0] || undefined,
        name: names[0] || undefined,
        rawInput: input,
      },
    };
  }

  // ----------------------------------------------------------------
  // 2. 承諾パターン（inbox の pending がある前提で分類）
  //    ※ 実際の承諾は token が必要なので executor 側で処理
  // ----------------------------------------------------------------
  // 注: 現状 approve/decline は inbox UI から直接呼ばれるので、
  //     チャットからの分類は最小限にする
  //     将来的に「受信箱の申請を承諾」などのパターンを追加可能

  // ----------------------------------------------------------------
  // マッチしなかった場合
  // ----------------------------------------------------------------
  return null;
};
