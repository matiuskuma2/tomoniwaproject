# Ops & Scalability Guardrails（確定版：スケール/コスト/監査）

本ドキュメントは「壊れない・燃えない（コスト）」を保証する最小運用ルールを確定する。

---

## 1. コストガード（確定：無料公開の生存条件）
- AI_FALLBACK_ENABLED=false をデフォルト
  - Gemini → Pattern（OpenAIに落ちない）
- ai_usage_logs は null なし（数値は0埋め、文字列はunknown）
- Admin Dashboardで provider/model/feature ごとに集計

---

## 2. データ境界（確定）
- workspace_id で完全分離（contacts/lists/threads/rooms 全て）
- Admin API は requireAuth + requireAdmin（すでに実装済み方針）

---

## 3. 監査ログ（確定：後続実装）
次の操作は audit_logs に必ず記録（Phase C以降で実装）
- contacts 一括インポート
- list 作成/更新/一括送信
- thread finalize（手動/自動）
- admin権限変更

---

## 4. スケール時の考え方（確定）
- "検索はDB / 説明は短要約"
- リスト一括送信は Queue（EMAIL_QUEUE）で分割送信
- remind は thread×60分 のレート制限でスパムを抑える（実装済み方針）

---

## 5. Google Meetリンク発行（方向性：確定）
- finalize（手動/自動）時に meeting link を作り、確定通知に含める
- 実装順：
  1) finalize に hook
  2) meetリンク生成（Google Calendar Event / Meet）
  3) thread_finalize に meeting_link を保存（将来migration）
  4) inbox/email へ反映

※ ただし、まず contacts/lists の確定と一括invite体験を固めた後に進める（広げすぎない）。
