// SM-2 spaced repetition — pure domain logic, no imports (PLAN.md §4.1).
//
// Ratings follow SuperMemo-2's 0–5 quality scale; the UI exposes three
// buttons (Again / Hard / Easy) that map onto 1 / 3 / 5.

export const RATING = { AGAIN: 1, HARD: 3, EASY: 5 };

const MIN_EASE = 1.3;
const DAY_MS = 24 * 60 * 60 * 1000;

export function initialSchedulingState(now = new Date()) {
  return {
    state: 'new',
    ease: 2.5,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    dueAt: now, // new cards are due immediately
    lastReviewAt: null,
  };
}

// schedule(state, quality, now) → next state. Never mutates its input.
export function schedule(state, quality, now = new Date()) {
  if (quality < 0 || quality > 5 || !Number.isInteger(quality)) {
    throw new RangeError(`quality must be an integer 0–5, got ${quality}`);
  }

  const easeDelta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  const ease = Math.max(MIN_EASE, state.ease + easeDelta);

  if (quality < 3) {
    // Lapse: forget the interval and come back due immediately — the card
    // rejoins the same queue so the user can retry it in this session.
    return {
      ...state,
      state: 'learning',
      ease,
      intervalDays: 0,
      reps: 0,
      lapses: state.lapses + 1,
      dueAt: now,
      lastReviewAt: now,
    };
  }

  const reps = state.reps + 1;
  let intervalDays;
  if (state.reps === 0) intervalDays = 1;
  else if (state.reps === 1) intervalDays = 6;
  else intervalDays = Math.round(state.intervalDays * state.ease);

  return {
    ...state,
    state: 'review',
    ease,
    intervalDays,
    reps,
    dueAt: new Date(now.getTime() + intervalDays * DAY_MS),
    lastReviewAt: now,
  };
}
