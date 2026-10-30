import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, registerAgent } from './helpers.js';
import { Deck } from '../src/modules/decks/deck.model.js';
import { oid } from '../src/platform/oid.js';

let ctx;
let alice; // agent

beforeAll(async () => {
  ctx = await setupTestApp();
  ({ agent: alice } = await registerAgent(ctx, 100));
});

afterAll(async () => {
  await ctx.teardown();
});

describe('decks & flashcards', () => {
  let deckId;
  let cardId;

  it('creates a deck', async () => {
    const res = await alice.post('/api/decks').send({ title: 'Biology 101', subject: 'Biology' });
    expect(res.status).toBe(201);
    expect(res.body.deck).toMatchObject({ title: 'Biology 101', subject: 'Biology' });
    deckId = res.body.deck.id;
  });

  it('rejects an empty title', async () => {
    const res = await alice.post('/api/decks').send({ title: '  ' });
    expect(res.status).toBe(400);
  });

  it('lists decks with card counts', async () => {
    const res = await alice.get('/api/decks');
    expect(res.status).toBe(200);
    const deck = res.body.decks.find((d) => d.id === deckId);
    expect(deck.cardCount).toBe(0);
  });

  it('adds cards to the deck', async () => {
    const res = await alice.post(`/api/decks/${deckId}/cards`).send({
      question: 'What is the powerhouse of the cell?',
      answer: 'The mitochondria.',
    });
    expect(res.status).toBe(201);
    cardId = res.body.card.id;

    const list = await alice.get(`/api/decks/${deckId}/cards`);
    expect(list.body.cards).toHaveLength(1);
  });

  it('edits a card without touching scheduling', async () => {
    const res = await alice.patch(`/api/cards/${cardId}`).send({ answer: 'The mitochondria — it makes ATP.' });
    expect(res.status).toBe(200);
    expect(res.body.card.answer).toContain('ATP');
    expect(res.body.card.question).toContain('powerhouse');
  });

  it('renames a deck', async () => {
    const res = await alice.patch(`/api/decks/${deckId}`).send({ title: 'Biology — Unit 1' });
    expect(res.body.deck.title).toBe('Biology — Unit 1');
  });
});

describe('study & spaced repetition', () => {
  let deckId;
  let cardId;

  beforeAll(async () => {
    const deck = await alice.post('/api/decks').send({ title: 'Chemistry' });
    deckId = deck.body.deck.id;
    const card = await alice.post(`/api/decks/${deckId}/cards`).send({ question: 'H2O?', answer: 'Water' });
    cardId = card.body.card.id;
  });

  it('new cards appear in a deck-mode session', async () => {
    const res = await alice.post('/api/study/sessions').send({ mode: 'deck', deckIds: [deckId] });
    expect(res.status).toBe(200);
    expect(res.body.cards.some((c) => c.id === cardId)).toBe(true);
    // answers are present for the study UI to reveal — the client hides them
    expect(res.body.cards[0]).toHaveProperty('answer');
  });

  it('deck-mode session without deckIds is a 400', async () => {
    const res = await alice.post('/api/study/sessions').send({ mode: 'deck' });
    expect(res.status).toBe(400);
  });

  it('records a review and schedules the next one tomorrow', async () => {
    const res = await alice.post('/api/reviews').send({ flashcardId: cardId, rating: 3 });
    expect(res.status).toBe(201);
    expect(res.body.scheduling.state).toBe('review');
    expect(res.body.scheduling.intervalDays).toBe(1);

    const due = new Date(res.body.scheduling.dueAt).getTime();
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
    expect(Math.abs(due - tomorrow)).toBeLessThan(5000);
  });

  it('a reviewed card leaves the due queue until its date', async () => {
    const res = await alice.get('/api/study/due');
    expect(res.status).toBe(200);
    expect(res.body.byDeck.find((d) => d.deckId === deckId)).toBeUndefined();
  });

  it('a failed card comes back due almost immediately', async () => {
    const deck = await alice.post('/api/decks').send({ title: 'Physics' });
    const card = await alice.post(`/api/decks/${deck.body.deck.id}/cards`).send({ question: 'F=ma?', answer: "Newton's second law" });

    const res = await alice.post('/api/reviews').send({ flashcardId: card.body.card.id, rating: 1 });
    expect(res.body.scheduling.state).toBe('learning');
    expect(res.body.scheduling.lapses).toBe(1);

    const due = await alice.get('/api/study/due');
    expect(due.body.byDeck.find((d) => d.deckId === deck.body.deck.id)?.due).toBe(1);
  });

  it('rejects an unknown rating', async () => {
    const res = await alice.post('/api/reviews').send({ flashcardId: cardId, rating: 4 });
    expect(res.status).toBe(400);
  });

  it('revising the latest review recomputes the schedule from the pre-review state', async () => {
    const deck = await alice.post('/api/decks').send({ title: 'Revisions' });
    const card = await alice.post(`/api/decks/${deck.body.deck.id}/cards`).send({ question: 'NaCl?', answer: 'Table salt' });
    const id = card.body.card.id;

    // grade it Easy first…
    const first = await alice.post('/api/reviews').send({ flashcardId: id, rating: 5 });
    expect(first.status).toBe(201);
    expect(first.body.reviewLogId).toBeTruthy();
    expect(first.body.scheduling.state).toBe('review');

    // …then change it to Again: schedule is rebuilt from the snapshot, not
    // layered on top of the Easy grade.
    const rev1 = await alice.post(`/api/reviews/${first.body.reviewLogId}/revise`).send({ rating: 1 });
    expect(rev1.status).toBe(200);
    expect(rev1.body.scheduling.state).toBe('learning');
    expect(rev1.body.scheduling.lapses).toBe(1);
    expect(rev1.body.scheduling.intervalDays).toBe(0);
    expect(Math.abs(new Date(rev1.body.scheduling.dueAt).getTime() - Date.now())).toBeLessThan(5000);

    // the same review can still be revised (it's the latest), and the lapse
    // doesn't accumulate — each revision recomputes from the same snapshot
    const rev2 = await alice.post(`/api/reviews/${first.body.reviewLogId}/revise`).send({ rating: 3 });
    expect(rev2.body.scheduling.state).toBe('review');
    expect(rev2.body.scheduling.lapses).toBe(0);
    expect(rev2.body.scheduling.intervalDays).toBe(1);
    expect(rev2.body.scheduling.ease).toBeCloseTo(2.36, 5);

    // the revision keeps the original review's point in time: a passing
    // regrade schedules from `reviewedAt` (tomorrow), so the card is *not*
    // due — verify against the schedule the API itself returned.
    const due = await alice.get('/api/study/due');
    const dueCount = due.body.byDeck.find((d) => d.deckId === deck.body.deck.id)?.due ?? 0;
    const daysOut = (new Date(rev2.body.scheduling.dueAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(dueCount).toBe(daysOut <= 0 ? 1 : 0);
    expect(daysOut).toBeGreaterThan(0);
  });

  it('a review with a newer one on the same card can no longer be revised', async () => {
    const deck = await alice.post('/api/decks').send({ title: 'Too late' });
    const card = await alice.post(`/api/decks/${deck.body.deck.id}/cards`).send({ question: 'Au?', answer: 'Gold' });
    const id = card.body.card.id;

    const first = await alice.post('/api/reviews').send({ flashcardId: id, rating: 5 });
    await alice.post('/api/reviews').send({ flashcardId: id, rating: 5 }); // second review supersedes

    const res = await alice.post(`/api/reviews/${first.body.reviewLogId}/revise`).send({ rating: 1 });
    expect(res.status).toBe(400);
  });

  it('another user cannot revise someone else’s review', async () => {
    const { agent: bob } = await registerAgent(ctx, 104);
    const deck = await alice.post('/api/decks').send({ title: 'Private review' });
    const card = await alice.post(`/api/decks/${deck.body.deck.id}/cards`).send({ question: 'Fe?', answer: 'Iron' });
    const review = await alice.post('/api/reviews').send({ flashcardId: card.body.card.id, rating: 5 });

    const res = await bob.post(`/api/reviews/${review.body.reviewLogId}/revise`).send({ rating: 1 });
    expect(res.status).toBe(404);
  });

  it('revise rejects an unknown rating and an unknown review', async () => {
    const deck = await alice.post('/api/decks').send({ title: 'Bad revises' });
    const card = await alice.post(`/api/decks/${deck.body.deck.id}/cards`).send({ question: 'Cu?', answer: 'Copper' });
    const review = await alice.post('/api/reviews').send({ flashcardId: card.body.card.id, rating: 5 });

    expect((await alice.post(`/api/reviews/${review.body.reviewLogId}/revise`).send({ rating: 4 })).status).toBe(400);
    expect((await alice.post('/api/reviews/000000000000000000000000/revise').send({ rating: 1 })).status).toBe(404);
  });

  it('another user cannot review someone else’s card', async () => {
    const { agent: bob } = await registerAgent(ctx, 101);
    const res = await bob.post('/api/reviews').send({ flashcardId: cardId, rating: 3 });
    expect(res.status).toBe(404);
  });
});

describe('ownership scoping', () => {
  it("bob cannot read, edit, or delete alice's deck or cards", async () => {
    const { agent: bob } = await registerAgent(ctx, 102);
    const aliceDeck = await alice.post('/api/decks').send({ title: 'Private deck' });
    const aliceCard = await alice.post(`/api/decks/${aliceDeck.body.deck.id}/cards`).send({ question: 'q', answer: 'a' });
    const deckId = aliceDeck.body.deck.id;
    const cardId = aliceCard.body.card.id;

    // 404 on reads, consistent with "existence isn't leaked" (PLAN.md §6)
    expect((await bob.get(`/api/decks/${deckId}`)).status).toBe(404);
    expect((await bob.get(`/api/decks/${deckId}/cards`)).status).toBe(404);
    expect((await bob.patch(`/api/decks/${deckId}`).send({ title: 'hacked' })).status).toBe(404);
    expect((await bob.delete(`/api/decks/${deckId}`)).status).toBe(404);
    expect((await bob.patch(`/api/cards/${cardId}`).send({ answer: 'x' })).status).toBe(404);
    expect((await bob.delete(`/api/cards/${cardId}`)).status).toBe(404);

    // deck is untouched
    const check = await alice.get(`/api/decks/${deckId}`);
    expect(check.body.deck.title).toBe('Private deck');
  });

  it("bob's deck list doesn't include alice's decks", async () => {
    const { agent: bob } = await registerAgent(ctx, 103);
    const res = await bob.get('/api/decks');
    expect(res.body.decks).toHaveLength(0);
  });
  it('deleting a deck hides its cards too', async () => {
    const deck = await alice.post('/api/decks').send({ title: 'Doomed' });
    await alice.post(`/api/decks/${deck.body.deck.id}/cards`).send({ question: 'q', answer: 'a' });
    await alice.delete(`/api/decks/${deck.body.deck.id}`);

    const decks = await alice.get('/api/decks');
    expect(decks.body.decks.find((d) => d.id === deck.body.deck.id)).toBeUndefined();
  });
});

describe('quick revision', () => {
  it('draws up to 10 cards from decks made in the past week', async () => {
    const res = await alice.post('/api/study/sessions').send({ mode: 'quick' });
    expect(res.status).toBe(200);
    expect(res.body.cards.length).toBeGreaterThan(0);
    expect(res.body.cards.length).toBeLessThanOrEqual(10);
    // usable by the study UI straight away
    expect(res.body.cards[0]).toHaveProperty('question');
    expect(res.body.cards[0]).toHaveProperty('answer');
    expect(res.body.cards[0]).toHaveProperty('id');
  });

  it('never picks cards from decks older than a week', async () => {
    const stale = await alice.post('/api/decks').send({ title: 'Last month' });
    const staleCard = await alice
      .post(`/api/decks/${stale.body.deck.id}/cards`)
      .send({ question: 'Ancient?', answer: 'From an old deck' });
    // backdate the deck past the window (bypass mongoose timestamps; the id
    // must be an ObjectId or the filter matches nothing)
    await Deck.collection.updateOne(
      { _id: oid(stale.body.deck.id) },
      { $set: { createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) } },
    );

    const res = await alice.post('/api/study/sessions').send({ mode: 'quick' });
    expect(res.status).toBe(200);
    expect(res.body.cards.some((c) => c.id === staleCard.body.card.id)).toBe(false);
  });

  it('returns an empty queue for a student with no recent decks', async () => {
    const { agent: newcomer } = await registerAgent(ctx, 105);
    const res = await newcomer.post('/api/study/sessions').send({ mode: 'quick' });
    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(0);
    expect(res.body.session.mode).toBe('quick');
  });
});

describe('dashboard feed', () => {
  it('shows the three most recent decks with counts and a today flag', async () => {
    const res = await alice.get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.recentDecks.length).toBeGreaterThan(0);
    expect(res.body.recentDecks.length).toBeLessThanOrEqual(3);

    // newest first, newest one was made during this run (i.e. today)
    const times = res.body.recentDecks.map((d) => new Date(d.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(res.body.recentDecks[0].createdToday).toBe(true);
    // hand-made decks have no source document; PDF ones would name the file
    expect(res.body.recentDecks[0]).toHaveProperty('documentFilename');
    expect(typeof res.body.recentDecks[0].cardCount).toBe('number');
  });

  it('ranks this week\u2019s effort against other active students, without leaking who', async () => {
    // bob studies too, once — so there are two active students to compare
    const { agent: bob } = await registerAgent(ctx, 106);
    const deck = await bob.post('/api/decks').send({ title: 'Bob deck' });
    const card = await bob.post(`/api/decks/${deck.body.deck.id}/cards`).send({ question: 'q', answer: 'a' });
    await bob.post('/api/reviews').send({ flashcardId: card.body.card.id, rating: 5 });

    const aliceDash = await alice.get('/api/dashboard');
    expect(aliceDash.body.peer.studentsActive).toBe(2);
    expect(aliceDash.body.peer.rank).toBe(1);
    expect(aliceDash.body.peer.percentile).toBe(100); // beat everyone else
    expect(aliceDash.body.peer.reviewsThisWeek).toBeGreaterThan(1);

    const bobDash = await bob.get('/api/dashboard');
    expect(bobDash.body.peer.rank).toBe(2);
    expect(bobDash.body.peer.percentile).toBe(0);
    expect(bobDash.body.peer.reviewsThisWeek).toBe(1);
    // counts only — no names, no ids of other students
    expect(JSON.stringify(bobDash.body.peer)).not.toMatch(/@|alice|user100/i);
  });

  it('tells a student with no reviews this week that the board is waiting', async () => {
    const { agent: idle } = await registerAgent(ctx, 107);
    const res = await idle.get('/api/dashboard');
    expect(res.body.peer.reviewsThisWeek).toBe(0);
    expect(res.body.peer.rank).toBeNull();
    expect(res.body.peer.percentile).toBeNull();
    expect(res.body.peer.studentsActive).toBeGreaterThanOrEqual(2);
  });
});

// The upload/decks UI shows a 30-second "Undo" section wherever something
// was deleted; these cover the restore endpoints behind it.
describe('undo deletion (restore)', () => {
  it('restores a deleted deck with its cards, but not cards deleted earlier', async () => {
    const deck = await alice.post('/api/decks').send({ title: 'Undoable deck' });
    const deckId = deck.body.deck.id;
    const kept = await alice.post(`/api/decks/${deckId}/cards`).send({ question: 'q1', answer: 'a1' });
    const removedFirst = await alice.post(`/api/decks/${deckId}/cards`).send({ question: 'q2', answer: 'a2' });

    await alice.delete(`/api/cards/${removedFirst.body.card.id}`);
    // the deck's own deletion must land strictly later, or this card would be
    // swept back in with it
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect((await alice.delete(`/api/decks/${deckId}`)).status).toBe(200);

    // hidden everywhere while the undo section is showing
    expect((await alice.get(`/api/decks/${deckId}`)).status).toBe(404);
    expect((await alice.get('/api/decks')).body.decks.find((d) => d.id === deckId)).toBeUndefined();

    expect((await alice.post(`/api/decks/${deckId}/restore`)).status).toBe(200);

    expect((await alice.get(`/api/decks/${deckId}`)).status).toBe(200);
    const cardIds = (await alice.get(`/api/decks/${deckId}/cards`)).body.cards.map((c) => c.id);
    expect(cardIds).toContain(kept.body.card.id);
    expect(cardIds).not.toContain(removedFirst.body.card.id);
  });

  it('restores an individually deleted card', async () => {
    const deck = await alice.post('/api/decks').send({ title: 'Card undo' });
    const deckId = deck.body.deck.id;
    const card = await alice.post(`/api/decks/${deckId}/cards`).send({ question: 'q', answer: 'a' });
    await alice.delete(`/api/cards/${card.body.card.id}`);
    expect((await alice.get(`/api/decks/${deckId}/cards`)).body.cards).toHaveLength(0);

    expect((await alice.post(`/api/cards/${card.body.card.id}/restore`)).status).toBe(200);
    const cardIds = (await alice.get(`/api/decks/${deckId}/cards`)).body.cards.map((c) => c.id);
    expect(cardIds).toContain(card.body.card.id);
  });

  it('refuses to restore a live row, a card in a deleted deck, or someone else\u2019s', async () => {
    const { agent: mallory } = await registerAgent(ctx, 108);

    // a deck that is still there has nothing to restore
    const live = await alice.post('/api/decks').send({ title: 'Still here' });
    expect((await alice.post(`/api/decks/${live.body.deck.id}/restore`)).status).toBe(404);

    // a card cannot come back into a deck that is itself deleted
    const doomed = await alice.post('/api/decks').send({ title: 'Doomed' });
    const card = await alice.post(`/api/decks/${doomed.body.deck.id}/cards`).send({ question: 'q', answer: 'a' });
    await alice.delete(`/api/decks/${doomed.body.deck.id}`);
    expect((await alice.post(`/api/cards/${card.body.card.id}/restore`)).status).toBe(404);

    // ownership scoping: restore 404s across users, like every other endpoint
    expect((await mallory.post(`/api/decks/${live.body.deck.id}/restore`)).status).toBe(404);
    expect((await mallory.post(`/api/cards/${card.body.card.id}/restore`)).status).toBe(404);
  });
});
