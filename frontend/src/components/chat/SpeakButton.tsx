/**
 * SpeakButton - テキスト読み上げボタンコンポーネント
 * Phase Next-4 Day2: 🔊ボタンでテキストを音声で読み上げ
 */

import { useSpeechSynthesis } from '../../hooks/useSpeechSynthesis';

interface SpeakButtonProps {
  text: string;
  disabled?: boolean;
}

/**
 * テキスト読み上げボタン
 * - 🔊ボタンをクリックしてテキストを読み上げ
 * - 読み上げ中は停止ボタンに変わる
 * - エラーはサイレント処理（コンソールログのみ）
 */
export function SpeakButton({ text, disabled = false }: SpeakButtonProps) {
  const { isSpeaking, isSupported, speak, stop } = useSpeechSynthesis();

  // サポート外の場合は非表示
  if (!isSupported) {
    return null;
  }

  // ボタンクリックハンドラ
  const handleClick = () => {
    if (isSpeaking) {
      stop();
    } else {
      speak(text);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`
        flex items-center justify-center
        w-8 h-8 rounded-full
        transition-all duration-200
        ${isSpeaking
          ? 'bg-blue-500 hover:bg-blue-600'
          : 'bg-gray-100 hover:bg-gray-200'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${isSpeaking ? 'text-white' : 'text-gray-600'}
        border border-gray-300
      `}
      title={isSpeaking ? '読み上げ停止' : '読み上げ'}
    >
      {isSpeaking ? (
        // 読み上げ中アイコン（停止ボタン）
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <rect x="6" y="6" width="8" height="8" rx="1" />
        </svg>
      ) : (
        // スピーカーアイコン
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 3.75a.75.75 0 00-1.264-.546L4.703 7H3.167a.75.75 0 00-.7.48A10.38 10.38 0 002 10c0 .838.1 1.653.286 2.437a.75.75 0 00.7.48h1.535l4.033 3.796A.75.75 0 0010 16.25V3.75zM13.373 5.122a.75.75 0 011.06.006 9.5 9.5 0 010 13.744.75.75 0 11-1.066-1.06 8 8 0 000-11.624.75.75 0 01.006-1.06zm2.828 2.829a.75.75 0 011.06 0 5.5 5.5 0 010 7.778.75.75 0 01-1.06-1.06 4 4 0 000-5.658.75.75 0 010-1.06z" />
        </svg>
      )}
    </button>
  );
}
