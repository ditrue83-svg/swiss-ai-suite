import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { BrandMark } from '@/components/ui/BrandMark';
import { Input } from '@/components/ui/forms';
import { toUserMessage } from '@/lib/errors';
import { useT } from '@/i18n';

export function ForgotPasswordPage() {
  const t = useT();
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
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
        <div className="auth-title">{t('auth.forgot.title')}</div>
        <div className="auth-sub">{t('auth.forgot.subtitle')}</div>

        {error && <div className="form-error"><Icon name="alert" className="ic-sm" /><span>{error}</span></div>}
        {sent ? (
          <div className="form-success">
            {t('auth.forgot.sent')}
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <Input id="fp-email" label={t('auth.emailLabel')} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('auth.emailPlaceholder')} />
            <div className="auth-actions">
              <button className="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting || undefined}>
                {submitting ? <span className="spinner" aria-hidden="true" /> : null} {t('auth.forgot.submit')}
              </button>
            </div>
          </form>
        )}

        <div className="auth-alt"><Link className="btn-link" to="/login">← {t('auth.forgot.backToLogin')}</Link></div>
      </div>
    </div>
  );
}
