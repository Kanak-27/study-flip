import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import Tooltip from '../../components/Tooltip.jsx';

export default function DecksPage() {
  const [decks, setDecks] = useState(null);
  const [error, setError] = useState(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [savingRename, setSavingRename] = useState(false);

  const load = useCallback(() => {
    api('/api/decks')
      .then((data) => setDecks(data.decks))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  async function createDeck(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/decks', { method: 'POST', body: { title: title.trim() } });
      setTitle('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteDeck(deck) {
    if (!window.confirm(`Delete “${deck.title}” and its ${deck.cardCount} cards?`)) return;
    await api(`/api/decks/${deck.id}`, { method: 'DELETE' });
    load();
  }

  // Rename in place — a title you recognise is the whole point of a list.
  function startRename(deck) {
    setRenamingId(deck.id);
    setRenameValue(deck.title);
  }

  async function saveRename() {
    if (!renameValue.trim()) return;
    setSavingRename(true);
    setError(null);
    try {
      await api(`/api/decks/${renamingId}`, { method: 'PATCH', body: { title: renameValue.trim() } });
      setRenamingId(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingRename(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-slate-900">Your decks</h2>
        <Link to="/upload" className="rounded-md bg-forest-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-700">
          Generate from PDF
        </Link>
      </div>

      <form onSubmit={createDeck} className="mt-6 flex flex-col gap-2 sm:flex-row">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New deck title…"
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-forest-700 focus:outline-none focus:ring-1 focus:ring-forest-700"
        />
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {busy ? 'Adding…' : 'Add deck'}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {decks === null ? (
        <p className="mt-8 text-sm text-slate-500">Loading…</p>
      ) : decks.length === 0 ? (
        <p className="mt-8 text-sm text-slate-500">
          No decks yet. Create one above, or upload a PDF to generate flashcards.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {decks.map((deck) => (
            <li key={deck.id} className="rounded-xl border border-slate-200 bg-white p-5">
              {renamingId === deck.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveRename();
                  }}
                  className="grid gap-2"
                >
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    autoFocus
                    maxLength={200}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-forest-700 focus:outline-none focus:ring-1 focus:ring-forest-700"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={savingRename || !renameValue.trim()}
                      className="rounded-md bg-forest-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-forest-700 disabled:opacity-60"
                    >
                      {savingRename ? 'Saving…' : 'Save name'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link to={`/decks/${deck.id}`} className="min-w-0 break-words font-medium text-slate-900 hover:text-forest-800">
                      {deck.title}
                    </Link>
                    <div className="flex shrink-0 items-center gap-2 text-xs">
                      <Tooltip label="Rename this deck so you can find it later." side="bottom">
                        <button
                          onClick={() => startRename(deck)}
                          className="text-slate-400 hover:text-forest-800"
                          aria-label={`Rename ${deck.title}`}
                        >
                          Rename
                        </button>
                      </Tooltip>
                      <button
                        onClick={() => deleteDeck(deck)}
                        className="text-slate-400 hover:text-red-600"
                        aria-label={`Delete ${deck.title}`}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {deck.cardCount} card{deck.cardCount === 1 ? '' : 's'}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
