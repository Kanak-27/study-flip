import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import Tooltip from '../../components/Tooltip.jsx';

// The dashboard answers three questions in one screen: how's my habit
// doing (streak), what should I do right now (quick revision), and how do
// I compare (standings). Raw counters (due, totals, recall, reviews today)
// were dropped on request — they added noise without changing behaviour.
export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [due, setDue] = useState(null);

  useEffect(() => {
    api('/api/dashboard')
      .then(setData)
      .catch((err) => setError(err.message));
    api('/api/study/due')
      .then((d) => setDue(d.dueTotal))
      .catch(() => setDue(0));
  }, []);

  const stats = data?.stats;
  const peer = data?.peer;
  const recent = data?.recentDecks ?? [];
  const activity = data?.activity ?? [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {/* ---- action row ---- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Your dashboard</h2>
          <p className="mt-1 text-sm text-slate-500">Pick up where you left off.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/study"
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {due > 0 ? `Study now — ${due} due` : 'Study (nothing due)'}
          </Link>
          <Tooltip label="Turn a PDF into flashcards with AI." side="bottom">
            <Link
              to="/upload"
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Upload PDF
            </Link>
          </Tooltip>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* ---- the streak: the loudest block on the page ---- */}
      <StreakBanner stats={stats} activity={activity} />

      {/* ---- quick revision, explained ---- */}
      <QuickRevision />

      {/* ---- standings: the scoreboard ---- */}
      <Standings peer={peer} stats={stats} />

      {/* ---- what I made recently ---- */}
      <section className="mt-8">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-slate-900">Recent decks</h3>
          <Tooltip
            label="The three decks you created most recently. The file name is the PDF they came from; ‘Manual deck’ means you built it yourself."
            side="bottom"
          >
            <button
              type="button"
              aria-label="About recent decks"
              className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold text-slate-400 hover:border-forest-600 hover:text-forest-700"
            >
              ?
            </button>
          </Tooltip>
          <Link to="/decks" className="ml-auto text-sm font-medium text-forest-800 hover:underline">
            View all decks
          </Link>
        </div>

        {recent.length === 0 ? (
          <div className="mt-3 rounded-xl border-2 border-dashed border-slate-200 bg-white p-8 text-center">
            <p className="text-sm text-slate-500">
              No decks yet — upload a PDF and AI will turn it into flashcards.
            </p>
            <Link to="/upload" className="btn-primary mt-4">
              Upload your first PDF
            </Link>
          </div>
        ) : (
          <ul className="mt-3 grid gap-4 sm:grid-cols-3">
            {recent.map((deck) => (
              <li key={deck.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    to={`/decks/${deck.id}`}
                    className="font-medium leading-snug text-slate-900 hover:text-forest-800"
                  >
                    {deck.title}
                  </Link>
                  {deck.createdToday && (
                    <span className="shrink-0 rounded-full bg-forest-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-forest-800">
                      Today
                    </span>
                  )}
                </div>
                <p className="mt-2 flex items-center gap-1.5 truncate text-xs text-slate-500">
                  <DocIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">{deck.documentFilename ?? 'Manual deck'}</span>
                </p>
                <p className="mt-auto pt-2 text-xs text-slate-400">
                  {deck.cardCount} card{deck.cardCount === 1 ? '' : 's'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- the numbers ---- */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-slate-900">Last 30 days</h3>
            <Tooltip
              label="Reviews per day. Taller bars mean more cards graded; the shade shows how many you recalled."
              side="bottom"
            >
              <button
                type="button"
                aria-label="About this chart"
                className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold text-slate-400 hover:border-forest-600 hover:text-forest-700"
              >
                ?
              </button>
            </Tooltip>
          </div>
          {activity.length ? (
            <ActivityChart activity={activity} />
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              No reviews yet.{' '}
              <Link to="/study?mode=quick" className="text-forest-800 hover:underline">
                Start a quick revision
              </Link>{' '}
              to build your streak.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

// The habit, turned up to eleven: gradient banner, oversized number, and
// the last seven days as dots so "streak" is something you can see rather
// than a tile you scroll past.
function StreakBanner({ stats, activity }) {
  if (!stats) {
    return <div className="mt-6 h-32 animate-pulse rounded-2xl bg-slate-100" />;
  }

  const days = stats.streakDays;
  const dots = lastSevenDays(activity);

  return (
    <section className="mt-6 overflow-hidden rounded-2xl bg-gradient-to-br from-forest-700 via-forest-800 to-forest-900 p-6 text-white shadow-lg sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <span
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20 sm:h-20 sm:w-20 ${
              days > 0 ? 'animate-pulse' : ''
            }`}
          >
            <FlameIcon className="h-8 w-8 text-amber-400 sm:h-10 sm:w-10" />
          </span>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-forest-200">
              Your streak
              <Tooltip
                label="Consecutive days with at least one review. Review once today to keep it alive."
                side="bottom"
              >
                <button
                  type="button"
                  aria-label="How the streak works"
                  className="ml-2 inline-flex h-4 w-4 items-center justify-center rounded-full border border-forest-500 text-[10px] font-bold text-forest-200 hover:border-forest-300 hover:text-white"
                >
                  ?
                </button>
              </Tooltip>
            </p>

            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-5xl font-black leading-none tracking-tight sm:text-6xl">
                {days}
              </span>
              <span className="text-sm font-semibold uppercase tracking-wide text-forest-200">
                day{days === 1 ? '' : 's'} running
              </span>
            </p>

            <p className="mt-2 max-w-md text-sm text-forest-100">
              {days > 0
                ? 'Reviewed on consecutive days. One session today keeps it alive.'
                : 'No streak yet — review a few cards today and this number starts climbing.'}
            </p>
          </div>
        </div>

        <ul className="flex gap-2" aria-label="Reviews on each of the last seven days">
          {dots.map((dot) => (
            <li key={dot.key} className="flex flex-col items-center gap-1">
              <Tooltip
                label={
                  dot.reviews > 0
                    ? `${dot.key}: ${dot.reviews} review${dot.reviews === 1 ? '' : 's'}`
                    : `${dot.key}: no reviews`
                }
                side="top"
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                    dot.reviews > 0
                      ? 'bg-amber-400 text-forest-900'
                      : 'bg-white/10 text-forest-200'
                  } ${dot.isToday ? 'ring-2 ring-white/70' : ''}`}
                >
                  {dot.reviews > 0 ? <CheckIcon className="h-4 w-4" /> : '·'}
                </span>
              </Tooltip>
              <span className="text-[10px] font-medium uppercase text-forest-300">{dot.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// The last seven UTC days, oldest first, aligned with the day buckets the
// server uses for the activity chart ($dateToString in UTC).
function lastSevenDays(activity) {
  const reviewsByDate = new Map(activity.map((a) => [a.date, a.reviews]));
  const DAY_MS = 24 * 60 * 60 * 1000;
  const dots = [];
  for (let i = 6; i >= 0; i--) {
    const key = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
    dots.push({
      key,
      reviews: reviewsByDate.get(key) ?? 0,
      label: 'SMTWTFS'[new Date(`${key}T00:00:00Z`).getUTCDay()],
      isToday: i === 0,
    });
  }
  return dots;
}

// Quick revision gets its own section because a button alone never explains
// what the feature is: what it draws from, how long it takes, and that it
// needs no setup.
function QuickRevision() {
  return (
    <section className="mt-6 flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-slate-200 bg-white p-6 sm:p-7">
      <div className="flex min-w-0 items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-forest-100 text-forest-800">
          <BoltIcon className="h-6 w-6" />
        </span>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-900">Quick revision</h3>
            <Tooltip
              label="A five-minute refresher: 10 random cards drawn from decks you created in the last 7 days."
              side="bottom"
            >
              <button
                type="button"
                aria-label="What is quick revision?"
                className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-bold text-slate-400 hover:border-forest-600 hover:text-forest-700"
              >
                ?
              </button>
            </Tooltip>
          </div>

          <p className="mt-1 max-w-xl text-sm text-slate-600">
            A short session for material you made recently. We shuffle 10 cards from decks you
            created in the last 7 days — no deck to pick, no schedule to follow. Just flip,
            answer, and keep the streak alive.
          </p>

          <ul className="mt-3 flex flex-wrap gap-2 text-xs font-medium text-slate-600">
            <li className="rounded-full bg-slate-100 px-2.5 py-1">10 random cards</li>
            <li className="rounded-full bg-slate-100 px-2.5 py-1">Decks from the last 7 days</li>
            <li className="rounded-full bg-slate-100 px-2.5 py-1">≈ 5 minutes</li>
            <li className="rounded-full bg-slate-100 px-2.5 py-1">No setup</li>
          </ul>
        </div>
      </div>

      <Link to="/study?mode=quick" className="btn-primary shrink-0">
        <BoltIcon className="h-4 w-4" />
        Start quick revision
      </Link>
    </section>
  );
}

// The scoreboard: rank among students who studied this week, plus the
// numbers that move it. Counts only — we never show who the others are.
function Standings({ peer, stats }) {
  if (!peer || !stats) {
    return <div className="mt-6 h-24 animate-pulse rounded-2xl bg-slate-100" />;
  }

  return (
    <section className="mt-6 rounded-2xl border border-forest-800 bg-forest-800 p-5 text-white sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-forest-300">
            This week's standings
            <Tooltip
              label="Ranks your review count against every other student who reviewed in the last 7 days. Only counts are compared — nobody sees who anyone is."
              side="bottom"
            >
              <button
                type="button"
                aria-label="How standings are calculated"
                className="ml-2 inline-flex h-4 w-4 items-center justify-center rounded-full border border-forest-500 text-[10px] font-bold text-forest-200 hover:border-forest-300 hover:text-white"
              >
                ?
              </button>
            </Tooltip>
          </p>
          <p className="mt-1.5 text-lg font-semibold leading-snug">{headline(peer)}</p>
        </div>

        <div className="flex shrink-0 gap-6 text-center">
          <Metric
            label="Reviews"
            value={peer.reviewsThisWeek}
            tip="Cards graded in the last 7 days."
          />
          <Metric
            label="Streak"
            value={`${stats.streakDays}d`}
            tip="Consecutive days with at least one review."
          />
        </div>
      </div>
    </section>
  );
}

function headline(peer) {
  if (peer.rank === null) {
    return peer.studentsActive > 0
      ? `No reviews yet this week — ${peer.studentsActive} student${peer.studentsActive === 1 ? ' is' : 's are'} already studying. A quick revision puts you on the board.`
      : 'Nobody has reviewed this week yet — be the first on the board.';
  }
  if (peer.studentsActive < 2) return "You're the only one on the board this week — set the pace.";
  if (peer.percentile >= 50) return `You're ahead of ${peer.percentile}% of students this week — keep the streak alive.`;
  return `Rank #${peer.rank} of ${peer.studentsActive} this week — ${peer.percentile}% of students are ahead. Two sessions closes the gap.`;
}

function Metric({ label, value, tip }) {
  return (
    <Tooltip label={tip} side="bottom">
      <div className="cursor-default rounded-xl bg-forest-700/60 px-3.5 py-2">
        <div className="text-lg font-bold leading-tight">{value}</div>
        <div className="text-[11px] font-medium text-forest-200">{label}</div>
      </div>
    </Tooltip>
  );
}

// Simple CSS bar chart — no charting dependency for six numbers a week.
function ActivityChart({ activity }) {
  const max = Math.max(...activity.map((a) => a.reviews), 1);
  return (
    <div className="mt-4 flex h-40 items-end gap-1">
      {activity.map((day) => (
        <div
          key={day.date}
          title={`${day.date}: ${day.reviews} reviews, ${day.recalled} recalled`}
          className="group flex-1 rounded-t bg-forest-400 transition-colors hover:bg-forest-600"
          style={{ height: `${Math.max((day.reviews / max) * 100, 4)}%` }}
        />
      ))}
    </div>
  );
}

function BoltIcon({ className }) {
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
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

function FlameIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2c1 3.5-1 5.5-2.5 7C8 10.5 7 12 7 14a5 5 0 0 0 10 0c0-2.2-1.1-3.9-2.3-5.4-.4 1-1.1 1.7-2 2.1.6-2.6-.4-6.2-2.7-8.7z" />
    </svg>
  );
}

function CheckIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function DocIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}
