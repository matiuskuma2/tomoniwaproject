/**
 * Pool Create Executor
 * 
 * G2-A: 管理者がチャットでプールを作成
 * 
 * 入力例:
 * - 「営業チームで予約受付つくって。メンバーは田中/佐藤/山田。来週の平日10-18で1時間枠」
 * - 「相談窓口の受付を作成して」
 * - 「面談予約のプールを作って」
 * 
 * 処理フロー:
 * 1. POST /api/pools (プール作成)
 * 2. POST /api/pools/:id/members (メンバー追加)
 * 3. POST /api/pools/:id/slots (枠作成)
 * 4. GET /api/pools/:id/public-link (公開リンク発行)
 * 
 * 出力:
 * - プール作成完了メッセージ
 * - 公開リンク
 * - 自動割当の説明
 */

import { poolsApi } from '../../../api/pools';
import type { IntentResult } from '../../classifier/types';
import type { ExecutionResult, ExecutionContext } from '../types';

// ============================================================
// Types
// ============================================================

interface CreatePoolParams {
  pool_name?: string;
  description?: string;
  member_emails?: string[];
  member_names?: string[];
  slots?: SlotConfig[];
  duration_minutes?: number;
  range?: string;
}

interface SlotConfig {
  start_at: string;
  end_at: string;
  label?: string;
}

// ============================================================
// Main Executor
// ============================================================

/**
 * プール作成 executor
 * 
 * @param intentResult - 分類結果
 * @param _context - 実行コンテキスト（未使用）
 */
export async function executePoolCreate(
  intentResult: IntentResult,
  _context?: ExecutionContext
): Promise<ExecutionResult> {
  const params = intentResult.params as CreatePoolParams;
  
  // -------------------- バリデーション --------------------
  if (!params.pool_name) {
    return {
      success: false,
      message: 'プール名を指定してください。例: 「営業チームの予約受付を作って」',
      needsClarification: {
        field: 'pool_name',
        message: '作成するプールの名前を教えてください。',
      },
    };
  }
  
  try {
    // -------------------- 1. プール作成 --------------------
    const poolResponse = await poolsApi.create({
      name: params.pool_name,
      description: params.description || `${params.pool_name}の予約受付`,
    });
    
    if (!poolResponse.pool) {
      return {
        success: false,
        message: 'プールの作成に失敗しました。もう一度お試しください。',
      };
    }
    
    const pool = poolResponse.pool;
    const results: string[] = [];
    results.push(`✅ プール「${pool.name}」を作成しました`);
    
    // -------------------- 2. メンバー追加 --------------------
    let membersAdded = 0;
    
    // 自分自身を最初のメンバーとして追加（オーナー）
    try {
      await poolsApi.addMember(pool.id, { user_id: pool.owner_user_id });
      membersAdded++;
    } catch (e) {
      // 既に追加されている場合は無視
      console.log('[PoolCreate] Owner already a member or error:', e);
    }
    
    // 指定されたメンバーを追加
    if (params.member_emails && params.member_emails.length > 0) {
      for (const email of params.member_emails) {
        try {
          // TODO: メールアドレスからuser_idを解決する必要がある
          // 現状は検索APIを使う必要があるが、MVPではスキップ
          console.log('[PoolCreate] Member email to add:', email);
        } catch (e) {
          console.log('[PoolCreate] Failed to add member:', email, e);
        }
      }
    }
    
    if (membersAdded > 0) {
      results.push(`👥 メンバー ${membersAdded} 人を追加しました`);
    }
    
    // -------------------- 3. スロット作成 --------------------
    let slotsCreated = 0;
    
    if (params.slots && params.slots.length > 0) {
      // 明示的に指定されたスロット
      try {
        const slotsResponse = await poolsApi.createSlots(pool.id, params.slots);
        slotsCreated = slotsResponse.slots?.length || 0;
      } catch (e) {
        console.error('[PoolCreate] Failed to create explicit slots:', e);
      }
    } else if (params.duration_minutes) {
      // 自動生成スロット（MVPではデフォルト枠を作成）
      const defaultSlots = generateDefaultSlots(params.duration_minutes, params.range);
      if (defaultSlots.length > 0) {
        try {
          const slotsResponse = await poolsApi.createSlots(pool.id, defaultSlots);
          slotsCreated = slotsResponse.slots?.length || 0;
        } catch (e) {
          console.error('[PoolCreate] Failed to create default slots:', e);
        }
      }
    }
    
    if (slotsCreated > 0) {
      results.push(`📅 ${slotsCreated} 件の予約枠を作成しました`);
    }
    
    // -------------------- 4. 公開リンク取得 --------------------
    let publicUrl: string | null = null;
    try {
      const linkResponse = await poolsApi.getPublicLink(pool.id);
      publicUrl = linkResponse.public_url || null;
    } catch (e) {
      console.error('[PoolCreate] Failed to get public link:', e);
    }
    
    // -------------------- 結果メッセージ構築 --------------------
    let message = results.join('\n');
    
    if (publicUrl) {
      message += `\n\n🔗 **共有リンク**:\n${publicUrl}\n\nこのリンクを共有すると、誰でも予約できます。`;
    }
    
    message += '\n\n予約が入ると、メンバーに自動で割り当てられます（ラウンドロビン方式）。';
    
    if (slotsCreated === 0) {
      message += '\n\n💡 予約枠を追加するには「来週の平日10-18時で1時間枠を追加して」などと伝えてください。';
    }
    
    return {
      success: true,
      message,
      data: {
        kind: 'pool.created',
        payload: {
          pool_id: pool.id,
          pool_name: pool.name,
          members_count: membersAdded,
          slots_count: slotsCreated,
          public_url: publicUrl,
        },
      },
    };
    
  } catch (error) {
    console.error('[PoolCreate] Error:', error);
    
    const errorMessage = extractErrorMessage(error);
    
    // 重複エラーの場合
    if (errorMessage.includes('UNIQUE') || errorMessage.includes('duplicate')) {
      return {
        success: false,
        message: `同じ名前のプール「${params.pool_name}」が既に存在します。別の名前を指定してください。`,
      };
    }
    
    return {
      success: false,
      message: `プールの作成に失敗しました: ${errorMessage}`,
    };
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * デフォルトスロットを生成
 * 
 * MVP: 翌日〜1週間後の平日、指定された時間枠で生成
 */
function generateDefaultSlots(
  durationMinutes: number,
  range?: string
): Array<{ start_at: string; end_at: string; label?: string }> {
  const slots: Array<{ start_at: string; end_at: string; label?: string }> = [];
  
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() + 1); // 翌日から
  startDate.setHours(0, 0, 0, 0);
  
  const daysToGenerate = range === 'next_month' ? 30 : 7; // デフォルト1週間
  const startHour = 10; // 10時開始
  const endHour = 18; // 18時終了
  
  for (let day = 0; day < daysToGenerate; day++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + day);
    
    // 平日のみ（0=日曜, 6=土曜）
    const dayOfWeek = currentDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;
    
    // 1日3枠（午前、昼、午後）をデフォルトで生成
    const timeSlots = [
      { hour: 10, label: '午前' },
      { hour: 13, label: '午後1' },
      { hour: 15, label: '午後2' },
    ];
    
    for (const timeSlot of timeSlots) {
      const slotStart = new Date(currentDate);
      slotStart.setHours(timeSlot.hour, 0, 0, 0);
      
      const slotEnd = new Date(slotStart);
      slotEnd.setMinutes(slotEnd.getMinutes() + durationMinutes);
      
      // 終了時間が営業時間内であることを確認
      if (slotEnd.getHours() <= endHour) {
        const dateLabel = formatDateLabel(currentDate);
        slots.push({
          start_at: slotStart.toISOString(),
          end_at: slotEnd.toISOString(),
          label: `${dateLabel} ${timeSlot.label}`,
        });
      }
    }
    
    // 最大21枠（1週間 × 3枠/日）
    if (slots.length >= 21) break;
  }
  
  return slots;
}

/**
 * 日付ラベルをフォーマット
 */
function formatDateLabel(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  return `${month}/${day}(${weekday})`;
}

/**
 * エラーメッセージを抽出
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    if (typeof err.message === 'string') return err.message;
    if (typeof err.error === 'string') return err.error;
  }
  return String(error);
}

// ============================================================
// Additional Executors (Slot Management)
// ============================================================

/**
 * スロット追加 executor
 * 
 * 既存プールに予約枠を追加
 */
export async function executePoolAddSlots(
  intentResult: IntentResult,
  _context?: ExecutionContext
): Promise<ExecutionResult> {
  const params = intentResult.params as {
    pool_id?: string;
    pool_name?: string;
    slots?: SlotConfig[];
    duration_minutes?: number;
    range?: string;
  };
  
  // プールIDまたは名前が必要
  if (!params.pool_id && !params.pool_name) {
    return {
      success: false,
      message: 'どのプールに枠を追加しますか？プール名を指定してください。',
      needsClarification: {
        field: 'pool_name',
        message: '枠を追加するプール名を教えてください。',
      },
    };
  }
  
  try {
    // プール検索（名前からIDを解決）
    let poolId = params.pool_id;
    let poolName = params.pool_name;
    
    if (!poolId && poolName) {
      const poolsResponse = await poolsApi.list();
      const pool = poolsResponse.pools?.find(
        (p) => p.name === poolName || p.name.includes(poolName!)
      );
      if (!pool) {
        return {
          success: false,
          message: `プール「${poolName}」が見つかりません。`,
        };
      }
      poolId = pool.id;
      poolName = pool.name;
    }
    
    // スロット生成
    const slotsToCreate = params.slots || generateDefaultSlots(
      params.duration_minutes || 60,
      params.range
    );
    
    if (slotsToCreate.length === 0) {
      return {
        success: false,
        message: '追加する枠がありません。「来週の平日で1時間枠」などと指定してください。',
      };
    }
    
    // スロット作成
    const response = await poolsApi.createSlots(poolId!, slotsToCreate);
    const created = response.slots?.length || 0;
    
    return {
      success: true,
      message: `プール「${poolName}」に ${created} 件の予約枠を追加しました。`,
      data: {
        kind: 'pool.slots_added',
        payload: {
          pool_id: poolId,
          pool_name: poolName,
          slots_count: created,
        },
      },
    };
    
  } catch (error) {
    console.error('[PoolAddSlots] Error:', error);
    return {
      success: false,
      message: `枠の追加に失敗しました: ${extractErrorMessage(error)}`,
    };
  }
}
