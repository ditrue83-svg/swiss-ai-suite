# Sistema di design — AI-Swisse

Documenta com'è costruita l'interfaccia e **perché**. Il codice sta in
`src/styles/app.css`; qui c'è ciò che il codice da solo non dice.

Per vederlo in funzione: <https://app.ai-swisse.com>.

## Il problema di partenza

L'interfaccia funzionava, ma non aveva un sistema. Misurato sul CSS prima
dell'intervento:

- **23 dimensioni di testo diverse**, fra cui 13.5px, 11.5px, 10.5px — valori
  che nessuno sceglie per principio: erano aggiustamenti fatti a occhio,
  schermata per schermata;
- spaziature libere fra 2 e 16px, senza un ritmo;
- **corpo del testo a 13px**, con sette punti a 10px o meno.

L'ultimo punto non era estetico. Chi usa questa applicazione legge importi,
scadenze e nomi di enti: è spesso il titolare di una PMI o chi le tiene i conti,
oltre i quarantacinque anni, di fretta.

## Il carattere

**Due famiglie, ospitate da noi, dal 2026-09-03**: **Manrope** per il corpo del
testo e **Sora** per titoli e numeri grandi. La divisione dei mestieri viene
dal mockup «Panoramica» approvato: Manrope porta bottoni, tabelle e moduli;
Sora porta ciò che si guarda prima — titoli e numeri dei KPI — dietro il token
`--font-display`. Prima c'era **Inter**, solo, dal 2026-08-10: i suoi file sono
stati rimossi con il cambio, e la loro storia resta nella cronologia git di
`fonts.css`. Prima ancora c'era lo stack di sistema (`-apple-system`, Segoe UI,
Helvetica…), che dava un prodotto diverso su ogni macchina.

**Non da Google Fonts, e non è una preferenza.** Un `<link>` a
`fonts.googleapis.com` farebbe partire dal browser di ogni cliente una richiesta
verso un servizio estero che ne vede l'indirizzo IP. L'informativa privacy
dichiara che l'applicazione non carica risorse esterne, e `public/_headers` lo
dice anche alla macchina: la CSP ammette `font-src 'self' data:`. Caricarlo da
fuori renderebbe falsa una dichiarazione fatta ai clienti. Vale per le due
famiglie di oggi come valeva per Inter.

| | |
|---|---|
| Famiglie | **Manrope** sul `:root` (`font-family`) e **Sora** su `--font-display` — ciascuna con lo stack di sistema come ripiego (`app.css`, `:root`) |
| Origine | i variabili ufficiali di `google/fonts` (SIL OFL, licenza in `public/fonts/`), fermati ai tre pesi |
| Ospitati | **da noi**, `public/fonts/` — mai da un CDN, vedi sopra |
| Pesi | **400** corpo · **500** etichette e navigazione · **600** titoli, numeri e grassetto, **per ciascuna famiglia**: sei file, e non ne esistono altri — il CSS non può chiederne |
| Peso dei file | ~104 KB in tutto (16-18 KB a peso) — il sottoinsieme dei caratteri che il prodotto usa davvero |
| Caricamento | `font-display: swap`; **precaricato il solo Manrope 400**, con `crossorigin` |
| Controllo | `npm run fonts:check` (sei impronte, copertura **letta dalla cmap dei file**, cablaggio, pesi chiesti) |

⚠️⚠️ **TRE PESI PER FAMIGLIA VUOL DIRE CHE 700 E 800 NON ESISTONO, e per tre
giorni i fogli di stile li hanno chiesti in 58 regole.** Era l'epoca di Inter,
ma la lezione non è del carattere: misurato a schermo il 2026-08-13, a 40 px la
stessa stringa occupava **257,73 px identici** a 600, 700, 800 e 900. Il
browser **non sintetizza** un grassetto — sceglie la faccia più vicina e
disegna **seicento**. Quindi `.kpi-value` a 800 e `.kpi-label` a 600 erano lo
stesso peso: un gradino di gerarchia scritto nel codice e **inesistente sullo
schermo**, che nessun controllo vedeva perché nessuno confrontava le due liste.
Le 58 regole sono state portate a 600 — un cambio che non sposta **un pixel**,
perché 600 è ciò che già rendevano — e `b, strong` ora dichiara 600 invece di
ereditare il 700 del browser (59 punti che rendevano un peso che il CSS non
diceva). `fonts:check` fallisce se una regola chiede un peso senza file.

**Se un giorno servisse un quarto peso**, il gesto è aggiungere il file *e*
la voce in `CARATTERI`: scrivere `font-weight: 700` e basta non aggiunge un
peso, lo fa solo sembrare.

⚠️ **La copertura si misura aprendo i binari, non leggendo la gamma chiesta al
subsetter.** Fino al 2026-08-13 `fonts:check` confrontava i dizionari con la
costante `GAMMA` — che chiede 556 codepoint, mentre i file di allora ne
disegnavano **445**. Centoundici erano dichiarati e assenti: un carattere fra
quelli sarebbe passato verde e a schermo l'avrebbe disegnato un altro font.
Oggi il controllo legge la tabella `cmap` dentro i `.woff2` (decompressione
brotli, tabella non trasformata) e verifica che **dentro ogni famiglia i tre
pesi coprano gli stessi caratteri** — altrimenti una parola in grassetto
cambierebbe carattere a metà. Con due famiglie c'è una domanda in più, e la
risposta è la più stretta possibile: la copertura dei dizionari si misura
sull'**intersezione** delle due cmap (Manrope 362 glifi, Sora 342, intersezione
**333**, letti dal controllo), perché un titolo può portare qualunque stringa
del corpo — e i dizionari ci stanno.

⚠️ **Il sottoinsieme «latin» di Google non andava bene, e il perché vale più
della scelta**: non contiene **U+202F**, lo spazio fine insecabile che tutta
l'interfaccia francese usa davanti a `: ; ! ?` e dentro i guillemets — quello che
`i18n:typography` impone. Ogni etichetta francese avrebbe avuto quel singolo
carattere disegnato da un altro font. Il difetto stava **dentro un file
binario**, dove nessuna rilettura del codice arriva: è emerso aprendo i `.woff2`
e chiedendo loro quali caratteri contenessero. `fonts:check` fa quella domanda a
ogni esecuzione della CI.

⚠️⚠️ **E la domanda andava rifatta sui file NUOVI, perché la risposta era
cambiata: né Manrope né Sora disegnano U+202F, e Sora non ha nemmeno U+2192**
(la freccia «→»). Scoperto il 2026-09-03 aprendo i candidati, non leggendo la
documentazione. I sei file serviti portano quei due glifi **trapiantati dai
file Inter storici**, riscalati all'em di destinazione — le unità per em sono
diverse (Manrope 2000, Sora 1000, Inter 2048), quindi il trapianto non è una
copia: è una conversione, descritta passo per passo nella testata di
`scripts/fonts-check.mjs`. La copertura dell'intersezione qui sopra include
quei due codepoint: se una rigenerazione li perdesse, il controllo diventerebbe
rosso sui dizionari francesi di domani, non su un ricordo.

### Che cosa il cambio ha spostato davvero — misurato, non previsto

- ⚠️⚠️ **Sora e Manrope hanno cifre PROPORZIONALI di default, come Inter —
  solo peggio.** Misurato il 2026-09-03 sui file: il «1» di Sora è largo
  0,42 em contro gli 0,659 em del «6». A 29 px, peso 600, sui numeri veri della
  Panoramica: «11» **24,4 px** contro «66» **38,2 px** — **13,8 px** di scarto
  fra due numeri di due cifre (Inter a 30 px ne dava 14,4: il suo «1» era
  stretto, quello di Sora lo è di più). I numeri della striscia stanno uno
  accanto all'altro e si confrontano a colpo d'occhio: senza intervento
  ballerebbero. Con `font-variant-numeric: tabular-nums` — la feature `tnum`
  c'è in tutti e sei i file, verificato — lo scarto è **zero**. La dichiara
  `.kpi-value`, e il commento accanto racconta la misura; per gli altri numeri
  che si confrontano (delta, importi e date in tabella, conteggi nelle
  pastiglie) c'è la classe `.num`, che porta Sora tabulare ovunque serva.
  **La regola scritta non basta: c'è un controllo** — `test:shell-unit` §8
  elenca le classi i cui numeri stanno in colonna e pretende la dichiarazione
  su ciascuna.
- **La larghezza di riga del testo è stata rimisurata, non tradotta.** `ch` è
  la larghezza dello **zero**: in Manrope lo zero misura 7,80 px a 13,5 px
  mentre il carattere medio di una frase italiana vera ne misura 6,26.
  `--measure` è passato da 52ch (per lo zero largo 9,46 px di Inter a 15 px) a
  **56ch** = 437 px ≈ **70 caratteri** del testo reale, contati sul riassunto
  di un'analisi con il font servito. Il dettaglio sta in «Colonna di lettura».
- ⚠️ **`hyphens: auto` nelle CELLE DI TABELLA era stato provato e SCARTATO ai
  tempi di Inter, e la sentenza non è cambiata.** In una colonna da 66 px
  spezza «Aus-glei-chs-kas-se» una sillaba per riga e porta l'intestazione da
  35 px a 128 px: peggiora ciò che dovrebbe risolvere. Le larghezze restano
  automatiche (regola 6) e non è stata introdotta nessuna misura fissa.
- ✅ **La stessa dichiarazione resta GIUSTA nella barra laterale**, ed è la
  prova che la regola non è la proprietà ma la misura. Rimisurato su Manrope
  il 2026-09-06: `Unternehmenseinstellungen` — parola sola di 25 caratteri,
  nessun punto di rottura naturale — misura **173,2 px** a 13,5 px contro i
  ~148-164 utili nella colonna (che dal restyle è 236 px, 252 da ≥1280 px:
  vedi «La cornice»). Usciva già con lo stack di sistema e con Inter. Con
  `hyphens: auto` sull'etichetta la voce diventa «Unternehmenseinstel-lungen»,
  con il trattino su una sillaba valida; `overflow-wrap: break-word` avrebbe
  dato «Unternehmenseinstellun|gen», che in tedesco è sbagliato.
- ⚠️ **Le cifre tabulari sono più LARGHE, e una colonna fissa se ne accorge** —
  storia del 2026-08, ancora vera. `.bar-val` stava in una traccia di griglia
  di 42 px (34 sotto i 600 px): «100 %» misurava 38,3 px con le cifre tabulari
  — e ne misurava già **35,7** senza, quindi sul telefono usciva dalla propria
  colonna **da prima**. La traccia è passata a `max-content`, che in una
  griglia vale per tutta la colonna: le barre restano allineate fra loro e la
  colonna prende la misura del numero più largo. Regola 6: mai una larghezza
  fissa attorno a un contenuto che può crescere.
- **La stampa non tocca il carattere**: il blocco `@media print` cambia i
  colori, non `font-family`, e `test:print-unit` lo presidia. L'ultima prova
  su un PDF vero — i pesi incorporati come sottoinsiemi, U+202F e
  `é à œ « » —` presenti nel documento — è del periodo Inter: con due famiglie
  va riaperta, e questa riga è il promemoria.

## Il marchio

Un **wordmark**, non un'icona: blocco pieno con la sigla **AI**, poi la parola
**Swisse**. Sta in `BrandMark.tsx` e compare in nove punti (barra laterale,
barra del telefono, drawer, le quattro schermate di autenticazione,
la configurazione mancante, l'onboarding).

**Non è un segno inventato qui, e dal 2026-08-14 non è nemmeno un segno
ricomposto.** Fino a quel giorno il componente lo riscriveva come testo in
Inter — blocco, sigla e parola — con la motivazione che il prodotto parlava in
Inter. Il difetto si vedeva nella stessa scheda del browser: la favicon
portava già i contorni veri del marchio e la barra ne mostrava una
ricostruzione, due disegni dello stesso segno a due centimetri di distanza.
Un marchio ricomposto è un marchio somigliante, e un marchio somigliante è un
secondo marchio. Ora il segno è **uno**: i contorni stanno in `brandArt.ts`,
copiati dall'artefatto che il titolare serve su ai-swisse.com e sorvegliati
glifo per glifo da `npm run brand:check`. Chi arriva dalla vetrina e apre
l'applicazione riconosce lo stesso marchio, non ne crede due. La scelta non
dipende dal carattere del momento: è passata indenne attraverso Inter e il
passaggio a Manrope e Sora del 2026-09-03 proprio perché il segno non è
composto in nessun font.

Che cosa c'era prima, e perché non andava:

| | |
|---|---|
| fino al 2026-08-12 | il path di `plus` in un quadrato accent — un **comando** nella posizione del nome |
| dal 2026-08-12 | una «S» a tratto nello stesso quadrato — la forma dell'**avatar**, e una lettera che il marchio non usa |
| dal 2026-08-13 | il wordmark, ricomposto come testo |
| dal 2026-08-14 | il wordmark **in contorni**, copiato dall'artefatto del titolare |

⚠️ **Il difetto che nessuna delle due sostituzioni aveva tolto**: il contenitore
pesava quanto la campanella accanto. Un quadrato pieno di 32 px e un pulsante di
40 px affiancati sono **due scatole di pari grado**, e il marchio non è un
accessorio della campanella. Togliendo la scatola, il grado torna a dirsi da sé:
il nome è il wordmark, la campanella è un glifo senza fondo. (Dal 2026-09-06 i
due non dividono nemmeno più una riga: la campanella vive nella barra in cima,
a mount unico — vedi «La cornice».)

⚠️ **Il raggio del blocco NON è `--radius-sm`.** Quello è il raggio dei
controlli — pulsanti, hamburger, campi. Un blocco con lo stesso raggio dei
pulsanti torna a leggersi come qualcosa da premere, che è l'errore da cui si
viene per due volte. Il blocco usa `var(--sp-1)`.

**Il nome non si traduce, la riga sotto sì.** «AI-Swisse» vive in un posto solo,
`brand.name` dei dizionari, e il componente lo **divide sul trattino**: non è
scritto a mano da nessuna parte (`i18n:coverage` uscirebbe 1). `test:shell-unit`
§3b pretende che tutti e tre i dizionari si dividano e che il nome sia identico
nelle tre lingue.

⚠️ **La favicon è il posto in cui la scelta dei contorni è NATA, e la ragione è
tecnica, non estetica.** Un `data:` URI non carica risorse esterne — è tutto il
punto della CSP — quindi un `<text>` lì dentro sarebbe disegnato dal carattere
di sistema, diverso su ogni macchina. Il segno va in **contorni**, e i contorni
sono gli stessi di `brandArt.ts` e della vetrina: una scheda aperta su
ai-swisse.com e una aperta sull'applicazione mostrano lo stesso segno.
`test:shell-unit` §3 lega i due colori ai token e rifiuta un `<text>`.

**Che cosa NON è sorvegliato, e va detto**: che il segno dell'app e quello della
vetrina restino uguali. `site/` è una base di codice separata, invisibile da
questo albero — nessun controllo di qui può leggerla. Se il marchio cambia, i
due posti si aggiornano a mano, e sono due.

## Scala tipografica

Sei gradini per il testo più **uno fuori scala per i numeri grandi**, uno per
compito. Se un testo non rientra in nessuno, il problema è la gerarchia, non la
scala. Dal 2026-09-06 i valori sono quelli contati sulle classi del mockup
«Panoramica» approvato — non aggiustamenti a occhio:

| Token | Valore | Uso |
|---|---|---|
| `--fs-eyebrow` | 10,5px | etichette di gruppo maiuscole, con `--ls-eyebrow` 0,16em |
| `--fs-label` | 12,5px | etichette, pastiglie |
| `--fs-meta` | 11,5px | metadati, didascalie |
| `--fs-body` | 13,5px | corpo del testo |
| `--fs-strong` | 14,5px | titoli di scheda e di riga |
| `--fs-h2` | 16,5px | titoli di sezione |
| `--fs-h1` | 17px | titoli di pagina |
| `--fs-kpi` | 29px | i numeri della Panoramica — **fuori scala**, con `--ls-kpi` −0,03em e cifre tabulari |

⚠️ **La base è SCESA da 15px a 13,5px** — inversione della scelta del
2026-08-10, che l'aveva alzata per «chi legge importi e scadenze». Non è un
risparmio di pixel: è la densità da cruscotto del mockup, dove la gerarchia
cambia mestiere — non sono più i **titoli** a portare il peso della pagina (il
più grande è 17px) ma i **numeri**, in Sora 29px a cifre tabulari. E il corpo
è davvero più piccolo: l'occhio di Manrope (0,540em) è praticamente quello di
Inter (0,546em), quindi non c'è un guadagno di disegno a compensare. La
controprova che 13,5px basti è la verifica a schermo — in coda al restyle —
non una misura di font.

⚠️ **Una gerarchia si dichiara con i gradini che ci sono, non aggiungendone uno
di troppo** — e la storia di questa riga ha tre atti. La Panoramica aveva
cinque schede numeriche identiche su una griglia da quattro colonne — un 3+2
con un buco in fondo, una forma che nessuno aveva scelto — e cinque numeri
della stessa misura non dicono quale guardare per primo. Primo atto
(2026-08-11): la metrica principale tiene `--fs-h1` e le altre **scendono** a
`--fs-h2` — trenta contro ventidue, più il doppio di superficie. Secondo atto
(2026-08-14): «Azioni da completare» esce (regola 13) e la scheda grande
diventa «Attività aperte», in un rapporto 1:2. Terzo atto (2026-09-06): il
mockup fonde la striscia in **una scheda sola divisa da filetti** (`.kpi-grid`,
l'eccezione del gap da 1px è dichiarata nel CSS: è lo spessore del filetto,
non spaziatura) e tutti i numeri stanno a `--fs-kpi`. Il 29px non contraddice
la lezione: non è un settimo titolo — è l'unico testo pensato per essere letto
da lontano, e sta fuori dai sei gradini perché non è un compito del testo, è
il dato che la pagina serve. Il gradino che manca è quasi sempre un gradino di
troppo da qualche altra parte.

Quante regole rispettino la scala non lo dice questo file: lo dice
`npm run design:lint`, che fallisce su ogni `font-size` in pixel. Un conteggio
scritto qui invecchierebbe al primo commit che non lo aggiorna — è già successo
ai numeri che stavano in questa riga. Le due sole eccezioni ammesse —
pseudo-elementi la cui misura dipende dal cerchio che le contiene — sono
dichiarate nello script, con il motivo accanto.

**Nessuna nuova regola deve usare px per il testo.**

## Spaziature

Multipli di 4: `4px` · `—` · `—` · `—` · `24px` · `—` · `—`
(`--sp-1` … `--sp-12`), più un mezzo gradino: **`--sp-05: 2px`**.

Il ritmo fra gli elementi lo fanno i multipli di 4; `--sp-05` è l'anatomia
**dentro** un elemento — il respiro verticale di una pastiglia, una pila
fitta, l'allineamento di un'icona alla prima riga. È nato il 2026-08-10 da
53 eccezioni di `design:lint` che dicevano tutte la stessa cosa: quando una
lista di eccezioni cresce con lo stesso motivo, non mancano eccezioni, manca
un gradino. Nominato il gradino, le 53 righe sono tornate scala. Restano
eccezioni i **negativi** (un margine che risale compensa qualcosa di
specifico: la scala non parla in negativo) e gli idiomi come `sr-only`.

Nel markup le distanze si scrivono con le utilità in coda a `extra.css`
(`.m-0`, `.mt-2`, `.py-2`, …): prendono i valori **solo** dalla scala, e un
`style={{ marginTop: 8 }}` non passa il lint. Quando un elemento ne accumula
più di due, quello che si sta descrivendo è un componente e va nominato nel
CSS.

## Superfici

Tre livelli, e la regola è che si sceglie **uno per blocco**, non «scheda o
niente».

| Token | Che cos'è | Per che cosa |
|---|---|---|
| `--surface-1` | fondo proprio (`--card`), bordo, ombra, angoli | ciò che si **legge**: l'analisi, il prossimo passo |
| `--surface-2` | nessun fondo, un filetto (`--surface-rule`) sopra | ciò che si **consulta**: attività, CRM, organizzazione |
| `--surface-3` | nessun contenitore | ciò che si **scorre**: una riga di metadati |

Le classi si chiamano come i token; `.card` **è** `.surface-1` — lo stesso
selettore, non una copia, perché due regole con gli stessi valori sono due
verità che divergono al primo ritocco.

⚠️ **Il livello 2 e il livello 3 sono trasparenti di proposito.** Un terzo
grigio appena diverso sarebbe un valore da mantenere in due temi per non dire
niente in più. Un blocco piano si stacca dal precedente con un **filetto**, una
riga inline non si stacca affatto: è testo con un'etichetta accanto.

Il perché di tutto questo sta in una schermata sola. Il dettaglio di un
documento metteva in una `.card` l'analisi, il prossimo passo, le attività, il
CRM, l'organizzazione, le informazioni tecniche, l'eliminazione **e** l'origine
— quest'ultima una scheda intera per una riga di testo. Sette contenitori
identici non fanno gerarchia: la fanno sparire, e a quel punto a dire che cosa
conta resta solo la posizione, che è un ripiego.

**La forma del livello 1 è quella del «panel» del riferimento** (dal
2026-09-06): fondo `--card`, bordo `--line`, raggio `--radius` e ombra
`--shadow-sm` — che **è** la `shadow-panel` del file, tradotta in sRGB: un filo
a contatto e una sola ombra lunga e stretta (−18px di spread), tinta
`rgb(8, 24, 34)`, perché non sporchi i lati. Al passaggio del puntatore, chi
risponde davvero porta `.panel-hover` e l'ombra sale a
`--shadow-panel-hover` — non è di serie su `.card`: un sollevamento che
distingue tutto non distingue niente. I raggi sono tre, dal riferimento:
**`--radius: 10px`** per pannelli, bottoni e campi, **`--radius-md: 8px`** per
le voci di navigazione, **`--radius-sm: 6px`** per i piccoli contenitori
(erano 12 e 8). L'unica ombra colorata è **`--shadow-cta`**, tinta `#37AEEF`:
la portano il marchio e `.btn-primary`, e basta — nel mockup sta sotto il
blocco della sigla e il bottone della barra in cima. In tema scuro si abbassa
al 35%: sul nero pieno diventerebbe il «glow» che la versione chiara dichiara
vietato.

⚠️ **`--surface-2` è un nome riciclato, e la storia è la solita.** Fino al
2026-08-11 quel nome apparteneva al riempimento tenue delle pastiglie neutre e
degli hover — un **colore**, non un livello. Nominando i tre livelli sarebbe
diventato il secondo `--surface-2` della stessa palette: esattamente il guasto
di `--amber` usato sia per scrivere sia per riempire, che aveva prodotto il
marrone della barra «Media» che nessuno aveva scelto. Il riempimento ora si
chiama **`--fill-subtle`**, che è quello che è.

⚠️⚠️ **E quel rename è costato una riparazione, perché i token di questo file
non sono solo dell'app**: la vetrina li deriva, e il suo `style.css` usava
`--surface-2` in cinque punti come fondo — che dopo il rename valeva
`transparent`. Come si evita la prossima volta: **regola 12**, in fondo.

## Colonna di lettura

Due misure diverse, e confonderle è ciò che faceva correre il riassunto di
un'analisi per tutta la larghezza dello schermo:

| Token | Valore | Che cosa limita |
|---|---|---|
| `--measure` | `56ch` | il **testo corrente** (`.prose`): circa settanta caratteri |
| `--content-max` | `880px` | la **colonna di contenuto** (`.reading-col`) di una pagina di lettura |

Tabelle ed elenchi possono superare la prima — sono strutture, non prosa — ma
non la seconda.

⚠️ **`56ch` e non `70ch`, ed è misurato, non stimato.** `ch` è la larghezza
dello **zero**, e in Manrope lo zero misura 7,80 px a 13,5 px mentre il
carattere medio di una frase italiana vera ne misura 6,26. Scrivere `70ch` per
«settanta caratteri» darebbe una riga da **87** caratteri: diciassette in più
di quelli voluti, cioè il difetto che si stava correggendo. `56ch` = 437 px ≈
**70 caratteri**, contati sul riassunto di un'analisi con il font servito. Il
valore è stato **rimisurato il 2026-09-03** nel passaggio da Inter a Manrope —
era 52ch, per lo zero largo 9,46 px di Inter a 15 px — esattamente come la
riga qui sotto prescriveva: il conteggio dipende dal **carattere**, non dalla
lingua, e quando cambia il carattere questo numero va **rimisurato**, non
tradotto.

## Una sola azione primaria per schermata

Il dettaglio di un documento aveva **sei pulsanti prima del contenuto**, su tre
righe, tutti dello stesso peso: fra «Analizza» e «Elimina» non c'era nessuna
differenza visiva. Un pulsante distruttivo con lo stesso peso di quello che si
deve premere non è una scelta offerta, è una trappola lasciata aperta.

La riga delle azioni (`.action-bar`) ha tre posti, e l'ordine significa:

1. **la primaria**, una sola — l'azione del momento, quella che «Prossimo passo»
   indica;
2. **le secondarie**, in una riga, `btn-sm`;
3. **il trabocco** (`ActionMenu`, il pulsante `⋯`), staccato da un margine
   automatico: ciò che è raro (archivia, stampa) o irreversibile (elimina).

⚠️ **La decisione si rende in un posto solo.** La primaria è la stessa che il
riquadro «Prossimo passo» spiega, e la disegna lo stesso codice
(`NextStepPrimary`/`NextStepSecondary` in `NextStepCard.tsx`): riordinare i
pulsanti senza unificarli avrebbe solo spostato il problema, perché due punti
che rendono la stessa decisione prima o poi ne rendono due diverse. Per la
stessa ragione «Analizza» è sparito dal riquadro dell'analisi e «Apri analisi
completa» — che compariva **due volte** nella pagina — vive solo dentro la
scheda Analisi.

⚠️ **Una voce distruttiva nel menu è testo rosso, mai un fondo pieno.** Dentro
un menu una riga rossa piena grida quanto un avviso, e lì non c'è nessuna
emergenza: c'è un comando che non si può disfare, e a dirlo è la conferma che
segue. La conferma compare **dove è stata chiesta**, in cima; la vecchia scheda
«Eliminazione definitiva» in fondo a ogni documento era un avvertimento
permanente, e un avvertimento permanente si smette di leggere.

⚠️ **Un interruttore non è un'azione primaria.** «Attivi/Archiviati» e
«Mostra filtri» usavano `btn-primary`, cioè il blu d'azione, sulla stessa
schermata di «Carica documento»: due pulsanti blu che chiedevano la stessa
attenzione per due cose che non si somigliano — uno **carica**, l'altro cambia
soltanto quello che si sta guardando. Lo stato premuto ora è una superficie
(`.btn-toggle[aria-pressed="true"]`), e i due estremi si toccano (`.segmented`)
perché sono un interruttore, non due pulsanti vicini.

⚠️ **Dal 2026-09-06 esiste un primario che sta SOPRA la schermata, e non è un
concorrente di questa regola.** «Carica documento» vive nella barra in cima
(vedi «La cornice»), su ogni pagina: porta ad «Analizza documento» con il
modulo di caricamento già aperto — il gesto da cui comincia il lavoro del
prodotto. Appartiene alla cornice, non al contenuto: la regola dei tre posti
continua a valere **dentro** la schermata, dove la primaria resta quella che
«Prossimo passo» indica.

## La cornice: la colonna e la barra in cima

Dal 2026-09-06 la struttura è quella del riferimento `panoramica-ai-swisse.html`:
una colonna laterale a sinistra e — **a ogni larghezza** — una barra in cima
alla colonna di contenuto. La colonna destra che le contiene entrambe è nuova
(`.shell-body`): prima la barra era `display: none` sopra i 900px e il telefono
ne aveva una tutta sua.

**La colonna** è larga 236px, 252 da ≥1280px — le due larghezze del
riferimento; era 264. La voce attiva è una pastiglia `--accent-soft` con la
**barretta** `::before` di 3px a filo del bordo sinistro, alta quanto il testo:
è la forma del mockup, non il filetto tolto il 26.08 — la differenza è la
misura e la posizione. In fondo, sopra il box account, c'è il riquadro «**Dati
in Svizzera**» (`.data-box`, scudo con spunta, tradotto nelle tre lingue): una
promessa del prodotto, non una voce di navigazione. Il badge numerico è **UNO
SOLO**, su «Documenti»: porta il conteggio condiviso della shell
(`useAttentionCount`, i documenti «da verificare» attivi) — la stessa
definizione della colonna «Richiede attenzione» della Panoramica e della
destinazione del suo collegamento (`/documenti?stato=to_verify`), perché un
numero qui e un numero diverso là sarebbero due verità. Una sola
interrogazione, rinfrescata al cambio di azienda e di pagina: un badge per voce
costerebbe una richiesta per voce per cambio pagina, ed è la ragione per cui il
secondo numero del mockup — la posta non letta — resta fuori. **Esc chiude il
drawer**, come già faceva per la campanella e le finestre: un tasto chiude una
cosa sola.

**La barra in cima** è alta 68px (`--topbar-h`), resta appiccicata mentre il
contenuto scorre sotto, ed è una **velatura**: `color-mix` all'85% della
`--card` di qualunque tema più sfocatura — il `bg-panel/85` del riferimento,
senza bisogno di un token nuovo; in tema scuro torna piena, perché la
trasparenza lascerebbe leggere il contenuto in trasparenza. Da sinistra porta:

- il **percorso** della pagina (`.crumbs`): sezione › voce, letto da `NAV` e
  `NAV_SETTINGS` — la stessa struttura che mostra la colonna. Sparisce sotto i
  900px: lì il «dove sono» lo porta già il titolo della pagina, e lo spazio
  serve ai comandi;
- il **campo che apre la ricerca rapida** (⌘K): un `<button>` vestito da
  campo. Il riferimento lo disegna come un input, ma ciò che fa è *aprire* un
  riquadro — e un controllo che ne apre un altro è un pulsante, con
  un'etichetta per chi non vede. Sotto i 900px lo sostituisce la lente sola,
  stessa scatola dell'hamburger. Il «⌘K» è un'espressione JSX apposta: quel
  glifo non è nel sottoinsieme dei caratteri serviti, quindi non può vivere
  nei dizionari che `fonts:check` pesa;
- la **pastiglia «richiede attenzione»**: un collegamento alla lista filtrata,
  con **lo stesso numero** del blocco della Panoramica — il conteggio
  condiviso della shell. Ambra e non rossa: è lavoro ordinario che aspetta,
  non un allarme. Il punto che pulsa è quello del riferimento (due dischi
  sovrapposti, quello sopra cresce e svanisce); chi chiede meno movimento
  perde l'alone e tiene il disco fermo. A zero non si mostra: «niente da
  verificare» non è un segnale;
- la **campanella**, a mount **UNICO**: fino al 2026-09-05 stava anche accanto
  al marchio della colonna — montata due volte, una per formato, e il CSS ne
  nascondeva una;
- la **CTA «Carica documento»** → `/admin?carica=1`, che apre direttamente il
  modulo di caricamento. L'etichetta sparisce sotto i 600px, l'`aria-label`
  no.

**La ricerca rapida** (`components/layout/CommandPalette.tsx`, nuova) è un
dialogo modale in un **portale**: la barra in cui nasce ha `backdrop-filter`,
e un antenato con filtro diventa il blocco di contenimento per
`position: fixed` — il velo coprirebbe la barra e basta. È un **combobox**
secondo il pattern APG: il fuoco è uno solo, il campo; le frecce muovono
l'opzione corrente (`aria-activedescendant`), Invio la apre, Esc chiude in
cattura — sotto potrebbe esserci il drawer, che ha il suo Esc. Tre gruppi —
**Pagine, Documenti, Attività**, alimentati dai servizi veri — cinque voci per
gruppo: è un lanciatore, non un archivio. Le ricerche partono dopo **200ms** di
silenzio, non a ogni tasto («con», «cont», «contr» sarebbero tre
interrogazioni per una sola intenzione); un guasto di **un** servizio spegne
**un** gruppo, che dichiara perché è vuoto invece di fingersi senza risultati.
Ogni apertura riparte da campo e lista vuoti: una ricerca che mostra la query
di ieri sembra una risposta già data — e non lo è. Tradotta nelle tre lingue.

## Le utility del riferimento

Il restyle non ha copiato il mockup classe per classe: ha cercato le
**controparti**, e dove esistevano già la sovrapposizione è dichiarata nel
CSS, non duplicata:

| Riferimento | Nell'app |
|---|---|
| `panel` | **È `.card`** — stesso fondo, bordo, raggio e ombra (e già identica a `.surface-1`) |
| `pill` | **È `.badge`** con le sue varianti, dietro il componente `Tag` |
| `meter` | **È `.meter-track` + `.meter-fill`** — traccia da 3px dal 2026-09-06; `.meter-fill.ok` verde a completamento: «fatto» è lo stato verificato, non una quantità d'accento in più |
| `num` | `.num`, **nuova**: Sora a cifre tabulari e tracking chiuso, per i numeri che si confrontano fuori dai KPI |
| `eyebrow` | `.eyebrow`, **nuova**, per gli header di pannello — in shell la portano già `.nav-section` e `.brand-sub.caps` |
| `panel-hover` | `.panel-hover`, **nuova**: il sollevamento dell'ombra, solo per chi risponde davvero al puntatore |
| `row-hover` | `.row-hover`, **nuova**: il fondo appena azzurrato della riga (70% di `--accent-soft`) |
| `table` | `.table` + `.table-scroll`, **nuove**: testata a fondo canvas con eyebrow, corpo a filetti tenui, hover di riga; `min-width: 620px`, e lo scorrimento orizzontale sta nel contenitore — che è ciò che scorre |

Dove si vedono: la colonna «**Richiede attenzione**» della Panoramica — pallino
di stato (rosso se il termine è già passato, ambra pieno se è in coda),
`.row-hover` sulle righe, importi e date `.num`, il chevron «vai» che compare
all'hover **e al focus da tastiera**, «Vedi tutti» a tutta larghezza con il
filetto sopra; `.panel-hover` sulle schede della Panoramica e sulla striscia
KPI; le tabelle IVA e le righe delle fatture migrate alla `.table` globale, con
l'eyebrow **solo in testata**: un `th scope="row"` nel corpo è il nome della
riga, non un titolo di colonna, e maiuscoletto grigio lo renderebbe
irriconoscibile.

## Colore

Dal 2026-09-06 neutri e stati sono i **valori sRGB calcolati dagli oklch del
riferimento** `panoramica-ai-swisse.html` (canvas `0.988/0.003/240`, ink
`0.235/0.021/249`, graphite `0.468/0.022/249`, line `0.923/0.007/245`): l'sRGB
è come il browser li rasterizza. Un'eccezione dichiarata: lo «sky» del file è
`#44B3ED`, ma **`--accent` resta `#37AEEF`** — il colore scelto dal titolare il
2026-08-17, pinnato da `brand:check`: la tinta segue il marchio, non il mockup.

| Token | Valore | Ruolo |
|---|---|---|
| `--accent` | `#37AEEF` | riempimenti, filetti, stati attivi — sopra ci si scrive **scuro** |
| `--accent-dark` | `hsl(201, 85%, 48%)` | hover del primario: qui l'accento è chiaro, quindi l'hover **scende** |
| `--accent-text` | `hsl(201, 85%, 27%)` | testo e collegamenti (7,92:1 su bianco) |
| `--accent-soft` / `--accent-line` | `#E8F6FE` / `hsl(201, 58%, 82%)` | fondi tenui / bordo di ciò che vi sta sopra |
| `--on-accent` | `hsl(213, 35%, 10%)` | testo sopra l'azzurro (7,14:1; il bianco farebbe **2,48:1**) |
| `--ink` | `#161F28` | testo principale |
| `--ink-soft` | `hsl(213, 22%, 30%)` | testo secondario |
| `--muted` | `#515C66` | metadati (il «graphite» del riferimento) |
| `--bg` / `--card` | `#F9FBFD` / `#ffffff` | canvas del riferimento / superficie delle schede |
| `--line` / `--line-strong` | `#E2E6EA` / `#D2D8DD` | bordi / bordi marcati (hover, stati attivi) |
| `--fill-subtle` / `--track` | `#F1F5F8` / `#E6EBEF` | hover neutri («secondary») / fondo delle barre («sunken») |
| `--red` / `--red-dark` | `#DC3336` / `#B31C21` | **urgente**: il primo riempie, il secondo porta testo |
| `--amber` / `--amber-fill` | `#925303` / `#E8941B` | **azione a breve**: scrive / riempie |
| `--green` / `--green-fill` | `#1C6844` / `#419E6E` | **verificato**: scrive / riempie |
| `--red-soft` / `--amber-soft` / `--green-soft` | `#FFEBEA` / `#FFF1DA` / `#E2F9EC` | fondi tenui degli stati |
| `--line-subtle` | `rgba(127, 127, 127, 0.15)` | separatori dentro una scheda; il grigio al 50% con alfa bassa regge su entrambi i temi, e per questo non ha una variante scura |
| `--scrim` | `rgba(16, 24, 40, 0.4)` | velo dietro un cassetto aperto (era scritto due volte, con due valori diversi) |
| `--on-highlight` | `hsl(45, 60%, 12%)` | testo sopra l'evidenziazione della citazione |
| `--focus` | `hsl(201, 88%, 42%)` | anello del focus da tastiera |

La gerarchia dei grigi resta a tre: `--ink-soft` non è sceso al livello del
graphite dei metadati — il riferimento ha due soli grigi, l'app ne ha tre e il
secondario non poteva confondersi col «muted».

**La scala semantica è quella del riferimento**: azzurro = informazione,
ambra = azione a breve, rosso = urgente, verde = verificato. Non è
decorazione: dice quanto manca a una scadenza e se un'azione è stata svolta.
Resta separata dal colore d'azione, così un pulsante non compete mai con un
avviso.

⚠️ **L'hover del primario NON è lo «sky-deep» del riferimento, e la deviazione
è voluta — «fedele ma accessibile».** Quel valore (oklch `0.585/0.135/240`, il
`--color-sky-deep` del file) con il testo scuro `--on-accent` farebbe
**4,33:1**, sotto la soglia AA di 4,5. `--accent-dark` è il valore più fondo
che resta sopra: **5,73:1** (conto e motivo nel commento del token, in
`app.css`).

⚠️ `--red` serve a barre, bordi e riempimenti. Per il **testo** si usa
`--red-dark`: il primo non raggiunge il contrasto minimo su fondo chiaro.

⚠️ **Ambra e verde hanno la stessa doppia natura, e per un po' non l'avevano.**
`--amber` e `--green` erano stati scuriti per raggiungere il contrasto AA come
*testo* sulle pastiglie, poi riusati come *riempimento* delle barre: da lì il
marrone della barra «Media» nella dashboard, che nessuno aveva scelto. Ora
esistono `--amber-fill` e `--green-fill`, esattamente come il rosso aveva già
`--red` (riempie) e `--red-dark` (scrive). **Un colore che deve essere leggibile
e un colore che deve essere riconoscibile non sono lo stesso colore.**

## Contrasti

Verificati con il calcolo WCAG, non a occhio, e **ricalcolati dai token il
2026-09-06** — neutri e stati nuovi, stessa formula della sezione 12 di
`test:shell-unit`, che li ripesa a ogni esecuzione.

⚠️ **La colonna del fondo non è un dettaglio**: fino al 2026-08-13 questa
tabella non diceva contro quale superficie fossero misurati i rapporti, e i
numeri si riproducono solo su `--card`. Le stesse tinte su `--bg` danno valori
diversi (16.06 · 7.64 · 6.59): una tabella senza il fondo è una tabella che non
si può verificare.

| coppia | fondo | chiaro | scuro |
|---|---|---|---|
| testo principale (`--ink`) | `--card` | **16.66:1** | **13.47:1** |
| collegamenti (`--accent-text`) | `--card` | **7.92:1** | **8.68:1** |
| testo sul pulsante (`--on-accent`) | `--accent` | **7.14:1** | **7.14:1** |
| hover del primario (`--on-accent`) | `--accent-dark` | **5,73:1** — letta in `app.css` | **8.54:1** |
| metadati (`--muted`) | `--card` | **6.83:1** | **6.19:1** |
| pastiglia «media» (`--amber`) | `--amber-soft` | **5.45:1** | **7.57:1** |
| pastiglia «bassa» (`--green`) | `--green-soft` | **6.10:1** | **7.32:1** |
| eyebrow 10,5px e label 12,5px (`--muted`) | `--card` | **6.83:1** | **6.19:1** |
| testo su fondo pagina (`--ink`) | `--bg` | **16.06:1** | **16.35:1** |
| metadati su fondo pagina (`--muted`) | `--bg` | **6.59:1** | **7.51:1** |
| rosso di testo (`--red-dark`) | `--red-soft` | **5.90:1** | **6.36:1** |
| evidenziazione (`--on-highlight`) | `--highlight` | **12.02:1** | **5.60:1** |

**Tutte a 4.5:1 o sopra, in tutti e due i temi** — soglia del testo normale,
quindi valgono anche per i gradini piccoli. I valori si sono mossi rispetto a
prima perché sono cambiati i token (neutri e stati agli sRGB del riferimento),
ed è il compito di questa tabella: riportare i rapporti che il codice ha
oggi, non conservare quelli che aveva.

⚠️ **La sigla del marchio NON è più in questa tabella, e non è una svista.**
Il bianco su `#37AEEF` fa 2,48:1 — ma la sigla non è testo: è un disegno in
contorni (`brandArt.ts`), e WCAG 1.4.3 misura il testo, non i segni. La sua
sorveglianza è la **forma** — `brand:check` la confronta glifo per glifo con
l'artefatto del titolare — non un rapporto di luminanza.

⚠️ **Il carattere non sposta un contrasto di un decimale** — il rapporto WCAG è
funzione dei soli colori. Ciò che il carattere cambia è lo **spessore
percepito**, che WCAG 2.1 non misura, e quello si guarda a schermo nei due temi.

⚠️ **La vecchia giustificazione dello spessore era già scaduta quando è stata
scritta.** Diceva che i gradini piccoli restano leggibili «perché usano già peso
600–700, non 400»: `.nav-section` è passata a 400 il 2026-08-13, e altre regole
a 12 px stanno a 400 per eredità. La frase giusta è più corta e si regge da
sola: **ogni coppia della tabella supera 4,5:1, cioè la soglia del testo
normale** — quella che vale a 400 come a 600, a 17px come a 10,5. Non c'è
nessun contrasto che dipenda dal peso per stare in regola, e quindi nessuna
giustificazione da tenere aggiornata.

## Tema scuro

Dal 2026-08-16 è una **scelta**, non il riflesso del sistema: il predefinito è
il chiaro, la preferenza (chiaro / scuro / come il sistema) vive in
`lib/theme.ts` e arriva al CSS come `data-theme` già risolto. Senza JavaScript
si vede il `:root` nudo — che è esattamente il predefinito voluto.

Non è un'inversione. **L'accento è lo stesso `#37AEEF` dei due temi** — la sua
luminosità era già quella giusta per staccarsi dal fondo scuro — e il testo
sopra resta **scuro** (`--on-accent`); è l'hover che si ribalta (`--accent-dark`
schiarisce invece di scendere), e `--red-dark`, che è colore di testo,
schiarisce invece di scurire. Il blocco ridefinisce anche ciò che il restyle
ha aggiunto: le ombre nuove (`--shadow-panel-hover`, e `--shadow-cta` che si
abbassa al 35% per non diventare «glow») e la velatura della barra in cima,
che in scuro torna un fondo pieno — la trasparenza lascerebbe leggere il
contenuto sotto.

⚠️ La soglia WCAG di 3:1 vale per i **controlli** (campi, select, aree di
caricamento), non per i bordi decorativi delle schede: quelle si staccano per
differenza di superficie. I controlli usano `--line-strong`.

⚠️ **Anche l'evidenziazione ha il suo colore di testo.** `mark.ev-hl` usava
`--ink`: in tema chiaro va bene (scuro su giallo chiaro, 12:1), ma in tema
scuro `--ink` è quasi bianco e l'evidenziazione diventa un ocra di luminanza
media — il contrasto scendeva a **2.54:1**, sotto la soglia AA, proprio sulla
frase che dimostra da dove viene un'informazione. Ora esiste `--on-highlight`,
scuro in entrambi i temi: 12:1 in chiaro, 5.6:1 in scuro.

La regola generale: **ogni fondo pieno ha bisogno del proprio colore di testo**
(`--on-accent`, `--on-ink`, `--on-highlight`). Ereditare `--ink` funziona solo
finché il fondo resta chiaro in tutti e due i temi.

## Focus da tastiera

Una regola sola, `:focus-visible`, con un **`outline`** e non un `box-shadow`:
l'outline segue da sé la forma dell'elemento. Prima la regola globale imponeva
`border-radius: 6px` a qualunque cosa ricevesse il fuoco, e su una pastiglia
(99px) o su un cerchio (50%) l'anello aveva la forma sbagliata.

⚠️ L'anello del focus **non è decorazione**: `.step-dot.active` lo usava per
segnare il passo corrente dello stepper, e così il segnale «sei qui con la
tastiera» perdeva significato. Ora quel passo ha un alone dell'accento suo.

⚠️ **Ciò che il puntatore mostra, la tastiera lo mostra uguale.** Nella colonna
«Richiede attenzione» il chevron «vai» è nascosto a riposo e compare sia
all'hover sia al `:focus-visible` della riga — lo spazio resta riservato, la
riga non si sposta. E nella ricerca rapida l'anello sta **dentro** il pannello
(`outline-offset` negativo): l'`overflow: hidden` che arrotonda gli angoli del
riquadro taglierebbe quello esterno.

## Movimento ridotto

`prefers-reduced-motion: reduce` disattiva gli **spostamenti**, non il feedback:
la pagina non scivola più a ogni cambio, lo scheletro di caricamento non pulsa,
la barra non cresce, il pulsante non si abbassa — e, dal restyle, non si
**solleva** più all'hover, il pannello della ricerca rapida non entra più con
un'animazione, e il punto della pastiglia «richiede attenzione» smette di
pulsare: il disco fermo resta, l'alone no (un alone immobile sarebbe un secondo
punto, non un punto fermo). Le transizioni di colore restano, e lo spinner
continua a girare — è l'unico segnale che qualcosa sta ancora lavorando — solo
più lento.

## Dati: la forma non deve dire più di quello che si sa

Le barre orizzontali della dashboard sbagliavano due volte:

- **`min-width: 3px`** disegnava un segmento colorato anche a valore **zero**:
  una quantità che non esiste. Ora a zero non si disegna nulla, e il numero
  accanto resta il dato esatto.
- la lunghezza era normalizzata sul **valore massimo**, quindi un solo documento
  riempiva la barra fino in fondo e sembrava «tanto». Ora il denominatore è il
  **totale della serie**: la lunghezza dice quanta parte dell'insieme sta in
  quella riga.

È la stessa regola della governance del prodotto, applicata alla grafica: se non
si sa, non si mostra; se si mostra, deve essere vero.

## Aree cliccabili

WCAG 2.2 (2.5.8) chiede **24×24 px** per un bersaglio isolato. `.mini-btn` stava
a 22, `.ev-btn` a 20: ora hanno `min-height: 26px`.

Dove esiste una riga, **il bersaglio è la riga**: le priorità di Panoramica e
Dashboard sono un `<a>` che avvolge tutto (`.action-row.is-link`), non una
freccia di 16 px in fondo. Nella checklist dell'analisi il testo dell'azione è
un `<label>` legato alla casella: si spunta cliccando la frase.

⚠️ Quando una riga diventa un `<a>`, il colore va riportato a `var(--ink)`:
altrimenti la regola globale dei collegamenti tinge di blu tutto il contenuto.

## Il vocabolario della fiducia — le marcature

Il vantaggio del prodotto è dire **da dove viene ogni affermazione** — e fino
al 2026-08-12 lo diceva con pastiglie colorate indistinguibili: «Da verificare»
(uno stato di fiducia) e «Scadenza 10.09.2026» (un termine) erano la stessa
forma ambra. Da quel giorno ogni famiglia semantica ha **una forma propria**,
e il colore è **rinforzo, mai unico portatore**: le famiglie si distinguono a
stampa in bianco e nero. Il riferimento è la marginalia dei documenti
amministrativi, non il badge da dashboard.

| Famiglia | Forma | Stati |
|---|---|---|
| **Provenienza** | filetto verticale (barra di revisione): pieno · doppio · tratteggiato · puntinato | dal documento · suggerimento AI-Swisse · inferenza · da verificare |
| **Confidenza** | triade di punti: quanti sono PIENI è il segno | alta ●●● · media ●●○ · bassa ●○○ |
| **Idoneità** | glifo di giudizio + parola, sempre insieme | ? · ✓ · ✕ a tratto · ✕ pieno (definitivo) |
| **Fonte** | timbro d'archivio: maiuscoletto + data tabellare | verificata di recente · da ricontrollare · vecchia · mai verificata · demo (a cornice) |
| **Termine** | le CIFRE sono il segno: data tabellare + distanza | fra N giorni · scade oggi/domani · scaduto da N · nessuna scadenza · data da verificare |
| **Provenienza di un'azione** | le stesse due forme della provenienza, con le parole delle azioni | richiesta nel documento (pieno) · suggerita da AI-Swisse (doppio) |
| **Stato del lavoro** | la casella che si riempie: è una progressione | vuota · a metà · in pausa · spuntata |
| **Priorità** | la DIREZIONE del tratto | su (alta) · di lato (media) · giù (bassa) |
| **Finestra di candidatura** | la parentesi `[ ]`: l'etichetta sta dentro una finestra | aperta · aprirà · sempre aperta · chiusa · sospesa · non dichiarata |

I componenti stanno in `src/components/ui/` (ProvenanceMark con
ActionOriginMark, ConfidenceBadge, DeadlineMark, StatusMark, PriorityMark,
EvidenceLink, MarkLegend), le classi in
`app.css`, sezione «MARCATURE». **Aggiungere uno stato è una riga nella mappa
del componente**: la legenda itera sulle stesse mappe e si aggiorna da sola.
I glifi sono SVG interni, non caratteri: il sottoinsieme del font non c'entra e
`fonts:check` nemmeno.

`test:shell-unit` sezione 7 sorveglia il vocabolario: che ogni segno chieda un
glifo esistente e abbia la sua regola nel foglio di stile, che ogni voce porti
la sua parola in tutte e tre le lingue, che la legenda renda un blocco per ogni
famiglia, che ogni schermata con segni la monti, e che nelle schermate
convertite non tornino le pastiglie d'allarme (`badge-alta/media/bassa`) — con
le eccezioni dichiarate una per riga, e un'eccezione senza riscontro che fa
fallire il controllo, come in `design:lint`.

Le regole che il sistema incorpora:

- **L'incertezza non è un guasto.** «Dichiarato incerto» è il prodotto che
  funziona: dichiara ciò che non può determinare. Sta su `.verify-note` —
  superficie neutra, filetto puntinato — mai su un fondo rosso. Il **rosso
  resta a ciò che è andato storto davvero**: analisi fallita, permesso negato,
  connessione rotta. (Unica eccezione voluta: lo *scaduto* del termine, perché
  un termine mancato è qualcosa che è andato storto **nel mondo**.)
- **Un termine non conta i giorni su una data non verificata.** `toVerify`
  vince sul conteggio: «fra 5 giorni» su una data incerta è un'invenzione
  (era il difetto dei contratti sulle date `candidate`).
- **La verificabilità sta in linea.** Ogni campo con evidenza mostra la frase
  originale senza cambiare pagina (`EvidenceLink`); un campo **senza** evidenza
  verificata lo dichiara in maiuscoletto muto, non tace.
- **La legenda è la stessa ovunque** e mostra **tutte** le famiglie, non solo
  quelle della schermata che si sta guardando: Attività, Scadenzario,
  Documenti, dettaglio documento e foglio d'analisi. Un vocabolario che cambia da una schermata all'altra non è un
  vocabolario, è un elenco di abitudini locali. Si impara una volta, si
  richiude.
- **Ma solo dove c'è almeno un segno da spiegare, e mai come scheda.** Su una
  schermata vuota la legenda non deve essere l'unica cosa in pagina.
  Dal 2026-08-14 conta i `.mark` renderizzati nella pagina (esclusi i propri) e
  se sono zero non compare. ⚠️ **Il conteggio guarda il DOM, non una prop**: una
  condizione passata dalle undici schermate che la usano sarebbe stata undici
  posti in cui ricordarsene, cioè lo stesso invecchiamento che l'iterazione
  sulle mappe evita. La forma è una **riga richiudibile a piè di pagina** con
  il suo filetto.
- **Una famiglia non presta il suo segno a un'altra.** La priorità non usa la
  triade di punti (è la confidenza) e la sospensione di un programma non usa
  la parentesi (è la finestra di un bando): un fatto del dominio che non
  appartiene a nessuna famiglia resta testo con `.decl-flag`. Prendere in
  prestito una forma vicina dice una cosa falsa con più autorevolezza.
- **Il rosso non marca un giudizio.** Priorità alta, «probabilmente non
  idoneo» e «non idoneo» non sono guasti: erano `badge-alta` e il verdetto
  `vh-bad`. Il grado lo porta il peso dell'inchiostro, il giudizio il glifo.
- **Le parole vietate restano vietate**: *approvato*, *garantito*,
  una certezza ufficiale. Dichiarare un esito amministrativo spetta all'autorità.

### L'etichetta non è una marcatura — `Tag`

Le nove famiglie rispondono a una domanda ciascuna. Una **etichetta** non
risponde a nessuna: dice a quale insieme una cosa appartiene — il ruolo di una
persona, il tipo di un contratto, la valuta, la fase di un'opportunità. È una
parola, non un giudizio, e vive in `components/ui/Tag.tsx`.

⚠️ **`.badge` esisteva da sempre: quello che mancava era il componente, e la
differenza è misurabile.** Finché era una classe, ogni modulo scriveva il
proprio `<span className="badge badge-…">` e sceglieva il tono a occhio. Il
2026-08-14, contando gli usi nei moduli: **57 pastiglie scritte a mano** in
diciassette file, e tre difetti che nessun controllo poteva vedere perché non
c'era niente da controllare — erano stringhe:

- lo **stesso** stato di relazione era rosso, ambra o blu nell'elenco clienti e
  **grigio neutro** nella scheda dello stesso cliente: un'azienda con attività
  scadute gridava in un posto e taceva nell'altro;
- gli **stessi** ruoli erano neutri nell'elenco e **blu** nella scheda — e
  `badge-blue` è `--accent-soft`, il blu d'**azione**, che dal 2026-08-13 non
  marca più uno stato;
- lo stato di un'opportunità portava l'**ambra**, cioè il colore che in tutto il
  resto del prodotto significa «attenzione», su un fatto del tutto normale.

**Il tono ha un default e si omette.** `Tag` rende `neutral` se non gli si dice
altro; `info`, `attention`, `ok` e `alert` si scrivono solo sapendo dire perché.
`test:shell-unit` §9 fallisce su ogni pastiglia scritta a mano nei moduli, e §7
— che vieta i toni d'allarme dove parlano i segni — ora guarda **anche** i toni
di `Tag`, comprese le tabelle `STATUS_TONE = { error: 'alert' }`: un controllo
che guardasse le sole classi vecchie diventerebbe cieco proprio mentre il codice
che sorveglia cambia.

⚠️ **Che cosa NON è stato migrato, e perché non è una dimenticanza.** Un
inventario dei moduli ha classificato ogni uso: la maggior parte non sono
marcature (filtri cliccabili, contatori, etichette di lingua, navigazione) e
restano quello che sono. Restano invece **senza famiglia** quattro cose che una
famiglia la vorrebbero, e che nessuna delle nove può ospitare senza prestare il
proprio segno a un'altra — cosa che questo sistema vieta:

| che cosa | dove |
|---|---|
| lo stato di salute di una **relazione** (otto valori) | `crm/ClientsPage`, `crm/ClientDetailPage` |

Sono decisioni di prodotto — quante famiglie deve avere il vocabolario — non
lavoro di consolidamento, e vanno prese guardando, non dedotte.

⚠️ **Una di quelle quattro ha già un difetto VISTO, non previsto**: lo stato di
una relazione è `badge-blue` nell'**elenco** clienti e `badge-neutral` nella
**scheda** dello stesso cliente. «Trattativa in corso» è blu di là e grigia di
qua — guardato in produzione il 2026-08-14 su un cliente vero. La causa è che
la mappa dei toni esiste solo nell'elenco (`STATE_TONE` in `ClientsPage`) e la
scheda usa un `<Tag>` nudo. Finché lo stato di relazione non ha una famiglia
sua, i due punti vanno tenuti allineati **a mano**, e questa riga è il
promemoria che oggi non lo sono.

### Un divario dichiarato: la provenienza dei passaggi di un'attività

`ChecklistAction.sourceType` distingue ciò che un documento **richiede** da ciò
che AI-Swisse **suggerisce**, e il segno lo porta ovunque quel dato viva: foglio
d'analisi, dettaglio del documento, foglio di stampa. **Non** nell'elenco delle
attività né nello scadenzario: quando le azioni diventano lavoro,
`stepsFromActions` copia solo il testo e `task_checklist_items` non ha una
colonna dove conservare la provenienza — il dato non esiste più, e mostrarlo
richiederebbe una migrazione. Finché non c'è, il segno **non si inventa**: nella
riga di un'attività `task.source` (Admin AI, una regola, una
persona) resta testo, perché dice quale modulo l'ha creata e **non** se il
documento chiedesse quella cosa.

## Regole che valgono per chi lavora qui dopo

1. **Nessun valore scritto a mano**: misure e colori vengono dai token.
   Dal 2026-08-09 non è un'esortazione: `npm run design:lint` **blocca la CI**
   quando trova un pixel o un colore fuori posto. Le eccezioni stanno nello
   script, una riga e un motivo ciascuna; una riga senza più riscontro nel
   codice fa fallire il controllo, così la lista non può che dire il vero.
2. **Il focus da tastiera è già risolto** da una regola `:focus-visible` globale:
   non aggiungerne di locali.
3. **L'urgenza ha già una forma oltre al colore** (icona con fondo colorato per
   priorità): non aggiungere altri indicatori per la stessa informazione.
4. **Niente sottolineatura sulla navigazione**, sì sui collegamenti dentro un
   testo — lì è l'unico segnale che li distingue da una parola qualsiasi.
5. **Nel rimappare la tipografia, non usare regex sui nomi di classe**: «tag»
   cattura `.price-tag` (il prezzo, 29px). Liste esplicite, e provare sempre a vuoto prima.
6. **Nessuna larghezza fissa dove c'è testo tradotto.** Vale anche in
   **altezza**: alle etichette dei KPI servono due righe riservate
   (`min-height: 2.7em`), perché «Scadenze prossimi 7 giorni» in tedesco diventa
   «Fristen in den nächsten 7 Tagen» e, andando a capo, faceva scendere il suo
   numero di una riga disallineando tutta la fila.
7. **Una pastiglia etichetta uno stato, non contiene un periodo.** Le frasi
   operative restano testo corrente, non vengono compresse dentro una pastiglia.
8. **Un solo colore forte per riga.** Due avvisi rossi affiancati non dicono
   «due volte urgente», dicono «non guardare».

   ⚠️ **È una regola sulla RIGA, e per questo non può vivere dentro le singole
   pastiglie.** Nell'elenco dei documenti le due pastiglie sceglievano il tono
   ognuna guardando solo il proprio dato, e un documento «da verificare» con una
   scadenza dichiarata ne mostrava **due ambra affiancate**: nessuna delle due
   era sbagliata presa da sola — la scadenza è ambra perché dice quanto manca,
   lo stato è ambra perché la lettura è incerta — ed è precisamente per questo
   che nessuna rilettura del markup l'avrebbe trovato. Ora la decisione è una
   funzione pura che guarda la riga intera (`rowBadgeTones`), con una precedenza
   dichiarata — **guasto › scadenza › stato** — e l'invariante è provato sul
   prodotto cartesiano di stato × scadenza × «scadenza da verificare», non su
   tre casi scelti a mano (`npm run test:documents-unit`, sezione 11).

   Chi perde **non sparisce**: scende a neutro e tiene il suo testo. Togliere il
   colore è togliere una classificazione; togliere la pastiglia sarebbe togliere
   un'informazione. E quando è la scadenza stessa a essere incerta la precedenza
   si rovescia da sé, senza bisogno di un caso in più: quella pastiglia scende a
   neutro per conto proprio (§36) e l'ambra resta libera per lo stato.
9. **Prima di scrivere `.card`, scegliere il livello.** I livelli sono tre e
   stanno in `--surface-1/2/3`: mettere tutto in una scheda non è una scelta
   neutra, è la rinuncia a dire che cosa conta.
10. **Una riga di elenco ha una struttura, non una catena.** «A · B · C · D · E»
    dà lo stesso peso a cinque valori: per trovare il mittente — che è quasi
    sempre il modo in cui si cerca un documento — bisogna leggere tutto, e in
    una colonna stretta quella riga va a capo cinque volte. Nell'elenco dei
    documenti restano una catena solo i due valori davvero secondari.
11. **Cifre tabulari e allineamento a destra sono DUE cose.** `tabular-nums`
    rende le cifre della stessa larghezza; non basta se la colonna che le
    contiene cambia larghezza da una riga all'altra. Le date dell'elenco
    documenti stavano in coda a un titolo di lunghezza variabile, dentro un
    blocco che le pastiglie di destra spingevano avanti e indietro: allineate
    «a destra» dentro un contenitore che si muove non sono allineate. Ora hanno
    il bordo destro della riga.
12. **Prima di rinominare un token, cercarne i consumatori — ANCHE fuori da
    questo repository.** `:root` di `app.css` non è solo dell'app: la vetrina
    (`site/` nel monorepo) **deriva** quel blocco con `sync-tokens.mjs`, e il
    suo `style.css` consuma i token come tutti gli altri. Da qui dentro non si
    vede: è una base di codice separata, e nello specchio non esiste affatto.

    ```bash
    grep -rn -- "--nome-del-token" ~/swiss-ai-suite-repo/site
    ```

    ⚠️ **Il pericolo non è rinominare: è RIUSARE il nome vecchio per un'altra
    cosa.** Un token cancellato lascia una dichiarazione invalida — brutta, ma
    inerte e prima o poi visibile. Un token *riusato* lascia una dichiarazione
    **valida che disegna la cosa sbagliata**, e non lo dice nessuno. Il
    2026-08-11 `--surface-2` è passato da «riempimento grigio» a «livello di
    superficie», che vale `transparent`: la vetrina lo usava in cinque punti
    come fondo, e sarebbe stata pubblicata con cinque fondi spariti. Un
    controllo dei `var()` orfani non l'avrebbe visto — il token c'era ancora.

    ⚠️ E il controllo che c'è **non gira sulle pull request**: `site.yml` ha
    solo `push: branches: [main]`, quindi il rosso arriva a cose fatte. Prima di
    aprire la PR si esegue a mano il comando esatto della CI:

    ```bash
    cd ~/swiss-ai-suite-repo/site && APP_CSS=../app/src/styles/app.css node sync-tokens.mjs --check
    ```
13. **Un numero senza un elenco che lo spieghi non è un KPI.** Ogni scheda
    numerica della Panoramica porta alla lista filtrata da cui il numero esce, e
    la destinazione deve rendere **lo stesso numero**: `/documenti?stato=
    to_verify` è il filtro che ha prodotto il conteggio, `?vista=high` è la
    stessa condizione SQL di `highRelevance`. Il 2026-08-14 «Azioni da
    completare» è stata **tolta** per questa regola: contava le voci di
    checklist dentro le analisi, e nessuna pagina del prodotto le elenca —
    aggiungere quel filtro sarebbe stata una funzione nuova, lasciarla muta
    sarebbe stata l'unica scheda che non porta da nessuna parte. Al suo posto la
    scheda grande è «Attività aperte», che un elenco ce l'ha. Un numero che non
    si può aprire si toglie; non gli si dà una destinazione vaga.

    ⚠️ E il conteggio deve venire dalla **stessa interrogazione** della
    destinazione, non da un ricalcolo sui dati già in memoria: «da verificare»
    contava le analisi con confidenza non alta, mentre la pagina filtrava su
    `needs_review`. Due definizioni della stessa parola sono due verità.

    ⚠️ **Lo zero propone.** A zero la didascalia allarga la finestra («nessuna
    scadenza questa settimana») o dice il gesto successivo, con tono quieto —
    non è un allarme, è un invito. Uno zero senza messaggio è spazio morto, e a
    zero le frasi dello stato normale diventano assurde: «nessuna scaduta»
    dentro un insieme vuoto descrive l'assenza di un problema che non c'era.
14. **Il filetto appartiene al blocco, la misura appartiene al testo.** Legarli
    con un solo `max-width` fa quello che faceva il piè di pagina della
    Panoramica: contenuto largo 905 px, filetto largo 426 — si fermava a metà e
    il blocco sembrava fluttuare. La misura di lettura si toglie al **contenuto**
    con `padding-inline-end: max(0px, calc(100% - var(--measure)))`; la scatola,
    e con lei il bordo, resta larga quanto la colonna.
