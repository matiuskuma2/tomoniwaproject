# UI DOM Rules（DOM構造事故を防ぐ固定ルール）

**Version**: v1.0  
**Status**: 確定（P0非機能要件）  
**更新日**: 2026-01-01

---

## 📌 目的

**DOM構造事故（閉じタグ欠落、タブネスト崩壊、埋め込み衝突）を起こせなくする**ための設計ルールとガードレール。

「後から直す」ではなく、**最初から事故を防ぐ仕組みを入れる**ことで技術負債をゼロにする。

---

## 🚨 DOM事故が起きやすいパターン（禁止事項）

### 1. タブの責務違反
❌ **NG**: タブコンポーネント内で状態管理・データ取得をする
```typescript
// ❌ NG例
function MobileTab({ tab }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetchData().then(setData); // タブ内でデータ取得
  }, []);
  return <div>{data?.content}</div>;
}
```

✅ **OK**: タブは表示切替だけ、データは外で管理
```typescript
// ✅ OK例
function ChatLayout({ activeTab, tabData }) {
  return (
    <Tabs value={activeTab}>
      <TabsContent value="chat">{tabData.chat}</TabsContent>
      <TabsContent value="schedule">{tabData.schedule}</TabsContent>
    </Tabs>
  );
}
```

### 2. レイアウトの境界違反
❌ **NG**: ChatLayout内で子コンポーネントの詳細を知っている
```typescript
// ❌ NG例
function ChatLayout() {
  return (
    <div className="chat-layout">
      <MessageList messages={messages} /> {/* 詳細を知っている */}
      <ScheduleCard schedule={schedule} /> {/* 詳細を知っている */}
    </div>
  );
}
```

✅ **OK**: ChatLayoutは3カラムDOMを提供するだけ（slot方式）
```typescript
// ✅ OK例
function ChatLayout({ leftPane, centerPane, rightPane }) {
  return (
    <div className="chat-layout">
      <div className="left-pane">{leftPane}</div>
      <div className="center-pane">{centerPane}</div>
      <div className="right-pane">{rightPane}</div>
    </div>
  );
}
```

### 3. 埋め込みの隔離違反
❌ **NG**: 外部スクリプト（MyASP JSタグ）をReactツリー直下に注入
```typescript
// ❌ NG例
function BillingPage() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://myasp.jp/form.js';
    document.body.appendChild(script); // Reactツリーに直接注入
  }, []);
  return <div id="myasp-form"></div>;
}
```

✅ **OK**: iframe で隔離（推奨）
```typescript
// ✅ OK例
function BillingPage() {
  return (
    <div className="billing-container">
      <iframe
        src="https://myasp.jp/form/xxxxx"
        className="billing-iframe"
        style={{ width: '100%', height: '600px', border: 'none' }}
      />
    </div>
  );
}
```

### 4. 条件分岐のネスト地獄
❌ **NG**: return内で深いネストと条件分岐
```typescript
// ❌ NG例
function CardsPane({ schedule, votes, proposals }) {
  return (
    <div>
      {schedule && (
        <div>
          {schedule.status === 'pending' && (
            <div>
              {votes.length > 0 && (
                <div>
                  {/* さらにネスト... */}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

✅ **OK**: 条件分岐を浅く、早期return
```typescript
// ✅ OK例
function CardsPane({ schedule, votes, proposals }) {
  if (!schedule) return null;
  if (schedule.status !== 'pending') return <CompletedView schedule={schedule} />;
  
  return (
    <div className="cards-pane">
      {votes.length > 0 && <VotesSummaryCard votes={votes} />}
      {proposals.length > 0 && <ProposalsCard proposals={proposals} />}
    </div>
  );
}
```

---

## ✅ 固定ルール（P0: 絶対に守る）

### Rule 1: タブの責務は「表示切替のみ」

- タブコンポーネント内で状態管理をしない
- タブコンポーネント内でデータ取得をしない
- データは親（ChatLayoutの外）で管理し、propsで渡す

### Rule 2: レイアウトの境界を固定（3カラムDOM）

- `ChatLayout` は3カラムDOMを提供するだけ（slot方式）
- 子コンポーネントの詳細を知らない
- 子コンポーネントは独立して動作する

```typescript
// 固定テンプレート
<ChatLayout
  leftPane={<ThreadList />}
  centerPane={<ChatMessages />}
  rightPane={<CardsPane />}
/>
```

### Rule 3: `dangerouslySetInnerHTML` は原則禁止

- 使う場合は必ず XSS対策（DOMPurify等）
- 監査ログに記録
- レビュー必須

### Rule 4: 外部スクリプト（MyASP等）は iframe で隔離

- **推奨**: iframe方式（DOM事故ゼロ）
- **次点**: 専用コンポーネント内で隔離（useEffect + cleanup必須）
- Reactツリー直下に直接注入は禁止

### Rule 5: カードの表示条件を固定

- カードは「データがある時だけ表示」
- 条件分岐は早期return で浅く保つ
- ネストは最大3階層まで

### Rule 6: Fragment多用の禁止

- `<></>` を5個以上ネストしない
- 構造を浅く、コンポーネント分割で対応

---

## 🛡️ 自動チェック（CI）でDOM事故を落とす

### 必須CI（GitHub Actions / Cloudflare CI）

1. **TypeScript型チェック**
   ```bash
   tsc -b
   ```

2. **ESLint**
   ```bash
   eslint src/
   ```

3. **Vite Build**
   ```bash
   vite build
   ```

4. **閉じタグ欠落チェック**（Reactは自動で検出）
   - ビルドエラーで落ちる

### 推奨CI（将来追加）

5. **Bundle Size チェック**
   ```bash
   npm run build && du -sh dist/
   ```

6. **未使用コンポーネント検出**
   ```bash
   npx ts-prune
   ```

---

## 📋 レビュー観点（PR時に必ず確認）

### DOM構造チェックリスト

- [ ] タブは「表示切替のみ」か？（状態管理・データ取得してない？）
- [ ] ChatLayoutは3カラムDOMを提供するだけか？（子の詳細を知ってない？）
- [ ] `dangerouslySetInnerHTML` を使ってない？（使う場合はXSS対策済み？）
- [ ] 外部スクリプトはiframe で隔離されてる？
- [ ] 条件分岐のネストは3階層以内？
- [ ] Fragmentは5個以上ネストしてない？
- [ ] カードの表示条件は明確？（データがある時だけ表示？）

---

## 🔧 実装例（ベストプラクティス）

### 良い例: タブの責務分離

```typescript
// ChatPage.tsx（データ管理の親）
function ChatPage({ threadId }) {
  const [activeTab, setActiveTab] = useState('chat');
  const { messages, schedule, votes } = useThreadData(threadId);

  return (
    <ChatLayout
      leftPane={<ThreadList />}
      centerPane={
        <MobileTabs activeTab={activeTab} onTabChange={setActiveTab}>
          <TabContent value="chat">
            <ChatMessages messages={messages} />
          </TabContent>
          <TabContent value="schedule">
            <ScheduleView schedule={schedule} votes={votes} />
          </TabContent>
        </MobileTabs>
      }
      rightPane={<CardsPane schedule={schedule} votes={votes} />}
    />
  );
}
```

### 良い例: 条件分岐を浅く

```typescript
// CardsPane.tsx
function CardsPane({ schedule, votes, proposals }) {
  // 早期return で浅く
  if (!schedule) return null;
  
  const showVotes = votes.length > 0;
  const showProposals = proposals.length > 0;

  return (
    <div className="cards-pane">
      {showVotes && <VotesSummaryCard votes={votes} />}
      {showProposals && <ProposalsCard proposals={proposals} />}
      <ScheduleCard schedule={schedule} />
    </div>
  );
}
```

### 良い例: 外部スクリプトの隔離（iframe推奨）

```typescript
// BillingPage.tsx
function BillingPage() {
  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">プラン選択</h1>
      <div className="billing-iframe-container">
        <iframe
          src="https://myasp.jp/form/xxxxx"
          className="w-full h-[600px] border-none rounded-lg shadow-lg"
          title="課金フォーム"
        />
      </div>
    </div>
  );
}
```

---

## 🚨 事故った時の対処（最小）

### 症状1: タブ切替で白画面

**原因**: タブ内でuseEffect無限ループ or データ取得失敗

**対処**:
1. ErrorBoundary で catch
2. タブ内のデータ取得を親に移動
3. useEffect依存配列を確認

### 症状2: カードが表示されない

**原因**: 条件分岐の誤り or データ未取得

**対処**:
1. 条件分岐を `console.log` で確認
2. データがnull/undefinedの場合の早期returnを追加
3. ローディング状態を明示

### 症状3: 埋め込みフォームでスタイル崩壊

**原因**: 外部CSSとReactのCSS衝突

**対処**:
1. iframe方式に切替（推奨）
2. Shadow DOM で隔離（高度）
3. CSS Modules / Tailwind で名前空間分離

---

## 📚 参照文書

- [CHAT_DATA_CONTRACT.md](./CHAT_DATA_CONTRACT.md): チャットデータ契約
- [EMBED_INTEGRATION_POLICY.md](./EMBED_INTEGRATION_POLICY.md): MyASP埋め込み隔離方針
- [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md): P0非機能要件

---

## 更新履歴

| 日付 | バージョン | 変更内容 | 更新者 |
|------|------------|----------|--------|
| 2026-01-01 | v1.0 | 初版作成（P0非機能要件） | 開発チーム |

---

**END OF DOCUMENT**
