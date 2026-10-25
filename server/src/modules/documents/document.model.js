import { Schema, model } from 'mongoose';

const documentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    filename: { type: String, required: true, maxlength: 255 },
    sizeBytes: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'extracting', 'extracted', 'failed'],
      default: 'pending',
    },
    // Kept on the document for MVP; move to object storage when texts get big.
    fileBuffer: { type: Buffer, select: false },
    extractedText: { type: String, default: '' },
    error: { type: String },
  },
  { timestamps: true },
);

documentSchema.index({ userId: 1, createdAt: -1 });

documentSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    // the full text is large; list/detail endpoints send a preview instead
    delete ret.extractedText;
    // never ship the raw PDF bytes back out — they were only ever loaded for
    // the extraction worker
    delete ret.fileBuffer;
    return ret;
  },
});

export const Document = model('Document', documentSchema);
