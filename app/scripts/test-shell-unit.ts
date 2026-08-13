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
import { NAV, NAV_SETTINGS, isSection, navItemMatches, type NavItem } from '../src/components/layout/nav.ts';

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
const total = pass + fail;
console.log(`\n${B}ESITO${X}: ${fail === 0 ? `${G}verde${X}` : `${R}rosso${X}`} — ${pass}/${total} passi`);
process.exit(fail === 0 ? 0 : 1);
