import nodemailer from 'nodemailer';
import { config, isProd } from './config.js';
import { AppError } from './errors.js';
import { logger } from './logger.js';

// One place that sends mail. Tests can swap the transport; development without
// SMTP logs messages instead of failing, and production refuses to proceed so
// a missing SMTP config can never look like "the code email never arrived".

let transport = null;
let testSender = null;

export function mailConfigured() {
  return Boolean(config.SMTP_HOST);
}

// Flows that *must* send mail (signup codes, password resets) call this before
// touching the database, so production without SMTP fails the same way for
// every address instead of becoming an account-existence oracle.
export function assertMailReady() {
  if (!mailConfigured() && isProd) {
    throw new AppError(
      503,
      'mail_unconfigured',
      'Email delivery is not configured on this server. Please contact support.',
    );
  }
}

// Test hook: capture messages instead of hitting a real server.
export function setMailSender(sender) {
  testSender = sender;
}

export function resetMailSender() {
  testSender = null;
}

// Google shows app passwords as four groups of four characters. People often
// paste them with the spaces, which Gmail's SMTP endpoint does not accept.
function smtpPassword() {
  const pass = config.SMTP_PASS ?? '';
  return config.SMTP_HOST?.toLowerCase() === 'smtp.gmail.com'
    ? pass.replace(/\s+/g, '')
    : pass;
}

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER
        ? { user: config.SMTP_USER, pass: smtpPassword() }
        : undefined,
    });
  }
  return transport;
}

// Used by `npm run mail:test` so an operator can check the credentials without
// creating an account or waiting for an OTP.
export async function verifyMailTransport() {
  assertMailReady();
  await getTransport().verify();
}

export async function sendMail({ to, subject, text, html }) {
  if (testSender) {
    await testSender({ to, subject, text, html });
    return { captured: true };
  }

  if (!mailConfigured()) {
    if (isProd) {
      throw new AppError(
        503,
        'mail_unconfigured',
        'Email delivery is not configured on this server. Please contact support.',
      );
    }
    // Local development: the code still has to be visible somewhere.
    logger.warn({ to, subject, body: text }, 'email not sent (no SMTP configured)');
    return { logged: true };
  }

  try {
    return await getTransport().sendMail({
      from: config.MAIL_FROM,
      to,
      subject,
      text,
      html,
    });
  } catch (err) {
    // Keep the provider's real error in the logs, but don't leak SMTP details
    // (or turn a mail outage into a generic "something went wrong" 500).
    logger.error({ err, to, subject }, 'email delivery failed');
    throw new AppError(
      502,
      'mail_delivery_failed',
      'We could not send that email right now. Please try again in a few minutes.',
    );
  }
}

const BRAND = 'StudyFlip';

export async function sendOtpEmail({ to, code, purpose, ttlMinutes }) {
  const action =
    purpose === 'register'
      ? 'finish creating your StudyFlip account'
      : 'reset your StudyFlip password';
  return sendMail({
    to,
    subject: `${code} is your ${BRAND} code`,
    text: `Your ${BRAND} code is ${code}.\n\nUse it to ${action}. It expires in ${ttlMinutes} minutes.\n\nIf you did not request this, you can ignore this email.`,
    html: `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
  <p style="font-size:20px;font-weight:800;margin:0 0 24px">studyflip<span style="color:#166534">.</span></p>
  <p style="margin:0 0 12px">Use this code to ${action}:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:0 0 16px">${code}</p>
  <p style="margin:0 0 8px;color:#475569">It expires in ${ttlMinutes} minutes.</p>
  <p style="margin:0;color:#94a3b8;font-size:13px">If you did not request this, you can safely ignore this email.</p>
</div>`,
  });
}

export async function sendPasswordChangedEmail({ to, name }) {
  return sendMail({
    to,
    subject: `Your ${BRAND} password was changed`,
    text: `Hi ${name},\n\nThe password for your ${BRAND} account was just changed. If this was you, no action is needed.\n\nIf you did not change it, reset your password immediately and contact support.`,
  });
}

export async function sendAccountDeletedEmail({ to, name }) {
  return sendMail({
    to,
    subject: `Your ${BRAND} account was deleted`,
    text: `Hi ${name},\n\nYour ${BRAND} account and its study data were deleted. If you did not request this, contact support right away.`,
  });
}
