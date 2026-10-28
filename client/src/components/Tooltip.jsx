// Dependency-free hover/focus tooltip. Wraps the thing it explains: the
// bubble shows on hover AND on keyboard focus (group-focus-within), so it
// never hides information from keyboard users. Use `side` when the trigger
// sits near the top edge.
export default function Tooltip({ label, children, side = 'top' }) {
  const position =
    side === 'top'
      ? 'bottom-full left-1/2 mb-2 -translate-x-1/2'
      : 'top-full left-1/2 mt-2 -translate-x-1/2';

  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 w-max max-w-[16rem] rounded-md bg-slate-900 px-2.5 py-1.5 text-left text-xs font-medium leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100 ${position}`}
      >
        {label}
      </span>
    </span>
  );
}
