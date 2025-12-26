/**
 * Attendance Rule Engine (Phase A: Core Engine)
 * 
 * Purpose: Evaluate AttendanceRule JSON and finalize threads based on selections
 * 
 * Rule Types (v1):
 * - ANY: Any single participant accepting any slot triggers finalization
 * - ALL: All participants must select the same slot
 * - K_OF_N: At least K participants must select the same slot
 * - REQUIRED_PLUS_K: Required participants + K optional participants
 * - GROUP_ANY: At least one participant from any group
 * - EXPRESSION: Complex boolean expression (future)
 */

import type { D1Database } from '@cloudflare/workers-types';

// ============================================================
// Types
// ============================================================

export type RuleType = 'ANY' | 'ALL' | 'K_OF_N' | 'REQUIRED_PLUS_K' | 'GROUP_ANY' | 'EXPRESSION';
export type FinalizePolicy = 'EARLIEST_VALID' | 'BEST_SCORE' | 'HOST_CHOICE' | 'MANUAL';

export interface AttendanceRuleV1 {
  version: 1;
  type: RuleType;
  participants: string[]; // InviteeKey array (u:/e:/lm:)
  
  // K_OF_N specific
  k?: number;
  
  // REQUIRED_PLUS_K specific
  required?: string[]; // InviteeKey array
  optional?: string[]; // InviteeKey array
  quorum?: number; // minimum optional participants needed
  
  // GROUP_ANY specific
  groups?: {
    id: string;
    members: string[]; // InviteeKey array
  }[];
  
  // EXPRESSION specific (future)
  expression?: string;
}

export interface ThreadSlot {
  slot_id: string;
  thread_id: string;
  start_at: string;
  end_at: string;
  timezone: string;
  label?: string;
}

export interface ThreadSelection {
  selection_id: string;
  thread_id: string;
  invitee_key: string;
  status: 'pending' | 'selected' | 'declined' | 'expired';
  selected_slot_id?: string;
  responded_at?: string;
}

export interface FinalizeResult {
  finalized: boolean;
  final_slot_id?: string;
  reason: string;
  final_participants: string[]; // InviteeKey array
}

// ============================================================
// Attendance Engine Service
// ============================================================

export class AttendanceEngine {
  constructor(private db: D1Database) {}

  /**
   * Evaluate rule and determine if thread can be finalized
   */
  async evaluateRule(
    rule: AttendanceRuleV1,
    selections: ThreadSelection[],
    slots: ThreadSlot[]
  ): Promise<FinalizeResult> {
    // Filter to only 'selected' status
    const selected = selections.filter(s => s.status === 'selected' && s.selected_slot_id);

    // Group selections by slot
    const slotGroups = new Map<string, Set<string>>();
    for (const sel of selected) {
      if (!sel.selected_slot_id) continue;
      if (!slotGroups.has(sel.selected_slot_id)) {
        slotGroups.set(sel.selected_slot_id, new Set());
      }
      slotGroups.get(sel.selected_slot_id)!.add(sel.invitee_key);
    }

    // Evaluate based on rule type
    switch (rule.type) {
      case 'ANY':
        return this.evaluateAny(slotGroups, slots);
      
      case 'ALL':
        return this.evaluateAll(rule, slotGroups, slots);
      
      case 'K_OF_N':
        return this.evaluateKOfN(rule, slotGroups, slots);
      
      case 'REQUIRED_PLUS_K':
        return this.evaluateRequiredPlusK(rule, slotGroups, slots);
      
      case 'GROUP_ANY':
        return this.evaluateGroupAny(rule, slotGroups, slots);
      
      default:
        return {
          finalized: false,
          reason: `Unsupported rule type: ${rule.type}`,
          final_participants: []
        };
    }
  }

  /**
   * ANY: First slot with any selection wins
   */
  private evaluateAny(
    slotGroups: Map<string, Set<string>>,
    slots: ThreadSlot[]
  ): FinalizeResult {
    // Find earliest slot with any selection
    const sortedSlots = [...slots].sort((a, b) => 
      new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
    );

    for (const slot of sortedSlots) {
      const participants = slotGroups.get(slot.slot_id);
      if (participants && participants.size > 0) {
        return {
          finalized: true,
          final_slot_id: slot.slot_id,
          reason: `ANY rule satisfied: ${participants.size} participant(s) selected`,
          final_participants: Array.from(participants)
        };
      }
    }

    return {
      finalized: false,
      reason: 'No participants have selected any slot',
      final_participants: []
    };
  }

  /**
   * ALL: All participants must select the same slot
   */
  private evaluateAll(
    rule: AttendanceRuleV1,
    slotGroups: Map<string, Set<string>>,
    slots: ThreadSlot[]
  ): FinalizeResult {
    const requiredParticipants = new Set(rule.participants);
    
    // Find slot where ALL required participants have selected
    for (const [slotId, participants] of slotGroups.entries()) {
      // Check if all required participants are in this slot
      const allPresent = [...requiredParticipants].every(p => participants.has(p));
      
      if (allPresent && participants.size === requiredParticipants.size) {
        return {
          finalized: true,
          final_slot_id: slotId,
          reason: `ALL rule satisfied: ${participants.size}/${requiredParticipants.size} participants`,
          final_participants: Array.from(participants)
        };
      }
    }

    return {
      finalized: false,
      reason: `Waiting for all ${requiredParticipants.size} participants`,
      final_participants: []
    };
  }

  /**
   * K_OF_N: At least K participants must select the same slot
   */
  private evaluateKOfN(
    rule: AttendanceRuleV1,
    slotGroups: Map<string, Set<string>>,
    slots: ThreadSlot[]
  ): FinalizeResult {
    const k = rule.k || 1;
    const eligibleParticipants = new Set(rule.participants);

    // Find first slot with K or more eligible participants
    const sortedSlots = [...slots].sort((a, b) => 
      new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
    );

    for (const slot of sortedSlots) {
      const participants = slotGroups.get(slot.slot_id);
      if (!participants) continue;

      // Count eligible participants who selected this slot
      const eligibleCount = [...participants].filter(p => eligibleParticipants.has(p)).length;

      if (eligibleCount >= k) {
        return {
          finalized: true,
          final_slot_id: slot.slot_id,
          reason: `K_OF_N rule satisfied: ${eligibleCount}/${k} participants`,
          final_participants: [...participants].filter(p => eligibleParticipants.has(p))
        };
      }
    }

    return {
      finalized: false,
      reason: `Waiting for ${k} participants (current best: ${Math.max(0, ...[...slotGroups.values()].map(s => s.size))})`,
      final_participants: []
    };
  }

  /**
   * REQUIRED_PLUS_K: Required participants + K optional participants
   */
  private evaluateRequiredPlusK(
    rule: AttendanceRuleV1,
    slotGroups: Map<string, Set<string>>,
    slots: ThreadSlot[]
  ): FinalizeResult {
    const required = new Set(rule.required || []);
    const optional = new Set(rule.optional || []);
    const quorum = rule.quorum || 1;

    // Find slot where all required + quorum optional are present
    for (const [slotId, participants] of slotGroups.entries()) {
      // Check all required are present
      const allRequiredPresent = [...required].every(p => participants.has(p));
      if (!allRequiredPresent) continue;

      // Count optional participants
      const optionalCount = [...participants].filter(p => optional.has(p)).length;

      if (optionalCount >= quorum) {
        return {
          finalized: true,
          final_slot_id: slotId,
          reason: `REQUIRED_PLUS_K satisfied: ${required.size} required + ${optionalCount}/${quorum} optional`,
          final_participants: Array.from(participants)
        };
      }
    }

    return {
      finalized: false,
      reason: `Waiting for ${required.size} required + ${quorum} optional participants`,
      final_participants: []
    };
  }

  /**
   * GROUP_ANY: At least one participant from any group
   */
  private evaluateGroupAny(
    rule: AttendanceRuleV1,
    slotGroups: Map<string, Set<string>>,
    slots: ThreadSlot[]
  ): FinalizeResult {
    const groups = rule.groups || [];

    // Find first slot with at least one participant from any group
    const sortedSlots = [...slots].sort((a, b) => 
      new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
    );

    for (const slot of sortedSlots) {
      const participants = slotGroups.get(slot.slot_id);
      if (!participants) continue;

      // Check if any group has a participant
      for (const group of groups) {
        const groupMembers = new Set(group.members);
        const hasGroupMember = [...participants].some(p => groupMembers.has(p));
        
        if (hasGroupMember) {
          return {
            finalized: true,
            final_slot_id: slot.slot_id,
            reason: `GROUP_ANY satisfied: participant from group "${group.id}"`,
            final_participants: Array.from(participants)
          };
        }
      }
    }

    return {
      finalized: false,
      reason: 'No participants from any group have selected a slot',
      final_participants: []
    };
  }

  /**
   * Finalize a thread (write to DB)
   */
  async finalizeThread(
    threadId: string,
    policy: FinalizePolicy,
    userId?: string
  ): Promise<FinalizeResult> {
    // 1. Load rule, slots, selections
    const rule = await this.loadRule(threadId);
    const slots = await this.loadSlots(threadId);
    const selections = await this.loadSelections(threadId);

    // 2. Evaluate
    const result = await this.evaluateRule(rule, selections, slots);

    // 3. If finalized, write to thread_finalize
    if (result.finalized && result.final_slot_id) {
      await this.db.prepare(`
        INSERT OR REPLACE INTO thread_finalize (
          thread_id,
          final_slot_id,
          finalize_policy,
          finalized_by_user_id,
          finalized_at,
          final_participants_json,
          updated_at
        ) VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'))
      `).bind(
        threadId,
        result.final_slot_id,
        policy,
        userId || null,
        JSON.stringify(result.final_participants)
      ).run();

      // 4. Update thread_participants (confirm participants)
      for (const inviteeKey of result.final_participants) {
        // Parse invitee_key to get user_id if internal
        if (inviteeKey.startsWith('u:')) {
          const internalUserId = inviteeKey.slice(2);
          await this.db.prepare(`
            INSERT OR IGNORE INTO thread_participants (thread_id, user_id, role, joined_at)
            VALUES (?, ?, 'participant', datetime('now'))
          `).bind(threadId, internalUserId).run();
        }
      }

      // 5. Send notifications (inbox)
      // TODO: Implement notification logic
    }

    return result;
  }

  /**
   * Load rule from DB
   */
  private async loadRule(threadId: string): Promise<AttendanceRuleV1> {
    const result = await this.db.prepare(`
      SELECT rule_json FROM thread_attendance_rules WHERE thread_id = ?
    `).bind(threadId).first<{ rule_json: string }>();

    if (!result) {
      // Default to ANY if no rule exists
      return {
        version: 1,
        type: 'ANY',
        participants: []
      };
    }

    return JSON.parse(result.rule_json);
  }

  /**
   * Load slots from DB
   */
  private async loadSlots(threadId: string): Promise<ThreadSlot[]> {
    const results = await this.db.prepare(`
      SELECT * FROM scheduling_slots WHERE thread_id = ? ORDER BY start_at ASC
    `).bind(threadId).all<ThreadSlot>();

    return results.results || [];
  }

  /**
   * Load selections from DB
   */
  private async loadSelections(threadId: string): Promise<ThreadSelection[]> {
    const results = await this.db.prepare(`
      SELECT * FROM thread_selections WHERE thread_id = ?
    `).bind(threadId).all<ThreadSelection>();

    return results.results || [];
  }
}
