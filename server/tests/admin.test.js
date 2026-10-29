import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { setupTestApp, registerAgent } from './helpers.js';
import { User } from '../src/modules/auth/user.model.js';
import { Job } from '../src/platform/jobs.js';
import { GenerationRun } from '../src/modules/generation/generation.service.js';
import { Document } from '../src/modules/documents/document.model.js';
import { Deck } from '../src/modules/decks/deck.model.js';
import { Subscription } from '../src/modules/billing/billing.service.js';

let ctx;
let admin;
let alice;

beforeAll(async () => {
  ctx = await setupTestApp();
  // admin@example.com is on the test ADMIN_EMAILS allowlist (see helpers.js).
  admin = await registerAgent(ctx, 900, { email: 'admin@example.com', name: 'Admin User' });
  alice = await registerAgent(ctx, 901);
});

afterAll(async () => {
  await ctx.teardown();
});

describe('admin access control', () => {
  it('promotes allowlisted emails to admin', async () => {
    expect(admin.user.role).toBe('admin');
    expect(alice.user.role).toBe('user');
  });

  it('blocks non-admins from every admin endpoint', async () => {
    const res = await alice.agent.get('/api/admin/overview');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });
});

describe('admin overview and public config', () => {
  it('returns product, content and queue stats', async () => {
    const res = await admin.agent.get('/api/admin/overview');
    expect(res.status).toBe(200);
    expect(res.body.stats.users.total).toBeGreaterThanOrEqual(2);
    expect(res.body.stats.users.admins).toBeGreaterThanOrEqual(1);
    expect(res.body.stats.content).toMatchObject({ documents: 0, decks: 0, cards: 0 });
    expect(res.body.queue).toMatchObject({ queued: 0, running: 0, failed: 0 });
    expect(res.body.environment.nodeEnv).toBe('test');
    expect(res.body.environment.mailConfigured).toBe(false);
  });

  it('exposes only public switches on /api/config', async () => {
    const res = await ctx.request.get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ signupsEnabled: true, generationEnabled: true });
    expect(res.body.environment).toBeUndefined();
    expect(res.body.adminEmails).toBeUndefined();
  });
});

describe('runtime settings', () => {
  it('lets an admin change quotas, switches and the announcement', async () => {
    const res = await admin.agent.patch('/api/admin/settings').send({
      generationsPerMonth: { free: 7 },
      signupsEnabled: false,
      generationEnabled: false,
      announcement: 'Maintenance tonight at 10pm.',
    });
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({
      generationsPerMonth: { free: 7, premium: 200 },
      signupsEnabled: false,
      generationEnabled: false,
      announcement: 'Maintenance tonight at 10pm.',
    });

    // The public switches and the plan pricing page both read the cache.
    const config = await ctx.request.get('/api/config');
    expect(config.body).toMatchObject({
      signupsEnabled: false,
      generationEnabled: false,
      announcement: 'Maintenance tonight at 10pm.',
    });

    const plans = await alice.agent.get('/api/plans');
    expect(plans.body.plans.find((p) => p.id === 'free').limits.generationsPerMonth).toBe(7);
  });

  it('pauses signups and generation without a deploy', async () => {
    const signup = await ctx.request.post('/api/auth/register').send({
      name: 'Paused User',
      email: 'paused@example.com',
      password: 'supersecret1',
    });
    expect(signup.status).toBe(403);
    expect(signup.body.error.message).toMatch(/paused/i);

    const fakeDocumentId = new mongoose.Types.ObjectId().toString();
    const generate = await alice.agent.post(`/api/documents/${fakeDocumentId}/generate`);
    expect(generate.status).toBe(403);
    expect(generate.body.error.message).toMatch(/paused/i);

    // Back on for the rest of the suite.
    const reenabled = await admin.agent.patch('/api/admin/settings').send({
      signupsEnabled: true,
      generationEnabled: true,
    });
    expect(reenabled.status).toBe(200);
  });
});

describe('admin user management', () => {
  it('searches users and filters by plan', async () => {
    const search = await admin.agent.get('/api/admin/users?q=user901');
    expect(search.status).toBe(200);
    expect(search.body.users).toHaveLength(1);
    expect(search.body.users[0].email).toBe('user901@example.com');

    await Subscription.create({
      userId: alice.user.id,
      planId: 'premium',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const premium = await admin.agent.get('/api/admin/users?plan=premium');
    expect(premium.status).toBe(200);
    expect(premium.body.users.map((u) => u.email)).toContain('user901@example.com');

    const free = await admin.agent.get('/api/admin/users?plan=free');
    expect(free.body.users.map((u) => u.email)).not.toContain('user901@example.com');
  });

  it('returns the detail view used by the drill-down panel', async () => {
    const res = await admin.agent.get(`/api/admin/users/${alice.user.id}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('user901@example.com');
    expect(res.body.subscription.plan).toBe('premium');
    expect(res.body.counts).toMatchObject({ documents: 0, decks: 0, cards: 0, reviews: 0 });
    expect(res.body.recentRuns).toEqual([]);
  });

  it('suspends an account immediately and can lift it', async () => {
    const suspend = await admin.agent
      .patch(`/api/admin/users/${alice.user.id}`)
      .send({ suspended: true, suspendedReason: 'Spam uploads' });
    expect(suspend.status).toBe(200);
    expect(suspend.body.user).toMatchObject({ suspended: true, suspendedReason: 'Spam uploads' });
    expect(suspend.body.signedOutSessions).toBe(true);

    // The old session is gone and fresh logins are refused.
    expect((await alice.agent.get('/api/dashboard')).status).toBe(401);
    const blocked = await alice.agent
      .post('/api/auth/login')
      .send({ email: 'user901@example.com', password: 'supersecret1' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/suspended/i);

    const list = await admin.agent.get('/api/admin/users?status=suspended');
    expect(list.body.users.map((u) => u.email)).toContain('user901@example.com');

    const lift = await admin.agent
      .patch(`/api/admin/users/${alice.user.id}`)
      .send({ suspended: false });
    expect(lift.status).toBe(200);
    expect(lift.body.user.suspended).toBe(false);

    const login = await alice.agent
      .post('/api/auth/login')
      .send({ email: 'user901@example.com', password: 'supersecret1' });
    expect(login.status).toBe(200);
  });

  it('changes roles and revokes admin access again', async () => {
    const promote = await admin.agent
      .patch(`/api/admin/users/${alice.user.id}`)
      .send({ role: 'admin' });
    expect(promote.status).toBe(200);
    expect(promote.body.user.role).toBe('admin');
    expect((await alice.agent.get('/api/admin/overview')).status).toBe(200);

    const demote = await admin.agent
      .patch(`/api/admin/users/${alice.user.id}`)
      .send({ role: 'user' });
    expect(demote.status).toBe(200);
    expect((await alice.agent.get('/api/admin/overview')).status).toBe(403);
  });

  it('resets 2FA and signs the user out', async () => {
    await User.updateOne(
      { _id: alice.user.id },
      { $set: { twoFactorEnabled: true, 'twoFactor.enabled': true } },
    );

    const res = await admin.agent
      .patch(`/api/admin/users/${alice.user.id}`)
      .send({ resetTwoFactor: true });
    expect(res.status).toBe(200);
    expect(res.body.user.twoFactorEnabled).toBe(false);
    expect(res.body.signedOutSessions).toBe(true);

    const user = await User.findById(alice.user.id);
    expect(user.twoFactorEnabled).toBe(false);
    expect((await alice.agent.get('/api/auth/me')).status).toBe(401);
  });

  it('refuses to let an admin lock themselves out', async () => {
    const suspendSelf = await admin.agent
      .patch(`/api/admin/users/${admin.user.id}`)
      .send({ suspended: true });
    expect(suspendSelf.status).toBe(400);

    const demoteSelf = await admin.agent
      .patch(`/api/admin/users/${admin.user.id}`)
      .send({ role: 'user' });
    expect(demoteSelf.status).toBe(400);

    const deleteSelf = await admin.agent.delete(`/api/admin/users/${admin.user.id}`);
    expect(deleteSelf.status).toBe(400);
  });
});

describe('admin queue and run supervision', () => {
  it('lists and retries a failed job', async () => {
    const job = await Job.create({
      type: 'generate',
      payload: { runId: 'x' },
      status: 'failed',
      attempts: 3,
      lastError: 'provider exploded',
    });

    const list = await admin.agent.get('/api/admin/jobs?status=failed');
    expect(list.status).toBe(200);
    expect(list.body.jobs.map((row) => row.id)).toContain(String(job._id));

    const retry = await admin.agent.post(`/api/admin/jobs/${job.id}/retry`);
    expect(retry.status).toBe(200);

    const after = await Job.findById(job.id);
    expect(after.status).toBe('queued');
    expect(after.attempts).toBe(0);
    expect(after.lastError).toBeUndefined();
  });

  it('lists a failed generation run and queues it again', async () => {
    const doc = await Document.create({
      userId: alice.user.id,
      filename: 'notes.pdf',
      sizeBytes: 100,
      status: 'extracted',
      extractedText: 'Some notes.',
    });
    const run = await GenerationRun.create({
      userId: alice.user.id,
      documentId: doc._id,
      status: 'failed',
      error: 'AI failed',
    });

    const list = await admin.agent.get('/api/admin/runs?status=failed');
    expect(list.status).toBe(200);
    const row = list.body.runs.find((r) => r.id === String(run._id));
    expect(row).toMatchObject({ userEmail: 'user901@example.com', documentFilename: 'notes.pdf' });

    const retry = await admin.agent.post(`/api/admin/runs/${run.id}/retry`);
    expect(retry.status).toBe(200);
    expect((await GenerationRun.findById(run.id)).status).toBe('running');
    expect(await Job.countDocuments({ type: 'generate', status: 'queued' })).toBeGreaterThanOrEqual(1);
  });
});

describe('admin audit trail', () => {
  it('records settings, user and queue changes', async () => {
    const res = await admin.agent.get('/api/admin/audit?limit=100');
    expect(res.status).toBe(200);
    const actions = res.body.entries.map((entry) => entry.action);
    expect(actions).toContain('settings.update');
    expect(actions).toContain('user.update');
    expect(actions).toContain('job.retry');
    expect(actions).toContain('run.retry');
  });
});

describe('admin account deletion', () => {
  it('removes the account and its data', async () => {
    const bob = await registerAgent(ctx, 902);
    const deck = await bob.agent.post('/api/decks').send({ title: 'Bob deck' });
    expect(deck.status).toBe(201);

    const res = await admin.agent.delete(`/api/admin/users/${bob.user.id}`);
    expect(res.status).toBe(200);
    expect(await User.findById(bob.user.id)).toBeNull();
    expect(await Deck.countDocuments({ userId: bob.user.id })).toBe(0);

    const login = await ctx.request
      .post('/api/auth/login')
      .send({ email: 'user902@example.com', password: 'supersecret1' });
    expect(login.status).toBe(401);
  });
});
