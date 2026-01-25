/**
 * Shared: buildPrepareMessage
 * 
 * Phase 1-3b: invite.ts から移動
 * 
 * IMPORTANT: この関数の出力文字列は一切変更しないこと
 * （E2E/運用の互換性を維持するため）
 */

import type { PrepareSendResponse } from '../../../api/pendingActions';

/**
 * Prepare API レスポンスからユーザー向けメッセージを生成
 * P3-INV1 B案: メールプレビュー骨格ブロック対応
 * 
 * Note: この関数は invite.ts / apiExecutor.ts から使用される
 */
export function buildPrepareMessage(response: PrepareSendResponse): string {
  const summary = response.summary;
  let message = `📧 送信先: ${summary.valid_count}件\n`;
  
  if (summary.preview && summary.preview.length > 0) {
    message += '\n**送信先プレビュー:**\n';
    summary.preview.forEach((p: { email: string; is_app_user?: boolean }) => {
      message += `- ${p.email}${p.is_app_user ? ' (アプリユーザー)' : ''}\n`;
    });
    if (summary.valid_count > summary.preview.length) {
      message += `... 他 ${summary.valid_count - summary.preview.length}名\n`;
    }
  }
  
  // P3-INV1 B案: メールプレビュー骨格ブロック表示
  const emailPreview = response.email_preview;
  if (emailPreview) {
    message += '\n**📬 送信されるメール内容:**\n';
    message += `📌 件名: ${emailPreview.subject}\n\n`;
    
    // blocks をわかりやすく表示
    emailPreview.blocks.forEach((block) => {
      switch (block.type) {
        case 'intro':
          message += `📝 ${block.text}\n`;
          break;
        case 'notes':
          if (block.items && block.items.length > 0) {
            message += `\n📋 ${block.text}:\n`;
            block.items.forEach((item: string) => {
              message += `  • ${item}\n`;
            });
          } else {
            message += `📋 ${block.text}\n`;
          }
          break;
        case 'slots':
          message += `\n📅 ${block.text}:\n`;
          if (block.items && block.items.length > 0) {
            block.items.slice(0, 5).forEach((item: string) => {
              message += `  • ${item}\n`;
            });
            if (block.items.length > 5) {
              message += `  ... 他 ${block.items.length - 5}件\n`;
            }
          }
          break;
        case 'cta':
          message += `\n🔘 ボタン: [${block.text}]\n`;
          break;
        case 'deadline':
          message += `⏰ リンク有効期限: ${block.expires_at || block.text}\n`;
          break;
        case 'custom_message':
          message += `💬 メッセージ: ${block.text}\n`;
          break;
        case 'footer':
          // フッターは省略（長くなるため）
          break;
      }
    });
    
    // タイムゾーン情報
    if (emailPreview.recipient_timezone && emailPreview.recipient_timezone !== 'Asia/Tokyo') {
      message += `\n🌍 表示タイムゾーン: ${emailPreview.recipient_timezone}\n`;
    }
  }
  
  if (summary.skipped && Object.values(summary.skipped).some((v: number) => v > 0)) {
    message += '\n⚠️ スキップ: ';
    const reasons = [];
    if (summary.skipped.invalid_email > 0) reasons.push(`無効なメール ${summary.skipped.invalid_email}件`);
    if (summary.skipped.duplicate_input > 0) reasons.push(`重複 ${summary.skipped.duplicate_input}件`);
    if (summary.skipped.already_invited > 0) reasons.push(`招待済み ${summary.skipped.already_invited}件`);
    message += reasons.join(', ') + '\n';
  }
  
  message += '\n次に「送る」「キャンセル」「別スレッドで」のいずれかを入力してください。';
  
  return message;
}
