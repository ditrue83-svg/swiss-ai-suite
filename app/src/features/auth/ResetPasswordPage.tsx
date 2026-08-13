// Pagina di reimpostazione: raggiunta dal link email (Supabase apre una sessione
// di recovery). L'utente imposta la nuova password.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { BrandMark } from '@/components/ui/BrandMark';
import { toUserMessage } from '@/lib/errors';
import { useT } from '@/i18n';

export function ResetPasswordPage() {
  const t = useT();
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
    if (password.length < 8) { setError(t('auth.errors.passwordShort')); return; }
    if (password !== confirm) { setError(t('auth.passwordsDiffer')); return; }
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
          <BrandMark />
        </div>
        <div className="auth-title">{t('auth.reset.title')}</div>
        <div className="auth-sub">{t('auth.reset.subtitle')}</div>

        {!session && <div className="info-box mb-14">{t('auth.openFromLink')}</div>}
        {error && <div className="form-error"><Icon name="alert" className="ic-sm" /><span>{error}</span></div>}
        {done ? (
          <div className="form-success">{t('auth.redirecting')}</div>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="rp-pass">{t('auth.reset.newPassword')}</label>
              <input id="rp-pass" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('auth.passwordPlaceholder')} />
            </div>
            <div className="field">
              <label htmlFor="rp-conf">{t('auth.confirmPassword')}</label>
              <input id="rp-conf" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <div className="auth-actions">
              <button className="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting || undefined}>
                {submitting ? <span className="spinner" aria-hidden="true" /> : null} {t('auth.reset.submit')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
