/**
 * Chatwork Renderer
 * P2-E1: EmailModel → Chatwork メッセージ変換
 * 
 * Chatworkのメッセージ記法:
 * - [info]...[/info] : 情報ブロック
 * - [title]...[/title] : タイトル（info内で使用）
 * - [hr] : 水平線
 * - [To:account_id] : メンション
 * 
 * 共通モデル（emailModel.ts）から Chatwork用メッセージを生成
 * - 文面の二重管理を防止
 * - Slack/Email と一貫性のある通知内容
 */

import type { EmailModel, EmailBlock } from '../utils/emailModel';

/**
 * EmailModel から Chatwork メッセージを生成
 */
export function renderChatworkMessage(model: EmailModel): string {
  const lines: string[] = [];

  const headerEmoji = getHeaderEmoji(model.template_type);
  const headerTitle = getHeaderTitle(model.template_type);

  // Info block with title
  lines.push('[info]');
  lines.push(`[title]${headerEmoji} ${headerTitle}[/title]`);
  lines.push('');
  lines.push(`📋 ${model.subject}`);
  lines.push('');

  // Render blocks
  for (const block of model.blocks) {
    const text = renderBlock(block);
    if (text) {
      lines.push(text);
      lines.push('');
    }
  }

  // CTA Link
  if (model.cta_url) {
    lines.push(`➡️ ${getCTALabel(model.template_type)}`);
    lines.push(model.cta_url);
    lines.push('');
  }

  // Footer
  lines.push(`📧 Tomoniwao（トモニワオ）| リンク有効期限: ${model.link_expires_at}`);
  lines.push('[/info]');

  return lines.join('\n');
}

/**
 * シンプルな通知メッセージを生成（info block なし）
 */
export function renderChatworkSimpleMessage(
  eventType: 'invite' | 'additional_slots' | 'reminder',
  params: {
    inviterName?: string;
    threadTitle: string;
    recipientCount?: number;
    slotCount?: number;
    remindedCount?: number;
    reminderType?: 'pending' | 'need_response' | 'responded';
  }
): string {
  switch (eventType) {
    case 'invite':
      return `📅 ${params.inviterName}さんが「${params.threadTitle}」の日程調整を開始しました（${params.recipientCount}名に招待送信）`;

    case 'additional_slots':
      return `📅 「${params.threadTitle}」に${params.slotCount}件の追加候補が追加されました`;

    case 'reminder': {
      let reminderLabel = 'リマインド';
      switch (params.reminderType) {
        case 'pending':
          reminderLabel = '未返信リマインド';
          break;
        case 'need_response':
          reminderLabel = '再回答リマインド';
          break;
        case 'responded':
          reminderLabel = '回答済みリマインド';
          break;
      }
      return `⏰ 「${params.threadTitle}」の${reminderLabel}を${params.remindedCount}名に送信しました`;
    }

    default:
      return `🔔 ${params.threadTitle} の通知`;
  }
}

// ============================================================
// Helper Functions
// ============================================================

function getHeaderEmoji(templateType: string): string {
  switch (templateType) {
    case 'invite':
      return '📅';
    case 'additional_slots':
      return '📅';
    case 'reminder':
      return '⏰';
    default:
      return '🔔';
  }
}

function getHeaderTitle(templateType: string): string {
  switch (templateType) {
    case 'invite':
      return '日程調整のご依頼';
    case 'additional_slots':
      return '追加候補のお知らせ';
    case 'reminder':
      return '日程回答のお願い';
    default:
      return 'Tomoniwao 通知';
  }
}

function getCTALabel(templateType: string): string {
  switch (templateType) {
    case 'invite':
      return '日程を回答する';
    case 'additional_slots':
      return '追加候補を確認する';
    case 'reminder':
      return '日程を回答する';
    default:
      return '詳細を見る';
  }
}

function renderBlock(block: EmailBlock): string | null {
  switch (block.type) {
    case 'intro':
      return block.text;

    case 'notes':
      if (block.items && block.items.length > 0) {
        return `📌 ${block.text}\n${block.items.map(i => `・${i}`).join('\n')}`;
      }
      return block.text;

    case 'slots':
      if (block.items && block.items.length > 0) {
        const slotsText = block.items.slice(0, 5).map(i => `・${i}`).join('\n');
        const moreText = block.items.length > 5 ? `\n…他 ${block.items.length - 5} 件` : '';
        return `📅 ${block.text}\n${slotsText}${moreText}`;
      }
      return null;

    case 'custom_message':
      return `💬 ${block.text}`;

    case 'deadline':
      return `⏰ 回答期限: ${block.text}`;

    case 'cta':
      // CTA is handled separately
      return null;

    case 'footer':
      // Footer is rendered at the end
      return null;

    default:
      return null;
  }
}
