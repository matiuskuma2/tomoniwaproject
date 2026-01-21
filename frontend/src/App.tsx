import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { isAuthenticated } from './core/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ThreadCreatePage } from './pages/ThreadCreatePage';
import { ThreadDetailPage } from './pages/ThreadDetailPage';
import { ContactsPage } from './pages/ContactsPage';
import { ListsPage } from './pages/ListsPage';
import { ChatPage } from './pages/ChatPage';
import BillingPage from './pages/BillingPage';
import SettingsPage from './pages/SettingsPage';
import WorkspaceNotificationsPage from './pages/WorkspaceNotificationsPage';

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
        <Route
          path="/contacts"
          element={
            <ProtectedRoute>
              <ContactsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lists"
          element={
            <ProtectedRoute>
              <ListsPage />
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

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
