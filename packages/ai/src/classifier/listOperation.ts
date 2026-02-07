/**
 * Classifier: List Operation
 * 
 * チャットからリスト操作を検出する。
 * 
 * ■ 対応カテゴリ:
 *   list.create        → 「〇〇リスト作って」「新しいリスト作成」
 *   list.add_member    → 「〇〇リストに田中さん追加」「〇〇に田中、佐藤を追加して」
 *   list.remove_member → 「〇〇リストから田中さん外して」
 *   list.show          → 「リスト一覧」「〇〇リストのメンバー見せて」
 * 
 * ■ 設計:
 *   - pending中は新規リスト操作を受け付けない（事故防止）
 *   - pending不要（リスト操作は即実行。削除のみ将来的にconfirm検討）
 *   - contactImport より低い優先順位
 */

import type { IClassifier, ClassifierContext, ClassifiedIntent, ListOperationParams } from './types';

// ============================================================
// パターン定義
// ============================================================

// リスト作成パターン
const CREATE_PATTERNS = [
  /(?:リスト|グループ|list|group)\s*(?:を)?(?:作|作成|つくって|つくる|新規|新しく|create|make)/i,
  /(?:新しい|新規)\s*(?:の)?\s*(?:リスト|グループ|list|group)/i,
  /(?:作成|作って|つくって|create|make)\s*(?:.*)\s*(?:リスト|グループ|list|group)/i,
];

// メンバー追加パターン
const ADD_MEMBER_PATTERNS = [
  /(?:リスト|グループ|list|group)\s*(?:に|へ)\s*.+\s*(?:を)?(?:追加|入れて|加えて|add)/i,
  /(.+)\s*(?:を)\s*(?:リスト|グループ|list|group)\s*(?:に|へ)\s*(?:追加|入れて|加えて|add)/i,
  /(.+)\s*(?:に|へ)\s*(.+)\s*(?:を)?(?:追加|入れ|加え)/i,
];

// メンバー削除パターン
const REMOVE_MEMBER_PATTERNS = [
  /(?:リスト|グループ|list|group)\s*(?:から)\s*.+\s*(?:を)?(?:削除|外して|除外|抜いて|remove)/i,
  /(.+)\s*(?:を)\s*(?:リスト|グループ|list|group)\s*(?:から)\s*(?:削除|外して|除外|抜いて|remove)/i,
  /(.+)\s*(?:から)\s*(.+)\s*(?:を)?(?:削除|外|除外|抜)/i,
];

// リスト表示パターン
const SHOW_PATTERNS = [
  /(?:リスト|グループ|list|group)\s*(?:一覧|一覧表示|見せて|表示|show|list)/i,
  /(?:リスト|グループ|list|group)\s*(?:の)?\s*(?:メンバー|人|中身|member)/i,
  /(?:どんな|どの)\s*(?:リスト|グループ|list|group)/i,
  /(?:リスト|グループ|list|group)\s*(?:を)?\s*(?:確認|教えて|見たい)/i,
];

// リスト名抽出用ヘルパー
const LIST_NAME_EXTRACTOR = /[「」『』""'']/g;
const QUOTE_PAIRS = /[「『"'](.+?)[」』"']/;

// ============================================================
// Classifier
// ============================================================

export class ListOperationClassifier implements IClassifier {
  name = 'listOperation';

  classify(ctx: ClassifierContext): ClassifiedIntent | null {
    // pending中は新規リスト操作を受け付けない
    if (ctx.pending_state.hasPending) {
      return null;
    }

    const input = ctx.user_input.trim();

    // 短すぎる入力はスキップ
    if (input.length < 3) {
      return null;
    }

    // ---- list.create ----
    if (CREATE_PATTERNS.some(p => p.test(input))) {
      return {
        category: 'list.create',
        confidence: 0.88,
        list_params: this.extractCreateParams(input),
      };
    }

    // ---- list.remove_member ---- (add_memberより先に判定: 「から」の方が具体的)
    if (REMOVE_MEMBER_PATTERNS.some(p => p.test(input))) {
      return {
        category: 'list.remove_member',
        confidence: 0.85,
        list_params: this.extractRemoveMemberParams(input),
      };
    }

    // ---- list.add_member ----
    if (ADD_MEMBER_PATTERNS.some(p => p.test(input))) {
      return {
        category: 'list.add_member',
        confidence: 0.85,
        list_params: this.extractAddMemberParams(input),
      };
    }

    // ---- list.show ----
    if (SHOW_PATTERNS.some(p => p.test(input))) {
      return {
        category: 'list.show',
        confidence: 0.82,
        list_params: this.extractShowParams(input),
      };
    }

    return null;
  }

  // ============================================================
  // パラメータ抽出
  // ============================================================

  /**
   * list.create のパラメータ抽出
   * 例: 「営業チームリスト作って」→ list_name: '営業チーム'
   * 例: 「「ゴルフ仲間」というリストを作成」→ list_name: 'ゴルフ仲間'
   */
  private extractCreateParams(input: string): ListOperationParams {
    // カッコ内のリスト名
    const quoted = QUOTE_PAIRS.exec(input);
    if (quoted) {
      return { list_name: quoted[1].trim() };
    }

    // 「〇〇リスト」パターン
    const listNameMatch = input.match(/(.+?)(?:リスト|グループ|list|group)\s*(?:を)?(?:作|つく|create|make)/i);
    if (listNameMatch) {
      let name = listNameMatch[1].trim();
      // 先頭の「新しい」「新規」等を除去
      name = name.replace(/^(?:新しい|新規|新)\s*(?:の)?\s*/, '');
      if (name.length > 0) {
        return { list_name: name };
      }
    }

    // 「作って〇〇」パターン
    const reverseMatch = input.match(/(?:作って?|つくって?|作成して?|create|make)\s*[「『"']?(.+?)[」』"']?\s*(?:リスト|グループ|list|group)?$/i);
    if (reverseMatch && reverseMatch[1].trim().length > 0) {
      return { list_name: reverseMatch[1].trim() };
    }

    return {};
  }

  /**
   * list.add_member のパラメータ抽出
   * 例: 「営業リストに田中さん追加」→ list_name: '営業', member_query: '田中'
   * 例: 「営業リストに田中、佐藤、山田を追加」→ member_queries: ['田中','佐藤','山田']
   */
  private extractAddMemberParams(input: string): ListOperationParams {
    const params: ListOperationParams = {};

    // 「〇〇リストに△△を追加」
    const match = input.match(/(.+?)(?:リスト|グループ|list|group)\s*(?:に|へ)\s*(.+?)\s*(?:を)?(?:追加|入れ|加え|add)/i);
    if (match) {
      params.list_name = match[1].trim().replace(LIST_NAME_EXTRACTOR, '');
      const memberStr = match[2].trim().replace(/さん/g, '');
      
      // カンマ/「、」区切りで複数人
      const members = memberStr.split(/[,、]\s*/).map(m => m.trim()).filter(m => m.length > 0);
      if (members.length > 1) {
        params.member_queries = members;
      } else {
        params.member_query = members[0];
      }
      return params;
    }

    // 「△△を〇〇リストに追加」
    const reverseMatch = input.match(/(.+?)\s*(?:を)\s*(.+?)(?:リスト|グループ|list|group)\s*(?:に|へ)\s*(?:追加|入れ|加え|add)/i);
    if (reverseMatch) {
      const memberStr = reverseMatch[1].trim().replace(/さん/g, '');
      params.list_name = reverseMatch[2].trim().replace(LIST_NAME_EXTRACTOR, '');
      
      const members = memberStr.split(/[,、]\s*/).map(m => m.trim()).filter(m => m.length > 0);
      if (members.length > 1) {
        params.member_queries = members;
      } else {
        params.member_query = members[0];
      }
      return params;
    }

    return params;
  }

  /**
   * list.remove_member のパラメータ抽出
   * 例: 「営業リストから田中さん外して」→ list_name: '営業', member_query: '田中'
   */
  private extractRemoveMemberParams(input: string): ListOperationParams {
    const params: ListOperationParams = {};

    const match = input.match(/(.+?)(?:リスト|グループ|list|group)\s*(?:から)\s*(.+?)\s*(?:を)?(?:削除|外|除外|抜|remove)/i);
    if (match) {
      params.list_name = match[1].trim().replace(LIST_NAME_EXTRACTOR, '');
      params.member_query = match[2].trim().replace(/さん/g, '');
      return params;
    }

    return params;
  }

  /**
   * list.show のパラメータ抽出
   * 例: 「リスト一覧」→ {} (全リスト)
   * 例: 「営業リストのメンバー」→ list_name: '営業' (特定リストのメンバー)
   */
  private extractShowParams(input: string): ListOperationParams {
    // 特定リストのメンバー表示
    const memberMatch = input.match(/(.+?)(?:リスト|グループ|list|group)\s*(?:の)?\s*(?:メンバー|人|中身|member)/i);
    if (memberMatch) {
      return { list_name: memberMatch[1].trim().replace(LIST_NAME_EXTRACTOR, '') };
    }

    // カッコ内のリスト名
    const quoted = QUOTE_PAIRS.exec(input);
    if (quoted) {
      return { list_name: quoted[1].trim() };
    }

    return {};
  }
}
