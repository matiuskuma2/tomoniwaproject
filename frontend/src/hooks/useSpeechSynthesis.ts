/**
 * useSpeechSynthesis - Web Speech API TTS カスタムフック
 * Phase Next-4 Day2: テキスト読み上げ機能
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export interface UseSpeechSynthesisResult {
  // State
  isSpeaking: boolean;
  isSupported: boolean;
  
  // Controls
  speak: (text: string) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
}

/**
 * Web Speech API を使ったテキスト読み上げカスタムフック
 * 
 * @returns {UseSpeechSynthesisResult} 読み上げの状態と制御関数
 */
export function useSpeechSynthesis(): UseSpeechSynthesisResult {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // ブラウザ対応チェック
  useEffect(() => {
    if ('speechSynthesis' in window) {
      setIsSupported(true);
      console.log('[TTS] Speech synthesis supported');
    } else {
      setIsSupported(false);
      console.log('[TTS] Speech synthesis not supported');
    }
  }, []);

  // テキスト読み上げ
  const speak = useCallback((text: string) => {
    if (!isSupported) {
      console.log('[TTS] Speech synthesis not supported');
      return;
    }

    // 既存の読み上げを停止
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }

    // 空文字チェック
    if (!text || text.trim().length === 0) {
      console.log('[TTS] Empty text, skipping');
      return;
    }

    try {
      // 新しい発話を作成
      const utterance = new SpeechSynthesisUtterance(text);
      utteranceRef.current = utterance;

      // 日本語設定
      utterance.lang = 'ja-JP';
      utterance.rate = 1.0; // 速度（0.1 - 10）
      utterance.pitch = 1.0; // 音程（0 - 2）
      utterance.volume = 1.0; // 音量（0 - 1）

      // イベントハンドラ
      utterance.onstart = () => {
        setIsSpeaking(true);
        console.log('[TTS] Started speaking');
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        console.log('[TTS] Finished speaking');
      };

      utterance.onerror = (event) => {
        setIsSpeaking(false);
        console.log('[TTS] Error:', event.error);
        
        // Safari で "interrupted" エラーが出る場合があるが、これは正常動作
        if (event.error !== 'interrupted' && event.error !== 'canceled') {
          console.error('[TTS] Unexpected error:', event.error);
        }
      };

      // 読み上げ開始
      window.speechSynthesis.speak(utterance);
      console.log('[TTS] Speaking:', text.substring(0, 50) + (text.length > 50 ? '...' : ''));
    } catch (error) {
      console.error('[TTS] Failed to speak:', error);
      setIsSpeaking(false);
    }
  }, [isSupported]);

  // 読み上げ停止
  const stop = useCallback(() => {
    if (!isSupported) return;

    try {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      console.log('[TTS] Stopped speaking');
    } catch (error) {
      console.error('[TTS] Failed to stop:', error);
    }
  }, [isSupported]);

  // 読み上げ一時停止
  const pause = useCallback(() => {
    if (!isSupported) return;

    try {
      window.speechSynthesis.pause();
      console.log('[TTS] Paused speaking');
    } catch (error) {
      console.error('[TTS] Failed to pause:', error);
    }
  }, [isSupported]);

  // 読み上げ再開
  const resume = useCallback(() => {
    if (!isSupported) return;

    try {
      window.speechSynthesis.resume();
      console.log('[TTS] Resumed speaking');
    } catch (error) {
      console.error('[TTS] Failed to resume:', error);
    }
  }, [isSupported]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (isSupported && window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      }
    };
  }, [isSupported]);

  return {
    isSpeaking,
    isSupported,
    speak,
    stop,
    pause,
    resume,
  };
}
