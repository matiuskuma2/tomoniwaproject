/**
 * resolveContact.test.ts
 * Phase 2: 連絡先解決ユーティリティのテスト
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizePersonName } from '../resolveContact';

// ============================================================
// normalizePersonName のテスト（純粋関数なのでモック不要）
// ============================================================

describe('normalizePersonName', () => {
  it('「さん」を除去', () => {
    expect(normalizePersonName('田中さん')).toBe('田中');
  });

  it('「くん」を除去', () => {
    expect(normalizePersonName('大島くん')).toBe('大島');
  });

  it('「氏」を除去', () => {
    expect(normalizePersonName('佐藤氏')).toBe('佐藤');
  });

  it('「様」を除去', () => {
    expect(normalizePersonName('山田様')).toBe('山田');
  });

  it('「先生」を除去', () => {
    expect(normalizePersonName('鈴木先生')).toBe('鈴木');
  });

  it('「殿」を除去', () => {
    expect(normalizePersonName('高橋殿')).toBe('高橋');
  });

  it('敬称なしはそのまま', () => {
    expect(normalizePersonName('田中')).toBe('田中');
  });

  it('前後の空白を除去', () => {
    expect(normalizePersonName('  田中さん  ')).toBe('田中');
  });

  it('敬称が途中にある場合は除去しない', () => {
    // 「さん」が末尾でない場合は敬称とみなさない
    expect(normalizePersonName('さん田中')).toBe('さん田中');
  });

  it('空文字列', () => {
    expect(normalizePersonName('')).toBe('');
  });
});

// ============================================================
// resolveContact のテスト（API モックが必要）
// ============================================================

// contactsApi をモック
vi.mock('../../../../api/contacts', () => ({
  contactsApi: {
    list: vi.fn(),
  },
}));

import { resolveContact } from '../resolveContact';
import { contactsApi } from '../../../../api/contacts';

describe('resolveContact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('email が直接指定されている場合', () => {
    it('有効な email → resolved（contacts 検索せず）', async () => {
      const result = await resolveContact({ email: 'test@example.com', name: 'テスト' });

      expect(result.type).toBe('resolved');
      if (result.type === 'resolved') {
        expect(result.contact.email).toBe('test@example.com');
        expect(result.contact.display_name).toBe('テスト');
        expect(result.contact.contact_id).toBe('');  // 外部メールなので空
      }

      // contacts API は呼ばれない
      expect(contactsApi.list).not.toHaveBeenCalled();
    });

    it('無効な email → invalid', async () => {
      const result = await resolveContact({ email: 'invalid-email' });

      expect(result.type).toBe('invalid');
      if (result.type === 'invalid') {
        expect(result.reason).toContain('無効なメールアドレス');
      }
    });
  });

  describe('name のみの場合', () => {
    it('1件ヒット＆email あり → resolved', async () => {
      vi.mocked(contactsApi.list).mockResolvedValueOnce({
        contacts: [
          { id: 'contact-1', display_name: '大島太郎', email: 'oshima@example.com' },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      } as any);

      const result = await resolveContact({ name: '大島くん' });

      expect(result.type).toBe('resolved');
      if (result.type === 'resolved') {
        expect(result.contact.contact_id).toBe('contact-1');
        expect(result.contact.display_name).toBe('大島太郎');
        expect(result.contact.email).toBe('oshima@example.com');
      }

      // 敬称を除去して検索
      expect(contactsApi.list).toHaveBeenCalledWith({ q: '大島', limit: 10 });
    });

    it('1件ヒット＆email なし → not_found (no_email)', async () => {
      vi.mocked(contactsApi.list).mockResolvedValueOnce({
        contacts: [
          { id: 'contact-1', display_name: '大島太郎', email: null },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      } as any);

      const result = await resolveContact({ name: '大島くん' });

      expect(result.type).toBe('not_found');
      if (result.type === 'not_found') {
        expect(result.reason).toBe('no_email');
        expect(result.query_name).toBe('大島くん');
      }
    });

    it('複数件ヒット → needs_selection（email ありのみ）', async () => {
      vi.mocked(contactsApi.list).mockResolvedValueOnce({
        contacts: [
          { id: 'contact-1', display_name: '田中一郎', email: 'tanaka1@example.com' },
          { id: 'contact-2', display_name: '田中二郎', email: 'tanaka2@example.com' },
          { id: 'contact-3', display_name: '田中三郎', email: null },  // email なし → 除外
        ],
        total: 3,
        limit: 10,
        offset: 0,
      } as any);

      const result = await resolveContact({ name: '田中さん' });

      expect(result.type).toBe('needs_selection');
      if (result.type === 'needs_selection') {
        expect(result.candidates).toHaveLength(2);  // email なしは除外
        expect(result.candidates[0].display_name).toBe('田中一郎');
        expect(result.candidates[1].display_name).toBe('田中二郎');
        expect(result.query_name).toBe('田中さん');
      }
    });

    it('0件ヒット → not_found (no_match)', async () => {
      vi.mocked(contactsApi.list).mockResolvedValueOnce({
        contacts: [],
        total: 0,
        limit: 10,
        offset: 0,
      } as any);

      const result = await resolveContact({ name: '存在しない人' });

      expect(result.type).toBe('not_found');
      if (result.type === 'not_found') {
        expect(result.reason).toBe('no_match');
        expect(result.query_name).toBe('存在しない人');
      }
    });

    it('API エラー → invalid', async () => {
      vi.mocked(contactsApi.list).mockRejectedValueOnce(new Error('API error'));

      const result = await resolveContact({ name: '田中さん' });

      expect(result.type).toBe('invalid');
      if (result.type === 'invalid') {
        expect(result.reason).toContain('エラーが発生');
      }
    });
  });

  describe('name も email もない場合', () => {
    it('→ invalid', async () => {
      const result = await resolveContact({});

      expect(result.type).toBe('invalid');
      if (result.type === 'invalid') {
        expect(result.reason).toContain('名前またはメールアドレスが必要');
      }
    });
  });

  describe('候補数の制限', () => {
    it('6件以上ヒットしても最大5件まで', async () => {
      vi.mocked(contactsApi.list).mockResolvedValueOnce({
        contacts: [
          { id: 'c1', display_name: '田中1', email: 't1@example.com' },
          { id: 'c2', display_name: '田中2', email: 't2@example.com' },
          { id: 'c3', display_name: '田中3', email: 't3@example.com' },
          { id: 'c4', display_name: '田中4', email: 't4@example.com' },
          { id: 'c5', display_name: '田中5', email: 't5@example.com' },
          { id: 'c6', display_name: '田中6', email: 't6@example.com' },
        ],
        total: 6,
        limit: 10,
        offset: 0,
      } as any);

      const result = await resolveContact({ name: '田中' });

      expect(result.type).toBe('needs_selection');
      if (result.type === 'needs_selection') {
        expect(result.candidates).toHaveLength(5);  // 最大5件
      }
    });
  });
});
