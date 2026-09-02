// ============================================================================
// Tipografia francese: gli spazi prima dei segni doppi.
//   npm run i18n:typography
//   npm run i18n:typography -- --self-test
//
// IL PROBLEMA CHE CHIUDE
// In francese i segni doppi ( : ; ! ? ) e i guillemets vogliono uno spazio
// INSECABILE: con uno spazio normale il segno può finire da solo a capo, e la
// riga si spezza fra la parola e i due punti. Fino al 2026-07-28 il dizionario
// francese ne aveva 155 con lo spazio normale, mentre le stringhe aggiunte con
// la 0018 e tutta la vetrina usavano già U+202F: due convenzioni nello stesso
// prodotto, cioè nessuna convenzione.
//
// QUALE CARATTERE, E PERCHÉ QUESTO
// Le fonti NON concordano: l'Imprimerie nationale vuole l'espace fine
// insécable (U+202F) davanti a ; ! ? e l'espace insécable normale (U+00A0)
// davanti ai due punti; altre guide usano U+202F ovunque. Non c'è una risposta
// vera da scoprire: c'è una scelta da fare e da tenere. Si è scelto **U+202F
// ovunque**, perché è quello che la vetrina usa già — e un cliente che passa
// dal sito all'applicazione vede un prodotto solo. La scelta è dichiarata qui
// e non va cambiata senza cambiarla anche in `~/ai-swisse-landing`.
//
// CHE COSA NON GUARDA, DI PROPOSITO
// Solo le STRINGHE del dizionario. I commenti del codice restano come sono:
// non li legge nessun cliente, e obbligare a scriverli con caratteri
// invisibili renderebbe il sorgente più difficile da mantenere per una regola
// che non lo riguarda. C'è un commento francese in `fr.ts` che infatti resta
// con lo spazio normale, ed è corretto che il controllo non lo veda.
//
// ⚠️ Come ogni controllo di questo progetto, ha `--self-test` con casi che
// DEVONO farlo fallire: due versioni di `i18n:coverage` hanno dato falsi verdi
// per mesi perché nessuno le aveva mai messe alla prova.
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// L'elenco dei dizionari vive in UN posto: il disco, riconciliato con LOCALES.
import { dizionari } from './i18n-locales.mjs';

const NNBSP = ' '; // espace fine insécable
const NBSP = ' ';  // espace insécable

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = resolve(ROOT, 'src/i18n/locales/fr.ts');

// ⚠️ La CODIFICA riguarda TUTTE le lingue, non solo il francese — e l'elenco
// non si scrive più qui: fino al 2026-08-13 era cablato («it, de, fr») e una
// quarta lingua sul disco non la guardava nessuno. Ora viene dal disco,
// riconciliato con LOCALES (vedi i18n-locales.mjs).
const DIZIONARI = dizionari().map((rel) => resolve(ROOT, rel));

/** Stringhe letterali — apici singoli, DOPPI e template: la tipografia non
 * dipende dal delimitatore. ⚠️ Fino al 2026-08-13 si guardavano solo gli
 * apici singoli: una stringa in apici doppi sfuggiva intera. Latente, ma un
 * controllo appeso a una convenzione di stile muore al primo formatter. */
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

/** Il testo di un match, con le interpolazioni `${…}` dei template rimosse:
 * sono codice, e sostituirle con qualcosa inventerebbe spazi che non esistono. */
const testoDelLetterale = (m) => (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, '');

/**
 * Occorrenze da correggere DENTRO una stringa.
 * Lo spazio dev'essere preceduto da qualcosa che non sia spazio: «a : b» è un
 * errore, «  : b» in una stringa di sola punteggiatura no.
 */
const REGOLE = [
  { nome: 'due punti', re: /(?<=[^\s\\]) :/g, atteso: `${NNBSP}:` },
  { nome: 'punto e virgola', re: /(?<=[^\s\\]) ;/g, atteso: `${NNBSP};` },
  { nome: 'punto interrogativo', re: /(?<=[^\s\\]) \?/g, atteso: `${NNBSP}?` },
  { nome: 'punto esclamativo', re: /(?<=[^\s\\]) !/g, atteso: `${NNBSP}!` },
  { nome: 'guillemet aperto', re: /« /g, atteso: `«${NNBSP}` },
  { nome: 'guillemet chiuso', re: / »/g, atteso: `${NNBSP}»` },
  // U+00A0 non è sbagliato in assoluto: è l'ALTRA convenzione. Mescolarle sì.
  { nome: 'spazio insecabile largo (U+00A0), qui si usa U+202F', re: new RegExp(`${NBSP}[:;?!»]`, 'g'), atteso: `${NNBSP}` },
];

/** Ritorna le violazioni di UN testo (già estratto da una stringa). */
export function violazioniDelTesto(testo) {
  const out = [];
  for (const r of REGOLE) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(testo)) !== null) out.push(r.nome);
  }
  return out;
}

// ---------------------------------------------------------------------------
// LA CODIFICA CORROTTA (mojibake)
//
// ⚠️⚠️ PERCHÉ ESISTE, e la data conta. Il 2026-08-10, cercando quali caratteri
// dovessero stare nel carattere tipografico, è saltato fuori che 17 righe dei
// tre dizionari erano UTF-8 rilette come Latin-1: «TrÃ¨s pertinente» invece di
// «Très pertinente», «SÃ¬» invece di «Sì», «MÃ¶glicherweise» invece di
// «Möglicherweise». Tutte nella stessa sezione, tutte visibili a
// schermo, entrate con un commit di allineamento dello specchio (450de6b).
//
// Nessun controllo le vedeva: `i18n:coverage` salta i dizionari di proposito
// (sono testo per definizione) e questo file guardava solo la spaziatura del
// francese. Una parola sbagliata in tre lingue è passata per settimane sotto
// due controlli verdi.
//
// COME LO RICONOSCE, senza indovinare: si cercano le sequenze di due caratteri
// che nascono da quella doppia codifica — `Ã`/`Â` seguiti da un carattere
// U+0080–U+00BF — e si tiene solo quelle che, ricodificate, tornano un
// carattere UTF-8 valido. Una sequenza che non torna indietro NON viene
// segnalata: sarebbe un'ipotesi, non una misura.
// ---------------------------------------------------------------------------
const MOJIBAKE = /[ÃÂ][-¿]/g;

/** Le sequenze di `testo` che sono con ogni evidenza una doppia codifica. */
export function sequenzeMojibake(testo) {
  const out = [];
  MOJIBAKE.lastIndex = 0;
  let m;
  while ((m = MOJIBAKE.exec(testo)) !== null) {
    const grezzo = m[0];
    // Ricodifica: i due caratteri come byte Latin-1, riletti come UTF-8.
    const byte = Uint8Array.from([grezzo.charCodeAt(0), grezzo.charCodeAt(1)]);
    const tornato = new TextDecoder('utf-8', { fatal: true });
    let riparato;
    try { riparato = tornato.decode(byte); } catch { continue; }
    if (riparato.length === 1 && riparato !== '�') out.push({ grezzo, riparato });
  }
  return out;
}

/** Ritorna le violazioni di un intero sorgente, guardando solo le stringhe. */
export function violazioniDelSorgente(src) {
  const out = [];
  LITERAL.lastIndex = 0;
  let m;
  while ((m = LITERAL.exec(src)) !== null) {
    const testo = testoDelLetterale(m);
    const v = violazioniDelTesto(testo);
    if (v.length) out.push({ testo, regole: [...new Set(v)] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Autoverifica: metà dei casi DEVE risultare sbagliata, metà DEVE passare.
// ---------------------------------------------------------------------------
const CASI = [
  { nome: 'due punti con spazio normale', src: `const a = 'Priorité : toutes';`, deveFallire: true },
  { nome: 'due punti con U+202F', src: `const a = 'Priorité${NNBSP}: toutes';`, deveFallire: false },
  { nome: 'interrogativo con spazio normale', src: `const a = 'Que faire ?';`, deveFallire: true },
  { nome: 'punto e virgola con spazio normale', src: `const a = 'Attention ; ensuite';`, deveFallire: true },
  { nome: 'guillemets con spazio normale', src: `const a = 'Voir « le document »';`, deveFallire: true },
  { nome: 'guillemets con U+202F', src: `const a = 'Voir «${NNBSP}le document${NNBSP}»';`, deveFallire: false },
  { nome: 'U+00A0 al posto di U+202F', src: `const a = 'Priorité${NBSP}: toutes';`, deveFallire: true },
  // ⚠️ GLI APICI DOPPI E I TEMPLATE. Fino al 2026-08-13 si guardavano SOLO gli
  // apici singoli: questi casi, con la regex vecchia, non fallivano — la
  // stringa intera era invisibile per via del delimitatore. Latente, ma un
  // controllo appeso a una convenzione di stile muore al primo formatter.
  { nome: '⚠️ APICI DOPPI: lo spazio sbagliato si vede anche lì', src: `const a = "Priorité : toutes";`, deveFallire: true },
  { nome: '⚠️ TEMPLATE: il testo statico si giudica', src: 'const a = `Que faire ?`;', deveFallire: true },
  { nome: 'l’interpolazione di un template non inventa errori', src: 'const a = `Priorité${"x"}: toutes`;', deveFallire: false },
  // ⚠️ I due negativi che contano: il controllo non deve inventarsi errori.
  { nome: 'URL con due punti (nessuno spazio)', src: `const a = 'https://ai-swisse.com/a:b';`, deveFallire: false },
  { nome: 'orario', src: `const a = '14:30';`, deveFallire: false },
  { nome: 'COMMENTO francese: non è testo d’interfaccia', src: `// Elle ne s’adoucit pas : un IBAN`, deveFallire: false },
  { nome: 'testo senza segni doppi', src: `const a = 'Aucune ponctuation double ici';`, deveFallire: false },
];

// ⚠️ I casi della CODIFICA. I negativi contano quanto i positivi: «Ç», «©» e
// ««» sono caratteri legittimi, e un rilevatore che li scambiasse per
// corruzione riscriverebbe testo giusto.
const CASI_CODIFICA = [
  { nome: 'francese corrotto (Ã¨ → è)', testo: `'TrÃ¨s pertinente'`, deveFallire: true },
  { nome: 'italiano corrotto (Ã¬ → ì)', testo: `'SÃ¬'`, deveFallire: true },
  { nome: 'tedesco corrotto (Ã¶ → ö)', testo: `'MÃ¶glicherweise fÃ¶rderfÃ¤hig'`, deveFallire: true },
  { nome: 'francese CORRETTO', testo: `'Très pertinente'`, deveFallire: false },
  { nome: 'italiano CORRETTO', testo: `'Sì, già avviato'`, deveFallire: false },
  { nome: 'tedesco CORRETTO', testo: `'Möglicherweise förderfähig'`, deveFallire: false },
  { nome: '⚠️ la cediglia maiuscola non è corruzione', testo: `'Ça ne se corrige pas'`, deveFallire: false },
  { nome: '⚠️ il simbolo di copyright non è corruzione', testo: `'© AI-Swisse'`, deveFallire: false },
  { nome: '⚠️ i guillemets non sono corruzione', testo: `'Voir « le document »'`, deveFallire: false },
  { nome: '⚠️ la A con tilde portoghese, da sola, non è corruzione', testo: `'São Paulo'`, deveFallire: false },
];

function eseguiCasi() {
  const punteggiatura = CASI.map((c) => {
    const fallito = violazioniDelSorgente(c.src).length > 0;
    return { ...c, ok: fallito === c.deveFallire };
  });
  const codifica = CASI_CODIFICA.map((c) => {
    const fallito = sequenzeMojibake(c.testo).length > 0;
    return { ...c, ok: fallito === c.deveFallire };
  });
  return [...punteggiatura, ...codifica];
}

const soloSelfTest = process.argv.includes('--self-test');
const esiti = eseguiCasi();
const rotti = esiti.filter((e) => !e.ok);

if (rotti.length) {
  console.error('\n  ✗ Autoverifica FALLITA: il controllo non riconosce i propri casi noti.');
  for (const c of rotti) {
    console.error(`    ${c.nome} — atteso ${c.deveFallire ? 'errore' : 'nessun errore'}`);
  }
  console.error('  Un controllo che non supera i propri casi non può dare un verde.\n');
  process.exit(1);
}

if (soloSelfTest) {
  console.log(`\n  ✓ Autoverifica superata: ${esiti.length} casi (positivi e negativi).\n`);
  process.exit(0);
}

// --- La codifica, in tutte e tre le lingue ----------------------------------
const corrotti = [];
for (const percorso of DIZIONARI) {
  const testo = readFileSync(percorso, 'utf8');
  testo.split('\n').forEach((riga, i) => {
    const seq = sequenzeMojibake(riga);
    if (seq.length) corrotti.push({ percorso, riga: i + 1, testo: riga.trim(), seq });
  });
}

if (corrotti.length) {
  console.error(`\n  ✗ ${corrotti.length} righe con la CODIFICA CORROTTA (UTF-8 riletto come Latin-1):\n`);
  for (const c of corrotti.slice(0, 20)) {
    const nome = c.percorso.slice(c.percorso.indexOf('src/'));
    const esempi = [...new Set(c.seq.map((s) => `${s.grezzo} → ${s.riparato}`))].join(' · ');
    console.error(`    ${nome}:${c.riga}  ${esempi}`);
    console.error(`      ${c.testo.slice(0, 110)}`);
  }
  if (corrotti.length > 20) console.error(`\n    …e altre ${corrotti.length - 20}.`);
  console.error('\n  Non è un dettaglio tipografico: è una parola sbagliata sotto gli occhi'
    + '\n  di chi legge. Ricodificare le sequenze, non riscriverle a mano.\n');
  process.exit(1);
}

const src = readFileSync(TARGET, 'utf8');
const violazioni = violazioniDelSorgente(src);

if (violazioni.length === 0) {
  console.log(`\n  Nessuna: la tipografia francese usa U+202F ovunque e le tre lingue hanno`
    + ` la codifica intatta\n  (${esiti.length} casi di autoverifica superati).\n`);
  process.exit(0);
}

console.error(`\n  ✗ ${violazioni.length} stringhe francesi con spaziatura da correggere:\n`);
for (const v of violazioni.slice(0, 40)) {
  const mostrato = v.testo.replace(new RegExp(NNBSP, 'g'), '[U+202F]').slice(0, 110);
  console.error(`    ${mostrato}`);
  console.error(`      → ${v.regole.join(', ')}`);
}
if (violazioni.length > 40) console.error(`\n    …e altre ${violazioni.length - 40}.`);
console.error(`\n  In francese il segno doppio non va separato: con lo spazio normale può finire da solo a capo.\n`);
process.exit(1);
