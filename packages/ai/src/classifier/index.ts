/**
 * Classifier Chain - エントリポイント
 * 
 * チャット入力を分類するchain of responsibility
 * 
 * ■ 優先順位（事故ゼロ設計）:
 *   1. PendingDecisionClassifier  — pending中のYES/NO（contact_import系は除外）
 *   2. ContactImportClassifier    — contact_import系のpending応答 + 新規テキスト取り込み判定
 *   3. ListOperationClassifier    — リスト操作（create/add/remove/show）
 *   4. fallback → 'unknown'
 * 
 * ■ 衝突防止の仕組み:
 *   - PendingDecision は contact_import系kindをスキップする
 *   - ContactImport は contact_import系kindのときだけYES/NOを拾う
 *   → 「はい/いいえ」が2つのclassifierで衝突する事故はゼロ
 */

import type { IClassifier, ClassifierContext, ClassifiedIntent } from './types';
import { PendingDecisionClassifier } from './pendingDecision';
import { ContactImportClassifier } from './contactImport';
import { ListOperationClassifier } from './listOperation';

export * from './types';
export { PendingDecisionClassifier } from './pendingDecision';
export { ContactImportClassifier } from './contactImport';
export { ListOperationClassifier } from './listOperation';

/**
 * Classifier Chain
 * 登録順にclassifyを試み、最初にマッチしたものを返す
 */
export class ClassifierChain {
  private classifiers: IClassifier[] = [];

  constructor() {
    // ■ 優先順位: pendingDecision → contactImport → listOperation → (将来追加)
    this.classifiers = [
      new PendingDecisionClassifier(),
      new ContactImportClassifier(),
      new ListOperationClassifier(),
    ];
  }

  /**
   * ユーザー入力を分類する
   */
  classify(ctx: ClassifierContext): ClassifiedIntent {
    for (const classifier of this.classifiers) {
      const result = classifier.classify(ctx);
      if (result) {
        return result;
      }
    }

    // どのclassifierにもマッチしない → unknown
    return {
      category: 'unknown',
      confidence: 0.1,
      raw_text: ctx.user_input,
    };
  }

  /**
   * classifierを追加（末尾に追加 = 最低優先度）
   */
  addClassifier(classifier: IClassifier): void {
    this.classifiers.push(classifier);
  }

  /**
   * classifierを先頭に追加（最高優先度）
   */
  prependClassifier(classifier: IClassifier): void {
    this.classifiers.unshift(classifier);
  }

  /**
   * 現在のclassifierリストを返す（デバッグ用）
   */
  getClassifierNames(): string[] {
    return this.classifiers.map(c => c.name);
  }
}
