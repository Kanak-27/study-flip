import { Document } from './document.model.js';
import { enqueue } from '../../platform/jobs.js';
import { badRequest, notFound } from '../../platform/errors.js';
import { logger } from '../../platform/logger.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// Uploads arrive as multipart fields: `file` (buffer) plus optional metadata.
export async function createDocument(userId, { filename, size, buffer }) {
  if (size === 0 || buffer.length === 0) throw badRequest('The uploaded file is empty.');
  if (size > MAX_UPLOAD_BYTES) throw badRequest('Files must be 10 MB or smaller.');
  // Magic-byte check: a real PDF starts with %PDF, whatever the filename says.
  if (!(buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46)) {
    throw badRequest('That file does not look like a PDF.');
  }

  // The raw buffer stays on the document for MVP — our 10 MB cap sits under
  // Mongo's 16 MB document limit. Object storage comes when sizes grow.
  const doc = await Document.create({ userId, filename, sizeBytes: size, fileBuffer: buffer });
  await enqueue('extract', { documentId: doc.id });
  return doc;
}

export async function requireDocument(userId, docId) {
  const doc = await Document.findOne({ _id: docId, userId, deletedAt: null });
  if (!doc) throw notFound('Document not found.');
  return doc;
}

// Undo target for the upload page's 30-second undo section. Only a deleted
// document can be restored; anything else 404s so the endpoint can't be used
// to poke at live rows.
export async function restoreDocument(userId, docId) {
  const doc = await Document.findOne({ _id: docId, userId, deletedAt: { $ne: null } });
  if (!doc) throw notFound('Document not found.');
  doc.deletedAt = null;
  await doc.save();
  return doc;
}

// --- job handler (run by the worker) ---

export async function handleExtract({ documentId }) {
  const doc = await Document.findById(documentId).select('+fileBuffer');
  if (!doc) return; // deleted before the worker got to it

  doc.status = 'extracting';
  await doc.save();

  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(doc.fileBuffer));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });

    const clean = (text ?? '').replace(/[ \t]+\n/g, '\n').trim();
    if (!clean) {
      // Scanned/image-only PDF lands here — see PLAN.md risk table.
      throw new Error(
        'No text could be extracted. The PDF may be scanned or image-only (OCR is not supported yet).',
      );
    }

    doc.extractedText = clean;
    doc.status = 'extracted';
    doc.error = undefined;
    logger.info({ documentId, totalPages, chars: clean.length }, 'extracted document text');
  } catch (err) {
    doc.status = 'failed';
    doc.error = err.message?.startsWith('No text') ? err.message : 'Could not read this PDF.';
    logger.warn({ err, documentId }, 'extraction failed');
  }
  await doc.save();

  // keep the document lean once the text is in
  if (doc.status === 'extracted') {
    doc.fileBuffer = undefined;
    await doc.save();
  }
}
