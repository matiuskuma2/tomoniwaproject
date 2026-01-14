# Frontend Refresh Map

> Write操作後にどのRead APIをrefreshするかの一覧
> 運用事故防止のための必須ルール

## 📋 概要

### 目的
- Write操作後のキャッシュ不整合を防止
- 「古い状態が表示される」運用事故を根絶
- 開発者が迷わないルールの明文化

### 原則
1. **Write後は必ず関連Readをrefresh**
2. **refreshはキャッシュのTTLを無視して強制実行**
3. **複数画面に影響する場合は全てrefresh**

---

## 🔄 Refresh Map（Write → Read）

### Thread操作

| Write操作 | 関数 | Refresh対象 | 備考 |
|-----------|------|-------------|------|
| スレッド作成 | `threadsApi.create()` | `refreshStatus(threadId)`, `refreshThreadsList()` | 新規threadIdを取得後 |
| 日程確定 | `threadsApi.finalize()` | `refreshStatus(threadId)`, `refreshInbox()` | confirmed状態に変更 |
| 候補追加 | `threadsApi.addSlots()` | `refreshStatus(threadId)` | slots配列が変更 |
| 招待送信 | `threadsApi.addBulkInvites()` | `refreshStatus(threadId)` | invites配列が変更 |

### Remind操作

| Write操作 | 関数 | Refresh対象 | 備考 |
|-----------|------|-------------|------|
| リマインド送信 | `threadsApi.remind()` | `refreshStatus(threadId)` | invites.statusが変更可能性 |
| 再回答要求送信 | `threadsApi.remindNeedResponse()` | `refreshStatus(threadId)` | proposal_version_at_responseが変更 |

### Pending Action操作

| Write操作 | 関数 | Refresh対象 | 備考 |
|-----------|------|-------------|------|
| 送信確認実行 | `pendingActionsApi.execute()` | `refreshStatus(threadId)`, `refreshThreadsList()` | threadId必須 |
| 候補追加確認実行 | `pendingActionsApi.execute()` | `refreshStatus(threadId)` | add_slots時 |

### List操作

| Write操作 | 関数 | Refresh対象 | 備考 |
|-----------|------|-------------|------|
| リスト作成 | `listsApi.create()` | `refreshListsList()` | 新規list追加 |
| メンバー追加 | `listsApi.addMember()` | `refreshListMembers(listId)` | members配列が変更 |

### Calendar操作（将来）

| Write操作 | 関数 | Refresh対象 | 備考 |
|-----------|------|-------------|------|
| 予定作成 | `calendarApi.create()` | `refreshToday()`, `refreshWeek()` | 作成日に応じて |

---

## 🛡️ 実装パターン

### 推奨パターン：Executor内でrefresh呼び出し

```typescript
// executors/thread.ts
export async function executeFinalize(intentResult: IntentResult): Promise<ExecutionResult> {
  const { threadId, slotNumber } = intentResult.params;
  
  try {
    // Write操作
    const response = await threadsApi.finalize(threadId, {
      selected_slot_id: selectedSlotId,
    });
    
    // ✅ 必須：Write後のrefresh
    await refreshStatus(threadId);  // 強制refresh（TTL無視）
    // TODO: refreshInbox() も追加予定
    
    return { success: true, message, data };
  } catch (error) {
    // エラー時もrefreshして最新状態を取得
    await refreshStatus(threadId);
    return { success: false, message: errorMessage };
  }
}
```

### 禁止パターン：UIコンポーネント内で直接refresh

```typescript
// ❌ 禁止：UIコンポーネントでの直接refresh
function ConfirmButton({ threadId }) {
  const handleClick = async () => {
    await threadsApi.finalize(threadId, data);
    await refreshStatus(threadId);  // ← ここでやるな
  };
}

// ✅ 正解：Executor経由でrefresh
function ConfirmButton({ threadId }) {
  const handleClick = async () => {
    const result = await executeFinalize({ params: { threadId } });
    // refreshはexecutor内で完了済み
  };
}
```

---

## 📊 キャッシュ戦略の分類

### Read API（キャッシュ可）

| API | TTL | inflight共有 | 備考 |
|-----|-----|--------------|------|
| `threadsApi.getStatus()` | 10s | ✅ | 最も頻繁に呼ばれる |
| `threadsApi.list()` | 30s | ✅ | スレッド一覧 |
| `inboxApi.list()` | 30s | ✅ | 通知一覧 |
| `listsApi.list()` | 60s | ✅ | リスト一覧 |
| `calendarApi.today()` | 60s | ✅ | 今日の予定 |
| `calendarApi.week()` | 60s | ✅ | 今週の予定 |

### Write API（キャッシュ不可）

| API | 分類 | 備考 |
|-----|------|------|
| `threadsApi.create()` | write | 常に実行 |
| `threadsApi.finalize()` | write | 常に実行 |
| `threadsApi.addSlots()` | write | 常に実行 |
| `threadsApi.remind()` | write | 常に実行 |
| `pendingActionsApi.execute()` | write | 常に実行 |

---

## ⚠️ 運用事故パターンと対策

### パターン1：確定後に古い状態が表示される

**原因**: finalize後にrefreshStatusを呼んでいない
**対策**: executeFinalize内で必ずrefreshStatus(threadId)を呼ぶ

### パターン2：招待送信後にinvites.lengthが変わらない

**原因**: addBulkInvites後にrefreshStatusを呼んでいない
**対策**: executeInviteList内で必ずrefreshStatus(threadId)を呼ぶ

### パターン3：スレッド作成後に一覧に表示されない

**原因**: create後にrefreshThreadsListを呼んでいない
**対策**: executeCreate内で必ずrefreshThreadsList()を呼ぶ

### パターン4：キャッシュが効きすぎて古い状態が残る

**原因**: Write後にTTL内のキャッシュを返している
**対策**: Write操作後は必ずforceRefresh: trueで呼ぶ

---

## 🔧 実装チェックリスト

### 新しいWrite APIを追加する時

- [ ] 対応するrefresh対象を特定
- [ ] Executor内でrefresh呼び出しを追加
- [ ] このドキュメントに追記
- [ ] エラー時のrefresh処理も追加

### 既存のWrite APIを修正する時

- [ ] このドキュメントのrefresh対象を確認
- [ ] 変更によって新しいrefresh対象が増えないか確認
- [ ] テストでrefreshが呼ばれることを確認

---

## 📝 更新履歴

| 日付 | 内容 | 担当 |
|------|------|------|
| 2026-01-14 | 初版作成 | - |

---

## 関連ドキュメント

- [FRONTEND_PERF_PLAN.md](./FRONTEND_PERF_PLAN.md) - 1万人対応計画
- [FRONTEND_NATIVE_PREP.md](./FRONTEND_NATIVE_PREP.md) - ネイティブ化準備
- [FRONTEND_ARCHITECTURE.md](./FRONTEND_ARCHITECTURE.md) - 全体設計
