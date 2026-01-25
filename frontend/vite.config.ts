import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

/**
 * Phase 0'-2: /version.json を dist に出力するプラグイン
 * 
 * 目的:
 *   - フロントエンドのデプロイ状態を即時確認
 *   - curl https://app.tomoniwao.jp/version.json で commit/build_time を取得
 * 
 * 設計:
 *   - ビルド成果物として emit（Gitにはコミットしない）
 *   - git が使えない環境でもビルドを落とさない（commit: 'unknown'）
 */
function versionJsonPlugin(): Plugin {
  return {
    name: 'version-json',
    generateBundle() {
      let commit = 'unknown'
      try {
        commit = execSync('git rev-parse --short HEAD', { 
          stdio: ['ignore', 'pipe', 'ignore'] 
        }).toString().trim()
      } catch {
        // ビルドは止めない（CIや浅いclone対策）
      }
      const build_time = new Date().toISOString()
      const body = JSON.stringify({ commit, build_time }, null, 2)

      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: body,
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionJsonPlugin()],
})
