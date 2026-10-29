// Small shared pieces for the login/register forms. Kept in one file on
// purpose — they exist only to keep the two pages readable.
import { Link } from 'react-router-dom';

export function AuthCard({ title, children }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4">
      <Link to="/" className="mb-8 text-2xl font-black tracking-tight text-slate-900">
        studyflip<span className="text-forest-800">.</span>
      </Link>
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-center text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, type = 'text', value, onChange, required, hint, ...rest }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-forest-700 focus:outline-none focus:ring-1 focus:ring-forest-700"
      />
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ children }) {
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {children}
    </p>
  );
}

export function SubmitButton({ busy, children }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full rounded-full bg-forest-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-forest-700 disabled:opacity-60"
    >
      {busy ? 'Working…' : children}
    </button>
  );
}
