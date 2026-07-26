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

Stato attuale: **113 regole usano i token**, **2 usano ancora pixel** —
e quelle sono pseudo-elementi la cui misura dipende dal cerchio che le contiene.

**Nessuna nuova regola deve usare px per il testo.**

## Spaziature

Multipli di 4: `4px` · `—` · `—` · `—` · `24px` · `—` · `—`
(`--sp-1` … `--sp-12`).

## Colore

| Token | Valore | Ruolo |
|---|---|---|
| `--accent` | `hsl(207, 88%, 39%)` | fondo dei pulsanti, elementi attivi |
| `--accent-text` | `hsl(207, 90%, 30%)` | testo e collegamenti |
| `--ink` | `hsl(213, 40%, 13%)` | testo principale |
| `--ink-soft` | `hsl(213, 22%, 30%)` | testo secondario |
| `--muted` | `hsl(213, 12%, 42%)` | metadati |
| `--red` / `--amber` / `--green` | `hsl(0, 84%, 60%)` / `hsl(35, 78%, 34%)` / `hsl(151, 48%, 32%)` | urgenza, attenzione, assolto |

L'accento è più fondo dell'azzurro precedente (`hsl(199,100%,50%)`), che era
saturo quasi al massimo: qui accompagna solleciti dell'AFC e termini di
pagamento, non un prodotto consumer.

**Rosso, ambra e verde non sono decorazione**: dicono quanto manca a una
scadenza e se un'azione è stata svolta. Restano separati dal colore d'azione,
così un pulsante non compete mai con un avviso.

⚠️ `--red` serve a barre, bordi e riempimenti. Per il **testo** si usa
`--red-dark`: il primo non raggiunge il contrasto minimo su fondo chiaro.

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

## Regole che valgono per chi lavora qui dopo

1. **Nessun valore scritto a mano**: misure e colori vengono dai token.
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
