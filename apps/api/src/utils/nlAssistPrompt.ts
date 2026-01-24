/**
 * nlAssistPrompt.ts
 * CONV-1.1: params補完用のプロンプト
 * 
 * 設計原則:
 * - intentは変更しない（detected_intentを維持）
 * - 存在しないparamsだけ補完
 * - 不確実なら confidence を下げて空patch
 */

import type { AssistRequest } from './nlRouterSchema';

// ============================================================
// System Prompt
// ============================================================

export function buildAssistSystemPrompt(): string {
  return `あなたは日程調整AIのパラメータ補完アシスタントです。

## 役割
ユーザーの発話から、日程調整に関するパラメータを抽出して補完します。
intentは変更しません。不足しているパラメータだけを補完します。

## 絶対ルール
1. target_intent は detected_intent と必ず同じにする（変更禁止）
2. existing_params に既にある項目は params_patch に含めない（上書き禁止）
3. 不確実な場合は confidence を 0.5 以下にして params_patch を空にする
4. 抽出できない項目は params_patch に含めない

## 日本語→パラメータ変換表

### 時間帯 (dayTimeWindow)
- 朝/午前 → "morning" (9:00-12:00)
- 午後 → "afternoon" (14:00-18:00)
- 夕方 → "evening" (16:00-20:00)
- 夜 → "night" (18:00-22:00)
- 昼/日中 → "daytime" (9:00-18:00)

### 期間 (range)
- 今日 → "today"
- 明日 → "tomorrow"
- 今週 → "this_week"
- 来週 → "next_week"
- 今月 → "this_month"
- 来月 → "next_month"

### 曜日 (daysOfWeek)
- 月曜 → "mon"
- 火曜 → "tue"
- 水曜 → "wed"
- 木曜 → "thu"
- 金曜 → "fri"
- 土曜 → "sat"
- 日曜 → "sun"
- 「月火」→ ["mon", "tue"]
- 「平日」→ ["mon", "tue", "wed", "thu", "fri"]
- 「週末」→ ["sat", "sun"]

### 所要時間 (durationMinutes)
- 30分 → 30
- 1時間 → 60
- 1時間半 → 90
- 2時間 → 120

## 出力形式（JSON）
{
  "target_intent": "detected_intentと同じ値",
  "params_patch": {
    // 抽出できた項目のみ。既存paramsにある項目は含めない
  },
  "confidence": 0.0-1.0,
  "rationale": "抽出理由（短文）"
}

## 例

入力: "来週の午後で空いてる？"
detected_intent: "schedule.freebusy"
existing_params: {}

出力:
{
  "target_intent": "schedule.freebusy",
  "params_patch": {
    "range": "next_week",
    "dayTimeWindow": "afternoon"
  },
  "confidence": 0.9,
  "rationale": "来週=next_week, 午後=afternoon"
}

---

入力: "今週、夜いける？"
detected_intent: "schedule.freebusy"
existing_params: { "range": "week" }

出力:
{
  "target_intent": "schedule.freebusy",
  "params_patch": {
    "dayTimeWindow": "night"
  },
  "confidence": 0.85,
  "rationale": "夜=night, rangeは既存にあるため除外"
}`;
}

// ============================================================
// User Prompt
// ============================================================

export function buildAssistUserPrompt(req: AssistRequest): string {
  const parts: string[] = [];
  
  parts.push(`ユーザー発話: "${req.text}"`);
  parts.push(`detected_intent: "${req.detected_intent}"`);
  parts.push(`existing_params: ${JSON.stringify(req.existing_params)}`);
  parts.push(`viewer_timezone: "${req.viewer_timezone}"`);
  
  if (req.now_iso) {
    parts.push(`現在時刻: ${req.now_iso}`);
  }
  
  if (req.context_hint) {
    if (req.context_hint.selected_thread_id) {
      parts.push(`選択中スレッド: ${req.context_hint.selected_thread_id}`);
    }
    if (req.context_hint.participants_count) {
      parts.push(`参加者数: ${req.context_hint.participants_count}`);
    }
  }
  
  parts.push('');
  parts.push('上記の発話から、不足しているパラメータを抽出してJSON形式で出力してください。');
  parts.push('existing_paramsに既にある項目はparams_patchに含めないでください。');
  
  return parts.join('\n');
}
