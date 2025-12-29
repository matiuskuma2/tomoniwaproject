# PHASE0B_VS_DOCS_GAP_REPORT.md
## ToMoniWao – 現状実装 × ドキュメント突合レポート

最終更新日: 2025-12-29  
目的: 現状の実装とドキュメントの間にあるギャップを可視化し、手戻りを防ぐ

---

## 📋 Gap Report 要約

| カテゴリ | 総数 | 今直す | 後で回収 | 運用対応 | 問題なし |
|---------|-----|--------|---------|---------|---------|
| 調整ロジック | 6 | 0 | 3 | 3 | 0 |
| 通知チャネル | 4 | 0 | 4 | 0 | 0 |
| 発話→API | 4 | 0 | 4 | 0 | 0 |
| APIコントラクト | 6 | 0 | 0 | 0 | 6 |
| **合計** | **20** | **0** | **11** | **3** | **6** |

---

## 🎯 結論（先に明記）

### ✅ 重要な結論
1. **現状の実装は docs の方針に違反していない**
2. **破壊的変更は一切不要**
3. **ズレは「段階導入」として説明可能**
4. **最大の Gap は「チャットUI未実装」だが、これは Phase Next-1 で対応予定**

### ⚠️ 注意すべき点
1. **docs は「最終形」を記載しており、現状は「Phase 0B (MVP)」**
2. **「暫定UI」と「最終形UX」の区別を docs 内で明記する必要あり**
3. **API コントラクト（固定キー表）を docs に追加する必要あり**

---

## 📊 Gap Report 詳細

### A. 調整ロジック（SCHEDULING_RULES.md）

| No | Rule（docsの該当箇所） | Current behavior（現状の挙動） | Risk（放置すると何が困るか） | Fix policy（今直す/後で直す/運用） | No-break constraint（不変条件に抵触しないか） | Verification（確認手順） |
|----|----------------------|------------------------------|----------------------------|--------------------------------|------------------------------------------|----------------------|
| A1 | AND/CORE/MAX の3分類 | 現状は external の「MAX型」に近い実装のみ。UI/API は汎用設計（thread_attendance_rules で将来対応可能） | docs を読むと「今すぐ全部実装済み」と誤解される | **後で回収**: Phase Next-2 で AI が AND/CORE/MAX を判定 | ✅ 不変条件に抵触しない（スキーマ拡張不要） | 1) docs に「現状は MAX のみ実装」を明記<br>2) SCHEDULING_COVERAGE_MATRIX.md 参照 |
| A2 | 最大2回ルール | 現状は「運用で2回まで」になっている（コード側に強制はない） | 無限再調整が発生する可能性（現状は低い） | **運用対応**: 現状は主催者が手動確定のため問題なし。Phase Next-2 で AI が回数制御を実装 | ✅ 不変条件に抵触しない | 1) docs に「現状は運用で2回」を明記<br>2) Phase Next-2 で実装予定 |
| A3 | 調整失敗時の扱い | 現状は主催者が手動で「確定しない」選択が可能 | AI 実装時に「失敗処理」が抜ける可能性 | **運用対応**: 現状は主催者判断で OK。Phase Next-2 で AI が失敗判定を実装 | ✅ 不変条件に抵触しない | 1) Phase Next-2 で失敗メッセージを実装 |
| A4 | 条件を UI で選択させない | 現状は UI に調整条件の選択欄なし（✅ 正しい） | なし（正しい状態） | **問題なし**: docs 通り | ✅ 不変条件に抵触しない | ✅ 確認済み: ThreadCreatePage には調整条件の UI なし |
| A5 | 日程調整は AI 内部のループ | 現状は「主催者が手動で確定」（外部リンク型） | docs は「AI が自動調整ループ」を想定 | **後で回収**: Phase Next-2 で AI 調整ループを実装 | ✅ 不変条件に抵触しない | 1) docs に「現状は手動確定」を明記<br>2) UX_CHAT_SPEC.md に段階導入を追記 |
| A6 | 調整ラウンド（最大2回）の定義 | 現状は「運用で2回」になっている。Round 1/2 の概念が明文化されていない | docs を読むと「2回とは何を指すのか」が曖昧で、実装時に解釈がブレる可能性 | **後で回収**: SCHEDULING_RULES.md に「Round 1/2 の定義」を追記済み。Phase Next-2 で AI が実装 | ✅ 不変条件に抵触しない（AI 内部のロジックとして実装） | 1) SCHEDULING_RULES.md セクション 10 を参照<br>2) Phase Next-2 で AI が調整ラウンドを制御 |

---

### B. 通知チャネル（NOTIFICATION_CHANNEL_RULES.md）

| No | Rule（docsの該当箇所） | Current behavior（現状の挙動） | Risk（放置すると何が困るか） | Fix policy（今直す/後で直す/運用） | No-break constraint（不変条件に抵触しないか） | Verification（確認手順） |
|----|----------------------|------------------------------|----------------------------|--------------------------------|------------------------------------------|----------------------|
| B1 | チャット（秘書との会話） | 現状は **チャットUI未実装**。Dashboard のカードで代替 | docs を読むと「今チャットで会話できる」と誤解される | **後で回収**: Phase Next-1 でチャット UI を実装 | ✅ 不変条件に抵触しない（API は既存のまま） | 1) docs に「現状は Dashboard で代替」を明記<br>2) Phase Next-1 で実装予定 |
| B2 | お知らせ（ベル） | 現状は inbox テーブルに通知を保存。ベルアイコンは未実装 | docs を読むと「ベルアイコンをクリックできる」と誤解される | **後で回収**: Phase Next-1 でベルアイコン UI を実装 | ✅ 不変条件に抵触しない（inbox テーブルは既存） | 1) docs に「現状は inbox テーブルのみ」を明記<br>2) Phase Next-1 で UI 実装予定 |
| B3 | メール通知（external） | 現状は正しく実装されている（thread_invites → EMAIL_QUEUE） | なし（正しい状態） | **問題なし**: docs 通り | ✅ 不変条件に抵触しない | ✅ 確認済み: threads.ts 374-393行目でメール送信 |
| B4 | 関係性遷移時の通知チャネル切替 | 現状は external のみ実装のため、関係性遷移のケースが未発生 | docs を読むと「関係性が変わったとき通知がどこに出るか」が不明瞭で、実装時に混乱する可能性 | **後で回収**: NOTIFICATION_CHANNEL_RULES.md に「関係性遷移×通知切替」を追記済み。Phase Next-2/3 で実装 | ✅ 不変条件に抵触しない（通知ロジックの追加のみ） | 1) NOTIFICATION_CHANNEL_RULES.md セクション 9 を参照<br>2) Phase Next-2 で coworker 対応<br>3) Phase Next-3 で family 対応 |

---

### C. 発話→API（UX_CHAT_TO_API_MAPPING.md）

| No | Rule（docsの該当箇所） | Current behavior（現状の挙動） | Risk（放置すると何が困るか） | Fix policy（今直す/後で直す/運用） | No-break constraint（不変条件に抵触しないか） | Verification（確認手順） |
|----|----------------------|------------------------------|----------------------------|--------------------------------|------------------------------------------|----------------------|
| C1 | 発話 → AI 判定 → API | 現状は **フォームUI**（ThreadCreatePage）で thread 作成 | docs は「自然言語発話」を想定 | **後で回収**: Phase Next-2 で発話 → intent → API 呼び出しを実装 | ✅ 不変条件に抵触しない（API は既存のまま） | 1) docs に「現状はフォーム UI」を明記<br>2) Phase Next-2 で実装予定 |
| C2 | coworker / family の扱い | 現状は external のみ実装（coworker / family は未実装） | docs を読むと「今すぐ全部できる」と誤解される | **後で回収**: Phase Next-3 で Google Calendar 読み取り + 権限管理を実装 | ✅ 不変条件に抵触しない（スキーマ拡張不要） | 1) SCHEDULING_COVERAGE_MATRIX.md に明記済み<br>2) Phase Next-3 で実装予定 |
| C3 | 再調整は同一スレッド内 | 現状は「新規 thread 作成」で代替 | docs は「同一スレッド内で再調整」を想定 | **後で回収**: Phase Next-2 で同一スレッド再調整を実装 | ✅ 不変条件に抵触しない（thread_selections に複数回の回答を保存可能） | 1) docs に「現状は新規 thread」を明記<br>2) Phase Next-2 で実装予定 |
| C4 | 募集中の予定確認（3.4） | 現状は Dashboard の thread 一覧で代替 | docs は「発話で確認」を想定 | **後で回収**: Phase Next-2 で発話対応を実装 | ✅ 不変条件に抵触しない（GET /api/threads は既存） | 1) docs に「現状は Dashboard」を明記<br>2) Phase Next-2 で実装予定 |

---

### D. API コントラクト（事故りやすいキー固定表）

**重要**: API_CONTRACT_CRITICAL.md が存在しない。このドキュメントを作成する必要がある。

| No | Rule（固定すべきキー） | Current behavior（現状の挙動） | Risk（放置すると何が困るか） | Fix policy（今直す/後で直す/運用） | No-break constraint（不変条件に抵触しないか） | Verification（確認手順） |
|----|----------------------|------------------------------|----------------------------|--------------------------------|------------------------------------------|----------------------|
| D1 | slot_id / start_at / end_at | ✅ 正しく実装されている（threads.ts 256-266行目、scheduling_slots テーブル） | なし（正しい状態） | **問題なし**: docs に明文化が必要 | ✅ 不変条件に抵触しない | ✅ 確認済み: threadsStatus.ts 94-106行目 |
| D2 | invite_url の host 固定 | ✅ 正しく実装されている（threads.ts 406-410行目、`c.req.header('host')`） | なし（正しい状態） | **問題なし**: docs に明文化が必要 | ✅ 不変条件に抵触しない | ✅ 確認済み: workers.dev 固定を回避している |
| D3 | selections[].status | ✅ 'selected' を使用（invite.ts 429-434行目） | なし（正しい状態） | **問題なし**: docs に明文化が必要 | ✅ 不変条件に抵触しない | ✅ 確認済み: ThreadDetailPage.tsx 262行目で status フィルタなし |
| D4 | finalize 後の meeting 返却 | ✅ 正しく実装されている（threadsStatus.ts 171-176行目） | なし（正しい状態） | **問題なし**: docs に明文化が必要 | ✅ 不変条件に抵触しない | ✅ 確認済み: status API が meeting を返す |
| D5 | timezone のデフォルト | ✅ 'Asia/Tokyo' をデフォルトに設定（threads.ts 265行目） | なし（正しい状態） | **問題なし**: docs に明文化が必要 | ✅ 不変条件に抵触しない | ✅ 確認済み |
| D6 | invitee_key のフォーマット | ✅ 外部は email ベース、内部は 'u:userId' 形式（threadsFinalize.ts 228-246行目） | なし（正しい状態） | **問題なし**: docs に明文化が必要 | ✅ 不変条件に抵触しない | ✅ 確認済み |

---

## 🔧 必要なアクション

### 1. ドキュメント更新（最優先）

#### 1-A. UX_CHAT_SPEC.md に追記
```markdown
## 現状（Phase 0B MVP）の位置づけ

現状は **審査用の暫定 UI** であり、最終形ではない。

- 現状: Dashboard のカード型 UI（Thread 一覧 → 詳細）
- 最終形: チャット秘書 UI（左スレッド一覧 / 右会話ログ）

**Phase Next-1 でチャット UI を実装予定**
```

#### 1-B. SCHEDULING_RULES.md に追記
```markdown
## 現状（Phase 0B MVP）の実装状況

- **実装済み**: external の MAX 型（主催者が手動確定）
- **未実装**: AND/CORE の自動判定、AI 調整ループ
- **調整回数**: 現状は運用で 2 回まで（コード制限なし）

**Phase Next-2 で AI 調整ループを実装予定**
```

#### 1-C. NOTIFICATION_CHANNEL_RULES.md に追記
```markdown
## 現状（Phase 0B MVP）の実装状況

- **実装済み**: メール通知（external）、inbox テーブル
- **未実装**: チャット UI、ベルアイコン UI

**Phase Next-1 でチャット UI とベルアイコンを実装予定**
```

#### 1-D. API_CONTRACT_CRITICAL.md を新規作成
```markdown
# API_CONTRACT_CRITICAL.md
## ToMoniWao – API コントラクト（固定キー表）

**破壊禁止**: 以下のキーは変更・削除・リネーム禁止

### 1. scheduling_slots
- slot_id (UUID)
- start_at (ISO 8601)
- end_at (ISO 8601)
- timezone (IANA形式、デフォルト: 'Asia/Tokyo')

### 2. thread_invites
- invite_url: `https://${host}/i/${token}`（workers.dev 固定禁止）

### 3. thread_selections
- status: 'selected' | 'declined'（'accepted' は invite の status）

### 4. thread_finalize（GET /api/threads/:id/status のレスポンス）
- evaluation.meeting.url（finalize 後に返す）

### 5. invitee_key
- 外部: email（例: "user@example.com"）
- 内部: "u:userId"（例: "u:123e4567-e89b-12d3-a456-426614174000"）
```

---

### 2. Phase Next-1 の準備（次のステップ）

以下を作成済み：
- `docs/PHASE_NEXT1_CHAT_UI_SPEC.md`

次のアクション：
1. チャット UI の器を実装（左スレッド一覧 / 右チャットログ）
2. 既存 Dashboard を壊さない
3. DB/API/Migration は変更しない

---

## 📝 まとめ

### ✅ 現状は健全
- 実装と docs の間に **破壊的な矛盾はない**
- ズレは「段階導入」として説明可能
- API/DB/Migration は変更不要

### ⚠️ docs の補強が必要
- 「現状（Phase 0B）」と「最終形（Phase Next）」の区別を明記
- API_CONTRACT_CRITICAL.md を新規作成
- 各 docs に「現状の実装状況」セクションを追加

### 🎯 次のステップ
1. **今すぐ**: docs を更新（上記の追記を実施）
2. **Phase Next-1**: チャット UI の器を実装
3. **Phase Next-2**: 発話 → intent → API 呼び出しを実装
4. **Phase Next-3**: Google Calendar 読み取り + 権限管理を実装

---

**重要**: このレポートは「現状確認」のためのものであり、今すぐコードを変更する必要はない。  
次の Phase Next-1 に進む前に、docs を補強することが最優先。

---
