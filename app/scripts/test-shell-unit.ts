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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ICONS } from '../src/components/ui/Icon.tsx';
import { dividiMarchio } from '../src/components/ui/BrandMark.tsx';
import { LOCALES } from '../src/i18n/index.tsx';
import { it } from '../src/i18n/locales/it.ts';
import { de } from '../src/i18n/locales/de.ts';
import { fr } from '../src/i18n/locales/fr.ts';
import { NAV, NAV_SETTINGS, isSection, navItemMatches, type NavItem } from '../src/components/layout/nav.ts';
import { GLYPH_NAMES, type MarkGlyphName } from '../src/components/ui/MarkGlyph.tsx';
import { PROVENANCE_KINDS } from '../src/components/ui/ProvenanceMark.tsx';
import { CONFIDENCE_LEVELS } from '../src/components/ui/ConfidenceBadge.tsx';
import { ELIGIBILITY_STATES } from '../src/components/ui/EligibilityMark.tsx';
import { SOURCE_STATES } from '../src/components/ui/SourceStamp.tsx';
import { DEADLINE_STATES, deadlineState } from '../src/components/ui/DeadlineMark.tsx';
import { TASK_STATES } from '../src/components/ui/StatusMark.tsx';
import { PRIORITY_LEVELS } from '../src/components/ui/PriorityMark.tsx';
import { WINDOW_STATES } from '../src/components/ui/WindowMark.tsx';

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
  check(`la sigla è --on-accent`, svg.includes(`fill='${onAccent}'`), `atteso fill='${onAccent}'`);
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
    'il marchio sta in BrandMark.tsx e si compone in Inter: un\'icona «logo» è la porta da cui rientra come pulsante',
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

  const settingsShape = NAV_SETTINGS.map((s) => s.id);
  check(
    'Impostazioni raccoglie azienda · automazioni · registro · abbonamento',
    JSON.stringify(settingsShape) === JSON.stringify(['company', 'automations', 'audit', 'pricing']),
    `trovato ${settingsShape.join(' · ')}`,
  );
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
  for (const [lang, dict] of [['it', it], ['de', de], ['fr', fr]] as const) {
    const labels = [
      ...items.map((i) => (dict.nav as Record<string, string>)[i.labelKey.replace('nav.', '')]),
      ...NAV_SETTINGS.map((s) => (dict.nav as Record<string, string>)[s.labelKey.replace('nav.', '')]),
      (dict.nav as Record<string, string>).settings,
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
  for (const classe of ['.prose', '.page-desc', '.greeting-sub', '.footnote', '.legal-note', '.hero p']) {
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
    .filter((f) => f.nome !== 'DEADLINE_STATES') // il termine è reso con esempi numerici, non iterando
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
      if (!/badge-(alta|media|bassa)/.test(src)) continue;
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
const total = pass + fail;
console.log(`\n${B}ESITO${X}: ${fail === 0 ? `${G}verde${X}` : `${R}rosso${X}`} — ${pass}/${total} passi`);
process.exit(fail === 0 ? 0 : 1);
