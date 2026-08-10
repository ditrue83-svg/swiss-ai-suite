import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { toUserMessage } from '@/lib/errors';
import { useT } from '@/i18n';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';

export function LoginPage() {
  const t = useT();
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
            <div className="brand-name">{t('brand.name')}</div>
            <div className="brand-sub">{t('brand.tagline')}</div>
          </div>
        </div>
        <div className="auth-title">{t('auth.login.title')}</div>
        <div className="auth-sub">{t('auth.login.subtitle')}</div>

        {error && <div className="form-error"><Icon name="alert" className="ic-sm" /><span>{error}</span></div>}

        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="login-email">{t('auth.emailLabel')}</label>
            <input id="login-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('auth.emailPlaceholder')} />
          </div>
          <div className="field">
            <label htmlFor="login-password">{t('auth.passwordLabel')}</label>
            <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <div className="auth-actions">
            <button className="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting || undefined}>
              {submitting ? <span className="spinner" aria-hidden="true" /> : null} {t('auth.login.submit')}
            </button>
          </div>
        </form>

        <div className="auth-alt">
          <Link className="btn-link" to="/forgot-password">{t('auth.login.forgot')}</Link>
        </div>
        <div className="auth-alt">
          {t('auth.login.noAccount')} <Link className="btn-link" to="/register">{t('auth.login.createAccount')}</Link>
        </div>
        {/* La lingua si sceglie PRIMA di accedere: chi non legge l'italiano
            deve poter capire la schermata di accesso. */}
        <div className="mt-4" style={{ display: 'flex', justifyContent: 'center' }}>
          <LanguageSwitcher compact />
        </div>
      </div>
    </div>
  );
}
