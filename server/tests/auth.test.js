import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setupTestApp, newUser, registerAgent } from './helpers.js';

let ctx;

beforeAll(async () => {
  ctx = await setupTestApp();
});

afterAll(async () => {
  await ctx.teardown();
});

// Starts a signup and returns the response holding the development OTP.
function startRegistration(agent, i, overrides = {}) {
  return agent.post('/api/auth/register').send({ ...newUser(i), ...overrides });
}

describe('auth', () => {
  it('registers in two steps and starts a session only after the code', async () => {
    const agent = request.agent(ctx.app);
    const start = await startRegistration(agent, 1);

    expect(start.status).toBe(202);
    expect(start.body).toMatchObject({ pending: true, email: 'user1@example.com' });
    expect(start.body.devCode).toMatch(/^\d{6}$/);

    // No account exists until the emailed code is entered.
    expect((await agent.get('/api/auth/me')).status).toBe(401);

    const res = await agent
      .post('/api/auth/register/verify')
      .send({ email: 'user1@example.com', otp: start.body.devCode });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'user1@example.com', name: 'Test User 1' });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.emailVerifiedAt).toBeTruthy();
    expect(res.body.user.hasAvatar).toBe(false);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('user1@example.com');
  });

  it('rejects a wrong code and never creates the account', async () => {
    const agent = request.agent(ctx.app);
    const start = await startRegistration(agent, 15);

    const wrong = start.body.devCode === '000000' ? '000001' : '000000';
    const bad = await agent
      .post('/api/auth/register/verify')
      .send({ email: newUser(15).email, otp: wrong });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/not correct/i);

    // The pending signup cannot sign in, and the address is still free.
    const login = await ctx.request.post('/api/auth/login').send({
      email: newUser(15).email,
      password: newUser(15).password,
    });
    expect(login.status).toBe(401);
  });

  it('rejects a duplicate email before issuing another code', async () => {
    await registerAgent(ctx, 2);
    const res = await startRegistration(ctx.request, 2);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('rejects an invalid email and a short password', async () => {
    const badEmail = await ctx.request
      .post('/api/auth/register')
      .send({ ...newUser(3), email: 'nope' });
    expect(badEmail.status).toBe(400);

    const shortPw = await ctx.request
      .post('/api/auth/register')
      .send({ ...newUser(3), password: 'short' });
    expect(shortPw.status).toBe(400);
    expect(shortPw.body.error.message).toMatch(/at least 8/i);
  });

  it('rate-limits resending a code to the same address', async () => {
    // The helper test app config uses the default 60s cooldown; a second send
    // within the window must be refused rather than spamming the inbox.
    const start = await startRegistration(ctx.request, 30);
    expect(start.status).toBe(202);
    const again = await startRegistration(ctx.request, 30);
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('rate_limited');
  });

  it('logs in with correct credentials and rejects wrong ones', async () => {
    await registerAgent(ctx, 4);

    const ok = await ctx.request.post('/api/auth/login').send({
      email: newUser(4).email,
      password: newUser(4).password,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe(newUser(4).email);

    const bad = await ctx.request.post('/api/auth/login').send({
      email: newUser(4).email,
      password: 'wrong-password',
    });
    expect(bad.status).toBe(401);
    // the login page shows this verbatim — it must actually say why, not
    // imply the user isn't signed in while they're standing on the login form
    expect(bad.body.error.message).toBe('Incorrect email or password.');
    // same message for unknown email and wrong password — no account enumeration
    const unknown = await ctx.request.post('/api/auth/login').send({
      email: 'ghost@example.com',
      password: 'whatever123',
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message);
  });

  it('signs in regardless of email casing or stray whitespace', async () => {
    await registerAgent(ctx, 11);

    const shouty = await ctx.request.post('/api/auth/login').send({
      email: '  USER11@EXAMPLE.COM  ',
      password: newUser(11).password,
    });
    expect(shouty.status).toBe(200);
    expect(shouty.body.user.email).toBe('user11@example.com');

    // and the stored account is lowercased, so it can't fork a second account
    const registerUpper = await ctx.request
      .post('/api/auth/register')
      .send({ ...newUser(12), email: 'USER12@EXAMPLE.COM' });
    expect(registerUpper.status).toBe(202);
    expect(registerUpper.body.email).toBe('user12@example.com');

    const verified = await ctx.request
      .post('/api/auth/register/verify')
      .send({ email: 'USER12@EXAMPLE.COM', otp: registerUpper.body.devCode });
    expect(verified.status).toBe(201);
    expect(verified.body.user.email).toBe('user12@example.com');
  });

  it('returns 401 from /me without a session', async () => {
    const res = await ctx.request.get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('ends the session on logout', async () => {
    const { agent } = await registerAgent(ctx, 6);
    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(200);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
  });
});

describe('session isolation', () => {
  it("one user's session never reveals another user", async () => {
    const a = await registerAgent(ctx, 7);
    const b = await registerAgent(ctx, 8);

    const meA = await a.agent.get('/api/auth/me');
    const meB = await b.agent.get('/api/auth/me');
    expect(meA.body.user.email).toBe('user7@example.com');
    expect(meB.body.user.email).toBe('user8@example.com');
    expect(meA.body.user.id).not.toBe(meB.body.user.id);
  });

  it('dashboard requires auth', async () => {
    const res = await request(ctx.app).get('/api/dashboard');
    expect(res.status).toBe(401);
  });

  it('dashboard returns zeroed stats for a signed-in user', async () => {
    const { agent } = await registerAgent(ctx, 9);
    const res = await agent.get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({ decks: 0, flashcards: 0, dueToday: 0 });
  });

  it('unknown API routes 404 with the uniform error shape', async () => {
    // behind the auth guard, so sign in first
    const { agent } = await registerAgent(ctx, 10);
    const res = await agent.get('/api/definitely-not-a-route');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

// Keep this LAST: it exhausts this app instance's 30-per-15-min credential
// budget, so anything declared below would see 429s.
describe('credential rate limiting', () => {
  it('is actually applied to login and answers in the app error shape', async () => {
    let res;
    let sawLimitHeaders = false;
    for (let i = 0; i < 35; i += 1) {
      res = await ctx.request.post('/api/auth/login').send({
        email: 'ghost@example.com',
        password: 'whatever123',
      });
      if (res.headers['ratelimit-limit']) sawLimitHeaders = true;
      if (res.status === 429) break;
    }
    expect(sawLimitHeaders).toBe(true); // the limiter runs on every attempt
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('rate_limited');
    expect(res.body.error.message).toMatch(/too many attempts/i);
  });
});
