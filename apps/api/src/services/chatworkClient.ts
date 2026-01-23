/**
 * Chatwork Client
 * P2-E1: Chatwork API メッセージ送信
 * 
 * API Docs: https://developer.chatwork.com/reference/post-rooms-room_id-messages
 * 
 * 特徴:
 * - retry/backoff（429/5xxエラー対応）
 * - EmailConsumer/SlackClientと同じ耐障害設計
 * - 失敗しても呼び出し元は落ちない（isolation）
 */

const CHATWORK_API_BASE = 'https://api.chatwork.com/v2';

export interface ChatworkSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  statusCode?: number;
  retryCount?: number;
}

/**
 * Chatworkにメッセージを送信
 * 
 * @param apiToken - Chatwork API Token
 * @param roomId - 送信先ルームID
 * @param body - メッセージ本文
 * @param options - 送信オプション
 * @returns 送信結果
 */
export async function sendChatworkMessage(
  apiToken: string,
  roomId: string,
  body: string,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    selfUnread?: boolean;  // 自分を未読にする（デフォルト: false）
  } = {}
): Promise<ChatworkSendResult> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 1000;

  let lastError: string | undefined;
  let lastStatusCode: number | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const url = `${CHATWORK_API_BASE}/rooms/${roomId}/messages`;
      
      const params = new URLSearchParams();
      params.append('body', body);
      if (options.selfUnread) {
        params.append('self_unread', '1');
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-ChatWorkToken': apiToken,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      lastStatusCode = response.status;

      if (response.ok) {
        const data = await response.json() as { message_id: string };
        console.log(`[ChatworkClient] Message sent successfully (attempt ${attempt}), messageId: ${data.message_id}`);
        return { 
          success: true, 
          messageId: data.message_id,
          retryCount: attempt - 1 
        };
      }

      // Error handling
      const errorText = await response.text();
      
      // 429 Rate Limit or 5xx Server Error → retry with backoff
      if (response.status === 429 || response.status >= 500) {
        lastError = `Chatwork API error (${response.status}): ${errorText}`;
        console.warn(`[ChatworkClient] Retryable error (attempt ${attempt}/${maxRetries}): ${lastError}`);
        
        if (attempt < maxRetries) {
          const delay = initialDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
          await sleep(delay);
          continue;
        }
      }

      // 4xx (except 429) → don't retry
      lastError = `Chatwork API error (${response.status}): ${errorText}`;
      console.error(`[ChatworkClient] Non-retryable error: ${lastError}`);
      return { success: false, error: lastError, statusCode: response.status };

    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(`[ChatworkClient] Network error (attempt ${attempt}/${maxRetries}): ${lastError}`);
      
      if (attempt < maxRetries) {
        const delay = initialDelayMs * Math.pow(2, attempt - 1);
        await sleep(delay);
        continue;
      }
    }
  }

  // All retries exhausted
  console.error(`[ChatworkClient] Failed after ${maxRetries} retries: ${lastError}`);
  return { 
    success: false, 
    error: lastError || 'Unknown error', 
    statusCode: lastStatusCode,
    retryCount: maxRetries 
  };
}

/**
 * Chatwork API Tokenを検証（ルーム情報取得で確認）
 * 
 * @param apiToken - Chatwork API Token
 * @param roomId - ルームID
 * @returns ルーム名（成功時）またはエラー
 */
export async function verifyChatworkToken(
  apiToken: string,
  roomId: string
): Promise<{ success: boolean; roomName?: string; error?: string }> {
  try {
    const url = `${CHATWORK_API_BASE}/rooms/${roomId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-ChatWorkToken': apiToken,
      },
    });

    if (response.ok) {
      const data = await response.json() as { name: string };
      return { success: true, roomName: data.name };
    }

    const errorText = await response.text();
    return { 
      success: false, 
      error: `Chatwork API error (${response.status}): ${errorText}` 
    };

  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
