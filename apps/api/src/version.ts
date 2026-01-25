// NOTE: This file is intentionally committed for safety.
// scripts/write-version.mjs will overwrite VERSION values on build/deploy.
export const VERSION = {
  commit: "5467cd1",
  build_time: "2026-01-25T13:54:49.100Z",
} as const;

export type VersionInfo = typeof VERSION;
