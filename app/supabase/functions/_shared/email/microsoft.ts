// ============================================================================
// Adapter Microsoft 365 / Outlook (Microsoft Graph).
//
// Permessi DELEGATI richiesti — e solo questi (§2.3):
//   offline_access   per ottenere il refresh token
//   User.Read        identità stabile dell'account collegato
//   Mail.Read        lettura di messaggi e allegati della casella dell'utente
//
// `Mail.Read` non consente di inviare, spostare, cancellare né modificare: come
// per Google, il vincolo vive nel token e non nella nostra disciplina.
//
// Sincronizzazione incrementale con le delta query di Graph; push con le change
// notification. Microsoft documenta esplicitamente le LIFECYCLE NOTIFICATION per
// i casi in cui la sottoscrizione viene rimossa, richiede una nuova
// autorizzazione o ha perso notifiche: non sono casi limite da ignorare, e qui
// `CURSOR_EXPIRED` e `SUBSCRIPTION_GONE` sono codici di dominio veri, che
// portano a una riconciliazione o a una nuova sottoscrizione.
//
// Modulo portabile: nessuna API Deno.
// ============================================================================
import { providerBytes, providerFetch, providerJson, formEncode } from './http.ts';
import {
  detectBulk, headerMap, normalizeBody, normalizeDate, normalizeRecipients, normalizeSubject,
} from './normalize.ts';
import { MICROSOFT_SUBSCRIPTION_MINUTES } from './contract.ts';
import { EmailProviderError } from './types.ts';
import type {
  EmailProviderAdapter, NormalizedAttachment, NormalizedEmailMessage,
  OAuthTokens, ProviderAccountIdentity, ProviderConfig, SyncListResult, WatchResult,
} from './types.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const INBOX = `${GRAPH}/me/mailFolders('inbox')/messages`;

export const MICROSOFT_SCOPES = ['offline_access', 'User.Read', 'Mail.Read'];

/** Risorsa sottoscritta: solo la posta in arrivo, non l'intera casella. */
const SUBSCRIPTION_RESOURCE = "me/mailFolders('inbox')/messages";

const MESSAGE_FIELDS = [
  'id', 'conversationId', 'internetMessageId', 'subject', 'from', 'sender',
  'toRecipients', 'ccRecipients', 'receivedDateTime', 'sentDateTime',
  'body', 'bodyPreview', 'hasAttachments', 'importance', 'internetMessageHeaders',
].join(',');

interface GraphAddress { name?: string | null; address?: string | null }
interface GraphRecipient { emailAddress?: GraphAddress }

interface GraphMessage {
  id: string;
  conversationId?: string | null;
  internetMessageId?: string | null;
  subject?: string | null;
  from?: GraphRecipient | null;
  sender?: GraphRecipient | null;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  body?: { contentType?: string | null; content?: string | null } | null;
  bodyPreview?: string | null;
  hasAttachments?: boolean;
  importance?: string | null;
  internetMessageHeaders?: { name?: string | null; value?: string | null }[] | null;
}

interface GraphAttachment {
  '@odata.type'?: string;
  id?: string;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
  isInline?: boolean;
  contentId?: string | null;
}

const toRecipient = (r: GraphRecipient | null | undefined) => ({
  name: r?.emailAddress?.name ?? null,
  email: r?.emailAddress?.address ?? null,
});

export function createMicrosoftAdapter(config: ProviderConfig): EmailProviderAdapter {
  const fetchImpl = config.fetchImpl;
  const tenant = config.tenant?.trim() || 'common';
  const authorizeUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`;
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
  const auth = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

  async function tokenRequest(params: Record<string, string>): Promise<OAuthTokens> {
    const payload = await providerJson<{
      access_token?: string; refresh_token?: string; expires_in?: number; scope?: string;
    }>(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode(params),
      fetchImpl,
      attempts: 2,
    });
    if (!payload.access_token) {
      throw new EmailProviderError('AUTH_EXPIRED', 'Microsoft non ha restituito un access token');
    }
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      expiresAt: new Date(Date.now() + Math.max(60, (payload.expires_in ?? 3600) - 60) * 1000).toISOString(),
      scopes: (payload.scope ?? '').split(' ').filter(Boolean),
    };
  }

  /**
   * Il cursore delta è un URL COMPLETO fornito da Graph, e viene richiesto con
   * l'access token dell'utente nell'intestazione. Se in quel campo finisse un
   * indirizzo arbitrario — per un guasto, per un dato manomesso, per un errore
   * futuro che concedesse la scrittura su `sync_cursor` — spediremmo il token
   * a un server estraneo. Qui si verifica che sia Graph, e basta: il costo è
   * una riga, il danno evitato è la consegna di una credenziale.
   */
  function assertGraphUrl(url: string): void {
    let host: string;
    try {
      host = new URL(url).host.toLowerCase();
    } catch {
      throw new EmailProviderError('INVALID_RESPONSE', 'cursore di sincronizzazione non è un URL');
    }
    if (host !== 'graph.microsoft.com') {
      throw new EmailProviderError('INVALID_RESPONSE', `cursore verso un host non previsto: ${host}`);
    }
  }

  /**
   * Le delta query restituiscono un `@odata.deltaLink` (fine del giro) oppure un
   * `@odata.nextLink` (c'è un'altra pagina). Si conserva quello che c'è: sono
   * entrambi URL completi e opachi, e ripartire da un `nextLink` è il modo
   * corretto di riprendere una enumerazione interrotta a metà.
   */
  async function readDelta(url: string, accessToken: string, max: number): Promise<SyncListResult> {
    assertGraphUrl(url);
    try {
      const payload = await providerJson<{
        value?: { id?: string; '@removed'?: unknown }[];
        '@odata.nextLink'?: string;
        '@odata.deltaLink'?: string;
      }>(url, { headers: auth(accessToken), fetchImpl });

      const ids = (payload.value ?? [])
        // Una cancellazione non è un messaggio da importare: in versione 1 non
        // si rispecchia lo stato del provider, quindi si ignora.
        .filter((m) => !m['@removed'] && typeof m.id === 'string')
        .map((m) => m.id as string)
        .slice(0, max);

      const next = payload['@odata.nextLink'];
      const delta = payload['@odata.deltaLink'];
      return {
        messageIds: ids,
        cursor: next ?? delta ?? null,
        cursorExpired: false,
        hasMore: !!next,
      };
    } catch (error) {
      // 410 Gone / `resyncRequired`: il token delta non è più valido. È il
      // gemello del `historyId` scaduto di Gmail e si tratta allo stesso modo.
      if (error instanceof EmailProviderError && (error.code === 'CURSOR_EXPIRED' || error.code === 'NOT_FOUND')) {
        return { messageIds: [], cursor: null, cursorExpired: true, hasMore: false };
      }
      throw error;
    }
  }

  const adapter: EmailProviderAdapter = {
    id: 'microsoft',

    buildAuthorizationUrl({ state, codeChallenge, loginHint }) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        redirect_uri: config.redirectUri,
        response_mode: 'query',
        scope: MICROSOFT_SCOPES.join(' '),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      if (loginHint) params.set('login_hint', loginHint);
      return `${authorizeUrl}?${params.toString()}`;
    },

    async exchangeCode({ code, codeVerifier }) {
      return await tokenRequest({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: config.redirectUri,
        scope: MICROSOFT_SCOPES.join(' '),
      });
    },

    async refresh(refreshToken) {
      return await tokenRequest({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: MICROSOFT_SCOPES.join(' '),
      });
    },

    async getAccountIdentity(accessToken): Promise<ProviderAccountIdentity> {
      const me = await providerJson<{ id?: string; mail?: string | null; userPrincipalName?: string | null; displayName?: string | null }>(
        `${GRAPH}/me?$select=id,mail,userPrincipalName,displayName`,
        { headers: auth(accessToken), fetchImpl },
      );
      const email = (me.mail ?? me.userPrincipalName ?? '').toLowerCase();
      if (!me.id || !email) throw new EmailProviderError('INVALID_RESPONSE', 'profilo Microsoft incompleto');
      return { accountId: me.id, emailAddress: email, displayName: me.displayName ?? null };
    },

    async listInitial({ accessToken, since, max }) {
      const url = `${INBOX}?${new URLSearchParams({
        $select: 'id',
        $filter: `receivedDateTime ge ${since}`,
        $orderby: 'receivedDateTime desc',
        $top: String(Math.min(max, 100)),
      })}`;
      const payload = await providerJson<{ value?: { id?: string }[]; '@odata.nextLink'?: string }>(url, {
        headers: auth(accessToken), fetchImpl,
      });
      return {
        messageIds: (payload.value ?? []).map((m) => m.id).filter((id): id is string => !!id).slice(0, max),
        cursor: null,
        cursorExpired: false,
        hasMore: !!payload['@odata.nextLink'],
      };
    },

    async listIncremental({ accessToken, cursor, max }) {
      if (!cursor) return { messageIds: [], cursor: null, cursorExpired: true, hasMore: false };
      return await readDelta(cursor, accessToken, max);
    },

    async listWindow({ accessToken, since, max }) {
      return await adapter.listInitial({ accessToken, since, max });
    },

    async getCurrentCursor(accessToken) {
      // `$deltatoken=latest` restituisce il segnalibro «da adesso in poi» senza
      // enumerare la cartella: è il modo documentato per iniziare a osservare i
      // cambiamenti futuri dopo un import iniziale fatto per data.
      const payload = await providerJson<{ '@odata.deltaLink'?: string }>(
        `${INBOX}/delta?$deltatoken=latest&$select=id`,
        { headers: auth(accessToken), fetchImpl },
      );
      return payload['@odata.deltaLink'] ?? null;
    },

    async getMessage({ accessToken, messageId }): Promise<NormalizedEmailMessage> {
      const message = await providerJson<GraphMessage>(
        `${GRAPH}/me/messages/${encodeURIComponent(messageId)}?$select=${encodeURIComponent(MESSAGE_FIELDS)}`,
        { headers: auth(accessToken), fetchImpl },
      );

      const isHtml = (message.body?.contentType ?? '').toLowerCase() === 'html';
      const content = message.body?.content ?? '';
      const body = normalizeBody({
        html: isHtml ? content : null,
        text: isHtml ? (message.bodyPreview ?? null) : content,
      });

      const headers = headerMap(message.internetMessageHeaders);
      const fromRaw = toRecipient(message.from ?? message.sender);
      const from = fromRaw.email
        ? { name: fromRaw.name, email: fromRaw.email.toLowerCase() }
        : null;

      let attachments: NormalizedAttachment[] = [];
      if (message.hasAttachments) {
        const list = await providerJson<{ value?: GraphAttachment[] }>(
          `${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline,contentId`,
          { headers: auth(accessToken), fetchImpl },
        );
        attachments = (list.value ?? []).slice(0, 60).map((a) => ({
          externalId: a.id ?? '',
          filename: a.name ?? null,
          // Un `itemAttachment` (un messaggio allegato a un altro messaggio) o un
          // `referenceAttachment` (un link a OneDrive) non sono file scaricabili
          // da questo endpoint: si dichiara il tipo reale, così la politica sugli
          // allegati li scarta con un motivo invece di fallire nel download.
          declaredMimeType: a['@odata.type'] === '#microsoft.graph.fileAttachment'
            ? (a.contentType ?? null)
            : (a['@odata.type'] ?? 'application/octet-stream'),
          sizeBytes: typeof a.size === 'number' ? a.size : null,
          contentId: a.contentId ?? null,
          isInline: a.isInline === true || !!a.contentId,
        })).filter((a) => a.externalId);
      }

      return {
        externalId: message.id,
        threadId: message.conversationId ?? null,
        internetMessageId: message.internetMessageId?.replace(/^<|>$/g, '') || null,
        subject: normalizeSubject(message.subject),
        from,
        to: normalizeRecipients((message.toRecipients ?? []).map(toRecipient)),
        cc: normalizeRecipients((message.ccRecipients ?? []).map(toRecipient)),
        receivedAt: normalizeDate(message.receivedDateTime) ?? new Date().toISOString(),
        sentAt: normalizeDate(message.sentDateTime),
        textBody: body.text,
        preview: body.preview || (message.bodyPreview ?? '').trim(),
        links: body.links,
        attachments,
        isBulk: detectBulk(headers),
        importance: message.importance ?? null,
      };
    },

    async getAttachment({ accessToken, messageId, attachmentId }) {
      return await providerBytes(
        `${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`,
        { headers: auth(accessToken), fetchImpl, timeoutMs: 45_000 },
      );
    },

    async createWatch({ accessToken, notificationUrl, clientState }): Promise<WatchResult> {
      const expiration = new Date(Date.now() + MICROSOFT_SUBSCRIPTION_MINUTES * 60_000).toISOString();
      const payload = await providerJson<{ id?: string; expirationDateTime?: string }>(`${GRAPH}/subscriptions`, {
        method: 'POST',
        headers: { ...auth(accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changeType: 'created',
          notificationUrl,
          // Le notifiche di ciclo di vita arrivano allo stesso endpoint: è lì
          // che si scopre che una sottoscrizione è stata rimossa o che serve una
          // nuova autorizzazione, prima che la casella smetta di aggiornarsi.
          lifecycleNotificationUrl: notificationUrl,
          resource: SUBSCRIPTION_RESOURCE,
          expirationDateTime: expiration,
          clientState,
        }),
        fetchImpl,
      });
      return {
        resourceId: payload.id ?? null,
        expiresAt: payload.expirationDateTime ?? expiration,
        clientState,
      };
    },

    async renewWatch({ accessToken, resourceId, notificationUrl, clientState }): Promise<WatchResult> {
      if (!resourceId) return await adapter.createWatch({ accessToken, notificationUrl, clientState });
      const expiration = new Date(Date.now() + MICROSOFT_SUBSCRIPTION_MINUTES * 60_000).toISOString();
      try {
        const payload = await providerJson<{ id?: string; expirationDateTime?: string }>(
          `${GRAPH}/subscriptions/${encodeURIComponent(resourceId)}`,
          {
            method: 'PATCH',
            headers: { ...auth(accessToken), 'Content-Type': 'application/json' },
            body: JSON.stringify({ expirationDateTime: expiration }),
            fetchImpl,
          },
        );
        return { resourceId: payload.id ?? resourceId, expiresAt: payload.expirationDateTime ?? expiration, clientState };
      } catch (error) {
        // Sottoscrizione già sparita: se ne crea una nuova. È il caso che le
        // lifecycle notification annunciano, e che comunque va gestito anche
        // quando la notifica non arriva.
        if (error instanceof EmailProviderError && (error.code === 'NOT_FOUND' || error.code === 'SUBSCRIPTION_GONE')) {
          return await adapter.createWatch({ accessToken, notificationUrl, clientState });
        }
        throw error;
      }
    },

    async stopWatch({ accessToken, resourceId }) {
      if (!resourceId) return;
      try {
        await providerFetch(`${GRAPH}/subscriptions/${encodeURIComponent(resourceId)}`, {
          method: 'DELETE', headers: auth(accessToken), fetchImpl, attempts: 2,
        });
      } catch (error) {
        // Una sottoscrizione già assente è il risultato voluto, non un errore.
        if (error instanceof EmailProviderError && error.code === 'NOT_FOUND') return;
        throw error;
      }
    },

    async revoke() {
      // Microsoft non espone una revoca del singolo consenso applicativo
      // paragonabile a quella di Google: l'unico endpoint disponibile
      // (`revokeSignInSessions`) invaliderebbe TUTTE le sessioni dell'utente,
      // ben oltre quello che «scollega la casella da AI-Swisse» deve fare.
      // Quindi qui non si finge una revoca: si distruggono i token e la
      // sottoscrizione, e la schermata dice all'utente dove togliere il consenso
      // dal proprio account Microsoft. Meglio dichiarare il limite che simulare
      // un'azione che non avviene.
    },
  };

  return adapter;
}
