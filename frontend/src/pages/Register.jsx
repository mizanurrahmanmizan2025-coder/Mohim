import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AuthLayout from './AuthLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) return setError('Password must be at least 8 characters');
    if (form.password !== form.confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      await register(form.name, form.email, form.password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Create your account" subtitle="Get started with Custom AI Suite">
      <form onSubmit={submit} className="space-y-4">
        <input className="input" required placeholder="Full name" value={form.name} onChange={set('name')} autoComplete="name" />
        <input className="input" type="email" required placeholder="Email" value={form.email} onChange={set('email')} autoComplete="email" />
        <input className="input" type="password" required placeholder="Password (min 8 characters)" value={form.password} onChange={set('password')} autoComplete="new-password" />
        <input className="input" type="password" required placeholder="Confirm password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-300">{error}</p>}
        <button className="btn-primary w-full py-3" disabled={busy}>
          {busy && <Loader2 size={16} className="animate-spin" />} Create account
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-gray-500">
        Already have an account? <Link to="/login" className="font-medium text-blue-600 hover:underline dark:text-blue-400">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
