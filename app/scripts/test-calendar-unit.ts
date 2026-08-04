// ============================================================================
// AI-Swisse — Calendario e notifiche: test DETERMINISTICI, offline.
//   npm run test:calendar-unit
//
// Nessuna rete, nessuna credenziale, nessun credito AI. Coprono le decisioni
// che si possono sbagliare in silenzio e che nessun test sul database
// coglierebbe, perché non riguardano il database:
//
//   1. LO STATO DESIDERATO di un evento (§65/§109) — la funzione da cui
//      dipende ogni scrittura verso Google e Microsoft;
//   2. I PROMEMORIA con il fuso orario e il cambio dell'ora (§110);
//   3. LA DEDUPLICAZIONE: lo stesso worker eseguito tre volte (§111);
//   4. L'IDEMPOTENZA degli adapter contro un provider finto (§113/§120);
//   5. IL CONTENUTO degli eventi: giornata intera, nessun invitato, nessun
//      promemoria del provider, nessun dato sensibile (§114/§115/§95);
//   6. LA GRIGLIA del mese, che sbaglia in silenzio disegnando una casella
//      nel posto sbagliato;
//   7. LA COERENZA fra le costanti del server e ciò che la UI dichiara.
//
// ⚠️ NESSUN TEST QUI DIPENDE DAL FUSO ORARIO DELLA MACCHINA. Ogni funzione
// riceve l'istante e la zona per parametro, e la sezione 2 lo verifica
// esplicitamente su due zone diverse contemporaneamente.
// ============================================================================
import {
  buildEventContent, eventContentHash, eventKeyFor, getCalendarDesiredState,
  isValidGoogleEventId, nextDay,
  type DesiredStateConnection, type DesiredStateTask,
} from '../supabase/functions/_shared/calendar/desired.ts';
import {
  daysBetween, dueReminders, reminderWindow, unassignedAlert, zonedNow,
} from '../supabase/functions/_shared/calendar/reminders.ts';
import {
  CORRELATION_HEADERS, DEFAULT_TIMEZONE, EMAIL_MAX_ATTEMPTS, QUEUE_MAX_ATTEMPTS,
  REMINDER_LOCAL_HOUR, UNASSIGNED_ALERT_DAYS, correlationId, dedicatedCalendarName,
  emailBackoffSeconds, queueBackoffSeconds,
} from '../supabase/functions/_shared/calendar/contract.ts';
import { SERVER_LOCALES, formatDay, st } from '../supabase/functions/_shared/calendar/i18n.ts';
import { createGoogleCalendarAdapter } from '../supabase/functions/_shared/calendar/google.ts';
import { createMicrosoftCalendarAdapter } from '../supabase/functions/_shared/calendar/microsoft.ts';
import { buildReminderEmail, createResendProvider } from '../supabase/functions/_shared/calendar/email.ts';
// ⚠️ `notify.ts` è PORTABILE: importa solo store/reminders/i18n/email, mai
// `runtime.ts`. È ciò che permette di eseguire qui la funzione di consegna vera
// invece di una sua imitazione.
import { deliverEmails, type NotifyDeps } from '../supabase/functions/_shared/calendar/notify.ts';
import {
  MAX_PER_DAY, addDays, agendaGroups, buildMonthGrid, gridRange, groupByDay,
  overdueByDays, overdueItems, shiftMonth, shortTitle, todayISO,
} from '../src/features/calendar/calendarModel';
import { badgeLabel, notificationLink, notificationTitleKey, relativeTime } from '../src/features/notifications/notificationFormat';
// ⚠️ Si importa il modulo dei DEFAULT, non il service: quello tira dentro il
// client Supabase, che legge le variabili d'ambiente di Vite e fuori dal
// browser non esiste. È la stessa ragione per cui `runtime.ts` delle Edge
// Function non va importato dai test.
import { DEFAULT_TIMEZONE as UI_TIMEZONE, defaultPreferences as uiDefaults } from '../src/features/calendar/preferencesDefaults';
import type { CalendarTaskItem } from '../src/types/models';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', DIM = '\x1b[2m', X = '\x1b[0m';
const ok = (cond: boolean, label: string, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${label}`); }
  else { fail++; console.log(`  ${R}✗ ${label}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);

const task = (over: Partial<DesiredStateTask> = {}): DesiredStateTask => ({
  id: 't1', companyId: 'A', title: 'Trasmettere rendiconto IVA',
  dueDate: '2026-08-31', status: 'open', priority: 'high',
  assigneeUserId: 'andrea', archivedAt: null, ...over,
});
const conn = (over: Partial<DesiredStateConnection> = {}): DesiredStateConnection => ({
  id: 'c1', companyId: 'A', userId: 'andrea', status: 'active', syncEnabled: true, ...over,
});

console.log(`${B}AI-Swisse — Calendario e notifiche: regole, offline${X}`);

// ===========================================================================
section('1 · Stato desiderato di un evento (§65/§109)');
// ===========================================================================
{
  ok(getCalendarDesiredState(task(), conn()).kind === 'present',
    'aperta + assegnata a me + con scadenza + non archiviata → l’evento deve esistere');

  const completed = getCalendarDesiredState(task({ status: 'completed' }), conn());
  ok(completed.kind === 'absent' && completed.reason === 'completed',
    'completata → l’evento non deve esistere, e il motivo è «completata»');

  const archived = getCalendarDesiredState(task({ archivedAt: '2026-07-01T00:00:00Z' }), conn());
  ok(archived.kind === 'absent' && archived.reason === 'archived', 'archiviata → assente');

  const noDue = getCalendarDesiredState(task({ dueDate: null }), conn());
  ok(noDue.kind === 'absent' && noDue.reason === 'no_due_date',
    'senza scadenza → assente: una data non si inventa per far entrare l’attività nel calendario');

  const other = getCalendarDesiredState(task({ assigneeUserId: 'marco' }), conn());
  ok(other.kind === 'absent' && other.reason === 'not_assignee',
    'assegnata a un altro → assente dal MIO calendario');
  ok(getCalendarDesiredState(task({ assigneeUserId: 'marco' }), conn({ userId: 'marco' })).kind === 'present',
    '…e presente su quello del nuovo responsabile: il cambio di assegnatario sposta l’evento');

  const unassigned = getCalendarDesiredState(task({ assigneeUserId: null }), conn());
  ok(unassigned.kind === 'absent' && unassigned.reason === 'not_assignee',
    'senza responsabile → nessun calendario personale la riceve');

  // §87 — la difesa che nessun test sul database può sostituire.
  const foreign = getCalendarDesiredState(task({ companyId: 'B' }), conn({ companyId: 'A' }));
  ok(foreign.kind === 'absent' && foreign.reason === 'wrong_company',
    'attività di un’altra azienda → assente, e il controllo viene PRIMA di tutto il resto');

  const disabled = getCalendarDesiredState(task(), conn({ syncEnabled: false }));
  ok(disabled.kind === 'absent' && disabled.reason === 'sync_disabled',
    'sincronizzazione spenta → gli eventi già scritti si rimuovono, non restano fermi');
}

// ⚠️ La distinzione che salva il calendario di chi deve solo riautorizzare.
{
  const reauth = getCalendarDesiredState(task(), conn({ status: 'reauth_required' }));
  ok(reauth.kind === 'untouchable' && reauth.reason === 'connection_reauth',
    'connessione da ricollegare → INTOCCABILE, non «assente»: un token scaduto non deve svuotare un calendario');
  ok(getCalendarDesiredState(task(), conn({ status: 'error' })).kind === 'untouchable',
    'connessione in errore → intoccabile');
  ok(getCalendarDesiredState(task(), conn({ status: 'disconnected' })).kind === 'untouchable',
    'connessione scollegata → intoccabile: non abbiamo più un token per toccare niente');
  // Controprova: se «da ricollegare» fosse trattato come «assente», il worker
  // cancellerebbe gli eventi di chi ha solo un consenso scaduto.
  const completedButReauth = getCalendarDesiredState(task({ status: 'completed' }), conn({ status: 'reauth_required' }));
  ok(completedButReauth.kind === 'untouchable',
    'anche un’attività completata su una connessione rotta resta intoccabile: senza token non si cancella nulla');
}

// ===========================================================================
section('2 · Promemoria, fuso orario e ora legale (§110)');
// ===========================================================================
{
  const prefs = {
    remind7Days: true, remind1Day: true, remindDueDay: true, remindOverdue: true,
    timezone: 'Europe/Zurich',
  };

  // ⚠️ IL CASO DELL'ORA LEGALE, e il motivo per cui il fuso non si calcola a mano.
  // In Europe/Zurich l'ora legale del 2026 comincia domenica 29 marzo alle 02:00.
  // Alla STESSA ora UTC, il giorno prima sono le 07:30 locali e il giorno dopo
  // le 08:30: la soglia delle otto cade in mezzo.
  const beforeDst = new Date('2026-03-28T06:30:00Z');
  const afterDst = new Date('2026-03-29T06:30:00Z');
  ok(zonedNow(beforeDst, 'Europe/Zurich').hour === 7,
    'il 28 marzo alle 06:30 UTC a Zurigo sono le 07:30 (ora solare)',
    `ottenuto: ${zonedNow(beforeDst, 'Europe/Zurich').hour}`);
  ok(zonedNow(afterDst, 'Europe/Zurich').hour === 8,
    'il 29 marzo alle 06:30 UTC a Zurigo sono le 08:30 (ora legale già in vigore)',
    `ottenuto: ${zonedNow(afterDst, 'Europe/Zurich').hour}`);
  ok(dueReminders({ dueDate: '2026-03-29', prefs, now: beforeDst, taskId: 't' }).length === 0,
    'prima delle otto locali non si sveglia nessuno');
  ok(dueReminders({ dueDate: '2026-03-29', prefs, now: afterDst, taskId: 't' })
      .some((r) => r.kind === 'd0'),
    'dopo le otto locali il promemoria del giorno stesso parte — e il confine lo ha spostato l’ora legale');

  // La stessa funzione, due zone diverse, lo stesso istante: la macchina non c'entra.
  const instant = new Date('2026-07-15T05:30:00Z');
  ok(zonedNow(instant, 'Europe/Zurich').hour === 7 && zonedNow(instant, 'UTC').hour === 5,
    'lo stesso istante dà ore diverse in zone diverse: il fuso della macchina non entra nel calcolo',
    `Zurigo=${zonedNow(instant, 'Europe/Zurich').hour} UTC=${zonedNow(instant, 'UTC').hour}`);

  let threw = false;
  try { zonedNow(instant, 'Europa/Zurigo'); } catch { threw = true; }
  ok(threw, 'un fuso inesistente SOLLEVA invece di ripiegare su UTC: un promemoria all’ora sbagliata sembra funzionare');
}

// Le quattro finestre.
{
  const prefs = {
    remind7Days: true, remind1Day: true, remindDueDay: true, remindOverdue: true,
    timezone: 'Europe/Zurich',
  };
  const at = (day: string) => new Date(`${day}T09:00:00Z`);   // 11:00 a Zurigo in estate
  const kinds = (dueDate: string, day: string) =>
    dueReminders({ dueDate, prefs, now: at(day), taskId: 't' }).map((r) => r.kind);

  ok(kinds('2026-08-31', '2026-08-24').includes('d7'), 'sette giorni prima → promemoria «fra una settimana»');
  ok(kinds('2026-08-31', '2026-08-30').includes('d1'), 'un giorno prima → promemoria «domani»');
  ok(kinds('2026-08-31', '2026-08-31').includes('d0'), 'il giorno stesso → promemoria «oggi»');
  ok(kinds('2026-08-31', '2026-09-02').includes('overdue'), 'dopo la scadenza → promemoria «scaduta»');
  ok(kinds('2026-08-31', '2026-08-20').length === 0, 'undici giorni prima: ancora niente, non è un promemoria è rumore');

  // ⚠️ Il recupero: l'intervallo, non l'uguaglianza. Se il job resta fermo un
  // giorno, il promemoria dei sette arriva a sei — tardi, non perso (§37).
  ok(kinds('2026-08-31', '2026-08-26').includes('d7'),
    'a cinque giorni scatta ancora la finestra dei sette: un job saltato fa arrivare tardi, non fa perdere');
  ok(!kinds('2026-08-31', '2026-08-30').includes('d7'),
    '…ma a un giorno la finestra dei sette è chiusa: due promemoria per la stessa cosa nello stesso giorno no');

  // Le finestre non si sovrappongono mai.
  for (const offset of [0, 1, 2, 3, 5, 7]) {
    const day = addDays('2026-08-31', -offset);
    const k = kinds('2026-08-31', day);
    ok(k.length <= 1, `a ${offset} giorni dalla scadenza scatta al massimo un promemoria`, `ottenuti: ${k.join(',')}`);
  }

  // Le preferenze spengono davvero.
  const off = { ...prefs, remind7Days: false };
  ok(dueReminders({ dueDate: '2026-08-31', prefs: off, now: at('2026-08-24'), taskId: 't' }).length === 0,
    'una finestra disattivata non produce niente');
}

// ===========================================================================
section('3 · Deduplicazione: lo stesso worker tre volte (§111)');
// ===========================================================================
{
  const prefs = {
    remind7Days: true, remind1Day: true, remindDueDay: true, remindOverdue: true,
    timezone: 'Europe/Zurich',
  };
  const keys = [0, 1, 2].map(() =>
    dueReminders({ dueDate: '2026-08-31', prefs, now: new Date('2026-08-30T09:00:00Z'), taskId: 'task-42' })
      .map((r) => r.dedupeKey).join('|'));
  ok(new Set(keys).size === 1 && keys[0] === 'task:task-42:d1',
    'tre esecuzioni producono la STESSA chiave: il duplicato lo respinge il vincolo del database, non un controllo nel codice',
    `chiavi: ${JSON.stringify(keys)}`);

  // Chiavi diverse per finestre diverse: altrimenti il promemoria del giorno
  // stesso non arriverebbe mai a chi ha già ricevuto quello dei sette giorni.
  const all = ['2026-08-24', '2026-08-30', '2026-08-31', '2026-09-02'].map((d) =>
    dueReminders({ dueDate: '2026-08-31', prefs, now: new Date(`${d}T09:00:00Z`), taskId: 't' })
      .map((r) => r.dedupeKey)).flat();
  ok(new Set(all).size === all.length && all.length === 4,
    'le quattro finestre hanno quattro chiavi distinte', `chiavi: ${all.join(', ')}`);

  // L'attività urgente senza responsabile: una volta sola, e solo se alta.
  const alert = unassignedAlert({
    dueDate: '2026-08-31', priority: 'high', now: new Date('2026-08-28T09:00:00Z'),
    timezone: 'Europe/Zurich', taskId: 't',
  });
  ok(alert?.dedupeKey === 'task:t:unassigned', 'l’avviso «urgente senza responsabile» ha una chiave sola, per sempre');
  ok(unassignedAlert({
    dueDate: '2026-08-31', priority: 'medium', now: new Date('2026-08-28T09:00:00Z'),
    timezone: 'Europe/Zurich', taskId: 't',
  }) === null, 'a priorità media non scatta: un avviso che arriva sempre non viene più letto');
  ok(unassignedAlert({
    dueDate: '2026-12-31', priority: 'high', now: new Date('2026-08-28T09:00:00Z'),
    timezone: 'Europe/Zurich', taskId: 't',
  }) === null, `oltre ${UNASSIGNED_ALERT_DAYS} giorni non scatta`);
}

// ===========================================================================
section('4 · Giorni di calendario e finestra del worker');
// ===========================================================================
{
  ok(daysBetween('2026-08-24', '2026-08-31') === 7, 'sette giorni sono sette');
  ok(daysBetween('2026-08-31', '2026-08-24') === -7, 'e all’indietro sono meno sette');
  ok(daysBetween('2026-03-28', '2026-03-30') === 2,
    'attraversando il cambio dell’ora restano due giorni, non 1,96');
  ok(daysBetween('2028-02-28', '2028-03-01') === 2, 'il 29 febbraio di un anno bisestile è un giorno vero');
  ok(Number.isNaN(daysBetween('non-una-data', '2026-01-01')), 'una data illeggibile non diventa zero');

  const w = reminderWindow(new Date('2026-07-27T12:00:00Z'), 30);
  ok(w.from === '2026-06-27' && w.to === '2026-08-04',
    'la finestra guarda indietro un mese e avanti otto giorni', `${w.from} → ${w.to}`);
}

// ===========================================================================
section('5 · Contenuto dell’evento: che cosa esce dal prodotto (§95/§114)');
// ===========================================================================
{
  const content = buildEventContent({
    task: { id: 'task-1', title: 'Trasmettere rendiconto IVA', dueDate: '2026-08-31', priority: 'high' },
    companyName: 'Rossi SA',
    appOrigin: 'https://app.ai-swisse.com',
    locale: 'it',
    showTitle: true,
  });
  ok(content.title === 'Trasmettere rendiconto IVA', 'il titolo è quello dell’attività');
  ok(content.description.includes('Rossi SA'), 'la descrizione dice di quale azienda si tratta');
  ok(content.description.includes('https://app.ai-swisse.com/attivita/task-1'),
    'e porta un collegamento all’attività, costruito sull’origine decisa dal SERVER');

  // ⚠️ Il controllo che conta: nel calendario NON finisce nient'altro.
  const vietati = ['CHF', 'IBAN', 'iban', '4820', 'Amministrazione federale', 'allegato', 'estratto'];
  ok(!vietati.some((v) => content.description.includes(v)),
    'nessun importo, IBAN, mittente o contenuto di documento finisce nell’evento');

  const hidden = buildEventContent({
    task: { id: 'task-1', title: 'Trasmettere rendiconto IVA', dueDate: '2026-08-31', priority: 'high' },
    companyName: 'Rossi SA', appOrigin: 'https://app.ai-swisse.com', locale: 'it', showTitle: false,
  });
  ok(hidden.title === 'Attività AI-Swisse in scadenza' && !hidden.title.includes('IVA'),
    'con il titolo nascosto (§96) il testo vero non lascia AI-Swisse');
  ok(hidden.description.includes('https://app.ai-swisse.com/attivita/task-1'),
    '…ma il collegamento resta: l’evento deve pur portare da qualche parte');

  // Le tre lingue, dallo stesso contenuto.
  for (const locale of SERVER_LOCALES) {
    const c = buildEventContent({
      task: { id: 't', title: 'X', dueDate: '2026-08-31', priority: 'medium' },
      companyName: 'Rossi SA', appOrigin: 'https://x.test', locale, showTitle: true,
    });
    ok(c.description.split('\n').length === 4 && c.description.trim().length > 30,
      `la descrizione è completa in ${locale}`);
  }
}

// La chiave dell'evento: deterministica e valida per Google.
{
  const k1 = await eventKeyFor('task-1', 'conn-1');
  const k2 = await eventKeyFor('task-1', 'conn-1');
  const k3 = await eventKeyFor('task-1', 'conn-2');
  ok(k1 === k2, 'la stessa coppia (attività, connessione) dà sempre la stessa chiave');
  ok(k1 !== k3, 'connessioni diverse danno chiavi diverse: la stessa attività può stare su due calendari');
  ok(isValidGoogleEventId(k1),
    'la chiave rispetta l’alfabeto che Google impone (a–v e 0–9)', `chiave: ${k1}`);
  ok(!isValidGoogleEventId('aiswisse-task'),
    'il controllo dell’alfabeto boccia davvero: «w» e «-» non sono ammessi');

  const h1 = await eventContentHash({ calendarId: 'cal', title: 'A', description: 'D', date: '2026-08-31' });
  const h2 = await eventContentHash({ calendarId: 'cal', title: 'A', description: 'D', date: '2026-09-15' });
  const h3 = await eventContentHash({ calendarId: 'ALTRO', title: 'A', description: 'D', date: '2026-08-31' });
  ok(h1 !== h2, 'cambiando la data cambia l’impronta: l’evento va riscritto');
  ok(h1 !== h3, 'cambiando calendario cambia l’impronta: gli eventi vanno riscritti nel calendario nuovo');
}

// La fine esclusiva: il difetto più facile da non vedere.
{
  ok(nextDay('2026-08-31') === '2026-09-01', 'il giorno dopo il 31 agosto è il 1° settembre');
  ok(nextDay('2026-12-31') === '2027-01-01', 'e dopo il 31 dicembre viene l’anno nuovo');
  ok(nextDay('2028-02-28') === '2028-02-29', 'il 2028 è bisestile');
  ok(nextDay('2026-03-28') === '2026-03-29', 'il giorno del cambio d’ora dura comunque un giorno');
}

// ===========================================================================
section('6 · Adapter Google: idempotenza e forma dell’evento (§113/§114)');
// ===========================================================================

interface Chiamata { method: string; url: string; body: unknown }

/** Un provider finto: registra le chiamate e risponde secondo un copione. */
function fakeFetch(copione: (c: Chiamata, n: number) => { status: number; body?: unknown }) {
  const chiamate: Chiamata[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const c: Chiamata = {
      method: init?.method ?? 'GET',
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    chiamate.push(c);
    const r = copione(c, chiamate.length);
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
      status: r.status, headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, chiamate };
}

// ⚠️ `taskId` è un UUID, come nel sistema vero: gli adapter lo interpolano in
// un'espressione di interrogazione e ne verificano la forma. Un dato di prova
// più permissivo del dato reale nasconderebbe proprio quel controllo.
const TASK_ID = '3f2a1c9e-7b4d-4a10-9c55-1e8f0d6b2a34';
const EVENTO = {
  eventKey: 'ais0123456789abcdef', title: 'Trasmettere rendiconto IVA',
  description: 'Attività sincronizzata da AI-Swisse.', date: '2026-08-31', taskId: TASK_ID,
};

{
  // Caso normale: l'evento esiste già → una sola PATCH.
  const f = fakeFetch(() => ({ status: 200, body: { id: 'evt-1' } }));
  const google = createGoogleCalendarAdapter({
    clientId: 'x', clientSecret: 'y', redirectUri: 'https://r.test', fetchImpl: f.impl,
  });
  const ref = await google.upsertEvent({
    accessToken: 'tok', calendarId: 'cal-1', providerEventId: 'evt-1', event: EVENTO,
  });
  ok(ref.providerEventId === 'evt-1' && f.chiamate.length === 1 && f.chiamate[0].method === 'PATCH',
    'un evento già collegato si aggiorna con UNA chiamata',
    `chiamate: ${f.chiamate.map((c) => c.method).join(',')}`);

  const body = f.chiamate[0].body as Record<string, any>;
  ok(body.start?.date === '2026-08-31' && body.end?.date === '2026-09-01',
    'giornata intera con la fine ESCLUSIVA: il giorno dopo, come documenta Google');
  ok(body.start?.dateTime === undefined && body.end?.dateTime === undefined,
    'nessun orario inventato: `due_date` è una data, non le nove del mattino (§8)');
  ok(body.attendees === undefined, 'nessun partecipante: un evento senza destinatari non può mandare inviti (§55)');
  ok(body.conferenceData === undefined, 'nessuna riunione online (§56)');
  ok(body.reminders?.useDefault === false && Array.isArray(body.reminders?.overrides) && body.reminders.overrides.length === 0,
    'nessun promemoria dal provider: quelli li fa AI-Swisse, e due per la stessa cosa si ignorano entrambi (§57)');
  ok(body.extendedProperties?.private?.aiSwisseTaskId === TASK_ID,
    'l’identificativo dell’attività sta nei metadati applicativi, per la riconciliazione (§60)');
  ok(body.status === 'confirmed',
    'lo stato è dichiarato «confermato»: è ciò che RIPRISTINA un evento cancellato a mano');
  ok(f.chiamate[0].url.includes('sendUpdates=none'), 'nessuna notifica ai partecipanti (§55)');
}

{
  // ⚠️ IL RITENTATIVO DOPO UN TIMEOUT (§113/§59). L'evento non c'è (404 sulla
  // PATCH), si crea con l'identificativo scelto da noi, e Google risponde 409
  // perché la creazione precedente ERA andata a buon fine: la risposta si era
  // persa per strada. Il risultato deve essere UN evento, non due.
  const f = fakeFetch((c, n) => {
    if (n === 1) return { status: 404 };                       // PATCH: non lo trova
    if (n === 2) return { status: 409 };                       // POST: esiste già
    return { status: 200, body: { id: EVENTO.eventKey } };     // PATCH: lo aggiorna
  });
  const google = createGoogleCalendarAdapter({
    clientId: 'x', clientSecret: 'y', redirectUri: 'https://r.test', fetchImpl: f.impl,
  });
  const ref = await google.upsertEvent({
    accessToken: 'tok', calendarId: 'cal-1', providerEventId: null, event: EVENTO,
  });
  ok(ref.providerEventId === EVENTO.eventKey,
    'un conflitto sull’identificativo NON crea un secondo evento: si adotta quello che c’è');
  const posts = f.chiamate.filter((c) => c.method === 'POST');
  ok(posts.length === 1, 'e la creazione viene tentata UNA volta sola', `POST: ${posts.length}`);
  ok((posts[0].body as Record<string, unknown>).id === EVENTO.eventKey,
    'la creazione porta l’identificativo deterministico: è la primitiva di idempotenza di Google');
}

{
  // §120 — cambio di scadenza: lo STESSO evento, aggiornato.
  const f = fakeFetch(() => ({ status: 200, body: { id: 'evt-1' } }));
  const google = createGoogleCalendarAdapter({
    clientId: 'x', clientSecret: 'y', redirectUri: 'https://r.test', fetchImpl: f.impl,
  });
  await google.upsertEvent({
    accessToken: 'tok', calendarId: 'cal-1', providerEventId: 'evt-1',
    event: { ...EVENTO, date: '2026-09-15' },
  });
  const body = f.chiamate[0].body as Record<string, any>;
  ok(f.chiamate.every((c) => c.method !== 'POST') && body.start.date === '2026-09-15',
    '31 agosto → 15 settembre aggiorna l’evento esistente, non ne crea un secondo');
}

{
  // Cancellazione: un evento già sparito NON è un errore.
  const f = fakeFetch(() => ({ status: 404 }));
  const google = createGoogleCalendarAdapter({
    clientId: 'x', clientSecret: 'y', redirectUri: 'https://r.test', fetchImpl: f.impl,
  });
  let sollevato = false;
  try {
    await google.deleteEvent({ accessToken: 'tok', calendarId: 'cal', providerEventId: 'evt' });
  } catch { sollevato = true; }
  ok(!sollevato, 'cancellare un evento già cancellato riesce: l’esito voluto è raggiunto');

  // Un evento annullato conta come ASSENTE: per chi guarda il calendario non c'è.
  const f2 = fakeFetch(() => ({ status: 200, body: { id: 'evt', status: 'cancelled' } }));
  const g2 = createGoogleCalendarAdapter({
    clientId: 'x', clientSecret: 'y', redirectUri: 'https://r.test', fetchImpl: f2.impl,
  });
  ok(!(await g2.eventExists({ accessToken: 't', calendarId: 'c', providerEventId: 'e' })),
    'un evento annullato risulta assente: è ciò che fa scattare la ricreazione (§68)');
}

{
  // Lo scope: il privilegio minimo, e nessuno scope della posta.
  const google = createGoogleCalendarAdapter({ clientId: 'cid', clientSecret: 'y', redirectUri: 'https://r.test' });
  const url = google.buildAuthorizationUrl({ state: 's', codeChallenge: 'c' });
  ok(url.includes('calendar.app.created'), 'si chiede lo scope a privilegio minimo di Google');
  ok(!url.includes('gmail'), 'e nessuno scope della posta');
  ok(url.includes('include_granted_scopes=false'),
    '⚠️ include_granted_scopes=false: altrimenti chi ha già collegato la posta otterrebbe un token che legge anche Gmail (§49)');
  ok(url.includes('access_type=offline') && url.includes('prompt=consent'),
    'si chiede il refresh token, e lo si richiede anche a chi aveva già autorizzato');
  ok(url.includes('code_challenge_method=S256'), 'PKCE');
}

// ===========================================================================
section('7 · Adapter Microsoft: stesso dominio, altra strada (§115)');
// ===========================================================================
{
  const f = fakeFetch(() => ({ status: 200, body: { id: 'evt-ms' } }));
  const ms = createMicrosoftCalendarAdapter({
    clientId: 'x', clientSecret: 'y', redirectUri: 'https://r.test', fetchImpl: f.impl,
  });
  await ms.upsertEvent({ accessToken: 'tok', calendarId: 'cal', providerEventId: 'evt-ms', event: EVENTO });

  const body = f.chiamate[0].body as Record<string, any>;
  ok(body.isAllDay === true, 'giornata intera');
  ok(body.start?.dateTime === '2026-08-31T00:00:00.0000000' && body.end?.dateTime === '2026-09-01T00:00:00.0000000',
    'due mezzanotti nello stesso fuso, con la fine esclusiva: è ciò che Graph impone quando isAllDay è vero');
  ok(body.start?.timeZone === body.end?.timeZone, 'e nello STESSO fuso, come richiede la documentazione');
  ok(Array.isArray(body.attendees) && body.attendees.length === 0,
    'nessun partecipante — dichiarato vuoto e non omesso, così un aggiornamento non ne lascia di vecchi');
  ok(body.isReminderOn === false, 'nessun promemoria dal provider (§57)');
  ok(body.isOnlineMeeting === undefined, 'nessuna riunione Teams (§56)');
  ok(body.showAs === 'free', 'una scadenza non occupa la giornata di nessuno');
  ok(body.singleValueExtendedProperties?.[0]?.value === TASK_ID,
    'l’identificativo dell’attività è nella proprietà estesa: è così che si ritrova l’evento su Graph');
  ok(body.transactionId === undefined,
    'in AGGIORNAMENTO il transactionId non si manda: Graph non ne consente la modifica dopo la creazione');
}

{
  // ⚠️ La differenza con Google: senza un identificativo noto si CERCA prima di
  // scrivere, altrimenti la ricreazione dopo una cancellazione manuale
  // produrrebbe un doppione.
  const f = fakeFetch((c, n) => {
    if (n === 1) return { status: 200, body: { value: [] } };       // ricerca: niente
    return { status: 201, body: { id: 'evt-nuovo' } };              // creazione
  });
  const ms = createMicrosoftCalendarAdapter({
    clientId: 'x', clientSecret: 'y', redirectUri: 'https://r.test', fetchImpl: f.impl,
  });
  const ref = await ms.upsertEvent({ accessToken: 'tok', calendarId: 'cal', providerEventId: null, event: EVENTO });
  ok(ref.providerEventId === 'evt-nuovo', 'senza evento esistente se ne crea uno');
  ok(f.chiamate[0].method === 'GET' && f.chiamate[0].url.includes('singleValueExtendedProperties'),
    'ma PRIMA si cerca per metadato: è la rete di sicurezza che Google non serve, perché là l’id lo scegliamo noi');
  ok((f.chiamate[1].body as Record<string, unknown>).transactionId === EVENTO.eventKey,
    'e la creazione porta il transactionId, che copre il ritentativo dopo un timeout');

  // Ritentativo: la ricerca TROVA l'evento della volta precedente → si aggiorna.
  const f2 = fakeFetch((c, n) => {
    if (n === 1) return { status: 200, body: { value: [{ id: 'evt-gia-creato' }] } };
    return { status: 200, body: { id: 'evt-gia-creato' } };
  });
  const ms2 = createMicrosoftCalendarAdapter({
    clientId: 'x', clientSecret: 'y', redirectUri: 'https://r.test', fetchImpl: f2.impl,
  });
  const ref2 = await ms2.upsertEvent({ accessToken: 'tok', calendarId: 'cal', providerEventId: null, event: EVENTO });
  ok(ref2.providerEventId === 'evt-gia-creato' && f2.chiamate.every((c) => c.method !== 'POST'),
    'al ritentativo la ricerca trova l’evento già creato e NON se ne crea un secondo (§59)');
}

{
  // L'identificativo dell'attività finisce dentro un'espressione OData: la sua
  // forma si verifica prima di comporla, non si spera che sia un UUID.
  const f = fakeFetch(() => ({ status: 200, body: { value: [] } }));
  const ms = createMicrosoftCalendarAdapter({
    clientId: 'x', clientSecret: 'y', redirectUri: 'https://r.test', fetchImpl: f.impl,
  });
  let respinto = false;
  try {
    await ms.findEventByTask({ accessToken: 't', calendarId: 'c', taskId: "x' or ep/value eq 'y" });
  } catch { respinto = true; }
  ok(respinto && f.chiamate.length === 0,
    'un identificativo malformato viene RESPINTO prima di comporre il filtro, e nessuna richiesta parte');
  ok(await ms.findEventByTask({ accessToken: 't', calendarId: 'c', taskId: '00000000-0000-4000-8000-000000000000' }) === null,
    '…mentre un UUID vero passa');
}

{
  const ms = createMicrosoftCalendarAdapter({ clientId: 'cid', clientSecret: 'y', redirectUri: 'https://r.test' });
  const url = ms.buildAuthorizationUrl({ state: 's', codeChallenge: 'c' });
  ok(url.includes('Calendars.ReadWrite') && !url.includes('Calendars.ReadWrite.All'),
    'permessi DELEGATI e mai quelli di applicazione, che coprirebbero l’intera organizzazione (§51)');
  ok(!url.includes('.Shared'), 'e nemmeno i calendari condivisi e delegati');
  ok(url.includes('offline_access'), 'si chiede il refresh token');
  ok(ms.scopes.length > 0 && ms.scopes.every((s) => !s.includes('Mail')),
    'nessun permesso sulla posta in un adapter di calendario (§49)');
}

// Il modello di dominio è lo stesso per i due provider.
{
  const google = createGoogleCalendarAdapter({ clientId: 'x', clientSecret: 'y', redirectUri: 'https://r.test' });
  const ms = createMicrosoftCalendarAdapter({ clientId: 'x', clientSecret: 'y', redirectUri: 'https://r.test' });
  const metodi = ['buildAuthorizationUrl', 'exchangeCode', 'refresh', 'getAccountIdentity',
    'ensureDedicatedCalendar', 'upsertEvent', 'deleteEvent', 'eventExists', 'findEventByTask', 'revoke'];
  ok(metodi.every((m) => typeof (google as any)[m] === 'function' && typeof (ms as any)[m] === 'function'),
    'i due adapter rispettano lo stesso contratto: il dominio non sa quale provider c’è dietro');
  // ⚠️ L'ASSENZA è il vincolo: non esiste un metodo per leggere i calendari
  // personali, le disponibilità o gli eventi altrui. Se un domani servisse,
  // comparirebbe qui e questo test lo direbbe.
  const vietati = ['listCalendars', 'listEvents', 'freeBusy', 'sendInvite', 'addAttendee'];
  ok(vietati.every((m) => (google as any)[m] === undefined && (ms as any)[m] === undefined),
    'nessun metodo per leggere calendari personali, disponibilità o invitare qualcuno: l’assenza È la garanzia');
}

// ===========================================================================
section('8 · Ritentativi ed email (§44/§112)');
// ===========================================================================
{
  ok(queueBackoffSeconds(1) < queueBackoffSeconds(2) && queueBackoffSeconds(2) < queueBackoffSeconds(3),
    'l’attesa della coda cresce a ogni tentativo');
  ok(queueBackoffSeconds(20) <= 3600, 'e ha un tetto: non si arriva mai a riprovare fra una settimana');
  ok(QUEUE_MAX_ATTEMPTS > 1 && QUEUE_MAX_ATTEMPTS < 20,
    'i tentativi sono finiti: né uno solo, né infiniti');

  // Il jitter: senza, tutte le consegne respinte insieme ritentano insieme e
  // ricreano il picco che le aveva fatte respingere.
  const con = emailBackoffSeconds(2, () => 0);
  const senza = emailBackoffSeconds(2, () => 1);
  ok(senza > con, 'l’attesa dell’email porta un jitter: due consegne non ripartono nello stesso istante');
  ok(EMAIL_MAX_ATTEMPTS >= 2 && EMAIL_MAX_ATTEMPTS <= 10, 'i tentativi di invio sono limitati');

  const mail = buildReminderEmail({
    subject: 'AI-Swisse — Attività in scadenza domani',
    companyName: 'Rossi SA',
    taskTitle: 'Trasmettere rendiconto IVA',
    deadlineLine: 'Scadenza: 31 agosto 2026',
    actionLabel: 'Apri attività',
    url: 'https://app.ai-swisse.com/attivita/task-1',
    footer: 'Ricevi questo messaggio perché…',
  });
  ok(mail.text.includes('Rossi SA') && mail.text.includes('Trasmettere rendiconto IVA'),
    'l’email dice azienda e attività');
  ok(mail.text.includes('https://app.ai-swisse.com/attivita/task-1'), 'e porta un collegamento');
  ok(mail.text.includes('Ricevi questo messaggio perché'),
    'e dice PERCHÉ arriva: senza quella riga un promemoria è indistinguibile da posta non richiesta');
  ok(!/[<>]/.test(mail.text),
    'testo semplice, nessun markup: dove non c’è HTML non esiste il difetto «mi sono dimenticato di sanificare»');
}

// ===========================================================================
section('9 · Griglia del mese e agenda');
// ===========================================================================
{
  // Agosto 2026 comincia di SABATO: il caso che rompe le griglie ingenue.
  const grid = buildMonthGrid(2026, 8);
  ok(grid.every((w) => w.length === 7), 'ogni settimana ha sette giorni');
  ok(grid[0][0].date === '2026-07-27' && !grid[0][0].inMonth,
    'la prima riga comincia dal lunedì, anche se appartiene al mese precedente',
    `primo: ${grid[0][0].date}`);
  ok(grid.flat().filter((d) => d.inMonth).length === 31, 'agosto ha trentun giorni, tutti presenti');
  ok(grid.every((w) => w.some((d) => d.inMonth)),
    'nessuna riga interamente fuori mese: farebbe saltellare l’altezza della pagina');

  // Febbraio 2027 comincia di lunedì e ha 28 giorni: quattro righe esatte.
  const feb = buildMonthGrid(2027, 2);
  ok(feb.length === 4 && feb[0][0].date === '2027-02-01', 'un febbraio che comincia di lunedì sta in quattro righe');

  // ⚠️ Agosto 2026 comincia di sabato E finisce di lunedì: servono SEI righe, e
  // l'ultima sconfina nel 6 settembre. L'intervallo chiesto al database deve
  // coprire tutto ciò che si disegna — un giorno in meno significherebbe una
  // casella vuota che in realtà ha una scadenza dentro.
  const range = gridRange(2026, 8);
  ok(range.from === '2026-07-27' && range.to === '2026-09-06',
    'l’intervallo chiesto al database copre TUTTE le caselle disegnate, sconfinamenti compresi',
    `${range.from} → ${range.to}`);
  ok(grid.length === 6, 'e per agosto 2026 le righe sono sei', `righe: ${grid.length}`);
  // Controprova su un mese che ne richiede cinque.
  ok(buildMonthGrid(2026, 9).length === 5, 'settembre 2026 sta invece in cinque righe');

  ok(shiftMonth(2026, 12, 1).year === 2027 && shiftMonth(2026, 12, 1).month === 1, 'dopo dicembre viene gennaio');
  ok(shiftMonth(2026, 1, -1).year === 2025 && shiftMonth(2026, 1, -1).month === 12, 'e prima di gennaio dicembre');
}

{
  const item = (over: Partial<CalendarTaskItem>): CalendarTaskItem => ({
    id: 'x', title: 'A', dueDate: '2026-08-31', priority: 'medium', status: 'open',
    source: 'manual', assigneeUserId: null, assigneeName: null, documentId: null, ...over,
  });
  const items = [
    item({ id: '1', dueDate: '2026-08-31', priority: 'low', title: 'Zeta' }),
    item({ id: '2', dueDate: '2026-08-31', priority: 'high', title: 'Alfa' }),
    item({ id: '3', dueDate: '2026-08-31', priority: 'high', status: 'completed', title: 'Fatta' }),
    item({ id: '4', dueDate: '2026-09-02' }),
  ];
  const byDay = groupByDay(items);
  ok(byDay.get('2026-08-31')?.length === 3, 'tre attività lo stesso giorno');
  const order = byDay.get('2026-08-31')!.map((t) => t.id);
  ok(order[0] === '2' && order[2] === '3',
    'dentro la giornata: prima la priorità alta, in fondo ciò che è già stato fatto', `ordine: ${order.join(',')}`);

  const groups = agendaGroups(items);
  ok(groups.length === 2 && groups[0].date === '2026-08-31',
    'l’agenda elenca solo i giorni che hanno qualcosa, in ordine');

  // Le scadute passano dalla STESSA definizione di Attività e Panoramica.
  const oggi = new Date('2026-09-01T10:00:00');
  const late = overdueItems(items, oggi);
  ok(late.length === 2 && late.every((t) => t.status !== 'completed'),
    'in ritardo: le aperte con scadenza passata, mai quelle concluse');
  ok(overdueByDays(item({ dueDate: '2026-08-30' }), oggi) === 2, 'scaduta da due giorni');

  ok(MAX_PER_DAY === 3, 'in una casella del mese si mostrano tre attività, poi si riassume');
  ok(shortTitle('Trasmettere il rendiconto IVA del secondo trimestre').endsWith('…'),
    'un titolo lungo viene abbreviato');
  ok(!shortTitle('Trasmettere il rendiconto IVA del secondo trimestre').includes('trime'),
    '…senza tagliare a metà una parola');
  ok(shortTitle('Breve') === 'Breve', 'un titolo corto resta intero');
}

// ===========================================================================
section('10 · Notifiche: etichette, collegamenti, badge');
// ===========================================================================
{
  // ⚠️⚠️ L'ELENCO SI LEGGE DALLE MIGRAZIONI, non si scrive a mano.
  //
  // Fino al 2026-07-30 questo test enumerava SETTE tipi scritti qui dentro,
  // mentre il database ne ammetteva già undici: `workflow_alert` (0020),
  // `crm_opportunity_assigned` (0026) e i quattro degli incentivi (0032) non
  // venivano provati da nessuno. Una lista a mano non fallisce quando l'enum
  // cresce — smette semplicemente di guardare, e resta verde. È la stessa
  // trappola di `crm_is_public_domain`, chiusa nello stesso modo: il test
  // LEGGE l'SQL.
  //
  // ⚠️ E il difetto non sarebbe stato cosmetico: `notificationTitleKey` è uno
  //    `switch` senza `default`, quindi un tipo non coperto torna `undefined` e
  //    la campanella va in crash su `t(undefined)`.
  const SQL = ['0018_calendar_notifications', '0020_workflow_automation',
    '0024_contract_manager', '0026_crm_light', '0032_subsidy_ai_2']
    .map((f) => readFileSync(join(HERE, '..', 'supabase', 'migrations', `${f}.sql`), 'utf8'))
    .join('\n');

  const dichiarati = new Set<string>();
  const creato = SQL.match(/create type public\.notification_type as enum \(([\s\S]*?)\)/i);
  if (creato) {
    for (const m of creato[1].replace(/--[^\n]*/g, '').matchAll(/'([^']+)'/g)) dichiarati.add(m[1]);
  }
  for (const m of SQL.matchAll(/alter type public\.notification_type add value if not exists '([^']+)'/gi)) {
    dichiarati.add(m[1]);
  }

  ok(dichiarati.size >= 11,
    `l'enum del database dichiara ${dichiarati.size} tipi di notifica`, [...dichiarati].join(', '));
  for (const type of dichiarati) {
    const key = notificationTitleKey({ type: type as never, payload: {} });
    ok(typeof key === 'string' && key.startsWith('notifications.'),
      `«${type}» ha la sua etichetta: senza, la campanella chiama t(undefined) e va in crash`);
  }
  ok(notificationTitleKey({ type: 'task_due_soon', payload: { kind: 'd1' } }) === 'notifications.typeDueTomorrow',
    '«domani» e «fra una settimana» sono la stessa notifica per il database e due frasi diverse per chi legge');
  ok(notificationTitleKey({ type: 'task_due_soon', payload: { kind: 'd7' } }) === 'notifications.typeDueSoon',
    '…e la distinzione viene dal dato scritto dal worker, non da una deduzione');

  ok(notificationLink({ entityType: 'task', entityId: 'abc' }) === '/attivita/abc',
    'una notifica di attività porta all’attività');
  ok(notificationLink({ entityType: 'calendar_connection', entityId: 'x' }) === '/calendario/impostazioni',
    'una notifica di calendario porta alle impostazioni');
  ok(notificationLink({ entityType: 'sconosciuto', entityId: 'x' }) === '/',
    'un tipo sconosciuto non diventa un collegamento inventato');

  // ⚠️⚠️ OGNI ENTITÀ CHE IL VINCOLO DI `notifications` AMMETTE deve avere un
  //    collegamento vero. Il ramo finale `return '/'` esiste per i valori
  //    SCONOSCIUTI, ed è giusto; ma un valore che il database ammette e che
  //    finisce lì è una campanella che porta alla Panoramica invece che alla
  //    cosa di cui parla. Il 2026-07-30 ci finivano `contract` (ammesso dalla
  //    0024 apposta per «il preavviso si avvicina») e i due degli incentivi.
  // ⚠️ SI PRENDE L'ULTIMO, non il primo: il vincolo viene RIDEFINITO a ogni
  //    migrazione che allarga l'elenco (0020, 0024, 0026, 0032), e quello in
  //    vigore è l'ultimo applicato. La prima versione di questo controllo
  //    leggeva il primo e vedeva tre entità su nove — cioè dichiarava di
  //    guardare tutto mentre guardava un terzo. Un controllo che sembra
  //    completo e non lo è vale meno di nessun controllo.
  const vincoli = [...SQL.matchAll(
    /alter table public\.notifications[\s\S]*?check \(entity_type in \(([\s\S]*?)\)\)/gi)];
  const ultimo = vincoli.length ? vincoli[vincoli.length - 1] : null;
  const entita = ultimo
    ? [...ultimo[1].replace(/--[^\n]*/g, '').matchAll(/'([^']+)'/g)].map((m) => m[1])
    : [];
  ok(entita.length >= 9, `il vincolo ammette ${entita.length} tipi di entità`, entita.join(', '));
  for (const et of entita) {
    const link = notificationLink({ entityType: et as never, entityId: 'abc', payload: {} });
    ok(link !== '/',
      `«${et}» porta a qualcosa di preciso e non alla Panoramica`, link);
  }

  ok(notificationLink({ entityType: 'contract', entityId: 'c1' }) === '/contratti/c1',
    'un avviso di contratto porta al contratto (0024)');
  ok(notificationLink({ entityType: 'subsidy_case', entityId: 'k1' }) === '/incentivi?scheda=pratiche',
    'una notifica di pratica porta alla scheda Pratiche');
  // ⚠️ Non esiste una rotta per la singola opportunità: si porta all'elenco,
  //    filtrato sul progetto quando il produttore lo dichiara. Inventare
  //    `/incentivi/:id` darebbe un indirizzo che non risponde.
  ok(notificationLink({ entityType: 'subsidy_opportunity', entityId: 'o1', payload: {} }) === '/incentivi',
    'senza progetto dichiarato, una notifica di opportunità apre l’elenco');
  ok(notificationLink({
    entityType: 'subsidy_opportunity', entityId: 'o1', payload: { projectId: 'p 1' },
  }) === '/incentivi?progetto=p%201',
    'con il progetto dichiarato l’elenco arriva già filtrato, e l’identificativo è codificato');

  ok(badgeLabel(0) === '' && badgeLabel(3) === '3' && badgeLabel(147) === '9+',
    'il pallino non contiene mai più di due caratteri (§80)');

  const rel = relativeTime(new Date(Date.now() - 7_200_000).toISOString(), 'it-CH');
  ok(rel.length > 0 && !rel.includes('NaN'), 'il tempo relativo si compone nella lingua di chi legge', rel);
}

// ===========================================================================
section('11 · Coerenza fra server e interfaccia');
// ===========================================================================
{
  // La stessa trappola già pagata con l'Inbox: due copie di una costante che
  // divergono, e l'interfaccia promette una cosa mentre il server ne fa un'altra.
  ok(UI_TIMEZONE === DEFAULT_TIMEZONE,
    'il fuso predefinito è lo stesso nel server e nell’interfaccia', `${UI_TIMEZONE} / ${DEFAULT_TIMEZONE}`);

  const ui = uiDefaults('c', 'u', 'it');
  ok(ui.inAppEnabled === true && ui.emailEnabled === false,
    'i default dell’interfaccia coincidono con quelli della migrazione: in-app acceso, email SPENTA');
  ok(ui.remind7Days && ui.remind1Day && ui.remindDueDay && ui.remindOverdue,
    'e i quattro promemoria sono accesi, come dichiara la 0018');
  ok(ui.showTaskTitle === true, 'il titolo nel calendario esterno è mostrato per impostazione predefinita');

  ok(REMINDER_LOCAL_HOUR >= 6 && REMINDER_LOCAL_HOUR <= 10,
    'l’ora dei promemoria è mattutina e non notturna (§36)');

  ok(dedicatedCalendarName('Rossi SA') === 'AI-Swisse — Rossi SA',
    'il nome del calendario dedicato è quello dichiarato all’utente', dedicatedCalendarName('Rossi SA'));
  ok(dedicatedCalendarName('  Rossi   SA  ') === 'AI-Swisse — Rossi SA',
    'spazi di troppo non producono due calendari con nomi diversi');
}

// Il dizionario del server è completo nelle tre lingue.
{
  const chiavi = ['eventIntro', 'eventCompany', 'eventPriority', 'eventOpen', 'eventGenericTitle',
    'subjectAssigned', 'subjectDueSoon', 'subjectDueTomorrow', 'subjectDueToday', 'subjectOverdue',
    'subjectUnassigned', 'subjectSyncFailed', 'subjectReauth', 'bodyDeadline', 'bodyOpen', 'footerWhy'] as const;
  let mancanti = 0;
  for (const locale of SERVER_LOCALES) {
    for (const k of chiavi) {
      const v = st(locale, k);
      if (!v || v === k) mancanti++;
    }
  }
  ok(mancanti === 0,
    'i testi che il server manda fuori dal prodotto esistono in tutte e tre le lingue',
    `mancanti: ${mancanti}`);

  ok(formatDay('2026-08-31', 'it').includes('2026') && formatDay('2026-08-31', 'de') !== formatDay('2026-08-31', 'fr'),
    'le date nelle email sono scritte nella lingua di chi legge',
    `it=${formatDay('2026-08-31', 'it')} de=${formatDay('2026-08-31', 'de')} fr=${formatDay('2026-08-31', 'fr')}`);
  ok(formatDay('2026-08-31', 'it').includes('31'),
    '⚠️ e il giorno è quello giusto: una data di calendario si formatta in UTC, altrimenti a ovest di Greenwich comparirebbe il 30');
}

// `todayISO` è l'UNICA funzione che guarda l'orologio della macchina, ed è giusto:
// «oggi» è una domanda locale.
{
  const t1 = todayISO(new Date('2026-08-31T23:30:00'));
  ok(/^\d{4}-\d{2}-\d{2}$/.test(t1), 'todayISO produce una data di calendario', t1);
  ok(todayISO(new Date('2026-08-31T00:10:00')) === todayISO(new Date('2026-08-31T23:50:00')),
    'e non cambia fra l’inizio e la fine dello stesso giorno locale');
}

// ===========================================================================
// L'IDENTIFICATIVO DI CORRELAZIONE — l'unico dato di osservabilità che i due
// worker non avevano, e senza il quale due esecuzioni consecutive dello
// scheduler producono log indistinguibili.
//
// ⚠️ Il caso che conta è l'ULTIMO: quando la piattaforma non fornisce nulla,
// l'id generato dev'essere RICONOSCIBILE come tale. Un id inventato che si
// spaccia per quello del gateway manda a cercare per mezz'ora una riga che nei
// log della piattaforma non esiste.
// ===========================================================================
{
  const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n] ?? null });

  ok(correlationId(headers({ 'sb-request-id': 'abc-123' })) === 'abc-123',
    'l’identificativo della piattaforma viene usato così com’è');

  ok(correlationId(headers({ 'x-request-id': 'xyz' })) === 'xyz',
    'in mancanza, si accetta x-request-id');

  ok(correlationId(headers({ 'cf-ray': 'ray-9' })) === 'ray-9',
    'e in mancanza anche di quello, cf-ray');

  ok(correlationId(headers({ 'sb-request-id': 'primo', 'x-request-id': 'secondo' })) === 'primo',
    'con più intestazioni vince la più affidabile, non l’ultima letta');

  ok(correlationId(headers({ 'sb-request-id': '   ' })) !== '   '
    && correlationId(headers({ 'sb-request-id': '   ' })).startsWith('gen:'),
    'un’intestazione presente ma VUOTA non conta come identificativo');

  ok(correlationId(headers({ 'sb-request-id': '  spazi-attorno  ' })) === 'spazi-attorno',
    'gli spazi attorno vengono tolti');

  const generato = correlationId(headers({}));
  ok(generato.startsWith('gen:'),
    '⚠️ senza nessuna intestazione l’id è DICHIARATO come generato (prefisso gen:)',
    generato);
  ok(generato !== correlationId(headers({})),
    'e due esecuzioni senza intestazione non condividono lo stesso id');

  ok(CORRELATION_HEADERS.length === 3 && CORRELATION_HEADERS[0] === 'sb-request-id',
    'l’ordine delle intestazioni è dichiarato, non implicito nel codice');
}

// ===========================================================================
section('12 · La CONSEGNA: `deliverEmails` eseguita davvero (§44/§79/§144)');
// ===========================================================================
//
// ⚠️ PERCHÉ QUESTA SEZIONE ESISTE. Fino al 2026-08-03 il percorso di consegna
// non era eseguito da NESSUN test: la sezione 8 prova `buildReminderEmail`, che
// compone del testo, e si ferma lì. `deliverEmails` — la funzione che prenota la
// riga, compone il destinatario, chiama il provider e decide se un guasto è
// definitivo — non era mai stata eseguita, né qui né altrove. Un percorso che
// non ha mai girato non è «implementato e testato»: è scritto.
//
// Qui gira la funzione VERA, con un client Supabase finto e una `fetch` finta.
// La stessa scelta della sezione 8 di `test:validate`: l'ambiente è finto, il
// codice è quello che gira in produzione.
{
  // Simulatore minimo di PostgREST: sostiene esattamente le catene che
  // `deliverEmails` e `composeEmail` usano, e NIENTE di più. Una finzione che
  // sostiene più di ciò che serve nasconde le query sbagliate invece di
  // mostrarle.
  type Row = Record<string, unknown>;
  interface Scritto { tabella: string; id: unknown; patch: Row }

  function sbFinto(tabelle: Record<string, Row[]>, scritti: Scritto[]) {
    const from = (tabella: string) => {
      const filtri: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      let tetto = Number.POSITIVE_INFINITY;
      const righe = () => (tabelle[tabella] ?? []).filter((r) => filtri.every((f) => f(r)));
      const api = {
        select: () => api,
        eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return api; },
        in: (c: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[c])); return api; },
        lte: (c: string, v: string) => { filtri.push((r) => String(r[c]) <= v); return api; },
        order: () => api,
        limit: (n: number) => { tetto = n; return api; },
        update: (p: Row) => { patch = p; return api; },
        maybeSingle: () => Promise.resolve({ data: righe()[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          const colpite = righe().slice(0, tetto);
          if (patch) {
            for (const r of colpite) {
              Object.assign(r, patch);
              scritti.push({ tabella, id: r.id, patch: patch as Row });
            }
          }
          return Promise.resolve({ data: colpite, error: null }).then(res, rej);
        },
      };
      return api;
    };
    return { from } as unknown as NotifyDeps['sb'];
  }

  /** Una `fetch` che risponde ciò che le si dice e registra cosa ha ricevuto. */
  function fetchFinta(risposte: { status: number; body?: string; headers?: Record<string, string> }[]) {
    const viste: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    let i = 0;
    const impl = ((url: string, init: RequestInit) => {
      const r = risposte[Math.min(i, risposte.length - 1)];
      i++;
      viste.push({
        url: String(url),
        headers: (init.headers ?? {}) as Record<string, string>,
        body: JSON.parse(String(init.body ?? '{}')),
      });
      return Promise.resolve(new Response(r.body ?? '{"id":"resend-1"}', {
        status: r.status,
        headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
      }));
    }) as unknown as typeof fetch;
    return { impl, viste, chiamate: () => i };
  }

  const COMPANY = 'comp-1', USER = 'user-1', DELIVERY = 'del-1';

  /** Lo scenario nominale: una consegna in coda, con tutto al suo posto. */
  const scenario = (over: {
    profilo?: Row | null; notifica?: Row | null; prefs?: Row[]; consegna?: Row;
  } = {}) => ({
    notification_deliveries: [{
      id: DELIVERY, attempts: 0, status: 'pending', channel: 'email',
      // ⚠️ NEL PASSATO, e la prima stesura l'aveva messo nel futuro: la select
      // di `deliverEmails` filtra `next_attempt_at <= adesso`, non selezionava
      // nulla, e TRE asserzioni diventavano verdi perché non c'era niente da
      // toccare. Un verde ottenuto da una coda vuota non dice niente sul codice.
      next_attempt_at: '2020-01-01T00:00:00.000Z',
      notification_id: 'notif-1',
      notifications: over.notifica === undefined ? {
        company_id: COMPANY, user_id: USER, type: 'task_due_today',
        entity_type: 'task', entity_id: 'task-9',
        payload: { title: 'Trasmettere rendiconto IVA', dueDate: '2026-08-03', kind: 'd0' },
      } : over.notifica,
      ...over.consegna,
    }] as Row[],
    profiles: over.profilo === undefined
      ? [{ id: USER, email: 'destinatario.tecnico@ai-swisse.com' }]
      : (over.profilo ? [over.profilo] : []),
    companies: [{ id: COMPANY, legal_name: 'Tecnica Sagl' }],
    notification_preferences: over.prefs ?? [],
  });

  const provider = (impl: typeof fetch) =>
    createResendProvider({ apiKey: 're_chiave_finta', from: 'AI-Swisse <notifiche@ai-swisse.com>', fetchImpl: impl });

  const deps = (tabelle: Record<string, Row[]>, scritti: Scritto[], p: NotifyDeps['emailProvider']): NotifyDeps => ({
    sb: sbFinto(tabelle, scritti), appOrigin: 'https://app.ai-swisse.com', emailProvider: p,
  });

  const FUTURO = Date.now() + 60_000;

  // --- 12.1 Il caso nominale: la consegna parte davvero ---------------------
  {
    const t = scenario(), scritti: Scritto[] = [];
    const f = fetchFinta([{ status: 200, body: '{"id":"resend-abc"}' }]);
    const rep = await deliverEmails(deps(t, scritti, provider(f.impl)), FUTURO);

    ok(rep.attempted === 1 && rep.sent === 1 && rep.failed === 0 && rep.retried === 0,
      'una consegna in coda viene tentata e riesce', JSON.stringify(rep));
    ok(f.chiamate() === 1, 'il provider è stato chiamato UNA volta');
    ok(f.viste[0]?.url === 'https://api.resend.com/emails', 'verso l’endpoint del provider', f.viste[0]?.url);
    ok((f.viste[0]?.body.to as string[])?.[0] === 'destinatario.tecnico@ai-swisse.com',
      '⚠️ il destinatario esce da `profiles.email`, non da un valore scritto nel codice',
      JSON.stringify(f.viste[0]?.body.to));
    ok(f.viste[0]?.body.from === 'AI-Swisse <notifiche@ai-swisse.com>',
      'il mittente è quello configurato in NOTIFICATION_EMAIL_FROM');
    ok(String(f.viste[0]?.body.subject).includes('in scadenza oggi'),
      'l’oggetto è quello del tipo di notifica', String(f.viste[0]?.body.subject));
    ok(String(f.viste[0]?.body.text).includes('Tecnica Sagl')
      && String(f.viste[0]?.body.text).includes('Trasmettere rendiconto IVA')
      && String(f.viste[0]?.body.text).includes('https://app.ai-swisse.com/attivita/task-9'),
      'il corpo porta azienda, attività e il collegamento costruito dal SERVER');
    ok(f.viste[0]?.headers['Idempotency-Key'] === `delivery:${DELIVERY}`,
      '⚠️ la chiave di idempotenza è quella della CONSEGNA: è ciò che impedisce la seconda email quando la nostra richiesta si perde',
      f.viste[0]?.headers['Idempotency-Key']);

    const finale = t.notification_deliveries[0];
    ok(finale.status === 'sent' && finale.provider_message_id === 'resend-abc' && finale.error_code === null,
      'la riga si chiude come inviata, con l’identificativo del provider',
      JSON.stringify({ status: finale.status, id: finale.provider_message_id }));
    ok(scritti.some((s) => s.patch.status === 'sending' && s.patch.attempts === 1),
      '⚠️ il tentativo è REGISTRATO PRIMA dell’invio: se l’isolate muore, il peggio è un’email in meno, mai una in più');
  }

  // --- 12.2 Nessun provider: la coda non si tocca ---------------------------
  {
    const t = scenario(), scritti: Scritto[] = [];
    const rep = await deliverEmails(deps(t, scritti, null), FUTURO);
    ok(rep.attempted === 0 && rep.sent === 0,
      'senza provider configurato non parte niente — ed è la garanzia dichiarata in product-status, non una svista');
    ok(scritti.length === 0 && t.notification_deliveries[0].status === 'pending',
      '⚠️ e la riga in coda NON viene toccata: resta pending, non diventa «fallita»');
  }

  // --- 12.3 Senza indirizzo non si inventa un destinatario ------------------
  {
    const t = scenario({ profilo: null }), scritti: Scritto[] = [];
    const f = fetchFinta([{ status: 200 }]);
    const rep = await deliverEmails(deps(t, scritti, provider(f.impl)), FUTURO);
    ok(f.chiamate() === 0, '⚠️ profilo senza indirizzo: il provider non viene chiamato affatto');
    ok(t.notification_deliveries[0].status === 'cancelled'
      && t.notification_deliveries[0].error_code === 'NO_RECIPIENT',
      'e la consegna si chiude come ANNULLATA con la ragione, non come riuscita',
      String(t.notification_deliveries[0].error_code));
    ok(rep.sent === 0, 'e il report non conta un invio che non c’è stato');
  }

  // --- 12.4 La notifica non c'è più: annullata, non fallita -----------------
  {
    const t = scenario({ notifica: null }), scritti: Scritto[] = [];
    const f = fetchFinta([{ status: 200 }]);
    await deliverEmails(deps(t, scritti, provider(f.impl)), FUTURO);
    ok(f.chiamate() === 0 && t.notification_deliveries[0].error_code === 'NOTIFICATION_GONE',
      'una notifica sparita annulla la consegna: non è andato storto niente, e non si dice il contrario');
  }

  // --- 12.5 Un 4xx del provider è DEFINITIVO -------------------------------
  {
    const t = scenario(), scritti: Scritto[] = [];
    // 403 con dominio non verificato: il caso che si incontra davvero al primo
    // invio, se `NOTIFICATION_EMAIL_FROM` usa un dominio non registrato.
    const f = fetchFinta([{ status: 403, body: '{"message":"The domain is not verified"}' }]);
    const rep = await deliverEmails(deps(t, scritti, provider(f.impl)), FUTURO);
    ok(f.chiamate() === 1,
      '⚠️ un 4xx non si ritenta NEMMENO dentro il provider: ritentarlo non lo fa diventare valido',
      `chiamate: ${f.chiamate()}`);
    ok(rep.failed === 1 && rep.retried === 0, 'ed è contato come fallimento, non come ritentativo');
    ok(t.notification_deliveries[0].status === 'failed'
      && t.notification_deliveries[0].error_code === 'INVALID_RESPONSE',
      'la riga si chiude subito invece di occupare la coda per giorni',
      String(t.notification_deliveries[0].error_code));
  }

  // --- 12.6 Un 429 è transitorio: si ritenta ------------------------------
  {
    const t = scenario(), scritti: Scritto[] = [];
    const f = fetchFinta([{ status: 429, headers: { 'retry-after': '0' } }]);
    const rep = await deliverEmails(deps(t, scritti, provider(f.impl)), FUTURO);
    ok(f.chiamate() === 2, 'un 429 viene ritentato dentro il provider (due tentativi, come dichiarato)',
      `chiamate: ${f.chiamate()}`);
    ok(rep.retried === 1 && rep.failed === 0, 'e il report lo chiama ritentativo, non fallimento');
    ok(t.notification_deliveries[0].status === 'pending',
      '⚠️ la riga torna in coda: un limite di frequenza non è un indirizzo sbagliato');
  }

  // --- 12.7 I tentativi sono finiti ---------------------------------------
  {
    const t = scenario({ consegna: { attempts: EMAIL_MAX_ATTEMPTS - 1 } }), scritti: Scritto[] = [];
    const f = fetchFinta([{ status: 429, headers: { 'retry-after': '0' } }]);
    const rep = await deliverEmails(deps(t, scritti, provider(f.impl)), FUTURO);
    ok(rep.failed === 1 && t.notification_deliveries[0].status === 'failed',
      'all’ultimo tentativo anche un guasto transitorio chiude la consegna: non si ritenta per sempre');
  }

  // --- 12.8 La lingua di chi riceve, non quella del server -----------------
  {
    const t = scenario({
      prefs: [{
        company_id: COMPANY, user_id: USER, in_app_enabled: true, email_enabled: true,
        remind_7_days: true, remind_1_day: true, remind_due_day: true, remind_overdue: true,
        timezone: 'Europe/Zurich', locale: 'de', show_task_title: true,
      }],
    });
    const f = fetchFinta([{ status: 200 }]);
    await deliverEmails(deps(t, [], provider(f.impl)), FUTURO);
    ok(String(f.viste[0]?.body.subject).includes('Frist heute'),
      '⚠️ l’oggetto arriva in TEDESCO se la preferenza dice de: la lingua è quella registrata, non quella del server',
      String(f.viste[0]?.body.subject));
    ok(String(f.viste[0]?.body.text).includes('Sie erhalten diese Nachricht'),
      'e anche la riga che spiega perché il messaggio arriva');
  }
}

// ===========================================================================
console.log(`\n${B}Riepilogo${X}  ${G}${pass} superati${X}${fail ? `  ${R}${fail} falliti${X}` : ''}\n`);
process.exit(fail ? 1 : 0);
