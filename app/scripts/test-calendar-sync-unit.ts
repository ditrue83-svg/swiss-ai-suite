// ============================================================================
// IL MOTORE DI SINCRONIZZAZIONE, ESEGUITO — non riletto.
//
// `_shared/calendar/sync.ts` è stato per mesi la riga più grossa di
// TYPECHECK_SCOPERTI: 451 righe che nessun test eseguiva, nello stesso modulo
// dove `composeEmail` ha nascosto per settimane un destinatario mancante. Questa
// suite toglie quella riga nel solo modo ammesso dal registro del debito:
// importando il modulo da un test che lo ESEGUE.
//
// COME: le funzioni vere (`syncTask`, `enqueueInitialSync`,
// `reconcileConnection`) girano contro un client Supabase finto e un adapter
// finto — la stessa scelta della sezione 12 di `test:calendar-unit`. I segreti
// nella tabella finta sono cifrati con la `seal` VERA, quindi anche il giro di
// cifratura (AAD compresa) è quello di produzione.
//
// COSA NON PROVA, dichiarato: che Google o Microsoft rispondano come il copione
// dice. Il contratto degli adapter contro un `fetch` finto sta nelle sezioni 6-7
// di `test:calendar-unit`; le chiamate alle API vive restano non provate finché
// non esiste una connessione OAuth reale (docs/product-status.md).
//
// La finzione sostiene ESATTAMENTE le catene che sync.ts e store.ts usano, e
// niente di più: una finzione più generosa nasconderebbe le query sbagliate
// invece di mostrarle.
// ============================================================================
import {
  enqueueInitialSync, reconcileConnection, syncTask, type SyncDeps,
} from '../supabase/functions/_shared/calendar/sync.ts';
import type { CalendarConnectionRow } from '../supabase/functions/_shared/calendar/store.ts';
import {
  buildEventContent, eventContentHash, eventKeyFor, getCalendarDesiredState,
} from '../supabase/functions/_shared/calendar/desired.ts';
import {
  CalendarProviderError,
  type CalendarOAuthTokens, type CalendarProviderAdapter,
} from '../supabase/functions/_shared/calendar/types.ts';
import {
  generateKeyBase64, importKey, seal, toHex,
} from '../supabase/functions/_shared/email/crypto.ts';

let pass = 0, fail = 0;
const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', DIM = '\x1b[2m', X = '\x1b[0m';
const ok = (cond: boolean, label: string, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${label}`); }
  else { fail++; console.log(`  ${R}✗ ${label}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);

// ---- Il client Supabase finto ----------------------------------------------

type Row = Record<string, unknown>;
interface Scritto { op: 'update' | 'delete' | 'upsert'; tabella: string; righe: Row[]; patch: Row | null }

/**
 * Simulatore minimo di PostgREST.
 *
 * Le LETTURE restituiscono copie — come fa PostgREST, che serializza — così un
 * oggetto letto e mutato in memoria non cambia la «tabella» alle spalle del
 * test. Le SCRITTURE toccano le righe conservate e finiscono in due registri:
 * `scritti` (cosa) e `diario` (in che ordine, insieme alle chiamate al
 * provider) — perché in questo modulo l'ORDINE è una garanzia dichiarata:
 * prima l'evento poi la riga, prima l'identificativo del calendario poi gli
 * eventi dentro.
 */
function sbFinto(
  tabelle: Record<string, Row[]>,
  scritti: Scritto[],
  diario: string[],
  ganci: { primaDi?: (op: string, tabella: string, patch: Row | null) => void } = {},
) {
  const from = (tabella: string) => {
    const filtri: ((r: Row) => boolean)[] = [];
    let op: 'select' | 'update' | 'delete' | 'upsert' = 'select';
    let patch: Row | null = null;
    let daUpsert: Row[] = [];
    let conflitto: string[] = [];
    let ignoraDuplicati = false;
    let tetto = Number.POSITIVE_INFINITY;
    let selectDopoScrittura = false;
    let ordinamento: { colonna: string; crescente: boolean; nulliPrima: boolean } | null = null;

    // ⚠️ L'ordinamento ORDINA DAVVERO, e non è pignoleria: finché `order()` era
    // un `() => api`, la garanzia «i meno recentemente verificati per primi» —
    // ciò che impedisce la fame dei collegamenti mai controllati quando il lotto
    // è più piccolo della coda — era invisibile PER COSTRUZIONE. Invertire
    // l'ordinamento in sync.ts lasciava la suite verde.
    const righe = () => {
      const trovate = (tabelle[tabella] ?? []).filter((r) => filtri.every((f) => f(r)));
      if (!ordinamento) return trovate;
      const { colonna, crescente, nulliPrima } = ordinamento;
      return trovate.sort((a, b) => {
        const x = a[colonna], y = b[colonna];
        if (x == null && y == null) return 0;
        if (x == null) return nulliPrima ? -1 : 1;
        if (y == null) return nulliPrima ? 1 : -1;
        const c = String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
        return crescente ? c : -c;
      });
    };
    const copia = (r: Row): Row => ({ ...r });

    // `.or('a.is.null,b.lt.X')`: si sostengono SOLO le forme che store.ts usa
    // (`is.null` e `lt.`). Una forma nuova deve rompere il test, non passare.
    const filtroOr = (expr: string) => (r: Row) =>
      expr.split(',').some((cond) => {
        const [col, opNome, ...resto] = cond.split('.');
        if (opNome === 'is' && resto.join('.') === 'null') return r[col] == null;
        if (opNome === 'lt') return r[col] != null && String(r[col]) < resto.join('.');
        throw new Error(`or() non previsto dalla finzione: ${cond}`);
      });

    const esegui = () => {
      ganci.primaDi?.(op, tabella, patch);
      if (op === 'select') {
        return { data: righe().slice(0, tetto).map(copia), error: null };
      }
      if (op === 'update') {
        const colpite = righe();
        for (const r of colpite) Object.assign(r, patch);
        scritti.push({ op, tabella, righe: colpite.map(copia), patch });
        diario.push(`db:update:${tabella}[${Object.keys(patch ?? {}).sort().join(',')}]`);
        return { data: selectDopoScrittura ? colpite.map(copia) : null, error: null };
      }
      if (op === 'delete') {
        const via = righe();
        tabelle[tabella] = (tabelle[tabella] ?? []).filter((r) => !via.includes(r));
        scritti.push({ op, tabella, righe: via.map(copia), patch: null });
        diario.push(`db:delete:${tabella}`);
        return { data: via.map(copia), error: null };
      }
      // upsert
      const esistenti = tabelle[tabella] ?? (tabelle[tabella] = []);
      for (const riga of daUpsert) {
        const gemella = esistenti.find((r) => conflitto.every((c) => r[c] === riga[c]));
        if (gemella) { if (!ignoraDuplicati) Object.assign(gemella, riga); }
        else esistenti.push({ ...riga });
      }
      scritti.push({ op, tabella, righe: daUpsert.map(copia), patch: null });
      diario.push(`db:upsert:${tabella}`);
      return { data: null, error: null };
    };

    const api = {
      select: (_cols?: string) => { if (op !== 'select') selectDopoScrittura = true; return api; },
      eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return api; },
      neq: (c: string, v: unknown) => { filtri.push((r) => r[c] !== v); return api; },
      in: (c: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[c])); return api; },
      is: (c: string, v: unknown) => { filtri.push((r) => (v === null ? r[c] == null : r[c] === v)); return api; },
      not: (c: string, opNome: string, v: unknown) => {
        if (opNome !== 'is' || v !== null) throw new Error(`not() non previsto dalla finzione: ${opNome}`);
        filtri.push((r) => r[c] != null); return api;
      },
      or: (expr: string) => { filtri.push(filtroOr(expr)); return api; },
      order: (colonna: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
        if (typeof colonna !== 'string') throw new Error('order() non previsto dalla finzione');
        ordinamento = {
          colonna, crescente: opts.ascending ?? true, nulliPrima: opts.nullsFirst ?? false,
        };
        return api;
      },
      limit: (n: number) => { tetto = n; return api; },
      update: (p: Row) => { op = 'update'; patch = p; return api; },
      delete: () => { op = 'delete'; return api; },
      upsert: (r: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => {
        op = 'upsert'; daUpsert = Array.isArray(r) ? r : [r];
        conflitto = (opts.onConflict ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        ignoraDuplicati = opts.ignoreDuplicates ?? false;
        return api;
      },
      maybeSingle: () => {
        const { data } = esegui() as { data: Row[] | null };
        return Promise.resolve({ data: data?.[0] ?? null, error: null });
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve().then(esegui).then(res, rej),
    };
    return api;
  };
  return {
    from,
    rpc: () => { throw new Error('rpc non previsto in questa suite'); },
  } as unknown as SyncDeps['sb'];
}

// ---- L'adapter finto --------------------------------------------------------

interface Copione {
  refresh?: (refreshToken: string) => CalendarOAuthTokens;
  ensureDedicatedCalendar?: (input: { calendarId: string | null; name: string }) =>
    { calendarId: string; name: string; created: boolean };
  upsertEvent?: (input: { providerEventId: string | null; calendarId: string }) => { providerEventId: string };
  deleteEvent?: () => void;
  eventExists?: (input: { calendarId: string; providerEventId: string }) => boolean;
}

/** Registra ogni chiamata nel diario condiviso e risponde secondo il copione. */
function adapterFinto(diario: string[], copione: Copione = {}) {
  const chiamate: { metodo: string; input: Record<string, unknown> }[] = [];
  const nota = (metodo: string, input: Record<string, unknown>) => {
    chiamate.push({ metodo, input });
    diario.push(`provider:${metodo}`);
  };
  const mai = (metodo: string) => () => { throw new Error(`${metodo} non previsto in questa suite`); };

  const adapter: CalendarProviderAdapter = {
    id: 'google',
    scopes: [],
    buildAuthorizationUrl: mai('buildAuthorizationUrl'),
    exchangeCode: mai('exchangeCode'),
    getAccountIdentity: mai('getAccountIdentity'),
    revoke: mai('revoke'),
    findEventByTask: mai('findEventByTask'),
    refresh: async (refreshToken) => {
      nota('refresh', { refreshToken });
      if (copione.refresh) return copione.refresh(refreshToken);
      return {
        accessToken: 'tok-rinnovato', refreshToken: null,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scopes: [],
      };
    },
    ensureDedicatedCalendar: async (input) => {
      nota('ensureDedicatedCalendar', { calendarId: input.calendarId, name: input.name });
      if (copione.ensureDedicatedCalendar) return copione.ensureDedicatedCalendar(input);
      return input.calendarId
        ? { calendarId: input.calendarId, name: input.name, created: false }
        : { calendarId: 'cal-nuovo', name: input.name, created: true };
    },
    upsertEvent: async (input) => {
      nota('upsertEvent', {
        calendarId: input.calendarId, providerEventId: input.providerEventId,
        accessToken: input.accessToken, eventKey: input.event.eventKey,
        title: input.event.title, description: input.event.description,
        date: input.event.date, taskId: input.event.taskId,
      });
      if (copione.upsertEvent) return copione.upsertEvent(input);
      return { providerEventId: `evt-${chiamate.length}` };
    },
    deleteEvent: async (input) => {
      nota('deleteEvent', {
        calendarId: input.calendarId, providerEventId: input.providerEventId,
      });
      copione.deleteEvent?.();
    },
    eventExists: async (input) => {
      // ⚠️ `calendarId` si registra, e serve: senza, chiedere l'esistenza sul
      // calendario CORRENTE invece che su quello del collegamento era
      // invisibile per costruzione — e produrrebbe una riga cancellata e
      // riaccodata a ogni riconciliazione.
      nota('eventExists', {
        calendarId: input.calendarId, providerEventId: input.providerEventId,
      });
      return copione.eventExists ? copione.eventExists(input) : true;
    },
  };
  return { adapter, chiamate };
}

// ---- Lo scenario ------------------------------------------------------------

const KEY = await importKey(generateKeyBase64());
const FUTURO = new Date(Date.now() + 3_600_000).toISOString();
const PASSATO = new Date(Date.now() - 3_600_000).toISOString();

/** Una riga di `calendar_connection_secrets`, cifrata con la `seal` VERA. */
async function segreti(connectionId: string, over: {
  accessToken?: string | null; scadenza?: string | null; refreshToken?: string | null;
} = {}): Promise<Row> {
  const hex = async (testo: string) => {
    const s = await seal(KEY, testo, connectionId);
    return { ct: `\\x${toHex(s.ciphertext)}`, iv: `\\x${toHex(s.iv)}` };
  };
  const access = over.accessToken === undefined ? 'tok-valido' : over.accessToken;
  const refresh = over.refreshToken === undefined ? 'tok-refresh' : over.refreshToken;
  const a = access === null ? null : await hex(access);
  const r = refresh === null ? null : await hex(refresh);
  return {
    connection_id: connectionId,
    access_token_ct: a?.ct ?? null, access_token_iv: a?.iv ?? null,
    access_token_expires_at: over.scadenza === undefined ? FUTURO : over.scadenza,
    refresh_token_ct: r?.ct ?? null, refresh_token_iv: r?.iv ?? null,
  };
}

// ⚠️ `Row` e non `Partial<CalendarConnectionRow>`: la RIGA della tabella ha più
// colonne della proiezione che il modulo legge — `last_error_code` e
// `last_error_at` le scrive `markConnectionError` e non compaiono in
// `CONNECTION_COLUMNS`. Tipizzare qui la proiezione impedirebbe di costruire lo
// stato «connessione caduta e poi risanata», che è proprio ciò che va provato.
const connessione = (over: Row = {}): Row => ({
  id: 'c-1', company_id: 'A', user_id: 'u-1', provider: 'google',
  provider_account_id: 'acc-1', email_address: 'andrea@rossi-sa.ch',
  provider_calendar_id: 'cal-1', calendar_name: 'AI-Swisse — Rossi SA',
  status: 'active', sync_enabled: true,
  initial_sync_completed_at: PASSATO, last_sync_at: null, last_successful_sync_at: null,
  sync_lease_id: null, sync_lease_until: null,
  ...over,
});

const attivita = (over: Row = {}): Row => ({
  id: 't-1', company_id: 'A', title: 'Trasmettere rendiconto IVA',
  due_date: '2026-09-30', status: 'open', priority: 'high',
  assignee_user_id: 'u-1', archived_at: null,
  ...over,
});

const collegamento = (over: Row = {}): Row => ({
  id: 'l-1', company_id: 'A', user_id: 'u-1', connection_id: 'c-1', task_id: 't-1',
  provider_event_id: 'evt-esistente', provider_calendar_id: 'cal-1',
  sync_status: 'synced', content_hash: null, last_synced_at: null,
  ...over,
});

interface Scena {
  tabelle: Record<string, Row[]>;
  scritti: Scritto[];
  diario: string[];
  deps: SyncDeps;
  chiamate: { metodo: string; input: Record<string, unknown> }[];
}

function scena(tabelle: Record<string, Row[]>, copione: Copione = {}, ganci: Parameters<typeof sbFinto>[3] = {}): Scena {
  const scritti: Scritto[] = [];
  const diario: string[] = [];
  const { adapter, chiamate } = adapterFinto(diario, copione);
  const deps: SyncDeps = {
    sb: sbFinto(tabelle, scritti, diario, ganci),
    encryptionKey: KEY,
    adapterFor: () => adapter,
    appOrigin: 'https://app.ai-swisse.com',
    companyNames: new Map(),
  };
  return { tabelle, scritti, diario, deps, chiamate };
}

const AZIENDE = [{ id: 'A', legal_name: 'Rossi SA' }];

/** L'impronta che `syncTask` calcolerà per questa attività su questo calendario. */
async function improntaAttesa(t: Row, calendarId: string): Promise<string> {
  const content = buildEventContent({
    task: {
      id: t.id as string, title: t.title as string,
      dueDate: t.due_date as string, priority: t.priority as 'low' | 'medium' | 'high',
    },
    companyName: 'Rossi SA', appOrigin: 'https://app.ai-swisse.com',
    locale: 'it', showTitle: true,
  });
  return await eventContentHash({
    calendarId, title: content.title, description: content.description, date: t.due_date as string,
  });
}

console.log(`${B}AI-Swisse — Il motore di sincronizzazione, eseguito contro finzioni${X}`);

// ===========================================================================
section('1 · Il cambio di responsabile: togliere di là e mettere di qua, insieme');
// ===========================================================================
// L'unità di lavoro è l'ATTIVITÀ, non la coppia (attività, calendario): quando
// il responsabile cambia, l'evento deve sparire dal vecchio calendario e
// comparire sul nuovo nella stessa esecuzione. È la ragione dichiarata in cima
// a sync.ts, e qui la si esegue.
{
  const vecchia = connessione({ id: 'c-vecchia', user_id: 'u-vecchio', provider_calendar_id: 'cal-vecchio' });
  const nuova = connessione({ id: 'c-nuova', user_id: 'u-nuovo', provider_calendar_id: 'cal-nuovo' });
  const t = attivita({ assignee_user_id: 'u-nuovo' });
  const s = scena({
    tasks: [t],
    companies: AZIENDE,
    calendar_connections: [vecchia, nuova],
    calendar_event_links: [collegamento({
      id: 'l-vecchio', connection_id: 'c-vecchia', user_id: 'u-vecchio',
      provider_event_id: 'evt-vecchio', provider_calendar_id: 'cal-vecchio',
    })],
    calendar_connection_secrets: [await segreti('c-vecchia'), await segreti('c-nuova')],
    notification_preferences: [],
  });

  const esito = await syncTask(s.deps, 't-1');

  ok(esito.deleted === 1 && esito.upserted === 1 && esito.failures === 0,
    'un evento tolto e uno scritto, nella stessa esecuzione',
    JSON.stringify(esito));

  const cancellazione = s.chiamate.find((c) => c.metodo === 'deleteEvent');
  ok(cancellazione?.input.calendarId === 'cal-vecchio'
    && cancellazione?.input.providerEventId === 'evt-vecchio',
    'la cancellazione colpisce l’evento del VECCHIO responsabile, sul suo calendario');

  const scrittura = s.chiamate.find((c) => c.metodo === 'upsertEvent');
  ok(scrittura?.input.calendarId === 'cal-nuovo',
    'la scrittura va sul calendario del NUOVO responsabile');
  ok(scrittura?.input.eventKey === await eventKeyFor('t-1', 'c-nuova'),
    'la chiave dell’evento deriva da (attività, connessione): stessa attività, connessione nuova, chiave nuova');
  ok(scrittura?.input.date === '2026-09-30' && scrittura?.input.taskId === 't-1',
    'giorno di scadenza e identificativo dell’attività arrivano all’adapter come sono');

  // L'ordine è una garanzia scritta nel codice, non un dettaglio: prima
  // l'evento presso il provider, poi la riga. Al contrario, un guasto in mezzo
  // lascerebbe un evento che nessuno sa più di aver creato.
  const iEvento = s.diario.indexOf('provider:deleteEvent');
  const iRiga = s.diario.indexOf('db:delete:calendar_event_links');
  ok(iEvento !== -1 && iRiga !== -1 && iEvento < iRiga,
    'prima l’evento presso il provider, poi la riga del collegamento',
    s.diario.join(' → '));

  ok(!s.tabelle.calendar_event_links.some((l) => l.id === 'l-vecchio'),
    'il collegamento vecchio non c’è più');
  const nuovo = s.tabelle.calendar_event_links.find((l) => l.connection_id === 'c-nuova');
  ok(nuovo?.sync_status === 'synced'
    && nuovo?.content_hash === await improntaAttesa(t, 'cal-nuovo'),
    'il collegamento nuovo è `synced` e porta l’impronta di ciò che è stato scritto');
}

// ===========================================================================
section('2 · Niente è cambiato: nessuna scrittura presso il provider');
// ===========================================================================
// È ciò che rende sopportabile una riconciliazione quotidiana: cinquanta
// attività invariate non devono diventare cinquanta chiamate all'API.
{
  const t = attivita();
  const s = scena({
    tasks: [t],
    companies: AZIENDE,
    calendar_connections: [connessione()],
    calendar_event_links: [collegamento({ content_hash: await improntaAttesa(t, 'cal-1') })],
    calendar_connection_secrets: [await segreti('c-1')],
    notification_preferences: [],
  });

  const esito = await syncTask(s.deps, 't-1');
  ok(esito.upserted === 0 && esito.failures === 0,
    'esito: nessun lavoro da fare', JSON.stringify(esito));
  ok(!s.chiamate.some((c) => c.metodo === 'upsertEvent'),
    'nessuna scrittura di evento presso il provider');
  ok(!s.scritti.some((w) => w.tabella === 'calendar_event_links'),
    'e nessuna riscrittura del collegamento');
}

// E il caso complementare: il TITOLO è cambiato, quindi l'impronta non
// coincide più, e l'evento si aggiorna — con l'identificativo già noto,
// perché il collegamento punta allo stesso calendario.
{
  const t = attivita({ title: 'Trasmettere rendiconto IVA — 3º trimestre' });
  const vecchia = await improntaAttesa(attivita(), 'cal-1');   // l'impronta del titolo di PRIMA
  const s = scena({
    tasks: [t],
    companies: AZIENDE,
    calendar_connections: [connessione()],
    calendar_event_links: [collegamento({ content_hash: vecchia })],
    calendar_connection_secrets: [await segreti('c-1')],
    notification_preferences: [],
  });

  const esito = await syncTask(s.deps, 't-1');
  const scrittura = s.chiamate.find((c) => c.metodo === 'upsertEvent');
  ok(esito.upserted === 1 && scrittura?.input.providerEventId === 'evt-esistente',
    'contenuto cambiato: si aggiorna l’evento ESISTENTE, non se ne crea un secondo');
  ok(scrittura?.input.title === 'Trasmettere rendiconto IVA — 3º trimestre',
    'con il titolo nuovo');
}

// Il collegamento punta a un calendario che non è più quello corrente:
// l'identificativo noto appartiene a un evento che non esiste più, e NON va
// riusato sul calendario nuovo.
{
  const t = attivita();
  const s = scena({
    tasks: [t],
    companies: AZIENDE,
    calendar_connections: [connessione()],
    calendar_event_links: [collegamento({ provider_calendar_id: 'cal-cancellato' })],
    calendar_connection_secrets: [await segreti('c-1')],
    notification_preferences: [],
  });

  await syncTask(s.deps, 't-1');
  const scrittura = s.chiamate.find((c) => c.metodo === 'upsertEvent');
  ok(scrittura !== undefined && scrittura.input.providerEventId === null,
    'collegamento verso un ALTRO calendario: l’identificativo noto non si riusa',
    JSON.stringify(scrittura?.input));
}

// ===========================================================================
section('3 · `untouchable` NON è `absent`: il calendario di chi deve riautorizzare non si svuota');
// ===========================================================================
// La distinzione dichiarata in desired.ts, eseguita nel worker: una connessione
// `reauth_required` con un collegamento NON produce una cancellazione.
{
  const s = scena({
    tasks: [attivita()],
    companies: AZIENDE,
    calendar_connections: [connessione({ status: 'reauth_required' })],
    calendar_event_links: [collegamento()],
    calendar_connection_secrets: [await segreti('c-1')],
    notification_preferences: [],
  });

  const esito = await syncTask(s.deps, 't-1');
  ok(esito.untouchable === 1 && esito.deleted === 0 && esito.failures === 0,
    'la connessione si dichiara intoccabile, non assente', JSON.stringify(esito));
  ok(s.chiamate.length === 0,
    'NESSUNA chiamata al provider: senza un token valido non si conclude niente');
  ok(s.tabelle.calendar_event_links.length === 1,
    'il collegamento resta al suo posto');
}

// ===========================================================================
section('4 · I casi vuoti: attività sparita, nessuna connessione');
// ===========================================================================
{
  const s = scena({ tasks: [], companies: AZIENDE, calendar_connections: [], calendar_event_links: [] });
  const esito = await syncTask(s.deps, 't-sparita');
  ok(esito.upserted === 0 && esito.deleted === 0 && esito.failures === 0 && esito.untouchable === 0,
    'attività sparita: esito vuoto, un limite dichiarato nel modulo — non un errore');
  ok(s.scritti.length === 0 && s.chiamate.length === 0, 'e nessun effetto collaterale');
}
{
  const s = scena({ tasks: [attivita()], companies: AZIENDE, calendar_connections: [], calendar_event_links: [] });
  const esito = await syncTask(s.deps, 't-1');
  ok(esito.upserted === 0 && s.chiamate.length === 0,
    'nessuna connessione attiva e nessun collegamento: niente da fare, niente fatto');
}

// ===========================================================================
section('5 · La creazione del calendario si PRENOTA (§lease)');
// ===========================================================================
// Due esecuzioni sovrapposte leggerebbero entrambe `provider_calendar_id` a
// NULL e creerebbero due calendari con lo stesso nome. Il lease esiste per
// quella gara; qui la gara viene recitata dal copione.
{
  // Nessun calendario ancora: si prenota, si crea, si salva PRIMA di scrivere
  // eventi, si rilascia.
  const s = scena({
    tasks: [attivita()],
    companies: AZIENDE,
    calendar_connections: [connessione({ provider_calendar_id: null, calendar_name: null })],
    calendar_event_links: [],
    calendar_connection_secrets: [await segreti('c-1')],
    notification_preferences: [],
  });

  const esito = await syncTask(s.deps, 't-1');
  ok(esito.upserted === 1 && esito.failures === 0, 'l’evento arriva sul calendario appena creato');

  const prenotazione = s.scritti.find((w) =>
    w.tabella === 'calendar_connections' && w.patch?.sync_lease_id != null);
  ok(prenotazione !== undefined, 'la creazione è stata PRENOTATA (lease scritto)');

  const iSalvataggio = s.diario.findIndex((v) => v.includes('provider_calendar_id'));
  const iEvento = s.diario.indexOf('provider:upsertEvent');
  ok(iSalvataggio !== -1 && iSalvataggio < iEvento,
    'l’identificativo del calendario si salva PRIMA di scrivere il primo evento: '
    + 'i 150 secondi di Supabase arrivano senza preavviso',
    s.diario.join(' → '));

  const conn = s.tabelle.calendar_connections[0];
  ok(conn.provider_calendar_id === 'cal-nuovo' && conn.sync_lease_id === null && conn.sync_lease_until === null,
    'a fine giro: calendario salvato e lease rilasciato');
}
{
  // La gara persa, esito buono: mentre il lease era occupato l'altra esecuzione
  // ha finito. La rilettura trova il suo calendario e lo si usa, senza crearne
  // un secondo.
  const s = scena(
    {
      tasks: [attivita()],
      companies: AZIENDE,
      calendar_connections: [connessione({
        provider_calendar_id: null, calendar_name: null, sync_lease_id: 'lease-altrui', sync_lease_until: FUTURO,
      })],
      calendar_event_links: [],
      calendar_connection_secrets: [await segreti('c-1')],
      notification_preferences: [],
    },
    {},
    {
      // Il copione recita l'ALTRA esecuzione: nel momento in cui la nostra prova
      // a prenotare, quella ha appena finito di creare il calendario.
      primaDi: (op, tabella, patch) => {
        if (op === 'update' && tabella === 'calendar_connections' && patch?.sync_lease_id != null) {
          const c = s.tabelle.calendar_connections[0];
          c.provider_calendar_id = 'cal-altrui';
          c.calendar_name = 'AI-Swisse — Rossi SA';
        }
      },
    },
  );

  const esito = await syncTask(s.deps, 't-1');
  ok(esito.upserted === 1 && esito.failures === 0, 'la gara persa non è un guasto: si usa il calendario dell’altro');
  const creazioni = s.chiamate.filter((c) => c.metodo === 'ensureDedicatedCalendar');
  ok(creazioni.length === 1 && creazioni[0].input.calendarId === 'cal-altrui',
    'e all’adapter arriva l’identificativo ALTRUI: nessun secondo calendario con lo stesso nome');
}
{
  // La gara persa, esito incerto: l'altra esecuzione non ha ancora finito. Non
  // si crea niente e si dichiara un guasto RITENTABILE: meglio un giro in più
  // che due calendari.
  const s = scena({
    tasks: [attivita()],
    companies: AZIENDE,
    calendar_connections: [connessione({
      provider_calendar_id: null, calendar_name: null, sync_lease_id: 'lease-altrui', sync_lease_until: FUTURO,
    })],
    calendar_event_links: [],
    calendar_connection_secrets: [await segreti('c-1')],
    notification_preferences: [],
  });

  const esito = await syncTask(s.deps, 't-1');
  ok(esito.failures === 1 && esito.errorCode === 'PROVIDER_UNAVAILABLE' && !esito.fatal,
    'creazione già in corso altrove: guasto ritentabile, non fatale', JSON.stringify(esito));
  ok(!s.chiamate.some((c) => c.metodo === 'ensureDedicatedCalendar'),
    'e NESSUNA creazione partita da qui');
}
{
  // ⚠️ IL LEASE SCADUTO SI RIPRENDE, ed è la garanzia per cui il lease è a
  // scadenza invece che un booleano: un processo ucciso a metà lascia la
  // prenotazione in mano a nessuno, e senza il confronto sull'ora quella
  // connessione non creerebbe MAI più il proprio calendario — ogni giro
  // finirebbe in «creazione già in corso», per sempre.
  const s = scena({
    tasks: [attivita()],
    companies: AZIENDE,
    calendar_connections: [connessione({
      provider_calendar_id: null, calendar_name: null,
      sync_lease_id: 'lease-di-un-processo-morto', sync_lease_until: PASSATO,
    })],
    calendar_event_links: [],
    calendar_connection_secrets: [await segreti('c-1')],
    notification_preferences: [],
  });

  const esito = await syncTask(s.deps, 't-1');
  ok(esito.upserted === 1 && esito.failures === 0,
    'lease SCADUTO: la prenotazione si riprende e il lavoro va a termine',
    JSON.stringify(esito));
  ok(s.chiamate.some((c) => c.metodo === 'ensureDedicatedCalendar' && c.input.calendarId === null),
    'il calendario viene creato: un processo morto non blocca la creazione per sempre');
}
{
  // Il rilascio del lease non dipende dalla fortuna: se a fallire è LA
  // CREAZIONE STESSA — il momento in cui il lease è in mano nostra — il
  // `finally` restituisce la prenotazione lo stesso. (Un guasto DOPO la
  // creazione non è una prova: lì il lease è già stato rilasciato dal
  // percorso normale, e la prima stesura di questo caso lo aveva confuso —
  // la controprova per mutazione è passata verde, cioè il test era finto.)
  const s = scena(
    {
      tasks: [attivita()],
      companies: AZIENDE,
      calendar_connections: [connessione({ provider_calendar_id: null, calendar_name: null })],
      calendar_event_links: [],
      calendar_connection_secrets: [await segreti('c-1')],
      notification_preferences: [],
    },
    {
      ensureDedicatedCalendar: () => {
        throw new CalendarProviderError('PROVIDER_UNAVAILABLE', 'il provider è occupato durante la creazione');
      },
    },
  );

  const esito = await syncTask(s.deps, 't-1');
  ok(esito.failures === 1 && esito.errorCode === 'PROVIDER_UNAVAILABLE', 'il guasto è registrato');
  const conn = s.tabelle.calendar_connections[0];
  ok(conn.sync_lease_id === null && conn.sync_lease_until === null,
    'ma il lease è rilasciato lo stesso: un guasto non blocca la creazione per sempre');
}
{
  // L'utente ha cancellato il calendario dedicato: se ne crea un altro, e i
  // collegamenti che puntavano al vecchio si tolgono — le RIGHE, non gli
  // eventi, che stavano in un calendario ormai inesistente.
  //
  // ⚠️ La scena tiene DUE connessioni di proposito: la pulizia deve restare
  // dentro il confine della propria connessione. Senza la seconda, togliere
  // `.eq('connection_id', …)` dalla cancellazione non produceva nessun rosso —
  // e in produzione avrebbe cancellato i collegamenti di TUTTE le persone
  // dell'azienda ogni volta che una sola rifà il proprio calendario.
  const s = scena(
    {
      tasks: [attivita()],
      companies: AZIENDE,
      calendar_connections: [
        // ⚠️ Il nome parte DIVERSO da quello atteso di proposito: partendo da
        // quello giusto l'asserzione sul nome non poteva fallire, e togliere
        // `calendar_name` dal salvataggio non produceva nessun rosso qui.
        connessione({ calendar_name: 'AI-Swisse — Nome Vecchio' }),
        connessione({ id: 'c-2', user_id: 'u-2', provider_calendar_id: 'cal-2' }),
      ],
      calendar_event_links: [
        collegamento({ id: 'l-stantio', task_id: 't-altro', provider_calendar_id: 'cal-1' }),
        collegamento({
          id: 'l-altrui', task_id: 't-altro', connection_id: 'c-2', user_id: 'u-2',
          provider_calendar_id: 'cal-2',
        }),
      ],
      calendar_connection_secrets: [await segreti('c-1'), await segreti('c-2')],
      notification_preferences: [],
    },
    {
      ensureDedicatedCalendar: () => ({ calendarId: 'cal-rifatto', name: 'AI-Swisse — Rossi SA', created: true }),
    },
  );

  await syncTask(s.deps, 't-1');
  ok(!s.tabelle.calendar_event_links.some((l) => l.id === 'l-stantio'),
    'calendario rifatto: la riga verso quello vecchio se ne va');
  ok(s.tabelle.calendar_event_links.some((l) => l.id === 'l-altrui'),
    '⚠️ ma i collegamenti dell’ALTRA connessione restano: la pulizia non esce dal suo confine');
  ok(!s.chiamate.some((c) => c.metodo === 'deleteEvent'),
    'senza NESSUNA cancellazione presso il provider: quegli eventi non esistono più');
  const conn = s.tabelle.calendar_connections[0];
  ok(conn.provider_calendar_id === 'cal-rifatto' && conn.calendar_name === 'AI-Swisse — Rossi SA',
    'e la connessione porta identificativo E nome del calendario nuovo');
}
{
  // La sola RINOMINA — l'azienda cambia ragione sociale, il calendario resta
  // quello — deve comunque arrivare nel database: altrimenti `calendar_name`
  // resta stantio e qualunque schermata che lo mostri mente.
  const s = scena(
    {
      tasks: [attivita()],
      companies: AZIENDE,
      calendar_connections: [connessione({ calendar_name: 'AI-Swisse — Nome Vecchio' })],
      calendar_event_links: [],
      calendar_connection_secrets: [await segreti('c-1')],
      notification_preferences: [],
    },
    {
      ensureDedicatedCalendar: (input) => ({ calendarId: input.calendarId as string, name: input.name, created: false }),
    },
  );

  await syncTask(s.deps, 't-1');
  ok(s.tabelle.calendar_connections[0].calendar_name === 'AI-Swisse — Rossi SA',
    'stesso calendario, nome nuovo: la rinomina viene salvata lo stesso');
}

// ===========================================================================
section('6 · Il token: rinnovo, consenso revocato, provider occupato');
// ===========================================================================
{
  // Token scaduto, rinnovo riuscito: l'evento parte con il token NUOVO, i
  // segreti si riscrivono, e il refresh token che Google non riemette NON viene
  // azzerato.
  const s = scena({
    tasks: [attivita()],
    companies: AZIENDE,
    calendar_connections: [connessione()],
    calendar_event_links: [],
    calendar_connection_secrets: [await segreti('c-1', { scadenza: PASSATO })],
    notification_preferences: [],
  });

  const esito = await syncTask(s.deps, 't-1');
  ok(esito.upserted === 1 && s.chiamate.filter((c) => c.metodo === 'refresh').length === 1,
    'token scaduto: UN rinnovo, poi si lavora');
  // ⚠️ QUALE segreto arriva al rinnovo, non solo che il rinnovo avvenga:
  // passando l'access token al posto del refresh token ogni rinnovo fallirebbe
  // contro il provider vero, e la suite restava verde perché nessuno leggeva
  // l'argomento. È anche l'unica asserzione che prova la decifratura del
  // refresh token, cioè metà di ciò che la testata di questo file rivendica.
  ok(s.chiamate.find((c) => c.metodo === 'refresh')?.input.refreshToken === 'tok-refresh',
    'al rinnovo arriva il REFRESH token decifrato, non l’access token');
  ok(s.chiamate.find((c) => c.metodo === 'upsertEvent')?.input.accessToken === 'tok-rinnovato',
    'l’evento parte con il token rinnovato');
  const riscrittura = s.scritti.find((w) => w.tabella === 'calendar_connection_secrets');
  ok(riscrittura !== undefined && 'access_token_ct' in (riscrittura.righe[0] ?? {}),
    'i segreti nuovi sono salvati');
  ok(!('refresh_token_ct' in (riscrittura?.righe[0] ?? {})),
    'e il refresh token che il provider NON ha riemesso non viene toccato: '
    + 'scrivere null spegnerebbe il collegamento');
}
{
  // Token scaduto e nessun refresh token: è un consenso che non c'è più. Fatale,
  // e la connessione va a `reauth_required` — il pulsante, non l'attesa.
  const s = scena({
    tasks: [attivita()],
    companies: AZIENDE,
    calendar_connections: [connessione()],
    calendar_event_links: [],
    calendar_connection_secrets: [await segreti('c-1', { scadenza: PASSATO, refreshToken: null })],
    notification_preferences: [],
  });

  const esito = await syncTask(s.deps, 't-1');
  ok(esito.failures === 1 && esito.errorCode === 'AUTH_EXPIRED' && esito.fatal,
    'senza refresh token il guasto è FATALE: ritentare non riporta il consenso',
    JSON.stringify(esito));
  ok(s.tabelle.calendar_connections[0].status === 'reauth_required',
    'la connessione chiede una riautorizzazione');
}
{
  // Il rinnovo fallisce perché il provider è giù: NON è una revoca. La
  // connessione va a `error` — passerà da solo — e mandare l'utente a
  // ricollegare un calendario sano è l'errore che l'Inbox ha già pagato.
  const s = scena(
    {
      tasks: [attivita()],
      companies: AZIENDE,
      calendar_connections: [connessione()],
      calendar_event_links: [],
      calendar_connection_secrets: [await segreti('c-1', { scadenza: PASSATO })],
      notification_preferences: [],
    },
    {
      refresh: () => { throw new CalendarProviderError('PROVIDER_UNAVAILABLE', 'occupato'); },
    },
  );

  const esito = await syncTask(s.deps, 't-1');
  ok(esito.failures === 1 && esito.errorCode === 'PROVIDER_UNAVAILABLE' && !esito.fatal,
    'provider irraggiungibile al rinnovo: transitorio, non fatale');
  ok(s.tabelle.calendar_connections[0].status === 'error',
    'la connessione è in `error`, NON in `reauth_required`: nessun pulsante per un guasto che passa da solo');
}
{
  // Lo SCOPE revocato è l'altra metà del predicato «fatale», e vive in DUE
  // copie — in `syncTask` e in `getValidAccessToken`. Nessun copione lo
  // lanciava, quindi si poteva togliere `|| AUTH_INSUFFICIENT_SCOPE` dall'una
  // o dall'altra senza un rosso: in produzione significherebbe ritentare per
  // sempre contro un consenso che non tornerà, senza mai mostrare il pulsante.
  const s = scena(
    {
      tasks: [attivita()],
      companies: AZIENDE,
      calendar_connections: [connessione()],
      calendar_event_links: [],
      calendar_connection_secrets: [await segreti('c-1', { scadenza: PASSATO })],
      notification_preferences: [],
    },
    {
      refresh: () => {
        throw new CalendarProviderError('AUTH_INSUFFICIENT_SCOPE', 'lo scope del calendario è stato revocato');
      },
    },
  );

  const esito = await syncTask(s.deps, 't-1');
  ok(esito.errorCode === 'AUTH_INSUFFICIENT_SCOPE' && esito.fatal,
    'scope revocato: FATALE quanto un consenso scaduto', JSON.stringify(esito));
  ok(s.tabelle.calendar_connections[0].status === 'reauth_required',
    'e la connessione chiede di riautorizzare, invece di ritentare per sempre');
}
{
  // ⚠️ L'OROLOGIO DEI SUCCESSI. Senza questa asserzione la chiamata a
  // `markConnectionOk` si poteva togliere da `syncTask` senza nessun rosso: la
  // connessione della scena parte già `active`, quindi controllare lo stato non
  // dimostra niente. `last_successful_sync_at` invece parte NULLO, ed è ciò che
  // distingue «non è mai riuscita» da «è riuscita e poi è caduta».
  const s = scena({
    tasks: [attivita()],
    companies: AZIENDE,
    calendar_connections: [connessione()],
    calendar_event_links: [],
    calendar_connection_secrets: [await segreti('c-1')],
    notification_preferences: [],
  });

  const esito = await syncTask(s.deps, 't-1');
  const conn = s.tabelle.calendar_connections[0];
  ok(esito.upserted === 1 && conn.last_successful_sync_at !== null,
    'giro riuscito: l’orologio dei successi avanza');
  ok(conn.last_error_code === null && conn.last_error_at === null,
    'e nessun guasto resta appiccicato a una connessione sana');
}
{
  // Il primo codice di guasto si conserva; `fatal` scatta anche se il guasto
  // fatale arriva DOPO uno transitorio, perché governa il ritentativo di tutta
  // l'attività.
  const c1 = connessione({ id: 'c-a', user_id: 'u-1', provider_calendar_id: 'cal-a' });
  const c2 = connessione({ id: 'c-b', user_id: 'u-1', provider_calendar_id: 'cal-b' });
  const s = scena(
    {
      tasks: [attivita()],
      companies: AZIENDE,
      calendar_connections: [c1, c2],
      calendar_event_links: [],
      calendar_connection_secrets: [
        await segreti('c-a'),
        await segreti('c-b', { scadenza: PASSATO, refreshToken: null }),
      ],
      notification_preferences: [],
    },
    {
      upsertEvent: (input) => {
        if (input.calendarId === 'cal-a') throw new CalendarProviderError('PROVIDER_RATE_LIMITED', 'rallenta');
        return { providerEventId: 'evt-x' };
      },
    },
  );

  const esito = await syncTask(s.deps, 't-1');
  ok(esito.failures === 2 && esito.errorCode === 'PROVIDER_RATE_LIMITED',
    'il PRIMO codice resta nel registro', JSON.stringify(esito));
  ok(esito.fatal,
    'ma `fatal` lo accende anche il secondo guasto: un consenso revocato non si risolve riprovando');
}

// ===========================================================================
section('7 · La sincronizzazione iniziale riempie la coda, non scrive eventi');
// ===========================================================================
{
  // I criteri SQL sono l'unica duplicazione dichiarata di
  // `getCalendarDesiredState`: qui si esegue la query finta su un campionario
  // di attività e si pretende che accodi ESATTAMENTE quelle che la funzione
  // pura dichiara `present`.
  const campione = [
    attivita({ id: 't-si' }),
    attivita({ id: 't-conclusa', status: 'completed' }),
    attivita({ id: 't-archiviata', archived_at: PASSATO }),
    attivita({ id: 't-senza-scadenza', due_date: null }),
    attivita({ id: 't-di-altri', assignee_user_id: 'u-altro' }),
    attivita({ id: 't-altra-azienda', company_id: 'B' }),
  ];
  const conn = connessione();
  const s = scena({
    tasks: campione,
    companies: AZIENDE,
    calendar_connections: [conn],
    calendar_event_links: [],
    calendar_sync_queue: [],
  });

  const quante = await enqueueInitialSync(s.deps, conn as unknown as CalendarConnectionRow);

  const attese = campione.filter((t) => getCalendarDesiredState(
    {
      id: t.id as string, companyId: t.company_id as string, title: t.title as string,
      dueDate: t.due_date as string | null,
      status: t.status as 'open' | 'in_progress' | 'waiting' | 'completed',
      priority: t.priority as 'low' | 'medium' | 'high',
      assigneeUserId: t.assignee_user_id as string | null,
      archivedAt: t.archived_at as string | null,
    },
    { id: 'c-1', companyId: 'A', userId: 'u-1', status: 'active', syncEnabled: true },
  ).kind === 'present').map((t) => t.id);

  const accodate = (s.tabelle.calendar_sync_queue ?? []).map((r) => r.task_id);
  ok(attese.length === 1 && attese[0] === 't-si',
    'la funzione pura dichiara `present` una sola attività del campionario (sanità del campionario)');
  ok(quante === 1 && accodate.length === 1 && accodate[0] === 't-si',
    'la query accoda ESATTAMENTE quelle: i due criteri — SQL e funzione pura — dicono la stessa cosa',
    `accodate: ${JSON.stringify(accodate)}`);
  ok(s.chiamate.length === 0,
    'e nessuna chiamata al provider: l’import iniziale riempie la coda, il worker farà il resto');
  ok(s.tabelle.calendar_connections[0].initial_sync_completed_at !== null,
    'sotto il limite: l’import si dichiara completo');
}
{
  // Al LIMITE esatto non ci si dichiara completi: delle attività possono essere
  // rimaste fuori, e un lavoro interrotto che si dice finito non lo riprende
  // più nessuno (la lezione dell'import dell'Inbox).
  const tante = [attivita({ id: 't-a' }), attivita({ id: 't-b' }), attivita({ id: 't-c' })];
  const conn = connessione({ initial_sync_completed_at: null });
  const s = scena({
    tasks: tante,
    companies: AZIENDE,
    calendar_connections: [conn],
    calendar_event_links: [],
    calendar_sync_queue: [],
  });

  const quante = await enqueueInitialSync(s.deps, conn as unknown as CalendarConnectionRow, 3);
  ok(quante === 3 && s.tabelle.calendar_connections[0].initial_sync_completed_at === null,
    'prese quante il limite: il completamento NON si dichiara — riprenderà la riconciliazione');
}

// ===========================================================================
section('8 · La riconciliazione ripara ciò che la coda non può vedere');
// ===========================================================================
{
  // Un evento cancellato a mano dall'utente e un'attività senza collegamento:
  // la riconciliazione non scrive eventi — rimette in coda, un solo percorso di
  // scrittura in tutto il sistema.
  // ⚠️ IL CAMPIONARIO PORTA LE ESCHE. La query degli orfani è la SECONDA copia
  // dei criteri di `getCalendarDesiredState` (la prima è nell'import iniziale,
  // §7) e non era guardata da niente: togliendo un filtro la suite restava
  // verde. In produzione un'attività conclusa verrebbe rimessa in coda a ogni
  // riconciliazione — `syncTask` la dichiara assente e non lascia collegamento,
  // quindi al giro dopo è di nuovo «orfana»: una coda che non si quieta mai.
  //
  // La connessione parte in `error`: è lo stato in cui la riconciliazione la
  // trova davvero (per `syncTask` sarebbe intoccabile), e risanarla è il suo
  // compito.
  const conn = connessione({
    status: 'error', last_error_code: 'PROVIDER_UNAVAILABLE', last_error_at: PASSATO,
  });
  const s = scena(
    {
      tasks: [
        attivita({ id: 't-collegata' }),
        attivita({ id: 't-cancellata-a-mano' }),
        attivita({ id: 't-orfana' }),
        attivita({ id: 't-conclusa', status: 'completed' }),
        attivita({ id: 't-archiviata', archived_at: PASSATO }),
        attivita({ id: 't-senza-scadenza', due_date: null }),
        attivita({ id: 't-di-altri', assignee_user_id: 'u-altro' }),
        attivita({ id: 't-altra-azienda', company_id: 'B' }),
      ],
      companies: AZIENDE,
      calendar_connections: [conn],
      calendar_event_links: [
        collegamento({ id: 'l-sano', task_id: 't-collegata', provider_event_id: 'evt-sano' }),
        // ⚠️ Su un calendario PRECEDENTE di proposito: l'esistenza va chiesta
        // dove l'evento è stato scritto, non sul calendario corrente.
        collegamento({
          id: 'l-morto', task_id: 't-cancellata-a-mano',
          provider_event_id: 'evt-sparito', provider_calendar_id: 'cal-precedente',
        }),
      ],
      calendar_connection_secrets: [await segreti('c-1')],
      calendar_sync_queue: [],
      notification_preferences: [],
    },
    { eventExists: (input) => input.providerEventId !== 'evt-sparito' },
  );

  const esito = await reconcileConnection(s.deps, conn as unknown as CalendarConnectionRow, 50, Date.now() + 60_000);

  ok(esito.checked === 2 && esito.requeued === 2 && esito.errorCode === null,
    'due collegamenti controllati, due attività rimesse in coda', JSON.stringify(esito));
  ok(!s.tabelle.calendar_event_links.some((l) => l.id === 'l-morto'),
    'il collegamento verso l’evento sparito se ne va: mentiva');
  ok(s.tabelle.calendar_event_links.some((l) => l.id === 'l-sano'),
    'quello sano resta');
  ok(s.chiamate.some((c) => c.metodo === 'eventExists'
    && c.input.providerEventId === 'evt-sparito' && c.input.calendarId === 'cal-precedente'),
    'l’esistenza è chiesta sul calendario DEL COLLEGAMENTO, non su quello corrente');
  const inCoda = (s.tabelle.calendar_sync_queue ?? []).map((r) => r.task_id).sort();
  ok(JSON.stringify(inCoda) === JSON.stringify(['t-cancellata-a-mano', 't-orfana']),
    'in coda ESATTAMENTE due: l’evento cancellato a mano e l’unica vera orfana — '
    + 'conclusa, archiviata, senza scadenza, di un altro e di un’altra azienda restano fuori',
    JSON.stringify(inCoda));
  ok(!s.chiamate.some((c) => c.metodo === 'upsertEvent'),
    'e NESSUN evento scritto da qui: la riconciliazione non è un secondo worker');
  const conn2 = s.tabelle.calendar_connections[0];
  ok(conn2.status === 'active' && conn2.last_error_code === null && conn2.last_error_at === null,
    'la connessione è RISANATA: da `error` a attiva, con il guasto cancellato');
  ok(conn2.last_successful_sync_at !== null && conn2.last_sync_at !== null,
    'e i due orologi avanzano — quello dei successi e quello della riconciliazione');
}
{
  // ⚠️ L'ORDINE DEL LOTTO: «i meno recentemente verificati per primi». Quando i
  // collegamenti sono più del lotto, è ciò che impedisce a un collegamento di
  // non essere controllato MAI — e prima che la finzione ordinasse davvero,
  // invertire l'ordinamento non produceva nessun rosso.
  const conn = connessione();
  const s = scena({
    tasks: [],
    companies: AZIENDE,
    calendar_connections: [conn],
    calendar_event_links: [
      collegamento({ id: 'l-recente', task_id: 't-a', provider_event_id: 'evt-a', last_synced_at: '2026-08-01T00:00:00Z' }),
      collegamento({ id: 'l-vecchio', task_id: 't-b', provider_event_id: 'evt-b', last_synced_at: '2026-01-01T00:00:00Z' }),
      collegamento({ id: 'l-mai', task_id: 't-c', provider_event_id: 'evt-c', last_synced_at: null }),
    ],
    calendar_connection_secrets: [await segreti('c-1')],
    calendar_sync_queue: [],
    notification_preferences: [],
  });

  const esito = await reconcileConnection(s.deps, conn as unknown as CalendarConnectionRow, 2, Date.now() + 60_000);
  const guardati = s.chiamate.filter((c) => c.metodo === 'eventExists').map((c) => c.input.providerEventId);
  ok(esito.checked === 2 && JSON.stringify(guardati) === JSON.stringify(['evt-c', 'evt-b']),
    'lotto da 2 su 3 collegamenti: prima quello MAI verificato, poi il più vecchio',
    JSON.stringify(guardati));
}
{
  // Il budget di tempo: a scadenza superata i controlli presso il provider si
  // fermano — nessuna chiamata — ma il controllo degli orfani, che è locale,
  // lavora lo stesso.
  const conn = connessione();
  const s = scena({
    tasks: [attivita({ id: 't-orfana' })],
    companies: AZIENDE,
    calendar_connections: [conn],
    calendar_event_links: [collegamento({ id: 'l-mai-guardato', task_id: 't-altro' })],
    calendar_connection_secrets: [await segreti('c-1')],
    calendar_sync_queue: [],
    notification_preferences: [],
  });

  const esito = await reconcileConnection(s.deps, conn as unknown as CalendarConnectionRow, 50, Date.now() - 1);
  ok(esito.checked === 0 && !s.chiamate.some((c) => c.metodo === 'eventExists'),
    'scadenza superata: nessun collegamento interrogato presso il provider');
  ok(s.tabelle.calendar_event_links.some((l) => l.id === 'l-mai-guardato'),
    'il collegamento non guardato resta dov’è: non giudicato, non toccato');
  ok(esito.requeued === 1 && (s.tabelle.calendar_sync_queue ?? [])[0]?.task_id === 't-orfana',
    'ma l’orfana — che non costa chiamate — va in coda lo stesso');
}
{
  // Un guasto non fa saltare il giro: si registra il codice e si esce puliti.
  // Il chiamante deciderà; la riconciliazione non ha un proprio ritentativo.
  const conn = connessione();
  const s = scena(
    {
      tasks: [],
      companies: AZIENDE,
      calendar_connections: [conn],
      calendar_event_links: [],
      calendar_connection_secrets: [await segreti('c-1', { scadenza: PASSATO })],
      calendar_sync_queue: [],
      notification_preferences: [],
    },
    { refresh: () => { throw new CalendarProviderError('PROVIDER_UNAVAILABLE', 'occupato'); } },
  );

  const esito = await reconcileConnection(s.deps, conn as unknown as CalendarConnectionRow, 50, Date.now() + 60_000);
  ok(esito.errorCode === 'PROVIDER_UNAVAILABLE' && esito.checked === 0,
    'il guasto diventa un codice nell’esito, non un’eccezione che sale');
  ok(s.tabelle.calendar_connections[0].last_sync_at === null,
    'e l’orologio della riconciliazione NON avanza: quel giro non c’è stato');
}

// ===========================================================================
section('9 · Le preferenze arrivano al contenuto: titolo nascosto e lingua di chi riceve');
// ===========================================================================
// ⚠️ La funzione che COMPONE il contenuto è pura ed è provata altrove
// (`test:calendar-unit` §5). Ciò che nessuno provava è il FILO: che le
// preferenze lette dal database arrivino davvero fin lì. Cablando `showTitle:
// true` o `locale: 'it'` dentro `syncTask` la suite restava verde — e chi ha
// spento il titolo (§96) se lo sarebbe ritrovato scritto nel calendario, che è
// una promessa di riservatezza, non una preferenza estetica.
{
  const t = attivita();
  const s = scena({
    tasks: [t],
    companies: AZIENDE,
    calendar_connections: [connessione()],
    calendar_event_links: [],
    calendar_connection_secrets: [await segreti('c-1')],
    notification_preferences: [{
      company_id: 'A', user_id: 'u-1',
      in_app_enabled: true, email_enabled: false,
      remind_7_days: true, remind_1_day: true, remind_due_day: true, remind_overdue: true,
      timezone: 'Europe/Zurich', locale: 'fr', show_task_title: false,
    }],
  });

  await syncTask(s.deps, 't-1');

  const atteso = buildEventContent({
    task: { id: 't-1', title: t.title as string, dueDate: t.due_date as string, priority: 'high' },
    companyName: 'Rossi SA', appOrigin: 'https://app.ai-swisse.com',
    locale: 'fr', showTitle: false,
  });
  const scrittura = s.chiamate.find((c) => c.metodo === 'upsertEvent');

  ok(scrittura?.input.title === atteso.title,
    'titolo spento: all’adapter arriva il titolo GENERICO, non quello dell’attività',
    `arrivato: ${JSON.stringify(scrittura?.input.title)}`);
  ok(!String(scrittura?.input.title).includes('rendiconto'),
    '⚠️ il testo vero dell’attività non lascia AI-Swisse');
  ok(scrittura?.input.description === atteso.description,
    'e la descrizione è nella lingua di chi riceve, non in quella del server');
  ok(String(scrittura?.input.description).includes('Tâche synchronisée'),
    'francese davvero, non italiano che passa per francese');
}

// ---------------------------------------------------------------------------
console.log(`\n${B}Totale:${X} ${G}${pass} superate${X}, ${fail === 0 ? '0 fallite' : `${R}${fail} FALLITE${X}`}`);
process.exit(fail === 0 ? 0 : 1);
