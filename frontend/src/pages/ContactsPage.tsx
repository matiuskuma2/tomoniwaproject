/**
 * Contacts Page - Phase D-1 Updated
 * Manage contact list with relationship badges
 * 
 * Phase D-1 UI-3: Added relationship removal functionality
 * Phase R1: Added internal scheduling button for workmates
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { contactsApi, schedulingInternalApi } from '../core/api';
import { 
  relationshipsApi,
  getRelationTypeLabel, 
  getRelationTypeBadgeClass,
  type RelationType 
} from '../core/api/relationships';
import { 
  getRelationshipMap,
  invalidateRelationships,
  type RelationshipInfo 
} from '../core/cache/relationshipsCache';
import type { Contact } from '../core/models';

// ============================================================
// Relationship Badge Component
// ============================================================

interface RelationshipBadgeProps {
  relationType: RelationType;
  showStranger?: boolean;
  relationshipId?: string;
  onRemove?: (relationshipId: string) => void;
  isRemoving?: boolean;
}

function RelationshipBadge({ 
  relationType, 
  showStranger = false, 
  relationshipId,
  onRemove,
  isRemoving = false,
}: RelationshipBadgeProps) {
  // Don't show badge for strangers unless explicitly requested
  if (relationType === 'stranger' && !showStranger) {
    return null;
  }
  
  const label = getRelationTypeLabel(relationType);
  const colorClass = getRelationTypeBadgeClass(relationType);
  
  const handleRemoveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (relationshipId && onRemove && !isRemoving) {
      onRemove(relationshipId);
    }
  };
  
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${colorClass}`}>
      {label}
      {/* Show remove button only for active relationships */}
      {relationshipId && onRemove && (
        <button
          type="button"
          onClick={handleRemoveClick}
          disabled={isRemoving}
          className={`ml-0.5 p-0.5 rounded-full hover:bg-black/10 focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-gray-400 ${
            isRemoving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
          }`}
          title="関係を解除"
        >
          {isRemoving ? (
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </button>
      )}
    </span>
  );
}

// ============================================================
// Main Page Component
// ============================================================

export function ContactsPage() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  
  // Phase D-1: Relationship cache
  const [relationshipMap, setRelationshipMap] = useState<Map<string, RelationshipInfo>>(new Map());
  const [relationshipsLoading, setRelationshipsLoading] = useState(true);
  
  // Phase D-1 UI-3: Relationship removal state
  const [removingRelationshipId, setRemovingRelationshipId] = useState<string | null>(null);
  const [removalSuccess, setRemovalSuccess] = useState<string | null>(null);
  
  // Phase R1: Internal scheduling state
  const [schedulingUserId, setSchedulingUserId] = useState<string | null>(null);
  const [schedulingSuccess, setSchedulingSuccess] = useState<string | null>(null);

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
  
  // Get relationship info for a contact (includes relationship_id)
  const getContactRelationshipInfo = (contact: Contact): RelationshipInfo | null => {
    if (contact.user_id) {
      return relationshipMap.get(contact.user_id) || null;
    }
    return null;
  };
  
  // Phase D-1 UI-3: Handle relationship removal
  const handleRemoveRelationship = async (relationshipId: string) => {
    // Confirmation dialog
    const confirmed = window.confirm(
      'この関係を解除しますか？\n（相手にも解除が反映されます）'
    );
    
    if (!confirmed) {
      return;
    }
    
    setRemovingRelationshipId(relationshipId);
    setRemovalSuccess(null);
    
    try {
      await relationshipsApi.remove(relationshipId);
      
      // Invalidate cache and refresh
      invalidateRelationships();
      await loadRelationships();
      
      // Show success message
      setRemovalSuccess('関係を解除しました');
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setRemovalSuccess(null);
      }, 3000);
    } catch (err) {
      console.error('Failed to remove relationship:', err);
      
      // Show error to user
      const errorMessage = err instanceof Error ? err.message : '関係の解除に失敗しました';
      alert(errorMessage);
    } finally {
      setRemovingRelationshipId(null);
    }
  };
  
  // Phase R1: Handle start internal scheduling
  const handleStartScheduling = async (contact: Contact) => {
    if (!contact.user_id) {
      alert('このユーザーとの日程調整はできません（ユーザーIDがありません）');
      return;
    }
    
    setSchedulingUserId(contact.user_id);
    setSchedulingSuccess(null);
    
    try {
      // Generate time range: 2 weeks from now
      const now = new Date();
      const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      
      const result = await schedulingInternalApi.prepare({
        invitee_user_id: contact.user_id,
        title: `${contact.display_name}さんとの日程調整`,
        constraints: {
          time_min: now.toISOString(),
          time_max: twoWeeksLater.toISOString(),
          prefer: 'any',
          duration: 60,  // 60 minutes
          candidate_count: 3,
        },
      });
      
      if (result.success) {
        // Show success message
        setSchedulingSuccess(`${contact.display_name}さんに日程調整の依頼を送信しました`);
        
        // Navigate to the thread page after a short delay
        setTimeout(() => {
          navigate(`/scheduling/${result.thread_id}`);
        }, 1500);
      }
    } catch (err) {
      console.error('Failed to start scheduling:', err);
      const errorMessage = err instanceof Error ? err.message : '日程調整の開始に失敗しました';
      alert(errorMessage);
    } finally {
      setSchedulingUserId(null);
    }
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
        <div className="mt-4 flex gap-2 md:mt-0 md:ml-4">
          {/* Phase D-1: Link to relationship request page */}
          <button
            onClick={() => navigate('/relationships/request')}
            className="inline-flex items-center px-4 py-2 border border-blue-600 rounded-md text-sm font-medium text-blue-600 bg-white hover:bg-blue-50"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
            つながりを作る
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
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
      
      {/* Phase D-1 UI-3: Success message for relationship removal */}
      {removalSuccess && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded flex items-center justify-between">
          <span>{removalSuccess}</span>
          <button
            onClick={() => setRemovalSuccess(null)}
            className="text-green-600 hover:text-green-800"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      
      {/* Phase R1: Success message for scheduling */}
      {schedulingSuccess && (
        <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-600 px-4 py-3 rounded flex items-center justify-between">
          <span>📅 {schedulingSuccess}</span>
          <button
            onClick={() => setSchedulingSuccess(null)}
            className="text-blue-600 hover:text-blue-800"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
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
              const relationshipInfo = getContactRelationshipInfo(contact);
              
              return (
                <li key={contact.id} className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {contact.display_name}
                        </p>
                        {/* Phase D-1: Relationship Badge with Remove Button */}
                        <RelationshipBadge 
                          relationType={relationType} 
                          showStranger={false}
                          relationshipId={relationshipInfo?.relationship_id}
                          onRemove={handleRemoveRelationship}
                          isRemoving={removingRelationshipId === relationshipInfo?.relationship_id}
                        />
                      </div>
                      {contact.email && (
                        <p className="text-sm text-gray-500 truncate">{contact.email}</p>
                      )}
                      {contact.notes && (
                        <p className="mt-1 text-sm text-gray-500">{contact.notes}</p>
                      )}
                    </div>
                    <div className="ml-4 flex-shrink-0 flex gap-2 items-center">
                      {/* Phase R1: Scheduling button for workmates */}
                      {relationType === 'workmate' && contact.user_id && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartScheduling(contact);
                          }}
                          disabled={schedulingUserId === contact.user_id}
                          className={`
                            px-3 py-1 text-xs font-medium rounded-md
                            ${schedulingUserId === contact.user_id
                              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                              : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                            }
                          `}
                          title="日程調整を開始"
                        >
                          {schedulingUserId === contact.user_id ? (
                            <span className="flex items-center">
                              <svg className="animate-spin h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              送信中...
                            </span>
                          ) : (
                            <>📅 日程調整</>
                          )}
                        </button>
                      )}
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
