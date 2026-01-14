/**
 * Users Me API
 * P3-TZ1: ユーザープロフィール取得・タイムゾーン設定
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
};
