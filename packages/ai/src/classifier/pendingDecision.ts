/**
 * Classifier: Pending Decision
 * 
 * pending中に「はい/いいえ」が入力されたときに最優先で拾う。
 * 
 * 重要設計:
 * - pending.contact_import.confirm のYES/NOはここでは拾わない
 *   → classifyContactImport が先に判定する（優先順位で制御）
 * - ここで拾うのは send_invites / finalize_thread / cancel_thread のYES/NO
 * - contact_import系がpendingの時は、このclassifierはスキップする
 * 
 * これにより「はい/いいえ」が pendingDecision と contact_import.confirm で
 * 衝突する事故を完全に防ぐ。
 */

import type { IClassifier, ClassifierContext, ClassifiedIntent } from './types';
import { PENDING_CONFIRMATION_KIND } from '../../../../packages/shared/src/types/pendingAction';

// YES判定パターン
const YES_PATTERNS = [
  /^(はい|うん|yes|ok|おk|いいよ|いいです|お願い|送って|確定|決定|実行|する|了解|りょ|おけ)$/i,
  /^(y|yes|ok|sure|go|do it|confirm|send)$/i,
  /^(はい。?|うん。?|yes\.?|ok\.?)$/i,
];

// NO判定パターン
const NO_PATTERNS = [
  /^(いいえ|いや|no|だめ|やめ|やめて|キャンセル|取り消|中止|しない|やめる|やめとく|やっぱ|nah)$/i,
  /^(n|no|nope|cancel|abort|stop)$/i,
  /^(いいえ。?|いや。?|no\.?|だめ。?)$/i,
];

// contact_import系のpending kind（ここでは拾わない）
const CONTACT_IMPORT_KINDS: ReadonlySet<string> = new Set([
  PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_CONFIRM,
  PENDING_CONFIRMATION_KIND.CONTACT_IMPORT_PERSON_SELECT,
]);

export class PendingDecisionClassifier implements IClassifier {
  name = 'pendingDecision';

  classify(ctx: ClassifierContext): ClassifiedIntent | null {
    // pendingが無ければスキップ
    if (!ctx.pending_state.hasPending || !ctx.pending_state.kind) {
      return null;
    }

    // contact_import系のpendingの場合はスキップ
    // → classifyContactImport に任せる
    if (CONTACT_IMPORT_KINDS.has(ctx.pending_state.kind)) {
      return null;
    }

    const input = ctx.user_input.trim();

    // YES判定
    if (YES_PATTERNS.some(p => p.test(input))) {
      return {
        category: 'pending.decision',
        confidence: 0.95,
        pending_response: {
          answer: 'yes',
          target_kind: ctx.pending_state.kind,
        },
      };
    }

    // NO判定
    if (NO_PATTERNS.some(p => p.test(input))) {
      return {
        category: 'pending.decision',
        confidence: 0.95,
        pending_response: {
          answer: 'no',
          target_kind: ctx.pending_state.kind,
        },
      };
    }

    return null;
  }
}
