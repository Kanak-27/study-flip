import { Router } from 'express';
import multer from 'multer';
import { createDocument, requireDocument, MAX_UPLOAD_BYTES } from './documents.service.js';
import { wrap, badRequest } from '../../platform/errors.js';
import { oid } from '../../platform/oid.js';

export const documentsRouter = Router();

// Memory storage: files are small (10 MB cap) and the worker reads buffers
// straight from Mongo, so nothing touches disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (file.mimetype !== 'application/pdf') {
      cb(badRequest('Only PDF files are supported.'));
      return;
    }
    cb(null, true);
  },
});

documentsRouter.post(
  '/documents',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) throw badRequest('Attach a PDF in the "file" field.');
    const doc = await createDocument(req.userId, {
      filename: req.file.originalname,
      size: req.file.size,
      buffer: req.file.buffer,
    });
    res.status(201).json({ document: doc });
  }),
);

documentsRouter.get(
  '/documents',
  wrap(async (req, res) => {
    const { Document } = await import('./document.model.js');
    const { GenerationRun } = await import('../generation/generation.service.js');
    const documents = await Document.find({ userId: req.userId }).sort({ createdAt: -1 });

    // Attach the most recent generation run to each document so the UI can
    // offer "View" for a doc that's already been turned into cards, instead
    // of always starting over. One grouped query, newest run per document.
    const runs = await GenerationRun.aggregate([
      { $match: { userId: oid(req.userId) } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$documentId', runId: { $first: '$_id' }, status: { $first: '$status' }, cardCount: { $first: { $size: '$cards' } } } },
    ]);
    const runByDoc = new Map(runs.map((r) => [r._id.toString(), r]));

    res.json({
      documents: documents.map((d) => {
        const j = d.toJSON();
        const run = runByDoc.get(d.id);
        j.lastRun = run ? { runId: run.runId.toString(), status: run.status, cardCount: run.cardCount } : null;
        return j;
      }),
    });
  }),
);

documentsRouter.get(
  '/documents/:id',
  wrap(async (req, res) => {
    const doc = await requireDocument(req.userId, req.params.id);
    // full text is dropped by toJSON; send a preview + length instead
    res.json({
      document: {
        ...doc.toJSON(),
        textPreview: (doc.extractedText ?? '').slice(0, 500),
        textLength: doc.extractedText?.length ?? 0,
      },
    });
  }),
);

documentsRouter.delete(
  '/documents/:id',
  wrap(async (req, res) => {
    const doc = await requireDocument(req.userId, req.params.id);
    await doc.deleteOne();
    res.json({ ok: true });
  }),
);
