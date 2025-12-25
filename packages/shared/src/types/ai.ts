/**
 * AI Provider Types
 */

export type AIProvider = 'gemini' | 'openai';

export interface AIProviderSettings {
  id: string;
  provider: AIProvider;
  is_enabled: boolean;
  default_model: string;
  fallback_provider: AIProvider | null;
  fallback_model: string | null;
  feature_routing_json: Record<string, any>;
  created_at: number;
  updated_at: number;
}

export interface AIProviderKey {
  id: string;
  provider: AIProvider;
  key_name: string;
  api_key_enc: string;
  masked_preview: string | null;
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface AIUsageLog {
  id: string;
  user_id: string | null;
  room_id: string | null;
  workspace_id: string | null;
  provider: AIProvider;
  model: string;
  feature: string;
  status: 'success' | 'error';
  input_tokens: number | null;
  output_tokens: number | null;
  audio_seconds: number | null;
  estimated_cost_usd: number | null;
  request_metadata_json: string | null;
  error_message: string | null;
  created_at: number;
}

export interface AIBudget {
  id: string;
  scope: 'global' | 'per_user' | 'per_room' | 'per_plan';
  scope_id: string | null;
  period: 'daily' | 'monthly';
  limit_usd: number;
  action_on_exceed: 'block' | 'degrade' | 'disable_voice' | 'disable_broadcasts';
  degrade_policy_json: Record<string, any>;
  alert_50: boolean;
  alert_80: boolean;
  alert_100: boolean;
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface AIBudgetAlertEvent {
  id: string;
  budget_id: string;
  threshold_percent: number;
  current_usage_usd: number;
  limit_usd: number;
  notified_at: number;
}
