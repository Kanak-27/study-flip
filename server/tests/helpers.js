import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';


// Boots an in-memory MongoDB once per test file, then wires the real Express
// app to it. Nothing here is mocked — the full middleware stack runs, which is
// the point of integration tests.

let mongod;

export async function setupTestApp() {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ??= 'test-secret-at-least-16-chars';

  // Billing must be deterministic: a developer's real server/.env (sandbox keys)
  // must not leak into tests and silently flip the app into "billing on".
  // `??=` keeps what a test set explicitly, e.g. billing.test.js.
  process.env.CASHFREE_CLIENT_ID ??= '';
  process.env.CASHFREE_CLIENT_SECRET ??= '';
  process.env.CASHFREE_WEBHOOK_SECRET ??= '';
  process.env.CASHFREE_PLAN_ID ??= '';
  // Valid value, not empty: config validates it as a URL.
  process.env.BILLING_RETURN_URL ??= 'http://localhost:5173/api/billing/return';
  process.env.CLIENT_ORIGIN ??= 'http://localhost:5173';

  // No SMTP in tests: otp.service then returns `devCode` in the response, which
  // is exactly how the two-step registration helper gets through. The admin
  // allowlist stays empty except for the one address the admin tests promote.
  process.env.SMTP_HOST ??= '';
  process.env.ADMIN_EMAILS ??= 'admin@example.com';

  mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri('studyflip-test');

  // Import after env is set — config.js reads process.env at import time.
  const { connectDb, disconnectDb } = await import('../src/platform/db.js');
  const { createApp } = await import('../src/app.js');
  const { refreshSettings } = await import('../src/platform/settings.js');

  await connectDb(process.env.MONGO_URI);
  await refreshSettings();
  const { default: MongoStore } = await import('connect-mongo');
  const sessionStore = MongoStore.create({ mongoUrl: process.env.MONGO_URI });

  const app = createApp({ sessionStore });

  return {
    app,
    sessionStore,
    request: request(app),
    agent: request.agent(app), // persists cookies across requests
    async teardown() {
      await mongoose.connection.dropDatabase().catch(() => {});
      await disconnectDb();
      await mongod.stop();
    },
  };
}

export const newUser = (i) => ({
  name: `Test User ${i}`,
  email: `user${i}@example.com`,
  password: 'supersecret1',
});

// Registers a user and returns a supertest agent carrying their session cookie.
// Registration is two-step in the product: start it, read the development OTP
// the server logs instead of emailing, then verify it.
export async function registerAgent(ctx, i, overrides = {}) {
  const details = { ...newUser(i), ...overrides };
  const agent = request.agent(ctx.app);

  const start = await agent.post('/api/auth/register').send(details);
  if (start.status !== 202) {
    throw new Error(`register start failed: ${start.status} ${JSON.stringify(start.body)}`);
  }
  if (!start.body.devCode) {
    throw new Error('register start did not return a devCode; is SMTP_HOST set in tests?');
  }

  const res = await agent
    .post('/api/auth/register/verify')
    .send({ email: details.email, otp: start.body.devCode });
  if (res.status !== 201) {
    throw new Error(`register verify failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { agent, user: res.body.user, devCode: start.body.devCode };
}
