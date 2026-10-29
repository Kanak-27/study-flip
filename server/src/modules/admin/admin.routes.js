import { Router } from 'express';
import mongoose from 'mongoose';
import { User } from '../auth/user.model.js';
import { deleteUserAccount } from '../auth/account.service.js';
import { Subscription, generationsUsedThisMonth } from '../billing/billing.service.js';
import { billingConfigured, cashfreeMode } from '../billing/cashfree.client.js';
import { Document } from '../documents/document.model.js';
import { GenerationRun } from '../generation/generation.service.js';
import { Deck } from '../decks/deck.model.js';
import { Flashcard } from '../decks/flashcard.model.js';
import { ReviewLog } from '../study/reviewLog.model.js';
import { UsageEvent } from '../billing/usageEvent.model.js';
import { Job, enqueue } from '../../platform/jobs.js';
import { getSettings, updateSettings } from '../../platform/settings.js';
import { config, adminEmails } from '../../platform/config.js';
import { mailConfigured } from '../../platform/mailer.js';
import { destroyUserSessions } from '../../platform/sessions.js';
import { badRequest, conflict, notFound, wrap } from '../../platform/errors.js';
import { z, parseBody } from '../../platform/validation.js';
import { oid } from '../../platform/oid.js';
import { AuditLog } from './audit.model.js';
import { audit } from './audit.service.js';

// Day-to-day supervision endpoints. Every route here sits behind requireAdmin
// (mounted in app.js) and every mutation leaves an audit row.
export const adminRouter = Router();

const USER_ROLES = ['user', 'admin'];
const RUN_STATUSES = ['running', 'completed', 'partial', 'failed'];
const JOB_STATUSES = ['queued', 'running', 'completed', 'failed'];

// --- helpers ---------------------------------------------------------------

function paging(query, { defaultLimit = 25, maxLimit = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit),
  );
  return { page, limit, skip: (page - 1) * limit };
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function startOfMonthUtc() {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function findUserOr404(id) {
  if (!mongoose.isValidObjectId(id)) throw notFound('User not found.');
  const user = await User.findById(id);
  if (!user) throw notFound('User not found.');
  return user;
}

// Entitled = premium with time left, or premium marked active without an end
// date (older rows). Mirrors getEntitlements without one query per user.
function entitledSubscriptionFilter() {
  const now = new Date();
  return {
    planId: 'premium',
    $or: [{ currentPeriodEnd: { $gt: now } }, { currentPeriodEnd: null, status: 'active' }],
  };
}

async function entitledUserIds() {
  const rows = await Subscription.find(entitledSubscriptionFilter()).select('userId').lean();
  return rows.map((row) => row.userId);
}

function environment() {
  return {
    nodeEnv: config.NODE_ENV,
    mailConfigured: mailConfigured(),
    billingConfigured: billingConfigured(),
    billingMode: cashfreeMode(),
    aiConfigured: Boolean(config.GROQ_API_KEY),
    adminEmails: [...adminEmails],
  };
}

function publicUser(user) {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    phone: user.phone ?? null,
    bio: user.bio ?? null,
    role: user.role ?? 'user',
    emailVerified: Boolean(user.emailVerifiedAt),
    emailVerifiedAt: user.emailVerifiedAt ?? null,
    suspended: Boolean(user.suspendedAt),
    suspendedAt: user.suspendedAt ?? null,
    suspendedReason: user.suspendedReason ?? null,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    hasAvatar: Boolean(user.avatarUpdatedAt),
    avatarUpdatedAt: user.avatarUpdatedAt ?? null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

function publicSubscription(sub) {
  if (!sub) return { plan: 'free', status: null, currentPeriodEnd: null, canceledAt: null };
  const now = new Date();
  const premium =
    sub.planId === 'premium' &&
    (sub.currentPeriodEnd ? sub.currentPeriodEnd > now : sub.status === 'active');
  return {
    plan: premium ? 'premium' : 'free',
    status: sub.status ?? null,
    currentPeriodEnd: sub.currentPeriodEnd ?? null,
    canceledAt: sub.canceledAt ?? null,
    providerSubscriptionId: sub.providerSubscriptionId ?? null,
  };
}

// --- overview --------------------------------------------------------------

adminRouter.get(
  '/admin/overview',
  wrap(async (req, res) => {
    const now = new Date();
    const monthStart = startOfMonthUtc();
    const weekAgo = daysAgo(7);
    const monthAgo = daysAgo(30);

    const [
      usersTotal,
      users7d,
      users30d,
      suspended,
      admins,
      premium,
      documents,
      decks,
      cards,
      reviews7d,
      reviews30d,
      generationsThisMonth,
      runsCompleted30d,
      runsFailed30d,
      queueQueued,
      queueRunning,
      queueFailed,
      recentUsers,
      signupRows,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ createdAt: { $gte: weekAgo } }),
      User.countDocuments({ createdAt: { $gte: monthAgo } }),
      User.countDocuments({ suspendedAt: { $ne: null } }),
      User.countDocuments({ role: 'admin' }),
      Subscription.countDocuments(entitledSubscriptionFilter()),
      Document.countDocuments({}),
      Deck.countDocuments({ deletedAt: null }),
      Flashcard.countDocuments({ deletedAt: null }),
      ReviewLog.countDocuments({ reviewedAt: { $gte: weekAgo } }),
      ReviewLog.countDocuments({ reviewedAt: { $gte: monthAgo } }),
      UsageEvent.countDocuments({ type: 'generation', occurredAt: { $gte: monthStart } }),
      GenerationRun.countDocuments({ status: 'completed', createdAt: { $gte: monthAgo } }),
      GenerationRun.countDocuments({ status: 'failed', createdAt: { $gte: monthAgo } }),
      Job.countDocuments({ status: 'queued' }),
      Job.countDocuments({ status: 'running' }),
      Job.countDocuments({ status: 'failed' }),
      // No projection: avatar.data/contentType are already `select: false`, and
      // excluding the parent `avatar` path collides with those nested excludes
      // in MongoDB ("Path collision at avatar.data").
      User.find({}).sort({ createdAt: -1 }).limit(8).lean(),
      User.aggregate([
        { $match: { createdAt: { $gte: monthAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    res.json({
      stats: {
        users: { total: usersTotal, new7d: users7d, new30d: users30d, suspended, admins, premium },
        content: { documents, decks, cards },
        study: { reviews7d, reviews30d },
        ai: { generationsThisMonth, runsCompleted30d, runsFailed30d },
      },
      queue: { queued: queueQueued, running: queueRunning, failed: queueFailed },
      recentUsers: recentUsers.map(publicUser),
      signupsByDay: signupRows.map((row) => ({ date: row._id, count: row.count })),
      environment: environment(),
      generatedAt: now,
    });
  }),
);

// --- users -----------------------------------------------------------------

adminRouter.get(
  '/admin/users',
  wrap(async (req, res) => {
    const { page, limit, skip } = paging(req.query);
    const q = String(req.query.q ?? '').trim();
    const role = String(req.query.role ?? '');
    const status = String(req.query.status ?? '');
    const plan = String(req.query.plan ?? '');

    const filter = {};
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ email: rx }, { name: rx }];
    }
    if (USER_ROLES.includes(role)) filter.role = role;
    if (status === 'suspended') filter.suspendedAt = { $ne: null };
    if (status === 'active') filter.suspendedAt = null;

    if (plan === 'premium' || plan === 'free') {
      const premiumIds = await entitledUserIds();
      if (plan === 'premium') filter._id = { $in: premiumIds };
      else filter._id = { $nin: premiumIds };
    }

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const ids = users.map((user) => user._id);
    const since = startOfMonthUtc();
    const [subs, usage] = await Promise.all([
      ids.length ? Subscription.find({ userId: { $in: ids } }).lean() : [],
      ids.length
        ? UsageEvent.aggregate([
            {
              $match: { userId: { $in: ids.map(oid) }, type: 'generation', occurredAt: { $gte: since } },
            },
            { $group: { _id: '$userId', count: { $sum: 1 } } },
          ])
        : [],
    ]);
    const subById = new Map(subs.map((sub) => [String(sub.userId), sub]));
    const usedById = new Map(usage.map((row) => [String(row._id), row.count]));

    res.json({
      users: users.map((user) => ({
        ...publicUser(user),
        plan: publicSubscription(subById.get(String(user._id))),
        generationsThisMonth: usedById.get(String(user._id)) ?? 0,
      })),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  }),
);

adminRouter.get(
  '/admin/users/:id',
  wrap(async (req, res) => {
    const user = await findUserOr404(req.params.id);
    const id = String(user._id);
    const monthStart = startOfMonthUtc();

    const db = mongoose.connection.db;
    const sessionsQuery = {
      $or: [
        { 'session.userId': id },
        { session: { $regex: `"userId"\\s*:\\s*"${id}"` } },
      ],
    };

    const [sub, used, documents, decks, cards, reviews, runs, auditRows, sessions] =
      await Promise.all([
        Subscription.findOne({ userId: user._id }).lean(),
        generationsUsedThisMonth(user._id),
        Document.countDocuments({ userId: user._id }),
        Deck.countDocuments({ userId: user._id, deletedAt: null }),
        Flashcard.countDocuments({ userId: user._id, deletedAt: null }),
        ReviewLog.countDocuments({ userId: user._id }),
        GenerationRun.find({ userId: user._id })
          .sort({ createdAt: -1 })
          .limit(6)
          .select('status error createdAt documentId')
          .lean(),
        AuditLog.find({ targetId: id }).sort({ createdAt: -1 }).limit(10).lean(),
        db ? db.collection('sessions').countDocuments(sessionsQuery).catch(() => 0) : 0,
      ]);

    const docIds = runs.map((run) => run.documentId).filter(Boolean);
    const docs = docIds.length
      ? await Document.find({ _id: { $in: docIds } }).select('filename').lean()
      : [];
    const filenameById = new Map(docs.map((doc) => [String(doc._id), doc.filename]));

    res.json({
      user: publicUser(user),
      subscription: publicSubscription(sub),
      usage: { generationsThisMonth: used },
      counts: { documents, decks, cards, reviews, sessions },
      recentRuns: runs.map((run) => ({
        id: String(run._id),
        status: run.status,
        error: run.error ?? null,
        createdAt: run.createdAt,
        documentFilename: run.documentId
          ? (filenameById.get(String(run.documentId)) ?? null)
          : null,
      })),
      recentAudit: auditRows.map((row) => ({
        id: String(row._id),
        action: row.action,
        actorEmail: row.actorEmail,
        detail: row.detail,
        createdAt: row.createdAt,
      })),
      environment: environment(),
      generatedAt: new Date(),
    });
  }),
);

const userPatchSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100).optional(),
  phone: z.string().trim().max(20, 'Phone number is too long').optional(),
  bio: z.string().trim().max(280, 'Bio must be 280 characters or fewer').optional(),
  role: z.enum(USER_ROLES).optional(),
  suspended: z.boolean().optional(),
  suspendedReason: z.string().trim().max(200).optional(),
  emailVerified: z.boolean().optional(),
  resetTwoFactor: z.boolean().optional(),
});

adminRouter.patch(
  '/admin/users/:id',
  wrap(async (req, res) => {
    const user = await findUserOr404(req.params.id);
    const patch = parseBody(userPatchSchema, req.body);
    const self = String(user._id) === String(req.userId);
    const before = publicUser(user);
    const changes = {};

    if (self && patch.role && patch.role !== 'admin') {
      throw badRequest('You cannot remove your own admin access.');
    }
    if (self && patch.suspended === true) {
      throw badRequest('You cannot suspend your own account.');
    }

    if (patch.name !== undefined) {
      user.name = patch.name;
      changes.name = patch.name;
    }
    if (patch.phone !== undefined) {
      user.phone = patch.phone || undefined;
      changes.phone = patch.phone;
    }
    if (patch.bio !== undefined) {
      user.bio = patch.bio || undefined;
      changes.bio = patch.bio;
    }
    if (patch.role !== undefined && patch.role !== user.role) {
      user.role = patch.role;
      changes.role = patch.role;
    }

    if (patch.emailVerified !== undefined) {
      user.emailVerifiedAt = patch.emailVerified ? new Date() : undefined;
      changes.emailVerified = patch.emailVerified;
    }

    let signedOutSessions = false;
    if (patch.suspended === true && !user.suspendedAt) {
      user.suspendedAt = new Date();
      user.suspendedReason = patch.suspendedReason || 'Suspended by an administrator.';
      changes.suspended = true;
      changes.suspendedReason = user.suspendedReason;
    } else if (patch.suspended === false && user.suspendedAt) {
      user.suspendedAt = undefined;
      user.suspendedReason = undefined;
      changes.suspended = false;
    } else if (user.suspendedAt && patch.suspendedReason !== undefined && patch.suspendedReason) {
      user.suspendedReason = patch.suspendedReason;
      changes.suspendedReason = patch.suspendedReason;
    }

    if (patch.resetTwoFactor === true) {
      user.twoFactor = { enabled: false, recoveryCodes: [] };
      user.twoFactorEnabled = false;
      changes.resetTwoFactor = true;
    }

    await user.save();

    if (changes.suspended === true || changes.resetTwoFactor) {
      await destroyUserSessions(user.id);
      signedOutSessions = true;
    }

    await audit(req, 'user.update', {
      targetType: 'user',
      targetId: user.id,
      detail: { changes, signedOutSessions },
    });

    res.json({
      user: publicUser(user),
      before,
      changed: changes,
      signedOutSessions,
    });
  }),
);

adminRouter.delete(
  '/admin/users/:id',
  wrap(async (req, res) => {
    const user = await findUserOr404(req.params.id);
    if (String(user._id) === String(req.userId)) {
      throw badRequest('You cannot delete your own account from the admin panel.');
    }

    const snapshot = { email: user.email, name: user.name, role: user.role };
    await deleteUserAccount(user);
    await audit(req, 'user.delete', {
      targetType: 'user',
      targetId: req.params.id,
      detail: snapshot,
    });

    res.json({ ok: true, email: snapshot.email });
  }),
);

// --- generation runs -------------------------------------------------------

adminRouter.get(
  '/admin/runs',
  wrap(async (req, res) => {
    const { page, limit, skip } = paging(req.query);
    const status = String(req.query.status ?? '');
    const match = {};
    if (RUN_STATUSES.includes(status)) match.status = status;

    const [total, rows] = await Promise.all([
      GenerationRun.countDocuments(match),
      GenerationRun.aggregate([
        { $match: match },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            userId: 1,
            documentId: 1,
            status: 1,
            error: 1,
            createdAt: 1,
            updatedAt: 1,
            cardCount: { $size: '$cards' },
          },
        },
      ]),
    ]);

    const userIds = [...new Set(rows.map((row) => String(row.userId)))];
    const docIds = [...new Set(rows.map((row) => String(row.documentId)))];
    const [users, docs] = await Promise.all([
      userIds.length ? User.find({ _id: { $in: userIds } }).select('email name').lean() : [],
      docIds.length ? Document.find({ _id: { $in: docIds } }).select('filename').lean() : [],
    ]);
    const userById = new Map(users.map((user) => [String(user._id), user]));
    const docById = new Map(docs.map((doc) => [String(doc._id), doc]));

    res.json({
      runs: rows.map((row) => {
        const user = userById.get(String(row.userId));
        return {
          id: String(row._id),
          status: row.status,
          error: row.error ?? null,
          cardCount: row.cardCount,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          userId: String(row.userId),
          userEmail: user?.email ?? null,
          userName: user?.name ?? null,
          documentFilename: docById.get(String(row.documentId))?.filename ?? null,
        };
      }),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  }),
);

adminRouter.post(
  '/admin/runs/:id/retry',
  wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Run not found.');
    const run = await GenerationRun.findById(req.params.id);
    if (!run) throw notFound('Run not found.');
    if (run.status !== 'failed') {
      throw conflict('Only failed runs can be retried.');
    }

    run.status = 'running';
    run.error = undefined;
    run.cards = [];
    await run.save();
    await enqueue('generate', { runId: run.id });

    await audit(req, 'run.retry', {
      targetType: 'generation_run',
      targetId: run.id,
      detail: { userId: String(run.userId), documentId: String(run.documentId) },
    });

    res.json({ ok: true, runId: run.id, status: run.status });
  }),
);

// --- job queue -------------------------------------------------------------

adminRouter.get(
  '/admin/jobs',
  wrap(async (req, res) => {
    const { page, limit, skip } = paging(req.query);
    const status = String(req.query.status ?? '');
    const type = String(req.query.type ?? '');
    const filter = {};
    if (JOB_STATUSES.includes(status)) filter.status = status;
    if (type) filter.type = type;

    const [total, jobs, counts] = await Promise.all([
      Job.countDocuments(filter),
      Job.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Job.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);

    res.json({
      jobs: jobs.map((job) => ({
        id: String(job._id),
        type: job.type,
        status: job.status,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        nextRunAt: job.nextRunAt,
        heartbeatAt: job.heartbeatAt ?? null,
        lastError: job.lastError ?? null,
        payload: job.payload,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      })),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      counts: Object.fromEntries(counts.map((row) => [row._id, row.count])),
    });
  }),
);

adminRouter.post(
  '/admin/jobs/:id/retry',
  wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Job not found.');
    const job = await Job.findById(req.params.id);
    if (!job) throw notFound('Job not found.');
    if (job.status !== 'failed') throw conflict('Only failed jobs can be retried.');

    job.status = 'queued';
    job.attempts = 0;
    job.nextRunAt = new Date();
    job.heartbeatAt = undefined;
    job.lastError = undefined;
    await job.save();

    await audit(req, 'job.retry', {
      targetType: 'job',
      targetId: job.id,
      detail: { type: job.type, payload: job.payload },
    });

    res.json({ ok: true, jobId: job.id, status: job.status });
  }),
);

// --- runtime settings ------------------------------------------------------

const settingsSchema = z.object({
  generationsPerMonth: z
    .object({
      free: z.coerce.number().int().min(0).max(100_000),
      premium: z.coerce.number().int().min(0).max(100_000),
    })
    .partial()
    .optional(),
  signupsEnabled: z.boolean().optional(),
  generationEnabled: z.boolean().optional(),
  announcement: z.string().trim().max(280, 'Announcement must be 280 characters or fewer').optional(),
});

adminRouter.get(
  '/admin/settings',
  wrap(async (_req, res) => {
    res.json({ settings: getSettings(), environment: environment() });
  }),
);

adminRouter.patch(
  '/admin/settings',
  wrap(async (req, res) => {
    const patch = parseBody(settingsSchema, req.body);
    const before = getSettings();
    const settings = await updateSettings(patch, req.userId);

    await audit(req, 'settings.update', {
      targetType: 'settings',
      targetId: 'global',
      detail: { before, after: settings, patch },
    });

    res.json({ settings, environment: environment() });
  }),
);

// --- audit trail -----------------------------------------------------------

adminRouter.get(
  '/admin/audit',
  wrap(async (req, res) => {
    const { page, limit, skip } = paging(req.query);
    const action = String(req.query.action ?? '').trim();
    const filter = action ? { action } : {};
    const [total, logs] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    res.json({
      entries: logs.map((row) => ({
        id: String(row._id),
        actorId: row.actorId ? String(row.actorId) : null,
        actorEmail: row.actorEmail ?? null,
        action: row.action,
        targetType: row.targetType ?? null,
        targetId: row.targetId ?? null,
        detail: row.detail ?? null,
        createdAt: row.createdAt,
      })),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  }),
);
