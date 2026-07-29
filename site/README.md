# Vetrina AI-Swisse — `ai-swisse.com`

Sito statico di presentazione del SaaS. L'applicazione vive altrove, su
**`app.ai-swisse.com`** (`~/swiss-ai-suite-app`): qui non c'è codice
applicativo, solo pagine HTML e un foglio di stile.

```bash
node sync-tokens.mjs   # allinea tokens.css ai token dell'app
node build.mjs         # genera dist/
```

```
dist/
  index.html            italiano   → https://ai-swisse.com/
  impressum.html  privacy.html  condizioni.html
  de/index.html         tedesco    → /de/     + impressum, datenschutz, nutzungsbedingungen
  fr/index.html         francese   → /fr/     + impressum, confidentialite, conditions
  style.css             tokens.css + style.css concatenati
  fonts/                Inter Tight variabile self-hostato + licenza OFL
  og.png                anteprima social 1200×630
  og.html               sorgente leggibile dell'anteprima
  robots.txt  sitemap.xml
  autonoma/             una pagina per lingua, CSS incorporato, da aprire con un doppio clic
                        (senza i font: su file:// i percorsi non risolvono, resta il carattere di sistema)
```

Per vederlo in locale: `python3 -m http.server 8745 --directory dist`
(c'è una voce `ai-swisse-landing` in `~/.claude/launch.json`).

## Ordine delle sezioni, e perché

promessa → come funziona → esempio → **i tre movimenti** (cosa arriva, cosa
diventa, cosa trova) → **automazioni** → verificabilità → lingue →
**quello che è giusto sapere** → prezzi → contatti.

Dal 2026-07-29 la sezione moduli non dice più «due moduli»: l'app ne ha
dieci di aree, e elencarle sarebbe un manuale. La forma vera sono tre
movimenti; Documenti è la memoria dentro «cosa diventa», le Automazioni
hanno una sezione propria perché cambiano categoria al prodotto — da
strumento che apri a cosa che lavora mentre non ci sei.

I limiti stanno **prima** dei prezzi di proposito: chi legge una cifra deve già
sapere che cosa il prodotto non fa. Metterli dopo sarebbe far firmare prima e
leggere poi.

«Chi c'è dietro» è stata **tolta su decisione del titolare** (2026-07-28): i
dati della persona restano nell'impressum, nell'informativa e nel foro
competente delle condizioni — dove la legge li chiede — non in vetrina.

## Regole sui contenuti

In `content.mjs` non si scrive nulla che il prodotto non faccia già. Non
compaiono:

- «prova gratuita» o «14 giorni» — non esiste un trial;
- «dati in Svizzera» — il progetto Supabase è a Francoforte (`eu-central-1`),
  quindi si scrive «in Europa», e lo si dice in una sezione dedicata invece che
  in fondo alla pagina;
- «ricerca automatica nel registro IDI» — ⚠️ aggiornamento 2026-07-29: Zefix è
  stato **provato contro l'API viva il 2026-07-28** (credenziali UFRC), quindi
  il divieto non è più «non funziona» ma «non ancora raccontato»: se lo si
  vuole in vetrina, va deciso apposta, non dedotto da qui;
- «in tempo reale» per l'Inbox — la cadenza vera è il cron dei 15 minuti,
  e il push Pub/Sub è rimandato per scelta;
- «Outlook / Microsoft 365» — l'adapter è completo ma i secret non sono
  impostati: l'app lo dichiara non configurato, la vetrina non lo nomina;
- **gestione multi-cliente per fiduciarie** — il modello dati regge, la porta
  non c'è: resta «direzione di sviluppo» negli assi dei prezzi.

Fino al 2026-07-29 questo elenco vietava anche «posta amministrativa
automatica» e «workflow»: oggi **esistono** (Inbox su cron da 15 minuti,
Automazioni 0020 con worker da 5 minuti) e la vetrina li racconta — coi loro
limiti dichiarati nella sezione limiti (solo Google, collegamento assistito,
sei inneschi e sei azioni tutte reversibili).

L'**esempio di risultato** è ricostruito con dati fittizi ed è etichettato come
tale. Non è uno screenshot: una schermata reale mostrerebbe la ragione sociale e
i documenti di un'impresa vera.

## Prezzi: perché non ci sono quattro schede

Il listino non è definito e nessun pagamento è implementato. Quattro cifre in
vetrina sarebbero destinate a cambiare, e il JSON-LD le avrebbe dichiarate ai
motori di ricerca come se fossero un'offerta ferma. La sezione dichiara che il
listino si sta definendo con le imprese pilota, elenca **gli assi su cui i piani
si differenzieranno** — che sono veri oggi — e porta al contatto.

Di conseguenza il blocco JSON-LD **non contiene `offers`**: dire una cosa alla
persona e un'altra al motore di ricerca è comunque dire una cosa falsa.

## Il campo e la firma

La pagina ha **un solo colore pieno e un solo gesto**, e vengono entrambi da
cose che esistono già.

**Il campo** è `--ms-field`, `hsl(207 88% 24%)`: il blu dei pulsanti
dell'applicazione portato alla profondità che serve perché il bianco ci stia
sopra (10,2:1). È **fisso nei due temi**, come la carta della lettera, e
compare **due volte**: la sezione d'apertura e quella di chiusura, piè di
pagina compreso. In mezzo la pagina è di carta.

⚠️ **Sul campo l'azione è bianca, non blu**: l'accento dell'app su questo
fondo fa 1,9:1. Primaria bianca piena, secondaria a contorno col bordo al
45% (3,35:1, sopra la soglia dei controlli).

⚠️ **La barra superiore resta chiara anche in home, ed è una decisione.**
Tingerla di blu era più d'effetto — la pagina si apriva tutta nel colore,
come fa magiq.ch col giallo — ma un campo senza bordo superiore è uno sfondo,
non un blocco; e soprattutto l'applicazione ha la barra chiara e il marchio
blu su bianco (verificato su `app.ai-swisse.com`). Invertire il marchio qui
avrebbe dato due lockup diversi allo stesso prodotto.

**La firma** è l'evidenziatore. Il prodotto marca in giallo la frase del
documento da cui viene un'informazione; la vetrina marca le proprie parole
allo stesso modo. Si scrive `[[parole]]` in `content.mjs` — il marcatore non
cambia una parola, quindi la linea editoriale resta quella — e `hl()` in
`build.mjs` lo trasforma in `<span class="ms-hl">`; `plain()` lo toglie per
`<title>`, meta e anteprima social.

Il giallo ha **due forme e ognuna significa una cosa sola**:

| forma | dove | significato |
|---|---|---|
| riempimento (`<mark>`) | solo dentro la carta | «questo è ripreso alla lettera da un documento» |
| tratto (`.ms-hl`) | solo sui titoli | «questa è una promessa nostra» |

Riempire un titolo produrrebbe una cancellatura, non una marcatura — e farebbe
passare una nostra affermazione per una prova citata, cioè la confusione che
il prodotto esiste per eliminare. **Regola: una sola evidenziazione per
schermata.** In tutta la pagina sono due, `heroTitle` e `ctaTitle`.

Il tratto usa `text-decoration-skip-ink: auto`: con `none` la coda della «g»
di «Aufgaben» finiva dentro il giallo, e bianco su giallo fa 1,22:1.

## Il disegno: «Protocollo», e lo strato --ms-*

La pagina è composta come un documento tecnico svizzero: sezioni numerate
01–09 con la stessa testata di protocollo, filetti hairline come ossatura,
tre registri di superficie — fondo pagina, banda elevata (esempio,
verificabilità, chiusura), e **una sola inversione totale d'inchiostro: i
limiti**. Il momento visivamente più solenne della pagina è l'elenco di ciò
che il prodotto non fa, di proposito.

Tutte le misure della vetrina (scala tipografica, griglia, spaziature,
superfici derivate) vivono in variabili con prefisso **`--ms-*`** dentro
`style.css`: un futuro `sync-tokens` non le tocca, e i COLORI restano quelli
dei token dell'app.

Il carattere è **Inter Tight** (SIL OFL, licenza in `static/fonts/OFL.txt`),
un solo file variabile per subset, self-hostato: nessuna risorsa remota,
come dichiara l'informativa. Tre scelte da conoscere:

- l'asse di peso è **limitato a 400–600 negli `@font-face`**: un
  `font-weight: 800` scritto per errore rende comunque 600;
- il subset `latin-ext` è dichiarato con il suo `unicode-range` ma non viene
  mai scaricato per it/de/fr: il browser lo chiede solo se serve un glifo;
- sotto i 600px l'H1 scende a `clamp(2rem, 9vw, 2.75rem)`: misurato,
  «dell'amministrazione,» è 396px a 44px su 327 utili — il minimo della
  scala desktop non può fisicamente stare in italiano su un telefono.

Gli script inline sono TRE, tutti locali, senza rete e senza cookie: il
JSON-LD, le date dell'esempio (vedi sotto), e la rivelazione allo scroll —
che aggiunge la classe `is-pending` DOPO il caricamento e solo agli elementi
sotto la piega, quindi nessun testo nasce a `opacity: 0`: senza JavaScript,
o con `prefers-reduced-motion`, tutto è visibile e fermo.

## Token: derivati, non copiati

`tokens.css` è **generato**: `node sync-tokens.mjs` estrae il blocco `:root` e
la sua variante scura da `src/styles/app.css` dell'applicazione.

Erano stati copiati a mano e avevano già iniziato a divergere — `theme-color`
era rimasto su un blu che l'accento dell'app non aveva più. Chi arriva dalla
vetrina e crea un account non deve avere l'impressione di cambiare prodotto.

```bash
node sync-tokens.mjs --check   # esce 1 se tokens.css è rimasto indietro
```

Per cambiare un colore: si cambia **nell'app**, poi si rilancia lo script.
`tokens.css` non va modificato a mano.

## L'anteprima social

`static/og.png` (1200×630) viene copiata in `dist/` dal build. X e Facebook non
renderizzano SVG e su questa macchina non c'è un convertitore, quindi è stata
disegnata su canvas nel browser e scaricata. `dist/og.html` resta come sorgente
leggibile: stessa promessa, stesso accento, apribile e fotografabile.

Per rifarla: aprire una pagina qualsiasi del sito e incollare nella console il
codice che disegna il canvas (è in fondo a questo file), oppure aprire `og.html`
e catturare l'area a 1200×630.

## Dati mancanti: campi vuoti, non segnaposto

**In produzione non compare nessuna parentesi quadra.** Dove manca un dato reale
la frase è scritta in modo da reggere senza; dove il dato è una voce a sé
(`aboutRole`, `aboutPlace`, `contactAddress`, `contactPhone`) il campo è una
stringa **vuota** e il generatore salta il blocco. Riempirlo è l'unica cosa da
fare quando il dato arriva.

`LEGAL_COMPLETE` in `content.mjs` governa impressum, privacy e condizioni.
**Oggi è `true`**: i dati del titolare sono arrivati il 2026-07-26.

| | `false` | `true` (oggi) |
|---|---|---|
| `<meta name="robots">` | `noindex, nofollow` | `index, follow` |
| collegamenti nel piè di pagina | assenti, resta solo l'email | presenti |
| pagine nella `sitemap.xml` | escluse (3 URL) | incluse (12 URL) |

Serve rimetterlo a `false` se un domani si aggiunge una pagina legale ancora da
compilare: pagine che dicono il vero ma non sono complete non devono farsi
indicizzare come se lo fossero.

### Dati del titolare

```
AI-Swisse, ditta individuale
Titolare: Andrea Cavalieri
Via Rovello 32, 6942 Savosa (Canton Ticino), Svizzera
```

Stanno in `content.mjs` e compaiono nell'impressum, come titolare del
trattamento nell'informativa, nei contatti e nel foro
competente delle condizioni d'uso.

## Le date dell'esempio non invecchiano

L'esempio in home page mostrava «31.08.2026 · Mancano 12 giorni»: già alla
pubblicazione era falso (mancavano 36 giorni) e dal 31 agosto la scadenza
sarebbe risultata passata. Una vetrina che dimostra come si leggono le scadenze
non può sbagliare la propria.

Ora la data è sempre a **40 giorni da oggi**: calcolata alla costruzione e
ricalcolata al caricamento da uno script inline di undici righe — nessuna
richiesta di rete, nessun cookie, niente che l'informativa non dichiari. Senza
JavaScript resta la data della costruzione, corretta al momento della
pubblicazione. La citazione dentro la lettera e quella nell'analisi vengono
dalla stessa fonte, quindi non possono divergere.

I formati seguono la convenzione di ciascuna lingua: `04.09.2026` ovunque nella
riga della scadenza, e per esteso nel corpo della lettera — «4 settembre 2026»,
«4. September 2026», «4 septembre 2026».

## Cosa manca

- **Il numero IDI/CHE**, se la ditta è iscritta al registro di commercio — in
  Svizzera l'obbligo scatta sopra una certa cifra d'affari. Le pagine sono
  scritte in modo da non presupporre l'iscrizione, quindi oggi sono corrette
  comunque; se il numero esiste, va aggiunto all'impressum.
- **Il telefono**: `contactPhone` è vuoto e il blocco non viene scritto. Basta
  riempirlo e compare nei contatti e nell'impressum, con il collegamento `tel:`.
- **La revisione di un legale** per le condizioni d'uso e per la base giuridica
  del trasferimento dei dati fuori dall'UE — oggi il fatto è dichiarato (il testo
  estratto va ad Anthropic, che ha sede negli Stati Uniti), la base giuridica no.
  È la prima cosa che chiederà un cliente attento.
- **Una rilettura madrelingua di tedesco e francese**, che il titolare ha deciso
  di non commissionare (2026-07-26). I testi sono stati rivisti internamente con
  i controlli verificabili — «ss» al posto di «ß», tipografia francese, forma di
  cortesia, coerenza dei termini, calchi dall'italiano, lunghezze a confronto —
  e le correzioni trovate sono state applicate. Il limite resta: chi ha riletto è
  lo stesso strumento che ha scritto, quindi una formulazione innaturale ma
  coerente con sé stessa non emerge da nessun controllo automatico.

## Il vecchio `~/ai-swisse-sito`

È un'altra cosa: `index.html` intitolato «Accendi la tua presenza digitale»,
un'offerta da agenzia digitale. Non è stato toccato.

---

### Rigenerare `static/og.png`

`dist/og.html` è il sorgente: stesso lockup, stesso claim, stessi colori della
vetrina (il canvas che viveva qui è stato tolto il 2026-07-29 — disegnava
ancora il vecchio marchio col «+», ed era una copia destinata a divergere).
Si fotografa a 1200×630:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars \
  --virtual-time-budget=6000 --window-size=1200,630 \
  --screenshot=static/og.png "http://localhost:8745/og.html"
```

(oppure si apre `og.html` nel browser e si cattura l'area a 1200×630).
Poi `node build.mjs` la copia in `dist/`.
