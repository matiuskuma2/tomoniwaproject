/**
 * useSpeechRecognition - Web Speech API カスタムフック
 * Phase Next-4 Day1: 音声認識機能をChatPaneに統合
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// Web Speech API型定義（TypeScriptビルトインにない場合の補完）
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: ISpeechRecognition, ev: Event) => any) | null;
  onend: ((this: ISpeechRecognition, ev: Event) => any) | null;
  onresult: ((this: ISpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onerror: ((this: ISpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
}

interface ISpeechRecognitionConstructor {
  new (): ISpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: ISpeechRecognitionConstructor;
    webkitSpeechRecognition?: ISpeechRecognitionConstructor;
  }
}

export interface UseSpeechRecognitionResult {
  // State
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  isSupported: boolean;
  
  // Controls
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
}

/**
 * Web Speech API を使った音声認識カスタムフック
 * 
 * @returns {UseSpeechRecognitionResult} 音声認識の状態と制御関数
 */
export function useSpeechRecognition(): UseSpeechRecognitionResult {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const SpeechRecognitionConstructor = useRef<ISpeechRecognitionConstructor | null>(null);
  const permissionDeniedRef = useRef(false); // 権限拒否フラグ

  // SpeechRecognition インスタンスを初期化する関数
  const initializeRecognition = useCallback(() => {
    if (!SpeechRecognitionConstructor.current) {
      return null;
    }

    const recognition = new SpeechRecognitionConstructor.current();
    recognition.continuous = true; // 連続認識
    recognition.interimResults = true; // 途中結果を取得
    recognition.lang = 'ja-JP'; // 日本語
    
    // 認識結果イベント
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcriptPart = result[0].transcript;
        
        if (result.isFinal) {
          final += transcriptPart;
        } else {
          interim += transcriptPart;
        }
      }
      
      if (final) {
        setTranscript(prev => prev + final);
      }
      setInterimTranscript(interim);
      setError(null);
    };
    
    // エラーイベント - サイレント処理（UI上にエラーを表示しない）
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // コンソールにログだけ残す（デバッグ用）
      console.log('[Voice Recognition]', event.error);
      
      // エラー種別によって処理を分ける
      switch (event.error) {
        case 'not-allowed':
        case 'permission-denied':
          // 権限拒否フラグを立てる
          console.log('[Voice Recognition] Permission denied. Will create new instance on next start.');
          permissionDeniedRef.current = true;
          break;
        case 'no-speech':
          // 音声なし - 自動停止（正常動作）
          console.log('[Voice Recognition] No speech detected.');
          break;
        case 'aborted':
          // 中断 - ユーザーが停止ボタンを押した場合など
          console.log('[Voice Recognition] Aborted.');
          break;
        case 'audio-capture':
          // マイクが見つからない
          console.log('[Voice Recognition] No microphone found.');
          break;
        case 'network':
          // ネットワークエラー
          console.log('[Voice Recognition] Network error.');
          break;
        default:
          console.log('[Voice Recognition] Unknown error:', event.error);
      }
      
      // エラー表示はせず、リスニング状態だけ解除
      setIsListening(false);
      setError(null); // エラー状態をクリア（常にnull）
    };
    
    // 認識終了イベント
    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
    };
    
    // 認識開始イベント
    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    return recognition;
  }, []);

  // ブラウザ対応チェック
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (SpeechRecognition) {
      setIsSupported(true);
      SpeechRecognitionConstructor.current = SpeechRecognition;
      recognitionRef.current = initializeRecognition();
    } else {
      setIsSupported(false);
      // エラー表示はしない（コンソールログのみ）
      console.log('[Voice Recognition] Browser not supported. SpeechRecognition API is not available.');
    }
    
    // クリーンアップ
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, [initializeRecognition]);

  // 音声認識開始
  const startListening = useCallback(() => {
    if (!isSupported) {
      console.log('[Voice Recognition] Cannot start: not supported.');
      return;
    }
    
    // 権限拒否された後、または既存のインスタンスがない場合は新しいインスタンスを作成
    if (permissionDeniedRef.current || !recognitionRef.current) {
      console.log('[Voice Recognition] Creating new instance for retry or initialization.');
      
      // 古いインスタンスがあれば破棄
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // abort が失敗しても無視
        }
      }
      
      // 新しいインスタンスを作成
      recognitionRef.current = initializeRecognition();
      permissionDeniedRef.current = false; // フラグをリセット
    }
    
    if (!recognitionRef.current) {
      console.log('[Voice Recognition] Failed to create recognition instance.');
      return;
    }
    
    try {
      recognitionRef.current.start();
      console.log('[Voice Recognition] Started successfully.');
    } catch (err) {
      console.log('[Voice Recognition] Failed to start:', err);
      if (err instanceof Error && err.message.includes('already started')) {
        // すでに起動中の場合は無視（正常動作）
        return;
      }
      // 他のエラーの場合は次回再試行のためフラグを立てる
      permissionDeniedRef.current = true;
    }
  }, [isSupported, initializeRecognition]);

  // 音声認識停止
  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    
    try {
      recognitionRef.current.stop();
    } catch (err) {
      console.error('Failed to stop recognition:', err);
    }
  }, []);

  // トランスクリプトリセット
  const resetTranscript = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
    setError(null);
  }, []);

  return {
    isListening,
    transcript,
    interimTranscript,
    error,
    isSupported,
    startListening,
    stopListening,
    resetTranscript,
  };
}
