/**
 * List Handlers - リスト関連の実行ハンドラ
 * 
 * 対応Intent:
 * - list.create
 * - list.list
 * - list.members
 * - list.add_member
 */

import { listsApi } from '../../../core/api/lists';
import { contactsApi } from '../../../core/api/contacts';
import type { IntentResult } from '../../../core/chat/intentClassifier';
import type { ExecutionResult } from '../types';

// ============================================================
// list.create
// ============================================================

export async function executeListCreate(intentResult: IntentResult): Promise<ExecutionResult> {
  const { listName } = intentResult.params;
  
  if (!listName) {
    return {
      success: false,
      message: 'リスト名を指定してください。',
      needsClarification: {
        field: 'listName',
        message: '作成するリストの名前を入力してください。\n\n例: 「営業部リストを作って」',
      },
    };
  }
  
  try {
    const response = await listsApi.create({
      name: listName,
      description: 'チャットから作成',
    });
    
    return {
      success: true,
      message: `✅ リスト「${listName}」を作成しました。\n\nメンバーを追加するには「tanaka@example.comを${listName}に追加」と入力してください。`,
      data: {
        kind: 'list.created',
        payload: {
          listId: response.id,
          listName: response.name,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ リスト作成に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

// ============================================================
// list.list
// ============================================================

export async function executeListList(): Promise<ExecutionResult> {
  try {
    const response = await listsApi.list();
    const lists = response.items || [];
    
    if (lists.length === 0) {
      return {
        success: true,
        message: '📋 リストがありません。\n\n「〇〇リストを作って」でリストを作成できます。',
        data: {
          kind: 'list.listed',
          payload: { lists: [] },
        },
      };
    }
    
    let message = `📋 リスト一覧（${lists.length}件）\n\n`;
    lists.forEach((list: any, index: number) => {
      message += `${index + 1}. ${list.name}`;
      if (list.description) message += ` - ${list.description}`;
      message += '\n';
    });
    
    message += '\n💡 「〇〇リストのメンバー」でメンバーを確認できます。';
    
    return {
      success: true,
      message,
      data: {
        kind: 'list.listed',
        payload: { lists },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ リスト取得に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

// ============================================================
// list.members
// ============================================================

export async function executeListMembers(intentResult: IntentResult): Promise<ExecutionResult> {
  const { listName } = intentResult.params;
  
  if (!listName) {
    return {
      success: false,
      message: 'リスト名を指定してください。',
      needsClarification: {
        field: 'listName',
        message: 'どのリストのメンバーを表示しますか？\n\n例: 「営業部リストのメンバー」',
      },
    };
  }
  
  try {
    // リストIDを取得
    const listsResponse = await listsApi.list();
    const lists = listsResponse.items || [];
    const targetList = lists.find((l: any) => l.name === listName || l.name.includes(listName));
    
    if (!targetList) {
      return {
        success: false,
        message: `❌ リスト「${listName}」が見つかりませんでした。`,
      };
    }
    
    const membersResponse = await listsApi.getMembers(targetList.id);
    const members = membersResponse.items || [];
    
    if (members.length === 0) {
      return {
        success: true,
        message: `📋 リスト「${targetList.name}」にはメンバーがいません。\n\n「tanaka@example.comを${targetList.name}に追加」でメンバーを追加できます。`,
        data: {
          kind: 'list.members',
          payload: { listName: targetList.name, members: [] },
        },
      };
    }
    
    let message = `📋 「${targetList.name}」のメンバー（${members.length}名）\n\n`;
    members.forEach((member: any, index: number) => {
      message += `${index + 1}. ${member.contact_display_name || member.contact_email || '名前なし'}`;
      if (member.contact_email) message += ` <${member.contact_email}>`;
      message += '\n';
    });
    
    return {
      success: true,
      message,
      data: {
        kind: 'list.members',
        payload: { listName: targetList.name, members },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ メンバー取得に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

// ============================================================
// list.add_member
// ============================================================

export async function executeListAddMember(intentResult: IntentResult): Promise<ExecutionResult> {
  const { emails, listName } = intentResult.params;
  
  if (!emails || emails.length === 0) {
    return {
      success: false,
      message: 'メールアドレスを指定してください。',
      needsClarification: {
        field: 'emails',
        message: '追加するメールアドレスを入力してください。\n\n例: 「tanaka@example.comを営業部リストに追加」',
      },
    };
  }
  
  if (!listName) {
    return {
      success: false,
      message: 'リスト名を指定してください。',
      needsClarification: {
        field: 'listName',
        message: 'どのリストに追加しますか？\n\n例: 「営業部リストに追加」',
      },
    };
  }
  
  try {
    // リストIDを取得
    const listsResponse = await listsApi.list();
    const lists = listsResponse.items || [];
    const targetList = lists.find((l: any) => l.name === listName || l.name.includes(listName));
    
    if (!targetList) {
      return {
        success: false,
        message: `❌ リスト「${listName}」が見つかりませんでした。`,
      };
    }
    
    // 各メールアドレスに対してコンタクト作成 → リストに追加
    let addedCount = 0;
    const errors: string[] = [];
    
    for (const email of emails) {
      try {
        // コンタクト作成（既存の場合は既存を使用）
        let contact;
        try {
          contact = await contactsApi.create({
            kind: 'external_person',
            email,
            display_name: email.split('@')[0],
          });
        } catch (e: any) {
          // 既存コンタクトの場合はリストから検索
          const contactsResponse = await contactsApi.list({ q: email });
          contact = (contactsResponse.items || []).find((c: any) => c.email === email);
          if (!contact) throw e;
        }
        
        // リストに追加
        await listsApi.addMember(targetList.id, { contact_id: contact.id });
        addedCount++;
      } catch (e: any) {
        errors.push(`${email}: ${e.message || '追加失敗'}`);
      }
    }
    
    let message = `✅ ${addedCount}名をリスト「${targetList.name}」に追加しました。`;
    
    if (errors.length > 0) {
      message += `\n\n⚠️ エラー:\n${errors.join('\n')}`;
    }
    
    return {
      success: true,
      message,
      data: {
        kind: 'list.member_added',
        payload: {
          listName: targetList.name,
          email: emails[0],
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ メンバー追加に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}
