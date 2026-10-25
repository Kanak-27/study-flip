import { describe, expect, it } from 'vitest';
import { schedule, initialSchedulingState, RATING } from '../src/modules/scheduling/sm2.js';

const T0 = new Date('2026-01-01T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('SM-2 scheduling', () => {
  it('starts new cards due immediately with default ease', () => {
    const s = initialSchedulingState(T0);
    expect(s).toMatchObject({ state: 'new', ease: 2.5, intervalDays: 0, reps: 0 });
    expect(s.dueAt.getTime()).toBe(T0.getTime());
  });

  it('first pass gives 1 day, second gives 6, then multiplies by ease', () => {
    let s = initialSchedulingState(T0);

    s = schedule(s, RATING.EASY, T0);
    expect(s.intervalDays).toBe(1);
    expect(s.reps).toBe(1);

    s = schedule(s, RATING.EASY, T0);
    expect(s.intervalDays).toBe(6);
    expect(s.reps).toBe(2);

    s = schedule(s, RATING.EASY, T0);
    // ease rose +0.1 per Easy rating: 2.5 → 2.6 → 2.7; the third interval
    // uses the ease the card carried into the review (2.7): round(6 × 2.7) = 16
    expect(s.intervalDays).toBe(16);
    expect(s.dueAt.getTime()).toBe(T0.getTime() + 16 * DAY);
  });

  it('a lapse resets reps, counts the lapse, and comes back due immediately', () => {
    let s = initialSchedulingState(T0);
    s = schedule(s, RATING.HARD, T0);
    s = schedule(s, RATING.HARD, T0);
    expect(s.reps).toBe(2);

    s = schedule(s, RATING.AGAIN, T0);
    expect(s.reps).toBe(0);
    expect(s.lapses).toBe(1);
    expect(s.state).toBe('learning');
    expect(s.dueAt.getTime()).toBe(T0.getTime());

    // recovery: first pass after a lapse is 1 day again
    s = schedule(s, RATING.HARD, T0);
    expect(s.intervalDays).toBe(1);
  });

  it('ease floors at 1.3 no matter how many failures', () => {
    let s = initialSchedulingState(T0);
    for (let i = 0; i < 20; i++) {
      s = schedule(s, RATING.AGAIN, T0);
    }
    expect(s.ease).toBeGreaterThanOrEqual(1.3);
  });

  it('Easy raises ease, Hard nudges it down slightly', () => {
    let s = initialSchedulingState(T0);
    const afterEasy = schedule(s, RATING.EASY, T0);
    expect(afterEasy.ease).toBeCloseTo(2.6, 5);

    // Hard (q=3): 0.1 − 2 × (0.08 + 2 × 0.02) = −0.14
    const afterHard = schedule(s, RATING.HARD, T0);
    expect(afterHard.ease).toBeCloseTo(2.36, 5);
  });

  it('rejects out-of-range quality', () => {
    const s = initialSchedulingState(T0);
    expect(() => schedule(s, 6, T0)).toThrow(RangeError);
    expect(() => schedule(s, -1, T0)).toThrow(RangeError);
    expect(() => schedule(s, 2.5, T0)).toThrow(RangeError);
  });

  it('never mutates the input state', () => {
    const s = initialSchedulingState(T0);
    const snapshot = JSON.parse(JSON.stringify(s));
    schedule(s, RATING.EASY, T0);
    schedule(s, RATING.AGAIN, T0);
    expect(JSON.parse(JSON.stringify(s))).toEqual(snapshot);
  });
});
