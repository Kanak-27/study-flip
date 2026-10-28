import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { AuthCard, ErrorNote, Field, SubmitButton } from './AuthLayout.jsx';

export default function RegisterPage() {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register({ name, email, password });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Create your account">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" value={name} onChange={setName} required />
        {/* trimmed as you type — matches the server, and keeps the browser's
            type=email validation from silently blocking a pasted address */}
        <Field label="Email" type="email" value={email} onChange={(v) => setEmail(v.trim())} required />
        <Field label="Password" type="password" value={password} onChange={setPassword} required hint="At least 8 characters" />
        {error && <ErrorNote>{error}</ErrorNote>}
        <SubmitButton busy={busy}>Create account</SubmitButton>
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
