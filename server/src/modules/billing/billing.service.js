import { model, Schema } from 'mongoose';
import { getPlan } from './plans.js';
import { forbidden, badRequest } from '../../platform/errors.js';

const subscriptionSchema = new Schema(
  {
    // single doc per user; absent = free plan
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    planId: { type: String, enum: ['free', 'premium'], default: 'free' },
    // `pending` = checkout opened, customer has not authorised the mandate yet.
    status: { type: String, enum: ['pending', 'active', 'past_due', 'canceled'], default: 'pending' },
    provider: { type: String, default: 'cashfree' },
    // Cashfree subscription id we generate at checkout (sf-<userId>-<ts>).
    providerSubscriptionId: { type: String, index: true },
    // Cashfree's own numeric reference (cf_subscription_id).
    providerSubscriptionRef: { type: String },
    // End of the period the customer has already paid for. Premium is granted
    // until this moment even if the mandate is cancelled — they paid for it.
    currentPeriodEnd: { type: Date },
    canceledAt: { type: Date },
    // Last time we asked Cashfree for this mandate's real state. Throttles
    // reconciliation so polling the page cannot hammer the provider.
    providerCheckedAt: { type: Date },
  },
  { timestamps: true },
);

export const Subscription = model('Subscription', subscriptionSchema);

// --- entitlements ---

// The single source of "what may this user do right now". Every quota check
// and premium gate goes through here, never through a plan literal.
export async function getEntitlements(userId) {
  const sub = await Subscription.findOne({ userId });
  const now = new Date();
  const entitled = Boolean(
    sub &&
      sub.planId === 'premium' &&
      (sub.currentPeriodEnd ? sub.currentPeriodEnd > now : sub.status === 'active'),
  );
  return { plan: getPlan(entitled ? 'premium' : 'free'), subscription: sub ?? null };
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

// The webhook is the only writer of entitlements: the client never tells us a
// user paid — Cashfree does, with a signature we verify first.
export async function upsertSubscription({
  userId,
  subscriptionId,
  subscriptionRef,
  planId,
  status,
  currentPeriodEnd,
  canceledAt,
}) {
  const $set = { planId, status };
  if (subscriptionId) $set.providerSubscriptionId = subscriptionId;
  if (subscriptionRef) $set.providerSubscriptionRef = subscriptionRef;
  if (currentPeriodEnd !== undefined) $set.currentPeriodEnd = currentPeriodEnd;
  if (canceledAt !== undefined) $set.canceledAt = canceledAt;

  return Subscription.findOneAndUpdate(
    { userId },
    { $set },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function markCheckoutPending({ userId, subscriptionId }) {
  return Subscription.findOneAndUpdate(
    { userId },
    { $set: { providerSubscriptionId: subscriptionId, status: 'pending', planId: 'free' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function findSubscriptionByUserId(userId) {
  return Subscription.findOne({ userId });
}

export async function findSubscriptionByProviderId(subscriptionId) {
  return Subscription.findOne({ providerSubscriptionId: subscriptionId });
}

// Records that we just asked Cashfree for this mandate, even when nothing
// changed — otherwise an abandoned checkout would be re-checked on every poll.
export async function markProviderChecked(userId) {
  await Subscription.updateOne({ userId }, { $set: { providerCheckedAt: new Date() } });
}

export async function cancelSubscription(userId, currentPeriodEnd) {
  return Subscription.findOneAndUpdate(
    { userId },
    { $set: { status: 'canceled', canceledAt: new Date(), currentPeriodEnd } },
    { new: true },
  );
}

export function parsePlanId(id) {
  if (!['free', 'premium'].includes(id)) throw badRequest('Unknown plan.');
  return id;
}
