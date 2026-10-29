import { z } from 'zod';
import { model, Schema } from 'mongoose';
import { generateFlashcards } from './ai.gateway.js';
import { enqueue } from '../../platform/jobs.js';
import { badRequest, forbidden, notFound } from '../../platform/errors.js';
import { logger } from '../../platform/logger.js';
import { getSettings } from '../../platform/settings.js';
import { Deck } from '../decks/deck.model.js';
import { Flashcard } from '../decks/flashcard.model.js';

// --- run persistence ---

const generationRunSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'Document', required: true },
    status: {
      type: String,
      enum: ['running', 'completed', 'partial', 'failed'],
      default: 'running',
    },
    cards: {
      type: [
        {
          _id: false,
          question: String,
          answer: String,
          sourceChunk: Number,
        },
      ],
      default: [],
    },
    error: { type: String },
  },
  { timestamps: true },
);

generationRunSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const GenerationRun = model('GenerationRun', generationRunSchema);

// --- chunking ---

// Paragraph-aware sliding window. ~12k chars ≈ 3k tokens; the last paragraph
// of a chunk is repeated into the next so concepts split across a boundary
// still get their context.
export function chunkText(text, { maxChars = 12_000, overlapChars = 500 } = {}) {
  if (text.length <= maxChars) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    if (current && current.length + para.length + 2 > maxChars) {
      chunks.push(current);
      current = current.slice(-overlapChars) + '\n\n' + para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

function dedupe(cards) {
  const seen = new Set();
  const out = [];
  for (const card of cards) {
    const key = card.question.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

// --- service ---

export async function startGeneration(userId, documentId) {
  // Admin kill-switch for the AI provider (outage, runaway spend, abuse).
  // It pauses new runs only; existing decks and studying keep working.
  if (!getSettings().generationEnabled) {
    throw forbidden('AI generation is paused right now. Please try again later.');
  }

  const { Document } = await import('../documents/document.model.js');
  const doc = await Document.findOne({ _id: documentId, userId });
  if (!doc) throw notFound('Document not found.');
  if (doc.status !== 'extracted') {
    throw badRequest(doc.status === 'failed' ? 'This document failed to process.' : 'This document is still being processed.');
  }

  // Quota gate runs before enqueueing — never spend AI money on a run we
  // would have to revoke (PLAN.md §4.3).
  const { assertGenerationAllowed, recordGenerationUsage } = await import('../billing/billing.service.js');
  await assertGenerationAllowed(userId);

  const run = await GenerationRun.create({ userId, documentId });
  await enqueue('generate', { runId: run.id });
  await recordGenerationUsage(userId);
  return run;
}

export async function requireRun(userId, runId) {
  const run = await GenerationRun.findOne({ _id: runId, userId });
  if (!run) throw notFound('Generation run not found.');
  return run;
}

export const saveToDeckSchema = z.object({
  runId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  cardIndexes: z.array(z.number().int().nonnegative()).optional(), // default: all
});

export async function saveRunToDeck(userId, { runId, title, cardIndexes }) {
  const run = await requireRun(userId, runId);
  if (run.status !== 'completed' && run.status !== 'partial') {
    throw badRequest('This run has no saved cards yet.');
  }

  const picked =
    cardIndexes === undefined
      ? run.cards
      : cardIndexes.map((i) => run.cards[i]).filter(Boolean);
  if (picked.length === 0) throw badRequest('Select at least one card to save.');

  const deck = await Deck.create({ userId, title, documentId: run.documentId });
  await Flashcard.insertMany(
    picked.map((c) => ({
      userId,
      deckId: deck._id,
      question: c.question,
      answer: c.answer,
      sourceChunk: c.sourceChunk,
    })),
  );
  return { deck, cardCount: picked.length };
}

export const appendToDeckSchema = z.object({
  runId: z.string().min(1),
  cardIndexes: z.array(z.number().int().nonnegative()).optional(), // default: all
});

// "The cards I already have aren't enough" — regenerate from the deck's
// source PDF and fold the new batch into the same deck. Questions already in
// the deck are skipped so regenerating never duplicates what you study.
export async function appendRunToDeck(userId, deckId, { runId, cardIndexes }) {
  const deck = await Deck.findOne({ _id: deckId, userId, deletedAt: null });
  if (!deck) throw notFound('Deck not found.');

  const run = await requireRun(userId, runId);
  if (run.status !== 'completed' && run.status !== 'partial') {
    throw badRequest('This run has no saved cards yet.');
  }

  const picked =
    cardIndexes === undefined
      ? run.cards
      : cardIndexes.map((i) => run.cards[i]).filter(Boolean);
  if (picked.length === 0) throw badRequest('Select at least one card to add.');

  const existing = await Flashcard.find({ deckId: deck._id, deletedAt: null })
    .select('question')
    .lean();
  const seen = new Set(existing.map((c) => c.question.trim().toLowerCase()));
  const fresh = picked.filter((c) => {
    const key = c.question.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (fresh.length > 0) {
    await Flashcard.insertMany(
      fresh.map((c) => ({
        userId,
        deckId: deck._id,
        question: c.question,
        answer: c.answer,
        sourceChunk: c.sourceChunk,
      })),
    );
  }
  return { added: fresh.length, skipped: picked.length - fresh.length };
}

// --- job handler (run by the worker) ---

// `generate` is injectable so tests can exercise the run lifecycle without
// the vendor; production callers use the real gateway.
export async function handleGenerate({ runId }, { generate = generateFlashcards } = {}) {
  const run = await GenerationRun.findById(runId);
  if (!run) return;

  const { Document } = await import('../documents/document.model.js');
  const doc = await Document.findById(run.documentId);
  if (!doc?.extractedText) {
    run.status = 'failed';
    run.error = 'Document text is no longer available.';
    await run.save();
    return;
  }

  const chunks = chunkText(doc.extractedText);
  const collected = [];
  let failures = 0;

  for (let i = 0; i < chunks.length; i++) {
    try {
      const cards = await generate(chunks[i]);
      collected.push(...cards.map((c) => ({ ...c, sourceChunk: i })));
    } catch (err) {
      failures += 1;
      logger.warn({ err, runId, chunk: i, of: chunks.length }, 'chunk generation failed');
    }
  }

  run.cards = dedupe(collected);
  if (run.cards.length === 0) {
    run.status = 'failed';
    run.error = failures === chunks.length ? 'AI generation failed for every section.' : 'No usable cards were generated.';
  } else if (failures > 0) {
    run.status = 'partial';
    run.error = `${failures} of ${chunks.length} sections failed; saved what succeeded.`;
  } else {
    run.status = 'completed';
  }
  await run.save();
  logger.info({ runId, cards: run.cards.length, status: run.status }, 'generation run finished');
}
