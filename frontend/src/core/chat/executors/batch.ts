/**
 * Batch Executors
 * P2-B1: 一括招待バッチ処理最適化
 * 
 * 目的:
 * - 大量招待時のパフォーマンス改善（chunking）
 * - 途中で落ちても「どこまで送れたか」表示
 * - refreshAfterWrite を最後に1回にまとめて負荷軽減
 * 
 * 設計方針:
 * - chunk サイズ: 50件/バッチ（設定可能）
 * - 進捗表示: 件数ベース（% より直感的）
 * - エラーハンドリング: continue on error（全体を止めない）
 */

import { listsApi } from '../../api/lists';
import { contactsApi } from '../../api/contacts';
import { refreshLists, refreshContacts } from '../../cache';
import { getRefreshActions, type WriteOp } from '../../refresh/refreshMap';
import { runRefresh } from '../../refresh/runRefresh';
import { log } from '../../platform';
import type { IntentResult } from '../intentClassifier';
import type { ExecutionResult } from './types';

// ============================================================
// Configuration
// ============================================================

/** バッチサイズ（1回のAPI呼び出しで処理する件数） */
export const BATCH_CHUNK_SIZE = 50;

/** 進捗コールバック型 */
export type BatchProgressCallback = (progress: BatchProgress) => void;

/** 進捗情報 */
export interface BatchProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  currentChunk: number;
  totalChunks: number;
  isComplete: boolean;
}

/** バッチ結果 */
export interface BatchResult {
  success: boolean;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: Array<{ email: string; error: string }>;
  duration: number;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * 配列を指定サイズのチャンクに分割
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * P2-B1: Write 操作後に refresh を実行（最後に1回）
 */
async function refreshAfterBatch(ops: WriteOp[], threadId?: string): Promise<void> {
  try {
    // 重複を除去してまとめて refresh
    const uniqueOps = [...new Set(ops)];
    const allActions = uniqueOps.flatMap(op => getRefreshActions(op, { threadId }));
    
    // 重複する action type を除去
    const uniqueActions = allActions.filter((action, index, self) => 
      index === self.findIndex(a => a.type === action.type && 
        (a.type !== 'STATUS' || (a as any).threadId === (action as any).threadId))
    );
    
    await runRefresh(uniqueActions);
  } catch (e) {
    log.warn('refreshAfterBatch failed', { module: 'batch', ops, threadId, err: e });
  }
}

/**
 * 進捗メッセージを生成
 */
export function formatBatchProgress(progress: BatchProgress): string {
  const { total, processed, succeeded, failed, skipped, currentChunk, totalChunks, isComplete } = progress;
  
  if (isComplete) {
    let message = `✅ 処理完了\n\n`;
    message += `📊 結果: ${succeeded}件 成功`;
    if (failed > 0) message += ` / ${failed}件 失敗`;
    if (skipped > 0) message += ` / ${skipped}件 スキップ`;
    message += ` (全${total}件)`;
    return message;
  }
  
  let message = `⏳ 処理中... ${processed}/${total}件\n`;
  message += `📦 チャンク: ${currentChunk}/${totalChunks}\n`;
  if (succeeded > 0) message += `✅ 成功: ${succeeded}件\n`;
  if (failed > 0) message += `❌ 失敗: ${failed}件\n`;
  if (skipped > 0) message += `⏭️ スキップ: ${skipped}件`;
  
  return message;
}

/**
 * バッチ結果メッセージを生成
 */
export function formatBatchResult(result: BatchResult, context: { listName?: string } = {}): string {
  const { total, succeeded, failed, skipped, errors, duration } = result;
  const { listName } = context;
  
  let message = `📩 **バッチ処理完了**\n\n`;
  
  if (listName) {
    message += `📋 リスト: ${listName}\n`;
  }
  
  message += `📊 処理結果:\n`;
  message += `  ✅ 成功: ${succeeded}件\n`;
  if (failed > 0) message += `  ❌ 失敗: ${failed}件\n`;
  if (skipped > 0) message += `  ⏭️ スキップ: ${skipped}件\n`;
  message += `  📦 合計: ${total}件\n`;
  message += `  ⏱️ 処理時間: ${(duration / 1000).toFixed(1)}秒\n`;
  
  // エラー詳細（最大5件）
  if (errors.length > 0) {
    message += `\n⚠️ エラー詳細:\n`;
    const displayErrors = errors.slice(0, 5);
    displayErrors.forEach(({ email, error }) => {
      message += `  - ${email}: ${error}\n`;
    });
    if (errors.length > 5) {
      message += `  ... 他${errors.length - 5}件のエラー\n`;
    }
  }
  
  return message;
}

// ============================================================
// Batch Executors
// ============================================================

/**
 * P2-B1: リストへのメンバー一括追加（chunking版）
 * 
 * 特徴:
 * - 50件ずつ処理（BATCH_CHUNK_SIZE）
 * - エラーでも続行（continue on error）
 * - refresh は最後に1回だけ
 */
export async function executeBatchAddMembers(
  intentResult: IntentResult,
  onProgress?: BatchProgressCallback
): Promise<ExecutionResult> {
  const { emails, listName } = intentResult.params as {
    emails?: string[];
    listName?: string;
  };
  
  if (!emails || emails.length === 0) {
    return {
      success: false,
      message: 'メールアドレスを指定してください。',
      needsClarification: {
        field: 'emails',
        message: '追加するメールアドレスを入力してください。',
      },
    };
  }
  
  if (!listName) {
    return {
      success: false,
      message: 'リスト名を指定してください。',
      needsClarification: {
        field: 'listName',
        message: 'どのリストに追加しますか？',
      },
    };
  }
  
  const startTime = Date.now();
  
  try {
    // リストIDを取得
    const listsResponse = await listsApi.list() as any;
    const lists = listsResponse.lists || listsResponse.items || [];
    const targetList = lists.find((l: any) => l.name === listName || l.name.includes(listName));
    
    if (!targetList) {
      return {
        success: false,
        message: `❌ リスト「${listName}」が見つかりませんでした。`,
      };
    }
    
    // チャンクに分割
    const chunks = chunkArray(emails, BATCH_CHUNK_SIZE);
    const totalChunks = chunks.length;
    
    // 結果集計
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    const errors: Array<{ email: string; error: string }> = [];
    const writeOps: WriteOp[] = [];
    
    // チャンクごとに処理
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      
      for (const email of chunk) {
        try {
          // コンタクト作成（既存の場合は既存を使用）
          let contact;
          try {
            contact = await contactsApi.create({
              kind: 'external_person',
              email,
              display_name: email.split('@')[0],
            });
            writeOps.push('CONTACT_CREATE');
          } catch (e: any) {
            // 既存コンタクトの場合はリストから検索
            const contactsResponse = await contactsApi.list({ q: email });
            contact = (contactsResponse.items || []).find((c: any) => c.email === email);
            if (!contact) throw e;
          }
          
          // リストに追加
          await listsApi.addMember(targetList.id, { contact_id: contact.id });
          succeeded++;
          writeOps.push('LIST_ADD_MEMBER');
        } catch (e: any) {
          if (e.message?.includes('already exists') || e.message?.includes('duplicate')) {
            skipped++;
          } else {
            failed++;
            errors.push({ email, error: e.message || '追加失敗' });
          }
        }
      }
      
      // 進捗コールバック
      if (onProgress) {
        const processed = (chunkIndex + 1) * BATCH_CHUNK_SIZE;
        onProgress({
          total: emails.length,
          processed: Math.min(processed, emails.length),
          succeeded,
          failed,
          skipped,
          currentChunk: chunkIndex + 1,
          totalChunks,
          isComplete: chunkIndex === chunks.length - 1,
        });
      }
    }
    
    // P2-B1: 最後に1回だけ refresh
    if (succeeded > 0 || writeOps.length > 0) {
      await refreshAfterBatch(['LIST_ADD_MEMBER', 'CONTACT_CREATE']);
    }
    
    const duration = Date.now() - startTime;
    
    const result: BatchResult = {
      success: failed === 0,
      total: emails.length,
      succeeded,
      failed,
      skipped,
      errors,
      duration,
    };
    
    return {
      success: true,
      message: formatBatchResult(result, { listName: targetList.name }),
      data: {
        kind: 'batch.add_members.completed',
        payload: {
          listId: targetList.id,
          listName: targetList.name,
          ...result,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `❌ バッチ処理に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
    };
  }
}

/**
 * P2-B1: 現在のバッチサイズを取得
 */
export function getBatchChunkSize(): number {
  return BATCH_CHUNK_SIZE;
}
