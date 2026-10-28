import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../platform/config.js';

// Thin Cashfree Payments client. Deliberately dependency-free: the SDKs pull
// in a lot for four endpoints, and a plain fetch call is easier to test and to
// reason about than a pinned SDK version.
//
// Docs: https://www.cashfree.com/docs/api-reference/payments/latest/subscription/overview

const SANDBOX = 'https://sandbox.cashfree.com/pg';
const PRODUCTION = 'https://api.cashfree.com/pg';

export function billingConfigured() {
  return Boolean(config.CASHFREE_CLIENT_ID && config.CASHFREE_CLIENT_SECRET);
}

export function cashfreeMode() {
  return config.CASHFREE_ENV === 'production' ? 'production' : 'sandbox';
}

function baseUrl() {
  return cashfreeMode() === 'production' ? PRODUCTION : SANDBOX;
}

async function request(method, path, body, { idempotencyKey } = {}) {
  const headers = {
    accept: 'application/json',
    'x-client-id': config.CASHFREE_CLIENT_ID,
    'x-client-secret': config.CASHFREE_CLIENT_SECRET,
    'x-api-version': config.CASHFREE_API_VERSION,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;

  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = new Error(data?.message || `Cashfree request failed (${res.status}).`);
    err.status = res.status;
    err.cashfreeCode = data?.code;
    err.body = data;
    throw err;
  }
  return data;
}

// Cashfree plans are created once and reused forever. When CASHFREE_PLAN_ID is
// configured we trust it; otherwise derive a stable id from the amount so the
// second checkout doesn't create a duplicate plan.
export async function ensurePlan(amountInr) {
  if (config.CASHFREE_PLAN_ID) return config.CASHFREE_PLAN_ID;

  const planId = `studyflip_premium_inr_${String(amountInr).replace('.', '_')}`.slice(0, 40);
  try {
    const plan = await request('POST', '/plans', {
      plan_id: planId,
      // Cashfree rejects '/' and other punctuation in plan names.
      plan_name: `StudyFlip Premium ${amountInr} monthly`.slice(0, 40),
      plan_type: 'PERIODIC',
      plan_currency: 'INR',
      plan_recurring_amount: amountInr,
      plan_max_amount: amountInr,
      plan_max_cycles: 120, // ten years of monthly cycles
      plan_intervals: 1,
      plan_interval_type: 'MONTH',
      plan_note: 'StudyFlip Premium - monthly, cancel anytime',
    });
    return plan?.plan_id ?? planId;
  } catch (err) {
    // Only "already exists" is benign (another checkout won the race). Any
    // other 400 is a payload bug — surfacing it beats handing Cashfree a plan
    // id that was never created.
    if (err.cashfreeCode === 'plan_already_exists') return planId;
    throw err;
  }
}

export function createSubscription(payload, options) {
  return request('POST', '/subscriptions', payload, options);
}

export function fetchSubscription(subscriptionId) {
  return request('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

// Cancels the mandate immediately, so no further charges are raised.
export function cancelProviderSubscription(subscriptionId) {
  return request('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}/manage`, {
    subscription_id: subscriptionId,
    action: 'CANCEL',
  });
}

// Signature = base64(HMAC-SHA256(timestamp + rawBody, client secret)), sent as
// x-webhook-signature alongside x-webhook-timestamp. The raw body is required —
// re-serialising parsed JSON changes key order/whitespace and breaks the hash.
export function verifyWebhookSignature({ signature, timestamp, rawBody, secret }) {
  if (!signature || !timestamp || !rawBody || !secret) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}${rawBody}`).digest('base64');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
