import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiUpload } from '../../api/client.js';
import Spinner from '../../components/Spinner.jsx';
import UpgradeCard from '../billing/UpgradeCard.jsx';
import UndoSection, { useUndoableDeletes, withUndoSections } from '../../components/UndoSection.jsx';

// Upload → extract → generate → deck. The worker does the heavy lifting;
// this page polls status, then shows the deck the cards landed in.
const POLL_MS = 2000;
// Longest we'll block the button waiting on a run before telling the user it
// may still be going. Real runs finish well inside this.
const GENERATION_TIMEOUT_MS = 90_000;
// Documents in any of these states are still moving: poll the list so each
// status resolves to "Ready to generate" (or a failure reason) without a
// manual reload.
const TRANSIENT_STATUSES = new Set(['pending', 'extracting']);

export default function UploadPage() {
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState(null);
  const [busyDocId, setBusyDocId] = useState(null);
  // 'generate' while the AI writes new cards, 'view' while we fetch an old run.
  // Only used for the wording of the progress panel.
  const [busyMode, setBusyMode] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState('');
  // { runId, cards, status, error, deck, deckError } — deck is prepared
  // automatically as soon as the cards exist, so the panel's job is to point
  // at it, not to ask the user to build one.
  const [run, setRun] = useState(null);
  const undo = useUndoableDeletes();
  const fileRef = useRef(null);
  // The progress panel and the finished cards share this spot, below the
  // document list. It is off-screen on short windows, so anything that starts
  // or finishes a run scrolls it into view — otherwise the page looks dead.
  const resultsRef = useRef(null);

  function revealResults() {
    // Let React commit the panel first, then bring it into view.
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const load = useCallback(() => {
    return api('/api/documents')
      .then((data) => setDocuments(data.documents))
      .catch((err) => setError(err.message));
  }, []);

  // NB: don't pass `load` straight to useEffect — it returns a promise (the
  // upload() caller awaits it), and React would invoke that as the effect's
  // clean-up, which throws and blanks the page.
  useEffect(() => {
    load();
  }, [load]);

  // Keep statuses live while anything is still processing, so "pending" and
  // "extracting" resolve to their final state without a manual reload.
  const hasPending = documents?.some((d) => TRANSIENT_STATUSES.has(d.status)) ?? false;
  const busyDoc = documents?.find((d) => d.id === busyDocId) ?? null;
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [hasPending, load]);

  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    setUploadName(file.name);
    const form = new FormData();
    form.append('file', file);
    try {
      await apiUpload('/api/documents', form);
      // only clear the loader once the file is actually visible in the list
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      setUploadName('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function generate(doc) {
    setBusyDocId(doc.id);
    setBusyMode('generate');
    setError(null);
    setRun(null);
    revealResults();
    try {
      const start = await api(`/api/documents/${doc.id}/generate`, { method: 'POST' });
      // Poll the run until it leaves 'running'. Bounded: if the worker never
      // picks it up we tell the user instead of spinning forever.
      let timedOut = false;
      const deadline = Date.now() + GENERATION_TIMEOUT_MS;
      let current = null;
      let lastError = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        try {
          ({ run: current } = await api(`/api/generation-runs/${start.runId}`));
          lastError = null;
        } catch (err) {
          // A dropped request or a 5xx blip must not discard a run that is
          // still finishing in the background; keep polling. Only definitive
          // answers (401/404) are worth giving up on.
          if (err.status && err.status < 500) throw err;
          lastError = err;
          continue;
        }
        if (current.status !== 'running') break;
      }
      if (!current && lastError) throw lastError;
      if (!current || current.status === 'running') {
        timedOut = true;
      }
      if (timedOut) {
        setError('Generation is taking longer than expected. It may still finish in the background — check back in a minute.');
        await load();
      } else {
        await showRun(doc, current);
        // Refresh the list so this row immediately offers "View N cards"
        // instead of looking untouched until the next page load.
        load();
        revealResults();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyDocId(null);
      setBusyMode(null);
    }
  }

  // The deck exists before the user reads the cards: no review-then-save step,
  // just a button to open what was made. A first run creates the deck from the
  // PDF's name; a later run folds its cards into that same deck, deduplicated
  // server-side, so one PDF means one deck.
  async function ensureDeck(doc, runId) {
    const { decks } = await api('/api/decks');
    const existing = decks.find((d) => d.documentId === doc.id);
    if (existing) {
      const result = await api(`/api/decks/${existing.id}/cards/from-run`, {
        method: 'POST',
        body: { runId },
      });
      return {
        id: existing.id,
        title: existing.title,
        cardCount: existing.cardCount + result.added,
        added: result.added,
        skipped: result.skipped,
      };
    }
    const title = doc.filename.replace(/\.pdf$/i, '');
    const { deck, cardCount } = await api('/api/decks/from-run', {
      method: 'POST',
      body: { runId, title },
    });
    return { id: deck.id, title: deck.title ?? title, cardCount, added: cardCount, skipped: 0 };
  }

  // Puts a finished run on screen with its deck already prepared. A failed or
  // empty run shows as-is; a deck that couldn't be prepared is reported next
  // to the cards rather than swallowed.
  async function showRun(doc, current) {
    const cards = current.cards ?? [];
    const next = {
      runId: current.id,
      status: current.status,
      error: current.error,
      cards,
      documentId: doc.id,
      deck: null,
      deckError: null,
    };
    if (cards.length > 0 && (current.status === 'completed' || current.status === 'partial')) {
      try {
        next.deck = await ensureDeck(doc, current.id);
      } catch (err) {
        next.deckError = `Cards are ready, but the deck couldn't be prepared: ${err.message}`;
      }
    }
    setRun(next);
  }

  // A doc that already produced cards gets its last run back — with the deck
  // that run produced (or with a deck prepared now, for runs that predate
  // automatic decks) — without spending another AI credit.
  async function viewRun(doc) {
    if (!doc.lastRun) return;
    setBusyDocId(doc.id);
    setBusyMode('view');
    setError(null);
    setRun(null);
    revealResults();
    try {
      const { run: current } = await api(`/api/generation-runs/${doc.lastRun.runId}`);
      await showRun(doc, current);
      revealResults();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyDocId(null);
      setBusyMode(null);
    }
  }

  // Deleting a document leaves an undo section in its place for 30 seconds;
  // the API call has already happened, so Undo calls the restore endpoint.
  async function deleteDocument(doc) {
    try {
      await api(`/api/documents/${doc.id}`, { method: 'DELETE' });
    } catch (err) {
      setError(err.message);
      return;
    }
    const index = documents.findIndex((d) => d.id === doc.id);
    undo.mark(doc.id, doc, index);
    setDocuments((list) => list.filter((d) => d.id !== doc.id));
  }

  async function undoDeleteDocument(id) {
    try {
      await api(`/api/documents/${id}/restore`, { method: 'POST' });
    } catch (err) {
      setError(err.message);
      return;
    }
    const entry = undo.entries[id];
    undo.clear(id);
    if (entry) {
      setDocuments((list) => {
        const next = [...list];
        next.splice(Math.min(entry.index, next.length), 0, entry.item);
        return next;
      });
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold text-slate-900">Upload &amp; generate</h2>
          <p className="mt-1 text-sm text-slate-500">
            Upload a PDF of your notes or textbook chapter; we extract the text and turn it into flashcards.
          </p>
        </div>
        {/* you should see what a generation costs before you spend one */}
        <div className="w-full max-w-sm">
          <UpgradeCard />
        </div>
      </div>

      <label
        className={`mt-6 flex flex-col items-center rounded-xl border-2 border-dashed border-slate-300 bg-white p-6 text-center sm:p-10 ${
          uploading ? 'pointer-events-none opacity-70' : 'cursor-pointer hover:border-forest-600'
        }`}
      >
        {uploading ? (
          <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <Spinner className="h-4 w-4 text-forest-800" />
            Uploading {uploadName}…
          </span>
        ) : (
          <span className="text-sm font-medium text-slate-900">Click to choose a PDF</span>
        )}
        <span className="mt-1 text-xs text-slate-500">Up to 10 MB · text-based PDFs only (no scans yet)</span>
        <input ref={fileRef} type="file" accept="application/pdf" onChange={upload} disabled={uploading} className="hidden" />
      </label>

      {error && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {documents === null ? (
        <p className="mt-8 text-sm text-slate-500">Loading…</p>
      ) : withUndoSections(documents, undo.entries).length === 0 ? (
        <p className="mt-8 text-sm text-slate-500">No documents yet.</p>
      ) : (
        <ul className="mt-8 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {withUndoSections(documents, undo.entries).map((doc) =>
            doc.undoSection ? (
              <li key={doc.id} className="px-4 py-3">
                <div className="rounded-lg border-2 border-dashed border-slate-300 px-4 py-3">
                  <UndoSection
                    label={`Document “${doc.filename}”`}
                    secondsLeft={undo.secondsLeft(doc.id)}
                    onUndo={() => undoDeleteDocument(doc.id)}
                  />
                </div>
              </li>
            ) : (
            <li key={doc.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{doc.filename}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  <StatusBadge status={doc.status} />
                  {doc.error && ` · ${doc.error}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                {doc.status === 'extracted' && (
                  <button
                    onClick={() => generate(doc)}
                    disabled={busyDocId === doc.id}
                    className="inline-flex items-center gap-1.5 rounded-md bg-forest-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-700 disabled:opacity-60"
                  >
                    {busyDocId === doc.id && <Spinner className="h-3.5 w-3.5" />}
                    {busyDocId === doc.id ? 'Generating…' : doc.lastRun ? 'Generate again' : 'Generate flashcards'}
                  </button>
                )}
                {doc.lastRun && doc.lastRun.status !== 'running' && doc.lastRun.cardCount > 0 && (
                  <button
                    onClick={() => viewRun(doc)}
                    disabled={busyDocId === doc.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-forest-700 px-3 py-1.5 text-sm font-medium text-forest-800 hover:bg-forest-50 disabled:opacity-60"
                  >
                    View {doc.lastRun.cardCount} card{doc.lastRun.cardCount === 1 ? '' : 's'}
                  </button>
                )}
                <button
                  onClick={() => deleteDocument(doc)}
                  className="text-xs text-slate-400 hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            </li>
            ),
          )}
        </ul>
      )}

      {(busyDocId || run) && (
        <section
          ref={resultsRef}
          aria-live="polite"
          aria-busy={busyDocId ? 'true' : 'false'}
          className="mt-10 scroll-mt-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-6"
        >
          {busyDocId ? (
            <div className="flex items-start gap-3">
              <Spinner className="mt-0.5 h-4 w-4 text-forest-800" />
              <div>
                <p className="font-semibold text-slate-900">
                  {busyMode === 'view' ? 'Loading cards…' : 'Generating flashcards…'}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {busyDoc?.filename ? `${busyDoc.filename} · ` : ''}
                  {busyMode === 'view'
                    ? 'fetching the cards from your last run.'
                    : 'reading the PDF and writing cards. They will appear here in a few seconds.'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <h3 className="font-semibold text-slate-900">
                Generated cards
                {run.status === 'partial' && <span className="ml-2 text-sm font-normal text-amber-600">(partial — some sections failed)</span>}
                {run.status === 'failed' && <span className="ml-2 text-sm font-normal text-red-600">(failed)</span>}
              </h3>
              {run.error && <p className="mt-1 text-sm text-slate-500">{run.error}</p>}

              {run.cards.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No cards were generated from this document.</p>
              ) : (
                <>
                  {run.deck && (
                    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-forest-200 bg-forest-50 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-forest-900">
                          Your deck “{run.deck.title}” is ready — {run.deck.cardCount} card
                          {run.deck.cardCount === 1 ? '' : 's'}.
                        </p>
                        <p className="mt-0.5 text-xs text-forest-700">
                          Saved automatically. Study it now, or edit the cards any time.
                          {run.deck.skipped > 0 &&
                            run.deck.added > 0 &&
                            ` ${run.deck.skipped} duplicate${run.deck.skipped === 1 ? '' : 's'} skipped.`}
                        </p>
                      </div>
                      <Link
                        to={`/decks/${run.deck.id}`}
                        className="btn-primary w-full shrink-0 justify-center sm:w-auto"
                      >
                        View deck
                      </Link>
                    </div>
                  )}
                  {run.deckError && (
                    <p role="alert" className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      {run.deckError}
                    </p>
                  )}

                  <ul className="mt-4 max-h-96 divide-y divide-slate-100 overflow-y-auto">
                    {run.cards.map((card, i) => (
                      <li key={i} className="py-3">
                        <p className="break-words text-sm font-medium text-slate-900">{card.question}</p>
                        <p className="mt-0.5 break-words text-sm text-slate-600">{card.answer}</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    pending: 'text-slate-500',
    extracting: 'text-amber-600',
    extracted: 'text-emerald-600',
    failed: 'text-red-600',
  };
  const labels = {
    pending: 'Pending',
    extracting: 'Extracting text…',
    extracted: 'Ready to generate',
    failed: 'Extraction failed',
  };
  const busy = status === 'pending' || status === 'extracting';
  return (
    <span className={`inline-flex items-center gap-1 ${styles[status] ?? 'text-slate-500'}`}>
      {busy && <Spinner className="h-3 w-3" />}
      {labels[status] ?? status}
    </span>
  );
}
