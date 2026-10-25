import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';

export default function DecksPage() {
  const [decks, setDecks] = useState(null);
  const [error, setError] = useState(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-900">Your decks</h2>
        <Link to="/upload" className="rounded-md bg-forest-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-700">
          Generate from PDF
        </Link>
      </div>

      <form onSubmit={createDeck} className="mt-6 flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New deck title…"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-forest-700 focus:outline-none focus:ring-1 focus:ring-forest-700"
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
              <div className="flex items-start justify-between gap-2">
                <Link to={`/decks/${deck.id}`} className="font-medium text-slate-900 hover:text-forest-800">
                  {deck.title}
                </Link>
                <button
                  onClick={() => deleteDeck(deck)}
                  className="text-xs text-slate-400 hover:text-red-600"
                  aria-label={`Delete ${deck.title}`}
                >
                  Delete
                </button>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {deck.cardCount} card{deck.cardCount === 1 ? '' : 's'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
