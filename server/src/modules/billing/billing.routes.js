import { randomUUID } from 'node:crypto';
import { Router, raw } from 'express';
import { getPlans, getPlan } from './plans.js';
import {
  getEntitlements,
  upsertSubscription,
  markCheckoutPending,
  findSubscriptionByUserId,
  findSubscriptionByProviderId,
  cancelSubscription,
  generationsUsedThisMonth,
} from './billing.service.js';
import {
  billingConfigured,
  cashfreeMode,
  ensurePlan,
  createSubscription,
  cancelProviderSubscription,
  verifyWebhookSignature,
} from './cashfree.client.js';
import { config } from '../../platform/config.js';
import { AppError, wrap, badRequest, notFound, conflict } from '../../platform/errors.js';
import { logger } from '../../platform/logger.js';
import { User } from '../auth/user.model.js';

export const billingRouter = Router();

// Mounted BEFORE express.json(): Cashfree signs the raw request body, so this
// route must see the untouched bytes. Mounting it after the JSON parser would
// hand the handler a parsed object and every signature check would fail.
export const cashfreeWebhookRouter = Router();

cashfreeWebhookRouter.post(
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
    res.json({ received: true });
  }),
);

billingRouter.get('/plans', (_req, res) => {
  res.json({ plans: Object.values(getPlans()) });
});

billingRouter.get(
  '/billing/subscription',
  wrap(async (req, res) => {
    const { plan, subscription } = await getEntitlements(req.userId);
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
        return_url: `${config.CLIENT_ORIGIN}/plans?upgraded=1`,
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
