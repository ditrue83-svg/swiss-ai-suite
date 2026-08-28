import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { BrandMark } from '@/components/ui/BrandMark';
import { Input } from '@/components/ui/forms';
import { toUserMessage } from '@/lib/errors';
import { useT } from '@/i18n';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import styles from './auth.module.css';

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
          <BrandMark />
        </div>
        <div className="auth-title">{t('auth.login.title')}</div>
        <div className="auth-sub">{t('auth.login.subtitle')}</div>

        {error && <div className="form-error"><Icon name="alert" className="ic-sm" /><span>{error}</span></div>}

        <form onSubmit={onSubmit} noValidate>
          <Input id="login-email" label={t('auth.emailLabel')} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('auth.emailPlaceholder')} />
          <Input id="login-password" label={t('auth.passwordLabel')} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          <div className={styles.authActions}>
            <button className="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting || undefined}>
              {submitting ? <span className="spinner" aria-hidden="true" /> : null} {t('auth.login.submit')}
            </button>
          </div>
        </form>

        <div className={styles.authAlt}>
          <Link className="btn-link" to="/forgot-password">{t('auth.login.forgot')}</Link>
        </div>
        <div className={styles.authAlt}>
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
