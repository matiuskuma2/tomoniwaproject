// NOTE: This file is intentionally committed for safety.
// scripts/write-version.mjs will overwrite VERSION values on build/deploy.
export const VERSION = {
  commit: 'unknown',
  build_time: null as string | null,
} as const;

export type VersionInfo = typeof VERSION;
