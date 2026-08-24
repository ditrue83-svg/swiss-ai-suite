#!/usr/bin/env node
// ============================================================================
// stati:censimento — GLI STATI DEL DOCUMENTO, RIMISURATI ADESSO.
//
//   npm run stati:censimento              → il rapporto a schermo
//   npm run stati:censimento -- --json    → gli stessi numeri in JSON
//   npm run stati:censimento:self-test    → prova le regole senza database
//
// ⚠️ PERCHÉ ESISTE. `docs/stati-documento.md` è un censimento con i numeri
// accanto alla data in cui sono stati presi. La regola del progetto dice che
// **il registro si rimisura, non si eredita**: un censimento che si può solo
// rileggere, dopo qualche giro, è un racconto. Questo comando è il modo di
// rifare la misura — la stessa, sulle stesse colonne — invece di copiare i
// numeri di ieri.
//
// ⚠️ SOLA LETTURA. Nessuna riga toccata, nessuna funzione Edge invocata,
// **nessun credito AI speso**: solo `select`. Il database di `.env.test` è la
// produzione, e un censimento che scrivesse sarebbe un censimento che cambia
// ciò che conta.
//
// ⚠️ NESSUN RIPIEGO. Se una misura non si può prendere, la riga lo DICE e il
// comando esce 3. Un rapporto con «0 documenti» perché la connessione è caduta
// sarebbe peggio di nessun rapporto — è la stessa scelta di `status`.
//
// ⚠️ CHE COSA QUESTO COMANDO **NON** SA. Non sa CHI scrive un campo: quella è
// una lettura del sorgente, la fa una persona, e sta scritta nel documento con
// il `file:riga` accanto. Un grep che cercasse `'completed'` nei sorgenti
// direbbe «vivo» per un valore nominato in un test — e questo progetto ha una
// regola apposta contro i rilevatori che si fanno tenere in vita dai banchi.
// Qui si misurano i DATI e lo SCHEMA, che sono verificabili; l'attribuzione
// resta dichiarata a mano e rileggibile.
//
// Non stampa mai un contenuto: nomi di colonne, valori di enum e conteggi.
// ============================================================================
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const MIGRAZIONI = join(APP, 'supabase', 'migrations');

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';

// ---------------------------------------------------------------------------
// LE PARTI PURE — provate da `--self-test`, senza database e senza rete.
// ---------------------------------------------------------------------------

/**
 * I valori di ogni enum, letti DALLE MIGRAZIONI e non da un elenco scritto qui.
 *
 * ⚠️ Due forme, e servono entrambe: `create type … as enum (…)` dichiara,
 * `alter type … add value` aggiunge. Fino al 2026-08-24 un censimento fatto a
 * occhio su `document_status` ne contava quattro: gli altri quattro erano
 * arrivati con la 0006, in un'altra migrazione e in un'altra forma.
 *
 * ⚠️ Il `returns table (…)` di una funzione NON è una dichiarazione di enum e
 * non deve entrarci: contiene nomi di colonne e, dentro i corpi, letterali
 * fra apici. L'espressione àncora `as enum` subito prima della parentesi, che
 * è ciò che distingue le due cose.
 */
export function leggiEnum(sorgenti) {
  const enums = new Map();
  const aggiungi = (nome, valore, file) => {
    if (!enums.has(nome)) enums.set(nome, { valori: [], da: file });
    const e = enums.get(nome);
    if (!e.valori.includes(valore)) e.valori.push(valore);
  };
  for (const { file, sql } of sorgenti) {
    const creazione = /create\s+type\s+public\.([a-z_]+)\s+as\s+enum\s*\(([\s\S]*?)\)\s*;/gi;
    let m;
    while ((m = creazione.exec(sql))) {
      for (const v of m[2].matchAll(/'([^']+)'/g)) aggiungi(m[1], v[1], file);
    }
    const aggiunta = /alter\s+type\s+public\.([a-z_]+)\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'/gi;
    while ((m = aggiunta.exec(sql))) aggiungi(m[1], m[2], file);
  }
  return enums;
}

/** Quante righe per valore. `null` è un valore come gli altri e si dichiara. */
export function perValore(righe, colonna) {
  const m = new Map();
  for (const r of righe) {
    const v = r[colonna] === undefined || r[colonna] === null ? null : String(r[colonna]);
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return m;
}

/**
 * Gli stati morti NEI DUE SENSI.
 *
 * `senzaRighe`  dichiarati nell'enum e non scritti su nessuna riga — può voler
 *               dire «non ancora capitato» oppure «nessun codice lo produce»,
 *               e la differenza la dice il documento, non questo conteggio;
 * `nonDichiarati` presenti nei dati e ASSENTI dall'enum. Deve essere vuoto: se
 *               non lo è, la colonna non è l'enum che crediamo (è `text` con un
 *               `check`, o l'enum è stato allargato fuori dalle migrazioni).
 */
export function morti(dichiarati, usati) {
  const presenti = new Set([...usati.keys()].filter((k) => k !== null));
  return {
    senzaRighe: dichiarati.filter((v) => !presenti.has(v)),
    nonDichiarati: [...presenti].filter((v) => !dichiarati.includes(v)),
  };
}

/**
 * Due colonne dicono la stessa cosa?
 *
 * Si misura sulla mappa `da → a`: se ogni valore di `da` porta a UN SOLO
 * valore di `a`, la seconda colonna non aggiunge un fatto — lo ripete.
 *
 * ⚠️ NON è una prova di ridondanza per sempre: dice che sui dati di OGGI le due
 * colonne non si sono mai contraddette. È il massimo che un conteggio può
 * affermare, e va scritto così nel documento.
 */
export function funzioneDa(righe, da, a) {
  const mappa = new Map();
  let ambigue = 0;
  for (const r of righe) {
    const k = String(r[da] ?? 'null');
    const v = String(r[a] ?? 'null');
    if (!mappa.has(k)) mappa.set(k, new Set());
    mappa.get(k).add(v);
  }
  for (const s of mappa.values()) if (s.size > 1) ambigue++;
  return {
    totale: righe.length,
    coppie: [...mappa].map(([k, s]) => ({ da: k, a: [...s], n: righe.filter((r) => String(r[da] ?? 'null') === k).length })),
    eFunzione: ambigue === 0 && righe.length > 0,
    ambigue,
  };
}

/** Quante righe hanno i due campi in accordo, e quante no. */
export function accordo(righe, a, b) {
  let uguali = 0, diversi = 0;
  for (const r of righe) {
    if (String(r[a] ?? 'null') === String(r[b] ?? 'null')) uguali++; else diversi++;
  }
  return { uguali, diversi };
}

// ---------------------------------------------------------------------------
// LE TABELLE MISURATE — dichiarate qui, con la colonna che porta lo stato.
//
// ⚠️ L'elenco delle tabelle con `archived_at` NON è scritto a mano: si ricava
// dalle migrazioni (`tabelleConArchivio`), altrimenti la prossima tabella che
// nasce con quella colonna resterebbe fuori dal censimento senza che nessuno
// se ne accorga — che è esattamente il modo in cui un registro invecchia.
// ---------------------------------------------------------------------------

/**
 * Le tabelle che hanno una colonna `archived_at`, lette dalle migrazioni.
 *
 * ⚠️ Si scartano le occorrenze dentro un `returns table (…)`: là `archived_at`
 * è una colonna RESTITUITA da una funzione di lettura, non una colonna che
 * esiste. Contarle darebbe otto tabelle che non esistono.
 */
export function tabelleConArchivio(sorgenti) {
  const trovate = new Map();
  for (const { file, sql } of sorgenti) {
    const righe = sql.split('\n');
    let contesto = null;
    for (let i = 0; i < righe.length; i++) {
      const riga = righe[i];
      let m;
      if ((m = /^create\s+table\s+if\s+not\s+exists\s+public\.([a-z_]+)/i.exec(riga))) contesto = m[1];
      else if ((m = /^alter\s+table\s+public\.([a-z_]+)/i.exec(riga))) contesto = m[1];
      // ⚠️ UNA GUARDIA SOLA, e non due. La prima stesura ne aveva anche una su
      // `returns table (`: misurata sulle 45 migrazioni vere non cambiava un
      // solo nome, perché ogni `returns table` di questo progetto sta dentro
      // una funzione già dichiarata alla riga sopra. Una regola che non PUÒ
      // scattare non è inattiva: è una riga di specifica che mente, e in questo
      // progetto se ne è già tolta una per la stessa ragione (`analysisTrust`,
      // la regola sull'OCR). L'alternanza `or replace` copre le due forme.
      else if (/^create\s+(or\s+replace\s+)?function/i.test(riga)) contesto = null;
      if (!contesto) continue;
      if (!/\barchived_at\b/.test(riga)) continue;
      if (!/timestamptz/.test(riga) && !/add\s+column/i.test(riga)) continue;
      if (!trovate.has(contesto)) trovate.set(contesto, `${file}:${i + 1}`);
    }
  }
  return trovate;
}

// ---------------------------------------------------------------------------
// IL RAPPORTO
// ---------------------------------------------------------------------------

function sorgentiMigrazioni() {
  if (!existsSync(MIGRAZIONI)) return null;
  return readdirSync(MIGRAZIONI).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRAZIONI, f), 'utf8') }));
}

/** Le colonne di stato censite, con l'enum che le tipizza. */
const CENSITE = [
  { tabella: 'documents', colonna: 'status', enumName: 'document_status' },
  { tabella: 'documents', colonna: 'source_type', enumName: 'document_source_type' },
  { tabella: 'documents', colonna: 'category', enumName: 'document_category' },
  { tabella: 'documents', colonna: 'category_source', enumName: 'document_category_source' },
  { tabella: 'document_analyses', colonna: 'analysis_status', enumName: 'analysis_status' },
  { tabella: 'document_analyses', colonna: 'confidence', enumName: null },
  { tabella: 'document_analyses', colonna: 'deadline_type', enumName: null },
  { tabella: 'document_analyses', colonna: 'deadline_kind', enumName: null },
  { tabella: 'document_analyses', colonna: 'deadline_requires_verification', enumName: null },
  { tabella: 'email_messages', colonna: 'processing_status', enumName: 'email_processing_status' },
  { tabella: 'email_messages', colonna: 'attention_status', enumName: 'email_attention_status' },
  { tabella: 'email_messages', colonna: 'relevance', enumName: 'email_relevance' },
  { tabella: 'email_message_documents', colonna: 'relation', enumName: 'email_document_relation' },
  { tabella: 'tasks', colonna: 'status', enumName: 'task_status' },
  { tabella: 'tasks', colonna: 'source', enumName: 'task_source' },
  { tabella: 'finance_items', colonna: 'review_status', enumName: 'finance_review_status' },
  { tabella: 'contracts', colonna: 'review_status', enumName: 'contract_review_status' },
  { tabella: 'contracts', colonna: 'lifecycle_status', enumName: 'contract_lifecycle_status' },
  { tabella: 'audit_logs', colonna: 'action', enumName: 'audit_action' },
];

/** Le colonne da leggere per tabella (una richiesta sola per tabella). */
const COLONNE = {
  documents: 'id,status,source_type,category,category_source,archived_at,archived_by,created_at',
  document_analyses: 'id,document_id,analysis_status,confidence,deadline,deadline_type,deadline_kind,deadline_requires_verification,uncertainties,created_at',
  analysis_corrections: 'id,field,corrected_value,corrected_by,corrected_at,document_id,analysis_id',
  action_progress: 'id,analysis_id,action_index,done,done_by,done_at',
  email_messages: 'id,processing_status,attention_status,relevance,seen_at,handled_at',
  email_message_documents: 'id,email_message_id,document_id,relation',
  tasks: 'id,status,source,document_id,archived_at,archived_by',
  finance_items: 'id,review_status,processing_status,archived_at,archived_by,reviewed_at',
  contracts: 'id,review_status,lifecycle_status,archived_at,archived_by',
  audit_logs: 'id,action,entity_type,created_at',
  ai_request_log: 'id,kind,status,created_at',
};

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  const comeJson = args.includes('--json');

  const sorgenti = sorgentiMigrazioni();
  if (!sorgenti) {
    console.error(`${R}✗ supabase/migrations non si legge: senza le migrazioni non c'è nulla da confrontare.${X}`);
    process.exit(3);
  }
  const enums = leggiEnum(sorgenti);
  const conArchivio = tabelleConArchivio(sorgenti);

  const mancanti = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !process.env[k]);
  if (mancanti.length) {
    console.error(`${R}✗ Manca ${mancanti.join(', ')}: il censimento misura il database vero, e senza chiavi non misura niente.${X}`);
    console.error(`${DIM}  npm run stati:censimento  usa --env-file=.env.test${X}`);
    process.exit(3);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const ws = await import('ws');
  if (!globalThis.WebSocket) globalThis.WebSocket = ws.default;
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const istante = new Date().toISOString();
  const dati = {};
  const nonMisurate = [];
  for (const [tab, cols] of Object.entries(COLONNE)) {
    const { data, error, count } = await sb.from(tab).select(cols, { count: 'exact' }).limit(10000);
    if (error) { nonMisurate.push(`${tab} — ${error.code ?? ''} ${error.message}`); continue; }
    dati[tab] = { righe: data ?? [], totale: count ?? (data ?? []).length };
  }

  // le tabelle con archived_at che non sono fra le COLONNE: si contano e basta
  const archivio = {};
  for (const [tab, dove] of conArchivio) {
    const { data, error, count } = await sb.from(tab).select('id,archived_at', { count: 'exact' }).limit(10000);
    if (error) { archivio[tab] = { dove, errore: `${error.code ?? ''} ${error.message}` }; continue; }
    archivio[tab] = { dove, totale: count ?? 0, archiviate: (data ?? []).filter((r) => r.archived_at).length };
  }

  const rapporto = { misuratoIl: istante, enums: {}, colonne: [], archivio, nonMisurate };

  for (const c of CENSITE) {
    const t = dati[c.tabella];
    if (!t) { rapporto.colonne.push({ ...c, errore: 'tabella non misurata' }); continue; }
    const usati = perValore(t.righe, c.colonna);
    const dichiarati = c.enumName ? (enums.get(c.enumName)?.valori ?? []) : null;
    rapporto.colonne.push({
      ...c,
      righe: t.totale,
      valori: [...usati].map(([v, n]) => ({ valore: v, n })).sort((a, b) => b.n - a.n),
      dichiarati,
      morti: dichiarati ? morti(dichiarati, usati) : null,
    });
  }
  for (const [nome, e] of enums) rapporto.enums[nome] = e.valori;

  // ---- le coppie che dicono la stessa cosa ---------------------------------
  rapporto.coppie = [];
  if (dati.email_messages) {
    rapporto.coppie.push({
      che: 'email_messages.relevance → email_messages.attention_status',
      ...funzioneDa(dati.email_messages.righe, 'relevance', 'attention_status'),
    });
  }
  if (dati.documents && dati.document_analyses) {
    const ultima = new Map();
    for (const a of [...dati.document_analyses.righe].sort((x, y) => (x.created_at < y.created_at ? -1 : 1))) {
      ultima.set(a.document_id, a);
    }
    const unite = dati.documents.righe
      .map((d) => ({ id: d.id, doc: d.status, an: ultima.get(d.id)?.analysis_status ?? null }))
      .filter((r) => r.an !== null);
    rapporto.coppie.push({
      che: 'documents.status ↔ analysis_status dell\'ultima analisi',
      totale: unite.length,
      senzaAnalisi: dati.documents.righe.length - unite.length,
      ...accordo(unite, 'doc', 'an'),
    });
  }

  // ---- la checklist --------------------------------------------------------
  if (dati.action_progress) {
    const r = dati.action_progress.righe;
    rapporto.actionProgress = {
      righe: dati.action_progress.totale,
      spuntate: r.filter((x) => x.done).length,
      nonSpuntate: r.filter((x) => !x.done).length,
      analisiToccate: new Set(r.map((x) => x.analysis_id)).size,
      analisiTotali: dati.document_analyses?.totale ?? null,
      spuntateSenzaMomento: r.filter((x) => x.done && !x.done_at).length,
    };
  }

  // ---- la verifica umana ---------------------------------------------------
  if (dati.analysis_corrections) {
    const r = dati.analysis_corrections.righe;
    rapporto.verificaUmana = {
      correzioni: dati.analysis_corrections.totale,
      perCampo: [...perValore(r, 'field')].map(([v, n]) => ({ campo: v, n })),
      documentiToccati: new Set(r.map((x) => x.document_id)).size,
    };
  }

  // ---- l'archiviazione dei documenti: con o senza un archiviatore ----------
  if (dati.documents) {
    const r = dati.documents.righe;
    const arch = r.filter((d) => d.archived_at);
    const perGiorno = perValore(arch.map((d) => ({ g: String(d.archived_at).slice(0, 10) })), 'g');
    rapporto.archiviazioneDocumenti = {
      totale: r.length,
      archiviati: arch.length,
      conArchiviatore: arch.filter((d) => d.archived_by).length,
      senzaArchiviatore: arch.filter((d) => !d.archived_by).length,
      perGiorno: [...perGiorno].map(([g, n]) => ({ giorno: g, n })).sort((a, b) => (a.giorno < b.giorno ? -1 : 1)),
    };
  }

  if (comeJson) { console.log(JSON.stringify(rapporto, null, 2)); return uscita(rapporto); }
  stampa(rapporto);
  return uscita(rapporto);
}

function uscita(rapporto) {
  if (rapporto.nonMisurate.length) process.exit(3);
  const nonDichiarati = rapporto.colonne.filter((c) => c.morti?.nonDichiarati.length);
  if (nonDichiarati.length) process.exit(1);
  process.exit(0);
}

function stampa(r) {
  console.log(`\n${B}Censimento degli stati — misurato il ${r.misuratoIl}${X}`);
  console.log(`${DIM}sola lettura · nessun credito AI speso${X}\n`);

  console.log(`${B}1. I campi di stato${X}`);
  for (const c of r.colonne) {
    if (c.errore) { console.log(`  ${R}${c.tabella}.${c.colonna}: ${c.errore}${X}`); continue; }
    const valori = c.valori.map((v) => `${v.valore ?? 'NULL'}=${v.n}`).join('  ');
    console.log(`  ${B}${c.tabella}.${c.colonna}${X} ${DIM}(${c.righe} righe)${X}`);
    console.log(`    dati       ${valori || DIM + 'nessuna riga' + X}`);
    if (c.dichiarati) {
      console.log(`    enum       ${c.enumName} (${c.dichiarati.length}) ${c.dichiarati.join(', ')}`);
      if (c.morti.senzaRighe.length) {
        console.log(`    ${Y}senza righe${X} ${c.morti.senzaRighe.join(', ')}`);
      }
      if (c.morti.nonDichiarati.length) {
        console.log(`    ${R}NON DICHIARATI${X} ${c.morti.nonDichiarati.join(', ')} — la colonna non è l'enum che credevamo`);
      }
    }
  }

  console.log(`\n${B}2. I campi che dicono la stessa cosa${X}`);
  for (const c of r.coppie) {
    if (c.eFunzione !== undefined) {
      console.log(`  ${c.che}`);
      console.log(`    ${c.eFunzione ? R + 'una funzione totale' + X : G + 'non è una funzione' + X} su ${c.totale} righe (${c.ambigue} valori ambigui)`);
      for (const p of c.coppie) console.log(`      ${p.da} → ${p.a.join(' | ')}  (${p.n})`);
    } else {
      console.log(`  ${c.che}`);
      console.log(`    concordi ${c.uguali} · discordi ${c.diversi} · senza analisi ${c.senzaAnalisi}`);
    }
  }

  if (r.actionProgress) {
    const a = r.actionProgress;
    console.log(`\n${B}3. action_progress${X}`);
    console.log(`  ${a.righe} righe · spuntate ${a.spuntate} · non spuntate ${a.nonSpuntate}`);
    console.log(`  analisi toccate ${a.analisiToccate} su ${a.analisiTotali}`);
    if (a.spuntateSenzaMomento) console.log(`  ${Y}spuntate senza momento: ${a.spuntateSenzaMomento}${X}`);
  }

  if (r.verificaUmana) {
    const v = r.verificaUmana;
    console.log(`\n${B}4. La verifica umana (analysis_corrections)${X}`);
    console.log(`  ${v.correzioni} correzioni su ${v.documentiToccati} documenti`);
    for (const c of v.perCampo) console.log(`    ${c.campo}=${c.n}`);
    if (!v.correzioni) console.log(`  ${Y}nessuna: l'asse della verifica umana è vuoto${X}`);
  }

  if (r.archiviazioneDocumenti) {
    const a = r.archiviazioneDocumenti;
    console.log(`\n${B}5. L'archiviazione dei documenti${X}`);
    console.log(`  ${a.archiviati} archiviati su ${a.totale} · con archiviatore ${a.conArchiviatore} · senza ${a.senzaArchiviatore}`);
    for (const g of a.perGiorno) console.log(`    ${g.giorno}  ${g.n}`);
  }

  console.log(`\n${B}6. L'archiviazione attraverso il prodotto${X} ${DIM}(tabelle con archived_at, dalle migrazioni)${X}`);
  for (const [tab, a] of Object.entries(r.archivio).sort()) {
    if (a.errore) { console.log(`  ${R}${tab.padEnd(24)} ${a.errore}${X}`); continue; }
    console.log(`  ${tab.padEnd(24)} ${String(a.totale).padStart(4)} righe · ${String(a.archiviate).padStart(4)} archiviate  ${DIM}${a.dove}${X}`);
  }

  if (r.nonMisurate.length) {
    console.log(`\n${R}✗ Misure NON prese (${r.nonMisurate.length}):${X}`);
    for (const n of r.nonMisurate) console.log(`  ${n}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// SELF-TEST — le regole devono sapere diventare rosse.
// ---------------------------------------------------------------------------
function selfTest() {
  let ok = 0; const rossi = [];
  const prova = (nome, cond) => { if (cond) ok++; else rossi.push(nome); };

  // --- leggiEnum -----------------------------------------------------------
  const sorgenti = [
    { file: '0001.sql', sql: "do $$ begin\n  create type public.tinta as enum ('rossa', 'blu');\nexception when duplicate_object then null; end $$;" },
    { file: '0002.sql', sql: "alter type public.tinta add value if not exists 'verde';" },
    {
      file: '0003.sql',
      sql: "create or replace function public.elenco()\nreturns table (\n  id uuid,\n  stato text,\n  archived_at timestamptz\n)\nas $$ select 'rossa'; $$;",
    },
    {
      file: '0004.sql',
      sql: "create type public.taglia as enum ('piccola', 'grande');\n\ncreate type public.misura as enum ('cm', 'kg');",
    },
  ];
  const e = leggiEnum(sorgenti);
  prova('leggiEnum unisce create e alter', JSON.stringify(e.get('tinta')?.valori) === JSON.stringify(['rossa', 'blu', 'verde']));
  prova('leggiEnum non inventa enum dai returns table', e.size === 3);
  // ⚠️ DUE ENUM NELLO STESSO FILE, che è la norma e non l'eccezione: la 0024 ne
  // dichiara venti di fila. Con una cattura golosa il primo si mangerebbe i
  // valori del secondo, e il censimento direbbe che `misura` ammette anche
  // «rossa» — un enum inventato che nessuno andrebbe a ricontrollare.
  prova('leggiEnum non fonde due enum dello stesso file',
    JSON.stringify(e.get('taglia')?.valori) === JSON.stringify(['piccola', 'grande'])
    && JSON.stringify(e.get('misura')?.valori) === JSON.stringify(['cm', 'kg']));

  // --- tabelleConArchivio --------------------------------------------------
  // ⚠️ LA DISPOSIZIONE DEI CASI È IL CASO. Il contesto riparte da zero a ogni
  // file, quindi una funzione messa in un file suo verrebbe scartata anche
  // senza guardia alcuna: un caso che non può fallire non prova niente, ed è
  // il verde falso che questo progetto ha già pagato quattro volte. Perciò le
  // due funzioni stanno DOPO una tabella che `archived_at` NON ce l'ha — come
  // nelle migrazioni vere — e la controprova è che quella tabella non compaia.
  const conArch = tabelleConArchivio([
    { file: '0017.sql', sql: 'alter table public.documents\n  add column if not exists archived_at        timestamptz,\n  add column if not exists archived_by        uuid;' },
    { file: '0024.sql', sql: 'create table if not exists public.senza_archivio (\n  id uuid\n);\n\ncreate or replace function public.list_uno()\nreturns table (\n  id uuid,\n  archived_at timestamptz\n)\nas $$ begin end $$;' },
    // La seconda forma, senza `or replace`: nelle 45 migrazioni di oggi non
    // compare, e proprio per questo sta qui — una guardia provata su una forma
    // sola si rompe in silenzio alla prima migrazione scritta nell'altra.
    { file: '0026.sql', sql: 'create table if not exists public.anche_senza (\n  id uuid\n);\n\ncreate function public.list_due()\nreturns table (\n  id uuid,\n  archived_at timestamptz\n)\nas $$ begin end $$;' },
  ]);
  prova('tabelleConArchivio trova la colonna aggiunta', conArch.has('documents'));
  // ⚠️ LE DUE CONTROPROVE CHE CONTANO: le colonne che una funzione RESTITUISCE
  // non sono colonne che esistono. Senza la guardia il censimento attribuirebbe
  // `archived_at` alla tabella dichiarata poco sopra — otto nomi inventati,
  // misurati sulle migrazioni vere.
  prova('tabelleConArchivio non attribuisce le colonne di una funzione (or replace)', !conArch.has('senza_archivio'));
  prova('tabelleConArchivio non attribuisce le colonne di una funzione (senza or replace)', !conArch.has('anche_senza'));
  prova('tabelleConArchivio trova una tabella sola', conArch.size === 1);

  // --- morti ---------------------------------------------------------------
  const usati = perValore([{ s: 'a' }, { s: 'a' }, { s: 'b' }, { s: null }], 's');
  prova('perValore conta anche i NULL', usati.get(null) === 1 && usati.get('a') === 2);
  const m = morti(['a', 'b', 'c'], usati);
  prova('morti trova il valore senza righe', JSON.stringify(m.senzaRighe) === JSON.stringify(['c']));
  prova('morti non accusa un valore che ha righe', !m.senzaRighe.includes('a'));
  const m2 = morti(['a'], usati);
  prova('morti trova un valore non dichiarato', m2.nonDichiarati.includes('b'));

  // --- funzioneDa ----------------------------------------------------------
  const uno = funzioneDa([{ a: 'x', b: '1' }, { a: 'x', b: '1' }, { a: 'y', b: '2' }], 'a', 'b');
  prova('funzioneDa riconosce una funzione totale', uno.eFunzione && uno.ambigue === 0);
  // ⚠️ CONTROPROVA: se `x` porta a due valori diversi, le colonne NON dicono la
  // stessa cosa — e dichiararlo lo stesso sarebbe il verde falso da evitare.
  const due = funzioneDa([{ a: 'x', b: '1' }, { a: 'x', b: '2' }], 'a', 'b');
  prova('funzioneDa si accorge del valore ambiguo', !due.eFunzione && due.ambigue === 1);
  const vuoto = funzioneDa([], 'a', 'b');
  prova('funzioneDa su zero righe non dichiara nulla', !vuoto.eFunzione);

  // --- accordo -------------------------------------------------------------
  const acc = accordo([{ a: '1', b: '1' }, { a: '1', b: '2' }], 'a', 'b');
  prova('accordo conta concordi e discordi', acc.uguali === 1 && acc.diversi === 1);

  if (rossi.length) {
    console.error(`\n${R}✗ self-test: ${rossi.length} su ${ok + rossi.length} falliti${X}`);
    for (const n of rossi) console.error(`  ${R}·${X} ${n}`);
    process.exit(1);
  }
  console.log(`${G}✓${X} stati:censimento self-test — ${ok} su ${ok} ${DIM}(regole pure, nessun database)${X}`);
  process.exit(0);
}

await main();
