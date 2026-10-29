import { config } from '../../platform/config.js';
import { getSettings } from '../../platform/settings.js';

// Plans and their entitlements. Free must cover the whole learning loop —
// quotas only limit generation volume (PLAN.md §2, §10).
//
// Quotas come from runtime settings so an admin can adjust them without a
// deploy. Pricing lives in env (`CASHFREE_PLAN_AMOUNT`, INR) because Cashfree
// charges in the currency the plan was created with; the UI reads it from
// GET /api/plans so the price shown and the price charged cannot drift apart.
//
// Upload caps are the same on both plans on purpose: PDFs are stored inline in
// Mongo, whose 16 MB document limit caps us long before the plan does. Raising
// Premium to a bigger PDF needs object storage first.
export function getPlans() {
  const { generationsPerMonth } = getSettings();
  return {
    free: {
      id: 'free',
      name: 'Free',
      priceMonthly: 0,
      currency: 'INR',
      limits: {
        generationsPerMonth: generationsPerMonth.free,
        maxUploadMb: 10,
      },
      features: ['manual_decks', 'study', 'spaced_repetition', 'dashboard'],
    },
    premium: {
      id: 'premium',
      name: 'Premium',
      priceMonthly: config.CASHFREE_PLAN_AMOUNT,
      currency: 'INR',
      limits: {
        generationsPerMonth: generationsPerMonth.premium,
        maxUploadMb: 10,
      },
      features: ['manual_decks', 'study', 'spaced_repetition', 'dashboard', 'ai_generation'],
    },
  };
}

export function getPlan(planId) {
  const plans = getPlans();
  return plans[planId] ?? plans.free;
}
