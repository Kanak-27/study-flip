import { config } from './platform/config.js';
import { logger } from './platform/logger.js';
import { connectDb, disconnectDb } from './platform/db.js';
import { refreshSettings } from './platform/settings.js';
import { createApp, createSessionStore } from './app.js';

async function main() {
  await connectDb();
  // Load admin-editable settings before the first request so plans, signup
  // gating and the announcement match the database from the start.
  await refreshSettings();
  const app = createApp({ sessionStore: createSessionStore() });

  const server = app.listen(config.PORT, () => {
    logger.info(`API listening on http://localhost:${config.PORT}`);
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    // don't hang forever on a stuck connection
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error(err, 'failed to start');
  process.exit(1);
});
