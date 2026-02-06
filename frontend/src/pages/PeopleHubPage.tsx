/**
 * People Hub Page - P1 SSOT統合UI
 * 
 * People中心の統合ビュー（連絡先/リスト/つながりを1画面で管理）
 * 
 * 設計原則:
 * - SSOT: GET /api/people で統合データ取得
 * - UIは監査専用: 登録はチャット経由
 * - 1人=1行: person_keyで重複排除
 * - email必須警告: リスト招待の成立を保証
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  peopleApi,
  getConnectionStatusLabel,
  getConnectionStatusBadgeClass,
  listsApi,
  type Person,
  type ConnectionStatus,
  type PeopleListResponse,
  type AuditSummary,
} from '../core/api';
import type { List } from '../core/models';
import { getLists, subscribeLists } from '../core/cache';

// ============================================================
// Types
// ============================================================

type FilterType = 'all' | ConnectionStatus;

// ============================================================
// Connection Badge Component
// ============================================================

interface ConnectionBadgeProps {
  status: ConnectionStatus;
  showExternal?: boolean;
}

function ConnectionBadge({ status, showExternal = false }: ConnectionBadgeProps) {
  if (status === 'external' && !showExternal) {
    return null;
  }
  
  const label = getConnectionStatusLabel(status);
  const colorClass = getConnectionStatusBadgeClass(status);
  
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${colorClass}`}>
      {label}
    </span>
  );
}

// ============================================================
// Email Warning Badge
// ============================================================

function EmailWarningBadge({ hasEmail }: { hasEmail: boolean }) {
  if (hasEmail) return null;
  
  return (
    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800">
      ⚠️ メール未設定
    </span>
  );
}

// ============================================================
// List Tags Component
// ============================================================

function ListTags({ lists }: { lists: { list_id: string; list_name: string }[] }) {
  if (lists.length === 0) return null;
  
  const displayLists = lists.slice(0, 2);
  const remaining = lists.length - 2;
  
  return (
    <div className="flex gap-1 flex-wrap">
      {displayLists.map((list) => (
        <span
          key={list.list_id}
          className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-800"
        >
          {list.list_name}
        </span>
      ))}
      {remaining > 0 && (
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
          +{remaining}
        </span>
      )}
    </div>
  );
}

// ============================================================
// Audit Banner Component
// ============================================================

interface AuditBannerProps {
  audit: AuditSummary | null;
  loading: boolean;
}

function AuditBanner({ audit, loading }: AuditBannerProps) {
  if (loading || !audit) {
    return null;
  }
  
  const hasIssues = audit.missing_email_count > 0 || audit.pending_request_count > 0;
  
  if (!hasIssues) {
    return null;
  }
  
  return (
    <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
      <h3 className="text-sm font-medium text-amber-800 mb-2">⚠️ 注意が必要な項目</h3>
      <ul className="text-sm text-amber-700 space-y-1">
        {audit.missing_email_count > 0 && (
          <li>
            • {audit.missing_email_count}人がメール未設定です（一括招待できません）
          </li>
        )}
        {audit.pending_request_count > 0 && (
          <li>
            • {audit.pending_request_count}件のつながり申請が保留中です
          </li>
        )}
      </ul>
    </div>
  );
}

// ============================================================
// Chat Modal Component
// ============================================================

interface ChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: () => void;
}

function ChatModal({ isOpen, onClose, onNavigate }: ChatModalProps) {
  if (!isOpen) return null;
  
  const examples = [
    '田中太郎さん（tanaka@example.com）を連絡先に追加して',
    '名刺を取り込みたい',
    '営業チームのリストを作成して',
    '山田さんを仕事仲間として登録したい',
  ];
  
  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900">
            💬 チャットで追加
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500"
          >
            ✕
          </button>
        </div>
        
        <p className="text-sm text-gray-600 mb-4">
          連絡先の追加・名刺の取り込み・リストの作成は、チャットで行うと安全です。
          AIアシスタントが確認しながら正確に登録します。
        </p>
        
        <div className="bg-gray-50 rounded-lg p-4 mb-4">
          <p className="text-xs text-gray-500 mb-2">例：</p>
          <ul className="space-y-2">
            {examples.map((example, i) => (
              <li key={i} className="text-sm text-gray-700">
                「{example}」
              </li>
            ))}
          </ul>
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            onClick={onNavigate}
            className="flex-1 px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            チャットを開く
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// List Filter Dropdown
// ============================================================

interface ListFilterProps {
  lists: List[];
  selectedListId: string | null;
  onSelect: (listId: string | null) => void;
}

function ListFilterDropdown({ lists, selectedListId, onSelect }: ListFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const selectedList = lists.find(l => l.id === selectedListId);
  
  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`px-3 py-1 text-sm rounded-full flex items-center gap-1 ${
          selectedListId
            ? 'bg-purple-600 text-white'
            : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
        }`}
      >
        📋 {selectedList?.name || 'リスト'}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {isOpen && (
        <div className="absolute mt-1 w-48 bg-white rounded-md shadow-lg z-10 border">
          <ul className="py-1">
            <li>
              <button
                onClick={() => {
                  onSelect(null);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-4 py-2 text-sm ${
                  !selectedListId ? 'bg-purple-50 text-purple-700' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                すべてのリスト
              </button>
            </li>
            {lists.map((list) => (
              <li key={list.id}>
                <button
                  onClick={() => {
                    onSelect(list.id);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-sm ${
                    selectedListId === list.id ? 'bg-purple-50 text-purple-700' : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {list.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main Page
// ============================================================

export function PeopleHubPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // State
  const [people, setPeople] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  const [audit, setAudit] = useState<AuditSummary | null>(null);
  const [auditLoading, setAuditLoading] = useState(true);
  const [showChatModal, setShowChatModal] = useState(false);
  
  // Pagination
  const [offset, setOffset] = useState(0);
  const limit = 50;
  
  // Load lists for filter dropdown
  useEffect(() => {
    const loadLists = async () => {
      try {
        const items = await getLists();
        setLists(items);
      } catch (err) {
        console.error('Failed to load lists:', err);
      }
    };
    loadLists();
    
    const unsubscribe = subscribeLists((updatedLists) => {
      if (updatedLists) setLists(updatedLists);
    });
    return unsubscribe;
  }, []);
  
  // Load audit summary
  useEffect(() => {
    const loadAudit = async () => {
      try {
        setAuditLoading(true);
        const summary = await peopleApi.getAudit();
        setAudit(summary);
      } catch (err) {
        console.error('Failed to load audit:', err);
      } finally {
        setAuditLoading(false);
      }
    };
    loadAudit();
  }, []);
  
  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setOffset(0); // Reset pagination on search
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  
  // Load people
  const loadPeople = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response: PeopleListResponse = await peopleApi.list({
        q: debouncedQuery || undefined,
        connection_status: filter !== 'all' ? filter : undefined,
        list_id: selectedListId || undefined,
        limit,
        offset,
      });
      
      setPeople(response.items);
      setTotal(response.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, filter, selectedListId, offset]);
  
  useEffect(() => {
    loadPeople();
  }, [loadPeople]);
  
  // Handle filter change
  const handleFilterChange = (newFilter: FilterType) => {
    setFilter(newFilter);
    setOffset(0);
  };
  
  // Handle list filter change
  const handleListFilterChange = (listId: string | null) => {
    setSelectedListId(listId);
    setOffset(0);
  };
  
  // Pagination
  const hasMore = offset + limit < total;
  const hasPrevious = offset > 0;
  
  const handleNextPage = () => {
    if (hasMore) {
      setOffset(offset + limit);
    }
  };
  
  const handlePreviousPage = () => {
    if (hasPrevious) {
      setOffset(Math.max(0, offset - limit));
    }
  };
  
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="md:flex md:items-center md:justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:text-3xl sm:truncate">
              👥 People
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {total > 0 ? `${total}人` : ''} • 連絡先・リスト・つながりの一元管理
            </p>
          </div>
          <div className="mt-4 flex md:mt-0 md:ml-4 gap-2">
            <button
              onClick={() => navigate('/relationships/request')}
              className="inline-flex items-center px-4 py-2 border border-blue-600 rounded-md text-sm font-medium text-blue-600 bg-white hover:bg-blue-50"
            >
              🤝 つながり申請
            </button>
            <button
              onClick={() => setShowChatModal(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              💬 チャットで追加
            </button>
          </div>
        </div>
      </div>

      {/* Audit Banner */}
      <AuditBanner audit={audit} loading={auditLoading} />

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="名前、メールアドレスで検索..."
            className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          />
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-2 items-center">
        <span className="text-sm text-gray-500 mr-2">フィルター:</span>
        
        {/* Connection status filters */}
        {[
          { value: 'all' as const, label: 'すべて' },
          { value: 'workmate' as const, label: '仕事仲間' },
          { value: 'family' as const, label: '家族' },
          { value: 'external' as const, label: '外部' },
          { value: 'pending' as const, label: '申請中' },
        ].map(({ value, label }) => (
          <button
            key={value}
            onClick={() => handleFilterChange(value)}
            className={`px-3 py-1 text-sm rounded-full ${
              filter === value
                ? value === 'all' 
                  ? 'bg-gray-800 text-white'
                  : getConnectionStatusBadgeClass(value).replace('bg-', 'bg-').replace('100', '600').replace('text-', 'text-white ').replace('800', '')
                : value === 'all'
                  ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  : getConnectionStatusBadgeClass(value) + ' hover:opacity-80'
            }`}
          >
            {label}
          </button>
        ))}
        
        {/* List filter dropdown */}
        {lists.length > 0 && (
          <ListFilterDropdown
            lists={lists}
            selectedListId={selectedListId}
            onSelect={handleListFilterChange}
          />
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {/* Empty State */}
      {!loading && people.length === 0 && (
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
            <span className="text-2xl">👥</span>
          </div>
          <p className="text-gray-500">
            {debouncedQuery || filter !== 'all' || selectedListId
              ? '条件に一致する人がいません'
              : '連絡先がありません'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            チャットで名刺を取り込むか、連絡先を追加してください
          </p>
          <button
            onClick={() => setShowChatModal(true)}
            className="mt-4 px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            チャットで追加 →
          </button>
        </div>
      )}

      {/* People List */}
      {!loading && people.length > 0 && (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <ul className="divide-y divide-gray-200">
            {people.map((person) => (
              <li key={person.person_key} className="px-4 py-4 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    {/* Name + Badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {person.display_name || '(名前未設定)'}
                      </p>
                      <ConnectionBadge status={person.connection_status} showExternal />
                      <EmailWarningBadge hasEmail={person.has_email} />
                      {person.is_app_user && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-100 text-indigo-800">
                          アプリユーザー
                        </span>
                      )}
                    </div>
                    
                    {/* Email */}
                    {person.email && (
                      <p className="text-sm text-gray-500 truncate mt-1">{person.email}</p>
                    )}
                    
                    {/* List Tags */}
                    {person.lists.length > 0 && (
                      <div className="mt-2">
                        <ListTags lists={person.lists} />
                      </div>
                    )}
                  </div>
                  
                  {/* Actions */}
                  <div className="ml-4 flex-shrink-0 flex gap-2">
                    {person.is_app_user && person.connection_status !== 'pending' && person.connection_status !== 'blocked' && (
                      <button
                        onClick={() => navigate(`/scheduling/internal?with=${person.person_id}`)}
                        className="px-3 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 rounded hover:bg-blue-50"
                      >
                        日程調整
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pagination */}
      {!loading && people.length > 0 && (hasPrevious || hasMore) && (
        <div className="mt-4 flex justify-between items-center">
          <button
            onClick={handlePreviousPage}
            disabled={!hasPrevious}
            className={`px-4 py-2 text-sm font-medium rounded-md ${
              hasPrevious
                ? 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
                : 'text-gray-400 bg-gray-100 border border-gray-200 cursor-not-allowed'
            }`}
          >
            ← 前へ
          </button>
          <span className="text-sm text-gray-500">
            {offset + 1} - {Math.min(offset + limit, total)} / {total}人
          </span>
          <button
            onClick={handleNextPage}
            disabled={!hasMore}
            className={`px-4 py-2 text-sm font-medium rounded-md ${
              hasMore
                ? 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
                : 'text-gray-400 bg-gray-100 border border-gray-200 cursor-not-allowed'
            }`}
          >
            次へ →
          </button>
        </div>
      )}

      {/* Chat Modal */}
      <ChatModal
        isOpen={showChatModal}
        onClose={() => setShowChatModal(false)}
        onNavigate={() => {
          setShowChatModal(false);
          navigate('/chat');
        }}
      />
    </div>
  );
}
