import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { AuthCard, ErrorNote, Field, SubmitButton } from './AuthLayout.jsx';

export default function RegisterPage() {
  const { startRegistration, completeRegistration, config } = useAuth();
  const [step, setStep] = useState('details');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [devCode, setDevCode] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onSubmitDetails = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await startRegistration({ name, email, password });
      setDevCode(data.devCode ?? null);
      setStep('code');
      setBusy(false);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const onSubmitCode = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await completeRegistration({ email, otp });
      // the router redirect takes over once user is set
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  // Re-running step one is also the resend path: the server reuses the pending
  // challenge and enforces the 60-second cooldown itself.
  const onResend = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const data = await startRegistration({ name, email, password });
      setDevCode(data.devCode ?? null);
      setNotice('A new code is on its way.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'code') {
    return (
      <AuthCard title="Check your email">
        <form onSubmit={onSubmitCode} className="space-y-4">
          <p className="text-sm text-slate-600">
            We sent a 6-digit code to <span className="font-medium text-slate-900">{email}</span>.
            Enter it below to finish creating your account.
          </p>
          <Field
            label="Verification code"
            value={otp}
            onChange={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            hint="The code expires in 10 minutes."
          />
          {devCode && (
            <p className="rounded-md bg-forest-50 px-3 py-2 text-sm text-forest-800">
              Development mode — email is not configured, so your code is{' '}
              <span className="font-mono font-semibold">{devCode}</span>.
            </p>
          )}
          {notice && <p className="text-sm text-slate-500">{notice}</p>}
          {error && <ErrorNote>{error}</ErrorNote>}
          <SubmitButton busy={busy}>Create account</SubmitButton>
        </form>
        <div className="mt-6 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => {
              setStep('details');
              setOtp('');
              setError(null);
              setNotice(null);
            }}
            className="text-slate-500 hover:text-forest-800"
          >
            Change details
          </button>
          <button
            type="button"
            onClick={onResend}
            disabled={busy}
            className="font-medium text-forest-800 hover:text-forest-700 disabled:opacity-60"
          >
            Resend code
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your account">
      {config.signupsEnabled === false && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          New signups are paused right now. Please check back later.
        </p>
      )}
      <form onSubmit={onSubmitDetails} className="space-y-4">
        <Field label="Name" value={name} onChange={setName} required autoComplete="name" />
        {/* trimmed as you type — matches the server, and keeps the browser's
            type=email validation from silently blocking a pasted address */}
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(v) => setEmail(v.trim())}
          required
          autoComplete="email"
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          required
          autoComplete="new-password"
          hint="At least 8 characters"
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        <SubmitButton busy={busy}>Continue</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-forest-800 hover:text-forest-700">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
