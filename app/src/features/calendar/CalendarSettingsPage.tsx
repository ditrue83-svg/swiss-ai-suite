// ============================================================================
// Notifiche e calendario — le impostazioni.
//
// Due cose che questa schermata non fa, di proposito:
//   · non mostra codici tecnici. `invalid_grant` diventa «il calendario deve
//     essere ricollegato», che è l'informazione utile (§108);
//   · non promette ciò che non avviene. L'elenco dei permessi PRIMA del
//     consenso corrisponde agli scope realmente richiesti — li legge dagli
//     adapter del server, non da un testo scritto a mano — e l'interruttore
//     delle email è disattivato quando nessun servizio di invio è configurato,
//     invece di essere acceso su un canale spento (§53/§79).
//
// ⚠️ IL CASO PIÙ FACILE DA SBAGLIARE: GOOGLE E MICROSOFT NON SONO UGUALI
// Su Google lo scope richiesto riguarda soltanto i calendari creati da questa
// applicazione, quindi «non leggiamo il tuo calendario personale» è un fatto
// imposto dal token. Su Microsoft un permesso equivalente non esiste, e la
// stessa frase sarebbe un impegno, non una garanzia. La schermata mostra due
// avvertenze diverse, perché dire la stessa cosa per entrambi sarebbe dire il
// falso per uno dei due.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Button, ErrorState, SkeletonLine } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { useCompany } from '@/contexts/CompanyContext';
import { useI18n, useT } from '@/i18n';
import { formatDate } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { calendarConnectionService, calendarErrorMessage } from '@/services/calendarConnectionService';
import {
  DEFAULT_TIMEZONE, TIMEZONE_CHOICES, defaultPreferences, notificationService,
} from '@/services/notificationService';
import type { CalendarConnection, CalendarProvider, NotificationPreferences } from '@/types/models';

const STATUS_KEY = {
  active: 'calendar.statusConnected',
  reauth_required: 'calendar.statusReauth',
  error: 'calendar.statusError',
  disconnected: 'calendar.statusDisconnected',
} as const;

const STATUS_CLASS = {
  active: 'badge-neutral',
  reauth_required: 'badge-alta',
  error: 'badge-alta',
  disconnected: 'badge-neutral',
} as const;

export function CalendarSettingsPage() {
  const t = useT();
  const { locale, localeTag } = useI18n();
  const { user } = useAuth();
  const { activeCompanyId, activeCompany } = useCompany();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const companyId = activeCompanyId as string;

  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [providers, setProviders] = useState<CalendarProvider[] | null>(null);
  const [scopes, setScopes] = useState<Partial<Record<CalendarProvider, string[]>>>({});
  /**
   * Lo dice il SERVER, non un'ipotesi di questa schermata. Finché la risposta
   * non arriva resta falso: uno stato che non promette nulla è preferibile a
   * uno che promette una consegna che non avverrebbe (§79).
   */
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<CalendarProvider | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, info, saved] = await Promise.all([
        calendarConnectionService.list(companyId),
        // Se il server non risponde su questo punto non si assume nulla: resta
        // `null`, e la schermata dice che non lo sa invece di mostrare due
        // pulsanti che potrebbero non funzionare.
        calendarConnectionService.providers().catch(() => null),
        notificationService.preferences(companyId),
      ]);
      setConnections(list);
      setProviders(info?.providers ?? null);
      setScopes(info?.scopes ?? {});
      setEmailConfigured(info?.emailConfigured === true);
      setPrefs(saved ?? defaultPreferences(companyId, user?.id ?? '', locale));
      setError(null);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setLoading(false);
    }
  }, [companyId, user?.id, locale]);

  useEffect(() => { void load(); }, [load]);

  // L'esito del consenso torna nell'URL. Si mostra e si PULISCE: lasciarlo lì
  // farebbe ricomparire «collegato» a ogni ricaricamento della pagina.
  useEffect(() => {
    const outcome = params.get('calendar');
    if (!outcome) return;
    const code = params.get('code');
    if (outcome === 'ok') showToast(t('calendar.statusConnected'));
    else if (outcome === 'cancelled') showToast(t('common.cancel'));
    else showToast(calendarErrorMessage(code) ?? t('calendar.errors.generic'));
    const next = new URLSearchParams(params);
    next.delete('calendar');
    next.delete('code');
    setParams(next, { replace: true });
  }, [params, setParams, showToast, t]);

  async function connect(provider: CalendarProvider) {
    setConnecting(provider);
    try {
      const url = await calendarConnectionService.startConnect({
        companyId, provider, locale, returnPath: '/calendario/impostazioni',
      });
      // Il consenso avviene sul sito del provider: si lascia l'applicazione.
      window.location.assign(url);
    } catch (e) {
      showToast(toUserMessage(e));
      setConnecting(null);
    }
  }

  async function syncNow(connection: CalendarConnection) {
    setBusyId(connection.id);
    try {
      const result = await calendarConnectionService.syncNow(connection.id);
      const upserted = Number(result.report?.upserted ?? 0);
      showToast(upserted > 0 ? t('calendar.syncDone', { n: upserted }) : t('calendar.syncStarted'));
      await load();
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function disconnect(connection: CalendarConnection, removeEvents: boolean) {
    setBusyId(connection.id);
    try {
      const result = await calendarConnectionService.disconnect(connection.id, removeEvents);
      setArmedId(null);
      showToast(t('calendar.disconnectedDone'));
      if (result.eventsRemoved > 0) showToast(t('calendar.eventsRemoved', { n: result.eventsRemoved }));
      if (!removeEvents && result.eventsLeft > 0) showToast(t('calendar.eventsLeft', { n: result.eventsLeft }));
      if (result.removalFailed) showToast(t('calendar.removalFailed'));
      // Microsoft non consente di revocare il consenso dall'esterno: se non è
      // stato revocato lo si dice, invece di lasciar credere il contrario.
      if (!result.revoked && connection.provider === 'microsoft') showToast(t('calendar.revokeManual'));
      await load();
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function savePrefs(next: NotificationPreferences) {
    setPrefs(next);
    setSaving(true);
    try {
      const saved = await notificationService.savePreferences({ ...next, userId: user!.id, companyId });
      setPrefs(saved);
      showToast(t('calendar.saved'));
    } catch (e) {
      showToast(toUserMessage(e));
      await load();                      // si rilegge lo stato VERO, non quello sperato
    } finally {
      setSaving(false);
    }
  }

  const available = providers ?? [];
  const canConnect = available.length > 0;

  return (
    <>
      <div className="page-head">
        <button className="btn btn-sm btn-link" onClick={() => navigate('/calendario')}>
          <Icon name="arrowLeft" className="ic-sm" /> {t('calendar.back')}
        </button>
        <div className="page-title">{t('calendar.settingsTitle')}</div>
        <div className="page-desc">{t('calendar.settingsSubtitle')}</div>
      </div>

      {loading && <div className="card"><SkeletonLine width="60%" /><SkeletonLine width="80%" /></div>}
      {error && !loading && <div className="card"><ErrorState message={error} onRetry={load} /></div>}

      {/* ---- Promemoria ---------------------------------------------------- */}
      {!loading && !error && prefs && (
        <div className="card">
          <div className="card-title">{t('calendar.remindersTitle')}</div>
          <p className="muted-sm">{t('calendar.remindersHint')}</p>
          <div className="checks">
            <Toggle id="r7" label={t('calendar.remind7')} checked={prefs.remind7Days} disabled={saving}
              onChange={(v) => void savePrefs({ ...prefs, remind7Days: v })} />
            <Toggle id="r1" label={t('calendar.remind1')} checked={prefs.remind1Day} disabled={saving}
              onChange={(v) => void savePrefs({ ...prefs, remind1Day: v })} />
            <Toggle id="r0" label={t('calendar.remind0')} checked={prefs.remindDueDay} disabled={saving}
              onChange={(v) => void savePrefs({ ...prefs, remindDueDay: v })} />
            <Toggle id="rov" label={t('calendar.remindOverdue')} checked={prefs.remindOverdue} disabled={saving}
              onChange={(v) => void savePrefs({ ...prefs, remindOverdue: v })} />
          </div>

          <div className="card-title mt-16">{t('calendar.channelsTitle')}</div>
          <div className="checks">
            <Toggle id="c-app" label={t('calendar.channelInApp')} checked={prefs.inAppEnabled} disabled={saving}
              onChange={(v) => void savePrefs({ ...prefs, inAppEnabled: v })} />
            {/* §79 — l'interruttore delle email non si mostra acceso su un
                canale che non esiste. Qui è dichiarato non disponibile finché
                l'installazione non ha un servizio di invio configurato. */}
            {emailConfigured ? (
              <Toggle id="c-mail" label={t('calendar.channelEmail')} checked={prefs.emailEnabled} disabled={saving}
                onChange={(v) => void savePrefs({ ...prefs, emailEnabled: v })} />
            ) : (
              <div className="check-off">
                <span className="text-muted">{t('calendar.channelEmail')} — {t('calendar.emailUnavailable')}</span>
                <div className="muted-sm">{t('calendar.emailUnavailableWhy')}</div>
              </div>
            )}
          </div>
          <p className="muted-sm">{t('calendar.channelInAppNote')}</p>

          <div className="card-title mt-16">{t('calendar.timezoneTitle')}</div>
          <div className="field">
            <label htmlFor="tz">{t('calendar.timezoneTitle')}</label>
            <select id="tz" value={prefs.timezone || DEFAULT_TIMEZONE} disabled={saving}
              onChange={(e) => void savePrefs({ ...prefs, timezone: e.target.value })}>
              {/* Il fuso salvato può non essere nell'elenco: lo si mostra
                  comunque, invece di farlo sparire silenziosamente. */}
              {(TIMEZONE_CHOICES.includes(prefs.timezone) ? TIMEZONE_CHOICES : [prefs.timezone, ...TIMEZONE_CHOICES])
                .map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
            <div className="field-hint">{t('calendar.timezoneHint')}</div>
          </div>
        </div>
      )}

      {/* ---- Calendario esterno -------------------------------------------- */}
      {!loading && !error && (
        <div className="card mt-16">
          <div className="card-title">{t('calendar.connectTitle')}</div>

          {connections.filter((c) => c.status !== 'disconnected').length === 0 && !showConnect && (
            <>
              <p className="page-desc">{t('calendar.noConnection')}</p>
              {canConnect
                ? <Button variant="primary" icon="calendar" onClick={() => setShowConnect(true)}>{t('calendar.connectCta')}</Button>
                : <p className="muted-sm">{t('calendar.noneConfigured')}</p>}
            </>
          )}

          {connections.filter((c) => c.status !== 'disconnected').map((connection) => (
            <div key={connection.id}>
              <div className="list-row">
                <div className="list-main">
                  <div className="list-title">
                    {connection.provider === 'google' ? t('calendar.connectGoogle') : t('calendar.connectMicrosoft')}
                    {' · '}{connection.emailAddress}
                  </div>
                  <div className="list-sub">
                    {t('calendar.calendarLabel')}: {connection.calendarName ?? t('calendar.calendarPending')}
                    {' · '}
                    {connection.lastSuccessfulSyncAt
                      ? t('calendar.lastSync', {
                          when: `${formatDate(connection.lastSuccessfulSyncAt)} ${new Date(connection.lastSuccessfulSyncAt).toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' })}`,
                        })
                      : t('calendar.neverSynced')}
                    {/* Il codice tecnico resta nei log; qui si dice cosa significa. */}
                    {connection.status !== 'active' && connection.lastErrorCode && (
                      <> · {calendarErrorMessage(connection.lastErrorCode)}</>
                    )}
                  </div>
                </div>
                <span className={`badge ${STATUS_CLASS[connection.status]}`}>{t(STATUS_KEY[connection.status])}</span>
              </div>

              <div className="row-wrap">
                {connection.status === 'active' && (
                  <Button size="sm" icon="refresh" loading={busyId === connection.id}
                    onClick={() => void syncNow(connection)}>{t('calendar.syncNow')}</Button>
                )}
                {connection.status === 'reauth_required' && (
                  <Button size="sm" variant="primary" loading={connecting !== null}
                    onClick={() => void connect(connection.provider)}>{t('calendar.reconnect')}</Button>
                )}
                {armedId !== connection.id && (
                  <button className="btn btn-sm" onClick={() => setArmedId(connection.id)}>
                    {t('calendar.disconnect')}
                  </button>
                )}
              </div>

              {/* §70 — gli eventi già scritti non si cancellano senza chiedere.
                  Non c'è un valore predefinito: sono due pulsanti, e finché non
                  se ne preme uno non succede niente. */}
              {armedId === connection.id && (
                <div className="info-box mt-14">
                  <Icon name="alert" className="ic-sm" />
                  <div>
                    <strong>{t('calendar.disconnectTitle')}</strong>
                    <div>{t('calendar.disconnectExplain')}</div>
                    <div className="row-wrap mt-10">
                      <Button size="sm" loading={busyId === connection.id}
                        onClick={() => void disconnect(connection, false)}>{t('calendar.disconnectKeep')}</Button>
                      <Button size="sm" variant="danger" loading={busyId === connection.id}
                        onClick={() => void disconnect(connection, true)}>{t('calendar.disconnectRemove')}</Button>
                      <button className="btn btn-sm" onClick={() => setArmedId(null)}>{t('common.cancel')}</button>
                    </div>
                  </div>
                </div>
              )}

              <div className="info-box mt-14">
                <Icon name="alert" className="ic-sm" />
                <div>
                  <strong>{t('calendar.oneWayTitle')}</strong>
                  <div>{t('calendar.oneWayBody')}</div>
                  <div className="muted-sm mt-8">{t('calendar.managedNotice')}</div>
                </div>
              </div>
            </div>
          ))}

          {providers !== null && providers.length === 0 && (
            <p className="muted-sm">{t('calendar.noneConfigured')}</p>
          )}

          {showConnect && canConnect && (
            <div className="mt-16">
              <p className="page-desc">{t('calendar.connectSubtitle')}</p>

              <div className="grid-2">
                <div className="info-box">
                  <div>
                    <strong>{t('calendar.willTitle')}</strong>
                    <ul className="stack-sm">
                      <li>{t('calendar.will1', { company: activeCompany?.legalName ?? '' })}</li>
                      <li>{t('calendar.will2')}</li>
                      <li>{t('calendar.will3')}</li>
                      <li>{t('calendar.will4')}</li>
                    </ul>
                  </div>
                </div>
                <div className="info-box">
                  <div>
                    <strong>{t('calendar.wontTitle')}</strong>
                    <ul className="stack-sm">
                      <li>{t('calendar.wont1')}</li>
                      <li>{t('calendar.wont2')}</li>
                      <li>{t('calendar.wont3')}</li>
                      <li>{t('calendar.wont4')}</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="inbox-actions mt-14">
                {(['google', 'microsoft'] as CalendarProvider[]).map((provider) => (
                  available.includes(provider) ? (
                    <div key={provider} className="connect-choice">
                      <Button variant="primary" icon="calendar" loading={connecting === provider}
                        onClick={() => void connect(provider)}>
                        {provider === 'google' ? t('calendar.connectGoogle') : t('calendar.connectMicrosoft')}
                      </Button>
                      {/* L'avvertenza è DIVERSA per i due provider, perché la
                          garanzia è diversa: su Google la impone il permesso,
                          su Microsoft è un impegno nostro. */}
                      <div className="muted-sm">
                        {provider === 'google' ? t('calendar.scopeNoteGoogle') : t('calendar.scopeNoteMicrosoft')}
                      </div>
                      {/* Gli scope REALI, letti dagli adapter del server: se un
                          domani cambiassero, questa riga lo direbbe da sé. */}
                      {scopes[provider]?.length ? (
                        <div className="muted-sm">
                          {t('calendar.scopesReal', { scopes: (scopes[provider] ?? []).join(', ') })}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <span key={provider} className="text-muted">
                      {provider === 'google' ? t('calendar.connectGoogle') : t('calendar.connectMicrosoft')}
                      {' — '}{t('calendar.notConfigured')}
                    </span>
                  )
                ))}
                <button className="btn btn-sm" onClick={() => setShowConnect(false)}>{t('common.cancel')}</button>
              </div>
            </div>
          )}

          {!showConnect && connections.some((c) => c.status !== 'disconnected') && canConnect && (
            <div className="mt-14">
              <Button size="sm" icon="plus" onClick={() => setShowConnect(true)}>{t('calendar.connectCta')}</Button>
            </div>
          )}
        </div>
      )}

      {/* ---- Che cosa esce dal prodotto ------------------------------------- */}
      {!loading && !error && prefs && (
        <div className="card mt-16">
          <div className="card-title">{t('calendar.privacyTitle')}</div>
          <div className="checks">
            <Toggle id="show-title" label={t('calendar.showTitleLabel')} checked={prefs.showTaskTitle} disabled={saving}
              onChange={(v) => void savePrefs({ ...prefs, showTaskTitle: v })} />
          </div>
          <p className="muted-sm">{t('calendar.showTitleHint')}</p>
          <p className="muted-sm">{t('calendar.privacyNote')}</p>
        </div>
      )}
    </>
  );
}

/**
 * Una casella di spunta con la sua etichetta.
 *
 * ⚠️ Il testo è un `<label>` legato alla casella e la classe è `.task-check`:
 * è la stessa regola introdotta nella 0016 dopo aver misurato una casella di
 * 13 pixel con un bersaglio cliccabile di 23 — sotto i 24 che WCAG 2.2 chiede.
 */
function Toggle({
  id, label, checked, disabled, onChange,
}: { id: string; label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="task-check">
      <input id={id} type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}
