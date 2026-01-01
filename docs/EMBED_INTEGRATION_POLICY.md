# Embed Integration Policy（外部サービス埋め込みの隔離方針）

**Version**: v1.0  
**Status**: 確定（P0非機能要件）  
**更新日**: 2026-01-01

---

## 📌 目的

**外部サービス（MyASP等）の埋め込みでDOM事故・CSS衝突・XSS攻撃を防ぐ**ための固定ルールとベストプラクティス。

「アプリ内で完結してるように見せる」体験を崩さず、技術負債をゼロにする。

---

## 🎯 原則（P0: 絶対に守る）

### 1. **iframe優先の原則**

外部サービスは **iframe で隔離するのが最優先**（DOM事故ゼロ・CSS衝突ゼロ）

### 2. **Single Source of Truth**

設定（URL・パラメータ）は **外部サービス側を正（真実）** とする。アプリ側に二重管理しない。

### 3. **戻り先は受け皿のみ**

サンクス（完了後遷移）先はアプリ側に持つが、**表示だけ**（データ同期は別API）。

### 4. **スクリプト注入は最終手段**

JSタグ注入は **iframeが使えない場合のみ**、専用コンポーネントで隔離。

---

## 🔐 MyASP課金連携の実装方針

### **推奨方式: iframe隔離**

#### メリット
- ✅ DOM事故ゼロ（Reactツリーと完全分離）
- ✅ CSS衝突ゼロ（外部スタイルが混ざらない）
- ✅ XSS攻撃の影響範囲最小化
- ✅ MyASP側でデザイン・項目変更しても自動反映

#### デメリット
- ❌ MyASPフォームデザインがアプリと完全一致しない可能性
- 対策: MyASP側の「登録フォームデザイン」でCSSを調整

#### 実装例

```typescript
// /billing/subscribe
function BillingSubscribePage() {
  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">プラン選択</h1>
      <div className="billing-iframe-container">
        <iframe
          src="https://myasp.jp/form/xxxxx" // MyASP発行のフォームURL
          className="w-full h-[600px] border-none rounded-lg shadow-lg"
          title="課金フォーム"
          sandbox="allow-scripts allow-same-origin allow-forms" // セキュリティ
        />
      </div>
    </div>
  );
}
```

#### サンクス（完了後遷移）

```typescript
// /billing/return（受け皿のみ）
function BillingReturnPage() {
  const [status, setStatus] = useState('loading');
  const [plan, setPlan] = useState(null);

  useEffect(() => {
    // MyASP → tomonowa POST同期が完了するまでポーリング（最大30秒）
    const poll = setInterval(async () => {
      const res = await fetch('/api/billing/me');
      const data = await res.json();
      if (data.plan && data.status === 1) {
        setStatus('success');
        setPlan(data.plan);
        clearInterval(poll);
      }
    }, 2000);

    setTimeout(() => {
      clearInterval(poll);
      setStatus('timeout');
    }, 30000);

    return () => clearInterval(poll);
  }, []);

  if (status === 'loading') {
    return (
      <div className="max-w-md mx-auto p-8 text-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p>プラン反映中...</p>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="max-w-md mx-auto p-8 text-center">
        <h1 className="text-2xl font-bold mb-4">🎉 プラン登録完了！</h1>
        <p className="mb-4">
          {plan === 1 && 'ライトプラン'}
          {plan === 2 && 'スタンダードプラン'}
          {plan === 3 && 'プロプラン'}
          になりました
        </p>
        <button onClick={() => router.push('/')} className="btn-primary">
          トップへ戻る
        </button>
      </div>
    );
  }

  return <div>反映に時間がかかっています。しばらくしてから確認してください。</div>;
}
```

---

### **次点方式: JSタグ注入（隔離必須）**

#### 使用条件
- iframeが使えない場合のみ
- MyASPの「登録フォームタグの発行（JS）」を使う場合

#### メリット
- ✅ MyASP側でデザイン・項目変更しても自動反映
- ✅ アプリ内に見える（iframeより一体感）

#### デメリット
- ❌ DOM事故リスク（閉じタグ欠落・CSS衝突）
- ❌ jQuery等の依存ライブラリがReactと衝突する可能性
- ❌ cleanup処理を忘れるとメモリリーク

#### 実装例（専用コンポーネントで隔離）

```typescript
// MyASPFormEmbed.tsx（専用コンポーネント）
import { useEffect, useRef } from 'react';

interface MyASPFormEmbedProps {
  formId: string;
}

function MyASPFormEmbed({ formId }: MyASPFormEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // MyASP JSタグを動的に挿入
    const script = document.createElement('script');
    script.src = `https://myasp.jp/form/${formId}.js`;
    script.async = true;
    
    containerRef.current.appendChild(script);

    // cleanup（アンマウント時に削除）
    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = ''; // 生成されたDOMを削除
      }
    };
  }, [formId]);

  return (
    <div 
      ref={containerRef} 
      className="myasp-form-container"
      style={{ isolation: 'isolate' }} // CSS隔離
    />
  );
}

// 使用例
function BillingSubscribePage() {
  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">プラン選択</h1>
      <MyASPFormEmbed formId="xxxxx" />
    </div>
  );
}
```

---

## 🚫 禁止事項（絶対にやらない）

### 1. Reactツリー直下に直接スクリプト注入

❌ **NG例**:
```typescript
// ❌ これは絶対にやらない
function BillingPage() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://myasp.jp/form.js';
    document.body.appendChild(script); // Reactツリー外に直接注入
  }, []);
  return <div id="myasp-form"></div>;
}
```

**問題点**:
- Reactの仮想DOMと実DOMが不一致
- cleanup処理がない（メモリリーク）
- 他のコンポーネントに影響

### 2. サンクスURLのアプリ側固定実装

❌ **NG例**:
```typescript
// ❌ これは技術負債
const MYASP_SUCCESS_URL = 'https://app.tomoniwao.jp/billing/success'; // ハードコード
```

**問題点**:
- MyASP側で変更したらアプリも変更が必要（二重管理）
- 設定の真実が2箇所に分散

✅ **OK例**:
- サンクスURLは **MyASP側だけで管理**
- アプリ側は `/billing/return` を受け皿として用意するだけ

### 3. MyASPからのPOSTデータをフロントで処理

❌ **NG例**:
```typescript
// ❌ これは危険
function BillingReturnPage() {
  const params = new URLSearchParams(location.search);
  const plan = params.get('plan'); // MyASPからのGETパラメータ
  // フロント側で課金状態を判断 → XSSリスク
}
```

**問題点**:
- MyASPからのGETパラメータは改ざん可能
- 課金の真実はMyASP → tomonowa POST同期のみ

✅ **OK例**:
- GET `/api/billing/me` でサーバから取得（POST同期済みのデータ）

---

## 🔒 セキュリティ対策

### iframe使用時

```typescript
<iframe
  src="https://myasp.jp/form/xxxxx"
  sandbox="allow-scripts allow-same-origin allow-forms" // 最小権限
  referrerpolicy="no-referrer" // Referer送信しない
  title="課金フォーム"
/>
```

### JSタグ注入時

1. **Content Security Policy（CSP）**
   ```html
   <meta http-equiv="Content-Security-Policy" content="script-src 'self' https://myasp.jp">
   ```

2. **cleanup必須**
   ```typescript
   useEffect(() => {
     // script挿入
     return () => {
       // 必ずcleanup
       containerRef.current.innerHTML = '';
     };
   }, []);
   ```

3. **Subresource Integrity（SRI）**（可能なら）
   ```html
   <script src="https://myasp.jp/form.js" integrity="sha384-xxxxx"></script>
   ```

---

## 📋 実装チェックリスト

### MyASP埋め込み実装時

- [ ] **iframe方式を検討したか？**（最優先）
- [ ] JSタグ注入の場合、専用コンポーネントで隔離したか？
- [ ] cleanup処理を書いたか？
- [ ] サンクスURLはMyASP側だけで管理してるか？
- [ ] `/billing/return` は表示だけ（データ同期は別API）か？
- [ ] セキュリティ対策（sandbox / CSP）を入れたか？
- [ ] モバイル表示を確認したか？

### レビュー観点

- [ ] Reactツリー直下に直接スクリプト注入してない？
- [ ] cleanup処理がある？
- [ ] サンクスURLのハードコードがない？
- [ ] MyASPからのPOSTデータをフロントで処理してない？
- [ ] iframe の sandbox 属性が適切？

---

## 🧪 テスト（DoD）

### iframe方式

- [ ] フォームが表示される（スマホ・PC）
- [ ] 決済完了後 `/billing/return` にリダイレクト
- [ ] `/billing/return` で plan/status が反映される（30秒以内）
- [ ] CSS衝突がない（アプリのスタイルが崩れない）

### JSタグ注入方式

- [ ] フォームが表示される（スマホ・PC）
- [ ] 決済完了後 `/billing/return` にリダイレクト
- [ ] アンマウント後に生成DOMが削除される
- [ ] 他のページに遷移してもスクリプトが残ってない
- [ ] CSS衝突がない

---

## 📚 参照文書

- [UI_DOM_RULES.md](./UI_DOM_RULES.md): DOM構造事故を防ぐルール
- [MYASP_INTEGRATION_SPEC.md](./MYASP_INTEGRATION_SPEC.md): MyASP課金連携 実装仕様
- [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md): P0非機能要件

---

## 更新履歴

| 日付 | バージョン | 変更内容 | 更新者 |
|------|------------|----------|--------|
| 2026-01-01 | v1.0 | 初版作成（P0非機能要件） | 開発チーム |

---

**END OF DOCUMENT**
