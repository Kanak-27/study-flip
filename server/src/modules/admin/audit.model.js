import { Schema, model } from 'mongoose';

// Append-only trail of everything an admin changed. Kept even after the target
// account is deleted (targetId is a plain string on purpose), because "who
// deleted this user and when" is exactly what an audit log is for.
const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    actorEmail: { type: String, lowercase: true, trim: true },
    action: { type: String, required: true, index: true },
    targetType: { type: String },
    targetId: { type: String, index: true },
    detail: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

auditLogSchema.index({ createdAt: -1 });

auditLogSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const AuditLog = model('AuditLog', auditLogSchema);
