/**
 * System Settings Types
 */

export interface SystemSetting {
  key: string;
  value_json: any;  // Can be string, number, object, etc.
  updated_by_admin_id: string | null;
  updated_at: number;
}

export interface SystemSettingUpsertItem {
  key: string;
  value_json: any;
}
