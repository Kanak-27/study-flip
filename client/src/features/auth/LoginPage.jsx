import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { AuthCard, ErrorNote, Field, SubmitButton } from './AuthLayout.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      // the router redirect takes over once user is set
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Welcome back">
      <form onSubmit={onSubmit} className="space-y-4">
        {/* trim as you type: the server trims too, and a pasted trailing
            space would otherwise make the browser reject the whole submit */}
        <Field label="Email" type="email" value={email} onChange={(v) => setEmail(v.trim())} required />
        <Field label="Password" type="password" value={password} onChange={setPassword} required />
        {error && <ErrorNote>{error}</ErrorNote>}
        <SubmitButton busy={busy}>Sign in</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        No account yet?{' '}
        <Link to="/register" className="font-medium text-forest-800 hover:text-forest-700">
          Create one
        </Link>
      </p>
    </AuthCard>
  );
}
