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
 * 3. 複数候補がいる場合 → pending.pool.member_select で選択要求
 * 4. 問題なければ draft を作成 → pending.pool.create で確認要求
 * 5. 「はい」で実作成（executePoolCreateFinalize）
 * 
 * 制約:
 * - workmate関係がないとメンバーに追加できない（D0前提）
 * - 複数候補は自動選択しない（事故防止）
 * - Pool作成前に必ず確認（confirm 1回挟む）
 */

import { poolsApi } from '../../../api/pools';
import { relationshipsApi, type UserSearchResult } from '../../../api/relationships';
import type { PendingState } from '../../pendingTypes';
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
  // pending.pool.member_select から来た場合
  selected_member_id?: string;
}

interface MemberResolution {
  name: string;
  user_id?: string;
  display_name: string;
  email?: string;
  is_workmate: boolean;
  can_request: boolean;
  error?: string;
  // 複数候補がある場合
  candidates?: UserSearchResult[];
}

interface SlotConfig {
  duration_minutes: number;
  range: 'this_week' | 'next_week' | 'next_month';
  start_hour: number;
  end_hour: number;
}

export interface PoolCreateDraft {
  pool_name: string;
  description?: string;
  members: Array<{ user_id: string; display_name: string; email?: string }>;
  slot_config?: SlotConfig;
}

// ============================================================
// Main Executor
// ============================================================

/**
 * プール作成 executor (Step 1: ドラフト生成 → pending 返却)
 * 
 * チーム指定あり版:
 * - メンバー名から relationshipsApi.search で解決
 * - workmate関係チェック
 * - 複数候補は pending.pool.member_select で選択要求
 * - 問題なければ pending.pool.create で確認要求
 */
export async function executePoolCreate(
  intentResult: IntentResult,
  context?: ExecutionContext
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
  const workmateMembers: Array<{ user_id: string; display_name: string; email?: string }> = [];
  const needsWorkmateRequest: MemberResolution[] = [];
  const notFoundMembers: string[] = [];
  const needsSelection: { name: string; candidates: UserSearchResult[] }[] = [];
  
  if (params.member_names && params.member_names.length > 0) {
    for (const name of params.member_names) {
      const resolution = await resolveMemberViaSearch(name);
      
      // 複数候補がある場合 → 選択要求
      if (resolution.candidates && resolution.candidates.length > 1) {
        needsSelection.push({
          name,
          candidates: resolution.candidates,
        });
      } else if (resolution.error || !resolution.user_id) {
        notFoundMembers.push(name);
      } else if (resolution.is_workmate) {
        workmateMembers.push({
          user_id: resolution.user_id,
          display_name: resolution.display_name,
          email: resolution.email,
        });
      } else if (resolution.can_request) {
        // 連絡先は見つかったがworkmateではない
        needsWorkmateRequest.push(resolution);
      } else {
        // can_request=falseの場合（pending中など）
        needsWorkmateRequest.push(resolution);
      }
    }
  }
  
  // -------------------- 3. 複数候補 → 選択要求 --------------------
  if (needsSelection.length > 0) {
    const first = needsSelection[0];
    const candidateList = first.candidates
      .map((c, i) => `${i + 1}) ${c.display_name} <${c.email}>`)
      .join('\n');
    
    // pending.pool.member_select を返す
    const pending: PendingState = {
      kind: 'pending.pool.member_select',
      threadId: (context as any)?.threadId ?? '__global__',
      createdAt: Date.now(),
      query_name: first.name,
      candidates: first.candidates.map(c => ({
        id: c.id,
        display_name: c.display_name,
        email: c.email,
        is_workmate: c.relationship?.relation_type === 'workmate',
      })),
      resolved_members: workmateMembers,
      remaining_names: needsSelection.slice(1).map(n => n.name),
      draft_pool_name: params.pool_name,
      original_params: intentResult.params as Record<string, unknown>,
    };
    
    return {
      success: false,
      message: `「${first.name}」が複数見つかりました。どれですか？\n\n${candidateList}\n\n番号で選んでください。`,
      data: {
        kind: 'pending.action.created',
        payload: {
          actionType: 'pool.member_select',
          pending,
        },
      } as any,
    };
  }
  
  // -------------------- 4. workmate未成立者への対応 --------------------
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
          already_workmate: workmateMembers,
          not_found: notFoundMembers,
        },
      },
    };
  }
  
  // -------------------- 5. 連絡先が見つからない場合 --------------------
  if (notFoundMembers.length > 0 && workmateMembers.length === 0 && !params.member_names?.length) {
    // メンバー指定なしの場合はOK（オーナーのみでPool作成）
  } else if (notFoundMembers.length > 0 && workmateMembers.length === 0) {
    return {
      success: false,
      message: `以下の方が見つかりませんでした：\n\n• ${notFoundMembers.join('\n• ')}\n\n正確な名前またはメールアドレスを入力するか、先に仕事仲間として登録してください。`,
    };
  }
  
  // -------------------- 6. ドラフト作成 → pending.pool.create で確認要求 --------------------
  const slotConfig: SlotConfig | undefined = (params.range || params.start_hour || params.duration_minutes) 
    ? {
        duration_minutes: params.duration_minutes || 60,
        range: parseRange(params.range),
        start_hour: params.start_hour || 10,
        end_hour: params.end_hour || 18,
      }
    : undefined;
  
  const draft: PoolCreateDraft = {
    pool_name: params.pool_name,
    description: params.description,
    members: workmateMembers,
    slot_config: slotConfig,
  };
  
  // 確認メッセージを構築
  const rangeLabel = slotConfig 
    ? (slotConfig.range === 'this_week' ? '今週' : slotConfig.range === 'next_week' ? '来週' : '来月')
    : null;
  
  const memberList = workmateMembers.length > 0
    ? workmateMembers.map(m => m.display_name).join(' / ')
    : 'あなた（オーナー）のみ';
  
  const slotInfo = slotConfig
    ? `${rangeLabel} 平日 ${slotConfig.start_hour}:00-${slotConfig.end_hour}:00 / ${slotConfig.duration_minutes}分枠`
    : '未設定（後で追加できます）';
  
  const confirmMessage = [
    `以下の内容で予約受付（プール）を作成します。よろしいですか？`,
    ``,
    `📝 プール名: ${params.pool_name}`,
    `👥 メンバー: ${memberList}`,
    `📅 枠: ${slotInfo}`,
    ``,
    `（はい / いいえ）`,
  ].join('\n');
  
  // pending.pool.create を返す
  const pending: PendingState = {
    kind: 'pending.pool.create',
    threadId: (context as any)?.threadId ?? '__global__',
    createdAt: Date.now(),
    draft,
  };
  
  return {
    success: true,
    message: confirmMessage,
    data: {
      kind: 'pending.action.created',
      payload: {
        actionType: 'pool.create.confirm',
        pending,
      },
    } as any,
  };
}

// ============================================================
// Finalize Executor (Step 2: 確認後の実作成)
// ============================================================

/**
 * プール作成実行（確認後に呼ばれる）
 */
export async function executePoolCreateFinalize(
  draft: PoolCreateDraft,
  _context?: ExecutionContext
): Promise<ExecutionResult> {
  try {
    // 1. プール作成
    const poolResponse = await poolsApi.create({
      name: draft.pool_name,
      description: draft.description || `${draft.pool_name}の予約受付`,
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
    
    // 2. オーナー自身をメンバーとして追加
    let membersAdded = 0;
    try {
      await poolsApi.addMember(pool.id, pool.owner_user_id);
      membersAdded++;
    } catch (e) {
      console.log('[PoolCreate] Owner already a member or error:', e);
    }
    
    // 3. workmate成立済みメンバーを追加
    for (const member of draft.members) {
      try {
        await poolsApi.addMember(pool.id, member.user_id);
        membersAdded++;
        results.push(`👤 ${member.display_name}さんをメンバーに追加しました`);
      } catch (e) {
        console.log('[PoolCreate] Failed to add member:', member, e);
      }
    }
    
    if (membersAdded > 0) {
      results.push(`👥 合計 ${membersAdded} 人がメンバーとして登録されました`);
    }
    
    // 4. スロット作成
    let slotsCreated = 0;
    if (draft.slot_config) {
      const defaultSlots = generateSlots(draft.slot_config);
      if (defaultSlots.length > 0) {
        try {
          const slotsResponse = await poolsApi.createSlots(pool.id, { slots: defaultSlots });
          slotsCreated = slotsResponse.slots?.length || 0;
          if (slotsCreated > 0) {
            results.push(`📅 ${slotsCreated} 件の予約枠を作成しました`);
          }
        } catch (e) {
          console.error('[PoolCreate] Failed to create slots:', e);
        }
      }
    }
    
    // 5. 公開リンク取得
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
      message += '\n\n💡 予約枠を追加するには「来週の平日で1時間枠を追加して」などと伝えてください。';
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
        message: `同じ名前のプール「${draft.pool_name}」が既に存在します。別の名前を指定してください。`,
      };
    }
    
    return {
      success: false,
      message: `プールの作成に失敗しました: ${errorMessage}`,
    };
  }
}

/**
 * プール作成キャンセル
 */
export function executePoolCreateCancel(): ExecutionResult {
  return {
    success: true,
    message: 'OK、プール作成を中止しました。',
    data: {
      kind: 'pending.action.cleared',
      payload: {},
    },
  };
}

/**
 * メンバー選択後の処理
 */
export async function executePoolMemberSelected(
  selectedMemberId: string,
  pending: PendingState & { kind: 'pending.pool.member_select' },
  context?: ExecutionContext
): Promise<ExecutionResult> {
  // 選択されたメンバーを追加
  const selected = pending.candidates.find(c => c.id === selectedMemberId);
  if (!selected) {
    return {
      success: false,
      message: '選択されたメンバーが見つかりません。',
    };
  }
  
  const resolvedMembers = [
    ...pending.resolved_members,
    {
      user_id: selected.id,
      display_name: selected.display_name,
      email: selected.email,
    },
  ];
  
  // まだ解決が必要なメンバーがいる場合は、再帰的に処理
  // （今回のMVPでは最初の1名のみ選択要求、残りは後で）
  
  // workmate チェック
  if (!selected.is_workmate) {
    return {
      success: false,
      message: `${selected.display_name}さんはまだ仕事仲間（workmate）登録されていません。\n\n先に「${selected.display_name}さんを仕事仲間に追加して」と送ってください。`,
      data: {
        kind: 'pool.needs_workmate',
        payload: {
          pool_name: pending.draft_pool_name,
          needs_workmate: [{ name: selected.display_name, email: selected.email }],
          already_workmate: pending.resolved_members,
          not_found: [],
        },
      },
    };
  }
  
  // 全メンバー解決済み → confirm フローへ
  const params = pending.original_params as CreatePoolParams;
  
  // resolvedMembers を workmateMembers として扱う（内部処理用）
  // → executePoolCreate を直接呼ばず、draft を作成して pending.pool.create へ
  
  const slotConfig: SlotConfig | undefined = (params.range || params.start_hour || params.duration_minutes) 
    ? {
        duration_minutes: params.duration_minutes || 60,
        range: parseRange(params.range),
        start_hour: params.start_hour || 10,
        end_hour: params.end_hour || 18,
      }
    : undefined;
  
  const draft: PoolCreateDraft = {
    pool_name: pending.draft_pool_name,
    description: params.description,
    members: resolvedMembers,
    slot_config: slotConfig,
  };
  
  // 確認メッセージを構築
  const rangeLabel = slotConfig 
    ? (slotConfig.range === 'this_week' ? '今週' : slotConfig.range === 'next_week' ? '来週' : '来月')
    : null;
  
  const memberList = resolvedMembers.length > 0
    ? resolvedMembers.map(m => m.display_name).join(' / ')
    : 'あなた（オーナー）のみ';
  
  const slotInfo = slotConfig
    ? `${rangeLabel} 平日 ${slotConfig.start_hour}:00-${slotConfig.end_hour}:00 / ${slotConfig.duration_minutes}分枠`
    : '未設定（後で追加できます）';
  
  const confirmMessage = [
    `以下の内容で予約受付（プール）を作成します。よろしいですか？`,
    ``,
    `📝 プール名: ${pending.draft_pool_name}`,
    `👥 メンバー: ${memberList}`,
    `📅 枠: ${slotInfo}`,
    ``,
    `（はい / いいえ）`,
  ].join('\n');
  
  // pending.pool.create を返す
  const newPending: PendingState = {
    kind: 'pending.pool.create',
    threadId: (context as any)?.threadId ?? '__global__',
    createdAt: Date.now(),
    draft,
  };
  
  return {
    success: true,
    message: confirmMessage,
    data: {
      kind: 'pending.action.created',
      payload: {
        actionType: 'pool.create.confirm',
        pending: newPending,
      },
    } as any,
  };
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * relationshipsApi.search を使ってメンバーを検索し、workmate状態を取得
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
    
    // 複数候補がある場合は candidates を返す
    if (response.results.length > 1) {
      return {
        name,
        display_name: name,
        is_workmate: false,
        can_request: false,
        candidates: response.results,
      };
    }
    
    // 1件のみヒット
    const result: UserSearchResult = response.results[0];
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
    const response = await poolsApi.createSlots(poolId!, { slots: slotsToCreate });
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
