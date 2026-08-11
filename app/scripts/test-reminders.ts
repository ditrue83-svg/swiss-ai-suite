// ============================================================================
// AI-Swisse — Il MOTORE dei promemoria, ESEGUITO contro un database vero.
//   npm run test:reminders
//
// ⚠️ QUALE database dipende da `.env.test`, e la differenza va detta invece che
// lasciata intendere: in locale è la PRODUZIONE (regola di casa), nella CI è un
// database EFFIMERO appena migrato. Le asserzioni qui sotto non nominano nessuno
// dei due — l'host lo stampa l'intestazione, prima di ogni esecuzione. Una riga
// verde che dichiara «contro la produzione» mentre gira contro un database
// vuoto sarebbe un'etichetta che mente.
//
// ⚠️ PERCHÉ ESISTE. `notifications-worker` è in esercizio dal 2026-07-27, il suo
// scheduler riesce ogni quindici minuti, e in produzione `notifications` è a
// ZERO righe. Fino all'11 agosto 2026 quello zero era una DEDUZIONE dal codice:
// nessuno aveva mai visto `generateReminders` produrre un promemoria — non un
// test, che non la importava nemmeno, e non la produzione.
//
// Lo zero, misurato, è CORRETTO: le quattro attività vere scadono a settembre,
// e la finestra dei promemoria arriva a otto giorni. Ma «corretto» e «rotto»
// avevano lo stesso aspetto, ed è la ragione per cui questo file esiste: qui il
// motore gira davvero, e la riga o compare o non compare.
//
// ⚠️⚠️ LA PRUDENZA CHE QUESTO FILE DEVE AVERE. `generateReminders` NON filtra
// per azienda: legge le attività di TUTTI dentro la finestra. Eseguirla con
// l'istante di adesso significherebbe poter scrivere promemoria VERI a persone
// VERE come effetto collaterale di un test. Per questo:
//   · l'istante è spostato nel 2028, e la scadenza di prova con lui;
//   · PRIMA di eseguire si conta che cosa c'è in quella finestra, e se c'è
//     qualcosa che non è nostro il test si FERMA invece di scrivere;
//   · l'azienda è usa-e-getta, e una pulizia incompleta fa fallire il test.
//
// Le tre precauzioni valgono anche quando il database è effimero: una di esse
// che si accendesse solo «in produzione» sarebbe provata solo dove non serve.
// ============================================================================
import WebSocket from 'ws';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { generateReminders } from '../supabase/functions/_shared/calendar/notify.ts';
import type { NotifyDeps } from '../supabase/functions/_shared/calendar/notify.ts';

if (!globalThis.WebSocket) (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;

const DB_URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DB_URL || !SERVICE) {
  console.error('Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.test');
  process.exit(2);
}

const admin = createClient(DB_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${name}`); }
  else { fail++; console.log(`  ${R}✗ ${name}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};

const creati: { utenti: string[]; aziende: string[] } = { utenti: [], aziende: [] };

// L'istante e la scadenza: sette giorni esatti, in un anno in cui il database
// di produzione non ha nulla. `dueReminders` vuole che siano passate le otto
// locali, e alle 08:00 UTC a Zurigo sono le dieci.
const ISTANTE = new Date('2028-06-08T08:00:00.000Z');
const SCADENZA = '2028-06-15';
// La stessa che calcola `reminderWindow(ISTANTE)`: da -30 giorni a +8.
const FINESTRA = { da: '2028-05-09', a: '2028-06-16' };

async function main() {
  console.log(`${B}AI-Swisse — Il motore dei promemoria, eseguito${X}`);
  // ⚠️ L'HOST si stampa, e non è un vezzo: «ho lanciato test:reminders» e «ho
  // lanciato test:reminders contro la produzione» sono due frasi diverse. È la
  // stessa ragione per cui lo stampa `run-test-suite` prima di ogni gruppo che
  // scrive. L'host non è un segreto: sta nel bundle pubblicato come
  // VITE_SUPABASE_URL.
  console.log(`${DIM}database: ${new URL(DB_URL!).host}${X}`);
  console.log(`${DIM}istante simulato: ${ISTANTE.toISOString()} · finestra ${FINESTRA.da} → ${FINESTRA.a}${X}\n`);

  // ---- 0. Il cancello: la finestra è nostra? ------------------------------
  const { data: gia, error: giaErr } = await admin.from('tasks')
    .select('id').neq('status', 'completed').is('archived_at', null)
    .gte('due_date', FINESTRA.da).lte('due_date', FINESTRA.a);
  if (giaErr) {
    console.error(`${R}Non ho potuto contare le attività nella finestra: ${giaErr.message}${X}`);
    console.error(`${DIM}Senza quel conteggio non si esegue: il motore scriverebbe alla cieca.${X}`);
    process.exit(2);
  }
  if ((gia ?? []).length) {
    console.error(`${R}⚠️ La finestra del 2028 contiene già ${gia!.length} attività che non sono nostre.${X}`);
    console.error(`${DIM}Il motore scriverebbe promemoria a persone reali. Mi fermo: sposta la finestra`);
    console.error(`  di questo file (ISTANTE e SCADENZA) su un intervallo vuoto, e rileggi il perché in cima.${X}`);
    process.exit(2);
  }
  check('la finestra scelta è VUOTA su questo database: nessuna attività che non sia nostra verrà toccata', true);

  // ---- 1. L'azienda usa-e-getta -------------------------------------------
  const email = `promemoria+${Date.now()}@example.com`;
  const { data: u, error: uErr } = await admin.auth.admin.createUser({
    email, password: 'Test1234!', email_confirm: true,
    user_metadata: { first_name: 'Prova', last_name: 'Promemoria' },
  });
  if (uErr || !u?.user) throw new Error(`utente: ${uErr?.message}`);
  creati.utenti.push(u.user.id);

  const { data: c, error: cErr } = await admin.from('companies')
    .insert({ legal_name: `Promemoria ${Date.now()}`, canton: 'Ticino' }).select('id').single();
  if (cErr) throw new Error(`azienda: ${cErr.message}`);
  creati.aziende.push(c.id);
  const { error: mErr } = await admin.from('company_members')
    .insert({ company_id: c.id, user_id: u.user.id, role: 'owner' });
  if (mErr) throw new Error(`appartenenza: ${mErr.message}`);

  const { data: t, error: tErr } = await admin.from('tasks').insert({
    company_id: c.id, created_by: u.user.id, title: 'Attività di prova — promemoria',
    due_date: SCADENZA, priority: 'medium', status: 'open', source: 'manual',
    assignee_user_id: u.user.id,
  }).select('id').single();
  if (tErr) throw new Error(`attività: ${tErr.message}`);

  // ---- 2. Il motore gira ---------------------------------------------------
  const deps = {
    sb: admin as unknown as NotifyDeps['sb'],
    appOrigin: 'https://app.ai-swisse.com',
    emailProvider: null,
  };
  const primo = await generateReminders(deps, ISTANTE, Date.now() + 60_000);

  check('⚠️ il motore ha letto UNA attività, la nostra: la finestra è rimasta nostra anche durante l’esecuzione',
    primo.tasksScanned === 1,
    `lette: ${primo.tasksScanned} — se è più di una qualcosa è entrato nella finestra fra il cancello e adesso`);

  // ⚠️ L'etichetta NON nomina la produzione, e non è una sfumatura: questa
  // suite gira anche nella CI, dove `.env.test` punta a un database EFFIMERO.
  // Una riga verde che dichiara «contro la produzione» mentre gira contro un
  // database vuoto è un'etichetta che mente, ed è la cosa che questo
  // repository combatte in ogni suo controllo. Quale database sia lo dice
  // l'intestazione, che stampa l'host prima di ogni esecuzione.
  check('⚠️⚠️ IL MOTORE DEI PROMEMORIA GENERA — la funzione che dal 2026-07-27 non aveva mai prodotto una riga',
    primo.created === 1, JSON.stringify(primo));

  const { data: nate, error: nateErr } = await admin.from('notifications')
    .select('id, user_id, company_id, type, entity_type, dedupe_key, payload, read_at')
    .eq('entity_id', t.id);
  const promemoria = (nate ?? []).filter((r) => r.dedupe_key !== null);
  const daEvento = (nate ?? []).filter((r) => r.dedupe_key === null);

  // ⚠️ QUESTA ASSERZIONE È NATA SBAGLIATA, e il database l'ha corretta alla
  // prima esecuzione: pretendeva UNA riga e ne ha trovate DUE. La seconda non è
  // un difetto — è l'altra famiglia di notifiche della 0018, quella generata da
  // un EVENTO: l'attività nasce già assegnata, e un trigger scrive
  // `task_assigned` con `dedupe_key` nullo. Le due famiglie hanno bisogni
  // opposti (una si ritenta senza duplicare, l'altra no) e qui si vedono
  // convivere sul database vero, che è più di quanto l'asserzione chiedesse.
  check('le DUE famiglie della 0018 convivono: un promemoria con la chiave, e un avviso da evento senza',
    !nateErr && promemoria.length === 1 && daEvento.length === 1,
    nateErr?.message ?? `con chiave: ${promemoria.length}, da evento: ${daEvento.length}`);

  check('…e l’avviso da evento è `task_assigned`, scritto dal TRIGGER quando l’attività nasce già assegnata',
    daEvento[0]?.type === 'task_assigned', JSON.stringify(daEvento[0]));

  const n = promemoria[0];
  check('il promemoria è del responsabile, nella sua azienda, con la chiave dei sette giorni',
    n?.user_id === u.user.id && n?.company_id === c.id
    && n?.dedupe_key === `task:${t.id}:d7` && n?.type === 'task_due_soon'
    && n?.entity_type === 'task',
    JSON.stringify(n));

  check('nasce NON letto: è un fatto nuovo, non una riga già archiviata', n?.read_at === null);

  check('il payload porta il titolo, che è ciò con cui si compone la frase',
    (n?.payload as { title?: string })?.title === 'Attività di prova — promemoria',
    JSON.stringify(n?.payload));

  check('nessuna email accodata e nessun avviso ai titolari: il provider non è configurato e il report lo DICHIARA (§79)',
    primo.emailsQueued === 0 && primo.unassignedAlerts === 0 && primo.skippedNoTimezone === 0,
    JSON.stringify(primo));

  // ---- 3. L'idempotenza, contro il vincolo VERO ----------------------------
  const secondo = await generateReminders(deps, ISTANTE, Date.now() + 60_000);
  const { data: dopo } = await admin.from('notifications')
    .select('id, dedupe_key').eq('entity_id', t.id);
  check('⚠️ eseguito due volte non raddoppia: a impedirlo è il VINCOLO UNICO del database vero, non un controllo scritto nel codice',
    secondo.created === 0 && (dopo ?? []).filter((r) => r.dedupe_key !== null).length === 1,
    `secondo giro: ${secondo.created} creati · promemoria totali: ${(dopo ?? []).filter((r) => r.dedupe_key !== null).length}`);

  // ---- 4. E fuori dalla finestra, niente ----------------------------------
  const { error: spostaErr } = await admin.from('tasks')
    .update({ due_date: '2028-09-30' }).eq('id', t.id);
  if (spostaErr) throw new Error(`spostamento: ${spostaErr.message}`);
  const terzo = await generateReminders(deps, ISTANTE, Date.now() + 60_000);
  check('⚠️ spostata la scadenza FUORI dalla finestra, il motore non legge più niente e non scrive niente — è esattamente lo stato della produzione oggi',
    terzo.tasksScanned === 0 && terzo.created === 0, JSON.stringify(terzo));
}

/**
 * Pulizia.
 *
 * ⚠️ L'esito delle cancellazioni si CONTROLLA. `supabase-js` non solleva: torna
 * `{ error }`. Ignorarlo è già costato due aziende di prova rimaste nel
 * database di produzione dopo `test:inbox`. Una pulizia incompleta fa FALLIRE
 * il test — e la notifica scritta qui sparisce con l'azienda, in cascata.
 */
async function pulizia() {
  const problemi: string[] = [];
  for (const id of creati.aziende) {
    const { error } = await admin.from('companies').delete().eq('id', id);
    if (error) problemi.push(`azienda ${id}: ${error.message}`);
  }
  for (const id of creati.utenti) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) problemi.push(`utente ${id}: ${error.message}`);
  }
  // ⚠️ Non basta che la cancellazione non dia errore: si RILEGGE. La cascata
  // che porta via le notifiche è una promessa dello schema, e una promessa
  // verificata è l'unica che vale.
  for (const id of creati.aziende) {
    const { data, error } = await admin.from('notifications').select('id').eq('company_id', id);
    if (error) problemi.push(`rilettura notifiche ${id}: ${error.message}`);
    else if ((data ?? []).length) problemi.push(`restano ${data!.length} notifiche dell'azienda ${id}`);
  }
  if (problemi.length) {
    console.log(`\n${R}Pulizia INCOMPLETA — restano dati di prova nella PRODUZIONE:${X}`);
    for (const p of problemi) console.log(`  ${R}·${X} ${p}`);
    fail += problemi.length;
  } else if (creati.aziende.length) {
    console.log(`\n  ${DIM}pulizia completa: azienda, utente, attività e notifica rimossi (verificato rileggendo).${X}`);
  }
}

try {
  await main();
} catch (e) {
  fail++;
  console.error(`\n${R}Interrotto:${X} ${(e as Error).message}`);
} finally {
  await pulizia();
  console.log(`\n${B}Riepilogo${X}  ${G}${pass} superati${X}${fail ? `  ${R}${fail} falliti${X}` : ''}\n`);
  process.exit(fail ? 1 : 0);
}
