import { model, Schema } from 'mongoose';
import { getPlan } from './plans.js';
import { forbidden, badRequest } from '../../platform/errors.js';

const subscriptionSchema = new Schema(
  {
    // single doc per user; absent = free plan
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    planId: { type: String, enum: ['free', 'premium'], default: 'free' },
    status: { type: String, enum: ['active', 'past_due', 'canceled'], default: 'active' },
    provider: { type: String, default: 'stripe' },
    providerCustomerId: { type: String },
    providerSubscriptionId: { type: String },
    currentPeriodEnd: { type: Date },
  },
  { timestamps: true },
);

export const Subscription = model('Subscription', subscriptionSchema);

// --- entitlements ---

// The single source of "what may this user do right now". Every quota check
// and premium gate goes through here, never through a plan literal.
export async function getEntitlements(userId) {
  const sub = await Subscription.findOne({ userId });
  const active = sub && sub.status === 'active' && (!sub.currentPeriodEnd || sub.currentPeriodEnd > new Date());
  const plan = getPlan(active ? sub.planId : 'free');
  return { plan, subscription: sub ?? null };
}

// --- usage quotas ---

export async function generationsUsedThisMonth(userId) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const { UsageEvent } = await import('./usageEvent.model.js');
  return UsageEvent.countDocuments({ userId, type: 'generation', occurredAt: { $gte: start } });
}

// Called before enqueueing a generation run — fail early, before we spend
// AI money on someone over their limit.
export async function assertGenerationAllowed(userId) {
  const { plan } = await getEntitlements(userId);
  const used = await generationsUsedThisMonth(userId);
  if (used >= plan.limits.generationsPerMonth) {
    throw forbidden(
      `You've used all ${plan.limits.generationsPerMonth} AI generations on the ${plan.name} plan this month. Upgrade to continue.`,
    );
  }
  return { plan, used };
}

export async function recordGenerationUsage(userId, quantity = 1) {
  const { UsageEvent } = await import('./usageEvent.model.js');
  await UsageEvent.create({ userId, type: 'generation', quantity });
}

// --- subscription lifecycle (driven by webhooks only) ---

// The webhook is the only writer of entitlements: the client never tells us
// a user paid — Stripe does, once, with a verifiable signature.
export async function upsertSubscription({ userId, customerId, subscriptionId, planId, status, currentPeriodEnd }) {
  const sub = await Subscription.findOneAndUpdate(
    { userId },
    {
      $set: { providerCustomerId: customerId, providerSubscriptionId: subscriptionId, planId, status, currentPeriodEnd },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return sub;
}

export async function cancelSubscription(userId) {
  return Subscription.findOneAndUpdate(
    { userId },
    { $set: { status: 'canceled', planId: 'free' } },
    { new: true },
  );
}

export function parsePlanId(id) {
  if (!['free', 'premium'].includes(id)) throw badRequest('Unknown plan.');
  return id;
}
