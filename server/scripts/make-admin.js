import { connectDb, disconnectDb } from '../src/platform/db.js';
import { User } from '../src/modules/auth/user.model.js';

// Promotes an existing account to admin without touching the database by hand.
// The same result can be had by adding the address to ADMIN_EMAILS and having
// the user sign in again, but this works for ops when they cannot wait.
//
//   npm run make-admin -- user@example.com

const email = process.argv[2]?.trim().toLowerCase();

if (!email) {
  console.error('Usage: npm run make-admin -- user@example.com');
  process.exit(1);
}

await connectDb();

try {
  const user = await User.findOneAndUpdate(
    { email },
    { $set: { role: 'admin' } },
    { new: true },
  );
  if (!user) {
    console.error(`No account uses ${email}. Ask them to sign up first.`);
    process.exitCode = 1;
  } else {
    console.log(`${email} is now an admin.`);
  }
} finally {
  await disconnectDb();
}
