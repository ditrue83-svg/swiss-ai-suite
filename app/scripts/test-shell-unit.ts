// ============================================================================
// AI-Swisse — La shell (testata e barra di navigazione): test OFFLINE.
//   npm run test:shell-unit
//
// Niente database, niente rete, niente credito. Prova le regole della shell
// che nessun altro controllo vede — il design-lint guarda carattere,
// colore e spaziatura dentro src/, non le forme, i contenitori, né la
// struttura della navigazione, né index.html:
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
//   3. FAVICON — il marchio è uno: il campo della favicon è `--accent` e la
//      sigla è `--on-accent`, letti dal token e pretesi letterali nell'SVG.
//      La favicon è nata dal prototipo con un gradiente suo
//      (#00A3FF→#4DEAFF): due blu per lo stesso segno sono due marchi. E va
//      in contorni: un data: URI non carica Inter, quindi un <text> lo
//      disegnerebbe un carattere diverso su ogni macchina.
//
//   3b. MARCHIO — «AI-Swisse» si legge da `brand.name` e si divide sul
//      trattino; non è scritto a mano in un componente, e non è tornato
//      un'icona (da lì rientrerebbe dentro un pulsante).
//
// ⚠️ Il CSS si LEGGE DAI FILE, non si descrive a mano: un elenco di proprietà
// copiato qui dentro invecchia al primo ritocco del foglio di stile e comincia
// a garantire una cosa che non c'è più.
// ============================================================================
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ICONS } from '../src/components/ui/Icon.tsx';
import { dividiMarchio } from '../src/components/ui/BrandMark.tsx';
import { LOCALES, pluralKey, type PluralBase } from '../src/i18n/index.tsx';
import { it } from '../src/i18n/locales/it.ts';
import { de } from '../src/i18n/locales/de.ts';
import { fr } from '../src/i18n/locales/fr.ts';
import { NAV, NAV_SETTINGS, isSection, navItemMatches, type NavItem } from '../src/components/layout/nav.ts';
import {
  chiaviTaskSplit, contoDate, decidiBlocchi, fraseCatalogo, rigaNature, splitOpenTasks,
  termini, TERMINI_IN_PANORAMICA, type DataDocumento,
} from '../src/features/dashboard/overviewBlocks.ts';
import { GLYPH_NAMES, type MarkGlyphName } from '../src/components/ui/MarkGlyph.tsx';
import { PROVENANCE_KINDS } from '../src/components/ui/ProvenanceMark.tsx';
import { CONFIDENCE_LEVELS } from '../src/components/ui/ConfidenceBadge.tsx';
import { ELIGIBILITY_STATES } from '../src/components/ui/EligibilityMark.tsx';
import { SOURCE_STATES } from '../src/components/ui/SourceStamp.tsx';
import { DEADLINE_STATES, deadlineState } from '../src/components/ui/DeadlineMark.tsx';
import { APPOINTMENT_STATES, appointmentState } from '../src/components/ui/AppointmentMark.tsx';
// ⚠️ DUE PORTE PER LA STESSA FUNZIONE, di proposito: quella del modulo
// condiviso e quella da cui la prendono le Attività e la Panoramica. Se un
// giorno la seconda smettesse di essere la prima, la sezione 17 lo dice.
import { calendarDaysUntil, giornoLocale } from '../src/lib/calendarDays.ts';
import { formatDate, formatDateTime } from '../src/lib/format.ts';
import { calendarDaysUntil as calendarDaysUntilTasks } from '../src/features/tasks/taskFormat.ts';
import { TASK_STATES } from '../src/components/ui/StatusMark.tsx';
import { PRIORITY_LEVELS } from '../src/components/ui/PriorityMark.tsx';
import { WINDOW_STATES } from '../src/components/ui/WindowMark.tsx';
import { contaSegni } from '../src/components/ui/MarkLegend.tsx';

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

  // ⚠️ IL CAMPO È `--brand`, NON `--accent`, e il cambio è del 2026-08-14.
  // Fino ad allora la favicon portava il blu D'AZIONE: la scheda del browser
  // mostrava un marchio di un colore che il titolare non usa da nessuna parte.
  // I due token esistono per due mestieri — `--accent` deve reggere il
  // contrasto AA perché ci si scrive e ci si clicca sopra, `--brand` è il
  // colore del segno — e la favicon è un segno.
  // Il valore si LEGGE dal token (il primo del file, cioè il tema chiaro:
  // la favicon è una e la scheda del browser non segue il tema del sito) e si
  // pretende letterale nell'SVG. Se un giorno il marchio cambia, questo rosso
  // è il promemoria che la favicon non si aggiorna da sola.
  const appCss = readFileSync(join(root, 'src/styles/app.css'), 'utf8');
  const brand = appCss.match(/--brand:\s*([^;]+);/)?.[1].trim() ?? '';
  const brandInk = appCss.match(/--brand-ink:\s*([^;]+);/)?.[1].trim() ?? '';
  check('i token --brand e --brand-ink esistono in app.css', brand !== '' && brandInk !== '');
  check(`il campo della favicon è --brand`, svg.includes(`fill='${brand}'`), `atteso fill='${brand}'`);
  check(`la sigla è --brand-ink`, svg.includes(`fill='${brandInk}'`), `atteso fill='${brandInk}'`);
  // ⚠️ DAL 2026-08-26 IL BLU DEL MARCHIO È IL BLU D'AZIONE, e la scelta è di
  // Andrea: `--brand` e `--accent` portano lo stesso azzurro #37AEEF. I token
  // restano due perché i mestieri restano due — il marchio è un disegno, il
  // testo ha soglie di contrasto — ma il valore è uno: due azzurri che si
  // somigliano sono due segni. Se un giorno qualcuno tornasse a separarli,
  // il cambio va fatto nelle due sedi insieme (lo sorveglia `brand:check`),
  // non cambiando un solo valore qui.
  const accent = appCss.match(/--accent:\s*([^;]+);/)?.[1].trim() ?? '';
  check(
    'il blu del marchio è il blu d\'azione — un solo azzurro, deciso il 2026-08-26',
    brand !== '' && brand === accent && brand.toLowerCase() === '#37aeef',
    'marchio e azione portano lo stesso #37AEEF: chi li separa o ne cambia il valore lo fa nelle due sedi insieme',
  );
  check('nessun gradiente residuo', !svg.includes('linearGradient'));

  // ⚠️ La favicon dev'essere in CONTORNI. Un data: URI non carica risorse
  // esterne (è il punto della CSP), quindi un <text> qui dentro lo
  // disegnerebbe un carattere di sistema diverso su ogni macchina: il marchio
  // smetterebbe di essere uno. Questo rosso arriva a chi, un giorno, proverà
  // la scorciatoia — che a schermo sembra funzionare, perché sulla SUA
  // macchina un font c'è.
  check(
    'la favicon non compone testo',
    !/<text[\s>]/.test(svg),
    'un data: URI non può caricare Inter: il segno va in contorni, o lo disegna il carattere di sistema',
  );

  // Il marchio dell'interfaccia non è più un'icona: se qualcuno lo rimette
  // nella famiglia, torna disponibile a chi monta un pulsante.
  check(
    'il marchio non è tornato una voce della famiglia icone',
    !Object.prototype.hasOwnProperty.call(ICONS, 'logo'),
    'il marchio sta in BrandMark.tsx e i suoi contorni in brandArt.ts: un\'icona «logo» è la porta da cui rientra come pulsante',
  );
}

// ---------------------------------------------------------------------------
section('3b. Il marchio — si legge dai dizionari, non si scrive a mano');

{
  // Il nome del prodotto vive in un posto solo (`brand.name`) e il marchio lo
  // divide sul trattino: «AI-Swisse» → blocco «AI» + parola «Swisse». Se un
  // dizionario perdesse il trattino, `dividiMarchio` tornerebbe null e la
  // barra mostrerebbe il nome intero senza blocco — un marchio a metà che
  // NESSUNO vedrebbe in italiano. Qui si pretende che tutti e tre si dividano.
  const dizionari: [string, Record<string, unknown>][] = [['it', it], ['de', de], ['fr', fr]];
  for (const [lingua, dz] of dizionari) {
    const nome = (dz.brand as { name?: string } | undefined)?.name ?? '';
    const parti = dividiMarchio(nome);
    check(
      `${lingua}: «${nome}» si divide in sigla e parola`,
      parti !== null && parti[0].length > 0 && parti[1].length > 0,
      'il marchio si compone da brand.name: senza trattino il blocco sparisce senza che nulla protesti',
    );
  }
  // Le tre lingue devono avere lo STESSO nome: un marchio tradotto è due marchi.
  const nomi = dizionari.map(([, dz]) => (dz.brand as { name?: string } | undefined)?.name ?? '');
  check(
    'il nome del marchio non si traduce',
    new Set(nomi).size === 1,
    `trovati: ${nomi.join(' · ')}`,
  );

  // I casi che DEVONO rompere il divisore: la prova che non inventa una
  // divisione plausibile quando la forma non c'è.
  check('«AISwisse» (senza trattino) non si divide', dividiMarchio('AISwisse') === null);
  check('«-Swisse» (trattino in testa) non si divide', dividiMarchio('-Swisse') === null);
  check('«AI-» (trattino in coda) non si divide', dividiMarchio('AI-') === null);
}

// ---------------------------------------------------------------------------
section('3c. Il marchio ha DUE sedi, e finora non lo ricordava nessuno');

{
  // ⚠️⚠️ PERCHÉ QUESTO CONTROLLO ESISTE. Lo stesso marchio vive in due basi di
  // codice: qui (`BrandMark.tsx` + `brandArt.ts` + le regole `.brand-*`/`.bm-*`)
  // e nella vetrina (`site/static/logo-ai-swisse.svg`). `site/` è invisibile da
  // questo albero: nessun controllo dell'app poteva leggerla. Se il marchio
  // cambia, i posti da toccare sono due e non c'era niente che lo ricordasse:
  // si sarebbe scoperto guardando le due pagine affiancate, cioè per caso.
  //
  // ⚠️ IL 2026-08-14 I DUE BLU HANNO SMESSO DI DIVERGERE. Fino a quel giorno
  // l'app ricomponeva il segno in Inter sul token `--accent` e questo commento
  // diceva che la differenza era «per scelta»: erano due marchi, e uno dei due
  // non era di nessuno. Adesso i contorni sono gli STESSI (copiati in
  // `brandArt.ts`, confrontati carattere per carattere da `npm run brand:check`)
  // e il colore è lo stesso `#37AEEF`, che qui si chiama `--brand` — e dal
  // 2026-08-26 è anche `--accent`: un solo azzurro, scelto da Andrea.
  //
  // COME. Un'impronta di ciò che DEFINISCE il segno — le dichiarazioni CSS
  // delle regole `.brand-*` e le classi che il componente monta — confrontata
  // con quella dichiarata qui sotto. Non è un test di stile: è un promemoria
  // che scatta nell'istante in cui il marchio si muove, e nomina l'altra sede.
  //
  // ⚠️ L'impronta ignora i COMMENTI, di proposito: un controllo che diventa
  // rosso quando si riscrive una spiegazione insegna a rifare il numero senza
  // guardare, ed è il modo in cui una cricca smette di valere.
  const css = readFileSync(join(root, 'src', 'styles', 'app.css'), 'utf8');
  const senzaCommenti = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // ⚠️ ANCHE `.bm-*`, e l'aggiunta è del 2026-08-14: sono le tre regole che
  // vestono i pezzi del disegno (blocco, sigla, parola). Guardando solo
  // `.brand-*` si potrebbe cambiare il colore del marchio senza che l'impronta
  // se ne accorga — cioè proprio la cosa che questo controllo esiste per vedere.
  const regoleMarchio = [...senzaCommenti.matchAll(/^\.(?:brand|bm)-[\w-]*\s*\{[^}]*\}/gm)]
    .map((m) => m[0].replace(/\s+/g, ' ').trim())
    .sort();
  const sorgente = readFileSync(join(root, 'src', 'components', 'ui', 'BrandMark.tsx'), 'utf8');
  const classiMontate = [...sorgente.matchAll(/className="([^"]+)"/g)].map((m) => m[1]).sort();

  const impronta = createHash('sha256')
    .update(JSON.stringify({ regoleMarchio, classiMontate }))
    .digest('hex')
    .slice(0, 16);

  // L'impronta del marchio al 2026-08-14, DOPO il passaggio ai contorni veri.
  // Cambiarla è il gesto che accompagna un cambiamento del segno, e va fatto
  // dopo aver visto verde `npm run brand:check` — che è ciò che confronta i
  // tracciati con la vetrina. Questa impronta da sola non prova l'allineamento:
  // prova che il segno non si è mosso senza che qualcuno lo decidesse.
  const IMPRONTA_DICHIARATA = '388e47112d89b0fa';

  check(
    'il marchio dell\'app è quello dichiarato — se cambia, la vetrina va cambiata con lui',
    impronta === IMPRONTA_DICHIARATA,
    `impronta ${impronta}, dichiarata ${IMPRONTA_DICHIARATA}.\n`
    + '     Il marchio ha DUE sedi:\n'
    + '       · qui        src/components/ui/BrandMark.tsx + brandArt.ts + le regole .brand-*/.bm-* di app.css\n'
    + '       · la vetrina ~/swiss-ai-suite-repo/site/static/logo-ai-swisse.svg (+ scuro, + favicon)\n'
    + '     Dal 2026-08-14 la FORMA e il COLORE sono gli stessi: si cambia PRIMA la vetrina,\n'
    + '     poi si riallinea qui (`npm run brand:check` confronta i tracciati carattere per\n'
    + '     carattere) e infine si scrive la nuova impronta — ricordando che site/ si pubblica\n'
    + '     da sé (site.yml, su push a main).',
  );

  // ⚠️ E se la seconda sede è raggiungibile, si GUARDA invece di crederci.
  // Dal monorepo (dove gira la CI) `../site` esiste; da ~/swiss-ai-suite-app no,
  // e allora la riga lo DICHIARA — non si finge un verde su una cosa non vista.
  // Due geografie, entrambe vere: nel monorepo (e in CI) l'app sta in `app/` e
  // la vetrina le è sorella; sulla macchina di sviluppo l'albero di lavoro è
  // `~/swiss-ai-suite-app` e il monorepo gli sta accanto.
  const vetrina = [
    join(root, '..', 'site', 'static', 'logo-ai-swisse.svg'),
    join(root, '..', 'swiss-ai-suite-repo', 'site', 'static', 'logo-ai-swisse.svg'),
  ].find((p) => existsSync(p));
  if (vetrina) {
    const svg = readFileSync(vetrina, 'utf8');
    // Il blu atteso si LEGGE dal token dell'app, non si riscrive qui: un valore
    // letterale in questa riga è rimasto indietro una volta già (2026-08-26).
    const bluMarchio = senzaCommenti.match(/--brand:\s*([^;]+);/)?.[1].trim() ?? '';
    check(
      'la vetrina porta il blu del marchio (--brand) e il blocco della sigla',
      bluMarchio !== '' && svg.toLowerCase().includes(bluMarchio.toLowerCase()) && /<rect/i.test(svg),
      `il logo della vetrina non porta ${bluMarchio || '(un --brand leggibile)'}: allinea il marchio dell'app o dichiara la divergenza`,
    );
  } else {
    console.log(`  ${DIM}! seconda sede non raggiungibile da questo albero:`
      + ' il confronto con la vetrina gira nel monorepo, dove gira anche la CI.'
      + ' Qui resta verificata la sola sede dell\'app.'
      + `${X}`);
  }
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
section('5. La barra — la struttura del lavoro, non l\'architettura');

// ⚠️ PERCHÉ QUESTA SEZIONE. Fino al 2026-08-13 i gruppi si chiamavano
// «Piattaforma», «Moduli», «Automazione»: l'architettura del software, non la
// giornata di chi lo usa. La struttura nuova — oggi → LAVORO → ARCHIVIO →
// Impostazioni in fondo — è una DECISIONE, e queste asserzioni le impediscono
// di sfarinarsi una voce alla volta: l'ordine qui sotto non è «com'è», è
// «come deve restare finché non si decide altrimenti».

{
  const shape = NAV.map((e) => (isSection(e) ? `[${e.sectionKey}]` : e.id));
  const expected = [
    'home', 'assistant',
    '[nav.sectionWork]', 'inbox', 'admin', 'deadlines', 'subsidy',
    '[nav.sectionArchive]', 'documents', 'contracts', 'clients', 'finance',
  ];
  check(
    'oggi → LAVORO → ARCHIVIO, nell\'ordine deciso',
    JSON.stringify(shape) === JSON.stringify(expected),
    `atteso ${expected.join(' · ')}\n     trovato ${shape.join(' · ')}`,
  );

  // ⚠️ L'ORDINE È UNA DECISIONE, non l'ordine in cui le voci sono nate: prima
  // ciò che vale per CHI GUARDA (preferenze), poi chi si è (azienda), poi che
  // cosa si paga (abbonamento) — e in fondo, dopo la riga, i due luoghi in cui
  // si lavora invece di configurare.
  const settingsShape = NAV_SETTINGS.map((s) => s.id);
  check(
    'Impostazioni raccoglie preferenze · azienda · abbonamento · automazioni · registro',
    JSON.stringify(settingsShape) === JSON.stringify(['preferences', 'company', 'pricing', 'automations', 'audit']),
    `trovato ${settingsShape.join(' · ')}`,
  );
  // I pannelli PRIMA, le pagine DOPO: una colonnina che alterna «si apre qui» e
  // «ti porto via» costringe a leggere la freccia di ogni riga per sapere che
  // cosa succede al clic.
  const apre = NAV_SETTINGS.map((s) => s.apre);
  check(
    'i pannelli vengono tutti prima delle voci che portano a una pagina',
    apre.indexOf('pagina') === -1 || !apre.slice(apre.indexOf('pagina')).includes('pannello'),
    `trovato ${apre.join(' · ')}`,
  );
  // ⚠️ E OGNI PANNELLO DEVE ESSERE DAVVERO MONTATO. Un `apre: 'pannello'` senza
  // il suo ramo in `SettingsDialog` non dà un errore: dà un riquadro VUOTO, che
  // è il modo peggiore di rompersi — sembra che l'impostazione non ci sia.
  const dialogSrc = readFileSync(join(root, 'src/features/settings/SettingsDialog.tsx'), 'utf8');
  for (const v of NAV_SETTINGS.filter((s) => s.apre === 'pannello')) {
    check(`il pannello «${v.id}» è montato nella finestra`,
      new RegExp(`attivo === '${v.id}'`).test(dialogSrc),
      'senza il suo ramo la finestra mostra un riquadro vuoto');
  }
  // E il contrario: nessun ramo per una voce che non esiste più.
  const rami = [...dialogSrc.matchAll(/attivo === '([a-z]+)'/g)].map((m) => m[1]!);
  const orfani = rami.filter((r) => !NAV_SETTINGS.some((s) => s.id === r && s.apre === 'pannello'));
  check('nessun pannello montato per una voce che non c\'è', orfani.length === 0, orfani.join(', '));
  check(
    'il Registro attività è l\'UNICA voce riservata',
    NAV_SETTINGS.filter((s) => s.adminOnly).map((s) => s.id).join() === 'audit'
      && NAV.every((e) => isSection(e) || !e.adminOnly),
  );

  // Il calendario non ha una voce propria: è il secondo modo di guardare le
  // scadenze, e la voce che lo copre lo dichiara con `alsoMatches`.
  const items = NAV.filter((e): e is NavItem => !isSection(e));
  check('nessuna voce punta a /calendario', items.every((i) => i.path !== '/calendario'));
  const deadlines = items.find((i) => i.id === 'deadlines');
  check(
    '«Scadenze e attività» resta accesa anche su /calendario',
    deadlines !== undefined && navItemMatches(deadlines, '/calendario') && navItemMatches(deadlines, '/calendario/impostazioni'),
  );
  check(
    'l\'accensione è per segmento, non per prefisso di stringa',
    deadlines !== undefined && navItemMatches(deadlines, '/attivita/123') && !navItemMatches(deadlines, '/attivitaX'),
  );

  const allPaths = [...items.map((i) => i.path), ...NAV_SETTINGS.map((s) => s.path)];
  check('nessun percorso compare due volte', new Set(allPaths).size === allPaths.length);

  // Le rotte si leggono da App.tsx COME TESTO, come la favicon da index.html:
  // montare il router qui vorrebbe dire provare react-router, non la barra.
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  for (const p of allPaths.filter((x) => x !== '/')) {
    check(`la voce ${p} ha una rotta`, app.includes(`path="${p}"`));
  }
  check('la rotta /calendario resta viva (segnalibri, email di notifica)', app.includes('path="/calendario"'));

  // I vecchi indirizzi stanno nei segnalibri e nelle email delle persone:
  // il reindirizzamento è parte del contratto, non una cortesia.
  for (const [from, to] of [['/dashboard', '/'], ['/scadenziario', '/attivita'], ['/archivio', '/documenti']] as const) {
    const re = new RegExp(`path="${from.replace('/', '\\/')}"[^\\n]*<Navigate to="${to.replace('/', '\\/')}"`);
    check(`${from} reindirizza a ${to}`, re.test(app));
  }
}

{
  // LA COLLISIONE DEI NOMI: «Admin AI — Documenti» e «Documenti» erano
  // indistinguibili. La voce di analisi è un'azione, l'archivio è un luogo,
  // e in NESSUNA lingua possono tornare a chiamarsi uguali.
  for (const [lang, dict] of [['it', it], ['de', de], ['fr', fr]] as const) {
    check(
      `${lang}: «${dict.nav.analyzeDoc}» ≠ «${dict.nav.documents}»`,
      dict.nav.analyzeDoc.trim().toLowerCase() !== dict.nav.documents.trim().toLowerCase(),
    );
  }

  // L'INGOMBRO: la barra è larga 264px e una voce deve stare su una riga.
  // 24 caratteri è la misura della voce più lunga che ci sta con l'icona
  // accanto (verificata a schermo, non calcolata); il tedesco ha la sua
  // asserzione perché è la lingua che ha già sfondato una volta
  // («Unternehmenseinstellungen», 25 caratteri, sillabata su due righe).
  check('de: «Fristen & Aufgaben», compatto, non la traduzione letterale',
    de.nav.tasks.length <= 20, `«${de.nav.tasks}» = ${de.nav.tasks.length} caratteri`);
  const items = NAV.filter((e): e is NavItem => !isSection(e));
  // «nav» e «.» separati: il letterale unito finisce in punto, e per
  // `i18n:orphans` un token così copre l'INTERA sezione nav.* — cieca.
  const NAV_PUNTO = 'nav' + '.';
  for (const [lang, dict] of [['it', it], ['de', de], ['fr', fr]] as const) {
    const labels = [
      ...items.map((i) => (dict.nav as unknown as Record<string, string>)[i.labelKey.replace(NAV_PUNTO, '')]),
      ...NAV_SETTINGS.map((s) => (dict.nav as unknown as Record<string, string>)[s.labelKey.replace(NAV_PUNTO, '')]),
      (dict.nav as unknown as Record<string, string>).settings,
    ];
    const missing = labels.some((l) => l === undefined);
    const tooLong = labels.filter((l) => l !== undefined && l.length > 24);
    check(
      `${lang}: ogni voce esiste nel dizionario e sta su una riga (≤ 24)`,
      !missing && tooLong.length === 0,
      missing ? 'una chiave della barra non esiste nel dizionario' : tooLong.map((l) => `«${l}» = ${l.length}`).join('; '),
    );
  }
}

{
  // LA GERARCHIA VISIVA, letta dai fogli di stile come per la campanella.
  const appCss = readFileSync(join(root, 'src/styles/app.css'), 'utf8');
  const extraCss = readFileSync(join(root, 'src/styles/extra.css'), 'utf8');

  // La voce attiva parla il vocabolario della fiducia: il filetto verticale
  // (la barra di revisione di .mark-prov), non solo un fondo colorato.
  const btnBlock = appCss.match(/\.nav-btn\s*\{([^}]*)\}/)?.[1] ?? '';
  const activeBlock = appCss.match(/\.nav-btn\.active\s*\{([^}]*)\}/)?.[1] ?? '';
  check('il filetto è SEMPRE presente, trasparente a riposo (niente salto di 3px)',
    /border-left:\s*3px solid transparent/.test(btnBlock));
  check('la voce attiva accende il filetto con --accent',
    /border-left-color:\s*var\(--accent\)/.test(activeBlock));

  // L'etichetta di gruppo è orientamento, non una voce: pesa meno.
  const sectionWeight = Number(appCss.match(/\.nav-section\s*\{[^}]*font-weight:\s*(\d+)/)?.[1] ?? NaN);
  const btnWeight = Number(btnBlock.match(/font-weight:\s*(\d+)/)?.[1] ?? NaN);
  check(
    'l\'etichetta di gruppo pesa meno delle voci',
    Number.isFinite(sectionWeight) && Number.isFinite(btnWeight) && sectionWeight < btnWeight,
    `sezione ${sectionWeight} · voce ${btnWeight}`,
  );

  // L'azienda attiva è contesto, non contenuto: niente cornice da scheda.
  // Stesso giudizio della campanella: `border:` che non sia 0/none, o un
  // fondo di superficie, farebbero del contesto una scheda.
  const csBlock = extraCss.match(/\.company-switch\s*\{([^}]*)\}/)?.[1] ?? '';
  check('.company-switch esiste in extra.css', csBlock !== '');
  check('l\'azienda attiva non ha cornice', !/\bborder\s*:(?!\s*(?:0(?:[;\s]|$)|none\b))/.test(csBlock));
  check('l\'azienda attiva non ha fondo di superficie', !/\bbackground\s*:\s*var\(--(card|bg)\)/.test(csBlock));

  // Le impostazioni stanno IN FONDO (margin-top: auto) e la navigazione
  // scorre da sé quando lo schermo è basso: senza, il fondo sparirebbe.
  const footBlock = appCss.match(/\.nav-foot\s*\{([^}]*)\}/)?.[1] ?? '';
  check('il piede della barra è spinto in fondo', /margin-top:\s*auto/.test(footBlock));
  // Sticky col fondo della superficie: a 375px la navigazione scorre, e
  // «Impostazioni» deve restare visibile — trovato SPARITO sotto la piega
  // alla prima verifica a schermo, non dedotto dal codice.
  check('il piede resta visibile quando la navigazione scorre',
    /position:\s*sticky/.test(footBlock) && /bottom:\s*0/.test(footBlock) && /background:\s*var\(--card\)/.test(footBlock));
  const navBlock = appCss.match(/\.nav\s*\{([^}]*)\}/)?.[1] ?? '';
  check('la navigazione scorre quando non ci sta', /overflow-y:\s*auto/.test(navBlock) && /flex:\s*1/.test(navBlock));
}

{
  // LE DUE PAGINE DELLE SCADENZE portano la STESSA testata (DeadlinesHead):
  // titolo dalla chiave della voce di menu e interruttore elenco/calendario.
  const tasksPage = readFileSync(join(root, 'src/features/tasks/TasksPage.tsx'), 'utf8');
  const calendarPage = readFileSync(join(root, 'src/features/calendar/CalendarPage.tsx'), 'utf8');
  check('l\'elenco monta la testata comune in modo elenco',
    /<DeadlinesHead mode="list"/.test(tasksPage));
  check('il calendario monta la testata comune in modo calendario',
    /<DeadlinesHead mode="calendar"/.test(calendarPage));
  const head = readFileSync(join(root, 'src/features/tasks/DeadlinesHead.tsx'), 'utf8');
  check('la testata usa la chiave della voce di menu (un nome, un posto)',
    /t\('nav\.tasks'\)/.test(head));
  check('l\'interruttore naviga alle due rotte vive',
    /to="\/attivita"/.test(head) && /to="\/calendario"/.test(head));

  // LA SCORCIATOIA della Panoramica porta ESATTAMENTE dove porta la voce
  // «Analizza documento» della barra — stessa destinazione, letta dai
  // sorgenti di entrambe.
  const home = readFileSync(join(root, 'src/features/dashboard/HomePage.tsx'), 'utf8');
  const adminItem = NAV.find((e) => !isSection(e) && e.id === 'admin') as NavItem;
  const shortcut = new RegExp(`to="${adminItem.path.replace('/', '\\/')}"[^\\n]*home\\.analyzeDoc`);
  check('«Analizza un documento» porta dove porta la voce della barra', shortcut.test(home));
}

// ---------------------------------------------------------------------------
section('6. Gerarchia e densità dentro le pagine');

// ⚠️ PERCHÉ. Il lavoro di fc4003d aveva dato al dettaglio documento una sola
// azione primaria, tre livelli di superficie e una colonna di lettura — e
// nessun controllo li sorvegliava. Nei giorni successivi il blu d'azione è
// tornato a marcare lo STATO dei filtri in cinque schermate, e la testata
// comune nata il 2026-08-13 lo ha riportato pure lei. Una regola di design
// senza guardiano è una regola che dura fino al prossimo componente.

{
  // (a) IL BLU D'AZIONE NON È UNO STATO PREMUTO.
  // `aria-pressed` dice «questo è un interruttore»: un interruttore acceso è
  // una SUPERFICIE (`btn-toggle`), non l'azione della schermata. Il controllo
  // guarda il singolo tag di apertura, così un pulsante primario e un
  // interruttore che stanno nella stessa riga non si confondono fra loro.
  const feature = join(root, 'src/features');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.tsx')) files.push(p);
    }
  };
  walk(feature);
  walk(join(root, 'src/components'));

  const colpevoli: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    // Ogni tag di apertura di un elemento interattivo, fino al `>` che lo chiude.
    for (const m of src.matchAll(/<(?:button|Link|a)\b[^>]*>/g)) {
      const tag = m[0];
      if (tag.includes('aria-pressed') && tag.includes('btn-primary')) {
        colpevoli.push(`${f.replace(`${root}/`, '')}: ${tag.slice(0, 70).replace(/\s+/g, ' ')}…`);
      }
    }
  }
  check(
    'nessun pulsante usa il blu d\'azione come stato premuto',
    colpevoli.length === 0,
    colpevoli.join('\n     '),
  );
}

{
  const appCssRaw = readFileSync(join(root, 'src/styles/app.css'), 'utf8');
  // ⚠️ I COMMENTI SI TOLGONO PRIMA DI GIUDICARE. Alla prima esecuzione questo
  // controllo è uscito rosso sul codice GIÀ CORRETTO, perché il commento che
  // spiega il difetto ne cita il selettore: un test che legge la prosa invece
  // delle regole vieta di documentare ciò che si è corretto.
  const appCss = appCssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

  // (b) IL FILETTO DEI BLOCCHI PIANI SI DÀ A CHI SEGUE.
  // `:first-of-type` guarda il TIPO di elemento, non la classe: con quella
  // regola il filetto restava sul primo blocco piano e spariva dall'unico
  // `<details>` della pagina — il contrario di ciò che il commento prometteva.
  check(
    'il filetto del blocco piano non dipende dal tipo di elemento',
    !/\.surface-2:first-of-type/.test(appCss),
    'usare `.surface-2 ~ .surface-2`: la classe, non il tag',
  );
  check(
    'il filetto lo porta il blocco piano che SEGUE un altro blocco piano',
    /\.surface-2\s*~\s*\.surface-2\s*\{[^}]*border-top:/.test(appCss),
  );

  // (c) IL TESTO CORRENTE HA UNA MISURA DI LETTURA.
  // Non basta che `--measure` esista: deve essere CONSUMATO da ogni classe che
  // porta prosa. `.page-desc` aveva 640px scritti a mano — ~94 caratteri, cioè
  // il numero che il token è nato per correggere.
  // ⚠️ UN ELENCO ESPLICITO, non un divieto generico di `max-width` in pixel.
  // La prima versione cercava `max-width: 6..px` in tutto il foglio e usciva
  // rossa su `.onboarding-card`, `.crm-narrow`, `.ct-narrow`: quelle sono
  // larghezze di CONTENITORI, e un pixel lì è una scelta di layout, non una
  // riga di testo decisa a occhio. Un controllo che grida su ciò che è giusto
  // si impara a ignorare, e da quel momento non protegge più niente.
  // Le classi qui sotto sono quelle che portano PROSA: chi ne aggiunge una
  // aggiunge una riga qui.
  // ⚠️ `.footnote` NON è in questo elenco dal 2026-08-14, ed è una promozione,
  // non un'esenzione: il suo testo resta nella misura ma con un padding, così
  // il filetto sopra può correre per intero. Il controllo suo sta più sotto,
  // nella sezione 10 — chi togliesse il padding lo farebbe fallire.
  for (const classe of ['.prose', '.page-desc', '.greeting-sub', '.legal-note', '.hero p']) {
    const sel = classe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blocco = appCss.match(new RegExp(`${sel}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    check(
      `${classe} porta la misura di lettura`,
      /max-width:\s*var\(--measure\)/.test(blocco),
      blocco ? `trovato: ${blocco.trim().slice(0, 60)}` : 'regola assente',
    );
  }

  // (d) IL NUMERO PIÙ GRANDE È UNO SOLO.
  // `.meter-num` era `--fs-h1` come il valore della scheda grande: due primi
  // posti non fanno gerarchia.
  const meter = appCss.match(/\.meter-num\s*\{([^}]*)\}/)?.[1] ?? '';
  check(
    'la percentuale di completamento non compete col numero che conta di più',
    /font-size:\s*var\(--fs-h2\)/.test(meter),
    `.meter-num: ${meter.trim().slice(0, 60)}`,
  );
}

{
  // (e) SCADENZE E ATTIVITÀ: un'area, un sottotitolo, un nome per ogni porta.
  const head = readFileSync(join(root, 'src/features/tasks/DeadlinesHead.tsx'), 'utf8');
  check(
    'la testata comune non riceve più un sottotitolo per vista',
    !head.includes('subtitleKey'),
    'il sottotitolo descrive l\'AREA: due sottotitoli che si alternano sono due nomi per una cosa sola',
  );
  check('la testata usa il sottotitolo unico dell\'area', /t\('tasks\.areaSubtitle'\)/.test(head));
  // Le vecchie chiavi non devono sopravvivere: una chiave orfana è la seconda
  // fonte di verità che aspetta solo di essere ripescata.
  const dizionari = { it, de, fr } as Record<string, Record<string, Record<string, unknown>>>;
  for (const [lang, d] of Object.entries(dizionari)) {
    check(
      `${lang}: nessun sottotitolo residuo di elenco o calendario`,
      d.tasks.hubSubtitle === undefined && d.calendar.subtitle === undefined,
    );
    check(`${lang}: l'area ha il suo sottotitolo`, typeof d.tasks.areaSubtitle === 'string');
  }

  const cal = readFileSync(join(root, 'src/features/calendar/CalendarPage.tsx'), 'utf8');
  check(
    'il collegamento del calendario si chiama «Sincronizzazione», non «Impostazioni»',
    /t\('calendar\.sync'\)/.test(cal) && !/t\('calendar\.settings'\)/.test(cal),
  );
  // ⚠️ E NON PORTA L'ICONA DELL'INGRANAGGIO: la parola cambiata e il segno no
  // sarebbero due porte ancora indistinguibili a colpo d'occhio.
  const rigaSync = cal.split('\n').find((l) => l.includes("calendar.sync")) ?? '';
  const contesto = cal.slice(Math.max(0, cal.indexOf(rigaSync) - 200), cal.indexOf(rigaSync) + rigaSync.length);
  check(
    'e non porta l\'icona della voce Impostazioni',
    !/name="settings"/.test(contesto),
    contesto.slice(-90).replace(/\s+/g, ' '),
  );
  for (const [lang, d] of Object.entries(dizionari)) {
    check(
      `${lang}: «Sincronizzazione» non si chiama come la voce Impostazioni`,
      typeof d.calendar.sync === 'string'
        && (d.calendar.sync as string).toLowerCase() !== (d.nav.settings as string).toLowerCase(),
      `${d.calendar.sync} / ${d.nav.settings}`,
    );
  }
}

{
  // (f) LE SCORCIATOIE DELLA PANORAMICA PARLANO COME LA BARRA.
  // Non basta che portino alla stessa rotta (lo prova già la sezione 5): se il
  // nome è un altro, chi legge non sa che è lo stesso posto.
  // Si prendono le QUATTRO stringhe che servono, tipizzate dal dizionario
  // stesso: un cast dell'intero dizionario a `Record<…>` non regge (le sezioni
  // hanno profondità diverse) e passare da `unknown` spegnerebbe proprio il
  // controllo che rende utile questo file — se una chiave sparisce, deve
  // fallire la COMPILAZIONE, non un'asserzione a runtime.
  const dizionari = [
    { lang: 'it', nav: it.nav, home: it.home },
    { lang: 'de', nav: de.nav, home: de.home },
    { lang: 'fr', nav: fr.nav, home: fr.home },
  ];
  for (const d of dizionari) {
    const lang = d.lang;
    check(
      `${lang}: «${d.home.analyzeDoc}» è la voce della barra, alla lettera`,
      d.home.analyzeDoc === d.nav.analyzeDoc,
      `barra «${d.nav.analyzeDoc}» · scorciatoia «${d.home.analyzeDoc}»`,
    );
    // Per gli incentivi la scorciatoia è un'AZIONE e la voce un LUOGO: i due
    // testi non possono coincidere alla lettera, ma il NOME DELLA COSA sì —
    // ed era «Fördermittel» contro «Förderungen».
    const parole = d.nav.incentives.split(/[^\p{L}]+/u).filter((w) => w.length >= 5).map((w) => w.toLowerCase());
    const scorciatoia = d.home.findSubsidies.toLowerCase();
    check(
      `${lang}: la scorciatoia agli incentivi usa il sostantivo della barra`,
      parole.some((w) => scorciatoia.includes(w)),
      `barra «${d.nav.incentives}» · scorciatoia «${d.home.findSubsidies}»`,
    );
  }
}

// ---------------------------------------------------------------------------
section('7. Il vocabolario della fiducia — le famiglie di marcature');

// ⚠️ PERCHÉ QUESTA SEZIONE. Il sistema di marcature è nato il 2026-08-12 con
// cinque famiglie e una legenda che si aggiorna da sola; in dieci giorni sono
// arrivate tre famiglie nuove (stato del lavoro, priorità, finestra) e in
// mezza dozzina di schermate le pastiglie colorate non se ne sono andate da
// sole. Le regole del vocabolario sono tre, e nessuna era sorvegliata:
//   · ogni famiglia ha una FORMA propria e il colore è rinforzo;
//   · la legenda mostra TUTTE le famiglie, sempre le stesse;
//   · una schermata che usa un segno monta la legenda.
// Una regola di design senza guardiano dura fino al prossimo componente
// (lezione della sezione 6, pagata due volte).

{
  const appCss = readFileSync(join(root, 'src/styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const legendSrc = readFileSync(join(root, 'src/components/ui/MarkLegend.tsx'), 'utf8');

  // Le mappe VERE, importate: se una famiglia cambia, questo elenco non resta
  // indietro perché non descrive niente — usa gli oggetti stessi.
  // `labelKey` può essere null: il TERMINE compone il suo testo con i numeri
  // («fra 12 giorni») e non ha una chiave fissa per ogni stato.
  const famiglie: { nome: string; mappa: Record<string, { cls: string; glyph?: MarkGlyphName; labelKey: string | null }> }[] = [
    { nome: 'PROVENANCE_KINDS', mappa: PROVENANCE_KINDS },
    { nome: 'CONFIDENCE_LEVELS', mappa: CONFIDENCE_LEVELS },
    { nome: 'ELIGIBILITY_STATES', mappa: ELIGIBILITY_STATES },
    { nome: 'SOURCE_STATES', mappa: SOURCE_STATES },
    { nome: 'DEADLINE_STATES', mappa: DEADLINE_STATES },
    { nome: 'APPOINTMENT_STATES', mappa: APPOINTMENT_STATES },
    { nome: 'TASK_STATES', mappa: TASK_STATES },
    { nome: 'PRIORITY_LEVELS', mappa: PRIORITY_LEVELS },
    { nome: 'WINDOW_STATES', mappa: WINDOW_STATES },
  ];

  // (a) OGNI SEGNO CHIEDE UN GLIFO CHE ESISTE.
  // Un nome sbagliato non esplode: `GLYPHS[name]` è `undefined` e il
  // componente rende un `<svg>` vuoto — una marcatura senza forma, cioè un
  // segno che resta affidato al solo colore.
  const glifiIgnoti: string[] = [];
  for (const f of famiglie) {
    for (const [k, v] of Object.entries(f.mappa)) {
      if (v.glyph && !GLYPH_NAMES.includes(v.glyph)) glifiIgnoti.push(`${f.nome}.${k} → ${v.glyph}`);
    }
  }
  check('ogni famiglia chiede glifi che esistono', glifiIgnoti.length === 0, glifiIgnoti.join(', '));

  // (b) OGNI SEGNO HA LA SUA REGOLA NEL FOGLIO DI STILE.
  // Una classe dichiarata in una mappa e mai scritta in app.css è un segno che
  // eredita il colore di quello accanto: si vede solo aprendo la schermata
  // giusta nella lingua giusta, che è il modo peggiore di accorgersene.
  const classiOrfane: string[] = [];
  for (const f of famiglie) {
    for (const [k, v] of Object.entries(f.mappa)) {
      if (!new RegExp(`\\.${v.cls}\\b`).test(appCss)) classiOrfane.push(`${f.nome}.${k} → .${v.cls}`);
    }
  }
  check('ogni segno ha la sua regola in app.css', classiOrfane.length === 0, classiOrfane.join(', '));

  // (c) OGNI VOCE DI OGNI FAMIGLIA HA UN'ETICHETTA NELLE TRE LINGUE.
  // ⚠️ Il colore NON è portatore: la parola c'è sempre, e se manca in una
  // lingua sola quella lingua resta col solo segno grafico.
  const dizionari: Record<string, unknown> = { it, de, fr };
  const risolvi = (d: unknown, chiave: string): unknown =>
    chiave.split('.').reduce<unknown>((acc, p) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[p] : undefined), d);
  const senzaParola: string[] = [];
  for (const f of famiglie) {
    for (const [k, v] of Object.entries(f.mappa)) {
      if (!v.labelKey) continue; // DEADLINE_STATES.none porta numeri, non una chiave fissa
      for (const [lang, d] of Object.entries(dizionari)) {
        if (typeof risolvi(d, v.labelKey) !== 'string') senzaParola.push(`${lang}: ${f.nome}.${k} → ${v.labelKey}`);
      }
    }
  }
  check('ogni segno porta la sua parola in it/de/fr', senzaParola.length === 0, senzaParola.join('\n     '));

  // (d) LA PRIORITÀ NON RUBA IL SEGNO DELLA CONFIDENZA.
  // Sono due domande diverse — quanto conta un lavoro, quanto è affidabile
  // un'analisi — ed erano già state confuse una volta, quando entrambe erano
  // una pastiglia colorata. La triade di punti resta di una sola famiglia.
  const glifiConf = new Set(Object.values(CONFIDENCE_LEVELS).map((v) => v.glyph));
  const glifiPrio = new Set(Object.values(PRIORITY_LEVELS).map((v) => v.glyph));
  check(
    'priorità e confidenza non condividono nessun glifo',
    [...glifiPrio].every((g) => !glifiConf.has(g)),
    [...glifiPrio].filter((g) => glifiConf.has(g)).join(', '),
  );

  // (e) LA LEGENDA NON PUÒ INVECCHIARE: mostra TUTTE le famiglie.
  // Itera le mappe, quindi uno stato nuovo compare da sé — ma una FAMIGLIA
  // nuova va aggiunta, e finché non lo è i suoi segni sono in giro senza che
  // niente li spieghi.
  const fuoriLegenda = famiglie
    // Le due famiglie di DATE si rendono con esempi numerici, non iterando la
    // mappa: «fra 12 giorni» non è una parola fissa. Il blocco c'è lo stesso, e
    // il conteggio qui sotto lo pretende.
    .filter((f) => f.nome !== 'DEADLINE_STATES' && f.nome !== 'APPOINTMENT_STATES')
    .filter((f) => !legendSrc.includes(f.nome))
    .map((f) => f.nome);
  check('la legenda elenca tutte le famiglie', fuoriLegenda.length === 0, fuoriLegenda.join(', '));
  // ⚠️ E NON BASTA CHE IL NOME COMPAIA. Trovato provando a rompere questo
  // controllo: rinominando l'import la mappa restava citata nel file e il
  // verde reggeva pur senza il blocco reso — la stessa famiglia di verde falso
  // del byte NUL. Si contano anche i BLOCCHI: uno per famiglia, più quello
  // della provenienza delle azioni, che non ha una mappa sua perché usa le
  // due forme della provenienza con le parole delle azioni.
  const blocchi = legendSrc.match(/ml-fam-title/g)?.length ?? 0;
  check(
    'la legenda rende un blocco per ogni famiglia',
    blocchi === famiglie.length + 1,
    `${blocchi} blocchi per ${famiglie.length + 1} famiglie`,
  );

  // (f) CHI MOSTRA UN SEGNO MOSTRA LA LEGENDA.
  // ⚠️ Elenco esplicito di PAGINE, non una regola dedotta dagli import: le
  // righe e le testate vivono in file propri (NextStepCard, parts.tsx) e
  // pretendere la legenda anche là ne metterebbe tre sulla stessa schermata.
  // Chi aggiunge una pagina con dei segni aggiunge una riga qui.
  const pagineConSegni = [
    'src/features/tasks/TasksPage.tsx',
    'src/features/tasks/TaskDetailPage.tsx',
    'src/features/calendar/CalendarPage.tsx',
    'src/features/documents/DocumentsPage.tsx',
    'src/features/documents/DocumentDetailPage.tsx',
    'src/features/admin-ai/ResultView.tsx',
    'src/features/incentives/OpportunitiesTab.tsx',
    'src/features/incentives/OpportunityDetail.tsx',
    'src/features/incentives/CatalogTab.tsx',
    'src/features/subsidy-ai/ResultsList.tsx',
    'src/features/subsidy-ai/ProgramDetail.tsx',
  ];
  const senzaLegenda = pagineConSegni
    .filter((p) => !readFileSync(join(root, p), 'utf8').includes('<MarkLegend />'));
  check('ogni schermata con segni monta la legenda', senzaLegenda.length === 0, senzaLegenda.join(', '));

  // (g) NIENTE PASTIGLIE DI STATO NELLE SCHERMATE DEL VOCABOLARIO.
  // `badge-alta/media/bassa` è la scala degli allarmi: rosso, ambra, verde. Ci
  // finivano una priorità, un'idoneità e un ritardo — tre cose che non sono
  // guasti. Il perimetro è quello delle schermate convertite: altrove (Inbox,
  // Contratti, CRM) le pastiglie descrivono altro e restano.
  //
  // ⚠️ LE ECCEZIONI SONO DICHIARATE QUI, una riga ciascuna con il motivo — come
  // in `design-lint.mjs`, e per la stessa ragione: ciò che non passa dal
  // controllo deve passare da una frase che si può contestare. Il rosso È il
  // colore giusto quando qualcosa è andato storto DAVVERO, e sono questi i
  // casi. Un'eccezione che non corrisponde più a niente fa fallire il
  // controllo: va tolta, non dimenticata.
  const eccezioni: { file: string; motivo: string }[] = [
    {
      file: 'src/features/documents/DocumentsPage.tsx',
      motivo: 'un\'analisi FALLITA è un guasto vero: il rosso è il suo colore, non un prestito',
    },
    {
      file: 'src/features/calendar/CalendarSettingsPage.tsx',
      motivo: 'connessione in errore o da riautorizzare: il calendario non si sta sincronizzando',
    },
  ];
  const perimetro = ['tasks', 'calendar', 'documents', 'subsidy-ai', 'incentives'];
  const conPastiglie: string[] = [];
  const eccezioniUsate = new Set<string>();
  for (const dir of perimetro) {
    const base = join(root, 'src/features', dir);
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) files.push(p);
      }
    };
    walk(base);
    for (const file of files) {
      const rel = file.replace(`${root}/`, '');
      const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      // ⚠️ DUE FORME, DALLA MIGRAZIONE A `Tag` del 2026-08-14: le pastiglie
      // d'allarme non si scrivono più con le classi `badge-alta|media|bassa`,
      // si chiedono con `<Tag tone="alert">` e `tone="attention"`. Guardare le
      // sole classi vecchie avrebbe lasciato passare la stessa cosa scritta nel
      // modo nuovo — un controllo che diventa cieco proprio mentre il codice
      // che sorveglia cambia. Le classi restano nel controllo perché
      // sopravvivono in `Tag.tsx` e in un componente di terze parti potrebbero
      // ricomparire.
      // ⚠️ ANCHE NELLA FORMA DA MAPPA. Il tono spesso non è scritto nel JSX ma
      // in una tabella in cima al file (`STATUS_TONE = { error: 'alert', … }`),
      // e cercare il solo `tone="alert"` non lo vede: è così che il primo
      // tentativo ha lasciato morire l'eccezione del calendario, che il tono
      // d'allarme ce l'ha eccome. Si cercano i VALORI, ovunque stiano.
      // Due forme e due sole: il tono scritto nel JSX (`tone="alert"`) e il
      // tono che sta in una tabella (`reauth_required: 'alert',`).
      // ⚠️ NON il semplice `'alert'` sciolto: quello è anche il nome di
      // un'icona (`<Icon name="alert" />`), che sta in mezzo modulo — provato,
      // e dava dieci rossi falsi in un colpo.
      if (!/badge-(alta|media|bassa)|tone="(alert|attention)"|:\s*'(alert|attention)'/.test(src)) continue;
      if (eccezioni.some((e) => e.file === rel)) { eccezioniUsate.add(rel); continue; }
      conPastiglie.push(rel);
    }
  }
  check(
    'nessuna pastiglia d\'allarme dove parlano i segni',
    conPastiglie.length === 0,
    conPastiglie.join(', '),
  );
  // Un'eccezione morta è una regola che sembra ancora in vigore e non protegge
  // più niente: la si toglie, come pretende `design-lint`.
  const eccezioniMorte = eccezioni.filter((e) => !eccezioniUsate.has(e.file)).map((e) => e.file);
  check(
    'nessuna eccezione dichiarata è rimasta senza riscontro',
    eccezioniMorte.length === 0,
    eccezioniMorte.join(', '),
  );

  // (h) LE PAROLE VIETATE RESTANO VIETATE.
  // ⚠️ Il perimetro sono le ETICHETTE D'IDONEITÀ, non l'intero dizionario:
  // `subsidy.cases.statuses.approved` dice che una PERSONA ha registrato l'esito
  // di un'autorità, ed è un fatto vero che va poter dire. Qui si vieta all'app
  // di DEDURRE un'idoneità: dichiararla spetta all'autorità, non a noi.
  const vietate = /approvat|garantit|ufficialmente|genehmigt|garantiert|offiziell|approuv|garanti|officiellement/i;
  const promesse: string[] = [];
  for (const [lang, d] of Object.entries(dizionari)) {
    for (const v of Object.values(ELIGIBILITY_STATES)) {
      const testo = risolvi(d, v.labelKey);
      if (typeof testo === 'string' && vietate.test(testo)) promesse.push(`${lang}: «${testo}» (${v.labelKey})`);
    }
  }
  check('nessuna etichetta d\'idoneità promette un esito', promesse.length === 0, promesse.join('\n     '));

  // (i) L'INGOMBRO TEDESCO — DIECI CARATTERI, e il numero è misurato.
  //
  // Stato, priorità e termine stanno sulla STESSA riga d'elenco, sotto il
  // titolo. Banco di prova del 2026-08-13, viewport 375, dizionario tedesco,
  // riga peggiore («In Arbeit» + «hoch» + «seit 3 Tagen überfällig»): con
  // un'etichetta di stato di 10 caratteri i tre segni restano su una riga con
  // 2 pixel di margine; a 11 la riga si spezza e cresce da 127 a 159 pixel.
  // Il primo tentativo di questo controllo diceva 12 — un numero scelto a
  // occhio, che avrebbe lasciato passare proprio ciò che deve fermare.
  //
  // ⚠️ NON promette che la riga non vada MAI a capo: con la priorità più lunga
  // («niedrig») e la frase di ritardo più lunga i segni passano a due righe
  // anche con le etichette di oggi, e va bene — restano tutti leggibili e
  // nessuno viene troncato. Quello che questo controllo impedisce è che una
  // sola parola faccia da sola quel danno, in una lingua sola.
  const inRiga = [...Object.values(TASK_STATES), ...Object.values(PRIORITY_LEVELS)];
  const troppoLunghe: string[] = [];
  for (const [lang, d] of Object.entries(dizionari)) {
    for (const v of inRiga) {
      const testo = risolvi(d, v.labelKey);
      if (typeof testo === 'string' && testo.length > 10) troppoLunghe.push(`${lang}: «${testo}» (${testo.length})`);
    }
  }
  check('nessuna etichetta di stato o priorità supera i dieci caratteri', troppoLunghe.length === 0, troppoLunghe.join(', '));

  // (l) IL CONTO DEI GIORNI DI RITARDO È UNO SOLO.
  // Lo scadenziario aveva il suo (`overdueByDays` in calendarModel) accanto a
  // quello della famiglia del termine: due aritmetiche della stessa scadenza.
  // Resta questa, e si prova qui — comprese le due giornate di scarto attorno
  // a oggi, dove un conto sui millisecondi sbaglia.
  const oggi = new Date('2026-09-01T10:00:00');
  const giorniFa = (iso: string) => deadlineState(iso, false, 7, oggi);
  check('due giorni di ritardo si contano due', giorniFa('2026-08-30').state === 'over' && giorniFa('2026-08-30').days === 2);
  check('oggi non è in ritardo', giorniFa('2026-09-01').state === 'today');
  check('domani è vicino, non scaduto', giorniFa('2026-09-02').state === 'soon');
  check('senza data si dichiara «nessuna scadenza»', deadlineState(null).state === 'none');

  // ⚠️⚠️ L'APPUNTAMENTO CONTA I GIORNI COME IL TERMINE, MA NON GIUDICA.
  // Il 10.09.2026 era un sopralluogo del Comune presentato come scadenza. Da
  // qui in poi ha un segno suo, e la differenza che conta è il passato: un
  // termine mancato è un guaio («scaduto da 2 giorni», rosso), un sopralluogo
  // passato è semplicemente avvenuto. Se `past` diventasse `over`, il segno
  // tornerebbe a raccontare un allarme che il dato non dichiara.
  const app = (iso: string) => appointmentState(iso, 7, oggi);
  check('un appuntamento passato è passato, non «scaduto»',
    app('2026-08-30').state === 'past' && app('2026-08-30').days === 2);
  check('oggi è oggi', app('2026-09-01').state === 'today');
  check('domani è vicino', app('2026-09-02').state === 'soon');
  check('e a due settimane è solo futuro', app('2026-09-15').state === 'future');
  // La coppia che tiene separate le due famiglie: stessa data, due letture.
  check('LA COPPIA: la stessa data passata, termine e appuntamento non dicono la stessa cosa',
    giorniFa('2026-08-30').state === 'over' && app('2026-08-30').state === 'past');
}

// ---------------------------------------------------------------------------
section('8. Cifre tabulari — dove i numeri stanno in colonna');

{
  // ⚠️ PERCHÉ UN CONTROLLO E NON UNA RIGA NEL SISTEMA DI DESIGN. La regola
  // «cifre tabulari dove i numeri si impilano» è scritta in design-system.md
  // §11 dal 2026-08-10, ed è bastata a coprire scadenze e importi di Finanze —
  // ma NON i KPI della Panoramica, che sono rimasti con le cifre proporzionali
  // per tre giorni con tutta la suite verde. Una regola scritta che non ha un
  // controllo copre ciò a cui qualcuno ha pensato, e niente altro.
  //
  // Il perimetro sono le classi il cui contenuto è SEMPRE un numero e che
  // stanno in una colonna. Non è l'elenco di tutti i numeri dell'app: è
  // l'elenco di quelli che si guardano uno sotto l'altro.
  const NUMERICHE: { selettore: string; file: string; perche: string }[] = [
    { selettore: '.kpi-value', file: 'src/styles/app.css', perche: 'griglia 2×2, e una colonna sola sotto i 600px' },
    { selettore: '.bar-val', file: 'src/styles/app.css', perche: 'colonna fissa da 42px allineata a destra' },
    { selettore: '.meter-num', file: 'src/styles/app.css', perche: 'percentuale di completamento della Panoramica' },
    { selettore: '.dl-date', file: 'src/styles/app.css', perche: 'pila di scadenze' },
    { selettore: '.rb-num', file: 'src/styles/app.css', perche: 'percentuali di rilevanza, una scheda sotto l\'altra' },
    { selettore: '.doc-row-date', file: 'src/styles/app.css', perche: 'colonna delle date nell\'elenco documenti' },
    { selettore: '.fin-num', file: 'src/styles/extra.css', perche: 'gli importi' },
    { selettore: '.crm-kv dd', file: 'src/styles/extra.css', perche: 'colonna dei valori: importi e scadenze fuori da Finanze' },
  ];
  const fogli = new Map<string, string>();
  const senza: string[] = [];
  for (const n of NUMERICHE) {
    // ⚠️ I commenti si tolgono PRIMA di spezzare in regole, non dentro il
    // ciclo: la testata di `.kpi-value` contiene «24,4px · «40» 38,8px», e
    // spezzando sulle virgole il commento si rompe a metà — le due metà non
    // sono più riconoscibili come commento e finiscono nel nome del selettore.
    // Trovato perché il controllo, appena scritto, dava per scoperte cinque
    // classi che dichiarano la proprietà: un rosso falso.
    if (!fogli.has(n.file)) {
      fogli.set(n.file, readFileSync(join(root, n.file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' '));
    }
    const css = fogli.get(n.file)!;
    // ⚠️ Si cerca la regola che COLPISCE quel selettore, non una riga uguale
    // alla lettera: `.rb-num` vive dentro `.rel-badge .rb-num`, e la prima
    // stesura di questo controllo l'ha dato per scoperto pur essendo a posto —
    // un rosso falso è un difetto quanto un verde falso. Basta che il selettore
    // FINISCA con il bersaglio (`.rel-badge .rb-num` sì, `.rb-num-alt` no).
    // `[^{}]*` anche nel corpo: così si agganciano solo le regole PIÙ INTERNE,
    // e un blocco `@media` non viene scambiato per una regola.
    const dichiara = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].some(([, sel, corpo]) => {
      if (!/font-variant-numeric:\s*tabular-nums/.test(corpo)) return false;
      return sel.split(',').some((s) => {
        const pulito = s.trim();
        return pulito === n.selettore || pulito.endsWith(` ${n.selettore}`);
      });
    });
    if (!dichiara) senza.push(`${n.selettore} (${n.perche})`);
  }
  check(
    'ogni classe di numeri in colonna dichiara le cifre tabulari',
    senza.length === 0,
    `${senza.join('; ')}\n     Inter usa cifre proporzionali: il «1» è più stretto, e la colonna balla.`,
  );
}

// ---------------------------------------------------------------------------
section('9. Le etichette — una sola implementazione, e il tono non si sceglie a occhio');

{
  // ⚠️ PERCHÉ ESISTE. `.badge` era una classe, non un componente: ogni modulo
  // scriveva il proprio <span className="badge badge-…"> e sceglieva il TONO
  // riga per riga. Il risultato, misurato leggendo il codice il 2026-08-14:
  //   · lo STESSO stato di relazione era rosso/ambra/blu nell'elenco clienti e
  //     grigio neutro nella scheda dello stesso cliente;
  //   · gli STESSI ruoli erano neutri nell'elenco e blu nella scheda;
  //   · lo stato di un'opportunità portava l'ambra, cioè il colore che in tutto
  //     il resto del prodotto significa «attenzione», su un fatto normale.
  // Nessuno di questi era visibile da un controllo, perché non c'era niente da
  // controllare: erano stringhe. Ora c'è `Tag`, e questo tiene ferma la regola.
  const moduli = join(root, 'src/features');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.tsx')) files.push(p);
    }
  };
  walk(moduli);

  const aMano: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // `badge-row` è un CONTENITORE di righe, non una pastiglia: non entra.
    // `bell-badge` è il pallino dei non letti, che non è un'etichetta.
    const righe = src.split('\n');
    righe.forEach((riga, i) => {
      // ⚠️ `(?<![\w-])badge` e non `\bbadge\b`: il trattino è un confine di
      // parola, quindi `\b` acchiappa anche `rel-badge` — che è la scheda di
      // pertinenza degli incentivi, una classe sua con il suo CSS, non una
      // pastiglia scritta a mano. Trovato alla prima esecuzione: due rossi
      // falsi su codice a posto.
      if (!/className=(\{`|")[^"`]*(?<![\w-])badge(?![\w-])/.test(riga)) return;
      // `badge-row` è il CONTENITORE delle righe di pastiglie, non una
      // pastiglia; `bell-badge` è il pallino dei non letti.
      if (/badge-row|bell-badge/.test(riga)) return;
      aMano.push(`${file.replace(`${root}/`, '')}:${i + 1}`);
    });
  }
  check(
    'nessuna pastiglia scritta a mano nei moduli',
    aMano.length === 0,
    `${aMano.join(', ')}\n     Le etichette si compongono con <Tag> (components/ui/Tag.tsx): il tono si omette, a meno di saper dire perché.`,
  );
}

// ---------------------------------------------------------------------------
section('10. Rifiniture — la barra che scorre, la legenda, i numeri che portano');

// ⚠️ PERCHÉ QUESTA SEZIONE. Cinque difetti visti a schermo il 2026-08-14, tutti
// invisibili al typecheck e al design-lint perché nessuno riguarda un valore
// scritto a mano: una barra di scorrimento vestita col default del sistema, una
// legenda che compariva su pagine senza segni, schede numeriche che non
// portavano da nessuna parte, zeri senza messaggio, un filetto largo la metà
// del suo blocco. Ciò che si è corretto guardando va tenuto fermo leggendo.

{
  const appCss = readFileSync(join(root, 'src/styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const extraCss = readFileSync(join(root, 'src/styles/extra.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const blocco = (css: string, sel: string) =>
    css.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

  // (a) LA BARRA DI SCORRIMENTO DELLA NAVIGAZIONE È VESTITA, e da TUTT'E DUE i
  // meccanismi: la parola chiave standard per i motori recenti, la pseudo-classe
  // `-webkit-` per gli altri. Con una sola delle due, metà dei browser resta col
  // default di sistema — cioè il difetto di partenza, ma solo per qualcuno.
  const nav = blocco(appCss, '.nav, .drawer');
  check('la navigazione dichiara una barra sottile', /scrollbar-width:\s*thin/.test(nav), nav.trim().slice(0, 70));
  check(
    'e il suo colore viene dai token, su fondo trasparente',
    /scrollbar-color:\s*var\(--[\w-]+\)\s+transparent/.test(nav),
    nav.trim().slice(0, 90),
  );
  check(
    'la controparte -webkit esiste (motori che non leggono la parola chiave)',
    /::-webkit-scrollbar-thumb[^{]*\{[^}]*background:\s*var\(--/.test(appCss),
  );
  // ⚠️ Il colore della barra NON può essere un letterale: sarebbe l'unico punto
  // dell'app con un grigio deciso a mano, e in tema scuro resterebbe chiaro.
  // (design:lint non guarda `scrollbar-color`: non è una proprietà di colore
  // che conosce. Questo controllo copre il buco.)
  check(
    'nessun colore scritto a mano nelle regole della barra',
    !/scrollbar-color:[^;]*(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/.test(appCss)
      && !/::-webkit-scrollbar[^{]*\{[^}]*(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/.test(appCss),
  );

  // (b) IL PIÈ DI PAGINA — il filetto per intero, il testo nella misura.
  const foot = blocco(appCss, '.footnote');
  check(
    'il piè di pagina non lega più il filetto alla misura di lettura',
    !/max-width:\s*var\(--measure\)/.test(foot),
    `.footnote: ${foot.trim().slice(0, 80)}`,
  );
  check(
    'ma il testo resta nella misura, per padding',
    /padding-inline-end:\s*max\(\s*0px\s*,\s*calc\(\s*100%\s*-\s*var\(--measure\)\s*\)\s*\)/.test(foot),
    `.footnote: ${foot.trim().slice(0, 80)}`,
  );
  check('e il filetto sopra c\'è ancora', /border-top:\s*1px\s+solid\s+var\(--/.test(foot));

  // (c) LA SCHEDA NUMERICA COLLEGATA È UNA COLONNA FLEX come le altre.
  // Con `display: block` il `margin-top: auto` della didascalia non ha su cosa
  // appoggiarsi e la fila si disallinea di 6px.
  const link = blocco(extraCss, '.kpi-link');
  check('la scheda collegata resta una colonna flex', /display:\s*flex/.test(link), `.kpi-link: ${link.trim().slice(0, 70)}`);
  const linkHover = blocco(extraCss, '.kpi-link:hover');
  check(
    'e al passaggio del mouse non si sottolinea (la regola globale a:hover lo farebbe)',
    /text-decoration:\s*none/.test(linkHover),
    `.kpi-link:hover: ${linkHover.trim().slice(0, 70)}`,
  );
}

{
  // (d) LA PANORAMICA DISEGNATA DAI NUMERI (censimento 2026-08-19).
  // Non più una griglia di KPI: blocchi che compaiono solo con contenuto,
  // nell'ordine «decisioni → lavoro → limiti del sistema → opportunità».
  // Le decisioni per prime perché sbloccano il resto: il gate delle attività
  // dipende letteralmente da loro.
  // ⚠️ SENZA COMMENTI, tutti e tre i tipi: il preambolo di questa pagina NOMINA
  // `subsidy-worker` per spiegare perché il pulsante non c'è, e un lettore a
  // regex non distingue una riga che fa una cosa da una riga che la racconta —
  // è la guardia di `scope.ts` nata rossa da sola, la stessa lezione.
  const home = readFileSync(join(root, 'src/features/dashboard/HomePage.tsx'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const corpo = home.slice(home.indexOf('function OverviewBody'));
  const ordine = ['BloccoDecisioni', 'BloccoDaFare', 'BloccoSistema', 'BloccoOpportunita']
    .map((b) => corpo.indexOf(`<${b} `));
  check('i quattro blocchi ci sono, nell\'ordine deciso',
    ordine.every((i) => i >= 0) && ordine.every((i, k) => k === 0 || i > ordine[k - 1]!),
    `posizioni: ${ordine.join(', ')}`);
  // Le destinazioni, una per una: ogni numero porta alla pagina che rende LO
  // STESSO numero — e le popolazioni sono dichiarate nell'indirizzo
  // (`archiviati=1`), perché `list_documents` ne mostra una alla volta.
  for (const to of [
    '/documenti?appartenenza=1',
    '/attivita',
    '/documenti?stato=to_verify', '/documenti?stato=to_verify&archiviati=1',
    '/documenti?stato=failed', '/documenti?stato=failed&archiviati=1',
    '/documenti?stato=none', '/documenti?stato=none&archiviati=1',
    '/incentivi?scheda=progetti',
  ]) {
    check(`un blocco porta a ${to}`, home.includes(`"${to}"`) || home.includes(`'${to}'`));
  }
  // COSA NON C'È, DI PROPOSITO — e deve restare così:
  check('nessun grafico: non esiste una serie storica da mostrare',
    !home.includes('<Bars') && !/meter-fill/.test(home));
  check('nessun pulsante che chiami una funzione non invocabile («Avvia la verifica»)',
    !/subsidy-worker|functions\.invoke/.test(home),
    'il worker è dello scheduler: l\'azione vera è descrivere un progetto');
  check('il piè di pagina dichiara l\'insieme UNA volta, per tutta la pagina',
    home.includes('home.footPopulation') && home.includes('home.footUpdated'));
  check('lo stato vuoto dice cosa è stato controllato, non «tutto a posto»',
    home.includes('home.emptyChecked'));
  check('l\'esempio di un blocco passa dalla regola del titolo, mai dal grezzo',
    home.includes('documentLabelText') && !/item\.title|latest\.title/.test(home),
    'la prima riga di questa pagina è già stata «2.5» una volta');

  // (e) OGNI ZERO PORTA CON SÉ COSA HA ESCLUSO — le frasi esistono nelle tre
  // lingue e la pagina le usa. «Nessun termine» e «nessuno scaduto» sono
  // affermazioni, non assenze.
  const dizionari = [{ lang: 'it', d: it.home }, { lang: 'de', d: de.home }, { lang: 'fr', d: fr.home }];
  for (const { lang, d } of dizionari) {
    for (const [chiave, testo] of Object.entries({
      tasksTermsNone: d.tasksTermsNone, tasksOverdueNone: d.tasksOverdueNone,
      datesUnrecordedMany: d.datesUnrecordedMany, assessNever: d.assessNever,
      emptyChecked: d.emptyChecked, footPopulation: d.footPopulation,
    })) {
      check(`${lang}: la frase di ${chiave} esiste`, typeof testo === 'string' && testo.trim().length > 0);
    }
  }
  // ⚠️ LE CHIAVI COMPLETE, MAI COMPOSTE con un template `home.${…}`: il suo
  // prefisso statico «home.» renderebbe CIECA l'intera sezione home.* per
  // `i18n:orphans` — trovato per mutazione il 2026-08-20 (tolta l'unica
  // chiamante di home.datesMixed, il verde restava verde). La sentinella di
  // `sezioniCieche` ora lo impedisce; qui una chiave esatta è anche un uso
  // esatto, tenuto vero dal check stesso: se la Panoramica smette di usarla,
  // questa riga diventa rossa prima che l'orfana possa nascondersi.
  //
  // ⚠️ E LA DOMANDA SI FA SUI DUE FILE. Le due frasi degli zeri non stanno più
  // nel JSX: le nomina `chiaviTaskSplit`, la funzione PURA che decide quale
  // parola va su quale numero (§18, R4). Cercarle nella sola pagina renderebbe
  // rossa questa riga proprio per la correzione che la rafforza — e siccome
  // entrambi i file sono LETTI, la chiave resta un uso esatto per il
  // rilevatore in tutti e due i casi.
  const decisioni = readFileSync(join(root, 'src/features/dashboard/overviewBlocks.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const chiave of ['home.tasksTermsNone', 'home.tasksOverdueNone', 'home.assessNever', 'home.emptyChecked']) {
    check(`la Panoramica usa ${chiave}`,
      home.includes(chiave) || decisioni.includes(chiave));
  }
  // ⚠️ Il conteggio «da verificare» resta il totale della STESSA interrogazione
  // a cui porta il collegamento (stateTotals → list_documents), mai un
  // ricalcolo locale sulle analisi caricate.
  check('i totali dei documenti vengono da stateTotals, per popolazione',
    home.includes('daVerificare.attivi') && home.includes('daVerificare.archiviati'));
  check(
    'e nessun numero è ricalcolato sulla confidence in memoria',
    !/confidence\s*!==\s*'alta'/.test(home),
    'un conteggio locale e un filtro del database sono due verità sullo stesso fatto',
  );
}

{
  // (f) LA LEGENDA — mai una scheda dedicata, e solo dove ci sono segni.
  const moduli: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.tsx')) moduli.push(p);
    }
  };
  walk(join(root, 'src/features'));

  const dentroScheda: string[] = [];
  for (const f of moduli) {
    const src = readFileSync(f, 'utf8');
    src.split('\n').forEach((riga, i) => {
      if (!riga.includes('<MarkLegend')) return;
      // Una scheda DEDICATA è un contenitore che apre e chiude sulla stessa
      // riga attorno alla sola legenda: `<div className="card"><MarkLegend /></div>`.
      if (/className="[^"]*\bcard\b[^"]*"\s*>\s*<MarkLegend/.test(riga)) {
        dentroScheda.push(`${f.replace(`${root}/`, '')}:${i + 1}`);
      }
    });
  }
  check(
    'la legenda non è mai una scheda dedicata',
    dentroScheda.length === 0,
    `${dentroScheda.join(', ')}\n     È una riga richiudibile a piè di pagina: `
      + 'una superficie elevata attorno a un glossario dice «questo si legge», e non è vero.',
  );
  // E il piede se lo porta lei: undici copie di `mt-12` divergono, e soprattutto
  // resterebbero in pagina quando la legenda decide di non comparire.
  const conMargine = moduli.filter((f) => /className="mt-12"\s*>\s*<MarkLegend/.test(readFileSync(f, 'utf8')));
  check('e nemmeno un margine scritto attorno', conMargine.length === 0, conMargine.join(', '));

  const legenda = readFileSync(join(root, 'src/components/ui/MarkLegend.tsx'), 'utf8');
  check(
    'la legenda si mostra solo se nella pagina c\'è almeno un segno',
    /segni === 0/.test(legenda) && /contaSegni/.test(legenda),
  );
}

{
  // (g) IL CONTEGGIO DEI SEGNI — provato sul rosso, non solo sul verde.
  // ⚠️ È la parte che conta: un conteggio che dice sempre «ce ne sono» tiene la
  // legenda accesa ovunque, e il difetto torna senza che niente diventi rosso.
  // Si costruisce un finto albero con la stessa API che usa il componente
  // (`querySelectorAll` + `closest`): niente browser, niente dipendenze.
  interface FintoNodo { classi: string[]; genitore: FintoNodo | null }
  const nodo = (classi: string, genitore: FintoNodo | null = null): FintoNodo =>
    ({ classi: classi.split(' ').filter(Boolean), genitore });
  const finto = (nodi: FintoNodo[]) => ({
    querySelectorAll: (sel: string) => nodi.filter((n) => n.classi.includes(sel.slice(1))).map((n) => ({
      closest: (s: string) => {
        for (let c: FintoNodo | null = n; c; c = c.genitore) if (c.classi.includes(s.slice(1))) return c;
        return null;
      },
    })),
  }) as unknown as ParentNode;

  const casi: { nome: string; nodi: FintoNodo[]; atteso: number }[] = [];
  const pagina = nodo('main');
  const dentroLegenda = nodo('mark-legend', pagina);
  casi.push({ nome: 'pagina vuota', nodi: [], atteso: 0 });
  casi.push({ nome: 'un segno in pagina', nodi: [nodo('mark mark-prio', pagina)], atteso: 1 });
  casi.push({
    nome: 'i segni DELLA legenda non contano',
    nodi: [nodo('mark mark-prio', dentroLegenda), nodo('mark mark-conf', dentroLegenda)],
    atteso: 0,
  });
  casi.push({
    nome: 'legenda aperta più un segno vero: conta solo il vero',
    nodi: [nodo('mark mark-prio', dentroLegenda), nodo('mark mark-due', pagina)],
    atteso: 1,
  });
  for (const c of casi) {
    const n = contaSegni(finto(c.nodi));
    check(`conteggio dei segni — ${c.nome}: ${c.atteso}`, n === c.atteso, `trovati ${n}`);
  }
}

// ---------------------------------------------------------------------------
section('11. Il tema — una decisione di prodotto, e le due copie che devono concordare');
// ---------------------------------------------------------------------------
// Dal 2026-08-16 il tema NON segue più il sistema operativo: il predefinito è
// chiaro perché l'aspetto del prodotto è una decisione di prodotto, e la
// preferenza a tre stati sta in `localStorage`.
//
// ⚠️ LA LOGICA ESISTE DUE VOLTE, e non si può evitare: `src/lib/theme.ts` è la
// copia autorevole, ma lo script in linea di `index.html` deve girare PRIMA
// della prima pittura o il tema lampeggia a ogni caricamento — e nessun modulo
// dell'applicazione può girare prima del primo fotogramma. Questa sezione è il
// prezzo di quella copia: chiave, valori e predefinito si rileggono da entrambe
// e devono coincidere. Senza, la divergenza si scopre da un utente che ha
// scelto scuro e vede un lampo bianco.
{
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const theme = readFileSync(join(root, 'src/lib/theme.ts'), 'utf8');
  const appCss = readFileSync(join(root, 'src/styles/app.css'), 'utf8');

  // (a) LA CHIAVE DEL DEPOSITO è la stessa nelle due copie.
  const chiaveTs = theme.match(/CHIAVE_TEMA\s*=\s*'([^']+)'/)?.[1] ?? '';
  check('index.html usa la stessa chiave di localStorage di theme.ts',
    chiaveTs !== '' && html.includes(`localStorage.getItem('${chiaveTs}')`),
    `theme.ts dice «${chiaveTs}»`);

  // (b) I TRE VALORI sono gli stessi, e sono tre.
  const temiTs = [...(theme.match(/TEMI = \[([^\]]+)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  check('theme.ts dichiara esattamente tre preferenze', temiTs.length === 3, temiTs.join(', '));
  check('index.html riconosce le stesse tre preferenze',
    temiTs.every((v) => html.includes(`'${v}'`)), temiTs.join(', '));

  // (c) IL PREDEFINITO è lo stesso — ed è «chiaro». È LA decisione: se un
  // giorno cambia, deve cambiare in due posti, e questo rosso lo ricorda.
  const predefinitoTs = theme.match(/TEMA_PREDEFINITO: Tema = '([^']+)'/)?.[1] ?? '';
  check('il predefinito di theme.ts è «chiaro»', predefinitoTs === 'chiaro', `letto: ${predefinitoTs}`);
  check('index.html ricade sullo stesso predefinito',
    new RegExp(`pref = '${predefinitoTs}'`).test(html), `atteso «pref = '${predefinitoTs}'»`);

  // (d) LO SCRIPT È IN LINEA E NEL <head>: se diventasse un modulo o scendesse
  // nel body, girerebbe dopo la prima pittura e il lampo tornerebbe.
  const head = html.slice(0, html.indexOf('</head>'));
  check('lo script del tema è in linea, sincrono e dentro <head>',
    /<script>\s*\(function \(\) \{/.test(head) && head.includes("setAttribute('data-theme'"),
    'atteso uno <script> senza src e senza type=module dentro <head>');

  // (e) IL CSS SELEZIONA SU CIÒ CHE LO SCRIPT SCRIVE. Lo script scrive
  // `light`/`dark`; il foglio di stile ha il blocco scuro su `dark`. Un
  // disallineamento qui è un tema che non si applica mai, in silenzio.
  check('app.css ha il blocco scuro su :root[data-theme="dark"]',
    appCss.includes(':root[data-theme="dark"] {'));
  // ⚠️ SENZA I COMMENTI. Il file SPIEGA perché non usa più quella media query,
  // e citarla è il modo giusto di documentarlo: cercarla nel sorgente grezzo
  // renderebbe questo controllo rosso per una frase invece che per una regola.
  const appCssRegole = appCss.replace(/\/\*[\s\S]*?\*\//g, '');
  check('app.css non aggancia più il tema a prefers-color-scheme',
    !/@media \(prefers-color-scheme: dark\)\s*\{/.test(appCssRegole),
    'il tema è una scelta dell\'app, non del sistema operativo');

  // (f) `color-scheme` È DICHIARATO IN ENTRAMBI I TEMI. Senza, i controlli che
  // disegna il SISTEMA — barra di scorrimento, tendina di una select,
  // calendario di un input[type=date] — restano scuri dentro un'app chiara.
  // Finché il tema seguiva il sistema i due concordavano sempre: è un difetto
  // che questo lavoro poteva introdurre, non uno che aveva già.
  const rootChiaro = appCss.slice(appCss.indexOf(':root {'), appCss.indexOf(':root[data-theme="dark"]'));
  const rootScuro = appCss.slice(appCss.indexOf(':root[data-theme="dark"]'), appCss.indexOf('* { margin: 0'));
  check('il tema chiaro dichiara color-scheme: light', /color-scheme:\s*light/.test(rootChiaro));
  check('il tema scuro dichiara color-scheme: dark', /color-scheme:\s*dark/.test(rootScuro));
  check('index.html porta il meta color-scheme per l\'istante prima del CSS',
    /<meta name="color-scheme" content="light"/.test(html));

  // (g) `theme-color` NON è più legato al sistema operativo. Erano due
  // dichiarazioni con `media`: la barra del telefono avrebbe seguito il
  // sistema mentre l'app segue sé stessa.
  const themeColorMeta = [...html.matchAll(/<meta name="theme-color"[^>]*>/g)].map((m) => m[0]!);
  check('c\'è una sola dichiarazione theme-color', themeColorMeta.length === 1, themeColorMeta.join(' | '));
  check('e non è legata a prefers-color-scheme',
    !themeColorMeta.some((m) => m.includes('media=')), themeColorMeta.join(' | '));
  // Il valore statico è il predefinito del prodotto: ciò che si vede se
  // JavaScript non parte. Deve essere il chiaro, e deve essere `--card`.
  const cardChiaro = /--card:\s*([^;]+);/.exec(rootChiaro)?.[1]?.trim() ?? '';
  check('il theme-color statico è il --card del tema chiaro',
    themeColorMeta[0]?.includes(cardChiaro) ?? false, `--card chiaro = ${cardChiaro}`);

  // ⚠️ E IL VALORE SCURO DEVE ESSERE `--card` DEL TEMA SCURO, che è scritto in
  // `hsl()`. Il confronto è quindi NUMERICO, non testuale: `#1c232c` e
  // `hsl(213, 22%, 14%)` sono lo stesso colore scritto in due modi, e un test
  // che confrontasse le stringhe fallirebbe sempre — o, peggio, verrebbe tolto.
  // Serve perché è già successo: `theme-color` era rimasto su un blu che
  // l'accento dell'app non aveva più. Ora quel valore vive in tre punti — il
  // meta statico, lo script in linea, `theme.ts` — e tutti e tre devono
  // rispondere a `--card`.
  const hslToHex = (v: string): string | null => {
    const m = /^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/.exec(v.trim());
    if (!m) return /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null;
    const h = Number(m[1]) / 360, s = Number(m[2]) / 100, l = Number(m[3]) / 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h * 12) % 12;
      return Math.round((l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))) * 255);
    };
    return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  };
  const cardScuroHex = hslToHex(/--card:\s*([^;]+);/.exec(rootScuro)?.[1]?.trim() ?? '');
  for (const [dove, testo] of [['index.html', html], ['theme.ts', theme]] as const) {
    check(`${dove}: il theme-color scuro è il --card del tema scuro`,
      cardScuroHex !== null && testo.toLowerCase().includes(cardScuroHex),
      `--card scuro = ${cardScuroHex ?? 'illeggibile'}`);
  }

  // (g bis) ⚠️ LE COPIE DEL SELETTORE DEVONO CONCORDARE, e fino al 2026-08-17
  // non concordavano: `ThemeSwitcher` teneva la preferenza in uno `useState`
  // suo, e nell'albero autenticato le copie erano due (colonna e cassetto).
  // Chi cambiava aspetto da una vedeva l'altra ferma sul valore vecchio. Con la
  // finestra delle impostazioni le copie sono TRE e due si vedono nella stessa
  // schermata: il difetto è diventato ciò che si guarda.
  // Il rimedio è che la preferenza non sia stato di un componente ma del
  // documento — `sottoscriviTema` in `theme.ts` — e queste tre righe lo tengono
  // fermo. Provate sul rosso: togliendo l'avviso agli ascoltatori, la suite era
  // rimasta VERDE, ed è la ragione per cui esistono.
  const switcher = readFileSync(join(root, 'src/components/ui/ThemeSwitcher.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('il selettore dell\'aspetto LEGGE la preferenza, non la possiede',
    /useSyncExternalStore\(sottoscriviTema/.test(switcher) && !/useState/.test(switcher),
    'con uno useState le copie divergono: l\'app scura e la tendina che dice «Chiaro»');
  check('theme.ts offre una sottoscrizione', /export function sottoscriviTema/.test(theme));
  check('e scegliere il tema avvisa chi ascolta',
    /for \(const cb of ascoltatori\) cb\(\);/.test(theme),
    'senza l\'avviso la sottoscrizione esiste e non serve a niente: il difetto resta, silenzioso');

  // (h) LE TRE PREFERENZE HANNO UN'ETICHETTA NELLE TRE LINGUE. Un'opzione
  // senza parola in una lingua sola è una tendina con una riga vuota.
  for (const [lang, dict] of [['it', it], ['de', de], ['fr', fr]] as const) {
    const nav = dict.nav as unknown as Record<string, unknown>;
    const opts = nav.themeOption as Record<string, string> | undefined;
    check(`${lang}: le tre preferenze di aspetto hanno la loro parola`,
      typeof nav.theme === 'string' && !!nav.theme
        && !!opts && temiTs.every((v) => typeof opts[v] === 'string' && opts[v]!.length > 0),
      temiTs.map((v) => `${v}=${opts?.[v] ?? '—'}`).join(' '));
  }
}

// ---------------------------------------------------------------------------
section('12. Il contrasto dei fondi pieni — misurato, in tutti e tre i temi');
// ---------------------------------------------------------------------------
// ⚠️ PERCHÉ ESISTE, e la data conta. Il pallino delle notifiche scriveva
// `--on-accent` sopra `--red`: **3,78:1 in chiaro**, sotto la soglia AA di 4,5
// da quando esiste. Nessun controllo lo vedeva, perché nessun controllo sapeva
// FARE UN CONTO: `design:lint` guarda che i colori vengano dai token, non che i
// token accostati si leggano. Una regola che dice «usa i token» non protegge da
// due token che insieme non si vedono.
//
// Qui non si controlla il pallino: si controlla la FAMIGLIA. Ogni regola di
// `app.css` e `extra.css` che dichiara INSIEME un fondo e un colore di testo
// presi dai token viene risolta nei tre temi — chiaro, scuro, stampa — e pesata.
// Sono 89 coppie — erano 90 fino al 2026-08-17, quando le due regole gemelle
// della pastiglia premuta (`.on` e `[aria-pressed]`) sono diventate una sola —
// e nessuna è sotto la soglia. Il numero lo stampa il controllo: se scende
// molto, è il LETTORE che si è rotto, ed è la ragione della soglia a 80 più
// sotto. Un'eccezione qui
// non esiste per scelta: se un giorno servisse (testo grande, che ad AA si
// accontenta di 3:1), va dichiarata con il suo motivo, come fa `design:lint`.
{
  const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const app = senzaCommenti(readFileSync(join(root, 'src/styles/app.css'), 'utf8'));
  const extra = senzaCommenti(readFileSync(join(root, 'src/styles/extra.css'), 'utf8'));

  const canale = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const luminanza = (c: [number, number, number]) => 0.2126 * canale(c[0]) + 0.7152 * canale(c[1]) + 0.0722 * canale(c[2]);
  const contrasto = (a: [number, number, number], b: [number, number, number]) => {
    const [x, y] = [luminanza(a), luminanza(b)].sort((p, q) => q - p);
    return (x! + 0.05) / (y! + 0.05);
  };
  const colore = (v: string | undefined): [number, number, number] | null => {
    if (!v) return null;
    const t = v.trim();
    let m = /^#([0-9a-f]{6})$/i.exec(t);
    if (m) return [0, 2, 4].map((i) => parseInt(m![1]!.slice(i, i + 2), 16)) as [number, number, number];
    m = /^#([0-9a-f]{3})$/i.exec(t);
    if (m) return [...m[1]!].map((c) => parseInt(c + c, 16)) as [number, number, number];
    m = /^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i.exec(t);
    if (!m) return null;
    const h = Number(m[1]) / 360, s = Number(m[2]) / 100, l = Number(m[3]) / 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h * 12) % 12;
      return Math.round((l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))) * 255);
    };
    return [f(0), f(8), f(4)];
  };

  const dichiarazioni = (src: string) => {
    const m = new Map<string, string>();
    for (const x of src.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g)) m.set(x[1]!, x[2]!.trim());
    return m;
  };
  const fetta = (da: string, a?: string) => app.slice(app.indexOf(da), a ? app.indexOf(a) : undefined);
  const CHIARO = dichiarazioni(fetta(':root {', ':root[data-theme="dark"]'));
  const SCURO = new Map([...CHIARO, ...dichiarazioni(fetta(':root[data-theme="dark"] {', ':root[data-theme="dark"] .sidebar'))]);
  const STAMPA = new Map([...CHIARO, ...dichiarazioni(fetta('@media print'))]);
  // ⚠️ CONTROPROVA DEL LETTORE: se una delle tre tavolozze si leggesse vuota,
  // ogni coppia resterebbe «non calcolabile» e la sezione passerebbe in
  // silenzio — il verde falso che questo progetto ha già pagato tre volte.
  for (const [nome, m] of [['chiaro', CHIARO], ['scuro', SCURO], ['stampa', STAMPA]] as const) {
    check(`la tavolozza «${nome}» è stata letta (--card e --ink ci sono)`,
      !!m.get('--card') && !!m.get('--ink'), `${m.size} dichiarazioni lette`);
  }

  const risolvi = (v: string | undefined, m: Map<string, string>): string | undefined => {
    let g = 0;
    while (v && v.startsWith('var(') && g++ < 6) v = m.get(v.slice(4, v.indexOf(')')).trim());
    return v;
  };

  const coppie: { sel: string; bg: string; fg: string }[] = [];
  for (const [, sel, corpo] of (`${app}\n${extra}`).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const bg = /(?:^|;|\s)background(?:-color)?:\s*(var\(--[a-z0-9-]+\))/.exec(corpo!)?.[1];
    const fg = /(?:^|;|\s)color:\s*(var\(--[a-z0-9-]+\))/.exec(corpo!)?.[1];
    if (bg && fg) coppie.push({ sel: sel!.replace(/\s+/g, ' ').trim(), bg, fg });
  }
  // Se il lettore delle REGOLE si rompesse, zero coppie darebbero zero
  // violazioni: anche questo va dichiarato, non dedotto.
  check('le regole con fondo e testo dai token sono state trovate',
    coppie.length >= 80, `trovate ${coppie.length}`);

  const sotto: string[] = [];
  for (const c of coppie) {
    for (const [tema, m] of [['chiaro', CHIARO], ['scuro', SCURO], ['stampa', STAMPA]] as const) {
      const f = colore(risolvi(c.bg, m)), t = colore(risolvi(c.fg, m));
      if (!f || !t) continue;                       // token non risolvibile: non si finge un esito
      const k = contrasto(f, t);
      if (k < 4.5) sotto.push(`${tema}: ${c.sel} — ${c.fg} su ${c.bg} = ${k.toFixed(2)}:1`);
    }
  }
  check(`tutte le ${coppie.length} coppie fondo/testo raggiungono AA nei tre temi`,
    sotto.length === 0, sotto.join('\n     '));

  // ⚠️ E il caso che ha fatto nascere la sezione, nominato: se qualcuno
  // rimettesse `--red` sotto il pallino, il conto sopra lo direbbe — ma non
  // direbbe PERCHÉ. Questa riga lo dice.
  const pallino = /\.bell-badge\s*\{([^}]*)\}/.exec(extra)?.[1] ?? '';
  check('il pallino delle notifiche scrive su --red-dark, non su --red',
    /background:\s*var\(--red-dark\)/.test(pallino),
    'su --red il bianco fa 3,78:1 in chiaro: --red riempie, --red-dark porta testo');
  check('e ci scrive con --on-red, non con --on-accent',
    /color:\s*var\(--on-red\)/.test(pallino),
    "dal 2026-08-17 --on-accent è inchiostro SCURO (l'accento è l'azzurro chiaro): sopra questo rosso farebbe 3,04:1");

  // ⚠️ L'AZZURRO RIEMPIE, NON SCRIVE — e il conto delle coppie non può
  // vederlo. Una regola che dichiara `color:` SENZA un `background:` accanto
  // non forma una coppia: sta scrivendo sopra ciò che eredita, e il lettore qui
  // sopra la salta. È esattamente la forma dei tre segni trovati il 2026-08-17
  // — il pallino degli elenchi, un'etichetta del calendario e la data di oggi —
  // che scrivevano `color: var(--accent)` su fondo chiaro: 2,48:1, e nessuna
  // coppia da pesare. Da qui in poi `--accent` è un colore di RIEMPIMENTO:
  // l'inchiostro della sua famiglia si chiama `--accent-text`.
  const scriventi: string[] = [];
  for (const [, sel, corpo] of (`${app}\n${extra}`).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/(?:^|;|\s)color:\s*var\(--accent\)/.test(corpo!)) scriventi.push(sel!.replace(/\s+/g, ' ').trim());
  }
  check("nessuna regola SCRIVE con --accent (l'inchiostro è --accent-text)",
    scriventi.length === 0,
    `${scriventi.join('; ')} — #37AEEF come testo su bianco fa 2,48:1`);

  // ⚠️ E le caselle native, dove la spunta la disegna il BROWSER, in bianco:
  // il colore che gli si dà è un fondo, e sopra un azzurro chiaro quella spunta
  // sparisce. `accent-color` vuole quindi l'inchiostro, non il riempimento.
  const caselle: string[] = [];
  for (const [, sel, corpo] of (`${app}\n${extra}`).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/accent-color:\s*var\(--accent\)\s*[;}]/.test(`${corpo!};`)) caselle.push(sel!.replace(/\s+/g, ' ').trim());
  }
  check('le caselle native usano accent-color: var(--accent-text)',
    caselle.length === 0,
    `${caselle.join('; ')} — la spunta bianca sopra #37AEEF fa 2,48:1`);

  // ⚠️ CHI STA DENTRO UN RIEMPIMENTO D'ACCENTO SCRIVE CON --on-accent, e il
  // conto delle coppie non può dirlo: `.nav-btn.active .ic { color: … }` non
  // dichiara un fondo, quindi non forma una coppia — il fondo glielo dà il
  // genitore. È il buco esatto trovato il 2026-08-17 provando una mutazione che
  // NON diventava rossa: rimettendo `--accent-text` sull'icona della voce
  // attiva, l'icona faceva 2,99:1 sull'azzurro e la suite restava verde.
  // Qui si guarda la PARENTELA: per ogni selettore che riempie con `--accent`,
  // ogni regola discendente che dichiara un colore di testo deve scrivere con
  // `--on-accent`. È l'unico inchiostro garantito su quel fondo — in tutt'e tre
  // i temi, perché il token si ribalta con loro.
  const riempieAccento = new Set<string>();
  for (const [, sel, corpo] of (`${app}\n${extra}`).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(?:^|;|\s)background(?:-color)?:\s*var\(--accent\)\s*[;}]/.test(`${corpo!};`)) continue;
    for (const p of sel!.split(',')) riempieAccento.add(p.replace(/\s+/g, ' ').trim());
  }
  check('i riempimenti che usano --accent sono stati trovati',
    riempieAccento.size >= 8, `trovati ${riempieAccento.size}`);

  const dentro: string[] = [];
  for (const [, sel, corpo] of (`${app}\n${extra}`).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const inchiostro = /(?:^|;|\s)color:\s*([^;}]+)/.exec(corpo!)?.[1]?.trim();
    if (!inchiostro) continue;
    for (const p of sel!.split(',')) {
      const parte = p.replace(/\s+/g, ' ').trim();
      // `+ ' '` e non `startsWith` nudo: `.check-pill.on:hover` è lo STESSO
      // elemento, non un discendente, e il suo colore lo decide la regola sua.
      for (const f of riempieAccento) {
        if (!parte.startsWith(`${f} `) && !parte.startsWith(`${f}>`)) continue;
        if (inchiostro !== 'var(--on-accent)') dentro.push(`${parte} scrive ${inchiostro}`);
      }
    }
  }
  check("dentro un riempimento d'accento si scrive solo con --on-accent",
    dentro.length === 0,
    `${dentro.join('; ')} — sull'azzurro pieno --accent-text fa 2,99:1`);

  // ⚠️ UN SOLO AZZURRO, NON DUE. La famiglia dell'accento è fatta di gradazioni
  // dello STESSO tono: cambiare `--accent` e lasciare un derivato sul tono
  // vecchio non dà un colore sbagliato — dà due colori che quasi coincidono,
  // che è peggio, perché nessuno lo nota e nessuno sa quale dei due è quello
  // giusto. È successo il 2026-08-17 spostando la famiglia da 207 a 201:
  // `--accent-line` del tema scuro è rimasto indietro, in un blocco lontano
  // dagli altri quattro, e nessun conto di contrasto poteva vederlo — due toni
  // vicini hanno la stessa luminosità, quindi le coppie restano tutte verdi.
  // Qui non si misura il contrasto: si misura il TONO.
  const tono = (rgb: [number, number, number]): number => {
    const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return -1;                       // grigio: non ha tono da confrontare
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return Math.round(((h * 60) + 360) % 360);
  };
  const FAMIGLIA = ['--accent', '--accent-dark', '--accent-text', '--accent-soft', '--accent-line', '--focus'];
  for (const [tema, m] of [['chiaro', CHIARO], ['scuro', SCURO]] as const) {
    const toni = FAMIGLIA.map((t) => [t, tono(colore(risolvi(`var(${t})`, m)) ?? [0, 0, 0])] as const)
      .filter(([, h]) => h >= 0);
    // Controprova del lettore: se i token non si risolvessero, l'elenco sarebbe
    // vuoto e «tutti uguali» sarebbe vero per vacuità — il verde falso di sempre.
    check(`${tema}: la famiglia dell'accento è stata letta (${FAMIGLIA.length} token)`,
      toni.length === FAMIGLIA.length, `letti ${toni.length}: ${toni.map(([t]) => t).join(', ')}`);
    // ±2 gradi: hsl→rgb→hsl passa da tre interi, e un arrotondamento di un
    // punto sposta il tono di un grado. Due FAMIGLIE diverse distano decine.
    const base = toni[0]?.[1] ?? 0;
    const fuori = toni.filter(([, h]) => Math.abs(h - base) > 2);
    check(`${tema}: un solo azzurro — tutta la famiglia sullo stesso tono (${base}°)`,
      fuori.length === 0,
      fuori.map(([t, h]) => `${t} è a ${h}°`).join(', '));
  }
}

// ---------------------------------------------------------------------------
section('13. Il bilancio in altezza della colonna — a 1280×720, contato');
// ---------------------------------------------------------------------------
// ⚠️ PERCHÉ ESISTE. Fino al 2026-08-16 la colonna chiedeva 962px e ne aveva
// 720: la navigazione — unica parte elastica — ne nascondeva 242, cioè
// «Incentivi», l'intestazione ARCHIVIO e le sue quattro voci. Chi apriva
// l'applicazione vedeva sei voci su dieci e doveva scorrere per sapere che le
// altre esistevano. Nessun controllo lo vedeva: `design:lint` guarda che le
// misure vengano dai token, non che le misure SOMMATE ci stiano nello schermo.
// È lo stesso buco della sezione 12 — una regola che dice «usa i token» non
// protegge da dieci token che insieme non entrano.
//
// Questa sezione FA IL CONTO. Legge le geometrie dai fogli di stile e dalla
// tabella NAV, e ricostruisce l'altezza della colonna come la costruisce il
// browser: ogni riga di testo è `font-size × line-height`, ogni scatola è il
// suo contenuto più i suoi padding. Il modello NON è dedotto: è stato
// verificato contro il browser (banco locale, Chrome, 1280×720, 2026-08-16) e
// riproduce ogni blocco al centesimo — voce 31,25 · sezione 34,59 · piede
// 40,25 · marchio 81,32 · azienda 66,89 · box account 88,40.
//
// ⚠️ IL MARGINE È SOTTILE E VA DETTO: a 720 la colonna chiede ~716,5 e ne
// avanzano ~3,5. Non è un caso fortunato, è un bilancio: chi aggiunge una riga
// qui dentro deve toglierne un'altra, e questo controllo è il posto in cui se
// ne accorge PRIMA di pubblicare. Dove stanno i pixel, se servissero: la riga
// di sottotitolo del marchio (24), il passo di 2px fra le voci (24 in tutto),
// il padding verticale della colonna (8).
{
  const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const app = senzaCommenti(readFileSync(join(root, 'src/styles/app.css'), 'utf8'));
  const extra = senzaCommenti(readFileSync(join(root, 'src/styles/extra.css'), 'utf8'));
  const shell = readFileSync(join(root, 'src/components/layout/AppShell.tsx'), 'utf8');
  const brandArt = readFileSync(join(root, 'src/components/ui/brandArt.ts'), 'utf8');
  const lingua = readFileSync(join(root, 'src/components/ui/LanguageSwitcher.tsx'), 'utf8');
  const aspetto = readFileSync(join(root, 'src/components/ui/ThemeSwitcher.tsx'), 'utf8');
  const css = `${app}\n${extra}`;

  // La scala: i px dei token, così il modello parla la lingua dei fogli.
  const scala = new Map<string, number>();
  for (const m of app.matchAll(/(--(?:sp|fs)-[a-z0-9]+)\s*:\s*([\d.]+)px/g)) scala.set(m[1]!, Number(m[2]));

  /** Il corpo della PRIMA regola che dichiara esattamente questo selettore.
   *  `(?:^|\})` àncora l'inizio: senza, `.nav-btn` peschèrebbe dentro
   *  `.sidebar .nav-btn`, che è proprio la coppia che qui va distinta. */
  const regola = (sel: string, fonte = css): string => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`).exec(fonte)?.[1] ?? '';
  };
  const dichiarazione = (corpo: string, prop: string): string | undefined =>
    new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(corpo)?.[1]?.trim();
  /** Un valore in px, sia scritto (`44px`) sia preso da un token (`var(--sp-2)`). */
  const px = (v: string | undefined): number | null => {
    if (v === undefined) return null;
    const t = v.trim();
    if (t === '0') return 0;
    const tok = /^var\((--[a-z0-9-]+)\)$/.exec(t);
    if (tok) return scala.get(tok[1]!) ?? null;
    const n = /^(-?[\d.]+)px$/.exec(t);
    return n ? Number(n[1]) : null;
  };
  /** Sopra e sotto di uno shorthand `padding`/`margin` a 1, 2, 3 o 4 valori. */
  const verticali = (corpo: string, prop: string): [number, number] | null => {
    const v = dichiarazione(corpo, prop);
    if (v === undefined) return null;
    const parti = v.split(/\s+/).map((x) => px(x));
    if (parti.some((x) => x === null)) return null;
    const [a, , c] = parti as number[];
    return [a!, parti.length >= 3 ? c! : a!];
  };

  const interlinea = Number(/(?:^|;)\s*line-height:\s*([\d.]+)/.exec(regola('body', app))?.[1] ?? NaN);
  const riga = (token: string) => (scala.get(token) ?? NaN) * interlinea;

  // --- le geometrie, lette una per una -------------------------------------
  const gCol = regola('.sidebar');
  const gMarchio = regola('.brand');
  const gAzienda = regola('.company-switch');
  const gNav = regola('.nav');
  const gSezione = regola('.nav-section');
  const gVoce = regola('.sidebar .nav-btn');
  const gPiede = regola('.nav-foot');
  const gBox = regola('.account-box');
  const gRiga = regola('.account-row');
  const gPrefs = regola('.account-prefs');

  const colPad = verticali(gCol, 'padding');
  const marchioPad = verticali(gMarchio, 'padding');
  const aziendaPad = verticali(gAzienda, 'padding');
  const aziendaMarg = verticali(gAzienda, 'margin-bottom');
  const sezionePad = verticali(gSezione, 'padding');
  const vocePad = verticali(gVoce, 'padding');
  const navGap = px(dichiarazione(gNav, 'gap'));
  const boxGap = px(dichiarazione(gBox, 'gap'));
  const boxPad = px(dichiarazione(gBox, 'padding-top'));
  const rigaPad = verticali(gRiga, 'padding');
  const piedePad = px(dichiarazione(gPiede, 'padding-top'));
  const logoW = px(dichiarazione(regola('.brand-logo'), 'width'));
  const subMarg = px(dichiarazione(regola('.brand-sub'), 'margin-top'));
  const campanella = px(dichiarazione(regola('.bell-btn'), 'height')) ?? 36;
  const vb = /MARCHIO_VIEWBOX\s*=\s*'([\d\s.]+)'/.exec(brandArt)?.[1]?.trim().split(/\s+/).map(Number);

  // ⚠️ CONTROPROVA DEL LETTORE, prima di ogni conto: se una geometria si
  // leggesse `null`, il modello sommerebbe NaN e il confronto `NaN <= 720`
  // sarebbe FALSO — cioè rosso, non verde falso. Ma un rosso senza nome manda
  // a caccia nel posto sbagliato: qui si dice QUALE misura non si è letta.
  const letture: [string, unknown][] = [
    ['.sidebar padding', colPad], ['.brand padding', marchioPad],
    ['.company-switch padding', aziendaPad], ['.company-switch margin-bottom', aziendaMarg],
    ['.nav gap', navGap], ['.nav-section padding', sezionePad],
    ['.sidebar .nav-btn padding', vocePad], ['.nav-foot padding-top', piedePad],
    ['.account-box gap', boxGap], ['.account-box padding-top', boxPad],
    ['.account-row padding', rigaPad], ['.brand-logo width', logoW],
    ['.brand-sub margin-top', subMarg], ['MARCHIO_VIEWBOX', vb?.length === 4 ? vb : null],
    ['body line-height', Number.isFinite(interlinea) ? interlinea : null],
  ];
  const illeggibili = letture.filter(([, v]) => v === null || v === undefined).map(([k]) => k);
  check('tutte le geometrie della colonna si leggono dai fogli',
    illeggibili.length === 0, `non lette: ${illeggibili.join(', ')}`);

  // --- il conto -------------------------------------------------------------
  const BORDO = 1;                       // i filetti di .nav-foot e .account-box
  const PREFS = 28;                      // ⚠️ MISURATO, non calcolabile: l'altezza
  // della riga lingua/aspetto/uscita la decidono le tendine compatte, e il loro
  // padding è scritto IN LINEA nei due componenti (`padding: '4px 8px'`,
  // `fontSize: '0.85rem'`), non in un foglio. Un `<select>` per giunta non usa
  // il line-height del corpo. 28px è ciò che il browser produce, verificato al
  // banco il 2026-08-16; se un giorno quelle misure passassero al CSS, questo
  // numero diventerà un conto come gli altri.

  const logoH = logoW! * (vb![3]! / vb![2]!);
  const marchio = marchioPad![0] + Math.max(logoH + subMarg! + riga('--fs-meta'), campanella) + marchioPad![1];
  const azienda = aziendaPad![0] + riga('--fs-label') + riga('--fs-meta') * 2 + aziendaPad![1] + aziendaMarg![1];
  const voce = riga('--fs-body') + vocePad![0] + vocePad![1];
  const sezione = riga('--fs-label') + sezionePad![0] + sezionePad![1];
  const piede = BORDO + piedePad! + voce;

  const nVoci = NAV.filter((e): e is NavItem => !isSection(e)).length;
  const nSezioni = NAV.filter(isSection).length;
  const nFigliNav = nVoci + nSezioni + 1;                       // +1: il piede
  const navContenuto = nVoci * voce + nSezioni * sezione + piede + (nFigliNav - 1) * navGap!;

  const rigaAccount = rigaPad![0] + riga('--fs-body') + riga('--fs-meta') + rigaPad![1];
  const account = BORDO + boxPad! + rigaAccount + boxGap! + PREFS;

  const ALTEZZA = 720;                                          // 1280×720, lo schermo stretto di riferimento
  const nFigliCol = 4;                                          // marchio, azienda, navigazione, box account
  const colGap = px(dichiarazione(gCol, 'gap'))!;
  const totale = colPad![0] + marchio + azienda + navContenuto + account + colPad![1] + (nFigliCol - 1) * colGap;
  const avanzo = ALTEZZA - totale;

  console.log(`  ${DIM}marchio ${marchio.toFixed(2)} · azienda ${azienda.toFixed(2)} · navigazione ${navContenuto.toFixed(2)} (${nVoci} voci da ${voce.toFixed(2)}, ${nSezioni} sezioni da ${sezione.toFixed(2)}, piede ${piede.toFixed(2)}) · account ${account.toFixed(2)} → ${totale.toFixed(2)} su ${ALTEZZA}${X}`);

  check(`a ${ALTEZZA}px la colonna intera ci sta, senza scorrere`,
    totale <= ALTEZZA,
    `chiede ${totale.toFixed(2)}px: ne mancano ${(-avanzo).toFixed(2)}. La navigazione è l'unica parte elastica, quindi il di più lo nasconde LEI — e ciò che sparisce sono le ultime voci, ARCHIVIO per primo.`);

  // Il conto sopra dice «ci sta». Questo dice CHE COSA ci sta: tutte e dieci le
  // voci, non otto. Sono la stessa disuguaglianza vista dalla parte del lettore.
  const spazioNav = ALTEZZA - colPad![0] - marchio - azienda - account - colPad![1] - (nFigliCol - 1) * colGap;
  const vociVisibili = Math.min(nVoci, Math.max(0, Math.floor((spazioNav - nSezioni * (sezione + navGap!) - piede - navGap!) / (voce + navGap!))));
  check(`si vedono tutte e ${nVoci} le voci senza toccare la rotella`,
    vociVisibili >= nVoci, `se ne vedrebbero ${vociVisibili}`);

  // --- le decisioni che producono il bilancio, ciascuna col suo perché -------

  // (a) LA DENSITÀ È DEL PUNTATORE, NON DEL DITO. La voce stretta vale nella
  //     colonna (mouse); il drawer, che si tocca, tiene la sua.
  const voceBase = verticali(regola('.nav-btn'), 'padding');
  check('la voce stretta vale SOLO nella colonna (.sidebar .nav-btn)',
    vocePad !== null && voceBase !== null && vocePad[0] < voceBase[0],
    `colonna ${vocePad?.[0]}px, base ${voceBase?.[0]}px: se fossero uguali, la stretta sarebbe finita anche sotto il dito`);
  check('nel drawer la voce resta quella da dito (--sp-2)',
    voceBase?.[0] === scala.get('--sp-2'),
    `${voceBase?.[0]}px: sotto i 900px la colonna non esiste, c'è il cassetto`);

  // (b) I TRE COMANDI PERSONALI STANNO SU UNA RIGA SOLA. Erano tre righe
  //     impilate: 202px di piede sotto una navigazione che ne cercava 242.
  const colonnePrefs = dichiarazione(gPrefs, 'grid-template-columns')?.split(/\s+/).length ?? 0;
  check('lingua, aspetto e uscita stanno su UNA riga (griglia a tre colonne)',
    /display:\s*grid/.test(gPrefs) && colonnePrefs === 3, `colonne dichiarate: ${colonnePrefs}`);
  check("l'AppShell li mette davvero lì dentro",
    /className="account-prefs"[\s\S]{0,600}?<LanguageSwitcher[\s\S]{0,600}?<ThemeSwitcher[\s\S]{0,600}?handleSignOut/.test(shell));
  check('la vecchia pila di tre righe non è tornata',
    !/account-actions/.test(shell) && !/account-actions/.test(css)
      && !/className="mb-2"><(?:Language|Theme)Switcher/.test(shell),
    'la .account-actions e i due involucri .mb-2 erano 65px di margine sommato');

  // (c) L'USCITA HA PERSO L'ETICHETTA VISIBILE: deve conservare il nome. Un
  //     pulsante che è solo un'icona e non ha né aria-label né title è un
  //     comando anonimo — e questo, per giunta, fa uscire dall'account.
  const bottoneUscita = /<button[^>]*onClick=\{handleSignOut\}[\s\S]*?>/.exec(shell)?.[0] ?? '';
  check("l'uscita, ormai sola icona, conserva nome e titolo",
    /aria-label=\{t\('nav\.signOutAria'\)\}/.test(bottoneUscita) && /title=\{t\('nav\.signOut'\)\}/.test(bottoneUscita),
    'aria-label per il lettore di schermo, title per il puntatore');

  // (d) NEL CASSETTO IL BERSAGLIO TORNA DA DITO. 28px sotto un pollice sono un
  //     modo di sbagliare tendina, o di uscire dall'account per errore.
  const gPrefsDrawer = regola('.drawer .account-prefs select,\n  .drawer .account-prefs .btn');
  check('nel drawer i tre comandi tornano a 44px (WCAG 2.2, tocco)',
    px(dichiarazione(gPrefsDrawer, 'min-height')) === 44,
    'la riga compatta è una misura da puntatore, e sotto i 900px non c\'è un puntatore');

  // (e) L'ETICHETTA DELL'ASPETTO STA IN UNA TENDINA DA 91px. «Segui il sistema»
  //     e «Systemeinstellung folgen» ci entravano a metà: chi sceglie non
  //     leggeva che cosa aveva scelto. Nello spazio utile — 57px misurati a
  //     0,85rem — ci stanno una parola e circa dieci caratteri.
  for (const [lang, dict] of [['it', it], ['de', de], ['fr', fr]] as const) {
    const opts = (dict.nav as unknown as { themeOption: Record<string, string> }).themeOption;
    const larghe = Object.values(opts).filter((v) => v.includes(' ') || v.length > 10);
    check(`${lang}: le opzioni dell'aspetto stanno nella tendina compatta`,
      larghe.length === 0, `troppo lunghe: ${larghe.join(', ')}`);
  }

  // (f) DUE COPIE NELL'ALBERO, UN ID SOLO. I due selettori sono montati nella
  //     colonna E nel cassetto: un id scritto a mano era duplicato nel
  //     documento, e un `htmlFor` trova sempre il primo — cioè può etichettare
  //     la tendina che nessuno vede. Stessa cura del gruppo Impostazioni.
  for (const [nome, src] of [['LanguageSwitcher', lingua], ['ThemeSwitcher', aspetto]] as const) {
    // ⚠️ I COMMENTI VANNO VIA PRIMA DI GUARDARE: il commento che spiega questa
    // regola CITA l'id sbagliato (`id="lang-select"`), e la prima stesura del
    // controllo lo trovava lì dentro — rosso su un codice corretto, per aver
    // letto la spiegazione invece del codice.
    const codice = src.replace(/\/\/[^\n]*/g, '');
    check(`${nome}: l'id viene da useId, non è scritto a mano`,
      /useId\(\)/.test(codice) && !/id="[a-z-]+"/.test(codice));
  }
}

// ---------------------------------------------------------------------------
section('14. La finestra — un modale che non intrappola');
// ---------------------------------------------------------------------------
// ⚠️ PERCHÉ ESISTE. Dal 2026-08-17 le impostazioni sono un dialogo modale, ed è
// il primo del progetto. Un modale fatto male non si vede: la schermata è
// giusta, i colori sono giusti, e chi naviga da tastiera esce dal riquadro e
// continua a tabulare dentro la pagina SOTTO il velo — senza sapere dov'è, e
// senza un modo ovvio di tornare. Non c'è schermata che lo mostri e non c'è
// occhio che lo veda: o lo si controlla, o si scopre da una segnalazione.
//
// Le quattro cose che rendono un dialogo un dialogo si leggono dal sorgente,
// perché il comportamento vero (fuoco, Esc, velo) è stato provato al banco in
// Chrome e riprovarlo qui vorrebbe dire montare un DOM finto e provare quello.
// Qui si sorveglia che le quattro righe non spariscano in un ritocco.
{
  // ⚠️ I COMMENTI VANNO VIA PRIMA DI GUARDARE, ed è la SECONDA volta in questo
  // file: qui sotto si pretende che `requestAnimationFrame` non compaia, e il
  // commento che spiega perché lo NOMINA. Chi legge il sorgente con i commenti
  // dentro sta leggendo la spiegazione invece del codice.
  const senzaNote = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const dialogSrc = senzaNote(readFileSync(join(root, 'src/components/ui/Dialog.tsx'), 'utf8'));
  const shell = senzaNote(readFileSync(join(root, 'src/components/layout/AppShell.tsx'), 'utf8'));
  const css = readFileSync(join(root, 'src/styles/extra.css'), 'utf8');

  // (a) È dichiarato un dialogo, e ha un NOME.
  check('role="dialog" con aria-modal', /role="dialog"/.test(dialogSrc) && /aria-modal="true"/.test(dialogSrc));
  check('la finestra ha un nome (aria-labelledby sul titolo)',
    /aria-labelledby=\{titleId\}/.test(dialogSrc) && /id=\{titleId\}/.test(dialogSrc),
    'senza nome un lettore di schermo annuncia «finestra di dialogo» e nient\'altro');

  // (b) Il fuoco entra e TORNA. La riga del ritorno è quella che si dimentica.
  check('il fuoco entra all\'apertura', /\.focus\(\)/.test(dialogSrc));
  check('e torna da dove veniva alla chiusura',
    /provenienza\.current\?\.focus\?\.\(\)/.test(dialogSrc),
    'senza, la tabulazione riparte dall\'inizio del documento, cioè dal marchio');
  // ⚠️ E NON attraverso `requestAnimationFrame`: è sospeso quando il documento
  // non è in primo piano, e al banco il fuoco non entrava mai. Il caso è
  // nominato perché la riga sembra innocua e ci si ricasca.
  check('il fuoco non passa da requestAnimationFrame',
    !/requestAnimationFrame/.test(dialogSrc),
    'rAF è sospeso a documento non in primo piano: la finestra si apriva senza fuoco');

  // (c) Il fuoco non ESCE: serve il ramo per Tab e quello per Maiusc+Tab.
  check('Tab è intercettato in tutt\'e due i versi',
    /e\.key !== 'Tab'/.test(dialogSrc) && /e\.shiftKey/.test(dialogSrc) && /preventDefault/.test(dialogSrc));

  // (d) I due gesti che tutti provano.
  check('Esc chiude', /e\.key === 'Escape'/.test(dialogSrc));
  check('il velo chiude, e solo il velo',
    /e\.target === e\.currentTarget/.test(dialogSrc),
    'senza il confronto, un clic dentro il riquadro chiuderebbe la finestra');

  // (e) Va in un PORTALE: dentro la colonna laterale, che è sticky e ha un
  //     overflow suo, un figlio `fixed` verrebbe ritagliato.
  check('la finestra è appesa al corpo del documento', /createPortal/.test(dialogSrc));

  // (f) Lo scorrimento del corpo si ferma, e RIPARTE.
  check('il corpo non scorre sotto la finestra', /body\.style\.overflow = 'hidden'/.test(dialogSrc));
  check('e lo scorrimento viene ripristinato com\'era',
    /const prima = document\.body\.style\.overflow/.test(dialogSrc)
      && /document\.body\.style\.overflow = prima/.test(dialogSrc),
    'rimetterlo a \'\' invece che al valore di prima romperebbe il cassetto aperto sotto');

  // (g) UNA SOLA finestra nell'albero. I NavList sono due — colonna e cassetto —
  //     e una finestra per ciascuno vorrebbe dire due modali possibili insieme.
  const montaggi = [...shell.matchAll(/<SettingsDialog/g)].length;
  check('la finestra è montata UNA volta sola nell\'AppShell', montaggi === 1, `trovate ${montaggi}`);

  // (h) Il pulsante dichiara che apre un riquadro.
  check('il pulsante Impostazioni dichiara aria-haspopup="dialog"',
    /aria-haspopup="dialog"/.test(shell),
    'un pulsante che apre un modale senza dirlo è un pulsante che sorprende');

  // (h bis) ⚠️ IL GRUPPO CHE SI APRIVA NON DEVE TORNARE, e con lui le due
  // classi che lo vestivano. `.nav-caret` era la freccia su/giù, `.nav-subitem`
  // il rientro delle quattro sottovoci: da quando le impostazioni sono una
  // finestra nessun componente le rende.
  // Non è pulizia. Sono rimaste in produzione per un merge, e le ha trovate il
  // controllo dei marcatori sul bundle SERVITO — non una rilettura del codice.
  // Una regola per una classe che nessuno scrive è un INDIZIO FALSO: chi legge
  // il foglio conclude che la barra ha ancora delle sottovoci, e chi rifà il
  // conto della sezione 13 se le aspetta nel bilancio. E se un giorno tornasse
  // il gruppo, tornerebbero i 124px in una colonna che ne ha 3,42 di margine.
  const appCss = readFileSync(join(root, 'src/styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const tsx = readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => readFileSync(join(root, 'src', f), 'utf8')).join('\n');
  for (const classe of ['nav-caret', 'nav-subitem']) {
    check(`la classe .${classe} non è tornata nei fogli`,
      !new RegExp(`\\.${classe}\\b`).test(appCss),
      'vestiva il gruppo che si apriva nella colonna: se torna, o è morta o è tornato il gruppo');
    check(`e nessun componente la scrive`,
      !new RegExp(`\\b${classe}\\b`).test(tsx));
  }
  // ⚠️ CONTROPROVA DEL LETTORE: se `tsx` si leggesse vuoto, «nessun componente
  // la scrive» sarebbe vero per vacuità — e lo sarebbe per sempre.
  check('i componenti sono stati letti davvero (il lettore non è a vuoto)',
    tsx.includes('nav-ellipsis') && tsx.length > 50_000, `${tsx.length} caratteri letti`);

  // (i) Il velo copre tutto e sta sopra il cassetto (z-index 60).
  const velo = /\.dialog-scrim\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const z = Number(/z-index:\s*(\d+)/.exec(velo)?.[1] ?? NaN);
  check('il velo sta SOPRA il cassetto', z > 60, `z-index del velo: ${z || 'non letto'}`);
  check('il velo copre tutto lo schermo', /position:\s*fixed/.test(velo) && /inset:\s*0/.test(velo));
}

// ---------------------------------------------------------------------------
section('15. I fogli come li legge il BROWSER — un commento che si chiude due volte');
// ---------------------------------------------------------------------------
// ⚠️⚠️ PERCHÉ ESISTE, e perché sta PRIMA del conto della sezione 16. In CSS il
// commento non si annida: `/*` apre e il PRIMO `*/` chiude. Un commento lungo
// che ne contiene un altro — o che cita una riga di codice commentata — si
// chiude a metà, e da lì in avanti il testo rimasto è spazzatura che il parser
// butta via INSIEME alla regola successiva. Senza un errore, senza un avviso.
//
// Non è un caso di scuola. Il 2026-08-17, in `app.css`, un commento dentro
// `:root` si chiudeva due volte: il parser ha mangiato la dichiarazione che
// seguiva e `--red` è rimasto NON DEFINITO in tema chiaro, cioè nel tema
// predefinito. Dodici usi — il pallino delle notifiche, il bordo di
// `.btn-danger`, il filetto di `.kpi.alert`, la barra `.bar-fill.s-alta`, il
// `.dot-alta` — con `background: var(--red)` che diventa trasparente e
// `border-left: 3px solid var(--red)` che diventa nessun bordo.
//
// ⚠️ E NESSUN CONTROLLO POTEVA VEDERLO, perché tutti leggono il CSS con
// un'espressione regolare: nel FILE `--red: hsl(0, 84%, 60%)` c'è, e la sezione
// 12 ne pesava tranquillamente il contrasto. Verde su un colore che il browser
// non aveva. Lo ha trovato il banco, aprendo la pagina e chiedendo il valore
// calcolato. Qui si controlla la sola cosa che si può controllare leggendo:
// che tagliando i commenti come li taglia un parser non avanzi un `*/` orfano.
{
  const FOGLI = ['src/styles/app.css', 'src/styles/extra.css', 'src/styles/fonts.css'];
  let commentiTotali = 0;
  for (const f of FOGLI) {
    const testo = readFileSync(join(root, f), 'utf8');
    // Non greedy: si ferma al PRIMO `*/`, esattamente come il parser.
    const commenti = testo.match(/\/\*[\s\S]*?\*\//g) ?? [];
    commentiTotali += commenti.length;
    const resto = testo.replace(/\/\*[\s\S]*?\*\//g, '');
    const i = resto.indexOf('*/');
    const dove = i < 0 ? '' : `…${resto.slice(Math.max(0, i - 90), i + 2).replace(/\s+/g, ' ')}`;
    check(`${f}: nessun \`*/\` orfano — nessun commento chiuso due volte`,
      i < 0,
      `${dove}\n     Il testo prima di questo \`*/\` non è un commento: il parser lo scarta INSIEME alla regola che segue.`);
  }
  // ⚠️ CONTROPROVA DEL LETTORE: se i fogli si leggessero vuoti, «nessun orfano»
  // sarebbe vero per vacuità — e lo sarebbe per sempre.
  check(`i tre fogli sono stati letti davvero (${commentiTotali} commenti)`,
    commentiTotali > 200, `trovati ${commentiTotali} commenti: troppo pochi perché la lettura sia avvenuta`);
}

// ---------------------------------------------------------------------------
section('16. Il bilancio in larghezza di «Chiedi ad AI-Swisse» — a 1440×900, contato');
// ---------------------------------------------------------------------------
// ⚠️ PERCHÉ ESISTE. È il gemello orizzontale della sezione 13, e nasce dalla
// stessa cecità: `design:lint` controlla che le misure vengano dai token, non
// che le misure SOMMATE lascino spazio alla cosa per cui la schermata esiste.
// Fino al 2026-08-17 «Chiedi ad AI-Swisse» aveva tre colonne e la conversazione
// era la più stretta di tutte: 468px misurati al banco a 1440×900, contro 264
// di barra, 264 di elenco e 300 di fonti. La pagina si chiama «Chiedi», e la
// parte in cui si chiede era un terzo dello schermo.
//
// Qui il conto si rifà dai fogli: larghezza della colonna dell'applicazione,
// margini di `.main`, colonne della griglia, gap. Il modello è stato verificato
// contro il browser (banco locale, Chrome, 1440×900, 2026-08-17) e dà gli
// stessi numeri al pixel: conversazione 800, elenco 264, pagina 1080.
{
  const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const appRaw = readFileSync(join(root, 'src/styles/app.css'), 'utf8');
  const extraRaw = readFileSync(join(root, 'src/styles/extra.css'), 'utf8');
  const app = senzaCommenti(appRaw);
  const extra = senzaCommenti(extraRaw);
  // ⚠️ I COMMENTI VANNO VIA PRIMA DI GUARDARE, ed è la TERZA volta in questo
  // file: qui sotto si pretende che `requestAnimationFrame` non compaia nella
  // pagina, e il commento che spiega perché lo NOMINA. Alla prima stesura il
  // controllo era rosso su un codice corretto — leggeva la spiegazione.
  const pagina = readFileSync(join(root, 'src/features/assistant/AssistantPage.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  /** Il corpo di un blocco `@media`, chiuso contando le graffe.
   *  ⚠️ E SI SCEGLIE QUELLO GIUSTO: di `@media (max-width: 900px)` ce n'è più
   *  d'uno per foglio, e un `[\s\S]*?` che parte dal primo arriva a pescare la
   *  regola FUORI dai media — alla prima stesura leggeva i token del desktop e
   *  li dichiarava giusti per il telefono. */
  const bloccoMedia = (larghezza: string, fonte: string, deveContenere: string): string => {
    const re = new RegExp(`@media \\(max-width: ${larghezza}\\)\\s*\\{`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(fonte))) {
      let i = m.index + m[0].length;
      const inizio = i;
      let prof = 1;
      while (i < fonte.length && prof > 0) {
        if (fonte[i] === '{') prof++; else if (fonte[i] === '}') prof--;
        i++;
      }
      const corpo = fonte.slice(inizio, i - 1);
      if (corpo.includes(deveContenere)) return corpo;
    }
    return '';
  };

  const scala = new Map<string, number>();
  for (const m of app.matchAll(/(--(?:sp|topbar)-[a-z0-9]+|--content-max)\s*:\s*([\d.]+)px/g)) scala.set(m[1]!, Number(m[2]));

  /** Il corpo della PRIMA regola che dichiara esattamente questo selettore.
   *  `(?:^|\})` àncora l'inizio — ed è anche ciò che rende ROSSO, e non verde
   *  falso, un foglio con un commento chiuso due volte: dopo lo spazzatura la
   *  regola non è più preceduta da una graffa. */
  const regola = (sel: string, fonte: string): string => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`).exec(fonte)?.[1] ?? '';
  };
  const dichiarazione = (corpo: string, prop: string): string | undefined =>
    new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(corpo)?.[1]?.trim();
  const px = (v: string | undefined): number | null => {
    if (v === undefined) return null;
    const t = v.trim();
    if (t === '0') return 0;
    const tok = /^var\((--[a-z0-9-]+)\)$/.exec(t);
    if (tok) return scala.get(tok[1]!) ?? null;
    const n = /^(-?[\d.]+)px$/.exec(t);
    return n ? Number(n[1]) : null;
  };
  /** I token nominati da una somma `calc(var(--a) + var(--b))`, nell'ordine. */
  const tokenDi = (v: string | undefined): string[] =>
    [...(v ?? '').matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!);

  const gColonna = regola('.sidebar', app);
  const gMain = regola('.main', app);
  const gPage = regola('.as-page', extra);
  const gLayout = regola('.as-layout', extra);
  const gConv = regola('.as-main', extra);

  const colonnaW = px(dichiarazione(gColonna, 'width'));
  const mainPad = (dichiarazione(gMain, 'padding') ?? '').split(/\s+/);
  const padOrizz = px(mainPad[1]);
  const griglia = dichiarazione(gLayout, 'grid-template-columns') ?? '';
  const gap = px(dichiarazione(gLayout, 'gap'));
  const colonne = [...griglia.matchAll(/minmax\(0,\s*([^)]+)\)/g)].map((m) => m[1]!.trim());

  const letture: [string, unknown][] = [
    ['.sidebar width', colonnaW], ['.main padding (orizzontale)', padOrizz],
    ['.as-layout grid-template-columns', colonne.length ? colonne : null],
    ['.as-layout gap', gap],
    ['.as-page --as-shell-y', dichiarazione(gPage, '--as-shell-y') ?? null],
    ['.as-main max-width', dichiarazione(gConv, 'max-width') ?? null],
  ];
  const illeggibili = letture.filter(([, v]) => v === null || v === undefined).map(([k]) => k);
  check('tutte le geometrie della schermata si leggono dai fogli',
    illeggibili.length === 0, `non lette: ${illeggibili.join(', ')}`);

  // --- (a) DUE colonne, non tre: le fonti non sono più una colonna fissa -----
  check('la griglia ha DUE colonne: le conversazioni e la conversazione',
    colonne.length === 2, `ne dichiara ${colonne.length}: ${griglia}`);
  check("la seconda colonna è quella elastica (è la conversazione a prendersi l'avanzo)",
    colonne[1] === '1fr', `la seconda è «${colonne[1]}»`);
  // ⚠️ La colonna morta non deve tornare, come `.nav-caret` e `.nav-subitem`:
  // una classe che nessuno rende è un indizio falso per chi rifà questo conto.
  check('la colonna «Fonti» non è tornata: nessun `.as-side-right` nei fogli',
    !/\.as-side-right\b/.test(app) && !/\.as-side-right\b/.test(extra));
  check('e nessun componente la scrive',
    !/as-side-right/.test(pagina),
    'le fonti sono un pannello: se torna la colonna, torna anche la conversazione stretta');

  // --- (b) IL CONTO, a 1440×900 ---------------------------------------------
  const FINESTRA = 1440;
  const elenco = px(colonne[0]);
  const conversazione = FINESTRA - colonnaW! - padOrizz! * 2 - elenco! - gap!;
  const attorno = FINESTRA - conversazione;                  // barra, elenco, margini, gap

  console.log(`  ${DIM}barra ${colonnaW} · margini ${padOrizz! * 2} · elenco ${elenco} · gap ${gap} → conversazione ${conversazione} su ${FINESTRA}${X}`);

  check(`a ${FINESTRA}px la conversazione è più larga di TUTTO il resto messo insieme`,
    conversazione > attorno,
    `conversazione ${conversazione}, resto ${attorno}: la pagina si chiama «Chiedi» e la parte in cui si chiede non è la maggiore`);
  check('e i conti tornano: niente scorrimento orizzontale',
    colonnaW! + padOrizz! * 2 + elenco! + gap! + conversazione === FINESTRA,
    `sommano ${colonnaW! + padOrizz! * 2 + elenco! + gap! + conversazione}`);

  // --- (c) La riga di testo resta leggibile, e il tetto viene da un token ----
  const tettoConv = dichiarazione(gConv, 'max-width');
  check('la conversazione ha un tetto di lettura, e viene dal token --content-max',
    tettoConv === 'var(--content-max)',
    `dichiara «${tettoConv}»: su uno schermo da 1920 senza tetto la riga arriva a ~170 caratteri`);
  check('il tetto non stringe la conversazione a 1440 (là comanda lo spazio, non il tetto)',
    (scala.get('--content-max') ?? 0) >= conversazione,
    `--content-max ${scala.get('--content-max')} < ${conversazione}: il tetto starebbe togliendo larghezza invece di darla`);
  check("il tetto di `.main` è tolto solo QUI, e solo dove c'è questa pagina",
    /\.main:has\(\.as-page\)\s*\{[^}]*max-width:\s*none/.test(extra),
    'senza, a 1920 la pagina si ferma a 1160 e lascia 496px di vuoto');

  // --- (d) L'ALTEZZA: gli stessi token del padding di `.main`, non due numeri -
  // ⚠️ È il difetto che questo controllo nasce per non far tornare: `94px` con
  // accanto un commento «30 + 64» quando i token facevano 80, e sotto i 900px
  // 68 dichiarati dove ne servivano 128 (la barra in cima non era contata).
  const PUNTI: [string, string, string[]][] = [
    ['schermo largo', gPage, ['--sp-8', '--sp-12']],
    ['fino a 900px', regola('.as-page', bloccoMedia('900px', extra, '--as-shell-y')),
      ['--topbar-h', '--sp-6', '--sp-12']],
    ['fino a 600px', regola('.as-page', bloccoMedia('600px', extra, '--as-shell-y')),
      ['--topbar-h', '--sp-4', '--sp-12']],
  ];
  for (const [dove, corpo, attesi] of PUNTI) {
    const usati = tokenDi(dichiarazione(corpo, '--as-shell-y'));
    check(`${dove}: --as-shell-y somma i token giusti (${attesi.join(' + ')})`,
      usati.length === attesi.length && attesi.every((t, i) => usati[i] === t),
      `somma ${usati.length ? usati.join(' + ') : '«niente»'} — un numero scritto a mano qui invecchia in silenzio`);
  }
  // E i token dichiarati sono davvero quelli che `.main` usa là.
  const padMain900 = regola('.main', bloccoMedia('900px', app, '.main'));
  const padMain600 = regola('.main', bloccoMedia('600px', app, '.main'));
  const vertDi = (corpo: string): string[] => {
    const p = (dichiarazione(corpo, 'padding') ?? '').split(/\s+/);
    return p.length >= 3 ? [p[0]!, p[2]!] : p.length === 2 ? [p[0]!, p[0]!] : [];
  };
  for (const [dove, corpoMain, corpoPage] of [
    ['schermo largo', gMain, gPage],
    ['fino a 900px', padMain900, PUNTI[1]![1]],
    ['fino a 600px', padMain600, PUNTI[2]![1]],
  ] as const) {
    const vert = vertDi(corpoMain).map((v) => /var\((--[a-z0-9-]+)\)/.exec(v)?.[1] ?? v);
    const usati = tokenDi(dichiarazione(corpoPage, '--as-shell-y')).filter((t) => t !== '--topbar-h');
    check(`${dove}: sono gli STESSI token del padding verticale di .main`,
      vert.length === 2 && usati.length === 2 && vert[0] === usati[0] && vert[1] === usati[1],
      `.main ha [${vert.join(', ')}], --as-shell-y usa [${usati.join(', ')}]`);
  }
  // La barra in cima esiste solo sotto i 900px: sopra NON va contata.
  check('la barra in cima entra nel conto solo dove esiste (sotto i 900px)',
    !tokenDi(dichiarazione(gPage, '--as-shell-y')).includes('--topbar-h')
      && /@media \(max-width: 900px\)/.test(extra),
    'su desktop `.topbar` è `display: none`: contarla toglierebbe 56px per niente');

  // --- (e) IL PANNELLO DELLE FONTI: raggiungibile, e chiuso davvero ---------
  const gDrawer = regola('.as-drawer', extra);
  check('un pannello chiuso esce dalla catena del Tab (visibility: hidden)',
    /visibility:\s*hidden/.test(gDrawer),
    '`translateX` sposta i pixel e basta: i collegamenti restano tabulabili fuori schermo');
  check("in apertura la visibilità cambia a durata zero (il fuoco dev'entrare subito)",
    /\.as-drawer\.open\s*\{[^}]*transition:[^;]*visibility 0s/.test(extra),
    'interpolata, nell’istante zero vale ancora `hidden` e il .focus() non prende');
  check('la pastiglia delle fonti dichiara che cosa apre e se è aperto',
    /aria-controls=\{panelId\}/.test(pagina) && /aria-expanded=\{panelOpen\}/.test(pagina));
  check('il pannello si chiude con Esc', /e\.key === 'Escape'/.test(pagina));
  check('il fuoco entra nel pannello e TORNA da dove veniva',
    /chiusura\.current\?\.focus\(\)/.test(pagina) && /provenienza\.current\?\.focus\?\.\(\)/.test(pagina));
  check('e non passa da requestAnimationFrame',
    !/requestAnimationFrame/.test(pagina),
    'rAF è sospeso a documento non in primo piano: il fuoco non entrerebbe mai');

  // ⚠️⚠️ E IL FUOCO SI SPOSTA ANCHE A PANNELLO GIÀ APERTO (2026-08-19). Con le
  // sole `[open]`, aprire le fonti di UN'ALTRA risposta mentre il pannello è
  // già aperto non rieseguiva niente: il contenuto cambiava sotto un fuoco
  // rimasto dov'era. Chi naviga da tastiera premeva «3 fonti» e restava
  // esattamente dov'era — cioè il difetto che questo pannello era nato per
  // chiudere, sopravvissuto al caso «già aperto».
  //
  // ⚠️ SONO DUE EFFETTI, E LA SEPARAZIONE È LA CORREZIONE. Aggiungere
  // `message?.id` all'effetto unico avrebbe fatto girare anche la PULIZIA a
  // ogni cambio di risposta: la pulizia restituisce il fuoco alla provenienza,
  // quindi il fuoco sarebbe rimbalzato sulla pastiglia VECCHIA prima di
  // arrivare al pannello, e la provenienza registrata subito dopo sarebbe
  // stata quella sbagliata — con Esc si sarebbe tornati alla risposta
  // precedente invece che a quella che si stava guardando. La provenienza si
  // prende UNA volta, all'apertura; il fuoco si muove a ogni risposta.
  const effettiPannello = [...pagina.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[([^\]]*)\]\);/g)];
  const effFuoco = effettiPannello.find((m) => /chiusura\.current\?\.focus\(\)/.test(m[1]!));
  check('il fuoco entra a ogni cambio di risposta, non solo all\'apertura',
    !!effFuoco && /\bmessage\?\.id\b/.test(effFuoco[2]!),
    effFuoco ? `dipendenze: [${effFuoco[2]}]` : "l'effetto che sposta il fuoco non si trova più");
  const effProvenienza = effettiPannello.find((m) => /provenienza\.current = document\.activeElement/.test(m[1]!));
  check('la provenienza si registra SOLO all\'apertura: Esc torna dove si era',
    !!effProvenienza && !/\bmessage\?\.id\b/.test(effProvenienza[2]!),
    effProvenienza ? `dipendenze: [${effProvenienza[2]}]` : "l'effetto che registra la provenienza non si trova più");
  check('e i due effetti sono DUE: la pulizia non deve girare a ogni risposta',
    !!effFuoco && !!effProvenienza && effFuoco[0] !== effProvenienza[0],
    'un effetto solo rimbalzerebbe il fuoco sulla pastiglia vecchia prima di entrare nel pannello');
  check('su schermo largo il pannello non vela la risposta che sta citando',
    /\.as-overlay\s*\{\s*display:\s*none/.test(extra),
    'il velo vive nel blocco dei 900px: le fonti si leggono ACCANTO alla risposta');
  // ⚠️ DENTRO L'EFFETTO, non «da qualche parte nel file»: `setSourcesOpen(false)`
  // c'è anche nella chiusura del pannello, e cercarlo nel testo intero lasciava
  // il controllo VERDE con l'azzeramento tolto (visto alla prova avversaria).
  const azzeramento = /useEffect\(\(\) => \{([\s\S]*?)\}, \[activeCompanyId\]\);/.exec(pagina)?.[1] ?? '';
  check("al cambio azienda il pannello si chiude (§33: non resta aperto su un'altra impresa)",
    /setSourcesOpen\(false\)/.test(azzeramento),
    azzeramento ? "l'effetto su activeCompanyId non lo chiude" : "l'effetto su activeCompanyId non è stato letto");

  // --- (f) L'intestazione è una riga sola ------------------------------------
  check('la testata della pagina non porta più il sottotitolo',
    !/page-desc/.test(pagina),
    'titolo e sottotitolo costavano 121px degli 806 della pagina');
  check('e il sottotitolo non è sparito: è sceso nel vuoto iniziale',
    /subtitle=\{t\('assistant\.subtitle'\)\}/.test(pagina));
}

// ---------------------------------------------------------------------------
section('17. Il conto dei giorni e il FUSO — una scadenza di oggi non è «scaduta ieri»');

// ⚠️⚠️ IL DIFETTO NON SI VEDE DA ZURIGO, ed è per questo che è arrivato in
// produzione. `new Date('2026-08-20')` è mezzanotte UTC — la norma per una data
// senza ora. `DeadlineMark` e `AppointmentMark` la rileggevano con i getter
// LOCALI: a New York quell'istante è il 19 agosto alle 20:00, e `getDate()`
// rispondeva 19. Una scadenza di OGGI si mostrava «scaduta ieri», in ROSSO, a
// chiunque aprisse l'app a ovest di Greenwich. In Europe/Zurich il conto torna,
// quindi nessuna prova scritta qui poteva vederlo: il fuso va SIMULATO.
//
// ⚠️ E ORA IL CONTO È UNO SOLO. Erano tre copie — `calendarDaysUntil` nelle
// Attività, scritta bene, e due `giorniA` identici e sbagliati nello stesso
// modo, nati copiandosi a vicenda. Le prove qui sotto passano dai TRE punti
// d'ingresso: se uno tornasse ad avere la sua aritmetica, qui diventa rosso.
{
  const tzOriginale = process.env.TZ;
  try {
    // Un fuso a ovest di Greenwich: è la condizione in cui il difetto si vede.
    process.env.TZ = 'America/New_York';
    // Mezzogiorno del 20 agosto 2026 A NEW YORK. L'istante è assoluto: a
    // cambiare è solo come lo leggono i getter locali.
    const oggi = new Date('2026-08-20T12:00:00-04:00');
    check('il fuso simulato è davvero a ovest (altrimenti la prova non prova niente)',
      oggi.getTimezoneOffset() > 0, `offset ${oggi.getTimezoneOffset()}`);

    check('New York · una scadenza di OGGI dista zero giorni, non meno uno',
      calendarDaysUntil('2026-08-20', oggi) === 0,
      String(calendarDaysUntil('2026-08-20', oggi)));
    check('New York · il segno del TERMINE dice «oggi», non «scaduta»',
      deadlineState('2026-08-20', false, 7, oggi).state === 'today',
      deadlineState('2026-08-20', false, 7, oggi).state);
    check('New York · il segno dell’APPUNTAMENTO dice «oggi», non «passato»',
      appointmentState('2026-08-20', 7, oggi).state === 'today',
      appointmentState('2026-08-20', 7, oggi).state);
    check('New York · e la stessa funzione presa dalle ATTIVITÀ dà lo stesso numero',
      calendarDaysUntilTasks('2026-08-20', oggi) === 0,
      String(calendarDaysUntilTasks('2026-08-20', oggi)));

    // I due giorni accanto, dove uno scarto di uno si vede subito.
    check('New York · ieri è meno uno e il termine è scaduto DA UN GIORNO',
      calendarDaysUntil('2026-08-19', oggi) === -1
      && deadlineState('2026-08-19', false, 7, oggi).days === 1);
    check('New York · domani è più uno, e non è ancora scaduto',
      calendarDaysUntil('2026-08-21', oggi) === 1
      && deadlineState('2026-08-21', false, 7, oggi).state === 'soon');

    // ⚠️ LA CONTROPROVA — la copia vecchia, riprodotta qui riga per riga. Senza,
    // «oggi dista zero» sarebbe verde anche su un'aritmetica che non è mai
    // stata rotta, e questa sezione non proverebbe di aver corretto qualcosa.
    const giorniALocale = (dateIso: string, o: Date): number => {
      const a = new Date(o.getFullYear(), o.getMonth(), o.getDate());
      const d = new Date(dateIso);
      const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      return Math.round((b.getTime() - a.getTime()) / 86_400_000);
    };
    check('CONTROPROVA: la copia con i getter LOCALI dice −1 su una scadenza di oggi',
      giorniALocale('2026-08-20', oggi) === -1, String(giorniALocale('2026-08-20', oggi)));

    // ⚠️ E A EST NON DEVE CAMBIARE NIENTE: la correzione non doveva spostare il
    // conto dove già tornava. Un fuso a est di Greenwich, con lo stesso giorno.
    process.env.TZ = 'Europe/Zurich';
    const oggiZurigo = new Date('2026-08-20T12:00:00+02:00');
    check('Zurigo · una scadenza di oggi resta zero giorni',
      calendarDaysUntil('2026-08-20', oggiZurigo) === 0);
    check('Zurigo · e i due segni continuano a dire «oggi»',
      deadlineState('2026-08-20', false, 7, oggiZurigo).state === 'today'
      && appointmentState('2026-08-20', 7, oggiZurigo).state === 'today');
    check('Zurigo · CONTROPROVA: qui anche la copia vecchia tornava — ecco perché non si vedeva',
      giorniALocale('2026-08-20', oggiZurigo) === 0);
  } finally {
    // ⚠️ Il fuso si rimette com'era: le sezioni che seguono — e chi legge il
    // risultato — non devono ereditare un ambiente che questa prova ha piegato.
    if (tzOriginale === undefined) delete process.env.TZ; else process.env.TZ = tzOriginale;
  }

  // Una data che non si legge non diventa un numero: «nessuna scadenza» e
  // «scade oggi» sono due cose diverse.
  check('una data illeggibile dà null, non zero',
    calendarDaysUntil('non-una-data') === null && calendarDaysUntil(null) === null);
  check('e il termine la dichiara DA VERIFICARE, invece di scrivere «fra NaN giorni»',
    deadlineState('non-una-data').state === 'toVerify',
    deadlineState('non-una-data').state);

  // ⚠️ LA GUARDIA SCOLLEGATA: nessuna quarta copia. Le prove qui sopra restano
  // verdi il giorno in cui qualcuno riscrive il conto dentro un componente.
  const conteggi = ['src/components/ui/DeadlineMark.tsx', 'src/components/ui/AppointmentMark.tsx',
    'src/features/tasks/taskFormat.ts']
    .filter((f) => /new Date\(\s*\w+\.getFullYear\(\)/.test(
      readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')));
  check('nessuno dei tre punti si è riscritto il conto in casa', conteggi.length === 0,
    conteggi.join(', '));
}

// ---------------------------------------------------------------------------
section('18. La Panoramica dai numeri — i blocchi sono puri e provati');
// ⚠️ PERCHÉ QUI. `useOverview` importa i servizi e non si carica da Node: ogni
// decisione della Home — chi compare, come si dividono le attività, CHE PAROLA
// va su quale numero — sta in `overviewBlocks`, dove QUESTO banco può romperla.
// I numeri che seguono sono quelli del censimento 2026-08-19.

{
  const T = (over: Partial<{ title: string; dueDate: string | null; appointmentDate: string | null }> = {}) => ({
    title: 'x', dueDate: null, appointmentDate: null, ...over,
  });
  const OGGI = '2026-08-19';

  // (a) La divisione delle attività: termini ≠ appuntamenti (0041).
  const rossi = splitOpenTasks(
    [T({ appointmentDate: '2026-09-01' }), T({ appointmentDate: '2026-09-02' }), T({ appointmentDate: '2026-09-03' })],
    3, OGGI,
  );
  check('le tre di Rossi sono APPUNTAMENTI: nessun termine, nessuno scaduto',
    rossi.appuntamenti === 3 && rossi.termini === 0 && rossi.scadute === 0 && rossi.senzaData === 0);
  check('un\'attività con ENTRAMBE le date è un termine, non due righe',
    (() => { const s = splitOpenTasks([T({ dueDate: '2026-09-01', appointmentDate: '2026-08-25' })], 1, OGGI);
      return s.termini === 1 && s.appuntamenti === 0; })());
  check('senza nessuna data è «senza data», non un appuntamento',
    splitOpenTasks([T()], 1, OGGI).senzaData === 1);
  check('scaduta = due_date PRIMA di oggi, in ora locale passata da fuori',
    (() => { const s = splitOpenTasks([T({ dueDate: '2026-08-18' }), T({ dueDate: '2026-08-19' })], 2, OGGI);
      return s.scadute === 1; })());
  check('il diviso parziale si dichiara: lette < aperte',
    (() => { const s = splitOpenTasks([T()], 5, OGGI); return s.parziale && s.lette === 1 && s.aperte === 5; })());
  check('il primo è la testa dell\'elenco già ordinato, non una scelta locale',
    splitOpenTasks([T({ title: 'primo' }), T({ title: 'secondo' })], 2, OGGI).primo?.title === 'primo');

  // ⚠️⚠️ (a-bis) R4 — IL NOME A SCHERMO, non solo la classificazione.
  // La divisione qui sopra era guardata; la PAROLA che accompagna ciascun
  // numero no, ed è la parola che l'utente legge. Rendere gli appuntamenti con
  // la chiave dei termini — «3 termini» sopra tre sopralluoghi — è una data
  // presentata come un obbligo quando non lo è: la classe d'errore che questo
  // prodotto teme di più, e restava verde in tutta la suite.
  {
    const parti = chiaviTaskSplit(rossi);
    const perNumero = (n: number) => parti.find((x) => x.n === n) ?? null;
    check('R4: i 3 appuntamenti prendono la parola DEGLI APPUNTAMENTI',
      perNumero(3)?.base === 'home.tasksAppts',
      `la parte da 3 porta ${JSON.stringify(perNumero(3))}`);
    check('R4: e nessuna parte porta la parola dei TERMINI, che qui sono zero',
      parti.every((x) => x.base !== 'home.tasksTerms'),
      'zero termini: la coppia dei termini non deve comparire affatto');
    check('lo zero dei termini è una FRASE INTERA dichiarata, non un conteggio',
      parti.some((x) => x.base === null && x.chiave === 'home.tasksTermsNone'));

    const misto = splitOpenTasks(
      [T({ dueDate: '2026-08-01' }), T({ dueDate: '2026-09-01' }), T({ appointmentDate: '2026-09-02' }), T()],
      4, OGGI,
    );
    const p2 = chiaviTaskSplit(misto);
    check('R4: con 2 termini e 1 appuntamento ogni numero porta la SUA parola',
      p2.find((x) => x.n === 2)?.base === 'home.tasksTerms'
      && p2.find((x) => x.n === 1 && x.base === 'home.tasksAppts') !== undefined,
      JSON.stringify(p2));
    check('R4: lo scaduto non prende la parola dei termini né viceversa',
      p2.filter((x) => x.base === 'home.tasksOverdue').length === 1
      && p2.filter((x) => x.base === 'home.tasksTerms').length === 1);
    check('l\'ordine delle parti non cambia: appuntamenti · termini · senza data · scaduti',
      p2.map((x) => x.base ?? x.chiave).join('|')
        === 'home.tasksAppts|home.tasksTerms|home.tasksNoDate|home.tasksOverdue',
      p2.map((x) => x.base ?? x.chiave).join('|'));
  }

  // ⚠️ R4 NELLE TRE LINGUE: la parola dei termini e quella degli appuntamenti
  // sono DIVERSE in ciascuna, e non si scambiano. In tedesco «Termin» è
  // l'appuntamento e «Frist» il termine: un controllo scritto in italiano su
  // «termin» le confonderebbe, quindi ogni lingua porta le sue due parole.
  {
    const PAROLE = {
      it: { termine: 'termin', appuntamento: 'appuntament' },
      de: { termine: 'frist', appuntamento: 'termin' },
      fr: { termine: 'échéance', appuntamento: 'rendez-vous' },
    } as const;
    for (const { lang, d } of [{ lang: 'it', d: it.home }, { lang: 'de', d: de.home }, { lang: 'fr', d: fr.home }] as const) {
      const w = PAROLE[lang];
      const term = `${d.tasksTermsOne} ${d.tasksTermsMany} ${d.tasksTermsNone}`.toLowerCase();
      const appt = `${d.tasksApptsOne} ${d.tasksApptsMany}`.toLowerCase();
      check(`${lang}: la frase dei TERMINI dice la parola del termine`,
        term.includes(w.termine), term);
      check(`${lang}: e non dice quella dell'appuntamento`,
        !term.includes(w.appuntamento), term);
      check(`${lang}: la frase degli APPUNTAMENTI dice la parola dell'appuntamento`,
        appt.includes(w.appuntamento), appt);
      check(`${lang}: e non dice quella del termine`,
        !appt.includes(w.termine), appt);
    }
  }

  // ⚠️ E LA PAGINA NON SCEGLIE LE CHIAVI DA SÉ: se le scegliesse, la coppia
  // numero-parola tornerebbe fuori dalla portata di questo banco.
  {
    const senzaCommenti = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const pagina = senzaCommenti(readFileSync(join(root, 'src/features/dashboard/HomePage.tsx'), 'utf8'));
    check('la Panoramica compone la ripartizione con chiaviTaskSplit',
      /chiaviTaskSplit\(/.test(pagina));
    check('e non nomina a mano nessuna chiave della ripartizione',
      !/home\.tasks(Appts|Terms|NoDate|Overdue)(One|Many)/.test(pagina),
      'le coppie stanno nella funzione pura, non sparse nel JSX');
  }

  // (b) LE DATE DEI DOCUMENTI. NULL e lo storico 'none' NON sono «nessuna
  // scadenza» — sono natura non registrata. In produzione: 2 date, entrambe
  // NULL, zero termini.
  const D = (kind: string | null, deadline: string | null = '2026-09-01', id = 'x'): DataDocumento & { id: string } =>
    ({ kind, deadline, id });

  const produzione = contoDate([D(null), D(null)], 2);
  check('le due date di produzione: natura non registrata, zero termini',
    produzione.nonRegistrate === 2 && produzione.termini.length === 0 && produzione.totale === 2);
  check('term è termine; event e reference non obbligano; \'none\' e l\'ignoto non sono registrati',
    (() => { const c = contoDate([D('term'), D('event'), D('reference'), D('none'), D('boh'), D(null)], 6);
      return c.termini.length === 1 && c.nonObbliganti === 2 && c.nonRegistrate === 3; })());
  check('la ripartizione dichiara SU QUANTE righe ha contato, e le voci sommano lì',
    (() => { const c = contoDate([D('term'), D('event'), D(null)], 3);
      return c.lette === 3 && c.termini.length + c.nonObbliganti + c.nonRegistrate === c.lette; })());
  check('lette < totale: la ripartizione si dichiara parziale',
    contoDate([D(null)], 9).parziale && !contoDate([D(null)], 1).parziale);

  // ⚠️⚠️ (b-bis) UN TERMINE È UNA VOCE, NON UN NUMERO — e l'ordine è quello
  // del giorno: il più scaduto per primo. «3 date nei documenti: 1 termini, 1
  // che non obbligano l'azienda, 1 di natura non registrata» era il censimento
  // delle nature di un archivio al posto della data che obbliga davvero.
  {
    const c = contoDate([D('term', '2026-12-01', 'tardi'), D('term', '2026-01-15', 'presto'), D(null)], 3);
    check('i termini escono INTERI, in ordine di giorno crescente',
      c.termini.map((x) => x.id).join(',') === 'presto,tardi',
      c.termini.map((x) => `${x.id}:${x.deadline}`).join(' '));
    check('una data senza giorno finisce in coda, non in testa',
      contoDate([D('term', null, 'muta'), D('term', '2026-05-05', 'datata')], 2)
        .termini.map((x) => x.id).join(',') === 'datata,muta');
  }

  // I termini delle DUE popolazioni si uniscono: un termine archiviato resta un
  // obbligo, e il collegamento porta al documento — non a un elenco.
  {
    const att = contoDate([D('term', '2026-06-01', 'att')], 1);
    const arch = contoDate([D('term', '2026-03-01', 'arch')], 1);
    const u = termini(att, arch);
    check('il termine ARCHIVIATO compare, e prima di quello attivo se è più vicino',
      u.voci.map((x) => x.id).join(',') === 'arch,att' && u.trovati === 2, u.voci.map((x) => x.id).join(','));
    check('nessun termine: nessuna voce, e il blocco non ha niente da mostrare',
      termini(contoDate([D(null)], 1), contoDate([], 0)).voci.length === 0);

    // Il tetto dichiarato: la regola resta «ogni termine è una voce», ma la
    // Home non è l'elenco delle scadenze — e quando morde lo DICE.
    const molti = contoDate(
      Array.from({ length: TERMINI_IN_PANORAMICA + 2 }, (_, i) => D('term', `2026-0${(i % 9) + 1}-01`, `t${i}`)),
      TERMINI_IN_PANORAMICA + 2,
    );
    const conTetto = termini(molti, contoDate([], 0));
    check('il tetto dei termini elencati morde e si dichiara col numero che resta',
      conTetto.voci.length === TERMINI_IN_PANORAMICA && conTetto.altri === 2
      && conTetto.trovati === TERMINI_IN_PANORAMICA + 2,
      `voci ${conTetto.voci.length}, altri ${conTetto.altri}`);
    check('sotto il tetto non c\'è niente da dichiarare',
      termini(att, arch).altri === 0);

    // ⚠️⚠️ L'ELENCO NON SI DICHIARA COMPLETO SE NON LO È: con la lettura al
    // tetto un termine può stare fra le date NON guardate.
    const parziale = termini(contoDate([D('term')], 40), contoDate([], 0));
    check('lettura al tetto: l\'elenco dei termini si dichiara parziale, coi due numeri',
      parziale.parziale && parziale.lette === 1 && parziale.totaleDate === 40);
    check('lettura intera: niente da dichiarare',
      !termini(att, arch).parziale);
  }

  // (b-ter) LA RIGA DELLE DATE DI NATURA NON REGISTRATA — un limite, e il suo
  // numero non è sempre quello della destinazione.
  {
    check('niente da dire quando ogni natura è registrata',
      rigaNature(contoDate([D('term'), D('event')], 2)) === null);
    const prod = rigaNature(contoDate([D(null), D(null)], 2))!;
    check('produzione: 2 su 2, e la destinazione mostra esattamente quelle',
      prod.n === 2 && prod.totale === 2 && !prod.destinazionePiuAmpia);
    const mista = rigaNature(contoDate([D(null), D('term'), D('event')], 3))!;
    check('1 non registrata su 3 date: la riga dichiara che la destinazione è più ampia',
      mista.n === 1 && mista.totale === 3 && mista.destinazionePiuAmpia);
    const tetto = rigaNature(contoDate([D(null), D(null)], 30))!;
    check('e il tetto di lettura resta dichiarato per conto suo',
      tetto.parziale && tetto.lette === 2 && tetto.totale === 30);
  }

  // (c) La visibilità dei blocchi: compaiono solo con contenuto.
  const zero = {
    ownership: 0, aperte: 0, terminiNeiDocumenti: 0, dateNonRegistrate: 0,
    daVerificare: 0, fallite: 0, maiAnalizzati: 0,
    programmiInCatalogo: 0, openCases: 0, activeProjects: 0,
  };
  check('il blocco decisioni esiste solo con appartenenze da confermare',
    decidiBlocchi({ ...zero, ownership: 7 }).decisioni && !decidiBlocchi(zero).decisioni);
  check('16 non conclusive accendono il blocco del sistema anche a Home «vuota»',
    decidiBlocchi({ ...zero, daVerificare: 16 }).sistema);
  check('lo stato vuoto operativo dichiara il controllato, anche col catalogo pieno',
    (() => { const b = decidiBlocchi({ ...zero, programmiInCatalogo: 7 });
      return b.vuotoOperativo && b.opportunita; })());
  check('con una decisione aperta lo stato vuoto NON compare',
    !decidiBlocchi({ ...zero, ownership: 1 }).vuotoOperativo);

  // ⚠️⚠️ (c-bis) «DA FARE» SOLO SE C'È DA FARE. Un titolo «Da fare» sopra una
  // riga che non chiede niente insegna a saltare quel titolo: le date di
  // natura non dichiarata non sono lavoro, sono un limite di ciò che il
  // sistema ha capito, e vanno fra i limiti.
  {
    const soloIgnote = decidiBlocchi({ ...zero, dateNonRegistrate: 2 });
    check('due date di natura ignota NON accendono «Da fare»',
      !soloIgnote.daFare,
      'era il caso della produzione: un blocco «Da fare» senza niente da fare');
    check('le accende invece il blocco dei limiti, che è il posto delle cose così',
      soloIgnote.sistema);
    check('e la pagina non dice «Niente in sospeso»: qualcosa da dire c\'è',
      !soloIgnote.vuotoOperativo);
    const conTermine = decidiBlocchi({ ...zero, terminiNeiDocumenti: 1 });
    check('CONTROPROVA: un TERMINE accende «Da fare» — quello sì è lavoro',
      conTermine.daFare && !conTermine.sistema);
  }

  // ⚠️⚠️ (d) NESSUN BLOCCO SPARISCE IN SILENZIO. Ogni ingresso che può valere
  // `null` — cioè «non ho potuto leggere» — deve LASCIARE IL SUO BLOCCO A
  // SCHERMO. Un blocco che sparisce quando è rotto è indistinguibile da un
  // blocco vuoto perché non c'è niente da fare, ed erano due risposte opposte
  // allo stesso guasto sulla stessa pagina: il catalogo lo dichiarava, la
  // lettura dell'appartenenza faceva sparire il blocco Decisioni.
  {
    const guasti: { nome: string; input: typeof zero; blocco: keyof ReturnType<typeof decidiBlocchi> }[] = [
      { nome: 'appartenenza non leggibile', input: { ...zero, ownership: null as never }, blocco: 'decisioni' },
      { nome: 'catalogo non leggibile', input: { ...zero, programmiInCatalogo: null as never }, blocco: 'opportunita' },
    ];
    for (const g of guasti) {
      check(`${g.nome}: il blocco RESTA a schermo per dichiararlo`,
        decidiBlocchi(g.input)[g.blocco] === true);
    }
    const ignoto = decidiBlocchi({ ...zero, ownership: null as never });
    check('e la pagina sa che dentro va la frase del guasto, non un conteggio',
      ignoto.ownershipIgnota);
    check('appartenenza non letta + tutto il resto a zero: «Niente in sospeso» NON compare',
      !ignoto.vuotoOperativo);
    // La CONTROPROVA: con l'appartenenza LETTA e a zero, lo stato vuoto è
    // ancora quello di prima — la correzione non l'ha spento in generale.
    const letto = decidiBlocchi(zero);
    check('CONTROPROVA: appartenenza letta e a zero, lo stato vuoto compare ancora',
      letto.vuotoOperativo && !letto.ownershipIgnota && !letto.decisioni);
  }

  // (e) Le frasi esistono nelle tre lingue, coi loro segnaposto, e la pagina le
  // rende: una chiave scritta e mai resa non dichiara niente.
  const SEGNAPOSTO: Record<string, string[]> = {
    termItem: ['{date}', '{title}'],
    termsPartial: ['{n}', '{tot}'],
    datesUnrecordedOne: ['{dove}'],
    datesUnrecordedMany: ['{n}', '{dove}'],
    datesScope: ['{tot}', '{dove}'],
    datesSplitPartial: ['{n}', '{tot}'],
    termsMoreOne: ['{n}'],
    termsMoreMany: ['{n}'],
    footNonBindingMany: ['{n}'],
    footNonBindingArchived: ['{n}'],
  };
  for (const { lang, d } of [{ lang: 'it', d: it.home }, { lang: 'de', d: de.home }, { lang: 'fr', d: fr.home }]) {
    for (const [k, attesi] of Object.entries(SEGNAPOSTO)) {
      const testo = (d as Record<string, string>)[k];
      check(`${lang}: home.${k} esiste e porta ${attesi.join(' ')}`,
        typeof testo === 'string' && attesi.every((x) => testo.includes(x)), testo);
    }
    for (const k of ['termsFromDocs', 'termNoDate', 'ctaDates', 'tasksHeading'] as const) {
      const testo = (d as Record<string, string>)[k];
      check(`${lang}: home.${k} esiste`, typeof testo === 'string' && testo.trim().length > 0);
    }
  }

  {
    const senzaCommenti = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const pagina = senzaCommenti(readFileSync(join(root, 'src/features/dashboard/HomePage.tsx'), 'utf8'));
    // ⚠️⚠️ NON BASTA CHE LA CHIAVE COMPAIA NEL FILE. Due sabotaggi restavano
    // verdi con il solo `includes`: togliere `<VociTermini/>` dal blocco «Da
    // fare» (il componente restava definito più sotto, chiave compresa) e
    // togliere il `<Link>` attorno alla riga delle date (il `to=` restava, ma
    // su un'altra riga). È la cecità R3 in miniatura: una chiave scritta non è
    // una chiave RESA, e un indirizzo scritto non è un collegamento. Perciò si
    // guarda il CORPO della funzione che deve renderla, e la riga intera.
    const corpoDi = (nome: string) => {
      const da = pagina.indexOf(`function ${nome}(`);
      if (da < 0) return '';
      const a = pagina.indexOf('\n}\n', da);
      return pagina.slice(da, a < 0 ? undefined : a);
    };
    const rigaCon = (ago: string) => pagina.split('\n').filter((r) => r.includes(ago));
    // Un `<Link>` può stare su tre righe: la domanda «questo numero è
    // cliccabile?» si fa sul PEZZO fra l'apertura e la chiusura, non sulla riga.
    const dentroUnLink = (corpo: string, ago: string) =>
      corpo.split('<Link').slice(1).some((pezzo) => {
        const fine = pezzo.indexOf('</Link>');
        return fine >= 0 && pezzo.slice(0, fine).includes(ago);
      });

    check('la Panoramica rende i termini come VOCI, con giorno e titolo',
      pagina.includes('home.termItem') && /termini\(/.test(pagina));
    check('e il blocco «Da fare» le rende DAVVERO, non le tiene definite altrove',
      /<VociTermini\b/.test(corpoDi('BloccoDaFare')),
      'il componente esisteva e nessuno lo montava: il sabotaggio restava verde');
    // ⚠️ «nessun termine» (delle ATTIVITÀ) sopra un termine dei DOCUMENTI sono
    // due frasi vere che si leggono come una contraddizione: quando ci sono
    // tutt'e due le parti, ciascuna dice di che cosa parla.
    check('con termini E attività insieme, le due parti hanno ciascuna il suo nome',
      corpoDi('BloccoDaFare').includes('home.tasksHeading')
      && /titolo=\{dueParti\}/.test(corpoDi('BloccoDaFare'))
      && /const dueParti = /.test(corpoDi('BloccoDaFare')));
    check('e ogni voce porta al DOCUMENTO, non a un elenco',
      rigaCon('home.termItem').length > 0
      && corpoDi('VociTermini').includes('/documenti/${v.id}'),
      'un termine si apre, non si filtra');
    check('la riga delle date ignote esiste, ed è un collegamento VERO',
      rigaCon("home.datesUnrecorded").some((r) => r.includes('<Link') && r.includes('</Link>')),
      'un numero senza destinazione è un numero che l\'utente non può verificare');
    check('e il blocco dei limiti la monta per entrambe le popolazioni',
      (corpoDi('BloccoSistema').match(/<RigaDateIgnote\b/g) ?? []).length === 2
      && corpoDi('BloccoSistema').includes('home.popActive')
      && corpoDi('BloccoSistema').includes('home.popArchived'));
    // ⚠️⚠️ UN TETTO CHE SMETTE DI DICHIARARSI QUANDO MORDE è la classe di
    // difetto che questa pagina è nata per togliere: una marcatura che sparisce
    // proprio nel momento in cui serve. Il conteggio resta a schermo, sembra
    // intero, e non lo è — «calcolata sulle prime 100 di 150» diventa «150».
    // Misurato il 2026-08-20: togliere la riga di `tasksSplitPartial` o quella
    // di `ownershipPartial` lasciava TUTTA la suite verde. Ogni dichiarazione
    // va cercata nel CORPO della funzione che la possiede, e insieme alla
    // condizione che la accende: una senza l'altra è metà guardia.
    //
    // ⚠️ E il letterale qui è lecito perché questo check ASSERISCE che il
    // prodotto lo usa: se la pagina smette di renderlo, questa riga è rossa
    // prima che il rilevatore di chiavi orfane possa tacere. Un letterale in un
    // banco che NON assicura l'uso sarebbe la macchina che tiene in vita ciò
    // che dovrebbe segnalare.
    const TETTI: { chiave: string; funzione: string; condizione: string }[] = [
      { chiave: 'home.ownershipPartial', funzione: 'BloccoDecisioni', condizione: 'ownership.parziale' },
      { chiave: 'home.tasksSplitPartial', funzione: 'BloccoDaFare', condizione: 's.parziale' },
      { chiave: 'home.termsPartial', funzione: 'VociTermini', condizione: 'parziale' },
      { chiave: 'home.datesSplitPartial', funzione: 'RigaDateIgnote', condizione: 'r.parziale' },
    ];
    for (const tetto of TETTI) {
      const corpo = corpoDi(tetto.funzione);
      check(`il tetto di ${tetto.chiave} si dichiara dentro ${tetto.funzione}`,
        corpo.includes(tetto.chiave) && corpo.includes(tetto.condizione),
        corpo.includes(tetto.chiave) ? `manca la condizione ${tetto.condizione}` : 'la frase non è resa');
    }
    // ⚠️ Anche il tetto dell'ELENCO dei termini si dichiara a schermo, non solo
    // nella funzione pura: `altri` calcolato e mai reso è un tetto che morde in
    // silenzio. (Come sopra, il letterale è lecito perché il check assicura
    // l'uso: se la pagina smette di renderlo, questa riga è rossa prima che
    // `i18n:orphans` debba accorgersi delle due forme rimaste sole.)
    check('e il numero dei termini NON elencati si dichiara a schermo',
      corpoDi('VociTermini').includes('home.termsMore'));
    check('e la divergenza col numero della destinazione si dichiara',
      pagina.includes('home.datesScope') && /destinazionePiuAmpia/.test(pagina));
    // ⚠️⚠️ LE DATE CHE NON OBBLIGANO NON SPARISCONO, e la ragione è
    // l'ASIMMETRIA DELL'ERRORE: un evento scambiato per termine mostra un
    // obbligo falso, visibile e autocorreggente; un TERMINE scambiato per
    // evento sparisce in silenzio e si scopre tardi. Un conteggio solo, nel
    // piede, col suo collegamento: non una voce, non un blocco, niente che
    // chieda un gesto — ma niente silenzio su quella popolazione.
    {
      const corpo = corpoDi('OverviewBody');
      check('il piede dichiara le date che non obbligano, e il numero porta all\'elenco',
        dentroUnLink(corpo, 'home.footNonBinding'),
        'un conteggio senza destinazione è un conteggio che l\'utente non può verificare');
      check('e il conteggio copre le DUE popolazioni, non una',
        /attivi\.nonObbliganti \+ data\.date\.archiviati\.nonObbliganti/.test(corpo));
      check('e non tace sulla parte ARCHIVIATA, che la destinazione non mostra',
        corpo.includes('home.footNonBindingArchived')
        && corpo.includes('data.date.archiviati.nonObbliganti > 0'));
    }

    check('il blocco Decisioni dichiara il guasto DENTRO DI SÉ, senza una sezione a parte',
      pagina.includes('home.ownershipUnknown')
      && !/blocchi\.ownershipIgnota &&/.test(pagina),
      'un blocco che non riesce a leggere i suoi dati resta a schermo e lo dice');
    check('nessuna riga di conteggio della Panoramica sceglie a mano fra singolare e plurale',
      !/\?\s*'home\.[A-Za-z]+One'\s*:\s*'home\.[A-Za-z]+Many'/.test(pagina),
      'la forma la sceglie la lingua: `tn`, non un `=== 1`');
  }

  // ⚠️⚠️ (f) LE FORME PLURALI LE SCEGLIE LA LINGUA. In italiano e in tedesco lo
  // ZERO vuole il plurale; in FRANCESE vuole il singolare. Un `n === 1` scritto
  // a mano è giusto in due lingue su tre, e sbaglia proprio sullo zero — il
  // numero che questa pagina mostra più spesso.
  {
    const atteso: Record<string, ('One' | 'Many')[]> = {
      it: ['Many', 'One', 'Many'],
      de: ['Many', 'One', 'Many'],
      fr: ['One', 'One', 'Many'],
    };
    const base: PluralBase = 'home.tasksTerms';
    for (const lang of LOCALES) {
      const forme = [0, 1, 2].map((n) => (pluralKey(base, n, lang).endsWith('One') ? 'One' : 'Many'));
      check(`${lang}: 0 · 1 · 2 → ${atteso[lang].join(' · ')}`,
        forme.join('|') === atteso[lang].join('|'), forme.join('|'));
    }
    check('⚠️ ed è il francese a distinguersi: lo ZERO vuole il SINGOLARE',
      pluralKey('home.tasksTerms', 0, 'fr').endsWith('One')
      && pluralKey('home.tasksTerms', 0, 'it').endsWith('Many'));
    // ⚠️⚠️ LE BASI SI LEGGONO DAL SORGENTE, NON SI ELENCANO QUI. Un elenco
    // scritto a mano nominerebbe dieci chiavi `home.*` come LETTERALI, e per
    // `i18n:orphans` un letterale è un uso: le venti forme resterebbero «vive»
    // anche dopo che la pagina avesse smesso di chiamarle — questo banco
    // diventerebbe la macchina che le tiene in vita. Provato: togliendo
    // l'unica chiamante di `home.termsMore` dalla Panoramica, con l'elenco a
    // mano il rilevatore restava VERDE. Le catture qui sotto sono valori a
    // runtime, e le espressioni regolari il tokenizzatore le salta.
    const senzaCommenti2 = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const sorgenti = [
      senzaCommenti2(readFileSync(join(root, 'src/features/dashboard/HomePage.tsx'), 'utf8')),
      senzaCommenti2(readFileSync(join(root, 'src/features/dashboard/overviewBlocks.ts'), 'utf8')),
    ].join('\n');
    const basi = [...new Set([
      ...sorgenti.matchAll(/tn\(\s*'(home\.[A-Za-z]+)'/g),
      ...sorgenti.matchAll(/base="(home\.[A-Za-z]+)"/g),
      ...sorgenti.matchAll(/base: '(home\.[A-Za-z]+)'/g),
    ].map((m) => m[1]))] as PluralBase[];
    check('le basi plurali si trovano nel sorgente della Panoramica (almeno nove)',
      basi.length >= 9, basi.join(' '));
    check('e per ognuna la coppia esiste nelle tre lingue, a 0 · 1 · 2 · 8',
      basi.every((b) => LOCALES.every((l) => [0, 1, 2, 8].every((n) => {
        const k = pluralKey(b, n, l).split('.')[1];
        const d = { it: it.home, de: de.home, fr: fr.home }[l] as Record<string, string>;
        return typeof d[k] === 'string' && d[k].trim().length > 0;
      }))), basi.join(' '));
  }
}

// ---------------------------------------------------------------------------
section('19. I tetti dichiarati — il numero non lo sceglie il frontend');
// ⚠️ `useOverview` non si carica da Node (importa i servizi): la costante si
// legge dal SORGENTE, e il tetto vero dalla migrazione più recente che
// definisce `list_tasks`. Chiedere alla RPC più di quanto concede non è un
// numero generoso: è una copertura che la Home dichiara di avere e non ha —
// con 150 attività aperte, `limit: 200` ne otteneva 100 e la riga scriveva
// «calcolata sulle prime 100 di 150».
// ⚠️ I COMMENTI SI TOLGONO PRIMA DI LEGGERE: la nota qui accanto alla costante
// cita il `least(...)` della migrazione, e un lettore a regex non distingue una
// riga che fa una cosa da una che la racconta.

{
  const senzaCommenti = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const overview = senzaCommenti(readFileSync(join(root, 'src/features/dashboard/useOverview.ts'), 'utf8'));
  const chiesto = Number(overview.match(/const TASKS_SPLIT_MAX = (\d+);/)?.[1]);
  check('la costante TASKS_SPLIT_MAX si trova nel sorgente', Number.isFinite(chiesto),
    'un lettore che non trova niente NON deve uscire verde: se il nome cambia, questo passo è rosso');

  // Il tetto vero: vince l'ULTIMA migrazione che (ri)definisce `list_tasks`.
  // Oggi è la 0041; una 0050 che lo alzasse sposterebbe questo controllo con sé.
  const migrazioni = readdirSync(join(root, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql')).sort();
  let concesso = NaN, dove = '';
  for (const f of migrazioni) {
    const sql = readFileSync(join(root, 'supabase/migrations', f), 'utf8');
    // ⚠️ `indexOf` sulla DEFINIZIONE e non `lastIndexOf` sul nome: l'ultima
    // occorrenza di «function public.list_tasks(» è il `revoke`/`grant` in
    // fondo al file, dopo il quale non c'è nessun `least(...)` da leggere — e
    // il lettore usciva a mani vuote credendo di aver guardato.
    const i = sql.indexOf('create or replace function public.list_tasks(');
    if (i < 0) continue;
    const m = sql.slice(i).match(/least\(coalesce\(p_limit,\s*\d+\),\s*(\d+)\)/);
    if (m) { concesso = Number(m[1]); dove = f; }
  }
  check('il tetto di list_tasks si legge dalla migrazione più recente che la definisce',
    Number.isFinite(concesso), dove || 'nessuna definizione trovata: il lettore sta leggendo a vuoto');

  check(`la Panoramica non chiede più di quanto list_tasks conceda (${chiesto} ≤ ${concesso})`,
    chiesto <= concesso, `${dove}: least(coalesce(p_limit, …), ${concesso})`);

  // CONTROPROVA del lettore delle migrazioni: il tetto letto è un numero vero e
  // non uno zero di ripiego che farebbe passare qualunque costante.
  check('CONTROPROVA: il tetto letto è quello della 0041, cioè 100',
    concesso === 100 && dove.startsWith('0041'), `${dove} → ${concesso}`);
}

// ---------------------------------------------------------------------------
section('20. Il catalogo vuoto non è un catalogo verificato');
// ⚠️⚠️ `verified === programs` è vero anche con entrambi a ZERO, e il blocco
// Opportunità si accende pure a catalogo vuoto — basta una pratica aperta o un
// progetto attivo. Ne usciva «0 programmi in banca dati, verificati».

{
  check('catalogo vuoto: la frase dice che è vuoto, non che è tutto verificato',
    fraseCatalogo({ programs: 0, verified: 0 }) === 'vuoto',
    fraseCatalogo({ programs: 0, verified: 0 }));
  check('sette su sette resta «tutti verificati» — la correzione non ha spento il caso vero',
    fraseCatalogo({ programs: 7, verified: 7 }) === 'tuttiVerificati');
  check('sette su tre è «in parte»',
    fraseCatalogo({ programs: 7, verified: 3 }) === 'inParte');
  check('e «non ho potuto guardare» resta distinto da «ho guardato e non c\'era niente»',
    fraseCatalogo(null) === 'nonLeggibile');
  // Il caso limite che l'uguaglianza da sola non distingue: zero programmi ma
  // un numero di verificati assurdo non deve comunque diventare un vanto.
  check('zero programmi: la frase è «vuoto» qualunque cosa dica il verificato',
    fraseCatalogo({ programs: 0, verified: 3 }) === 'vuoto');

  for (const { lang, d } of [{ lang: 'it', d: it.home }, { lang: 'de', d: de.home }, { lang: 'fr', d: fr.home }]) {
    check(`${lang}: home.catalogEmpty esiste`,
      typeof d.catalogEmpty === 'string' && d.catalogEmpty.trim().length > 0);
  }
  {
    const pagina = readFileSync(join(root, 'src/features/dashboard/HomePage.tsx'), 'utf8');
    check('la Panoramica rende home.catalogEmpty e passa da fraseCatalogo',
      pagina.includes('home.catalogEmpty') && /fraseCatalogo\(/.test(pagina));
    check('e non decide più in linea con l\'uguaglianza fra i due conteggi',
      !/catalogo\.verified === catalogo\.programs/.test(pagina));
  }
}

// ---------------------------------------------------------------------------
section('21. Un guasto di un riquadro non porta giù la Panoramica intera');
// ⚠️⚠️ `catalogState` e `assessmentCount` tornano `null` sul guasto — è
// dichiarato in `OverviewData` e il blocco lo dice a schermo — mentre `summary`
// LANCIA (`fail(error)`), e non era avvolta da nessun `.catch`: una `Promise.all`
// che rifiuta porta giù tutto, e la Panoramica finiva in ErrorState per un
// guasto di `subsidy_home_summary`. Il ramo `home.summaryUnknown`, scritto e
// tradotto apposta, era irraggiungibile.
//
// Il guardiano non guarda un solo nome: pretende che OGNI lettura degli
// incentivi fatta dalla Panoramica o non possa rifiutare, o sia avvolta.

{
  const senzaCommenti = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const overview = senzaCommenti(readFileSync(join(root, 'src/features/dashboard/useOverview.ts'), 'utf8'));
  const servizio = senzaCommenti(readFileSync(join(root, 'src/services/incentivesService.ts'), 'utf8'));

  // Il corpo di un metodo del servizio, dalla firma alla chiusura del membro.
  const corpoServizio = (nome: string) => {
    const i = servizio.indexOf(`async ${nome}(`);
    if (i < 0) return null;
    const j = servizio.indexOf('\n  },', i);
    return j < 0 ? servizio.slice(i) : servizio.slice(i, j);
  };
  // Può rifiutare? Non lo dice il TIPO — `summary` è dichiarata
  // `Promise<IncentiveSummary | null>` e lancia lo stesso — lo dice il corpo.
  const puoLanciare = (nome: string) => {
    const c = corpoServizio(nome);
    return c === null ? null : /\bfail\(|\bthrow\b/.test(c);
  };

  // Ogni lettura degli incentivi che la Panoramica fa, con o senza `.catch`.
  const chiamate = [...overview.matchAll(/incentivesService\.(\w+)\([^\n]*/g)]
    .map((m) => ({ nome: m[1], riga: m[0], avvolta: /\.catch\(/.test(m[0]) }));
  check('le letture degli incentivi della Panoramica si trovano nel sorgente',
    chiamate.length >= 3, `trovate: ${chiamate.map((c) => c.nome).join(', ') || 'nessuna'}`);

  const scoperte = chiamate.filter((c) => puoLanciare(c.nome) === true && !c.avvolta);
  check('nessuna lettura che può rifiutare è lasciata scoperta dentro la Promise.all',
    scoperte.length === 0,
    scoperte.map((c) => `${c.nome} lancia e non è avvolta`).join('; '));

  const ignote = chiamate.filter((c) => puoLanciare(c.nome) === null);
  check('e ogni metodo chiamato si è potuto ritrovare nel servizio',
    ignote.length === 0, ignote.map((c) => c.nome).join(', '));

  // CONTROPROVE: il lettore deve saper distinguere le due specie, o direbbe
  // «tutto a posto» anche su un servizio che lancia dappertutto.
  check('CONTROPROVA: il lettore vede che summary PUÒ lanciare',
    puoLanciare('summary') === true);
  check('CONTROPROVA: e che catalogState e assessmentCount NO',
    puoLanciare('catalogState') === false && puoLanciare('assessmentCount') === false);
  check('e summary è quella avvolta dal .catch nella Panoramica',
    chiamate.some((c) => c.nome === 'summary' && c.avvolta));

  // Il ramo che il lancio teneva irraggiungibile esiste, è tradotto, ed è reso.
  const pagina = readFileSync(join(root, 'src/features/dashboard/HomePage.tsx'), 'utf8');
  check('la Panoramica rende home.summaryUnknown quando i numeri non ci sono',
    pagina.includes('home.summaryUnknown'));
  for (const { lang, d } of [{ lang: 'it', d: it.home }, { lang: 'de', d: de.home }, { lang: 'fr', d: fr.home }]) {
    check(`${lang}: home.summaryUnknown esiste`,
      typeof d.summaryUnknown === 'string' && d.summaryUnknown.trim().length > 0);
  }
}

// ---------------------------------------------------------------------------
section('22. Una data pura si formatta al suo giorno, in qualunque fuso');
// ⚠️⚠️ L'ULTIMO RESIDUO DELLA FAMIGLIA CHIUSA IL 2026-08-19. `new Date(
// '2026-08-20')` è mezzanotte UTC, e `toLocaleDateString` la rilegge nel fuso
// di chi guarda: a ovest di Greenwich la data mostrata scalava di un giorno.
// In Svizzera non si vede — è il motivo per cui è rimasto — ed è esercitato dal
// codice nuovo della Panoramica, che formatta `dueDate` e `appointmentDate`,
// due colonne `date`.
// ⚠️ Lo schema del fuso è quello della sezione 17: salva, imposta, e `finally`
// ripristina — le sezioni che seguono non ereditano un ambiente piegato.

{
  const tzOriginale = process.env.TZ;
  const rendi = (tz: string, valore: string) => { process.env.TZ = tz; return formatDate(valore); };
  try {
    // La CONTROPROVA prima di tutto: se il fuso non morde in questo processo,
    // le prove qui sotto sarebbero verdi senza provare niente.
    process.env.TZ = 'America/Los_Angeles';
    check('CONTROPROVA: il fuso simulato morde davvero, e la costruzione ingenua sbaglia',
      new Date().getTimezoneOffset() > 0 && new Date('2026-08-20').getDate() === 19,
      `offset=${new Date().getTimezoneOffset()} giorno=${new Date('2026-08-20').getDate()}`);

    const ovest = rendi('America/Los_Angeles', '2026-08-20');
    const est = rendi('Europe/Zurich', '2026-08-20');
    const estremo = rendi('Pacific/Kiritimati', '2026-08-20');
    check('la stessa data pura dà lo stesso giorno a UTC-7, a UTC+2 e a UTC+14',
      ovest === est && est === estremo, `${ovest} · ${est} · ${estremo}`);
    check('ed è il giorno scritto nel dato, non quello accanto',
      est === '20.08.2026', est);

    // Un ISTANTE non si tocca: convertirlo al giorno di chi guarda è giusto, e
    // una correzione che lo appiattisse sarebbe il difetto opposto.
    process.env.TZ = 'America/Los_Angeles';
    check('un istante completo resta un istante: a UTC-7 le 01:00 UTC sono il giorno prima',
      formatDate('2026-08-20T01:00:00Z') === '19.08.2026',
      formatDate('2026-08-20T01:00:00Z'));

    // Una data che non esiste non diventa una data plausibile: `new Date(2026,
    // 1, 31)` traboccherebbe al 3 marzo.
    process.env.TZ = 'Europe/Zurich';
    check('il 31 febbraio non diventa il 3 marzo: resta illeggibile',
      formatDate('2026-02-31') === '—', formatDate('2026-02-31'));
    check('e un valore assente o illeggibile resta «—»',
      formatDate(null) === '—' && formatDate('non-una-data') === '—');

    // Una data pura NON ha un'ora, e `formatDateTime` non ne inventa una.
    check('formatDateTime su una data pura mostra il giorno, senza un orario inventato',
      formatDateTime('2026-08-20') === '20.08.2026', formatDateTime('2026-08-20'));
    check('mentre su un istante continua a dare data E ora',
      /^\d{2}\.\d{2}\.\d{4},? \d{2}:\d{2}$/.test(formatDateTime('2026-08-20T12:34:00Z')),
      formatDateTime('2026-08-20T12:34:00Z'));
  } finally {
    if (tzOriginale === undefined) delete process.env.TZ; else process.env.TZ = tzOriginale;
  }

  // ⚠️ NESSUNA QUINTA COPIA DELLA REGEX. Il riconoscitore sta in
  // `calendarDays`, il modulo nato per questo difetto: `format.ts` lo importa
  // invece di riscriverselo, come già fanno i tre punti della sezione 17.
  const fmt = readFileSync(join(root, 'src/lib/format.ts'), 'utf8');
  check('format.ts non si è riscritto il riconoscitore in casa',
    /from '\.\/calendarDays'/.test(fmt) && !/\\d\{4\}/.test(fmt.replace(/\/\*[\s\S]*?\*\//g, '')),
    'la data pura ha già quattro regex in linea nel frontend: questa sarebbe la quinta');
}

// ---------------------------------------------------------------------------
section('23. Una sola aritmetica dei giorni — nessuna copia che divida istanti');

// ⚠️⚠️ PERCHÉ ESISTE, e non è la sezione 17 con altre parole. La 17 prova che
// TRE punti d'ingresso noti diano lo stesso numero. Non poteva vedere una
// QUARTA copia scritta altrove — e il 2026-08-24 il censimento ne ha trovate
// altre quattro, tre delle quali sbagliate nello stesso identico modo:
//
//   ❌ daysUntil     src/lib/format.ts            → Inbox: urgenza e filtro
//   ❌ daysUntil     features/admin-ai/engine.ts  → conteggi dell'archivio
//   ❌ daysUntilMs   _shared/automation/facts.ts  → inneschi delle Automazioni
//   ❌ priorityFromDueDate  features/tasks/taskFormat.ts  → priorità SCRITTA nel dato
//
// L'ultima stava nel file che RI-ESPORTA la funzione giusta: avere la risposta
// corretta a portata di mano non serve a niente finché nessuno la chiama.
//
// ⚠️ E il server si era allineato ALLA COPIA SBAGLIATA di proposito — c'era
// scritto: «così è nel motore locale, allinearsi a una versione migliore
// significherebbe divergere». La coerenza con un riferimento non misurato è il
// modo in cui un difetto si moltiplica invece di restare uno.
//
// LA REGOLA CHE QUESTA SEZIONE APPLICA, e si deriva dal SORGENTE:
// ogni divisione per 86'400'000 deve stare in una funzione che prima NORMALIZZA
// a mezzanotte (`Date.UTC(` oppure `T00:00:00`). Dividere due istanti grezzi
// per rispondere a una domanda di calendario è il difetto, sempre.
//
// ⚠️ LE ECCEZIONI SI CONTROLLANO NEI DUE VERSI, come in `design:lint`: una voce
// rimasta senza il suo sito fa fallire quanto un sito senza voce. Un'esenzione
// sopravvissuta a ciò che esentava è una porta lasciata aperta.
{
  /** Dove la domanda NON è di calendario, e dividere istanti è giusto. */
  const ECCEZIONI: Record<string, string> = {
    'src/features/incentives/reviewModel.ts': 
      'waitingDays misura il tempo TRASCORSO da un `created_at` (timestamptz, un istante): «da quanto aspetta» è una durata, non un giorno di calendario',
  };

  /** Commenti sostituiti da spazi: le righe restano, il testo no. Una guardia
   *  che leggesse i commenti nascerebbe rossa per le spiegazioni qui sopra. */
  const senzaCommenti = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, (m, pre) =>
      (pre ?? '') + m.slice((pre ?? '').length).replace(/[^\n]/g, ' '));

  const sorgenti: string[] = [];
  const cammina = (dir: string) => {
    for (const voce of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${voce.name}`;
      if (voce.isDirectory()) { cammina(rel); continue; }
      if (/\.(ts|tsx)$/.test(voce.name)) sorgenti.push(rel);
    }
  };
  cammina('src');
  cammina('supabase/functions');

  check('il censimento guarda un perimetro vero, non una cartella vuota',
    sorgenti.length > 100, `${sorgenti.length} file`);

  const scoperte: string[] = [];
  const usate = new Set<string>();

  for (const rel of sorgenti) {
    const testo = senzaCommenti(readFileSync(join(root, rel), 'utf8'));
    const righe = testo.split('\n');
    for (let i = 0; i < righe.length; i++) {
      if (!/\/\s*86[_ ]?400[_ ]?000/.test(righe[i]!)) continue;
      // Il corpo della funzione che contiene la divisione: dal precedente
      // inizio di dichiarazione a colonna zero, al successivo.
      const confine = /^(export\s+)?(async\s+)?(function|const|class)\s/;
      let da = i; while (da > 0 && !confine.test(righe[da]!)) da--;
      let a = i + 1; while (a < righe.length && !confine.test(righe[a]!)) a++;
      const corpo = righe.slice(da, a).join('\n');
      const normalizza = /Date\.UTC\(/.test(corpo) || /T00:00:00/.test(corpo);
      if (normalizza) continue;
      if (ECCEZIONI[rel]) { usate.add(rel); continue; }
      scoperte.push(`${rel}:${i + 1}  ${righe[i]!.trim()}`);
    }
  }

  check('nessuna funzione divide due istanti grezzi per contare giorni',
    scoperte.length === 0, scoperte.join('\n     '));

  const orfane = Object.keys(ECCEZIONI).filter((k) => !usate.has(k));
  check('nessuna eccezione dichiarata è rimasta senza il suo sito',
    orfane.length === 0, orfane.join(', '));

  // ⚠️ E la funzione canonica è UNA SOLA. Non si conta un elenco scritto qui:
  // si chiede al sorgente quanti file la DEFINISCONO (non la importano).
  const definizioni = sorgenti.filter((rel) =>
    /export function calendarDaysUntil\s*\(/.test(senzaCommenti(readFileSync(join(root, rel), 'utf8'))));
  check('`calendarDaysUntil` è definita in un posto solo',
    definizioni.length === 1, definizioni.join(', '));
  check('e quel posto è `_shared`, raggiungibile dai due runtime',
    definizioni[0] === 'supabase/functions/_shared/calendarDays.ts', String(definizioni[0]));
}

// ---------------------------------------------------------------------------
const total = pass + fail;
console.log(`\n${B}ESITO${X}: ${fail === 0 ? `${G}verde${X}` : `${R}rosso${X}`} — ${pass}/${total} passi`);
process.exit(fail === 0 ? 0 : 1);
