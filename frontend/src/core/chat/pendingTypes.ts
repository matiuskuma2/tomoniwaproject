/**
 * pendingTypes.ts
 * P0-1: PendingState 正規化 - threadId必須・単一辞書
 * 
 * 目的:
 * - pending系を1つの辞書に統合: pendingByThreadId: Record<string, PendingState>
 * - confirm/キャンセルの判定は「今のthreadIdの pending を見る」だけにする
 * - ChatLayout / ChatPane / intentClassifier / apiExecutor の "pending受け渡し" を一本化
 */

// ============================================================
// Pending Kind (確認待ち操作の種類)
// ============================================================

export type PendingKind =
  | 'pending.action'           // Beta A: send/add_invites/add_slots
  | 'pending.contact.select'   // Phase 2: 連絡先選択待ち
  | 'pending.channel.select'   // Phase 3: チャネル選択待ち
  | 'pending.pool.create'      // G2-A: Pool作成確認待ち
  | 'pending.pool.member_select' // G2-A: Pool作成時のメンバー選択待ち
  | 'pending.contact_import.confirm'  // PR-D-1.1: 連絡先取り込み確認待ち
  | 'pending.person.select'    // PR-D-1.1: 曖昧一致時の人物選択待ち
  | 'pending.post_import.next_step' // PR-D-FE-3.1: 名刺取り込み完了後の次手選択
  | 'remind.pending'           // Phase Next-6 Day1: 未回答者リマインド
  | 'remind.need_response'     // Phase2 P2-D1: 再回答依頼リマインド
  | 'remind.responded'         // Phase2 P2-D2: 最新回答済み者リマインド
  | 'notify.confirmed'         // Phase Next-6 Day3: 確定通知
  | 'split.propose'            // Phase Next-6 Day2: 票割れ追加提案
  | 'auto_propose'             // Phase Next-5 Day2: 自動候補提案
  | 'reschedule.pending'       // P2-D3: 確定後やり直し（再調整）
  | 'ai.confirm'               // CONV-1.2: AI秘書による確認待ち
  | 'pending.scheduling.clarification'; // BUG-1b: スケジューリング途中の追加情報待ち

// ============================================================
// Base Interface (全 PendingState 共通)
// ============================================================

export interface PendingBase {
  kind: PendingKind;
  threadId: string;           // 必須: どのスレッドに紐づくか
  createdAt: number;          // Date.now() - 作成時刻
}

// ============================================================
// PendingState Union (各種確認待ち状態)
// ============================================================

export type PendingState =
  // Beta A: 招待送信 / 招待追加 / 候補追加 / PREF-SET-1: 好み設定確認
  | (PendingBase & {
      kind: 'pending.action';
      confirmToken: string;
      expiresAt: string;
      summary: {
        action?: string;
        emails?: string[];
        slots?: Array<{ start_at: string; end_at: string; label?: string }>;
        thread_title?: string;
        [key: string]: unknown;
      };
      mode: 'new_thread' | 'add_to_thread' | 'add_slots' | 'preference_set';
      threadTitle?: string;
      actionType?: 'send_invites' | 'add_invites' | 'add_slots' | 'prefs.pending';
      // PREF-SET-1: 好み設定確認フロー用
      proposed_prefs?: Record<string, unknown>;
      merged_prefs?: Record<string, unknown>;
    })
  
  // Phase Next-6 Day1: 未回答者へのリマインド
  | (PendingBase & {
      kind: 'remind.pending';
      pendingInvites: Array<{ email: string; name?: string }>;
      count: number;
    })
  
  // Phase2 P2-D1: 再回答が必要な人へのリマインド
  | (PendingBase & {
      kind: 'remind.need_response';
      targetInvitees: Array<{ email: string; name?: string; inviteeKey: string }>;
      count: number;
      threadTitle?: string;  // TD-REMIND-UNIFY: classifier から渡す用
    })
  
  // Phase2 P2-D2: 最新回答済みの人へのリマインド
  | (PendingBase & {
      kind: 'remind.responded';
      targetInvitees: Array<{ email: string; name?: string; inviteeKey: string }>;
      count: number;
      threadTitle?: string;  // TD-REMIND-UNIFY: classifier から渡す用
    })
  
  // Phase Next-6 Day3: 確定通知
  | (PendingBase & {
      kind: 'notify.confirmed';
      invites: Array<{ email: string; name?: string }>;
      finalSlot: { start_at: string; end_at: string; label?: string };
      meetingUrl?: string;
    })
  
  // Phase Next-6 Day2: 票割れ時の追加候補提案
  | (PendingBase & {
      kind: 'split.propose';
      voteSummary: Array<{ label: string; votes: number }>;
    })
  
  // Phase Next-5 Day2: 自動候補日時提案
  | (PendingBase & {
      kind: 'auto_propose';
      source: 'initial' | 'additional';
      emails?: string[];
      duration?: number;
      range?: string;
      proposals: Array<{ start_at: string; end_at: string; label: string }>;
    })
  
  // P2-D3: 確定後やり直し（再調整）
  | (PendingBase & {
      kind: 'reschedule.pending';
      originalThreadId: string;
      originalTitle: string;
      participants: Array<{ email: string; name?: string }>;
      suggestedTitle: string;
    })

  // CONV-1.2: AI秘書による確認待ち
  | (PendingBase & {
      kind: 'ai.confirm';
      targetIntent: string;             // 実行対象のintent
      params: Record<string, unknown>;  // intentに渡すparams
      sideEffect: 'none' | 'read' | 'write_local' | 'write_external';
      confirmationPrompt: string;       // 確認メッセージ
    })

  // BUG-1b: スケジューリング途中の追加情報待ち
  // 「大島くんと調整したい」→ 日付を聞く → ユーザーが「来週木曜17時から」と返す → 元のintent+personを復元して実行
  // PR-UX-15: clarificationId を追加 — threadId 以外のトークンで会話継続を追跡
  | (PendingBase & {
      kind: 'pending.scheduling.clarification';
      clarificationId: string;          // PR-UX-15: ユニーク追跡ID (crypto.randomUUID() or fallback)
      originalIntent: string;           // 元のintent (schedule.1on1.fixed 等)
      originalParams: Record<string, unknown>;  // classifier が抽出済みの params (person, title, duration_minutes 等)
      missingField: string;             // 不足フィールド ('date', 'time', 'slots')
      originalInput: string;            // 元のユーザー入力 (「大島くんと調整したい」)
    })

  // G2-A: Pool作成確認待ち
  | (PendingBase & {
      kind: 'pending.pool.create';
      draft: {
        pool_name: string;
        description?: string;
        members: Array<{ user_id: string; display_name: string; email?: string }>;
        slot_config?: {
          range?: 'this_week' | 'next_week' | 'next_month';
          start_hour?: number;
          end_hour?: number;
          duration_minutes?: number;
        };
      };
    })

  // G2-A: Pool作成時のメンバー選択待ち（同名が複数いる場合）
  | (PendingBase & {
      kind: 'pending.pool.member_select';
      query_name: string;
      candidates: Array<{
        id: string;
        display_name: string;
        email: string;
        is_workmate: boolean;
      }>;
      resolved_members: Array<{ user_id: string; display_name: string; email?: string }>;
      remaining_names: string[];
      draft_pool_name: string;
      original_params: Record<string, unknown>;
    })

  // Phase 2: 連絡先選択待ち（名前から複数候補が見つかった時）
  | (PendingBase & {
      kind: 'pending.contact.select';
      candidates: Array<{
        contact_id: string;
        display_name: string;
        email?: string;
      }>;
      query_name: string;                // 元の検索名（「大島くん」など）
      intent_to_resume: string;          // 選択後に再実行する intent
      original_params: Record<string, unknown>;  // 元の params
    })

  // Phase 3: チャネル選択待ち（複数チャネルが同条件で並ぶ時）
  | (PendingBase & {
      kind: 'pending.channel.select';
      candidates: Array<{
        type: 'email' | 'slack' | 'chatwork' | 'line' | 'phone';
        value: string;
        display_label: string;
        is_primary: boolean;
        verified: boolean;
      }>;
      contact_id: string;                 // 対象の連絡先ID
      contact_name: string;               // 対象の連絡先名
      reason: string;                     // 選択が必要な理由
      intent_to_resume: string;           // 選択後に再実行する intent
      original_params: Record<string, unknown>;  // 元の params
    })

  // PR-D-1.1: 連絡先取り込み確認待ち
  | (PendingBase & {
      kind: 'pending.contact_import.confirm';
      confirmation_token: string;
      source: 'text' | 'email' | 'csv' | 'business_card';
      preview: {
        /** 登録予定の連絡先 */
        ok: Array<{
          index: number;
          display_name: string | null;
          email: string;
        }>;
        /** メール欠落でスキップ */
        missing_email: Array<{
          index: number;
          raw_line: string;
          display_name: string | null;
        }>;
        /** 曖昧一致（要選択） */
        ambiguous: Array<{
          index: number;
          display_name: string | null;
          email: string;
          candidates: Array<{
            id: string;
            display_name: string | null;
            email: string | null;
          }>;
          reason: 'same_name' | 'similar_name' | 'email_exists';
        }>;
      };
      /** 曖昧一致の選択結果（index → action） */
      ambiguous_actions: Record<number, {
        action: 'create_new' | 'skip' | 'update_existing';
        existing_id?: string;
      }>;
      /** すべての曖昧一致が解決済みかどうか */
      all_ambiguous_resolved: boolean;
    })

  // PR-D-FE-3.1: 名刺取り込み完了後の次手選択
  | (PendingBase & {
      kind: 'pending.post_import.next_step';
      /** ユーザーが入力した意図（アップロード時のメッセージから抽出） */
      intent: 'send_invite' | 'schedule' | 'message_only' | 'unknown';
      /** ユーザーが入力した補足メッセージ */
      userMessage?: string;
      /** 取り込み結果のサマリ */
      importSummary: {
        created_count: number;
        updated_count: number;
        skipped_count: number;
        /** 取り込んだ連絡先の表示名+メール */
        imported_contacts: Array<{ display_name: string; email: string }>;
      };
      /** 取り込み元ソース */
      source: 'text' | 'csv' | 'business_card';
    })

  // PR-D-1.1: 曖昧一致時の人物選択待ち
  | (PendingBase & {
      kind: 'pending.person.select';
      parent_kind: 'contact_import';
      confirmation_token: string;
      candidate_index: number;            // 現在選択中の候補のインデックス
      input_name: string | null;          // 入力された名前
      input_email: string;                // 入力されたメール
      reason: 'same_name' | 'similar_name' | 'email_exists';
      options: Array<{
        id: string;
        display_name: string | null;
        email: string | null;
      }>;
      /** 「新規」「スキップ」も選択肢に含める */
      allow_create_new: boolean;
      allow_skip: boolean;
    });

// ============================================================
// Utility Functions
// ============================================================

/**
 * 現在のthreadIdで pending を取得
 * 
 * @param pendingByThreadId - pending状態の辞書
 * @param threadId - 現在選択中のスレッドID
 * @returns 該当するPendingState、なければnull
 */
export function getPendingForThread(
  pendingByThreadId: Record<string, PendingState | null>,
  threadId?: string | null
): PendingState | null {
  if (!threadId) return null;
  return pendingByThreadId[threadId] ?? null;
}

/**
 * pending の種類を判定するヘルパー
 */
export function isPendingAction(pending: PendingState | null): pending is PendingState & { kind: 'pending.action' } {
  return pending?.kind === 'pending.action';
}

export function isPendingRemind(pending: PendingState | null): pending is PendingState & { kind: 'remind.pending' } {
  return pending?.kind === 'remind.pending';
}

export function isPendingRemindNeedResponse(pending: PendingState | null): pending is PendingState & { kind: 'remind.need_response' } {
  return pending?.kind === 'remind.need_response';
}

export function isPendingRemindResponded(pending: PendingState | null): pending is PendingState & { kind: 'remind.responded' } {
  return pending?.kind === 'remind.responded';
}

export function isPendingNotify(pending: PendingState | null): pending is PendingState & { kind: 'notify.confirmed' } {
  return pending?.kind === 'notify.confirmed';
}

export function isPendingSplit(pending: PendingState | null): pending is PendingState & { kind: 'split.propose' } {
  return pending?.kind === 'split.propose';
}

export function isPendingAutoPropose(pending: PendingState | null): pending is PendingState & { kind: 'auto_propose' } {
  return pending?.kind === 'auto_propose';
}

export function isPendingReschedule(pending: PendingState | null): pending is PendingState & { kind: 'reschedule.pending' } {
  return pending?.kind === 'reschedule.pending';
}

export function isPendingAiConfirm(pending: PendingState | null): pending is PendingState & { kind: 'ai.confirm' } {
  return pending?.kind === 'ai.confirm';
}

export function isPendingContactSelect(pending: PendingState | null): pending is PendingState & { kind: 'pending.contact.select' } {
  return pending?.kind === 'pending.contact.select';
}

export function isPendingChannelSelect(pending: PendingState | null): pending is PendingState & { kind: 'pending.channel.select' } {
  return pending?.kind === 'pending.channel.select';
}

export function isPendingPoolCreate(pending: PendingState | null): pending is PendingState & { kind: 'pending.pool.create' } {
  return pending?.kind === 'pending.pool.create';
}

export function isPendingPoolMemberSelect(pending: PendingState | null): pending is PendingState & { kind: 'pending.pool.member_select' } {
  return pending?.kind === 'pending.pool.member_select';
}

// PR-D-1.1: 連絡先取り込み用 type guards
export function isPendingContactImportConfirm(pending: PendingState | null): pending is PendingState & { kind: 'pending.contact_import.confirm' } {
  return pending?.kind === 'pending.contact_import.confirm';
}

export function isPendingPersonSelect(pending: PendingState | null): pending is PendingState & { kind: 'pending.person.select' } {
  return pending?.kind === 'pending.person.select';
}

// PR-D-FE-3.1: 名刺取り込み完了後の次手選択
export function isPendingPostImportNextStep(pending: PendingState | null): pending is PendingState & { kind: 'pending.post_import.next_step' } {
  return pending?.kind === 'pending.post_import.next_step';
}

// BUG-1b: スケジューリング途中の追加情報待ち
export function isPendingSchedulingClarification(pending: PendingState | null): pending is PendingState & { kind: 'pending.scheduling.clarification' } {
  return pending?.kind === 'pending.scheduling.clarification';
}

/**
 * pending が確認待ち（はい/いいえ対象）かどうか
 */
export function hasPendingConfirmation(pending: PendingState | null): boolean {
  if (!pending) return false;
  return [
    'pending.action',
    'pending.contact.select',  // Phase 2
    'pending.channel.select',  // Phase 3
    'pending.pool.create',     // G2-A
    'pending.pool.member_select', // G2-A
    'pending.contact_import.confirm',  // PR-D-1.1
    'pending.person.select',   // PR-D-1.1
    'pending.post_import.next_step', // PR-D-FE-3.1
    'remind.pending',
    'remind.need_response',
    'remind.responded',
    'notify.confirmed',
    'split.propose',
    'auto_propose',
    'reschedule.pending',
    'ai.confirm',  // CONV-1.2
    'pending.scheduling.clarification',  // BUG-1b
  ].includes(pending.kind);
}

/**
 * pending の説明文を生成（デバッグ・ログ用）
 */
// ============================================================
// PR-D-FE-1: Pending UI SSOT (Single Source of Truth)
// placeholder / hint banner / send button label を一元管理
// ============================================================

/**
 * pending種別に応じた入力欄のplaceholder
 * Gate-A: 100%反映 — 何を入力すべきか明示
 */
export function getPendingPlaceholder(pending: PendingState | null): string | null {
  if (!pending) return null;
  
  switch (pending.kind) {
    // PR-D-FE-1: Contact Import系
    case 'pending.contact_import.confirm':
      return 'はい / いいえ';
    case 'pending.post_import.next_step':
      return pending.intent === 'unknown'
        ? '1=招待送信 / 2=日程調整 / 3=完了'
        : '「はい」/「いいえ」';
    case 'pending.person.select':
      return '番号で選択（例: 1） / 0=新規 / s=スキップ';
    
    // 既存 pending 系
    case 'pending.action':
      if (pending.actionType === 'add_slots') {
        return '「追加」/「やめる」';
      }
      return '「送る」/「キャンセル」/「別スレッドで」';
    case 'pending.pool.create':
      return '「はい」/「いいえ」';
    case 'pending.pool.member_select':
      return '番号で選択（例: 1）';
    case 'pending.contact.select':
      return '番号で選択（例: 1）';
    case 'pending.channel.select':
      return '番号で選択（例: 1）';
    case 'remind.pending':
    case 'remind.need_response':
    case 'remind.responded':
    case 'notify.confirmed':
    case 'split.propose':
    case 'auto_propose':
    case 'reschedule.pending':
      return '「はい」/「キャンセル」';
    case 'ai.confirm':
      return '「はい」/「いいえ」';
    case 'pending.scheduling.clarification':
      return '日時を入力（例: 来週木曜17時から）';
    default:
      return null;
  }
}

/**
 * pending種別に応じたヒントバナーのメッセージ
 * Gate-A: 現在何を待っているか明示
 */
export function getPendingHintBanner(pending: PendingState | null): string | null {
  if (!pending) return null;
  
  switch (pending.kind) {
    case 'pending.contact_import.confirm': {
      const p = pending as PendingState & { kind: 'pending.contact_import.confirm' };
      if (!p.all_ambiguous_resolved && p.preview.ambiguous.length > 0) {
        return `⚠️ 曖昧一致 ${p.preview.ambiguous.length}件あり — 「はい」で新規作成 / 「スキップして続行」/ 「いいえ」でキャンセル`;
      }
      const okCount = p.preview.ok.length;
      return `📋 連絡先 ${okCount}件の登録を確認中 — 「はい」で登録 / 「いいえ」でキャンセル`;
    }
    case 'pending.person.select': {
      const p = pending as PendingState & { kind: 'pending.person.select' };
      const optCount = p.options.length;
      return `❓ 「${p.input_name || p.input_email}」に似た連絡先が${optCount}件 — 番号で選択 / 0=新規 / s=スキップ`;
    }
    case 'pending.post_import.next_step': {
      const p = pending as PendingState & { kind: 'pending.post_import.next_step' };
      if (p.intent === 'unknown') {
        return `📋 ${p.importSummary.created_count}件の連絡先を取り込みました — 次のアクションを選んでください`;
      }
      const actionLabel = p.intent === 'send_invite' ? '招待送信' : p.intent === 'schedule' ? '日程調整' : '完了';
      return `📋 ${p.importSummary.created_count}件の連絡先を取り込みました — ${actionLabel}を実行しますか？`;
    }
    case 'pending.action':
      return `⚠️ 確認待ち: 「送る」「キャンセル」「別スレッドで」`;
    case 'pending.pool.create':
      return `⚠️ プール作成確認: 「はい」「いいえ」`;
    case 'pending.pool.member_select':
      return `❓ メンバー選択: 番号で選択`;
    case 'pending.contact.select':
      return `❓ 連絡先選択: 番号で選択`;
    case 'pending.channel.select':
      return `❓ チャネル選択: 番号で選択`;
    case 'remind.pending':
      return `⚠️ リマインド確認: 「はい」「キャンセル」`;
    case 'remind.need_response':
    case 'remind.responded':
      return `⚠️ リマインド確認: 「はい」「キャンセル」`;
    case 'notify.confirmed':
      return `⚠️ 確定通知確認: 「はい」「キャンセル」`;
    case 'split.propose':
      return `⚠️ 追加候補提案: 「はい」「キャンセル」`;
    case 'auto_propose':
      return `⚠️ 自動提案確認: 「はい」「キャンセル」`;
    case 'reschedule.pending':
      return `⚠️ 再調整確認: 「はい」「キャンセル」`;
    case 'ai.confirm':
      return `🤖 AI確認: 「はい」「いいえ」`;
    case 'pending.scheduling.clarification': {
      const p = pending as PendingState & { kind: 'pending.scheduling.clarification' };
      const personName = (p.originalParams.person as { name?: string })?.name || '';
      const suffix = (p.originalParams.person as { suffix?: string })?.suffix || 'さん';
      return `📅 ${personName}${suffix}との予定調整中 — ${p.missingField === 'date' ? '日時' : p.missingField === 'time' ? '時刻' : '候補日時'}を入力してください`;
    }
    default:
      return null;
  }
}

/**
 * pending種別に応じた送信ボタンのラベル
 * Gate-A: 操作の意味を明示
 */
export function getPendingSendButtonLabel(pending: PendingState | null): string | null {
  if (!pending) return null;
  
  switch (pending.kind) {
    case 'pending.contact_import.confirm':
      return '確定';
    case 'pending.post_import.next_step':
      return '選択';
    case 'pending.person.select':
      return '選択';
    case 'pending.action':
      return '決定';
    case 'pending.pool.create':
    case 'pending.pool.member_select':
    case 'pending.contact.select':
    case 'pending.channel.select':
      return '選択';
    case 'remind.pending':
    case 'remind.need_response':
    case 'remind.responded':
    case 'notify.confirmed':
    case 'split.propose':
    case 'auto_propose':
    case 'reschedule.pending':
    case 'ai.confirm':
      return '確定';
    case 'pending.scheduling.clarification':
      return '送信';
    default:
      return null;
  }
}

/**
 * PR-UX-15: clarificationId を生成
 * crypto.randomUUID() が利用可能ならそれを使用、そうでなければ fallback
 */
export function generateClarificationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `clr-${crypto.randomUUID()}`;
  }
  // fallback: timestamp + random
  return `clr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function describePending(pending: PendingState | null): string {
  if (!pending) return 'なし';
  
  switch (pending.kind) {
    case 'pending.action':
      return `招待操作待ち (${pending.actionType ?? pending.mode})`;
    case 'remind.pending':
      return `未回答リマインド待ち (${pending.count}名)`;
    case 'remind.need_response':
      return `再回答リマインド待ち (${pending.count}名)`;
    case 'remind.responded':
      return `回答済みリマインド待ち (${pending.count}名)`;
    case 'notify.confirmed':
      return `確定通知待ち (${pending.invites.length}名)`;
    case 'split.propose':
      return `追加候補提案待ち`;
    case 'auto_propose':
      return `自動提案待ち (${pending.proposals.length}件)`;
    case 'reschedule.pending':
      return `再調整待ち (${pending.participants.length}名)`;
    case 'ai.confirm':
      return `AI確認待ち (${pending.targetIntent})`;
    case 'pending.contact.select':
      return `連絡先選択待ち (「${pending.query_name}」${pending.candidates.length}件)`;
    case 'pending.channel.select':
      return `チャネル選択待ち (${pending.contact_name}、${pending.candidates.length}件)`;
    case 'pending.pool.create':
      return `プール作成確認待ち (${pending.draft.pool_name})`;
    case 'pending.pool.member_select':
      return `メンバー選択待ち (「${pending.query_name}」${pending.candidates.length}件)`;
    // PR-D-1.1: 連絡先取り込み
    case 'pending.contact_import.confirm':
      return `連絡先取り込み確認待ち (${pending.preview.ok.length}件)`;
    case 'pending.post_import.next_step':
      return `次手選択待ち (intent=${pending.intent}, ${pending.importSummary.created_count}件取り込み済)`;
    case 'pending.person.select':
      return `人物選択待ち (「${pending.input_name || pending.input_email}」${pending.options.length}件)`;
    case 'pending.scheduling.clarification':
      return `日程調整情報待ち (${pending.missingField}不足, intent=${pending.originalIntent}, clr=${pending.clarificationId})`;
    default:
      return `不明な状態`;
  }
}
