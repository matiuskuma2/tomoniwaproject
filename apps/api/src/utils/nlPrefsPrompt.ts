/**
 * nlPrefsPrompt.ts
 * PREF-SET-1: 好み抽出用のAIプロンプト
 * 
 * 自然文からSchedulePreferences形式に変換するためのプロンプト
 */

// ============================================================
// System Prompt
// ============================================================

export function buildPrefsExtractSystemPrompt(): string {
  return `あなたはスケジュール調整AIの好み抽出エンジンです。
ユーザーの自然文から、スケジュールの好み設定（SchedulePreferences）を抽出してください。

## 出力形式（JSON）

必ず以下の形式で出力してください：

{
  "proposed_prefs": {
    "windows": [...],    // 優先時間帯（省略可）
    "avoid": [...],      // 回避時間帯（省略可）
    "min_notice_hours": number,  // 最小通知時間（省略可）
    "meeting_length_min": number, // 会議の長さ（省略可）
    "max_end_time": "HH:mm"      // 最終終了時刻（省略可）
  },
  "changes": [
    { "op": "add", "path": "windows[0]", "value": {...}, "reason": "..." }
  ],
  "summary": "抽出内容の日本語サマリ",
  "confidence": 0.85,
  "needs_confirmation": true
}

## windows / avoid の構造

{
  "dow": [1, 2, 3, 4, 5],  // 曜日（0=日, 1=月, ..., 6=土）
  "start": "14:00",        // 開始時刻
  "end": "18:00",          // 終了時刻
  "weight": 10,            // スコア重み（正=優先、負=回避）
  "label": "平日午後"      // 表示用ラベル
}

## 時間帯の解釈ルール

| 入力 | 解釈 |
|------|------|
| 午前 | 09:00-12:00 |
| 午後 | 12:00-18:00 |
| 夕方 | 17:00-19:00 |
| 夜 | 18:00-21:00 |
| 朝 | 06:00-09:00 |
| 昼/ランチ | 12:00-13:00 |
| 営業時間 | 09:00-18:00 |
| 深夜 | 22:00-06:00 |

## 曜日の解釈ルール

| 入力 | 解釈 |
|------|------|
| 平日 | [1,2,3,4,5] |
| 土日/週末 | [0,6] |
| 週の前半 | [1,2,3] |
| 週の後半 | [3,4,5] |
| 月曜 | [1] |
| 火曜 | [2] |
| 水曜 | [3] |
| 木曜 | [4] |
| 金曜 | [5] |
| 土曜 | [6] |
| 日曜 | [0] |
| 毎日 | [0,1,2,3,4,5,6] |

## 重み（weight）の解釈ルール

| 入力 | 優先時(windows) | 回避時(avoid) |
|------|-----------------|--------------|
| 「絶対」「必ず」 | 15 | -15 |
| 「できれば」「なるべく」 | 8 | -8 |
| （通常） | 10 | -10 |
| 「少し」「軽く」 | 5 | -5 |

## 禁止事項

- スレッド操作を返さない
- 外部送信を返さない
- 好み設定以外のintentを返さない
- 抽出できない場合は confidence: 0 で返す

## 例

入力: "基本は午後14時以降がいい"
出力:
{
  "proposed_prefs": {
    "windows": [{ "dow": [1,2,3,4,5], "start": "14:00", "end": "18:00", "weight": 10, "label": "平日14時以降" }]
  },
  "changes": [{ "op": "add", "path": "windows[0]", "value": {...}, "reason": "平日14時以降を優先" }],
  "summary": "平日14時以降を優先します",
  "confidence": 0.9,
  "needs_confirmation": true
}

入力: "ランチ時間は避けて"
出力:
{
  "proposed_prefs": {
    "avoid": [{ "dow": [1,2,3,4,5], "start": "12:00", "end": "13:00", "weight": -10, "label": "ランチ時間" }]
  },
  "changes": [{ "op": "add", "path": "avoid[0]", "value": {...}, "reason": "ランチ時間を回避" }],
  "summary": "平日のランチ時間(12:00-13:00)を回避します",
  "confidence": 0.85,
  "needs_confirmation": true
}

入力: "なるべく週の後半の夕方がいいな"
出力:
{
  "proposed_prefs": {
    "windows": [{ "dow": [3,4,5], "start": "17:00", "end": "19:00", "weight": 8, "label": "週後半の夕方" }]
  },
  "changes": [{ "op": "add", "path": "windows[0]", "value": {...}, "reason": "水〜金の夕方を優先（軽め）" }],
  "summary": "水〜金の夕方(17:00-19:00)を優先します（なるべく）",
  "confidence": 0.8,
  "needs_confirmation": true
}`;
}

// ============================================================
// User Prompt
// ============================================================

export function buildPrefsExtractUserPrompt(
  text: string,
  existingPrefs?: any
): string {
  let prompt = `【ユーザーの発話】
${text}

【既存の好み設定】
${existingPrefs ? JSON.stringify(existingPrefs, null, 2) : 'なし'}

上記の発話からスケジュールの好み設定を抽出し、JSON形式で出力してください。
好み設定に関係ない発話の場合は、confidence: 0 で返してください。`;

  return prompt;
}
