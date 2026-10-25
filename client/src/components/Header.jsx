import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext.jsx';

// Single header for every signed-in page. Sticky so it stays reachable on
// long study sessions; active route is highlighted so users always know
// where they are.
const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/decks', label: 'Decks' },
  { to: '/study', label: 'Study' },
  { to: '/upload', label: 'Upload' },
];

export default function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-8">
          <Link to="/" className="text-xl font-black tracking-tight text-slate-900">
            studyflip<span className="text-forest-800">.</span>
          </Link>
          <nav className="flex gap-6 text-sm font-medium">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  isActive
                    ? 'border-b-2 border-forest-800 pb-0.5 text-forest-800'
                    : 'border-b-2 border-transparent pb-0.5 text-slate-600 hover:border-forest-300 hover:text-forest-800'
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-slate-600 sm:inline">Hi, {user.name}</span>
          <button
            onClick={logout}
            className="rounded-full border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-forest-300 hover:text-forest-800"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
