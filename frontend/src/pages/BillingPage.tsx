/**
 * Day3-2: /settings/billing（最小実装）
 * 
 * 目的: UXの安心感のみ（課金ロジックは増やさない）
 * 表示項目: tier / amount / status / source
 * 文言: 「決済反映に数分かかることがあります」
 * スマホ崩れない
 * 
 * やらないこと:
 * - プラン変更導線
 * - 再課金ボタン
 * - 複雑な説明
 */

import { useState, useEffect } from 'react';

interface BillingInfo {
  tier: 'free' | 'pro' | 'team' | 'enterprise';
  amount: number;
  status: number;
  last_event_ts: string | null;
  updated_at: string | null;
  source: 'default_free' | 'myasp';
}

const TIER_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  team: 'Team',
  enterprise: 'Enterprise',
};

const STATUS_LABELS: Record<number, string> = {
  1: '有効',
  2: '停止中',
  3: '有効',
  4: '解約済み',
};

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBillingInfo();
  }, []);

  const fetchBillingInfo = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/billing/me', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('課金情報の取得に失敗しました');
      }

      const data = await response.json();
      setBilling(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラー');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-gray-600">読み込み中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-md p-6 max-w-md w-full">
          <div className="text-red-600 font-medium mb-2">エラー</div>
          <div className="text-gray-700">{error}</div>
        </div>
      </div>
    );
  }

  if (!billing) {
    return null;
  }

  const tierLabel = TIER_LABELS[billing.tier] || billing.tier;
  const statusLabel = STATUS_LABELS[billing.status] || '不明';
  const isSuspended = billing.status === 2 || billing.status === 4;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto">
        {/* ヘッダー */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">課金情報</h1>
          <p className="text-sm text-gray-600">
            現在のプランと課金状態を確認できます
          </p>
        </div>

        {/* 反映待ちの注意書き */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-blue-600 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">決済反映について</p>
              <p>決済反映に数分かかることがあります。最新の情報が表示されるまでお待ちください。</p>
            </div>
          </div>
        </div>

        {/* 課金情報カード */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="p-6">
            {/* プラン */}
            <div className="mb-6">
              <div className="text-sm text-gray-600 mb-1">現在のプラン</div>
              <div className="flex items-baseline">
                <span className="text-3xl font-bold text-gray-900">{tierLabel}</span>
                {billing.amount > 0 && (
                  <span className="ml-3 text-lg text-gray-600">
                    ¥{billing.amount.toLocaleString()} / 月
                  </span>
                )}
              </div>
            </div>

            {/* ステータス */}
            <div className="mb-6">
              <div className="text-sm text-gray-600 mb-2">ステータス</div>
              <div className="flex items-center">
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                    isSuspended
                      ? 'bg-red-100 text-red-800'
                      : 'bg-green-100 text-green-800'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full mr-2 ${
                      isSuspended ? 'bg-red-600' : 'bg-green-600'
                    }`}
                  ></span>
                  {statusLabel}
                </span>
              </div>
            </div>

            {/* 停止中の警告 */}
            {isSuspended && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <div className="flex items-start">
                  <svg className="w-5 h-5 text-red-600 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div className="text-sm text-red-800">
                    <p className="font-medium mb-1">課金が{statusLabel}です</p>
                    <p>一部の機能（スレッドの確定・リマインド送信など）が制限されています。閲覧や提案の作成は可能です。</p>
                  </div>
                </div>
              </div>
            )}

            {/* 課金ソース */}
            <div className="border-t border-gray-200 pt-4">
              <div className="text-xs text-gray-500">
                課金元: {billing.source === 'myasp' ? 'MyASP連携' : 'デフォルト（Free）'}
              </div>
              {billing.last_event_ts && (
                <div className="text-xs text-gray-500 mt-1">
                  最終更新: {new Date(billing.last_event_ts).toLocaleString('ja-JP')}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Freeプランの場合の案内 */}
        {billing.tier === 'free' && (
          <div className="mt-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="text-sm text-gray-700">
              <p className="font-medium mb-2">Freeプランをご利用中です</p>
              <p>有料プランへのアップグレードについては、運営にお問い合わせください。</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
