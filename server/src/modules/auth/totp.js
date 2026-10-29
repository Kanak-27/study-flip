import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { config } from '../../platform/config.js';

// RFC 6238 TOTP (SHA-1, 6 digits, 30s) with RFC 4648 base32 secrets. Written
// here instead of pulling a dependency: it is ~40 lines and easy to test
// against the published vectors. Used for authenticator-app 2FA.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
// Accept one step either side, so a slightly slow phone clock still works.
const WINDOW = 1;

export function generateTotpSecret(bytes = 20) {
  return base32Encode(randomBytes(bytes));
}

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(secret) {
  const clean = secret.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error('invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpAt(secret, timestampMs = Date.now(), digits = DIGITS) {
  const counter = Math.floor(timestampMs / 1000 / STEP_SECONDS);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function verifyTotp(secret, code) {
  const candidate = String(code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(candidate)) return false;
  const now = Date.now();
  for (let offset = -WINDOW; offset <= WINDOW; offset++) {
    const expected = totpAt(secret, now + offset * STEP_SECONDS * 1000);
    const a = Buffer.from(expected);
    const b = Buffer.from(candidate);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function totpUri({ secret, email, issuer = 'StudyFlip' }) {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function totpQrDataUrl(uri) {
  return QRCode.toDataURL(uri, { margin: 1, width: 220 });
}

// --- recovery codes ---------------------------------------------------------
// One-time codes for "I lost my phone". Hashed like OTPs so a database leak
// does not hand out bypasses.

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes

function hashRecovery(code) {
  return createHmac('sha256', config.SESSION_SECRET)
    .update(`recovery:${code.replace(/-/g, '').toLowerCase()}`)
    .digest('hex');
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    let raw = '';
    for (let i = 0; i < 8; i++) raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}

export function hashRecoveryCodes(codes) {
  return codes.map(hashRecovery);
}

// Returns the remaining hashes when the code was valid, or null.
export function consumeRecoveryCode(hashes, code) {
  if (!Array.isArray(hashes) || hashes.length === 0) return null;
  const candidate = hashRecovery(String(code ?? ''));
  const remaining = hashes.filter((hash) => hash !== candidate);
  return remaining.length === hashes.length ? null : remaining;
}
