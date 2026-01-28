/**
 * Relationship Request Page - Phase D-1 UI-2a
 * Search users and send relationship requests
 */

import { useState } from 'react';
import { 
  relationshipsApi,
  getRelationTypeLabel,
  getRelationTypeBadgeClass,
  getPermissionPresetLabel,
  type RelationType,
  type PermissionPreset,
  type UserSearchResult,
} from '../core/api';
import { refreshRelationships } from '../core/cache/relationshipsCache';

// ============================================================
// Permission Preset Modal
// ============================================================

interface PermissionPresetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (preset: PermissionPreset) => void;
  targetUser: UserSearchResult | null;
}

function PermissionPresetModal({ isOpen, onClose, onSelect, targetUser }: PermissionPresetModalProps) {
  if (!isOpen || !targetUser) return null;

  const presets: { preset: PermissionPreset; description: string }[] = [
    {
      preset: 'family_view_freebusy',
      description: 'スケジュールの空き/予定ありを共有できます',
    },
    {
      preset: 'family_can_write',
      description: '代理で予定を作成することもできます',
    },
  ];

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          家族としてつながる
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          {targetUser.display_name || targetUser.email} さんとの共有範囲を選択してください
        </p>
        
        <div className="space-y-3">
          {presets.map(({ preset, description }) => (
            <button
              key={preset}
              onClick={() => onSelect(preset)}
              className="w-full text-left p-4 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-blue-300 transition-colors"
            >
              <div className="font-medium text-gray-900">
                {getPermissionPresetLabel(preset)}
              </div>
              <div className="text-sm text-gray-500 mt-1">
                {description}
              </div>
            </button>
          ))}
        </div>
        
        <button
          onClick={onClose}
          className="mt-4 w-full px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Search Result Card
// ============================================================

interface SearchResultCardProps {
  user: UserSearchResult;
  onRequestWorkmate: (user: UserSearchResult) => void;
  onRequestFamily: (user: UserSearchResult) => void;
  isRequesting: boolean;
}

function SearchResultCard({ user, onRequestWorkmate, onRequestFamily, isRequesting }: SearchResultCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {user.display_name || '(名前未設定)'}
        </p>
        <p className="text-sm text-gray-500 truncate">{user.email}</p>
        
        {/* Existing relationship badge */}
        {user.relationship && (
          <span className={`mt-1 inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${getRelationTypeBadgeClass(user.relationship.relation_type)}`}>
            {getRelationTypeLabel(user.relationship.relation_type)}
          </span>
        )}
        
        {/* Pending request indicator */}
        {user.pending_request && (
          <span className="mt-1 inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">
            申請中（{getRelationTypeLabel(user.pending_request.requested_type as RelationType)}）
          </span>
        )}
      </div>
      
      <div className="ml-4 flex-shrink-0 flex gap-2">
        {user.can_request && !user.pending_request && (
          <>
            <button
              onClick={() => onRequestWorkmate(user)}
              disabled={isRequesting}
              className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-100 rounded-md hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              仕事仲間
            </button>
            <button
              onClick={() => onRequestFamily(user)}
              disabled={isRequesting}
              className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-100 rounded-md hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              家族
            </button>
          </>
        )}
        
        {user.relationship && (
          <span className="text-xs text-gray-500">既につながっています</span>
        )}
        
        {user.pending_request && (
          <span className="text-xs text-gray-500">承認待ち</span>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Main Page
// ============================================================

export function RelationshipRequestPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  
  // Request state
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  
  // Family preset modal
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!searchQuery.trim() || searchQuery.trim().length < 3) {
      setSearchError('3文字以上で検索してください');
      return;
    }
    
    try {
      setIsSearching(true);
      setSearchError(null);
      setRequestSuccess(null);
      setRequestError(null);
      
      const response = await relationshipsApi.search(searchQuery.trim());
      setSearchResults(response.results);
      setHasSearched(true);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : '検索に失敗しました');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleRequestWorkmate = async (user: UserSearchResult) => {
    try {
      setIsRequesting(true);
      setRequestError(null);
      setRequestSuccess(null);
      
      await relationshipsApi.request({
        invitee_identifier: user.id,
        requested_type: 'workmate',
      });
      
      setRequestSuccess(`${user.display_name || user.email} さんに「仕事仲間」申請を送信しました`);
      
      // Refresh search results
      const response = await relationshipsApi.search(searchQuery.trim());
      setSearchResults(response.results);
      
      // Refresh relationships cache
      await refreshRelationships();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : '申請に失敗しました');
    } finally {
      setIsRequesting(false);
    }
  };

  const handleRequestFamily = (user: UserSearchResult) => {
    setSelectedUser(user);
    setShowPresetModal(true);
  };

  const handleFamilyPresetSelect = async (preset: PermissionPreset) => {
    if (!selectedUser) return;
    
    try {
      setShowPresetModal(false);
      setIsRequesting(true);
      setRequestError(null);
      setRequestSuccess(null);
      
      await relationshipsApi.request({
        invitee_identifier: selectedUser.id,
        requested_type: 'family',
        permission_preset: preset,
      });
      
      setRequestSuccess(`${selectedUser.display_name || selectedUser.email} さんに「家族」申請を送信しました`);
      
      // Refresh search results
      const response = await relationshipsApi.search(searchQuery.trim());
      setSearchResults(response.results);
      
      // Refresh relationships cache
      await refreshRelationships();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : '申請に失敗しました');
    } finally {
      setIsRequesting(false);
      setSelectedUser(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">
          つながりを作る
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          メールアドレスまたは名前で検索して、仕事仲間や家族として申請できます
        </p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="メールアドレスまたは名前で検索..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={isSearching}
            className="px-6 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSearching ? '検索中...' : '検索'}
          </button>
        </div>
      </form>

      {/* Error Messages */}
      {searchError && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
          {searchError}
        </div>
      )}
      
      {requestError && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded">
          {requestError}
        </div>
      )}

      {/* Success Message */}
      {requestSuccess && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded">
          {requestSuccess}
        </div>
      )}

      {/* Search Results */}
      {hasSearched && (
        <div className="space-y-3">
          {searchResults.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">ユーザーが見つかりませんでした</p>
              <p className="text-sm text-gray-400 mt-1">
                メールアドレスで検索するか、別のキーワードをお試しください
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-2">
                {searchResults.length}件のユーザーが見つかりました
              </p>
              {searchResults.map((user) => (
                <SearchResultCard
                  key={user.id}
                  user={user}
                  onRequestWorkmate={handleRequestWorkmate}
                  onRequestFamily={handleRequestFamily}
                  isRequesting={isRequesting}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Instructions (before search) */}
      {!hasSearched && (
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-gray-500">
            つながりたい相手を検索してください
          </p>
          <div className="mt-4 text-sm text-gray-400 space-y-1">
            <p><span className="inline-block w-20 text-blue-600 font-medium">仕事仲間</span>：空き時間を共有</p>
            <p><span className="inline-block w-20 text-green-600 font-medium">家族</span>：スケジュール詳細を共有</p>
          </div>
        </div>
      )}

      {/* Permission Preset Modal */}
      <PermissionPresetModal
        isOpen={showPresetModal}
        onClose={() => {
          setShowPresetModal(false);
          setSelectedUser(null);
        }}
        onSelect={handleFamilyPresetSelect}
        targetUser={selectedUser}
      />
    </div>
  );
}
