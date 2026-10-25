import { Router } from 'express';
import {
  createDeckSchema,
  updateDeckSchema,
  cardSchema,
  listDecks,
  requireDeck,
  createDeck,
  updateDeck,
  softDeleteDeck,
  listCards,
  requireCard,
  createCard,
  updateCard,
  softDeleteCard,
} from './decks.service.js';
import { parseBody } from '../../platform/validation.js';
import { wrap } from '../../platform/errors.js';

export const decksRouter = Router();

decksRouter
  .route('/decks')
  .get(
    wrap(async (req, res) => {
      res.json({ decks: await listDecks(req.userId) });
    }),
  )
  .post(
    wrap(async (req, res) => {
      const data = parseBody(createDeckSchema, req.body);
      const deck = await createDeck(req.userId, data);
      res.status(201).json({ deck });
    }),
  );

decksRouter
  .route('/decks/:id')
  .get(
    wrap(async (req, res) => {
      const deck = await requireDeck(req.userId, req.params.id);
      res.json({ deck });
    }),
  )
  .patch(
    wrap(async (req, res) => {
      const deck = await requireDeck(req.userId, req.params.id);
      const patch = parseBody(updateDeckSchema, req.body);
      res.json({ deck: await updateDeck(deck, patch) });
    }),
  )
  .delete(
    wrap(async (req, res) => {
      const deck = await requireDeck(req.userId, req.params.id);
      await softDeleteDeck(deck);
      res.json({ ok: true });
    }),
  );

decksRouter
  .route('/decks/:id/cards')
  .get(
    wrap(async (req, res) => {
      await requireDeck(req.userId, req.params.id);
      res.json({ cards: await listCards(req.userId, req.params.id) });
    }),
  )
  .post(
    wrap(async (req, res) => {
      const deck = await requireDeck(req.userId, req.params.id);
      const data = parseBody(cardSchema, req.body);
      const card = await createCard(req.userId, deck._id, data);
      res.status(201).json({ card });
    }),
  );

decksRouter
  .route('/cards/:id')
  .patch(
    wrap(async (req, res) => {
      const card = await requireCard(req.userId, req.params.id);
      const patch = parseBody(cardSchema.partial(), req.body);
      res.json({ card: await updateCard(card, patch) });
    }),
  )
  .delete(
    wrap(async (req, res) => {
      const card = await requireCard(req.userId, req.params.id);
      await softDeleteCard(card);
      res.json({ ok: true });
    }),
  );
