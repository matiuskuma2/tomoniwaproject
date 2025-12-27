# Bulk Invite & Progress Queries（確定版：音声で状況確認）

「話しかけるだけで進捗が分かる」を、最小コストで成立させるための確定仕様。

---

## 1. 状況確認の基本原則（確定）
- 進捗の正は DB（thread_invites / thread_selections / thread_finalize）
- LLMは「説明文の生成」「曖昧な問い合わせの補助」に限定
- "全データをLLMに読ませる"はしない

---

## 2. "今どうなってる？"（確定）
- GET /api/threads/:id/status が返す情報が正
- ここで返すべき最低限（確定）：
  - thread
  - rule（AttendanceRule）
  - slots
  - invites（email/name/status/invite_url）
  - selections（invitee_key/status/selected_slot_id/responded_at）
  - pending（未返信者一覧）
  - finalized（thread_finalize があれば確定情報）

---

## 3. "誰に催促すべき？"（確定）
- pending = invites - selections（invitee_key基準）
- required_missing（REQUIRED_PLUS_QUORUM等の必須者が未返信）も返す
- remind API は status を元に "未返信のみ" に送る（今の実装方針と一致）

---

## 4. "この人どうだっけ？"（確定）
- contacts.summary / tags_json / notes から返す
- 返答テンプレ：
  - 名前 / 関係性 / 重要タグ / 最終接点 / 直近の調整スレッド状況（あれば）

---

## 5. 大規模化（確定方針）
- SQL検索 + summary返却が基本
- embeddingは必要になったら導入（今は不要）
