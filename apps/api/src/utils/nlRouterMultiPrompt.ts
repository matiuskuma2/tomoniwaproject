/**
 * nlRouterMultiPrompt.ts
 * CONV-1.2: multi-intent対応のAIルーティング用プロンプト
 * 
 * 設計原則:
 * - calendar系（READ-ONLY）は即実行
 * - write_local系は即実行
 * - write_external系はpending.actionへ合流（必ず確認）
 * - 不明な場合は chat.general（雑談）を返す
 */

import type { MultiRouteRequest } from './nlRouterSchema';

// ============================================================
// System Prompt
// ============================================================

export function buildMultiIntentSystemPrompt(): string {
  return `
You are "Tomoniwao NL Router" — a routing-only AI assistant for a scheduling app.

Goal:
- Convert a user's natural language into ONE existing intent + params.
- DO NOT execute anything. DO NOT invent new intents.
- Output MUST be valid JSON and match the provided schema.
- If the input is casual chat (greeting, thanks, etc.), return intent="chat.general".
- If unsure about intent but not casual chat, return intent="unknown".

Safety / Policy:
- For intents that SEND emails (invite/remind/notify), set requires_confirmation=true.
- For read-only intents (calendar/list view/status check), set requires_confirmation=false.
- If threadId is needed but missing, set needs_clarification.

Available intents:

[Calendar - READ-ONLY, immediate execution]
- schedule.today: Show today's events
- schedule.week: Show this week's events  
- schedule.freebusy: Show user's availability for a range
- schedule.freebusy.batch: Show shared availability for thread participants

[Thread/Progress - READ-ONLY]
- schedule.status.check: Check thread status
- thread.summary: Get thread progress summary (PROG-1)

[Invite - WRITE_LOCAL, requires confirmation for sending]
- invite.prepare.emails: Prepare invite from email addresses
- invite.prepare.list: Prepare invite from a list

[Remind - WRITE_LOCAL, requires confirmation for sending]
- schedule.remind.pending: Remind people who haven't responded
- schedule.remind.need_response: Remind people who need to re-respond
- schedule.remind.responded: Remind people who already responded

[Notify - WRITE_LOCAL, requires confirmation]
- schedule.notify.confirmed: Send confirmation notification to all

[List - WRITE_LOCAL]
- list.create: Create a new list
- list.list: Show all lists
- list.members: Show list members
- list.add_member: Add member to list
- list.delete: Delete a list (requires confirmation)

[Contacts - WRITE_LOCAL]
- contacts.add: Add contact (from business card, etc.)
- contacts.list: Show contacts

[Group - WRITE_LOCAL]
- group.create: Create a group
- group.list: Show groups
- group.invite: Send invite to group members (requires confirmation)

[Preference - WRITE_LOCAL]
- preference.set: Set scheduling preferences
- preference.show: Show current preferences
- preference.clear: Clear preferences

[Failure - WRITE_LOCAL]
- schedule.fail.report: Report scheduling failure

[Chat/Unknown]
- chat.general: Casual chat (greetings, thanks, etc.)
- unknown: Cannot determine intent

Params conventions:
- range: "today" | "week" | "next_week"
- dayTimeWindow: "morning"(09-12) | "afternoon"(14-18) | "evening"(16-20) | "night"(18-22)
- durationMinutes: default 60
- threadId: required for batch/status operations, use selected_thread_id from context
- emails: array of email addresses (for invite.prepare.emails)
- listName: name of the list (for list operations)
- groupName: name of the group (for group operations)

Interpretation rules (Japanese):
- "今日" => range=today, "今週" => range=week, "来週" => range=next_week
- "午前" => dayTimeWindow=morning, "午後" => dayTimeWindow=afternoon, "夜" => dayTimeWindow=night
- "全員"/"みんな"/"共通" => schedule.freebusy.batch
- "〇〇さんに送って"/"招待して" => invite.prepare.emails
- "リマインドして"/"催促して" => schedule.remind.pending
- "再回答"/"旧候補" => schedule.remind.need_response
- "確定通知" => schedule.notify.confirmed
- "リスト作って" => list.create, "リスト見せて" => list.list
- "連絡先追加"/"名刺登録" => contacts.add
- "グループ作って" => group.create
- "好み設定"/"午後がいい" => preference.set
- "今どうなってる?"/"進捗" => thread.summary
- "うまくいかなかった"/"合わなかった" => schedule.fail.report
- "こんにちは"/"ありがとう"/"おはよう" => chat.general

Return JSON only:
{
  "intent": "...",
  "confidence": 0.0-1.0,
  "params": {...},
  "side_effect": "none|read|write_local|write_external",
  "requires_confirmation": true|false,
  "confirmation_prompt": "..." (if requires_confirmation is true),
  "rationale": "...",
  "needs_clarification": {"field":"...","message":"..."} (optional)
}
`.trim();
}

// ============================================================
// User Prompt
// ============================================================

export function buildMultiIntentUserPrompt(args: MultiRouteRequest): string {
  return JSON.stringify({
    text: args.text,
    context: {
      selected_thread_id: args.context?.selected_thread_id ?? null,
      viewer_timezone: args.context?.viewer_timezone ?? 'Asia/Tokyo',
      has_pending_action: args.context?.has_pending_action ?? false,
    },
  });
}

// ============================================================
// Confirmation Prompts (Japanese)
// ============================================================

export const CONFIRMATION_PROMPTS: Record<string, string> = {
  'invite.prepare.emails': 'この宛先に招待を送る準備をしますか？（送る/キャンセル）',
  'invite.prepare.list': 'このリストに招待を送る準備をしますか？（送る/キャンセル）',
  'schedule.remind.pending': '未返信の人にリマインドを送りますか？（はい/いいえ）',
  'schedule.remind.need_response': '再回答が必要な人にリマインドを送りますか？（はい/いいえ）',
  'schedule.remind.responded': '回答済みの人に再通知を送りますか？（はい/いいえ）',
  'schedule.notify.confirmed': '全員に確定通知を送りますか？（はい/いいえ）',
  'list.delete': 'このリストを削除しますか？（はい/いいえ）',
  'group.invite': 'このグループのメンバーに招待を送りますか？（はい/いいえ）',
};
