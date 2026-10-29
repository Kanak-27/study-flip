import { User } from './user.model.js';
import { badRequest, conflict, forbidden, unauthorized } from '../../platform/errors.js';
import { z, parseBody } from '../../platform/validation.js';
import { adminEmails } from '../../platform/config.js';
import { getSettings } from '../../platform/settings.js';
import { assertMailReady } from '../../platform/mailer.js';
import { issueOtp, verifyOtp } from './otp.service.js';
import { consumeRecoveryCode, verifyTotp } from './totp.js';

// Emails are stored and compared in lowercase: a unique index on `email` is
// case-sensitive, so "Kanak@Gmail.com" and "kanak@gmail.com" would otherwise
// become two accounts — and signing in with the other casing would 401.

const email = z.string().trim().toLowerCase().email('Enter a valid email address');
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long');
const otp = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your email');

export const registerSchema = z.object({
  email,
  password,
  name: z.string().trim().min(1, 'Name is required').max(100),
});

export const registerVerifySchema = z.object({ email, otp });

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});

export const loginSecondFactorSchema = z.object({
  code: z.string().trim().min(6, 'Enter your authentication code').max(20),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({ email, otp, password });

// Anyone whose address is on ADMIN_EMAILS becomes an admin when they sign in.
// The database is still the source of truth; removing the env var does not
// silently demote someone mid-session (use the admin panel for that).
export function applyAdminAllowlist(user) {
  if (adminEmails.has(user.email) && user.role !== 'admin') {
    user.role = 'admin';
    return true;
  }
  return false;
}

// --- registration (two steps: details → emailed code) ----------------------

export async function startRegistration({ name, email, password }) {
  assertMailReady();
  if (!getSettings().signupsEnabled) {
    throw forbidden('New signups are paused right now. Please try again later.');
  }

  const existing = await User.findOne({ email }).select('_id');
  if (existing) throw conflict('An account with this email already exists. Sign in instead.');

  const { hash } = await import('@node-rs/argon2');
  const passwordHash = await hash(password);

  // The account is not created until the code is verified, so an abandoned
  // signup cannot squat the address or show up in the admin user list.
  const { devCode } = await issueOtp(email, 'register', { name, passwordHash });
  return { email, devCode };
}

export async function completeRegistration({ email, otp }) {
  const meta = await verifyOtp(email, 'register', otp);

  const existing = await User.findOne({ email }).select('_id');
  if (existing) throw conflict('An account with this email already exists. Sign in instead.');

  try {
    const user = await User.create({
      email,
      name: meta.name,
      passwordHash: meta.passwordHash,
      emailVerifiedAt: new Date(),
      role: adminEmails.has(email) ? 'admin' : 'user',
    });
    return user;
  } catch (err) {
    if (err?.code === 11000) {
      throw conflict('An account with this email already exists. Sign in instead.');
    }
    throw err;
  }
}

// --- sign in ---------------------------------------------------------------

export async function authenticate({ email, password }) {
  const { verify } = await import('@node-rs/argon2');
  const user = await User.findOne({ email }).select('+passwordHash');
  // Same message for unknown email and wrong password — don't leak which
  // addresses are registered.
  if (!user) throw unauthorized('Incorrect email or password.');
  if (user.suspendedAt) {
    throw forbidden('This account is suspended. Contact support if you think this is a mistake.');
  }
  const ok = await verify(user.passwordHash, password);
  if (!ok) throw unauthorized('Incorrect email or password.');

  // lastLoginAt is stamped only after any second factor succeeds (see routes).
  applyAdminAllowlist(user);
  await user.save();
  return user;
}

// TOTP first; recovery code as the fallback. Recovery codes are one-time, so a
// successful use removes it from the account.
export async function verifySecondFactor(user, code) {
  // Callers load the user with `.select('+twoFactor.secret +twoFactor.recoveryCodes')`.
  const twoFactor = user.twoFactor;
  if (!twoFactor?.enabled || !twoFactor.secret) return false;

  if (verifyTotp(twoFactor.secret, code)) return true;

  const remaining = consumeRecoveryCode(twoFactor.recoveryCodes, code);
  if (!remaining) return false;
  user.twoFactor.recoveryCodes = remaining;
  await user.save();
  return true;
}

// --- password reset --------------------------------------------------------

// Always resolves, even for unknown addresses: the response must not reveal
// whether an account exists. A real account gets a code in its inbox.
export async function requestPasswordReset(email) {
  assertMailReady();
  const user = await User.findOne({ email }).select('_id');
  if (!user) return {};
  return issueOtp(email, 'reset_password');
}

export async function resetPassword({ email, otp, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');

  // One error for bad/expired codes and unknown addresses alike, so the reset
  // endpoint cannot be used to discover which emails have accounts.
  const invalidCode = () =>
    badRequest('That code is invalid or has expired. Request a new one.');

  try {
    await verifyOtp(email, 'reset_password', otp);
  } catch {
    throw invalidCode();
  }
  if (!user) throw invalidCode();

  const { hash } = await import('@node-rs/argon2');
  user.passwordHash = await hash(password);
  user.passwordChangedAt = new Date();
  await user.save();
  return user;
}

// --- profile ---------------------------------------------------------------

export const profileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100).optional(),
  phone: z
    .string()
    .trim()
    .max(20, 'Phone number is too long')
    .regex(/^[+0-9 ()-]*$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
  bio: z.string().trim().max(280, 'Bio must be 280 characters or fewer').optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: password,
});

export { parseBody as parse };
