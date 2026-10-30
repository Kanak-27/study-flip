import { connectDb, disconnectDb } from '../src/platform/db.js';
import { User } from '../src/modules/auth/user.model.js';

// Bootstrap an admin account without going through email OTP. This is for the
// very first admin (or for ops when mail is broken): afterwards, use the admin
// panel's Users tab to promote other people. Creating an account this way marks
// the address as verified and hashes the password with the same argon2 settings
// the registration flow uses.
//
//   npm run create-admin -- you@example.com 'your-password' "Your Name"
//
// Re-running it for the same address resets that password and keeps the admin
// role, so it is also the recovery path if the only admin is locked out.

const [rawEmail, password, name = 'Admin'] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();

if (!email || !password) {
  console.error("Usage: npm run create-admin -- you@example.com 'your-password' \"Your Name\"");
  process.exit(1);
}
if (!/^\S+@\S+\.\S+$/.test(email)) {
  console.error(`Not a valid email address: ${rawEmail}`);
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

await connectDb();

try {
  const { hash } = await import('@node-rs/argon2');
  const passwordHash = await hash(password);

  const existing = await User.findOne({ email }).select('_id');
  if (existing) {
    await User.updateOne(
      { _id: existing._id },
      {
        $set: {
          passwordHash,
          role: 'admin',
          emailVerifiedAt: new Date(),
          passwordChangedAt: new Date(),
        },
        $unset: { suspendedAt: 1, suspendedReason: 1 },
      },
    );
    console.log(`${email} already existed — password reset and admin role confirmed.`);
  } else {
    await User.create({
      email,
      name: name.trim().slice(0, 100) || 'Admin',
      passwordHash,
      role: 'admin',
      emailVerifiedAt: new Date(),
    });
    console.log(`${email} created as an admin.`);
  }
} finally {
  await disconnectDb();
}
