# Frontend Native Preparation（ネイティブ化準備）

> React Native移行を見据えた設計ルールと準備事項
> 「後から詰む」を防ぐための事前整備

## 📋 概要

### ネイティブ化で詰む3大原因

1. **Platform依存** - localStorage, window, document 直接参照
2. **Navigation依存** - react-router前提のURL/履歴操作
3. **Web API依存** - Clipboard, Share, Notifications 等

### 対策の原則

> **「抽象化レイヤーを1枚挟む」**

Web固有のAPIは直接使わず、Platform Adapter経由で呼ぶ。
ネイティブ移行時はAdapter実装を差し替えるだけ。

---

## 🎯 Platform Adapters ✅ 実装済み

### 1. Storage Adapter（P1-C）✅ 完了

**ファイル**: `core/platform/storage.ts`

**目的**: localStorage ⇄ AsyncStorage の差し替え

**使用方法**:
```typescript
import { storage, STORAGE_KEYS } from '../core/platform';

// ❌ 禁止：直接参照
localStorage.setItem('key', value);

// ✅ 推奨：Adapter経由
await storage.set(STORAGE_KEYS.MESSAGES, value);
```

**提供API**:
```typescript
export const storage = {
  get: (key: string) => Promise<string | null>,
  set: (key: string, value: string) => Promise<void>,
  remove: (key: string) => Promise<void>,
  clear: () => Promise<void>,
  keys: () => Promise<string[]>,
};

export const STORAGE_KEYS = {
  MESSAGES: 'tomoniwao_messages',
  AUTH: 'tomoniwao_auth',
  SETTINGS: 'tomoniwao_settings',
  TIMEZONE: 'tomoniwao_timezone',
} as const;
```

### 2. Navigation Adapter（P1-C）✅ 完了

**ファイル**: `core/platform/navigation.ts`

**目的**: react-router ⇄ react-navigation の差し替え

**使用方法**:
```typescript
import { ROUTES, buildChatRoute } from '../core/platform';

// ❌ 禁止：ハードコードされたパス
navigate('/chat/' + threadId);

// ✅ 推奨：定数経由
navigate(ROUTES.CHAT_THREAD(threadId));
// または
navigate(buildChatRoute(threadId));
```

**提供API**:
```typescript
export const ROUTES = {
  HOME: '/',
  CHAT: '/chat',
  CHAT_THREAD: (threadId: string) => `/chat/${threadId}`,
  SETTINGS: '/settings',
  SETTINGS_BILLING: '/settings/billing',
  CONTACTS: '/contacts',
  LISTS: '/lists',
} as const;
```

---

## ⏳ 追加予定のAdapters

### 3. Environment Adapter ⏳ 未着手

**ファイル**: `core/platform/env.ts`（予定）

**目的**: プラットフォーム判定の一元化

**実装予定**:
```typescript
export type Platform = 'web' | 'ios' | 'android';

export const env = {
  platform: 'web' as Platform,
  isWeb: true,
  isNative: false,
  isIOS: false,
  isAndroid: false,
  
  // 機能フラグ
  supportsNotifications: true,
  supportsShare: true,
  supportsBiometrics: false,
  
  // バージョン情報
  appVersion: '1.0.0',
  buildNumber: '1',
};
```

### 4. Logger Adapter ⏳ 未着手

**ファイル**: `core/platform/log.ts`（予定）

**目的**: ログレベルとPII制御（運用事故防止）

**実装予定**:
```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const log = {
  debug: (message: string, data?: any) => void,
  info: (message: string, data?: any) => void,
  warn: (message: string, data?: any) => void,
  error: (message: string, error?: Error) => void,
  
  // PII（個人情報）を含むログは本番では出力しない
  debugPII: (message: string, data?: any) => void,
};

// 設定
export const logConfig = {
  level: 'info' as LogLevel,
  enablePII: false, // 本番ではfalse必須
  enableRemote: false, // Sentry等への送信
};
```

### 5. Clipboard Adapter ⏳ 未着手

**ファイル**: `core/platform/clipboard.ts`（予定）

**目的**: navigator.clipboard ⇄ Clipboard.setString の差し替え

**実装予定**:
```typescript
export const clipboard = {
  copy: async (text: string) => Promise<void>,
  paste: async () => Promise<string>,
};
```

### 6. Share Adapter ⏳ 未着手

**ファイル**: `core/platform/share.ts`（予定）

**目的**: Web Share API ⇄ Share.share の差し替え

**実装予定**:
```typescript
export const share = {
  share: async (options: {
    title?: string;
    text?: string;
    url?: string;
  }) => Promise<void>,
  
  canShare: () => boolean,
};
```

### 7. Notifications Adapter ⏳ 未着手

**ファイル**: `core/platform/notifications.ts`（予定）

**目的**: Web Notifications ⇄ PushNotifications の差し替え

**実装予定**:
```typescript
export const notifications = {
  requestPermission: async () => Promise<'granted' | 'denied'>,
  getToken: async () => Promise<string | null>,
  show: async (options: {
    title: string;
    body: string;
    data?: any;
  }) => Promise<void>,
};
```

---

## 📋 移行チェックリスト

### Web固有API使用箇所の確認

| API | 直接使用 | Adapter経由 | 備考 |
|-----|----------|-------------|------|
| localStorage | ❌ 禁止 | ✅ storage | useChatReducerで使用 |
| window.location | ❌ 禁止 | ✅ navigation | ChatLayoutで使用 |
| document | ⚠️ 要確認 | - | DOM操作は最小限に |
| navigator.clipboard | ⚠️ 要確認 | ⏳ clipboard | 招待URL コピー |
| navigator.share | ⚠️ 要確認 | ⏳ share | 共有機能 |
| Notification | ⚠️ 要確認 | ⏳ notifications | プッシュ通知 |

### URL/パス依存の確認

| 箇所 | 依存 | 対策 |
|------|------|------|
| `/chat/:threadId` | react-router | ROUTES定数使用 |
| `/settings` | react-router | ROUTES定数使用 |
| `window.history` | ブラウザ履歴 | navigation.back()使用 |

---

## 🔧 コーディングルール

### 必須ルール

1. **localStorage/sessionStorage 直接使用禁止**
   ```typescript
   // ❌ 禁止
   localStorage.setItem('key', value);
   
   // ✅ 必須
   await storage.set(STORAGE_KEYS.KEY, value);
   ```

2. **ハードコードされたパス禁止**
   ```typescript
   // ❌ 禁止
   navigate('/chat/' + threadId);
   
   // ✅ 必須
   navigate(ROUTES.CHAT_THREAD(threadId));
   ```

3. **window/document 直接参照は最小限**
   ```typescript
   // ⚠️ 注意が必要
   if (typeof window !== 'undefined') {
     // Web専用処理
   }
   
   // ✅ 推奨：Adapter経由
   if (env.isWeb) {
     // Web専用処理
   }
   ```

### 推奨ルール

1. **新規Web API使用時はAdapter化を検討**
2. **Platform固有処理は`platform/`に集約**
3. **ビジネスロジックはPlatform非依存に**

---

## 📊 移行時の工数見積もり

### Adapter実装済み（移行コスト低）

| Adapter | 実装状況 | 移行工数 |
|---------|----------|----------|
| storage | ✅ 完了 | 1日 |
| navigation | ✅ 完了 | 1日 |

### Adapter未実装（移行コスト中）

| Adapter | 実装状況 | 移行工数 |
|---------|----------|----------|
| env | ⏳ 未着手 | 0.5日 |
| log | ⏳ 未着手 | 0.5日 |
| clipboard | ⏳ 未着手 | 0.5日 |
| share | ⏳ 未着手 | 0.5日 |
| notifications | ⏳ 未着手 | 1日 |

### ビジネスロジック（移行コスト低）

| 領域 | 依存度 | 移行工数 |
|------|--------|----------|
| executors | Platform非依存 | 0日 |
| cache | Platform非依存 | 0日 |
| apiExecutor | Platform非依存 | 0日 |
| intentClassifier | Platform非依存 | 0日 |

### UI（移行コスト高）

| 領域 | 依存度 | 移行工数 |
|------|--------|----------|
| ChatLayout | react-router | 3日 |
| CardsPane | Web CSS | 2日 |
| ThreadsList | Web CSS | 2日 |

---

## 📝 更新履歴

| 日付 | 内容 | コミット |
|------|------|----------|
| 2026-01-14 | P1-C storage/navigation adapter | dc8b5bc |

---

## 関連ドキュメント

- [FRONTEND_REFRESH_MAP.md](./FRONTEND_REFRESH_MAP.md) - Write→Refresh一覧
- [FRONTEND_PERF_PLAN.md](./FRONTEND_PERF_PLAN.md) - 1万人対応計画
- [FRONTEND_ARCHITECTURE.md](./FRONTEND_ARCHITECTURE.md) - 全体設計
