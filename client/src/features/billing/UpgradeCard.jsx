import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client.js';

// Shows the current plan and usage; "Upgrade" starts a Stripe Checkout
// session and redirects to it. Degrades with a note when billing isn't
// configured on the server.
export default function UpgradeCard() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/billing/subscription')
      .then(setInfo)
      .catch((err) => setError(err.message));
  }, []);

  async function upgrade() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api('/api/billing/checkout', { method: 'POST' });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? err.message : 'Could not start checkout. Try again later.');
      setBusy(false);
    }
  }

  if (error && !info) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">{error}</div>
    );
  }
  if (!info) {
    return <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading plan…</div>;
  }

  const isPremium = info.plan.id === 'premium';
  const limit = info.plan.limits.generationsPerMonth;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">{info.plan.name} plan</p>
          <p className="mt-0.5 text-xs text-slate-500">
            AI generations: {info.used} / {limit} this month
          </p>
        </div>
        {!isPremium && (
          <button
            onClick={upgrade}
            disabled={busy}
            className="rounded-md bg-forest-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-700 disabled:opacity-60"
          >
            {busy ? 'Redirecting…' : 'Upgrade'}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
