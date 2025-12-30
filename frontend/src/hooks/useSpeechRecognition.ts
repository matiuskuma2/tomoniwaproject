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

  // ブラウザ対応チェック
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (SpeechRecognition) {
      setIsSupported(true);
      recognitionRef.current = new SpeechRecognition();
      
      const recognition = recognitionRef.current;
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
      
      // エラーイベント
      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error);
        
        let errorMessage = '音声認識でエラーが発生しました。';
        
        switch (event.error) {
          case 'not-allowed':
          case 'permission-denied':
            errorMessage = '🎤 マイクへのアクセスが拒否されました。ブラウザの設定でマイクの使用を許可してください。';
            break;
          case 'no-speech':
            errorMessage = '音声が検出されませんでした。もう一度お試しください。';
            break;
          case 'aborted':
            errorMessage = '音声認識が中断されました。';
            break;
          case 'audio-capture':
            errorMessage = 'マイクが見つかりませんでした。マイクが接続されているか確認してください。';
            break;
          case 'network':
            errorMessage = 'ネットワークエラーが発生しました。接続を確認してください。';
            break;
          default:
            errorMessage = `音声認識エラー: ${event.error}`;
        }
        
        setError(errorMessage);
        setIsListening(false);
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
    } else {
      setIsSupported(false);
      setError('⚠️ お使いのブラウザは音声認識に対応していません。Chrome、Edge、Safari などの最新ブラウザをお使いください。');
    }
    
    // クリーンアップ
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  // 音声認識開始
  const startListening = useCallback(() => {
    if (!recognitionRef.current || !isSupported) {
      setError('音声認識がサポートされていません。');
      return;
    }
    
    try {
      setError(null);
      recognitionRef.current.start();
    } catch (err) {
      console.error('Failed to start recognition:', err);
      if (err instanceof Error && err.message.includes('already started')) {
        // すでに起動中の場合は無視
        return;
      }
      setError('音声認識の開始に失敗しました。');
    }
  }, [isSupported]);

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
