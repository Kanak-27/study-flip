// Dependency-free hover/focus tooltip. Wraps the thing it explains: the
// bubble shows on hover AND on keyboard focus (group-focus-within), so it
// never hides information from keyboard users. Use `side` when the trigger
// sits near the top edge, and `align="right"` when it sits near the right
// edge — a centred bubble there would stick out past the viewport and let
// the page scroll sideways.
export default function Tooltip({ label, children, side = 'top', align = 'center' }) {
  const vertical = side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2';
  const horizontal =
    align === 'right'
      ? 'right-0'
      : 'left-1/2 -translate-x-1/2 max-sm:left-auto max-sm:right-0 max-sm:translate-x-0';

  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`tooltip-bubble pointer-events-none absolute z-50 w-max max-w-[min(16rem,calc(100vw-2rem))] rounded-md bg-slate-900 px-2.5 py-1.5 text-left text-xs font-medium leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100 ${vertical} ${horizontal}`}
      >
        {label}
      </span>
    </span>
  );
}
