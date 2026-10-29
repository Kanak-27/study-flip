import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { model, Schema } from 'mongoose';
import { config, isProd } from '../../platform/config.js';
import { AppError, badRequest } from '../../platform/errors.js';
import { mailConfigured, sendOtpEmail } from '../../platform/mailer.js';
import { logger } from '../../platform/logger.js';

// Email codes for signup and password reset. Codes are stored as an HMAC of
// the address + purpose + code, never in plain text: a leaked database cannot
// be brute-forced offline into a working code without the server secret.
// TTL cleanup is handled by Mongo, so abandoned signups disappear on their own.

export const OTP_PURPOSES = ['register', 'reset_password'];

const otpChallengeSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    purpose: { type: String, enum: OTP_PURPOSES, required: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    sends: { type: Number, default: 1 },
    lastSentAt: { type: Date, default: () => new Date() },
    // Registration carries the pending profile; reset carries nothing.
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

otpChallengeSchema.index({ email: 1, purpose: 1 }, { unique: true });
// Mongo deletes expired challenges, so a stale code can never linger.
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OtpChallenge = model('OtpChallenge', otpChallengeSchema);

function hashCode(email, purpose, code) {
  return createHmac('sha256', config.SESSION_SECRET)
    .update(`${purpose}:${email}:${code}`)
    .digest('hex');
}

function matches(expectedHex, actualHex) {
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(actualHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

const secondsLeft = (from, seconds) =>
  Math.max(1, Math.ceil((from.getTime() + seconds * 1000 - Date.now()) / 1000));

// Creates (or refreshes) a code and emails it. Registration also stores the
// hashed password so the account only exists once the address is proven.
export async function issueOtp(email, purpose, meta = {}) {
  const existing = await OtpChallenge.findOne({ email, purpose });
  const now = new Date();

  if (existing) {
    const expired = existing.expiresAt <= now;
    if (!expired) {
      if (existing.lastSentAt && now - existing.lastSentAt < config.OTP_RESEND_SECONDS * 1000) {
        throw new AppError(
          429,
          'rate_limited',
          `Please wait ${secondsLeft(existing.lastSentAt, config.OTP_RESEND_SECONDS)}s before requesting another code.`,
        );
      }
      if (existing.sends >= config.OTP_MAX_SENDS) {
        throw new AppError(
          429,
          'rate_limited',
          'Too many codes requested for this email. Try again in a little while.',
        );
      }
    }
  }

  const code = generateCode();
  const expiresAt = new Date(now.getTime() + config.OTP_TTL_MINUTES * 60 * 1000);
  const resetCounts = !existing || existing.expiresAt <= now;

  await OtpChallenge.findOneAndUpdate(
    { email, purpose },
    {
      $set: {
        codeHash: hashCode(email, purpose, code),
        expiresAt,
        attempts: 0,
        lastSentAt: now,
        meta,
        ...(resetCounts ? { sends: 1 } : {}),
      },
      ...(resetCounts ? {} : { $inc: { sends: 1 } }),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  try {
    await sendOtpEmail({ to: email, code, purpose, ttlMinutes: config.OTP_TTL_MINUTES });
  } catch (err) {
    // Never leave a code the user cannot receive.
    await OtpChallenge.deleteOne({ email, purpose });
    throw err;
  }

  logger.info({ email, purpose }, 'otp sent');
  // Development convenience only: without SMTP there is no other way to see
  // the code. Production never exposes it, even when SMTP is missing.
  return !isProd && !mailConfigured() ? { devCode: code } : {};
}

// Validates a code and deletes it on success (single use).
export async function verifyOtp(email, purpose, code) {
  const challenge = await OtpChallenge.findOne({ email, purpose });
  if (!challenge) {
    throw badRequest('That code is invalid or has expired. Request a new one.');
  }
  if (challenge.expiresAt <= new Date()) {
    await challenge.deleteOne();
    throw badRequest('That code has expired. Request a new one.');
  }
  if (challenge.attempts >= config.OTP_MAX_ATTEMPTS) {
    await challenge.deleteOne();
    throw badRequest('Too many incorrect attempts. Request a new code.');
  }

  const expected = hashCode(email, purpose, code);
  if (!matches(expected, challenge.codeHash)) {
    challenge.attempts += 1;
    await challenge.save();
    throw badRequest('That code is not correct. Check the email and try again.');
  }

  await challenge.deleteOne();
  return challenge.meta ?? {};
}

export async function clearOtp(email, purpose) {
  await OtpChallenge.deleteOne({ email, purpose });
}
