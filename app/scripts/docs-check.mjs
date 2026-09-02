#!/usr/bin/env node
// ============================================================================
// docs:check — la documentazione descrive il codice che c'è davvero?
//
// ⚠️ PERCHÉ ESISTE. Il 2026-07-27 il README della radice è stato riscritto come
// indice, proprio perché un fatto raccontato in due posti diverge. Due giorni
// dopo divergeva di nuovo: mancavano Finanze, tre migrazioni e due documenti.
// La disciplina non ha funzionato, e non funzionerà — perché non è un problema
// di disciplina. **Una lista scritta a mano che descrive il contenuto di una
// cartella invecchia da sola al primo commit che non la aggiorna.**
//
// Questo progetto ha già l'idioma giusto e lo usa in tre posti: `db:bundle
// --check`, `i18n:coverage --self-test` e la 0014 che si autoverifica in
// migrazione. Un controllo che fallisce vale più di una regola che si spera
// venga rispettata. Questo è il quarto.
//
// COSA VERIFICA
//   1. MODULI      ogni cartella di src/features/ è dichiarata, e ogni modulo
//                  descritto nel README ha la sua cartella.
//   2. MIGRAZIONI  ogni file di supabase/migrations/ compare nei README.
//   3. DOCUMENTI   ogni file di docs/ è raggiungibile da un collegamento, e
//                  ogni collegamento punta a un file che esiste.
//   4. COMANDI     ogni script di package.json è documentato, e ogni comando
//                  documentato esiste davvero.
//   5. FUNZIONI    ogni Edge Function è elencata nella struttura.
//
// COSA NON FA, DI PROPOSITO
//   · non corregge niente. La prosa attorno agli elenchi la scrive una persona,
//     e rigenerarla trasformerebbe un controllo in un generatore di testo che
//     nessuno rilegge più;
//   · non giudica se una descrizione sia BUONA: sa solo se la cosa descritta
//     esiste. Un modulo descritto male ma esistente passa — ed è giusto così,
//     perché un controllo che pretende di valutare la prosa produce falsi
//     allarmi finché qualcuno lo spegne.
//
//   node scripts/docs-check.mjs [--self-test]
// ============================================================================
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const ROOT = resolve(APP, '..');

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';

// ---------------------------------------------------------------------------
// LA MAPPA — ed è il cuore del controllo, non un dettaglio di configurazione.
//
// ⚠️ Ogni cartella di `src/features/` deve comparire qui. Aggiungerne una senza
// dichiararla FA FALLIRE il controllo, ed è esattamente il caso che si vuole
// intercettare: il modulo Contratti è vissuto per ore in `src/features/` senza
// che un solo README lo nominasse, mentre la vetrina lo prometteva ai clienti.
//
// `moduleName` è il nome con cui il README della radice chiama il modulo nella
// tabella «I moduli». `null` significa: questa cartella NON è un modulo di
// prodotto, e la ragione è scritta accanto — così la scelta resta leggibile
// invece di essere un'omissione che sembra una dimenticanza.
// ---------------------------------------------------------------------------
const FEATURES = {
  'admin-ai':    { moduleName: 'Admin AI' },
  'inbox':       { moduleName: 'Inbox' },
  'tasks':       { moduleName: 'Attività' },
  'documents':   { moduleName: 'Documenti' },
  'calendar':    { moduleName: 'Calendario e notifiche' },
  'automations': { moduleName: 'Automazioni' },
  'finance':     { moduleName: 'Finanze' },
  'contracts':   { moduleName: 'Contratti' },
  'crm':         { moduleName: 'Clienti' },
  'assistant':   { moduleName: 'Chiedi ad AI-Swisse' },
  // Non sono moduli: sono parti dell'impalcatura, e nessun cliente le sceglie.
  'auth':          { moduleName: null, why: 'accesso e registrazione, non un modulo' },
  'companies':     { moduleName: null, why: 'onboarding e impostazioni azienda' },
  'dashboard':     { moduleName: null, why: 'la Panoramica: mostra i moduli, non è un modulo' },
  'notifications': { moduleName: null, why: 'la campanella, parte di «Calendario e notifiche»' },
  'pricing':       { moduleName: null, why: 'pagina commerciale' },
  // La finestra delle impostazioni non è un modulo: è il CONTENITORE in cui i
  // moduli di configurazione degli altri si vanno a scegliere — preferenze,
  // azienda, abbonamento. Non possiede un dato suo e nessun cliente la
  // sceglie: ci si arriva dal piede della barra.
  'settings':      { moduleName: null, why: 'la finestra che raccoglie le impostazioni degli altri, non un modulo' },
  // Il Registro attività (0039) NON è un modulo di prodotto: è come l'azienda
  // si guarda da fuori — una schermata sola, riservata a titolari e
  // amministratori, che indicizza i fatti degli altri moduli senza possederne
  // nessuno. Sta nel menu accanto a «Impostazioni azienda» per la stessa ragione.
  'audit':         { moduleName: null, why: 'registro trasversale, non un modulo: indicizza i fatti degli altri' },
  // La stampa non è un modulo e non è una schermata: è una VISTA degli altri —
  // la versione su carta dell'analisi, del contratto e del verdetto d'idoneità.
  // Non ha una rotta propria e nessun cliente la sceglie: la si raggiunge dalle
  // pagine che stampa.
  'print':         { moduleName: null, why: 'vista di stampa degli altri moduli, non una schermata propria' },
};

/** Le Edge Function di servizio, che la struttura non elenca una per una. */
const FUNCTION_EXCEPTIONS = new Set(['_shared']);

// ---------------------------------------------------------------------------

function read(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function listDirs(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function listFiles(path, ext) {
  if (!existsSync(path)) return [];
  return readdirSync(path).filter((f) => f.endsWith(ext)).sort();
}

/**
 * Come `listFiles`, ma DENTRO le sottocartelle, con percorsi relativi
 * (`archivio/vecchio.md`).
 *
 * ⚠️ Fino al 2026-08-13 la scansione di `docs/` era piatta: un documento
 * dentro una sottocartella non risultava mai orfano e il suo testo non veniva
 * letto dai controlli sulle contraddizioni — invisibile due volte, e la prova
 * l'ha data un file vero: `docs/archivio/prova-cecita.md`, orfano, usciva 0.
 */
function listFilesDeep(path, ext, prefix = '') {
  if (!existsSync(path)) return [];
  const out = [];
  for (const e of readdirSync(path, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...listFilesDeep(join(path, e.name), ext, `${prefix}${e.name}/`));
    else if (e.name.endsWith(ext)) out.push(`${prefix}${e.name}`);
  }
  return out.sort();
}

/** Le cartelle del perimetro che NON esistono: chi le riceve deve fermarsi. */
export function perimetroMancante(cartelle) {
  return cartelle.filter((c) => !c.esiste).map((c) => c.nome);
}

/**
 * I problemi trovati. Ognuno dice COSA manca e DOVE, mai solo «non allineato»:
 * un messaggio che non indica il file da aprire fa perdere il tempo che voleva
 * risparmiare.
 */
class Report {
  constructor() { this.problems = []; }
  add(area, what, where, hint) { this.problems.push({ area, what, where, hint }); }
  get ok() { return this.problems.length === 0; }
}

// ---------------------------------------------------------------------------
// I cinque controlli. Ognuno è una funzione pura su TESTI e ELENCHI, così il
// `--self-test` può passargli contenuti costruiti apposta invece di scrivere
// file finti sul disco.
// ---------------------------------------------------------------------------

/**
 * 0. L'ESITO — e sta fra i controlli, non in fondo al file, perché è la parte
 * che ha mentito.
 *
 * Fino al 2026-08-03 questa decisione viveva dentro una catena di `if` in coda
 * allo script: nessuno poteva provarla, e infatti sbagliava. Con il README della
 * radice assente stampava «Nessuna divergenza» e usciva ZERO, mentre due dei
 * cinque controlli non erano stati eseguiti.
 *
 * `codice`: 0 verde · 1 divergenze · 3 non si è potuto rispondere.
 */
export function esitoFinale({ ok, rootMissing, allowPartial }) {
  if (!ok) return { codice: 1, stato: 'divergenze' };
  if (rootMissing && !allowPartial) return { codice: 3, stato: 'parziale' };
  return { codice: 0, stato: rootMissing ? 'parziale-accettato' : 'completo' };
}

/** 1. MODULI — il controllo che avrebbe intercettato i Contratti. */
export function checkModules(report, { featureDirs, rootReadme, map }) {
  for (const dir of featureDirs) {
    const known = map[dir];
    if (!known) {
      report.add('moduli', `la cartella «${dir}» non è dichiarata`,
        'scripts/docs-check.mjs → FEATURES',
        'aggiungila alla mappa: con un `moduleName` se è un modulo di prodotto, '
        + 'con `moduleName: null` e una ragione se non lo è');
      continue;
    }
    if (known.moduleName && rootReadme !== null
        && !rootReadme.includes(`**${known.moduleName}**`)) {
      report.add('moduli', `il modulo «${known.moduleName}» esiste in src/features/${dir}/ ma non è descritto`,
        'README.md → sezione «I moduli»',
        'aggiungi una riga alla tabella dei moduli');
    }
  }

  // …e al contrario: un modulo descritto e assente dal codice è la stessa bugia
  // vista dall'altro lato — è ciò che la vetrina ha fatto con i Contratti.
  if (rootReadme !== null) {
    for (const [dir, { moduleName }] of Object.entries(map)) {
      if (!moduleName) continue;
      if (rootReadme.includes(`**${moduleName}**`) && !featureDirs.includes(dir)) {
        report.add('moduli', `il README descrive «${moduleName}», ma src/features/${dir}/ non esiste`,
          'README.md → sezione «I moduli»',
          'o il modulo è stato rimosso, o la cartella si chiama diversamente');
      }
    }
  }
}

/** 2. MIGRAZIONI — ogni file citato almeno una volta. */
export function checkMigrations(report, { migrations, texts }) {
  for (const file of migrations) {
    const bare = file.replace(/\.sql$/, '');
    const number = bare.slice(0, 4);
    // Basta il NUMERO: i README parlano di «migrazione 0021» più spesso che del
    // nome del file, e pretendere il nome completo produrrebbe falsi allarmi.
    const cited = texts.some((t) => t.includes(bare) || t.includes(number));
    if (!cited) {
      report.add('migrazioni', `la migrazione ${file} non è citata da nessun README`,
        'README.md oppure app/README.md → sezione «Database» / «Struttura»',
        'una migrazione che nessun documento nomina è una modifica al database '
        + 'di cui nessuno saprà la ragione');
    }
  }
}

/** 3. DOCUMENTI — nei due sensi: orfani e collegamenti rotti. */
export function checkDocs(report, { docFiles, links, docsExist }) {
  for (const file of docFiles) {
    const linked = links.some((l) => l.endsWith(`docs/${file}`));
    if (!linked) {
      report.add('documenti', `docs/${file} non è raggiungibile da nessun collegamento`,
        'README.md → «Dove sta la documentazione»',
        'un documento che nessun indice nomina non lo apre nessuno');
    }
  }
  for (const link of links) {
    if (!docsExist(link)) {
      report.add('documenti', `il collegamento a «${link}» punta a un file che non esiste`,
        'README.md oppure app/README.md',
        'correggi il percorso o rimuovi il collegamento');
    }
  }
}

/** 4. COMANDI — nei due sensi. */
export function checkCommands(report, { scripts, commandsSection, ignore = [] }) {
  for (const name of scripts) {
    if (ignore.includes(name)) continue;
    if (!commandsSection.includes(`npm run ${name}`)) {
      report.add('comandi', `lo script «${name}» non è documentato`,
        'app/README.md → sezione «Comandi»',
        'un comando che esiste e non è scritto da nessuna parte è un comando '
        + 'che nessuno userà');
    }
  }
  const documented = [...commandsSection.matchAll(/npm run ([a-z0-9:-]+)/g)].map((m) => m[1]);
  for (const name of new Set(documented)) {
    if (!scripts.includes(name)) {
      report.add('comandi', `il README documenta «npm run ${name}», che in package.json non esiste`,
        'app/README.md → sezione «Comandi»',
        'chi lo prova ottiene un errore e perde fiducia in tutto il resto');
    }
  }
}

// ---------------------------------------------------------------------------
// I controlli 6, 7 e 8 — aggiunti il 2026-07-31.
//
// ⚠️ I primi cinque verificano che le cose DESCRITTE esistano. Non vedono la
// classe di bugia più cara: un'AFFERMAZIONE DI STATO falsa. Il README della
// radice diceva `/automazioni` pubblicata e `app/README.md` diceva che esisteva
// «solo in locale»; una delle due era falsa da settimane, e tutti e cinque i
// controlli restavano verdi perché la cartella, la migrazione e i comandi
// c'erano tutti.
//
// La cura NON è un parser semantico: è una FONTE UNICA. `docs/product-status.md`
// dichiara lo stato di ogni modulo in una tabella, e questi tre controlli
// verificano che nessun altro documento la contraddica.
// ---------------------------------------------------------------------------

/** Le parole con cui un documento nega che qualcosa sia pubblicato. */
export const FRASI_NON_PUBBLICATO = [
  'non è ancora pubblicat', 'non ancora pubblicat', 'non è pubblicat',
  'esiste solo in locale', 'solo in locale',
];

/** Legge la tabella dei moduli da `product-status.md`. */
export function leggiStato(testo) {
  const sezione = /## I moduli\n([\s\S]*?)(?=\n## )/.exec(testo);
  if (!sezione) return [];
  return sezione[1].split('\n')
    .filter((r) => r.trim().startsWith('|'))
    .map((r) => r.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((c) => c.length >= 8 && !/^-+$/.test(c[0]) && c[0] !== 'Modulo')
    .map((c) => ({
      nome: c[0],
      rotta: c[1].replace(/`/g, ''),
      // ⚠️ Il grassetto si toglie: chi scrive la tabella metterà in evidenza
      // proprio i **no** che contano, e un controllo che li rifiuta per la
      // formattazione insegna a non evidenziarli più.
      stati: c.slice(2, 8).map((s) => s.replace(/[*_`]/g, '').trim()),
    }));
}

/** 6. La tabella dello stato copre esattamente i moduli di prodotto. */
export function checkStatusTable(report, { righe, map }) {
  const VOCABOLARIO = new Set(['sì', 'no', 'parziale', '—']);
  const attesi = Object.values(map).filter((m) => m.moduleName).map((m) => m.moduleName);
  const presenti = righe.map((r) => r.nome);

  for (const nome of attesi) {
    if (!presenti.includes(nome)) {
      report.add('stato', `il modulo «${nome}» non ha una riga in product-status.md`,
        'docs/product-status.md → «I moduli»',
        'un modulo il cui stato non è dichiarato da nessuna parte verrà '
        + 'descritto a memoria, e la memoria invecchia');
    }
  }
  for (const r of righe) {
    if (!attesi.includes(r.nome)) {
      report.add('stato', `product-status.md dichiara «${r.nome}», che non è un modulo di prodotto`,
        'docs/product-status.md', 'o il nome è sbagliato, o va aggiunto a FEATURES');
    }
    for (const s of r.stati) {
      if (!VOCABOLARIO.has(s)) {
        report.add('stato', `il modulo «${r.nome}» ha lo stato «${s}», che non è del vocabolario`,
          'docs/product-status.md',
          `i valori ammessi sono: ${[...VOCABOLARIO].join(', ')} — «quasi» e `
          + '«in corso» sono i modi in cui una tabella smette di dire qualcosa');
      }
    }
  }
}

/** 7. Le rotte dichiarate esistono nel router. */
export function checkRoutes(report, { rotte, router }) {
  for (const r of rotte) {
    if (!r || r === '—') continue;
    if (!router.includes(`path="${r}"`)) {
      report.add('rotte', `la rotta «${r}» è dichiarata ma non esiste nel router`,
        'docs/product-status.md ↔ src/App.tsx',
        'chi la incolla in un browser finisce sulla Panoramica, e nessun test lo vede');
    }
  }
}

/** 8. Nessun documento nega ciò che la tabella dichiara. */
export function checkStatusContradictions(report, { moduli, testi }) {
  // ⚠️ Il grassetto va tolto PRIMA di cercare. `docs/crm-light.md` scriveva
  // «Il modulo non è ancora **pubblicato**», e la prima versione di questo
  // controllo non lo vedeva: gli asterischi cadevano in mezzo alla frase. È
  // esattamente la forma del difetto di `i18n:coverage`, che cercava parole
  // al singolare mentre le etichette erano al plurale — un controllo che
  // guarda dove è comodo invece che dove sta il testo.
  const pulisci = (s) => s.replace(/[*_`]/g, '').toLowerCase();

  for (const { file, testo } of testi) {
    const righe = testo.split('\n');
    righe.forEach((riga, i) => {
      const bassa = pulisci(riga);
      if (!FRASI_NON_PUBBLICATO.some((f) => bassa.includes(f))) return;
      // Le frasi si spezzano a capo: si guarda un intorno, non la sola riga.
      const contesto = pulisci(righe.slice(Math.max(0, i - 2), i + 3).join(' '));
      for (const m of moduli) {
        // Oltre al nome della tabella e alla rotta si accettano gli ALIAS —
        // la cartella di `src/features/`. `docs/crm-light.md` chiama «CRM» il
        // modulo che la tabella chiama «Clienti», e senza questo la
        // contraddizione più vecchia del repository sarebbe rimasta invisibile.
        const nomi = [m.nome, m.rotta, ...(m.alias ?? [])].map((s) => s.toLowerCase());
        if (!nomi.some((n) => n && contesto.includes(n))) continue;
        report.add('stato',
          `«${file}» dice che «${m.nome}» (${m.rotta}) non è pubblicato, mentre product-status.md lo dichiara`,
          `${file}:${i + 1}`,
          'una delle due è falsa. Lo stato si dichiara in product-status.md e '
          + 'in nessun altro posto: qui va tolta la frase, non aggiornata');
      }
    });
  }
}

/** 5. EDGE FUNCTION — ogni funzione deployabile è elencata. */
export function checkFunctions(report, { functionDirs, texts }) {
  for (const dir of functionDirs) {
    if (FUNCTION_EXCEPTIONS.has(dir)) continue;
    if (!texts.some((t) => t.includes(dir))) {
      report.add('funzioni', `la Edge Function «${dir}» non è elencata`,
        'app/README.md → sezione «Struttura»',
        'una funzione che nessuno sa che esiste non verrà rideployata quando '
        + 'cambia il codice condiviso che usa');
    }
  }
}

// ---------------------------------------------------------------------------
// La scansione vera
// ---------------------------------------------------------------------------

function scan() {
  const report = new Report();

  // ⚠️ IL PERIMETRO, PRIMA DI TUTTO. `readdirSync` su una cartella assente
  // tornava [] e la scansione proseguiva su zero elementi: un perimetro
  // inesistente dava «zero divergenze» — un verde detto di un posto che non
  // era stato guardato. Una cartella del perimetro che manca non è un caso da
  // zero problemi: è la domanda posta male, e si esce 2.
  const perimetro = [
    ['src/features', join(APP, 'src', 'features')],
    ['supabase/migrations', join(APP, 'supabase', 'migrations')],
    ['supabase/functions', join(APP, 'supabase', 'functions')],
    ['docs', join(APP, 'docs')],
  ].map(([nome, path]) => ({ nome, esiste: existsSync(path) }));
  const mancanti = perimetroMancante(perimetro);
  if (mancanti.length) {
    console.error(`${R}Perimetro non trovato in ${APP}: ${mancanti.join(', ')}.${X}`);
    console.error(`${DIM}Zero file in una cartella assente non è «zero divergenze»: la scansione non parte.${X}`);
    process.exit(2);
  }

  const appReadme = read(join(APP, 'README.md'));
  // ⚠️ Il README della RADICE vive nel monorepo, un livello sopra l'app. Quando
  // si lavora nella directory di sviluppo (`~/swiss-ai-suite-app`) non c'è, e
  // il controllo lo DICHIARA invece di saltarlo in silenzio: un controllo che
  // verifica meno di quanto sembra è il difetto che questo progetto ha già
  // pagato due volte.
  // ⚠️ `--root <percorso>` esiste perché la directory di sviluppo NON è il
  // monorepo: `~/swiss-ai-suite-app` è una copia di `app/`, e il README della
  // radice vive in `~/swiss-ai-suite-repo`. Senza questa opzione l'unico modo di
  // eseguire il controllo COMPLETO era cambiare cartella — e chi non lo faceva
  // otteneva mezzo controllo. Il percorso si INDICA, non si indovina: cercarlo
  // da soli in giro per il disco significherebbe verificare un file che non si
  // sa quale sia.
  const rootFlag = process.argv.indexOf('--root');
  const rootArg = rootFlag >= 0 ? process.argv[rootFlag + 1] : null;
  // ⚠️ Un `--root` indicato e inesistente è un refuso di chi invoca, non un
  // «parziale»: rispondere PARZIALE a un percorso sbagliato direbbe che la
  // radice non c'era, mentre c'era — altrove.
  if (rootFlag >= 0 && (!rootArg || !existsSync(resolve(rootArg)))) {
    console.error(`${R}--root ${rootArg ?? '(vuoto)'} non esiste: indica il monorepo, o ometti l'opzione.${X}`);
    process.exit(2);
  }
  const rootDir = rootArg ? resolve(rootArg) : ROOT;
  const rootReadme = read(join(rootDir, 'README.md'));
  const rootMissing = rootReadme === null;

  if (appReadme === null) {
    console.error(`${R}app/README.md non trovato: non c'è niente da confrontare.${X}`);
    process.exit(2);
  }

  const texts = [appReadme, rootReadme].filter((t) => t !== null);

  checkModules(report, {
    featureDirs: listDirs(join(APP, 'src', 'features')),
    rootReadme, map: FEATURES,
  });

  checkMigrations(report, {
    migrations: listFiles(join(APP, 'supabase', 'migrations'), '.sql'), texts,
  });

  // ⚠️ Ricorsiva, e la regex dei collegamenti ammette il separatore: un
  // documento in `docs/archivio/` va visto sia come file sia come destinazione.
  const docFiles = listFilesDeep(join(APP, 'docs'), '.md');
  const links = [...texts.join('\n').matchAll(/\(([^)]*docs\/[a-z0-9/-]+\.md)\)/g)]
    .map((m) => m[1]);
  checkDocs(report, {
    docFiles, links,
    docsExist: (link) => {
      const name = link.split('docs/').pop();
      return existsSync(join(APP, 'docs', name));
    },
  });

  const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
  const commandsMatch = /## Comandi\n([\s\S]*?)(?=\n## )/.exec(appReadme);
  checkCommands(report, {
    scripts: Object.keys(pkg.scripts ?? {}),
    commandsSection: commandsMatch ? commandsMatch[1] : '',
    // `dev`, `build`, `preview` e `typecheck` sono nel setup, non nell'elenco
    // dei comandi: cercarli là produrrebbe un allarme su una scelta voluta.
    ignore: ['dev', 'build', 'preview', 'typecheck'],
  });

  checkFunctions(report, {
    functionDirs: listDirs(join(APP, 'supabase', 'functions')), texts,
  });

  // --- 6, 7 e 8: la fonte unica dello stato -------------------------------
  // ⚠️ Questi tre NON dipendono dal README della radice: funzionano anche
  // dalla directory di sviluppo, dove i primi controlli si fermano. È voluto —
  // le contraddizioni sullo stato sono la classe che è costata di più, e un
  // controllo che le vede solo dal monorepo le vedrebbe troppo tardi.
  const statusFile = join(APP, 'docs', 'product-status.md');
  const statusRaw = read(statusFile);
  if (statusRaw === null) {
    report.add('stato', 'docs/product-status.md non esiste',
      'docs/product-status.md',
      'è la definizione autorevole dello stato dei moduli: senza, ogni '
      + 'documento torna a dichiararlo per conto proprio');
  } else {
    const righe = leggiStato(statusRaw);
    checkStatusTable(report, { righe, map: FEATURES });
    checkRoutes(report, {
      rotte: righe.map((r) => r.rotta),
      router: read(join(APP, 'src', 'App.tsx')) ?? '',
    });

    // Ogni documento del progetto, sottocartelle comprese, tranne la fonte
    // stessa (quella alla radice di docs/: un omonimo annidato non è la fonte).
    const testi = [];
    for (const f of listFilesDeep(join(APP, 'docs'), '.md')) {
      if (f === 'product-status.md') continue;
      testi.push({ file: `docs/${f}`, testo: read(join(APP, 'docs', f)) ?? '' });
    }
    testi.push({ file: 'app/README.md', testo: appReadme });
    if (rootReadme !== null) testi.push({ file: 'README.md', testo: rootReadme });

    // L'alias di un modulo è la sua cartella in `src/features/`.
    const conAlias = righe.map((r) => ({
      ...r,
      alias: Object.entries(FEATURES)
        .filter(([, v]) => v.moduleName === r.nome).map(([k]) => k),
    }));
    checkStatusContradictions(report, { moduli: conAlias, testi });
  }

  return { report, rootMissing, rootDir };
}

// ---------------------------------------------------------------------------
// AUTOVERIFICA
//
// ⚠️ UN CONTROLLO CHE DICE VERDE SEMPRE È PEGGIO DI NESSUN CONTROLLO: dà la
// falsa certezza che il lavoro sia finito. In questo progetto è già successo
// DUE volte — con `i18n:coverage`, che cercava parole italiane al singolare e
// non vedeva cento etichette al plurale, e con i permessi della 0013, che
// dichiaravano nei commenti una garanzia che non esisteva.
//
// Ogni caso qui sotto è costruito per FAR FALLIRE un controllo preciso. Se uno
// smettesse di fallire, il controllo corrispondente sarebbe morto senza che
// nessuno se ne accorgesse.
// ---------------------------------------------------------------------------
const CASES = [
  {
    name: 'una cartella non dichiarata nella mappa → problema',
    run: (r) => checkModules(r, {
      featureDirs: ['admin-ai', 'contratti-nuovi'], rootReadme: '**Admin AI**', map: FEATURES,
    }),
    expect: 1,
  },
  {
    // ⚠️ Il README di questo caso non nomina NESSUN modulo, di proposito: un
    // caso che ne nomina uno diverso ne verifica due insieme (il modulo assente
    // dal codice) e conta due problemi. Un caso di autoverifica deve provare
    // UNA cosa sola, altrimenti non si sa quale controllo ha fallito.
    name: 'un modulo dichiarato e non descritto nel README → problema',
    run: (r) => checkModules(r, {
      featureDirs: ['contracts'], rootReadme: '## I moduli\n(tabella vuota)', map: FEATURES,
    }),
    expect: 1,
  },
  {
    name: 'un modulo descritto e senza cartella → problema (il caso della vetrina)',
    run: (r) => checkModules(r, {
      featureDirs: ['admin-ai'], rootReadme: '**Admin AI** **Contratti**', map: FEATURES,
    }),
    expect: 1,
  },
  {
    name: 'moduli allineati → nessun problema',
    run: (r) => checkModules(r, {
      featureDirs: ['admin-ai', 'auth'], rootReadme: '**Admin AI**', map: FEATURES,
    }),
    expect: 0,
  },
  {
    name: 'una migrazione mai citata → problema',
    run: (r) => checkMigrations(r, {
      migrations: ['0024_contract_manager.sql'], texts: ['fino alla 0023'],
    }),
    expect: 1,
  },
  {
    name: 'una migrazione citata per numero → nessun problema',
    run: (r) => checkMigrations(r, {
      migrations: ['0024_contract_manager.sql'], texts: ['la migrazione 0024 aggiunge…'],
    }),
    expect: 0,
  },
  {
    name: 'un documento orfano → problema',
    run: (r) => checkDocs(r, {
      docFiles: ['finance-operations.md'], links: ['app/docs/ai-inbox.md'],
      docsExist: () => true,
    }),
    expect: 1,
  },
  {
    // ⚠️ IL CASO DELLA SCANSIONE PIATTA: un orfano in una sottocartella deve
    // contare quanto uno alla radice — fino al 2026-08-13 non veniva nemmeno
    // elencato.
    name: 'un documento orfano in una SOTTOCARTELLA → problema',
    run: (r) => checkDocs(r, {
      docFiles: ['archivio/vecchio.md'], links: [], docsExist: () => true,
    }),
    expect: 1,
  },
  {
    name: 'un documento annidato e collegato → nessun problema',
    run: (r) => checkDocs(r, {
      docFiles: ['archivio/vecchio.md'], links: ['app/docs/archivio/vecchio.md'],
      docsExist: () => true,
    }),
    expect: 0,
  },
  {
    name: '⚠️ una cartella del perimetro assente → si nomina, non si tace',
    run: (r) => {
      for (const nome of perimetroMancante([
        { nome: 'docs', esiste: false }, { nome: 'src/features', esiste: true },
      ])) r.add('perimetro', `manca ${nome}`, 'scan');
    },
    expect: 1,
  },
  {
    name: 'perimetro al completo → nessun problema',
    run: (r) => {
      for (const nome of perimetroMancante([
        { nome: 'docs', esiste: true }, { nome: 'src/features', esiste: true },
      ])) r.add('perimetro', `manca ${nome}`, 'scan');
    },
    expect: 0,
  },
  {
    name: 'un collegamento rotto → problema',
    run: (r) => checkDocs(r, {
      docFiles: [], links: ['app/docs/inesistente.md'], docsExist: () => false,
    }),
    expect: 1,
  },
  {
    // Stessa ragione: una sezione «Comandi» che cita un altro script farebbe
    // scattare anche il controllo inverso.
    name: 'uno script non documentato → problema',
    run: (r) => checkCommands(r, {
      scripts: ['test:contracts'], commandsSection: '(nessun comando)',
    }),
    expect: 1,
  },
  {
    name: 'un comando documentato e inesistente → problema',
    run: (r) => checkCommands(r, {
      scripts: [], commandsSection: 'npm run test:fantasma',
    }),
    expect: 1,
  },
  {
    name: 'una Edge Function non elencata → problema',
    run: (r) => checkFunctions(r, {
      functionDirs: ['contract-worker', '_shared'], texts: ['finance-worker'],
    }),
    expect: 1,
  },
  {
    name: 'tutto allineato → nessun problema',
    run: (r) => checkFunctions(r, {
      functionDirs: ['contract-worker', '_shared'], texts: ['contract-worker'],
    }),
    expect: 0,
  },

  // --- i tre controlli sullo STATO ---------------------------------------
  {
    name: 'la tabella dello stato si legge davvero (nome, rotta, sei stati)',
    run: (r) => {
      const righe = leggiStato(
        '## I moduli\n\n| Modulo | Rotta | A | B | C | D | E | F | G | H |\n'
        + '|---|---|---|---|---|---|---|---|---|---|\n'
        + '| Inbox | `/inbox` | sì | sì | sì | sì | sì | no | Google | CASA |\n'
        + '\n## Altro\n',
      );
      const c = righe[0];
      if (righe.length !== 1 || c.nome !== 'Inbox' || c.rotta !== '/inbox'
          || c.stati.join(',') !== 'sì,sì,sì,sì,sì,no') {
        r.add('autoverifica', 'il lettore della tabella non ha letto ciò che doveva', 'leggiStato');
      }
    },
    expect: 0,
  },
  {
    name: 'un modulo senza riga nella tabella → problema',
    run: (r) => checkStatusTable(r, {
      righe: [], map: { contracts: { moduleName: 'Contratti' } },
    }),
    expect: 1,
  },
  {
    name: 'uno stato fuori dal vocabolario → problema',
    run: (r) => checkStatusTable(r, {
      righe: [{ nome: 'Contratti', rotta: '/contratti', stati: ['sì', 'quasi', 'sì', 'sì', 'no', 'sì'] }],
      map: { contracts: { moduleName: 'Contratti' } },
    }),
    expect: 1,
  },
  {
    name: 'tabella allineata → nessun problema',
    run: (r) => checkStatusTable(r, {
      righe: [{ nome: 'Contratti', rotta: '/contratti', stati: ['sì', 'sì', 'sì', 'sì', 'no', 'parziale'] }],
      map: { contracts: { moduleName: 'Contratti' } },
    }),
    expect: 0,
  },
  {
    name: 'una rotta dichiarata e assente dal router → problema',
    run: (r) => checkRoutes(r, {
      rotte: ['/finanze'], router: '<Route path="/clienti" element={<X/>} />',
    }),
    expect: 1,
  },
  {
    name: 'una rotta dichiarata e presente → nessun problema',
    run: (r) => checkRoutes(r, {
      rotte: ['/clienti'], router: '<Route path="/clienti" element={<X/>} />',
    }),
    expect: 0,
  },
  {
    // ⚠️ È IL CASO REALE: il README diceva `/automazioni` pubblicata e
    // app/README.md diceva che esisteva «solo in locale». Se questo caso
    // smettesse di fallire, il controllo sarebbe morto.
    name: 'un documento che nega la pubblicazione di un modulo dichiarato → problema',
    run: (r) => checkStatusContradictions(r, {
      moduli: [{ nome: 'Automazioni', rotta: '/automazioni' }],
      testi: [{
        file: 'app/README.md',
        testo: 'Automazioni (0020): il motore è in esercizio,\nma la schermata '
          + '`/automazioni` esiste solo in locale.\n',
      }],
    }),
    expect: 1,
  },
  {
    // ⚠️ ANCHE QUESTO È UN CASO REALE: docs/crm-light.md scriveva «non è
    // ancora **pubblicato**», e la prima versione di questo controllo non lo
    // vedeva perché il grassetto cadeva dentro la frase.
    name: 'la negazione col GRASSETTO in mezzo → problema lo stesso',
    run: (r) => checkStatusContradictions(r, {
      moduli: [{ nome: 'Clienti', rotta: '/clienti' }],
      testi: [{ file: 'docs/crm-light.md', testo: 'Il modulo Clienti non è ancora **pubblicato**.\n' }],
    }),
    expect: 1,
  },
  {
    name: 'la stessa frase su un modulo che NON è nella tabella → nessun problema',
    run: (r) => checkStatusContradictions(r, {
      moduli: [{ nome: 'Automazioni', rotta: '/automazioni' }],
      testi: [{ file: 'docs/x.md', testo: 'Il portale fiduciario non è ancora pubblicato.\n' }],
    }),
    expect: 0,
  },
];

function selfTest() {
  console.log(`${B}Autoverifica del controllo${X} ${DIM}(un controllo che non sa fallire non è un controllo)${X}\n`);
  let bad = 0;
  for (const c of CASES) {
    const r = new Report();
    c.run(r);
    const got = r.problems.length;
    const ok = got === c.expect;
    if (!ok) bad++;
    console.log(`  ${ok ? G + '✓' : R + '✗'}${X} ${c.name} ${DIM}— attesi ${c.expect}, trovati ${got}${X}`);
  }
  // ⚠️ L'ESITO, provato a parte perché non produce «problemi» ma un CODICE DI
  // USCITA — ed è il codice di uscita ad aver mentito fino al 2026-08-03.
  const esiti = [
    ['nessuna divergenza e controllo completo → 0', { ok: true, rootMissing: false, allowPartial: false }, 0],
    ['⚠️ nessuna divergenza ma PARZIALE → 3, non 0', { ok: true, rootMissing: true, allowPartial: false }, 3],
    ['parziale accettato esplicitamente → 0', { ok: true, rootMissing: true, allowPartial: true }, 0],
    ['divergenze → 1', { ok: false, rootMissing: false, allowPartial: false }, 1],
    ['⚠️ divergenze: --allow-partial NON le perdona', { ok: false, rootMissing: true, allowPartial: true }, 1],
  ];
  for (const [nome, input, atteso] of esiti) {
    const got = esitoFinale(input).codice;
    const ok = got === atteso;
    if (!ok) bad++;
    console.log(`  ${ok ? G + '✓' : R + '✗'}${X} ${nome} ${DIM}— atteso ${atteso}, ottenuto ${got}${X}`);
  }

  if (bad) {
    console.error(`\n${R}${bad} casi di autoverifica falliti: il controllo NON è affidabile.${X}`);
    process.exit(1);
  }
  console.log(`\n${G}Tutti i ${CASES.length + esiti.length} casi superati.${X}`);
  return true;
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

// ⚠️ L'autoverifica gira PRIMA di ogni scansione, come in `i18n:coverage`: un
// verde dato da un controllo rotto è la cosa che questo file esiste per evitare.
const quiet = [];
{
  let bad = 0;
  for (const c of CASES) {
    const r = new Report();
    c.run(r);
    if (r.problems.length !== c.expect) { bad++; quiet.push(c.name); }
  }
  if (bad) {
    console.error(`${R}✗ L'autoverifica del controllo è fallita su ${bad} casi:${X}`);
    for (const n of quiet) console.error(`   · ${n}`);
    console.error(`${DIM}   Il risultato della scansione non sarebbe attendibile: non viene eseguita.${X}`);
    process.exit(1);
  }
}

const { report, rootMissing, rootDir } = scan();

console.log(`\n${B}Documentazione — descrive il codice che c'è davvero?${X}`);
console.log(`${DIM}(controllo verificato su ${CASES.length} casi noti)${X}\n`);

// ⚠️⚠️ DICHIARARE IL SALTO NON BASTAVA, ED È LA STESSA LEZIONE DEL RUNNER DELLE
// SUITE. Fino al 2026-08-03 questo blocco stampava l'avviso giallo e poi, se non
// c'erano divergenze, il verde «Nessuna divergenza» con USCITA ZERO. Il salto era
// scritto, ma le due cose che un lettore guarda davvero — la parola «verde» e il
// codice di uscita — dicevano entrambe «a posto», mentre metà dei controlli
// (moduli e collegamenti della radice) non era stata eseguita.
//
// È il difetto che questo file esiste per intercettare, commesso da questo file.
// La regola è quella di `check:auth` e di `run-test-suite.mjs`: **uno strumento a
// cui viene posta una domanda a cui non può rispondere deve fallire, non
// rispondere a una domanda diversa.**
const ALLOW_PARTIAL = process.argv.includes('--allow-partial');

if (rootMissing) {
  console.log(`  ${Y}!${X} README della radice non trovato in ${rootDir}`);
  console.log(`    ${DIM}i controlli sui MODULI e sui collegamenti della radice non sono stati eseguiti.${X}\n`);
}

const esito = esitoFinale({ ok: report.ok, rootMissing, allowPartial: ALLOW_PARTIAL });

if (esito.stato === 'parziale') {
  console.log(`  ${Y}PARZIALE — e un controllo parziale non è un verde.${X}`);
  console.log(`${DIM}    Nessuna divergenza fra quelli ESEGUITI: migrazioni, documenti, comandi, funzioni.`);
  console.log(`    Non eseguiti: moduli e collegamenti della radice.`);
  console.log(`    · verifica completa:  npm run docs:check -- --root ~/swiss-ai-suite-repo`);
  console.log(`    · accetto il parziale: npm run docs:check -- --allow-partial${X}\n`);
  process.exit(esito.codice);
}

if (report.ok) {
  console.log(`  ${G}Nessuna divergenza: moduli, migrazioni, documenti, comandi e funzioni corrispondono.${X}`
    + (rootMissing ? `\n  ${DIM}(parziale, accettato con --allow-partial)${X}` : ''));
  console.log();
  process.exit(esito.codice);
}

const byArea = new Map();
for (const p of report.problems) {
  if (!byArea.has(p.area)) byArea.set(p.area, []);
  byArea.get(p.area).push(p);
}
console.log(`  ${R}${report.problems.length} divergenze:${X}\n`);
for (const [area, list] of byArea) {
  console.log(`  ${B}${area}${X}`);
  for (const p of list) {
    console.log(`    ${R}✗${X} ${p.what}`);
    console.log(`      ${DIM}dove: ${p.where}${X}`);
    if (p.hint) console.log(`      ${DIM}${p.hint}${X}`);
  }
  console.log('');
}
console.log(`${DIM}  Questo controllo NON corregge da solo: la prosa attorno agli elenchi la\n`
  + `  scrive una persona, e rigenerarla la renderebbe un testo che nessuno rilegge.${X}\n`);
process.exit(1);
