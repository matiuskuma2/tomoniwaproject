/**
 * freebusyBatch.ts
 * P3-INTERSECT1: 複数ユーザーのbusy取得 + intersection計算
 * 
 * 設計:
 * - 各参加者のbusyを取得（self=Google Calendar、外部=未連携なら除外）
 * - busyのunionを計算（= 全員のbusy）
 * - slotGeneratorに渡してintersection（共通空き）を生成
 */

import { GoogleCalendarService } from './googleCalendar';
import { generateAvailableSlots, getTimeWindowFromPrefer } from '../utils/slotGenerator';
import { scoreSlots, type ParticipantPrefs } from '../utils/slotScorer';
import { parseSchedulePrefs, type ScoredSlot, type ScoreReason } from '../utils/schedulePrefs';
import type { AvailableSlot, DayTimeWindow, SlotGeneratorResult } from '../utils/slotGenerator';
import type { Env } from '../../../../packages/shared/src/types/env';

// ============================================================
// Types
// ============================================================

export interface ParticipantInfo {
  type: 'self' | 'app_user' | 'external';
  userId?: string;       // app_user の場合のみ
  email?: string;        // 識別用（ログ・表示用）
  name?: string;         // 表示用
}

export interface BatchFreeBusyParams {
  organizerUserId: string;
  participants: ParticipantInfo[];
  timeMin: string;
  timeMax: string;
  meetingLengthMin?: number;
  stepMin?: number;
  maxResults?: number;
  prefer?: string;        // 'morning' | 'afternoon' | 'evening' | 'business'
  timezone?: string;
}

export interface ParticipantBusy {
  participant: ParticipantInfo;
  busy: Array<{ start: string; end: string }>;
  status: 'success' | 'not_linked' | 'error' | 'external_excluded';
  error?: string;
}

export interface BatchFreeBusyResult {
  available_slots: AvailableSlot[];
  scored_slots?: ScoredSlot[];  // P3-GEN1: スコア付きスロット
  busy_union: Array<{ start: string; end: string }>;
  per_participant: ParticipantBusy[];
  coverage: SlotGeneratorResult['coverage'];
  excluded_count: number;
  linked_count: number;
  prefer: string | null;
  warning: string | null;
  has_preferences?: boolean;  // P3-GEN1: 好み設定を持つ参加者がいるか
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * 複数のbusy配列をマージ（union）
 */
function mergeBusyUnion(
  allBusy: Array<Array<{ start: string; end: string }>>
): Array<{ start: string; end: string }> {
  // 全てのbusyをフラットに
  const flatBusy = allBusy.flat();
  
  if (flatBusy.length === 0) {
    return [];
  }
  
  // startでソート
  const sorted = flatBusy
    .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  
  // マージ
  const merged: Array<{ start: Date; end: Date }> = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];
    
    if (current.start <= last.end) {
      // 重なりまたは連続 → マージ
      last.end = current.end > last.end ? current.end : last.end;
    } else {
      merged.push(current);
    }
  }
  
  // ISO文字列に戻す
  return merged.map((b) => ({
    start: b.start.toISOString(),
    end: b.end.toISOString(),
  }));
}

// ============================================================
// Main Service
// ============================================================

/**
 * 複数参加者のbusyを取得してintersection（共通空き）を計算
 */
export async function getBatchFreeBusy(
  db: D1Database,
  env: Env,
  params: BatchFreeBusyParams
): Promise<BatchFreeBusyResult> {
  const {
    organizerUserId,
    participants,
    timeMin,
    timeMax,
    meetingLengthMin = 60,
    stepMin = 30,
    maxResults = 8,
    prefer,
    timezone = 'Asia/Tokyo',
  } = params;
  
  const perParticipant: ParticipantBusy[] = [];
  const allBusy: Array<Array<{ start: string; end: string }>> = [];
  let excludedCount = 0;
  let linkedCount = 0;
  
  // 1. 各参加者のbusyを取得
  for (const participant of participants) {
    if (participant.type === 'self') {
      // 主催者自身
      try {
        const accessToken = await GoogleCalendarService.getOrganizerAccessToken(db, organizerUserId, env);
        if (!accessToken) {
          perParticipant.push({
            participant,
            busy: [],
            status: 'not_linked',
          });
          excludedCount++;
          continue;
        }
        
        const calendarService = new GoogleCalendarService(accessToken, env);
        const busy = await calendarService.getFreeBusy(timeMin, timeMax);
        
        perParticipant.push({
          participant,
          busy,
          status: 'success',
        });
        allBusy.push(busy);
        linkedCount++;
      } catch (error) {
        perParticipant.push({
          participant,
          busy: [],
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        excludedCount++;
      }
    } else if (participant.type === 'app_user' && participant.userId) {
      // アプリユーザー（Google連携済みの可能性あり）
      try {
        const accessToken = await GoogleCalendarService.getOrganizerAccessToken(db, participant.userId, env);
        if (!accessToken) {
          perParticipant.push({
            participant,
            busy: [],
            status: 'not_linked',
          });
          excludedCount++;
          continue;
        }
        
        const calendarService = new GoogleCalendarService(accessToken, env);
        const busy = await calendarService.getFreeBusy(timeMin, timeMax);
        
        perParticipant.push({
          participant,
          busy,
          status: 'success',
        });
        allBusy.push(busy);
        linkedCount++;
      } catch (error) {
        perParticipant.push({
          participant,
          busy: [],
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        excludedCount++;
      }
    } else {
      // 外部参加者（token招待など）→ 現時点では除外
      perParticipant.push({
        participant,
        busy: [],
        status: 'external_excluded',
      });
      excludedCount++;
    }
  }
  
  // 2. busyのunionを計算
  const busyUnion = mergeBusyUnion(allBusy);
  
  // 3. slotGeneratorでintersection（共通空き）を計算
  const dayTimeWindow = getTimeWindowFromPrefer(prefer);
  const slotResult = generateAvailableSlots({
    timeMin,
    timeMax,
    busy: busyUnion,
    meetingLengthMin,
    stepMin,
    maxResults,
    dayTimeWindow,
    timezone,
  });
  
  // 4. 警告メッセージ生成
  let warning: string | null = null;
  if (excludedCount > 0 && linkedCount === 0) {
    warning = 'google_calendar_not_linked_all';
  } else if (excludedCount > 0) {
    warning = `${excludedCount}名のカレンダーが連携されていないため、共通空き計算から除外しました。`;
  }
  
  // P3-GEN1 + P3-SCORE1: 参加者の好みを取得してスコアリング
  // contacts.display_name を優先して participant_label を解決
  const participantPrefsForScoring: ParticipantPrefs[] = [];
  
  for (const pp of perParticipant) {
    if (pp.status === 'success' && pp.participant.userId) {
      // DBから好みと表示名を取得
      try {
        const userResult = await db
          .prepare('SELECT schedule_prefs_json, display_name, email FROM users WHERE id = ?')
          .bind(pp.participant.userId)
          .first<{ schedule_prefs_json: string | null; display_name: string | null; email: string | null }>();
        
        const prefs = parseSchedulePrefs(userResult?.schedule_prefs_json);
        
        // P3-SCORE1: displayName 解決優先順位
        // 1. contacts.display_name（主催者がつけた名前）
        // 2. participant.name（招待時の名前）
        // 3. users.display_name（ユーザー自身の名前）
        // 4. email
        // 5. '不明'
        let displayName = pp.participant.name || userResult?.display_name || userResult?.email || '不明';
        
        // contactsからdisplay_nameを取得（主催者がつけた名前を優先）
        if (pp.participant.email) {
          const contactResult = await db
            .prepare('SELECT display_name FROM contacts WHERE user_id = ? AND email = ?')
            .bind(organizerUserId, pp.participant.email)
            .first<{ display_name: string | null }>();
          
          if (contactResult?.display_name) {
            displayName = contactResult.display_name;
          }
        }
        
        participantPrefsForScoring.push({
          userId: pp.participant.userId,
          displayName,
          prefs,
        });
      } catch (e) {
        // 好み取得失敗時はスコア0で継続
        participantPrefsForScoring.push({
          userId: pp.participant.userId,
          displayName: pp.participant.name || pp.participant.email || '不明',
          prefs: null,
        });
      }
    }
  }
  
  // P3-SCORE1: 主催者自身もスコアリング対象に追加（self）
  for (const pp of perParticipant) {
    if (pp.participant.type === 'self' && pp.status === 'success') {
      try {
        const organizerResult = await db
          .prepare('SELECT schedule_prefs_json, display_name, email FROM users WHERE id = ?')
          .bind(organizerUserId)
          .first<{ schedule_prefs_json: string | null; display_name: string | null; email: string | null }>();
        
        const prefs = parseSchedulePrefs(organizerResult?.schedule_prefs_json);
        const displayName = organizerResult?.display_name || organizerResult?.email || 'あなた';
        
        // 既に追加されていない場合のみ追加
        if (!participantPrefsForScoring.some(p => p.userId === organizerUserId)) {
          participantPrefsForScoring.push({
            userId: organizerUserId,
            displayName,
            prefs,
          });
        }
      } catch (e) {
        // エラー時はスキップ
      }
    }
  }
  
  // スコアリング実行
  const scorerResult = scoreSlots({
    slots: slotResult.available_slots,
    participantPrefs: participantPrefsForScoring,
    maxResults,
    timezone,
  });

  return {
    available_slots: slotResult.available_slots,
    scored_slots: scorerResult.scored_slots,
    busy_union: busyUnion,
    per_participant: perParticipant,
    coverage: slotResult.coverage,
    excluded_count: excludedCount,
    linked_count: linkedCount,
    prefer: prefer || null,
    warning,
    has_preferences: scorerResult.has_preferences,
  };
}

/**
 * スレッドの参加者情報を取得
 */
export async function getThreadParticipants(
  db: D1Database,
  threadId: string,
  organizerUserId: string
): Promise<ParticipantInfo[]> {
  const participants: ParticipantInfo[] = [];
  
  // 1. 主催者を追加
  participants.push({
    type: 'self',
    userId: organizerUserId,
  });
  
  // 2. thread_invites から参加者を取得
  const invites = await db
    .prepare(
      `SELECT ti.id, ti.email, ti.name, ti.status,
              c.user_id as contact_user_id
       FROM thread_invites ti
       LEFT JOIN contacts c ON c.email = ti.email AND c.user_id = ?
       WHERE ti.thread_id = ?
         AND ti.status != 'declined'`
    )
    .bind(organizerUserId, threadId)
    .all<{
      id: string;
      email: string;
      name: string | null;
      status: string;
      contact_user_id: string | null;
    }>();
  
  for (const invite of invites.results || []) {
    // contactにuser_idがある場合はapp_user
    if (invite.contact_user_id) {
      participants.push({
        type: 'app_user',
        userId: invite.contact_user_id,
        email: invite.email,
        name: invite.name || undefined,
      });
    } else {
      // 外部参加者
      participants.push({
        type: 'external',
        email: invite.email,
        name: invite.name || undefined,
      });
    }
  }
  
  return participants;
}
