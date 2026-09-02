// ============================================================================
// AI-Swisse — Stampa / esportazione PDF: test OFFLINE.
//   npm run test:print-unit
//
// Niente database, niente rete, niente credito. Prova le tre cose che il caso
// d'uso — una fiduciaria archivia il foglio nel fascicolo del cliente — non
// perdona, e che nessun altro controllo vede:
//
//   1. NAVIGAZIONE — ciò che è comando non finisce su carta.
//   2. TEMA SCURO — il foglio resta bianco anche se il sistema è in scuro.
//      ⚠️ È l'errore più probabile della funzione, e non dipende da una regola
//      ma dall'ORDINE delle due media query: a parità di specificità (`:root`)
//      vince l'ultima scritta. Un controllo che guardasse solo «esiste una
//      regola che mette il fondo bianco» direbbe verde con la pagina nera.
//   3. CITAZIONI — la frase del documento è nel foglio, per esteso.
//
// ⚠️ Il CSS si LEGGE DAI FILE, non si descrive a mano: un elenco di selettori
// copiato qui dentro invecchia al primo ritocco del foglio di stile e comincia
// a garantire una cosa che non c'è più.
// ============================================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CONTRACT_EVIDENCE_LABELS, amountTypeKey, buildFooter, collectCitations,
  contractCitations, deadlineKindKey, splitActions,
} from '../src/features/print/printModel.ts';
import { it as dictIt } from '../src/i18n/locales/it.ts';
import { de as dictDe } from '../src/i18n/locales/de.ts';
import { fr as dictFr } from '../src/i18n/locales/fr.ts';
import type { ChecklistAction, DocumentAnalysis, Evidence } from '../src/types/models.ts';

const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${name}`); }
  else { fail++; console.log(`  ${R}✗ ${name}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);

const HERE = dirname(fileURLToPath(import.meta.url));
/**
 * ⚠️ I COMMENTI SI TOLGONO PRIMA DI ANALIZZARE, e la prima versione di questo
 * file non lo faceva: il commento che precede un gruppo di selettori finiva
 * dentro il PRIMO selettore del gruppo, così `.sidebar` risultava «non
 * nascosto» mentre la regola lo nascondeva benissimo. Un rosso falso vale un
 * verde falso — insegna a non fidarsi dei rossi.
 * Gli offset restano coerenti perché il confronto d'ordine avviene fra due
 * posizioni della STESSA stringa ripulita.
 */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const readCss = (f: string) => stripComments(readFileSync(join(HERE, '..', 'src', 'styles', f), 'utf8'));
// ⚠️ DAL 2026-08-28 (issue #83) le regole di stampa delle FEATURE vivono nei
// moduli CSS delle feature, dove il riferimento alla classe locale funziona:
// un controllo che le cercasse solo nei globali dichiarerebbe morte regole
// vive — la regressione che questo riallineo chiude.
const readMod = (f: string) => stripComments(readFileSync(join(HERE, '..', 'src', 'features', f), 'utf8'));
const APP = readCss('app.css');
const EXTRA = readCss('extra.css');
const PRINT_MOD = readMod('print/print.module.css');
const ADMIN_AI = readMod('admin-ai/admin-ai.module.css');
const CONTRACTS = readMod('contracts/contracts.module.css');

/**
 * Il corpo di un blocco `@media …`, contando le graffe.
 *
 * ⚠️ Non una regexp non greedy: dentro `@media print` ci sono decine di regole
 * con le loro graffe, e `[\s\S]*?}` si fermerebbe alla PRIMA — restituendo un
 * blocco lungo tre righe su cui ogni asserzione successiva sarebbe falsa senza
 * che nessuno se ne accorga.
 */
function mediaBlock(css: string, condition: string): { body: string; start: number } | null {
  const at = css.indexOf(`@media ${condition}`);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return { body: css.slice(open + 1, i), start: at };
    }
  }
  return null;
}

const printApp = mediaBlock(APP, 'print');
const printExtra = mediaBlock(EXTRA, 'print');
const printPrintMod = mediaBlock(PRINT_MOD, 'print');
const printAdminAi = mediaBlock(ADMIN_AI, 'print');
const printContracts = mediaBlock(CONTRACTS, 'print');

/**
 * Il blocco del TEMA SCURO.
 *
 * ⚠️ Dal 2026-08-16 non è più `@media (prefers-color-scheme: dark)`: il tema lo
 * sceglie l'app, e lo scuro è `:root[data-theme="dark"]`. Qui non si cerca più
 * una media query — si cerca quel selettore, e si prende il blocco per intero
 * con lo stesso conteggio di graffe, per la stessa ragione di `mediaBlock`.
 */
function selectorBlock(css: string, selector: string): { body: string; start: number } | null {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) return { body: css.slice(open + 1, i), start: at }; }
  }
  return null;
}
const darkApp = selectorBlock(APP, ':root[data-theme="dark"]');

// ---------------------------------------------------------------------------
section('0. I blocchi ci sono, e il lettore li ha letti davvero');

check('app.css ha un blocco @media print', printApp !== null);
check('extra.css ha un blocco @media print', printExtra !== null);
check('print.module.css ha un blocco @media print', printPrintMod !== null);
check('admin-ai.module.css ha un blocco @media print', printAdminAi !== null);
check('contracts.module.css ha un blocco @media print', printContracts !== null);
check('app.css ha ancora il blocco del tema scuro', darkApp !== null);
// ⚠️ Se l'estrattore prendesse tre righe invece del blocco intero, tutte le
// asserzioni qui sotto passerebbero o fallirebbero per la ragione sbagliata.
check('il blocco di stampa è stato estratto per intero, non troncato alla prima graffa',
  (printApp?.body.length ?? 0) > 1200, `lunghezza estratta: ${printApp?.body.length ?? 0}`);

const P = printApp?.body ?? '';
const PX = printExtra?.body ?? '';
const PM = printPrintMod?.body ?? '';

// ---------------------------------------------------------------------------
section('1. Navigazione e comandi: fuori dalla carta');

// I selettori si leggono DALLA regola che li nasconde, non da un elenco scritto
// qui: se domani la regola perde `.sidebar`, questo test lo vede.
const hidden = new Set<string>();
for (const m of P.matchAll(/([^{}]+)\{[^{}]*display:\s*none[^{}]*\}/g)) {
  for (const sel of m[1]!.split(',')) hidden.add(sel.trim());
}
const MUST_HIDE = ['.sidebar', '.topbar', '.drawer', '.nav', '.nav-btn', '.company-switch',
  '.account-box', '.toast', '.btn', 'button', '.no-print'];
for (const sel of MUST_HIDE) {
  check(`in stampa «${sel}» è nascosto`, hidden.has(sel),
    `selettori nascosti trovati: ${[...hidden].join(', ') || 'nessuno'}`);
}
check('il selettore di lingua sparisce col suo contenitore, o esplicitamente',
  hidden.has('.no-print'), 'LanguageSwitcher sta dentro .sidebar/.account-box, entrambi nascosti');
// ⚠️ `.print-only` è migrata il 2026-08-28 in `print/print.module.css` (issue
// #83): è la sola classe usata dalla sola feature `print`. Le due facce della
// regola — nascosta a schermo, visibile su carta — si leggono lì.
check('`.print-only` è nascosto FUORI dalla stampa (print.module.css)',
  /\.print-only\s*\{\s*display:\s*none/.test(PRINT_MOD.slice(0, printPrintMod?.start ?? PRINT_MOD.length)));
check('`.print-only` compare DENTRO la stampa (print.module.css)',
  /\.print-only\s*\{[^}]*display:\s*block/.test(PM));

// ---------------------------------------------------------------------------
section('2. Tema scuro: il foglio resta bianco');

// ⚠️⚠️ LE DUE ASSERZIONI CHE DECIDONO DAVVERO — e dal 2026-08-16 sono DUE.
//
// Prima il tema scuro era `@media (prefers-color-scheme: dark) { :root { … } }`:
// selettore `:root`, specificità (0,1,0), identica a quella della stampa. Fra
// due dichiarazioni di pari specificità vince quella scritta DOPO, e bastava
// tenere il blocco di stampa in fondo.
//
// Ora lo scuro è `:root[data-theme="dark"]` — specificità (0,2,0) — e su `:root`
// nudo VINCE PER SPECIFICITÀ, dovunque stia nel file. Stampando da un tema scuro
// sarebbe uscito un foglio nero con il blocco al suo posto e questo file tutto
// verde. Il rimedio è nel selettore della stampa, `:root, :root[data-theme]`, che
// pareggia (0,2,0) e restituisce la decisione all'ordine.
//
// Servono quindi entrambe: la stampa pareggia la specificità, E viene dopo.
check('⚠️ il selettore della stampa pareggia la specificità del tema scuro',
  /:root,\s*:root\[data-theme\]\s*\{/.test(P.slice(0, 200)) || /:root,\s*:root\[data-theme\]\s*\{/.test(P),
  'atteso «:root, :root[data-theme] {» in cima al blocco di stampa');
check('⚠️ il blocco di stampa viene DOPO quello del tema scuro (a pari specificità decide l’ordine)',
  (printApp?.start ?? -1) > (darkApp?.start ?? Infinity),
  `stampa a ${printApp?.start}, scuro a ${darkApp?.start}`);

// ⚠️ CONTROPROVA DEL LETTORE: il blocco scuro trovato deve essere quello VERO,
// non tre righe. Se `selectorBlock` sbagliasse, l'asserzione sull'ordine sarebbe
// verde per la ragione sbagliata.
check('il blocco del tema scuro è stato estratto per intero',
  (darkApp?.body.length ?? 0) > 1000 && /--bg:/.test(darkApp?.body ?? ''),
  `lunghezza estratta: ${darkApp?.body.length ?? 0}`);

const printRoot = /:root,\s*:root\[data-theme\]\s*\{([^}]*)\}/.exec(P)?.[1] ?? '';
const token = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(printRoot)?.[1]?.trim() ?? null;
const isWhite = (v: string | null) => v !== null && /^(#fff(fff)?|white|rgb\(255,\s*255,\s*255\))$/i.test(v);
const isBlack = (v: string | null) => v !== null && /^(#000(000)?|black|rgb\(0,\s*0,\s*0\))$/i.test(v);

check('in stampa `--bg` è bianco', isWhite(token('bg')), `letto: ${token('bg')}`);
check('in stampa `--card` è bianco', isWhite(token('card')), `letto: ${token('card')}`);
check('in stampa `--ink` è nero', isBlack(token('ink')), `letto: ${token('ink')}`);
check('in stampa `--accent-soft` non resta un fondo scuro', isWhite(token('accent-soft')), `letto: ${token('accent-soft')}`);
check('body forza fondo bianco e testo nero con !important',
  /html,\s*body\s*\{[^}]*background:\s*#ffffff\s*!important[^}]*color:\s*#000000\s*!important/.test(P));

// I token scuri NON devono comparire dentro il blocco di stampa.
check('nessun token di stampa resta su un valore scuro',
  !/--(bg|card|surface-2):\s*hsl\(\s*21[0-9]/.test(printRoot), printRoot.slice(0, 120));

// ---------------------------------------------------------------------------
section('3. Niente si spezza, niente viene tagliato');

check('le schede non si spezzano fra due pagine', /\.card[^{]*\{[^}]*break-inside:\s*avoid/.test(P));
check('c’è anche `page-break-inside`, per i motori che ignorano il moderno',
  /page-break-inside:\s*avoid/.test(P));
check('gli overflow vengono neutralizzati ovunque, non solo sul contenitore',
  /\*,[\s\S]{0,80}\{[^}]*overflow:\s*visible\s*!important/.test(P));
check('le altezze massime non tagliano il contenuto', /max-height:\s*none\s*!important/.test(P));
check('il contenitore principale perde l’altezza fissa',
  /\.main[\s\S]{0,200}height:\s*auto\s*!important/.test(P));
// ⚠️ Un `overflow: hidden` DENTRO il blocco di stampa rimetterebbe la
// ghigliottina che le righe sopra tolgono.
check('nel blocco di stampa non compare nessun `overflow: hidden`',
  !/overflow:\s*hidden/.test(P) && !/overflow:\s*hidden/.test(PX));
check('i moduli non si spezzano (extra.css)', /break-inside:\s*avoid/.test(PX));
// ⚠️ LE REGOLE DELLE FEATURE VIVONO NEI MODULI dal 2026-08-28 (issue #83): con
// i CSS Modules il selettore globale non aggancia più le classi hashate — era
// la regressione di stampa della migrazione. Qui si controlla che ogni regola
// migrata esista nel modulo della sua feature e punti alla classe locale.
// `.doc-viewer`/`.pdf-viewer`, che il blocco globale nominava accanto ad
// `.ax-doc`, non ci sono più: mai definiti in nessun foglio, mai scritti da
// nessun componente — erano selettori morti, cancellati nello sweep.
check('le schede dell’analisi non si spezzano (admin-ai.module.css)',
  /\.ax-header[\s\S]{0,120}break-inside:\s*avoid/.test(printAdminAi?.body ?? '')
    && /\.ax-actions-card/.test(printAdminAi?.body ?? ''));
check('il visualizzatore del documento non va su carta (`.ax-doc`, admin-ai.module.css)',
  /\.ax-doc\s*\{[^}]*display:\s*none/.test(printAdminAi?.body ?? ''),
  'era `.doc-viewer`/`.pdf-viewer`/`.ax-doc` in extra.css: i primi due erano morti, `.ax-doc` è la classe viva');
check('le righe documento/scadenza del contratto non si spezzano (contracts.module.css)',
  /\.ct-doc-row[\s\S]{0,140}break-inside:\s*avoid/.test(printContracts?.body ?? '')
    && /\.ct-ms-row/.test(printContracts?.body ?? ''));
// La controprova della migrazione: il blocco GLOBALE non deve più nominare le
// classi scopate — se tornasse, tornerebbe il selettore che non aggancia.
check('il blocco globale non nomina più classi scopate nei moduli',
  !/\.ax-header|\.ax-actions-card|\.ax-doc|\.ct-doc-row|\.ct-ms-row|\.doc-viewer|\.pdf-viewer/.test(PX));

// ---------------------------------------------------------------------------
section('4. Le citazioni finiscono nel foglio, per esteso');

const ev = (quote: string, page: number | null = null): Evidence => ({ quote, start: 0, end: quote.length, pageNumber: page });
const action = (id: number, text: string, sourceType: 'extracted' | 'suggested', quote: string | null): ChecklistAction =>
  ({ id, text, done: false, sourceType, evidence: quote ? ev(quote) : null });

const analysis = {
  senderEvidence: ev('Amministrazione federale delle contribuzioni', 1),
  deadlineEvidence: ev('entro il 30 settembre 2026'),
  amountEvidence: ev('CHF 1’240.00'),
  actions: [
    action(1, 'Pagare l’importo', 'extracted', 'il pagamento va effettuato entro il termine'),
    action(2, 'Metterlo in scadenzario', 'suggested', null),
  ],
  requestedDocuments: [{ label: 'Estratto conto', evidence: ev('si richiede l’estratto conto') }],
  amounts: [{ amount: 1240, currency: 'CHF', type: 'due', description: 'Imposta dovuta', display: 'CHF 1’240.00', evidence: ev('CHF 1’240.00') }],
  referenceNumbers: [{ label: 'Rif.', value: 'AFC-2026-001', evidence: ev('Rif. AFC-2026-001') }],
  legalReferences: [{ text: 'art. 12 LIVA', evidence: ev('ai sensi dell’art. 12 LIVA') }],
  risks: [{ text: 'Interessi di mora', level: 'explicit' as const, evidence: ev('in caso di ritardo sono dovuti interessi') }],
} as unknown as DocumentAnalysis;

const cits = collectCitations(analysis);
check('ogni citazione dell’analisi finisce nell’elenco', cits.length === 8, `trovate ${cits.length}`);
check('le frasi sono INTERE, mai troncate',
  cits.every((c) => !c.quote.endsWith('…') && !c.quote.endsWith('...')));
check('la frase del mittente è quella del documento',
  cits[0]?.quote === 'Amministrazione federale delle contribuzioni');
check('la pagina viaggia con la citazione, quando c’è', cits[0]?.page === 1);
check('un’azione senza citazione non produce una riga vuota',
  !cits.some((c) => c.quote.trim() === ''));
check('la stessa frase non si stampa due volte',
  new Set(cits.map((c) => `${c.labelKey}|${c.quote}`)).size === cits.length);
check('l’ordine è stabile fra due chiamate',
  JSON.stringify(collectCitations(analysis)) === JSON.stringify(cits));
check('un’analisi senza citazioni dà un elenco vuoto, non una riga finta',
  collectCitations({ senderEvidence: null, deadlineEvidence: null, amountEvidence: null,
    actions: [], requestedDocuments: [], amounts: [], referenceNumbers: [],
    legalReferences: [], risks: [] } as unknown as DocumentAnalysis).length === 0);

const contractCits = contractCitations({
  start_date: { quote: 'Il contratto decorre dal 1° gennaio 2026' },
  notice_period: { quote: 'con preavviso di tre mesi', page: 2 },
  campo_nuovo: { quote: 'clausola sconosciuta al modello' },
  vuoto: { quote: '   ' },
});
check('le citazioni del contratto usano le etichette già in uso a schermo',
  contractCits.some((c) => c.labelKey === CONTRACT_EVIDENCE_LABELS.start_date));
check('⚠️ un campo SCONOSCIUTO non si perde: si stampa col suo nome tecnico',
  contractCits.some((c) => c.subject === 'campo_nuovo'));
check('una citazione vuota non entra', !contractCits.some((c) => c.quote.trim() === ''));
check('l’ordine dei campi del contratto è stabile',
  JSON.stringify(contractCitations({ b: { quote: 'due' }, a: { quote: 'uno' } }).map((c) => c.quote)) === '["uno","due"]');

// ---------------------------------------------------------------------------
section('5. Ciò che la carta deve distinguere');

const split = splitActions(analysis.actions);
check('le azioni richieste dal documento sono separate dai suggerimenti',
  split.requested.length === 1 && split.suggested.length === 1);
check('un’azione senza provenienza nota NON diventa «richiesta dal documento»',
  splitActions([action(3, 'x', 'boh' as unknown as 'suggested', null)]).requested.length === 0);

check('«da verificare» vince sul tipo dichiarato',
  deadlineKindKey({ deadline: '2026-09-30', deadlineType: 'explicit', deadlineRequiresVerification: true } as DocumentAnalysis)
  === 'print.deadline.toVerify');
check('una scadenza esplicita si dichiara esplicita',
  deadlineKindKey({ deadline: '2026-09-30', deadlineType: 'explicit', deadlineRequiresVerification: false } as DocumentAnalysis)
  === 'print.deadline.explicit');
check('un tipo NON dichiarato non riceve un’etichetta inventata',
  deadlineKindKey({ deadline: '2026-09-30', deadlineType: null, deadlineRequiresVerification: false } as DocumentAnalysis) === null);
check('senza scadenza non c’è tipo', deadlineKindKey({ deadline: null, deadlineType: 'explicit', deadlineRequiresVerification: false } as DocumentAnalysis) === null);
check('il tipo dell’importo è tradotto solo se noto',
  amountTypeKey('due') === 'print.amountType.due' && amountTypeKey('inventato') === null && amountTypeKey(null) === null);

const foot = buildFooter({ companyName: '  Rossi SA  ', now: new Date('2026-08-07T10:00:00Z'), engine: 'claude-opus-5', analysisVersion: 2 });
check('il piè di pagina porta azienda, istante, motore e versione',
  foot.companyName === 'Rossi SA' && foot.printedAt === '2026-08-07T10:00:00.000Z'
  && foot.model === 'claude-opus-5' && foot.version === 'v2');
check('senza modello dichiarato non se ne inventa uno',
  buildFooter({ companyName: 'X', now: new Date(), engine: null }).model === null);

// ---------------------------------------------------------------------------
section('6. Le etichette esistono nelle tre lingue');

const dicts = { it: dictIt, de: dictDe, fr: dictFr } as const;
const label = (d: typeof dictIt, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[k] : undefined), d);

// Le chiavi si raccolgono da ciò che il codice USA davvero, non da un elenco.
const usedKeys = new Set<string>([
  ...cits.map((c) => c.labelKey as string),
  ...contractCits.map((c) => c.labelKey as string),
  'print.deadline.toVerify', 'print.deadline.explicit', 'print.deadline.relative',
  'print.amountType.due', 'print.amountType.fine', 'print.amountType.fee',
  'print.amountType.contribution', 'print.amountType.other',
  'print.section.identification', 'print.section.deadlineAndAmounts', 'print.section.actions',
  'print.section.citations', 'print.section.toVerify', 'print.section.sources',
  'print.actions.requested', 'print.actions.suggested',
  'print.citations.intro', 'print.citations.page', 'print.deadline.label', 'print.amount.label',
  'print.button.label', 'print.button.hint', 'print.facts.authority',
  'print.footer.company', 'print.footer.companyUnknown', 'print.footer.printedAt',
  'print.footer.model', 'print.footer.modelUnknown', 'print.footer.version',
  'print.footer.disclaimer',
]);
for (const [lang, d] of Object.entries(dicts)) {
  const missing = [...usedKeys].filter((k) => typeof label(d, k) !== 'string');
  check(`${lang}: tutte le ${usedKeys.size} etichette della stampa esistono`, missing.length === 0,
    `mancano: ${missing.join(', ')}`);
}
for (const [lang, d] of Object.entries(dicts)) {
  const disc = label(d, 'print.footer.disclaimer') as string;
  // ⚠️ Il foglio finisce in un fascicolo: la riga che dichiara il limite deve
  // esserci in tutte e tre le lingue, e nominare le tre cose che NON è.
  const words = { it: ['legale', 'fiscale', 'fiduciaria'], de: ['Rechts', 'Steuer', 'Treuhand'], fr: ['juridique', 'fiscal', 'fiduciaire'] }[lang]!;
  check(`${lang}: il disclaimer nomina consulenza legale, fiscale e fiduciaria`,
    words.every((w) => disc.includes(w)), disc);
}

// ---------------------------------------------------------------------------
// IL CARATTERE DEVE ARRIVARE NEL PDF.
//
// Il foglio stampato finisce nel fascicolo di una fiduciaria: se `@media print`
// toccasse `font-family`, quel foglio uscirebbe con il carattere di sistema
// mentre tutto il resto del prodotto è composto in Inter — e nessuno se ne
// accorgerebbe finché non guarda un PDF, cioè quasi mai.
//
// ⚠️ FINO AL 2026-08-13 QUESTO FATTO NON ERA SORVEGLIATO DA NIENTE: la parola
// «font» non compariva in questo file. La prova esisteva — un PDF vero
// ispezionato il 2026-08-10, con i tre sottoinsiemi incorporati — ma una prova
// fatta una volta non impedisce la riga che la smentisce il mese dopo.
//
// ⚠️ DAL 2026-08-28 il perimetro sono TUTTI i CSS di src/: con la migrazione a
// CSS Modules (issue #83) ogni feature ha il suo foglio, e una `@media print`
// può vivere in qualunque modulo — sorvegliare solo i due globali lascerebbe
// la porta aperta proprio dove le regole di stampa si sono spostate.
{
  const moduli: string[] = [];
  for (const feature of readdirSync(join(HERE, '..', 'src', 'features'))) {
    const dir = join(HERE, '..', 'src', 'features', feature);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) if (f.endsWith('.module.css')) moduli.push(join(dir, f));
  }
  const fogli: [string, string][] = [
    ['app.css', APP],
    ['extra.css', EXTRA],
    ...moduli.map((p): [string, string] => [p.split('/src/')[1] ?? p, stripComments(readFileSync(p, 'utf8'))]),
  ];
  const blocchi: { file: string; corpo: string }[] = [];
  for (const [file, css] of fogli) {
    let da = 0;
    for (;;) {
      const at = css.indexOf('@media print', da);
      if (at < 0) break;
      const b = mediaBlock(css.slice(at), 'print');
      if (!b) break;
      blocchi.push({ file, corpo: b.body });
      da = at + 12;
    }
  }
  check('i blocchi @media print si trovano', blocchi.length > 0, `trovati ${blocchi.length}`);
  const colpevoli = blocchi
    .filter((b) => /font-family\s*:|(^|[;{\s])font\s*:\s*(?!inherit)/.test(b.corpo))
    .map((b) => b.file);
  check(
    'nessun blocco @media print tocca il carattere',
    colpevoli.length === 0,
    `${colpevoli.join(', ')} — il PDF uscirebbe col carattere di sistema mentre lo schermo è in Inter`,
  );
}

// ---------------------------------------------------------------------------
console.log(`\n${B}Risultato:${X} ${fail === 0 ? `${G}${pass} passati${X}` : `${R}${fail} falliti${X} ${DIM}su ${pass + fail}${X}`}`);
process.exit(fail === 0 ? 0 : 1);
