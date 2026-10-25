import { Router } from 'express';
import {
  startGeneration,
  requireRun,
  saveRunToDeck,
  saveToDeckSchema,
  appendRunToDeck,
  appendToDeckSchema,
} from './generation.service.js';
import { parseBody } from '../../platform/validation.js';
import { wrap } from '../../platform/errors.js';

export const generationRouter = Router();

generationRouter.post(
  '/documents/:id/generate',
  wrap(async (req, res) => {
    const run = await startGeneration(req.userId, req.params.id);
    res.status(202).json({ runId: run.id, status: run.status });
  }),
);

generationRouter.get(
  '/generation-runs/:id',
  wrap(async (req, res) => {
    const run = await requireRun(req.userId, req.params.id);
    res.json({ run });
  }),
);

generationRouter.post(
  '/decks/from-run',
  wrap(async (req, res) => {
    const body = parseBody(saveToDeckSchema, req.body);
    const result = await saveRunToDeck(req.userId, body);
    res.status(201).json(result);
  }),
);

generationRouter.post(
  '/decks/:id/cards/from-run',
  wrap(async (req, res) => {
    const body = parseBody(appendToDeckSchema, req.body);
    const result = await appendRunToDeck(req.userId, req.params.id, body);
    res.status(201).json(result);
  }),
);
