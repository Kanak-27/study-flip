import { useState } from 'react';

// Shared show/hide control for password fields. The button lives inside the
// field's <label>, so the click is preventDefault-ed — otherwise the label's
// activation behaviour would also fire (moving focus, re-selecting the input)
// alongside the toggle.
export function useShowPassword() {
  const [shown, setShown] = useState(false);
  const toggle = () => setShown((value) => !value);
  return { shown, type: shown ? 'text' : 'password', toggle };
}

export function ShowPasswordButton({ shown, onToggle }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        onToggle();
      }}
      aria-label={shown ? 'Hide password' : 'Show password'}
      aria-pressed={shown}
      title={shown ? 'Hide password' : 'Show password'}
      className="absolute inset-y-0 right-1.5 flex items-center px-1 text-slate-400 hover:text-slate-600 focus:outline-none"
    >
      {shown ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
    </button>
  );
}

function EyeIcon({ className }) {
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
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

function EyeOffIcon({ className }) {
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
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.75" />
      <path d="M4 4l16 16" />
    </svg>
  );
}
