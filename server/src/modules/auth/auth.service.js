import { User } from './user.model.js';
import { conflict, unauthorized } from '../../platform/errors.js';
import { z, parseBody } from '../../platform/validation.js';

// Emails are stored and compared in lowercase: a unique index on `email` is
// case-sensitive, so "Kanak@Gmail.com" and "kanak@gmail.com" would otherwise
// become two accounts — and signing in with the other casing would 401.
export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  name: z.string().trim().min(1, 'Name is required').max(100),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export async function registerUser({ email, password, name }) {
  const existing = await User.findOne({ email });
  if (existing) throw conflict('An account with this email already exists.');

  const { hash } = await import('@node-rs/argon2');
  const user = await User.create({ email, name, passwordHash: await hash(password) });
  return user;
}

export async function authenticate({ email, password }) {
  const { verify } = await import('@node-rs/argon2');
  const user = await User.findOne({ email }).select('+passwordHash');
  // Same message for unknown email and wrong password — don't leak which
  // addresses are registered.
  if (!user) throw unauthorized('Incorrect email or password.');
  const ok = await verify(user.passwordHash, password);
  if (!ok) throw unauthorized('Incorrect email or password.');
  return user;
}

export { parseBody as parse };
