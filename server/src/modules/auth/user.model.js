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
    // phone number for the recurring-payment authorisation. Also editable in
    // the profile page.
    phone: { type: String, trim: true, maxlength: 20 },
    bio: { type: String, trim: true, maxlength: 280 },

    // `admin` can open /admin and manage other accounts. Never settable from
    // the client: only the ADMIN_EMAILS allowlist or `npm run make-admin`.
    role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },

    // New signups prove their address with an emailed code. Accounts created
    // before OTP signup existed have no value and must keep signing in.
    emailVerifiedAt: { type: Date },
    lastLoginAt: { type: Date },
    passwordChangedAt: { type: Date },

    // Suspension keeps the row (and its history) but blocks every API call.
    suspendedAt: { type: Date },
    suspendedReason: { type: String, trim: true, maxlength: 200 },

    // Avatar bytes live in Mongo like the PDFs do; only the version timestamp
    // goes out in JSON so the client can cache-bust the image URL.
    avatar: {
      // Never loaded unless a route explicitly asks for it: a default query
      // must not drag up to 2 MB of image bytes on every authenticated request.
      // Routes that serve the image use `.select('+avatar.data +avatar.contentType')`.
      data: { type: Buffer, select: false },
      contentType: { type: String, select: false },
    },
    avatarUpdatedAt: { type: Date },

    // TOTP secret + recovery code hashes never leave the server.
    twoFactor: {
      enabled: { type: Boolean, default: false },
      // Cryptographic material stays out of normal reads; routes that verify a
      // code opt in with `.select('+twoFactor.secret ...')`.
      secret: { type: String, select: false },
      pendingSecret: { type: String, select: false },
      recoveryCodes: { type: [String], default: [], select: false },
      enabledAt: { type: Date },
    },
    twoFactorEnabled: { type: Boolean, default: false, index: true },
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
    // Binary/profile-private fields never go over the wire; the avatar is
    // served as an image and the 2FA secret only during setup.
    delete ret.avatar;
    delete ret.twoFactor;
    ret.hasAvatar = Boolean(ret.avatarUpdatedAt);
    return ret;
  },
});

export const User = model('User', userSchema);
