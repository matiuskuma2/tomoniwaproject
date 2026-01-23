/**
 * Users Me API
 * P3-TZ1: ユーザープロフィール取得・タイムゾーン設定
 * P3-PREF1: スケジュール好み設定
 */

import { api } from './client';

export interface UserProfile {
  id: string;
  email: string;
  display_name?: string;
  avatar_url?: string;
  timezone: string;
  locale: string;
}

export interface GetMeResponse {
  user: UserProfile;
}

export interface UpdateMeResponse {
  success: boolean;
  user: UserProfile | null;
}

export const usersMeApi = {
  /**
   * 現在のユーザー情報を取得
   */
  async getMe(): Promise<GetMeResponse> {
    return api.get<GetMeResponse>('/api/users/me');
  },

  /**
   * タイムゾーンを更新
   */
  async updateTimezone(timezone: string): Promise<UpdateMeResponse> {
    return api.patch<UpdateMeResponse>('/api/users/me', { timezone });
  },

  /**
   * ユーザー設定を更新（タイムゾーン、ロケール、表示名など）
   */
  async updateProfile(data: {
    timezone?: string;
    locale?: string;
    display_name?: string;
  }): Promise<UpdateMeResponse> {
    return api.patch<UpdateMeResponse>('/api/users/me', data);
  },

  /**
   * スケジュール好み設定を取得
   */
  async getSchedulePrefs(): Promise<GetSchedulePrefsResponse> {
    return api.get<GetSchedulePrefsResponse>('/api/users/me/schedule-prefs');
  },

  /**
   * スケジュール好み設定を保存
   */
  async updateSchedulePrefs(prefs: SchedulePreferences): Promise<UpdateSchedulePrefsResponse> {
    return api.put<UpdateSchedulePrefsResponse>('/api/users/me/schedule-prefs', { schedule_prefs: prefs });
  },

  /**
   * スケジュール好み設定をクリア
   */
  async clearSchedulePrefs(): Promise<{ success: boolean }> {
    return api.delete<{ success: boolean }>('/api/users/me/schedule-prefs');
  },
};

// ============================================================
// P3-PREF1: Schedule Preferences Types
// ============================================================

/**
 * 時間帯ルール
 */
export interface TimeWindow {
  dow: number[];      // 曜日（0=日, 1=月, ..., 6=土）
  start: string;      // 開始時刻 "HH:mm"
  end: string;        // 終了時刻 "HH:mm"
  weight: number;     // スコア重み
  label?: string;     // ラベル（例: "平日午後"）
}

/**
 * スケジュール好み設定
 */
export interface SchedulePreferences {
  // 好む時間帯（weight > 0）
  windows?: TimeWindow[];
  // 避けたい時間帯（weight < 0）
  avoid?: TimeWindow[];
  // 最小通知時間（時間単位）
  min_notice_hours?: number;
  // 会議の長さ（分）
  meeting_length_min?: number;
  // 最終終了時刻
  max_end_time?: string;
}

export interface GetSchedulePrefsResponse {
  schedule_prefs: SchedulePreferences;
  has_prefs: boolean;
}

export interface UpdateSchedulePrefsResponse {
  success: boolean;
  schedule_prefs: SchedulePreferences;
}
