import { config } from '../src/platform/config.js';
import {
  mailConfigured,
  sendMail,
  verifyMailTransport,
} from '../src/platform/mailer.js';

// Checks the configured SMTP credentials and sends one real message.
//
//   npm run mail:test -w server -- you@example.com
//
// With no address it sends to SMTP_USER, which is useful for Gmail.

const to = process.argv[2]?.trim() || config.SMTP_USER;

if (!to) {
  console.error('Usage: npm run mail:test -w server -- you@example.com');
  process.exit(1);
}

if (!mailConfigured()) {
  console.error('SMTP_HOST is not set. Add the SMTP settings to server/.env first.');
  process.exit(1);
}

console.log(`Checking ${config.SMTP_HOST}:${config.SMTP_PORT} as ${config.SMTP_USER ?? '(no user)'}...`);

try {
  await verifyMailTransport();
  console.log('SMTP login OK.');
} catch (err) {
  console.error(`SMTP login failed: ${err.message}`);
  process.exit(1);
}

try {
  const result = await sendMail({
    to,
    subject: 'StudyFlip SMTP test',
    text: 'SMTP is configured correctly. This message was sent by npm run mail:test.',
  });
  console.log(`Test email sent to ${to}${result.messageId ? ` (${result.messageId})` : ''}.`);
} catch (err) {
  console.error(`SMTP login worked, but sending failed: ${err.message}`);
  process.exit(1);
}
