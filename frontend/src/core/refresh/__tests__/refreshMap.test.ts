/**
 * refreshMap.test.ts
 * 
 * A: refreshMap 定義漏れ検知テスト
 * 
 * 目的:
 * - すべての WriteOp が getRefreshActions で最低1つの RefreshAction を返すことを保証
 * - 新しい WriteOp を追加した際に、対応する RefreshAction の追加を強制
 * - 「書いたのにUIが古い」事故を CI で防止
 */

import { describe, it, expect } from 'vitest';
import { getRefreshActions, type WriteOp, type RefreshAction } from '../refreshMap';

// ============================================================
// WriteOp の完全リスト（ここを更新するとテストが落ちて検知できる）
// ============================================================

/**
 * 全ての WriteOp をリスト化
 * 新しい WriteOp を追加した場合はここに追加する必要がある
 */
const ALL_WRITE_OPS: WriteOp[] = [
  // スケジュール調整系
  'THREAD_CREATE',
  'INVITE_SEND',
  'INVITE_ADD_SLOTS',
  'ADD_SLOTS',
  'REMIND_PENDING',
  'REMIND_NEED_RESPONSE',
  'FINALIZE',
  'NOTIFY_CONFIRMED',
  // ユーザー設定系
  'USERS_ME_UPDATE_TZ',
  // リスト系
  'LIST_CREATE',
  'LIST_ADD_MEMBER',
  // 連絡先系 (P1-4)
  'CONTACT_CREATE',
  'CONTACT_UPDATE',
  'CONTACT_DELETE',
];

/**
 * WriteOp ごとの期待される RefreshAction type
 * これが満たされていないとテストが落ちる
 */
const EXPECTED_REFRESH_ACTIONS: Record<WriteOp, string[]> = {
  // スケジュール調整系: STATUS または THREADS_LIST が必須
  'THREAD_CREATE': ['STATUS', 'THREADS_LIST'],
  'INVITE_SEND': ['STATUS', 'INBOX'],
  'INVITE_ADD_SLOTS': ['STATUS'],
  'ADD_SLOTS': ['STATUS'],
  'REMIND_PENDING': ['STATUS', 'INBOX'],
  'REMIND_NEED_RESPONSE': ['STATUS', 'INBOX'],
  'FINALIZE': ['STATUS', 'INBOX', 'THREADS_LIST'],
  'NOTIFY_CONFIRMED': ['STATUS'],
  // ユーザー設定系: ME が必須
  'USERS_ME_UPDATE_TZ': ['ME'],
  // リスト系: LISTS が必須
  'LIST_CREATE': ['LISTS'],
  'LIST_ADD_MEMBER': ['LISTS'],
  // 連絡先系: CONTACTS が必須
  'CONTACT_CREATE': ['CONTACTS'],
  'CONTACT_UPDATE': ['CONTACTS'],
  'CONTACT_DELETE': ['CONTACTS'],
};

// ============================================================
// テストケース
// ============================================================

describe('refreshMap - WriteOp 定義漏れ検知', () => {
  describe('A-1: すべての WriteOp が RefreshAction を返す', () => {
    it.each(ALL_WRITE_OPS)(
      'WriteOp "%s" は最低1つの RefreshAction を返す',
      (writeOp) => {
        // threadId が必要な操作には threadId を渡す
        const needsThreadId = [
          'THREAD_CREATE', 'INVITE_SEND', 'INVITE_ADD_SLOTS', 'ADD_SLOTS',
          'REMIND_PENDING', 'REMIND_NEED_RESPONSE', 'FINALIZE', 'NOTIFY_CONFIRMED'
        ].includes(writeOp);
        
        const args = needsThreadId ? { threadId: 'test-thread-id' } : {};
        const actions = getRefreshActions(writeOp, args);
        
        expect(actions.length).toBeGreaterThanOrEqual(1);
      }
    );
  });

  describe('A-2: 期待される RefreshAction type が含まれている', () => {
    it.each(ALL_WRITE_OPS)(
      'WriteOp "%s" は期待される RefreshAction を返す',
      (writeOp) => {
        const needsThreadId = [
          'THREAD_CREATE', 'INVITE_SEND', 'INVITE_ADD_SLOTS', 'ADD_SLOTS',
          'REMIND_PENDING', 'REMIND_NEED_RESPONSE', 'FINALIZE', 'NOTIFY_CONFIRMED'
        ].includes(writeOp);
        
        const args = needsThreadId ? { threadId: 'test-thread-id' } : {};
        const actions = getRefreshActions(writeOp, args);
        const actionTypes = actions.map(a => a.type);
        
        const expectedTypes = EXPECTED_REFRESH_ACTIONS[writeOp];
        
        // 期待される RefreshAction type がすべて含まれているか
        expectedTypes.forEach(expectedType => {
          expect(actionTypes).toContain(expectedType);
        });
      }
    );
  });

  describe('A-3: WriteOp リストの完全性チェック', () => {
    it('ALL_WRITE_OPS は refreshMap.ts の WriteOp 型と一致する', () => {
      // このテストは型レベルでの検証
      // 新しい WriteOp を追加したが ALL_WRITE_OPS に追加し忘れた場合、
      // EXPECTED_REFRESH_ACTIONS にも追加し忘れるので A-2 で検知される
      
      // 最低限、数が一致することを確認
      // 現在: 14個
      expect(ALL_WRITE_OPS.length).toBe(14);
    });

    it('EXPECTED_REFRESH_ACTIONS は ALL_WRITE_OPS のすべてをカバーする', () => {
      ALL_WRITE_OPS.forEach(op => {
        expect(EXPECTED_REFRESH_ACTIONS).toHaveProperty(op);
        expect(EXPECTED_REFRESH_ACTIONS[op].length).toBeGreaterThan(0);
      });
    });
  });
});

describe('refreshMap - RefreshAction 整合性', () => {
  describe('STATUS を返す WriteOp は threadId が必要', () => {
    const statusOps: WriteOp[] = [
      'THREAD_CREATE', 'INVITE_SEND', 'INVITE_ADD_SLOTS', 'ADD_SLOTS',
      'REMIND_PENDING', 'REMIND_NEED_RESPONSE', 'FINALIZE', 'NOTIFY_CONFIRMED'
    ];

    it.each(statusOps)(
      'WriteOp "%s" は threadId ありで STATUS を返す',
      (writeOp) => {
        const actions = getRefreshActions(writeOp, { threadId: 'test-id' });
        const hasStatus = actions.some(a => a.type === 'STATUS');
        expect(hasStatus).toBe(true);
      }
    );

    it.each(statusOps)(
      'WriteOp "%s" は threadId なしでもクラッシュしない',
      (writeOp) => {
        expect(() => getRefreshActions(writeOp, {})).not.toThrow();
      }
    );
  });

  describe('threadId 不要な WriteOp', () => {
    const noThreadIdOps: WriteOp[] = [
      'USERS_ME_UPDATE_TZ', 'LIST_CREATE', 'LIST_ADD_MEMBER',
      'CONTACT_CREATE', 'CONTACT_UPDATE', 'CONTACT_DELETE'
    ];

    it.each(noThreadIdOps)(
      'WriteOp "%s" は threadId なしで正常動作',
      (writeOp) => {
        const actions = getRefreshActions(writeOp, {});
        expect(actions.length).toBeGreaterThan(0);
      }
    );
  });
});
