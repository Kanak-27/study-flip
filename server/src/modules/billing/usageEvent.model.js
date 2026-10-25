import { model, Schema } from 'mongoose';

// Rows, not counters: every quota-controlled action leaves an auditable
// event, so "you used 5 of 5" is a query, not a number we hope is right.
const usageEventSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['generation', 'upload'], required: true },
  quantity: { type: Number, default: 1 },
  occurredAt: { type: Date, default: () => new Date() },
});

usageEventSchema.index({ userId: 1, type: 1, occurredAt: -1 });

export const UsageEvent = model('UsageEvent', usageEventSchema);
