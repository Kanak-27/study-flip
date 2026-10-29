import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, avatarUrl } from '../../api/client.js';

// Day-to-day supervision without touching code: who signed up, who is paying,
// what the queue is doing, and the switches that change product behaviour.
// Every mutation is audited server-side; the Audit tab reads that trail back.
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'runs', label: 'AI runs' },
  { id: 'jobs', label: 'Queue' },
  { id: 'settings', label: 'Settings' },
  { id: 'audit', label: 'Audit' },
];

export default function AdminPage() {
  const [tab, setTab] = useState('overview');
  const [error, setError] = useState(null);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Admin</h1>
        <p className="mt-1 text-sm text-slate-500">
          Live product state and day-to-day account supervision.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setError(null);
            }}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === item.id
                ? 'border-forest-800 text-forest-800'
                : 'border-transparent text-slate-500 hover:text-forest-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <Note kind="error" className="mb-4">{error}</Note>}

      {tab === 'overview' && <Overview onError={setError} />}
      {tab === 'users' && <Users onError={setError} />}
      {tab === 'runs' && <Runs onError={setError} />}
      {tab === 'jobs' && <Jobs onError={setError} />}
      {tab === 'settings' && <SettingsPanel onError={setError} />}
      {tab === 'audit' && <Audit onError={setError} />}
    </main>
  );
}

// --- shared UI --------------------------------------------------------------

function Card({ title, description, actions, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

function Note({ kind = 'ok', children, className = '' }) {
  const tone =
    kind === 'error'
      ? 'bg-red-50 text-red-700'
      : kind === 'warn'
        ? 'bg-amber-50 text-amber-800'
        : 'bg-forest-50 text-forest-800';
  return <p className={`rounded-md px-3 py-2 text-sm ${tone} ${className}`}>{children}</p>;
}

function Button({ children, variant = 'primary', className = '', ...rest }) {
  const styles =
    variant === 'danger'
      ? 'border border-red-200 text-red-700 hover:bg-red-50'
      : variant === 'ghost'
        ? 'border border-slate-300 text-slate-700 hover:border-forest-800 hover:text-forest-800'
        : 'bg-forest-800 text-white hover:bg-forest-700';
  return (
    <button
      {...rest}
      className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

function Input({ label, value, onChange, type = 'text', hint, className = '', ...rest }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-forest-700 focus:outline-none focus:ring-1 focus:ring-forest-700"
      />
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

function Select({ label, value, onChange, options, className = '' }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-forest-700 focus:outline-none focus:ring-1 focus:ring-forest-700"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Badge({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-forest-50 text-forest-800',
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-800',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function Loading() {
  return <p className="py-10 text-center text-sm text-slate-500">Loading…</p>;
}

function Pagination({ page, pages, onPage }) {
  if (!pages || pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
      <span>
        Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        <Button variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortId(id) {
  return id ? `${String(id).slice(0, 8)}…` : '—';
}

function useAdminData(path, onError) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api(path));
    } catch (err) {
      onError?.(err.message);
    } finally {
      setLoading(false);
    }
  }, [path, onError]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, loading, reload: load, setData };
}

// --- overview ---------------------------------------------------------------

function Overview({ onError }) {
  const { data, loading, reload } = useAdminData('/api/admin/overview', onError);

  if (loading) return <Loading />;
  if (!data) return null;
  const { stats, queue, environment, recentUsers, signupsByDay } = data;
  const maxSignups = Math.max(1, ...signupsByDay.map((row) => row.count));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Users" value={stats.users.total} hint={`${stats.users.new7d} new this week`} />
        <Stat label="Premium" value={stats.users.premium} hint={`${stats.users.admins} admins · ${stats.users.suspended} suspended`} />
        <Stat label="Documents" value={stats.content.documents} hint={`${stats.content.decks} decks · ${stats.content.cards} cards`} />
        <Stat label="AI runs (30d)" value={stats.ai.runsCompleted30d} hint={`${stats.ai.runsFailed30d} failed · ${stats.ai.generationsThisMonth} this month`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Queue" description="Background jobs doing PDF extraction and generation." className="lg:col-span-1">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xl font-semibold text-slate-900">{queue.queued}</p>
              <p className="text-xs text-slate-500">Queued</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xl font-semibold text-slate-900">{queue.running}</p>
              <p className="text-xs text-slate-500">Running</p>
            </div>
            <div className={`rounded-lg p-3 ${queue.failed ? 'bg-red-50' : 'bg-slate-50'}`}>
              <p className={`text-xl font-semibold ${queue.failed ? 'text-red-700' : 'text-slate-900'}`}>{queue.failed}</p>
              <p className="text-xs text-slate-500">Failed</p>
            </div>
          </div>
          <Button variant="ghost" className="mt-4" onClick={reload}>
            Refresh
          </Button>
        </Card>

        <Card title="Environment" description="What is configured on this server." className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row label="Mode" value={environment.nodeEnv} />
            <Row label="Email" value={environment.mailConfigured ? 'SMTP configured' : 'Not configured'} bad={!environment.mailConfigured} />
            <Row label="Billing" value={environment.billingConfigured ? environment.billingMode : 'Disabled'} bad={!environment.billingConfigured} />
            <Row label="AI provider" value={environment.aiConfigured ? 'Configured' : 'Not configured'} bad={!environment.aiConfigured} />
            <Row label="Admin allowlist" value={environment.adminEmails.join(', ') || '—'} wide />
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Signups" description="Last 30 days." className="lg:col-span-2">
          {signupsByDay.length === 0 ? (
            <p className="text-sm text-slate-500">No signups in this window.</p>
          ) : (
            <div className="flex h-40 items-end gap-1.5">
              {signupsByDay.map((row) => (
                <div key={row.date} className="group relative flex flex-1 flex-col items-center justify-end">
                  <span className="mb-1 hidden text-xs text-slate-500 group-hover:block">{row.count}</span>
                  <div
                    className="w-full rounded-t bg-forest-400 transition-colors group-hover:bg-forest-700"
                    style={{ height: `${Math.max(4, (row.count / maxSignups) * 100)}%` }}
                    title={`${row.date}: ${row.count}`}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Newest accounts">
          <ul className="space-y-3">
            {recentUsers.map((user) => (
              <li key={user.id} className="flex items-center gap-3">
                <MiniAvatar user={user} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{user.name}</p>
                  <p className="truncate text-xs text-slate-500">{user.email}</p>
                </div>
                <span className="shrink-0 text-xs text-slate-400">{formatDate(user.createdAt).split(',')[0]}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, bad, wide }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`mt-0.5 break-words ${bad ? 'font-medium text-red-700' : 'text-slate-700'}`}>{value}</dd>
    </div>
  );
}

function MiniAvatar({ user, size = 'h-8 w-8' }) {
  const url = avatarUrl(user);
  if (url) {
    return <img src={url} alt="" className={`${size} rounded-full border border-slate-200 object-cover`} />;
  }
  const initial = (user.name ?? '?').trim().charAt(0).toUpperCase();
  return (
    <div className={`${size} flex shrink-0 items-center justify-center rounded-full bg-forest-100 text-xs font-semibold text-forest-800`}>
      {initial}
    </div>
  );
}

// --- users ------------------------------------------------------------------

const EMPTY_USER_FILTERS = { q: '', role: '', status: '', plan: '' };

function Users({ onError }) {
  const [filters, setFilters] = useState(EMPTY_USER_FILTERS);
  const [applied, setApplied] = useState(EMPTY_USER_FILTERS);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [note, setNote] = useState(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (applied.q) params.set('q', applied.q);
    if (applied.role) params.set('role', applied.role);
    if (applied.status) params.set('status', applied.status);
    if (applied.plan) params.set('plan', applied.plan);
    return `/api/admin/users?${params}`;
  }, [applied, page]);

  const { data, loading, reload } = useAdminData(query, onError);

  const onSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setApplied({ ...filters });
  };

  const refreshAll = async (message) => {
    setNote(message ?? null);
    await reload();
  };

  return (
    <div className="space-y-4">
      <Card>
        <form onSubmit={onSearch} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <Input
            label="Search"
            value={filters.q}
            onChange={(v) => setFilters((f) => ({ ...f, q: v }))}
            placeholder="Email or name"
            className="lg:col-span-2"
          />
          <Select
            label="Role"
            value={filters.role}
            onChange={(v) => setFilters((f) => ({ ...f, role: v }))}
            options={[
              { value: '', label: 'Any role' },
              { value: 'user', label: 'Student' },
              { value: 'admin', label: 'Admin' },
            ]}
          />
          <Select
            label="Status"
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            options={[
              { value: '', label: 'Any status' },
              { value: 'active', label: 'Active' },
              { value: 'suspended', label: 'Suspended' },
            ]}
          />
          <div className="flex gap-2">
            <Select
              label="Plan"
              value={filters.plan}
              onChange={(v) => setFilters((f) => ({ ...f, plan: v }))}
              options={[
                { value: '', label: 'Any plan' },
                { value: 'free', label: 'Free' },
                { value: 'premium', label: 'Premium' },
              ]}
              className="flex-1"
            />
            <Button type="submit" className="mb-0.5">
              Apply
            </Button>
          </div>
        </form>
        {note && <Note className="mt-3">{note}</Note>}
      </Card>

      <Card
        title={data ? `${data.total} account${data.total === 1 ? '' : 's'}` : 'Accounts'}
        description="Click a row to open the account and act on it."
      >
        {loading ? (
          <Loading />
        ) : !data?.users.length ? (
          <p className="text-sm text-slate-500">No accounts match those filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-2 pr-4 font-medium">Account</th>
                  <th className="py-2 pr-4 font-medium">Plan</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">AI this month</th>
                  <th className="py-2 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((user) => (
                  <tr
                    key={user.id}
                    onClick={() => setSelectedId(user.id)}
                    className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 ${
                      selectedId === user.id ? 'bg-forest-50/50' : ''
                    }`}
                  >
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-3">
                        <MiniAvatar user={user} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{user.name}</p>
                          <p className="truncate text-xs text-slate-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={user.plan.plan === 'premium' ? 'green' : 'slate'}>
                        {user.plan.plan === 'premium' ? 'Premium' : 'Free'}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={user.role === 'admin' ? 'amber' : 'slate'}>
                        {user.role === 'admin' ? 'Admin' : 'Student'}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-4">
                      {user.suspended ? <Badge tone="red">Suspended</Badge> : <Badge tone="green">Active</Badge>}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600">{user.generationsThisMonth}</td>
                    <td className="py-2.5 text-slate-500">{formatDate(user.createdAt).split(',')[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} />
      </Card>

      {selectedId && (
        <UserDetail
          key={selectedId}
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={refreshAll}
          onError={onError}
        />
      )}
    </div>
  );
}

function UserDetail({ id, onClose, onChanged, onError }) {
  const { data, loading, reload } = useAdminData(`/api/admin/users/${id}`, onError);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [suspendReason, setSuspendReason] = useState('');

  const patch = async (body, successMessage) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api(`/api/admin/users/${id}`, { method: 'PATCH', body });
      setNote(successMessage);
      await reload();
      await onChanged?.(successMessage);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const user = data?.user;
    if (!user || !window.confirm(`Delete ${user.email} and all of their data? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api(`/api/admin/users/${id}`, { method: 'DELETE' });
      await onChanged?.('Account deleted.');
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (loading) return <Card title="Account"><Loading /></Card>;
  if (!data) return null;

  const user = data.user;

  return (
    <Card
      title={user.name}
      description={user.email}
      actions={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <MiniAvatar user={user} size="h-14 w-14" />
            <div className="flex flex-wrap gap-2">
              <Badge tone={user.plan?.plan === 'premium' ? 'green' : 'slate'}>
                {data.subscription.plan === 'premium' ? 'Premium' : 'Free'}
              </Badge>
              <Badge tone={user.role === 'admin' ? 'amber' : 'slate'}>
                {user.role === 'admin' ? 'Admin' : 'Student'}
              </Badge>
              {user.emailVerified ? <Badge tone="green">Email verified</Badge> : <Badge tone="amber">Email unverified</Badge>}
              {user.suspended ? <Badge tone="red">Suspended</Badge> : <Badge tone="green">Active</Badge>}
              {user.twoFactorEnabled ? <Badge tone="green">2FA on</Badge> : <Badge tone="slate">2FA off</Badge>}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Row label="User id" value={<span className="font-mono text-xs">{user.id}</span>} wide />
            <Row label="Phone" value={user.phone || '—'} />
            <Row label="Joined" value={formatDate(user.createdAt)} />
            <Row label="Last login" value={formatDate(user.lastLoginAt)} />
            <Row label="Subscription" value={data.subscription.status || '—'} />
            <Row label="Period ends" value={formatDate(data.subscription.currentPeriodEnd)} />
            <Row label="AI this month" value={data.usage.generationsThisMonth} />
          </dl>

          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              ['Documents', data.counts.documents],
              ['Decks', data.counts.decks],
              ['Cards', data.counts.cards],
              ['Reviews', data.counts.reviews],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-2">
                <p className="text-lg font-semibold text-slate-900">{value}</p>
                <p className="text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>

          {user.suspended && user.suspendedReason && (
            <Note kind="warn">Suspended: {user.suspendedReason}</Note>
          )}

          {note && <Note>{note}</Note>}
          {error && <Note kind="error">{error}</Note>}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => patch({ role: user.role === 'admin' ? 'user' : 'admin' }, 'Role updated.')}
            >
              {user.role === 'admin' ? 'Remove admin' : 'Make admin'}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => patch({ emailVerified: !user.emailVerified }, 'Verification updated.')}
            >
              {user.emailVerified ? 'Mark email unverified' : 'Mark email verified'}
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !user.twoFactorEnabled}
              onClick={() => patch({ resetTwoFactor: true }, 'Two-factor reset; user signed out.')}
            >
              Reset 2FA
            </Button>
            <Button variant="danger" disabled={busy} onClick={remove}>
              Delete account
            </Button>
          </div>

          {!user.suspended ? (
            <div className="flex flex-wrap items-end gap-2">
              <Input
                label="Suspend with a reason"
                value={suspendReason}
                onChange={setSuspendReason}
                placeholder="e.g. abusive uploads"
                className="flex-1"
              />
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  patch(
                    { suspended: true, suspendedReason: suspendReason || 'Suspended by an administrator.' },
                    'Account suspended; sessions signed out.',
                  )
                }
              >
                Suspend
              </Button>
            </div>
          ) : (
            <Button variant="ghost" disabled={busy} onClick={() => patch({ suspended: false }, 'Suspension lifted.')}>
              Lift suspension
            </Button>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Recent AI runs</h3>
            {data.recentRuns.length === 0 ? (
              <p className="text-sm text-slate-500">No runs yet.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {data.recentRuns.map((run) => (
                  <li key={run.id} className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1.5">
                    <span className="truncate text-slate-600">{run.documentFilename || shortId(run.id)}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone={run.status === 'failed' ? 'red' : run.status === 'completed' ? 'green' : 'amber'}>
                        {run.status}
                      </Badge>
                      <span className="text-xs text-slate-400">{formatDate(run.createdAt).split(',')[0]}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Recent admin actions</h3>
            {data.recentAudit.length === 0 ? (
              <p className="text-sm text-slate-500">No admin actions recorded.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {data.recentAudit.map((entry) => (
                  <li key={entry.id} className="rounded border border-slate-100 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-700">{entry.action}</span>
                      <span className="text-xs text-slate-400">{formatDate(entry.createdAt)}</span>
                    </div>
                    <p className="text-xs text-slate-500">by {entry.actorEmail || 'unknown'}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// --- runs -------------------------------------------------------------------

function Runs({ onError }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState(null);
  const query = `/api/admin/runs?status=${encodeURIComponent(status)}&page=${page}&limit=20`;
  const { data, loading, reload } = useAdminData(query, onError);

  const retry = async (run) => {
    setBusyId(run.id);
    setNote(null);
    try {
      await api(`/api/admin/runs/${run.id}/retry`, { method: 'POST' });
      setNote('Run queued again.');
      await reload();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card title="AI generation runs" description="Retry a failed run after fixing the provider or quota.">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: '', label: 'Any status' },
            { value: 'failed', label: 'Failed' },
            { value: 'running', label: 'Running' },
            { value: 'completed', label: 'Completed' },
            { value: 'partial', label: 'Partial' },
          ]}
        />
        <Button variant="ghost" onClick={reload}>
          Refresh
        </Button>
        {note && <Note>{note}</Note>}
      </div>

      {loading ? (
        <Loading />
      ) : !data?.runs.length ? (
        <p className="text-sm text-slate-500">No runs match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-2 pr-4 font-medium">User</th>
                <th className="py-2 pr-4 font-medium">Document</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Cards</th>
                <th className="py-2 pr-4 font-medium">Created</th>
                <th className="py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((run) => (
                <tr key={run.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5 pr-4">
                    <p className="font-medium text-slate-800">{run.userName || '—'}</p>
                    <p className="text-xs text-slate-500">{run.userEmail || shortId(run.userId)}</p>
                  </td>
                  <td className="py-2.5 pr-4 text-slate-600">{run.documentFilename || shortId(run.documentId)}</td>
                  <td className="py-2.5 pr-4">
                    <Badge tone={run.status === 'failed' ? 'red' : run.status === 'completed' ? 'green' : 'amber'}>
                      {run.status}
                    </Badge>
                    {run.error && <p className="mt-1 max-w-xs truncate text-xs text-red-600" title={run.error}>{run.error}</p>}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-600">{run.cardCount}</td>
                  <td className="py-2.5 pr-4 text-slate-500">{formatDate(run.createdAt)}</td>
                  <td className="py-2.5">
                    {run.status === 'failed' && (
                      <Button variant="ghost" disabled={busyId === run.id} onClick={() => retry(run)}>
                        {busyId === run.id ? 'Queueing…' : 'Retry'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} />
    </Card>
  );
}

// --- jobs -------------------------------------------------------------------

function Jobs({ onError }) {
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState(null);
  const query = `/api/admin/jobs?status=${encodeURIComponent(status)}&type=${encodeURIComponent(type)}&page=${page}&limit=20`;
  const { data, loading, reload } = useAdminData(query, onError);

  const retry = async (job) => {
    setBusyId(job.id);
    setNote(null);
    try {
      await api(`/api/admin/jobs/${job.id}/retry`, { method: 'POST' });
      setNote('Job queued again.');
      await reload();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card title="Job queue" description="Stuck or failed jobs can be queued again.">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: '', label: 'Any status' },
            { value: 'queued', label: 'Queued' },
            { value: 'running', label: 'Running' },
            { value: 'failed', label: 'Failed' },
            { value: 'completed', label: 'Completed' },
          ]}
        />
        <Select
          label="Type"
          value={type}
          onChange={(v) => {
            setType(v);
            setPage(1);
          }}
          options={[
            { value: '', label: 'Any type' },
            { value: 'extract', label: 'Extract' },
            { value: 'generate', label: 'Generate' },
          ]}
        />
        <Button variant="ghost" onClick={reload}>
          Refresh
        </Button>
        {note && <Note>{note}</Note>}
      </div>
      {data?.counts && (
        <p className="mb-3 text-xs text-slate-500">
          {Object.entries(data.counts)
            .map(([key, value]) => `${key}: ${value}`)
            .join(' · ')}
        </p>
      )}

      {loading ? (
        <Loading />
      ) : !data?.jobs.length ? (
        <p className="text-sm text-slate-500">No jobs match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Attempts</th>
                <th className="py-2 pr-4 font-medium">Next run</th>
                <th className="py-2 pr-4 font-medium">Last error</th>
                <th className="py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((job) => (
                <tr key={job.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5 pr-4 font-medium text-slate-800">{job.type}</td>
                  <td className="py-2.5 pr-4">
                    <Badge tone={job.status === 'failed' ? 'red' : job.status === 'completed' ? 'green' : 'amber'}>
                      {job.status}
                    </Badge>
                  </td>
                  <td className="py-2.5 pr-4 text-slate-600">
                    {job.attempts}/{job.maxAttempts}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-500">{formatDate(job.nextRunAt)}</td>
                  <td className="max-w-xs py-2.5 pr-4">
                    <p className="truncate text-xs text-red-600" title={job.lastError || ''}>
                      {job.lastError || '—'}
                    </p>
                  </td>
                  <td className="py-2.5">
                    {job.status === 'failed' && (
                      <Button variant="ghost" disabled={busyId === job.id} onClick={() => retry(job)}>
                        {busyId === job.id ? 'Queueing…' : 'Retry'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} />
    </Card>
  );
}

// --- settings ---------------------------------------------------------------

function SettingsPanel({ onError }) {
  const [settings, setSettings] = useState(null);
  const [environment, setEnvironment] = useState(null);
  const [free, setFree] = useState('0');
  const [premium, setPremium] = useState('0');
  const [signupsEnabled, setSignupsEnabled] = useState(true);
  const [generationEnabled, setGenerationEnabled] = useState(true);
  const [announcement, setAnnouncement] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api('/api/admin/settings');
      setSettings(data.settings);
      setEnvironment(data.environment);
      setFree(String(data.settings.generationsPerMonth.free));
      setPremium(String(data.settings.generationsPerMonth.premium));
      setSignupsEnabled(data.settings.signupsEnabled);
      setGenerationEnabled(data.settings.generationEnabled);
      setAnnouncement(data.settings.announcement ?? '');
    } catch (err) {
      onError?.(err.message);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const data = await api('/api/admin/settings', {
        method: 'PATCH',
        body: {
          generationsPerMonth: {
            free: Number(free),
            premium: Number(premium),
          },
          signupsEnabled,
          generationEnabled,
          announcement,
        },
      });
      setSettings(data.settings);
      setEnvironment(data.environment);
      setNote('Settings saved. Changes apply immediately.');
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return <Loading />;

  return (
    <div className="space-y-4">
      <Card
        title="Runtime settings"
        description="Safe to change without a deploy. Prices and provider credentials stay in environment variables."
      >
        <form onSubmit={save} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Free plan AI generations / month"
              type="number"
              min="0"
              max="100000"
              value={free}
              onChange={setFree}
            />
            <Input
              label="Premium plan AI generations / month"
              type="number"
              min="0"
              max="100000"
              value={premium}
              onChange={setPremium}
            />
          </div>

          <div className="space-y-3">
            <Toggle
              label="Allow new signups"
              description="When off, the register page says signups are paused and the server rejects new accounts."
              checked={signupsEnabled}
              onChange={setSignupsEnabled}
            />
            <Toggle
              label="Allow AI generation"
              description="When off, new generation runs are refused. Studying and existing decks keep working."
              checked={generationEnabled}
              onChange={setGenerationEnabled}
            />
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Announcement</span>
            <textarea
              value={announcement}
              onChange={(e) => setAnnouncement(e.target.value)}
              rows={2}
              maxLength={280}
              placeholder="Shown at the top of the app when non-empty."
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-forest-700 focus:outline-none focus:ring-1 focus:ring-forest-700"
            />
            <span className="mt-1 block text-xs text-slate-400">{announcement.length}/280</span>
          </label>

          {note && <Note>{note}</Note>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </Button>
        </form>
      </Card>

      {environment && (
        <Card title="Environment" description="Read-only; change these in server environment variables.">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row label="Mode" value={environment.nodeEnv} />
            <Row label="Email" value={environment.mailConfigured ? 'SMTP configured' : 'Not configured'} bad={!environment.mailConfigured} />
            <Row label="Billing" value={environment.billingConfigured ? environment.billingMode : 'Disabled'} bad={!environment.billingConfigured} />
            <Row label="AI provider" value={environment.aiConfigured ? 'Configured' : 'Not configured'} bad={!environment.aiConfigured} />
          </dl>
        </Card>
      )}
    </div>
  );
}

function Toggle({ label, description, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-slate-200 p-3">
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 accent-forest-800"
      />
    </label>
  );
}

// --- audit ------------------------------------------------------------------

function Audit({ onError }) {
  const [action, setAction] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const query = `/api/admin/audit?action=${encodeURIComponent(applied)}&page=${page}&limit=30`;
  const { data, loading } = useAdminData(query, onError);

  return (
    <Card title="Audit trail" description="Every admin mutation, in reverse chronological order.">
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setApplied(action);
        }}
      >
        <Input
          label="Action"
          value={action}
          onChange={setAction}
          placeholder="e.g. user.update"
          className="w-56"
        />
        <Button type="submit">Filter</Button>
        {applied && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setAction('');
              setApplied('');
              setPage(1);
            }}
          >
            Clear
          </Button>
        )}
      </form>

      {loading ? (
        <Loading />
      ) : !data?.entries.length ? (
        <p className="text-sm text-slate-500">No audit entries.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Actor</th>
                <th className="py-2 pr-4 font-medium">Action</th>
                <th className="py-2 pr-4 font-medium">Target</th>
                <th className="py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-100 last:border-0">
                  <td className="whitespace-nowrap py-2.5 pr-4 text-slate-500">{formatDate(entry.createdAt)}</td>
                  <td className="py-2.5 pr-4 text-slate-600">{entry.actorEmail || shortId(entry.actorId)}</td>
                  <td className="py-2.5 pr-4 font-medium text-slate-800">{entry.action}</td>
                  <td className="py-2.5 pr-4 text-slate-600">
                    {entry.targetType ? `${entry.targetType}: ${shortId(entry.targetId)}` : '—'}
                  </td>
                  <td className="max-w-md py-2.5">
                    <code className="block truncate text-xs text-slate-500" title={JSON.stringify(entry.detail)}>
                      {entry.detail ? JSON.stringify(entry.detail) : '—'}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} onPage={setPage} />
    </Card>
  );
}
