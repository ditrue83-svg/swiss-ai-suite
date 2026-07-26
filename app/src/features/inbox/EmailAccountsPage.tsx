// ============================================================================
// Account email — collegare, controllare, scollegare le caselle.
//
// Due cose che questa schermata non fa, di proposito:
//   · non mostra codici tecnici. `invalid_grant` diventa «la connessione deve
//     essere rinnovata», che è l'informazione utile (§108);
//   · non promette ciò che non avviene. Prima del consenso si elenca cosa
//     AI-Swisse potrà e non potrà fare, e l'elenco corrisponde agli scope
//     realmente richiesti — non a quelli che suonerebbero meglio (§39).
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Button, EmptyCta, ErrorState, SkeletonLine } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { useCompany } from '@/contexts/CompanyContext';
import { useI18n, useT } from '@/i18n';
import { formatDate } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { emailConnectionService, inboxErrorMessage } from '@/services/emailConnectionService';
import { INITIAL_SYNC_DAYS, INITIAL_SYNC_MAX_MESSAGES } from './constants';
import type { EmailConnection, EmailProvider } from '@/types/models';

const STATUS_KEY = {
  active: 'inbox.accounts.connected',
  reauth_required: 'inbox.accounts.reauthRequired',
  disconnected: 'inbox.accounts.disconnected',
  error: 'inbox.accounts.error',
} as const;

const STATUS_CLASS = {
  active: 'badge-neutral',
  reauth_required: 'badge-alta',
  disconnected: 'badge-neutral',
  error: 'badge-alta',
} as const;

export function EmailAccountsPage() {
  const t = useT();
  const { localeTag } = useI18n();
  const { activeCompanyId, isAdmin } = useCompany();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const companyId = activeCompanyId as string;

  const [connections, setConnections] = useState<EmailConnection[]>([]);
  const [providers, setProviders] = useState<EmailProvider[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<EmailProvider | null>(null);
  const [showConnect, setShowConnect] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, available] = await Promise.all([
        emailConnectionService.list(companyId),
        // Se il server non risponde su questo punto non si assume nulla: si
        // lascia `null`, e la schermata dice che non lo sa invece di mostrare
        // due pulsanti che potrebbero non funzionare.
        emailConnectionService.availableProviders().catch(() => null),
      ]);
      setConnections(list);
      setProviders(available);
      setError(null);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  async function connect(provider: EmailProvider) {
    setConnecting(provider);
    try {
      const url = await emailConnectionService.startConnect({ companyId, provider, returnPath: '/inbox' });
      // Il consenso avviene sul sito del provider: si lascia l'applicazione.
      window.location.assign(url);
    } catch (e) {
      showToast(toUserMessage(e));
      setConnecting(null);
    }
  }

  async function disconnect(connection: EmailConnection) {
    setBusyId(connection.id);
    try {
      const result = await emailConnectionService.disconnect(connection.id);
      setArmedId(null);
      showToast(t('inbox.accounts.disconnected_done'));
      // Microsoft non consente di revocare il consenso dall'esterno: se non è
      // stato revocato lo si dice, invece di lasciar credere il contrario.
      if (!result.revoked && connection.provider === 'microsoft') {
        showToast(t('inbox.accounts.revokeManual'));
      }
      await load();
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  const availableProviders = providers ?? [];
  const canConnect = isAdmin && availableProviders.length > 0;

  return (
    <>
      <div className="page-head">
        <button className="btn btn-sm btn-link" onClick={() => navigate('/inbox')}>
          <Icon name="arrowLeft" className="ic-sm" /> {t('inbox.detail.back')}
        </button>
        <div className="page-title">{t('inbox.accounts.title')}</div>
        <div className="page-desc">{t('inbox.accounts.subtitle')}</div>
      </div>

      <div className="card">
        {loading && <><SkeletonLine width="55%" /><SkeletonLine width="70%" /></>}
        {error && !loading && <ErrorState message={error} onRetry={load} />}

        {!loading && !error && connections.length === 0 && (
          <EmptyCta
            icon="mail"
            title={t('inbox.accounts.none')}
            subtitle={t('inbox.empty.subtitle')}
            action={
              canConnect
                ? <Button variant="primary" icon="plus" onClick={() => setShowConnect(true)}>{t('inbox.accounts.addAccount')}</Button>
                : <span className="text-muted">{isAdmin ? t('inbox.connect.noneConfigured') : t('inbox.connect.adminOnly')}</span>
            }
          />
        )}

        {!loading && !error && connections.map((connection) => (
          <div className="list-row" key={connection.id}>
            <div className="list-main">
              <div className="list-title">
                {connection.provider === 'google' ? t('inbox.connect.google') : t('inbox.connect.microsoft')}
                {' · '}{connection.emailAddress}
              </div>
              <div className="list-sub">
                {connection.lastSuccessfulSyncAt
                  ? t('inbox.accounts.lastSync', {
                      when: `${formatDate(connection.lastSuccessfulSyncAt)} ${new Date(connection.lastSuccessfulSyncAt).toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' })}`,
                    })
                  : t('inbox.accounts.neverSynced')}
                {/* Il codice tecnico resta nei log; qui si dice cosa significa. */}
                {connection.status !== 'active' && connection.lastErrorCode && (
                  <> · {inboxErrorMessage(connection.lastErrorCode)}</>
                )}
              </div>
            </div>

            <span className={`badge ${STATUS_CLASS[connection.status]}`}>
              {t(STATUS_KEY[connection.status])}
            </span>

            {isAdmin && connection.status === 'reauth_required' && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => connect(connection.provider)}
                disabled={connecting !== null}
              >
                {t('inbox.accounts.reconnect')}
              </button>
            )}

            {isAdmin && connection.status !== 'disconnected' && (
              armedId === connection.id ? (
                <span className="row-wrap">
                  <button className="btn btn-sm btn-danger" onClick={() => disconnect(connection)} disabled={busyId === connection.id}>
                    {busyId === connection.id ? <span className="spinner" aria-hidden="true" /> : null} {t('inbox.accounts.disconnect')}
                  </button>
                  <button className="btn btn-sm" onClick={() => setArmedId(null)}>{t('common.cancel')}</button>
                </span>
              ) : (
                <button className="btn btn-sm" onClick={() => setArmedId(connection.id)}>
                  {t('inbox.accounts.disconnect')}
                </button>
              )
            )}
          </div>
        ))}

        {armedId && (
          <div className="info-box mt-14">
            <Icon name="alert" className="ic-sm" />
            <div>
              <strong>{t('inbox.accounts.disconnectConfirm')}</strong>
              <div>{t('inbox.accounts.disconnectExplain')}</div>
            </div>
          </div>
        )}

        {!loading && !error && connections.length > 0 && canConnect && !showConnect && (
          <div className="mt-14">
            <Button icon="plus" onClick={() => setShowConnect(true)}>{t('inbox.accounts.addAccount')}</Button>
          </div>
        )}

        {!loading && !error && isAdmin && providers !== null && providers.length === 0 && (
          <p className="muted-sm">{t('inbox.connect.noneConfigured')}</p>
        )}
      </div>

      {showConnect && canConnect && (
        <div className="card">
          <div className="card-title"><span>{t('inbox.connect.title')}</span></div>
          <p className="page-desc">{t('inbox.connect.subtitle')}</p>

          {/* §39 — l'elenco dei permessi PRIMA del redirect, e corrispondente
              agli scope realmente richiesti: gmail.readonly e Mail.Read. */}
          <div className="grid-2">
            <div className="info-box">
              <div>
                <strong>{t('inbox.connect.canTitle')}</strong>
                <ul className="stack-sm">
                  <li>{t('inbox.connect.can1')}</li>
                  <li>{t('inbox.connect.can2')}</li>
                  <li>{t('inbox.connect.can3')}</li>
                </ul>
              </div>
            </div>
            <div className="info-box">
              <div>
                <strong>{t('inbox.connect.cannotTitle')}</strong>
                <ul className="stack-sm">
                  <li>{t('inbox.connect.cannot1')}</li>
                  <li>{t('inbox.connect.cannot2')}</li>
                  <li>{t('inbox.connect.cannot3')}</li>
                </ul>
              </div>
            </div>
          </div>

          <p className="muted-sm">{t('inbox.connect.scope', { days: INITIAL_SYNC_DAYS, max: INITIAL_SYNC_MAX_MESSAGES })}</p>

          <div className="inbox-actions">
            {(['google', 'microsoft'] as EmailProvider[]).map((provider) => (
              availableProviders.includes(provider) ? (
                <Button
                  key={provider}
                  variant="primary"
                  icon="mail"
                  loading={connecting === provider}
                  onClick={() => connect(provider)}
                >
                  {provider === 'google' ? t('inbox.connect.google') : t('inbox.connect.microsoft')}
                </Button>
              ) : (
                <span key={provider} className="text-muted">
                  {provider === 'google' ? t('inbox.connect.google') : t('inbox.connect.microsoft')} — {t('inbox.connect.notConfigured')}
                </span>
              )
            ))}
            <button className="btn btn-sm" onClick={() => setShowConnect(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
    </>
  );
}
