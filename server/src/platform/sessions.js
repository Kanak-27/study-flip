import mongoose from 'mongoose';

// express-session stores session documents in Mongo (connect-mongo). Most
// versions keep the payload as a JSON string, some as an object, so both are
// matched. Used after password changes/resets and account deletion: a stolen
// cookie must stop working once the password does.
export async function destroyUserSessions(userId) {
  const db = mongoose.connection.db;
  if (!db) return 0;
  const id = String(userId);
  const result = await db.collection('sessions').deleteMany({
    $or: [
      { 'session.userId': id },
      // e.g. {"cookie":{...},"userId":"..."} stored as a string
      { session: { $regex: `"userId"\\s*:\\s*"${id}"` } },
    ],
  });
  return result.deletedCount ?? 0;
}
