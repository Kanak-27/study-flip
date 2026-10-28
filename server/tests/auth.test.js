import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, newUser } from './helpers.js';

let ctx;

beforeAll(async () => {
  ctx = await setupTestApp();
});

afterAll(async () => {
  await ctx.teardown();
});

describe('auth', () => {
  it('registers a user and starts a session', async () => {
    const res = await ctx.request.post('/api/auth/register').send(newUser(1));
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'user1@example.com', name: 'Test User 1' });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('rejects a duplicate email', async () => {
    await ctx.request.post('/api/auth/register').send(newUser(2));
    const res = await ctx.request.post('/api/auth/register').send(newUser(2));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('rejects an invalid email and a short password', async () => {
    const badEmail = await ctx.request.post('/api/auth/register').send({ ...newUser(3), email: 'nope' });
    expect(badEmail.status).toBe(400);

    const shortPw = await ctx.request.post('/api/auth/register').send({ ...newUser(3), password: 'short' });
    expect(shortPw.status).toBe(400);
    expect(shortPw.body.error.message).toMatch(/at least 8/i);
  });

  it('logs in with correct credentials and rejects wrong ones', async () => {
    await ctx.request.post('/api/auth/register').send(newUser(4));

    const ok = await ctx.request.post('/api/auth/login').send({
      email: newUser(4).email,
      password: newUser(4).password,
    });
    expect(ok.status).toBe(200);

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
    await ctx.request.post('/api/auth/register').send(newUser(11));

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
    expect(registerUpper.status).toBe(201);
    expect(registerUpper.body.user.email).toBe('user12@example.com');
  });

  it('returns 401 from /me without a session', async () => {
    const res = await ctx.request.get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the session user from /me', async () => {
    await ctx.agent.post('/api/auth/register').send(newUser(5));
    const res = await ctx.agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('user5@example.com');
  });

  it('ends the session on logout', async () => {
    await ctx.agent.post('/api/auth/register').send(newUser(6));
    const out = await ctx.agent.post('/api/auth/logout');
    expect(out.status).toBe(200);
    const me = await ctx.agent.get('/api/auth/me');
    expect(me.status).toBe(401);
  });
});

describe('session isolation', () => {
  it("one user's session never reveals another user", async () => {
    const a = await ctx.request.post('/api/auth/register').send(newUser(7));
    const b = await ctx.request.post('/api/auth/register').send(newUser(8));

    const meA = await ctx.request.get('/api/auth/me').set('Cookie', a.headers['set-cookie']);
    const meB = await ctx.request.get('/api/auth/me').set('Cookie', b.headers['set-cookie']);
    expect(meA.body.user.email).toBe('user7@example.com');
    expect(meB.body.user.email).toBe('user8@example.com');
    expect(meA.body.user.id).not.toBe(meB.body.user.id);
  });

  it('dashboard requires auth', async () => {
    const res = await ctx.request.get('/api/dashboard');
    expect(res.status).toBe(401);
  });

  it('dashboard returns zeroed stats for a signed-in user', async () => {
    await ctx.agent.post('/api/auth/register').send(newUser(9));
    const res = await ctx.agent.get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({ decks: 0, flashcards: 0, dueToday: 0 });
  });

  it('unknown API routes 404 with the uniform error shape', async () => {
    // behind the auth guard, so sign in first
    await ctx.agent.post('/api/auth/register').send(newUser(10));
    const res = await ctx.agent.get('/api/definitely-not-a-route');
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
