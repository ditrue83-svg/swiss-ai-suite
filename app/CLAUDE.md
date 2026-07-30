# Regole di lavoro su AI-Swisse

Questo file sta in `app/` e non nella radice perché è **qui** che si lavora
(`~/swiss-ai-suite-app`): un file di regole che vive dove nessuno apre il
terminale è una regola che nessuno legge.

## Git

- **Mai lavorare direttamente su `main`.** Un branch per intervento, con un nome
  che dica cosa fa (`improve/…`, `fix/…`).
- **Nessun deploy, nessun push, nessuna migrazione applicata senza che sia stato
  chiesto.** Applicare una migrazione e pubblicare cambiano la produzione: sono
  decisioni, non passaggi di un lavoro.
- **Non si modifica una migrazione già applicata.** Se ne scrive una nuova.
- **Una sola sessione per working tree.** La notte del 2026-07-29/30 due sessioni
  hanno lavorato in `~/swiss-ai-suite-app` insieme: `package.json`,
  `database.ts`, i tre dizionari e `nav.ts` portano i segni di entrambe, e la
  pubblicazione è dovuta diventare due commit per non attribuire a uno il lavoro
  dell'altro. Se accade di nuovo, **eseguire anche i test dell'altro modulo**:
  l'albero che si pubblica è uno solo.

## Consolidamento

- **Nessuna funzione di prodotto nuova** durante uno sprint di consolidamento.
  Si migliora ciò che esiste: correttezza, prove, chiarezza.
- **Ogni modifica ha un test**, e il test va provato su un caso che **deve**
  farlo fallire. Un controllo che dà un verde falso vale meno di nessun
  controllo: è già successo due volte con `i18n:coverage`.
- **Suite completa prima di ogni commit**: `npm run ci` sempre;
  `npm run test:all` quando c'è `.env.test`.
- **Non nascondere un test rosso** e non aggirarlo. Se resta rosso, si dice
  perché — un rosso spiegato è informazione, un rosso nascosto è un difetto in
  più.

## Verità

- **Non chiamare «operativa» una funzione perché esiste nel codice.** Le sei
  parole sono distinte e stanno in [`docs/product-status.md`](docs/product-status.md):
  implementato · deployato · configurato · testato · provato contro il servizio
  reale · disponibile a clienti esterni. `notifications-worker` è implementata,
  deployata e testata, e non ha mai generato un promemoria.
- **Lo stato di un modulo si dichiara in un posto solo.** Non creare una seconda
  fonte di verità: se un dato vive già da qualche parte, si legge da lì.
- **Non aggiornare la documentazione con numeri non verificati.** Un conteggio di
  test scritto in un messaggio di commit descrive l'albero di quel momento. Il
  numero vero lo dà l'esecuzione.
- **Ciò che non è provato contro la cosa reale non è vero, è solo scritto.**
  Aprire l'app, interrogare il database, leggere il bundle servito.
- **Nessun fallback silenzioso**: un guasto è un errore esplicito, mai un
  risultato plausibile.

## Sicurezza e dati

- **Il database di `.env.test` è la PRODUZIONE.** Niente test distruttivi: si
  creano aziende usa-e-getta e si rimuovono, e una pulizia incompleta deve far
  fallire il test.
- **Non stampare segreti**, né in un log, né in un messaggio di errore, né in un
  file di report. Si verifica che un nome esista, non che valore abbia.
- **Su `public`, un grant di colonna non restringe nulla senza un `revoke all`
  che lo preceda.** Supabase concede i privilegi pieni per default.

## Interfaccia

- **Trilingue it/de/fr, sempre.** Nessun testo scritto a mano nei componenti:
  `npm run i18n:coverage` esce 1 se ne trova.
- **Ogni campo va dentro `.field`**, altrimenti in tema scuro è bianco su bianco.
- **`tr()` a livello di modulo congela la lingua**: cercare `= tr(` fuori dalle
  funzioni prima di dire che l'i18n è a posto.
