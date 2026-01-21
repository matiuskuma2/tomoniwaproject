/**
 * P3-INV1 B案: メールプレビュー骨格ブロック生成
 * 
 * 送信前判断に必要な情報を構造化データで提供
 * - 件名
 * - 本文ブロック（intro/cta/slots/notes/deadline/footer）
 * - リンク有効期限
 * - 受信者タイムゾーン
 */

// ============================================================
// Types
// ============================================================

export type EmailPreviewBlockType = 
  | 'intro'           // 冒頭挨拶
  | 'cta'             // 行動ボタン
  | 'slots'           // 候補日時リスト
  | 'notes'           // 注意事項
  | 'deadline'        // 期限
  | 'footer'          // フッター
  | 'custom_message'; // カスタムメッセージ

export interface EmailPreviewBlock {
  type: EmailPreviewBlockType;
  text: string;
  variables_used?: string[];  // 何の変数を差し込んだか（デバッグ・説明用）
  url?: string;               // CTA の場合のリンク
  expires_at?: string;        // 期限の場合（ISO string または説明文）
  items?: string[];           // リスト形式の場合（slots, notes など）
}

export interface EmailPreview {
  subject: string;
  blocks: EmailPreviewBlock[];
  recipient_timezone?: string;  // 受信者のTZ
  link_expires_at?: string;     // リンク有効期限（説明文）
  template_type: EmailTemplateType;
}

export type EmailTemplateType = 
  | 'invite'           // 日程調整招待
  | 'additional_slots' // 追加候補通知
  | 'reminder';        // リマインド

// ============================================================
// Preview Generators
// ============================================================

/**
 * 日程調整招待メールのプレビュー生成
 */
export function generateInviteEmailPreview(params: {
  inviterName: string;
  threadTitle: string;
  recipientTimezone?: string;
}): EmailPreview {
  const { inviterName, threadTitle, recipientTimezone } = params;
  
  return {
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
        url: '（送信時に生成されます）',
        variables_used: ['invite_url'],
      },
      {
        type: 'deadline',
        text: '72時間',
        expires_at: '72時間',
      },
      {
        type: 'footer',
        text: 'このメールは Tomoniwao（トモニワオ）から送信されています。',
      },
    ],
    link_expires_at: '72時間',
    recipient_timezone: recipientTimezone || 'Asia/Tokyo',
    template_type: 'invite',
  };
}

/**
 * 追加候補通知メールのプレビュー生成
 */
export function generateAdditionalSlotsEmailPreview(params: {
  threadTitle: string;
  slotCount: number;
  slotLabels: string[];
  recipientTimezone?: string;
}): EmailPreview {
  const { threadTitle, slotCount, slotLabels, recipientTimezone } = params;
  
  return {
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
        url: '（送信時に生成されます）',
        variables_used: ['invite_url'],
      },
      {
        type: 'deadline',
        text: '72時間',
        expires_at: '72時間',
      },
      {
        type: 'footer',
        text: 'このメールは Tomoniwao（トモニワオ）から自動送信されています。',
      },
    ],
    link_expires_at: '72時間',
    recipient_timezone: recipientTimezone || 'Asia/Tokyo',
    template_type: 'additional_slots',
  };
}

/**
 * リマインドメールのプレビュー生成
 */
export function generateReminderEmailPreview(params: {
  inviterName: string;
  threadTitle: string;
  customMessage?: string;
  expiresAt?: string;
  recipientTimezone?: string;
}): EmailPreview {
  const { inviterName, threadTitle, customMessage, expiresAt, recipientTimezone } = params;
  
  const blocks: EmailPreviewBlock[] = [
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
      url: '（送信時に生成されます）',
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
    subject: `【リマインド】${inviterName}さんより日程調整のお願い`,
    blocks,
    link_expires_at: expiresAt || '72時間',
    recipient_timezone: recipientTimezone || 'Asia/Tokyo',
    template_type: 'reminder',
  };
}
