import { Router } from 'express';
import { User } from './user.model.js';
import {
  registerSchema,
  registerVerifySchema,
  loginSchema,
  loginSecondFactorSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  startRegistration,
  completeRegistration,
  authenticate,
  verifySecondFactor,
  requestPasswordReset,
  resetPassword,
  applyAdminAllowlist,
  parse,
} from './auth.service.js';
import { sendPasswordChangedEmail } from '../../platform/mailer.js';
import { destroyUserSessions } from '../../platform/sessions.js';
import { logger } from '../../platform/logger.js';
import { wrap, unauthorized, forbidden } from '../../platform/errors.js';

export const authRouter = Router();

// express-session's callbacks predate promises. Wrapping the two we need keeps
// the route bodies linear and makes failures real rejections.
const regenerate = (req) =>
  new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
const destroySession = (req) =>
  new Promise((resolve) => req.session.destroy(() => resolve()));

// A new session id on every sign-in prevents session fixation.
async function signIn(req, userId) {
  await regenerate(req);
  req.session.userId = String(userId);
  delete req.session.pending2faUserId;
}

authRouter.post(
  '/register',
  wrap(async (req, res) => {
    const data = parse(registerSchema, req.body);
    const result = await startRegistration(data);
    res.status(202).json({ pending: true, ...result });
  }),
);

authRouter.post(
  '/register/verify',
  wrap(async (req, res) => {
    const data = parse(registerVerifySchema, req.body);
    const user = await completeRegistration(data);
    await signIn(req, user.id);
    res.status(201).json({ user });
  }),
);

authRouter.post(
  '/login',
  wrap(async (req, res) => {
    const data = parse(loginSchema, req.body);
    const user = await authenticate(data);

    if (user.twoFactorEnabled) {
      // Not signed in yet — only this browser may finish the challenge.
      await regenerate(req);
      req.session.pending2faUserId = user.id;
      res.json({ twoFactorRequired: true });
      return;
    }

    await signIn(req, user.id);
    user.lastLoginAt = new Date();
    await user.save();
    res.json({ user });
  }),
);

authRouter.post(
  '/login/2fa',
  wrap(async (req, res) => {
    const { code } = parse(loginSecondFactorSchema, req.body);
    const pendingId = req.session.pending2faUserId;
    if (!pendingId) throw unauthorized('Your sign-in expired. Enter your password again.');

    const user = await User.findById(pendingId).select(
      '+twoFactor.secret +twoFactor.recoveryCodes',
    );
    if (!user || user.suspendedAt) {
      await destroySession(req);
      throw unauthorized('Your sign-in expired. Enter your password again.');
    }
    if (!(await verifySecondFactor(user, code))) {
      throw unauthorized('That code is not correct. Try the next one, or use a recovery code.');
    }

    await signIn(req, user.id);
    user.lastLoginAt = new Date();
    await user.save();
    res.json({ user });
  }),
);

authRouter.post('/logout', async (req, res) => {
  await destroySession(req);
  res.clearCookie('studyflip.sid').json({ ok: true });
});

authRouter.get(
  '/me',
  wrap(async (req, res) => {
    if (!req.session.userId) throw unauthorized();
    const user = await User.findById(req.session.userId);
    if (!user) {
      // session outlived the account
      await destroySession(req);
      throw unauthorized();
    }
    if (user.suspendedAt) {
      await destroySession(req);
      throw forbidden('This account is suspended. Contact support if you think this is a mistake.');
    }
    // Keeps ADMIN_EMAILS effective for an account created before it was set.
    if (applyAdminAllowlist(user)) await user.save();
    res.json({ user });
  }),
);

authRouter.post(
  '/password/forgot',
  wrap(async (req, res) => {
    const { email } = parse(forgotPasswordSchema, req.body);
    try {
      const result = await requestPasswordReset(email);
      // Same response either way: never reveal whether the address exists.
      res.status(202).json({ ok: true, ...result });
    } catch (err) {
      // A server with no working mail transport is an operational problem,
      // not an account-existence oracle: tell the operator-facing truth.
      if (err?.code === 'mail_unconfigured') throw err;
      res.status(202).json({ ok: true });
    }
  }),
);

authRouter.post(
  '/password/reset',
  wrap(async (req, res) => {
    const data = parse(resetPasswordSchema, req.body);
    const user = await resetPassword(data);

    // Every existing session dies with the old password.
    await destroyUserSessions(user.id);

    sendPasswordChangedEmail({ to: user.email, name: user.name }).catch((err) =>
      logger.warn({ err }, 'password changed email failed'),
    );

    res.json({ ok: true });
  }),
);
