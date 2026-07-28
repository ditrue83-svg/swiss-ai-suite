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

const NNBSP = ' '; // espace fine insécable
const NBSP = ' ';  // espace insécable

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = resolve(ROOT, 'src/i18n/locales/fr.ts');

/** Stringhe letterali in apici singoli, con `\'` gestito. */
const LITERAL = /'((?:[^'\\\n]|\\.)*)'/g;

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

/** Ritorna le violazioni di un intero sorgente, guardando solo le stringhe. */
export function violazioniDelSorgente(src) {
  const out = [];
  LITERAL.lastIndex = 0;
  let m;
  while ((m = LITERAL.exec(src)) !== null) {
    const v = violazioniDelTesto(m[1]);
    if (v.length) out.push({ testo: m[1], regole: [...new Set(v)] });
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
  // ⚠️ I due negativi che contano: il controllo non deve inventarsi errori.
  { nome: 'URL con due punti (nessuno spazio)', src: `const a = 'https://ai-swisse.com/a:b';`, deveFallire: false },
  { nome: 'orario', src: `const a = '14:30';`, deveFallire: false },
  { nome: 'COMMENTO francese: non è testo d’interfaccia', src: `// Elle ne s’adoucit pas : un IBAN`, deveFallire: false },
  { nome: 'testo senza segni doppi', src: `const a = 'Aucune ponctuation double ici';`, deveFallire: false },
];

function eseguiCasi() {
  return CASI.map((c) => {
    const fallito = violazioniDelSorgente(c.src).length > 0;
    return { ...c, ok: fallito === c.deveFallire };
  });
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

const src = readFileSync(TARGET, 'utf8');
const violazioni = violazioniDelSorgente(src);

if (violazioni.length === 0) {
  console.log(`\n  Nessuna: la tipografia francese usa U+202F ovunque (${esiti.length} casi di autoverifica superati).\n`);
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
