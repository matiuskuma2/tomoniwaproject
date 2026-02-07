/**
 * ChatPane
 * Center pane: displays chat-like conversation with intent execution
 * Phase Next-2: Text input → Intent classification → API execution
 * Phase Next-4 Day1: Voice input → Speech recognition → Text input
 * Messages are now managed per-thread by ChatLayout
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ThreadStatus_API } from '../../core/models';
import { classifyIntent } from '../../core/chat/intentClassifier';
import { executeIntent, type ExecutionResult } from '../../core/chat/apiExecutor';
import { extractErrorMessage } from '../../core/api/client';
import { VoiceRecognitionButton } from './VoiceRecognitionButton';
// PR-D-FE-3: 名刺OCRスキャン executor
import { executeBusinessCardScan } from '../../core/chat/executors/contactImport';
// P0-1: PendingState 正規化
import type { PendingState } from '../../core/chat/pendingTypes';
import { 
  getPendingPlaceholder,
  getPendingHintBanner,
  getPendingSendButtonLabel,
} from '../../core/chat/pendingTypes';

/**
 * 安全な時刻フォーマット関数
 * Date / number(ms) / ISO string を全て受け入れ、エラーで落ちない
 */
function formatTime(ts: unknown): string {
  const d =
    ts instanceof Date ? ts :
    typeof ts === 'number' ? new Date(ts) :
    typeof ts === 'string' ? new Date(ts) :
    null;

  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date | string | number;
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
  
  // P0-1: 正規化された pending（threadId に紐づく pending）
  pendingForThread?: PendingState | null;
  
  // P0-1: threadId 未選択時の pending.action（prepare-send等）
  globalPendingAction?: PendingState | null;
  
  // カウンター（max 2 制限用）
  additionalProposeCount?: number;
  remindCount?: number;
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
  pendingForThread = null,
  globalPendingAction = null,
  additionalProposeCount = 0,
  remindCount = 0,
}: ChatPaneProps) {
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false); // Phase Next-4 Day2.5: 音声補正中フラグ
  // PR-D-FE-3: 名刺画像添付
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // PR-D-FE-3: 画像添付ハンドラ
  const MAX_IMAGES = 5;
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles: File[] = [];
    const errors: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!ALLOWED_TYPES.includes(file.type)) {
        errors.push(`${file.name}: JPEG/PNG/WebPのみ対応`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: 10MBを超えています`);
        continue;
      }
      newFiles.push(file);
    }

    // 最大5枚制限
    const remaining = MAX_IMAGES - attachedImages.length;
    const toAdd = newFiles.slice(0, remaining);
    if (newFiles.length > remaining) {
      errors.push(`最大${MAX_IMAGES}枚まで添付できます`);
    }

    if (errors.length > 0) {
      // エラーメッセージをアシスタントメッセージとして表示
      const targetThreadId = threadId || 'temp';
      onAppend(targetThreadId, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ 画像添付エラー:\n${errors.join('\n')}`,
        timestamp: new Date(),
      });
    }

    if (toAdd.length > 0) {
      setAttachedImages(prev => [...prev, ...toAdd]);
    }

    // inputをリセット（同じファイル再選択対応）
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [attachedImages.length, threadId, onAppend]);

  const removeImage = useCallback((index: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== index));
  }, []);

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

  // PR-D-FE-3: 名刺スキャン専用ハンドラ（画像添付時はテキスト分類をバイパス）
  const handleBusinessCardScan = async (images: File[]) => {
    const targetThreadId = threadId || 'temp';
    const imageNames = images.map(f => f.name).join(', ');
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: `📎 名刺スキャン: ${images.length}枚 (${imageNames})`,
      timestamp: new Date(),
    };
    onAppend(targetThreadId, userMsg);
    setAttachedImages([]);
    setIsProcessing(true);

    try {
      console.log('[PR-D-FE-3] Executing business card scan:', images.length, 'images');
      const result = await executeBusinessCardScan(images);
      console.log('[PR-D-FE-3] Scan result:', result.success, result.message);

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result.message,
        timestamp: new Date(),
      };
      onAppend(targetThreadId, assistantMessage);

      // pending UI へ接続
      if (result.data && onExecutionResult) {
        onExecutionResult(result);
      }
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `❌ 名刺スキャンエラー: ${extractErrorMessage(error)}`,
        timestamp: new Date(),
      };
      onAppend(targetThreadId, errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendClick = async () => {
    // PR-D-FE-3: 画像添付があれば名刺スキャンへ
    if (attachedImages.length > 0) {
      await handleBusinessCardScan(attachedImages);
      return;
    }

    if (!message.trim() || isProcessing) return;
    
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message.trim(),
      timestamp: new Date(),
    };

    // Phase P0-5: threadId が無い場合は 'temp' を使う
    const targetThreadId = threadId || 'temp';
    onAppend(targetThreadId, userMessage);
    setMessage('');
    setIsProcessing(true);

    try {
      // Classify intent
      const intentResult = classifyIntent(message, {
        selectedThreadId: threadId || undefined,
        // P0-1: 正規化された pending を渡す
        pendingForThread,
        globalPendingAction,
      });
      
      console.log('[Intent] Classified:', intentResult.intent, 'params:', intentResult.params);

      // Execute intent
      console.log('[API] Executing intent:', intentResult.intent);
      const result = await executeIntent(intentResult, {
        // P0-1: 正規化された pending を渡す
        pendingForThread,
        globalPendingAction,
        additionalProposeCount,
        remindCount,
      });
      console.log('[API] Result:', result.success, result.message);

      // Add assistant response
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result.message,
        timestamp: new Date(),
      };

      // Phase P0-5: thread.create の結果を受け取って navigate
      if (result.data?.kind === 'thread.create') {
        const newThreadId = result.data?.payload?.threadId;
        if (newThreadId && typeof newThreadId === 'string') {
          // メッセージを新しいスレッドに追加してから navigate
          onAppend(newThreadId, assistantMessage);
          
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
          
          // Navigate to the new thread
          setTimeout(() => {
            navigate(`/chat/${newThreadId}`);
          }, 100);
          
          setIsProcessing(false);
          return; // navigate するので処理終了
        }
      }

      // Phase P0-5: thread.invites.batch の結果を受け取って navigate
      if (result.data?.kind === 'thread.invites.batch') {
        const newThreadId = result.data?.payload?.threadId;
        if (newThreadId && typeof newThreadId === 'string' && !threadId) {
          // メッセージを新しいスレッドに追加してから navigate
          onAppend(newThreadId, assistantMessage);
          
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
          
          // Navigate to the new thread
          setTimeout(() => {
            navigate(`/chat/${newThreadId}`);
          }, 100);
          
          setIsProcessing(false);
          return; // navigate するので処理終了
        }
      }

      // Phase P0-5: threadId が無い場合は 'temp' を使う
      onAppend(targetThreadId, assistantMessage);

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
        content: `❌ エラーが発生しました: ${extractErrorMessage(error)}`,
        timestamp: new Date(),
      };
      // Phase P0-5: threadId が無い場合は 'temp' を使う
      onAppend(targetThreadId, errorMessage);
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

  // Phase P0-5: status が無くてもチャット入力は可能にする

  // PERF-S2: メッセージ表示上限（DOM肥大防止）
  const MAX_DISPLAY_MESSAGES = 50;
  const displayMessages = messages.length > MAX_DISPLAY_MESSAGES
    ? messages.slice(-MAX_DISPLAY_MESSAGES)
    : messages;
  const hiddenCount = messages.length - displayMessages.length;

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Chat Messages Area */}
      <div data-testid="chat-messages" className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* PERF-S2: 古いメッセージ省略表示 */}
        {hiddenCount > 0 && (
          <div className="text-center text-xs text-gray-400 py-2">
            {hiddenCount}件の古いメッセージは省略されています
          </div>
        )}
        {displayMessages.length === 0 && !threadId ? (
          /* Phase P0-5: スレッド未選択時のプレースホルダー */
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-gray-500 max-w-md">
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-lg font-medium mb-2">新しい日程調整を作成</p>
              <p className="text-sm text-gray-400 mb-4">
                メールアドレスを入力して<br/>
                日程調整を始めましょう
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left">
                <p className="text-xs text-blue-800 font-medium mb-2">💡 使い方</p>
                <p className="text-xs text-blue-600">
                  1. メールアドレスを入力 (例: tanaka@example.com)<br/>
                  2. 自動的にスレッドが作成されます<br/>
                  3. 招待リンクが生成されます
                </p>
              </div>
            </div>
          </div>
        ) : (
          displayMessages.map((msg) => (
            <div key={msg.id} data-testid="chat-message" data-message-role={msg.role} className="flex items-start">
              {msg.role === 'assistant' ? (
                <>
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-medium">
                    AI
                  </div>
                  <div className="ml-3 flex-1">
                    <div className="bg-gray-100 rounded-lg p-3 inline-block max-w-2xl">
                      <p className="text-sm text-gray-900 whitespace-pre-wrap">{msg.content}</p>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {formatTime(msg.timestamp)}
                    </p>
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
                      {formatTime(msg.timestamp)}
                    </p>
                  </div>
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-gray-700 text-sm font-medium">
                    You
                  </div>
                </>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area (Phase Next-2: Enabled, Phase Next-4 Day1: Voice input added) */}
      <div className="border-t border-gray-200 p-4 bg-gray-50">
        {/* PR-D-FE-3: 添付画像プレビュー */}
        {attachedImages.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachedImages.map((file, index) => (
              <div key={`${file.name}-${index}`} className="relative group">
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  className="w-16 h-16 object-cover rounded-lg border border-gray-300"
                />
                <button
                  onClick={() => removeImage(index)}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label={`${file.name}を削除`}
                >
                  ×
                </button>
                <p className="text-[10px] text-gray-500 text-center truncate w-16">{file.name}</p>
              </div>
            ))}
          </div>
        )}
        {/* Hidden file input for image attachment */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          data-testid="chat-file-input"
        />
        <div className="flex items-center space-x-2">
          {/* PR-D-FE-3: 名刺画像添付ボタン */}
          <button
            data-testid="chat-attach-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing || attachedImages.length >= MAX_IMAGES}
            className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={`名刺画像を添付（最大${MAX_IMAGES}枚）`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          {/* Input field - 標準的なチャットUIに合わせて左側に配置 */}
          <input
            type="text"
            data-testid="chat-input"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={
              attachedImages.length > 0
                ? `📎 ${attachedImages.length}枚添付済み — 送信で名刺スキャン開始`
                : getPendingPlaceholder(pendingForThread || globalPendingAction)
                || (threadId ? "メッセージを入力..." : "メールアドレスを入力してスレッドを作成 (例: tanaka@example.com)")
            }
            disabled={isProcessing}
            className={`flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 ${
              attachedImages.length > 0 ? 'border-blue-400 bg-blue-50' :
              (pendingForThread || globalPendingAction) ? 'border-yellow-400 bg-yellow-50' : 'border-gray-300'
            }`}
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
          {/* PR-D-FE-3: 画像添付時はテキスト無しでも送信可能 */}
          <button
            data-testid="chat-send-button"
            onClick={handleSendClick}
            disabled={isProcessing || isVoiceProcessing || (!message.trim() && attachedImages.length === 0)}
            className={`px-4 py-2 text-white rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed ${
              attachedImages.length > 0 ? 'bg-green-600 hover:bg-green-700' :
              (pendingForThread || globalPendingAction) ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isProcessing ? '処理中...' : isVoiceProcessing ? '補正中...' : attachedImages.length > 0 ? '📷 スキャン' : (getPendingSendButtonLabel(pendingForThread || globalPendingAction) || '送信')}
          </button>
        </div>
        {/* PR-D-FE-1: SSOT ベースの pending ヒントバナー */}
        {(pendingForThread || globalPendingAction) && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2 mt-2">
            <p className="text-xs text-yellow-800">
              {getPendingHintBanner(pendingForThread || globalPendingAction) || '⚠️ 入力待ち'}
            </p>
          </div>
        )}
        <p className="text-xs text-gray-500 mt-2">
          💡 使い方: 「〇〇さんに日程調整送って」「状況教えて」「1番で確定して」 | 📎 名刺画像を添付してスキャン
        </p>
      </div>
    </div>
  );
}
