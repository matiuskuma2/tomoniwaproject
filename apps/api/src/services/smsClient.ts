/**
 * SMS Client (Twilio)
 * P2-E2: SMS通知
 * 
 * Twilio REST API を使用してSMSを送信
 * https://www.twilio.com/docs/sms/api/message-resource
 */

export interface SmsSendResult {
  success: boolean;
  messageSid?: string;
  error?: string;
}

export interface SmsSendParams {
  to: string;       // E.164形式（+81...）
  body: string;     // メッセージ本文（最大1600文字、日本語は70文字/セグメント）
  from: string;     // 送信元番号（Twilio購入番号、E.164形式）
}

/**
 * Twilio REST API でSMSを送信
 * 
 * @param accountSid - Twilio Account SID
 * @param authToken - Twilio Auth Token
 * @param params - 送信パラメータ
 */
export async function sendSms(
  accountSid: string,
  authToken: string,
  params: SmsSendParams
): Promise<SmsSendResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  // Basic認証ヘッダー
  const credentials = btoa(`${accountSid}:${authToken}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: params.to,
        From: params.from,
        Body: params.body,
      }).toString(),
    });

    const data = await response.json() as {
      sid?: string;
      status?: string;
      error_code?: number;
      error_message?: string;
      message?: string;
    };

    if (!response.ok) {
      console.error('[SmsClient] Twilio API error:', data);
      return {
        success: false,
        error: data.message || data.error_message || `HTTP ${response.status}`,
      };
    }

    console.log(`[SmsClient] SMS sent successfully: ${data.sid}`);
    return {
      success: true,
      messageSid: data.sid,
    };
  } catch (error) {
    console.error('[SmsClient] Network error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 電話番号をE.164形式に正規化（日本向け）
 * 
 * @param phone - 入力電話番号
 * @returns E.164形式の電話番号 or null（変換不可）
 * 
 * @example
 * normalizePhoneE164('090-1234-5678') // => '+819012345678'
 * normalizePhoneE164('09012345678')   // => '+819012345678'
 * normalizePhoneE164('+819012345678') // => '+819012345678'
 */
export function normalizePhoneE164(phone: string): string | null {
  if (!phone) return null;

  // 空白・ハイフン・括弧を除去
  let normalized = phone.replace(/[\s\-\(\)\.]/g, '');

  // 既にE.164形式（+始まり）の場合
  if (normalized.startsWith('+')) {
    // 数字のみかチェック（+を除く）
    if (/^\+\d{10,15}$/.test(normalized)) {
      return normalized;
    }
    return null;
  }

  // 日本の電話番号（0始まり）を変換
  if (normalized.startsWith('0') && normalized.length >= 10 && normalized.length <= 11) {
    // 0を+81に置換
    return '+81' + normalized.slice(1);
  }

  // その他は変換不可
  return null;
}

/**
 * E.164形式のバリデーション
 */
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{9,14}$/.test(phone);
}
