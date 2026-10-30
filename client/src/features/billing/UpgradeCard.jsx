import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';

// Shows the current plan and usage; "Upgrade" leads to the pricing page so
// people compare plans there instead of being dropped into a payment flow
// from the upload page. Degrades with a note when billing isn't configured
// on the server.
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
          <Link
            to="/plans"
            className="rounded-md bg-forest-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-700"
          >
            Upgrade
          </Link>
        )}
      </div>
    </div>
  );
}
