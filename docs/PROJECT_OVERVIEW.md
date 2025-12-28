# ToMoniWao - プロジェクト全体像

**最終更新**: 2025-12-28  
**バージョン**: MVP Phase 0B

---

## 🎯 プロジェクトビジョン

### コンセプト
**「音声指示だけで予定調整が完了する AI秘書」**

ユーザーは音声で「来週、田中さんとミーティング設定して」と指示するだけで、AIが：
1. 候補日時を生成
2. 相手に招待リンクを送信
3. 相手が希望日時を選択
4. 自動でGoogle Meetリンクを生成
5. カレンダーに予定を追加

### ターゲットユーザー
- **連続起業家・経営者**: 多忙で予定調整の時間を削減したい
- **営業・コンサルタント**: 複数の顧客と頻繁にミーティング調整
- **イベント主催者**: 参加者との日程調整を効率化

### 差別化ポイント
1. **音声ファースト**: チャット不要、音声だけで完結
2. **関係性管理**: 名刺→連絡先→リスト→一括招待の流れ
3. **PWA**: インストール不要、どのデバイスでもすぐ使える
4. **将来のネイティブ化**: Core Layer分離でiOS/Android展開容易

---

## 📐 開発フェーズ

### Phase 0: MVP（現在）
**目標**: 基本的な予定調整が動く状態

#### Phase 0A（完了）
- ✅ D1データベース構築
- ✅ Google OAuth認証
- ✅ 基本的なAPI実装（Users, Sessions）
- ✅ Admin Dashboard（システム設定、AI設定）

#### Phase 0B（現在）
- ✅ Threads（スケジュール調整セッション）
- ✅ Invites（外部招待リンク `/i/:token`）
- ✅ Contacts（連絡先管理）
- ✅ Lists（リスト・セグメント管理）
- ✅ Business Cards（名刺管理）
- ✅ Google Meet生成（Calendar API連携）
- ✅ Frontend（React SPA）デプロイ
- ⏳ 同一オリジン設定（Cloudflare）
- ⏳ 本番E2Eテスト

### Phase 1: PWA完全版（次フェーズ）
**目標**: 音声入力、UI/UX完成、実運用開始

- 音声入力機能（Web Speech API）
- Inbox（受信トレイ）実装
- Rooms（チャットルーム）実装
- プッシュ通知
- オフライン対応（Service Worker）
- リマインダー機能
- UI/UXブラッシュアップ
- ユーザーテスト・改善サイクル

### Phase 2: AI機能強化
**目標**: AI秘書としての自動化レベル向上

- 音声コマンド理解（Gemini/GPT）
- 日程候補の自動生成（カレンダー空き時間ベース）
- 相手の都合学習（過去データから傾向把握）
- 自動要約・議事録生成
- 名刺OCR・自動情報抽出

### Phase 3: ネイティブアプリ展開
**目標**: iOS/Android展開

- Capacitor or React Native
- Core Layer再利用
- ネイティブ機能（カメラ、GPS、通知）
- App Store / Google Play公開

---

## 🏗️ システム構成

### Monorepo構造
```
tomoniwaproject/
├── apps/
│   └── api/                 # Backend API (Workers)
├── frontend/                # Frontend SPA (React)
├── packages/
│   └── shared/             # Shared types and utilities
├── db/
│   └── migrations/         # D1 migrations
├── docs/                    # Documentation (this file)
└── wrangler.jsonc          # Cloudflare config
```

### デプロイ構成
```
app.tomoniwao.jp/
├── /*                 → Cloudflare Pages (React SPA)
├── /api/*             → Cloudflare Workers (Backend API)
├── /auth/*            → Cloudflare Workers (OAuth)
└── /i/:token          → Cloudflare Workers (External invite page)
```

---

## 🎨 ユーザーフロー

### 1. 初回登録
1. `https://app.tomoniwao.jp` にアクセス
2. 「Googleでログイン」
3. Google OAuth → カレンダー権限許可
4. Dashboard表示

### 2. 1対1予定調整（基本フロー）
1. Dashboard → 「新規スレッド作成」
2. タイトル・説明入力
3. 「連絡先から選択」または「メールアドレス入力」
4. 候補日時を追加
5. 「招待送信」
6. 相手に招待リンクがメール送信
7. 相手が `/i/:token` で候補から選択
8. 自動でGoogle Meet生成
9. カレンダーに予定追加

### 3. 一括招待（リスト活用）
1. Contacts → 名刺を複数登録
2. Lists → 「セミナー参加者」リスト作成
3. リストにメンバー追加
4. Lists → 「一括招待」
5. 新規Thread作成 → 全員に招待送信

---

## 🔐 セキュリティ・プライバシー

### 認証
- **Google OAuth 2.0**: openid, email, profile, calendar.events
- **Session管理**: D1 + Cookie（HttpOnly, Secure, SameSite=Lax）
- **Bearer Token**: Mobile/PWA用（sessionStorage）

### データ保護
- **暗号化**: Google refresh_tokenを暗号化して保存
- **アクセス制御**: ユーザーは自分のデータのみアクセス可能
- **GDPR対応**: ユーザーデータ削除機能（今後実装）

### Rate Limiting
- **Cloudflare KV**: IP/Userベースのレート制限
- **API保護**: 悪用防止

---

## 💰 コスト構造（無料枠）

### Cloudflare無料枠
- **Workers**: 100,000 req/day（十分）
- **Pages**: 無制限デプロイ
- **D1**: 5GB storage, 5M rows read/day
- **KV**: 100,000 reads/day
- **R2**: 10GB storage（音声録音用）
- **Queue**: 10,000 messages/day

### 外部サービス
- **Google Cloud**: OAuth + Calendar API（無料枠内）
- **SendGrid**: メール送信（無料枠: 100通/日）

→ **月間数千ユーザーまで無料で運用可能**

---

## 📊 成功指標（KPI）

### Phase 0B（MVP）
- [ ] 本番デプロイ完了
- [ ] 外部ユーザー10名でテスト
- [ ] 1対1予定調整が成功率95%以上

### Phase 1（PWA完全版）
- [ ] DAU: 50人
- [ ] スレッド作成数: 200/月
- [ ] 予定確定率: 80%以上
- [ ] ユーザー満足度: 4.0/5.0以上

### Phase 2（AI強化）
- [ ] 音声入力成功率: 90%以上
- [ ] 候補日時自動生成精度: 85%以上
- [ ] 名刺OCR精度: 95%以上

---

## 🚫 現時点で除外する機能

### 除外理由: MVP範囲外
- N対N調整（複数人の日程調整）
- Deep機能（Quest/Squad/Partner/Family）
- 高度なAI機能（要約、推薦）
- カスタムブランディング
- Webhook連携
- 多言語対応（日本語のみ）

### 将来検討
- Slack/Teams連携
- Zoom/Meet以外のビデオ会議ツール
- カレンダー同期（Google以外）
- 有料プラン

---

## 📞 サポート・問い合わせ

- **開発者**: モギモギ（関屋紘之）
- **GitHub**: https://github.com/matiuskuma2/tomoniwaproject
- **X**: @aitanoshimu

---

## 📜 ライセンス

Private（現時点では非公開）

---

**次のドキュメント**: [ARCHITECTURE.md](./ARCHITECTURE.md)
