import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { toUserMessage } from '@/lib/errors';

export function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setInfo(null);
    if (password.length < 8) {
      setError('La password deve avere almeno 8 caratteri.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await signUp({ firstName, lastName, email, password });
      if (res.needsEmailConfirmation) {
        setInfo('Account creato. Ti abbiamo inviato un’email di conferma: verificala, poi effettua l’accesso.');
        setSubmitting(false);
      } else {
        // Sessione già attiva → onboarding gestito dal routing.
        navigate('/', { replace: true });
      }
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
        <div className="auth-title">Crea account</div>
        <div className="auth-sub">Bastano pochi dati per iniziare.</div>

        {error && <div className="form-error"><Icon name="alert" className="ic-sm" /><span>{error}</span></div>}
        {info && <div className="form-success">{info}</div>}

        <form onSubmit={onSubmit} noValidate>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="reg-first">Nome</label>
              <input id="reg-first" autoComplete="given-name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Mario" />
            </div>
            <div className="field">
              <label htmlFor="reg-last">Cognome</label>
              <input id="reg-last" autoComplete="family-name" required value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Rossi" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="reg-email">Email</label>
            <input id="reg-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@azienda.ch" />
          </div>
          <div className="field">
            <label htmlFor="reg-password">Password</label>
            <input id="reg-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Almeno 8 caratteri" />
            <span className="field-hint">Usa almeno 8 caratteri.</span>
          </div>
          <div className="auth-actions">
            <button className="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting || undefined}>
              {submitting ? <span className="spinner" aria-hidden="true" /> : null} Crea account
            </button>
          </div>
        </form>

        <div className="auth-alt">
          Hai già un account? <Link className="btn-link" to="/login">Accedi</Link>
        </div>
      </div>
    </div>
  );
}
