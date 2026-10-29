import { User } from './user.model.js';
import { unauthorized, forbidden } from '../../platform/errors.js';

// Attach in front of any route that needs a signed-in user. Everything after
// this point may assume req.userId and req.user are set.
//
// The extra lookup is deliberate: a suspension must take effect immediately,
// not on the user's next sign-in. Selecting only the guard fields keeps it a
// tiny indexed read (and never drags avatar bytes or 2FA secrets along).
export async function requireAuth(req, _res, next) {
  const userId = req.session?.userId;
  if (!userId) return next(unauthorized());

  try {
    const user = await User.findById(userId).select('role suspendedAt email name');
    if (!user) {
      // The session outlived the account (e.g. deleted by an admin).
      req.session.destroy(() => {});
      return next(unauthorized());
    }
    if (user.suspendedAt) {
      return next(
        forbidden('This account is suspended. Contact support if you think this is a mistake.'),
      );
    }
    req.userId = String(user._id);
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Mount after requireAuth. Admin is a database role promoted by ADMIN_EMAILS
// or the make-admin script; it is never settable by the user themselves.
export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') {
    return next(forbidden('You do not have access to the admin area.'));
  }
  next();
}

// Ownership guard for resource routes: fetches the resource scoped by userId
// so another user's row is simply "not found" — existence isn't leaked.
export function ownedByUser(findById) {
  return async (req, _res, next) => {
    const doc = await findById(req.params.id, req.userId);
    if (!doc) return next(forbidden());
    req.doc = doc;
    next();
  };
}
