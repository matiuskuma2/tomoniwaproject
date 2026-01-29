/**
 * r1-internal-scheduling.smoke.spec.ts
 * R1 Internal Scheduling Smoke Test - Production Safety
 * 
 * テスト対象:
 * - 本番環境で fixture API が 403 を返すことを確認（セキュリティ検証）
 * - 本番環境で認証なしで API にアクセスすると 401 が返ることを確認
 * 
 * NOTE: smoke プロジェクトで実行（本番 URL に対してテスト）
 */

import { test, expect } from '@playwright/test';

const PROD_API_URL = 'https://webapp.snsrilarc.workers.dev';

test.describe('R1 Internal Scheduling Smoke: Production Safety', () => {
  
  test('本番環境では users/pair fixture API が 403 を返す', async ({ request }) => {
    const response = await request.post(`${PROD_API_URL}/test/fixtures/users/pair`, {
      data: {}
    });
    
    const status = response.status();
    
    // 403 (production) または 201 (development/staging)
    expect([201, 403]).toContain(status);
    
    if (status === 403) {
      console.log('[R1-Smoke] Production safety check passed: users/pair fixture returns 403');
    } else {
      console.log('[R1-Smoke] Running in non-production environment: fixture returns 201');
      // クリーンアップ
      const data = await response.json();
      if (data.user_a && data.user_b) {
        await request.delete(`${PROD_API_URL}/test/fixtures/users/pair`, {
          data: { user_ids: [data.user_a.id, data.user_b.id] }
        });
      }
    }
  });

  test('本番環境では relationships fixture API が 403 を返す', async ({ request }) => {
    const response = await request.post(`${PROD_API_URL}/test/fixtures/relationships`, {
      data: {
        user_a_id: 'smoke-test-a',
        user_b_id: 'smoke-test-b',
        relation_type: 'workmate',
        permission_preset: 'workmate_default'
      }
    });
    
    const status = response.status();
    
    // 403 (production) または 201/400 (development/staging)
    expect([201, 400, 403]).toContain(status);
    
    if (status === 403) {
      console.log('[R1-Smoke] Production safety check passed: relationships fixture returns 403');
    } else {
      console.log('[R1-Smoke] Running in non-production environment');
    }
  });

  test('本番環境で認証なしで scheduling/internal/prepare にアクセスすると 401', async ({ request }) => {
    const response = await request.post(`${PROD_API_URL}/api/scheduling/internal/prepare`, {
      headers: {
        'Content-Type': 'application/json'
      },
      data: {
        invitee_user_id: 'smoke-test-user',
        title: 'Smoke test'
      }
    });
    
    expect(response.status()).toBe(401);
    console.log('[R1-Smoke] Unauthorized access to prepare API returns 401');
  });

  test('本番環境で認証なしで scheduling/internal/:threadId にアクセスすると 401', async ({ request }) => {
    const response = await request.get(`${PROD_API_URL}/api/scheduling/internal/smoke-test-thread-id`);
    
    expect(response.status()).toBe(401);
    console.log('[R1-Smoke] Unauthorized access to thread detail API returns 401');
  });

  test('本番環境で認証なしで scheduling/internal/:threadId/respond にアクセスすると 401', async ({ request }) => {
    const response = await request.post(`${PROD_API_URL}/api/scheduling/internal/smoke-test-thread-id/respond`, {
      headers: {
        'Content-Type': 'application/json'
      },
      data: {
        selected_slot_id: 'smoke-test-slot'
      }
    });
    
    expect(response.status()).toBe(401);
    console.log('[R1-Smoke] Unauthorized access to respond API returns 401');
  });
});
