import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import Spinner from '../../components/Spinner.jsx';

// Upload → extract → generate → review → save-to-deck. The worker does the
// heavy lifting; this page polls status and renders the run's cards.
const POLL_MS = 2000;
// Longest we'll block the button waiting on a run before telling the user it
// may still be going. Real runs finish well inside this.
const GENERATION_TIMEOUT_MS = 90_000;
// Documents in any of these states are still moving: poll the list so each
// status resolves to "Ready to generate" (or a failure reason) without a
// manual reload.
const TRANSIENT_STATUSES = new Set(['pending', 'extracting']);

export default function UploadPage() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState(null);
  const [busyDocId, setBusyDocId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [run, setRun] = useState(null); // { runId, cards, status, error }
  const [selected, setSelected] = useState(new Set());
  const [deckTitle, setDeckTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

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
      const res = await fetch('/api/documents', { method: 'POST', credentials: 'include', body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? 'Upload failed.');
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
    setError(null);
    setRun(null);
    try {
      const start = await api(`/api/documents/${doc.id}/generate`, { method: 'POST' });
      // Poll the run until it leaves 'running'. Bounded: if the worker never
      // picks it up we tell the user instead of spinning forever.
      let timedOut = false;
      const deadline = Date.now() + GENERATION_TIMEOUT_MS;
      let current;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        ({ run: current } = await api(`/api/generation-runs/${start.runId}`));
        if (current.status !== 'running') break;
      }
      if (current.status === 'running') {
        timedOut = true;
      }
      if (timedOut) {
        setError('Generation is taking longer than expected. It may still finish in the background — check back in a minute.');
        await load();
      } else {
        setRun({
          runId: current.id,
          status: current.status,
          error: current.error,
          cards: current.cards,
          documentId: doc.id,
        });
        setSelected(new Set(current.cards.map((_, i) => i)));
        setDeckTitle(doc.filename.replace(/\.pdf$/i, ''));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyDocId(null);
    }
  }

  // A doc that already produced cards gets its last run back so the user can
  // review and re-save it without spending another AI credit.
  async function viewRun(doc) {
    if (!doc.lastRun) return;
    setBusyDocId(doc.id);
    setError(null);
    try {
      const { run: current } = await api(`/api/generation-runs/${doc.lastRun.runId}`);
      setRun({
        runId: current.id,
        status: current.status,
        error: current.error,
        cards: current.cards,
        documentId: doc.id,
      });
      setSelected(new Set(current.cards.map((_, i) => i)));
      setDeckTitle(doc.filename.replace(/\.pdf$/i, ''));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyDocId(null);
    }
  }

  function toggle(i) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  async function saveToDeck(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { deck } = await api('/api/decks/from-run', {
        method: 'POST',
        body: { runId: run.runId, title: deckTitle.trim(), cardIndexes: [...selected].sort((a, b) => a - b) },
      });
      navigate(`/decks/${deck.id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h2 className="text-xl font-semibold text-slate-900">Upload & generate</h2>
      <p className="mt-1 text-sm text-slate-500">
        Upload a PDF of your notes or textbook chapter; we extract the text and turn it into flashcards.
      </p>

      <label
        className={`mt-6 flex flex-col items-center rounded-xl border-2 border-dashed border-slate-300 bg-white p-10 text-center ${
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
      ) : documents.length === 0 ? (
        <p className="mt-8 text-sm text-slate-500">No documents yet.</p>
      ) : (
        <ul className="mt-8 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{doc.filename}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  <StatusBadge status={doc.status} />
                  {doc.error && ` · ${doc.error}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
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
                  onClick={async () => {
                    await api(`/api/documents/${doc.id}`, { method: 'DELETE' });
                    load();
                  }}
                  className="text-xs text-slate-400 hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {run && (
        <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6">
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
              <ul className="mt-4 max-h-96 divide-y divide-slate-100 overflow-y-auto">
                {run.cards.map((card, i) => (
                  <li key={i} className="flex items-start gap-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(i)}
                      onChange={() => toggle(i)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-forest-800 focus:ring-forest-700"
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-900">{card.question}</p>
                      <p className="mt-0.5 text-sm text-slate-600">{card.answer}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <form onSubmit={saveToDeck} className="mt-4 flex flex-wrap items-center gap-3">
                <input
                  value={deckTitle}
                  onChange={(e) => setDeckTitle(e.target.value)}
                  placeholder="Deck title"
                  className="flex-1 min-w-48 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-forest-700 focus:outline-none focus:ring-1 focus:ring-forest-700"
                />
                <button
                  type="submit"
                  disabled={saving || selected.size === 0 || !deckTitle.trim()}
                  className="rounded-md bg-forest-800 px-4 py-2 text-sm font-medium text-white hover:bg-forest-700 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : `Save ${selected.size} card${selected.size === 1 ? '' : 's'} to deck`}
                </button>
              </form>
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
