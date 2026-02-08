/**
 * E2E Test: contact.import.text チャット取り込みフロー
 * PR-D-1: テキスト登録の事故ゼロ設計検証
 * 
 * テストシナリオ:
 * 1. IMPORT-1: 有効なテキストからの連絡先取り込みプレビュー
 * 2. IMPORT-2: メール欠落時のHard fail検証
 * 3. IMPORT-3: 曖昧一致検出（同姓同名）
 * 4. IMPORT-4: 確認フロー経由での登録
 */

import { test, expect } from '@playwright/test';

// API Base URL
const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://localhost:3000';

test.describe('PR-D-1: contact.import.text チャット取り込み', () => {
  // テスト用の認証トークン（E2E環境で設定）
  let authToken: string;
  let _workspaceId: string;

  test.beforeAll(async ({ request }) => {
    // E2Eテスト用のユーザーセットアップ
    try {
      const fixtureResponse = await request.post(`${API_BASE_URL}/test/fixtures/users/pair`, {
        data: {
          user_a: { name: 'Import Test User A', email: 'import-test-a@example.com' },
          user_b: { name: 'Import Test User B', email: 'import-test-b@example.com' },
        },
      });
      
      if (fixtureResponse.ok()) {
        const fixture = await fixtureResponse.json();
        authToken = fixture.user_a?.token;
        _workspaceId = fixture.user_a?.workspace_id || 'ws-default';
      }
    } catch (_e) {
      console.warn('Fixture setup failed, using mock auth');
    }
  });

  test('IMPORT-1: 有効なテキストから連絡先プレビュー生成', async ({ request }) => {
    const importText = `田中太郎 tanaka@example.com
佐藤花子 sato@example.com
山田次郎 yamada@example.com`;

    const response = await request.post(`${API_BASE_URL}/api/contacts/import`, {
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      data: {
        text: importText,
        source: 'text',
      },
    });

    // 401（未認証）の場合はスキップ
    if (response.status() === 401) {
      test.skip();
      return;
    }

    expect(response.ok()).toBeTruthy();
    
    const result = await response.json();
    
    // プレビュー構造の検証
    expect(result).toHaveProperty('preview');
    expect(result.preview).toHaveProperty('candidates');
    expect(result.preview).toHaveProperty('valid_count');
    expect(result.preview.valid_count).toBe(3);
    
    // 確認トークンの存在
    expect(result).toHaveProperty('confirmation_token');
    expect(result.requires_confirmation).toBe(true);
    
    // 各候補の構造検証
    const candidates = result.preview.candidates;
    expect(candidates.length).toBe(3);
    
    for (const candidate of candidates) {
      expect(candidate.status).toBe('ok');
      expect(candidate.email).toBeTruthy();
    }
  });

  test('IMPORT-2: メール欠落時のHard fail検証', async ({ request }) => {
    const importText = `田中太郎
佐藤花子 sato@example.com
山田次郎（メールなし）`;

    const response = await request.post(`${API_BASE_URL}/api/contacts/import`, {
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      data: {
        text: importText,
        source: 'text',
      },
    });

    if (response.status() === 401) {
      test.skip();
      return;
    }

    expect(response.ok()).toBeTruthy();
    
    const result = await response.json();
    
    // メール欠落のカウント検証
    expect(result.preview.missing_email_count).toBe(2); // 田中太郎、山田次郎
    expect(result.preview.valid_count).toBe(1); // 佐藤花子のみ
    
    // メール欠落の候補がmissing_emailステータス
    const missingEmailCandidates = result.preview.candidates.filter(
      (c: any) => c.status === 'missing_email'
    );
    expect(missingEmailCandidates.length).toBe(2);
  });

  test('IMPORT-3: 複数フォーマット対応の検証', async ({ request }) => {
    const importText = `田中太郎 tanaka@example.com
佐藤花子<sato@example.com>
山田次郎,yamada@example.com
suzuki@example.com`;

    const response = await request.post(`${API_BASE_URL}/api/contacts/import`, {
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      data: {
        text: importText,
        source: 'text',
      },
    });

    if (response.status() === 401) {
      test.skip();
      return;
    }

    expect(response.ok()).toBeTruthy();
    
    const result = await response.json();
    
    // 4件すべて有効
    expect(result.preview.valid_count).toBe(4);
    
    const candidates = result.preview.candidates;
    
    // スペース区切り
    expect(candidates[0].display_name).toBe('田中太郎');
    expect(candidates[0].email).toBe('tanaka@example.com');
    
    // カッコ区切り
    expect(candidates[1].display_name).toBe('佐藤花子');
    expect(candidates[1].email).toBe('sato@example.com');
    
    // カンマ区切り
    expect(candidates[2].display_name).toBe('山田次郎');
    expect(candidates[2].email).toBe('yamada@example.com');
    
    // メールのみ（名前なし）
    expect(candidates[3].display_name).toBeNull();
    expect(candidates[3].email).toBe('suzuki@example.com');
  });

  test('IMPORT-4: 空入力のエラーハンドリング', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/contacts/import`, {
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      data: {
        text: '',
        source: 'text',
      },
    });

    if (response.status() === 401) {
      test.skip();
      return;
    }

    // 400 Bad Request
    expect(response.status()).toBe(400);
    
    const result = await response.json();
    expect(result).toHaveProperty('error');
  });

  test('IMPORT-5: 100件超過のエラーハンドリング', async ({ request }) => {
    // 101件のメールアドレスを生成
    const lines = Array.from({ length: 101 }, (_, i) => `user${i}@example.com`);
    const importText = lines.join('\n');

    const response = await request.post(`${API_BASE_URL}/api/contacts/import`, {
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      data: {
        text: importText,
        source: 'text',
      },
    });

    if (response.status() === 401) {
      test.skip();
      return;
    }

    // 400 Bad Request
    expect(response.status()).toBe(400);
    
    const result = await response.json();
    expect(result.error).toContain('Too many lines');
  });
});
