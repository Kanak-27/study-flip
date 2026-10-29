import { Router } from 'express';
import multer from 'multer';
import { User } from '../auth/user.model.js';
import { profileSchema, changePasswordSchema, parse } from '../auth/auth.service.js';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCodes,
  totpQrDataUrl,
  totpUri,
  verifyTotp,
} from '../auth/totp.js';
import { getEntitlements, generationsUsedThisMonth } from '../billing/billing.service.js';
import { deleteUserAccount } from '../auth/account.service.js';
import { sendPasswordChangedEmail } from '../../platform/mailer.js';
import { destroyUserSessions } from '../../platform/sessions.js';
import { logger } from '../../platform/logger.js';
import {
  badRequest,
  conflict,
  notFound,
  unauthorized,
  wrap,
} from '../../platform/errors.js';
import { z } from '../../platform/validation.js';

export const profileRouter = Router();

const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB is plenty at 256–512px

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(badRequest('Choose a JPG, PNG or WebP image.'));
      return;
    }
    cb(null, true);
  },
});

// Content-type headers can lie; check the first bytes so an HTML page cannot
// be stored and served back as "image/png".
function sniffImage(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

const regenerate = (req) =>
  new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));

// --- profile -----------------------------------------------------------------

profileRouter.get(
  '/me',
  wrap(async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) throw unauthorized();
    const [{ plan, subscription }, used] = await Promise.all([
      getEntitlements(req.userId),
      generationsUsedThisMonth(req.userId),
    ]);
    res.json({
      user,
      plan,
      used,
      subscription: subscription
        ? {
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
            canceledAt: subscription.canceledAt,
          }
        : null,
    });
  }),
);

profileRouter.patch(
  '/me',
  wrap(async (req, res) => {
    const data = parse(profileSchema, req.body);
    const user = await User.findById(req.userId);
    if (!user) throw unauthorized();

    if (data.name !== undefined) user.name = data.name;
    if (data.phone !== undefined) user.phone = data.phone || undefined;
    if (data.bio !== undefined) user.bio = data.bio || undefined;

    await user.save();
    res.json({ user });
  }),
);

profileRouter.post(
  '/me/password',
  wrap(async (req, res) => {
    const data = parse(changePasswordSchema, req.body);
    const user = await User.findById(req.userId).select('+passwordHash');
    if (!user) throw unauthorized();

    const { hash, verify } = await import('@node-rs/argon2');
    if (!(await verify(user.passwordHash, data.currentPassword))) {
      throw badRequest('Your current password is not correct.');
    }
    if (data.currentPassword === data.newPassword) {
      throw badRequest('Choose a password different from your current one.');
    }

    user.passwordHash = await hash(data.newPassword);
    user.passwordChangedAt = new Date();
    await user.save();

    // Every old session (including this one) is invalidated, then this browser
    // gets a fresh session so the user is not kicked out of the page they used.
    await destroyUserSessions(user.id);
    await regenerate(req);
    req.session.userId = user.id;

    sendPasswordChangedEmail({ to: user.email, name: user.name }).catch((err) =>
      logger.warn({ err }, 'password changed email failed'),
    );

    res.json({ ok: true, user });
  }),
);

// --- avatar ------------------------------------------------------------------

profileRouter.post(
  '/me/avatar',
  avatarUpload.single('avatar'),
  wrap(async (req, res) => {
    if (!req.file) throw badRequest('Attach an image in the "avatar" field.');
    const contentType = sniffImage(req.file.buffer);
    if (!contentType) throw badRequest('That file is not a JPG, PNG or WebP image.');

    const user = await User.findById(req.userId);
    if (!user) throw unauthorized();
    user.avatar = { data: req.file.buffer, contentType };
    user.avatarUpdatedAt = new Date();
    await user.save();
    res.json({ user });
  }),
);

profileRouter.delete(
  '/me/avatar',
  wrap(async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) throw unauthorized();
    user.avatar = undefined;
    user.avatarUpdatedAt = undefined;
    await user.save();
    res.json({ user });
  }),
);

profileRouter.get(
  '/users/:id/avatar',
  wrap(async (req, res) => {
    const user = await User.findById(req.params.id).select('+avatar.data +avatar.contentType');
    if (!user?.avatar?.data?.length) throw notFound('No avatar.');
    res.set('Content-Type', user.avatar.contentType || 'image/png');
    res.set('Cache-Control', 'private, max-age=300');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(user.avatar.data);
  }),
);

// --- two-factor authentication ----------------------------------------------

profileRouter.post(
  '/me/2fa/setup',
  wrap(async (req, res) => {
    const user = await User.findById(req.userId).select(
      '+twoFactor.pendingSecret +twoFactor.recoveryCodes',
    );
    if (!user) throw unauthorized();
    if (user.twoFactor?.enabled) throw conflict('Two-factor authentication is already enabled.');

    const secret = generateTotpSecret();
    user.twoFactor = {
      ...(user.twoFactor ? user.twoFactor.toObject?.() ?? user.twoFactor : {}),
      enabled: false,
      pendingSecret: secret,
    };
    await user.save();

    const otpauthUrl = totpUri({ secret, email: user.email });
    res.json({ secret, otpauthUrl, qr: await totpQrDataUrl(otpauthUrl) });
  }),
);

const twoFactorCodeSchema = z.object({ code: z.string().trim().min(6).max(20) });

profileRouter.post(
  '/me/2fa/enable',
  wrap(async (req, res) => {
    const { code } = parse(twoFactorCodeSchema, req.body);
    const user = await User.findById(req.userId).select(
      '+twoFactor.pendingSecret +twoFactor.recoveryCodes',
    );
    if (!user) throw unauthorized();
    if (!user.twoFactor?.pendingSecret) throw badRequest('Start the setup again to get a new QR code.');
    if (!verifyTotp(user.twoFactor.pendingSecret, code)) {
      throw badRequest('That code is not correct. Check your authenticator app and try again.');
    }

    const recoveryCodes = generateRecoveryCodes();
    user.twoFactor.secret = user.twoFactor.pendingSecret;
    user.twoFactor.pendingSecret = undefined;
    user.twoFactor.enabled = true;
    user.twoFactor.enabledAt = new Date();
    user.twoFactor.recoveryCodes = hashRecoveryCodes(recoveryCodes);
    user.twoFactorEnabled = true;
    await user.save();

    // Shown once; only hashes are kept.
    res.json({ recoveryCodes, user });
  }),
);

profileRouter.post(
  '/me/2fa/disable',
  wrap(async (req, res) => {
    const { password } = parse(z.object({ password: z.string().min(1, 'Enter your password') }), req.body);
    const user = await User.findById(req.userId).select('+passwordHash');
    if (!user) throw unauthorized();

    const { verify } = await import('@node-rs/argon2');
    if (!(await verify(user.passwordHash, password))) throw badRequest('Your password is not correct.');

    user.twoFactor = { enabled: false, recoveryCodes: [] };
    user.twoFactorEnabled = false;
    await user.save();
    res.json({ ok: true, user });
  }),
);

// --- account deletion --------------------------------------------------------

profileRouter.delete(
  '/me',
  wrap(async (req, res) => {
    const { password } = parse(z.object({ password: z.string().min(1, 'Enter your password') }), req.body);
    const user = await User.findById(req.userId).select('+passwordHash');
    if (!user) throw unauthorized();

    const { verify } = await import('@node-rs/argon2');
    if (!(await verify(user.passwordHash, password))) throw badRequest('Your password is not correct.');

    await deleteUserAccount(user);
    res.clearCookie('studyflip.sid').json({ ok: true });
  }),
);
