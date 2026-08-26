// ============================================================================
// Genera la vetrina AI-Swisse: `node build.mjs` → dist/
//
//   dist/index.html            italiano (radice)      dist/de/  dist/fr/
//   dist/impressum.html        pagine legali, una per lingua
//   dist/privacy.html          (in de e fr con gli slug della lingua)
//   dist/condizioni.html
//   dist/style.css             tokens.css + style.css concatenati
//   dist/og.html               sorgente dell'anteprima social, da fotografare
//   dist/autonoma/*.html       una pagina per lingua, CSS incorporato
//
// PERCHÉ TRE PAGINE E NON UNA CON UNO SWITCH JS
// Il pubblico è in tre regioni linguistiche e il mercato più grande è quello
// germanofono. Con un'unica pagina che cambia i testi via JavaScript, i motori
// di ricerca ne indicizzano una sola: la vetrina esisterebbe in tedesco solo
// per chi ci arriva già. Tre pagine statiche con `hreflang` costano un
// generatore, e si fanno trovare in tutte e tre.
//
// ORDINE DELLE SEZIONI
// promessa → come funziona → esempio → moduli → verificabilità → lingue →
// quello che è giusto sapere → prezzi → contatti. Le Automazioni stanno
// dopo i movimenti: si automatizza ciò che si è già capito e ordinato.
// I limiti stanno PRIMA dei prezzi di proposito: chi legge una cifra deve
// sapere già che cosa il prodotto non fa. Metterli dopo sarebbe far firmare
// prima e leggere poi.
// «Chi c'è dietro» è stata TOLTA su decisione del titolare (2026-07-28):
// i dati della persona restano nell'impressum e nell'informativa, dove la
// legge li chiede, non in vetrina.
// ============================================================================
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, cpSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTENT, LOCALES, LOCALE_LABEL, LOCALE_PATH, HTML_LANG,
  LEGAL_PAGES, LEGAL_SLUG, APP_URL, SITE_URL, CONTACT_EMAIL, LEGAL_COMPLETE,
} from './content.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'dist');

// ---------------------------------------------------------------------------
// IL LOGO DEL TITOLARE — l'immagine fornita il 2026-07-29, ricostruita in
// vettoriale: blocco #37AEEF (dal 2026-08-26 — prima #00AEEF) con «AI» bianco,
// wordmark «Swisse» in Poppins
// (glifi convertiti in tracciati: nessun font a runtime). IL COLORE È DEL
// MARCHIO — e dal 2026-08-26 coincide con `--accent`, per scelta del titolare:
// il disegno resta esente dalle soglie di contrasto del testo (WCAG 1.4.3 non
// si applica ai loghi), ma il valore è uno solo, documentato nel README. Si inlinea nelle pagine (così vive anche nelle autonome, dove i
// percorsi esterni non risolvono); i file restano pubblici in /logo-*.svg.
// La variante scura ha il wordmark bianco: serve sui fondi blu (anteprima
// social), dove l'azzurro del testo non leggerebbe.
// ---------------------------------------------------------------------------
const logoInline = (file, className) => readFileSync(join(ROOT, 'static', file), 'utf8')
  .replace('<svg ', `<svg class="${className}" aria-hidden="true" `)
  .replace(' role="img" aria-label="AI-Swisse"', '')
  .trim();
const LOGO = logoInline('logo-ai-swisse.svg', 'brand-logo');
const LOGO_SCURO = logoInline('logo-ai-swisse-scuro.svg', 'og-logo');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * L'EVIDENZIATORE È LA FIRMA DELLA PAGINA.
 *
 * Il prodotto ha un gesto proprio e vero: la frase del documento da cui viene
 * un'informazione resta marcata in giallo. Qui quel gesto diventa il modo in
 * cui la vetrina marca le proprie parole — non un ornamento inventato, ma la
 * stessa cosa che il prodotto fa, applicata a sé stesso.
 *
 * Nei testi si scrive `[[parole]]`; il marcatore NON cambia una parola, quindi
 * la linea editoriale resta quella. Regola per non abusarne: **una sola
 * evidenziazione per schermata**, e solo su parole che dicono ciò che il
 * prodotto fa davvero. Oggi sono due in tutta la pagina: la promessa nel
 * titolo e la chiusura.
 */
const hl = (s) => esc(s).replace(/\[\[(.+?)\]\]/g, '<span class="ms-hl">$1</span>');
/** Lo stesso testo senza marcatori: per `<title>`, meta e anteprima social. */
const plain = (s) => String(s).replace(/\[\[|\]\]/g, '');

/**
 * Data di riferimento della costruzione. Serve alla data delle pagine legali e
 * all'esempio in home page, che altrimenti invecchiano dentro il file.
 */
const OGGI = process.env.BUILD_DATE ? new Date(process.env.BUILD_DATE) : new Date();
const dataCH = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
/**
 * L'esempio in home page mostra una scadenza e i giorni che mancano. Erano
 * scritti nel testo — «31.08.2026 · Mancano 12 giorni» — e già al momento della
 * pubblicazione erano falsi: mancavano 36 giorni, e dal 31 agosto la scadenza
 * sarebbe risultata passata. Una vetrina che dimostra come si leggono le
 * scadenze non può sbagliare la propria.
 *
 * Ora la data è sempre a distanza fissa da oggi, calcolata qui, e uno script di
 * poche righe la ricalcola al caricamento: così resta vera anche fra sei mesi,
 * senza ricostruire il sito. Senza JavaScript si vede comunque la data della
 * costruzione, che è corretta al momento della pubblicazione.
 */
const GIORNI_ESEMPIO = 40;
const dataEsempio = new Date(OGGI.getTime() + GIORNI_ESEMPIO * 86400000);

/** Data per esteso dentro il testo della lettera, secondo la lingua. */
const MESI = {
  it: ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'],
  de: ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'],
  fr: ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'],
};
function dataEstesa(d, locale) {
  const g = d.getDate(), m = MESI[locale][d.getMonth()], a = d.getFullYear();
  if (locale === 'de') return `${g}. ${m} ${a}`;
  if (locale === 'fr') return `${g === 1 ? '1er' : g} ${m} ${a}`;
  return `${g} ${m} ${a}`;
}

const assetPrefix = (locale) => (locale === 'it' ? '' : '../');

/** Un campo che aspetta un dato reale: se è vuoto, il blocco non si scrive. */
const valorizzato = (v) => typeof v === 'string' && v.trim() !== '';

// ---------------------------------------------------------------------------
// Icone: le stesse dell'applicazione, non ridisegnate. Le quattro schede della
// verificabilità avevano tutte lo stesso segno, e quattro volte la stessa icona
// non è un sistema: è un riempitivo.
// ---------------------------------------------------------------------------
const ICONS = {
  check: '<path d="M4.5 12.5 9 17l10.5-10.5"/>',
  arrow: '<path d="M5 12h13M12.5 6.5 19 12l-6.5 5.5"/>',
  // la freccia della trasformazione: dalla frase marcata all'azione che ne esce
  arrowDown: '<path d="M12 5v13M6.5 11.5 12 18l5.5-6.5"/>',
  arrowLeft: '<path d="M19 12H6M11.5 6.5 5 12l6.5 5.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3.5 9h17M3.5 15h17M12 3c-2.5 2.5-2.5 15 0 18M12 3c2.5 2.5 2.5 15 0 18"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  phone: '<path d="M7 3.5H5.2a1.7 1.7 0 0 0-1.7 1.9c.5 4.6 2.4 8.2 5.4 11.2s6.6 4.9 11.2 5.4a1.7 1.7 0 0 0 1.9-1.7V18.5a1.5 1.5 0 0 0-1.2-1.5l-3-.6a1.5 1.5 0 0 0-1.5.6l-1 1.3a14 14 0 0 1-6-6l1.3-1a1.5 1.5 0 0 0 .6-1.5l-.6-3A1.5 1.5 0 0 0 7 3.5Z"/>',
  // documento con lente: «mostra nel documento», la citazione verificata
  quote: '<path d="M6.5 3h6l5 5v3.2"/><path d="M12.5 3v5h5"/><path d="M6.5 3A.5.5 0 0 0 6 3.5V21a.5.5 0 0 0 .5.5H12"/><circle cx="16.5" cy="16.5" r="2.7"/><path d="m18.6 18.6 1.9 1.9"/>',
  // punto interrogativo in cerchio: ciò che il sistema non sa
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.7"/><path d="M12 17.2h.01"/>',
  // etichetta: la provenienza dichiarata di ogni azione
  tag: '<path d="M3.5 11.2V4.5a1 1 0 0 1 1-1h6.7a1 1 0 0 1 .7.3l8 8a1 1 0 0 1 0 1.4l-6.7 6.7a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1-.3-.7Z"/><circle cx="8" cy="8" r="1.4"/>',
  // orologio con freccia: si può tornare a com'era
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5V9h4.5"/><path d="M12 7.5V12l3 1.8"/>',
  doc: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7Z"/><path d="M14 3v4h4"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12 2.5 2.5 4.7-5.2"/>',
  gauge: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="m12 16 4.2-4.2"/><circle cx="12" cy="16" r="1.2"/>',
  users: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19a5.6 5.6 0 0 0-2-4.3"/>',
  layers: '<path d="m12 3 8.5 4.5L12 12 3.5 7.5Z"/><path d="m3.5 12 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
};
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

/**
 * Selettore di lingua. Due cose che sembrano dettagli e non lo sono:
 *  · la lingua corrente NON è un collegamento — portava a `#`, cioè da nessuna
 *    parte, ed era annunciata come link dalle tecnologie assistive;
 *  · da una pagina legale si va alla STESSA pagina nell'altra lingua. Chi sta
 *    leggendo l'informativa privacy in tedesco e passa al francese vuole
 *    l'informativa in francese, non essere rispedito in home page.
 */
function languageNav(current, legalKey) {
  return LOCALES.map((l) => {
    if (l === current) {
      return `<span class="lang-current" aria-current="page">${LOCALE_LABEL[l]}</span>`;
    }
    const href = legalKey
      ? `${SITE_URL}${LOCALE_PATH[l]}${LEGAL_SLUG[l][legalKey]}.html`
      : `${SITE_URL}${LOCALE_PATH[l]}`;
    // `lang` oltre a `hreflang`: hreflang descrive la destinazione, lang la
    // lingua del TESTO del link — «Deutsch» su una pagina italiana va letto
    // in tedesco dalle sintesi vocali.
    return `<a class="lang-link" href="${href}" hreflang="${l}" lang="${l}">${LOCALE_LABEL[l]}</a>`;
  }).join('');
}

function head(locale, { title, description, canonical, extraLd, legalKey }) {
  // Gli hreflang delle pagine legali puntano alla STESSA pagina nelle altre
  // lingue, come fa il selettore: puntare alle tre home rendeva il canonical
  // estraneo al proprio set hreflang, che i motori scartano come incoerente.
  const altHref = (l) => legalKey
    ? `${SITE_URL}${LOCALE_PATH[l]}${LEGAL_SLUG[l][legalKey]}.html`
    : `${SITE_URL}${LOCALE_PATH[l]}`;
  const alternates = LOCALES.map(
    (l) => `<link rel="alternate" hreflang="${l}-CH" href="${altHref(l)}" />`,
  ).join('\n    ') + `\n    <link rel="alternate" hreflang="x-default" href="${altHref('it')}" />`;
  const p = assetPrefix(locale);
  return `    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${canonical}" />
    ${alternates}
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="AI-Swisse" />
    <meta property="og:locale" content="${locale}_CH" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${SITE_URL}/og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="AI-Swisse — ${esc(CONTENT[locale].tagline)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${SITE_URL}/og.png" />
    <!-- Lo stesso accento dell'applicazione, hsl(207 88% 39%): era rimasto un
         blu diverso, scritto a mano quando i token vivevano in due copie. -->
    <!-- UNA SOLA DICHIARAZIONE, SENZA attributo media, dal 2026-08-16. Erano
         due, legate a prefers-color-scheme: da quando il chiaro è il
         predefinito, la seconda avrebbe fatto seguire al telefono il SISTEMA
         mentre la pagina segue sé stessa — barra scura sopra un sito chiaro.
         È la stessa correzione fatta in app/index.html.
         Il meta color-scheme serve nell'istante prima che il foglio di stile
         arrivi; style.css lo ridichiara sul :root.
         ⚠️ Niente apici inversi qui dentro: questo commento vive in una stringa
         template, e un apice inverso la chiude. -->
    <meta name="theme-color" content="#0b6bc0" />
    <meta name="color-scheme" content="light" />
    <link rel="icon" type="image/svg+xml" href="${p}favicon.svg" />
    <link rel="preload" href="${p}fonts/inter-tight-var-latin.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="${p}style.css" />${extraLd ? `\n    <script type="application/ld+json">${extraLd}</script>` : ''}`;
}

function topbar(locale, c, { onLanding, legalKey }) {
  // Dalla pagina legale il marchio torna alla home DELLA STESSA LINGUA, con un
  // percorso relativo: `../index.html` avrebbe riportato un lettore tedesco
  // sulla home italiana.
  const home = onLanding ? '#main' : 'index.html';
  // La barra resta chiara anche in home: dà al campo blu il suo bordo
  // superiore e tiene il marchio identico a quello dell'applicazione.
  //
  // Il logo del titolare, inline (vedi il commento su LOGO in testa al file);
  // l'aria-label del collegamento dice il nome per intero a chi ascolta.
  return `    <header class="topbar">
      <a class="brand" href="${home}" aria-label="AI-Swisse — ${esc(c.tagline)}">
        ${LOGO}
        <span class="brand-sub" aria-hidden="true">${esc(c.tagline)}</span>
      </a>${onLanding ? `
      <nav class="topnav" aria-label="${esc(c.mainNav)}">
        <a href="#how">${esc(c.nav.how)}</a>
        <a href="#trust">${esc(c.nav.trust)}</a>
        <a href="#pricing">${esc(c.nav.pricing)}</a>
        <a href="#contact">${esc(c.nav.contact)}</a>
      </nav>` : ''}
      <div class="topactions">
        <span class="langs">${languageNav(locale, legalKey)}</span>
        <a class="btn" href="${APP_URL}">${esc(c.login)}</a>
      </div>
    </header>`;
}

function footer(locale, c, legalKey, onField) {
  // Percorsi RELATIVI senza prefisso: le pagine legali di ogni lingua stanno
  // nella cartella della lingua. Con `../` un lettore tedesco finiva su
  // `dist/datenschutz.html`, che non esiste.
  const legal = LEGAL_COMPLETE
    ? LEGAL_PAGES.map(
        (k) => `<a href="${LEGAL_SLUG[locale][k]}.html">${esc(c.footerLegal[k])}</a>`,
      ).join('<span class="foot-sep" aria-hidden="true">·</span>')
    : '';
  // In home il piè di pagina prosegue il campo blu della chiusura: sta fuori
  // da <main>, quindi la classe gliela dà il generatore — un selettore
  // fratello non lo raggiungerebbe.
  return `    <footer class="foot${onField ? ' on-field' : ''}">
      <p>${esc(c.footerNote)}</p>
      <p class="foot-links">
        <a href="${APP_URL}">${esc(c.footerApp)}</a>
        <span class="foot-sep" aria-hidden="true">·</span>
        <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>${legal ? `
        <span class="foot-sep" aria-hidden="true">·</span>
        ${legal}` : ''}
      </p>
      <p class="foot-links langs">${languageNav(locale, legalKey)}</p>
    </footer>`;
}

/**
 * Testata di protocollo: numero tabellare e titolo, eventualmente un tag.
 * È il filo conduttore delle sezioni — la stessa testata per tutte, come le
 * intestazioni ricorrenti di un documento tecnico. Il filetto sopra la
 * testata è il bordo della sezione, non un elemento a sé.
 */
function secHead(n, title, tag) {
  return `<div class="ms-sec-head">
          <span class="ms-sec-n" aria-hidden="true">${n}</span>
          <h2>${esc(title)}</h2>${tag ? `
          <span class="ms-tag">${esc(tag)}</span>` : ''}
        </div>`;
}

/** Le due chiamate all'azione, sempre insieme: iscriversi o parlare con qualcuno. */
function ctaPair(c, { primary = 'demo' } = {}) {
  const demo = `<a class="btn ${primary === 'demo' ? 'btn-primary' : ''}" href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(c.demo)}">${esc(c.demo)} ${icon(primary === 'demo' ? 'arrow' : 'mail')}</a>`;
  const signup = `<a class="btn ${primary === 'signup' ? 'btn-primary' : ''}" href="${APP_URL}">${esc(c.signup)} ${primary === 'signup' ? icon('arrow') : ''}</a>`;
  return primary === 'signup' ? signup + '\n          ' + demo : demo + '\n          ' + signup;
}

// ---------------------------------------------------------------------------
// Pagina principale
// ---------------------------------------------------------------------------
function page(locale) {
  const c = CONTENT[locale];
  const canonical = SITE_URL + LOCALE_PATH[locale];

  // Dati strutturati: solo fatti verificabili. Niente `offers`, perché il
  // listino non è definito — pubblicare prezzi in JSON-LD e scrivere accanto
  // che si stanno definendo sarebbe dire due cose diverse a due lettori
  // diversi, il motore di ricerca e la persona.
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'AI-Swisse',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: canonical,
    inLanguage: LOCALES.map((l) => `${l}-CH`),
    description: c.description,
    provider: { '@type': 'Organization', name: 'AI-Swisse', url: SITE_URL, email: CONTACT_EMAIL },
  });

  const steps = c.how.map((s) => `
        <li class="step">
          <span class="step-n" aria-hidden="true">${esc(s.n)}</span>
          <div><h3>${esc(s.t)}</h3><p>${esc(s.d)}</p></div>
        </li>`).join('');

  const modules = c.modules.map((m) => `
        <article class="card">
          <div class="kicker">${esc(m.kicker)}</div>
          <h3>${esc(m.name)}</h3>
          <p class="module-lead">${esc(m.lead)}</p>
          <ul class="ticks">
            ${m.points.map((x) => `<li>${icon('check')}<span>${esc(x)}</span></li>`).join('\n            ')}
          </ul>
        </article>`).join('');

  const trust = c.trust.map((t) => `
        <article class="card trust-card">
          <div class="trust-ico">${icon(t.icon)}</div>
          <h3>${esc(t.t)}</h3>
          <p>${esc(t.d)}</p>
        </article>`).join('');

  const axisIcons = ['doc', 'search', 'users', 'layers'];
  const axes = c.pricingAxes.map((a, i) => `
          <div class="axis">
            <span class="axis-ico" aria-hidden="true">${icon(axisIcons[i] || 'doc')}</span>
            <div><h3>${esc(a.t)}</h3><p>${esc(a.d)}</p></div>
          </div>`).join('');

  // Indici tabellari a due cifre: nell'inversione i limiti sono un elenco
  // protocollato, non un fondo pagina di avvertenze.
  const limits = c.limits.map((x, i) => `<li><span class="ms-lim-n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><p>${esc(x)}</p></li>`).join('\n          ');

  // In francese i guillemet vogliono lo spazio fine unificatore interno
  // (« texte ») — la stessa pagina francese lo usa già nelle citazioni del
  // copy. In italiano e in de-CH i guillemet svizzeri stanno senza spazio.
  const gsp = locale === 'fr' ? ' ' : '';

  // Le date dell'esempio non stanno nel testo: si calcolano.
  const e = { ...c.example };
  const dEsteso = dataEstesa(dataEsempio, locale);
  e.when = e.when.replace('{data}', dataCH(dataEsempio)).replace('{giorni}', String(GIORNI_ESEMPIO));
  e.letterHighlight = e.letterHighlight.replace('{dataLettera}', dEsteso);
  e.quote = e.quote.replace('{dataLettera}', dEsteso);

  return `<!doctype html>
<html lang="${HTML_LANG[locale]}">
  <head>
${head(locale, { title: c.title, description: c.description, canonical, extraLd: jsonLd })}
  </head>
  <body>
    <a class="skip" href="#main">${esc(c.skip)}</a>

${topbar(locale, c, { onLanding: true })}

    <main id="main">
      <!-- L'HERO È IL CAMPO: l'unica superficie di colore pieno della pagina,
           il blu dell'applicazione. Magiq ha il suo giallo; questo è il nostro,
           ed è lo stesso colore dei pulsanti dell'app — chi arriva di qui e
           crea un account non cambia prodotto.
           L'H1 è l'elemento LCP: nessuna classe di rivelazione, nessuna
           opacità. È dipinto visibile al primo frame, in entrambi i temi.
           A destra LA PROVA: la stessa cosa che il prodotto fa, in miniatura —
           una frase marcata nella lettera e l'azione che ne esce. Non è un
           mockup inventato di un'applicazione che non esiste: è etichettata
           come esempio e le sue date si ricalcolano come quelle del dossier. -->
      <section class="ms-hero">
        <div class="ms-hero-text">
          <p class="ms-kicker">${esc(c.tagline)}</p>
          <h1>${hl(c.heroTitle)}</h1>
          <p class="ms-lead">${esc(c.heroLead)}</p>
          <div class="ms-actions">
            ${ctaPair(c, { primary: 'signup' })}
          </div>
          <p class="ms-hero-meta">${icon('globe')}<span>${esc(c.heroNote)}</span></p>
        </div>
        <div class="ms-proof" aria-hidden="true">
          <div class="ms-proof-tag">${esc(e.label)}</div>
          <div class="ms-proof-paper">
            <div class="ms-proof-from">${esc(e.letterFrom.split('\n')[0])}</div>
            <p class="ms-proof-line">…${esc(e.letterBefore.trim().split('\n').pop())}</p>
            <p class="ms-proof-line"><mark data-testo="${esc(c.example.letterHighlight)}">${esc(e.letterHighlight)}</mark></p>
          </div>
          <div class="ms-proof-arrow">${icon('arrowDown')}</div>
          <div class="ms-proof-task">
            <span class="ms-proof-check">${icon('check')}</span>
            <div>
              <div class="ms-proof-action">${esc(e.action)}</div>
              <div class="ms-proof-when mock-when" data-scadenza="${GIORNI_ESEMPIO}" data-formato="${esc(c.example.when)}">${esc(e.when)}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="ms-section" id="how">
        ${secHead('01', c.howTitle)}
        <ol class="steps ms-r">${steps}
        </ol>
      </section>

      <!-- IL DOSSIER: lettera e analisi sullo stesso foglio di lavoro, con le
           ancore numerate ①②③ che collegano il punto del testo
           all'informazione ricavata: è la cosa che il prodotto fa. Non è uno
           screenshot — una schermata reale mostrerebbe la ragione sociale e i
           documenti di un'impresa vera — e l'etichetta di dati fittizi apre la
           sezione, sta sul foglio e chiude il dossier: ogni ritaglio la porta.
           Le ancore sono aria-hidden: per chi ascolta, i due pannelli sono già
           paralleli nel testo. I numeri stanno FUORI dagli elementi
           [data-testo]: lo script delle date ne riscrive il contenuto. -->
      <section class="ms-example" id="example">
        ${secHead('02', e.title, e.label)}
        <p class="ms-sec-lead">${esc(e.lead)}</p>
        <div class="ms-dossier ms-r">
          <div class="ms-paper">
            <div class="ms-pane-head"><span>${esc(e.letterTitle)}</span><span class="ms-tag">${esc(e.label)}</span></div>
            <div class="letter-from"><span class="ms-ref" aria-hidden="true">1</span>${esc(e.letterFrom)}</div>
            <div class="letter-subject"><span class="ms-ref" aria-hidden="true">2</span>${esc(e.letterSubject)}</div>
            <div class="letter-body">${esc(e.letterBefore)}<span class="ms-ref ms-ref-hl" aria-hidden="true">3</span><mark data-testo="${esc(c.example.letterHighlight)}">${esc(e.letterHighlight)}</mark>${esc(e.letterAfter)}</div>
          </div>
          <div class="ms-analysis">
            <div class="ms-pane-head"><span>${esc(e.analysisTitle)}</span></div>
            <div class="mock-top ms-row">
              <span class="ms-ref" aria-hidden="true">1</span>
              <h3>${esc(e.docTitle)}</h3>
              <span class="mock-badges"><span class="chip chip-hot">${esc(e.urgency)}</span><span class="chip">${esc(e.confidence)}</span></span>
            </div>
            <div class="ms-row">
              <span class="ms-ref" aria-hidden="true">2</span>
              <div class="mock-kicker">${esc(e.kicker)}</div>
              <div class="mock-action">${esc(e.action)} <span class="chip chip-origin">${icon('quote')}${esc(e.origin)}</span></div>
              <div class="mock-when" data-scadenza="${GIORNI_ESEMPIO}" data-formato="${esc(c.example.when)}">${esc(e.when)}</div>
            </div>
            <div class="ms-row">
              <span class="ms-ref" aria-hidden="true">3</span>
              <div class="mock-quote-label">${icon('quote')}<span>${esc(e.quoteLabel)}</span></div>
              <blockquote data-testo="${esc(c.example.quote)}">«${gsp}${esc(e.quote)}${gsp}»</blockquote>
            </div>
            <div class="mock-verify">
              <div class="mock-verify-title">${esc(e.verifyTitle)}</div>
              <div class="mock-verify-item"><span class="q" aria-hidden="true">?</span><span>${esc(e.verify)}</span></div>
            </div>
          </div>
        </div>
        <p class="ms-dossier-note">${esc(e.note)}</p>
      </section>

      <!-- Non più «due moduli»: tre movimenti — cosa arriva, cosa diventa,
           cosa trova. È la forma vera del prodotto di oggi, senza elencare
           dieci voci di menu come un manuale. -->
      <section class="ms-section" id="modules">
        ${secHead('03', c.modulesTitle)}
        <p class="ms-sec-lead">${esc(c.modulesLead)}</p>
        <div class="grid-3 ms-r">${modules}
        </div>
      </section>

      <!-- Le Automazioni hanno una sezione propria: sono ciò che cambia
           categoria al prodotto — da strumento che apri a cosa che lavora
           mentre non ci sei. Ogni affermazione qui viene da docs/
           workflow-automation.md: sei azioni, quattro inneschi, cinque
           minuti, nessuna regola che si accende da sola. -->
      <section class="ms-section" id="automations">
        ${secHead('04', c.autoTitle)}
        <p class="ms-sec-lead">${esc(c.autoLead)}</p>
        <ul class="ticks ms-auto ms-r">
          ${c.autoPoints.map((x) => `<li>${icon('check')}<span>${esc(x)}</span></li>`).join('\n          ')}
        </ul>
      </section>

      <!-- Registro B: banda elevata a piena larghezza. Le quattro schede
           restano quattro schede discrete, ciascuna col proprio bordo. -->
      <section class="ms-band" id="trust">
        ${secHead('05', c.trustTitle)}
        <p class="ms-sec-lead">${esc(c.trustLead)}</p>
        <div class="grid-2 ms-r">${trust}
        </div>
      </section>

      <section class="ms-section ms-langs" id="languages">
        ${secHead('06', c.langTitle)}
        <p class="ms-sec-lead">${esc(c.langLead)}</p>
      </section>

      <!-- I limiti PRIMA dei prezzi: chi legge una cifra deve già sapere che
           cosa il prodotto non fa. Registro C: l'unica inversione totale
           d'inchiostro della pagina — il momento visivamente più solenne è
           l'elenco dei limiti, di proposito. -->
      <section class="ms-invert" id="limits">
        ${secHead('07', c.limitsTitle)}
        <ol class="ms-limits ms-r">
          ${limits}
        </ol>
      </section>

      <!-- I prezzi sulla banda elevata: la sezione che dice «il listino non
           c'è ancora» non deve anche sembrare la più smorta della pagina.
           Sta fra l'inversione dei limiti e due sezioni chiare: è il gradino
           che rompe la fila. -->
      <section class="ms-band" id="pricing">
        ${secHead('08', c.pricingTitle)}
        <p class="ms-sec-lead">${esc(c.pricingLead)}</p>
        <h3 class="kicker">${esc(c.pricingAxesTitle)}</h3>
        <div class="axes ms-r">${axes}
        </div>
        <p class="pricing-note">${esc(c.pricingNote)}</p>
        <p class="center"><a class="btn btn-primary" href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(c.demo)}">${esc(c.pricingCta)} ${icon('arrow')}</a></p>
      </section>

      <section class="ms-section" id="contact">
        ${secHead('09', c.contactTitle)}
        <p class="ms-sec-lead">${esc(c.contactLead)}</p>
        <div class="contact-grid ms-r">
          <div class="contact-item">
            <span class="contact-ico" aria-hidden="true">${icon('mail')}</span>
            <div>
              <div class="contact-label">${esc(c.contactEmailLabel)}</div>
              <div class="contact-value"><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></div>
              <div class="contact-sub">${esc(c.contactHours)}</div>
            </div>
          </div>
          <div class="contact-item">
            <span class="contact-ico" aria-hidden="true">${icon('checkCircle')}</span>
            <div>
              <div class="contact-label">${esc(c.contactDemoLabel)}</div>
              <div class="contact-value"><a href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(c.demo)}">${esc(c.demo)}</a></div>
              <div class="contact-sub">${esc(c.contactDemoText)}</div>
            </div>
          </div>
${valorizzato(c.contactPhone) ? `          <div class="contact-item">
            <span class="contact-ico" aria-hidden="true">${icon('phone')}</span>
            <div>
              <div class="contact-label">${esc(c.contactPhoneLabel)}</div>
              <div class="contact-value"><a href="tel:${c.contactPhone.replace(/[^+0-9]/g, '')}">${esc(c.contactPhone)}</a></div>
            </div>
          </div>
` : ''}${valorizzato(c.contactAddress) ? `          <div class="contact-item">
            <span class="contact-ico" aria-hidden="true">${icon('doc')}</span>
            <div>
              <div class="contact-label">${esc(c.contactAddressLabel)}</div>
              <div class="contact-value">${esc(c.contactAddress)}</div>
            </div>
          </div>
` : ''}
        </div>
      </section>

      <!-- Chiusura sul campo, senza numero: non è una voce del documento, è
           la sua ultima pagina. La pagina si apre e si chiude nello stesso
           blu — due sole comparse, così il colore resta un evento. -->
      <section class="ms-cta-field ms-cta">
        <h2>${hl(c.ctaTitle)}</h2>
        <p class="ms-sec-lead">${esc(c.ctaLead)}</p>
        <p class="ms-actions">
          ${ctaPair(c, { primary: 'signup' })}
        </p>
      </section>
    </main>

${footer(locale, c, null, true)}
${scriptDate(locale)}
${scriptReveal()}
  </body>
</html>
`;
}

/**
 * Tiene vere le date dell'esempio. Undici righe, senza dipendenze, eseguite in
 * locale: non chiama nessun server, non usa cookie, non osserva nulla — quello
 * che l'informativa dichiara resta vero.
 *
 * Senza JavaScript la pagina mostra comunque le date calcolate alla
 * costruzione: corrette quando è stata pubblicata, e ricostruite a ogni push.
 */
function scriptDate(locale) {
  const mesi = JSON.stringify(MESI[locale]);
  // Stesso spazio fine unificatore della versione statica: se lo script
  // riscrive la citazione francese senza, la pagina si corregge da sola
  // all'indietro a ogni caricamento.
  const gsp = locale === 'fr' ? '\\u202f' : '';
  return `    <script>
      (function () {
        var els = document.querySelectorAll('.mock-when'); if (!els.length) return;
        var g = +els[0].dataset.scadenza, d = new Date(Date.now() + g * 86400000);
        var due = function (n) { return String(n).padStart(2, '0'); };
        var breve = due(d.getDate()) + '.' + due(d.getMonth() + 1) + '.' + d.getFullYear();
        var mesi = ${mesi}, gg = d.getDate();
        var esteso = ${locale === 'de' ? "gg + '. ' + mesi[d.getMonth()] + ' ' + d.getFullYear()"
          : locale === 'fr' ? "(gg === 1 ? '1er' : gg) + ' ' + mesi[d.getMonth()] + ' ' + d.getFullYear()"
          : "gg + ' ' + mesi[d.getMonth()] + ' ' + d.getFullYear()"};
        els.forEach(function (el) {
          el.textContent = el.dataset.formato.replace('{data}', breve).replace('{giorni}', g);
        });
        document.querySelectorAll('[data-testo]').forEach(function (n) {
          var t = n.dataset.testo.replace('{dataLettera}', esteso);
          n.textContent = n.tagName === 'BLOCKQUOTE' ? '\u00ab${gsp}' + t + '${gsp}\u00bb' : t;
        });
      })();
    </script>`;
}

/**
 * Rivelazione allo scroll dei blocchi sotto la piega: 180ms su opacità e 8px.
 *
 * Il CSS statico NON contiene alcun testo a opacity:0 — la classe .is-pending
 * viene aggiunta QUI, dopo il caricamento, e solo agli elementi che stanno
 * sotto la piega. Senza JavaScript, senza IntersectionObserver o con
 * prefers-reduced-motion tutto è visibile e fermo: la degradazione è lo stato
 * di partenza, non un ripiego. Come lo script delle date: locale, senza rete,
 * senza cookie — l'informativa resta vera.
 */
function scriptReveal() {
  return `    <script>
      (function () {
        if (!('IntersectionObserver' in window)) return;
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) { en.target.classList.remove('is-pending'); io.unobserve(en.target); }
          });
        }, { threshold: 0.12 });
        document.querySelectorAll('.ms-r').forEach(function (el) {
          if (el.getBoundingClientRect().top > innerHeight) { el.classList.add('is-pending'); io.observe(el); }
        });
      })();
    </script>`;
}

// ---------------------------------------------------------------------------
// Pagine legali
// ---------------------------------------------------------------------------
function legalPage(locale, key) {
  const c = CONTENT[locale];
  const doc = c.legal[key];
  const p = assetPrefix(locale);
  const canonical = `${SITE_URL}${LOCALE_PATH[locale]}${LEGAL_SLUG[locale][key]}.html`;

  const sections = doc.sections.map((s) => `
      <section>
        <h2>${esc(s.h)}</h2>
        ${s.p.map((x) => `<p>${esc(x)}</p>`).join('\n        ')}
      </section>`).join('');

  return `<!doctype html>
<html lang="${HTML_LANG[locale]}">
  <head>
${head(locale, { title: `${doc.title} — AI-Swisse`, description: doc.intro, canonical, legalKey: key })}
    <!-- Finché mancano ragione sociale, indirizzo e IDI, queste pagine dicono
         il vero ma non sono complete: non devono farsi indicizzare come se lo
         fossero. Con LEGAL_COMPLETE = true tornano index, follow. -->
    <meta name="robots" content="${LEGAL_COMPLETE ? 'index, follow' : 'noindex, nofollow'}" />
  </head>
  <body>
    <a class="skip" href="#main">${esc(c.skip)}</a>

${topbar(locale, c, { onLanding: false, legalKey: key })}

    <main id="main" class="narrow">
      <div class="legal-head">
        <p><a class="back-link" href="index.html">${icon('arrowLeft')}<span>${esc(c.legal.backToSite)}</span></a></p>
        <h1>${esc(doc.title)}</h1>
        <p class="section-lead">${esc(doc.intro)}</p>
        <p class="legal-updated">${esc(c.legal.updated.replace('{data}', dataCH(OGGI)))}</p>
      </div>
      <div class="legal-body">${sections}
      </div>
    </main>

${footer(locale, c, key)}
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Anteprima social: una pagina 1200×630 da fotografare per ottenere og.png.
// Non esiste un convertitore SVG→PNG su questa macchina, quindi l'immagine si
// produce aprendo questa pagina e catturandola. Il sorgente resta qui, così
// rifarla è una cosa di trenta secondi invece che un lavoro grafico.
// ---------------------------------------------------------------------------
function ogPage() {
  const c = CONTENT.it;
  return `<!doctype html>
<html lang="it-CH">
  <head>
    <meta charset="utf-8" />
    <title>AI-Swisse — anteprima social 1200×630</title>
    <link rel="stylesheet" href="style.css" />
    <style>
      /* Fondo pieno con l'accento del prodotto. Colori fissi e non token:
         l'immagine è un file PNG, non segue il tema di chi guarda. */
      html, body { margin: 0; padding: 0; background: #0b1220; }
      .og {
        width: 1200px; height: 630px; box-sizing: border-box;
        background: hsl(207, 88%, 32%);
        color: #fff; padding: 76px 84px; display: flex; flex-direction: column;
        justify-content: space-between;
        /* Lo stesso carattere della vetrina: style.css è collegato, quindi
           gli @font-face ci sono e fonts/ risolve. I pesi 800 del vecchio
           disegno renderebbero comunque 600: l'asse è limitato. */
        font-family: var(--ms-font);
      }
      .og-brand { display: flex; align-items: center; gap: 22px; }
      /* Il logo del titolare nella variante per fondi blu: blocco identico,
         wordmark bianco — l'azzurro del testo non leggerebbe sul campo. */
      .og-logo { height: 84px; width: auto; display: block; }
      .og-sub { font-size: 22px; opacity: 0.82; }
      .og-claim { font-size: 62px; font-weight: 800; line-height: 1.1; letter-spacing: -1.6px; max-width: 15ch; }
      .og-foot { display: flex; justify-content: space-between; align-items: flex-end; font-size: 24px; opacity: 0.9; }
      .og-langs { display: flex; gap: 12px; font-size: 20px; opacity: 0.8; }
    </style>
  </head>
  <body>
    <div class="og">
      <div class="og-brand">
        ${LOGO_SCURO}
        <div class="og-sub">${esc(c.tagline)}</div>
      </div>
      <div class="og-claim">${esc(plain(c.heroTitle))}</div>
      <div class="og-foot">
        <span>ai-swisse.com</span>
        <span class="og-langs"><span>Italiano</span><span>·</span><span>Deutsch</span><span>·</span><span>Français</span></span>
      </div>
    </div>
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Scrittura
// ---------------------------------------------------------------------------
// dist/ è una funzione pura di build.mjs + static/: si azzera e si
// ricostruisce. Senza questa riga i file orfani (prove locali, slug legali
// cambiati) sopravvivevano a ogni build — e dist si pubblica integralmente.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const tokens = readFileSync(join(ROOT, 'tokens.css'), 'utf8');
const styles = readFileSync(join(ROOT, 'style.css'), 'utf8');
const css = `${tokens}\n${styles}`;
writeFileSync(join(OUT, 'style.css'), css, 'utf8');
console.log('  css → dist/style.css (tokens.css + style.css)');

for (const locale of LOCALES) {
  const dir = locale === 'it' ? OUT : join(OUT, locale);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), page(locale), 'utf8');
  console.log(`  ${locale} → ${join(dir, 'index.html').replace(ROOT + '/', '')}`);
  for (const key of LEGAL_PAGES) {
    const name = `${LEGAL_SLUG[locale][key]}.html`;
    writeFileSync(join(dir, name), legalPage(locale, key), 'utf8');
    console.log(`  ${locale} → ${join(dir, name).replace(ROOT + '/', '')}`);
  }
}

writeFileSync(join(OUT, 'og.html'), ogPage(), 'utf8');

// Risorse statiche già pronte: l'anteprima social. È un PNG perché X e
// Facebook non renderizzano SVG, e su questa macchina non esiste un
// convertitore: è stata disegnata su canvas nel browser (il codice sta nel
// README) partendo dallo stesso testo e dallo stesso accento di og.html, che
// resta come sorgente leggibile per rifarla.
const STATIC = join(ROOT, 'static');
if (existsSync(STATIC)) {
  // `cpSync` ricorsivo: da quando i caratteri stanno in static/fonts/ la
  // copia file-per-file non basta più (copyFileSync su una cartella fallisce).
  for (const f of readdirSync(STATIC)) {
    cpSync(join(STATIC, f), join(OUT, f), { recursive: true });
    console.log(`  static → dist/${f}`);
  }
} else {
  console.log('  ! cartella static/ assente: og.png non copiata');
}

writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`, 'utf8');

const today = process.env.BUILD_DATE || '';
const urls = [];
for (const l of LOCALES) {
  urls.push(`${SITE_URL}${LOCALE_PATH[l]}`);
  // Una pagina con `noindex` dichiarata nella sitemap è una contraddizione:
  // si chiede di indicizzarla e le si dice di non farlo.
  if (LEGAL_COMPLETE) {
    for (const k of LEGAL_PAGES) urls.push(`${SITE_URL}${LOCALE_PATH[l]}${LEGAL_SLUG[l][k]}.html`);
  }
}
writeFileSync(
  join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc>${today ? `<lastmod>${today}</lastmod>` : ''}</url>`).join('\n') +
    `\n</urlset>\n`,
  'utf8',
);
console.log('  robots.txt, sitemap.xml');

// Versione autonoma: un file per lingua con il CSS incorporato, da aprire con
// un doppio clic senza server. Per la pubblicazione restano le pagine di dist,
// che tengono il foglio separato e quindi in cache fra una pagina e l'altra.
const ALONE = join(OUT, 'autonoma');
mkdirSync(ALONE, { recursive: true });
for (const locale of LOCALES) {
  let html = page(locale)
    .replace(/<link rel="stylesheet" href="[^"]*" \/>/, `<style>\n${css}\n    </style>`)
    // Niente preload dei caratteri né favicon: in un file aperto col doppio
    // clic i percorsi non risolvono. Il testo usa il carattere di sistema.
    .replace(/\s*<link rel="preload" href="[^"]*fonts\/[^"]*"[^>]*\/>/, '')
    .replace(/\s*<link rel="icon"[^>]*\/>/, '');
  // I collegamenti alle pagine legali sono relativi alla cartella della
  // lingua: in un file che vive da solo non risolverebbero. Qui diventano
  // assoluti verso il sito — funzioneranno quando sarà pubblicato, e nel
  // frattempo è chiaro dove puntano.
  for (const key of LEGAL_PAGES) {
    const slug = LEGAL_SLUG[locale][key];
    html = html.split(`href="${slug}.html"`).join(`href="${SITE_URL}${LOCALE_PATH[locale]}${slug}.html"`);
  }
  writeFileSync(join(ALONE, `ai-swisse-${locale}.html`), html, 'utf8');
  console.log(`  autonoma → dist/autonoma/ai-swisse-${locale}.html`);
}

console.log('\nFatto. Apri dist/index.html oppure servi la cartella dist/.\n');
