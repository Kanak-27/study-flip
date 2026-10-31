import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { api, apiUpload, avatarUrl } from '../../api/client.js';
import { ShowPasswordButton, useShowPassword } from '../../components/ShowPasswordButton.jsx';

// Everything the signed-in user can change about themselves. Kept on one page
// (rather than a settings labyrinth) because each section is small and the
// user usually wants to check several at once.
export default function ProfilePage() {
  const { user, updateUser, logout } = useAuth();
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/me')
      .then(setAccount)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Your profile</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage your details, security and account.
          </p>
        </div>
        <Link to="/plans" className="text-sm font-medium text-forest-800 hover:text-forest-700">
          View plans
        </Link>
      </div>

      {error && <ErrorNote className="mb-6">{error}</ErrorNote>}

      <div className="space-y-6">
        <IdentityCard user={user} account={account} updateUser={updateUser} />
        <DetailsCard user={user} updateUser={updateUser} />
        <PasswordCard />
        <TwoFactorCard user={user} updateUser={updateUser} />
        <SessionCard onLogout={logout} />
        <DangerCard
          onDeleted={async () => {
            await logout().catch(() => {});
            navigate('/', { replace: true });
          }}
        />
      </div>
    </main>
  );
}

// --- small pieces -----------------------------------------------------------

function Card({ title, description, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Note({ kind = 'ok', children }) {
  const tone =
    kind === 'error'
      ? 'bg-red-50 text-red-700'
      : kind === 'warn'
        ? 'bg-amber-50 text-amber-800'
        : 'bg-forest-50 text-forest-800';
  return <p className={`rounded-md px-3 py-2 text-sm ${tone}`}>{children}</p>;
}

function ErrorNote({ children, className = '' }) {
  return (
    <p role="alert" className={`rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ${className}`}>
      {children}
    </p>
  );
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
      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

function Input({ label, value, onChange, type = 'text', hint, ...rest }) {
  // Password fields on this page (change password, 2FA off, delete account)
  // all come through here, so one toggle covers them.
  const reveal = useShowPassword();
  const isPassword = type === 'password';
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <span className="relative block">
        <input
          type={isPassword ? reveal.type : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
          className={`w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-forest-700 focus:outline-none focus:ring-1 focus:ring-forest-700 ${
            isPassword ? 'pr-10' : ''
          }`}
        />
        {isPassword && <ShowPasswordButton shown={reveal.shown} onToggle={reveal.toggle} />}
      </span>
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

function Avatar({ user, size = 'h-20 w-20' }) {
  const url = avatarUrl(user);
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={`${size} rounded-full border border-slate-200 object-cover`}
      />
    );
  }
  const initial = (user?.name ?? '?').trim().charAt(0).toUpperCase();
  return (
    <div
      className={`${size} flex items-center justify-center rounded-full bg-forest-100 text-2xl font-semibold text-forest-800`}
    >
      {initial}
    </div>
  );
}

// --- sections ---------------------------------------------------------------

function IdentityCard({ user, account, updateUser }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const onPick = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMessage(null);
    setError(null);
    if (file.size > 2 * 1024 * 1024) {
      setError('Choose an image smaller than 2 MB.');
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('avatar', file);
      const data = await apiUpload('/api/me/avatar', form);
      updateUser(data.user);
      setMessage('Profile picture updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setMessage(null);
    setError(null);
    setBusy(true);
    try {
      const data = await api('/api/me/avatar', { method: 'DELETE' });
      updateUser(data.user);
      setMessage('Profile picture removed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const plan = account?.plan;
  return (
    <Card title="Account" description="Your picture, address and current plan.">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
        <Avatar user={user} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-lg font-medium text-slate-900">{user.name}</p>
          <p className="break-all text-sm text-slate-500">{user.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
              {user.role === 'admin' ? 'Administrator' : 'Student'}
            </span>
            {user.emailVerifiedAt && (
              <span className="rounded-full bg-forest-50 px-2 py-0.5 font-medium text-forest-800">
                Email verified
              </span>
            )}
            {plan && (
              <span className="rounded-full bg-forest-50 px-2 py-0.5 font-medium text-forest-800">
                {plan.name} plan
                {account?.used !== undefined && plan.id === 'free'
                  ? ` · ${account.used}/${plan.limits.generationsPerMonth} AI runs`
                  : ''}
              </span>
            )}
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={onPick}
          />
          <Button variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Uploading…' : 'Change picture'}
          </Button>
          {user.hasAvatar && (
            <Button variant="danger" disabled={busy} onClick={onRemove}>
              Remove
            </Button>
          )}
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400">JPG, PNG or WebP, up to 2 MB.</p>
      {message && (
        <div className="mt-3">
          <Note>{message}</Note>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Note kind="error">{error}</Note>
        </div>
      )}
    </Card>
  );
}

function DetailsCard({ user, updateUser }) {
  const [name, setName] = useState(user.name ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [bio, setBio] = useState(user.bio ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    setBusy(true);
    try {
      const data = await api('/api/me', {
        method: 'PATCH',
        body: { name, phone, bio },
      });
      updateUser(data.user);
      setMessage('Profile saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Personal details" description="Shown across the app. Email is used to sign in and cannot be changed here.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Name" value={name} onChange={setName} required maxLength={100} />
          <Input
            label="Phone"
            value={phone}
            onChange={setPhone}
            hint="Used by the payment provider for subscriptions."
            maxLength={20}
          />
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Bio</span>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            maxLength={280}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-forest-700 focus:outline-none focus:ring-1 focus:ring-forest-700"
            placeholder="A line about what you are studying."
          />
          <span className="mt-1 block text-xs text-slate-400">{bio.length}/280</span>
        </label>
        {message && <Note>{message}</Note>}
        {error && <Note kind="error">{error}</Note>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save details'}
        </Button>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (newPassword !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api('/api/me/password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      setMessage('Password changed. Other browsers were signed out.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Password" description="Changing it signs you out everywhere else.">
      <form onSubmit={onSubmit} className="space-y-4">
        <Input
          label="Current password"
          type="password"
          value={currentPassword}
          onChange={setCurrentPassword}
          required
          autoComplete="current-password"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="New password"
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            required
            autoComplete="new-password"
            hint="At least 8 characters"
          />
          <Input
            label="Confirm new password"
            type="password"
            value={confirm}
            onChange={setConfirm}
            required
            autoComplete="new-password"
          />
        </div>
        {message && <Note>{message}</Note>}
        {error && <Note kind="error">{error}</Note>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Updating…' : 'Change password'}
        </Button>
      </form>
    </Card>
  );
}

function TwoFactorCard({ user, updateUser }) {
  const [setup, setSetup] = useState(null); // { secret, qr, otpauthUrl }
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const clearFeedback = () => {
    setMessage(null);
    setError(null);
  };

  const startSetup = async () => {
    clearFeedback();
    setBusy(true);
    try {
      const data = await api('/api/me/2fa/setup', { method: 'POST' });
      setSetup(data);
      setRecoveryCodes(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const enable = async (e) => {
    e.preventDefault();
    clearFeedback();
    setBusy(true);
    try {
      const data = await api('/api/me/2fa/enable', { method: 'POST', body: { code } });
      updateUser(data.user);
      setRecoveryCodes(data.recoveryCodes);
      setSetup(null);
      setCode('');
      setMessage('Two-factor authentication is on. Save your recovery codes below.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const disable = async (e) => {
    e.preventDefault();
    clearFeedback();
    setBusy(true);
    try {
      const data = await api('/api/me/2fa/disable', { method: 'POST', body: { password } });
      updateUser(data.user);
      setPassword('');
      setRecoveryCodes(null);
      setMessage('Two-factor authentication is off.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Two-factor authentication"
      description="Require a code from your authenticator app in addition to your password."
    >
      {user.twoFactorEnabled ? (
        <div className="space-y-4">
          <Note>
            Two-factor authentication is enabled. At sign-in you will be asked for a 6-digit code.
          </Note>
          <form onSubmit={disable} className="space-y-3">
            <Input
              label="Confirm with your password to turn it off"
              type="password"
              value={password}
              onChange={setPassword}
              required
              autoComplete="current-password"
            />
            <Button type="submit" variant="danger" disabled={busy}>
              {busy ? 'Turning off…' : 'Turn off two-factor'}
            </Button>
          </form>
        </div>
      ) : setup ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Scan this QR code with Google Authenticator, Authy or 1Password, then enter the
            6-digit code it shows.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <img
              src={setup.qr}
              alt="Two-factor setup QR code"
              className="h-40 w-40 rounded border border-slate-200 bg-white p-2"
            />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Manual setup key
              </p>
              <code className="mt-1 block break-all rounded bg-slate-50 px-2 py-1 text-sm text-slate-700">
                {setup.secret}
              </code>
            </div>
          </div>
          <form onSubmit={enable} className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="w-full sm:w-48">
              <Input
                label="6-digit code"
                value={code}
                onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? 'Verifying…' : 'Turn on two-factor'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSetup(null);
                setCode('');
                clearFeedback();
              }}
            >
              Cancel
            </Button>
          </form>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-slate-600">
            Two-factor authentication is currently off.
          </p>
          <Button onClick={startSetup} disabled={busy}>
            {busy ? 'Preparing…' : 'Set up two-factor'}
          </Button>
        </div>
      )}

      {recoveryCodes && (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Save these recovery codes now — they are shown only once.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm text-amber-900 sm:grid-cols-2">
            {recoveryCodes.map((recoveryCode) => (
              <span key={recoveryCode}>{recoveryCode}</span>
            ))}
          </div>
          <Button
            variant="ghost"
            className="mt-3 !border-amber-300 !text-amber-900"
            onClick={() => setRecoveryCodes(null)}
          >
            I saved them
          </Button>
        </div>
      )}

      {message && (
        <div className="mt-4">
          <Note>{message}</Note>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Note kind="error">{error}</Note>
        </div>
      )}
    </Card>
  );
}

function SessionCard({ onLogout }) {
  return (
    <Card title="Session" description="Sign out of this browser.">
      <Button variant="ghost" onClick={onLogout}>
        Sign out
      </Button>
    </Card>
  );
}

function DangerCard({ onDeleted }) {
  const [password, setPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const onDelete = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('/api/me', { method: 'DELETE', body: { password } });
      await onDeleted();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-red-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold text-red-700">Delete account</h2>
      <p className="mt-1 text-sm text-slate-500">
        Permanently removes your decks, cards, documents, review history and subscription
        record. This cannot be undone.
      </p>
      {!confirming ? (
        <Button variant="danger" className="mt-4" onClick={() => setConfirming(true)}>
          Delete my account
        </Button>
      ) : (
        <form onSubmit={onDelete} className="mt-4 max-w-sm space-y-3">
          <Input
            label="Enter your password to confirm"
            type="password"
            value={password}
            onChange={setPassword}
            required
            autoComplete="current-password"
          />
          {error && <Note kind="error">{error}</Note>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" disabled={busy}>
              {busy ? 'Deleting…' : 'Yes, delete everything'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setConfirming(false);
                setPassword('');
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
