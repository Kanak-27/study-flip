import { AuditLog } from './audit.model.js';
import { logger } from '../../platform/logger.js';

// Records an admin action. Audit writes are best effort: losing one must not
// undo or block the action it describes, but it is loud in the logs.
export async function audit(req, action, { targetType, targetId, detail } = {}) {
  try {
    await AuditLog.create({
      actorId: req.userId,
      actorEmail: req.user?.email,
      action,
      targetType,
      targetId: targetId ? String(targetId) : undefined,
      detail,
    });
  } catch (err) {
    logger.warn({ err, action, targetId }, 'audit log write failed');
  }
}
