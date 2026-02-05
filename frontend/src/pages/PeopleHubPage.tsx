/**
 * People Hub Page - P1 SSOT統合UI
 * 
 * 連絡先 / リスト / つながり を単一ページで管理
 * 
 * 設計原則:
 * - SSOT: contacts テーブルが台帳
 * - UIは監査専用: 登録はチャット経由
 * - email必須化: 一括招待の成立を保証
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { contactsApi, listsApi } from '../core/api';
import { 
  relationshipsApi,
  getRelationTypeLabel, 
  getRelationTypeBadgeClass,
  type RelationType,
  type Relationship,
} from '../core/api/relationships';
import { 
  getRelationshipMap,
  invalidateRelationships,
  type RelationshipInfo 
} from '../core/cache/relationshipsCache';
import { getLists, subscribeLists } from '../core/cache';
import type { Contact, List, ListMember } from '../core/models';

// ============================================================
// Types
// ============================================================

type TabId = 'contacts' | 'lists' | 'relations';

interface TabConfig {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabConfig[] = [
  { id: 'contacts', label: '連絡先', icon: '👤' },
  { id: 'lists', label: 'リスト', icon: '📋' },
  { id: 'relations', label: 'つながり', icon: '🤝' },
];

// ============================================================
// Relationship Badge Component
// ============================================================

interface RelationshipBadgeProps {
  relationType: RelationType;
  showStranger?: boolean;
}

function RelationshipBadge({ relationType, showStranger = false }: RelationshipBadgeProps) {
  if (relationType === 'stranger' && !showStranger) {
    return null;
  }
  
  const label = getRelationTypeLabel(relationType);
  const colorClass = getRelationTypeBadgeClass(relationType);
  
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
// Contacts Tab
// ============================================================

interface ContactsTabProps {
  searchQuery: string;
}

function ContactsTab({ searchQuery }: ContactsTabProps) {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [relationshipMap, setRelationshipMap] = useState<Map<string, RelationshipInfo>>(new Map());

  const loadContacts = useCallback(async () => {
    try {
      setLoading(true);
      const [contactsRes, relMap] = await Promise.all([
        contactsApi.list({ q: searchQuery || undefined, limit: 100 }),
        getRelationshipMap(),
      ]);
      setContacts(contactsRes.items || []);
      setRelationshipMap(relMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const getContactRelationType = (contact: Contact): RelationType => {
    if (contact.user_id) {
      const info = relationshipMap.get(contact.user_id);
      if (info) return info.relation_type;
    }
    if (contact.relationship_type === 'family') return 'family';
    if (contact.relationship_type === 'coworker') return 'workmate';
    return 'stranger';
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
        {error}
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
          <span className="text-2xl">👤</span>
        </div>
        <p className="text-gray-500">連絡先がありません</p>
        <p className="text-sm text-gray-400 mt-1">チャットで名刺を取り込むか、連絡先を追加してください</p>
        <button
          onClick={() => navigate('/chat')}
          className="mt-4 px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          チャットで追加 →
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <ul className="divide-y divide-gray-200">
        {contacts.map((contact) => {
          const relationType = getContactRelationType(contact);
          
          return (
            <li key={contact.id} className="px-4 py-4 hover:bg-gray-50 cursor-pointer">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {contact.display_name || '(名前未設定)'}
                    </p>
                    <RelationshipBadge relationType={relationType} />
                    <EmailWarningBadge hasEmail={!!contact.email} />
                  </div>
                  {contact.email && (
                    <p className="text-sm text-gray-500 truncate">{contact.email}</p>
                  )}
                </div>
                <div className="ml-4 flex-shrink-0 flex gap-2">
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                    {contact.kind === 'internal_user' ? '内部' : '外部'}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ============================================================
// Lists Tab
// ============================================================

interface ListsTabProps {
  searchQuery: string;
}

function ListsTab({ searchQuery }: ListsTabProps) {
  const navigate = useNavigate();
  const [lists, setLists] = useState<List[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [members, setMembers] = useState<ListMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const loadLists = useCallback(async () => {
    try {
      setLoading(true);
      const items = await getLists();
      // フィルタリング
      const filtered = searchQuery
        ? items.filter(l => l.name.toLowerCase().includes(searchQuery.toLowerCase()))
        : items;
      setLists(filtered);
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    loadLists();
    const unsubscribe = subscribeLists((updatedLists) => {
      if (updatedLists) setLists(updatedLists);
    });
    return unsubscribe;
  }, [loadLists]);

  const loadMembers = async (listId: string) => {
    setSelectedList(listId);
    setMembersLoading(true);
    try {
      const response = await listsApi.getMembers(listId);
      setMembers(response.items || []);
    } catch (err) {
      console.error('Failed to load members:', err);
    } finally {
      setMembersLoading(false);
    }
  };

  const closeMembers = () => {
    setSelectedList(null);
    setMembers([]);
  };

  // email が設定されていないメンバー数をカウント
  const countMissingEmails = (membersList: ListMember[]) => {
    return membersList.filter(m => !m.contact_email).length;
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
        {error}
      </div>
    );
  }

  if (lists.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
          <span className="text-2xl">📋</span>
        </div>
        <p className="text-gray-500">リストがありません</p>
        <p className="text-sm text-gray-400 mt-1">チャットで「◯◯リスト作って」と言うと作成できます</p>
        <button
          onClick={() => navigate('/chat')}
          className="mt-4 px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          チャットで作成 →
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {lists.map((list) => (
          <div
            key={list.id}
            className="bg-white shadow rounded-lg p-6 hover:shadow-md transition cursor-pointer"
            onClick={() => loadMembers(list.id)}
          >
            <h3 className="text-lg font-medium text-gray-900 mb-2">{list.name}</h3>
            {list.description && (
              <p className="text-sm text-gray-500 mb-4 line-clamp-2">{list.description}</p>
            )}
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>メンバー確認 →</span>
            </div>
          </div>
        ))}
      </div>

      {/* Members Modal */}
      {selectedList && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                メンバー一覧
                {members.length > 0 && (
                  <span className="ml-2 text-sm text-gray-500">
                    ({members.length}人)
                  </span>
                )}
              </h3>
              <button
                onClick={closeMembers}
                className="text-gray-400 hover:text-gray-500"
              >
                ✕
              </button>
            </div>

            {/* Email警告 */}
            {members.length > 0 && countMissingEmails(members) > 0 && (
              <div className="mb-4 bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
                ⚠️ {countMissingEmails(members)}人がメール未設定です（一括招待できません）
              </div>
            )}

            {membersLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              </div>
            ) : members.length === 0 ? (
              <p className="text-center text-gray-500 py-8">
                メンバーがいません
                <br />
                <span className="text-sm">チャットで「このリストに追加」と言うと追加できます</span>
              </p>
            ) : (
              <ul className="divide-y divide-gray-200">
                {members.map((member) => (
                  <li key={member.id} className="py-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {member.contact_display_name || '(名前未設定)'}
                        </p>
                        {member.contact_email ? (
                          <p className="text-sm text-gray-500">{member.contact_email}</p>
                        ) : (
                          <p className="text-sm text-red-500">⚠️ メール未設定</p>
                        )}
                      </div>
                      <EmailWarningBadge hasEmail={!!member.contact_email} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================
// Relations Tab
// ============================================================

interface RelationsTabProps {
  searchQuery: string;
}

function RelationsTab({ searchQuery }: RelationsTabProps) {
  const navigate = useNavigate();
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'workmate' | 'family'>('all');
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadRelationships = useCallback(async () => {
    try {
      setLoading(true);
      const all = await relationshipsApi.listAll();
      setRelationships(all);
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRelationships();
  }, [loadRelationships]);

  const handleRemove = async (relationshipId: string) => {
    if (!window.confirm('このつながりを解除しますか？')) return;
    
    setRemovingId(relationshipId);
    try {
      await relationshipsApi.remove(relationshipId);
      invalidateRelationships();
      await loadRelationships();
    } catch (err) {
      console.error('Failed to remove relationship:', err);
      alert('解除に失敗しました');
    } finally {
      setRemovingId(null);
    }
  };

  // フィルタ + 検索
  const filtered = relationships.filter(r => {
    if (filter !== 'all' && r.relation_type !== filter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const name = r.other_user.display_name?.toLowerCase() || '';
      const email = r.other_user.email?.toLowerCase() || '';
      if (!name.includes(q) && !email.includes(q)) return false;
    }
    return true;
  });

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
        {error}
      </div>
    );
  }

  return (
    <div>
      {/* Filter */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1 text-sm rounded-full ${
            filter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          すべて
        </button>
        <button
          onClick={() => setFilter('workmate')}
          className={`px-3 py-1 text-sm rounded-full ${
            filter === 'workmate' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
          }`}
        >
          仕事仲間
        </button>
        <button
          onClick={() => setFilter('family')}
          className={`px-3 py-1 text-sm rounded-full ${
            filter === 'family' ? 'bg-green-600 text-white' : 'bg-green-100 text-green-700 hover:bg-green-200'
          }`}
        >
          家族
        </button>
      </div>

      {/* New Request Button */}
      <div className="mb-4">
        <button
          onClick={() => navigate('/relationships/request')}
          className="inline-flex items-center px-4 py-2 border border-blue-600 rounded-md text-sm font-medium text-blue-600 bg-white hover:bg-blue-50"
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
          つながり申請
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
            <span className="text-2xl">🤝</span>
          </div>
          <p className="text-gray-500">つながりがありません</p>
          <p className="text-sm text-gray-400 mt-1">仕事仲間や家族を追加すると、予定共有やPool予約ができます</p>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <ul className="divide-y divide-gray-200">
            {filtered.map((rel) => (
              <li key={rel.id} className="px-4 py-4 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {rel.other_user.display_name || '(名前未設定)'}
                      </p>
                      <RelationshipBadge relationType={rel.relation_type} />
                    </div>
                    <p className="text-sm text-gray-500 truncate">{rel.other_user.email}</p>
                  </div>
                  <div className="ml-4 flex-shrink-0 flex gap-2">
                    <button
                      onClick={() => handleRemove(rel.id)}
                      disabled={removingId === rel.id}
                      className="px-3 py-1 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                    >
                      {removingId === rel.id ? '解除中...' : '解除'}
                    </button>
                  </div>
                </div>
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
  const [searchQuery, setSearchQuery] = useState('');
  
  // タブ状態（URL param から）
  const tabParam = searchParams.get('tab') as TabId | null;
  const activeTab: TabId = tabParam && ['contacts', 'lists', 'relations'].includes(tabParam) 
    ? tabParam 
    : 'contacts';

  const handleTabChange = (tab: TabId) => {
    setSearchParams({ tab });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // 検索は各タブコンポーネントで処理
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="md:flex md:items-center md:justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:text-3xl sm:truncate">
              People Hub
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              連絡先・リスト・つながりの一元管理
            </p>
          </div>
          <div className="mt-4 flex md:mt-0 md:ml-4">
            <button
              onClick={() => navigate('/chat')}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              チャットで追加
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="名前、メールアドレスで検索..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            type="submit"
            className="px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            検索
          </button>
        </div>
      </form>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`
                py-4 px-1 border-b-2 font-medium text-sm
                ${activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }
              `}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'contacts' && <ContactsTab searchQuery={searchQuery} />}
      {activeTab === 'lists' && <ListsTab searchQuery={searchQuery} />}
      {activeTab === 'relations' && <RelationsTab searchQuery={searchQuery} />}
    </div>
  );
}
