/**
 * Relation Request Workmate Executor
 * 
 * D0: relation.request.workmate
 * 仕事仲間申請を実行する
 * 
 * API: POST /api/relationships/request
 * payload: invitee_identifier (email or user_id), requested_type: 'workmate'
 * 
 * @see D0-CONNECT-CHAT-SPEC.md
 */

import { relationshipsApi, type UserSearchResult } from '../../../api/relationships';
import type { IntentResult } from '../../intentClassifier';
import type { ExecutionResult, ExecutionContext } from '../types';

/**
 * 仕事仲間申請を実行
 * 
 * フロー:
 * 1. target の解決（email or user_id or 名前検索）
 * 2. 既存関係のチェック
 * 3. API 呼び出し
 * 4. 成功/失敗メッセージ
 * 
 * @param intentResult - 分類結果 (params.email, params.user_id, params.name のいずれか)
 * @param _ctx - ExecutionContext (未使用だが将来の拡張用)
 * @returns ExecutionResult
 */
export async function executeRelationRequestWorkmate(
  intentResult: IntentResult,
  _ctx?: ExecutionContext
): Promise<ExecutionResult> {
  const { email, user_id, name, message } = intentResult.params;
  
  // ----------------------------------------------------------------
  // Step 1: target の特定
  // ----------------------------------------------------------------
  let inviteeIdentifier: string | null = null;
  let targetDisplayName: string | null = null;
  
  // email が指定されている場合
  if (email && typeof email === 'string') {
    inviteeIdentifier = email;
    targetDisplayName = email;
  }
  // user_id が指定されている場合
  else if (user_id && typeof user_id === 'string') {
    inviteeIdentifier = user_id;
    targetDisplayName = user_id;
  }
  // 名前が指定されている場合 → 検索で解決
  else if (name && typeof name === 'string') {
    try {
      const searchResult = await relationshipsApi.search(name);
      
      if (searchResult.count === 0) {
        return {
          success: false,
          message: `「${name}」さんが見つかりませんでした。\n\nメールアドレスを指定して申請することもできます:\n「tanaka@example.com を仕事仲間に追加して」`,
          needsClarification: {
            field: 'email',
            message: `「${name}」さんが見つかりませんでした。メールアドレスを教えてください。`,
          },
        };
      }
      
      if (searchResult.count === 1) {
        const user = searchResult.results[0];
        inviteeIdentifier = user.id;
        targetDisplayName = user.display_name || user.email;
        
        // 既に仕事仲間の場合
        if (user.relationship) {
          return {
            success: false,
            message: `${targetDisplayName}さんとは既に仕事仲間です。`,
          };
        }
        
        // 申請中の場合
        if (user.pending_request) {
          return {
            success: false,
            message: `${targetDisplayName}さんへの仕事仲間申請は既に送信済みです。\n\n相手の承諾をお待ちください。`,
          };
        }
        
        // 申請不可の場合
        if (!user.can_request) {
          return {
            success: false,
            message: `${targetDisplayName}さんには現在仕事仲間申請を送れません。`,
          };
        }
      } else {
        // 複数候補がある場合
        return buildCandidateSelection(searchResult.results, name);
      }
    } catch (e) {
      return {
        success: false,
        message: `ユーザー検索に失敗しました: ${extractErrorMessage(e)}`,
      };
    }
  }
  
  // target が特定できない場合
  if (!inviteeIdentifier) {
    return {
      success: false,
      message: '仕事仲間に追加したい相手を指定してください。',
      needsClarification: {
        field: 'email',
        message: '仕事仲間に追加したい方のメールアドレスまたは名前を教えてください。\n\n例:\n• 「tanaka@example.com を仕事仲間に追加」\n• 「田中さんを仕事仲間に追加」',
      },
    };
  }
  
  // ----------------------------------------------------------------
  // Step 2: API 呼び出し
  // ----------------------------------------------------------------
  try {
    const response = await relationshipsApi.request({
      invitee_identifier: inviteeIdentifier,
      requested_type: 'workmate',
      message: message as string | undefined,
    });
    
    const displayName = response.invitee?.display_name || targetDisplayName || inviteeIdentifier;
    
    return {
      success: true,
      message: `✅ ${displayName}さんに仕事仲間申請を送りました。\n\n相手が承諾すると、お互いの空き時間を共有できるようになります。`,
      data: {
        kind: 'relation.request.sent',
        payload: {
          request_id: response.request_id,
          invitee_id: response.invitee?.id,
          invitee_email: response.invitee?.email,
          invitee_name: response.invitee?.display_name,
          requested_type: 'workmate',
          expires_at: response.expires_at,
        },
      },
    };
  } catch (e) {
    const errorMessage = extractErrorMessage(e);
    
    // 409 Conflict: 既存の関係/申請がある
    if (errorMessage.includes('already') || errorMessage.includes('409')) {
      return {
        success: false,
        message: `${targetDisplayName || inviteeIdentifier}さんとは既に仕事仲間か、申請中です。`,
      };
    }
    
    // 404 Not Found: ユーザーが見つからない
    if (errorMessage.includes('not found') || errorMessage.includes('404')) {
      return {
        success: false,
        message: `${targetDisplayName || inviteeIdentifier}さんが見つかりませんでした。\n\nメールアドレスが正しいか確認してください。`,
      };
    }
    
    return {
      success: false,
      message: `❌ 仕事仲間申請に失敗しました: ${errorMessage}`,
    };
  }
}

/**
 * 複数候補がある場合の選択肢を構築
 */
function buildCandidateSelection(
  candidates: UserSearchResult[],
  queryName: string
): ExecutionResult {
  let message = `「${queryName}」で ${candidates.length} 名見つかりました。どなたに申請しますか？\n\n`;
  
  candidates.slice(0, 5).forEach((user, index) => {
    const status = user.relationship
      ? ' (既に仕事仲間)'
      : user.pending_request
      ? ' (申請中)'
      : '';
    message += `${index + 1}. ${user.display_name || user.email}${status}\n`;
    if (user.email && user.display_name) {
      message += `   📧 ${user.email}\n`;
    }
  });
  
  if (candidates.length > 5) {
    message += `\n...他 ${candidates.length - 5} 名`;
  }
  
  message += '\n\n💡 番号または「〇〇さんに申請」と入力してください。';
  
  return {
    success: false,
    message,
    needsClarification: {
      field: 'user_selection',
      message: 'どなたに仕事仲間申請を送りますか？',
    },
    data: {
      kind: 'relation.request.candidates',
      payload: {
        candidates: candidates.map((u) => ({
          id: u.id,
          email: u.email,
          display_name: u.display_name,
          can_request: u.can_request,
        })),
        query_name: queryName,
      },
    },
  };
}

/**
 * エラーメッセージを抽出
 */
function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  if (typeof e === 'object' && e !== null && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return '不明なエラー';
}

/**
 * relation.approve executor
 * 仕事仲間申請を承諾する
 */
export async function executeRelationApprove(
  intentResult: IntentResult,
  _ctx?: ExecutionContext
): Promise<ExecutionResult> {
  const { token, request_id } = intentResult.params;
  
  // token が必要
  const targetToken = (token as string) || (request_id as string);
  
  if (!targetToken) {
    return {
      success: false,
      message: '承諾する申請を特定できませんでした。',
      needsClarification: {
        field: 'token',
        message: '受信箱から承諾したい申請を選んでください。',
      },
    };
  }
  
  try {
    const response = await relationshipsApi.accept(targetToken);
    
    return {
      success: true,
      message: `✅ 仕事仲間申請を承諾しました。\n\nこれでお互いの空き時間を共有できるようになりました。`,
      data: {
        kind: 'relation.approved',
        payload: {
          relationship_id: response.relationship_id,
          relation_type: response.relation_type,
        },
      },
    };
  } catch (e) {
    const errorMessage = extractErrorMessage(e);
    
    if (errorMessage.includes('expired') || errorMessage.includes('期限')) {
      return {
        success: false,
        message: 'この申請は有効期限が切れています。相手に再度申請してもらってください。',
      };
    }
    
    if (errorMessage.includes('not found') || errorMessage.includes('404')) {
      return {
        success: false,
        message: 'この申請は見つかりませんでした。既に処理済みか、取り消されている可能性があります。',
      };
    }
    
    return {
      success: false,
      message: `❌ 承諾に失敗しました: ${errorMessage}`,
    };
  }
}

/**
 * relation.decline executor
 * 仕事仲間申請を拒否する
 */
export async function executeRelationDecline(
  intentResult: IntentResult,
  _ctx?: ExecutionContext
): Promise<ExecutionResult> {
  const { token, request_id } = intentResult.params;
  
  const targetToken = (token as string) || (request_id as string);
  
  if (!targetToken) {
    return {
      success: false,
      message: '拒否する申請を特定できませんでした。',
      needsClarification: {
        field: 'token',
        message: '受信箱から拒否したい申請を選んでください。',
      },
    };
  }
  
  try {
    await relationshipsApi.decline(targetToken);
    
    return {
      success: true,
      message: '申請をお断りしました。\n\n相手には「承諾されませんでした」と表示されます。',
      data: {
        kind: 'relation.declined',
        payload: {
          token: targetToken,
        },
      },
    };
  } catch (e) {
    const errorMessage = extractErrorMessage(e);
    
    return {
      success: false,
      message: `❌ 拒否に失敗しました: ${errorMessage}`,
    };
  }
}
