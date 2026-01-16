/**
 * Platform Adapters
 * P1-C: Abstraction layer for Web/Native platform differences
 * P1-2: Added env.ts + log.ts for structured logging
 * 
 * Exports:
 * - storage: localStorage (Web) / AsyncStorage (Native)
 * - navigation: React Router (Web) / React Navigation (Native)
 * - env: Environment variables (Web/Native ready)
 * - log: Structured logger (Web/Native ready)
 * 
 * Usage:
 * import { storage, navigation, getEnv, log, STORAGE_KEYS, ROUTES } from '../core/platform';
 */

// P1-2: Environment adapter
export {
  getEnv,
  isProduction,
  isDevelopment,
  type AppEnv,
  type AppEnvName,
} from './env';

// P1-2: Structured logger
export { log, type LogContext } from './log';

// Storage adapter
export {
  storage,
  getStorage,
  getJSON,
  setJSON,
  getStorageSize,
  formatStorageSize,
  STORAGE_KEYS,
  setPlatform,
  getPlatform,
  StorageError,
  type StorageAdapter,
  type StorageKey,
  type Platform,
} from './storage';

// Navigation adapter
export {
  navigation,
  getNavigation,
  buildChatRoute,
  isChatRoute,
  extractThreadIdFromPath,
  ROUTES,
  type NavigationAdapter,
  type NavigationAction,
} from './navigation';
