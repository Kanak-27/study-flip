import { randomBytes } from 'node:crypto';

// Mongo-backed job queue (see PLAN.md §4.3). The claim is a single atomic
// findOneAndUpdate, so two workers can never grab the same job.

import { Schema, model } from 'mongoose';

const jobSchema = new Schema(
  {
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued' },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    nextRunAt: { type: Date, default: () => new Date() },
    heartbeatAt: { type: Date },
    lastError: { type: String },
  },
  { timestamps: true },
);

jobSchema.index({ status: 1, nextRunAt: 1 });

export const Job = model('Job', jobSchema);

// A claimed job is invisible to other workers until this window passes without
// a heartbeat, at which point it's considered dead and gets reclaimed.
const VISIBILITY_TIMEOUT_MS = 5 * 60 * 1000;

export async function enqueue(type, payload, { maxAttempts = 3 } = {}) {
  return Job.create({ type, payload, maxAttempts });
}

export async function claimNext() {
  const now = new Date();
  return Job.findOneAndUpdate(
    {
      status: 'queued',
      nextRunAt: { $lte: now },
    },
    {
      $set: { status: 'running', heartbeatAt: now },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, new: true },
  );
}

export async function reclaimStuck() {
  const cutoff = new Date(Date.now() - VISIBILITY_TIMEOUT_MS);
  return Job.updateMany(
    { status: 'running', heartbeatAt: { $lt: cutoff } },
    { $set: { status: 'queued', nextRunAt: new Date() } },
  );
}

export async function complete(job) {
  job.status = 'completed';
  await job.save();
}

export async function fail(job, error) {
  job.lastError = String(error?.message ?? error).slice(0, 1000);
  if (job.attempts >= job.maxAttempts) {
    job.status = 'failed';
  } else {
    // exponential backoff: 30s, 2m, 8m…
    const delayMs = 30_000 * 4 ** (job.attempts - 1);
    job.status = 'queued';
    job.nextRunAt = new Date(Date.now() + delayMs);
  }
  await job.save();
}

export function newJobId() {
  return randomBytes(8).toString('hex');
}
