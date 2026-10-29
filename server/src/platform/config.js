import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Load .env manually so we don't add a dependency for it. Node >= 20.12 could
// use --env-file, but loading here keeps `npm test` and scripts uniform.
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // no .env file — process.env alone must be enough
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  // Groq speaks the OpenAI wire format, so the gateway stays generic —
  // these are just the endpoint, key, and model (GroqDocs: OpenAI Compatibility).
  GROQ_API_KEY: z.string().optional(),
  GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),

  // --- email (OTP signup, password resets, security notices) ---------------
  // Any SMTP provider works (Gmail app password, Brevo, Resend SMTP, SES…).
  // Without SMTP_HOST the API logs codes to the console in development and
  // refuses OTP requests in production instead of silently locking users out.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('StudyFlip <no-reply@studyflip.local>'),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_SECONDS: z.coerce.number().int().nonnegative().default(60),
  OTP_MAX_SENDS: z.coerce.number().int().positive().default(5),

  // Comma-separated emails that are promoted to admin on sign-in/sign-up.
  // Existing accounts can also be promoted with `npm run make-admin -- email`.
  ADMIN_EMAILS: z.string().optional(),

  // Cashfree (subscriptions / recurring mandates). All optional: without keys
  // billing stays disabled and checkout returns 404 instead of failing later.
  CASHFREE_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  CASHFREE_CLIENT_ID: z.string().optional(),
  CASHFREE_CLIENT_SECRET: z.string().optional(),
  // Plan ID from the dashboard, or leave empty to create it on first checkout.
  CASHFREE_PLAN_ID: z.string().optional(),
  // Monthly premium price in INR. Cashfree plans are INR by default.
  CASHFREE_PLAN_AMOUNT: z.coerce.number().positive().default(699),
  CASHFREE_API_VERSION: z.string().default('2025-01-01'),
  // Cashfree signs webhooks with your client secret; override only if you
  // deliberately rotate the signing secret separately.
  CASHFREE_WEBHOOK_SECRET: z.string().optional(),
  // Where Cashfree sends the browser back after the mandate is authorised.
  // Must be served by the API (it 303s to the SPA) because Cashfree POSTs to
  // it and a static nginx SPA host answers POST with 405. Defaults to
  // CLIENT_ORIGIN/api/billing/return, which assumes nginx proxies /api there;
  // set this to the API's public URL if the site and API are separate hosts.
  BILLING_RETURN_URL: z.string().url().optional(),
});

const result = schema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid configuration:');
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = result.data;
export const isProd = config.NODE_ENV === 'production';

// Normalised once so every auth path checks the same source of truth.
export const adminEmails = new Set(
  (config.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);
