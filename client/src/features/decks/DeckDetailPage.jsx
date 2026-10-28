import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import Spinner from '../../components/Spinner.jsx';
import Tooltip from '../../components/Tooltip.jsx';

const POLL_MS = 2000;
// Longest we'll block the button waiting on a run before telling the user it
// may still be going. Matches the upload page's budget.
const GENERATION_TIMEOUT_MS = 90_000;

export default function DeckDetailPage() {
  const { deckId } = useParams();
  const navigate = useNavigate();
  const [deck, setDeck] = useState(null);
  const [cards, setCards] = useState(null);
  const [error, setError] = useState(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({ question: '', answer: '' });
  const [regenerating, setRegenerating] = useState(false);
  const [regenDone, setRegenDone] = useState(null); // { added, skipped }
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [savingRename, setSavingRename] = useState(false);

  const load = useCallback(() => {
    Promise.all([api(`/api/decks/${deckId}`), api(`/api/decks/${deckId}/cards`)])
      .then(([deckData, cardData]) => {
        setDeck(deckData.deck);
        setCards(cardData.cards);
      })
      .catch((err) => setError(err.message));
  }, [deckId]);

  useEffect(load, [load]);

  async function addCard(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/decks/${deckId}/cards`, {
        method: 'POST',
        body: { question: question.trim(), answer: answer.trim() },
      });
      setQuestion('');
      setAnswer('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(cardId) {
    try {
      await api(`/api/cards/${cardId}`, { method: 'PATCH', body: editDraft });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteCard(cardId) {
    await api(`/api/cards/${cardId}`, { method: 'DELETE' });
    load();
  }

  // Rename the deck without leaving it — titles are how you find things again.
  async function saveRename(e) {
    e.preventDefault();
    if (!renameValue.trim()) return;
    setSavingRename(true);
    setError(null);
    try {
      await api(`/api/decks/${deckId}`, { method: 'PATCH', body: { title: renameValue.trim() } });
      setRenaming(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingRename(false);
    }
  }

  async function deleteDeck() {
    if (!window.confirm(`Delete “${deck.title}” and all its cards?`)) return;
    await api(`/api/decks/${deckId}`, { method: 'DELETE' });
    navigate('/decks');
  }

  // Kick off a fresh generation run against the deck's source PDF, then poll
  // it. When it finishes, fold the new cards into THIS deck (deduped server-
  // side) so a short PDF can be grown without leaving the page.
  async function regenerate() {
    setRegenerating(true);
    setRegenDone(null);
    setError(null);
    try {
      const start = await api(`/api/documents/${deck.documentId}/generate`, { method: 'POST' });
      const deadline = Date.now() + GENERATION_TIMEOUT_MS;
      let run;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        ({ run } = await api(`/api/generation-runs/${start.runId}`));
        if (run.status !== 'running') break;
      }
      if (run.status === 'running') {
        throw new Error('Generation is taking longer than expected. It may still finish in the background — check back in a minute.');
      }
      if (run.status === 'failed') throw new Error(run.error || 'Generation failed.');
      const result = await api(`/api/decks/${deckId}/cards/from-run`, {
        method: 'POST',
        body: { runId: run.id },
      });
      setRegenDone(result);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRegenerating(false);
    }
  }

  if (!deck) {
    return <p className="mx-auto max-w-5xl px-6 py-10 text-sm text-slate-500">{error ?? 'Loading…'}</p>;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/decks" className="text-sm text-slate-400 hover:text-slate-600">
            ← All decks
          </Link>
          {renaming ? (
            <form onSubmit={saveRename} className="mt-1 flex items-center gap-2">
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
                maxLength={200}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:border-forest-700 focus:outline-none focus:ring-1 focus:ring-forest-700"
              />
              <button
                type="submit"
                disabled={savingRename || !renameValue.trim()}
                className="rounded-md bg-forest-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-700 disabled:opacity-60"
              >
                {savingRename ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="mt-1 flex items-center gap-2">
              <h2 className="text-xl font-semibold text-slate-900">{deck.title}</h2>
              <Tooltip label="Rename this deck so it's easy to remember." side="bottom">
                <button
                  onClick={() => {
                    setRenameValue(deck.title);
                    setRenaming(true);
                  }}
                  aria-label="Rename this deck"
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-forest-800"
                >
                  <PencilIcon className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
          )}
          {deck.subject && <p className="text-sm text-slate-500">{deck.subject}</p>}
        </div>
        <div className="flex gap-2">
          <Link
            to={`/study?deckId=${deckId}`}
            className="rounded-md bg-forest-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-700"
          >
            Study this deck
          </Link>
          <button
            onClick={deleteDeck}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Delete deck
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={addCard} className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="font-medium text-slate-900">Add a card</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Question"
            rows={2}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-forest-700 focus:outline-none focus:ring-1 focus:ring-forest-700"
          />
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Answer"
            rows={2}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-forest-700 focus:outline-none focus:ring-1 focus:ring-forest-700"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !question.trim() || !answer.trim()}
          className="mt-3 rounded-md bg-forest-800 px-4 py-2 text-sm font-medium text-white hover:bg-forest-700 disabled:opacity-60"
        >
          {busy ? 'Adding…' : 'Add card'}
        </button>
      </form>

      {cards === null ? (
        <p className="mt-8 text-sm text-slate-500">Loading cards…</p>
      ) : cards.length === 0 ? (
        <p className="mt-8 text-sm text-slate-500">No cards yet — add one above.</p>
      ) : (
        <ul className="mt-8 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {cards.map((card) => (
            <li key={card.id} className="p-4">
              {editingId === card.id ? (
                <div className="grid gap-2">
                  <input
                    value={editDraft.question}
                    onChange={(e) => setEditDraft((d) => ({ ...d, question: e.target.value }))}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    value={editDraft.answer}
                    onChange={(e) => setEditDraft((d) => ({ ...d, answer: e.target.value }))}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(card.id)}
                      className="rounded-md bg-forest-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-forest-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-slate-900">{card.question}</p>
                    <p className="mt-1 text-sm text-slate-600">{card.answer}</p>
                  </div>
                  <div className="flex shrink-0 gap-2 text-xs">
                    <button
                      onClick={() => {
                        setEditingId(card.id);
                        setEditDraft({ question: card.question, answer: card.answer });
                      }}
                      className="text-slate-400 hover:text-forest-800"
                    >
                      Edit
                    </button>
                    <button onClick={() => deleteCard(card.id)} className="text-slate-400 hover:text-red-600">
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          )          )}
        </ul>
      )}

      {/* Only decks born from a PDF can be topped up from it. */}
      {deck.documentId && (
        <section className="mt-10 rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-medium text-slate-900">Need more cards?</h3>
          <p className="mt-1 text-sm text-slate-500">
            Not enough cards from this PDF? Generate another batch from the same source. Cards already
            in this deck won’t be added twice.
          </p>
          {regenDone && (
            <p className="mt-3 rounded-md bg-forest-50 px-3 py-2 text-sm text-forest-800">
              Added {regenDone.added} new card{regenDone.added === 1 ? '' : 's'}
              {regenDone.skipped > 0 && ` · skipped ${regenDone.skipped} already in this deck`}.
            </p>
          )}
          <button
            onClick={regenerate}
            disabled={regenerating}
            className="btn-primary mt-4"
          >
            {regenerating && <Spinner className="h-4 w-4" />}
            {regenerating ? 'Generating more cards…' : 'Generate more cards'}
          </button>
        </section>
      )}
    </div>
  );
}

function PencilIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}
