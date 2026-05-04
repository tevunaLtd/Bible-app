/**
 * App.jsx — top-level router.
 *
 * Public routes (no login required):
 *   /c/:slug          CongregationPage  — members follow along on their phone
 *   /projection/:id   ProjectionPage    — full-screen for second monitor
 *   /login            LoginPage
 *
 * Protected routes (redirect to /login if no session):
 *   /                 → /operator  (or /setup if profile incomplete)
 *   /operator         OperatorPage
 *   /admin            AdminPage
 *   /archive          ArchivePage
 *   /setup            SetupPage
 */

import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';

import LoginPage        from './pages/LoginPage';
import SetupPage        from './pages/SetupPage';
import OperatorPage     from './pages/OperatorPage';
import AdminPage        from './pages/AdminPage';
import ArchivePage      from './pages/ArchivePage';
import CongregationPage from './pages/CongregationPage';
import ProjectionPage   from './pages/ProjectionPage';

function ProtectedRoute({ children }) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d1b2a] flex items-center justify-center">
        <span className="text-[#d4af37] font-serif text-xl animate-pulse">Loading…</span>
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  // Profile exists but setup not completed (no org/church assigned yet)
  if (profile && !profile.church_id && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }

  return children;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login"             element={<LoginPage />} />
      <Route path="/c/:slug"           element={<CongregationPage />} />
      <Route path="/projection/:id"    element={<ProjectionPage />} />

      {/* Protected */}
      <Route path="/setup"    element={<ProtectedRoute><SetupPage /></ProtectedRoute>} />
      <Route path="/operator" element={<ProtectedRoute><OperatorPage /></ProtectedRoute>} />
      <Route path="/admin"    element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
      <Route path="/archive"  element={<ProtectedRoute><ArchivePage /></ProtectedRoute>} />

      {/* Default: go to operator */}
      <Route path="*" element={<Navigate to="/operator" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
