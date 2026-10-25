import { z } from 'zod';
import { Flashcard } from '../decks/flashcard.model.js';
import { Deck } from '../decks/deck.model.js';
import { ReviewLog } from './reviewLog.model.js';
import { schedule, initialSchedulingState, RATING } from '../scheduling/sm2.js';
import { badRequest, notFound } from '../../platform/errors.js';
import { oid } from '../../platform/oid.js';

export const reviewSchema = z.object({
  flashcardId: z.string().min(1),
  rating: z
    .number()
    .int()
    .refine((q) => Object.values(RATING).includes(q), 'Rating must be Again (1), Hard (3) or Easy (5)'),
});

export const startSessionSchema = z.object({
  deckIds: z.array(z.string()).min(1).optional(),
  mode: z.enum(['due', 'deck']).default('due'),
});

// --- due queue ---

export async function dueCards(userId, { deckIds, limit = 200 } = {}) {
  const filter = {
    userId,
    deletedAt: null,
    'scheduling.dueAt': { $lte: new Date() },
    ...(deckIds ? { deckId: { $in: deckIds } } : {}),
  };
  return Flashcard.find(filter).sort({ 'scheduling.dueAt': 1 }).limit(limit);
}

export async function dueCountsByDeck(userId) {
  const counts = await Flashcard.aggregate([
    { $match: { userId: oid(userId), deletedAt: null, 'scheduling.dueAt': { $lte: new Date() } } },
    { $group: { _id: '$deckId', due: { $sum: 1 } } },
  ]);
  return counts;
}

// --- sessions ---

// Sessions are intentionally in-memory slices of the due queue: they hold no
// scheduling state, so a lost session loses nothing — the user just starts a
// new one. Card order and progress live client-side.
export async function buildSessionCards(userId, { mode, deckIds } = {}) {
  if (mode === 'deck') {
    if (!deckIds?.length) throw badRequest('deckIds are required in deck mode.');
    const decks = await Deck.find({ userId, _id: { $in: deckIds }, deletedAt: null });
    if (decks.length !== deckIds.length) throw notFound('One or more decks not found.');
  }
  const cards = await dueCards(userId, { deckIds });
  return cards.map((c) => ({
    id: c.id,
    deckId: c.deckId.toString(),
    question: c.question,
    answer: c.answer,
  }));
}

// --- review recording ---

// Records one review: appends to the log, advances SM-2 state, mirrors the
// schedule onto the card. Two writes in a transaction-sized operation; Mongo
// standalone (dev/tests) has no transactions, so a failure between them is
// repaired by the next review of the same card.
export async function recordReview(userId, { flashcardId, rating }) {
  const card = await Flashcard.findOne({ _id: flashcardId, userId, deletedAt: null });
  if (!card) throw notFound('Flashcard not found.');

  const prev = card.scheduling
    ? { ...card.scheduling.toObject() }
    : initialSchedulingState();
  const next = schedule(prev, rating);

  card.scheduling = {
    state: next.state,
    ease: next.ease,
    intervalDays: next.intervalDays,
    reps: next.reps,
    lapses: next.lapses,
    dueAt: next.dueAt,
    lastReviewAt: next.lastReviewAt,
  };
  await card.save();

  const log = await ReviewLog.create({
    userId,
    flashcardId: card._id,
    deckId: card.deckId,
    rating,
    recalled: rating >= 3,
    intervalDays: next.intervalDays,
    reviewedAt: new Date(),
    prevScheduling: {
      state: prev.state,
      ease: prev.ease,
      intervalDays: prev.intervalDays,
      reps: prev.reps,
      lapses: prev.lapses,
    },
  });

  // reviewLogId lets the UI revise this grade while it's still the newest
  // one (see reviseReview).
  return { flashcardId: card.id, reviewLogId: log.id, scheduling: card.scheduling };
}

export const reviseSchema = z.object({ rating: reviewSchema.shape.rating });

// Correct the grade on your own *latest* review. The schedule is recomputed
// from the pre-review snapshot as if the new grade had been given at the
// original review time, so history stays coherent: one review, right rating.
// Rejected once a newer review exists for the same card (the client closes
// its change window when the next card is flipped).
export async function reviseReview(userId, reviewId, rating) {
  const log = await ReviewLog.findOne({ _id: reviewId, userId });
  if (!log) throw notFound('Review not found.');

  const latest = await ReviewLog.findOne({ userId, flashcardId: log.flashcardId })
    .sort({ reviewedAt: -1, _id: -1 })
    .select('_id');
  if (latest?._id.toString() !== log._id.toString() || !log.prevScheduling) {
    throw badRequest('This review can no longer be changed.');
  }

  const card = await Flashcard.findOne({ _id: log.flashcardId, userId, deletedAt: null });
  if (!card) throw notFound('Flashcard not found.');

  const p = log.prevScheduling;
  const prev = { state: p.state, ease: p.ease, intervalDays: p.intervalDays, reps: p.reps, lapses: p.lapses };
  const next = schedule(prev, rating, log.reviewedAt);

  card.scheduling = {
    state: next.state,
    ease: next.ease,
    intervalDays: next.intervalDays,
    reps: next.reps,
    lapses: next.lapses,
    dueAt: next.dueAt,
    lastReviewAt: next.lastReviewAt,
  };
  await card.save();

  log.rating = rating;
  log.recalled = rating >= 3;
  log.intervalDays = next.intervalDays;
  await log.save();

  return { flashcardId: card.id, reviewLogId: log.id, rating, scheduling: card.scheduling };
}
