import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import UpgradeCard from '../billing/UpgradeCard.jsx';

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

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
    <h2 className="text-xl font-semibold text-slate-900">Your dashboard</h2>

      {error && (
        <p role="alert" className="mt-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          to="/study"
          className="rounded-md bg-forest-800 px-4 py-2 text-sm font-medium text-white hover:bg-forest-700"
        >
          {due > 0 ? `Study now — ${due} due` : 'Study (nothing due)'}
        </Link>
        <Link
          to="/decks"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          My decks
        </Link>
        <Link
          to="/upload"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Upload PDF
        </Link>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile label="Decks" value={stats?.decks} />
        <StatTile label="Flashcards" value={stats?.flashcards} />
        <StatTile label="Due today" value={stats?.dueToday} />
        <StatTile label="Reviews today" value={stats?.reviewsToday} />
        <StatTile label="Recall accuracy" value={stats?.recallAccuracy} suffix="%" />
        <StatTile label="Day streak" value={stats?.streakDays} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-medium text-slate-900">Last 30 days</h3>
          {data?.activity?.length ? (
            <ActivityChart activity={data.activity} />
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              No reviews yet. <Link to="/study" className="text-forest-800 hover:underline">Start a session</Link> to build your streak.
            </p>
          )}
        </div>
        <UpgradeCard />
      </div>
    </main>
  );
}

function StatTile({ label, value, suffix = '' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="text-2xl font-semibold text-slate-900">
        {value === null || value === undefined ? '—' : `${value}${suffix}`}
      </div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
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
