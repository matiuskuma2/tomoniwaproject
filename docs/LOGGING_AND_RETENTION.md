# LOGGING_AND_RETENTION.md

**Logging & Retention Policy（監査/運用/スケール）**

---

## ドキュメント情報

| 項目 | 内容 |
|------|------|
| バージョン | v1.0 |
| 作成日 | 2026-01-01 |
| ステータス | ✅ 確定（変更は影響範囲必須） |
| 関連文書 | `DEVELOPMENT_ROADMAP.md`, `CHAT_DATA_CONTRACT.md` |

---

## 目的

- "ログが溜まるとおかしくなる"を防ぐため、ログ種類を分離し、保持/索引/取得方法を固定する
- **1万人規模（データ爆増）でも後戻りしない土台を作る**

## 非目的

- UIデザインの固定
- Google Calendar同期の具体実装（Next-7 Day1で実装）

---

## 1. ログの分類（必ず分ける）

### 1.1 chat_messages（ユーザー体験ログ）

**用途：**
- チャットUIに表示するため

**特徴：**
- 読み取り頻度が高い
- DOM肥大の原因になりやすい

**原則：**
- UI表示は最新N件（`CHAT_DATA_CONTRACT.md`に従う）
- データは保持しても良いが、取得はcursor
- UIが直接触るのはこれだけ

---

### 1.2 audit_logs（監査ログ：superadmin/運用の正）

**用途：**
- "誰が/いつ/何を/誰に対して" を後から証明する

**特徴：**
- 重要だがUI表示頻度は低い
- 集計/検索の対象
- **長期保持が必要**

**記録対象（固定）：**

| カテゴリ | 記録内容 | 理由 |
|---------|---------|------|
| **Consent** | 取得/撤回（ConsentA/B/C/D） | 距離感昇格の証明 |
| **実行** | 自動確定/登録/通知の実行 | 勝手に実行していないことの証明 |
| **Link** | 作成/失効 | 外部誘導の追跡 |
| **Schedule** | 確定/変更/キャンセル | 予定操作の履歴 |
| **APIキー** | 登録/削除（本体は保存しない） | セキュリティ監査 |
| **superadmin** | BAN/プラン変更/制限変更 | 運営操作の監査 |

**DB構造（例）：**
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL, -- consent_granted/schedule_confirmed/link_created等
  target_type TEXT NOT NULL, -- contact/schedule/link等
  target_id UUID,
  payload_hash TEXT, -- PII最小化のためハッシュ
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- 必須インデックス
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action, created_at DESC);
```

---

### 1.3 jobs（非同期処理ログ）

**用途：**
- "重い処理"の実行状態を追う（同期/通知生成/要約など）

**例：**
- `notification_jobs` - 通知生成ジョブ
- `sync_jobs` - カレンダー同期ジョブ
- `summarization_jobs` - 会話要約ジョブ

**原則：**
- UIからは「結果だけ」参照（詳細ログは運用画面へ）
- 状態管理：pending / processing / completed / failed

**DB構造（例）：**
```sql
CREATE TABLE notification_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  thread_id UUID NOT NULL REFERENCES threads(id),
  job_type TEXT NOT NULL, -- remind/confirm/split等
  status TEXT NOT NULL, -- pending/processing/completed/failed
  result_payload JSONB,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- 必須インデックス
CREATE INDEX idx_notification_jobs_user_thread ON notification_jobs(user_id, thread_id);
CREATE INDEX idx_notification_jobs_status ON notification_jobs(status, created_at);
```

---

## 2. 保持（Retention）方針

### 2.1 chat_messages

| 項目 | 方針 |
|------|------|
| **UI表示** | 最新N件のみ（CHAT_DATA_CONTRACT.md参照） |
| **保持** | 当面保持可（ただし取得はcursor、管理は肥大対策を前提） |
| **将来** | アーカイブ/要約/検索の導線を追加（Next-9: RAG） |

---

### 2.2 audit_logs

| 項目 | 方針 |
|------|------|
| **原則** | **長期保持（削除しない）** |
| **PII最小化** | payloadはハッシュ or 最小限 |
| **検索/集計** | 索引を強くする（パフォーマンス維持） |
| **パーティション** | 将来的に年月単位でパーティション化も検討 |

---

### 2.3 jobs

| 項目 | 方針 |
|------|------|
| **保持** | 運用上の必要期間（例：30-90日） |
| **削除** | 期限を決めて削除（肥大を防ぐ） |
| **失敗ログ** | 長めに保持（トラブルシュート用） |

---

## 3. DB索引（1万人耐性の固定ルール）

### 必須インデックス一覧

```sql
-- chat_messages
CREATE INDEX idx_chat_messages_user_thread ON chat_messages(user_id, thread_id, created_at);
CREATE INDEX idx_chat_messages_created ON chat_messages(created_at DESC);

-- audit_logs
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action, created_at DESC);

-- schedules
CREATE INDEX idx_schedules_thread_status ON schedules(thread_id, status, created_at DESC);
CREATE INDEX idx_schedules_user ON schedules(user_id, created_at DESC);

-- selections（投票）
CREATE INDEX idx_selections_schedule_slot ON selections(schedule_id, selected_slot_id);
CREATE INDEX idx_selections_invitee ON selections(schedule_id, invitee_key);

-- invites
CREATE INDEX idx_invites_thread_status ON invites(thread_id, status);
CREATE INDEX idx_invites_token ON invites(token);

-- contacts
CREATE INDEX idx_contacts_user_email ON contacts(user_id, email);
CREATE INDEX idx_contacts_user ON contacts(user_id, created_at DESC);

-- relationships
CREATE INDEX idx_relationships_user_type ON relationships(user_id, relationship_type);
CREATE INDEX idx_relationships_contact ON relationships(contact_id);

-- notifications
CREATE INDEX idx_notifications_user_thread ON notifications(user_id, thread_id, created_at DESC);

-- jobs
CREATE INDEX idx_notification_jobs_user_thread ON notification_jobs(user_id, thread_id);
CREATE INDEX idx_notification_jobs_status ON notification_jobs(status, created_at);
CREATE INDEX idx_sync_jobs_user_thread ON sync_jobs(user_id, thread_id);
CREATE INDEX idx_sync_jobs_status ON sync_jobs(status, created_at);
```

---

### ページング方式

**禁止事項：**
- ❌ **offset禁止**（データ増で遅くなる）

**必須方式：**
- ✅ **cursor方式**（`created_at + id` などの複合cursor）

**実装例：**
```sql
-- 良い例（cursor pagination）
SELECT * FROM audit_logs
WHERE (created_at, id) < ($cursor_timestamp, $cursor_id)
ORDER BY created_at DESC, id DESC
LIMIT 50;

-- 悪い例（offset pagination）
SELECT * FROM audit_logs
ORDER BY created_at DESC
OFFSET 1000 LIMIT 50; -- 遅くなる
```

---

## 4. APIの原則（ログを増やしても壊れない）

### 4.1 読み取り

**原則：**
- 常にOK（ただし**limit/cursor必須**）
- ページング無しの全件取得は禁止

**例：**
```
GET /api/audit-logs?limit=50&cursor=<cursor>
GET /api/threads/:id/messages?limit=50&cursor=<cursor>
```

---

### 4.2 書き込み

**原則：**
- **confirm intent のみ**（実行点を固定）
- 冪等性担保（idempotency_key）

**例：**
```
POST /api/threads/:id/confirm
{
  "intent": "schedule.auto_propose.confirm",
  "idempotency_key": "thread_abc123_propose_001"
}
```

---

### 4.3 大量出力（監査/集計）

**原則：**
- **非同期 or 集計テーブルを使う**
- 都度集計は禁止（1万人で死ぬ）

**実装方針：**
1. 集計テーブルを用意（日次/月次バッチで更新）
2. superadmin画面は集計テーブルから表示
3. リアルタイム性が必要なものだけキャッシュ

---

## 5. 集計（superadminのための土台）

### 5.1 原則

**固定方針：**
- **"リアルタイム不要"な指標は集計テーブル/キャッシュ**
- 都度集計は1万人で破綻する

---

### 5.2 集計対象（例）

| 指標 | 集計方法 | 更新頻度 |
|------|---------|---------|
| プラン別ユーザー数 | 集計テーブル | 日次 |
| 今月のリンク作成数 | 集計テーブル | 日次 |
| 通知生成数 | 集計テーブル | 日次 |
| 実行回数 | 集計テーブル | 日次 |
| エラー率 | 集計テーブル | 時間 |
| アクティブユーザー数 | キャッシュ | リアルタイム |

---

### 5.3 実装例

**集計テーブル：**
```sql
CREATE TABLE daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE NOT NULL,
  metric_type TEXT NOT NULL, -- plan_distribution/link_count/notification_count等
  metric_value JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(metric_date, metric_type)
);

-- インデックス
CREATE INDEX idx_daily_metrics_date_type ON daily_metrics(metric_date DESC, metric_type);
```

**バッチ処理（例）：**
```sql
-- 日次バッチ（深夜実行）
INSERT INTO daily_metrics (metric_date, metric_type, metric_value)
VALUES (
  CURRENT_DATE,
  'plan_distribution',
  jsonb_build_object(
    'free', (SELECT COUNT(*) FROM users WHERE plan = 'free'),
    'pro', (SELECT COUNT(*) FROM users WHERE plan = 'pro'),
    'team', (SELECT COUNT(*) FROM users WHERE plan = 'team'),
    'enterprise', (SELECT COUNT(*) FROM users WHERE plan = 'enterprise')
  )
)
ON CONFLICT (metric_date, metric_type)
DO UPDATE SET metric_value = EXCLUDED.metric_value;
```

---

## 6. セキュリティ（ログに関する固定）

### 6.1 APIキー管理

**原則：**
- **APIキー本体は保存しない**（暗号化保存しても"閲覧UI"は禁止）
- `audit_logs`には「キー登録/削除の事実」だけ残す

**実装例：**
```typescript
// 良い例
await auditLog({
  actor_user_id: userId,
  action: 'api_key_registered',
  target_type: 'api_key',
  target_id: keyId,
  payload_hash: hashOf(keyId) // 本体は保存しない
});

// 悪い例
await auditLog({
  payload: { api_key: 'sk-xxxx' } // ❌ 本体を保存してはいけない
});
```

---

### 6.2 superadmin操作

**原則：**
- **superadmin操作も `audit_logs`に残す**（運用が事故らないため）

**記録対象：**
- ユーザーBAN/有効化
- プラン変更（強制）
- 制限変更（entitlements）
- APIキー強制削除
- データ削除操作

---

### 6.3 PII（個人情報）最小化

**原則：**
- PII（個人情報）は最小
- 必要なら `payload_hash` で追跡（内容は保存しない）

**実装例：**
```typescript
// 良い例
await auditLog({
  action: 'consent_granted',
  target_type: 'contact',
  target_id: contactId,
  payload_hash: hashOf({ email: contact.email, consent_type: 'ConsentA' })
  // emailは保存しない
});

// 悪い例
await auditLog({
  payload: { email: 'user@example.com' } // ❌ PII直接保存
});
```

---

## 7. 変更ルール（運用）

**このファイルに触れる変更は必ずPRで差分提出し、影響範囲を列挙する**

### 変更時に影響範囲を確認する項目：

| 項目 | 現在値 | 変更時の影響 |
|------|--------|-------------|
| ログの分類 | chat/audit/jobs | DB設計/UI/API全体 |
| Retention期間 | 記載通り | ストレージ容量/バックアップ |
| 索引方針 | cursor pagination | API/クエリパフォーマンス |
| 集計方針 | 集計テーブル | superadmin画面/レポート |
| PII最小化 | payload_hash | セキュリティ/監査 |

---

## 8. テストケース（必須）

以下のテストケースは必ず維持する：

### 8.1 ログ分離テスト
- [ ] chat_messagesとaudit_logsが分離されている
- [ ] UIはchat_messagesのみアクセスする
- [ ] superadminはaudit_logsにアクセスできる

### 8.2 cursor paginationテスト
- [ ] audit_logsをcursorで取得できる
- [ ] 1万件以上でも性能劣化しない
- [ ] offsetを使っていない

### 8.3 retention テスト
- [ ] audit_logsが長期保持される
- [ ] jobsが期限後に削除される
- [ ] chat_messagesがcursorで取得できる

### 8.4 集計テーブルテスト
- [ ] 日次バッチで集計テーブルが更新される
- [ ] superadmin画面で集計データが表示される
- [ ] リアルタイム集計を使っていない

### 8.5 セキュリティテスト
- [ ] APIキー本体が保存されていない
- [ ] superadmin操作がaudit_logsに記録される
- [ ] PII最小化されている

---

**END OF DOCUMENT**
