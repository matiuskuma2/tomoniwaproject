/**
 * Storage Adapter
 * P1-C: Abstraction layer for localStorage (Web) / AsyncStorage (Native)
 * 
 * Purpose:
 * - Provide a unified interface for persistent storage
 * - Enable seamless migration from Web to Native
 * - Centralize storage error handling
 * 
 * Usage:
 * - Web: Uses localStorage (synchronous, but wrapped as async for compatibility)
 * - Native: Will use AsyncStorage (async)
 * 
 * Storage Keys:
 * - 'tomoniwao_messages': Per-thread chat messages
 * - 'tomoniwao_auth': Authentication state (future)
 * - 'tomoniwao_settings': User preferences (future)
 */

// Storage key constants
export const STORAGE_KEYS = {
  MESSAGES: 'tomoniwao_messages',
  AUTH: 'tomoniwao_auth',
  SETTINGS: 'tomoniwao_settings',
  TIMEZONE: 'tomoniwao_timezone',
} as const;

export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];

// Storage interface that both Web and Native implementations must follow
export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
  // Get all keys (useful for debugging/migration)
  getAllKeys(): Promise<string[]>;
}

// Error types for storage operations
export class StorageError extends Error {
  operation: 'get' | 'set' | 'remove' | 'clear';
  key?: string;
  originalCause?: unknown;
  
  constructor(
    message: string,
    operation: 'get' | 'set' | 'remove' | 'clear',
    key?: string,
    cause?: unknown
  ) {
    super(message);
    this.name = 'StorageError';
    this.operation = operation;
    this.key = key;
    this.originalCause = cause;
  }
}

/**
 * Web Storage Adapter (localStorage)
 * Wraps synchronous localStorage as async for API compatibility
 */
class WebStorageAdapter implements StorageAdapter {
  private isAvailable: boolean;

  constructor() {
    this.isAvailable = this.checkAvailability();
  }

  private checkAvailability(): boolean {
    try {
      const testKey = '__storage_test__';
      localStorage.setItem(testKey, testKey);
      localStorage.removeItem(testKey);
      return true;
    } catch {
      console.warn('[Storage] localStorage is not available');
      return false;
    }
  }

  async getItem(key: string): Promise<string | null> {
    if (!this.isAvailable) {
      return null;
    }
    try {
      return localStorage.getItem(key);
    } catch (error) {
      throw new StorageError(
        `Failed to get item: ${key}`,
        'get',
        key,
        error
      );
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    if (!this.isAvailable) {
      throw new StorageError(
        'localStorage is not available',
        'set',
        key
      );
    }
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      // Handle QuotaExceededError
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        throw new StorageError(
          `Storage quota exceeded for key: ${key}`,
          'set',
          key,
          error
        );
      }
      throw new StorageError(
        `Failed to set item: ${key}`,
        'set',
        key,
        error
      );
    }
  }

  async removeItem(key: string): Promise<void> {
    if (!this.isAvailable) {
      return;
    }
    try {
      localStorage.removeItem(key);
    } catch (error) {
      throw new StorageError(
        `Failed to remove item: ${key}`,
        'remove',
        key,
        error
      );
    }
  }

  async clear(): Promise<void> {
    if (!this.isAvailable) {
      return;
    }
    try {
      // Only clear our keys, not all localStorage
      const ourKeys = Object.values(STORAGE_KEYS);
      for (const key of ourKeys) {
        localStorage.removeItem(key);
      }
    } catch (error) {
      throw new StorageError(
        'Failed to clear storage',
        'clear',
        undefined,
        error
      );
    }
  }

  async getAllKeys(): Promise<string[]> {
    if (!this.isAvailable) {
      return [];
    }
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('tomoniwao_')) {
          keys.push(key);
        }
      }
      return keys;
    } catch (error) {
      throw new StorageError(
        'Failed to get all keys',
        'get',
        undefined,
        error
      );
    }
  }
}

/**
 * Native Storage Adapter (AsyncStorage)
 * Placeholder for React Native migration
 * Will be implemented when native app is developed
 */
// class NativeStorageAdapter implements StorageAdapter {
//   async getItem(key: string): Promise<string | null> {
//     // return await AsyncStorage.getItem(key);
//     throw new Error('Native storage not implemented');
//   }
//   async setItem(key: string, value: string): Promise<void> {
//     // await AsyncStorage.setItem(key, value);
//     throw new Error('Native storage not implemented');
//   }
//   async removeItem(key: string): Promise<void> {
//     // await AsyncStorage.removeItem(key);
//     throw new Error('Native storage not implemented');
//   }
//   async clear(): Promise<void> {
//     // const ourKeys = await AsyncStorage.getAllKeys();
//     // const filtered = ourKeys.filter(k => k.startsWith('tomoniwao_'));
//     // await AsyncStorage.multiRemove(filtered);
//     throw new Error('Native storage not implemented');
//   }
//   async getAllKeys(): Promise<string[]> {
//     // const allKeys = await AsyncStorage.getAllKeys();
//     // return allKeys.filter(k => k.startsWith('tomoniwao_'));
//     throw new Error('Native storage not implemented');
//   }
// }

// Platform detection (can be overridden for testing)
export type Platform = 'web' | 'native';

let currentPlatform: Platform = 'web';

export function setPlatform(platform: Platform): void {
  currentPlatform = platform;
  // Reset storage instance when platform changes
  storageInstance = null;
}

export function getPlatform(): Platform {
  return currentPlatform;
}

// Singleton storage instance
let storageInstance: StorageAdapter | null = null;

/**
 * Get the storage adapter for the current platform
 * Singleton pattern ensures consistent state
 */
export function getStorage(): StorageAdapter {
  if (!storageInstance) {
    switch (currentPlatform) {
      case 'web':
        storageInstance = new WebStorageAdapter();
        break;
      case 'native':
        // TODO: Implement NativeStorageAdapter
        // storageInstance = new NativeStorageAdapter();
        throw new Error('Native storage not yet implemented');
      default:
        throw new Error(`Unknown platform: ${currentPlatform}`);
    }
  }
  return storageInstance;
}

// Convenience functions for direct usage
export const storage = {
  get: (key: string) => getStorage().getItem(key),
  set: (key: string, value: string) => getStorage().setItem(key, value),
  remove: (key: string) => getStorage().removeItem(key),
  clear: () => getStorage().clear(),
  keys: () => getStorage().getAllKeys(),
};

// JSON helpers with validation
export async function getJSON<T>(key: string): Promise<T | null> {
  const raw = await getStorage().getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`[Storage] Invalid JSON for key: ${key}`);
    return null;
  }
}

export async function setJSON<T>(key: string, value: T): Promise<void> {
  const serialized = JSON.stringify(value);
  await getStorage().setItem(key, serialized);
}

// Size utilities
export function getStorageSize(value: string): number {
  // UTF-16 encoding: 2 bytes per character (approximate)
  return new Blob([value]).size;
}

export function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
