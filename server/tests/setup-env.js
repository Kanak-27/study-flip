// Runs before every test module is imported. Config is read once at import
// time, so anything a test file imports statically (models, services) would
// otherwise capture the developer's server/.env instead of the test values.
//
// `??=` keeps an explicit value a test file sets for itself, but the suite
// runs against in-memory Mongo, no email, and no billing provider.

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ??= 'test-secret-at-least-16-chars';

// Config validates MONGO_URI at import time, and test files import config-
// dependent modules before `beforeAll` starts the in-memory Mongo. A
// placeholder keeps that import valid; the helper then overwrites it with the
// memory-server URI and passes it explicitly to connectDb().
process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/studyflip-test';

process.env.CASHFREE_CLIENT_ID ??= '';
process.env.CASHFREE_CLIENT_SECRET ??= '';
process.env.CASHFREE_WEBHOOK_SECRET ??= '';
process.env.CASHFREE_PLAN_ID ??= '';
process.env.BILLING_RETURN_URL ??= 'http://localhost:5173/api/billing/return';
process.env.CLIENT_ORIGIN ??= 'http://localhost:5173';

// No SMTP: otp.service then returns `devCode` in the response, which is how
// the two-step registration helper gets through. The admin allowlist has one
// address so admin tests have a real promoted account.
process.env.SMTP_HOST ??= '';
process.env.ADMIN_EMAILS ??= 'admin@example.com';
