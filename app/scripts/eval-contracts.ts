// ============================================================================
// L'ESTRAZIONE CONTRATTUALE misurata su tre contratti veri.
//   npm run eval:contracts              ← la coda la svuota il WORKER DEPLOYATO
//   npm run eval:contracts -- --local   ← la pipeline gira qui, in Node
//   npm run eval:contracts -- --self-test  ← prova il metro, senza rete
//
// PERCHÉ ESISTE. Fino al 2026-08-03 `contract_extractions` era a ZERO: il
// modulo Contratti era implementato, deployato, testato su un database vero e
// coperto da 93 controlli offline — e non aveva mai letto un contratto. Le
// suite provano che il codice fa ciò che dice; nessuna dice se ciò che il
// modello riporta CORRISPONDE a ciò che il documento contiene. È una domanda
// diversa, e si risponde solo con dei documenti.
//
// ⚠️ CHE COSA SONO I TRE DOCUMENTI, DICHIARATO. Sono contratti svizzeri
// VEROSIMILI scritti per questa prova (locazione commerciale · it, fornitura ·
// de, mandato fiduciario · fr), stampati in PDF e riletti con la STESSA
// estrazione del prodotto. Non sono contratti di terzi: quindi provano la
// lettura di un impaginato pulito, e NON provano l'OCR di una scansione né un
// documento scritto male. Il limite è dichiarato qui e in product-status.
//
// ⚠️⚠️ LA VERITÀ DI RIFERIMENTO NON SI CREDE: SI VERIFICA. Ogni valore atteso
// che dice di essere copiato dal documento viene cercato NEL TESTO ESTRATTO
// prima di misurare qualunque cosa. Se non si trova, l'eval si ferma: mi sarei
// inventato la risposta giusta, e avrei misurato il modello contro la mia
// memoria invece che contro la carta.
//
// ⚠️ SPENDE CREDITO E TOCCA LA PRODUZIONE. Crea un'azienda usa-e-getta, la
// misura e la cancella; la cancellazione viene VERIFICATA e una pulizia
// incompleta fa fallire il comando.
// ============================================================================
import Anthropic from '@anthropic-ai/sdk';
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  processContractDocument, type ContractDeps,
} from '../supabase/functions/_shared/contracts/process.ts';
import type { ContractDocumentRow, ServerClient } from '../supabase/functions/_shared/contracts/store.ts';

// Node 20 non ha `WebSocket` nativo e supabase-js lo pretende: stessa riga di
// `test-contracts.ts` e `check-auth-config.mjs`.
if (!globalThis.WebSocket) (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures', 'contracts');

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[1m', DIM = '\x1b[2m', X = '\x1b[0m';

// ---------------------------------------------------------------------------
// Il metro: come si confronta un valore letto con quello atteso.
// ---------------------------------------------------------------------------
export type Atteso =
  | { tipo: 'uguale'; valore: string; citato?: boolean }
  | { tipo: 'contiene'; valore: string; citato?: boolean }
  | { tipo: 'fra'; valori: string[] }
  | { tipo: 'vuoto' };

/** Confronto tollerante alla forma, non al contenuto: spazi e maiuscole. */
const norm = (v: unknown): string =>
  String(v ?? '').replace(/[\s ]+/g, ' ').trim().toLowerCase();

export function confronta(letto: unknown, atteso: Atteso): boolean {
  const l = norm(letto);
  switch (atteso.tipo) {
    case 'vuoto':
      // ⚠️ `false` NON è vuoto: su `signed` e `price_adjustment` un `false`
      // esplicito è una risposta, e confonderlo con l'assenza cancellerebbe la
      // differenza fra «il documento dice di no» e «il documento tace».
      return letto === null || letto === undefined || l === '';
    case 'uguale': return l === norm(atteso.valore);
    case 'contiene': return l.includes(norm(atteso.valore));
    case 'fra': return atteso.valori.some((v) => norm(v) === l);
  }
}

// ---------------------------------------------------------------------------
// I tre documenti e ciò che DICONO. Le voci con `citato: true` devono comparire
// alla lettera nel testo estratto: è l'autoverifica della verità di riferimento.
// ---------------------------------------------------------------------------
interface Caso {
  file: string;
  nome: string;
  tipoDocumento: string;
  atteso: Record<string, Atteso>;
}

const CASI: Caso[] = [
  {
    file: 'locazione-it.pdf',
    nome: 'Locazione commerciale (it)',
    tipoDocumento: 'rent',
    atteso: {
      document_language: { tipo: 'uguale', valore: 'it' },
      detected_type: { tipo: 'uguale', valore: 'rent' },
      company_party: { tipo: 'contiene', valore: 'Brenta Impianti SA', citato: true },
      counterparty: { tipo: 'contiene', valore: 'Immobiliare Ceresio SA', citato: true },
      counterparty_address: { tipo: 'contiene', valore: 'Via Nassa 12', citato: true },
      document_date: { tipo: 'contiene', valore: '12 giugno 2026', citato: true },
      start_date: { tipo: 'contiene', valore: 'ottobre 2026', citato: true },
      end_date: { tipo: 'contiene', valore: '30 settembre 2031', citato: true },
      end_date_kind: { tipo: 'uguale', valore: 'explicit' },
      minimum_term_value: { tipo: 'uguale', valore: '5' },
      minimum_term_unit: { tipo: 'uguale', valore: 'years' },
      auto_renewal: { tipo: 'uguale', valore: 'yes' },
      renewal_period_value: { tipo: 'uguale', valore: '1' },
      renewal_period_unit: { tipo: 'uguale', valore: 'years' },
      notice_period_value: { tipo: 'uguale', valore: '6' },
      notice_period_unit: { tipo: 'uguale', valore: 'months' },
      notice_anchor_text: { tipo: 'contiene', valore: 'preavviso di sei mesi', citato: true },
      termination_method: { tipo: 'uguale', valore: 'registered_mail' },
      termination_address: { tipo: 'contiene', valore: 'Via Nassa 12', citato: true },
      cost_amount: { tipo: 'contiene', valore: '4', citato: false },
      cost_currency: { tipo: 'uguale', valore: 'CHF' },
      cost_frequency: { tipo: 'uguale', valore: 'monthly' },
      cost_vat_included: { tipo: 'uguale', valore: 'false' },
      price_adjustment: { tipo: 'uguale', valore: 'true' },
      governing_law: { tipo: 'contiene', valore: 'svizzero', citato: true },
      jurisdiction: { tipo: 'contiene', valore: 'Lugano', citato: true },
      signed: { tipo: 'uguale', valore: 'true' },
    },
  },
  {
    file: 'fornitura-de.pdf',
    nome: 'Liefervertrag / fornitura (de)',
    tipoDocumento: 'supplier',
    atteso: {
      document_language: { tipo: 'uguale', valore: 'de' },
      detected_type: { tipo: 'uguale', valore: 'supplier' },
      company_party: { tipo: 'contiene', valore: 'Brenta Impianti SA', citato: true },
      counterparty: { tipo: 'contiene', valore: 'Aargauer Stahlhandel AG', citato: true },
      counterparty_address: { tipo: 'contiene', valore: 'Industriestrasse 27', citato: true },
      document_date: { tipo: 'contiene', valore: '3. November 2026', citato: true },
      start_date: { tipo: 'contiene', valore: '1. Januar 2027', citato: true },
      // ⚠️ TRAPPOLA: il contratto è «auf unbestimmte Zeit». Nessuna data di fine
      // esiste, e dedurne una sarebbe inventare.
      end_date: { tipo: 'vuoto' },
      end_date_kind: { tipo: 'uguale', valore: 'none' },
      // ⚠️ TRAPPOLA: c'è una MINDESTABNAHME (120 tonnellate l'anno), che è una
      // quantità, non una durata minima. `minimum_term` deve restare vuoto.
      minimum_term_value: { tipo: 'vuoto' },
      // ⚠️ TRAPPOLA: il documento non parla di rinnovo. Il silenzio è `unclear`,
      // mai `no` (§35).
      auto_renewal: { tipo: 'uguale', valore: 'unclear' },
      renewal_period_value: { tipo: 'vuoto' },
      notice_period_value: { tipo: 'uguale', valore: '3' },
      notice_period_unit: { tipo: 'uguale', valore: 'months' },
      notice_anchor_text: { tipo: 'contiene', valore: 'Ende eines Kalenderquartals', citato: true },
      termination_method: { tipo: 'uguale', valore: 'written_notice' },
      termination_address: { tipo: 'vuoto' },
      cost_amount: { tipo: 'contiene', valore: '1', citato: false },
      cost_currency: { tipo: 'uguale', valore: 'CHF' },
      // ⚠️ Il prezzo è «pro Tonne»: NON è una periodicità. La risposta giusta è
      // dichiarare di non saperlo, non sceglierne una plausibile.
      cost_frequency: { tipo: 'fra', valori: ['unknown', 'other'] },
      cost_vat_included: { tipo: 'uguale', valore: 'false' },
      price_adjustment: { tipo: 'uguale', valore: 'true' },
      governing_law: { tipo: 'contiene', valore: 'schweizerisches recht', citato: true },
      jurisdiction: { tipo: 'contiene', valore: 'Aarau', citato: true },
      signed: { tipo: 'uguale', valore: 'true' },
    },
  },
  {
    file: 'mandato-fr.pdf',
    nome: 'Contrat de mandat (fr)',
    tipoDocumento: 'service',
    atteso: {
      document_language: { tipo: 'uguale', valore: 'fr' },
      detected_type: { tipo: 'fra', valori: ['service', 'other'] },
      company_party: { tipo: 'contiene', valore: 'Brenta Impianti SA', citato: true },
      counterparty: { tipo: 'contiene', valore: 'Fiduciaire Léman', citato: true },
      counterparty_address: { tipo: 'contiene', valore: 'Rue du Rhône 65', citato: true },
      document_date: { tipo: 'contiene', valore: '15 décembre 2026', citato: true },
      start_date: { tipo: 'contiene', valore: 'février 2027', citato: true },
      // ⚠️⚠️ LA TRAPPOLA PRINCIPALE: ventiquattro mesi dal 1° febbraio 2027 fa il
      // 31 gennaio 2029, e quella data NON È SCRITTA. Il prompt vieta di
      // calcolarla; se compare qui, il modello ha fatto aritmetica su una
      // scadenza — l'errore più costoso che questo modulo possa commettere.
      end_date: { tipo: 'vuoto' },
      end_date_kind: { tipo: 'uguale', valore: 'unknown' },
      minimum_term_value: { tipo: 'uguale', valore: '24' },
      minimum_term_unit: { tipo: 'uguale', valore: 'months' },
      auto_renewal: { tipo: 'uguale', valore: 'yes' },
      renewal_period_value: { tipo: 'uguale', valore: '12' },
      renewal_period_unit: { tipo: 'uguale', valore: 'months' },
      notice_period_value: { tipo: 'uguale', valore: '2' },
      notice_period_unit: { tipo: 'uguale', valore: 'months' },
      notice_anchor_text: { tipo: 'contiene', valore: 'échéance annuelle', citato: true },
      termination_method: { tipo: 'uguale', valore: 'written_notice' },
      termination_address: { tipo: 'vuoto' },
      cost_amount: { tipo: 'contiene', valore: '1', citato: false },
      cost_currency: { tipo: 'uguale', valore: 'CHF' },
      cost_frequency: { tipo: 'uguale', valore: 'quarterly' },
      cost_vat_included: { tipo: 'uguale', valore: 'true' },
      // Nessuna clausola di indicizzazione: dichiararne una sarebbe inventare.
      price_adjustment: { tipo: 'fra', valori: ['false', ''] },
      governing_law: { tipo: 'contiene', valore: 'droit suisse', citato: true },
      jurisdiction: { tipo: 'contiene', valore: 'Genève', citato: true },
      signed: { tipo: 'uguale', valore: 'true' },
    },
  },
];

// ---------------------------------------------------------------------------
// --self-test: il metro provato su casi che DEVONO farlo fallire.
// ---------------------------------------------------------------------------
if (process.argv.slice(2).includes('--self-test')) {
  let p = 0, f = 0;
  const ok = (c: boolean, l: string) => { c ? (p++, console.log(`  ${G}✓${X} ${l}`)) : (f++, console.log(`  ${R}✗ ${l}${X}`)); };
  console.log(`${B}eval:contracts — prova del metro${X}\n`);

  ok(confronta('CHF', { tipo: 'uguale', valore: 'chf' }), 'l’uguaglianza ignora le maiuscole');
  ok(confronta(' Brenta  Impianti SA ', { tipo: 'contiene', valore: 'Brenta Impianti SA' }),
    'e gli spazi doppi, che l’estrazione da PDF produce sempre');
  ok(!confronta('31 gennaio 2029', { tipo: 'vuoto' }),
    '⚠️ una data calcolata NON passa per «vuoto»: è il caso che questo eval esiste per cogliere');
  ok(confronta(null, { tipo: 'vuoto' }) && confronta('', { tipo: 'vuoto' }),
    'null e stringa vuota sono entrambi «vuoto»');
  ok(!confronta(false, { tipo: 'vuoto' }),
    '⚠️ `false` NON è «vuoto»: «il documento dice di no» ≠ «il documento tace»');
  ok(!confronta('no', { tipo: 'uguale', valore: 'unclear' }),
    'un `no` dedotto dal silenzio viene contato come errore');
  ok(confronta('other', { tipo: 'fra', valori: ['unknown', 'other'] })
    && !confronta('monthly', { tipo: 'fra', valori: ['unknown', 'other'] }),
    'l’insieme accetta le risposte legittime e rifiuta quella inventata');

  // La proprietà che conta non è «quanti» ma «ogni caso ne ha abbastanza»: la
  // verità di riferimento di OGNI documento dev'essere ancorata al documento,
  // non solo quella del primo.
  const ancorati = CASI.map((c) => Object.values(c.atteso).filter((a) => (a as { citato?: boolean }).citato).length);
  ok(ancorati.every((n) => n >= 8),
    `ogni documento ha almeno 8 valori attesi COPIATI da lui: ${ancorati.join(', ')}`);

  console.log(`\n${B}Riepilogo${X}  ${G}${p} superati${X}${f ? `  ${R}${f} falliti${X}` : ''}\n`);
  process.exit(f ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Il resto tocca la produzione.
// ---------------------------------------------------------------------------
const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY, AI = process.env.ANTHROPIC_API_KEY;
const LOCALE = process.argv.slice(2).includes('--local');

if (!URL || !ANON || !SERVICE) {
  console.error(`${R}✗ mancano SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY${X}`);
  process.exit(3);
}
if (LOCALE && !AI) {
  console.error(`${R}✗ --local esegue la pipeline qui e ha bisogno di ANTHROPIC_API_KEY${X}`);
  process.exit(3);
}

// Le variabili d'ambiente si ricongelano qui: dopo il controllo qui sopra sono
// stringhe, ma il restringimento non sopravvive dentro `main()`.
const CFG = { url: URL, anon: ANON, service: SERVICE };

const admin = createClient(CFG.url, CFG.service, { auth: { persistSession: false, autoRefreshToken: false } });
const msg = (e: unknown) => (e as { message?: string } | null)?.message ?? String(e);
const stamp = Date.now();
const creato: { utenti: string[]; aziende: string[] } = { utenti: [], aziende: [] };

/** Estrae il testo come fa il prodotto: item uniti da spazio, pagine da `\n`. */
async function estraiPdf(percorso: string): Promise<{ full: string; pages: { pageNumber: number; text: string }[]; bytes: number }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const dati = readFileSync(percorso);
  const doc = await getDocument({ data: new Uint8Array(dati), useSystemFonts: true }).promise;
  const pages: { pageNumber: number; text: string }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    pages.push({
      pageNumber: i,
      text: (c.items as { str?: string }[]).map((it) => (typeof it.str === 'string' ? it.str : '')).join(' '),
    });
  }
  return { full: pages.map((p) => p.text).join('\n').trim(), pages, bytes: dati.length };
}

async function pulisci(): Promise<boolean> {
  let pulito = true;
  for (const id of creato.aziende) {
    const { error } = await admin.from('companies').delete().eq('id', id);
    if (error) { pulito = false; console.log(`  ${R}pulizia azienda ${id}: ${msg(error)}${X}`); }
  }
  for (const id of creato.utenti) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) { pulito = false; console.log(`  ${R}pulizia utente ${id}: ${msg(error)}${X}`); }
  }
  return pulito;
}

async function main() {
  console.log(`${B}AI-Swisse — estrazione contrattuale su tre contratti veri${X}`);
  console.log(`${DIM}modalità: ${LOCALE ? 'pipeline eseguita QUI (Node)' : 'coda svuotata dal WORKER DEPLOYATO'}${X}\n`);

  // --- 1. I documenti, e l'autoverifica della verità di riferimento ---------
  console.log(`${B}1 · I documenti, e la verità di riferimento verificata contro di essi${X}`);
  const testi = new Map<string, Awaited<ReturnType<typeof estraiPdf>>>();
  let bugie = 0;
  for (const caso of CASI) {
    const t = await estraiPdf(join(FIXTURES, caso.file));
    testi.set(caso.file, t);
    const mancanti: string[] = [];
    for (const [campo, atteso] of Object.entries(caso.atteso)) {
      const a = atteso as { citato?: boolean; valore?: string };
      if (!a.citato || !a.valore) continue;
      if (!norm(t.full).includes(norm(a.valore))) mancanti.push(`${campo}="${a.valore}"`);
    }
    bugie += mancanti.length;
    console.log(`  ${mancanti.length ? R + '✗' : G + '✓'}${X} ${caso.file} · ${t.pages.length} pag · ${t.full.length} car`
      + (mancanti.length ? `\n     ${DIM}non trovati nel documento: ${mancanti.join(', ')}${X}` : ''));
  }
  if (bugie) {
    console.log(`\n${R}✗ La verità di riferimento non è sostenuta dai documenti: ${bugie} valori.${X}`);
    console.log(`${DIM}  Si ferma qui: misurare il modello contro valori che il documento non contiene`);
    console.log(`  darebbe un tasso d'errore che parla di me, non del prodotto.${X}\n`);
    process.exit(1);
  }

  // --- 2. L'azienda tecnica -------------------------------------------------
  console.log(`\n${B}2 · Azienda tecnica usa-e-getta${X}`);
  const email = `contratti.eval.${stamp}@swissai-suite.ch`;
  const { data: u, error: ue } = await admin.auth.admin.createUser({
    email, password: 'Test1234!', email_confirm: true,
  });
  if (ue || !u?.user) throw new Error(`utente: ${msg(ue)}`);
  creato.utenti.push(u.user.id);

  const userClient = createClient(CFG.url, CFG.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: se } = await userClient.auth.signInWithPassword({ email, password: 'Test1234!' });
  if (se) throw new Error(`accesso: ${msg(se)}`);
  // ⚠️ Il nome è quello che compare NEI CONTRATTI: `company_party` si misura
  // anche su questo, e un nome con dentro un timestamp lo renderebbe insensato.
  const { data: cid, error: ce } = await userClient.rpc('create_company_with_owner', {
    p_legal_name: 'Brenta Impianti SA',
  });
  if (ce || !cid) throw new Error(`azienda: ${msg(ce)}`);
  creato.aziende.push(cid as string);
  console.log(`  ${G}✓${X} azienda ${String(cid).slice(0, 8)}… · utente ${u.user.id.slice(0, 8)}…`);

  // --- 3. Caricamento e messa in coda ---------------------------------------
  console.log(`\n${B}3 · Documenti caricati e contratti messi in coda${X}`);
  const inCoda: { caso: Caso; contractId: string; documentId: string; linkId: string }[] = [];

  for (const caso of CASI) {
    const t = testi.get(caso.file)!;
    const { data: doc, error: de } = await admin.from('documents').insert({
      company_id: cid, title: caso.file, source_type: 'upload', status: 'completed',
      file_size: t.bytes, mime_type: 'application/pdf',
    }).select('id').single();
    if (de || !doc) throw new Error(`documento ${caso.file}: ${msg(de)}`);

    const { error: xe } = await admin.from('document_extractions').insert({
      document_id: (doc as { id: string }).id, company_id: cid,
      full_text: t.full, pages: t.pages, extraction_method: 'native_pdf',
      page_count: t.pages.length, char_count: t.full.length, truncated: false,
    });
    if (xe) throw new Error(`testo ${caso.file}: ${msg(xe)}`);

    const { data: con, error: coe } = await admin.from('contracts').insert({
      company_id: cid, display_name: caso.nome, contract_type: caso.tipoDocumento,
      created_by: u.user.id,
    }).select('id').single();
    if (coe || !con) throw new Error(`contratto ${caso.file}: ${msg(coe)}`);

    const { data: link, error: le } = await admin.from('contract_documents').insert({
      company_id: cid, contract_id: (con as { id: string }).id,
      document_id: (doc as { id: string }).id,
      relation: 'main_agreement',
      // In `--local` si prende il documento subito, come farebbe
      // `claimNextDocument`: così il worker deployato non lo porta via a metà.
      ...(LOCALE ? { processing_status: 'processing', extraction_attempts: 1 } : {}),
    }).select('id, company_id, contract_id, document_id, relation, extraction_attempts').single();
    if (le || !link) throw new Error(`collegamento ${caso.file}: ${msg(le)}`);

    inCoda.push({
      caso, contractId: (con as { id: string }).id,
      documentId: (doc as { id: string }).id, linkId: (link as { id: string }).id,
    });
    console.log(`  ${G}✓${X} ${caso.nome}`);
  }

  // --- 4. L'estrazione ------------------------------------------------------
  console.log(`\n${B}4 · Estrazione${X}`);
  if (LOCALE) {
    const anthropic = new Anthropic({ apiKey: AI! });
    // ⚠️ `--dump` conserva la risposta GREZZA del modello accanto al verbale
    // scritto. Serve a rispondere alla sola domanda che conta quando un campo è
    // vuoto — «non l'ha detto lui o l'abbiamo scartato noi?» — e a risponderle
    // NELLO STESSO GIRO: due chiamate diverse danno due risposte diverse, e
    // confrontarle porta a incolpare il codice per una variazione del modello.
    const dump = process.argv.slice(2).includes('--dump');
    let quale = 0;
    const deps: ContractDeps = {
      sb: admin as unknown as ServerClient,
      createMessage: async (request) => {
        const m = await anthropic.messages.create(request as never) as never as
          { content: { type: string; text?: string }[] };
        if (dump) {
          const nome = CASI[quale]?.file.replace('.pdf', '') ?? `richiesta-${quale}`;
          writeFileSync(`.temp/grezzo-${nome}.json`,
            m.content.find((b) => b.type === 'text')?.text ?? '');
        }
        quale++;
        return m as never;
      },
      deadlineMs: Date.now() + 10 * 60_000,
    };
    for (const item of inCoda) {
      const t0 = Date.now();
      const row = {
        id: item.linkId, company_id: cid as string, contract_id: item.contractId,
        document_id: item.documentId, relation: 'main_agreement', extraction_attempts: 1,
      } as unknown as ContractDocumentRow;
      const esito = await processContractDocument(deps, row);
      console.log(`  ${esito.kind === 'completed' ? G + '✓' : R + '✗'}${X} ${item.caso.nome}: `
        + `${esito.kind}${'code' in esito ? ` (${esito.code})` : ''} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
  } else {
    console.log(`  ${DIM}in attesa del worker deployato (cron ogni 5 minuti)…${X}`);
    const scadenza = Date.now() + 12 * 60_000;
    let visti = 0;
    while (Date.now() < scadenza && visti < inCoda.length) {
      await new Promise((r) => setTimeout(r, 15_000));
      const { data } = await admin.from('contract_extractions')
        .select('id, contract_id, status').eq('company_id', cid);
      visti = (data ?? []).length;
      const { data: coda } = await admin.from('contract_documents')
        .select('processing_status').eq('company_id', cid);
      const stati = (coda ?? []).map((r) => (r as { processing_status: string }).processing_status);
      console.log(`  ${DIM}${new Date().toISOString().slice(11, 19)} · verbali ${visti}/${inCoda.length} · coda ${stati.join(' ')}${X}`);
    }
    if (visti < inCoda.length) {
      console.log(`  ${Y}⚠ il worker non ha completato tutto entro 12 minuti${X}`);
    }
  }

  // --- 5. La misura ---------------------------------------------------------
  console.log(`\n${B}5 · Tasso di esattezza, campo per campo${X}`);
  const perCampo = new Map<string, { giusti: number; totale: number; errori: string[] }>();
  let giustiTot = 0, totaleTot = 0;

  for (const item of inCoda) {
    const { data } = await admin.from('contract_extractions')
      .select('*').eq('contract_id', item.contractId)
      .order('extraction_version', { ascending: false }).limit(1);
    const est = (data ?? [])[0] as Record<string, unknown> | undefined;

    console.log(`\n  ${B}${item.caso.nome}${X}`);
    if (!est) { console.log(`    ${R}✗ nessun verbale scritto${X}`); continue; }
    if (est.status !== 'completed') {
      console.log(`    ${R}✗ verbale ${est.status} (${est.error_code ?? '—'})${X}`);
      continue;
    }
    console.log(`    ${DIM}modello ${est.model} · prompt ${est.prompt_version} · ${est.duration_ms} ms · `
      + `${est.input_tokens}→${est.output_tokens} token · flag: ${JSON.stringify(est.quality_flags)}${X}`);

    for (const [campo, atteso] of Object.entries(item.caso.atteso)) {
      const letto = est[campo];
      const giusto = confronta(letto, atteso as Atteso);
      const agg = perCampo.get(campo) ?? { giusti: 0, totale: 0, errori: [] };
      agg.totale++; totaleTot++;
      if (giusto) { agg.giusti++; giustiTot++; } else {
        agg.errori.push(`${item.caso.file}: letto ${JSON.stringify(letto)}, atteso ${JSON.stringify(atteso)}`);
      }
      perCampo.set(campo, agg);
      if (!giusto) {
        // ⚠️ Un campo vuoto ha DUE cause opposte, e distinguerle è tutto il
        // valore di questa riga: o il modello non ha risposto, o abbiamo
        // scartato noi la sua risposta. `field_sources` porta il nome del campo
        // solo se il valore è arrivato ed è sopravvissuto alla validazione.
        const fonti = (est.field_sources ?? {}) as Record<string, string>;
        const conf = (est.field_confidence ?? {}) as Record<string, number>;
        const base = campo.replace(/_(value|unit)$/, '').replace(/^notice_anchor_text$/, 'notice_anchor');
        const arrivato = base in fonti || campo in fonti;
        console.log(`    ${R}✗ ${campo}${X} ${DIM}letto ${JSON.stringify(letto)} · atteso ${JSON.stringify(atteso)}`
          + ` · dal modello: ${arrivato ? `sì (fiducia ${conf[base] ?? conf[campo]})` : 'non registrato'}${X}`);
      }
    }
    const pen = Array.isArray(est.penalties) ? est.penalties.length : 0;
    const att = Array.isArray(est.attention_clauses) ? est.attention_clauses.length : 0;
    const obb = Array.isArray(est.obligations) ? est.obligations.length : 0;
    const all = Array.isArray(est.referenced_annexes) ? est.referenced_annexes.length : 0;
    console.log(`    ${DIM}elenchi: ${obb} obblighi · ${att} clausole · ${pen} penali · ${all} allegati${X}`);
  }

  console.log(`\n${B}  Riepilogo per campo${X}`);
  const righe = [...perCampo.entries()].sort((a, b) => (a[1].giusti / a[1].totale) - (b[1].giusti / b[1].totale));
  for (const [campo, v] of righe) {
    const colore = v.giusti === v.totale ? G : v.giusti === 0 ? R : Y;
    console.log(`    ${colore}${String(v.giusti)}/${v.totale}${X}  ${campo}`);
  }
  const perc = totaleTot ? Math.round((giustiTot / totaleTot) * 1000) / 10 : 0;
  console.log(`\n  ${B}${giustiTot}/${totaleTot} campi esatti — ${perc}%${X}`);

  // --- 6. La pulizia, verificata -------------------------------------------
  console.log(`\n${B}6 · Eliminazione dei dati di prova${X}`);
  const pulito = await pulisci();
  const { data: restanti } = await admin.from('contract_extractions').select('id').eq('company_id', cid);
  const { data: aziendaRimasta } = await admin.from('companies').select('id').eq('id', cid);
  const { data: docRimasti } = await admin.from('documents').select('id').eq('company_id', cid);
  const residui = (restanti?.length ?? 0) + (aziendaRimasta?.length ?? 0) + (docRimasti?.length ?? 0);
  console.log(`  ${pulito && residui === 0 ? G + '✓' : R + '✗'}${X} cancellazione`
    + ` · verbali residui ${restanti?.length ?? 0} · documenti ${docRimasti?.length ?? 0} · aziende ${aziendaRimasta?.length ?? 0}`);

  const esitoRosso = !pulito || residui > 0 || giustiTot < totaleTot;
  console.log();
  process.exit(esitoRosso ? 1 : 0);
}

main().catch(async (e) => {
  console.error(`\n${R}Errore: ${msg(e)}${X}`);
  const pulito = await pulisci().catch(() => false);
  console.error(pulito ? `${G}i dati di prova sono stati rimossi${X}` : `${R}⚠ PULIZIA NON RIUSCITA: controllare a mano${X}`);
  process.exit(1);
});
