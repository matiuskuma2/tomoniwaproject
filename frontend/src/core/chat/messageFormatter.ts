/**
 * P2-B2: 統一メッセージフォーマッター
 * 
 * 構造:
 * 見出し → 要点 → 対象者 → 次アクション → 注意書き（世代/期限）
 * 
 * 主要3パターン:
 * 1. 未返信リマインド（pending）
 * 2. 再回答リマインド（need_response）
 * 3. 追加候補通知（additional_slots）
 */

// ============================================================
// 共通型定義
// ============================================================

export interface InviteeInfo {
  email: string;
  name?: string;
  respondedVersion?: number;
  inviteeKey?: string;
}

export interface MessageContext {
  threadTitle: string;
  threadId?: string;
  currentVersion?: number;
  remainingProposals?: number;
}

// ============================================================
// 共通ヘルパー
// ============================================================

/**
 * 対象者リストをフォーマット
 */
function formatInviteeList(
  invitees: InviteeInfo[],
  options?: {
    showStatus?: boolean;  // v1時点の回答 / 未回答 を表示
    maxDisplay?: number;   // 最大表示件数
  }
): string {
  const { showStatus = false, maxDisplay = 10 } = options || {};
  
  const displayInvitees = invitees.slice(0, maxDisplay);
  const remaining = invitees.length - displayInvitees.length;
  
  let result = '';
  displayInvitees.forEach((inv, index) => {
    result += `${index + 1}. ${inv.email}`;
    if (inv.name) {
      result += ` (${inv.name})`;
    }
    if (showStatus) {
      if (inv.respondedVersion) {
        result += ` — v${inv.respondedVersion}時点の回答`;
      } else {
        result += ` — 未回答`;
      }
    }
    result += '\n';
  });
  
  if (remaining > 0) {
    result += `  ...他 ${remaining}名\n`;
  }
  
  return result;
}

/**
 * 世代情報をフォーマット
 */
function formatVersionInfo(context: MessageContext): string {
  if (!context.currentVersion || context.currentVersion <= 1) {
    return '';
  }
  
  let result = `📊 候補バージョン: v${context.currentVersion}`;
  if (context.currentVersion > 1) {
    result += ' （追加候補あり）';
  }
  result += '\n';
  
  if (context.remainingProposals !== undefined) {
    result += `🔢 追加候補: あと ${context.remainingProposals} 回\n`;
  }
  
  return result;
}

// ============================================================
// 1. 未返信リマインド（pending）
// ============================================================

/**
 * 未返信リマインド - 確認メッセージ
 */
export function formatRemindPendingConfirm(
  context: MessageContext,
  pendingInvites: InviteeInfo[]
): string {
  const count = pendingInvites.length;
  
  let message = `📩 **未返信者へのリマインド確認**\n\n`;
  message += `📋 スレッド: ${context.threadTitle}\n`;
  message += formatVersionInfo(context);
  message += `📬 送信対象: ${count}名\n\n`;
  
  message += `**対象者:**\n`;
  message += formatInviteeList(pendingInvites, { showStatus: false });
  
  message += `\n⚠️ この ${count}名 にリマインドを送りますか？\n\n`;
  message += `「はい」で送信\n`;
  message += `「いいえ」でキャンセル`;
  
  return message;
}

/**
 * 未返信リマインド - 送信完了メッセージ
 */
export function formatRemindPendingSent(
  _context: MessageContext,
  results: Array<{ email: string; status: string }>,
  nextRemindAt?: string
): string {
  const sentCount = results.filter(r => r.status === 'sent').length;
  
  let message = `✅ リマインドを送信しました！\n\n`;
  message += `📬 送信: ${sentCount}名\n`;
  
  if (results.length > 0) {
    message += `\n**送信先:**\n`;
    results.forEach((result, index) => {
      const statusIcon = result.status === 'sent' ? '✅' : '❌';
      const statusText = result.status === 'sent' ? '送信完了' : '失敗';
      message += `${index + 1}. ${result.email} - ${statusIcon}${statusText}\n`;
    });
  }
  
  if (nextRemindAt) {
    message += `\n⏰ 次回リマインド可能: ${nextRemindAt}`;
  }
  
  return message;
}

/**
 * 未返信リマインド - 対象者なしメッセージ
 */
export function formatRemindPendingNone(context: MessageContext): string {
  return `✅ 「${context.threadTitle}」は全員が回答済みです。\nリマインドを送る必要はありません。`;
}

// ============================================================
// 2. 再回答リマインド（need_response）
// ============================================================

/**
 * 再回答必要者リスト - 表示メッセージ
 */
export function formatNeedResponseList(
  context: MessageContext,
  invitees: InviteeInfo[]
): string {
  const count = invitees.length;
  
  let message = `📋 **「${context.threadTitle}」の再回答必要者**\n\n`;
  message += formatVersionInfo(context);
  message += '\n';
  
  if (count === 0) {
    message += `✅ 全員が最新の候補 (v${context.currentVersion || 1}) に回答済みです！\n`;
    message += `\n日程を確定できる状態です。「1番で確定」などと入力してください。`;
  } else {
    message += `⚠️ **再回答が必要: ${count}名**\n\n`;
    message += formatInviteeList(invitees, { showStatus: true });
    
    message += `\n💡 ヒント:\n`;
    message += `- 「リマインド」と入力すると未返信者にリマインドを送れます\n`;
    if (context.remainingProposals && context.remainingProposals > 0) {
      message += `- 「追加候補」と入力すると新しい候補日を追加できます\n`;
    }
  }
  
  return message;
}

/**
 * 再回答リマインド - 確認メッセージ
 */
export function formatRemindNeedResponseConfirm(
  context: MessageContext,
  targetInvitees: InviteeInfo[]
): string {
  const count = targetInvitees.length;
  
  let message = `📩 **再回答必要者へのリマインド確認**\n\n`;
  message += `📋 スレッド: ${context.threadTitle}\n`;
  message += formatVersionInfo(context);
  message += `📬 送信対象: ${count}名\n\n`;
  
  message += `**対象者:**\n`;
  message += formatInviteeList(targetInvitees, { showStatus: false });
  
  message += `\n⚠️ この ${count}名 にリマインドを送りますか？\n`;
  message += `（再回答が必要な招待者のみに送信されます）\n\n`;
  message += `「はい」で送信\n`;
  message += `「いいえ」でキャンセル`;
  
  return message;
}

/**
 * 再回答リマインド - 送信完了メッセージ
 */
export function formatRemindNeedResponseSent(
  context: MessageContext,
  results: Array<{ email: string; status: string }>,
  nextRemindAt?: string
): string {
  const sentCount = results.filter(r => r.status === 'sent').length;
  
  let message = `✅ 再回答が必要な方にリマインドを送信しました！\n\n`;
  message += `📬 送信: ${sentCount}名\n`;
  message += formatVersionInfo(context);
  
  if (results.length > 0) {
    message += `\n**送信先:**\n`;
    results.forEach((result, index) => {
      const statusIcon = result.status === 'sent' ? '✅' : '❌';
      const statusText = result.status === 'sent' ? '送信完了' : '失敗';
      message += `${index + 1}. ${result.email} - ${statusIcon}${statusText}\n`;
    });
  }
  
  if (nextRemindAt) {
    message += `\n⏰ 次回リマインド可能: ${nextRemindAt}`;
  }
  
  return message;
}

/**
 * 再回答リマインド - 対象者なしメッセージ
 */
export function formatRemindNeedResponseNone(context: MessageContext): string {
  return `✅ 全員が最新の候補 (v${context.currentVersion || 1}) に回答済みです。\nリマインドを送る必要はありません。`;
}

// ============================================================
// 2.5 回答済みリマインド（responded）- P2-D2
// ============================================================

/**
 * 回答済みリマインド - 確認メッセージ
 */
export function formatRemindRespondedConfirm(
  context: MessageContext,
  targetInvitees: InviteeInfo[]
): string {
  const count = targetInvitees.length;
  
  let message = `📩 **回答済みの方へのリマインド確認**\n\n`;
  message += `📋 スレッド: ${context.threadTitle}\n`;
  message += formatVersionInfo(context);
  message += `📬 送信対象: ${count}名\n\n`;
  
  message += `**対象者:**\n`;
  message += formatInviteeList(targetInvitees, { showStatus: true });
  
  message += `\n⚠️ この ${count}名 にリマインドを送りますか？\n`;
  message += `（最新候補に回答済みの招待者に送信されます）\n\n`;
  message += `「はい」で送信\n`;
  message += `「いいえ」でキャンセル`;
  
  return message;
}

/**
 * 回答済みリマインド - 送信完了メッセージ
 */
export function formatRemindRespondedSent(
  _context: MessageContext,
  results: Array<{ email: string; status: string }>,
  nextRemindAt?: string
): string {
  const sentCount = results.filter(r => r.status === 'sent').length;
  
  let message = `✅ 回答済みの方にリマインドを送信しました！\n\n`;
  message += `📬 送信: ${sentCount}名\n`;
  
  if (results.length > 0) {
    message += `\n**送信先:**\n`;
    results.forEach((result, index) => {
      const statusIcon = result.status === 'sent' ? '✅' : '❌';
      const statusText = result.status === 'sent' ? '送信完了' : '失敗';
      message += `${index + 1}. ${result.email} - ${statusIcon}${statusText}\n`;
    });
  }
  
  if (nextRemindAt) {
    message += `\n⏰ 次回リマインド可能: ${nextRemindAt}`;
  }
  
  return message;
}

/**
 * 回答済みリマインド - 対象者なしメッセージ
 */
export function formatRemindRespondedNone(context: MessageContext): string {
  return `✅ 「${context.threadTitle}」には回答済みの方がいません。\nリマインドを送る対象がありません。`;
}

// ============================================================
// 3. 追加候補通知（additional_slots）
// ============================================================

export interface AdditionalSlotsInfo {
  slotCount: number;
  slotLabels: string[];
  nextVersion: number;
  remainingProposals: number;
}

/**
 * 追加候補 - 確認メッセージ
 */
export function formatAdditionalSlotsConfirm(
  context: MessageContext,
  slotsInfo: AdditionalSlotsInfo
): string {
  const { slotCount, slotLabels, remainingProposals } = slotsInfo;
  
  let message = `📅 **「${context.threadTitle}」に追加候補を出します**\n\n`;
  
  message += `**追加する候補 (${slotCount}件):**\n`;
  const displayLabels = slotLabels.slice(0, 3);
  displayLabels.forEach(label => {
    message += `• ${label}\n`;
  });
  if (slotCount > 3) {
    message += `  ...他 ${slotCount - 3}件\n`;
  }
  
  message += `\n📌 **重要なお知らせ:**\n`;
  message += `• 既存の回答は**保持されます**\n`;
  message += `• 追加した候補について、全員に**再回答を依頼**します\n`;
  message += `• 追加候補はあと **${remainingProposals}回** まで可能です\n`;
  
  message += `\n「追加」または「キャンセル」を入力してください。`;
  
  return message;
}

/**
 * 追加候補 - 実行完了メッセージ
 */
export function formatAdditionalSlotsExecuted(
  _context: MessageContext,
  result: {
    slotsAdded: number;
    recipientCount: number;
    proposalVersion: number;
    remainingProposals: number;
  }
): string {
  const { slotsAdded, recipientCount, proposalVersion, remainingProposals } = result;
  
  let message = `✅ **追加候補を追加しました！**\n\n`;
  message += `📅 追加した候補: ${slotsAdded}件\n`;
  message += `📊 候補バージョン: v${proposalVersion}\n`;
  message += `📬 通知送信: ${recipientCount}名\n`;
  
  message += `\n📌 **お知らせ:**\n`;
  message += `• 既存の回答は保持されています\n`;
  message += `• 対象者に再回答依頼の通知を送信しました\n`;
  if (remainingProposals > 0) {
    message += `• 追加候補はあと ${remainingProposals}回 可能です\n`;
  } else {
    message += `• 追加候補の上限に達しました\n`;
  }
  
  message += `\n💡 「再回答必要」と入力すると未回答者を確認できます。`;
  
  return message;
}

// ============================================================
// エラーメッセージ
// ============================================================

export function formatThreadNotSelected(): string {
  return 'スレッドが選択されていません。\n左のスレッド一覧から選択してください。';
}

export function formatThreadStatusError(status: 'confirmed' | 'cancelled'): string {
  const statusLabel = status === 'confirmed' ? '確定' : 'キャンセル';
  return `❌ このスレッドは既に ${statusLabel} されています。\nリマインドは送れません。`;
}

export function formatAdditionalSlotsStatusError(status: string): string {
  const messages: Record<string, string> = {
    draft: '下書き状態では追加候補を出せません。まず招待を送信してください。',
    confirmed: '確定済みのスレッドには追加候補を出せません。',
    cancelled: 'キャンセル済みのスレッドには追加候補を出せません。',
  };
  return `❌ ${messages[status] || '追加候補を出せない状態です。'}`;
}

export function formatAdditionalSlotsMaxError(): string {
  return '❌ 追加候補は最大2回までです。新しいスレッドを作成してください。';
}

export function formatAdditionalSlotsDuplicateError(): string {
  return '❌ 全ての候補が既存と重複しています。別の日時を指定してください。';
}
