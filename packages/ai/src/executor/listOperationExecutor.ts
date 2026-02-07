/**
 * List Operation Executor
 * 
 * Classifier の分類結果に基づいてリスト操作を実行する。
 * 
 * ■ ルーティング:
 *   list.create        → handleCreate（リスト作成）
 *   list.add_member    → handleAddMember（メンバー追加）
 *   list.remove_member → handleRemoveMember（メンバー削除）
 *   list.show          → handleShow（リスト一覧/メンバー表示）
 * 
 * ■ 設計:
 *   - UI追加なし。全操作はチャット経由で完結。
 *   - pending不要（即実行）
 *   - 既存の lists API を内部呼び出し
 */

import type { ClassifiedIntent, ListOperationParams } from '../classifier/types';

// ============================================================
// Executor Response
// ============================================================

export interface ListExecutorResponse {
  success: boolean;
  message: string;
  data?: {
    list?: ListInfo;
    lists?: ListInfo[];
    members?: MemberInfo[];
    added_count?: number;
    removed_count?: number;
    not_found?: string[];
  };
}

export interface ListInfo {
  id: string;
  name: string;
  description?: string;
  member_count: number;
}

export interface MemberInfo {
  contact_id: string;
  display_name: string;
  email?: string;
}

// ============================================================
// Dependencies Interface
// ============================================================

/**
 * Executor が依存する外部サービスのインターフェース
 * テスト時にモック可能にするためにインターフェース化
 */
export interface ListOperationDeps {
  /** リスト作成 */
  createList(params: {
    owner_user_id: string;
    name: string;
    description?: string;
  }): Promise<{ id: string; name: string; description?: string }>;

  /** リスト一覧取得 */
  getLists(userId: string): Promise<Array<{
    id: string;
    name: string;
    description?: string;
    member_count: number;
  }>>;

  /** 名前でリスト検索 */
  findListByName(userId: string, name: string): Promise<{
    id: string;
    name: string;
    description?: string;
    member_count: number;
  } | null>;

  /** リストのメンバー取得 */
  getListMembers(listId: string): Promise<Array<{
    contact_id: string;
    display_name: string;
    email?: string;
  }>>;

  /** 名前/メールで連絡先検索 */
  findContact(userId: string, query: string): Promise<{
    id: string;
    display_name: string;
    email?: string;
  } | null>;

  /** リストにメンバー追加 */
  addMember(listId: string, contactId: string): Promise<void>;

  /** リストからメンバー削除 */
  removeMember(listId: string, contactId: string): Promise<void>;
}

// ============================================================
// List Operation Executor
// ============================================================

export class ListOperationExecutor {
  constructor(private deps: ListOperationDeps) {}

  async execute(
    classified: ClassifiedIntent,
    userId: string
  ): Promise<ListExecutorResponse> {
    const params = classified.list_params || {};

    switch (classified.category) {
      case 'list.create':
        return this.handleCreate(params, userId);
      case 'list.add_member':
        return this.handleAddMember(params, userId);
      case 'list.remove_member':
        return this.handleRemoveMember(params, userId);
      case 'list.show':
        return this.handleShow(params, userId);
      default:
        return {
          success: false,
          message: `未対応のカテゴリ: ${classified.category}`,
        };
    }
  }

  // ============================================================
  // list.create → リスト作成
  // ============================================================

  private async handleCreate(
    params: ListOperationParams,
    userId: string
  ): Promise<ListExecutorResponse> {
    if (!params.list_name) {
      return {
        success: false,
        message: 'リスト名を指定してください。例:「営業チームリスト作って」',
      };
    }

    // 同名リストの重複チェック
    const existing = await this.deps.findListByName(userId, params.list_name);
    if (existing) {
      return {
        success: false,
        message: `「${params.list_name}」というリストは既に存在します。別の名前を指定してください。`,
        data: { list: existing },
      };
    }

    const list = await this.deps.createList({
      owner_user_id: userId,
      name: params.list_name,
      description: params.description,
    });

    return {
      success: true,
      message: `✅ リスト「${list.name}」を作成しました！\nメンバーを追加するには「${list.name}リストに〇〇さん追加」と送ってください。`,
      data: {
        list: {
          id: list.id,
          name: list.name,
          description: list.description,
          member_count: 0,
        },
      },
    };
  }

  // ============================================================
  // list.add_member → メンバー追加
  // ============================================================

  private async handleAddMember(
    params: ListOperationParams,
    userId: string
  ): Promise<ListExecutorResponse> {
    if (!params.list_name) {
      return {
        success: false,
        message: 'リスト名を指定してください。例:「営業リストに田中さん追加」',
      };
    }

    // リスト検索
    const list = await this.deps.findListByName(userId, params.list_name);
    if (!list) {
      return {
        success: false,
        message: `「${params.list_name}」というリストが見つかりません。\n先に「${params.list_name}リスト作って」でリストを作成してください。`,
      };
    }

    // 追加対象の連絡先を検索
    const queries = params.member_queries || (params.member_query ? [params.member_query] : []);
    if (queries.length === 0) {
      return {
        success: false,
        message: '追加するメンバーを指定してください。例:「営業リストに田中さん追加」',
      };
    }

    let addedCount = 0;
    const notFound: string[] = [];
    const addedMembers: MemberInfo[] = [];

    for (const query of queries) {
      const contact = await this.deps.findContact(userId, query);
      if (!contact) {
        notFound.push(query);
        continue;
      }

      try {
        await this.deps.addMember(list.id, contact.id);
        addedCount++;
        addedMembers.push({
          contact_id: contact.id,
          display_name: contact.display_name,
          email: contact.email,
        });
      } catch (e) {
        // 重複は無視
        if (e instanceof Error && e.message.includes('already')) {
          notFound.push(`${query}（既にメンバー）`);
        } else {
          notFound.push(`${query}（エラー）`);
        }
      }
    }

    // メッセージ組み立て
    const lines: string[] = [];

    if (addedCount > 0) {
      lines.push(`✅ 「${list.name}」に${addedCount}名を追加しました。`);
      for (const m of addedMembers) {
        const emailStr = m.email ? ` (${m.email})` : '';
        lines.push(`  • ${m.display_name}${emailStr}`);
      }
    }

    if (notFound.length > 0) {
      lines.push('');
      lines.push(`⚠️ 追加できなかった: ${notFound.length}名`);
      for (const n of notFound) {
        lines.push(`  • ${n}`);
      }
      if (notFound.some(n => !n.includes('既にメンバー') && !n.includes('エラー'))) {
        lines.push('');
        lines.push('連絡先に登録されていない人は、先に「登録して 〇〇 xxx@example.com」で登録してください。');
      }
    }

    return {
      success: addedCount > 0,
      message: lines.join('\n'),
      data: {
        list: { ...list, member_count: list.member_count + addedCount },
        added_count: addedCount,
        not_found: notFound,
        members: addedMembers,
      },
    };
  }

  // ============================================================
  // list.remove_member → メンバー削除
  // ============================================================

  private async handleRemoveMember(
    params: ListOperationParams,
    userId: string
  ): Promise<ListExecutorResponse> {
    if (!params.list_name) {
      return {
        success: false,
        message: 'リスト名を指定してください。例:「営業リストから田中さん外して」',
      };
    }

    if (!params.member_query) {
      return {
        success: false,
        message: '削除するメンバーを指定してください。例:「営業リストから田中さん外して」',
      };
    }

    // リスト検索
    const list = await this.deps.findListByName(userId, params.list_name);
    if (!list) {
      return {
        success: false,
        message: `「${params.list_name}」というリストが見つかりません。`,
      };
    }

    // 連絡先検索
    const contact = await this.deps.findContact(userId, params.member_query);
    if (!contact) {
      return {
        success: false,
        message: `「${params.member_query}」という連絡先が見つかりません。`,
      };
    }

    await this.deps.removeMember(list.id, contact.id);

    return {
      success: true,
      message: `✅ 「${list.name}」から${contact.display_name}を削除しました。`,
      data: {
        list: { ...list, member_count: Math.max(0, list.member_count - 1) },
        removed_count: 1,
      },
    };
  }

  // ============================================================
  // list.show → リスト一覧/メンバー表示
  // ============================================================

  private async handleShow(
    params: ListOperationParams,
    userId: string
  ): Promise<ListExecutorResponse> {
    // 特定リストのメンバー表示
    if (params.list_name) {
      const list = await this.deps.findListByName(userId, params.list_name);
      if (!list) {
        return {
          success: false,
          message: `「${params.list_name}」というリストが見つかりません。`,
        };
      }

      const members = await this.deps.getListMembers(list.id);

      if (members.length === 0) {
        return {
          success: true,
          message: `📋 「${list.name}」のメンバー: 0名\nメンバーを追加するには「${list.name}リストに〇〇さん追加」と送ってください。`,
          data: { list, members: [] },
        };
      }

      const lines: string[] = [
        `📋 「${list.name}」のメンバー: ${members.length}名`,
        '',
      ];
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        const emailStr = m.email ? ` (${m.email})` : '';
        lines.push(`  ${i + 1}. ${m.display_name}${emailStr}`);
      }

      return {
        success: true,
        message: lines.join('\n'),
        data: {
          list,
          members: members.map(m => ({
            contact_id: m.contact_id,
            display_name: m.display_name,
            email: m.email,
          })),
        },
      };
    }

    // 全リスト一覧
    const lists = await this.deps.getLists(userId);

    if (lists.length === 0) {
      return {
        success: true,
        message: '📋 リストはまだありません。\n「〇〇リスト作って」でリストを作成できます。',
        data: { lists: [] },
      };
    }

    const lines: string[] = [
      `📋 リスト一覧: ${lists.length}件`,
      '',
    ];
    for (const list of lists) {
      const descStr = list.description ? ` - ${list.description}` : '';
      lines.push(`  • ${list.name}（${list.member_count}名）${descStr}`);
    }
    lines.push('');
    lines.push('詳細を見るには「〇〇リストのメンバー」と送ってください。');

    return {
      success: true,
      message: lines.join('\n'),
      data: { lists },
    };
  }
}
