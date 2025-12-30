/**
 * VoiceRecognitionButton - 音声認識ボタンコンポーネント
 * Phase Next-4 Day1: 🎤ボタンで音声認識を開始/停止
 * Phase Next-4 Day1.5: Gemini補正機能の追加
 * エラー表示なし - サイレントエラーハンドリング
 */

import { useEffect } from 'react';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { voiceApi } from '../../core/api';

interface VoiceRecognitionButtonProps {
  onTranscriptUpdate: (transcript: string) => void;
  disabled?: boolean;
}

/**
 * 音声認識ボタン
 * - 🎤ボタンをクリックして音声認識を開始/停止
 * - 認識結果はリアルタイムで親コンポーネントに通知
 * - エラー発生時はエラーメッセージを表示
 */
export function VoiceRecognitionButton({ onTranscriptUpdate, disabled = false }: VoiceRecognitionButtonProps) {
  const {
    isListening,
    transcript,
    isSupported,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition();

  // トランスクリプト更新時にGemini補正を実行してから親コンポーネントに通知
  useEffect(() => {
    if (transcript) {
      // Gemini補正を非同期で実行
      const correctAndUpdate = async () => {
        try {
          console.log('[Voice] Original transcript:', transcript);
          
          // Gemini APIで補正
          const result = await voiceApi.correct(transcript);
          
          console.log('[Voice] Corrected transcript:', result.corrected);
          
          // 補正後のテキストを親に渡す
          onTranscriptUpdate(result.corrected);
        } catch (error) {
          console.error('[Voice] Correction failed, using original:', error);
          // エラー時は元のテキストを使用
          onTranscriptUpdate(transcript);
        }
        
        // 親に渡したらリセット
        resetTranscript();
      };
      
      correctAndUpdate();
    }
  }, [transcript, onTranscriptUpdate, resetTranscript]);

  // ボタンクリックハンドラ
  const handleClick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  // サポート外の場合は非表示（エラー表示なし）
  if (!isSupported) {
    return null;
  }

  return (
    <div className="relative">
      {/* 音声認識ボタン - コンパクトなデザイン */}
      <button
        onClick={handleClick}
        disabled={disabled}
        className={`
          flex items-center justify-center flex-shrink-0
          w-10 h-10 rounded-full
          transition-all duration-200
          ${isListening
            ? 'bg-red-500 hover:bg-red-600 animate-pulse'
            : 'bg-gray-100 hover:bg-gray-200'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${isListening ? 'text-white' : 'text-gray-600'}
          border border-gray-300
        `}
        title={isListening ? '音声認識を停止' : '音声認識を開始'}
      >
        {isListening ? (
          // 録音中アイコン（停止ボタン）
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <rect x="7" y="7" width="6" height="6" rx="1" />
          </svg>
        ) : (
          // マイクアイコン
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" />
          </svg>
        )}
      </button>

      {/* リスニング状態表示 - ボタン上部に絶対配置 */}
      {isListening && (
        <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
          <div className="text-xs text-red-600 font-medium flex items-center gap-1 bg-white px-2 py-1 rounded-full shadow-sm border border-red-200">
            <span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
            聞いています
          </div>
        </div>
      )}

      {/* エラー表示は不要 - サイレントに処理 */}
    </div>
  );
}
