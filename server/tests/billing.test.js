import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestApp, registerAgent } from './helpers.js';

// Billing is configured through env, and config.js reads process.env at import
// time — so these must be set before setupTestApp() loads the app.
const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';
const WEBHOOK_SECRET = 'whsec_test';
const PLAN_ID = 'plan_test';

let ctx;
let Subscription;

beforeAll(async () => {
  process.env.CASHFREE_CLIENT_ID = CLIENT_ID;
  process.env.CASHFREE_CLIENT_SECRET = CLIENT_SECRET;
  process.env.CASHFREE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.CASHFREE_PLAN_ID = PLAN_ID;
  process.env.CASHFREE_ENV = 'sandbox';

  ctx = await setupTestApp();
  ({ Subscription } = await import('../src/modules/billing/billing.service.js'));
});

afterAll(async () => {
  await ctx.teardown();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function postWebhook(payload, { secret = WEBHOOK_SECRET } = {}) {
  const raw = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(`${timestamp}${raw}`).digest('base64');

  return ctx.request
    .post('/api/billing/webhook')
    .set('Content-Type', 'application/json')
    .set('x-webhook-timestamp', timestamp)
    .set('x-webhook-signature', signature)
    .send(raw);
}

function activeEvent(subscriptionId, { status = 'ACTIVE', nextScheduleDate } = {}) {
  return {
    type: 'SUBSCRIPTION_STATUS_CHANGED',
    event_time: new Date().toISOString(),
    data: {
      subscription_details: {
        subscription_id: subscriptionId,
        cf_subscription_id: 'cf_12345',
        subscription_status: status,
        subscription_expiry_time: '2030-01-01T00:00:00',
        next_schedule_date:
          nextScheduleDate ?? new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 19),
      },
    },
  };
}

function mockCashfree(body, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('billing (Cashfree)', () => {
  it('turns Cashfree\'s POST to return_url into a 303 to the app', async () => {
    // Cashfree posts form data to return_url. Pointing that at the static SPA
    // host is what produced nginx "405 Not Allowed"; the API must absorb the
    // POST and redirect with GET instead.
    const post = await ctx.request
      .post('/api/billing/return')
      .type('form')
      .send({ cf_status: 'ACTIVE', cf_subscriptionId: 'sub_test' });

    expect(post.status).toBe(303);
    expect(post.headers.location).toBe('http://localhost:5173/plans?upgraded=1');

    const get = await ctx.request.get('/api/billing/return');
    expect(get.status).toBe(303);
  });

  it('starts a checkout and returns the subscription session id', async () => {
    const { agent } = await registerAgent(ctx, 10);
    const fetchMock = mockCashfree({
      subscription_id: 'sf-generated',
      subscription_session_id: 'sess_test_1',
      subscription_status: 'INITIALIZED',
    });

    const res = await agent.post('/api/billing/checkout').send({ phone: '9876543210' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ subsSessionId: 'sess_test_1', mode: 'sandbox' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sandbox.cashfree.com/pg/subscriptions');
    expect(options.headers['x-client-id']).toBe(CLIENT_ID);
    expect(options.headers['x-api-version']).toBe('2025-01-01');

    const sent = JSON.parse(options.body);
    expect(sent.plan_details.plan_id).toBe(PLAN_ID);
    expect(sent.customer_details).toMatchObject({
      customer_email: 'user10@example.com',
      customer_phone: '9876543210',
    });
    expect(sent.authorization_details.authorization_amount).toBe(699);
    expect(sent.subscription_id).toMatch(/^sf-[a-f0-9]{24}-/);
    // Must not point at the static SPA: Cashfree POSTs to it and nginx 405s.
    expect(sent.subscription_meta.return_url).toBe('http://localhost:5173/api/billing/return');
  });

  it('asks for a mobile number when the account has none', async () => {
    const { agent } = await registerAgent(ctx, 11);
    const res = await agent.post('/api/billing/checkout').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('phone_required');
  });

  it('rejects a webhook with an invalid signature', async () => {
    const { agent, user } = await registerAgent(ctx, 12);
    const res = await postWebhook(activeEvent(`sf-${user.id}-t1`), { secret: 'not-the-secret' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/signature/i);

    const sub = await agent.get('/api/billing/subscription');
    expect(sub.body.plan.id).toBe('free');
  });

  it('accepts a webhook signed with the client secret too', async () => {
    // Cashfree's documented algorithm signs with the client secret, while the
    // dashboard may be configured with a separate webhook secret. Either must
    // be accepted, otherwise real webhooks 400 and Premium never activates.
    const { agent, user } = await registerAgent(ctx, 18);
    const res = await postWebhook(activeEvent(`sf-${user.id}-t7`), { secret: CLIENT_SECRET });
    expect(res.status).toBe(200);

    const sub = await agent.get('/api/billing/subscription');
    expect(sub.body.plan.id).toBe('premium');
  });

  it('activates premium from a signed webhook', async () => {
    const { agent, user } = await registerAgent(ctx, 13);
    const res = await postWebhook(activeEvent(`sf-${user.id}-t2`));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const sub = await agent.get('/api/billing/subscription');
    expect(sub.body.plan.id).toBe('premium');
    expect(sub.body.subscription.status).toBe('active');
    expect(new Date(sub.body.subscription.currentPeriodEnd).getTime()).toBeGreaterThan(Date.now());
  });

  it('does not grant premium when the mandate authorisation fails', async () => {
    const { agent, user } = await registerAgent(ctx, 17);
    const subscriptionId = `sf-${user.id}-t6`;

    const res = await postWebhook({
      type: 'SUBSCRIPTION_AUTH_STATUS',
      data: {
        subscription_id: subscriptionId,
        cf_subscription_id: 'cf_999',
        payment_status: 'FAILED',
        authorization_details: { authorization_status: 'FAILED' },
        subscription_details: { subscription_id: subscriptionId, subscription_status: 'INITIALIZED' },
      },
    });

    expect(res.status).toBe(200);
    const sub = await agent.get('/api/billing/subscription');
    expect(sub.body.plan.id).toBe('free');
  });

  it('drops back to free once the paid period has ended', async () => {
    const { agent, user } = await registerAgent(ctx, 14);
    await postWebhook(activeEvent(`sf-${user.id}-t3`));

    await Subscription.updateOne(
      { userId: user.id },
      { $set: { currentPeriodEnd: new Date(Date.now() - 86400000) } },
    );

    const sub = await agent.get('/api/billing/subscription');
    expect(sub.body.plan.id).toBe('free');
  });

  it('cancels at Cashfree and keeps premium until the period ends', async () => {
    const { agent, user } = await registerAgent(ctx, 15);
    await postWebhook(activeEvent(`sf-${user.id}-t4`));

    const fetchMock = mockCashfree({ subscription_id: `sf-${user.id}-t4`, subscription_status: 'CANCELLED' });
    const res = await agent.post('/api/billing/cancel');

    expect(res.status).toBe(200);
    expect(res.body.subscription.status).toBe('canceled');

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/subscriptions\/sf-.*\/manage$/);
    expect(JSON.parse(options.body)).toMatchObject({ action: 'CANCEL' });

    // Already paid for this period, so Premium does not vanish immediately.
    const sub = await agent.get('/api/billing/subscription');
    expect(sub.body.plan.id).toBe('premium');
    expect(sub.body.subscription.status).toBe('canceled');
  });

  it('accepts a cancelled-mandate status change from Cashfree', async () => {
    const { agent, user } = await registerAgent(ctx, 16);
    await postWebhook(activeEvent(`sf-${user.id}-t5`));
    await postWebhook(activeEvent(`sf-${user.id}-t5`, { status: 'CUSTOMER_CANCELLED' }));

    const sub = await agent.get('/api/billing/subscription');
    expect(sub.body.subscription.status).toBe('canceled');
    expect(sub.body.plan.id).toBe('premium');
  });

  it('ignores webhooks for subscriptions it does not know', async () => {
    const res = await postWebhook({
      type: 'SUBSCRIPTION_STATUS_CHANGED',
      data: { subscription_details: { subscription_id: 'someone-else', subscription_status: 'ACTIVE' } },
    });
    expect(res.status).toBe(200);
  });
});
