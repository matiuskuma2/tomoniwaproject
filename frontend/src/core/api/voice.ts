/**
 * Voice API Client
 * Phase Next-4 Day1.5: Gemini voice input correction
 */

import { api } from './client';

export interface VoiceCorrectRequest {
  text: string;
}

export interface VoiceCorrectResponse {
  original: string;
  corrected: string;
  warning?: string;
  error?: string;
}

/**
 * Voice API Client
 */
export const voiceApi = {
  /**
   * Correct voice input text using Gemini API
   * 
   * Examples:
   * - "きょうのよてい" → "今日の予定"
   * - "あしたあいてる？" → "明日の空いてる時間は？"
   */
  async correct(text: string): Promise<VoiceCorrectResponse> {
    try {
      const response = await api.post<VoiceCorrectResponse>(
        '/api/voice/correct',
        { text }
      );
      return response;
    } catch (error) {
      // Fallback: return original text on error
      console.error('[Voice API] Correction failed:', error);
      return {
        original: text,
        corrected: text,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};
