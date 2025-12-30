/**
 * Gemini API Service
 * Phase Next-4 Day1: Voice input text correction
 * Uses Gemini 1.5 Flash for cost-effective short text processing
 */

interface GeminiRequest {
  contents: {
    parts: {
      text: string;
    }[];
  }[];
}

interface GeminiResponse {
  candidates: {
    content: {
      parts: {
        text: string;
      }[];
    };
  }[];
}

export class GeminiService {
  private apiKey: string;
  private model: string = 'gemini-1.5-flash';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Correct voice input text for better intent classification
   * 
   * Examples:
   * - "きょうのよてい" → "今日の予定"
   * - "あしたあいてる？" → "明日の空いてる時間は？"
   */
  async correctVoiceInput(text: string): Promise<string> {
    if (!text || text.trim().length === 0) {
      return text;
    }

    const prompt = `以下の音声入力テキストを、カレンダーアプリのチャット入力として自然な形に補正してください。

要件:
- ひらがな表記を漢字に変換
- カジュアルな口語を丁寧語に変換
- 意図を明確にする（「教えて」「確認」などの動詞を追加）
- 原文の意図を変えない
- 補正後のテキストのみを返す（説明不要）

音声入力: ${text}

補正後:`;

    try {
      const response = await this.callGemini(prompt);
      return response.trim();
    } catch (error) {
      console.error('[Gemini] Correction failed:', error);
      // Fallback: return original text
      return text;
    }
  }

  /**
   * Call Gemini API
   */
  private async callGemini(prompt: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const requestBody: GeminiRequest = {
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${errorText}`);
    }

    const data: GeminiResponse = await response.json();

    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No response from Gemini API');
    }

    return data.candidates[0].content.parts[0].text;
  }
}
