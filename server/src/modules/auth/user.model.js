import { Schema, model } from 'mongoose';

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'invalid email'],
    },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // Optional: collected on first checkout because Cashfree mandates need a
    // phone number for the recurring-payment authorisation.
    phone: { type: String, trim: true },
  },
  { timestamps: true },
);

// Public JSON shape: expose `id`, hide Mongo internals and the hash.
// Services that need to verify a password must explicitly `.select('+passwordHash')`.
userSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    return ret;
  },
});

export const User = model('User', userSchema);
