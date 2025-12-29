# AI_WORK_RULES.md
## ToMoniWao – AI作業ルール（壊さない・矛盾しない・段取りよく）

最終更新: 2025-12-29  
目的: AIの推測による事故（API破壊/DB破壊/前提ズレ）を防止する

---

## 0. 絶対禁止（Breaking禁止）
- DBスキーマ/マイグレーションの破壊（DROP/rename/過去migration編集）
- 既存APIレスポンスキーの削除・リネーム（追加のみ可）
- 既存の認証フロー（Cookie→/auth/token→Bearer）を壊す変更
- "ついで修正"で複数箇所を触る（原因1つだけ直す）
- UI都合で日程調整ロジックの意味を変える

---

## 1. Monorepo前提（固定）
- apps/api = Cloudflare Workers（Backend）
- frontend = Cloudflare Pages（Frontend）
- 同一ドメイン app.tomoniwao.jp
  - /api/* /auth/* /i/* → Workers
  - /* → Pages

---

## 2. バグ修正の標準手順（必須）
1) 再現手順（1行）
2) 期待結果（1行）
3) 原因候補（最大2つ）
4) 最小差分の修正案（どのファイルのどの行）
5) 確認手順（Console/Networkで見るポイント）
6) 副作用チェック（認証/ルーティング/既存E2Eが壊れてないか）

---

## 3. AIに依頼するときのテンプレ（コピペ）

```
あなたは ToMoniWao(tomoniwaproject) の開発補助AIです。

【絶対禁止】
- DB/マイグレーション/依存関係/日程調整ロジックを変更しない
- 既存APIのURL/レスポンスキーを削除・リネームしない（追加のみOK）
- ついで修正禁止（原因1点のみ）
- monorepo維持：apps/api=Workers、frontend=Pages、/api,/auth,/i→Workers、/*→Pages
- 認証は Cookie→/auth/token→Bearer→API

【今回の目的（1行）】
（例：Thread詳細の401を直す。API契約は変えない。）

【作業開始前に必ず出力】
- 再現手順（1行）
- 期待結果（1行）
- 原因候補（最大2つ）
- 最小差分の修正案（ファイル/行）
- 確認方法（Network/Consoleの観点）

【UXの正】
docs/UX_CHAT_SPEC.md と docs/SCHEDULING_LOGIC_SPEC.md に反する提案は禁止。
```

---

## 4. 仕様の"正"一覧（必読）
- docs/UX_CHAT_SPEC.md
- docs/SCHEDULING_LOGIC_SPEC.md
- docs/UI_CARD_CATALOG.md（作るなら）
- docs/API_CONTRACT_CRITICAL.md（作るなら）

---
