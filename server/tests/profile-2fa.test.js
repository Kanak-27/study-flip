import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, registerAgent } from './helpers.js';
import { totpAt } from '../src/modules/auth/totp.js';
import { User } from '../src/modules/auth/user.model.js';
import { Deck } from '../src/modules/decks/deck.model.js';
import { Flashcard } from '../src/modules/decks/flashcard.model.js';

let ctx;

// 1x1 transparent PNG — enough to exercise magic-byte sniffing and serving.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZkAAAAASUVORK5CYII=',
  'base64',
);

beforeAll(async () => {
  ctx = await setupTestApp();
});

afterAll(async () => {
  await ctx.teardown();
});

describe('profile', () => {
  it('returns the signed-in profile with plan and usage', async () => {
    const { agent } = await registerAgent(ctx, 300);
    const res = await agent.get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('user300@example.com');
    expect(res.body.plan.id).toBe('free');
    expect(res.body.used).toBe(0);
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('updates name, phone and bio and rejects a malformed phone', async () => {
    const { agent } = await registerAgent(ctx, 301);

    const ok = await agent.patch('/api/me').send({
      name: '  Updated Name  ',
      phone: '98765 43210',
      bio: '  Studies biology.  ',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({
      name: 'Updated Name',
      phone: '98765 43210',
      bio: 'Studies biology.',
    });

    const bad = await agent.patch('/api/me').send({ phone: 'call me maybe' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/valid phone/i);
  });

  it('uploads, serves and removes an avatar', async () => {
    const { agent, user } = await registerAgent(ctx, 302);

    const upload = await agent
      .post('/api/me/avatar')
      .attach('avatar', PNG, { filename: 'me.png', contentType: 'image/png' });
    expect(upload.status).toBe(200);
    expect(upload.body.user.hasAvatar).toBe(true);
    expect(upload.body.user.avatar).toBeUndefined(); // bytes never in JSON

    const img = await agent.get(`/api/users/${user.id}/avatar`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toMatch(/image\/png/);
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(img.body, PNG)).toBe(0);

    // A text file labelled image/png must be rejected on magic bytes.
    const fake = await agent
      .post('/api/me/avatar')
      .attach('avatar', Buffer.from('<html>not an image</html>'), {
        filename: 'fake.png',
        contentType: 'image/png',
      });
    expect(fake.status).toBe(400);
    expect(fake.body.error.message).toMatch(/not a JPG/i);

    const removed = await agent.delete('/api/me/avatar');
    expect(removed.status).toBe(200);
    expect(removed.body.user.hasAvatar).toBe(false);
    expect((await agent.get(`/api/users/${user.id}/avatar`)).status).toBe(404);
  });

  it('changes the password, keeps this browser signed in and invalidates old sessions', async () => {
    const { agent } = await registerAgent(ctx, 303);

    const wrong = await agent
      .post('/api/me/password')
      .send({ currentPassword: 'not-it', newPassword: 'brandnew123' });
    expect(wrong.status).toBe(400);

    const ok = await agent
      .post('/api/me/password')
      .send({ currentPassword: 'supersecret1', newPassword: 'brandnew123' });
    expect(ok.status).toBe(200);

    // This browser was re-established after every session was destroyed.
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    // The old password no longer works; the new one does.
    const old = await ctx.request
      .post('/api/auth/login')
      .send({ email: 'user303@example.com', password: 'supersecret1' });
    expect(old.status).toBe(401);

    const fresh = await ctx.request
      .post('/api/auth/login')
      .send({ email: 'user303@example.com', password: 'brandnew123' });
    expect(fresh.status).toBe(200);
  });

  it('deletes the account and every row it owned', async () => {
    const { agent, user } = await registerAgent(ctx, 304);

    const deck = await agent.post('/api/decks').send({ title: 'Temporary deck' });
    expect(deck.status).toBe(201);
    const card = await agent
      .post(`/api/decks/${deck.body.deck.id}/cards`)
      .send({ question: 'Q?', answer: 'A.' });
    expect(card.status).toBe(201);

    const wrong = await agent.delete('/api/me').send({ password: 'wrong' });
    expect(wrong.status).toBe(400);

    const ok = await agent.delete('/api/me').send({ password: 'supersecret1' });
    expect(ok.status).toBe(200);

    expect(await User.findById(user.id)).toBeNull();
    expect(await Deck.countDocuments({ userId: user.id })).toBe(0);
    expect(await Flashcard.countDocuments({ userId: user.id })).toBe(0);

    const login = await ctx.request
      .post('/api/auth/login')
      .send({ email: 'user304@example.com', password: 'supersecret1' });
    expect(login.status).toBe(401);
  });
});

describe('two-factor authentication', () => {
  it('sets up TOTP, requires it at login and accepts a one-time recovery code', async () => {
    const { agent } = await registerAgent(ctx, 310);

    const setup = await agent.post('/api/me/2fa/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(setup.body.qr).toMatch(/^data:image\/png;base64,/);
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/');

    const enable = await agent
      .post('/api/me/2fa/enable')
      .send({ code: totpAt(setup.body.secret) });
    expect(enable.status).toBe(200);
    expect(enable.body.user.twoFactorEnabled).toBe(true);
    expect(enable.body.recoveryCodes).toHaveLength(10);
    const recovery = enable.body.recoveryCodes;

    await agent.post('/api/auth/logout');

    // Password alone no longer signs in.
    const first = await agent
      .post('/api/auth/login')
      .send({ email: 'user310@example.com', password: 'supersecret1' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ twoFactorRequired: true });
    expect(first.body.user).toBeUndefined();
    // and the pending session is not authenticated
    expect((await agent.get('/api/auth/me')).status).toBe(401);

    const current = totpAt(setup.body.secret);
    const wrong = current === '000000' ? '000001' : '000000';
    const rejected = await agent.post('/api/auth/login/2fa').send({ code: wrong });
    expect(rejected.status).toBe(401);

    const verified = await agent.post('/api/auth/login/2fa').send({ code: current });
    expect(verified.status).toBe(200);
    expect(verified.body.user.email).toBe('user310@example.com');

    // Recovery code works once, then is gone.
    await agent.post('/api/auth/logout');
    await agent
      .post('/api/auth/login')
      .send({ email: 'user310@example.com', password: 'supersecret1' });
    const recoveryLogin = await agent.post('/api/auth/login/2fa').send({ code: recovery[0] });
    expect(recoveryLogin.status).toBe(200);

    await agent.post('/api/auth/logout');
    await agent
      .post('/api/auth/login')
      .send({ email: 'user310@example.com', password: 'supersecret1' });
    const reused = await agent.post('/api/auth/login/2fa').send({ code: recovery[0] });
    expect(reused.status).toBe(401);

    // A fresh TOTP code still gets in.
    const code = totpAt(setup.body.secret);
    const back = await agent.post('/api/auth/login/2fa').send({ code });
    expect(back.status).toBe(200);

    // Disable with the password, then login is single-step again.
    const disabled = await agent
      .post('/api/me/2fa/disable')
      .send({ password: 'supersecret1' });
    expect(disabled.status).toBe(200);
    expect(disabled.body.user.twoFactorEnabled).toBe(false);

    await agent.post('/api/auth/logout');
    const simple = await agent
      .post('/api/auth/login')
      .send({ email: 'user310@example.com', password: 'supersecret1' });
    expect(simple.status).toBe(200);
    expect(simple.body.user.email).toBe('user310@example.com');
  });
});
