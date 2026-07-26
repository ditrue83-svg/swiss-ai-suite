// ============================================================================
// Adapter Google Workspace / Gmail.
//
// Scope richiesti — e SOLO questi (§2.3):
//   openid                                        identità stabile dell'account
//   https://www.googleapis.com/auth/gmail.readonly  lettura di messaggi e allegati
//
// `gmail.readonly` non consente di cancellare, spostare, etichettare o inviare:
// il vincolo non è nel nostro codice, è nel token. Anche un bug qui non potrebbe
// modificare la casella dell'utente.
//
// Sincronizzazione incrementale secondo il modello ufficiale `users.history`,
// con push via Cloud Pub/Sub. La documentazione Gmail è esplicita nel dire che
// le notifiche push non sono una garanzia di consegna e che serve una strategia
// di recupero: qui `listWindow` esiste per quello, e `CURSOR_EXPIRED` viene
// dichiarato invece di essere assorbito — un `historyId` troppo vecchio significa
// che dei messaggi POTREBBERO essere stati persi, e va detto.
//
// Modulo portabile: nessuna API Deno. La configurazione arriva per parametro.
// ============================================================================
import { providerBytes, providerFetch, providerJson, formEncode } from './http.ts';
import { fromBase64 } from './crypto.ts';
import {
  detectBulk, headerMap, normalizeBody, normalizeDate, normalizeSubject,
  parseAddress, parseAddressList,
} from './normalize.ts';
import { EmailProviderError } from './types.ts';
import type {
  EmailProviderAdapter, NormalizedAttachment, NormalizedEmailMessage,
  OAuthTokens, ProviderAccountIdentity, ProviderConfig, SyncListResult, WatchResult,
} from './types.ts';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export const GOOGLE_SCOPES = ['openid', 'https://www.googleapis.com/auth/gmail.readonly'];

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name?: string; value?: string }[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
}

/** Decodifica il corpo di una parte MIME (base64url) rispettando il charset. */
function decodePartBody(part: GmailPart): string {
  const data = part.body?.data;
  if (!data) return '';
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(data);
  } catch {
    return '';
  }
  const headers = headerMap(part.headers);
  const contentType = headers['content-type'] ?? '';
  const charsetMatch = contentType.match(/charset="?([\w-]+)"?/i);
  const charset = (charsetMatch?.[1] ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

/**
 * Percorre l'albero MIME raccogliendo testo, HTML e allegati.
 *
 * La ricorsione è limitata in profondità: un messaggio costruito ad arte può
 * annidare parti a piacere, e un albero senza limite è un modo semplice per far
 * finire la memoria di un isolate.
 */
function walkParts(
  part: GmailPart | undefined,
  acc: { text: string[]; html: string[]; attachments: NormalizedAttachment[] },
  depth = 0,
): void {
  if (!part || depth > 12) return;
  const mime = (part.mimeType ?? '').toLowerCase();
  const headers = headerMap(part.headers);
  const disposition = headers['content-disposition'] ?? '';
  const contentId = (headers['content-id'] ?? '').replace(/^<|>$/g, '') || null;
  const isAttachment = !!part.body?.attachmentId || (!!part.filename && part.filename.length > 0);

  if (isAttachment) {
    if (acc.attachments.length < 60) {
      acc.attachments.push({
        externalId: part.body?.attachmentId ?? `part:${part.partId ?? String(acc.attachments.length)}`,
        filename: part.filename || null,
        declaredMimeType: mime || null,
        sizeBytes: typeof part.body?.size === 'number' ? part.body.size : null,
        contentId,
        // «inline» quando lo dichiara la disposizione oppure quando ha un
        // Content-ID: entrambe le forme indicano un'immagine incorporata.
        isInline: /inline/i.test(disposition) || !!contentId,
      });
    }
    return;                                     // un allegato non ha corpo da leggere
  }

  if (mime === 'text/plain') acc.text.push(decodePartBody(part));
  else if (mime === 'text/html') acc.html.push(decodePartBody(part));

  for (const child of part.parts ?? []) walkParts(child, acc, depth + 1);
}

export function createGoogleAdapter(config: ProviderConfig): EmailProviderAdapter {
  const fetchImpl = config.fetchImpl;
  const auth = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

  /**
   * `sub` dell'id_token: identità stabile dell'account Google. Il token arriva
   * direttamente dall'endpoint di Google su TLS, quindi secondo OpenID Connect
   * (§3.1.3.7) il client può leggerlo senza verificarne la firma. NON si usa mai
   * un id_token ricevuto per altre vie.
   */
  function subjectFromIdToken(idToken: string | undefined): string | null {
    if (!idToken) return null;
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    try {
      const payload = JSON.parse(new TextDecoder().decode(fromBase64(parts[1]))) as { sub?: string };
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  // L'identità stabile arriva nell'id_token dello scambio del codice, mentre
  // `getAccountIdentity` interroga Gmail — due chiamate diverse. Si conserva qui
  // fra l'una e l'altra, per la durata di UN flusso di collegamento.
  let idTokenSubject: string | null = null;

  async function tokenRequest(params: Record<string, string>): Promise<OAuthTokens> {
    const payload = await providerJson<{
      access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string;
    }>(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode(params),
      fetchImpl,
      attempts: 2,
    });
    if (!payload.access_token) {
      throw new EmailProviderError('AUTH_EXPIRED', 'Google non ha restituito un access token');
    }
    const subject = subjectFromIdToken(payload.id_token);
    if (subject) idTokenSubject = subject;
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      expiresAt: new Date(Date.now() + Math.max(60, (payload.expires_in ?? 3600) - 60) * 1000).toISOString(),
      scopes: (payload.scope ?? '').split(' ').filter(Boolean),
    };
  }

  const adapter: EmailProviderAdapter = {
    id: 'google',

    buildAuthorizationUrl({ state, codeChallenge, loginHint }) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        // `offline` è ciò che fa emettere il refresh token; `consent` lo fa
        // riemettere anche quando l'utente aveva già autorizzato l'app —
        // altrimenti una riconnessione otterrebbe un access token e nessun
        // refresh token, e la casella si spegnerebbe dopo un'ora.
        access_type: 'offline',
        prompt: 'consent',
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

    async getAccountIdentity(accessToken): Promise<ProviderAccountIdentity> {
      const profile = await providerJson<{ emailAddress?: string }>(`${API}/profile`, {
        headers: auth(accessToken), fetchImpl,
      });
      const email = profile.emailAddress;
      if (!email) throw new EmailProviderError('INVALID_RESPONSE', 'profilo Gmail senza indirizzo');
      return {
        // Se l'id_token non è arrivato si ripiega sull'indirizzo, DICHIARANDOLO
        // con un prefisso: così è evidente, guardando il dato, che quella
        // identità è meno stabile e non la si scambia per un `sub` di Google.
        accountId: idTokenSubject ?? `email:${email.toLowerCase()}`,
        emailAddress: email.toLowerCase(),
        displayName: null,
      };
    },

    async listInitial({ accessToken, since, max }) {
      // Gmail vuole `after:` in formato AAAA/MM/GG.
      const day = since.slice(0, 10).replace(/-/g, '/');
      const url = `${API}/messages?${new URLSearchParams({
        q: `in:inbox after:${day}`,
        maxResults: String(Math.min(max, 100)),
      })}`;
      const payload = await providerJson<{ messages?: { id: string }[]; nextPageToken?: string }>(url, {
        headers: auth(accessToken), fetchImpl,
      });
      return {
        messageIds: (payload.messages ?? []).map((m) => m.id).slice(0, max),
        cursor: null,                            // il cursore vero si prende con getCurrentCursor
        cursorExpired: false,
        hasMore: !!payload.nextPageToken,
      };
    },

    async listIncremental({ accessToken, cursor, max }) {
      if (!cursor) return { messageIds: [], cursor: null, cursorExpired: true, hasMore: false };
      const url = `${API}/history?${new URLSearchParams({
        startHistoryId: cursor,
        historyTypes: 'messageAdded',
        labelId: 'INBOX',
        maxResults: String(Math.min(max, 100)),
      })}`;
      try {
        const payload = await providerJson<{
          history?: { messagesAdded?: { message?: { id?: string } }[] }[];
          historyId?: string;
          nextPageToken?: string;
        }>(url, { headers: auth(accessToken), fetchImpl });

        const ids = new Set<string>();
        for (const entry of payload.history ?? []) {
          for (const added of entry.messagesAdded ?? []) {
            const id = added.message?.id;
            if (id) ids.add(id);
          }
        }
        return {
          messageIds: [...ids].slice(0, max),
          cursor: payload.historyId ?? cursor,
          cursorExpired: false,
          hasMore: !!payload.nextPageToken,
        };
      } catch (error) {
        // 404 su `history` significa: il punto di partenza è più vecchio della
        // finestra che Gmail conserva. Non è un guasto, ed è esattamente il caso
        // in cui NON si può sapere cosa è successo nel frattempo: si dichiara,
        // e la riconciliazione rilegge la finestra recente.
        if (error instanceof EmailProviderError && (error.code === 'NOT_FOUND' || error.code === 'CURSOR_EXPIRED')) {
          return { messageIds: [], cursor: null, cursorExpired: true, hasMore: false };
        }
        throw error;
      }
    },

    async listWindow({ accessToken, since, max }) {
      const day = since.slice(0, 10).replace(/-/g, '/');
      const url = `${API}/messages?${new URLSearchParams({
        q: `in:inbox after:${day}`,
        maxResults: String(Math.min(max, 100)),
      })}`;
      const payload = await providerJson<{ messages?: { id: string }[]; nextPageToken?: string }>(url, {
        headers: auth(accessToken), fetchImpl,
      });
      return {
        messageIds: (payload.messages ?? []).map((m) => m.id).slice(0, max),
        cursor: null,
        cursorExpired: false,
        hasMore: !!payload.nextPageToken,
      };
    },

    async getCurrentCursor(accessToken) {
      const profile = await providerJson<{ historyId?: string }>(`${API}/profile`, {
        headers: auth(accessToken), fetchImpl,
      });
      return profile.historyId ?? null;
    },

    async getMessage({ accessToken, messageId }): Promise<NormalizedEmailMessage> {
      const message = await providerJson<GmailMessage>(
        `${API}/messages/${encodeURIComponent(messageId)}?format=full`,
        { headers: auth(accessToken), fetchImpl },
      );
      const headers = headerMap(message.payload?.headers);
      const acc = { text: [] as string[], html: [] as string[], attachments: [] as NormalizedAttachment[] };
      walkParts(message.payload, acc);

      const body = normalizeBody({ html: acc.html.join('\n'), text: acc.text.join('\n') });
      const receivedAt =
        normalizeDate(message.internalDate ? Number(message.internalDate) : null) ??
        normalizeDate(headers.date) ??
        new Date().toISOString();

      return {
        externalId: message.id,
        threadId: message.threadId ?? null,
        internetMessageId: headers['message-id']?.replace(/^<|>$/g, '') || null,
        subject: normalizeSubject(headers.subject),
        from: parseAddress(headers.from),
        to: parseAddressList(headers.to),
        cc: parseAddressList(headers.cc),
        receivedAt,
        sentAt: normalizeDate(headers.date),
        textBody: body.text,
        preview: body.preview,
        links: body.links,
        attachments: acc.attachments,
        isBulk: detectBulk(headers),
        importance: headers['importance'] ?? headers['x-priority'] ?? null,
      };
    },

    async getAttachment({ accessToken, messageId, attachmentId }) {
      const payload = await providerJson<{ data?: string; size?: number }>(
        `${API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
        { headers: auth(accessToken), fetchImpl, timeoutMs: 45_000 },
      );
      if (!payload.data) throw new EmailProviderError('NOT_FOUND', 'allegato senza contenuto');
      return fromBase64(payload.data);
    },

    async createWatch({ accessToken, clientState }): Promise<WatchResult> {
      if (!config.pubsubTopic) {
        throw new EmailProviderError('CONFIG_MISSING', 'GOOGLE_PUBSUB_TOPIC non configurato');
      }
      const payload = await providerJson<{ historyId?: string; expiration?: string }>(`${API}/watch`, {
        method: 'POST',
        headers: { ...auth(accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicName: config.pubsubTopic,
          labelIds: ['INBOX'],
          labelFilterBehavior: 'include',
        }),
        fetchImpl,
      });
      return {
        // Gmail non emette un identificativo di sottoscrizione: il `watch` è uno
        // solo per casella e si rinnova richiamando lo stesso endpoint.
        resourceId: 'gmail-watch',
        expiresAt: payload.expiration ? new Date(Number(payload.expiration)).toISOString() : null,
        // Il segreto condiviso non serve a Gmail: la notifica Pub/Sub si
        // autentica con il token OIDC che Google firma. Si conserva comunque
        // per uniformità del contratto.
        clientState,
      };
    },

    async renewWatch(input) {
      // Rinnovare è ricreare: Gmail lo documenta così. Si richiama la funzione
      // per nome e non tramite `this`, che in un oggetto letterale dipende da
      // come il metodo viene invocato — e questo adapter viene passato in giro.
      return await adapter.createWatch(input);
    },

    async stopWatch({ accessToken }) {
      await providerFetch(`${API}/stop`, {
        method: 'POST',
        headers: { ...auth(accessToken), 'Content-Type': 'application/json' },
        body: '{}',
        fetchImpl,
        attempts: 2,
      });
    },

    async revoke({ accessToken, refreshToken }) {
      // Si revoca il refresh token quando c'è: revocarlo invalida l'intera
      // concessione, mentre revocare il solo access token la lascerebbe viva.
      const token = refreshToken ?? accessToken;
      await providerFetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formEncode({ token }),
        fetchImpl,
        attempts: 2,
      });
    },
  };

  return adapter;
}
