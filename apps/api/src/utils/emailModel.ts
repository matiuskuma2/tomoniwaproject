/**
 * P3-INV1 共通ソース化: メールモデル
 * 
 * テンプレートとプレビューの共通ソース
 * - compose*Model(): 素材データを組み立て
 * - render*Html/Text(): model から html/text を生成
 * - emailPreview.ts: model をそのまま blocks として返す
 * 
 * これにより「テンプレ変更 = model変更」になり、ズレを防止
 */

// ============================================================
// Types
// ============================================================

export type EmailBlockType = 
  | 'intro'           // 冒頭挨拶
  | 'cta'             // 行動ボタン
  | 'slots'           // 候補日時リスト
  | 'notes'           // 注意事項
  | 'deadline'        // 期限
  | 'footer'          // フッター
  | 'custom_message'; // カスタムメッセージ

export interface EmailBlock {
  type: EmailBlockType;
  text: string;
  variables_used?: string[];
  url?: string;
  expires_at?: string;
  items?: string[];
}

export type EmailTemplateType = 'invite' | 'additional_slots' | 'reminder' | 'one_on_one';

export interface EmailModel {
  template_type: EmailTemplateType;
  subject: string;
  blocks: EmailBlock[];
  link_expires_at: string;
  recipient_timezone?: string;
  // 追加データ（render時に使用）
  cta_url?: string;
  inviter_name?: string;
}

// ============================================================
// Constants
// ============================================================

// デフォルト値。Worker の env.PUBLIC_URL で上書き可能
// emailConsumer から getAppBaseUrl(env) 経由で取得推奨
export const APP_BASE_URL = 'https://app.tomoniwao.jp';

/**
 * 環境変数から APP_BASE_URL を取得するヘルパー
 * env.PUBLIC_URL が設定されていればそちらを使用
 */
export function getAppBaseUrl(env?: { PUBLIC_URL?: string }): string {
  return env?.PUBLIC_URL || APP_BASE_URL;
}
export const LINK_EXPIRES_HOURS = '72時間';

// ============================================================
// Model Composers
// ============================================================

/**
 * 日程調整招待メールのモデル生成
 */
export function composeInviteEmailModel(params: {
  inviterName: string;
  threadTitle: string;
  token?: string;        // render時のみ必要
  recipientTimezone?: string;
}): EmailModel {
  const { inviterName, threadTitle, token, recipientTimezone } = params;
  const ctaUrl = token ? `${APP_BASE_URL}/i/${token}` : undefined;
  
  return {
    template_type: 'invite',
    subject: `【日程調整】${inviterName}さんより「${threadTitle}」のご依頼`,
    blocks: [
      {
        type: 'intro',
        text: `${inviterName} さんより、「${threadTitle}」の日程調整依頼が届きました。`,
        variables_used: ['inviter_name', 'thread_title'],
      },
      {
        type: 'notes',
        text: '候補日時から、ご都合の良い日をお選びください。回答は数分で完了します。',
      },
      {
        type: 'cta',
        text: '日程を回答する',
        url: ctaUrl || '（送信時に生成されます）',
        variables_used: ['invite_url'],
      },
      {
        type: 'deadline',
        text: LINK_EXPIRES_HOURS,
        expires_at: LINK_EXPIRES_HOURS,
      },
      {
        type: 'footer',
        text: `このメールは Tomoniwao（トモニワオ）から送信されています。ご不明な点がございましたら、${inviterName} さんに直接お問い合わせください。`,
        variables_used: ['inviter_name'],
      },
    ],
    link_expires_at: LINK_EXPIRES_HOURS,
    recipient_timezone: recipientTimezone || 'Asia/Tokyo',
    cta_url: ctaUrl,
    inviter_name: inviterName,
  };
}

/**
 * 追加候補通知メールのモデル生成
 */
export function composeAdditionalSlotsEmailModel(params: {
  threadTitle: string;
  slotCount: number;
  slotLabels: string[];
  token?: string;
  recipientTimezone?: string;
}): EmailModel {
  const { threadTitle, slotCount, slotLabels, token, recipientTimezone } = params;
  const ctaUrl = token ? `${APP_BASE_URL}/i/${token}` : undefined;
  
  return {
    template_type: 'additional_slots',
    subject: `【追加候補のお知らせ】「${threadTitle}」`,
    blocks: [
      {
        type: 'intro',
        text: `「${threadTitle}」の日程調整に、新しい候補日が追加されました。`,
        variables_used: ['thread_title'],
      },
      {
        type: 'slots',
        text: `追加された候補（${slotCount}件）`,
        items: slotLabels,
        variables_used: ['slot_count', 'slot_description'],
      },
      {
        type: 'notes',
        text: '重要なお知らせ',
        items: [
          'これまでの回答は保持されています',
          '追加された候補についてのみ、ご回答をお願いします',
          '辞退された方にはこのメールは送信されません',
        ],
      },
      {
        type: 'cta',
        text: '追加候補を確認する',
        url: ctaUrl || '（送信時に生成されます）',
        variables_used: ['invite_url'],
      },
      {
        type: 'deadline',
        text: LINK_EXPIRES_HOURS,
        expires_at: LINK_EXPIRES_HOURS,
      },
      {
        type: 'footer',
        text: 'このメールは Tomoniwao（トモニワオ）から自動送信されています。',
      },
    ],
    link_expires_at: LINK_EXPIRES_HOURS,
    recipient_timezone: recipientTimezone || 'Asia/Tokyo',
    cta_url: ctaUrl,
  };
}

/**
 * リマインドメールのモデル生成
 */
export function composeReminderEmailModel(params: {
  inviterName: string;
  threadTitle: string;
  customMessage?: string;
  expiresAt?: string;
  token?: string;
  recipientTimezone?: string;
}): EmailModel {
  const { inviterName, threadTitle, customMessage, expiresAt, token, recipientTimezone } = params;
  const ctaUrl = token ? `${APP_BASE_URL}/i/${token}` : undefined;
  
  const blocks: EmailBlock[] = [
    {
      type: 'intro',
      text: `${inviterName} さんからの「${threadTitle}」へのご回答をお待ちしています。`,
      variables_used: ['inviter_name', 'thread_title'],
    },
  ];
  
  // カスタムメッセージがあれば追加
  if (customMessage) {
    blocks.push({
      type: 'custom_message',
      text: customMessage,
      variables_used: ['custom_message'],
    });
  }
  
  blocks.push(
    {
      type: 'notes',
      text: 'まだ日程のご回答をいただいておりません。お手数ですが、ご都合をお知らせください。',
    },
    {
      type: 'cta',
      text: '日程を回答する',
      url: ctaUrl || '（送信時に生成されます）',
      variables_used: ['invite_url'],
    },
  );
  
  // 期限があれば追加
  if (expiresAt) {
    blocks.push({
      type: 'deadline',
      text: `回答期限: ${expiresAt}`,
      expires_at: expiresAt,
      variables_used: ['expires_at', 'recipient_timezone'],
    });
  }
  
  blocks.push({
    type: 'footer',
    text: `このメールは Tomoniwao（トモニワオ）から送信されています。ご不明な点がございましたら、${inviterName} さんに直接お問い合わせください。`,
    variables_used: ['inviter_name'],
  });
  
  return {
    template_type: 'reminder',
    subject: `【リマインド】${inviterName}さんより日程調整のお願い`,
    blocks,
    link_expires_at: expiresAt || LINK_EXPIRES_HOURS,
    recipient_timezone: recipientTimezone || 'Asia/Tokyo',
    cta_url: ctaUrl,
    inviter_name: inviterName,
  };
}

/**
 * v1.1: 1対1固定日時招待メールのモデル生成
 * 「この日時でOKですか？」体験を提供
 */
export function composeOneOnOneEmailModel(params: {
  organizerName: string;
  inviteeName: string;
  title: string;
  slot: {
    start_at: string;
    end_at: string;
  };
  messageHint?: string;
  token?: string;
  recipientTimezone?: string;
}): EmailModel {
  const { organizerName, inviteeName, title, slot, messageHint, token, recipientTimezone } = params;
  const ctaUrl = token ? `${APP_BASE_URL}/i/${token}` : undefined;
  
  // 日時フォーマット
  const startDate = new Date(slot.start_at);
  const endDate = new Date(slot.end_at);
  const timezone = recipientTimezone || 'Asia/Tokyo';
  
  const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: timezone,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
  const timeFormatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  });
  
  const dateStr = dateFormatter.format(startDate);
  const startTimeStr = timeFormatter.format(startDate);
  const endTimeStr = timeFormatter.format(endDate);
  const slotLabel = `${dateStr} ${startTimeStr}〜${endTimeStr}`;
  
  const blocks: EmailBlock[] = [
    {
      type: 'intro',
      text: `${organizerName} さんから「${title}」の日程確認が届きました。`,
      variables_used: ['organizer_name', 'title'],
    },
    {
      type: 'slots',
      text: '📅 提案日時',
      items: [slotLabel],
      variables_used: ['slot_start_at', 'slot_end_at'],
    },
  ];
  
  // メッセージヒントがあれば追加
  if (messageHint) {
    blocks.push({
      type: 'custom_message',
      text: messageHint,
      variables_used: ['message_hint'],
    });
  }
  
  blocks.push(
    {
      type: 'notes',
      text: 'この日時で問題なければ「承諾する」を、別の日程をご希望の場合は「別の日程を希望する」をお選びください。',
    },
    {
      type: 'cta',
      text: '日程を確認する',
      url: ctaUrl || '（送信時に生成されます）',
      variables_used: ['invite_url'],
    },
    {
      type: 'deadline',
      text: LINK_EXPIRES_HOURS,
      expires_at: LINK_EXPIRES_HOURS,
    },
    {
      type: 'footer',
      text: `このメールは Tomoniwao（トモニワオ）から送信されています。ご不明な点がございましたら、${organizerName} さんに直接お問い合わせください。`,
      variables_used: ['organizer_name'],
    }
  );
  
  return {
    template_type: 'one_on_one',
    subject: `【日程確認】${organizerName}さんから「${title}」のご依頼`,
    blocks,
    link_expires_at: LINK_EXPIRES_HOURS,
    recipient_timezone: timezone,
    cta_url: ctaUrl,
    inviter_name: organizerName,
  };
}

// ============================================================
// HTML/CSS Constants
// ============================================================

const EMAIL_STYLES = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Segoe UI', sans-serif; line-height: 1.8; color: #333; background: #f5f5f5; margin: 0; padding: 20px; }
  .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden; }
  .content { padding: 32px 24px; }
  .message { background: #f8fafc; border-left: 4px solid #2563eb; padding: 16px 20px; margin: 20px 0; border-radius: 0 8px 8px 0; }
  .highlight { background: #ecfdf5; border-left: 4px solid #059669; padding: 16px 20px; margin: 20px 0; border-radius: 0 8px 8px 0; }
  .highlight h3 { margin: 0 0 8px 0; color: #059669; }
  .info-box { background: #f0f9ff; border: 1px solid #bae6fd; padding: 16px 20px; margin: 20px 0; border-radius: 8px; }
  .info-box p { margin: 0; color: #0369a1; }
  .button-container { text-align: center; margin: 32px 0; }
  .button { display: inline-block; padding: 16px 48px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600; }
  .link-fallback { margin-top: 24px; padding: 16px; background: #f1f5f9; border-radius: 8px; font-size: 13px; color: #64748b; word-break: break-all; }
  .footer { padding: 20px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; }
  .deadline { text-align: center; color: #dc2626; font-weight: 600; margin: 16px 0; }
  .custom-message { background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px 20px; margin: 20px 0; border-radius: 8px; font-style: italic; color: #475569; }
`;

const HEADER_STYLES: Record<EmailTemplateType, { bg: string; emoji: string; title: string }> = {
  invite: {
    bg: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
    emoji: '📅',
    title: '日程調整のご依頼',
  },
  additional_slots: {
    bg: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
    emoji: '📅',
    title: '追加候補のお知らせ',
  },
  reminder: {
    bg: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    emoji: '⏰',
    title: '日程回答のお願い',
  },
  one_on_one: {
    bg: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
    emoji: '📆',
    title: '日程確認のお願い',
  },
};

const BUTTON_STYLES: Record<EmailTemplateType, string> = {
  invite: 'background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white !important; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);',
  additional_slots: 'background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white !important; box-shadow: 0 4px 12px rgba(5, 150, 105, 0.3);',
  reminder: 'background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white !important; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);',
  one_on_one: 'background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); color: white !important; box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);',
};

// ============================================================
// HTML Escape
// ============================================================

function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// ============================================================
// Render Functions
// ============================================================

/**
 * EmailModel から HTML メールを生成
 */
export function renderEmailHtml(model: EmailModel): string {
  const header = HEADER_STYLES[model.template_type];
  const buttonStyle = BUTTON_STYLES[model.template_type];
  
  let bodyContent = '';
  
  for (const block of model.blocks) {
    switch (block.type) {
      case 'intro':
        bodyContent += `
          <p>こんにちは。</p>
          <div class="message">
            ${escapeHtml(block.text).replace(/\n/g, '<br>')}
          </div>
        `;
        break;
        
      case 'notes':
        if (block.items && block.items.length > 0) {
          bodyContent += `
            <div class="info-box">
              <p>📌 <strong>${escapeHtml(block.text)}</strong></p>
              <ul style="margin: 8px 0 0 0; padding-left: 20px; color: #0369a1;">
                ${block.items.map(item => `<li>${escapeHtml(item)}</li>`).join('\n')}
              </ul>
            </div>
          `;
        } else {
          bodyContent += `<p>${escapeHtml(block.text)}</p>`;
        }
        break;
        
      case 'slots':
        if (block.items && block.items.length > 0) {
          bodyContent += `
            <div class="highlight">
              <h3>${escapeHtml(block.text)}</h3>
              <p>${block.items.map(item => escapeHtml(item)).join('<br>')}</p>
            </div>
          `;
        }
        break;
        
      case 'custom_message':
        bodyContent += `
          <div class="custom-message">
            ${escapeHtml(block.text).replace(/\n/g, '<br>')}
          </div>
        `;
        break;
        
      case 'cta':
        if (model.cta_url) {
          bodyContent += `
            <div class="button-container">
              <a href="${model.cta_url}" class="button" style="${buttonStyle}">${escapeHtml(block.text)}</a>
            </div>
            <div class="link-fallback">
              ボタンが表示されない場合は、以下のURLをコピーしてブラウザに貼り付けてください：<br>
              <a href="${model.cta_url}" style="color: #2563eb;">${model.cta_url}</a>
            </div>
          `;
        }
        break;
        
      case 'deadline':
        if (block.expires_at) {
          bodyContent += `<p class="deadline">${escapeHtml(block.text)}</p>`;
        } else {
          bodyContent += `<p style="color: #64748b; font-size: 14px; text-align: center;">このリンクは${model.link_expires_at}有効です。</p>`;
        }
        break;
        
      case 'footer':
        // フッターは別枠で処理
        break;
    }
  }
  
  // フッターブロックを取得
  const footerBlock = model.blocks.find(b => b.type === 'footer');
  const footerText = footerBlock ? escapeHtml(footerBlock.text).replace(/\n/g, '<br>') : 'Tomoniwao（トモニワオ）から送信されています。';
  
  return `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>${EMAIL_STYLES}</style>
    </head>
    <body>
      <div class="container">
        <div class="header" style="background: ${header.bg}; color: white; padding: 30px 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 24px; font-weight: 600;">${header.emoji} ${header.title}</h1>
        </div>
        <div class="content">
          ${bodyContent}
        </div>
        <div class="footer">
          ${footerText}
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * EmailModel から テキストメールを生成
 */
export function renderEmailText(model: EmailModel): string {
  const header = HEADER_STYLES[model.template_type];
  let text = `${header.emoji} ${header.title}\n\n`;
  
  for (const block of model.blocks) {
    switch (block.type) {
      case 'intro':
        text += `こんにちは。\n\n${block.text}\n\n`;
        break;
        
      case 'notes':
        if (block.items && block.items.length > 0) {
          text += `【${block.text}】\n`;
          block.items.forEach(item => {
            text += `・${item}\n`;
          });
          text += '\n';
        } else {
          text += `${block.text}\n\n`;
        }
        break;
        
      case 'slots':
        if (block.items && block.items.length > 0) {
          text += `【${block.text}】\n`;
          block.items.forEach(item => {
            text += `${item}\n`;
          });
          text += '\n';
        }
        break;
        
      case 'custom_message':
        text += `メッセージ:\n${block.text}\n\n`;
        break;
        
      case 'cta':
        if (model.cta_url) {
          text += `▼ ${block.text}\n${model.cta_url}\n\n`;
        }
        break;
        
      case 'deadline':
        if (block.expires_at) {
          text += `${block.text}\n\n`;
        } else {
          text += `このリンクは${model.link_expires_at}有効です。\n\n`;
        }
        break;
        
      case 'footer':
        text += `---\n${block.text}\n`;
        break;
    }
  }
  
  return text;
}

// ============================================================
// Model to Preview (for API response)
// ============================================================

/**
 * EmailModel を API レスポンス用の EmailPreview 形式に変換
 */
export function modelToPreview(model: EmailModel): {
  subject: string;
  blocks: EmailBlock[];
  recipient_timezone?: string;
  link_expires_at: string;
  template_type: EmailTemplateType;
} {
  return {
    subject: model.subject,
    blocks: model.blocks,
    recipient_timezone: model.recipient_timezone,
    link_expires_at: model.link_expires_at,
    template_type: model.template_type,
  };
}
