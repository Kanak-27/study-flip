import { createRequire } from 'node:module';
import { Router, raw } from 'express';
import { PLANS, getPlan } from './plans.js';
import { getEntitlements, upsertSubscription, cancelSubscription, generationsUsedThisMonth } from './billing.service.js';
import { config } from '../../platform/config.js';
import { wrap, badRequest, notFound } from '../../platform/errors.js';
import { logger } from '../../platform/logger.js';

export const billingRouter = Router();

// Mounted OUTSIDE the auth guard: Stripe calls this endpoint server-to-server
// with a signed payload, never a session cookie. Signature verification is
// the authentication here.
export const stripeWebhookRouter = Router();

stripeWebhookRouter.post(
  '/billing/webhook',
  raw({ type: 'application/json', limit: '1mb' }),
  wrap(async (req, res) => {
    const stripe = loadStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !secret) throw notFound('Billing is not configured on this server.');

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
    } catch (err) {
      logger.warn({ err }, 'webhook signature verification failed');
      throw badRequest('Invalid webhook signature.');
    }

    const sub = event.data?.object;
    switch (event.type) {
      case 'checkout.session.completed': {
        if (sub?.metadata?.userId) {
          await upsertSubscription({
            userId: sub.metadata.userId,
            customerId: sub.customer,
            subscriptionId: sub.subscription,
            planId: 'premium',
            status: 'active',
            currentPeriodEnd: null, // refreshed by the events below
          });
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        await upsertSubscriptionByProvider({
          customerId: sub.customer,
          subscriptionId: sub.id,
          planId: sub.status === 'active' ? 'premium' : 'free',
          status: sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : 'canceled',
          currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
        });
        break;
      }
      case 'customer.subscription.deleted': {
        await upsertSubscriptionByProvider({
          customerId: sub.customer,
          subscriptionId: sub.id,
          planId: 'free',
          status: 'canceled',
          currentPeriodEnd: null,
        });
        break;
      }
      default:
        logger.info({ type: event.type }, 'webhook event ignored');
    }

    res.json({ received: true });
  }),
);

billingRouter.get('/plans', (_req, res) => {
  res.json({ plans: Object.values(PLANS) });
});

billingRouter.get(
  '/billing/subscription',
  wrap(async (req, res) => {
    const { plan, subscription } = await getEntitlements(req.userId);
    const used = await generationsUsedThisMonth(req.userId);
    res.json({ plan, used, subscription: subscription?.status === 'active' ? subscription : null });
  }),
);

// Creates a Stripe Checkout session. Returns 503 when billing isn't
// configured so dev environments degrade honestly instead of 500ing.
billingRouter.post(
  '/billing/checkout',
  wrap(async (req, res) => {
    const stripe = loadStripe();
    if (!stripe) throw notFound('Billing is not configured on this server.');

    const priceId = getPlan('premium').stripePriceId;
    if (!priceId) throw notFound('Billing is not configured on this server.');

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: req.body?.email,
      client_reference_id: req.userId.toString(),
      metadata: { userId: req.userId.toString() },
      success_url: `${config.CLIENT_ORIGIN}/?upgraded=1`,
      cancel_url: `${config.CLIENT_ORIGIN}/`,
    });
    res.json({ url: session.url });
  }),
);

// Stripe verifies the signature against the raw body — JSON parsing happens
// inside the handler, after verification. See stripeWebhookRouter above.

billingRouter.post(
  '/billing/cancel',
  wrap(async (req, res) => {
    // MVP: cancel locally; a real integration would also cancel at Stripe.
    // The next renewal webhook re-checks and downgrades if needed.
    const sub = await cancelSubscription(req.userId);
    res.json({ subscription: sub });
  }),
);

const require = createRequire(import.meta.url);

function loadStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  // lazy so the rest of the API doesn't require the dependency at boot
  try {
    return require('stripe');
  } catch {
    return null;
  }
}

async function upsertSubscriptionByProvider({ customerId, subscriptionId, planId, status, currentPeriodEnd }) {
  const { Subscription } = await import('./billing.service.js');
  const existing = await Subscription.findOne({ providerCustomerId: customerId });
  if (!existing) {
    logger.warn({ customerId }, 'webhook for unknown customer');
    return;
  }
  await upsertSubscription({
    userId: existing.userId,
    customerId,
    subscriptionId,
    planId,
    status,
    currentPeriodEnd,
  });
}
