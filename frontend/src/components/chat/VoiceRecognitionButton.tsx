/**
 * VoiceRecognitionButton - 音声認識ボタンコンポーネント
 * Phase Next-4 Day1: 🎤ボタンで音声認識を開始/停止
 */

import { useEffect } from 'react';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';

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
    interimTranscript,
    error,
    isSupported,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition();

  // トランスクリプト更新時に親コンポーネントに通知
  useEffect(() => {
    if (transcript) {
      onTranscriptUpdate(transcript);
      resetTranscript(); // 親に渡したらリセット
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

  // サポート外の場合は非表示
  if (!isSupported) {
    return (
      <div className="text-xs text-red-600 p-2 bg-red-50 rounded border border-red-200">
        ⚠️ お使いのブラウザは音声認識に対応していません
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 音声認識ボタン */}
      <button
        onClick={handleClick}
        disabled={disabled}
        className={`
          flex items-center justify-center
          w-10 h-10 rounded-full
          transition-all duration-200
          ${isListening
            ? 'bg-red-500 hover:bg-red-600 animate-pulse'
            : 'bg-blue-500 hover:bg-blue-600'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          text-white shadow-md hover:shadow-lg
        `}
        title={isListening ? '音声認識を停止' : '音声認識を開始'}
      >
        {isListening ? (
          // 録音中アイコン
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

      {/* リスニング状態表示 */}
      {isListening && (
        <div className="text-xs text-gray-600 flex items-center gap-1">
          <span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
          聞いています...
        </div>
      )}

      {/* 途中結果表示（デバッグ用・任意） */}
      {interimTranscript && (
        <div className="text-xs text-gray-500 italic">
          {interimTranscript}
        </div>
      )}

      {/* エラーメッセージ */}
      {error && (
        <div className="text-xs text-red-600 p-2 bg-red-50 rounded border border-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
