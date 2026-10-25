import { Types } from 'mongoose';

// aggregate() bypasses Mongoose's schema casting, so a string userId in a
// $match stage silently matches nothing against ObjectId fields. Every
// aggregation must go through this.
export function oid(value) {
  return value instanceof Types.ObjectId ? value : new Types.ObjectId(String(value));
}
