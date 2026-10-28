import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { config, isProd } from './platform/config.js';
import { logger } from './platform/logger.js';
import { apiNotFound, errorHandler } from './platform/errors.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { analyticsRouter } from './modules/analytics/analytics.routes.js';
import { decksRouter } from './modules/decks/decks.routes.js';
import { studyRouter } from './modules/study/study.routes.js';
import { documentsRouter } from './modules/documents/documents.routes.js';
import { generationRouter } from './modules/generation/generation.routes.js';
import { billingRouter, cashfreeWebhookRouter } from './modules/billing/billing.routes.js';
import { requireAuth } from './modules/auth/auth.middleware.js';

// Builds the Express app. Takes the session store as an argument so tests can
// run against an in-memory Mongo without touching the real config.
export function createApp({ sessionStore }) {
  const app = express();

  app.set('trust proxy', 1); // correct secure-cookie behavior behind a reverse proxy
  app.use(helmet());
  app.use(cors({ origin: config.CLIENT_ORIGIN, credentials: true }));

  // Cashfree signs the raw body, so this must be mounted BEFORE express.json().
  // It is also outside the session/auth stack: Cashfree calls it server-to-server.
  app.use('/api', cashfreeWebhookRouter);

  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: config.NODE_ENV !== 'test',
      customLogLevel(_req, res, err) {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  app.use(
    session({
      name: 'studyflip.sid',
      secret: config.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
      },
    }),
  );

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Brute-force protection on credential endpoints; generous enough for a
  // human, useless for a script. It must be mounted BEFORE the auth router:
  // a request the router has already answered never reaches middleware
  // registered after it, so the limiter used to be silently skipped.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    // reply in the app's error shape, otherwise the client falls back to a
    // generic "Something went wrong." and the user can't tell they're limited
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message: 'Too many attempts. Please wait a few minutes and try again.',
        },
      });
    },
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);

  app.use('/api/auth', authRouter);

  // everything below requires a session
  app.use('/api', requireAuth);
  app.use('/api', analyticsRouter);
  app.use('/api', decksRouter);
  app.use('/api', studyRouter);
  app.use('/api', documentsRouter);
  app.use('/api', generationRouter);
  app.use('/api', billingRouter);
  app.use('/api', apiNotFound);
  app.use(errorHandler);

  return app;
}

export function createSessionStore(mongoUrl = config.MONGO_URI) {
  return MongoStore.create({
    mongoUrl,
    ttl: 60 * 60 * 24 * 30,
    collectionName: 'sessions',
  });
}
