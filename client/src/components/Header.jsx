import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext.jsx';
import { api, avatarUrl } from '../api/client.js';
import Tooltip from './Tooltip.jsx';

// Single header for every signed-in page. Sticky so it stays reachable on
// long study sessions; active route is highlighted so users always know
// where they are.
const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/decks', label: 'Decks' },
  { to: '/study', label: 'Study' },
  { to: '/upload', label: 'Upload' },
  { to: '/plans', label: 'Pricing' },
];

export default function Header() {
  const { user, logout } = useAuth();
  const navItems = user.role === 'admin'
    ? [...NAV_ITEMS, { to: '/admin', label: 'Admin' }]
    : NAV_ITEMS;

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-8">
          <Link to="/" className="text-xl font-black tracking-tight text-slate-900">
            studyflip<span className="text-forest-800">.</span>
          </Link>
          <nav className="hidden gap-6 text-sm font-medium md:flex">
            {navItems.map((item) => (
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

        <div className="flex items-center gap-3">
          <PlanTag />
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-forest-800 text-forest-800'
                  : 'border-slate-300 text-slate-700 hover:border-forest-800 hover:text-forest-800'
              }`
            }
            aria-label="Your profile"
          >
            <HeaderAvatar user={user} />
            <span className="hidden sm:inline">Profile</span>
          </NavLink>
          <button
            onClick={logout}
            aria-label="Sign out"
            className="hidden rounded-full border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-forest-800 hover:text-forest-800 sm:inline"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

function HeaderAvatar({ user }) {
  const url = avatarUrl(user);
  if (url) {
    return <img src={url} alt="" className="h-6 w-6 rounded-full border border-slate-200 object-cover" />;
  }
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-forest-100 text-xs font-semibold text-forest-800">
      {(user.name ?? '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

// Plan status is plain hoverable text (not a link) so it reads as status,
// not action; the Upgrade button next to it is the one that navigates to
// the pricing page.
function PlanTag() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    api('/api/billing/subscription')
      .then(setInfo)
      .catch(() => setInfo({ failed: true }));
  }, []);

  if (!info || info.failed) return null;

  const isPremium = info.plan.id === 'premium';
  const limit = info.plan.limits.generationsPerMonth;
  const tip = isPremium
    ? 'Premium — unlimited study and decks, AI generation included.'
    : `Current status: ${info.used} of ${limit} AI generations used this month. Studying and decks are unlimited on Free.`;

  return (
    <>
      <Tooltip label={tip} side="bottom">
        <span
          className={`inline-flex cursor-default items-center gap-1.5 text-xs font-semibold ${
            isPremium ? 'text-forest-800' : 'text-slate-500'
          }`}
        >
          {isPremium ? <CrownIcon className="h-3.5 w-3.5" /> : null}
          {info.plan.name} plan
          {!isPremium && <span className="font-normal text-slate-400">· {info.used}/{limit}</span>}
        </span>
      </Tooltip>

      {!isPremium && (
        <Link
          to="/plans"
          className="inline-flex items-center rounded-full bg-forest-800 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-forest-700"
        >
          Upgrade
        </Link>
      )}
    </>
  );
}

function CrownIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z" />
    </svg>
  );
}
