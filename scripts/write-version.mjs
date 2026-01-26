/**
 * write-version.mjs
 * Phase 0'-1: ビルド時に version.ts を上書き
 * A-3b: router_fingerprint 追加（ルート構成変更の差分検知）
 * 
 * 目的:
 *   - /health で commit_sha と build_time を返すため
 *   - Cloudflare vars/secrets に依存しない（手動/CI両対応）
 *   - router_fingerprint でルート構成変更を検知
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
import { createHash } from 'node:crypto';
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

/**
 * A-3b: router_fingerprint 生成
 * threads/index.ts の import 文からサブルート一覧を抽出してハッシュ化
 * 
 * 目的: ルート構成が変わったかどうかを /health で検知
 * 例: list, create, proposals, invites, actions → fingerprint
 */
function generateRouterFingerprint() {
  const threadsIndexPath = path.join(process.cwd(), 'apps', 'api', 'src', 'routes', 'threads', 'index.ts');
  
  let content = '';
  try {
    content = fs.readFileSync(threadsIndexPath, 'utf8');
  } catch {
    return { fingerprint: 'unknown', routes: [] };
  }
  
  // import 文からサブルート名を抽出
  // 例: import listRoutes from './list'; → "list"
  const importMatches = content.match(/import \w+Routes from '\.\/(\w+)'/g) || [];
  const routes = importMatches
    .map(m => m.match(/from '\.\/(\w+)'/)?.[1] || '')
    .filter(Boolean)
    .sort();
  
  // ルート一覧からSHA256ハッシュを生成（短縮版8文字）
  const routeList = routes.join(',');
  const hash = createHash('sha256').update(routeList).digest('hex').substring(0, 8);
  
  return {
    fingerprint: hash,
    routes: routes,
  };
}

const commit = safe('git rev-parse --short HEAD');
const build_time = new Date().toISOString();
const { fingerprint: router_fingerprint, routes } = generateRouterFingerprint();

// apps/api/src/version.ts を上書き（process.cwd()基準）
const outPath = path.join(process.cwd(), 'apps', 'api', 'src', 'version.ts');

const body = `// NOTE: This file is intentionally committed for safety.
// scripts/write-version.mjs will overwrite VERSION values on build/deploy.
export const VERSION = {
  commit: ${JSON.stringify(commit)},
  build_time: ${JSON.stringify(build_time)},
  // A-3b: router_fingerprint - ルート構成変更の差分検知
  router_fingerprint: ${JSON.stringify(router_fingerprint)},
} as const;

export type VersionInfo = typeof VERSION;
`;

fs.writeFileSync(outPath, body, 'utf8');
console.log(`[write-version] Updated: ${outPath} commit=${commit} build_time=${build_time} router_fingerprint=${router_fingerprint}`);
console.log(`[write-version] Routes detected: ${routes.join(', ') || '(none)'}`);
