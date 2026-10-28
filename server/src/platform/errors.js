import { logger } from './logger.js';

export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message) => new AppError(400, 'bad_request', message);
export const unauthorized = (message = 'You must be signed in.') =>
  new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new AppError(404, 'not_found', message);
export const conflict = (message) => new AppError(409, 'conflict', message);

// Wraps an async route handler so rejected promises reach the error middleware.
// Express 5 does this natively for handlers, but being explicit keeps us safe
// if a handler is ever passed as a stored reference rather than registered.
export const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// 404 for unmatched API routes — everything else falls through to the SPA.
export function apiNotFound(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: 'Endpoint not found.' } });
}

// Single error shape for the whole API: { error: { code, message } }.
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err?.name === 'ZodError') {
    res.status(400).json({
      error: { code: 'bad_request', message: err.issues.map((i) => i.message).join('; ') },
    });
    return;
  }
  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong.' } });
}
