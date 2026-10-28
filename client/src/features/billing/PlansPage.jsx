import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client.js';
import Tooltip from '../../components/Tooltip.jsx';

// Plans are fetched from the server (`GET /api/plans`) so this page never
// hard-codes a price the backend doesn't agree with.
const FEATURE_LABELS = {
  manual_decks: 'Create and rename your own decks',
  study: 'Unlimited study sessions',
  spaced_repetition: 'SM-2 spaced repetition scheduling',
  dashboard: 'Dashboard, streaks and recall stats',
  ai_generation: 'AI flashcard generation from PDFs',
};

const LIMIT_LABELS = {
  generationsPerMonth: 'AI generations per month',
  maxUploadMb: 'Maximum PDF size per upload',
};

export default function PlansPage() {
  const [plans, setPlans] = useState(null);
  const [subInfo, setSubInfo] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/plans')
      .then((d) => setPlans(d.plans))
      .catch((err) => setError(err.message));
    api('/api/billing/subscription')
      .then(setSubInfo)
      .catch(() => setSubInfo(null));
  }, []);

  async function upgrade() {
    setBusy(true);
    setNote(null);
    try {
      const { url } = await api('/api/billing/checkout', { method: 'POST' });
      window.location.href = url;
    } catch (err) {
      setNote(
        err instanceof ApiError && err.status === 404
          ? err.message
          : 'Could not start checkout. Try again later.',
      );
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      </main>
    );
  }

  const currentPlanId = subInfo?.plan?.id ?? 'free';

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Plans &amp; pricing</h2>
          <p className="mt-1 text-sm text-slate-500">
            Studying, decks and the dashboard are free forever — paid plans raise the AI
            generation quota and file size.
          </p>
        </div>
        {subInfo && (
          <p className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
            Current plan: {subInfo.plan.name}
            {' · '}
            {subInfo.used} / {subInfo.plan.limits.generationsPerMonth} generations used this month
          </p>
        )}
      </div>

      {note && (
        <p role="status" className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {note}
        </p>
      )}

      {plans === null ? (
        <p className="mt-8 text-sm text-slate-500">Loading plans…</p>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {plans.map((plan) => {
            const isCurrent = plan.id === currentPlanId;
            const isPremium = plan.id === 'premium';
            return (
              <section
                key={plan.id}
                className={`relative flex flex-col rounded-2xl border bg-white p-6 ${
                  isPremium ? 'border-forest-700 shadow-lg' : 'border-slate-200'
                }`}
              >
                {isPremium && (
                  <span className="absolute -top-3 left-6 rounded-full bg-forest-800 px-3 py-0.5 text-xs font-semibold text-white">
                    Most popular
                  </span>
                )}

                <div className="flex items-baseline justify-between">
                  <h3 className="text-lg font-semibold text-slate-900">{plan.name}</h3>
                  <p className="text-2xl font-bold text-slate-900">
                    ${plan.priceMonthlyUsd}
                    <span className="text-sm font-normal text-slate-500">/month</span>
                  </p>
                </div>

                <ul className="mt-5 space-y-2.5 text-sm text-slate-700">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-forest-600" />
                      <span>{FEATURE_LABELS[feature] ?? feature}</span>
                    </li>
                  ))}
                </ul>

                <dl className="mt-5 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
                  {Object.entries(plan.limits).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between">
                      <dt className="flex items-center gap-1.5 text-slate-500">
                        {LIMIT_LABELS[key] ?? key}
                        <Tooltip label={limitHint(key, value)} side="top">
                          <button
                            type="button"
                            aria-label={`What is ${LIMIT_LABELS[key] ?? key}?`}
                            className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold text-slate-400 hover:border-forest-600 hover:text-forest-700"
                          >
                            ?
                          </button>
                        </Tooltip>
                      </dt>
                      <dd className="font-semibold text-slate-900">
                        {key === 'generationsPerMonth' ? `${value} / month` : `${value} MB`}
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-6 pt-1">
                  {isCurrent ? (
                    <span className="inline-flex w-full items-center justify-center rounded-full border border-forest-200 bg-forest-50 px-6 py-3 text-sm font-medium text-forest-800">
                      Your current plan
                    </span>
                  ) : isPremium ? (
                    <button onClick={upgrade} disabled={busy} className="btn-primary w-full justify-center">
                      {busy ? 'Redirecting…' : 'Upgrade to Premium'}
                    </button>
                  ) : (
                    <span className="inline-flex w-full items-center justify-center rounded-full border border-slate-300 px-6 py-3 text-sm font-medium text-slate-500">
                      Included free
                    </span>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-8 text-xs text-slate-400">
        Quotas reset at the start of each calendar month. Downgrades and cancellations apply at
        the end of the current period.
      </p>
    </main>
  );
}

function limitHint(key, value) {
  if (key === 'generationsPerMonth') {
    return value === 0
      ? 'AI generation is not included in this plan.'
      : `Upload a PDF and let AI turn it into flashcards up to ${value} times a month. Studying and manual decks are unlimited.`;
  }
  if (key === 'maxUploadMb') return `Largest PDF you can upload: ${value} megabytes.`;
  return String(value);
}

function CheckIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
