// ============================================================================
// Edge Function: calendar-disconnect — scollegare un calendario.
//
// ⚠️ L'ORDINE DELLE OPERAZIONI È IL CONTENUTO DI QUESTO FILE (§70)
// Se si revocasse il token per primo, non si potrebbero più togliere gli eventi
// già scritti: resterebbero per sempre nel calendario di una persona, a
// raccontare scadenze che nessuno aggiorna più, e nemmeno noi sapremmo più
// quali sono. Quindi:
//
//   1. si spegne la sincronizzazione, così nulla di nuovo viene scritto
//      mentre il resto è in corso;
//   2. SE l'utente ha chiesto di rimuovere gli eventi, li si rimuove ADESSO,
//      finché il token è ancora valido;
//   3. si revoca il consenso presso il provider, dove è supportato;
//   4. si distruggono i segreti;
//   5. si marca la connessione come scollegata.
//
// ⚠️ GLI EVENTI NON SI CANCELLANO SENZA CHIEDERE
// Sono nel calendario personale di qualcuno e possono essere l'unica traccia
// che quella persona ha di una scadenza. La scelta è dell'utente e arriva
// esplicita nella richiesta; non esiste un valore predefinito che decida al suo
// posto — `removeEvents` va detto, e se non viene detto gli eventi restano.
//
// ⚠️ MICROSOFT NON SI PUÒ REVOCARE DALL'ESTERNO
// Graph non espone un endpoint di revoca del consenso: si toglie da
// myapplications.microsoft.com. La risposta lo DICHIARA (`revoked: false`) e la
// schermata lo dice all'utente, invece di lasciargli credere che il consenso
// sia stato ritirato quando non lo è stato.
// ============================================================================
import {
  adapterFor, adminClient, assertMember, authenticate, CORS, failure,
  getEncryptionKey, json, logEvent,
} from '../_shared/calendar/runtime.ts';
import {
  deleteSecrets, getConnection, getValidAccessToken, readSecrets,
} from '../_shared/calendar/store.ts';
import { CalendarProviderError } from '../_shared/calendar/types.ts';

interface LinkRow { id: string; provider_event_id: string; provider_calendar_id: string }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);

  try {
    const auth = await authenticate(req);
    if (!auth) return failure('UNAUTHENTICATED', 401);

    const body = await req.json().catch(() => null) as { connectionId?: string; removeEvents?: boolean } | null;
    const connectionId = typeof body?.connectionId === 'string' ? body.connectionId : null;
    if (!connectionId) return failure('BAD_REQUEST', 400);
    // Assente = si lasciano. Una cancellazione non parte da un valore mancante.
    const removeEvents = body?.removeEvents === true;

    const sb = adminClient();
    const connection = await getConnection(sb, connectionId);
    if (!connection) return failure('NOT_FOUND', 404);

    // Un calendario è personale: lo scollega chi lo ha collegato, e nessun
    // altro — nemmeno il titolare dell'azienda. Doppio controllo: la
    // connessione dev'essere sua, e l'azienda una di cui è membro (via RLS).
    if (connection.user_id !== auth.userId) return failure('FORBIDDEN', 403);
    if (!(await assertMember(auth, connection.company_id))) return failure('FORBIDDEN', 403);

    // 1. Nulla di nuovo viene più scritto.
    await sb.from('calendar_connections')
      .update({ sync_enabled: false }).eq('id', connection.id);

    const key = await getEncryptionKey();
    const adapter = adapterFor(connection.provider);
    const report = { eventsRemoved: 0, eventsLeft: 0, revoked: false, removalFailed: false };

    // 2. Gli eventi, se l'utente lo ha chiesto — e finché il token è valido.
    let accessToken: string | null = null;
    try {
      accessToken = await getValidAccessToken(sb, key, connection, adapter);
    } catch {
      // Nessun token utilizzabile: non si può togliere niente e non si può
      // revocare niente. Lo scollegamento prosegue comunque — è il gesto che
      // l'utente ha chiesto — e la risposta dichiara che gli eventi restano.
      accessToken = null;
    }

    const { data: linkData } = await sb.from('calendar_event_links')
      .select('id, provider_event_id, provider_calendar_id')
      .eq('connection_id', connection.id);
    const links = (linkData ?? []) as LinkRow[];

    if (removeEvents && accessToken) {
      for (const link of links) {
        try {
          await adapter.deleteEvent({
            accessToken,
            calendarId: link.provider_calendar_id,
            providerEventId: link.provider_event_id,
          });
          report.eventsRemoved++;
        } catch {
          // Un evento che non si riesce a togliere non blocca lo scollegamento,
          // ma NON si finge che sia stato tolto: si conta a parte e la risposta
          // lo dice.
          report.removalFailed = true;
          report.eventsLeft++;
        }
      }
    } else {
      report.eventsLeft = links.length;
    }

    // 3. Revoca presso il provider, dove esiste.
    if (accessToken) {
      try {
        const secrets = await readSecrets(sb, key, connection.id);
        await adapter.revoke({ accessToken, refreshToken: secrets.refreshToken });
        report.revoked = connection.provider === 'google';
      } catch {
        // Una revoca fallita non impedisce lo scollegamento dalla nostra parte:
        // i segreti vengono distrutti comunque, quindi il token diventa
        // inutilizzabile da qui. Lo si dichiara e basta.
        report.revoked = false;
      }
    }

    // 4. I segreti spariscono. Da questo momento il token non è più
    //    utilizzabile da AI-Swisse, revoca o non revoca.
    await deleteSecrets(sb, connection.id);

    // 5. I collegamenti locali si tolgono: puntano a eventi che o non esistono
    //    più o non sono più nostri da gestire. Tenerli significherebbe che una
    //    riconnessione futura crederebbe di dover aggiornare eventi di cui non
    //    sa più nulla.
    await sb.from('calendar_event_links').delete().eq('connection_id', connection.id);

    await sb.from('calendar_connections').update({
      status: 'disconnected',
      sync_enabled: false,
      provider_calendar_id: null,
      calendar_name: null,
      last_error_code: null,
      last_error_at: null,
    }).eq('id', connection.id);

    logEvent('calendar-disconnect', {
      provider: connection.provider,
      removed: report.eventsRemoved,
      left: report.eventsLeft,
      revoked: report.revoked,
    });
    return json({ status: 'ok', ...report });
  } catch (error) {
    const code = error instanceof CalendarProviderError ? error.code : 'UNKNOWN';
    logEvent('calendar-disconnect', { code });
    return failure(code, code === 'CONFIG_MISSING' ? 503 : 500);
  }
});
