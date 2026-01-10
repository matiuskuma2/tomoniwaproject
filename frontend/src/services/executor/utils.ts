/**
 * Executor Utilities - 共通ユーティリティ関数
 */

// ============================================================
// Date/Time Formatting
// ============================================================

/**
 * 安全なタイムスタンプフォーマット
 */
export function safeFormatTime(ts: string | Date): string {
  try {
    const d = typeof ts === 'string' ? new Date(ts) : ts;
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * 時間範囲のフォーマット (HH:MM - HH:MM)
 */
export function formatTimeRange(start: string, end: string): string {
  const s = safeFormatTime(start);
  const e = safeFormatTime(end);
  if (!s || !e) return '';
  return `${s} - ${e}`;
}

/**
 * 日時範囲のフォーマット (M/D HH:MM - HH:MM)
 */
export function formatDateTimeRange(start: string, end: string): string {
  try {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return '';
    
    const dateStr = `${startDate.getMonth() + 1}/${startDate.getDate()}`;
    const startTime = startDate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const endTime = endDate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    
    return `${dateStr} ${startTime} - ${endTime}`;
  } catch {
    return '';
  }
}

/**
 * 日時のフォーマット (YYYY年M月D日 H時M分)
 */
export function formatDateTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    
    return date.toLocaleString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

/**
 * 提案ラベルのフォーマット (M/D (曜) HH:MM)
 */
export function formatProposalLabel(start: Date, end: Date): string {
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const month = start.getMonth() + 1;
  const day = start.getDate();
  const weekday = weekdays[start.getDay()];
  const startTime = start.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  const endTime = end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  
  return `${month}/${day} (${weekday}) ${startTime}〜${endTime}`;
}

// ============================================================
// Status Labels
// ============================================================

/**
 * スレッドステータスの日本語ラベル
 */
export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: '下書き',
    active: '日程調整中',
    confirmed: '確定済み',
    cancelled: 'キャンセル',
    expired: '期限切れ',
  };
  return labels[status] || status;
}

/**
 * 警告メッセージの取得
 */
export function getWarningMessage(warning: string): string {
  const warnings: Record<string, string> = {
    no_common_slot: '全員が参加できる共通の日程がありません',
    low_attendance: '参加可能人数が少ない日程しかありません',
    split_votes: '回答が分散しています',
  };
  return warnings[warning] || warning;
}
