import { model, Schema } from 'mongoose';

// Runtime-editable product settings. The admin panel writes here; the cached
// snapshot keeps hot paths (plan checks, signup gating) synchronous instead of
// adding a settings query to every request.
//
// Only things that are safe to change without a deploy live here. Prices and
// payment credentials stay in env because they are tied to a provider-side
// plan and an audit trail.

export const DEFAULT_SETTINGS = {
  generationsPerMonth: { free: 5, premium: 200 },
  signupsEnabled: true,
  generationEnabled: true,
  announcement: '',
};

const settingsSchema = new Schema(
  {
    key: { type: String, unique: true, default: 'global' },
    generationsPerMonth: {
      free: { type: Number, default: DEFAULT_SETTINGS.generationsPerMonth.free, min: 0, max: 100000 },
      premium: { type: Number, default: DEFAULT_SETTINGS.generationsPerMonth.premium, min: 0, max: 100000 },
    },
    signupsEnabled: { type: Boolean, default: true },
    generationEnabled: { type: Boolean, default: true },
    announcement: { type: String, trim: true, maxlength: 280, default: '' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const Settings = model('Settings', settingsSchema);

let cache = { ...DEFAULT_SETTINGS };
let loaded = false;

function shape(doc) {
  if (!doc) return { ...DEFAULT_SETTINGS };
  return {
    generationsPerMonth: {
      free: doc.generationsPerMonth?.free ?? DEFAULT_SETTINGS.generationsPerMonth.free,
      premium: doc.generationsPerMonth?.premium ?? DEFAULT_SETTINGS.generationsPerMonth.premium,
    },
    signupsEnabled: doc.signupsEnabled ?? DEFAULT_SETTINGS.signupsEnabled,
    generationEnabled: doc.generationEnabled ?? DEFAULT_SETTINGS.generationEnabled,
    announcement: doc.announcement ?? DEFAULT_SETTINGS.announcement,
  };
}

// Synchronous read for hot paths.
export function getSettings() {
  return cache;
}

// Called at boot (and by tests) so the cache matches the database.
export async function refreshSettings() {
  const doc = await Settings.findOne({ key: 'global' }).lean();
  cache = shape(doc);
  loaded = true;
  return cache;
}

export function settingsLoaded() {
  return loaded;
}

// Partial update from the admin panel; returns the new snapshot.
export async function updateSettings(patch, updatedBy) {
  const next = {
    'generationsPerMonth.free':
      patch.generationsPerMonth?.free ?? cache.generationsPerMonth.free,
    'generationsPerMonth.premium':
      patch.generationsPerMonth?.premium ?? cache.generationsPerMonth.premium,
    signupsEnabled: patch.signupsEnabled ?? cache.signupsEnabled,
    generationEnabled: patch.generationEnabled ?? cache.generationEnabled,
    announcement: patch.announcement ?? cache.announcement,
    updatedBy,
  };

  const doc = await Settings.findOneAndUpdate(
    { key: 'global' },
    { $set: next },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  cache = shape(doc);
  loaded = true;
  return cache;
}
