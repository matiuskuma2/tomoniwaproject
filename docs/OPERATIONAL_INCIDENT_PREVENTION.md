# Operational Incident Prevention Checklist（運用事故防止）

**Version**: 1.0  
**Created**: 2026-01-01  
**Owner**: Operations Team  
**Phase**: Next-11 (MyASP課金連携)

---

## 📋 対象

- MyASP課金連携
- billing_events / billing_accounts
- 実行Gate（confirm制御）

---

## 🔍 毎日見るチェック（5分）

### 1. 課金同期が止まっていないか
```sql
-- 当日のイベントがあるか確認
SELECT COUNT(*) FROM billing_events 
WHERE received_at >= date('now');

-- 最終同期時刻を確認（異常に古くないか）
SELECT MAX(received_at) as last_sync 
FROM billing_events;
```

**正常な状態**:
- 当日のイベントが1件以上ある
- last_sync が直近24時間以内

**異常な状態**:
- 当日のイベントが0件（MyASP設定確認）
- last_sync が24時間以上前（POST来ていない）

---

### 2. 異常なステータスが出ていないか
```sql
-- status別の集計
SELECT status, COUNT(*) as count 
FROM billing_accounts 
GROUP BY status;

-- 最近停止したユーザー（過去24時間）
SELECT myasp_user_id, email, status, updated_at 
FROM billing_accounts 
WHERE status IN (2, 4) 
  AND updated_at >= datetime('now', '-1 day')
ORDER BY updated_at DESC;
```

**正常な状態**:
- status=1（登録）が大多数
- status=2/4（停止/解約）は少数かつ予想範囲内

**異常な状態**:
- status=2/4 が急増（MyASP側の設定ミスや障害の可能性）
- 全ユーザーがstatus=2/4（緊急対応必要）

---

### 3. confirm が正しく止まっているか

**テストシナリオ**:
```bash
# 1. status=1（登録）のユーザーで confirm → 200 OK
curl -X POST http://localhost:3000/api/schedules/123/confirm \
  -H "Authorization: Bearer <token_status_1>"

# 2. status=2（停止）のユーザーで confirm → 403 Forbidden
curl -X POST http://localhost:3000/api/schedules/123/confirm \
  -H "Authorization: Bearer <token_status_2>"

# 3. status=2（停止）のユーザーで propose → 200 OK（重要）
curl -X POST http://localhost:3000/api/schedules/123/propose \
  -H "Authorization: Bearer <token_status_2>"
```

**正常な状態**:
- status=1/3 → confirm実行可能
- status=2/4 → confirm実行不可（403）
- status=2/4 → propose実行可能（200）

**異常な状態**:
- status=2/4 でも confirm が通る（Gate故障）
- status=2/4 で propose が止まる（Gateの入れ場所ミス）

---

## 🚨 障害時の初動対応（Runbook）

### シナリオ1: 課金が反映されない

**症状**:
- ユーザーが「MyASPで決済したのにプランが変わらない」と報告

**対応手順**:
1. **MyASP管理画面で確認**
   - 該当ユーザーの status を確認
   - MyASP側で正しく登録されているか

2. **billing_events を確認**
   ```sql
   SELECT * FROM billing_events 
   WHERE myasp_user_id = 'user123' 
   ORDER BY received_at DESC 
   LIMIT 10;
   ```
   - POST が来ているか確認
   - dedupe_key / ts / status を確認

3. **原因切り分け**
   - **POST が来ていない**
     → MyASP設定確認（外部システム連動登録のURL/data）
     → token確認（正しいtokenか）
   - **POST は来ている**
     → token認証確認（401エラー）
     → バリデーション確認（400エラー）
     → billing_accounts にUPSERTされているか確認

4. **応急処置（最終手段）**
   ```sql
   -- billing_accountsを手動で更新（やむを得ない場合のみ）
   INSERT OR REPLACE INTO billing_accounts (
     myasp_user_id, email, plan, amount, status, last_event_ts
   ) VALUES (
     'user123', 'test@example.com', 2, 2980, 1, datetime('now')
   );
   ```
   - **注意**: 手動更新は監査ログに残らないため、必ず billing_events に手動で記録

---

### シナリオ2: 全ユーザーが止まった

**症状**:
- 全ユーザーが「confirm実行できない（403エラー）」と報告
- スケジュール確定ができない

**対応手順**:
1. **billing_accounts.status を確認**
   ```sql
   SELECT status, COUNT(*) as count 
   FROM billing_accounts 
   GROUP BY status;
   ```
   - 全ユーザーが status=2/4 になっていないか確認

2. **最近のイベントを確認**
   ```sql
   SELECT * FROM billing_events 
   WHERE received_at >= datetime('now', '-1 hour')
   ORDER BY received_at DESC;
   ```
   - 誤POSTがあるか確認（MyASP側の設定ミスや障害）

3. **原因切り分け**
   - **MyASP側の設定ミス**
     → MyASP管理画面で外部システム連動登録を確認
     → 誤って全ユーザーにstatus=2（停止）をPOSTしていないか
   - **MyASP側の障害**
     → MyASP運営に問い合わせ

4. **応急処置**
   - **MyASP側で修正**
     → 全ユーザーに status=3（復活）をPOST送信
   - **tomonowa側での一時的な対応（緊急時のみ）**
     → Gateを一時的に無効化（コメントアウト）
     → 修正後に必ずGateを復元

---

### シナリオ3: 同じ課金イベントが何度も反映される

**症状**:
- ユーザーが「プランが何度も変わる」と報告
- billing_events に同じdedupe_keyが複数回入っている（はずがない）

**対応手順**:
1. **dedupe_key を確認**
   ```sql
   SELECT dedupe_key, COUNT(*) as count 
   FROM billing_events 
   GROUP BY dedupe_key 
   HAVING count > 1;
   ```
   - 同じdedupe_keyが複数回入っていないか確認

2. **原因切り分け**
   - **UNIQUE制約が壊れている**
     → データベースの整合性チェック
     → マイグレーション失敗の可能性
   - **dedupe_key生成ロジックが壊れている**
     → POST API の dedupe_key 生成部分を確認

3. **応急処置**
   - **UNIQUE制約を再作成**
     ```sql
     DROP INDEX IF EXISTS ux_billing_events_dedupe_key;
     CREATE UNIQUE INDEX ux_billing_events_dedupe_key 
       ON billing_events(dedupe_key);
     ```

---

## ❌ 絶対にやってはいけないこと

### 1. billing_accounts を直接 UPDATE
**理由**: 
- billing_accounts は billing_events からのUPSERTのみで更新されるべき
- 直接UPDATEすると監査ログとの整合性が失われる

**正しい方法**:
- MyASP側から正しいPOSTを送信する
- やむを得ない場合は billing_events に手動で記録してからUPSERT

---

### 2. billing_events を削除
**理由**:
- billing_events は監査ログ（永久保存）
- 削除すると過去の課金履歴が失われる

**正しい方法**:
- 削除しない
- 古いイベントは参照しないが、保存は続ける
- 将来的にアーカイブ（別テーブルに移動）を検討

---

### 3. Gate を confirm 以外に入れる
**理由**:
- 提案（propose）や投票（vote）は止めない（安全原則）
- confirm実行点のみ止める

**正しい方法**:
- canExecute(userId, action) で action='confirm' のみチェック
- propose / vote は Gate を通さない

---

## 📊 監視すべきメトリクス

### 1. 課金同期の健全性
- **最終同期時刻**: last_sync（24時間以内が正常）
- **当日イベント数**: events_today（1件以上が正常）
- **エラー率**: error_count / total_count（5%以下が正常）

### 2. ユーザーステータス分布
- **status=1（登録）**: 大多数（80%以上）
- **status=2（停止）**: 少数（10%以下）
- **status=3（復活）**: 少数（5%以下）
- **status=4（解約）**: 少数（5%以下）

### 3. Gate動作確認
- **confirm実行数**: confirm_total
- **confirm拒否数**: confirm_rejected（status=2/4）
- **propose実行数**: propose_total（stop時も継続）

---

## 🔄 定期メンテナンス（月次）

### 1. billing_events の肥大化チェック
```sql
-- テーブルサイズ確認（D1の場合）
SELECT COUNT(*) as total_events FROM billing_events;
```
- **目安**: 月間イベント数 × ユーザー数 × 1.5
- **対策**: 古いイベントをアーカイブ（将来実装）

### 2. billing_accounts の整合性チェック
```sql
-- billing_accounts と billing_events の整合性
SELECT a.myasp_user_id, a.status as account_status, e.status as event_status
FROM billing_accounts a
LEFT JOIN billing_events e ON a.last_event_id = e.id
WHERE a.status != e.status;
```
- **期待結果**: 0件（整合性が保たれている）
- **異常**: 1件以上（UPSERTロジック確認）

### 3. Gate動作確認（E2Eテスト）
```bash
# 月次で実施（本番環境で確認）
npm run test:billing:e2e
```

---

## 📚 関連ドキュメント

| ドキュメント | 内容 |
|------------|------|
| [MYASP_INTEGRATION_SPEC.md](./MYASP_INTEGRATION_SPEC.md) | 実装仕様書 |
| [MYASP_ADMIN_SETUP.md](./MYASP_ADMIN_SETUP.md) | 設定手順書 |
| [JIRA_WEEK1_TICKETS.md](./JIRA_WEEK1_TICKETS.md) | Jira起票用チケット |
| [SPRINT_WEEK1_MYASP_INTEGRATION.md](./SPRINT_WEEK1_MYASP_INTEGRATION.md) | 今週のスプリント計画 |

---

## 🎯 結論

このチェックリストを **毎日見る** ことで、以下が達成されます：
1. ✅ 技術負債ゼロ
2. ✅ 運用負債ゼロ
3. ✅ インシデントが起きにくい
4. ✅ 起きても初動対応が明確

**運用チームへの引き継ぎ時にもこのドキュメントを渡すだけでOK** 🎉
