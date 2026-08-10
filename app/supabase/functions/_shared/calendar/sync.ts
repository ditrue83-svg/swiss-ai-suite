// ============================================================================
// Il motore di sincronizzazione: da «lo stato desiderato» alle chiamate reali.
//
// LA REGOLA CHE GOVERNA TUTTO IL FILE: qui dentro non c'è nessuna decisione
// sulla presenza di un evento. Nessun `if (task.status === 'completed')`,
// nessun `if (!task.dueDate)`. Quelle condizioni vivono TUTTE in
// `getCalendarDesiredState`, che è pura e ha i propri test; questo file le
// legge e obbedisce.
//
// Non è un vezzo di struttura. Un `if` in più scritto qui — «se l'attività è
// archiviata salta» — sembrerebbe innocuo e creerebbe una seconda definizione
// di «l'evento deve esistere», che diverge dalla prima al primo caso limite e
// che nessun test coglierebbe, perché i test provano la funzione pura.
//
// L'UNITÀ DI LAVORO È L'ATTIVITÀ, NON LA COPPIA (ATTIVITÀ, CALENDARIO).
// Quando cambia il responsabile bisogna togliere un evento da un calendario e
// metterlo su un altro, e le due cose devono succedere insieme o non succedere:
// se la coda fosse per coppia, l'evento del vecchio responsabile potrebbe
// restare per ore accanto a quello del nuovo, e due persone crederebbero
// entrambe di doverlo fare.
// ============================================================================
import {
  buildEventContent, eventContentHash, eventKeyFor, getCalendarDesiredState,
  type DesiredStateConnection, type DesiredStateTask,
} from './desired.ts';
import { dedicatedCalendarName } from './contract.ts';
import { CalendarProviderError, type CalendarProviderAdapter } from './types.ts';
import {
  activeConnections, claimCalendarCreation, defaultPreferences, deleteLink, enqueueTasks,
  getConnection, getValidAccessToken, linksForTask, markConnectionOk, preferencesFor,
  releaseCalendarCreation, upsertLink,
  type CalendarConnectionRow, type EventLinkRow, type ServerClient,
} from './store.ts';

export interface SyncDeps {
  sb: ServerClient;
  encryptionKey: CryptoKey;
  adapterFor: (provider: 'google' | 'microsoft') => CalendarProviderAdapter;
  /** URL canonico dell'applicazione, deciso dal server. */
  appOrigin: string;
  /**
   * Memoria dei nomi azienda per la DURATA DI UNA ESECUZIONE.
   *
   * La crea chi invoca la funzione, non questo modulo: una cache a livello di
   * modulo sopravviverebbe fra un'invocazione e l'altra dello stesso isolate, e
   * un'azienda rinominata continuerebbe a comparire con il vecchio nome nel
   * calendario di qualcuno finché il runtime non ricicla — un dato stantio che
   * nessuno saprebbe spiegare.
   */
  companyNames: Map<string, string>;
}

export interface SyncOutcome {
  upserted: number;
  deleted: number;
  failures: number;
  /** Connessioni saltate perché non in grado di parlare con il provider. */
  untouchable: number;
  /** Il primo codice di guasto incontrato, per il registro. */
  errorCode: string | null;
  /** Vero quando il guasto richiede un gesto dell'utente: non ha senso ritentare. */
  fatal: boolean;
}

const TASK_COLUMNS =
  'id, company_id, title, due_date, status, priority, assignee_user_id, archived_at';

interface TaskRow {
  id: string; company_id: string; title: string; due_date: string | null;
  status: 'open' | 'in_progress' | 'waiting' | 'completed';
  priority: 'low' | 'medium' | 'high';
  assignee_user_id: string | null; archived_at: string | null;
}

const toDesiredTask = (t: TaskRow): DesiredStateTask => ({
  id: t.id, companyId: t.company_id, title: t.title, dueDate: t.due_date,
  status: t.status, priority: t.priority,
  assigneeUserId: t.assignee_user_id, archivedAt: t.archived_at,
});

const toDesiredConnection = (c: CalendarConnectionRow): DesiredStateConnection => ({
  id: c.id, companyId: c.company_id, userId: c.user_id,
  status: c.status, syncEnabled: c.sync_enabled,
});

/**
 * Porta UNA attività allo stato desiderato su tutti i calendari che la
 * riguardano.
 *
 * «Che la riguardano» è l'unione di due insiemi, e nessuno dei due basta da
 * solo: le connessioni ATTIVE dell'azienda — dove l'evento potrebbe dover
 * comparire — e le connessioni che hanno GIÀ un collegamento per questa
 * attività, dove potrebbe dover sparire. Guardare solo le prime lascerebbe per
 * sempre l'evento sul calendario di chi non è più responsabile.
 */
export async function syncTask(deps: SyncDeps, taskId: string): Promise<SyncOutcome> {
  const out: SyncOutcome = { upserted: 0, deleted: 0, failures: 0, untouchable: 0, errorCode: null, fatal: false };

  const { data: taskData } = await deps.sb.from('tasks').select(TASK_COLUMNS).eq('id', taskId).maybeSingle();
  const task = taskData as TaskRow | null;
  // Attività sparita: i collegamenti sono già spariti con lei (cascata sulla
  // chiave esterna). Gli eventi presso il provider restano orfani, e questo è
  // un LIMITE DICHIARATO: quando la riga non c'è più non sappiamo nemmeno su
  // quale calendario cercarli. Le attività non si cancellano — si archiviano — e
  // l'archiviazione passa dal percorso normale, che l'evento lo rimuove.
  if (!task) return out;

  const links = await linksForTask(deps.sb, taskId);
  const active = await activeConnections(deps.sb, task.company_id);

  // Le connessioni dei collegamenti esistenti che non sono più fra le attive.
  const known = new Map<string, CalendarConnectionRow>();
  for (const c of active) known.set(c.id, c);
  const missingIds = [...new Set(links.map((l) => l.connection_id))].filter((id) => !known.has(id));
  if (missingIds.length) {
    const { data } = await deps.sb.from('calendar_connections')
      .select('id, company_id, user_id, provider, provider_account_id, email_address, provider_calendar_id, calendar_name, status, sync_enabled, initial_sync_completed_at, last_sync_at, last_successful_sync_at, sync_lease_id, sync_lease_until')
      .in('id', missingIds);
    for (const c of (data ?? []) as CalendarConnectionRow[]) known.set(c.id, c);
  }

  if (!known.size) return out;

  const companyName = await companyNameOf(deps, task.company_id);
  const prefs = await preferencesFor(deps.sb, task.company_id, [...new Set([...known.values()].map((c) => c.user_id))]);
  const linkByConnection = new Map(links.map((l) => [l.connection_id, l]));

  for (const connection of known.values()) {
    const desired = getCalendarDesiredState(toDesiredTask(task), toDesiredConnection(connection));
    const link = linkByConnection.get(connection.id) ?? null;

    // Non si può scrivere e non si può concludere niente: si lascia tutto com'è.
    // ⚠️ Questo ramo è la ragione per cui `untouchable` esiste come stato
    // separato da `absent`: trattarlo come «l'evento non deve esserci»
    // svuoterebbe il calendario di chi ha solo un token da rinnovare.
    if (desired.kind === 'untouchable') { out.untouchable++; continue; }

    try {
      if (desired.kind === 'absent') {
        if (link) {
          const { adapter, accessToken } = await open(deps, connection);
          await adapter.deleteEvent({
            accessToken,
            calendarId: link.provider_calendar_id,
            providerEventId: link.provider_event_id,
          });
          // Prima l'evento, poi la riga: se si cancellasse prima la riga e la
          // chiamata fallisse, resterebbe un evento nel calendario di una
          // persona che nessuno sa più di aver creato.
          await deleteLink(deps.sb, link.id);
          out.deleted++;
        }
        continue;
      }

      // desired.kind === 'present'
      const { adapter, accessToken } = await open(deps, connection);
      const calendar = await ensureCalendar(deps, connection, adapter, accessToken, companyName);
      const p = prefs.get(connection.user_id) ?? defaultPreferences(task.company_id, connection.user_id);

      const content = buildEventContent({
        task: { id: task.id, title: task.title, dueDate: task.due_date, priority: task.priority },
        companyName,
        appOrigin: deps.appOrigin,
        locale: p.locale,
        showTitle: p.show_task_title,
      });
      const hash = await eventContentHash({
        calendarId: calendar, title: content.title, description: content.description, date: task.due_date as string,
      });

      // Niente è cambiato: nessuna chiamata. È ciò che rende sopportabile una
      // riconciliazione quotidiana su decine di attività.
      if (link && link.sync_status === 'synced' && link.content_hash === hash
          && link.provider_calendar_id === calendar) {
        continue;
      }

      // L'identificativo noto vale solo se punta allo STESSO calendario: dopo
      // che l'utente ha cancellato il calendario e ne abbiamo creato un altro,
      // quel numero appartiene a un evento che non esiste più.
      const knownEventId = link && link.provider_calendar_id === calendar ? link.provider_event_id : null;

      const ref = await adapter.upsertEvent({
        accessToken,
        calendarId: calendar,
        providerEventId: knownEventId,
        event: {
          eventKey: await eventKeyFor(task.id, connection.id),
          title: content.title,
          description: content.description,
          date: task.due_date as string,
          taskId: task.id,
        },
      });

      await upsertLink(deps.sb, {
        companyId: task.company_id,
        userId: connection.user_id,
        connectionId: connection.id,
        taskId: task.id,
        providerEventId: ref.providerEventId,
        providerCalendarId: calendar,
        contentHash: hash,
      });
      await markConnectionOk(deps.sb, connection.id);
      out.upserted++;
    } catch (error) {
      const code = error instanceof CalendarProviderError ? error.code : 'UNKNOWN';
      out.failures++;
      out.errorCode ??= code;
      // Un consenso revocato non si risolve riprovando: si smette e si dichiara.
      if (code === 'AUTH_EXPIRED' || code === 'AUTH_INSUFFICIENT_SCOPE') out.fatal = true;
    }
  }

  return out;
}

/** Adapter e token pronti all'uso per una connessione. */
async function open(deps: SyncDeps, connection: CalendarConnectionRow) {
  const adapter = deps.adapterFor(connection.provider);
  const accessToken = await getValidAccessToken(deps.sb, deps.encryptionKey, connection, adapter);
  return { adapter, accessToken };
}

/**
 * Il calendario dedicato, creandolo la prima volta.
 *
 * L'identificativo nuovo si SALVA SUBITO, prima di scriverci dentro qualunque
 * evento. Se si salvasse dopo e l'esecuzione morisse in mezzo — i 150 secondi
 * di Supabase arrivano senza preavviso e senza `finally` — al giro successivo
 * l'applicazione non saprebbe di aver già creato un calendario e ne creerebbe
 * un secondo con lo stesso nome. Su Google non potremmo nemmeno accorgercene:
 * lo scope a privilegio minimo non permette di elencare i calendari.
 */
async function ensureCalendar(
  deps: SyncDeps,
  connection: CalendarConnectionRow,
  adapter: CalendarProviderAdapter,
  accessToken: string,
  companyName: string,
): Promise<string> {
  const wanted = dedicatedCalendarName(companyName);

  // ⚠️ LA CREAZIONE SI PRENOTA. Due esecuzioni sovrapposte — lo scheduler e un
  // «Sincronizza ora» premuto nello stesso momento — leggerebbero entrambe
  // `provider_calendar_id` a NULL e creerebbero entrambe un calendario. Chi non
  // ottiene il lease rilegge: nel frattempo l'altro ha quasi certamente
  // finito, e si usa il suo. Se non ha ancora finito si dichiara un guasto
  // ritentabile, e la coda riprova fra poco — meglio un giro in più che due
  // calendari con lo stesso nome nel calendario di una persona.
  let lease: string | null = null;
  if (!connection.provider_calendar_id) {
    lease = await claimCalendarCreation(deps.sb, connection.id);
    if (!lease) {
      const fresh = await getConnection(deps.sb, connection.id);
      if (fresh?.provider_calendar_id) {
        connection.provider_calendar_id = fresh.provider_calendar_id;
        connection.calendar_name = fresh.calendar_name;
      } else {
        throw new CalendarProviderError(
          'PROVIDER_UNAVAILABLE',
          'creazione del calendario già in corso da un’altra esecuzione',
          { retryable: true },
        );
      }
    }
  }

  try {
    return await ensureCalendarInner(deps, connection, adapter, accessToken, wanted);
  } finally {
    if (lease) await releaseCalendarCreation(deps.sb, connection.id, lease);
  }
}

async function ensureCalendarInner(
  deps: SyncDeps,
  connection: CalendarConnectionRow,
  adapter: CalendarProviderAdapter,
  accessToken: string,
  wanted: string,
): Promise<string> {
  const result = await adapter.ensureDedicatedCalendar({
    accessToken,
    calendarId: connection.provider_calendar_id,
    name: wanted,
  });

  if (result.calendarId !== connection.provider_calendar_id || result.name !== connection.calendar_name) {
    await deps.sb.from('calendar_connections').update({
      provider_calendar_id: result.calendarId,
      calendar_name: result.name,
    }).eq('id', connection.id);
    connection.provider_calendar_id = result.calendarId;
    connection.calendar_name = result.name;
  }

  // Il calendario è cambiato: i collegamenti che puntavano al vecchio non
  // valgono più. Si tolgono le RIGHE e non gli eventi — quelli sono in un
  // calendario che l'utente ha cancellato, quindi non esistono più — e le
  // attività verranno riscritte nel calendario nuovo dal percorso normale.
  if (result.created) {
    await deps.sb.from('calendar_event_links')
      .delete().eq('connection_id', connection.id).neq('provider_calendar_id', result.calendarId);
  }

  return result.calendarId;
}

/** Il nome dell'azienda, letto una volta per esecuzione (non di più: vedi `SyncDeps`). */
async function companyNameOf(deps: SyncDeps, companyId: string): Promise<string> {
  const cached = deps.companyNames.get(companyId);
  if (cached !== undefined) return cached;
  const { data } = await deps.sb.from('companies').select('legal_name').eq('id', companyId).maybeSingle();
  const name = (data as { legal_name?: string } | null)?.legal_name ?? '';
  deps.companyNames.set(companyId, name);
  return name;
}

// ---- Sincronizzazione iniziale ----------------------------------------------

/**
 * Alla prima connessione: si accodano le attività che DOVREBBERO avere un
 * evento, e nient'altro (§125).
 *
 * Non si scrive niente qui dentro: si riempie la coda, e il worker fa il lavoro
 * con lo stesso codice di tutti i giorni. Un import iniziale che scrivesse per
 * conto proprio sarebbe una seconda implementazione della stessa cosa — e
 * sarebbe quella meno provata, perché gira una volta per cliente.
 *
 * I criteri sono gli stessi di `getCalendarDesiredState`, scritti in SQL. È
 * l'unica duplicazione di quella logica in tutto il sistema, ed è deliberata:
 * l'alternativa sarebbe caricare TUTTE le attività dell'azienda per filtrarle
 * in memoria. Un test verifica che i due criteri diano lo stesso risultato.
 */
export async function enqueueInitialSync(
  deps: SyncDeps, connection: CalendarConnectionRow, limit = 500,
): Promise<number> {
  const { data } = await deps.sb.from('tasks')
    .select('id')
    .eq('company_id', connection.company_id)
    .eq('assignee_user_id', connection.user_id)
    .neq('status', 'completed')
    .is('archived_at', null)
    .not('due_date', 'is', null)
    .limit(limit);

  const rows = ((data ?? []) as { id: string }[]).map((t) => ({ taskId: t.id, companyId: connection.company_id }));
  if (rows.length) await enqueueTasks(deps.sb, rows);

  // ⚠️ «Completato» solo se abbiamo davvero preso TUTTO. Se il limite è stato
  // raggiunto, delle attività sono rimaste fuori: dichiararlo completo sarebbe
  // falso e spegnerebbe la ripresa. È la lezione dell'import iniziale troncato
  // dell'Inbox — un lavoro interrotto che si dichiara finito non lo riprende
  // più nessuno. La riconciliazione periodica accoda ciò che manca.
  if (rows.length < limit) {
    await deps.sb.from('calendar_connections')
      .update({ initial_sync_completed_at: new Date().toISOString() })
      .eq('id', connection.id);
  }
  return rows.length;
}

// ---- Riconciliazione --------------------------------------------------------

export interface ReconcileOutcome {
  checked: number;
  requeued: number;
  errorCode: string | null;
}

/**
 * Il controllo periodico che ripara ciò che la coda non può vedere.
 *
 * La coda reagisce ai cambiamenti di AI-Swisse. Non sa nulla di ciò che succede
 * DALL'ALTRA PARTE: un evento cancellato a mano, un calendario svuotato, una
 * scrittura che il provider ha accettato e poi perso, un lavoro finito nel
 * fosso perché il token era scaduto proprio in quel momento. Senza questo
 * passaggio quei casi non si riparerebbero mai, e il calendario di una persona
 * si allontanerebbe dalla verità un pezzo alla volta senza che nessuno lo sappia.
 *
 * NON scrive eventi: rimette in coda. Un solo percorso di scrittura in tutto il
 * sistema (§66).
 */
export async function reconcileConnection(
  deps: SyncDeps, connection: CalendarConnectionRow, batch: number, deadlineMs: number,
): Promise<ReconcileOutcome> {
  const out: ReconcileOutcome = { checked: 0, requeued: 0, errorCode: null };

  try {
    const { adapter, accessToken } = await open(deps, connection);
    const companyName = await companyNameOf(deps, connection.company_id);
    const calendarId = await ensureCalendar(deps, connection, adapter, accessToken, companyName);

    // 1. Gli eventi che dovrebbero esserci: esistono ancora presso il provider?
    const { data: linkData } = await deps.sb.from('calendar_event_links')
      .select('id, company_id, user_id, connection_id, task_id, provider_event_id, provider_calendar_id, sync_status, content_hash')
      .eq('connection_id', connection.id)
      .order('last_synced_at', { ascending: true, nullsFirst: true })
      .limit(batch);

    const missing: { taskId: string; companyId: string }[] = [];
    for (const link of (linkData ?? []) as EventLinkRow[]) {
      if (Date.now() >= deadlineMs) break;
      out.checked++;
      const exists = await adapter.eventExists({
        accessToken, calendarId: link.provider_calendar_id, providerEventId: link.provider_event_id,
      });
      if (!exists) {
        // L'utente lo ha cancellato, oppure non è mai arrivato. In entrambi i
        // casi la fonte di verità è AI-Swisse (§68): si toglie il collegamento
        // che mente e si rimette l'attività in coda, che lo ricreerà.
        await deleteLink(deps.sb, link.id);
        missing.push({ taskId: link.task_id, companyId: link.company_id });
      }
    }

    // 2. Le attività che dovrebbero avere un evento e non hanno un collegamento.
    //    Copre il caso in cui una riga della coda sia andata persa.
    const { data: orphanData } = await deps.sb.from('tasks')
      .select('id')
      .eq('company_id', connection.company_id)
      .eq('assignee_user_id', connection.user_id)
      .neq('status', 'completed')
      .is('archived_at', null)
      .not('due_date', 'is', null)
      .limit(batch);

    const linked = new Set(((linkData ?? []) as EventLinkRow[]).map((l) => l.task_id));
    for (const t of (orphanData ?? []) as { id: string }[]) {
      if (!linked.has(t.id)) missing.push({ taskId: t.id, companyId: connection.company_id });
    }

    if (missing.length) {
      // ⚠️ La deduplicazione è una CINTURA, e oggi non stringe niente: `linked`
      // raccoglie i task di TUTTI i collegamenti del lotto — compresi quelli
      // appena cancellati al passo 1 — quindi il passo 2 non può ripescarli e un
      // duplicato non è costruibile. Il commento diceva il contrario («la stessa
      // attività può arrivare da entrambi i controlli») ed era falso: corretto il
      // 2026-08-10, dopo che una revisione ha verificato togliendola che nessuna
      // asserzione cambia colore.
      //
      // Resta, perché costa una riga e perché i due insiemi nascono da due query
      // che possono cambiare separatamente: se un domani `linked` venisse
      // costruito DOPO le cancellazioni, sarebbe l'unica difesa — e quel giorno
      // andrà provata. Nel frattempo `enqueueTasks` scrive comunque in upsert su
      // `task_id`, quindi un duplicato sarebbe innocuo anche senza.
      const unique = [...new Map(missing.map((m) => [m.taskId, m])).values()];
      await enqueueTasks(deps.sb, unique);
      out.requeued = unique.length;
    }

    await markConnectionOk(deps.sb, connection.id);
    await deps.sb.from('calendar_connections')
      .update({ last_sync_at: new Date().toISOString() }).eq('id', connection.id);
  } catch (error) {
    out.errorCode = error instanceof CalendarProviderError ? error.code : 'UNKNOWN';
  }

  return out;
}
