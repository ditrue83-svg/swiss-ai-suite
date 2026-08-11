// ============================================================================
// eval:stability — la STESSA domanda N volte, e quanto le risposte divergono.
//   npm run eval:stability                 # 5 ripetizioni sul caso reale
//   npm run eval:stability -- --n 10       # più ripetizioni (spende di più)
//   npm run eval:stability -- --self-test  # la matematica, senza spendere niente
//
// ⚠️⚠️ PERCHÉ ESISTE. Fino al 2026-08-11 questo repository misurava l'ESATTEZZA
// del classificatore — `eval:admin` verifica che i fatti estratti siano quelli
// giusti — e non misurava la STABILITÀ. Sono due domande diverse, e la seconda
// era già rossa in produzione senza che nessuno la ponesse.
//
// La misura che l'ha reso evidente: quattordici email di `notifications@stripe.com`
// con lo stesso oggetto e corpi che differiscono di poche decine di caratteri
// (1576–1727) hanno prodotto **tre tipi di documento diversi** — 11 volte
// «richiesta di documenti», 1 «comunicazione informativa», 1 «altro». Non è un
// errore di esattezza su un caso difficile: è la stessa domanda che riceve
// risposte diverse, e un'esattezza misurata una volta sola su una risposta che
// varia non dice niente su quella dopo.
//
// COSA SI MISURA, e perché non è «quante volte ha indovinato»
//   · la QUOTA MODALE: la frazione di risposte uguali alla più frequente. 1.0 =
//     sempre la stessa; 0.5 = una moneta.
//   · il numero di VALORI DISTINTI. Due risposte diverse su un campo enumerato
//     sono già un problema: significa che il campo non è determinato dal testo.
//   · l'ENTROPIA normalizzata: distingue «12 volte A e 1 volta B» da «7 A e 6 B»,
//     che la sola quota modale confonderebbe.
// Nessuna delle tre dice se la risposta è GIUSTA. Dicono se è la stessa.
//
// ⚠️ E LA SOGLIA È UNA DICHIARAZIONE, non una legge di natura. `SOGLIA_MODALE`
// dice quale instabilità siamo disposti ad accettare su un campo enumerato che
// finisce in un cruscotto operativo. Oggi è 1.0 sul tipo di documento — cioè
// nessuna: un documento che cambia categoria a ogni lettura non è classificato,
// è sorteggiato.
// ============================================================================
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[1m', DIM = '\x1b[2m', X = '\x1b[0m';

// ---------------------------------------------------------------------------
// LA MATEMATICA — pura, e provata senza spendere un centesimo.
// ---------------------------------------------------------------------------
export interface Dispersione {
  n: number;
  distinti: number;
  quotaModale: number;
  modale: string | null;
  entropia: number;
  conteggi: Record<string, number>;
}

/**
 * La dispersione di un insieme di risposte.
 *
 * ⚠️ `null` e `undefined` NON vengono scartati: diventano la stringa «(nessuno)».
 * Una risposta che a volte c'è e a volte no è instabile esattamente quanto una
 * che cambia valore — scartarla farebbe sembrare stabile il caso peggiore.
 */
export function dispersione(risposte: readonly (string | null | undefined)[]): Dispersione {
  const n = risposte.length;
  if (n === 0) return { n: 0, distinti: 0, quotaModale: 1, modale: null, entropia: 0, conteggi: {} };

  const conteggi: Record<string, number> = {};
  for (const r of risposte) {
    const k = r ?? '(nessuno)';
    conteggi[k] = (conteggi[k] ?? 0) + 1;
  }
  const voci = Object.entries(conteggi).sort((a, b) => b[1] - a[1]);
  const [modale, freq] = voci[0];

  // Entropia di Shannon normalizzata su log2(distinti): 0 = una sola risposta,
  // 1 = tutte le risposte equiprobabili. Con un solo valore distinto il
  // denominatore sarebbe 0: lì l'entropia è 0 per definizione, non NaN.
  const distinti = voci.length;
  const entropiaGrezza = -voci.reduce((s, [, c]) => {
    const p = c / n;
    return s + p * Math.log2(p);
  }, 0);
  const entropia = distinti <= 1 ? 0 : entropiaGrezza / Math.log2(distinti);

  return { n, distinti, quotaModale: freq / n, modale, entropia, conteggi };
}

/** Quanto una risposta deve essere costante perché la si possa usare. */
export const SOGLIA_MODALE: Record<string, number> = {
  // ⚠️ 1.0, cioè NESSUNA variazione ammessa. Il tipo pilota le automazioni
  // (`analysis.document_type` è un campo di condizione in registry.ts) e compare
  // in «Da gestire»: se cambia a ogni lettura, ogni regola scritta su di esso
  // si accende a caso.
  documentType: 1.0,
  // La lingua è una proprietà del testo, non un giudizio: o si riconosce o no.
  language: 1.0,
  // La scadenza decide se compare un'attività con una data. Una scadenza che
  // appare a intermittenza è peggio di una che non appare mai.
  deadlinePresente: 1.0,
  // Il riassunto è prosa: cambia di sicuro, e non è questo il campo da misurare.
  // Sta qui per dire che è stato ESCLUSO di proposito, non dimenticato.
  summaryShort: 0,
};

export interface EsitoCampo {
  campo: string;
  dispersione: Dispersione;
  soglia: number;
  passa: boolean;
}

export function valuta(rispostePerCampo: Record<string, readonly (string | null | undefined)[]>): EsitoCampo[] {
  return Object.entries(rispostePerCampo).map(([campo, risposte]) => {
    const d = dispersione(risposte);
    const soglia = SOGLIA_MODALE[campo] ?? 0;
    return { campo, dispersione: d, soglia, passa: d.quotaModale >= soglia };
  });
}

export function riga(e: EsitoCampo): string {
  const d = e.dispersione;
  const simbolo = e.passa ? `${G}✓${X}` : `${R}✗${X}`;
  const valori = Object.entries(d.conteggi).sort((a, b) => b[1] - a[1])
    .map(([k, c]) => `${k}×${c}`).join('  ');
  return `  ${simbolo} ${e.campo.padEnd(17)} quota modale ${d.quotaModale.toFixed(2)} `
    + `(soglia ${e.soglia.toFixed(2)}) · ${d.distinti} distinti · entropia ${d.entropia.toFixed(2)}\n`
    + `      ${DIM}${valori}${X}`;
}

// ---------------------------------------------------------------------------
// Autoverifica della matematica. Nessuna rete, nessun credito.
// ---------------------------------------------------------------------------
if (process.argv.includes('--self-test')) {
  let pass = 0, fail = 0;
  const ok = (c: boolean, l: string, d = '') => {
    if (c) { pass++; console.log(`  ${G}✓${X} ${l}${d ? ` ${DIM}— ${d}${X}` : ''}`); }
    else { fail++; console.error(`  ${R}✗${X} ${l}${d ? ` — ${d}` : ''}`); }
  };
  console.log(`\n${B}eval:stability — autoverifica della matematica${X}\n`);

  const uguali = dispersione(['a', 'a', 'a', 'a']);
  ok(uguali.quotaModale === 1 && uguali.distinti === 1 && uguali.entropia === 0,
    'quattro risposte uguali: quota 1, un solo valore, entropia 0');

  const moneta = dispersione(['a', 'b', 'a', 'b']);
  ok(moneta.quotaModale === 0.5 && moneta.entropia === 1,
    'due risposte metà e metà: quota 0.5, entropia massima');

  // ⚠️ IL CASO REALE, con i numeri veri del 2026-08-11.
  const reale = dispersione([
    ...Array(11).fill('request_for_documents'), 'information', 'other',
  ]);
  ok(reale.distinti === 3 && Math.abs(reale.quotaModale - 11 / 13) < 1e-9,
    'i 13 casi Stripe: 3 tipi distinti, quota modale 11/13', reale.quotaModale.toFixed(3));
  ok(reale.quotaModale < SOGLIA_MODALE.documentType,
    '…e sotto la soglia: questa misura sarebbe uscita ROSSA il giorno stesso');

  // La coppia che distingue le due forme di instabilità che la sola quota modale
  // confonderebbe: stesso numero di distinti, dispersione ben diversa.
  const quasiStabile = dispersione([...Array(12).fill('a'), 'b']);
  const bilanciato = dispersione([...Array(7).fill('a'), ...Array(6).fill('b')]);
  ok(quasiStabile.distinti === bilanciato.distinti && quasiStabile.entropia < bilanciato.entropia,
    'stesso numero di valori distinti, entropie diverse: «12 e 1» non è «7 e 6»',
    `${quasiStabile.entropia.toFixed(2)} < ${bilanciato.entropia.toFixed(2)}`);

  // ⚠️ L'assenza è una risposta. Se la scartassimo, un campo che compare a
  // intermittenza sembrerebbe stabilissimo — il caso peggiore travestito da migliore.
  const intermittente = dispersione(['2027-01-22', null, '2027-01-22', undefined]);
  ok(intermittente.distinti === 2 && intermittente.conteggi['(nessuno)'] === 2,
    'una risposta che a volte manca è instabile, non assente: «(nessuno)» conta come valore');

  ok(dispersione([]).quotaModale === 1 && dispersione([]).distinti === 0,
    'nessuna risposta: non si divide per zero e non si inventa instabilità');

  const esiti = valuta({ documentType: ['a', 'b'], summaryShort: ['x', 'y', 'z'] });
  ok(esiti.find((e) => e.campo === 'documentType')?.passa === false,
    'il tipo di documento con due valori NON passa');
  ok(esiti.find((e) => e.campo === 'summaryShort')?.passa === true,
    'CONTROPROVA: il riassunto è prosa, varia di diritto — soglia 0, e passa');

  console.log(`\n  ${pass} superati${fail ? `, ${R}${fail} falliti${X}` : ''}\n`);
  process.exit(fail ? 1 : 0);
}

// ---------------------------------------------------------------------------
// L'esecuzione vera: N analisi dello STESSO testo, contro l'API reale.
// ---------------------------------------------------------------------------
const argN = process.argv.indexOf('--n');
const N = argN > 0 ? Math.max(2, Number(process.argv[argN + 1]) || 5) : 5;

const FIXTURE = resolve(HERE, 'fixtures/stripe-instabilita.json');
const dati = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  casi: { id: string; oggetto: string; corpo: string; mittente: string;
    esitoOsservato: { documentType: string | null; language: string | null } }[];
};

const caso = dati.casi[0];
const testo = `Da: ${caso.mittente}\nOggetto: ${caso.oggetto}\n\n${caso.corpo}`;

console.log(`\n${B}Stabilità del classificatore${X}`);
console.log(`${DIM}Lo stesso testo, ${N} volte. Caso «${caso.id}» — ${caso.oggetto.slice(0, 54)}${X}`);
console.log(`${DIM}In produzione, il 2026-08-11, questo messaggio e i suoi tredici gemelli hanno`);
console.log(`prodotto tre tipi diversi. Qui si misura se la variazione è ancora lì.${X}\n`);

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error(`${R}ANTHROPIC_API_KEY assente: non si misura niente e non si finge di averlo fatto.${X}\n`);
  process.exit(3);
}

const [{ default: Anthropic }, { buildAnalysisRequest }, { validateAndNormalize }] = await Promise.all([
  import('@anthropic-ai/sdk'),
  import('../supabase/functions/_shared/prompt.ts'),
  import('../supabase/functions/_shared/validate.ts'),
]);

const client = new Anthropic({ apiKey: key });
const estrazione = { fullText: testo, pages: [{ pageNumber: 1, text: testo }], extractionMethod: 'text' as const };

const raccolte: Record<string, (string | null)[]> = {
  documentType: [], language: [], deadlinePresente: [], summaryShort: [],
};

for (let i = 0; i < N; i++) {
  const req = buildAnalysisRequest(testo, {
    legalName: 'Azienda Esempio SA', canton: 'TI', municipality: 'Lugano',
    legalForm: 'SA', sector: null,
  }, '2026-08-11', 'it');

  const risposta = await client.messages.create(req as never);
  const testoRisposta = (risposta as { content: { type: string; text?: string }[] }).content
    .filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');

  let normalizzata: ReturnType<typeof validateAndNormalize> | null = null;
  try {
    const grezzo = JSON.parse(testoRisposta.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    normalizzata = validateAndNormalize(grezzo, estrazione);
  } catch {
    // ⚠️ Una risposta illeggibile NON si salta: è il grado massimo di
    // instabilità, e saltarla migliorerebbe il punteggio proprio nel caso
    // peggiore. Entra come «(illeggibile)».
  }

  raccolte.documentType.push(normalizzata?.documentType.value ?? '(illeggibile)');
  raccolte.language.push(normalizzata?.language ?? '(illeggibile)');
  raccolte.deadlinePresente.push(normalizzata ? String(normalizzata.deadline.date !== null) : '(illeggibile)');
  raccolte.summaryShort.push(normalizzata?.summary ?? '(illeggibile)');
  process.stdout.write(`  ${DIM}${i + 1}/${N}${X}\r`);
}

const esiti = valuta(raccolte);
console.log('');
for (const e of esiti) console.log(riga(e));

const falliti = esiti.filter((e) => !e.passa);
console.log('');
console.log(`  ${DIM}Esito osservato in produzione lo stesso giorno: `
  + `${caso.esitoOsservato.documentType} · lingua ${caso.esitoOsservato.language}${X}`);
if (falliti.length === 0) {
  console.log(`\n  ${G}Stabile su ${N} ripetizioni${X} — ogni campo enumerato ha dato sempre la stessa risposta.`);
  console.log(`  ${DIM}⚠️ «Stabile» non vuol dire «giusto»: l'esattezza la misura eval:admin.${X}\n`);
  process.exit(0);
}
console.error(`\n  ${R}${falliti.length} campi instabili su ${esiti.length}${X} — `
  + `la stessa domanda ha ricevuto risposte diverse in ${N} tentativi.`);
console.error(`  ${Y}Un campo enumerato che varia non è classificato: è sorteggiato.${X}\n`);
process.exit(1);
