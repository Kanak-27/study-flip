import { config } from './platform/config.js';
import { logger } from './platform/logger.js';
import { connectDb, disconnectDb } from './platform/db.js';
import { claimNext, complete, fail, reclaimStuck } from './platform/jobs.js';
import { refreshSettings } from './platform/settings.js';
import { handleExtract } from './modules/documents/documents.service.js';
import { handleGenerate } from './modules/generation/generation.service.js';

const handlers = {
  extract: handleExtract,
  generate: handleGenerate,
};

const POLL_MS = 1500;
const RECLAIM_MS = 60_000;
let running = true;

async function runJob(job) {
  const handler = handlers[job.type];
  if (!handler) {
    job.lastError = `No handler for job type "${job.type}"`;
    job.status = 'failed';
    await job.save();
    return;
  }
  try {
    await handler(job.payload, job);
    await complete(job);
    logger.info({ jobId: job.id ?? job._id.toString(), type: job.type }, 'job completed');
  } catch (err) {
    logger.error({ err, type: job.type }, 'job failed');
    await fail(job, err);
  }
}

async function loop() {
  let lastReclaim = 0;
  while (running) {
    try {
      if (Date.now() - lastReclaim > RECLAIM_MS) {
        await reclaimStuck();
        lastReclaim = Date.now();
      }
      const job = await claimNext();
      if (job) {
        await runJob(job);
        continue; // drain the queue before sleeping
      }
    } catch (err) {
      logger.error({ err }, 'worker loop error');
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function main() {
  await connectDb();
  // Keep the shared settings cache warm in case a job handler consults it.
  await refreshSettings();
  logger.info('worker started');
  const shutdown = async () => {
    running = false;
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await loop();
}

main().catch((err) => {
  logger.error(err, 'worker failed to start');
  process.exit(1);
});
