import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { AuthCard, ErrorNote, Field, SubmitButton } from './AuthLayout.jsx';

export default function LoginPage() {
  const { login, verifyTwoFactor } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // null = password step, true = waiting for the authenticator/recovery code.
  const [twoFactor, setTwoFactor] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onSubmitPassword = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await login(email, password);
      if (data.twoFactorRequired) {
        setTwoFactor(true);
        setBusy(false);
        return;
      }
      // the router redirect takes over once user is set
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
      await verifyTwoFactor(code);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (twoFactor) {
    return (
      <AuthCard title="Two-factor check">
        <form onSubmit={onSubmitCode} className="space-y-4">
          <p className="text-sm text-slate-600">
            Enter the 6-digit code from your authenticator app. You can also use one of your
            recovery codes.
          </p>
          <Field
            label="Authentication code"
            value={code}
            onChange={(v) => setCode(v.replace(/\s/g, ''))}
            autoFocus
            required
          />
          {error && <ErrorNote>{error}</ErrorNote>}
          <SubmitButton busy={busy}>Verify and sign in</SubmitButton>
        </form>
        <button
          type="button"
          onClick={() => {
            setTwoFactor(false);
            setCode('');
            setError(null);
          }}
          className="mt-6 w-full text-center text-sm text-slate-500 hover:text-forest-800"
        >
          Back to password
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Welcome back">
      <form onSubmit={onSubmitPassword} className="space-y-4">
        {/* trim as you type: the server trims too, and a pasted trailing
            space would otherwise make the browser reject the whole submit */}
        <Field label="Email" type="email" value={email} onChange={(v) => setEmail(v.trim())} required />
        <Field label="Password" type="password" value={password} onChange={setPassword} required />
        {error && <ErrorNote>{error}</ErrorNote>}
        <SubmitButton busy={busy}>Sign in</SubmitButton>
      </form>
      <p className="mt-4 text-center text-sm">
        <Link to="/forgot-password" className="text-slate-500 hover:text-forest-800">
          Forgot your password?
        </Link>
      </p>
      <p className="mt-2 text-center text-sm text-slate-500">
        No account yet?{' '}
        <Link to="/register" className="font-medium text-forest-800 hover:text-forest-700">
          Create one
        </Link>
      </p>
    </AuthCard>
  );
}
