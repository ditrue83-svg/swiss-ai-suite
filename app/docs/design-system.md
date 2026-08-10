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

## Scala tipografica

Sei gradini, uno per compito. Se un testo non rientra in nessuno, il problema è
la gerarchia, non la scala.

| Token | Valore | Uso |
|---|---|---|
| `--fs-label` | 12px | etichette maiuscole, pastiglie |
| `--fs-meta` | 13px | metadati, didascalie |
| `--fs-body` | 15px | corpo del testo |
| `--fs-strong` | 17px | titoli di scheda e di riga |
| `--fs-h2` | 22px | titoli di sezione |
| `--fs-h1` | 30px | titoli di pagina |

Quante regole rispettino la scala non lo dice questo file: lo dice
`npm run design:lint`, che fallisce su ogni `font-size` in pixel. Un conteggio
scritto qui invecchierebbe al primo commit che non lo aggiorna — è già successo
ai numeri che stavano in questa riga. Le due sole eccezioni ammesse —
pseudo-elementi la cui misura dipende dal cerchio che le contiene — sono
dichiarate nello script, con il motivo accanto.

**Nessuna nuova regola deve usare px per il testo.**

## Spaziature

Multipli di 4: `4px` · `—` · `—` · `—` · `24px` · `—` · `—`
(`--sp-1` … `--sp-12`).

Il ritmo lo fa la scala; **sotto il primo gradino la scala non parla**. I 2px
che danno respiro a una pastiglia o allineano un'icona alla prima riga sono
anatomia dell'elemento, non ritmo fra gli elementi: vivono come eccezioni
dichiarate in `design:lint`, una riga e un motivo ciascuna. Se quella lista
cresce, non mancano eccezioni: manca un gradino.

Nel markup le distanze si scrivono con le utilità in coda a `extra.css`
(`.m-0`, `.mt-2`, `.py-2`, …): prendono i valori **solo** dalla scala, e un
`style={{ marginTop: 8 }}` non passa il lint. Quando un elemento ne accumula
più di due, quello che si sta descrivendo è un componente e va nominato nel
CSS.

## Colore

| Token | Valore | Ruolo |
|---|---|---|
| `--accent` | `hsl(207, 88%, 39%)` | fondo dei pulsanti, elementi attivi |
| `--accent-text` | `hsl(207, 90%, 30%)` | testo e collegamenti |
| `--ink` | `hsl(213, 40%, 13%)` | testo principale |
| `--ink-soft` | `hsl(213, 22%, 30%)` | testo secondario |
| `--muted` | `hsl(213, 12%, 42%)` | metadati |
| `--red` / `--amber` / `--green` | `hsl(0, 84%, 60%)` / `hsl(35, 78%, 34%)` / `hsl(151, 48%, 32%)` | urgenza, attenzione, assolto |
| `--amber-fill` / `--green-fill` | `hsl(35, 92%, 50%)` / `hsl(151, 52%, 40%)` | riempimenti: barre, pallini |
| `--accent-line` | `hsl(207, 58%, 82%)` | bordo di ciò che sta su `--accent-soft` |
| `--line-subtle` | `rgba(127, 127, 127, 0.15)` | separatori dentro una scheda; il grigio al 50% con alfa bassa regge su entrambi i temi, e per questo non ha una variante scura |
| `--scrim` | `rgba(16, 24, 40, 0.4)` | velo dietro un cassetto aperto (era scritto due volte, con due valori diversi) |
| `--on-highlight` | `hsl(45, 60%, 12%)` | testo sopra l'evidenziazione della citazione |
| `--focus` | `hsl(207, 88%, 42%)` | anello del focus da tastiera |

L'accento è più fondo dell'azzurro precedente (`hsl(199,100%,50%)`), che era
saturo quasi al massimo: qui accompagna solleciti dell'AFC e termini di
pagamento, non un prodotto consumer.

**Rosso, ambra e verde non sono decorazione**: dicono quanto manca a una
scadenza e se un'azione è stata svolta. Restano separati dal colore d'azione,
così un pulsante non compete mai con un avviso.

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

Verificati con il calcolo WCAG, non a occhio. Tema chiaro:

| | contrasto | |
|---|---|---|
| testo principale | 16.48:1 | AAA |
| collegamenti | 7.87:1 | AAA |
| testo bianco sul pulsante | 5.40:1 | AA |
| metadati | 5.52:1 | AA |
| pastiglia «media» (ambra) | 4.61:1 | AA — era **3.31:1** |
| pastiglia «bassa» (verde) | 4.69:1 | AA — era **4.00:1** |

Le ultime due erano sotto soglia proprio sulle pastiglie che comunicano
l'urgenza. Sono state scurite del minimo necessario, mantenendo la tinta: non un
colore diverso, lo stesso colore reso leggibile.

## Tema scuro

Segue `prefers-color-scheme`, senza interruttore nell'app: una preferenza in
meno da spiegare e ricordare.

Non è un'inversione. Su fondo scuro l'accento **si schiarisce** per staccarsi, e
il testo sopra diventa **scuro** (`--on-accent`); `--red-dark`, che è colore di
testo, schiarisce invece di scurire.

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

## Movimento ridotto

`prefers-reduced-motion: reduce` disattiva gli **spostamenti**, non il feedback:
la pagina non scivola più a ogni cambio, lo scheletro di caricamento non pulsa,
la barra non cresce, il pulsante non si abbassa. Le transizioni di colore
restano, e lo spinner continua a girare — è l'unico segnale che qualcosa sta
ancora lavorando — solo più lento.

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
   cattura `.price-tag` (il prezzo, 29px) e «badge» cattura `.rel-badge .rb-num`
   (la percentuale, 19px). Liste esplicite, e provare sempre a vuoto prima.
6. **Nessuna larghezza fissa dove c'è testo tradotto**: l'etichetta della
   rilevanza è RILEVANZA, RELEVANZ, PERTINENCE — a 66px usciva dal riquadro.
   Vale anche in **altezza**: alle etichette dei KPI servono due righe riservate
   (`min-height: 2.7em`), perché «Scadenze prossimi 7 giorni» in tedesco diventa
   «Fristen in den nächsten 7 Tagen» e, andando a capo, faceva scendere il suo
   numero di una riga disallineando tutta la fila.
7. **Una pastiglia etichetta uno stato, non contiene un periodo.** Nelle schede
   degli incentivi ce n'erano sei con quattro colori, e una conteneva una frase
   di due righe (la finestra di candidatura). Restano pastiglia le due cose che
   cambiano quello che fai — se il programma è concedibile, se la domanda va
   presentata prima di iniziare; il resto è testo.
8. **Un solo colore forte per riga.** Due avvisi rossi affiancati non dicono
   «due volte urgente», dicono «non guardare».
