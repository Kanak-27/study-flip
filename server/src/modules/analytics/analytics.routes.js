import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { wrap } from '../../platform/errors.js';
import { oid } from '../../platform/oid.js';
import { Deck } from '../decks/deck.model.js';
import { Flashcard } from '../decks/flashcard.model.js';
import { ReviewLog } from '../study/reviewLog.model.js';

// Dashboard aggregates in a handful of indexed count queries — fine at this
// scale; a single aggregation pipeline can replace them when it isn't.
export const analyticsRouter = Router();

analyticsRouter.get(
  '/dashboard',
  requireAuth,
  wrap(async (req, res) => {
    const userId = req.userId;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [decks, flashcards, dueToday, reviewsToday, accuracy, streak, activity] = await Promise.all([
      Deck.countDocuments({ userId, deletedAt: null }),
      Flashcard.countDocuments({ userId, deletedAt: null }),
      Flashcard.countDocuments({ userId, deletedAt: null, 'scheduling.dueAt': { $lte: new Date() } }),
      ReviewLog.countDocuments({ userId, reviewedAt: { $gte: startOfToday } }),
      ReviewLog.aggregate([
        { $match: { userId: oid(userId) } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            recalled: { $sum: { $cond: ['$recalled', 1, 0] } },
          },
        },
      ]),
      computeStreak(userId),
      ReviewLog.aggregate([
        { $match: { userId: oid(userId), reviewedAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$reviewedAt' } },
            reviews: { $sum: 1 },
            recalled: { $sum: { $cond: ['$recalled', 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const acc = accuracy[0];
    res.json({
      stats: {
        decks,
        flashcards,
        dueToday,
        reviewsToday,
        recallAccuracy: acc && acc.total > 0 ? Math.round((acc.recalled / acc.total) * 100) : null,
        streakDays: streak,
      },
      activity: activity.map((a) => ({ date: a._id, reviews: a.reviews, recalled: a.recalled })),
    });
  }),
);

// Consecutive days with at least one review, counting back from today.
// Yesterday-with-no-reviews doesn't break the streak — the day isn't over.
// All day math happens in UTC: daySet keys are toISOString() dates, so the
// cursor must step by whole UTC days (local setHours + setDate would drift a
// day in non-UTC timezones and silently return a zero streak).
async function computeStreak(userId) {
  const days = await ReviewLog.distinct('reviewedAt', { userId });
  const daySet = new Set(days.map((d) => d.toISOString().slice(0, 10)));

  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = new Date();
  let cursor = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (!daySet.has(new Date(cursor).toISOString().slice(0, 10))) cursor -= DAY_MS;

  let streak = 0;
  while (daySet.has(new Date(cursor).toISOString().slice(0, 10))) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}
