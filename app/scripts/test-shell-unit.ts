// ============================================================================
// AI-Swisse — La testata (marchio e campanella): test OFFLINE.
//   npm run test:shell-unit
//
// Niente database, niente rete, niente credito. Prova le tre regole della
// testata che nessun altro controllo vede — il design-lint guarda carattere,
// colore e spaziatura dentro src/, non le forme, i contenitori né index.html:
//
//   1. FORME — nella famiglia di icone nessuna forma appartiene a due nomi.
//      La regola è già scritta tre volte nei commenti di Icon.tsx (banknote/
//      receipt, askAi/fileSearch, receipt/tag), ma senza controllo è rimasta
//      una preghiera: il marchio è nato con lo STESSO path di `plus`, e un
//      marchio che è un comando si legge come un comando — «aggiungi», nella
//      posizione del logo.
//
//   2. CAMPANELLA — è un accessorio, non un pari grado del marchio: a riposo
//      non ha né bordo né fondo propri. Una scatola bordata di 40px accanto a
//      un marchio di 32px sono due scatole affiancate, cioè due pari grado.
//      L'hover può colorare: il feedback non è un contenitore.
//
//   3. FAVICON — il marchio è uno: il campo della favicon è `--accent` e il
//      tratto della S è `--on-accent`, letti dal token e pretesi letterali
//      nell'SVG. La favicon è nata dal prototipo con un gradiente suo
//      (#00A3FF→#4DEAFF): due blu per lo stesso segno sono due marchi.
//
// ⚠️ Il CSS si LEGGE DAI FILE, non si descrive a mano: un elenco di proprietà
// copiato qui dentro invecchia al primo ritocco del foglio di stile e comincia
// a garantire una cosa che non c'è più.
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ICONS } from '../src/components/ui/Icon.tsx';
import { LOCALES } from '../src/i18n/index.tsx';
import { it } from '../src/i18n/locales/it.ts';
import { de } from '../src/i18n/locales/de.ts';
import { fr } from '../src/i18n/locales/fr.ts';

const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${name}`); }
  else { fail++; console.log(`  ${R}✗ ${name}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
section('1. Forme — una forma, un nome');

{
  // Lo spazio non è forma: si normalizza prima di confrontare, perché due path
  // uguali a meno di un a-capo sono la stessa forma e devono risultarlo.
  const byShape = new Map<string, string[]>();
  for (const [name, path] of Object.entries(ICONS)) {
    const shape = path.replace(/\s+/g, ' ').trim();
    byShape.set(shape, [...(byShape.get(shape) ?? []), name]);
  }
  const dupes = [...byShape.values()].filter((names) => names.length > 1);
  check(
    'nessuna forma appartiene a due nomi',
    dupes.length === 0,
    dupes.map((names) => names.join(' = ')).join('; '),
  );
}

// ---------------------------------------------------------------------------
section('2. Campanella — accessorio, non pari grado');

{
  const css = readFileSync(join(root, 'src/styles/extra.css'), 'utf8');
  // Il PRIMO blocco `.bell-btn { … }` è lo stato a riposo; `:hover` è feedback
  // e non entra nel giudizio.
  const block = css.match(/\.bell-btn\s*\{([^}]*)\}/)?.[1] ?? '';
  check('.bell-btn esiste in extra.css', block !== '');

  // `\bborder\s*:` e non `border`: `border-radius` è la geometria del velo di
  // hover, non una scatola, e non deve entrare nel giudizio. ⚠️ Gli spazi dopo
  // i due punti stanno DENTRO il lookahead: fuori, il loro backtracking offre
  // al motore una posizione in cui «border: 0» non comincia con «0», e il
  // controllo boccerebbe anche il CSS corretto — trovato rosso alla prima
  // esecuzione sul codice già a posto.
  const boxBorder = /\bborder\s*:(?!\s*(?:0(?:[;\s]|$)|none\b))/.test(block);
  check(
    'a riposo nessun bordo proprio',
    !boxBorder,
    'un accessorio non ha contorno: la scatola bordata è il contenitore del marchio e dei comandi',
  );

  const boxSurface = /\bbackground\s*:\s*var\(--(card|bg)\)/.test(block);
  check(
    'a riposo nessun fondo di superficie',
    !boxSurface,
    "un fondo da scheda fa della campanella una scheda: il fondo appartiene all'hover",
  );
}

// ---------------------------------------------------------------------------
section('3. Favicon — il marchio è uno');

{
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const uri = html.match(/href="data:image\/svg\+xml,([^"]*)"/)?.[1] ?? '';
  check('la favicon esiste in index.html', uri !== '');

  // Si decodifica come fa il browser: il confronto giusto è sul documento SVG,
  // non sulla sua forma percent-encoded. Un URI malformato qui ESPLODE, ed è
  // giusto così: è un guasto, non un caso da assorbire.
  const svg = decodeURIComponent(uri);

  // Il colore canonico vive in app.css e un data URI non può dire var(--accent):
  // il valore si LEGGE dal token — il PRIMO `--accent:` del file, cioè il tema
  // chiaro, perché la favicon è una e la scheda del browser non segue il tema
  // del sito — e si pretende letterale nell'SVG. Se un giorno l'accento cambia,
  // questo rosso è il promemoria che la favicon non si aggiorna da sola.
  const appCss = readFileSync(join(root, 'src/styles/app.css'), 'utf8');
  const accent = appCss.match(/--accent:\s*([^;]+);/)?.[1].trim() ?? '';
  const onAccent = appCss.match(/--on-accent:\s*([^;]+);/)?.[1].trim() ?? '';
  check('i token --accent e --on-accent esistono in app.css', accent !== '' && onAccent !== '');
  check(`il campo della favicon è --accent`, svg.includes(`fill='${accent}'`), `atteso fill='${accent}'`);
  check(`il tratto della S è --on-accent`, svg.includes(`stroke='${onAccent}'`), `atteso stroke='${onAccent}'`);
  check('nessun gradiente residuo', !svg.includes('linearGradient'));
}

// ---------------------------------------------------------------------------
section('4. Il documento — titolo e lingua non restano fermi all\'italiano');

{
  // ⚠️ PERCHÉ. index.html è nato con titolo, descrizione e lang in una lingua
  // sola e NESSUN controllo li vedeva; e fino al 2026-08-13 il titolo della
  // scheda restava italiano anche per un utente tedesco, perché nessuno lo
  // aggiornava al cambio di lingua. Il documento statico parla la lingua di
  // riferimento (it) — è una scelta, dichiarata nel commento di index.html —
  // ma DEVE essere riconciliato col dizionario, e il provider DEVE riallineare
  // titolo e lang a runtime.
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const staticTitle = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
  const staticDescription = html.match(/name="description"[\s\S]*?content="([^"]*)"/)?.[1] ?? '';
  const staticLang = html.match(/<html lang="([a-z-]+)">/)?.[1] ?? '';

  check('index.html ha un titolo non vuoto', staticTitle.trim() !== '');
  check('index.html ha una descrizione non vuota', staticDescription.trim() !== '');
  check(
    'la lingua statica è una delle LOCALES',
    (LOCALES as readonly string[]).includes(staticLang),
    `lang="${staticLang}" — le lingue dichiarate sono ${LOCALES.join(', ')}`,
  );

  // La riconciliazione: il titolo statico È common.docTitle della lingua
  // statica. Se uno dei due cambia senza l'altro, questo rosso lo ricorda.
  const docTitles = { it: it.common.docTitle, de: de.common.docTitle, fr: fr.common.docTitle } as Record<string, string | undefined>;
  check(
    'il titolo statico coincide con common.docTitle della lingua dichiarata',
    staticTitle === docTitles[staticLang],
    `statico «${staticTitle}» · dizionario «${docTitles[staticLang] ?? '(chiave assente)'}»`,
  );
  check(
    'le tre docTitle sono tradotte davvero (nessuna copia)',
    new Set([docTitles.it, docTitles.de, docTitles.fr]).size === 3 && !Object.values(docTitles).includes(undefined),
  );

  // Il runtime: il provider riallinea lang e titolo al cambio di lingua. Si
  // legge il sorgente e si pretende il cablaggio letterale, come per la favicon.
  const provider = readFileSync(join(root, 'src/i18n/index.tsx'), 'utf8');
  check(
    'al cambio di lingua il provider aggiorna document.documentElement.lang',
    /document\.documentElement\.lang\s*=\s*locale/.test(provider),
  );
  check(
    'al cambio di lingua il provider aggiorna document.title dal dizionario',
    /document\.title\s*=\s*translate\('common\.docTitle'\)/.test(provider),
  );
}

// ---------------------------------------------------------------------------
const total = pass + fail;
console.log(`\n${B}ESITO${X}: ${fail === 0 ? `${G}verde${X}` : `${R}rosso${X}`} — ${pass}/${total} passi`);
process.exit(fail === 0 ? 0 : 1);
