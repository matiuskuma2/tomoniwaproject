/**
 * Pool Booking Executor
 * 
 * G2-A: pool_booking.book
 * 受付プールの予約（申込→Reserve→Assign→通知）を実行する
 * 
 * API: POST /api/pools/:poolId/book
 * payload: slot_id, note (optional)
 * 
 * フロー:
 * 1. プール特定（pool_name or pool_id）
 * 2. スロット特定（slot_id or 日時指定）
 * 3. 予約実行（book API）
 * 4. 結果表示（担当者名、枠情報）
 * 
 * @see G2-A-POOL-BOOKING-SPEC.md
 */

import { poolsApi, formatSlotTime, type Pool, type PoolSlot } from '../../../api/pools';
import type { IntentResult } from '../../intentClassifier';
import type { ExecutionResult, ExecutionContext } from '../types';

/**
 * 予約を実行
 * 
 * @param intentResult - 分類結果
 *   - params.pool_id: プールID（直接指定）
 *   - params.pool_name: プール名（検索用）
 *   - params.slot_id: スロットID（直接指定）
 *   - params.slot_label: スロットラベル（検索用）
 *   - params.note: 申込時のメモ
 * @param _ctx - ExecutionContext
 * @returns ExecutionResult
 */
export async function executePoolBook(
  intentResult: IntentResult,
  _ctx?: ExecutionContext
): Promise<ExecutionResult> {
  const { pool_id, pool_name, slot_id, slot_label, note } = intentResult.params;
  
  // ----------------------------------------------------------------
  // Step 1: プールの特定
  // ----------------------------------------------------------------
  let targetPool: Pool | null = null;
  let targetPoolId: string | null = pool_id as string | null;
  
  try {
    // pool_id が直接指定されている場合
    if (targetPoolId) {
      const poolResponse = await poolsApi.get(targetPoolId);
      targetPool = poolResponse.pool;
    }
    // pool_name で検索
    else if (pool_name && typeof pool_name === 'string') {
      const poolsResponse = await poolsApi.list({ limit: 100 });
      const matches = poolsResponse.pools.filter(p => 
        p.name.toLowerCase().includes(pool_name.toLowerCase())
      );
      
      if (matches.length === 0) {
        return {
          success: false,
          message: `「${pool_name}」というプールが見つかりませんでした。`,
          needsClarification: {
            field: 'pool_name',
            message: '予約したいプール名を教えてください。',
          },
        };
      }
      
      if (matches.length === 1) {
        targetPool = matches[0];
        targetPoolId = targetPool.id;
      } else {
        // 複数候補がある場合
        return buildPoolSelection(matches, pool_name);
      }
    }
    // プールが指定されていない場合 → 一覧を表示
    else {
      const poolsResponse = await poolsApi.list({ limit: 10 });
      
      if (poolsResponse.pools.length === 0) {
        return {
          success: false,
          message: '予約可能なプールがありません。\n\nプール管理者に連絡してください。',
        };
      }
      
      if (poolsResponse.pools.length === 1) {
        // プールが1つしかない場合は自動選択
        targetPool = poolsResponse.pools[0];
        targetPoolId = targetPool.id;
      } else {
        return buildPoolSelection(poolsResponse.pools, '');
      }
    }
  } catch (e) {
    return {
      success: false,
      message: `プールの取得に失敗しました: ${extractErrorMessage(e)}`,
    };
  }
  
  if (!targetPool || !targetPoolId) {
    return {
      success: false,
      message: '予約するプールを特定できませんでした。',
      needsClarification: {
        field: 'pool_name',
        message: '予約したいプール名を教えてください。',
      },
    };
  }
  
  // ----------------------------------------------------------------
  // Step 2: スロットの特定
  // ----------------------------------------------------------------
  let targetSlot: PoolSlot | null = null;
  let targetSlotId: string | null = slot_id as string | null;
  
  try {
    // slot_id が直接指定されている場合
    if (targetSlotId) {
      const slotsResponse = await poolsApi.listSlots(targetPoolId, { limit: 100 });
      targetSlot = slotsResponse.slots.find(s => s.id === targetSlotId) || null;
      
      if (!targetSlot) {
        return {
          success: false,
          message: '指定されたスロットが見つかりませんでした。',
        };
      }
      
      if (targetSlot.status !== 'open') {
        return {
          success: false,
          message: `この枠は既に予約済みです（${targetSlot.status}）。\n\n別の枠を選んでください。`,
        };
      }
    }
    // slot_label で検索、または空きスロット一覧を表示
    else {
      const slotsResponse = await poolsApi.listSlots(targetPoolId, { 
        status: 'open',
        limit: 20 
      });
      
      if (slotsResponse.slots.length === 0) {
        return {
          success: false,
          message: `「${targetPool.name}」に空き枠がありません。\n\nプール管理者に連絡してください。`,
        };
      }
      
      // slot_label で絞り込み
      if (slot_label && typeof slot_label === 'string') {
        const matches = slotsResponse.slots.filter(s => 
          s.label?.toLowerCase().includes(slot_label.toLowerCase())
        );
        
        if (matches.length === 1) {
          targetSlot = matches[0];
          targetSlotId = targetSlot.id;
        } else if (matches.length > 1) {
          return buildSlotSelection(matches, targetPool.name, slot_label);
        }
        // マッチしない場合は全スロットから選択
      }
      
      // スロットが特定できない場合は一覧表示
      if (!targetSlot) {
        if (slotsResponse.slots.length === 1) {
          // スロットが1つしかない場合は自動選択
          targetSlot = slotsResponse.slots[0];
          targetSlotId = targetSlot.id;
        } else {
          return buildSlotSelection(slotsResponse.slots, targetPool.name, slot_label as string | undefined);
        }
      }
    }
  } catch (e) {
    return {
      success: false,
      message: `スロットの取得に失敗しました: ${extractErrorMessage(e)}`,
    };
  }
  
  if (!targetSlot || !targetSlotId) {
    return {
      success: false,
      message: '予約する枠を特定できませんでした。',
      needsClarification: {
        field: 'slot_id',
        message: '予約したい枠を教えてください。',
      },
    };
  }
  
  // ----------------------------------------------------------------
  // Step 3: 予約実行
  // ----------------------------------------------------------------
  try {
    const response = await poolsApi.book(
      targetPoolId,
      targetSlotId,
      note as string | undefined
    );
    
    const slotLabel = targetSlot.label || formatSlotTime(targetSlot.start_at, targetSlot.end_at);
    
    return {
      success: true,
      message: `✅ 予約が確定しました！

📋 **${targetPool.name}**
📅 ${slotLabel}
👤 担当者に通知を送りました

予約ID: ${response.booking_id.substring(0, 8)}...`,
      data: {
        kind: 'pool_booking.booked',
        payload: {
          booking_id: response.booking_id,
          pool_id: response.pool_id,
          pool_name: targetPool.name,
          slot_id: response.slot_id,
          slot_label: slotLabel,
          slot_start_at: targetSlot.start_at,
          slot_end_at: targetSlot.end_at,
          assignee_user_id: response.assignee_user_id,
          status: response.status,
        },
      },
    };
  } catch (e) {
    const errorMessage = extractErrorMessage(e);
    
    // 409 SLOT_TAKEN
    if (errorMessage.includes('SLOT_TAKEN') || errorMessage.includes('already reserved') || errorMessage.includes('409')) {
      return {
        success: false,
        message: `この枠は他の方に取られてしまいました。\n\n別の空き枠を選んでください。`,
      };
    }
    
    // 409 NO_MEMBER_AVAILABLE
    if (errorMessage.includes('NO_MEMBER_AVAILABLE')) {
      return {
        success: false,
        message: `現在、対応可能な担当者がいません。\n\n時間をおいてから再度お試しください。`,
      };
    }
    
    // 404 SLOT_NOT_FOUND / POOL_NOT_FOUND
    if (errorMessage.includes('not found') || errorMessage.includes('404')) {
      return {
        success: false,
        message: `プールまたは枠が見つかりませんでした。\n\n管理者に連絡してください。`,
      };
    }
    
    return {
      success: false,
      message: `❌ 予約に失敗しました: ${errorMessage}`,
    };
  }
}

/**
 * 複数プールがある場合の選択肢を構築
 */
function buildPoolSelection(pools: Pool[], queryName: string): ExecutionResult {
  let message = queryName 
    ? `「${queryName}」で ${pools.length} 件のプールが見つかりました。\n\n` 
    : `${pools.length} 件のプールがあります。どれを予約しますか？\n\n`;
  
  pools.slice(0, 5).forEach((pool, index) => {
    const status = pool.is_active ? '' : ' (停止中)';
    message += `${index + 1}. ${pool.name}${status}\n`;
    if (pool.description) {
      message += `   📝 ${pool.description}\n`;
    }
  });
  
  if (pools.length > 5) {
    message += `\n...他 ${pools.length - 5} 件`;
  }
  
  message += '\n\n💡 番号またはプール名を入力してください。';
  
  return {
    success: false,
    message,
    needsClarification: {
      field: 'pool_selection',
      message: 'どのプールを予約しますか？',
    },
    data: {
      kind: 'pool_booking.pool_candidates',
      payload: {
        candidates: pools.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          is_active: p.is_active === 1,
        })),
        query_name: queryName,
      },
    },
  };
}

/**
 * 複数スロットがある場合の選択肢を構築
 */
function buildSlotSelection(slots: PoolSlot[], poolName: string, queryLabel?: string): ExecutionResult {
  let message = queryLabel 
    ? `「${queryLabel}」で ${slots.length} 件の空き枠が見つかりました。\n\n` 
    : `「${poolName}」の空き枠:\n\n`;
  
  slots.slice(0, 10).forEach((slot, index) => {
    const label = slot.label || formatSlotTime(slot.start_at, slot.end_at);
    message += `${index + 1}. ${label}\n`;
  });
  
  if (slots.length > 10) {
    message += `\n...他 ${slots.length - 10} 件`;
  }
  
  message += '\n\n💡 番号または枠名を入力して予約できます。';
  
  return {
    success: false,
    message,
    needsClarification: {
      field: 'slot_selection',
      message: 'どの枠を予約しますか？',
    },
    data: {
      kind: 'pool_booking.slot_candidates',
      payload: {
        pool_name: poolName,
        candidates: slots.map((s) => ({
          id: s.id,
          start_at: s.start_at,
          end_at: s.end_at,
          label: s.label || formatSlotTime(s.start_at, s.end_at),
        })),
        query_label: queryLabel,
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
 * pool_booking.cancel executor
 * 予約をキャンセルする
 */
export async function executePoolBookingCancel(
  intentResult: IntentResult,
  _ctx?: ExecutionContext
): Promise<ExecutionResult> {
  const { pool_id, booking_id, reason } = intentResult.params;
  
  if (!pool_id || !booking_id) {
    return {
      success: false,
      message: 'キャンセルする予約を特定できませんでした。',
      needsClarification: {
        field: 'booking_id',
        message: 'キャンセルしたい予約を選んでください。',
      },
    };
  }
  
  try {
    const response = await poolsApi.cancelBooking(
      pool_id as string,
      booking_id as string,
      reason as string | undefined
    );
    
    return {
      success: true,
      message: `✅ 予約をキャンセルしました。\n\n担当者と管理者に通知を送りました。\n枠は再び空きになりました。`,
      data: {
        kind: 'pool_booking.cancelled',
        payload: {
          booking_id: response.booking.id,
          pool_id: response.booking.pool_id,
          slot_id: response.booking.slot_id,
          status: response.booking.status,
          cancelled_by: response.booking.cancelled_by,
          cancellation_reason: response.booking.cancellation_reason,
        },
      },
    };
  } catch (e) {
    const errorMessage = extractErrorMessage(e);
    
    if (errorMessage.includes('ALREADY_CANCELLED')) {
      return {
        success: false,
        message: 'この予約は既にキャンセル済みです。',
      };
    }
    
    if (errorMessage.includes('not found') || errorMessage.includes('404')) {
      return {
        success: false,
        message: '予約が見つかりませんでした。',
      };
    }
    
    return {
      success: false,
      message: `❌ キャンセルに失敗しました: ${errorMessage}`,
    };
  }
}

/**
 * pool_booking.list executor
 * 予約一覧を表示する
 */
export async function executePoolBookingList(
  intentResult: IntentResult,
  _ctx?: ExecutionContext
): Promise<ExecutionResult> {
  const { pool_id, pool_name } = intentResult.params;
  
  try {
    // プール特定
    let targetPoolId: string | null = pool_id as string | null;
    let targetPoolName: string = '';
    
    if (!targetPoolId && pool_name) {
      const poolsResponse = await poolsApi.list({ limit: 100 });
      const matches = poolsResponse.pools.filter(p => 
        p.name.toLowerCase().includes((pool_name as string).toLowerCase())
      );
      
      if (matches.length === 1) {
        targetPoolId = matches[0].id;
        targetPoolName = matches[0].name;
      } else if (matches.length > 1) {
        return buildPoolSelection(matches, pool_name as string);
      } else {
        return {
          success: false,
          message: `「${pool_name}」というプールが見つかりませんでした。`,
        };
      }
    }
    
    if (!targetPoolId) {
      // プール一覧を表示
      const poolsResponse = await poolsApi.list({ limit: 10 });
      
      if (poolsResponse.pools.length === 0) {
        return {
          success: true,
          message: 'プールがありません。',
          data: {
            kind: 'pool_booking.list',
            payload: { pools: [], bookings: [] },
          },
        };
      }
      
      if (poolsResponse.pools.length === 1) {
        targetPoolId = poolsResponse.pools[0].id;
        targetPoolName = poolsResponse.pools[0].name;
      } else {
        return buildPoolSelection(poolsResponse.pools, '');
      }
    }
    
    // 予約一覧取得
    const bookingsResponse = await poolsApi.listBookings(targetPoolId);
    
    if (bookingsResponse.bookings.length === 0) {
      return {
        success: true,
        message: `「${targetPoolName}」の予約はありません。`,
        data: {
          kind: 'pool_booking.list',
          payload: {
            pool_id: targetPoolId,
            pool_name: targetPoolName,
            bookings: [],
          },
        },
      };
    }
    
    let message = `「${targetPoolName}」の予約一覧:\n\n`;
    
    bookingsResponse.bookings.slice(0, 10).forEach((booking, index) => {
      const status = booking.status === 'confirmed' ? '✅' : booking.status === 'cancelled' ? '❌' : '⏳';
      message += `${index + 1}. ${status} ${booking.id.substring(0, 8)}...\n`;
    });
    
    return {
      success: true,
      message,
      data: {
        kind: 'pool_booking.list',
        payload: {
          pool_id: targetPoolId,
          pool_name: targetPoolName,
          bookings: bookingsResponse.bookings,
        },
      },
    };
  } catch (e) {
    return {
      success: false,
      message: `予約一覧の取得に失敗しました: ${extractErrorMessage(e)}`,
    };
  }
}
