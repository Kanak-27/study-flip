import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './features/auth/AuthContext.jsx';
import Header from './components/Header.jsx';
import LandingPage from './features/landing/LandingPage.jsx';
import LoginPage from './features/auth/LoginPage.jsx';
import RegisterPage from './features/auth/RegisterPage.jsx';
import DashboardPage from './features/dashboard/DashboardPage.jsx';
import DecksPage from './features/decks/DecksPage.jsx';
import DeckDetailPage from './features/decks/DeckDetailPage.jsx';
import StudyPage from './features/study/StudyPage.jsx';
import UploadPage from './features/upload/UploadPage.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Centered>Loading…</Centered>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Centered({ children }) {
  return <div className="flex min-h-screen items-center justify-center text-slate-500">{children}</div>;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <Centered>Loading…</Centered>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/register" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
      <Route
        path="/"
        element={
          user ? (
            <Protected>
              <Shell>
                <DashboardPage />
              </Shell>
            </Protected>
          ) : (
            <LandingPage />
          )
        }
      />
      <Route
        path="/decks"
        element={
          <Protected>
            <Shell>
              <DecksPage />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/decks/:deckId"
        element={
          <Protected>
            <Shell>
              <DeckDetailPage />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/study"
        element={
          <Protected>
            <Shell>
              <StudyPage />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/upload"
        element={
          <Protected>
            <Shell>
              <UploadPage />
            </Shell>
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// One shell for every signed-in page: the shared sticky header on top of the
// route content, so navigation is identical everywhere.
function Shell({ children }) {
  return (
    <div className="min-h-screen bg-canvas">
      <Header />
      {children}
    </div>
  );
}
