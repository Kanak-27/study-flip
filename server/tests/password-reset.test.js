import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setupTestApp, registerAgent } from './helpers.js';

let ctx;

beforeAll(async () => {
  ctx = await setupTestApp();
});

afterAll(async () => {
  await ctx.teardown();
});

describe('password reset by email code', () => {
  it('always answers 202 on forgot-password, even for unknown addresses', async () => {
    const unknown = await ctx.request
      .post('/api/auth/password/forgot')
      .send({ email: 'nobody@example.com' });
    expect(unknown.status).toBe(202);
    expect(unknown.body).toMatchObject({ ok: true });
    // no challenge was created, so there is no code to leak
    expect(unknown.body.devCode).toBeUndefined();
  });

  it('resets the password, destroys old sessions and consumes the code', async () => {
    await registerAgent(ctx, 400);

    // A second browser that is signed in before the reset.
    const otherBrowser = request.agent(ctx.app);
    const login = await otherBrowser
      .post('/api/auth/login')
      .send({ email: 'user400@example.com', password: 'supersecret1' });
    expect(login.status).toBe(200);
    expect((await otherBrowser.get('/api/auth/me')).status).toBe(200);

    const forgot = await ctx.request
      .post('/api/auth/password/forgot')
      .send({ email: 'user400@example.com' });
    expect(forgot.status).toBe(202);
    expect(forgot.body.devCode).toMatch(/^\d{6}$/);

    const wrongCode = forgot.body.devCode === '000000' ? '000001' : '000000';
    const bad = await ctx.request.post('/api/auth/password/reset').send({
      email: 'user400@example.com',
      otp: wrongCode,
      password: 'resetpass123',
    });
    expect(bad.status).toBe(400);

    // Same message as an unknown address below — no account enumeration.
    const unknownReset = await ctx.request.post('/api/auth/password/reset').send({
      email: 'nobody@example.com',
      otp: wrongCode,
      password: 'resetpass123',
    });
    expect(unknownReset.status).toBe(400);
    expect(unknownReset.body.error.message).toBe(bad.body.error.message);

    const ok = await ctx.request.post('/api/auth/password/reset').send({
      email: 'user400@example.com',
      otp: forgot.body.devCode,
      password: 'resetpass123',
    });
    expect(ok.status).toBe(200);

    // Every existing session died with the old password.
    expect((await otherBrowser.get('/api/auth/me')).status).toBe(401);

    const oldPassword = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'user400@example.com', password: 'supersecret1' });
    expect(oldPassword.status).toBe(401);

    const newPassword = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'user400@example.com', password: 'resetpass123' });
    expect(newPassword.status).toBe(200);

    // The code was single-use.
    const replay = await ctx.request.post('/api/auth/password/reset').send({
      email: 'user400@example.com',
      otp: forgot.body.devCode,
      password: 'anotherpass123',
    });
    expect(replay.status).toBe(400);
  });

  it('never issues a reset for an address that has no account', async () => {
    const forgot = await ctx.request
      .post('/api/auth/password/forgot')
      .send({ email: 'still-nobody@example.com' });
    expect(forgot.status).toBe(202);
    expect(forgot.body.devCode).toBeUndefined();
  });

  it('rejects a short new password before touching the code', async () => {
    const res = await ctx.request.post('/api/auth/password/reset').send({
      email: 'user400@example.com',
      otp: '123456',
      password: 'short',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/at least 8/i);
  });
});
