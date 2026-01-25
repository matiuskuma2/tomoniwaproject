/**
 * write-version.mjs
 * Phase 0'-1: ビルド時に version.ts を上書き
 * 
 * 目的:
 *   - /health で commit_sha と build_time を返すため
 *   - Cloudflare vars/secrets に依存しない（手動/CI両対応）
 * 
 * 使用方法:
 *   node scripts/write-version.mjs
 * 
 * 設計:
 *   - version.ts は常駐ファイルとしてコミット
 *   - このスクリプトがビルド時に値を上書き
 *   - clone直後でも import が落ちない（安全）
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * コマンドを安全に実行（失敗時は 'unknown' を返す）
 */
function safe(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

const commit = safe('git rev-parse --short HEAD');
const build_time = new Date().toISOString();

// apps/api/src/version.ts を上書き（process.cwd()基準）
const outPath = path.join(process.cwd(), 'apps', 'api', 'src', 'version.ts');

const body = `// NOTE: This file is intentionally committed for safety.
// scripts/write-version.mjs will overwrite VERSION values on build/deploy.
export const VERSION = {
  commit: ${JSON.stringify(commit)},
  build_time: ${JSON.stringify(build_time)},
} as const;

export type VersionInfo = typeof VERSION;
`;

fs.writeFileSync(outPath, body, 'utf8');
console.log(`[write-version] Updated: ${outPath} commit=${commit} build_time=${build_time}`);
