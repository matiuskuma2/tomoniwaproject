/**
 * Gemini API Service
 * Phase Next-4 Day1: Voice input text correction
 * PR-D-3: Business card OCR extraction via Gemini Vision
 * Uses Gemini 1.5 Flash for cost-effective short text processing
 */

interface GeminiPart {
  text?: string;
  inline_data?: {
    mime_type: string;
    data: string; // base64
  };
}

interface GeminiRequest {
  contents: {
    parts: GeminiPart[];
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

/** PR-D-3: 名刺OCR抽出結果 */
export interface BusinessCardExtraction {
  name: string;
  email?: string;
  company?: string;
  title?: string;
  phone?: string;
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
   * PR-D-3: Extract business card information from image
   * 
   * Gate-1: emailが取れない名刺は missing_email として返す（Hard fail）
   * 複数名刺対応: 1画像に複数人が写っている可能性も考慮
   */
  async extractBusinessCard(imageBase64: string, mimeType: string): Promise<BusinessCardExtraction[]> {
    const prompt = `この名刺画像から情報を抽出してください。

必ずJSON配列で返してください。説明文やマークダウンは不要です。
各オブジェクトのフィールド:
- name: 氏名（必須）
- email: メールアドレス（見つからない場合はnull）
- company: 会社名（見つからない場合はnull）
- title: 役職（見つからない場合はnull）
- phone: 電話番号（見つからない場合はnull）

例: [{"name":"田中太郎","email":"tanaka@example.com","company":"株式会社ABC","title":"代表取締役","phone":"03-1234-5678"}]

JSON配列のみを返してください:`;

    const requestBody: GeminiRequest = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: imageBase64,
              },
            },
          ],
        },
      ],
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini Vision API error: ${response.status} ${errorText}`);
    }

    const data: GeminiResponse = await response.json();

    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No response from Gemini Vision API');
    }

    const rawText = data.candidates[0].content.parts[0].text;

    // JSON抽出（マークダウンコードブロックがある場合も対応）
    const jsonMatch = rawText.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!jsonMatch) {
      throw new Error('Failed to parse Gemini Vision response as JSON array');
    }

    const parsed: BusinessCardExtraction[] = JSON.parse(jsonMatch[0]);

    // バリデーション: name が空のものは除外
    return parsed.filter(e => e.name && e.name.trim().length > 0);
  }

  /**
   * Call Gemini API (text only)
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
