import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { toUserMessage } from '@/lib/errors';

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await signIn({ email, password });
      navigate(from, { replace: true });
    } catch (err) {
      setError(toUserMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="centered-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark" aria-hidden="true"><Icon name="logo" /></div>
          <div>
            <div className="brand-name">SwissAI Suite</div>
            <div className="brand-sub">per le PMI svizzere</div>
          </div>
        </div>
        <div className="auth-title">Accedi</div>
        <div className="auth-sub">Entra nel tuo spazio di lavoro amministrativo.</div>

        {error && <div className="form-error"><Icon name="alert" className="ic-sm" /><span>{error}</span></div>}

        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input id="login-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@azienda.ch" />
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <div className="auth-actions">
            <button className="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting || undefined}>
              {submitting ? <span className="spinner" aria-hidden="true" /> : null} Accedi
            </button>
          </div>
        </form>

        <div className="auth-alt">
          <Link className="btn-link" to="/forgot-password">Password dimenticata?</Link>
        </div>
        <div className="auth-alt">
          Non hai un account? <Link className="btn-link" to="/register">Crea account</Link>
        </div>
      </div>
    </div>
  );
}
