/**
 * Platform Adapters
 * P1-C: Abstraction layer for Web/Native platform differences
 * 
 * Exports:
 * - storage: localStorage (Web) / AsyncStorage (Native)
 * - navigation: React Router (Web) / React Navigation (Native)
 * 
 * Usage:
 * import { storage, navigation, STORAGE_KEYS, ROUTES } from '../core/platform';
 */

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
