import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import CheckoutButton from './CheckoutButton.jsx';

// Shows the current plan and usage; "Upgrade" starts a Cashfree subscription
// checkout. Degrades with a note when billing isn't configured on the server.
export default function UpgradeCard() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/billing/subscription')
      .then(setInfo)
      .catch((err) => setError(err.message));
  }, []);

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
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{info.plan.name} plan</p>
          <p className="mt-0.5 text-xs text-slate-500">
            AI generations: {info.used} / {limit} this month
          </p>
        </div>
        {!isPremium && (
          <CheckoutButton
            label="Upgrade"
            buttonClassName="rounded-md bg-forest-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-700 disabled:opacity-60"
          />
        )}
      </div>
    </div>
  );
}
