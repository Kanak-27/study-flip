import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, registerAgent } from './helpers.js';
import { makeTestPdf, makeBlankPdf } from './pdf.fixture.js';

let ctx;
let alice;

beforeAll(async () => {
  ctx = await setupTestApp();
  ({ agent: alice } = await registerAgent(ctx, 200));
});

afterAll(async () => {
  await ctx.teardown();
});

function uploadPdf(agent, buffer, filename = 'notes.pdf') {
  return agent
    .post('/api/documents')
    .attach('file', buffer, { filename, contentType: 'application/pdf' });
}

describe('document upload', () => {
  it('accepts a PDF and queues extraction', async () => {
    const res = await uploadPdf(alice, makeTestPdf());
    expect(res.status).toBe(201);
    expect(res.body.document).toMatchObject({ filename: 'notes.pdf', status: 'pending' });
    expect(res.body.document.extractedText).toBeUndefined(); // never in JSON
  });

  it('rejects a non-PDF by magic bytes even with a .pdf name', async () => {
    const res = await uploadPdf(alice, Buffer.from('just some text'), 'fake.pdf');
    expect(res.status).toBe(400);
  });

  it('rejects an empty file', async () => {
    const res = await uploadPdf(alice, Buffer.alloc(0), 'empty.pdf');
    expect(res.status).toBe(400);
  });

  it("lists only the user's own documents", async () => {
    const { agent: bob } = await registerAgent(ctx, 201);
    const bobs = await bob.get('/api/documents');
    expect(bobs.body.documents).toHaveLength(0);

    const mine = await alice.get('/api/documents');
    expect(mine.body.documents.length).toBeGreaterThan(0);
  });
});

describe('extraction worker', () => {
  it('extracts real text from an uploaded PDF', async () => {
    const upload = await uploadPdf(alice, makeTestPdf('Photosynthesis converts light into chemical energy.'));
    const { handleExtract } = await import('../src/modules/documents/documents.service.js');
    await handleExtract({ documentId: upload.body.document.id });

    const res = await alice.get(`/api/documents/${upload.body.document.id}`);
    expect(res.body.document.status).toBe('extracted');
    expect(res.body.document.textPreview).toContain('Photosynthesis');
  });

  it('marks an image-only PDF failed with a human reason', async () => {
    const upload = await uploadPdf(alice, makeBlankPdf(), 'scan.pdf');
    const { handleExtract } = await import('../src/modules/documents/documents.service.js');
    await handleExtract({ documentId: upload.body.document.id });

    const res = await alice.get(`/api/documents/${upload.body.document.id}`);
    expect(res.body.document.status).toBe('failed');
    expect(res.body.document.error).toMatch(/no text|scanned/i);
  });
});

// Stub generator: exercises the run lifecycle without calling the vendor.
const fakeGenerate = async (text) => [
  { question: 'What does this section discuss?', answer: text.slice(0, 40) },
  { question: 'Key term?', answer: 'A concept.' },
];

describe('AI generation', () => {
  let documentId;
  let runId;

  beforeAll(async () => {
    const upload = await uploadPdf(alice, makeTestPdf('The mitochondria is the powerhouse of the cell.'));
    documentId = upload.body.document.id;
    const { handleExtract } = await import('../src/modules/documents/documents.service.js');
    await handleExtract({ documentId });
  });

  it('starts a run on an extracted document', async () => {
    const res = await alice.post(`/api/documents/${documentId}/generate`);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'running' });
    runId = res.body.runId;
  });

  it('refuses to generate from an unprocessed document', async () => {
    const upload = await uploadPdf(alice, makeTestPdf('Another doc.'), 'fresh.pdf');
    const res = await alice.post(`/api/documents/${upload.body.document.id}/generate`);
    expect(res.status).toBe(400);
  });

  it('another user cannot start or read a run', async () => {
    const { agent: bob } = await registerAgent(ctx, 202);
    expect((await bob.post(`/api/documents/${documentId}/generate`)).status).toBe(404);
    expect((await bob.get(`/api/generation-runs/${runId}`)).status).toBe(404);
  });

  it('worker completes the run with cards, then saves a deck', async () => {
    const { handleGenerate } = await import('../src/modules/generation/generation.service.js');
    await handleGenerate({ runId }, { generate: fakeGenerate });

    const run = await alice.get(`/api/generation-runs/${runId}`);
    expect(run.body.run.status).toBe('completed');
    expect(run.body.run.cards.length).toBeGreaterThan(0);

    const saved = await alice.post('/api/decks/from-run').send({ runId, title: 'From PDF' });
    expect(saved.status).toBe(201);
    expect(saved.body.cardCount).toBe(run.body.run.cards.length);

    const cards = await alice.get(`/api/decks/${saved.body.deck.id}/cards`);
    expect(cards.body.cards.length).toBe(saved.body.cardCount);
  });

  it('attaches the last run to each document so the UI can offer View', async () => {
    const list = await alice.get('/api/documents');
    const doc = list.body.documents.find((d) => d.id === documentId);
    expect(doc.lastRun).toMatchObject({ runId, status: 'completed' });
    expect(doc.lastRun.cardCount).toBeGreaterThan(0);

    // a document that never generated reports no run rather than throwing
    const upload = await uploadPdf(alice, makeTestPdf('No run yet.'), 'no-run.pdf');
    await (await import('../src/modules/documents/documents.service.js')).handleExtract({ documentId: upload.body.document.id });
    const fresh = (await alice.get('/api/documents')).body.documents.find((d) => d.id === upload.body.document.id);
    expect(fresh.lastRun).toBeNull();
  });

  it('saves only selected cards when asked', async () => {
    const res = await alice.post('/api/decks/from-run').send({ runId, title: 'Subset', cardIndexes: [0] });
    expect(res.body.cardCount).toBe(1);
  });

  it('appends a regenerated batch into an existing deck, skipping duplicates', async () => {
    const existing = await alice.post('/api/decks').send({ title: 'Growable deck' });
    const deckId = existing.body.deck.id;

    const run = (await alice.get(`/api/generation-runs/${runId}`)).body.run;
    // seed the deck with a card identical to the run's first card
    await alice.post(`/api/decks/${deckId}/cards`).send({
      question: run.cards[0].question,
      answer: 'already studied this one',
    });

    const res = await alice.post(`/api/decks/${deckId}/cards/from-run`).send({ runId });
    expect(res.status).toBe(201);
    expect(res.body.added).toBe(run.cards.length - 1);
    expect(res.body.skipped).toBe(1);

    const cards = await alice.get(`/api/decks/${deckId}/cards`);
    expect(cards.body.cards.length).toBe(run.cards.length);
  });

  it('appends only selected cards when indexes are given', async () => {
    const deck = await alice.post('/api/decks').send({ title: 'Subset target' });
    const res = await alice
      .post(`/api/decks/${deck.body.deck.id}/cards/from-run`)
      .send({ runId, cardIndexes: [0] });
    expect(res.status).toBe(201);
    expect(res.body.added).toBe(1);
    expect(res.body.skipped).toBe(0);
  });

  it('another user cannot append into someone else’s deck', async () => {
    const { agent: bob } = await registerAgent(ctx, 203);
    const mine = await alice.post('/api/decks').send({ title: 'Alice only' });
    const res = await bob
      .post(`/api/decks/${mine.body.deck.id}/cards/from-run`)
      .send({ runId });
    expect(res.status).toBe(404);
  });
});

describe('subscription quotas', () => {
  it('lists plans without auth being premium', async () => {
    const res = await alice.get('/api/plans');
    expect(res.status).toBe(200);
    expect(res.body.plans.map((p) => p.id)).toEqual(expect.arrayContaining(['free', 'premium']));
  });

  it('free plan reports its limit and usage', async () => {
    const res = await alice.get('/api/billing/subscription');
    expect(res.status).toBe(200);
    expect(res.body.plan.id).toBe('free');
    expect(res.body.plan.limits.generationsPerMonth).toBeGreaterThan(0);
    expect(res.body.used).toBeGreaterThanOrEqual(0);
  });

  it('blocks generation over the monthly quota', async () => {
    // consume the entire free allowance
    const me = (await alice.get('/api/auth/me')).body.user;
    const { UsageEvent } = await import('../src/modules/billing/usageEvent.model.js');
    const { getEntitlements } = await import('../src/modules/billing/billing.service.js');
    const { plan } = await getEntitlements(me.id);
    await UsageEvent.insertMany(
      Array.from({ length: plan.limits.generationsPerMonth }, () => ({
        userId: me.id,
        type: 'generation',
        quantity: 1,
        occurredAt: new Date(),
      })),
    );

    const upload = await uploadPdf(alice, makeTestPdf('Quota test doc.'), 'quota.pdf');
    const { handleExtract } = await import('../src/modules/documents/documents.service.js');
    await handleExtract({ documentId: upload.body.document.id });

    const res = await alice.post(`/api/documents/${upload.body.document.id}/generate`);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/used all \d+ AI generations/i);
  });

  it('webhook endpoint refuses without billing config (and needs no session)', async () => {
    const res = await ctx.request.post('/api/billing/webhook').send({});
    expect(res.status).toBe(404);
  });
});
