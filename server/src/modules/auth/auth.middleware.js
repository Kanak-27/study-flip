import { unauthorized, forbidden } from '../../platform/errors.js';

// Attach in front of any route that needs a signed-in user. Everything after
// this point may assume req.userId is set.
export function requireAuth(req, _res, next) {
  if (!req.session?.userId) return next(unauthorized());
  req.userId = req.session.userId;
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
