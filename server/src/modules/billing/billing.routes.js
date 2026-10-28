import { randomUUID } from 'node:crypto';
import { Router, raw, urlencoded } from 'express';
import { getPlans, getPlan } from './plans.js';
import {
  getEntitlements,
  upsertSubscription,
  markCheckoutPending,
  findSubscriptionByUserId,
  findSubscriptionByProviderId,
  cancelSubscription,
  generationsUsedThisMonth,
  markProviderChecked,
} from './billing.service.js';
import {
  billingConfigured,
  cashfreeMode,
  ensurePlan,
  createSubscription,
  cancelProviderSubscription,
  fetchSubscription,
  verifyWebhookSignature,
} from './cashfree.client.js';
import { config } from '../../platform/config.js';
import { AppError, wrap, badRequest, notFound, conflict } from '../../platform/errors.js';
import { logger } from '../../platform/logger.js';
import { User } from '../auth/user.model.js';

export const billingRouter = Router();

// Public billing routes: Cashfree calls these server-to-server or as a browser
// redirect, so they sit outside the session/auth stack. Mounted BEFORE
// express.json() because the webhook signature covers the untouched bytes.
export const billingPublicRouter = Router();

// Cashfree POSTs (form-encoded) to return_url with cf_* parameters once the
// mandate is authorised. Sending that POST straight at the SPA is what produced
// "405 Not Allowed": nginx serves the app as static files and refuses non-GET
// methods, so the fallback to index.html never happens.
//
// The payload itself is not trusted for entitlements — it is only a hint that a
// subscription id exists, and we confirm the truth with Cashfree's API. Answering
// with a 303 turns the POST into a clean GET so a refresh doesn't resubmit it.
async function billingReturn(req, res) {
  try {
    const hint = req.body?.cf_subscriptionId;
    if (typeof hint === 'string' && hint) {
      const sub = await findSubscriptionByProviderId(hint);
      if (sub) await reconcileSubscription(sub, { force: true });
    }
  } catch (err) {
    // Never block the redirect: the SPA also reconciles while polling.
    logger.warn({ err }, 'cashfree return reconcile failed');
  }
  res.redirect(303, `${config.CLIENT_ORIGIN}/plans?upgraded=1`);
}

billingPublicRouter.get('/billing/return', wrap(billingReturn));
billingPublicRouter.post(
  '/billing/return',
  urlencoded({ extended: false, limit: '32kb' }), // drain the form body
  wrap(billingReturn),
);

billingPublicRouter.post(
  '/billing/webhook',
  raw({ type: 'application/json', limit: '1mb' }),
  wrap(async (req, res) => {
    if (!billingConfigured()) throw notFound('Billing is not configured on this server.');

    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';

    // Cashfree's documented algorithm signs with the client secret, but a
    // dashboard-configured "webhook secret" (if present) is what actually gets
    // used. Accept either, so a mismatched CASHFREE_WEBHOOK_SECRET can't make
    // every real webhook 400 while the rest of the setup looks healthy.
    const secrets = [
      config.CASHFREE_WEBHOOK_SECRET,
      config.CASHFREE_CLIENT_SECRET,
    ].filter(Boolean);

    const valid = secrets.some((secret) =>
      verifyWebhookSignature({
        signature: req.headers['x-webhook-signature'],
        timestamp: req.headers['x-webhook-timestamp'],
        rawBody,
        secret,
      }),
    );
    if (!valid) {
      logger.warn({ ip: req.ip }, 'cashfree webhook signature verification failed');
      throw badRequest('Invalid webhook signature.');
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      throw badRequest('Invalid webhook payload.');
    }

    await applyEvent(event);
    logger.info({ type: event?.type }, 'cashfree webhook processed');
    res.json({ received: true });
  }),
);

billingRouter.get('/plans', (_req, res) => {
  res.json({ plans: Object.values(getPlans()) });
});

billingRouter.get(
  '/billing/subscription',
  wrap(async (req, res) => {
    let { plan, subscription } = await getEntitlements(req.userId);

    // Self-heal: webhooks are best-effort. If their URL is wrong, blocked, or
    // the event was never subscribed, a successful payment would otherwise
    // leave the user on Free forever. When we think they are not premium but
    // Cashfree has a mandate for them, ask Cashfree directly — it is the
    // authority, so this cannot be used to grant access without paying.
    if (
      subscription?.providerSubscriptionId &&
      plan.id !== 'premium' &&
      subscription.status !== 'canceled'
    ) {
      const synced = await reconcileSubscription(subscription).catch((err) => {
        logger.warn(
          { err, subscriptionId: subscription.providerSubscriptionId },
          'cashfree reconcile failed',
        );
        return null;
      });
      if (synced) ({ plan, subscription } = await getEntitlements(req.userId));
    }

    const used = await generationsUsedThisMonth(req.userId);
    res.json({
      plan,
      used,
      subscription: publicSubscription(subscription),
      billing: { configured: billingConfigured(), mode: cashfreeMode() },
    });
  }),
);

// Creates a Cashfree subscription (mandate) and returns the session id the
// browser needs to open Cashfree's hosted checkout. 404 when billing is not
// configured so dev environments degrade honestly instead of 500ing.
billingRouter.post(
  '/billing/checkout',
  wrap(async (req, res) => {
    if (!billingConfigured()) throw notFound('Billing is not configured on this server.');

    const { plan: currentPlan } = await getEntitlements(req.userId);
    if (currentPlan.id === 'premium') throw conflict('You are already on the Premium plan.');

    const user = await User.findById(req.userId);
    if (!user) throw new AppError(401, 'unauthorized', 'You must be signed in.');

    const phone = normalizePhone(req.body?.phone) ?? user.phone;
    if (!phone) {
      throw new AppError(400, 'phone_required', 'Add a mobile number to continue to payment.');
    }
    if (req.body?.phone && phone !== user.phone) {
      await User.updateOne({ _id: user._id }, { $set: { phone } });
    }

    const price = getPlan('premium').priceMonthly;
    const planId = await ensurePlan(price);
    // The id encodes the user so a webhook that arrives before we stored the
    // checkout can still be attributed. Cashfree only allows [A-Za-z0-9._-].
    const subscriptionId = `sf-${req.userId}-${Date.now().toString(36)}`;

    const session = await createSubscription({
      subscription_id: subscriptionId,
      customer_details: {
        customer_name: user.name,
        customer_email: user.email,
        customer_phone: phone,
      },
      plan_details: { plan_id: planId },
      authorization_details: {
        // The authorisation payment is the first month's charge, so the
        // customer is never granted Premium on an unpaid mandate.
        authorization_amount: price,
        authorization_amount_refund: false,
        payment_methods: ['upi', 'card'],
      },
      subscription_meta: {
        // Cashfree POSTs back here, so this must hit the API (which 303s to the
        // SPA) rather than the static site. See billingReturn above.
        return_url: config.BILLING_RETURN_URL ?? `${config.CLIENT_ORIGIN}/api/billing/return`,
        notification_channel: ['EMAIL', 'SMS'],
        session_id_expiry: isoIn(30 * 60 * 1000),
      },
      subscription_expiry_time: isoIn(5 * 365 * 24 * 60 * 60 * 1000),
      subscription_tags: {
        psp_note: 'StudyFlip Premium',
        user_id: String(req.userId),
      },
    }, { idempotencyKey: randomUUID() });

    if (!session?.subscription_session_id) {
      logger.error({ session }, 'cashfree did not return a subscription session');
      throw new AppError(502, 'billing_unavailable', 'Could not start checkout. Try again later.');
    }

    await markCheckoutPending({ userId: req.userId, subscriptionId });

    res.json({ subsSessionId: session.subscription_session_id, mode: cashfreeMode() });
  }),
);

billingRouter.post(
  '/billing/cancel',
  wrap(async (req, res) => {
    if (!billingConfigured()) throw notFound('Billing is not configured on this server.');

    const sub = await findSubscriptionByUserId(req.userId);
    if (!sub?.providerSubscriptionId) throw badRequest('You do not have a subscription to cancel.');
    if (sub.status === 'canceled') {
      res.json({ subscription: publicSubscription(sub) });
      return;
    }

    try {
      await cancelProviderSubscription(sub.providerSubscriptionId);
    } catch (err) {
      // Already cancelled (or gone) at Cashfree — our state is still correct.
      if (err.status !== 400 && err.status !== 404) throw err;
      logger.warn({ err, subscriptionId: sub.providerSubscriptionId }, 'cashfree cancel rejected; continuing');
    }

    // Keep Premium until the period they already paid for ends; the mandate
    // itself is cancelled so no further charges are raised.
    const periodEnd = sub.currentPeriodEnd ?? addMonths(new Date(), 1);
    const updated = await cancelSubscription(req.userId, periodEnd);
    res.json({ subscription: publicSubscription(updated) });
  }),
);

// --- webhook handling ---

async function applyEvent(event) {
  const data = event?.data ?? {};
  const details = data.subscription_details ?? {};
  const subscriptionId = data.subscription_id ?? details.subscription_id;

  if (!subscriptionId) {
    logger.info({ type: event?.type }, 'cashfree webhook without subscription id');
    return;
  }

  const existing = await findSubscriptionByProviderId(subscriptionId);
  const userId = existing?.userId ?? userIdFromSubscriptionId(subscriptionId);
  if (!userId) {
    logger.warn({ subscriptionId, type: event?.type }, 'cashfree webhook for unknown subscription');
    return;
  }

  const periodEnd =
    parseCashfreeDate(details.next_schedule_date) ??
    parseCashfreeDate(data.payment_schedule_date) ??
    existing?.currentPeriodEnd ??
    addMonths(new Date(), 1);

  switch (event.type) {
    case 'SUBSCRIPTION_STATUS_CHANGED': {
      const status = details.subscription_status;
      const ref = details.cf_subscription_id ?? data.cf_subscription_id;

      if (status === 'ACTIVE') {
        await upsertSubscription({
          userId,
          subscriptionId,
          subscriptionRef: ref,
          planId: 'premium',
          status: 'active',
          currentPeriodEnd: periodEnd,
          canceledAt: null,
        });
        return;
      }

      if (['ON_HOLD', 'CUSTOMER_PAUSED', 'BANK_APPROVAL_PENDING'].includes(status)) {
        await upsertSubscription({
          userId,
          subscriptionId,
          subscriptionRef: ref,
          planId: 'premium',
          status: 'past_due',
          currentPeriodEnd: periodEnd,
        });
        return;
      }

      if (
        [
          'CANCELLED',
          'CUSTOMER_CANCELLED',
          'EXPIRED',
          'COMPLETED',
          'CARD_EXPIRED',
          'LINK_EXPIRED',
        ].includes(status)
      ) {
        await upsertSubscription({
          userId,
          subscriptionId,
          subscriptionRef: ref,
          planId: 'premium',
          status: 'canceled',
          currentPeriodEnd: existing?.currentPeriodEnd ?? periodEnd,
          canceledAt: new Date(),
        });
        return;
      }

      logger.info({ status, subscriptionId }, 'cashfree status not mapped to a plan');
      return;
    }

    case 'SUBSCRIPTION_AUTH_STATUS': {
      // This fires for both a completed and a failed/cancelled authorisation.
      const approved =
        data.payment_status === 'SUCCESS' ||
        data.authorization_details?.authorization_status === 'ACTIVE';
      if (!approved) {
        logger.info(
          { subscriptionId, paymentStatus: data.payment_status },
          'cashfree mandate authorisation not completed',
        );
        return;
      }
      await upsertSubscription({
        userId,
        subscriptionId,
        subscriptionRef: data.cf_subscription_id ?? details.cf_subscription_id,
        planId: 'premium',
        status: 'active',
        currentPeriodEnd: periodEnd,
        canceledAt: null,
      });
      return;
    }

    case 'SUBSCRIPTION_PAYMENT_SUCCESS': {
      await upsertSubscription({
        userId,
        subscriptionId,
        subscriptionRef: data.cf_subscription_id ?? details.cf_subscription_id,
        planId: 'premium',
        status: 'active',
        currentPeriodEnd: periodEnd,
        canceledAt: null,
      });
      return;
    }

    case 'SUBSCRIPTION_PAYMENT_FAILED': {
      await upsertSubscription({
        userId,
        subscriptionId,
        planId: 'premium',
        status: 'past_due',
        currentPeriodEnd: existing?.currentPeriodEnd ?? periodEnd,
      });
      return;
    }

    // Nothing to change for our entitlements — the mandate stays as it is.
    case 'SUBSCRIPTION_PAYMENT_CANCELLED':
    case 'SUBSCRIPTION_PAYMENT_NOTIFICATION_INITIATED':
    case 'SUBSCRIPTION_REFUND_STATUS':
    case 'SUBSCRIPTION_CARD_EXPIRY_REMINDER':
      logger.info({ type: event.type, subscriptionId }, 'cashfree webhook noted');
      return;

    default:
      logger.info({ type: event?.type }, 'cashfree webhook ignored');
  }
}

// --- reconciliation ---------------------------------------------------------
//
// Webhooks are the fast path, not the only path. Cashfree's own guidance is to
// treat the browser redirect and the webhook as unreliable; the Subscriptions
// API is the source of truth. This pulls the current mandate state and maps it
// onto our entitlement columns, so a missed webhook self-corrects on the next
// page load instead of needing manual support.

// A pending row is re-checked at most this often, so polling the page cannot be
// used to hammer Cashfree's API.
const RECONCILE_INTERVAL_MS = 5000;

async function reconcileSubscription(sub, { force = false } = {}) {
  if (!billingConfigured() || !sub?.providerSubscriptionId) return null;

  const lastChecked = sub.providerCheckedAt ?? sub.updatedAt;
  if (!force && Date.now() - new Date(lastChecked ?? 0).getTime() < RECONCILE_INTERVAL_MS) {
    return null;
  }

  const data = await fetchSubscription(sub.providerSubscriptionId);
  await markProviderChecked(sub.userId);
  logger.info(
    { subscriptionId: sub.providerSubscriptionId, status: data?.subscription_status },
    'cashfree subscription re-checked',
  );
  return applyProviderState({
    userId: sub.userId,
    subscriptionId: sub.providerSubscriptionId,
    data,
    existingPeriodEnd: sub.currentPeriodEnd,
  });
}

async function applyProviderState({ userId, subscriptionId, data, existingPeriodEnd }) {
  const providerStatus = data?.subscription_status;
  if (!providerStatus) return null;

  const authStatus = data?.authorization_details?.authorization_status;
  const subscriptionRef = data?.cf_subscription_id;
  const periodEnd =
    parseCashfreeDate(data?.next_schedule_date) ??
    existingPeriodEnd ??
    addMonths(new Date(), 1);

  if (providerStatus === 'ACTIVE') {
    // A failed/pending authorisation must never buy premium, even if the
    // subscription row says ACTIVE.
    if (authStatus && !['ACTIVE', 'PENDING'].includes(authStatus)) return null;
    return upsertSubscription({
      userId,
      subscriptionId,
      subscriptionRef,
      planId: 'premium',
      status: 'active',
      currentPeriodEnd: periodEnd,
      canceledAt: null,
    });
  }

  if (['ON_HOLD', 'CUSTOMER_PAUSED', 'BANK_APPROVAL_PENDING'].includes(providerStatus)) {
    return upsertSubscription({
      userId,
      subscriptionId,
      subscriptionRef,
      planId: 'premium',
      status: 'past_due',
      currentPeriodEnd: periodEnd,
    });
  }

  if (
    ['CANCELLED', 'CUSTOMER_CANCELLED', 'EXPIRED', 'COMPLETED', 'CARD_EXPIRED', 'LINK_EXPIRED'].includes(
      providerStatus,
    )
  ) {
    return upsertSubscription({
      userId,
      subscriptionId,
      subscriptionRef,
      planId: 'premium',
      status: 'canceled',
      currentPeriodEnd: existingPeriodEnd ?? periodEnd,
      canceledAt: new Date(),
    });
  }

  // INITIALIZED: still waiting on the customer, nothing to grant.
  return null;
}

// --- helpers ---

function publicSubscription(sub) {
  if (!sub) return null;
  return {
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd ?? null,
    canceledAt: sub.canceledAt ?? null,
  };
}

function userIdFromSubscriptionId(subscriptionId) {
  const match = /^sf-([a-f0-9]{24})-/i.exec(subscriptionId);
  return match ? match[1] : null;
}

function normalizePhone(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  throw badRequest('Enter a valid 10-digit mobile number.');
}

// Cashfree timestamps are IST and often omit the offset ("2026-01-01T10:00:00").
// Parsing those as UTC would shift every period end by 5h30m.
function parseCashfreeDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const date = new Date(hasZone ? text : `${text}+05:30`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function isoIn(ms) {
  return new Date(Date.now() + ms).toISOString();
}
