/**
 * NL Prefs API Client
 * PREF-SET-1: AIによる好み抽出
 */

import { api } from './client';

// ============================================================
// Types (Backend schema の簡易版)
// ============================================================

export interface TimeWindow {
  dow: number[];      // 曜日（0=日, 1=月, ..., 6=土）
  start: string;      // 開始時刻 "HH:mm"
  end: string;        // 終了時刻 "HH:mm"
  weight: number;     // スコア重み
  label?: string;     // ラベル
}

export interface ProposedPrefs {
  windows?: TimeWindow[];
  avoid?: TimeWindow[];
  min_notice_hours?: number;
  meeting_length_min?: number;
  max_end_time?: string;
}

export interface ProposedChange {
  op: 'add' | 'remove' | 'replace';
  path: string;
  value?: any;
  reason: string;
}

export interface ExtractPrefsResult {
  proposed_prefs: ProposedPrefs;
  changes: ProposedChange[];
  summary: string;
  merged_prefs?: ProposedPrefs;
  confidence: number;
  needs_confirmation: true;
}

export interface ExtractPrefsResponse {
  success: boolean;
  data?: ExtractPrefsResult;
  error?: {
    code: 'PARSE_ERROR' | 'VALIDATION_ERROR' | 'AI_ERROR' | 'NO_PREFS_FOUND';
    message: string;
  };
}

// ============================================================
// API Client
// ============================================================

export const nlPrefsApi = {
  /**
   * 自然文から好み設定を抽出
   * 
   * @param text ユーザーの発話
   * @param existingPrefs 既存の好み設定（マージ用）
   * @returns 抽出結果
   */
  async extractPrefs(
    text: string,
    existingPrefs?: any
  ): Promise<ExtractPrefsResponse> {
    return api.post<ExtractPrefsResponse>('/api/nl/prefs/extract', {
      text,
      viewer_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      existing_prefs: existingPrefs,
    });
  },
};
