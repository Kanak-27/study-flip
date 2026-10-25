import { Router } from 'express';
import {
  reviewSchema,
  reviseSchema,
  startSessionSchema,
  buildSessionCards,
  recordReview,
  reviseReview,
  dueCountsByDeck,
} from './study.service.js';
import { parseBody } from '../../platform/validation.js';
import { wrap } from '../../platform/errors.js';

export const studyRouter = Router();

studyRouter.post(
  '/study/sessions',
  wrap(async (req, res) => {
    const body = parseBody(startSessionSchema, req.body ?? {});
    const cards = await buildSessionCards(req.userId, body);
    // The client owns order and progress; the server hands out the queue.
    res.json({ session: { id: crypto.randomUUID(), mode: body.mode, total: cards.length }, cards });
  }),
);

studyRouter.get(
  '/study/due',
  wrap(async (req, res) => {
    const counts = await dueCountsByDeck(req.userId);
    const dueTotal = counts.reduce((sum, c) => sum + c.due, 0);
    res.json({
      dueTotal,
      byDeck: counts.map((c) => ({ deckId: c._id.toString(), due: c.due })),
    });
  }),
);

studyRouter.post(
  '/reviews',
  wrap(async (req, res) => {
    const body = parseBody(reviewSchema, req.body);
    const result = await recordReview(req.userId, body);
    res.status(201).json(result);
  }),
);

// "I marked that card wrong by accident" — revise the latest review while
// the client still has its change window open (before the next flip).
studyRouter.post(
  '/reviews/:id/revise',
  wrap(async (req, res) => {
    const body = parseBody(reviseSchema, req.body);
    const result = await reviseReview(req.userId, req.params.id, body.rating);
    res.json(result);
  }),
);
