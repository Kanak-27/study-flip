import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';

/* Study session, three stages (per the design):
   1. A tilted open question card sits on the deck (left); the right side shows
      an empty "flip to see the answer" placeholder.
   2. Flipping sends the card across its vertical axis to the right slot, where
      it shows the answer plus Again / Hard / Easy.
   3. Rating turns the answered card into a solid colour card on the right, and
      the next question opens from the deck on the left.
   Ratings map to SM-2's scale: Again=1, Hard=3, Easy=5. */

const RATINGS = [
  { label: 'Again', value: 1, key: '1', btn: 'bg-red-400 text-white hover:bg-red-500', panel: 'border-red-200 bg-red-100 text-red-700', check: 'bg-red-500' },
  { label: 'Hard', value: 3, key: '2', btn: 'bg-amber-300 text-amber-950 hover:bg-amber-400', panel: 'border-amber-200 bg-amber-100 text-amber-800', check: 'bg-amber-400' },
  { label: 'Easy', value: 5, key: '3', btn: 'bg-forest-500 text-white hover:bg-forest-600', panel: 'border-forest-200 bg-forest-100 text-forest-800', check: 'bg-forest-600' },
];

// Must cover the longest flip leg (--animate-flip-in: 560ms + 80ms delay).
const FLY_MS = 640;

export default function StudyPage() {
  const [searchParams] = useSearchParams();
  const deckIdParam = searchParams.get('deckId');

  // Opening /study always asks which deck to study. A deckId in the URL
  // (deep link from a deck page) preselects that deck and starts it at once.
  const [chosenId, setChosenId] = useState(deckIdParam);
  const [decks, setDecks] = useState(null);
  const [decksError, setDecksError] = useState(null);

  const [cards, setCards] = useState(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false); // answer side showing on the right
  const [flying, setFlying] = useState(false); // mid left-to-right flip
  const [marked, setMarked] = useState(null); // { rating, logId } — last grade, changeable until the next flip
  const [answered, setAnswered] = useState(0);
  const [error, setError] = useState(null);
  const [sessionError, setSessionError] = useState(null);
  const busyRef = useRef(false);
  const flyTimer = useRef(null);

  const startSession = useCallback(() => {
    if (!chosenId) return;
    setCards(null);
    setIndex(0);
    setFlipped(false);
    setFlying(false);
    setMarked(null);
    setAnswered(0);
    setSessionError(null);
    api('/api/study/sessions', {
      method: 'POST',
      body: { mode: 'deck', deckIds: [chosenId] },
    })
      .then((data) => setCards(data.cards))
      .catch((err) => setSessionError(err.message));
  }, [chosenId]);

  useEffect(startSession, [startSession]);
  useEffect(() => () => clearTimeout(flyTimer.current), []);

  // Load the deck list for the picker (not needed once a session is running).
  useEffect(() => {
    if (chosenId) return;
    api('/api/decks')
      .then((data) => setDecks(data.decks))
      .catch((err) => setDecksError(err.message));
  }, [chosenId]);

  const card = cards?.[index];
  const total = cards?.length ?? 0;
  const done = cards !== null && index >= total;

  function flip() {
    if (!card || flipped || flying) return;
    setFlying(true);
    setFlipped(true);
    clearTimeout(flyTimer.current);
    flyTimer.current = setTimeout(() => setFlying(false), FLY_MS);
  }

  async function rate(value) {
    if (!card || !flipped || flying || busyRef.current) return;
    busyRef.current = true;
    const rating = RATINGS.find((r) => r.value === value);
    try {
      const res = await api('/api/reviews', { method: 'POST', body: { flashcardId: card.id, rating: value } });
      setMarked({ rating, logId: res.reviewLogId });
      setFlipped(false);
      setAnswered((n) => n + 1);
      // On the last card, let the colour card linger before the wrap-up screen.
      const last = index + 1 >= total;
      if (last) {
        setTimeout(() => setIndex((i) => i + 1), 1400);
      } else {
        setIndex((i) => i + 1);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      busyRef.current = false;
    }
  }

  // Changed your mind about the last grade? Change it until the next card is
  // flipped — the server recomputes the schedule from the pre-review state,
  // so the correction replaces the grade instead of stacking on top of it.
  async function revise(value) {
    if (!marked || flipped || flying || busyRef.current || value === marked.rating.value) return;
    busyRef.current = true;
    try {
      const res = await api(`/api/reviews/${marked.logId}/revise`, { method: 'POST', body: { rating: value } });
      setMarked({ rating: RATINGS.find((r) => r.value === value), logId: res.reviewLogId ?? marked.logId });
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      busyRef.current = false;
    }
  }

  // Space/Enter flips; 1/2/3 rate. Ignored mid-flip or before the answer shows.
  useEffect(() => {
    function onKey(e) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        flip();
      }
      const rating = RATINGS.find((r) => r.key === e.key);
      if (rating) {
        if (flipped) rate(rating.value);
        else revise(rating.value); // no-op unless the graded card is showing
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The ask-first state: no deck chosen yet, so offer the picker.
  if (!chosenId) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h2 className="text-xl font-semibold text-slate-900">What do you want to study?</h2>
        <p className="mt-1 text-sm text-slate-500">Pick a deck to open a study session.</p>

        {decksError && (
          <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {decksError}
          </p>
        )}

        {decks === null ? (
          <p className="mt-8 text-sm text-slate-500">Loading decks…</p>
        ) : decks.length === 0 ? (
          <div className="mt-8">
            <p className="text-sm text-slate-500">You have no decks yet.</p>
            <Link to="/upload" className="btn-primary mt-4">Generate flashcards from a PDF</Link>
          </div>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {decks.map((deck) => (
              <li key={deck.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="font-medium text-slate-900">{deck.title}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {deck.cardCount} card{deck.cardCount === 1 ? '' : 's'}
                </p>
                <button
                  onClick={() => setChosenId(deck.id)}
                  disabled={deck.cardCount === 0}
                  className="btn-primary mt-4"
                >
                  Study this deck
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (sessionError) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {sessionError}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={startSession} className="btn-primary">Try again</button>
          <button onClick={() => setChosenId(null)} className="btn-secondary">Choose another deck</button>
        </div>
      </div>
    );
  }

  if (cards === null) {
    return <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-500">Loading session…</div>;
  }

  if (done) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h2 className="text-2xl font-semibold text-slate-900">Session complete 🎉</h2>
        <p className="mt-2 text-sm text-slate-500">
          You reviewed {answered} card{answered === 1 ? '' : 's'}.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={startSession} className="btn-secondary">Study this deck again</button>
          <button onClick={() => setChosenId(null)} className="btn-primary">Pick another deck</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>
          Card {Math.min(index + 1, total)} of {total}
        </span>
        <Link to="/" className="hover:text-slate-700">
          End session
        </Link>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-forest-800 transition-all"
          style={{ width: `${total ? (answered / total) * 100 : 0}%` }}
        />
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-10 grid gap-8 md:grid-cols-2 md:gap-12">
        {/* LEFT — the deck. Open question card tilts out of a fanned stack. */}
        <div className="relative mx-auto min-h-[22rem] w-full max-w-sm [perspective:1500px] md:min-h-[24rem]">
          <DeckStack />
          {(flipped || flying) && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-gradient-to-b from-forest-50 to-white shadow-lg">
              <CardsIcon className="h-10 w-10 text-forest-300" />
              <span className="mt-3 text-lg font-black tracking-tight text-forest-300">
                studyflip<span className="text-forest-400">.</span>
              </span>
            </div>
          )}
          {!flipped && card && <OpenCard key={`q-${index}`} card={card} animation="animate-open-in" onFlip={flip} />}
          {flying && card && <OpenCard card={card} animation="animate-flip-out" onFlip={flip} />}
        </div>

        {/* RIGHT — the answer slot. Placeholder, then the flipped card, then the
            colour result that lingers until the next flip covers it. */}
        <div className="relative mx-auto min-h-[22rem] w-full max-w-sm [perspective:1500px] md:min-h-[24rem]">
          {marked && (!flipped || flying) && (
            <MarkedCard key={`m-${answered}`} rating={marked.rating} onRevise={revise} />
          )}
          {flipped && card && (
            <AnswerCard
              key={`a-${index}`}
              card={card}
              animation={flying ? 'animate-flip-in' : ''}
              onRate={rate}
            />
          )}
          {!flipped && !marked && <Placeholder />}
        </div>
      </div>

      <p className="mt-8 text-center text-xs text-slate-400">
        Space flips the card · 1 = Again, 2 = Hard, 3 = Easy
      </p>
    </div>
  );
}

/* Fanned stack of face-down cards the open card leans out of. */
function DeckStack() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="absolute inset-0 rounded-2xl border border-slate-200 bg-white shadow-sm"
          style={{ transform: `rotate(${-7 + i * 1.6}deg) translateX(${-14 + i * 3}px)`, zIndex: i }}
        />
      ))}
    </div>
  );
}

/* Stage 1/3 left card: tilted, showing the question, with the flip button. */
function OpenCard({ card, animation, onFlip }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onFlip}
      onKeyDown={(e) => e.key === 'Enter' && onFlip()}
      aria-label="Question showing. Activate to reveal the answer."
      className={`absolute inset-0 z-30 flex cursor-pointer select-none flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-xl focus:outline-none focus:ring-2 focus:ring-forest-600 ${animation}`}
    >
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-forest-50 px-3 py-1 text-xs font-semibold text-forest-700">Question</span>
        <BookmarkIcon className="h-5 w-5 text-slate-300" />
      </div>
      <div className="flex flex-1 items-center justify-center px-2">
        <p className="text-center text-xl font-semibold leading-snug text-slate-900">{card.question}</p>
      </div>
      <div className="flex justify-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-forest-800 px-6 py-3 text-sm font-medium text-white shadow-md">
          <RefreshIcon className="h-4 w-4" />
          Flip Card
        </span>
      </div>
    </div>
  );
}

/* Stage 2 right card: the answer plus the three rating buttons. The card is
   a fixed-size slot, so a long answer scrolls inside it instead of spilling
   out — and it's set small and plain because it's reading material. */
function AnswerCard({ card, animation, onRate }) {
  return (
    <div className={`absolute inset-0 z-30 flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-xl ${animation}`}>
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-forest-100 px-3 py-1 text-xs font-semibold text-forest-800">Answer</span>
        <BookmarkIcon className="h-5 w-5 text-slate-300" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-2 py-4">
        <p className="whitespace-pre-wrap break-words text-center text-sm font-medium leading-relaxed text-slate-800">
          {card.answer}
        </p>
        <p className="break-words text-center text-xs text-slate-400">“{card.question}”</p>
      </div>
      <div className="flex shrink-0 flex-wrap justify-center gap-2 pt-2">
        {RATINGS.map((r) => (
          <button
            key={r.value}
            onClick={() => onRate(r.value)}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition-colors ${r.btn}`}
          >
            {r.label}
            <span className="ml-1.5 text-[10px] opacity-70">{r.key}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* Stage 3 right card: solid colour based on the rating, with a check. The
   grade stays changeable here until the next card is flipped — the buttons
   live on the colour card itself, so "wait, that was Easy not Hard" never
   needs a reload. */
function MarkedCard({ rating, onRevise }) {
  return (
    <div className="absolute inset-0 z-20 animate-pop-in" aria-live="polite">
      <div className={`absolute inset-0 translate-x-2 -translate-y-2 rounded-2xl border opacity-60 ${rating.panel}`} />
      <div className={`absolute inset-0 translate-x-1 -translate-y-1 rounded-2xl border opacity-80 ${rating.panel}`} />
      <div className={`absolute inset-0 flex flex-col items-center justify-center rounded-2xl border p-6 shadow-lg ${rating.panel}`}>
        <span className={`flex h-12 w-12 items-center justify-center rounded-full ${rating.check}`}>
          <CheckIcon className="h-6 w-6 text-white" />
        </span>
        <p className="mt-4 text-base font-semibold">Marked as {rating.label}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {RATINGS.map((r) => (
            <button
              key={r.value}
              onClick={() => onRevise(r.value)}
              disabled={r.value === rating.value}
              aria-label={`Change grade to ${r.label}`}
              className={`rounded-full border px-4 py-2 text-xs font-semibold shadow-sm transition-colors disabled:opacity-45 ${
                r.value === rating.value
                  ? `border-transparent ${r.btn}`
                  : 'border-white/70 bg-white/75 text-slate-700 hover:bg-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] opacity-70">
          Changed your mind? Pick another — until you flip the next card.
        </p>
      </div>
    </div>
  );
}

/* Stage 1 right slot: empty dashed card prompting the first flip. */
function Placeholder() {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-forest-200 bg-forest-50/40 p-6 text-center">
      <CardsIcon className="h-10 w-10 text-forest-300" />
      <p className="mt-3 text-sm text-slate-500">
        Flip a card to see
        <br />
        the answer here
      </p>
    </div>
  );
}

function RefreshIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function BookmarkIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 4h12v16l-6-4-6 4z" />
    </svg>
  );
}

function CardsIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="4" width="12" height="15" rx="2" />
      <path d="M4 7v10a2 2 0 0 0 2 2h9" />
    </svg>
  );
}

function CheckIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
