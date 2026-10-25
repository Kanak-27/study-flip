import { Schema, model } from 'mongoose';

// Append-only record of every review. Analytics read from here, never from
// mutable "current state", so history stays correct after rescheduling.
const reviewLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    flashcardId: { type: Schema.Types.ObjectId, ref: 'Flashcard', required: true },
    deckId: { type: Schema.Types.ObjectId, ref: 'Deck', required: true },
    rating: { type: Number, required: true, min: 0, max: 5 },
    recalled: { type: Boolean, required: true }, // pass (>=3) drives accuracy
    intervalDays: { type: Number, required: true }, // interval after this review
    // Snapshot of the card's schedule *before* this review, so the newest
    // review can be revised (the UI lets you change your grade until the next
    // card is flipped) without re-deriving the prior state. Older logs have
    // no snapshot and simply can't be revised.
    prevScheduling: {
      _id: false,
      state: { type: String },
      ease: { type: Number },
      intervalDays: { type: Number },
      reps: { type: Number },
      lapses: { type: Number },
    },
    reviewedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: false },
);

reviewLogSchema.index({ userId: 1, reviewedAt: -1 });
reviewLogSchema.index({ userId: 1, flashcardId: 1, reviewedAt: -1 });

export const ReviewLog = model('ReviewLog', reviewLogSchema);
