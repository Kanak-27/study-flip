import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import Tooltip from '../../components/Tooltip.jsx';
import CheckoutButton from './CheckoutButton.jsx';

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
  const [canceling, setCanceling] = useState(false);
  const [searchParams] = useSearchParams();
  const returningFromCheckout = searchParams.get('upgraded') === '1';

  useEffect(() => {
    api('/api/plans')
      .then((d) => setPlans(d.plans))
      .catch((err) => setError(err.message));
    refreshSubscription().catch(() => setSubInfo(null));
  }, []);

  // Cashfree redirects back here before its webhook may have landed, so poll a
  // few times instead of showing "Free plan" to someone who just paid.
  useEffect(() => {
    if (!returningFromCheckout) return undefined;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      try {
        const info = await refreshSubscription();
        if (info.plan.id === 'premium' || attempts >= 6) clearInterval(timer);
      } catch {
        if (attempts >= 6) clearInterval(timer);
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [returningFromCheckout]);

  async function refreshSubscription() {
    const info = await api('/api/billing/subscription');
    setSubInfo(info);
    return info;
  }

  async function cancel() {
    if (!window.confirm('Cancel Premium? You keep access until the end of the period you already paid for.')) {
      return;
    }
    setCanceling(true);
    setNote(null);
    try {
      const { subscription } = await api('/api/billing/cancel', { method: 'POST' });
      setSubInfo((info) => (info ? { ...info, subscription } : info));
      setNote('Subscription cancelled. Premium stays active until the end of the current period.');
    } catch (err) {
      setNote(err.message);
    } finally {
      setCanceling(false);
    }
  }

  if (error) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      </main>
    );
  }

  const currentPlanId = subInfo?.plan?.id ?? 'free';
  const subscription = subInfo?.subscription;
  const isCancelled = subscription?.status === 'canceled';

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Plans &amp; pricing</h2>
          <p className="mt-1 text-sm text-slate-500">
            Studying, decks and the dashboard are free forever — paid plans raise the AI
            generation quota.
          </p>
        </div>
        {subInfo && (
          <p className="max-w-full rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
            Current plan: {subInfo.plan.name}
            {' · '}
            {subInfo.used} / {subInfo.plan.limits.generationsPerMonth} generations used this month
          </p>
        )}
      </div>

      {returningFromCheckout && currentPlanId !== 'premium' && (
        <p role="status" className="mt-4 rounded-md bg-forest-50 px-3 py-2 text-sm text-forest-800">
          Payment received — activating Premium. This usually takes a few seconds; refresh if it
          doesn&apos;t update.
        </p>
      )}
      {returningFromCheckout && currentPlanId === 'premium' && (
        <p role="status" className="mt-4 rounded-md bg-forest-50 px-3 py-2 text-sm text-forest-800">
          Payment confirmed — welcome to Premium.
        </p>
      )}

      {note && (
        <p role="status" className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {note}
        </p>
      )}

      {currentPlanId === 'premium' && subscription && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
          {isCancelled ? (
            <span>
              Subscription cancelled. Premium stays active until{' '}
              {formatDate(subscription.currentPeriodEnd)}.
            </span>
          ) : (
            <>
              <span>
                Renews automatically
                {subscription.currentPeriodEnd
                  ? ` on ${formatDate(subscription.currentPeriodEnd)}`
                  : ' every month'}
                .
              </span>
              <button
                type="button"
                onClick={cancel}
                disabled={canceling}
                className="font-semibold text-red-600 hover:text-red-700 disabled:opacity-60"
              >
                {canceling ? 'Cancelling…' : 'Cancel subscription'}
              </button>
            </>
          )}
        </div>
      )}

      {plans === null ? (
        <p className="mt-8 text-sm text-slate-500">Loading plans…</p>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {plans.map((plan) => {
            const isCurrent = plan.id === currentPlanId;
            const isPremium = plan.id === 'premium';
            const symbol = plan.currency === 'INR' ? '₹' : '$';
            return (
              <section
                key={plan.id}
                className={`relative flex flex-col rounded-2xl border bg-white p-5 sm:p-6 ${
                  isPremium ? 'border-forest-700 shadow-lg' : 'border-slate-200'
                }`}
              >
                {isPremium && (
                  <span className="absolute -top-3 left-6 rounded-full bg-forest-800 px-3 py-0.5 text-xs font-semibold text-white">
                    Most popular
                  </span>
                )}

                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-semibold text-slate-900">{plan.name}</h3>
                  <p className="text-2xl font-bold text-slate-900">
                    {symbol}
                    {plan.priceMonthly}
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
                    <div key={key} className="flex items-center justify-between gap-3">
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
                    <CheckoutButton buttonClassName="btn-primary w-full justify-center" />
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

      <p className="mt-8 text-xs leading-relaxed text-slate-400">
        Quotas reset at the start of each calendar month. Cancelling stops future charges; Premium
        stays active until the period you already paid for ends.
      </p>
    </main>
  );
}

function formatDate(value) {
  if (!value) return 'the end of the current period';
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
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
