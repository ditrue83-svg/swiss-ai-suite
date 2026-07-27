// ============================================================================
// Adapter Google Calendar.
//
// SCOPE RICHIESTI — e solo questi:
//   openid                                              identità stabile dell'account
//   https://www.googleapis.com/auth/calendar.app.created
//
// `calendar.app.created` è il privilegio minimo che esista per quello che
// dobbiamo fare: «crea calendari secondari, e vedi/crea/modifica/cancella gli
// eventi SU QUELLI». Non dà accesso al calendario principale di nessuno, non
// legge gli appuntamenti personali, non vede le disponibilità. Anche un errore
// di programmazione qui dentro non potrebbe toccare un evento che non abbiamo
// creato noi: il vincolo non è nel nostro codice, è nel token.
//
// ⚠️ IL PREZZO DI QUELLO SCOPE, ED È LA COSA MENO OVVIA DI QUESTO FILE
// `calendarList.list` NON è fra i metodi che `calendar.app.created` autorizza.
// Cioè: non possiamo elencare i calendari dell'utente, quindi non possiamo
// CERCARE il nostro calendario per nome. L'unico modo di ritrovarlo è aver
// conservato il suo identificativo (`calendar_connections.provider_calendar_id`)
// e verificarlo con `calendars.get`, che invece quello scope autorizza.
// Se quell'identificativo si perdesse, il calendario resterebbe nell'account
// dell'utente e noi ne creeremmo un secondo con lo stesso nome.
//
// ⚠️ COME SI OTTIENE L'IDEMPOTENZA
// Google accetta un identificativo dell'evento SCELTO DAL CLIENT, purché usi
// l'alfabeto base32hex. È la primitiva migliore che si possa desiderare: il
// ritentativo di una creazione andata a buon fine ma la cui risposta non è mai
// arrivata trova l'identificativo già preso e non crea un secondo evento. Per
// questo qui non c'è nessuna «ricerca prima di scrivere»: si scrive, e in caso
// di conflitto si aggiorna.
//
// ⚠️ UN EVENTO CANCELLATO NON LIBERA IL SUO IDENTIFICATIVO
// Su Google la cancellazione lascia una riga con `status: cancelled`. Se la
// riconciliazione dovesse ricreare un evento che l'utente ha cancellato a mano
// (§68), una `insert` con lo stesso identificativo fallirebbe con un conflitto.
// Per questo la ricreazione avviene con `patch` che riporta `status` a
// `confirmed`: è la strada documentata, e vale sia per «esiste e va aggiornato»
// sia per «esisteva, è stato cancellato, va ripristinato».
//
// Modulo PORTABILE: nessuna API Deno. `fetchImpl` per parametro, così i test
// girano su payload sintetici senza rete.
// ============================================================================
import { formEncode } from '../email/http.ts';
import { fromBase64 } from '../email/crypto.ts';
import { calFetchTolerating, calJson, parseJsonSafe } from './http.ts';
import { eventMetadata, nextDay } from './desired.ts';
import { TASK_METADATA_KEY } from './contract.ts';
import {
  CalendarProviderError,
  type CalendarAccountIdentity, type CalendarEventContent, type CalendarEventRef,
  type CalendarOAuthTokens, type CalendarProviderAdapter, type CalendarProviderConfig,
} from './types.ts';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3';

export const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/calendar.app.created',
];

interface GoogleEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { date?: string };
  end?: { date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export function createGoogleCalendarAdapter(config: CalendarProviderConfig): CalendarProviderAdapter {
  const fetchImpl = config.fetchImpl;
  const auth = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });
  const jsonAuth = (accessToken: string) => ({ ...auth(accessToken), 'Content-Type': 'application/json' });

  /**
   * `sub` dell'id_token: identità stabile dell'account. Il token arriva
   * direttamente dall'endpoint di Google su TLS, quindi secondo OpenID Connect
   * (§3.1.3.7) il client può leggerlo senza verificarne la firma. Non si usa mai
   * un id_token ricevuto per altre vie.
   */
  function subjectFromIdToken(idToken: string | undefined): string | null {
    if (!idToken) return null;
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    try {
      const payload = JSON.parse(new TextDecoder().decode(fromBase64(parts[1]))) as { sub?: string; email?: string };
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  function emailFromIdToken(idToken: string | undefined): string | null {
    if (!idToken) return null;
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    try {
      const payload = JSON.parse(new TextDecoder().decode(fromBase64(parts[1]))) as { email?: string };
      return typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
    } catch {
      return null;
    }
  }

  // L'identità arriva nell'id_token dello scambio del codice. Si conserva qui
  // fra lo scambio e `getAccountIdentity`, per la durata di UN collegamento.
  let identity: { accountId: string | null; email: string | null } = { accountId: null, email: null };

  async function tokenRequest(params: Record<string, string>): Promise<CalendarOAuthTokens> {
    const payload = await calJson<{
      access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string;
    }>(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode(params),
      fetchImpl,
      attempts: 2,
    });
    if (!payload.access_token) {
      throw new CalendarProviderError('AUTH_EXPIRED', 'Google non ha restituito un access token');
    }
    const sub = subjectFromIdToken(payload.id_token);
    const email = emailFromIdToken(payload.id_token);
    if (sub) identity.accountId = sub;
    if (email) identity.email = email;

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      // Un minuto di margine: un token che scade mentre la richiesta è in volo
      // produce un 401 che sembra una revoca.
      expiresAt: new Date(Date.now() + Math.max(60, (payload.expires_in ?? 3600) - 60) * 1000).toISOString(),
      scopes: (payload.scope ?? '').split(' ').filter(Boolean),
    };
  }

  /** Il corpo dell'evento nella forma che Google si aspetta. */
  function eventBody(event: CalendarEventContent) {
    return {
      // `status: confirmed` è deliberato e non ridondante: è ciò che RIPRISTINA
      // un evento che l'utente aveva cancellato a mano. Senza, una `patch` su
      // un evento annullato lo lascerebbe annullato e la riconciliazione
      // continuerebbe a credere di averlo ricreato.
      status: 'confirmed',
      summary: event.title,
      description: event.description,
      // Giornata intera: la fine è ESCLUSIVA, quindi il giorno dopo.
      start: { date: event.date },
      end: { date: nextDay(event.date) },
      // §57 — nessun promemoria dal provider: il motore delle notifiche è
      // AI-Swisse, e due promemoria per la stessa cosa insegnano a ignorarli
      // entrambi.
      reminders: { useDefault: false, overrides: [] },
      // §60 — un riferimento non sensibile, per la riconciliazione.
      extendedProperties: { private: eventMetadata(event.taskId) },
      // §55/§56 — nessun partecipante, nessuna riunione online. Non compaiono
      // come campi vuoti: non compaiono affatto.
      transparency: 'transparent',
    };
  }

  const adapter: CalendarProviderAdapter = {
    id: 'google',
    scopes: GOOGLE_CALENDAR_SCOPES,

    buildAuthorizationUrl({ state, codeChallenge, loginHint }) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: GOOGLE_CALENDAR_SCOPES.join(' '),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        // `offline` fa emettere il refresh token; `consent` lo fa riemettere
        // anche a chi aveva già autorizzato — altrimenti una riconnessione
        // otterrebbe un access token e nessun refresh token, e il calendario si
        // spegnerebbe dopo un'ora.
        access_type: 'offline',
        prompt: 'consent',
        // ⚠️ `false` di proposito: se la stessa persona ha già collegato la
        // posta, `true` restituirebbe un token con ANCHE gli scope di Gmail.
        // Un token di calendario che può leggere la posta è esattamente ciò che
        // il privilegio minimo deve impedire (§49).
        include_granted_scopes: 'false',
      });
      if (loginHint) params.set('login_hint', loginHint);
      return `${AUTH_URL}?${params.toString()}`;
    },

    async exchangeCode({ code, codeVerifier }) {
      return await tokenRequest({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: config.redirectUri,
      });
    },

    async refresh(refreshToken) {
      return await tokenRequest({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });
    },

    async getAccountIdentity(accessToken): Promise<CalendarAccountIdentity> {
      // L'identità viene dall'id_token, che è già arrivato con lo scambio del
      // codice. NON si interroga un endpoint di profilo: richiederebbe uno scope
      // in più (`userinfo.email`) per un dato che abbiamo già.
      if (identity.accountId && identity.email) {
        return { accountId: identity.accountId, emailAddress: identity.email };
      }
      // Senza id_token non si inventa un'identità: si dichiara che manca. Un
      // identificativo di ripiego renderebbe due account indistinguibili.
      throw new CalendarProviderError(
        'INVALID_RESPONSE',
        'Google non ha restituito un id_token: identità dell’account non determinabile',
      );
    },

    async ensureDedicatedCalendar({ accessToken, calendarId, name }) {
      // 1) Se abbiamo un identificativo, si verifica che punti ancora a qualcosa.
      if (calendarId) {
        const probe = await calFetchTolerating(
          `${API}/calendars/${encodeURIComponent(calendarId)}`,
          [404, 410],
          { headers: auth(accessToken), fetchImpl },
        );
        if (!probe.tolerated) {
          const found = parseJsonSafe<{ id?: string; summary?: string }>(probe.text, API);
          return { calendarId: found.id ?? calendarId, name: found.summary ?? name, created: false };
        }
        // 404/410: l'utente lo ha cancellato. Non è un guasto — è una scelta
        // sua — e la risposta giusta è ricrearlo, non fermarsi.
      }

      // 2) Non si può CERCARLO per nome: `calendarList.list` non è autorizzato
      //    da `calendar.app.created`. Si crea.
      const created = await calJson<{ id?: string; summary?: string }>(`${API}/calendars`, {
        method: 'POST',
        headers: jsonAuth(accessToken),
        body: JSON.stringify({ summary: name }),
        fetchImpl,
      });
      if (!created.id) {
        throw new CalendarProviderError('INVALID_RESPONSE', 'Google non ha restituito l’id del calendario');
      }
      // Google aggiunge da sé il calendario appena creato all'elenco di chi lo
      // ha creato, e il proprietario non può toglierlo: comparirà accanto agli
      // altri calendari senza che serva un secondo passaggio.
      return { calendarId: created.id, name: created.summary ?? name, created: true };
    },

    async upsertEvent({ accessToken, calendarId, providerEventId, event }): Promise<CalendarEventRef> {
      const id = providerEventId ?? event.eventKey;
      const base = `${API}/calendars/${encodeURIComponent(calendarId)}/events`;
      const body = JSON.stringify(eventBody(event));
      // §55 — nessuna notifica ai partecipanti. Non ci sono partecipanti, ma
      // dirlo esplicitamente costa una parola e toglie ogni dubbio a chi legge.
      const query = '?sendUpdates=none';

      // 1) Si prova ad AGGIORNARE. È il caso più frequente (un'attività cambia
      //    più volte di quante ne nasca) e ripristina anche gli eventi annullati.
      const patched = await calFetchTolerating(
        `${base}/${encodeURIComponent(id)}${query}`,
        [404, 410],
        { method: 'PATCH', headers: jsonAuth(accessToken), body, fetchImpl },
      );
      if (!patched.tolerated) {
        const updated = parseJsonSafe<GoogleEvent>(patched.text, base);
        return { providerEventId: updated.id ?? id };
      }

      // 2) Non c'era: si crea con l'identificativo scelto da noi.
      const insertBody = JSON.stringify({ ...eventBody(event), id });
      const inserted = await calFetchTolerating(
        `${base}${query}`,
        [409],
        { method: 'POST', headers: jsonAuth(accessToken), body: insertBody, fetchImpl },
      );
      if (!inserted.tolerated) {
        const createdEvent = parseJsonSafe<GoogleEvent>(inserted.text, base);
        return { providerEventId: createdEvent.id ?? id };
      }

      // 3) Conflitto: l'identificativo esiste già. Due strade portano qui — un
      //    ritentativo dopo un timeout su una creazione riuscita, oppure un
      //    evento cancellato che non ha liberato il proprio id. In entrambi i
      //    casi la risposta è la stessa: aggiornare, con `status: confirmed`.
      const revived = await calJson<GoogleEvent>(
        `${base}/${encodeURIComponent(id)}${query}`,
        { method: 'PATCH', headers: jsonAuth(accessToken), body, fetchImpl },
      );
      return { providerEventId: revived.id ?? id };
    },

    async deleteEvent({ accessToken, calendarId, providerEventId }) {
      // 404/410 = era già cancellato. L'esito voluto è raggiunto: non è un
      // errore, e trattarlo come tale farebbe ritentare all'infinito.
      await calFetchTolerating(
        `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(providerEventId)}?sendUpdates=none`,
        [404, 410],
        { method: 'DELETE', headers: auth(accessToken), fetchImpl },
      );
    },

    async eventExists({ accessToken, calendarId, providerEventId }) {
      const probe = await calFetchTolerating(
        `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(providerEventId)}`,
        [404, 410],
        { headers: auth(accessToken), fetchImpl },
      );
      if (probe.tolerated) return false;
      const found = parseJsonSafe<GoogleEvent>(probe.text, API);
      // Un evento annullato non compare in nessun calendario: per chi guarda
      // non esiste, e qui si risponde a chi guarda.
      return found.status !== 'cancelled';
    },

    async findEventByTask({ accessToken, calendarId, taskId }) {
      const url = `${API}/calendars/${encodeURIComponent(calendarId)}/events?${new URLSearchParams({
        privateExtendedProperty: `${TASK_METADATA_KEY}=${taskId}`,
        maxResults: '5',
        showDeleted: 'false',
      })}`;
      const payload = await calJson<{ items?: GoogleEvent[] }>(url, { headers: auth(accessToken), fetchImpl });
      const alive = (payload.items ?? []).filter((e) => e.status !== 'cancelled');
      return alive[0]?.id ?? null;
    },

    async revoke({ accessToken, refreshToken }) {
      // Si revoca il refresh token quando c'è: invalida l'intera concessione,
      // mentre revocare il solo access token la lascerebbe viva.
      const token = refreshToken ?? accessToken;
      await calFetchTolerating(REVOKE_URL, [400], {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formEncode({ token }),
        fetchImpl,
      });
    },
  };

  return adapter;
}
