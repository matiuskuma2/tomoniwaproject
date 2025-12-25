/**
 * Test script for database migrations and repositories
 * Run with: npx tsx scripts/test-migrations.ts
 */

import { AIProviderSettingsRepository } from '../apps/api/src/repositories/aiProviderSettingsRepo';
import { AIProviderKeysRepository, createMaskedPreview } from '../apps/api/src/repositories/aiProviderKeysRepo';
import { SystemSettingsRepository } from '../apps/api/src/repositories/systemSettingsRepo';

// Mock D1Database for testing
const mockDB = {
  prepare: (query: string) => ({
    bind: (...args: any[]) => ({
      all: async () => ({ results: [] }),
      first: async () => null,
      run: async () => ({ success: true }),
    }),
    all: async () => ({ results: [] }),
    first: async () => null,
    run: async () => ({ success: true }),
  }),
  batch: async (statements: any[]) => {
    console.log(`✅ Batch executed with ${statements.length} statements`);
    return statements.map(() => ({ success: true }));
  },
  exec: async (query: string) => {
    console.log(`✅ Exec: ${query.substring(0, 100)}...`);
    return { success: true };
  },
} as any;

async function testAIProviderSettingsRepo() {
  console.log('\n=== Testing AIProviderSettingsRepository ===\n');
  
  const repo = new AIProviderSettingsRepository(mockDB);
  
  // Test upsertMany
  console.log('Testing upsertMany...');
  const testData = [
    {
      provider: 'gemini' as const,
      is_enabled: true,
      default_model: 'gemini-2.0-flash-exp',
      fallback_provider: 'openai' as const,
      fallback_model: 'gpt-4o-mini',
      feature_routing_json: {
        intent_parse: 'gemini-2.0-flash-exp',
        candidate_gen: 'gemini-2.0-flash-exp',
      },
    },
    {
      provider: 'openai' as const,
      is_enabled: true,
      default_model: 'gpt-4o-mini',
      feature_routing_json: {},
    },
  ];
  
  try {
    await repo.upsertMany(testData);
    console.log('✅ upsertMany succeeded');
  } catch (error) {
    console.error('❌ upsertMany failed:', error);
  }
}

async function testAIProviderKeysRepo() {
  console.log('\n=== Testing AIProviderKeysRepository ===\n');
  
  const repo = new AIProviderKeysRepository(mockDB);
  
  // Test createMaskedPreview
  console.log('Testing createMaskedPreview...');
  const testKey = 'sk-proj-1234567890abcdefghijklmnopqrstuvwxyz';
  const masked = createMaskedPreview(testKey);
  console.log(`Original: ${testKey}`);
  console.log(`Masked: ${masked}`);
  console.log(masked === 'sk-****...****wxyz' ? '✅ Masking correct' : '❌ Masking incorrect');
  
  // Test create
  console.log('\nTesting create...');
  try {
    await repo.create('gemini', 'Primary Gemini Key', 'encrypted_key_here', masked);
    console.log('✅ create succeeded');
  } catch (error) {
    console.error('❌ create failed:', error);
  }
}

async function testSystemSettingsRepo() {
  console.log('\n=== Testing SystemSettingsRepository ===\n');
  
  const repo = new SystemSettingsRepository(mockDB);
  
  // Test upsertMany
  console.log('Testing upsertMany...');
  const testData = [
    {
      key: 'email.from_address',
      value_json: 'noreply@example.com',
    },
    {
      key: 'email.from_name',
      value_json: 'AI Secretary',
    },
    {
      key: 'ogp.site_name',
      value_json: 'AI Secretary Scheduler',
    },
    {
      key: 'legal.terms_url',
      value_json: 'https://example.com/terms',
    },
  ];
  
  try {
    await repo.upsertMany(testData, 'admin-test-id');
    console.log('✅ upsertMany succeeded');
  } catch (error) {
    console.error('❌ upsertMany failed:', error);
  }
}

async function main() {
  console.log('🧪 Starting Repository Tests\n');
  console.log('Note: Using mock D1Database for testing');
  console.log('For real testing, run migrations with: npx wrangler d1 migrations apply webapp-production --local\n');
  
  await testAIProviderSettingsRepo();
  await testAIProviderKeysRepo();
  await testSystemSettingsRepo();
  
  console.log('\n✅ All repository tests completed!\n');
  console.log('Next steps:');
  console.log('1. Apply migrations: npx wrangler d1 migrations apply webapp-production --local');
  console.log('2. Test with real D1: Implement integration tests');
  console.log('3. Implement API routes for admin endpoints');
}

main().catch(console.error);
