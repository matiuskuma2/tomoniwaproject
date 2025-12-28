# ToMoniWao - 開発ロードマップ

**最終更新**: 2025-12-28  
**計画期間**: 2025年12月〜2026年Q3

---

## 🎯 ビジョン

**「音声指示だけで予定調整が完了する AI秘書」**

ユーザーは音声で「来週、田中さんとミーティング設定して」と指示するだけで、AIが自動で予定調整を完了させる。

---

## 📅 フェーズ別ロードマップ

### Phase 0B: MVP完成（現在）
**期間**: 2025年12月  
**目標**: 基本的な予定調整が動く状態

#### 完了済み ✅
- Backend API（Threads, Contacts, Lists, Business Cards）
- Frontend SPA（React）
- Google Meet生成
- 外部招待ページ（/i/:token）
- Cloudflare Workers/Pages デプロイ

#### 残作業 ⏳
- Cloudflare設定（カスタムドメイン、Workers Routes）
- 本番E2Eテスト
- バグ修正

**成功条件**:
- [ ] 本番デプロイ完了
- [ ] 外部ユーザー10名でテスト成功
- [ ] Thread作成→招待→Meet生成が一気通貫で動作

---

### Phase 1: PWA完全版
**期間**: 2026年1月〜3月（3ヶ月）  
**目標**: 実運用可能なPWA、音声入力実装

#### 主要機能
1. **音声入力** 🎤
   - Web Speech API実装
   - 「来週、田中さんとミーティング」→ Thread作成
   - 音声コマンド対応（基本的な指示のみ）

2. **Inbox（受信トレイ）** 📬
   - 招待通知一覧
   - 未対応アクション表示
   - 優先度表示

3. **Rooms（チャットルーム）** 💬
   - Thread内でのメッセージング
   - リアルタイム更新（WebSocket or Polling）

4. **プッシュ通知** 🔔
   - Web Push API実装
   - 招待受信通知
   - リマインダー通知

5. **オフライン対応** 📴
   - Service Worker実装
   - オフライン時のデータキャッシュ
   - オンライン復帰時の同期

6. **UI/UX改善** 🎨
   - アニメーション追加
   - エラーメッセージ日本語化
   - レスポンシブ対応完全化
   - ダークモード対応

#### 技術実装
- **音声**: Web Speech API
- **通知**: Web Push API + Cloudflare Queues
- **オフライン**: Service Worker + IndexedDB
- **リアルタイム**: Cloudflare Durable Objects（検討）

#### 成功条件
- [ ] DAU: 50人
- [ ] 音声入力成功率: 80%以上
- [ ] Thread作成数: 200/月
- [ ] ユーザー満足度: 4.0/5.0以上

---

### Phase 2: AI機能強化
**期間**: 2026年4月〜6月（3ヶ月）  
**目標**: AI秘書としての自動化レベル向上

#### 主要機能
1. **AI音声コマンド理解** 🤖
   - Gemini API連携
   - 自然言語理解（日程、相手、目的の抽出）
   - コンテキスト理解（「明日」「来週」の解釈）

2. **自動日程候補生成** 📅
   - Google Calendar空き時間分析
   - ユーザーの習慣学習（朝型/夜型）
   - 相手の都合学習（過去データから）

3. **名刺OCR** 📇
   - 画像→テキスト抽出（Google Vision API）
   - 自動Contact作成
   - 情報パース（名前、会社、役職、電話、メール）

4. **自動要約・議事録** 📝
   - ミーティング後の自動要約
   - 音声録音→テキスト化→要約
   - Threads Messagesとして保存

5. **スマート推薦** 💡
   - 「この人とまた会いましょう」推薦
   - 適切な日時推薦
   - 相手の都合を考慮

#### 技術実装
- **AI**: Gemini API（音声理解、要約）
- **OCR**: Google Vision API
- **分析**: BigQuery or D1集計

#### コスト管理
- AI利用量モニタリング
- 月間バジェット設定
- 無料枠超過アラート

#### 成功条件
- [ ] 音声コマンド成功率: 90%以上
- [ ] 日程候補精度: 85%以上
- [ ] 名刺OCR精度: 95%以上
- [ ] AI利用コスト: < $100/月

---

### Phase 3: ネイティブアプリ展開
**期間**: 2026年7月〜9月（3ヶ月）  
**目標**: iOS/Android展開

#### 主要機能
1. **Capacitor導入** 📱
   - React SPA → Capacitor でラップ
   - Core Layer再利用
   - ネイティブAPI活用（カメラ、GPS、通知）

2. **ネイティブ機能** 🔧
   - カメラ連携（名刺撮影）
   - GPS連携（場所情報）
   - プッシュ通知（ネイティブ）
   - バックグラウンド同期

3. **App Store/Google Play公開** 🚀
   - アプリ申請
   - レビュー対応
   - 公開

4. **React Native検討** 🤔
   - Capacitor vs React Native比較
   - パフォーマンス評価
   - 必要に応じて移行

#### 技術実装
- **Phase 3A**: Capacitor（WebView）
- **Phase 3B**: React Native（フルネイティブ、検討）

#### 成功条件
- [ ] iOS/Androidアプリ公開
- [ ] App Store評価: 4.5以上
- [ ] ダウンロード数: 1,000件/月

---

## 🔮 Phase 4以降（2026年Q4〜）

### 考えられる拡張機能
1. **チーム機能**
   - ワークスペース共有
   - チームカレンダー
   - 権限管理

2. **外部連携**
   - Slack/Teams連携
   - Zoom/Meet以外のビデオ会議
   - Salesforce/HubSpot連携

3. **高度なAI機能**
   - 議事録自動生成
   - アクションアイテム抽出
   - フォローアップ推薦

4. **エンタープライズ機能**
   - SSO（Single Sign-On）
   - カスタムブランディング
   - Webhook連携
   - API公開

5. **有料プラン**
   - Free: 10 Threads/月
   - Pro: 100 Threads/月（$10/月）
   - Team: 無制限（$50/月）

---

## 📊 マイルストーン

### 2026年1月
- [ ] Phase 1キックオフ
- [ ] 音声入力機能リリース
- [ ] Inbox/Rooms実装

### 2026年3月
- [ ] Phase 1完了
- [ ] PWA完全版リリース
- [ ] ユーザー50人達成

### 2026年6月
- [ ] Phase 2完了
- [ ] AI機能リリース
- [ ] ユーザー200人達成

### 2026年9月
- [ ] Phase 3完了
- [ ] iOS/Androidアプリ公開
- [ ] ユーザー1,000人達成

---

## 💰 予算計画

### Phase 0-1（MVP〜PWA完全版）
- **開発コスト**: ¥0（個人開発）
- **インフラコスト**: ¥0（Cloudflare無料枠）
- **外部API**: ¥0（Google無料枠）
- **合計**: ¥0

### Phase 2（AI機能強化）
- **開発コスト**: ¥0（個人開発）
- **インフラコスト**: ¥0（Cloudflare無料枠）
- **AI API**: ¥5,000〜¥10,000/月（Gemini API）
- **OCR API**: ¥2,000〜¥5,000/月（Google Vision API）
- **合計**: ¥7,000〜¥15,000/月

### Phase 3（ネイティブアプリ）
- **開発コスト**: ¥0（個人開発）
- **App Store**: ¥12,000/年（Apple Developer Program）
- **Google Play**: ¥2,500（1回のみ）
- **合計**: ¥14,500/年

### Phase 4（エンタープライズ）
- **開発コスト**: 要検討（外注or採用）
- **インフラコスト**: ¥50,000〜¥100,000/月（有料プラン）
- **合計**: 要検討

---

## 🎯 ビジネス目標

### 短期（2026年Q2）
- ユーザー数: 200人
- MAU: 100人
- Thread作成数: 1,000/月
- 収益: ¥0（無料）

### 中期（2026年Q4）
- ユーザー数: 1,000人
- MAU: 500人
- Thread作成数: 5,000/月
- 収益: ¥0（無料）

### 長期（2027年）
- ユーザー数: 10,000人
- MAU: 5,000人
- Thread作成数: 50,000/月
- 収益: ¥500,000/月（有料プラン開始）

---

## 🚧 リスクと対策

### 技術的リスク
| リスク | 対策 |
|--------|------|
| Cloudflare無料枠超過 | 有料プラン移行（Workers Paid: $5/月） |
| AI APIコスト高騰 | バジェット設定、利用制限 |
| スケーラビリティ問題 | D1 → Turso or PostgreSQL検討 |

### ビジネスリスク
| リスク | 対策 |
|--------|------|
| ユーザー獲得難航 | マーケティング強化、X発信 |
| 競合出現 | 差別化（音声特化、関係性管理） |
| 収益化の遅れ | Phase 2で有料プラン検討 |

---

## 📝 優先順位付け（MoSCoW）

### Must Have（必須）
- Phase 0B完了（Cloudflare設定、本番E2E）
- Phase 1: 音声入力、UI/UX改善
- Phase 2: AI音声理解、自動日程生成

### Should Have（重要）
- Phase 1: Inbox/Rooms
- Phase 2: 名刺OCR
- Phase 3: ネイティブアプリ

### Could Have（あると良い）
- Phase 1: ダークモード
- Phase 2: 自動要約
- Phase 3: React Native移行

### Won't Have（今は不要）
- N対N調整
- Deep機能（Quest/Squad）
- エンタープライズ機能

---

## 📞 問い合わせ

- **開発者**: モギモギ（関屋紘之）
- **GitHub**: https://github.com/matiuskuma2/tomoniwaproject
- **X**: @aitanoshimu

---

**関連ドキュメント**:
- [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DEVELOPMENT_STATUS.md](./DEVELOPMENT_STATUS.md)
