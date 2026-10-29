import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { AuthCard, ErrorNote, Field, SubmitButton } from './AuthLayout.jsx';

export default function ForgotPasswordPage() {
  const { forgotPassword, resetPassword } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [devCode, setDevCode] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmitEmail = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await forgotPassword(email);
      setDevCode(data?.devCode ?? null);
      setStep('reset');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onSubmitReset = async (e) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword({ email, otp, password });
      setDone(true);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const onResend = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const data = await forgotPassword(email);
      setDevCode(data?.devCode ?? null);
      setNotice('A new code is on its way.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthCard title="Password changed">
        <p className="text-sm text-slate-600">
          Your password has been reset. All other sessions were signed out.
        </p>
        <button
          type="button"
          onClick={() => navigate('/login', { replace: true })}
          className="mt-6 w-full rounded-full bg-forest-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-forest-700"
        >
          Sign in with the new password
        </button>
      </AuthCard>
    );
  }

  if (step === 'reset') {
    return (
      <AuthCard title="Choose a new password">
        <form onSubmit={onSubmitReset} className="space-y-4">
          <p className="text-sm text-slate-600">
            If an account exists for <span className="font-medium text-slate-900">{email}</span>,
            we sent it a 6-digit code.
          </p>
          <Field
            label="Reset code"
            value={otp}
            onChange={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
          />
          <Field
            label="New password"
            type="password"
            value={password}
            onChange={setPassword}
            required
            autoComplete="new-password"
            hint="At least 8 characters"
          />
          <Field
            label="Confirm new password"
            type="password"
            value={confirm}
            onChange={setConfirm}
            required
            autoComplete="new-password"
          />
          {devCode && (
            <p className="rounded-md bg-forest-50 px-3 py-2 text-sm text-forest-800">
              Development mode — email is not configured, so your code is{' '}
              <span className="font-mono font-semibold">{devCode}</span>.
            </p>
          )}
          {notice && <p className="text-sm text-slate-500">{notice}</p>}
          {error && <ErrorNote>{error}</ErrorNote>}
          <SubmitButton busy={busy}>Reset password</SubmitButton>
        </form>
        <div className="mt-6 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => {
              setStep('email');
              setOtp('');
              setError(null);
              setNotice(null);
            }}
            className="text-slate-500 hover:text-forest-800"
          >
            Change email
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
    <AuthCard title="Forgot your password?">
      <form onSubmit={onSubmitEmail} className="space-y-4">
        <p className="text-sm text-slate-600">
          Enter the email on your account and we&apos;ll send a code to reset your password.
        </p>
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(v) => setEmail(v.trim())}
          required
          autoComplete="email"
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        <SubmitButton busy={busy}>Send reset code</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Remembered it?{' '}
        <Link to="/login" className="font-medium text-forest-800 hover:text-forest-700">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
