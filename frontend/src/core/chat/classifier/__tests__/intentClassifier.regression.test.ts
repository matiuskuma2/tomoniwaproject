/**
 * intentClassifier.regression.test.ts
 * TD-003: Intent分類の回帰テスト
 * 
 * 守るべきもの:
 * 1. 優先順位が崩れてない
 * 2. pending に応じて「はい/いいえ」が正しい intent になる
 * 3. キーワードの代表例が意図した intent に落ちる
 */

import { describe, it, expect } from 'vitest';
import { classifyIntent } from '../../intentClassifier';
import type { IntentContext } from '../../classifier/types';
import type { PendingState } from '../../pendingTypes';

// ========== helpers ==========
function ctx(params: Partial<IntentContext> = {}): IntentContext {
  return {
    selectedThreadId: 'thread-001',
    ...params,
  };
}

function ctxNoThread(params: Partial<IntentContext> = {}): IntentContext {
  return {
    selectedThreadId: undefined,
    ...params,
  };
}

describe('TD-003 regression: intent classification', () => {
  // ============================================================
  // 1) pending.action 最優先（他の分類より先に反応）
  // ============================================================
  describe('Priority 1: pending.action (最優先)', () => {
    it('「送る」-> pending.action.decide (decision: 送る)', () => {
      const pending: PendingState = {
        kind: 'pending.action',
        threadId: 'thread-001',
        createdAt: Date.now(),
        confirmToken: 'token-abc',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        summary: {},
        mode: 'new_thread',
      };

      const r = classifyIntent('送る', { ...ctx(), pendingForThread: pending });

      expect(r.intent).toBe('pending.action.decide');
      expect(r.params.confirmToken).toBe('token-abc');
      expect(r.params.decision).toBe('送る');
    });

    it('「キャンセル」-> pending.action.decide (decision: キャンセル)', () => {
      const pending: PendingState = {
        kind: 'pending.action',
        threadId: 'thread-001',
        createdAt: Date.now(),
        confirmToken: 'token-xyz',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        summary: {},
        mode: 'new_thread',
      };

      const r = classifyIntent('キャンセル', { ...ctx(), pendingForThread: pending });

      expect(r.intent).toBe('pending.action.decide');
      expect(r.params.decision).toBe('キャンセル');
    });

    it('「追加」(add_slots mode) -> pending.action.decide (decision: 追加)', () => {
      const pending: PendingState = {
        kind: 'pending.action',
        threadId: 'thread-001',
        createdAt: Date.now(),
        confirmToken: 'token-add',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        summary: {},
        mode: 'add_slots',
      };

      const r = classifyIntent('追加', { ...ctx(), pendingForThread: pending });

      expect(r.intent).toBe('pending.action.decide');
      expect(r.params.decision).toBe('追加');
    });

    it('pending.action 中に関係ない入力 -> unknown + clarification (他の分類に行かない)', () => {
      const pending: PendingState = {
        kind: 'pending.action',
        threadId: 'thread-001',
        createdAt: Date.now(),
        confirmToken: 'token-xyz',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        summary: {},
        mode: 'add_slots',
      };

      const r = classifyIntent('天気どう？', { ...ctx(), pendingForThread: pending });

      expect(r.intent).toBe('unknown');
      expect(r.needsClarification?.message).toContain('確認待ち');
    });
  });

  // ============================================================
  // 2) confirm/cancel の優先順位（split > notify > remind > remind_need_response > auto_propose）
  // ============================================================
  describe('Priority 2: confirm/cancel 優先順位', () => {
    it('split.propose pending + 「はい」-> schedule.propose_for_split.confirm', () => {
      const pending: PendingState = {
        kind: 'split.propose',
        threadId: 'thread-001',
        createdAt: Date.now(),
        voteSummary: [{ label: 'A', votes: 1 }],
      };

      const r = classifyIntent('はい', { ...ctx(), pendingForThread: pending });
      expect(r.intent).toBe('schedule.propose_for_split.confirm');
    });

    it('notify.confirmed pending + 「はい」-> schedule.notify.confirmed.confirm', () => {
      const pending: PendingState = {
        kind: 'notify.confirmed',
        threadId: 'thread-001',
        createdAt: Date.now(),
        invites: [{ email: 'a@example.com' }],
        finalSlot: { start_at: '2026-01-01T00:00:00Z', end_at: '2026-01-01T01:00:00Z' },
      };

      const r = classifyIntent('はい', { ...ctx(), pendingForThread: pending });
      expect(r.intent).toBe('schedule.notify.confirmed.confirm');
    });

    it('remind.pending pending + 「はい」-> schedule.remind.pending.confirm', () => {
      const pending: PendingState = {
        kind: 'remind.pending',
        threadId: 'thread-001',
        createdAt: Date.now(),
        pendingInvites: [{ email: 'a@example.com' }],
        count: 1,
      };

      const r = classifyIntent('はい', { ...ctx(), pendingForThread: pending });
      expect(r.intent).toBe('schedule.remind.pending.confirm');
    });

    it('remind.need_response pending + 「はい」-> schedule.remind.need_response.confirm', () => {
      const pending: PendingState = {
        kind: 'remind.need_response',
        threadId: 'thread-001',
        createdAt: Date.now(),
        targetInvitees: [{ email: 'a@example.com', inviteeKey: 'k1' }],
        count: 1,
      };

      const r = classifyIntent('はい', { ...ctx(), pendingForThread: pending });
      expect(r.intent).toBe('schedule.remind.need_response.confirm');
    });

    it('remind.need_response pending + 「いいえ」-> schedule.remind.need_response.cancel', () => {
      const pending: PendingState = {
        kind: 'remind.need_response',
        threadId: 'thread-001',
        createdAt: Date.now(),
        targetInvitees: [{ email: 'a@example.com', inviteeKey: 'k1' }],
        count: 1,
      };

      const r = classifyIntent('いいえ', { ...ctx(), pendingForThread: pending });
      expect(r.intent).toBe('schedule.remind.need_response.cancel');
    });

    it('pending なし + 「はい」-> schedule.auto_propose.confirm (デフォルト)', () => {
      const r = classifyIntent('はい', ctx());
      expect(r.intent).toBe('schedule.auto_propose.confirm');
    });
  });

  // ============================================================
  // 3) 代表キーワードの回帰
  // ============================================================
  describe('Priority 3-7: キーワード回帰', () => {
    // リスト系
    it('「営業部リストを作って」-> list.create', () => {
      const r = classifyIntent('営業部リストを作って', ctx());
      expect(r.intent).toBe('list.create');
    });

    it('「リスト」-> list.list', () => {
      const r = classifyIntent('リスト', ctx());
      expect(r.intent).toBe('list.list');
    });

    it('「テストリストのメンバー」-> list.members', () => {
      const r = classifyIntent('テストリストのメンバー', ctx());
      expect(r.intent).toBe('list.members');
    });

    it('「営業部リストに招待」-> invite.prepare.list', () => {
      const r = classifyIntent('営業部リストに招待', ctx());
      expect(r.intent).toBe('invite.prepare.list');
    });

    // カレンダー系
    it('「今日の予定」-> schedule.today', () => {
      const r = classifyIntent('今日の予定', ctx());
      expect(r.intent).toBe('schedule.today');
    });

    it('「今週の予定」-> schedule.week', () => {
      const r = classifyIntent('今週の予定', ctx());
      expect(r.intent).toBe('schedule.week');
    });

    it('「空いてる？」-> schedule.freebusy', () => {
      const r = classifyIntent('空いてる？', ctx());
      expect(r.intent).toBe('schedule.freebusy');
    });

    // 提案系
    it('「追加候補」-> schedule.additional_propose', () => {
      const r = classifyIntent('追加候補', ctx());
      expect(r.intent).toBe('schedule.additional_propose');
    });

    it('「確定通知」-> schedule.notify.confirmed', () => {
      const r = classifyIntent('確定通知', ctx());
      expect(r.intent).toBe('schedule.notify.confirmed');
    });

    // リマインド系
    it('「再回答必要」-> schedule.need_response.list', () => {
      const r = classifyIntent('再回答必要', ctx());
      expect(r.intent).toBe('schedule.need_response.list');
    });

    // NOTE: 「再回答必要」が先にマッチするため schedule.need_response.list になる
    // これは現在の挙動（挙動を変えない方針）
    it('「再回答必要な人にリマインド」-> schedule.need_response.list (現挙動)', () => {
      const r = classifyIntent('再回答必要な人にリマインド', ctx());
      // 「再回答必要」が先にマッチするため list になる
      expect(r.intent).toBe('schedule.need_response.list');
    });

    it('「リマインド」-> schedule.remind.pending', () => {
      const r = classifyIntent('リマインド', ctx());
      expect(r.intent).toBe('schedule.remind.pending');
    });

    // スレッド系
    it('「スレッド作って」-> thread.create', () => {
      const r = classifyIntent('スレッド作って', ctx());
      expect(r.intent).toBe('thread.create');
    });

    it('「tanaka@example.com に送って」-> invite.prepare.emails', () => {
      const r = classifyIntent('tanaka@example.com に送って', ctx());
      expect(r.intent).toBe('invite.prepare.emails');
      expect(r.params.emails).toContain('tanaka@example.com');
    });

    it('「1番で確定」-> schedule.finalize (slotNumber: 1)', () => {
      const r = classifyIntent('1番で確定', ctx());
      expect(r.intent).toBe('schedule.finalize');
      expect(r.params.slotNumber).toBe(1);
    });

    it('「状況教えて」-> schedule.status.check', () => {
      const r = classifyIntent('状況教えて', ctx());
      expect(r.intent).toBe('schedule.status.check');
    });
  });

  // ============================================================
  // 4) threadId 無し時の clarification
  // ============================================================
  describe('threadId 無し時の clarification', () => {
    it('「再回答必要」+ threadId無し -> clarification', () => {
      const r = classifyIntent('再回答必要', ctxNoThread());
      expect(r.intent).toBe('schedule.need_response.list');
      expect(r.needsClarification).toBeTruthy();
      expect(r.needsClarification?.field).toBe('threadId');
    });

    it('「1番で確定」+ threadId無し -> clarification', () => {
      const r = classifyIntent('1番で確定', ctxNoThread());
      expect(r.intent).toBe('schedule.finalize');
      expect(r.needsClarification).toBeTruthy();
      expect(r.needsClarification?.field).toBe('threadId');
    });
  });
});
