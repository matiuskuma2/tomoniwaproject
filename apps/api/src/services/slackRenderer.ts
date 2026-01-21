/**
 * Slack Renderer
 * P2-E1: EmailPreview blocks → Slack payload変換
 * 
 * 共通モデル（emailModel.ts）から Slack用メッセージを生成
 * - 文面の二重管理を防止
 * - mrkdwn + 最小 blocks で表現
 */

import type { EmailModel, EmailBlock } from '../utils/emailModel';
import type { SlackPayload, SlackBlock } from './slackClient';

/**
 * EmailModel から Slack payload を生成
 */
export function renderSlackPayload(model: EmailModel): SlackPayload {
  const blocks: SlackBlock[] = [];
  let textFallback = '';

  // Header
  const headerEmoji = getHeaderEmoji(model.template_type);
  const headerTitle = getHeaderTitle(model.template_type);
  
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `${headerEmoji} ${headerTitle}`,
      emoji: true,
    },
  });

  // Subject (サブヘッダ的に)
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*${escapeSlackMrkdwn(model.subject)}*`,
    },
  });

  textFallback += `${headerEmoji} ${headerTitle}\n${model.subject}\n\n`;

  // Divider
  blocks.push({ type: 'divider' });

  // Blocks → Slack sections
  for (const block of model.blocks) {
    const rendered = renderBlock(block, model);
    if (rendered.block) {
      blocks.push(rendered.block);
    }
    if (rendered.text) {
      textFallback += rendered.text + '\n';
    }
  }

  // CTA Button (if exists)
  if (model.cta_url) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: getCTALabel(model.template_type),
            emoji: true,
          },
          url: model.cta_url,
          action_id: 'cta_button',
        },
      ],
    });
  }

  // Footer context
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `📧 Tomoniwao（トモニワオ）からの通知 | リンク有効期限: ${model.link_expires_at}`,
      },
    ],
  });

  return {
    text: textFallback.trim(), // Fallback for notifications
    blocks,
  };
}

/**
 * EmailModel から シンプルなテキストメッセージを生成
 * （blocks非対応環境用 / デバッグ用）
 */
export function renderSlackText(model: EmailModel): string {
  const lines: string[] = [];
  
  const headerEmoji = getHeaderEmoji(model.template_type);
  const headerTitle = getHeaderTitle(model.template_type);
  
  lines.push(`${headerEmoji} *${headerTitle}*`);
  lines.push(`📋 ${model.subject}`);
  lines.push('');

  for (const block of model.blocks) {
    const text = renderBlockAsText(block);
    if (text) {
      lines.push(text);
    }
  }

  if (model.cta_url) {
    lines.push('');
    lines.push(`➡️ <${model.cta_url}|${getCTALabel(model.template_type)}>`);
  }

  lines.push('');
  lines.push(`📧 Tomoniwao（トモニワオ）| リンク有効期限: ${model.link_expires_at}`);

  return lines.join('\n');
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
      return '📝 日程を回答する';
    case 'additional_slots':
      return '📝 追加候補を確認する';
    case 'reminder':
      return '📝 日程を回答する';
    default:
      return '🔗 詳細を見る';
  }
}

function renderBlock(block: EmailBlock, model: EmailModel): { block?: SlackBlock; text?: string } {
  switch (block.type) {
    case 'intro':
      return {
        block: {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: escapeSlackMrkdwn(block.text),
          },
        },
        text: block.text,
      };

    case 'notes':
      if (block.items && block.items.length > 0) {
        const itemsText = block.items.map(item => `• ${escapeSlackMrkdwn(item)}`).join('\n');
        return {
          block: {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📌 *${escapeSlackMrkdwn(block.text)}*\n${itemsText}`,
            },
          },
          text: `📌 ${block.text}\n${block.items.map(i => `• ${i}`).join('\n')}`,
        };
      }
      return {
        block: {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: escapeSlackMrkdwn(block.text),
          },
        },
        text: block.text,
      };

    case 'slots':
      if (block.items && block.items.length > 0) {
        const slotsText = block.items.slice(0, 5).map(item => `• ${escapeSlackMrkdwn(item)}`).join('\n');
        const moreText = block.items.length > 5 ? `\n…他 ${block.items.length - 5} 件` : '';
        return {
          block: {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📅 *${escapeSlackMrkdwn(block.text)}*\n${slotsText}${moreText}`,
            },
          },
          text: `📅 ${block.text}\n${block.items.slice(0, 5).map(i => `• ${i}`).join('\n')}${moreText}`,
        };
      }
      return {};

    case 'custom_message':
      return {
        block: {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `💬 _${escapeSlackMrkdwn(block.text)}_`,
          },
        },
        text: `💬 ${block.text}`,
      };

    case 'deadline':
      return {
        block: {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `⏰ *回答期限: ${escapeSlackMrkdwn(block.text)}*`,
          },
        },
        text: `⏰ 回答期限: ${block.text}`,
      };

    case 'cta':
      // CTA is handled separately with action button
      return {};

    case 'footer':
      // Footer is rendered as context at the end
      return {};

    default:
      return {};
  }
}

function renderBlockAsText(block: EmailBlock): string | null {
  switch (block.type) {
    case 'intro':
      return block.text;

    case 'notes':
      if (block.items && block.items.length > 0) {
        return `📌 ${block.text}\n${block.items.map(i => `• ${i}`).join('\n')}`;
      }
      return block.text;

    case 'slots':
      if (block.items && block.items.length > 0) {
        const slotsText = block.items.slice(0, 5).map(i => `• ${i}`).join('\n');
        const moreText = block.items.length > 5 ? `\n…他 ${block.items.length - 5} 件` : '';
        return `📅 ${block.text}\n${slotsText}${moreText}`;
      }
      return null;

    case 'custom_message':
      return `💬 ${block.text}`;

    case 'deadline':
      return `⏰ 回答期限: ${block.text}`;

    default:
      return null;
  }
}

/**
 * Slack mrkdwn用のエスケープ
 * - & < > をエスケープ
 * - ユーザー入力をそのまま表示するために必要
 */
function escapeSlackMrkdwn(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
