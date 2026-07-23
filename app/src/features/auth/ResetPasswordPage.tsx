// Pagina di reimpostazione: raggiunta dal link email (Supabase apre una sessione
// di recovery). L'utente imposta la nuova password.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { toUserMessage } from '@/lib/errors';

export function ResetPasswordPage() {
  const { updatePassword, session } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (password.length < 8) { setError('La password deve avere almeno 8 caratteri.'); return; }
    if (password !== confirm) { setError('Le due password non coincidono.'); return; }
    setSubmitting(true);
    try {
      await updatePassword(password);
      setDone(true);
      setTimeout(() => navigate('/', { replace: true }), 1200);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="centered-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark" aria-hidden="true"><Icon name="logo" /></div>
          <div><div className="brand-name">SwissAI Suite</div><div className="brand-sub">per le PMI svizzere</div></div>
        </div>
        <div className="auth-title">Nuova password</div>
        <div className="auth-sub">Scegli una nuova password per il tuo account.</div>

        {!session && <div className="info-box mb-14">Apri questa pagina dal link ricevuto via email per reimpostare la password.</div>}
        {error && <div className="form-error"><Icon name="alert" className="ic-sm" /><span>{error}</span></div>}
        {done ? (
          <div className="form-success">Password aggiornata. Ti stiamo reindirizzando…</div>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="rp-pass">Nuova password</label>
              <input id="rp-pass" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Almeno 8 caratteri" />
            </div>
            <div className="field">
              <label htmlFor="rp-conf">Conferma password</label>
              <input id="rp-conf" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <div className="auth-actions">
              <button className="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting || undefined}>
                {submitting ? <span className="spinner" aria-hidden="true" /> : null} Salva password
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
