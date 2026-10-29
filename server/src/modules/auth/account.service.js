import { User } from './user.model.js';
import { OtpChallenge } from './otp.service.js';
import { Document } from '../documents/document.model.js';
import { GenerationRun } from '../generation/generation.service.js';
import { Deck } from '../decks/deck.model.js';
import { Flashcard } from '../decks/flashcard.model.js';
import { ReviewLog } from '../study/reviewLog.model.js';
import { UsageEvent } from '../billing/usageEvent.model.js';
import { Subscription, findSubscriptionByUserId } from '../billing/billing.service.js';
import { billingConfigured, cancelProviderSubscription } from '../billing/cashfree.client.js';
import { sendAccountDeletedEmail } from '../../platform/mailer.js';
import { destroyUserSessions } from '../../platform/sessions.js';
import { logger } from '../../platform/logger.js';

// Removes every row owned by a user, then the user. Shared by the profile
// "delete my account" flow and the admin panel so the two can never drift —
// an admin delete that missed, say, ReviewLog would leave analytics orphans.
export async function deleteUserAccount(user, { notify = true } = {}) {
  // Stop future charges before the local record disappears. Best effort: a
  // provider hiccup must not trap the user with an undeletable account.
  try {
    const sub = await findSubscriptionByUserId(user.id);
    if (billingConfigured() && sub?.providerSubscriptionId && sub.status === 'active') {
      await cancelProviderSubscription(sub.providerSubscriptionId).catch((err) =>
        logger.warn({ err, userId: user.id }, 'provider cancellation failed during delete'),
      );
    }
  } catch (err) {
    logger.warn({ err, userId: user.id }, 'billing cleanup failed during delete');
  }

  await Promise.all([
    Document.deleteMany({ userId: user.id }),
    GenerationRun.deleteMany({ userId: user.id }),
    Deck.deleteMany({ userId: user.id }),
    Flashcard.deleteMany({ userId: user.id }),
    ReviewLog.deleteMany({ userId: user.id }),
    UsageEvent.deleteMany({ userId: user.id }),
    Subscription.deleteMany({ userId: user.id }),
    OtpChallenge.deleteMany({ email: user.email }),
  ]);

  const { email, name } = user;
  await destroyUserSessions(user.id);
  await user.deleteOne();

  if (notify) {
    sendAccountDeletedEmail({ to: email, name }).catch((err) =>
      logger.warn({ err }, 'account deleted email failed'),
    );
  }

  return { email };
}

// Returns the account row and (optionally) the password hash for a
// password-confirmed action.
export async function findAccountById(id, { withPassword = false } = {}) {
  const query = User.findById(id);
  return withPassword ? query.select('+passwordHash') : query;
}
