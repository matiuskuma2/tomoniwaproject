/**
 * ChatPane
 * Center pane: displays chat-like template text based on thread status
 * Uses GET /api/threads/:id/status
 * AI is NOT implemented - only template text generation
 */

import { useState } from 'react';
import type { ThreadStatus_API } from '../../core/models';

interface ChatPaneProps {
  status: ThreadStatus_API | null;
  loading: boolean;
}

export function ChatPane({ status, loading }: ChatPaneProps) {
  const [message, setMessage] = useState('');

  const handleSendClick = () => {
    // Show unimplemented toast
    alert('この機能は Phase Next-2 で実装予定です');
  };

  const generateTemplateText = (): string[] => {
    if (!status) {
      return ['スレッドを選択してください'];
    }

    const messages: string[] = [];

    // Generate template text based on status
    if (status.thread.status === 'draft') {
      messages.push('調整を開始します。');
    } else if (status.thread.status === 'active') {
      messages.push('候補日時を送付済みです。');
      
      if (status.pending.count > 0) {
        messages.push(`現在 ${status.pending.count} 名が未返信です。回答状況を確認できます。`);
      } else {
        messages.push('全員が回答済みです。日程を確定できます。');
      }

      if (status.selections && status.selections.length > 0) {
        messages.push(`${status.selections.length} 件の回答を受け取りました。`);
      }
    } else if (status.thread.status === 'confirmed' && status.evaluation.meeting) {
      messages.push('日程が確定しました！');
      messages.push(`Google Meet URL を確認できます: ${status.evaluation.meeting.url}`);
      messages.push('カレンダーに予定を追加しました。');
    } else if (status.thread.status === 'cancelled') {
      messages.push('この調整はキャンセルされました。');
    }

    return messages;
  };

  const templateMessages = generateTemplateText();

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <div className="text-center text-gray-500">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p className="text-sm">左のスレッド一覧から選択してください</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Chat Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {templateMessages.map((msg, idx) => (
          <div key={idx} className="flex items-start">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-medium">
              AI
            </div>
            <div className="ml-3 flex-1">
              <div className="bg-gray-100 rounded-lg p-3 inline-block max-w-2xl">
                <p className="text-sm text-gray-900">{msg}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Input Area (Unimplemented) */}
      <div className="border-t border-gray-200 p-4 bg-gray-50">
        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="メッセージを入力... (Phase Next-2 で実装予定)"
            disabled
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-100 text-gray-500 cursor-not-allowed"
          />
          <button
            onClick={handleSendClick}
            className="px-4 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition-colors cursor-not-allowed"
          >
            送信
          </button>
          <button
            onClick={handleSendClick}
            className="px-4 py-2 bg-gray-400 text-white rounded-lg hover:bg-gray-500 transition-colors cursor-not-allowed"
          >
            🎤 音声
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          ※ テキスト送信・音声入力は Phase Next-2 で実装予定です
        </p>
      </div>
    </div>
  );
}
