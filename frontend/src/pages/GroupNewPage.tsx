/**
 * Group New Page (1対N スレッド作成)
 * 
 * @see docs/plans/G1-PLAN.md
 */

import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { oneToManyApi, type OneToManyMode, type PrepareResponse } from '../core/api/oneToMany';
import { listsApi } from '../core/api';
import { contactsApi } from '../core/api/contacts';
import type { List, Contact } from '../core/models';

const MODE_OPTIONS: { value: OneToManyMode; label: string; description: string }[] = [
  { value: 'fixed', label: '固定日時', description: '1つの日時を決め打ちで送信' },
  { value: 'candidates', label: '候補から選択', description: '複数候補から参加者が選択' },
  { value: 'open_slots', label: '申込カレンダー', description: '空き枠を公開して申込を受付' },
];

// 大規模制限: 30人以上の場合の警告
const LARGE_SCALE_LIMIT = 30;

export function GroupNewPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<OneToManyMode>('candidates');
  const [deadlineHours, setDeadlineHours] = useState(72);
  
  // 招待者選択
  const [inviteeSource, setInviteeSource] = useState<'list' | 'contacts' | 'manual'>('list');
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [manualEmails, setManualEmails] = useState('');
  
  // リスト/連絡先データ
  const [lists, setLists] = useState<List[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  
  // スロット（候補日時）
  const [slots, setSlots] = useState<{ start_at: string; end_at: string; label: string }[]>([
    { start_at: '', end_at: '', label: '' },
  ]);
  
  // 準備結果
  const [prepareResult, setPrepareResult] = useState<PrepareResponse | null>(null);

  // リスト・連絡先をロード
  useEffect(() => {
    async function loadData() {
      try {
        setListsLoading(true);
        const [listsRes, contactsRes] = await Promise.all([
          listsApi.list(),
          contactsApi.list({ limit: 100 }),
        ]);
        setLists(listsRes.items || []);
        setContacts(contactsRes.items || []);
      } catch (err) {
        console.error('Failed to load lists/contacts:', err);
      } finally {
        setListsLoading(false);
      }
    }
    loadData();
  }, []);

  // 招待者数を計算（大規模警告用）
  const getInviteeCount = (): number => {
    if (inviteeSource === 'list' && selectedListId) {
      // TODO: リストのメンバー数を取得
      return 0;
    }
    if (inviteeSource === 'contacts') {
      return selectedContactIds.length;
    }
    if (inviteeSource === 'manual') {
      return manualEmails.split(/[\n,]/).filter(e => e.trim()).length;
    }
    return 0;
  };

  const inviteeCount = getInviteeCount();
  const isLargeScale = inviteeCount > LARGE_SCALE_LIMIT;

  // スロット追加/削除
  const addSlot = () => {
    setSlots([...slots, { start_at: '', end_at: '', label: '' }]);
  };

  const removeSlot = (index: number) => {
    setSlots(slots.filter((_, i) => i !== index));
  };

  const updateSlot = (index: number, field: string, value: string) => {
    const newSlots = [...slots];
    newSlots[index] = { ...newSlots[index], [field]: value };
    setSlots(newSlots);
  };

  // 準備（プレビュー）
  const handlePrepare = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('タイトルを入力してください');
      return;
    }

    // スロットのバリデーション（fixed/candidates は必須）
    if (['fixed', 'candidates'].includes(mode)) {
      const validSlots = slots.filter(s => s.start_at && s.end_at);
      if (validSlots.length === 0) {
        setError('少なくとも1つの日時候補を設定してください');
        return;
      }
    }

    // 大規模制限チェック
    if (isLargeScale && mode !== 'open_slots') {
      setError(`30人以上の場合は「申込カレンダー」モードを使用してください`);
      return;
    }

    try {
      setLoading(true);
      
      // スロットを ISO 形式に変換
      const validSlots = slots
        .filter(s => s.start_at && s.end_at)
        .map(s => ({
          start_at: new Date(s.start_at).toISOString(),
          end_at: new Date(s.end_at).toISOString(),
          label: s.label || undefined,
        }));

      const response = await oneToManyApi.prepare({
        title: title.trim(),
        description: description.trim() || undefined,
        mode,
        deadline_hours: deadlineHours,
        finalize_policy: 'organizer_decides',
        list_id: inviteeSource === 'list' ? selectedListId : undefined,
        contact_ids: inviteeSource === 'contacts' ? selectedContactIds : undefined,
        emails: inviteeSource === 'manual' 
          ? manualEmails.split(/[\n,]/).map(e => e.trim()).filter(Boolean)
          : undefined,
        slots: validSlots.length > 0 ? validSlots : undefined,
      });

      setPrepareResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  // 送信
  const handleSend = async () => {
    if (!prepareResult) return;

    try {
      setLoading(true);
      await oneToManyApi.send(prepareResult.thread.id, {
        invitees: prepareResult.invitees,
        channel_type: 'email',
      });
      navigate(`/group/${prepareResult.thread.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // 連絡先選択のトグル
  const toggleContact = (contactId: string) => {
    setSelectedContactIds(prev => 
      prev.includes(contactId) 
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          to="/group"
          className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block"
        >
          ← グループ予定調整一覧
        </Link>
        <h2 className="text-2xl font-bold text-gray-900">
          新規グループ予定調整
        </h2>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {!prepareResult ? (
        <form onSubmit={handlePrepare} className="space-y-6">
          {/* タイトル */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              タイトル <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="例: チーム定例ミーティング"
            />
          </div>

          {/* 説明 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              説明（任意）
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="予定の詳細など"
            />
          </div>

          {/* 方式 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              方式
            </label>
            <div className="space-y-2">
              {MODE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex items-start p-3 border rounded-md cursor-pointer ${
                    mode === option.value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="mode"
                    value={option.value}
                    checked={mode === option.value}
                    onChange={(e) => setMode(e.target.value as OneToManyMode)}
                    className="mt-0.5 mr-3"
                  />
                  <div>
                    <span className="font-medium">{option.label}</span>
                    <p className="text-sm text-gray-500">{option.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* 招待者選択 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              招待者
            </label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setInviteeSource('list')}
                className={`px-3 py-1 rounded-md text-sm ${
                  inviteeSource === 'list'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                リストから
              </button>
              <button
                type="button"
                onClick={() => setInviteeSource('contacts')}
                className={`px-3 py-1 rounded-md text-sm ${
                  inviteeSource === 'contacts'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                連絡先から
              </button>
              <button
                type="button"
                onClick={() => setInviteeSource('manual')}
                className={`px-3 py-1 rounded-md text-sm ${
                  inviteeSource === 'manual'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                メール直接入力
              </button>
            </div>

            {inviteeSource === 'list' && (
              <select
                value={selectedListId}
                onChange={(e) => setSelectedListId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">リストを選択...</option>
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            )}

            {inviteeSource === 'contacts' && (
              <div className="max-h-48 overflow-y-auto border border-gray-300 rounded-md p-2">
                {listsLoading ? (
                  <p className="text-gray-500 text-sm">読み込み中...</p>
                ) : contacts.length === 0 ? (
                  <p className="text-gray-500 text-sm">連絡先がありません</p>
                ) : (
                  contacts.map((contact) => (
                    <label
                      key={contact.id}
                      className="flex items-center p-2 hover:bg-gray-50 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedContactIds.includes(contact.id)}
                        onChange={() => toggleContact(contact.id)}
                        className="mr-2"
                      />
                      <span className="text-sm">
                        {contact.display_name || contact.email}
                        {contact.email && contact.display_name && (
                          <span className="text-gray-400 ml-1">({contact.email})</span>
                        )}
                      </span>
                    </label>
                  ))
                )}
              </div>
            )}

            {inviteeSource === 'manual' && (
              <textarea
                value={manualEmails}
                onChange={(e) => setManualEmails(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="メールアドレスを入力（カンマか改行で区切り）&#10;example1@email.com&#10;example2@email.com"
              />
            )}

            {/* 大規模警告 */}
            {isLargeScale && mode !== 'open_slots' && (
              <p className="mt-2 text-sm text-amber-600">
                ⚠️ 30人以上の場合は「申込カレンダー」モードの使用を推奨します
              </p>
            )}
          </div>

          {/* 日時候補（fixed/candidates の場合） */}
          {['fixed', 'candidates'].includes(mode) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                日時候補 <span className="text-red-500">*</span>
              </label>
              <div className="space-y-3">
                {slots.map((slot, index) => (
                  <div key={index} className="flex gap-2 items-start">
                    <div className="flex-1">
                      <input
                        type="datetime-local"
                        value={slot.start_at}
                        onChange={(e) => updateSlot(index, 'start_at', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        placeholder="開始"
                      />
                    </div>
                    <span className="py-2 text-gray-500">〜</span>
                    <div className="flex-1">
                      <input
                        type="datetime-local"
                        value={slot.end_at}
                        onChange={(e) => updateSlot(index, 'end_at', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        placeholder="終了"
                      />
                    </div>
                    {slots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSlot(index)}
                        className="p-2 text-gray-400 hover:text-red-500"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addSlot}
                className="mt-2 text-sm text-blue-600 hover:text-blue-700"
              >
                + 候補を追加
              </button>
            </div>
          )}

          {/* 締切 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              締切（回答期限）
            </label>
            <select
              value={deadlineHours}
              onChange={(e) => setDeadlineHours(Number(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            >
              <option value={24}>24時間後</option>
              <option value={48}>48時間後</option>
              <option value={72}>72時間後（3日）</option>
              <option value={168}>1週間後</option>
            </select>
          </div>

          {/* 送信ボタン */}
          <div className="flex gap-3 pt-4">
            <Link
              to="/group"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 text-center"
            >
              キャンセル
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? '準備中...' : '確認へ進む'}
            </button>
          </div>
        </form>
      ) : (
        /* 確認画面 */
        <div className="space-y-6">
          <div className="bg-gray-50 rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">内容を確認</h3>
            
            <dl className="space-y-3">
              <div>
                <dt className="text-sm font-medium text-gray-500">タイトル</dt>
                <dd className="text-sm text-gray-900">{prepareResult.thread.title}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">方式</dt>
                <dd className="text-sm text-gray-900">
                  {MODE_OPTIONS.find(o => o.value === prepareResult.thread.mode)?.label}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">招待者数</dt>
                <dd className="text-sm text-gray-900">{prepareResult.invitees_count}名</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">締切</dt>
                <dd className="text-sm text-gray-900">
                  {new Date(prepareResult.group_policy.deadline_at).toLocaleString('ja-JP')}
                </dd>
              </div>
            </dl>

            {/* 招待者リスト */}
            <div className="mt-4">
              <dt className="text-sm font-medium text-gray-500 mb-2">招待者</dt>
              <div className="max-h-40 overflow-y-auto bg-white border border-gray-200 rounded-md p-2">
                {prepareResult.invitees.map((invitee, i) => (
                  <div key={i} className="text-sm text-gray-700 py-1">
                    {invitee.name} ({invitee.email})
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setPrepareResult(null)}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              戻る
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={loading}
              className="flex-1 px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? '送信中...' : '招待を送信'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
