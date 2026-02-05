// NOTE: This file is intentionally committed for safety.
// scripts/write-version.mjs will overwrite VERSION values on build/deploy.
export const VERSION = {
  commit: "2adbf2f",
  build_time: "2026-02-05T17:29:08.626Z",
  // A-3b: router_fingerprint - ルート構成変更の差分検知
  router_fingerprint: "57057183",
} as const;

export type VersionInfo = typeof VERSION;
