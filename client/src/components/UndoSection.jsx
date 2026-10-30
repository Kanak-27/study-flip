import { useCallback, useEffect, useState } from 'react';

// Every deletion is undoable for 30 seconds. The page keeps a section in the
// place of the item it removed; the restore call behind Undo puts it back.
// Once the window closes the section disappears and the delete stands.
export const UNDO_WINDOW_MS = 30_000;

// Tracks the items a page has deleted but not yet given up on: id -> {
// item, index, expiresAt } — what was deleted, where it sat, and until when
// the undo section may stay.
export function useUndoableDeletes() {
  const [entries, setEntries] = useState({});
  const [now, setNow] = useState(() => Date.now());
  const active = Object.keys(entries).length > 0;

  // One clock per page: ticks the countdown while a section is open and drops
  // each section the moment it expires.
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setEntries((current) => {
        const kept = {};
        for (const [id, entry] of Object.entries(current)) {
          if (entry.expiresAt > t) kept[id] = entry;
        }
        return Object.keys(kept).length === Object.keys(current).length ? current : kept;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);

  const mark = useCallback((id, item, index) => {
    const t = Date.now();
    setNow(t);
    setEntries((current) => ({
      ...current,
      [id]: { item, index, expiresAt: t + UNDO_WINDOW_MS },
    }));
  }, []);

  const clear = useCallback((id) => {
    setEntries((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const secondsLeft = useCallback(
    (id) => {
      const entry = entries[id];
      if (!entry) return 0;
      return Math.max(0, Math.ceil((entry.expiresAt - now) / 1000));
    },
    [entries, now],
  );

  return { entries, mark, clear, secondsLeft };
}

// Merges pending deletions back into a (possibly re-fetched) list at the
// position each item occupied, tagged with `.undoSection`, so a page renders
// one array and branches on that tag. Items still present get tagged in
// place; ones the server no longer returns are spliced back in at their old
// spot. Once an entry expires it is simply gone — along with the item.
export function withUndoSections(items, entries) {
  const pending = Object.values(entries);
  if (pending.length === 0) return items;

  const present = new Set(items.map((item) => item.id));
  const merged = items.map((item) =>
    entries[item.id] ? { ...item, undoSection: entries[item.id] } : item,
  );
  pending
    .filter((entry) => !present.has(entry.item.id))
    .sort((a, b) => a.index - b.index)
    .forEach((entry, i) => {
      merged.splice(Math.min(entry.index + i, merged.length), 0, {
        ...entry.item,
        undoSection: entry,
      });
    });
  return merged;
}

// The section itself: shown where the deleted item used to be, with a live
// countdown of the time left to undo.
export default function UndoSection({ label, secondsLeft, onUndo }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="min-w-0 break-words text-sm font-medium text-slate-500">
        {label} deleted
      </p>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-xs tabular-nums text-slate-400" aria-label="Time left to undo">
          {secondsLeft}s
        </span>
        <button
          type="button"
          onClick={onUndo}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Undo
        </button>
      </div>
    </div>
  );
}
