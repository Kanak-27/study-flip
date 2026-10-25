// Plans and their entitlements. Free must cover the whole learning loop —
// quotas only limit generation volume (PLAN.md §2, §10).
export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    priceMonthlyUsd: 0,
    limits: {
      generationsPerMonth: 5,
      maxUploadMb: 10,
    },
    features: ['manual_decks', 'study', 'spaced_repetition', 'dashboard'],
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    priceMonthlyUsd: 8,
    stripePriceId: process.env.STRIPE_PRICE_PREMIUM,
    limits: {
      generationsPerMonth: 200,
      maxUploadMb: 25,
    },
    features: ['manual_decks', 'study', 'spaced_repetition', 'dashboard', 'ai_generation'],
  },
};

export function getPlan(planId) {
  return PLANS[planId] ?? PLANS.free;
}
