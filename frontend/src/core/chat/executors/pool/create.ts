/**
 * Pool Create Executor
 * 
 * G2-A: 管理者がチャットでプールを作成（チーム指定あり版）
 * 
 * 入力例:
 * - 「営業チームで予約受付つくって。メンバーは田中/佐藤/山田。来週の平日10-18で1時間枠」
 * - 「相談窓口の受付を作成して」
 * - 「面談予約のプールを作って」
 * 
 * 処理フロー:
 * 1. メンバー名 → relationshipsApi.search → user_id + workmate状態を解決
 * 2. workmate関係チェック（なければ relation.request.workmate を案内）
 * 3. slot_config を確認
 * 4. POST /api/pools (プール作成)
 * 5. POST /api/pools/:id/members (workmate成立済みのみ追加)
 * 6. POST /api/pools/:id/slots (枠作成)
 * 7. GET /api/pools/:id/public-link (公開リンク発行)
 * 
 * 制約:
 * - workmate関係がないとメンバーに追加できない（D0前提）
 */

import { poolsApi } from '../../../api/pools';
import { relationshipsApi, type UserSearchResult } from '../../../api/relationships';
import type { IntentResult } from '../../classifier/types';
import type { ExecutionResult, ExecutionContext } from '../types';

// ============================================================
// Types
// ============================================================

interface CreatePoolParams {
  pool_name?: string;
  description?: string;
  member_names?: string[];
  member_emails?: string[];
  duration_minutes?: number;
  range?: string;
  start_hour?: number;
  end_hour?: number;
}

interface MemberResolution {
  name: string;
  user_id?: string;
  display_name: string;
  email?: string;
  is_workmate: boolean;
  can_request: boolean;
  error?: string;
}

interface SlotConfig {
  duration_minutes: number;
  range: 'this_week' | 'next_week' | 'next_month';
  start_hour: number;
  end_hour: number;
}

// ============================================================
// Main Executor
// ============================================================

/**
 * プール作成 executor
 * 
 * チーム指定あり版:
 * - メンバー名から relationshipsApi.search で解決
 * - workmate関係チェック
 * - 確認フロー付き
 */
export async function executePoolCreate(
  intentResult: IntentResult,
  _context?: ExecutionContext
): Promise<ExecutionResult> {
  const params = intentResult.params as CreatePoolParams;
  
  // -------------------- 1. バリデーション --------------------
  if (!params.pool_name) {
    return {
      success: false,
      message: 'プール名を指定してください。\n\n例: 「営業チームの予約受付を作って」',
      needsClarification: {
        field: 'pool_name',
        message: '作成するプールの名前を教えてください。',
      },
    };
  }
  
  // -------------------- 2. メンバー解決 --------------------
  const workmateMembers: MemberResolution[] = [];
  const needsWorkmateRequest: MemberResolution[] = [];
  const notFoundMembers: string[] = [];
  
  if (params.member_names && params.member_names.length > 0) {
    for (const name of params.member_names) {
      const resolution = await resolveMemberViaSearch(name);
      
      if (resolution.error || !resolution.user_id) {
        notFoundMembers.push(name);
      } else if (resolution.is_workmate) {
        workmateMembers.push(resolution);
      } else if (resolution.can_request) {
        // 連絡先は見つかったがworkmateではない
        needsWorkmateRequest.push(resolution);
      } else {
        // can_request=falseの場合（pending中など）
        needsWorkmateRequest.push(resolution);
      }
    }
  }
  
  // -------------------- 3. workmate未成立者への対応 --------------------
  if (needsWorkmateRequest.length > 0) {
    const requestList = needsWorkmateRequest
      .map((m) => `• ${m.display_name}${m.email ? ` (${m.email})` : ''}`)
      .join('\n');
    
    let message = `以下の方はまだ仕事仲間（workmate）登録されていません：\n\n${requestList}\n\n`;
    message += '**予約プールのメンバーにするには、まず仕事仲間申請を行ってください。**\n\n';
    message += '例: 「田中さんを仕事仲間に追加して」';
    
    // workmate成立済みのメンバーがいる場合はその旨も伝える
    if (workmateMembers.length > 0) {
      const workmateList = workmateMembers.map((m) => m.display_name).join('、');
      message += `\n\n✅ ${workmateList} さんは仕事仲間として登録済みです。`;
    }
    
    return {
      success: false,
      message,
      data: {
        kind: 'pool.needs_workmate',
        payload: {
          pool_name: params.pool_name,
          needs_workmate: needsWorkmateRequest.map(m => ({ 
            name: m.display_name, 
            email: m.email 
          })),
          already_workmate: workmateMembers.map(m => ({ 
            user_id: m.user_id!, 
            display_name: m.display_name 
          })),
          not_found: notFoundMembers,
        },
      },
    };
  }
  
  // -------------------- 4. 連絡先が見つからない場合 --------------------
  if (notFoundMembers.length > 0 && workmateMembers.length === 0) {
    return {
      success: false,
      message: `以下の方が見つかりませんでした：\n\n• ${notFoundMembers.join('\n• ')}\n\n正確な名前またはメールアドレスを入力するか、先に仕事仲間として登録してください。`,
    };
  }
  
  // -------------------- 5. プール作成実行 --------------------
  try {
    // 5a. プール作成
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
    
    // 5b. オーナー自身をメンバーとして追加
    let membersAdded = 0;
    try {
      await poolsApi.addMember(pool.id, { user_id: pool.owner_user_id });
      membersAdded++;
    } catch (e) {
      console.log('[PoolCreate] Owner already a member or error:', e);
    }
    
    // 5c. workmate成立済みメンバーを追加
    for (const member of workmateMembers) {
      try {
        await poolsApi.addMember(pool.id, { user_id: member.user_id! });
        membersAdded++;
        results.push(`👤 ${member.display_name}さんをメンバーに追加しました`);
      } catch (e) {
        console.log('[PoolCreate] Failed to add member:', member, e);
      }
    }
    
    if (membersAdded > 0) {
      results.push(`👥 合計 ${membersAdded} 人がメンバーとして登録されました`);
    }
    
    // 5d. スロット作成
    let slotsCreated = 0;
    const slotConfig: SlotConfig = {
      duration_minutes: params.duration_minutes || 60,
      range: parseRange(params.range),
      start_hour: params.start_hour || 10,
      end_hour: params.end_hour || 18,
    };
    
    const defaultSlots = generateSlots(slotConfig);
    if (defaultSlots.length > 0) {
      try {
        const slotsResponse = await poolsApi.createSlots(pool.id, defaultSlots);
        slotsCreated = slotsResponse.slots?.length || 0;
        if (slotsCreated > 0) {
          results.push(`📅 ${slotsCreated} 件の予約枠を作成しました`);
        }
      } catch (e) {
        console.error('[PoolCreate] Failed to create slots:', e);
      }
    }
    
    // 5e. 公開リンク取得
    let publicUrl: string | null = null;
    try {
      const linkResponse = await poolsApi.getPublicLink(pool.id);
      publicUrl = linkResponse.public_url || null;
    } catch (e) {
      console.error('[PoolCreate] Failed to get public link:', e);
    }
    
    // -------------------- 6. 結果メッセージ構築 --------------------
    let message = results.join('\n');
    
    if (publicUrl) {
      message += `\n\n🔗 **共有リンク**:\n${publicUrl}\n\nこのリンクを共有すると、誰でも予約できます。`;
    }
    
    message += '\n\n予約が入ると、メンバーに自動で割り当てられます（ラウンドロビン方式）。';
    
    if (slotsCreated === 0) {
      message += '\n\n💡 予約枠を追加するには「来週の平日で1時間枠を追加して」などと伝えてください。';
    }
    
    // 連絡先が見つからなかったメンバーがいる場合
    if (notFoundMembers.length > 0) {
      message += `\n\n⚠️ 以下の方は見つからなかったためスキップしました：\n• ${notFoundMembers.join('\n• ')}`;
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
// Helper Functions
// ============================================================

/**
 * relationshipsApi.search を使ってメンバーを検索し、workmate状態を取得
 * 
 * 利点:
 * - user_id を直接取得できる
 * - workmate関係が既にあるかを1回のAPIで確認できる
 * - can_request でリクエスト可能かも分かる
 */
async function resolveMemberViaSearch(name: string): Promise<MemberResolution> {
  // 敬称を除去
  const normalizedName = name.trim().replace(/(さん|くん|氏|様|先生|殿)$/, '');
  
  try {
    const response = await relationshipsApi.search(normalizedName);
    
    if (!response.results || response.results.length === 0) {
      return {
        name,
        display_name: name,
        is_workmate: false,
        can_request: false,
        error: `「${name}」さんが見つかりません`,
      };
    }
    
    // 複数ヒットの場合は最初の1件を使用（MVP）
    // TODO: 候補選択フローを実装
    const result: UserSearchResult = response.results[0];
    
    // workmate関係があるか確認
    const isWorkmate = result.relationship?.relation_type === 'workmate';
    
    return {
      name,
      user_id: result.id,
      display_name: result.display_name || name,
      email: result.email,
      is_workmate: isWorkmate,
      can_request: result.can_request,
    };
    
  } catch (e) {
    console.error('[PoolCreate] Search error for:', name, e);
    return {
      name,
      display_name: name,
      is_workmate: false,
      can_request: false,
      error: `検索中にエラーが発生しました`,
    };
  }
}

/**
 * range文字列をパース
 */
function parseRange(range?: string): 'this_week' | 'next_week' | 'next_month' {
  if (!range) return 'next_week';
  if (range.includes('今週') || range === 'this_week') return 'this_week';
  if (range.includes('来月') || range === 'next_month') return 'next_month';
  return 'next_week';
}

/**
 * スロットを生成
 */
function generateSlots(config: SlotConfig): Array<{ start_at: string; end_at: string; label?: string }> {
  const slots: Array<{ start_at: string; end_at: string; label?: string }> = [];
  
  const now = new Date();
  const startDate = new Date(now);
  
  // range に基づいて開始日を設定
  if (config.range === 'this_week') {
    // 今日から
  } else if (config.range === 'next_week') {
    // 来週月曜から
    const dayOfWeek = startDate.getDay();
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    startDate.setDate(startDate.getDate() + daysUntilMonday);
  } else {
    // 来月1日から
    startDate.setMonth(startDate.getMonth() + 1);
    startDate.setDate(1);
  }
  startDate.setHours(0, 0, 0, 0);
  
  const daysToGenerate = config.range === 'next_month' ? 20 : 7;
  const slotsPerDay = Math.floor((config.end_hour - config.start_hour) / (config.duration_minutes / 60));
  
  for (let day = 0; day < daysToGenerate; day++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + day);
    
    // 平日のみ（0=日曜, 6=土曜）
    const dayOfWeek = currentDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;
    
    // 各時間帯でスロット生成
    for (let slotIndex = 0; slotIndex < Math.min(slotsPerDay, 4); slotIndex++) {
      const slotStart = new Date(currentDate);
      slotStart.setHours(config.start_hour + slotIndex * (config.duration_minutes / 60), 0, 0, 0);
      
      const slotEnd = new Date(slotStart);
      slotEnd.setMinutes(slotEnd.getMinutes() + config.duration_minutes);
      
      // 終了時間が営業時間内であることを確認
      if (slotEnd.getHours() <= config.end_hour) {
        const dateLabel = formatDateLabel(currentDate);
        const timeLabel = formatTimeLabel(slotStart);
        slots.push({
          start_at: slotStart.toISOString(),
          end_at: slotEnd.toISOString(),
          label: `${dateLabel} ${timeLabel}`,
        });
      }
    }
    
    // 最大28枠（7日 × 4枠/日）
    if (slots.length >= 28) break;
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
 * 時間ラベルをフォーマット
 */
function formatTimeLabel(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return '午前';
  if (hour < 15) return '午後1';
  return '午後2';
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
// Slot Management Executor
// ============================================================

/**
 * スロット追加 executor
 */
export async function executePoolAddSlots(
  intentResult: IntentResult,
  _context?: ExecutionContext
): Promise<ExecutionResult> {
  const params = intentResult.params as {
    pool_id?: string;
    pool_name?: string;
    duration_minutes?: number;
    range?: string;
    start_hour?: number;
    end_hour?: number;
  };
  
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
    // プール検索
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
    const config: SlotConfig = {
      duration_minutes: params.duration_minutes || 60,
      range: parseRange(params.range),
      start_hour: params.start_hour || 10,
      end_hour: params.end_hour || 18,
    };
    
    const slotsToCreate = generateSlots(config);
    
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
          pool_id: poolId!,
          pool_name: poolName!,
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
