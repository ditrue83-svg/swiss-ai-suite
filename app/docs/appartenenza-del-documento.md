# Il cancello dell'appartenenza, e i due difetti che la fattura di prova ha portato a galla

> **Che cos'è questo file.** Il resoconto di che cosa ha rotto un solo documento
> vero, il 2026-08-21, e di com'è finita. Sta nel repository e non in un
> messaggio di commit perché è la spiegazione di **tre regole che oggi vivono
> nel codice** e che, senza la storia, sembrano prudenze arbitrarie.
>
> Corrisponde alla **PR #74**, unita il 2026-08-22. Tutti i punti nel codice
> sono stati **riletti il 2026-08-24**, non copiati dalla PR.

---

## 0. Il documento

Il 2026-08-21 è stata caricata in produzione una **fattura di 15 pagine
intestata a una persona fisica**, non a Rossi SA. Un documento solo. Ha
smascherato tre difetti che **nessun test vedeva**, e nessuno dei tre era nel
modulo che si stava guardando.

---

## 1. Il cancello dell'appartenenza — dove veniva ereditato, e chi non lo ereditava

### 1.1 Che cos'era

La regola è: **appartenenza in dubbio ⇒ niente attività**. Finché nessuno
conferma che un documento riguardi l'azienda, da lì non nascono scadenze né
attività — perché il documento potrebbe essere di qualcun altro.

La regola **esisteva già**. Viveva in `DocumentDetailPage`, sotto forma di un
`canCreateTask` calcolato in pagina, e accanto c'era scritto — testualmente —
che era «l'unico interruttore che **tutti** i punti di creazione consultano».

### 1.2 Non era vero, e chi non lo ereditava

I punti di creazione di un'attività da un documento sono **tre**, e ne
consultava il cancello **uno solo**:

| Schermata | Consultava il cancello? |
|---|---|
| `DocumentDetailPage` — dettaglio del documento | **sì** |
| `ResultView` — la schermata di analisi di Admin AI | **no** |
| `FinanceDetailPage` — dettaglio di una voce di Finanze (**due** punti di creazione) | **no**, e non poteva |

Da `ResultView` è nata l'attività **«Pagare la fattura»**, su un documento che
non risultava dell'azienda.

Finanze non poteva consultarlo per una ragione strutturale, non per una
dimenticanza: **il verdetto nasce dall'analisi del documento**, e quella pagina
l'analisi non l'aveva mai avuta in pagina — aveva solo l'id del documento.
Poteva quindi rispondere una cosa sola: «non valutata».

### 1.3 Come si è trovato

Non da un test: **facendo girare `valutaAppartenenza` sui dati veri** di quel
documento. La risposta era `{ doubt: true, via: 'nome' }` — con qualunque
rubrica dei membri. Il destinatario era un nome di persona che non risultava fra
i membri dell'azienda.

### 1.4 Dov'è la regola adesso

**Nel modulo puro, come campo obbligatorio.** `appartenenza` è un campo di
`CreateFromDocumentInput` ([`documentToTask.ts:108-117`](../src/features/tasks/documentToTask.ts)),
con **tre risposte che non sono ripieghi l'una dell'altra**:

```
senza-dubbio   valutata, e il documento risulta dell'azienda
in-dubbio      valutata, e NON risulta → qui non si crea niente
non-valutata   non si è potuto valutare, e si dice PERCHÉ (campo `perche`)
```

- su `in-dubbio` la creazione è **rifiutata prima di qualunque scrittura**
  (`AppartenenzaInDubbio`, `documentToTask.ts:81`);
- `non-valutata` **non blocca**, deliberatamente — è il comportamento che le
  schermate avevano già — ma obbliga a scrivere in chiaro quale buco resta
  aperto, invece di lasciarlo invisibile;
- **un punto di creazione nuovo non compila** finché non dichiara che cosa sa.

Finanze adesso **se lo va a prendere**, il verdetto:
[`useDocumentOwnership`](../src/features/documents/useDocumentOwnership.ts)
carica l'analisi partendo dall'id del documento e restituisce già la forma che
il modulo delle attività pretende. I suoi due punti di creazione sono spenti
entrambi ([`FinanceDetailPage.tsx:384,502`](../src/features/finance/FinanceDetailPage.tsx)).

⚠️ **Il tipo obbliga a dichiarare, non a dire il vero.** Rimessa a mano la riga
`{ stato: 'senza-dubbio' }` dentro `ResultView`, **il compilatore è rimasto
muto** — provato il 2026-08-22. Perciò quel letterale è **vietato fuori da
`appartenenzaDa`**, e lo sorveglia una guardia sui sorgenti:
[`test-documents-unit.ts` sezione 19](../scripts/test-documents-unit.ts).
La guardia **scarta prima i commenti**: in questo progetto una guardia a regex è
già nata rossa per colpa della frase che la spiegava, e il commento che spiega
questo divieto nomina il valore vietato.

### 1.5 Che cosa è cambiato a schermo

- su un documento la cui appartenenza è in dubbio, il pulsante «crea attività»
  è **spento in tutte e tre le schermate** (prima: in una);
- accanto compare il motivo — «Questo documento potrebbe non riguardare
  {azienda}», con il destinatario che l'analisi ha letto, e la riga «Finché
  l'appartenenza non è confermata, il documento non crea scadenze né attività»
  (`documents.ownership.*`);
- l'indicatore di attendibilità **non mostra un livello basso**: mostra «non
  valutabile · appartenenza da confermare». Un livello è un giudizio
  sull'analisi *di questa azienda*, e finché non si sa se il documento la
  riguardi non c'è niente da giudicare;
- c'è un pulsante «Confermo che riguarda {azienda}», e la conferma si scrive
  come **correzione append-only** (`field='ownership'`): la revoca non cancella,
  **supera**.

---

## 2. Il primo difetto della fattura: lo stesso PDF letto due volte

### 2.1 Che cos'era

Lo stesso PDF di 15 pagine è stato analizzato **due volte a 74 secondi di
distanza**: due chiamate al modello, due righe in `document_analyses`, **credito
speso due volte**.

### 2.2 Come si è trovato

Guardando le righe vere: due analisi dello stesso `document_id` a 74 secondi di
distanza. La causa si legge nel codice di allora: `analyze-document` leggeva del
documento solo `id, company_id, storage_path, mime_type, file_size` — **lo stato
non lo guardava nessuno**, e niente rifiutava la seconda partenza.

### 2.3 Che cosa c'è adesso

La regola vive in [`analisiGiaInCorso`](../supabase/functions/_shared/recoverStuckAnalyses.ts)
(`recoverStuckAnalyses.ts:82-92`), **accanto alla soglia che condivide** con il
recupero delle analisi interrotte:

- sotto `STUCK_ANALYSIS_MINUTES` (20) ripartire è **pagare due volte**;
- sopra, il documento è considerato interrotto e ripartire è **necessario**.

Le due soglie sono **una costante sola**: se divergessero nascerebbe una terra
di nessuno — o documenti bloccati per sempre, o doppioni.

La regola è applicata **due volte**: in chiaro, e **dentro l'`UPDATE`** come
presa atomica ([`analyze-document/index.ts:144-146`](../supabase/functions/analyze-document/index.ts)),
perché una decisione presa in TypeScript su una riga letta un istante prima non
regge a una corsa fra due richieste.

⚠️ **Senza `updated_at` si considera in corso.** Non è pessimismo: rifiutare
costa un'attesa, ripartire costa una chiamata al modello. Fra i due errori
possibili si sceglie quello che non si paga.

### 2.4 Che cosa è cambiato a schermo

**Nessun errore.** Chi perde la corsa riceve **`202 processing`**, che è la
verità: un'analisi su quel documento sta già girando. Il client è già in ascolto
sullo stato del documento (`waitForCompletion`) e mostra l'esito della **prima**
analisi — la stessa barra di avanzamento, lo stesso risultato. Prima, la seconda
richiesta produceva una seconda analisi e la pagina mostrava quella.

---

## 3. Il secondo difetto: la riga di quota che non si chiudeva mai

### 3.1 Che cos'era

Ogni chiamata AI prenota una riga in `ai_request_log` con stato `pending`
(`try_consume_ai_quota`, [`0009`](../supabase/migrations/0009_quota_and_upload_limits.sql)),
e a fine lavoro `finalizeAiRequest` la chiude con l'esito, la durata e i token.

**Non si chiudeva.** Misurato allora: `analysis` fermo a `pending` **4 volte su
6**, `inbox_analysis` **18 su 18**.

### 3.2 Come si è trovato

Contando gli stati delle righe di log. Poi leggendo le due funzioni SQL che
possono chiuderle:

⚠️ **Nessuna delle due copre l'altra.** Una esige `user_id = auth.uid()`, l'altra
`user_id is null`. Col ruolo di servizio il confronto diventa `NULL = NULL` —
**mai vero**: zero righe toccate, **nessun errore**, e `finalizeAiRequest`
dichiarava di aver chiuso.

### 3.3 Che cosa c'è adesso

- **chi chiude è un parametro obbligatorio** (`come: 'utente' | 'sistema'`), così
  il chiamante deve dichiarare con quale autorità sta scrivendo e non può
  scegliere la funzione sbagliata per distrazione;
- **la chiusura si verifica rileggendo la riga**
  ([`persist.ts:369-372`](../supabase/functions/_shared/persist.ts)): se è ancora
  `pending`, l'`UPDATE` non ha trovato niente e la funzione **restituisce
  falso**. Se anche la rilettura fallisce, non si dichiara il successo — «non lo
  so» e «è andata bene» sono due cose diverse, ed è la confusione che questo
  difetto è costato;
- **nessuna migrazione**: le due funzioni SQL erano già giuste ciascuna per il
  suo caso.

### 3.4 Che cosa è cambiato a schermo — **niente, e va detto**

`ai_request_log` **non lo legge nessuna schermata** (misurato il 2026-08-24:
l'unico riferimento in `src/` è la definizione del tipo). Serve a due cose:

1. **il limite di richieste al minuto** — e lì il danno era piccolo: la finestra
   è di 60 secondi, quindi una riga rimasta `pending` smette di contare da sola
   dopo un minuto;
2. **sapere quanto si è speso** — e lì il danno era tutto: il registro delle
   chiamate AI, che è la sola risposta possibile a «quanto costa questo
   prodotto», diceva il falso su 22 righe su 24.

**La correzione si vede in un registro, non in una pagina.** Dirlo è parte della
correzione: cercare un cambiamento a schermo, qui, porterebbe a concludere che
non sia servita a niente.

---

## 4. Lo stato misurato oggi

Misurato il **2026-08-24 ore 16.00 UTC** sul database di produzione.

| | |
|---|---|
| righe in `ai_request_log` | **242** |
| di cui `pending` | **23** — `inbox_analysis` 18, `analysis` 4, `inbox_classification` 1 |
| l'ultima riga di log | **2026-08-21T19:40 UTC** |
| righe in `analysis_corrections` | **0** |
| di cui conferme di appartenenza | **0** |

Che cosa vuol dire, detto senza sconti:

- ⚠️ **le 23 righe `pending` sono quelle vecchie**, e restano: la correzione
  impedisce che se ne creino di nuove, non ripara le passate. Nessuna migrazione
  le ha toccate — sarebbe stato inventare un esito che nessuno conosce;
- ⚠️ **dal 2026-08-21 non è più partita una richiesta AI**, quindi la chiusura
  **non è ancora stata esercitata in produzione**: è implementata, deployata e
  provata sui filtri contro PostgREST vero, ma **la prova vera sarà la prossima
  analisi reale**;
- ⚠️ **la conferma di appartenenza non è mai stata scritta in produzione**: zero
  righe. Il percorso di scrittura è quello descritto in §1.5 e non è mai stato
  percorso da una persona.

⚠️ **Un buco che resta, dichiarato.** `DocumentDetailPage.tsx:346` comincia con
`if (!detail?.item.analysisId || !user) return;` — su un documento **senza
analisi** il pulsante «Confermo» non fa niente, **in silenzio**. Oggi non morde
(0 documenti senza analisi, misurato), ma è un ripiego muto e questo progetto li
vieta. Il perché strutturale — `analysis_corrections.analysis_id` è `not null` —
e le due forme possibili per chiuderlo stanno in
[`stati-documento.md` §7.3](stati-documento.md).

---

## 5. Che cosa questa correzione NON copre

- ⚠️ **Nessun banco monta una Edge Function.** Tolto il controllo da
  `analyze-document`, la suite resta verde. Sono provate le parti pure e i filtri
  contro il database vero; **l'innesto no**.
- ⚠️ Il gancio `useDocumentOwnership` **non è coperto dal banco offline**: un
  gancio che ne compone altri il banco non lo monta. La parte pura è stata
  estratta in [`ownershipReason.ts`](../src/features/documents/ownershipReason.ts)
  ed è provata; le due righe che compongono il verdetto sono coperte dalla
  guardia sui sorgenti e dalla rilettura, non da un'asserzione.

---

## 6. Documenti vicini

- [`stati-documento.md`](stati-documento.md) — il censimento degli stati, con l'asse della verifica umana e la migrazione che servirebbe.
- [`document-hub.md`](document-hub.md) — il modello dati dei Documenti.
- [`product-status.md`](product-status.md) — lo stato di ogni modulo, sede unica.
