import { Deck } from './deck.model.js';
import { Flashcard } from './flashcard.model.js';
import { notFound } from '../../platform/errors.js';
import { oid } from '../../platform/oid.js';
import { z, parseBody } from '../../platform/validation.js';

export const createDeckSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  subject: z.string().trim().max(100).optional(),
});

export const updateDeckSchema = createDeckSchema.partial();

export const cardSchema = z.object({
  question: z.string().trim().min(1, 'Question is required').max(2000),
  answer: z.string().trim().min(1, 'Answer is required').max(8000),
});

// --- decks ---

export async function listDecks(userId) {
  const decks = await Deck.find({ userId, deletedAt: null }).sort({ createdAt: -1 }).lean();
  // card counts in one extra query — decks per user are modest, and this
  // avoids an aggregation pipeline nobody needs yet
  const counts = await Flashcard.aggregate([
    { $match: { userId: oid(userId), deletedAt: null } },
    { $group: { _id: '$deckId', count: { $sum: 1 } } },
  ]);
  const byDeck = new Map(counts.map((c) => [c._id.toString(), c.count]));
  return decks.map((d) => ({ ...d, id: d._id.toString(), cardCount: byDeck.get(d._id.toString()) ?? 0, _id: undefined, __v: undefined }));
}

export async function getDeck(userId, deckId) {
  const deck = await Deck.findOne({ _id: deckId, userId, deletedAt: null });
  return deck ?? null;
}

export async function requireDeck(userId, deckId) {
  const deck = await getDeck(userId, deckId);
  if (!deck) throw notFound('Deck not found.');
  return deck;
}

export async function createDeck(userId, data) {
  return Deck.create({ userId, ...data });
}

export async function updateDeck(deck, patch) {
  Object.assign(deck, patch);
  await deck.save();
  return deck;
}

export async function softDeleteDeck(deck) {
  deck.deletedAt = new Date();
  await deck.save();
  await Flashcard.updateMany({ deckId: deck._id, deletedAt: null }, { $set: { deletedAt: new Date() } });
}

// --- flashcards ---

export async function listCards(userId, deckId) {
  return Flashcard.find({ userId, deckId, deletedAt: null }).sort({ createdAt: 1 });
}

export async function requireCard(userId, cardId) {
  const card = await Flashcard.findOne({ _id: cardId, userId, deletedAt: null });
  if (!card) throw notFound('Flashcard not found.');
  return card;
}

export async function createCard(userId, deckId, data) {
  return Flashcard.create({ userId, deckId, question: data.question, answer: data.answer });
}

export async function updateCard(card, patch) {
  // Only content fields — scheduling is never touched by an edit.
  if (patch.question !== undefined) card.question = patch.question;
  if (patch.answer !== undefined) card.answer = patch.answer;
  await card.save();
  return card;
}

export async function softDeleteCard(card) {
  card.deletedAt = new Date();
  await card.save();
}
