/**
 * Slack Client
 * P2-E1: Slack Incoming Webhook送信
 * 
 * 特徴:
 * - retry/backoff（429/5xxエラー対応）
 * - EmailConsumerと同じ耐障害設計
 * - 失敗しても呼び出し元は落ちない（isolation）
 */

export interface SlackPayload {
  text?: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
}

export interface SlackBlock {
  type: 'section' | 'divider' | 'header' | 'context' | 'actions';
  text?: {
    type: 'mrkdwn' | 'plain_text';
    text: string;
    emoji?: boolean;
  };
  accessory?: {
    type: 'button';
    text: {
      type: 'plain_text';
      text: string;
      emoji?: boolean;
    };
    url?: string;
    action_id?: string;
  };
  elements?: Array<{
    type: 'mrkdwn' | 'plain_text' | 'button';
    text?: string | { type: string; text: string; emoji?: boolean };
    url?: string;
    action_id?: string;
  }>;
}

export interface SlackAttachment {
  color?: string;
  pretext?: string;
  title?: string;
  title_link?: string;
  text?: string;
  fields?: Array<{
    title: string;
    value: string;
    short?: boolean;
  }>;
}

export interface SlackSendResult {
  success: boolean;
  error?: string;
  statusCode?: number;
  retryCount?: number;
}

/**
 * Slack Incoming Webhookにメッセージを送信
 * 
 * @param webhookUrl - Slack Incoming Webhook URL
 * @param payload - Slack message payload
 * @param options - 送信オプション
 * @returns 送信結果
 */
export async function sendSlackWebhook(
  webhookUrl: string,
  payload: SlackPayload,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
  } = {}
): Promise<SlackSendResult> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 1000;

  let lastError: string | undefined;
  let lastStatusCode: number | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      lastStatusCode = response.status;

      if (response.ok) {
        console.log(`[SlackClient] Message sent successfully (attempt ${attempt})`);
        return { success: true, retryCount: attempt - 1 };
      }

      // Slack webhookは成功時に "ok" を返す
      const responseText = await response.text();
      
      // 429 Rate Limit or 5xx Server Error → retry with backoff
      if (response.status === 429 || response.status >= 500) {
        lastError = `Slack API error (${response.status}): ${responseText}`;
        console.warn(`[SlackClient] Retryable error (attempt ${attempt}/${maxRetries}): ${lastError}`);
        
        if (attempt < maxRetries) {
          const delay = initialDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
          await sleep(delay);
          continue;
        }
      }

      // 4xx (except 429) → don't retry
      lastError = `Slack API error (${response.status}): ${responseText}`;
      console.error(`[SlackClient] Non-retryable error: ${lastError}`);
      return { success: false, error: lastError, statusCode: response.status };

    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(`[SlackClient] Network error (attempt ${attempt}/${maxRetries}): ${lastError}`);
      
      if (attempt < maxRetries) {
        const delay = initialDelayMs * Math.pow(2, attempt - 1);
        await sleep(delay);
        continue;
      }
    }
  }

  // All retries exhausted
  console.error(`[SlackClient] Failed after ${maxRetries} retries: ${lastError}`);
  return { 
    success: false, 
    error: lastError || 'Unknown error', 
    statusCode: lastStatusCode,
    retryCount: maxRetries 
  };
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
