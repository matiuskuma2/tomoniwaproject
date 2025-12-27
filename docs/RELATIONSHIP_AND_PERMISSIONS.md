# Relationship & Permissions（確定版：家族/仕事/他人）

本ドキュメントは「関係性が体験を壊さないための最小固定」を確定する。

---

## 1. relationship_type（確定）
Contacts に `relationship_type` を持たせ、最小3分類で固定する。

- family
- coworker
- external

---

## 2. "できること"の分岐（確定：今は制限しすぎない）
Phase B〜Cの現時点では、関係性による権限制御は"厳密実装しない"。

ただし、将来のために **設計上の解釈** を固定しておく。

### family（将来）
- 代理確定（本人の代わりに確定）を許可しやすい
- 自動登録（相手が未返信でも枠押さえ）を許可しやすい

### coworker（将来）
- Room/Team 前提での調整が増える
- 相互に日程共有（許可が取れている範囲）を扱いやすい

### external（現在の中心）
- 原則「相手に選んでもらう」モデルのみ
- 外部招待リンク /i/:token による回答が正

---

## 3. permission_level（将来の予約：まだ実装しない）
次の拡張に備えて概念だけ確定する。

- invite_only（今は全員これ）
- can_view_availability
- can_auto_schedule

---

## 4. セキュリティ（確定）
- relationship_type は"UI/体験の枝分かれ"であり、テナント境界は workspace_id で強制
- 外部リンクは token ベースで scope 最小化（本人の回答以外を見せない）
