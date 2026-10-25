import { Schema, model } from 'mongoose';

const flashcardSchema = new Schema(
  {
    // userId is denormalized from the deck on purpose: every hot-path query
    // filters by owner, so isolation never depends on a join (PLAN.md §5).
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deckId: { type: Schema.Types.ObjectId, ref: 'Deck', required: true },
    question: { type: String, required: true, trim: true, maxlength: 2000 },
    answer: { type: String, required: true, trim: true, maxlength: 8000 },
    sourceChunk: { type: String, maxlength: 4000 },

    // Scheduling state (SM-2). Lives on the card rather than a side
    // collection: reviews always update specific fields via $set, so editing
    // a question can't disturb review history and vice versa. reviewLogs
    // remains the append-only source of truth for analytics.
    scheduling: {
      state: { type: String, enum: ['new', 'learning', 'review'], default: 'new' },
      ease: { type: Number, default: 2.5 },
      intervalDays: { type: Number, default: 0 },
      reps: { type: Number, default: 0 },
      lapses: { type: Number, default: 0 },
      dueAt: { type: Date, default: () => new Date() },
      lastReviewAt: { type: Date },
    },

    deletedAt: { type: Date },
  },
  { timestamps: true },
);

flashcardSchema.index({ userId: 1, 'scheduling.dueAt': 1 });
flashcardSchema.index({ deckId: 1, deletedAt: 1 });

flashcardSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.deletedAt;
    return ret;
  },
});

export const Flashcard = model('Flashcard', flashcardSchema);
