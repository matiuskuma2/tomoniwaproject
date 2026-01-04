/**
 * ChatPane
 * Center pane: displays chat-like conversation with intent execution
 * Phase Next-2: Text input → Intent classification → API execution
 * Phase Next-4 Day1: Voice input → Speech recognition → Text input
 * Messages are now managed per-thread by ChatLayout
 */

import { useRef, useEffect } from 'react';
import { useState } from 'react';
import type { ThreadStatus_API } from '../../core/models';
import { classifyIntent } from '../../core/chat/intentClassifier';
import { executeIntent, type ExecutionResult } from '../../core/chat/apiExecutor';
import { VoiceRecognitionButton } from './VoiceRecognitionButton';
import { SpeakButton } from './SpeakButton';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatPaneProps {
  threadId: string | null;
  status: ThreadStatus_API | null;
  loading: boolean;
  
  // NEW: thread-specific messages passed from ChatLayout
  messages: ChatMessage[];
  
  // NEW: append message to thread
  onAppend: (threadId: string, msg: ChatMessage) => void;
  
  // NEW: seed template messages if empty
  onSeedIfEmpty: (threadId: string, seed: ChatMessage[]) => void;
  
  // Existing: refresh thread status
  onThreadUpdate?: () => void;
  
  // NEW (Phase Next-5 Day2.1): unified execution result handler (type-safe)
  onExecutionResult?: (result: ExecutionResult) => void;
  
  // NEW (Phase Next-5 Day2): pending auto-propose
  pendingAutoPropose?: any;
  
  // NEW (Phase Next-5 Day3): additional propose execution count (max 2)
  additionalProposeCount?: number;
  
  // NEW (Phase Next-6 Day1): pending remind
  pendingRemind?: {
    threadId: string;
    pendingInvites: Array<{ email: string; name?: string }>;
    count: number;
  } | null;
  
  // NEW (Phase Next-6 Day1): remind execution count (max 2)
  remindCount?: number;
  
  // NEW (Phase Next-6 Day3): pending notify
  pendingNotify?: {
    threadId: string;
    invites: Array<{ email: string; name?: string }>;
    finalSlot: { start_at: string; end_at: string; label?: string };
    meetingUrl?: string;
  } | null;
  
  // NEW (Phase Next-6 Day2): pending split
  pendingSplit?: {
    threadId: string;
  } | null;
}

export function ChatPane({ 
  threadId, 
  status, 
  loading, 
  messages, 
  onAppend, 
  onSeedIfEmpty, 
  onThreadUpdate,
  onExecutionResult,
  pendingAutoPropose,
  additionalProposeCount = 0,
  pendingRemind = null,
  remindCount = 0,
  pendingNotify = null,
  pendingSplit = null
}: ChatPaneProps) {
  const [message, setMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false); // Phase Next-4 Day2.5: 音声補正中フラグ
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Seed template messages if thread is empty (once per thread)
  useEffect(() => {
    if (!threadId) return;
    if (!status) return;
    if (loading) return;

    // Only seed if this thread has no messages
    if (messages.length === 0) {
      const templateLines = generateTemplateText(status);
      const seed: ChatMessage[] = templateLines.map((line, idx) => ({
        id: `template-${threadId}-${idx}`,
        role: 'assistant',
        content: line,
        timestamp: new Date(),
      }));
      onSeedIfEmpty(threadId, seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, status?.thread?.id, loading]);

  const handleSendClick = async () => {
    if (!message.trim() || isProcessing || !threadId) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message.trim(),
      timestamp: new Date(),
    };

    onAppend(threadId, userMessage);
    setMessage('');
    setIsProcessing(true);

    try {
      // Classify intent
      // Phase Next-6 Day1: Pass pendingRemind for confirm/cancel
      // Phase Next-6 Day3: Pass pendingNotify for confirm/cancel
      // Phase Next-6 Day2: Pass pendingSplit for confirm/cancel
      const intentResult = classifyIntent(message, {
        selectedThreadId: threadId,
        pendingRemind,
        pendingNotify,
        pendingSplit,
      });
      
      console.log('[Intent] Classified:', intentResult.intent, 'params:', intentResult.params);

      // Execute intent
      // Phase Next-5 Day2: Pass pendingAutoPropose for confirm/cancel
      // Phase Next-5 Day3: Pass additionalProposeCount for execution limit
      // Phase Next-6 Day1: Pass pendingRemind and remindCount
      // Phase Next-6 Day3: Pass pendingNotify
      // Phase Next-6 Day2: Pass pendingSplit
      console.log('[API] Executing intent:', intentResult.intent);
      const result = await executeIntent(intentResult, {
        pendingAutoPropose,
        additionalProposeCount,
        pendingRemind,
        remindCount,
        pendingNotify,
        pendingSplit,
      });
      console.log('[API] Result:', result.success, result.message);

      // Add assistant response
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result.message,
        timestamp: new Date(),
      };

      onAppend(threadId, assistantMessage);

      // Phase Next-5 Day2.1: Unified execution result handler
      if (result.data && onExecutionResult) {
        onExecutionResult(result);
      }

      // If successful, trigger refresh
      if (result.success && onThreadUpdate) {
        setTimeout(() => {
          onThreadUpdate();
        }, 500);
      }
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `❌ エラーが発生しました: ${error instanceof Error ? error.message : '不明なエラー'}`,
        timestamp: new Date(),
      };
      onAppend(threadId, errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendClick();
    }
  };

  const generateTemplateText = (s: ThreadStatus_API): string[] => {
    const msgs: string[] = [];

    // Generate template text based on status
    if (s.thread.status === 'draft') {
      msgs.push('調整を開始します。');
    } else if (s.thread.status === 'active') {
      msgs.push('候補日時を送付済みです。');
      
      if (s.pending.count > 0) {
        msgs.push(`現在 ${s.pending.count} 名が未返信です。回答状況を確認できます。`);
      } else {
        msgs.push('全員が回答済みです。日程を確定できます。');
      }

      if (s.selections && s.selections.length > 0) {
        msgs.push(`${s.selections.length} 件の回答を受け取りました。`);
      }
    } else if (s.thread.status === 'confirmed' && s.evaluation.meeting) {
      msgs.push('日程が確定しました！');
      msgs.push(`Google Meet URL を確認できます: ${s.evaluation.meeting.url}`);
      msgs.push('カレンダーに予定を追加しました。');
    } else if (s.thread.status === 'cancelled') {
      msgs.push('この調整はキャンセルされました。');
    }

    return msgs;
  };

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
        {messages.map((msg) => (
          <div key={msg.id} className="flex items-start">
            {msg.role === 'assistant' ? (
              <>
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-medium">
                  AI
                </div>
                <div className="ml-3 flex-1">
                  <div className="bg-gray-100 rounded-lg p-3 inline-block max-w-2xl">
                    <p className="text-sm text-gray-900 whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  <div className="flex items-center space-x-2 mt-1">
                    <p className="text-xs text-gray-400">
                      {new Date(msg.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    {/* Phase Next-4 Day2.5: messageId を渡して全体停止機能を有効化 */}
                    <SpeakButton text={msg.content} messageId={msg.id} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex-1"></div>
                <div className="mr-3 flex-shrink-0">
                  <div className="bg-blue-600 text-white rounded-lg p-3 inline-block max-w-2xl">
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  <p className="text-xs text-gray-400 mt-1 text-right">
                    {new Date(msg.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-gray-700 text-sm font-medium">
                  You
                </div>
              </>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area (Phase Next-2: Enabled, Phase Next-4 Day1: Voice input added) */}
      <div className="border-t border-gray-200 p-4 bg-gray-50">
        <div className="flex items-center space-x-2">
          {/* Input field - 標準的なチャットUIに合わせて左側に配置 */}
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="メッセージを入力..."
            disabled={isProcessing}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
          />
          
          {/* Phase Next-4 Day1: Voice Recognition Button - 右側に配置 */}
          {/* Phase Next-4 Day2.5: 置換方式に変更（追記 → 置換） + 補正中フラグ */}
          <VoiceRecognitionButton
            onTranscriptUpdate={(transcript) => {
              setMessage(transcript);
            }}
            disabled={isProcessing}
            onProcessingChange={setIsVoiceProcessing}
          />
          
          {/* Send button - 最も右側に配置 */}
          {/* Phase Next-4 Day2.5: 音声補正中もロック */}
          <button
            onClick={handleSendClick}
            disabled={isProcessing || isVoiceProcessing || !message.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {isProcessing ? '処理中...' : isVoiceProcessing ? '補正中...' : '送信'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          💡 使い方: 「〇〇さんに日程調整送って」「状況教えて」「1番で確定して」
        </p>
      </div>
    </div>
  );
}
