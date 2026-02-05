import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { isAuthenticated } from './core/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ThreadCreatePage } from './pages/ThreadCreatePage';
import { ThreadDetailPage } from './pages/ThreadDetailPage';
// Legacy: import { ContactsPage } from './pages/ContactsPage';
// Legacy: import { ListsPage } from './pages/ListsPage';
import { ChatPage } from './pages/ChatPage';
import { RelationshipRequestPage } from './pages/RelationshipRequestPage';
import { SchedulingInternalThreadPage } from './pages/SchedulingInternalThreadPage';
import { GroupListPage } from './pages/GroupListPage';
import { GroupNewPage } from './pages/GroupNewPage';
import { GroupThreadPage } from './pages/GroupThreadPage';
import BillingPage from './pages/BillingPage';
import SettingsPage from './pages/SettingsPage';
import WorkspaceNotificationsPage from './pages/WorkspaceNotificationsPage';
import { PeopleHubPage } from './pages/PeopleHubPage';

// Protected Route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
        {/* Public Route */}
        <Route path="/" element={<LoginPage />} />
        
        {/* Protected Routes */}
        {/* Phase P0-5: /dashboard を /chat に強制リダイレクト */}
        <Route path="/dashboard" element={<Navigate to="/chat" replace />} />
        <Route
          path="/dashboard-legacy"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/threads/new"
          element={
            <ProtectedRoute>
              <ThreadCreatePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/threads/:threadId"
          element={
            <ProtectedRoute>
              <ThreadDetailPage />
            </ProtectedRoute>
          }
        />
        {/* P1: People Hub - 連絡先/リスト/つながりの統合UI */}
        <Route
          path="/people"
          element={
            <ProtectedRoute>
              <PeopleHubPage />
            </ProtectedRoute>
          }
        />
        {/* Legacy routes: redirect to People Hub */}
        <Route path="/contacts" element={<Navigate to="/people?tab=contacts" replace />} />
        <Route path="/lists" element={<Navigate to="/people?tab=lists" replace />} />
        {/* Phase D-1: Relationship Request (つながり申請の専用画面として維持) */}
        <Route
          path="/relationships/request"
          element={
            <ProtectedRoute>
              <RelationshipRequestPage />
            </ProtectedRoute>
          }
        />
        
        {/* Phase Next-1: Chat UI Shell */}
        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <ChatPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chat/:threadId"
          element={
            <ProtectedRoute>
              <ChatPage />
            </ProtectedRoute>
          }
        />

        {/* Day3-2: Billing Settings */}
        <Route
          path="/settings/billing"
          element={
            <ProtectedRoute>
              <BillingPage />
            </ProtectedRoute>
          }
        />

        {/* P3-TZ1: User Settings (Timezone) */}
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />

        {/* P2-E1: Workspace Notifications Settings */}
        <Route
          path="/settings/workspace-notifications"
          element={
            <ProtectedRoute>
              <WorkspaceNotificationsPage />
            </ProtectedRoute>
          }
        />

        {/* Phase R1: Internal Scheduling Thread */}
        <Route
          path="/scheduling/:threadId"
          element={
            <ProtectedRoute>
              <SchedulingInternalThreadPage />
            </ProtectedRoute>
          }
        />

        {/* G1: Group Scheduling (1対N) */}
        <Route
          path="/group"
          element={
            <ProtectedRoute>
              <GroupListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/group/new"
          element={
            <ProtectedRoute>
              <GroupNewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/group/:threadId"
          element={
            <ProtectedRoute>
              <GroupThreadPage />
            </ProtectedRoute>
          }
        />

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
