import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './features/auth/AuthContext.jsx';
import Header from './components/Header.jsx';
import LandingPage from './features/landing/LandingPage.jsx';
import LoginPage from './features/auth/LoginPage.jsx';
import RegisterPage from './features/auth/RegisterPage.jsx';
import ForgotPasswordPage from './features/auth/ForgotPasswordPage.jsx';
import DashboardPage from './features/dashboard/DashboardPage.jsx';
import DecksPage from './features/decks/DecksPage.jsx';
import DeckDetailPage from './features/decks/DeckDetailPage.jsx';
import StudyPage from './features/study/StudyPage.jsx';
import UploadPage from './features/upload/UploadPage.jsx';
import PlansPage from './features/billing/PlansPage.jsx';
import ProfilePage from './features/profile/ProfilePage.jsx';
import AdminPage from './features/admin/AdminPage.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Centered>Loading…</Centered>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Admin is a server-side role, never a client claim. This guard is only a
// convenience: the API returns 403 regardless, so a hand-typed URL cannot
// reveal anything.
function AdminOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Centered>Loading…</Centered>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function Centered({ children }) {
  return <div className="flex min-h-screen items-center justify-center text-slate-500">{children}</div>;
}

function Page({ children }) {
  return (
    <Protected>
      <Shell>{children}</Shell>
    </Protected>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <Centered>Loading…</Centered>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/register" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
      <Route
        path="/forgot-password"
        element={user ? <Navigate to="/" replace /> : <ForgotPasswordPage />}
      />
      <Route
        path="/"
        element={
          user ? (
            <Page>
              <DashboardPage />
            </Page>
          ) : (
            <LandingPage />
          )
        }
      />
      <Route path="/decks" element={<Page><DecksPage /></Page>} />
      <Route path="/decks/:deckId" element={<Page><DeckDetailPage /></Page>} />
      <Route path="/study" element={<Page><StudyPage /></Page>} />
      <Route path="/upload" element={<Page><UploadPage /></Page>} />
      <Route path="/plans" element={<Page><PlansPage /></Page>} />
      <Route path="/profile" element={<Page><ProfilePage /></Page>} />
      <Route
        path="/admin"
        element={
          <AdminOnly>
            <Shell>
              <AdminPage />
            </Shell>
          </AdminOnly>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// One shell for every signed-in page: the shared sticky header on top of the
// route content, so navigation is identical everywhere. An admin announcement
// appears below the header when one is set.
function Shell({ children }) {
  const { config } = useAuth();

  return (
    <div className="min-h-screen bg-canvas">
      <Header />
      {config.announcement && (
        <div className="border-b border-amber-200 bg-amber-50">
          <p className="mx-auto max-w-6xl px-6 py-2 text-sm text-amber-900">{config.announcement}</p>
        </div>
      )}
      {children}
    </div>
  );
}
