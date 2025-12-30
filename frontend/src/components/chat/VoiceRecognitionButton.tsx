/**
 * VoiceRecognitionButton - 音声認識ボタンコンポーネント
 * Phase Next-4 Day1: 🎤ボタンで音声認識を開始/停止
 */

import { useEffect, useState } from 'react';
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
    error,
    isSupported,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition();

  // エラー表示状態を管理（ユーザーが閉じられるように）
  const [showError, setShowError] = useState(false);

  // トランスクリプト更新時に親コンポーネントに通知
  useEffect(() => {
    if (transcript) {
      onTranscriptUpdate(transcript);
      resetTranscript(); // 親に渡したらリセット
    }
  }, [transcript, onTranscriptUpdate, resetTranscript]);

  // エラー発生時にエラー表示をONにする
  useEffect(() => {
    if (error) {
      setShowError(true);
    }
  }, [error]);

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

      {/* エラーメッセージ - ボタン上部に表示（×ボタンで閉じられる） */}
      {showError && error && (
        <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 w-72 z-50">
          <div className="relative text-xs text-red-600 p-3 bg-red-50 rounded-lg border border-red-200 shadow-lg">
            {/* 閉じるボタン */}
            <button
              onClick={() => setShowError(false)}
              className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-100 rounded-full transition-colors"
              title="閉じる"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            {/* エラーメッセージ */}
            <div className="pr-4">
              {error}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
