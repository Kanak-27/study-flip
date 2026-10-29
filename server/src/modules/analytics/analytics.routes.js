import { Router } from 'express';
import { wrap } from '../../platform/errors.js';
import { oid } from '../../platform/oid.js';
import { Deck } from '../decks/deck.model.js';
import { Flashcard } from '../decks/flashcard.model.js';
import { Document } from '../documents/document.model.js';
import { ReviewLog } from '../study/reviewLog.model.js';

// Dashboard aggregates in a handful of indexed count queries — fine at this
// scale; a single aggregation pipeline can replace them when it isn't.
export const analyticsRouter = Router();

analyticsRouter.get(
  '/dashboard',
  wrap(async (req, res) => {
    const userId = req.userId;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [decks, flashcards, dueToday, reviewsToday, accuracy, streak, activity, recent, peer] = await Promise.all([
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
      recentDecks(userId, 3),
      peerComparison(userId, sevenDaysAgo),
    ]);

    // NB: the destructured name above must not shadow the helper functions
    // (`recentDecks`) — the initializer would hit the temporal dead zone.
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
      recentDecks: recent,
      peer,
    });
  }),
);

// The three decks made most recently, each with the PDF/document it came from
// — "what did I turn into flashcards today?" without a trip to the decks page.
async function recentDecks(userId, limit) {
  const decks = await Deck.find({ userId, deletedAt: null }).sort({ createdAt: -1 }).limit(limit).lean();
  if (!decks.length) return [];

  const docIds = decks.map((d) => d.documentId).filter(Boolean);
  const [docs, counts] = await Promise.all([
    docIds.length ? Document.find({ _id: { $in: docIds } }).select('filename').lean() : Promise.resolve([]),
    Flashcard.aggregate([
      { $match: { userId: oid(userId), deletedAt: null, deckId: { $in: decks.map((d) => d._id) } } },
      { $group: { _id: '$deckId', count: { $sum: 1 } } },
    ]),
  ]);
  const filenameById = new Map(docs.map((d) => [d._id.toString(), d.filename]));
  const countById = new Map(counts.map((c) => [c._id.toString(), c.count]));

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  return decks.map((d) => ({
    id: d._id.toString(),
    title: d.title,
    subject: d.subject ?? null,
    cardCount: countById.get(d._id.toString()) ?? 0,
    documentFilename: d.documentId ? (filenameById.get(d.documentId.toString()) ?? null) : null,
    createdAt: d.createdAt,
    createdToday: d.createdAt >= startOfToday,
  }));
}

// Where this student stands among everyone studying this week. Counts only —
// no names, no ids leave this function — so it's a scoreboard, not a
// directory. `percentile` is the share of other active students they beat.
async function peerComparison(userId, since) {
  const weekly = await ReviewLog.aggregate([
    { $match: { reviewedAt: { $gte: since } } },
    { $group: { _id: '$userId', reviews: { $sum: 1 } } },
    { $sort: { reviews: -1, _id: 1 } },
  ]);

  const idx = weekly.findIndex((r) => r._id.toString() === String(userId));
  const studentsActive = weekly.length;
  const reviewsThisWeek = idx >= 0 ? weekly[idx].reviews : 0;
  const base = { reviewsThisWeek, studentsActive, rank: idx >= 0 ? idx + 1 : null, percentile: null };
  if (idx < 0 || studentsActive < 2) return base;

  return { ...base, percentile: Math.round(((studentsActive - idx - 1) / (studentsActive - 1)) * 100) };
}

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
