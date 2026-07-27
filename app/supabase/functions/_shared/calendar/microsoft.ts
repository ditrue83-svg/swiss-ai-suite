// ============================================================================
// Adapter Microsoft Graph — calendario.
//
// PERMESSI RICHIESTI — delegated, e solo questi:
//   openid profile email offline_access
//   Calendars.ReadWrite
//
// ⚠️ QUI IL PRIVILEGIO MINIMO È PIÙ LARGO CHE SU GOOGLE, E VA DETTO
// Microsoft non ha un equivalente di `calendar.app.created`. Le uniche
// alternative delegate sono `Calendars.ReadWrite.Shared` (che aggiunge i
// calendari condivisi e delegati) e `Calendars.Read`/`ReadBasic`, che non
// permettono di scrivere. Per creare un calendario e gestirne gli eventi serve
// `Calendars.ReadWrite`, che copre TUTTI i calendari della persona — non solo
// il nostro.
//
// Conseguenza sul prodotto, non solo sul codice: la schermata del consenso NON
// può dire le stesse cose per i due provider. Su Google possiamo promettere che
// non vedremo il calendario personale perché è il token a impedircelo; su
// Microsoft possiamo solo impegnarci a non farlo, e l'unica garanzia è
// l'assenza dei metodi in `CalendarProviderAdapter` — che è una garanzia più
// debole, e la si dichiara invece di far finta che siano equivalenti.
// Le `application permissions` (`Calendars.ReadWrite.All`) non compaiono qui:
// darebbero accesso ai calendari dell'INTERA organizzazione senza che nessuno
// abbia acconsentito (§51).
//
// ⚠️ COME SI OTTIENE L'IDEMPOTENZA, E PERCHÉ È DIVERSA DA GOOGLE
// Graph non accetta un identificativo scelto dal client: lo genera lui. Offre
// però `transactionId`, «un identificativo personalizzato specificato da
// un'app affinché il server eviti operazioni POST ridondanti in caso di
// ritentativi». Copre il caso del timeout, ma non basta da solo: dopo un
// ritentativo noi non conosciamo comunque l'id dell'evento.
// Per questo, quando non abbiamo un id, si CERCA PRIMA per metadato — una
// proprietà estesa con l'id dell'attività — e si scrive solo se non c'è nulla.
// Una chiamata in più che rende la ricreazione dopo una cancellazione manuale
// (§68) corretta invece che approssimativa.
//
// Modulo PORTABILE: nessuna API Deno.
// ============================================================================
import { formEncode } from '../email/http.ts';
import { calFetchTolerating, calJson, parseJsonSafe } from './http.ts';
import { nextDay } from './desired.ts';
import { MS_TASK_PROPERTY, TASK_METADATA_KEY } from './contract.ts';
import {
  CalendarProviderError,
  type CalendarAccountIdentity, type CalendarEventContent, type CalendarEventRef,
  type CalendarOAuthTokens, type CalendarProviderAdapter, type CalendarProviderConfig,
} from './types.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';

export const MICROSOFT_CALENDAR_SCOPES = [
  'openid', 'profile', 'email', 'offline_access',
  'https://graph.microsoft.com/Calendars.ReadWrite',
];

const authBase = (tenant: string) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;

interface GraphEvent {
  id?: string;
  subject?: string;
  isAllDay?: boolean;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
}

export function createMicrosoftCalendarAdapter(config: CalendarProviderConfig): CalendarProviderAdapter {
  const fetchImpl = config.fetchImpl;
  const tenant = config.tenant ?? 'common';
  const auth = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });
  const jsonAuth = (accessToken: string) => ({ ...auth(accessToken), 'Content-Type': 'application/json' });

  async function tokenRequest(params: Record<string, string>): Promise<CalendarOAuthTokens> {
    const payload = await calJson<{
      access_token?: string; refresh_token?: string; expires_in?: number; scope?: string;
    }>(`${authBase(tenant)}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode(params),
      fetchImpl,
      attempts: 2,
    });
    if (!payload.access_token) {
      throw new CalendarProviderError('AUTH_EXPIRED', 'Microsoft non ha restituito un access token');
    }
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      expiresAt: new Date(Date.now() + Math.max(60, (payload.expires_in ?? 3600) - 60) * 1000).toISOString(),
      scopes: (payload.scope ?? '').split(' ').filter(Boolean),
    };
  }

  /**
   * Il corpo dell'evento nella forma che Graph si aspetta.
   *
   * `isAllDay` impone una regola precisa, citata dalla documentazione: «se true,
   * indipendentemente dal fatto che l'evento duri uno o più giorni, l'ora di
   * inizio e di fine devono essere impostate a mezzanotte e trovarsi nello
   * stesso fuso orario». La fine resta ESCLUSIVA — la mezzanotte del giorno
   * dopo — esattamente come su Google.
   *
   * Il fuso dichiarato è UTC e non quello dell'utente: per un evento di
   * giornata intera Outlook usa il fuso solo per collocare le due mezzanotti, e
   * dichiararne uno «locale» che non sappiamo essere quello del calendario
   * dell'utente introdurrebbe uno scivolamento di un giorno in certe zone. Con
   * UTC il giorno è quello scritto in `due_date`, senza interpretazioni.
   */
  function eventBody(event: CalendarEventContent, withTransaction: boolean) {
    const body: Record<string, unknown> = {
      subject: event.title,
      body: { contentType: 'text', content: event.description },
      isAllDay: true,
      start: { dateTime: `${event.date}T00:00:00.0000000`, timeZone: 'UTC' },
      end: { dateTime: `${nextDay(event.date)}T00:00:00.0000000`, timeZone: 'UTC' },
      // §57 — nessun promemoria dal provider: quello lo fa AI-Swisse.
      isReminderOn: false,
      // Una scadenza non occupa la giornata di nessuno: mostrarla come «occupato»
      // farebbe risultare la persona non disponibile per un'intera giornata.
      showAs: 'free',
      // §55 — nessun partecipante. Il campo è dichiarato vuoto e non omesso:
      // su un aggiornamento, ometterlo lascerebbe intatti eventuali destinatari
      // aggiunti a mano, e questo evento non deve averne.
      attendees: [],
      // §60 — il riferimento all'attività, per la riconciliazione.
      singleValueExtendedProperties: [{ id: MS_TASK_PROPERTY, value: event.taskId }],
    };
    // `transactionId` si può impostare solo alla creazione: «dopo averlo
    // impostato non è più modificabile in un aggiornamento successivo».
    if (withTransaction) body.transactionId = event.eventKey.slice(0, 250);
    return JSON.stringify(body);
  }

  const adapter: CalendarProviderAdapter = {
    id: 'microsoft',
    scopes: MICROSOFT_CALENDAR_SCOPES,

    buildAuthorizationUrl({ state, codeChallenge, loginHint }) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        redirect_uri: config.redirectUri,
        response_mode: 'query',
        scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      if (loginHint) params.set('login_hint', loginHint);
      return `${authBase(tenant)}/authorize?${params.toString()}`;
    },

    async exchangeCode({ code, codeVerifier }) {
      return await tokenRequest({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: config.redirectUri,
        scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
      });
    },

    async refresh(refreshToken) {
      return await tokenRequest({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
      });
    },

    async getAccountIdentity(accessToken): Promise<CalendarAccountIdentity> {
      const me = await calJson<{ id?: string; mail?: string; userPrincipalName?: string }>(
        `${GRAPH}/me?$select=id,mail,userPrincipalName`,
        { headers: auth(accessToken), fetchImpl },
      );
      const email = me.mail ?? me.userPrincipalName;
      if (!me.id || !email) {
        throw new CalendarProviderError('INVALID_RESPONSE', 'profilo Microsoft senza identificativo o indirizzo');
      }
      return { accountId: me.id, emailAddress: email.toLowerCase() };
    },

    async ensureDedicatedCalendar({ accessToken, calendarId, name }) {
      if (calendarId) {
        const probe = await calFetchTolerating(
          `${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}`,
          [404, 410],
          { headers: auth(accessToken), fetchImpl },
        );
        if (!probe.tolerated) {
          const found = parseJsonSafe<{ id?: string; name?: string }>(probe.text, GRAPH);
          return { calendarId: found.id ?? calendarId, name: found.name ?? name, created: false };
        }
      }

      // ⚠️ Qui, a differenza di Google, POTREMMO cercare per nome: il permesso
      // lo consente. Non lo facciamo. Un calendario che si chiama come il
      // nostro ma che non abbiamo creato noi potrebbe essere di chiunque, e
      // adottarlo significherebbe cominciare a scrivere eventi dentro un
      // calendario altrui perché i nomi coincidevano. L'identificativo salvato
      // è l'unico legame che riconosciamo — la stessa disciplina che su Google
      // è imposta dallo scope, qui è una scelta.
      const created = await calJson<{ id?: string; name?: string }>(`${GRAPH}/me/calendars`, {
        method: 'POST',
        headers: jsonAuth(accessToken),
        body: JSON.stringify({ name }),
        fetchImpl,
      });
      if (!created.id) {
        throw new CalendarProviderError('INVALID_RESPONSE', 'Microsoft non ha restituito l’id del calendario');
      }
      return { calendarId: created.id, name: created.name ?? name, created: true };
    },

    async upsertEvent({ accessToken, calendarId, providerEventId, event }): Promise<CalendarEventRef> {
      const base = `${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}/events`;

      // 1) Se sappiamo già quale evento è, si aggiorna.
      if (providerEventId) {
        const patched = await calFetchTolerating(
          `${base}/${encodeURIComponent(providerEventId)}`,
          [404, 410],
          { method: 'PATCH', headers: jsonAuth(accessToken), body: eventBody(event, false), fetchImpl },
        );
        if (!patched.tolerated) {
          const updated = parseJsonSafe<GraphEvent>(patched.text, base);
          return { providerEventId: updated.id ?? providerEventId };
        }
        // 404: l'utente lo ha cancellato. Si prosegue e se ne crea uno nuovo.
      }

      // 2) Non sappiamo quale sia: si CERCA per metadato prima di scrivere.
      //    È la differenza con Google, e la ragione è nel commento in cima.
      const existing = await adapter.findEventByTask({ accessToken, calendarId, taskId: event.taskId });
      if (existing) {
        const updated = await calJson<GraphEvent>(`${base}/${encodeURIComponent(existing)}`, {
          method: 'PATCH', headers: jsonAuth(accessToken), body: eventBody(event, false), fetchImpl,
        });
        return { providerEventId: updated.id ?? existing };
      }

      // 3) Non c'è: si crea, con `transactionId` a coprire il ritentativo.
      const created = await calJson<GraphEvent>(base, {
        method: 'POST', headers: jsonAuth(accessToken), body: eventBody(event, true), fetchImpl,
      });
      if (!created.id) {
        throw new CalendarProviderError('INVALID_RESPONSE', 'Microsoft non ha restituito l’id dell’evento');
      }
      return { providerEventId: created.id };
    },

    async deleteEvent({ accessToken, calendarId, providerEventId }) {
      await calFetchTolerating(
        `${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(providerEventId)}`,
        [404, 410],
        { method: 'DELETE', headers: auth(accessToken), fetchImpl },
      );
    },

    async eventExists({ accessToken, calendarId, providerEventId }) {
      const probe = await calFetchTolerating(
        `${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(providerEventId)}?$select=id`,
        [404, 410],
        { headers: auth(accessToken), fetchImpl },
      );
      return !probe.tolerated;
    },

    async findEventByTask({ accessToken, calendarId, taskId }) {
      // ⚠️ `taskId` finisce dentro un'espressione OData, cioè in un linguaggio
      // di interrogazione, e viene interpolato come stringa. Oggi arriva sempre
      // dalla nostra tabella e quindi è un UUID, ma «oggi arriva da lì» non è
      // una garanzia: è una consuetudine che il prossimo chiamante può rompere
      // senza accorgersene. Si verifica la forma PRIMA di comporre il filtro —
      // un apostrofo qui dentro cambierebbe il significato dell'espressione.
      if (!/^[0-9a-fA-F-]{36}$/.test(taskId)) {
        throw new CalendarProviderError('INVALID_RESPONSE', 'identificativo dell’attività non valido');
      }
      // Graph permette di filtrare sulle proprietà estese a valore singolo. È
      // l'unico modo di ritrovare un evento senza conoscerne l'identificativo,
      // e non richiede alcun permesso in più.
      const filter =
        `singleValueExtendedProperties/any(ep:ep/id eq '${MS_TASK_PROPERTY}' and ep/value eq '${taskId}')`;
      const url = `${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}/events?` +
        new URLSearchParams({ $filter: filter, $select: 'id', $top: '5' });
      const payload = await calJson<{ value?: GraphEvent[] }>(url, { headers: auth(accessToken), fetchImpl });
      return (payload.value ?? [])[0]?.id ?? null;
    },

    async revoke() {
      // Microsoft NON offre un endpoint per revocare il consenso dall'esterno:
      // si toglie da myapplications.microsoft.com. Qui non si finge il
      // contrario e non si solleva un errore — la disconnessione è comunque
      // avvenuta dalla nostra parte, e la schermata lo dice all'utente perché
      // possa completare il gesto dove va completato (§70).
      return;
    },
  };

  return adapter;
}

/** Il nome della proprietà applicativa, esportato per i test. */
export const MICROSOFT_TASK_PROPERTY_NAME = TASK_METADATA_KEY;
