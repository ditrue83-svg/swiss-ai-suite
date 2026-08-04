// ============================================================================
// Manutenzione catalogo (S4) — health check di `subsidy_programs`.
// Legge la tabella REALE e verifica INTEGRITÀ (campi, id validi, coerenza) e
// FRESCHEZZA (data_status 'recheck' + last_checked_at oltre soglia). Sola lettura.
//   node --env-file=.env.test scripts/subsidy-catalog-health.mjs
//   npm run subsidy:health   [-- --stale-days=120] [-- --review-stale-days=30]
//   npm run subsidy:health -- --self-test     ← prova il giudizio sulla coda
//
// Exit code:  0 = tutto valido e aggiornato · 1 = valido ma qualcosa da
//             ricontrollare · 2 = errori di integrità (dati malformati).
//
// ⚠️⚠️ E DA OGGI GUARDA ANCHE LA CODA DI REVISIONE, che è la cosa che non
// guardava. Il 2026-07-31 questo comando usciva 0 scrivendo «catalogo valido e
// aggiornato» mentre in `subsidy_catalog_reviews` sette schede aspettavano il
// giudizio di una persona dal 2026-07-30. Non era un difetto della suite —
// faceva esattamente ciò che dichiarava: freschezza e integrità. Era un difetto
// di COPERTURA, che è peggio, perché chi legge l'esito non ha modo di sapere
// che cosa l'esito non guarda. Su un catalogo con cui il prodotto dice a
// un'impresa se un incentivo la riguarda, del lavoro in attesa di una persona
// non può restare senza nome.
//
// LA REGOLA SCELTA, e perché non è «coda piena = rosso». Una revisione in coda
// NON è un errore di integrità: il dato è valido, è la sua conferma che manca.
// Farla diventare subito un fallimento insegnerebbe a ignorare quel rosso, che
// è il modo più sicuro di rendere inutile anche il rosso vero. Quindi:
//   · finché è dentro le soglie → la coda viene NOMINATA nel riepilogo e nella
//     riga di esito, e l'esito non può più dire «valido e aggiornato» e basta;
//   · oltre le soglie → diventa un errore di integrità, perché una coda che non
//     si smaltisce mai non è un arretrato: è un pezzo di catalogo che nessuno
//     sta più verificando.
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
// ⚠️ Servono all'autoverifica, che legge gli stati ammessi dalla MIGRAZIONE
// invece di ricopiarli: due copie di un elenco divergono in silenzio.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

// Insiemi ammessi (allineati a TIPI_PROGETTO/SETTORI/SupportType e alla 0007).
const PROJECT_TYPES = ['innovazione', 'energia', 'digitalizzazione', 'formazione', 'mobilita', 'assunzioni', 'export', 'edilizia'];
const SECTORS = ['industria', 'costruzioni', 'commercio', 'servizi', 'ict', 'turismo', 'sanita', 'trasporti'];
const SUPPORT_TYPES = ['grant', 'tax_relief', 'guarantee', 'loan', 'reimbursement', 'advisory', 'other'];
const DATA_STATUS = ['verified', 'recheck', 'demo'];
const AVAILABILITY = ['available', 'suspended'];
// Lingue in cui l'interfaccia esiste: i contenuti dovrebbero seguirla.
const CONTENT_LOCALES = ['de', 'fr'];
// Campi che, se non tradotti, lasciano l'utente davanti a testo italiano.
const TRANSLATABLE = ['name', 'authority', 'contribution_description', 'application_window', 'documents_required'];
const ANSWERS = ['si', 'no'];

// La sospensione dipende da condizioni che cambiano su base ANNUALE (per
// L-Rilocc, il tasso di disoccupazione dell'anno precedente): va ricontrollata
// molto più spesso del contenuto del programma, che può restare valido a lungo.
const AVAILABILITY_STALE_DAYS = 120;

const staleArg = process.argv.find((a) => a.startsWith('--stale-days='));
const STALE_DAYS = staleArg ? Math.max(1, parseInt(staleArg.split('=')[1], 10) || 180) : 180;

// ---------------------------------------------------------------------------
// LE SOGLIE DELLA CODA DI REVISIONE — e la ragione di ciascun numero, perché
// una soglia senza motivo è un numero che il primo che passa cambia.
//
// 30 GIORNI. Il contenuto `verified` di un programma si considera fresco per
// 180 giorni; lo stato di sospensione per 120. Una revisione in coda è una cosa
// diversa da entrambe: non è contenuto vecchio, è il SEGNALE che il contenuto
// potrebbe essere cambiato — la fonte ufficiale è cambiata e nessuno ha ancora
// stabilito se quel che diciamo a un'impresa sia ancora vero. Un segnale vale
// più di una scadenza, quindi la soglia sta un ordine di grandezza sotto quella
// del contenuto. Trenta giorni significa «questa coda viene guardata almeno una
// volta al mese»: una coda che non si guarda in un mese non si guarda.
// Le finestre di domanda dei programmi svizzeri si misurano in mesi o in anni,
// quindi un mese di ritardo su un cambiamento a rischio basso non fa perdere un
// bando; due mesi possono farlo, ed è per questo che la soglia non è 60.
const reviewStaleArg = process.argv.find((a) => a.startsWith('--review-stale-days='));
const REVIEW_STALE_DAYS = reviewStaleArg ? Math.max(1, parseInt(reviewStaleArg.split('=')[1], 10) || 30) : 30;

// 25 IN CODA. Il catalogo ha 7 programmi. Una coda tre volte più grande del
// catalogo non è un arretrato di lavoro: vuol dire che il rilevatore di
// cambiamenti sta segnalando ripetutamente le stesse cose e nessuno le legge —
// cioè che il meccanismo si è staccato dalla persona che dovrebbe servire.
const maxPendingArg = process.argv.find((a) => a.startsWith('--max-pending-reviews='));
const MAX_PENDING_REVIEWS = maxPendingArg ? Math.max(1, parseInt(maxPendingArg.split('=')[1], 10) || 25) : 25;

/**
 * Il giudizio sulla coda di revisione. Funzione PURA, e per la ragione di
 * sempre: è una decisione, e una decisione va provata sui casi che devono
 * farla scattare senza dover sporcare il catalogo vero per vederla reagire.
 *
 * Ritorna `{ pending, oldestDays, nominata, errori }`:
 *   · `nominata`  la riga che DEVE comparire nel riepilogo e nell'esito;
 *   · `errori`    i messaggi da contare come errori di integrità (vuoto se la
 *                 coda è dentro le soglie).
 */
export function giudicaCodaRevisioni(revisioni, oggi, soglie = {}) {
  const staleDays = soglie.staleDays ?? REVIEW_STALE_DAYS;
  const maxPending = soglie.maxPending ?? MAX_PENDING_REVIEWS;

  const pending = revisioni.filter((r) => r.status === 'pending');
  if (pending.length === 0) {
    return { pending: 0, oldestDays: null, nominata: 'Revisioni in attesa di una persona: nessuna', errori: [] };
  }

  const eta = pending
    .map((r) => Math.floor((oggi.getTime() - new Date(r.created_at).getTime()) / 86_400_000))
    .filter((n) => Number.isFinite(n));
  const oldestDays = eta.length ? Math.max(...eta) : null;

  const errori = [];
  if (oldestDays != null && oldestDays > staleDays) {
    errori.push(`coda di revisione ferma: la più vecchia aspetta da ${oldestDays} giorni (soglia ${staleDays}). `
      + 'Una revisione che nessuno guarda è una parte di catalogo che nessuno sta più verificando.');
  }
  if (pending.length > maxPending) {
    errori.push(`coda di revisione fuori scala: ${pending.length} in attesa (soglia ${maxPending}). `
      + 'Il rilevatore produce più di quanto una persona consumi.');
  }

  const eta_txt = oldestDays == null ? 'età ignota' : `la più vecchia da ${oldestDays}g`;
  return {
    pending: pending.length,
    oldestDays,
    nominata: `Revisioni in attesa di una persona: ${pending.length} (${eta_txt}, soglie: ${staleDays}g · ${maxPending} in coda)`,
    errori,
  };
}

// ---- Autoverifica del giudizio -------------------------------------------
const OGGI_FINTO = new Date('2026-08-01T00:00:00Z');

// ⚠️⚠️ LE SOGLIE DEL TEST SONO FISSATE QUI, E NON SI EREDITANO DA `process.argv`.
// Fino al 2026-08-05 i casi chiamavano `giudicaCodaRevisioni(revisioni, OGGI)`
// senza terzo argomento, quindi la funzione ripiegava sui valori globali — che
// arrivano dalla riga di comando. Conseguenza misurata:
//   npm run subsidy:health:self-test -- --review-stale-days=5
// faceva fallire il caso «esattamente 30 giorni» e stampava «il giudizio sulla
// coda NON è affidabile», che è FALSO: il giudizio era corretto, erano i casi ad
// assumere 30. Un'autoverifica che un flag rende rossa insegna a non fidarsi dei
// suoi rossi, ed è un difetto tanto quanto un verde falso — solo nell'altra
// direzione. Un caso deve dire per intero le condizioni che assume.
const SOGLIE_DEL_TEST = { staleDays: 30, maxPending: 25 };

const rev = (giorniFa, status = 'pending') => ({
  status,
  created_at: new Date(OGGI_FINTO.getTime() - giorniFa * 86_400_000).toISOString(),
});

/**
 * Gli stati ammessi, LETTI DALLA MIGRAZIONE invece che ricopiati.
 *
 * ⚠️⚠️ PERCHÉ SI LEGGE L'SQL. Il caso «le revisioni già evase non contano» usava
 * `'approved'`, che **non esiste**: l'enum è `pending · accepted · rejected ·
 * ignored`. Sul comportamento non cambiava nulla, perché il filtro è
 * `=== 'pending'` — ed è proprio questo il punto: nulla avrebbe MAI reso rossa
 * quella divergenza, e il test documentava uno stato inventato a chi lo legge
 * per sapere quali sono. È la stessa ragione per cui `test:crm-unit` legge la
 * 0026 invece di ricopiarne l'elenco dei domini.
 */
function statiAmmessi() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir).sort()) {
    const m = /create type public\.subsidy_review_status as enum \(([^)]*)\)/
      .exec(readFileSync(join(dir, f), 'utf8'));
    if (m) return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  }
  return null;
}

const CASI = [
  {
    name: 'coda vuota → nessun errore, ma la riga esiste lo stesso',
    revisioni: [], errori: 0, contiene: 'nessuna',
  },
  {
    // ⚠️ IL CASO REALE: sette revisioni del 2026-07-30, lette il 2026-08-01.
    name: 'le SETTE del 2026-07-30 → nominate, e non sono un errore (2 giorni)',
    revisioni: Array.from({ length: 7 }, () => rev(2)), errori: 0, contiene: '7',
  },
  {
    name: 'una revisione oltre i 30 giorni → errore di integrità',
    revisioni: [rev(31)], errori: 1,
  },
  {
    name: 'esattamente 30 giorni → ancora dentro la soglia',
    revisioni: [rev(30)], errori: 0,
  },
  {
    name: 'oltre 25 in coda → errore, anche se tutte recenti',
    revisioni: Array.from({ length: 26 }, () => rev(1)), errori: 1,
  },
  {
    name: 'vecchie E troppe → due errori distinti, non uno che copre l\'altro',
    revisioni: Array.from({ length: 26 }, () => rev(40)), errori: 2,
  },
  {
    // ⚠️ TUTTI E TRE gli stati evasi veri, non uno inventato. Qui c'era
    // `'approved'`, che non esiste nell'enum, e `accepted` e `ignored` — i due
    // che si incontrano davvero — non erano provati da nessuno.
    name: 'le revisioni già evase non contano (accepted · rejected · ignored)',
    revisioni: [rev(400, 'accepted'), rev(400, 'rejected'), rev(400, 'ignored')],
    errori: 0, contiene: 'nessuna',
  },
];

function selfTest() {
  console.log('\nAutoverifica del giudizio sulla coda di revisione\n');
  let bad = 0;

  // ---- Prima: i casi parlano di stati che ESISTONO? -----------------------
  // ⚠️ Se questo controllo non si può eseguire, NON si prosegue come se fosse
  // passato: «non ho potuto guardare» e «va bene» sono la stessa frase solo per
  // chi non vuole saperlo. È la regola che questo stesso file applica alla
  // lettura della coda.
  const ammessi = statiAmmessi();
  if (!ammessi) {
    console.error('  ✗ enum `subsidy_review_status` non trovata nelle migrazioni:');
    console.error('      gli stati usati dai casi non sono verificabili, e questo esito non vale.');
    bad++;
  } else {
    const usati = [...new Set(CASI.flatMap((c) => c.revisioni.map((r) => r.status)))];
    const inventati = usati.filter((s) => !ammessi.includes(s));
    const evasiVeri = ammessi.filter((s) => s !== 'pending');
    const scoperti = evasiVeri.filter((s) => !usati.includes(s));
    if (inventati.length) {
      console.log(`  ✗ i casi usano stati che non esistono: ${inventati.join(', ')} (ammessi: ${ammessi.join(' · ')})`);
      bad++;
    } else if (scoperti.length) {
      console.log(`  ✗ stati evasi mai provati: ${scoperti.join(', ')}`);
      bad++;
    } else {
      console.log(`  ✓ gli stati dei casi sono quelli della migrazione (${ammessi.join(' · ')})`);
    }
  }

  for (const c of CASI) {
    // ⚠️ Le soglie si PASSANO: vedi `SOGLIE_DEL_TEST`. Ereditarle da `argv`
    // rendeva l'esito di questa autoverifica dipendente da un flag.
    const r = giudicaCodaRevisioni(c.revisioni, OGGI_FINTO, SOGLIE_DEL_TEST);
    const problemi = [];
    if (r.errori.length !== c.errori) problemi.push(`attesi ${c.errori} errori, trovati ${r.errori.length}`);
    if (c.contiene && !r.nominata.includes(c.contiene)) problemi.push(`la riga non nomina «${c.contiene}»: «${r.nominata}»`);
    if (problemi.length) bad++;
    console.log(`  ${problemi.length ? '✗' : '✓'} ${c.name}`);
    for (const p of problemi) console.log(`      ${p}`);
  }
  if (bad) { console.error(`\n${bad} casi falliti: il giudizio sulla coda NON è affidabile.\n`); return false; }
  console.log(`\nTutti i ${CASI.length} casi superati.\n`);
  return true;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
}

const { SUPABASE_URL: U, SUPABASE_SERVICE_ROLE_KEY: S } = process.env;
if (!U || !S) { console.error('Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (usa --env-file=.env.test).'); process.exit(2); }
const admin = createClient(U, S, { auth: { persistSession: false, autoRefreshToken: false } });

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isArr = (v) => Array.isArray(v);
const daysBetween = (fromISO, to) => {
  const d = new Date(fromISO + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((to.getTime() - d.getTime()) / 86_400_000);
};

// Controlli di integrità su una riga. Ritorna array di messaggi di errore.
function lint(p) {
  const errs = [];
  const need = (cond, msg) => { if (!cond) errs.push(msg); };

  for (const f of ['id', 'name', 'authority', 'support_type', 'contribution_description', 'application_window', 'official_source_url', 'source_title'])
    need(isStr(p[f]), `campo obbligatorio mancante/vuoto: ${f}`);
  need(SUPPORT_TYPES.includes(p.support_type), `support_type non valido: ${p.support_type}`);
  need(DATA_STATUS.includes(p.data_status), `data_status non valido: ${p.data_status}`);
  need(isStr(p.official_source_url) && /^https?:\/\//.test(p.official_source_url), `official_source_url non è un URL http(s): ${p.official_source_url}`);

  need(isArr(p.geography) && p.geography.length > 0 && p.geography.every(isStr), 'geography vuota o malformata');
  need(isArr(p.target_sectors) && p.target_sectors.length > 0, 'target_sectors vuoto o malformato');
  if (isArr(p.target_sectors)) for (const s of p.target_sectors) need(s === 'ALL' || SECTORS.includes(s), `target_sectors: settore non valido '${s}'`);
  need(isArr(p.project_types) && p.project_types.length > 0, 'project_types vuoto o malformato');
  if (isArr(p.project_types)) for (const t of p.project_types) need(PROJECT_TYPES.includes(t), `project_types: tipo non valido '${t}'`);

  need(Number.isFinite(p.company_size_min) && p.company_size_min >= 0, 'company_size_min non valido');
  need(Number.isFinite(p.company_size_max) && p.company_size_max >= 0, 'company_size_max non valido');
  if (Number.isFinite(p.company_size_min) && Number.isFinite(p.company_size_max)) need(p.company_size_min <= p.company_size_max, `company_size_min (${p.company_size_min}) > max (${p.company_size_max})`);

  need(typeof p.must_apply_before_start === 'boolean', 'must_apply_before_start non booleano');

  // 0011 — disponibilità. Una sospensione senza motivo o senza fonte non è
  // verificabile dall'utente: vale come errore di integrità, non come nota.
  need(AVAILABILITY.includes(p.availability), `availability non valida: ${p.availability}`);
  if (p.availability === 'suspended') {
    need(isStr(p.availability_note), 'programma sospeso senza availability_note: il motivo va dichiarato');
    need(isStr(p.availability_source_url) && /^https?:\/\//.test(p.availability_source_url),
      'programma sospeso senza fonte verificabile (availability_source_url)');
    need(isStr(p.availability_checked_at), 'programma sospeso senza availability_checked_at');
  }

  const reqIds = new Set();
  need(isArr(p.requirements), 'requirements non è un array');
  if (isArr(p.requirements)) for (const [i, r] of p.requirements.entries()) {
    need(r && isStr(r.id) && isStr(r.text) && isStr(r.question) && typeof r.hard === 'boolean', `requirements[${i}] malformato`);
    if (r && isStr(r.id)) { need(!reqIds.has(r.id), `requirements: id duplicato '${r.id}'`); reqIds.add(r.id); }
  }
  need(isArr(p.exclusions), 'exclusions non è un array');
  if (isArr(p.exclusions)) for (const [i, x] of p.exclusions.entries()) {
    need(x && isStr(x.id) && isStr(x.text), `exclusions[${i}] malformato`);
    if (x && x.evaluable) {
      need(isStr(x.question), `exclusions[${i}] valutabile senza question`);
      need(ANSWERS.includes(x.triggeringAnswer), `exclusions[${i}] triggeringAnswer non valido: ${x.triggeringAnswer}`);
    }
  }
  return errs;
}

const run = async () => {
  const { data, error } = await admin.from('subsidy_programs').select('*').order('data_status', { ascending: true }).order('id', { ascending: true });
  if (error) { console.error('Lettura fallita:', error.message); process.exit(2); }
  const rows = data ?? [];
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);

  console.log(`\nCatalogo subsidy_programs — health check (${todayISO}, soglia freschezza ${STALE_DAYS}g)\n`);

  const integrityIssues = [];
  const toRecheck = [];
  const warnings = [];
  const byStatus = { verified: 0, recheck: 0, demo: 0, other: 0 };
  let activeCount = 0;
  let suspendedCount = 0;

  for (const p of rows) {
    byStatus[DATA_STATUS.includes(p.data_status) ? p.data_status : 'other']++;
    if (p.active) activeCount++;

    const errs = lint(p);
    const age = isStr(p.last_checked_at) ? daysBetween(p.last_checked_at, today) : null;
    const ageTxt = age == null ? 'mai' : `${age}g`;

    // Freschezza: recheck sempre; verified se oltre soglia; demo/senza data sempre.
    const stale = p.data_status === 'recheck' || p.data_status === 'demo' || age == null || (p.data_status === 'verified' && age > STALE_DAYS);
    const reason = p.data_status === 'recheck' ? 'recheck' : p.data_status === 'demo' ? 'demo' : age == null ? 'mai verificato' : `verified, ${age}g > ${STALE_DAYS}g`;

    if (p.must_apply_before_start === true && !isStr(p.must_apply_before_start_text))
      warnings.push(`${p.id}: must_apply_before_start=true ma manca must_apply_before_start_text`);
    if (p.active === false) warnings.push(`${p.id}: NON attivo (nascosto agli utenti)`);

    // 0011 — un programma sospeso non è un errore: è un fatto da tenere sotto
    // controllo, perché dipende da una condizione che cambia ogni anno.
    if (p.availability === 'suspended') {
      suspendedCount++;
      const availAge = isStr(p.availability_checked_at) ? daysBetween(p.availability_checked_at, today) : null;
      warnings.push(`${p.id}: SOSPESO — non concedibile (stato verificato ${availAge == null ? 'mai' : `${availAge}g fa`})`);
      if (availAge == null || availAge > AVAILABILITY_STALE_DAYS)
        toRecheck.push(`${p.id} (stato di sospensione da riverificare: ${availAge == null ? 'mai controllato' : `${availAge}g > ${AVAILABILITY_STALE_DAYS}g`})`);
    }

    // 0012 — traduzioni dei contenuti: una lingua assente non è un errore di
  // integrità (l'app lo dichiara all'utente), ma è un avviso da tenere d'occhio.
  const tr = (p.translations && typeof p.translations === 'object') ? p.translations : {};
  const missingLangs = CONTENT_LOCALES.filter((l) => !tr[l]);
  const partial = CONTENT_LOCALES.filter((l) => tr[l] && TRANSLATABLE.some((f) => !tr[l][f]));
  if (missingLangs.length) warnings.push(`${p.id}: contenuti non tradotti in ${missingLangs.join(', ')}`);
  if (partial.length) warnings.push(`${p.id}: traduzione incompleta in ${partial.join(', ')}`);

  const suspTag = p.availability === 'suspended' ? ' ⚠ SOSPESO' : '';
    const flag = errs.length ? '✗ ERRORI' : stale ? '· da ricontrollare' : '✓ ok';
    console.log(`  [${String(p.data_status).padEnd(8)}] ${String(p.id).padEnd(18)} chk ${String(p.last_checked_at ?? '—').padEnd(10)} (${ageTxt.padStart(4)})  ${flag}${suspTag}`);
    for (const e of errs) { console.log(`             ✗ ${e}`); integrityIssues.push(`${p.id}: ${e}`); }
    if (stale && !errs.length) toRecheck.push(`${p.id} (${reason})`);
  }

  // ---- La coda di revisione ------------------------------------------------
  // ⚠️ Se la lettura FALLISCE non si prosegue come se la coda fosse vuota.
  // «Non ho potuto guardare» e «non c'è niente» sono la stessa frase solo per
  // chi non vuole saperlo: è la forma esatta del difetto che questo intervento
  // sta correggendo altrove.
  const { data: revRows, error: revErr } = await admin
    .from('subsidy_catalog_reviews').select('status, created_at');
  if (revErr) {
    console.error(`\n✗ Impossibile leggere subsidy_catalog_reviews: ${revErr.message}`);
    console.error('  La coda di revisione non è stata guardata: questo esito non vale.\n');
    process.exit(2);
  }
  const coda = giudicaCodaRevisioni(revRows ?? [], today);

  console.log('\n— Riepilogo —');
  console.log(`  Programmi: ${rows.length}  (verified ${byStatus.verified} · recheck ${byStatus.recheck} · demo ${byStatus.demo}${byStatus.other ? ` · altro ${byStatus.other}` : ''})`);
  console.log(`  Attivi: ${activeCount}/${rows.length}`);
  console.log(`  Concedibili: ${rows.length - suspendedCount}/${rows.length}${suspendedCount ? `  (${suspendedCount} sospesi)` : ''}`);
  const fullyTranslated = rows.filter((p) => {
    const tr = (p.translations && typeof p.translations === 'object') ? p.translations : {};
    return CONTENT_LOCALES.every((l) => tr[l] && TRANSLATABLE.every((f) => tr[l][f]));
  }).length;
  console.log(`  Contenuti tradotti (de+fr): ${fullyTranslated}/${rows.length}`);
  console.log(`  Errori di integrità: ${integrityIssues.length}`);
  console.log(`  Da ricontrollare (freschezza): ${toRecheck.length}`);
  // ⚠️ La riga che mancava. Sta nel riepilogo SEMPRE, anche quando dice
  // «nessuna»: un conteggio che compare solo quando è diverso da zero insegna
  // a non cercarlo.
  console.log(`  ${coda.nominata}`);

  // Oltre le soglie, la coda smette di essere un arretrato e diventa integrità.
  for (const e of coda.errori) integrityIssues.push(`revisioni: ${e}`);

  if (warnings.length) { console.log('\n— Avvisi —'); for (const w of warnings) console.log(`  ! ${w}`); }
  if (toRecheck.length) { console.log('\n— Da ricontrollare —'); for (const r of toRecheck) console.log(`  - ${r}`); }
  if (coda.pending) {
    console.log('\n— In attesa di una persona —');
    console.log(`  ${coda.pending} revisioni del catalogo in stato «pending»${coda.oldestDays == null ? '' : `, la più vecchia da ${coda.oldestDays} giorni`}.`);
    console.log('  Nessun controllo automatico può chiuderle: contengono un giudizio, non un calcolo.');
    console.log('  Si leggono in `subsidy_catalog_reviews` (change_type, previous_values, proposed_values).');
  }
  if (integrityIssues.length) { console.log('\n— Errori di integrità (da correggere nel seed) —'); for (const e of integrityIssues) console.log(`  ✗ ${e}`); }

  const code = integrityIssues.length ? 2 : toRecheck.length ? 1 : 0;
  // ⚠️ LA FRASE «catalogo valido e aggiornato» NON PUÒ PIÙ COMPARIRE DA SOLA
  // mentre del lavoro aspetta una persona. Era esattamente ciò che si leggeva
  // il 2026-07-31 con sette revisioni ferme: vero sul catalogo, e completamente
  // fuorviante su ciò che restava da fare.
  const inAttesa = coda.pending ? ` · ${coda.pending} REVISIONI IN ATTESA DI UNA PERSONA` : '';
  const esito = code === 0 ? 'catalogo valido e aggiornato'
    : code === 1 ? 'valido, ma ci sono programmi da ricontrollare'
      : 'ERRORI DI INTEGRITÀ — correggere il seed';
  console.log(`\nEsito: ${esito}${inAttesa} (exit ${code})\n`);
  process.exit(code);
};

run().catch((e) => { console.error('Errore inatteso:', e?.message ?? e); process.exit(2); });
