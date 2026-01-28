/**
 * Contacts Page - Phase D-1 Updated
 * Manage contact list with relationship badges
 */

import { useEffect, useState, useMemo } from 'react';
import { contactsApi } from '../core/api';
import { 
  getRelationTypeLabel, 
  getRelationTypeBadgeClass,
  type RelationType 
} from '../core/api/relationships';
import { 
  getRelationshipMap, 
  getRelationTypeForUserSync,
  type RelationshipInfo 
} from '../core/cache/relationshipsCache';
import type { Contact } from '../core/models';

// ============================================================
// Relationship Badge Component
// ============================================================

interface RelationshipBadgeProps {
  relationType: RelationType;
  showStranger?: boolean;
}

function RelationshipBadge({ relationType, showStranger = false }: RelationshipBadgeProps) {
  // Don't show badge for strangers unless explicitly requested
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
// Main Page Component
// ============================================================

export function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  
  // Phase D-1: Relationship cache
  const [relationshipMap, setRelationshipMap] = useState<Map<string, RelationshipInfo>>(new Map());
  const [relationshipsLoading, setRelationshipsLoading] = useState(true);

  // Load contacts
  useEffect(() => {
    loadContacts();
  }, []);
  
  // Load relationships cache
  useEffect(() => {
    loadRelationships();
  }, []);

  const loadContacts = async (query?: string) => {
    try {
      setLoading(true);
      const response = await contactsApi.list({ q: query, limit: 100 });
      setContacts(response.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  };
  
  const loadRelationships = async () => {
    try {
      setRelationshipsLoading(true);
      const map = await getRelationshipMap();
      setRelationshipMap(map);
    } catch (err) {
      console.error('Failed to load relationships:', err);
      // Non-blocking error - continue without relationship badges
    } finally {
      setRelationshipsLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadContacts(searchQuery);
  };

  const handleAddContact = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    try {
      await contactsApi.create({
        kind: formData.get('kind') as string,
        display_name: formData.get('display_name') as string,
        email: formData.get('email') as string || undefined,
        relationship_type: formData.get('relationship_type') as string || undefined,
        notes: formData.get('notes') as string || undefined,
      });
      
      setShowAddModal(false);
      await loadContacts(searchQuery);
      e.currentTarget.reset();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create contact');
    }
  };
  
  // Get relationship type for a contact
  const getContactRelationType = (contact: Contact): RelationType => {
    // If contact has a linked user_id, check relationships
    if (contact.user_id) {
      const info = relationshipMap.get(contact.user_id);
      if (info) {
        return info.relation_type;
      }
    }
    
    // Fallback to contact's relationship_type (converted)
    if (contact.relationship_type) {
      switch (contact.relationship_type) {
        case 'family':
          return 'family';
        case 'coworker':
          return 'workmate';
        default:
          return 'stranger';
      }
    }
    
    return 'stranger';
  };

  if (loading && contacts.length === 0) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="md:flex md:items-center md:justify-between mb-8">
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:text-3xl sm:truncate">
            連絡先
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {relationshipsLoading 
              ? '関係情報を読み込み中...' 
              : `${relationshipMap.size}件の関係を取得済み`
            }
          </p>
        </div>
        <div className="mt-4 flex md:mt-0 md:ml-4">
          <button
            onClick={() => setShowAddModal(true)}
            className="ml-3 inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            新規追加
          </button>
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

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Contacts List */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        {contacts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-sm">連絡先がありません</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {contacts.map((contact) => {
              const relationType = getContactRelationType(contact);
              
              return (
                <li key={contact.id} className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {contact.display_name}
                        </p>
                        {/* Phase D-1: Relationship Badge */}
                        <RelationshipBadge 
                          relationType={relationType} 
                          showStranger={false} 
                        />
                      </div>
                      {contact.email && (
                        <p className="text-sm text-gray-500 truncate">{contact.email}</p>
                      )}
                      {contact.notes && (
                        <p className="mt-1 text-sm text-gray-500">{contact.notes}</p>
                      )}
                    </div>
                    <div className="ml-4 flex-shrink-0 flex gap-2">
                      {/* Contact kind badge */}
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                        {contact.kind === 'internal_user' ? '内部' : '外部'}
                      </span>
                      {/* Tags */}
                      {contact.tags && contact.tags.length > 0 && (
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                          {contact.tags[0]}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Add Contact Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">新規連絡先追加</h3>
            <form onSubmit={handleAddContact}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    種別
                  </label>
                  <select
                    name="kind"
                    required
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="external_person">個人（外部）</option>
                    <option value="internal_user">内部ユーザー</option>
                    <option value="organization">組織</option>
                    <option value="group">グループ</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    表示名 *
                  </label>
                  <input
                    type="text"
                    name="display_name"
                    required
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    メールアドレス
                  </label>
                  <input
                    type="email"
                    name="email"
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    関係性
                  </label>
                  <select
                    name="relationship_type"
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">選択してください</option>
                    <option value="family">家族</option>
                    <option value="friend">友人</option>
                    <option value="coworker">同僚</option>
                    <option value="client">顧客</option>
                    <option value="external">その他</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    メモ
                  </label>
                  <textarea
                    name="notes"
                    rows={3}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
                >
                  追加
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
