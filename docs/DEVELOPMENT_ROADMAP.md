# DEVELOPMENT_ROADMAP.md

**Google OAuth審査待ち期間の開発ロードマップ（技術負債ゼロ・10,000人耐性）**

---

## ドキュメント情報

| 項目 | 内容 |
|------|------|
| バージョン | v1.0 |
| 作成日 | 2026-01-01 |
| 最終更新 | 2026-01-01 |
| ステータス | ✅ 確定（唯一の正解） |
| 対象フェーズ | Phase Next-8/9（審査待ち期間） |

### 更新履歴

| 日付 | バージョン | 変更内容 | 担当 |
|------|-----------|---------|------|
| 2026-01-01 | v1.0 | 初版作成（審査待ち期間の開発計画確定） | - |

---

## 0. 目的（Why）

Google Calendar OAuth審査が未完了の期間でも、**技術負債を増やさず**、**最終像（距離感・1対N・台帳・同意・管理者・RAG・ネイティブ化）と矛盾しない形**で開発を前進させる。

### 重要原則（固定）

1. **Google依存部分は Boundary + Feature Flag + Manual Fallback で隔離する**
2. **提案→確認→実行（confirmだけ実行）を崩さない**
3. **データ増加前提（人数×やり取り×台帳）なので、DB/Index/ページング/監査/キューを先に固める**
4. **UIは スマホ最優先（将来ネイティブ化）**
   - 「カードにしか出ない通知」を作らない
   - チャット上部バナーを正にする

---

## 1. 前提（事実ベース：現在地）

### ✅ 既に実装済み（Phase Next-5/6）

- **基本機能**
  - Thread / Schedule / Link / 投票
  - ガードレール：提案→確認→実行（confirmのみPOST）
  - 通知：A案（送信用セット返すだけ。自動送信なし）

- **Phase Next-6 完了項目**
  - 票割れ検知→追加候補提案（Day2）
  - 未返信リマインド（Day1）
  - 確定通知（Day3）
  - すべてconfirm型（事故ゼロ）

- **P0対処完了**
  - 票数集計の整合（サーバー側集計）
  - 履歴永続化（localStorage + debounce）
  - 白画面対策（ErrorBoundary + 自動クリア）
  - スマホUX改善（容量制限 + 検証）

### ⏳ 審査待ち（現時点で本実装不可）

- **Next-7 Day1：Google Calendar "書き込み同期"**
  - OAuth審査完了後に実装
  - 設計（Day0）は完了済み
    - `SYNC_RUNBOOK.md`
    - `SYNC_API_SPEC.md`
    - `NEXT7_REVIEW_CHECKLIST.md`

### 📋 関連ドキュメント

既存の仕様書が揃っている：
- `DATABASE_SCHEMA.md` - 現在のDBスキーマ
- `RELATIONSHIP_AND_PERMISSIONS.md` - 距離感の基本定義
- `CONTACTS_SPEC.md` - 顧客台帳の基本仕様
- `OAUTH_REVIEW_SUMMARY.md` - OAuth審査の状況

---

## 2. 「決めて固定する」決定事項（揉めポイント潰し）

これらは**変更不可の固定事項**として扱う。変更する場合は影響範囲を必ず列挙。

### 2-1. 距離感（Relationship）と同意

**固定事項：**
- **external/work/team/family の昇格は 自動禁止**（必ず同意）
- **team = 共有カレンダー（free/busy以上）が成立している集合を前提**

**同意の種類：**
- **ConsentA（work化）**: 空き状況参照（free/busy）＋確認付き登録まで許可
- **ConsentB（team化）**: free/busy以上（共有カレンダー前提）＋自動確定/登録
- **ConsentC（family化）**: 事後通知で登録OK（確認なし）
- **ConsentD（占い/MBTI）**: 閲覧・利用範囲

### 2-2. Linkモード

**予約モード：**
- 相手選択 → Schedule(pending)（仮確定）
- 主催者確定 or 締切 → confirmed（最終確定）
- **カレンダー登録はconfirmed後のみ**

**投票モード：**
- 投票 → 成立条件＋現実優先（freebusy）→ AI確定

### 2-3. Contact（台帳）の参照関係（固定）

**唯一の正解：**
- **Schedule.participants は contact_id参照が正**
- Thread/Link は必要に応じて Contact を参照してよい（必須ではない）

**データ構造：**
```
User
 ├─ Contacts（顧客台帳）
 ├─ Threads（会話文脈）
 ├─ Links（外部向け入口）
 ├─ Schedules（予定）
 │   └─ Participants（contact_id参照）
 └─ Policies（本人ルール / RAG参照）
```

### 2-4. 1対N成立条件（最小セット）

**最小3種類で固定：**
1. `all_required` - 全員必須
2. `min_attendees` - N人以上で成立
3. `keyman_required` - 特定のキーマン必須

### 2-5. superadmin

**現フェーズの前提：**
- **運営者1名前提**（UI提供対象ではなく内部運用目的）
- 課金/制限/監査/コストは将来拡張可能な形で今から設計

---

## 3. 審査待ちでも進める開発（Phase Next-8/9：審査非依存）

### Phase Next-8：関係性OS + 台帳OS（基盤を唯一の正解にする）

#### Next-8 Day1：Relationship & Consent（DB/UX/監査）

**ゴール：** external/work/team/family を同意＋監査ログで固定し、踏み込み範囲がブレない状態にする

**DB追加：**
```sql
-- relationships テーブル
CREATE TABLE relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  relationship_type TEXT NOT NULL, -- external/work/team/family
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(user_id, contact_id)
);

-- consents テーブル
CREATE TABLE consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  consent_type TEXT NOT NULL, -- ConsentA/ConsentB/ConsentC/ConsentD
  granted_at TIMESTAMP NOT NULL DEFAULT now(),
  revoked_at TIMESTAMP,
  UNIQUE(user_id, contact_id, consent_type)
);

-- audit_logs テーブル
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  payload_hash TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- インデックス（10k耐性）
CREATE INDEX idx_relationships_user_id ON relationships(user_id);
CREATE INDEX idx_relationships_contact_id ON relationships(contact_id);
CREATE INDEX idx_relationships_type ON relationships(user_id, relationship_type);
CREATE INDEX idx_consents_user_contact ON consents(user_id, contact_id);
CREATE INDEX idx_consents_active ON consents(user_id, contact_id, consent_type) WHERE revoked_at IS NULL;
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);
```

**API追加：**
- `POST /api/contacts/:id/relationship` - 距離感変更リクエスト
- `POST /api/contacts/:id/consent` - 同意の付与/撤回
- `GET /api/contacts/:id/relationship` - 現在の距離感と同意状態
- `GET /api/audit-logs` - 監査ログ一覧（superadmin用）

**UI追加：**
- Contact詳細画面に距離感変更ボタン
- 同意確認ダイアログ（距離感ごとの説明文）
- 監査ログ表示（superadmin用）

**DoD（Day1）：**
- [ ] DB migration 実行完了
- [ ] API実装完了（単体テスト付き）
- [ ] UI実装完了（距離感変更フロー）
- [ ] 同意ダイアログのUX確認（説明文が明確）
- [ ] 監査ログが who/when/what/target を必ず記録
- [ ] 実機テスト PASS（external→work→team→family）

---

#### Next-8 Day2：Contacts（台帳）強化 + 送信チャネル抽象化

**ゴール：** 「メールだけ」から脱却できる"送信先の抽象化"を台帳側に入れる（送信自体はしない）

**DB修正：**
```sql
-- contacts に channel情報追加
ALTER TABLE contacts ADD COLUMN channel_email TEXT;
ALTER TABLE contacts ADD COLUMN channel_slack TEXT;
ALTER TABLE contacts ADD COLUMN channel_chatwork TEXT;
ALTER TABLE contacts ADD COLUMN channel_preference TEXT DEFAULT 'email'; -- email/slack/chatwork

-- schedule_participants の正規化（重要：負債解消）
CREATE TABLE schedule_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES schedules(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  role TEXT NOT NULL, -- organizer/required/optional/keyman
  relationship TEXT NOT NULL, -- external/work/team/family
  channel_preference TEXT NOT NULL DEFAULT 'email',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(schedule_id, contact_id)
);

-- インデックス（10k耐性）
CREATE INDEX idx_schedule_participants_schedule ON schedule_participants(schedule_id);
CREATE INDEX idx_schedule_participants_contact ON schedule_participants(contact_id);
CREATE INDEX idx_schedule_participants_role ON schedule_participants(schedule_id, role);
CREATE INDEX idx_contacts_user_email ON contacts(user_id, channel_email);
CREATE INDEX idx_contacts_user_slack ON contacts(user_id, channel_slack) WHERE channel_slack IS NOT NULL;
```

**機能追加：**
- 名刺/メール登録 → contact化
- 通知先チャネルの選択（email/slack/chatwork）
- 次回以降の候補リストに自動表示
- 送信用セット生成でチャネル別テンプレも返す

**API追加：**
- `POST /api/contacts/import` - 名刺/メール一括登録
- `PUT /api/contacts/:id/channels` - チャネル設定更新
- `GET /api/contacts/suggestions` - 候補リスト取得（thread作成時）
- `POST /api/schedule-participants/migrate` - 既存データ移行（管理用）

**UI追加：**
- Contact import画面（CSV/名刺/メール）
- チャネル選択UI（Contact詳細）
- Thread作成時の候補リスト（Contact台帳から）

**DoD（Day2）：**
- [ ] DB migration 実行完了
- [ ] schedule_participants への移行スクリプト完成
- [ ] 移行テスト PASS（既存Scheduleの参加者が正しく移行）
- [ ] Contact import機能完成
- [ ] チャネル選択UI完成
- [ ] 候補リスト表示完成
- [ ] 送信用セットでチャネル別テンプレ生成確認
- [ ] 実機テスト PASS

---

#### Next-8 Day3：1対N成立条件（最小）

**ゴール：** 成立条件がScheduleの正になる（投票→成立→確定が破綻しない）

**DB追加：**
```sql
-- schedule_conditions テーブル
CREATE TABLE schedule_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) UNIQUE,
  condition_type TEXT NOT NULL, -- all_required/min_attendees/keyman_required
  min_attendees INT,
  keyman_contact_id UUID REFERENCES contacts(id),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- インデックス
CREATE INDEX idx_schedule_conditions_schedule ON schedule_conditions(schedule_id);
CREATE INDEX idx_schedule_conditions_type ON schedule_conditions(condition_type);
```

**機能追加：**
- 成立条件の設定（Thread作成時）
- 成立条件の評価（投票後）
- 成立/未成立の通知（バナー表示）

**評価ロジック：**
```typescript
// 成立条件評価の例
function evaluateCondition(
  condition: ScheduleCondition,
  participants: Participant[],
  votes: Vote[]
): EvaluationResult {
  switch (condition.condition_type) {
    case 'all_required':
      // 全参加者が投票済みかチェック
      return participants.every(p => votes.some(v => v.participant_id === p.id));
    
    case 'min_attendees':
      // 最低N人が投票済みかチェック
      return votes.length >= condition.min_attendees;
    
    case 'keyman_required':
      // キーマンが投票済みかチェック
      return votes.some(v => v.participant_id === condition.keyman_contact_id);
    
    default:
      return false;
  }
}
```

**API追加：**
- `POST /api/threads/:id/conditions` - 成立条件設定
- `GET /api/threads/:id/evaluation` - 成立条件評価結果
- `GET /api/threads/:id/status` - 拡張（成立条件情報を含む）

**UI追加：**
- Thread作成画面に成立条件設定（3種類から選択）
- Card画面に成立条件表示
  - 「全員必須」「3人以上で成立」「〇〇さん必須」
- 成立/未成立の状態バナー（チャット上部）
- 成立条件の進捗表示（例：「3/5人が回答済み」）

**DoD（Day3）：**
- [ ] DB migration 実行完了
- [ ] 成立条件設定API完成
- [ ] 評価ロジック実装完成（3種類すべて）
- [ ] UI実装完成（設定＋表示＋バナー）
- [ ] 実機テスト PASS（3種類すべて）
  - [ ] all_required テスト
  - [ ] min_attendees テスト
  - [ ] keyman_required テスト
- [ ] 成立/未成立の通知が正しく表示される

---

### Phase Next-9：AIが事情を把握する土台（RAG最小）

#### Next-9 Day1：User Rules / Conversation Summaries（要約→ルール化）

**ゴール：** 「固定セリフ」から脱却する基盤（データ肥大化しない形）

**DB追加：**
```sql
-- user_rules テーブル
CREATE TABLE user_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  rule_type TEXT NOT NULL, -- time_preference/location/other
  rule_content JSONB NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- conversation_summaries テーブル
CREATE TABLE conversation_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  thread_id UUID NOT NULL REFERENCES threads(id),
  summary_text TEXT NOT NULL,
  extracted_rules JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- インデックス（10k耐性）
CREATE INDEX idx_user_rules_user ON user_rules(user_id, active);
CREATE INDEX idx_user_rules_type ON user_rules(user_id, rule_type, active);
CREATE INDEX idx_conversation_summaries_user ON conversation_summaries(user_id, thread_id);
CREATE INDEX idx_conversation_summaries_created ON conversation_summaries(user_id, created_at DESC);
```

**ルールの構造例：**
```json
{
  "rule_type": "time_preference",
  "rule_content": {
    "preferred_time": "afternoon",
    "avoid_time": "morning",
    "preferred_days": ["mon", "wed", "fri"],
    "avoid_days": ["sat", "sun"]
  },
  "priority": 10
}
```

**機能追加：**
- ルールの構造化保存（例：「来週午後ならOK、午前NG」）
- 会話ログを要約してルール抽出（データ肥大化防止）
- ルールに基づく候補提案

**重要原則：**
- ルールは "推測"ではなく "ユーザーが明示" or "会話で合意"のみ
- 自動でルールを作らない（必ず確認）

**API追加：**
- `POST /api/users/rules` - ルール登録
- `GET /api/users/rules` - ルール一覧
- `PUT /api/users/rules/:id` - ルール更新
- `DELETE /api/users/rules/:id` - ルール削除
- `POST /api/threads/:id/extract-rules` - 会話からルール抽出（要確認）
- `POST /api/threads/:id/summarize` - 会話要約

**UI追加：**
- ルール管理画面（設定画面）
- ルール抽出の確認ダイアログ
- 候補提案時にルール適用の説明表示

**DoD（Day1）：**
- [ ] DB migration 実行完了
- [ ] ルール登録API完成
- [ ] 会話要約ロジック実装（LLM使用）
- [ ] ルール抽出ロジック実装（確認付き）
- [ ] UI実装完成（ルール管理画面）
- [ ] ルールに基づく候補提案が動作する
- [ ] 実機テスト PASS

---

#### Next-9 Day2：Intent理解の高度化（安全優先）

**ゴール：** 会話理解は上げるが、実行ガード（confirm only）を崩さない

**機能追加：**
- ルールベース + 少量LLM補助（BYO API）
- 会話文脈を考慮した意図理解
- User Rulesを参照して提案精度向上
- 「勝手に実行しない」原則の維持

**実装方針：**
- 現在の `intentClassifier.ts` を拡張
- User Rulesを参照して提案の精度向上
- 確認フローは必ず挟む
- BYO API前提（運営コスト固定化しない）

**拡張例：**
```typescript
// User Rules参照の例
async function classifyIntentWithRules(
  message: string,
  userId: string,
  context: Context
): Promise<IntentResult> {
  // User Rulesを取得
  const rules = await getUserRules(userId);
  
  // ルールを考慮した意図分類
  const intent = await classifyIntent(message, rules, context);
  
  // 確認フローは必ず挟む
  if (intent.requiresExecution) {
    return {
      ...intent,
      needsConfirmation: true
    };
  }
  
  return intent;
}
```

**DoD（Day2）：**
- [ ] Intent分類精度向上（テストケース追加）
- [ ] User Rules参照ロジック実装
- [ ] 確認フロー維持確認（勝手に実行しない）
- [ ] BYO API設定確認
- [ ] 実機テスト PASS
- [ ] 精度測定（テストケースでの正解率）

---

## 4. Next-7（審査完了後に実装する：Day1）

### 固定方針（負債ゼロ）

1. **確定後のみ同期**（pendingは絶対同期しない）
2. **冪等キー**：`thread_id + schedule_id`（or `final_slot_id`）
3. **失敗時は 手動フォールバック**（登録セット/ICS/テンプレ）
4. **"差分更新しない"**（create-only）でまず出す

### DB追加

```sql
-- calendar_syncs テーブル
CREATE TABLE calendar_syncs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES threads(id),
  schedule_id UUID NOT NULL REFERENCES schedules(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL, -- manual/google
  status TEXT NOT NULL, -- blocked/created/already_synced/failed
  provider_event_id TEXT,
  manual_payload_json JSONB,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(thread_id, schedule_id)
);

-- インデックス
CREATE INDEX idx_calendar_syncs_thread ON calendar_syncs(thread_id);
CREATE INDEX idx_calendar_syncs_status ON calendar_syncs(status, updated_at);
CREATE INDEX idx_calendar_syncs_idempotency ON calendar_syncs(idempotency_key);
```

### 機能フラグ

```typescript
// 環境変数で制御
FEATURE_CALENDAR_SYNC_ENABLED=false // 審査待ちはfalse

// 審査完了後に true に変更
```

### API追加

- `POST /api/threads/:id/calendar/sync` - カレンダー同期実行
- `GET /api/threads/:id/calendar/sync-status` - 同期状態確認

### DoD（Day1）

- [ ] OAuth審査完了確認
- [ ] DB migration 実行完了
- [ ] CalendarSyncProvider実装（Google）
- [ ] 冪等性テスト PASS（同じリクエストで重複作成されない）
- [ ] 失敗時フォールバックテスト PASS（手動セット返す）
- [ ] 実機テスト PASS（確定後のみ同期）

---

## 5. 10,000人耐性（最初から固定）

### A. データ肥大化対策

#### messages（チャット）
- 保存するのは全量ではなく、一定期間＋要約に寄せる
- UI表示は最新N件、残りはアーカイブ
- TTL設定（例：90日後にアーカイブ）

#### schedules / votes / notifications
- 監査のため保持（削除しない）
- ページング前提の設計
- インデックス最適化

### B. DB設計原則

#### 必須インデックス（すべて作成済みか要確認）

```sql
-- threads
CREATE INDEX idx_threads_user_status ON threads(user_id, status, created_at DESC);

-- schedules
CREATE INDEX idx_schedules_thread_status ON schedules(thread_id, status, created_at DESC);

-- selections
CREATE INDEX idx_selections_schedule_slot ON selections(schedule_id, selected_slot_id);
CREATE INDEX idx_selections_invitee ON selections(schedule_id, invitee_key);

-- contacts
CREATE INDEX idx_contacts_user_email ON contacts(user_id, email);

-- relationships
CREATE INDEX idx_relationships_user_type ON relationships(user_id, relationship_type);

-- notifications
CREATE INDEX idx_notifications_user_thread ON notifications(user_id, thread_id, created_at DESC);
```

#### ページング方式

- **offsetではなくcursor方式**（将来の性能維持）

```typescript
// 良い例（cursor pagination）
GET /api/threads?cursor=abc123&limit=20

// 悪い例（offset pagination）
GET /api/threads?offset=1000&limit=20  // 遅くなる
```

### C. API設計原則

#### 読み取り
- いつでもOK（status/check）
- **ページング必須**（limit/cursor）

#### 書き込み
- **confirm intent のみ**
- **idempotency key を全実行APIに**

```typescript
// 実行APIの例
POST /api/threads/:id/confirm
{
  "intent": "schedule.auto_propose.confirm",
  "idempotency_key": "thread_abc123_propose_001"
}
```

### D. UI設計原則（スマホ前提）

#### 通知/提案
- **スマホで必ず見える位置に出す**
- カードタブだけに依存しない
- **チャット上部に「状態バナー」/ "次にやること" を1行で表示**

#### 状態表示
- 現在の状態が常に見える
- 次のアクションが明確

```typescript
// 状態バナーの例
<StatusBanner>
  <Icon>⚠️</Icon>
  <Text>票が割れています。追加候補を出しますか？</Text>
  <Button>はい</Button>
  <Button>いいえ</Button>
</StatusBanner>
```

---

## 6. タイムライン（目安）

### Week 1-2: Phase Next-8
- **Day1**: Relationship & Consent（3-5日）
- **Day2**: Contacts強化（3-5日）
- **Day3**: 1対N成立条件（3-5日）

### Week 3-4: Phase Next-9
- **Day1**: User Memory（RAG）（5-7日）
- **Day2**: Intent理解高度化（3-5日）

### Week 5: 統合テスト
- 全機能の統合テスト
- パフォーマンステスト（負荷テスト）
- UI/UXテスト（スマホ中心）

### 審査完了後: Phase Next-7 Day1
- Calendar Sync実装（5-7日）
- OAuth連携テスト
- 本番リリース

---

## 6.5. P0非機能要件（DOM事故・埋め込み・CI）

### 目的
**DOM構造事故・外部サービス埋め込み事故・ビルド事故を「起こせなくする」** ための仕組み化。

後から直すのではなく、**最初から事故を防ぐガードレール**を入れる。

---

### Epic 6.5-1: UI DOM Rules（固定ルール）

**優先度**: P0（最優先）  
**工数**: 0.5日（ドキュメント確認 + ルール適用）

#### タスク
- [ ] `UI_DOM_RULES.md` を全員で確認
- [ ] 固定ルール6項目の適用
  1. タブの責務は「表示切替のみ」
  2. レイアウトの境界を固定（3カラムDOM）
  3. `dangerouslySetInnerHTML` は原則禁止
  4. 外部スクリプトは iframe で隔離
  5. カードの表示条件を固定
  6. Fragment多用の禁止（最大3階層）

#### DoD
- [ ] UI_DOM_RULES.md を全員が読了
- [ ] レビュー観点をPRテンプレートに追加
- [ ] 既存コードで違反箇所がないか確認

---

### Epic 6.5-2: Embed Integration Policy（外部サービス埋め込み隔離）

**優先度**: P0（最優先）  
**工数**: 1-2日（MyASP埋め込み実装時）

#### タスク
- [ ] `EMBED_INTEGRATION_POLICY.md` を確認
- [ ] MyASP埋め込み方式を決定
  - **推奨**: iframe方式（DOM事故ゼロ）
  - **次点**: JSタグ注入（専用コンポーネントで隔離）
- [ ] `/billing/subscribe` 実装（iframe or JSタグ）
- [ ] `/billing/return` 実装（受け皿のみ）
- [ ] サンクスURL設定（MyASP側のみ）

#### DoD
- [ ] 決済完了後に `/billing/return` にリダイレクト
- [ ] `/billing/return` で plan/status が反映される（30秒以内）
- [ ] CSS衝突がない（アプリのスタイルが崩れない）
- [ ] スマホ表示確認（iPhone / Android）

---

### Epic 6.5-3: CI（lint/build自動チェック）

**優先度**: P0（最優先）  
**工数**: 0.5日（GitHub Actions設定）

#### タスク
- [ ] GitHub Actions設定（`.github/workflows/ci.yml`）
- [ ] 必須チェック3項目
  1. TypeScript型チェック（`tsc -b`）
  2. ESLint（`eslint src/`）
  3. Vite Build（`vite build`）
- [ ] PR作成時に自動実行
- [ ] main merge時に自動実行

#### DoD
- [ ] PR作成時にCIが自動実行される
- [ ] 型エラー・lint警告・ビルドエラーで CI失敗
- [ ] CI失敗時はmerge不可

---

### 重要：本体未完成でも負債にならない設計

**今回のスコープ（P0非機能要件）**:
- ✅ DOM事故を「起こせなくする」ルール化
- ✅ 外部サービス埋め込みの隔離方針
- ✅ CI自動チェック（lint/build）

**将来の拡張（Phase Next-12以降）**:
- Bundle Size チェック
- 未使用コンポーネント検出
- E2Eテスト自動化

---

## 7. リスクと対策

### リスク1: OAuth審査が長引く
**対策：** Phase Next-8/9 で十分な価値提供が可能。同期は手動フォールバック維持。

### リスク2: DB移行の失敗
**対策：** 移行スクリプトの段階的実施、ロールバック手順の事前準備。

### リスク3: パフォーマンス劣化
**対策：** インデックス最適化、クエリチューニング、キャッシュ導入。

### リスク4: スマホUI不具合
**対策：** スマホ実機テスト必須、ErrorBoundary完備、localStorage容量制限。

### リスク5: RAGのデータ肥大化
**対策：** 要約/アーカイブ/TTL、ページング、インデックス最適化。

---

## 8. Decision Log（決定リスト）

開発開始前に以下を会議で確定する必要がある。

### 🔴 必須決定事項（Phase Next-8 Day1開始前）

| # | 決定事項 | 現状 | 期限 | 担当 |
|---|---------|------|------|------|
| 1 | relationships/consents/audit_logs のテーブル名/key確定 | ✅ 本ドキュメントで確定 | - | - |
| 2 | schedule_participants の導入タイミング | 🟡 Day2で実施（推奨） | Day2開始前 | Backend |
| 3 | 1対N成立条件のJSON定義（3種類） | 🟡 要確定 | Day3開始前 | Backend |
| 4 | スマホ状態バナーのUI仕様（チャット上部） | 🟡 要確定 | Day1開始前 | Frontend |

### 🟡 検討事項（Phase Next-9開始前）

| # | 検討事項 | 現状 | 期限 | 担当 |
|---|---------|------|------|------|
| 5 | User RulesのJSON構造詳細 | 🟡 要確定 | Next-9 Day1開始前 | Backend |
| 6 | 会話要約のLLMモデル選定 | 🟡 要確定 | Next-9 Day1開始前 | AI |
| 7 | ルール抽出のロジック詳細 | 🟡 要確定 | Next-9 Day1開始前 | AI |
| 8 | BYO API設定の優先度 | 🟡 要確定 | Next-9 Day2開始前 | Backend |

### 🟢 将来検討事項（審査完了後）

| # | 検討事項 | 現状 | 期限 | 担当 |
|---|---------|------|------|------|
| 9 | CalendarSyncProviderの拡張（Outlook等） | 🔵 将来 | 審査完了後 | Backend |
| 10 | ネイティブアプリ化の詳細設計 | 🔵 将来 | Phase Next-10 | All |

---

## 9. DoD チェックリスト

### Phase Next-8 完了条件

- [ ] **Day1完了**: 距離感変更フローが動作する
- [ ] **Day1完了**: 同意の付与/撤回ができる
- [ ] **Day1完了**: 監査ログが正しく記録される
- [ ] **Day2完了**: Contact台帳が強化されている
- [ ] **Day2完了**: schedule_participants への移行完了
- [ ] **Day2完了**: チャネル選択UIが動作する
- [ ] **Day3完了**: 1対N成立条件が設定・評価できる
- [ ] **Day3完了**: 成立/未成立の通知が表示される

### Phase Next-9 完了条件

- [ ] **Day1完了**: User Rulesが保存・参照できる
- [ ] **Day1完了**: 会話からルール抽出ができる
- [ ] **Day1完了**: ルールに基づく候補提案が動作する
- [ ] **Day2完了**: Intent理解精度が向上している
- [ ] **Day2完了**: 確認フローが維持されている

### Phase Next-7 Day1 完了条件（審査後）

- [ ] **OAuth審査完了**: Google Calendar APIが利用可能
- [ ] **同期実装**: Google Calendar同期が動作する
- [ ] **冪等性**: 冪等性が担保されている
- [ ] **フォールバック**: 失敗時フォールバックが動作する
- [ ] **実機テスト**: 確定後のみ同期が動作する

---

## 10. 参照文書

### プロダクトビジョン
- `PRODUCT_VISION_OS.md`（v1.2-final） - 最終像と原則
- `BILLING_AND_LIMITS.md` - プラン別制限
- `RELATIONSHIP_POLICY.md` - 距離感と同意の詳細
- `INVITEE_UX_SPEC.md` - 誘われた側UX仕様
- `SUPERADMIN_SPEC.md` - 運営者向け管理仕様

### 技術仕様
- `DATABASE_SCHEMA.md` - 現在のDBスキーマ
- `API_SPECIFICATION.md` - API仕様
- `SYNC_RUNBOOK.md` - カレンダー同期設計（審査待ち）
- `SYNC_API_SPEC.md` - 同期API仕様
- `NEXT7_REVIEW_CHECKLIST.md` - Next-7 チェックリスト

### 開発状況
- `OAUTH_REVIEW_SUMMARY.md` - OAuth審査状況
- `PHASE_NEXT6_COMPLETE.md` - Next-6 完了レポート
- `CURRENT_IMPLEMENTATION_STATUS.md` - 現在の実装状況

---

## 次のアクション

### 🚀 即座に開始可能
1. **このロードマップを開発チームに共有**
2. **Decision Log（決定リスト）の必須決定事項を会議で確定**
3. **Next-8 Day1のDB migration作成開始**

### 📋 準備作業
1. **テストデータの準備**（距離感変更/同意フロー）
2. **スマホ実機テスト環境の整備**
3. **監査ログの可視化ツール準備**（superadmin用）

### 🔍 継続確認
1. **OAuth審査の進捗確認**（週次）
2. **パフォーマンスモニタリング**（DB/API）
3. **スマホUXフィードバック収集**

---

**このロードマップは「唯一の正解」として扱う。変更する場合は必ず影響範囲を列挙し、Decision Logに記録すること。**

---

END OF DOCUMENT
