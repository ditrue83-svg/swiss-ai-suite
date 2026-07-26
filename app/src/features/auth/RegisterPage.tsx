import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { toUserMessage } from '@/lib/errors';
import { useT } from '@/i18n';

export function RegisterPage() {
  const t = useT();
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
      setError(t('auth.errors.passwordShort'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await signUp({ firstName, lastName, email, password });
      if (res.needsEmailConfirmation) {
        setInfo(t('auth.register.checkEmail'));
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
            <div className="brand-name">{t('brand.name')}</div>
            <div className="brand-sub">{t('brand.tagline')}</div>
          </div>
        </div>
        <div className="auth-title">{t('auth.register.title')}</div>
        <div className="auth-sub">{t('auth.register.subtitle')}</div>

        {error && <div className="form-error"><Icon name="alert" className="ic-sm" /><span>{error}</span></div>}
        {info && <div className="form-success">{info}</div>}

        <form onSubmit={onSubmit} noValidate>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="reg-first">{t('auth.register.firstName')}</label>
              <input id="reg-first" autoComplete="given-name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder={t('auth.register.firstNamePlaceholder')} />
            </div>
            <div className="field">
              <label htmlFor="reg-last">{t('auth.register.lastName')}</label>
              <input id="reg-last" autoComplete="family-name" required value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder={t('auth.register.lastNamePlaceholder')} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="reg-email">{t('auth.emailLabel')}</label>
            <input id="reg-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('auth.emailPlaceholder')} />
          </div>
          <div className="field">
            <label htmlFor="reg-password">{t('auth.passwordLabel')}</label>
            <input id="reg-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('auth.passwordPlaceholder')} />
            <span className="field-hint">{t('auth.register.passwordHint')}</span>
          </div>
          <div className="auth-actions">
            <button className="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting || undefined}>
              {submitting ? <span className="spinner" aria-hidden="true" /> : null} {t('auth.register.submit')}
            </button>
          </div>
        </form>

        <div className="auth-alt">
          {t('auth.register.haveAccount')} <Link className="btn-link" to="/login">{t('auth.register.goToLogin')}</Link>
        </div>
      </div>
    </div>
  );
}
