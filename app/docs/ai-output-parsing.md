# Il contratto di lettura dell'output dei modelli

Un solo modulo, `supabase/functions/_shared/parse.ts`, estrae il JSON da ciò che
un modello ha scritto. Questo documento dice che cosa quel modulo garantisce,
che cosa **non** garantisce, e dove finisce la sua responsabilità.

Vale per tutti i percorsi AI del prodotto: Admin AI, trascrizione OCR,
classificazione della posta, Finanze e Contratti.

---

## 1. Parsing sintattico e validazione di dominio sono due cose

| | Chi | Che cosa decide |
|---|---|---|
| **Sintassi** | `_shared/parse.ts` | Dove finisce l'oggetto JSON e se è JSON |
| **Dominio** | il validatore del modulo | Se quei campi sono accettabili |

Il parser **non conosce nessuno schema**. Non sa che cosa sia una scadenza, un
IBAN o un livello di rilevanza. Restituisce `unknown`, e chi lo ha chiamato
valida:

- `_shared/validate.ts` → `validateAndNormalize` (Admin AI)
- `_shared/email/classifyPrompt.ts` → `validateClassifierOutput` (Inbox)
- `_shared/finance/validate.ts` → `validateFinanceOutput` (Finanze)
- `_shared/contracts/validate.ts` → `validateContractReading` (Contratti)

**Questi validatori restano separati e non vanno unificati.** Le loro
regole non sono la stessa regola scritta cinque volte: su una fattura una
citazione mancante toglie un importo, su un contratto blocca una data di
disdetta, sull'Inbox non esiste affatto il concetto. Fonderli produrrebbe un
validatore che accontenta tutti e non difende nessuno.

---

## 2. Che cosa il parser tollera

- spazi, tabulazioni e a capo esterni;
- **testo prima** dell'oggetto («Ecco il risultato:»);
- **testo dopo** l'oggetto («Ho mantenuto i dati separati.»);
- recinti markdown con linguaggio (` ```json `) e senza (` ``` `);
- testo fuori dal recinto, prima e dopo;
- un recinto il cui contenuto non comincia subito con la graffa;
- oggetti annidati a qualsiasi profondità;
- array dentro l'oggetto;
- graffe `{` e `}` **dentro le stringhe** JSON;
- virgolette escaped `\"`, backslash escaped `\\`, sequenze `\n` e `\uXXXX`;
- Unicode.

## 3. Che cosa il parser NON fa

Non ripara. In particolare **non** corregge:

- una virgola finale (`{"a":1,}`);
- una chiave senza virgolette (`{a:1}`);
- virgolette tipografiche al posto di quelle dritte;
- campi mancanti o di tipo sbagliato — quello è dominio, non sintassi.

E soprattutto:

- **non restituisce mai `{}`.** Una risposta assente è un errore, non un
  oggetto vuoto. Un oggetto vuoto attraversa i validatori fino ai loro ripieghi
  prudenti e produce un risultato plausibile costruito sul nulla: è il fallback
  silenzioso che questo prodotto non ammette.
- **non trasforma un array in un oggetto.** `[{"a":1}]` è una lista: consegnare
  `{"a":1}` a un validatore che aspetta un oggetto trasformerebbe «il modello ha
  risposto con la forma sbagliata» in un dato apparentemente buono.
- nessun `eval`, nessun `Function`, nessuna dipendenza esterna.

---

## 4. L'algoritmo

Uno **scanner lineare e deterministico**, senza espressioni regolari sul corpo
dell'oggetto. Mantiene quattro cose: posizione iniziale, profondità delle
graffe, dentro/fuori stringa, escape attivo.

Una `}` chiude l'oggetto **soltanto** se non si trova dentro una stringa e la
profondità torna a zero. Il testo che segue quella graffa non entra in
`JSON.parse` — ed è tutto il difetto che questo modulo ha avuto per due mesi:
il commento diceva «primo oggetto bilanciato», il codice prendeva la prima
graffa e teneva tutto fino alla fine della risposta.

### Recinti

Se esiste un recinto **completo** (apertura *e* chiusura), il suo contenuto ha
la precedenza, delimitatori esclusi. Se dentro il recinto non c'è alcun
candidato si riparte dal testo grezzo; se un candidato c'è e non regge, l'errore
è quello — non si va a cercare altrove.

Un recinto **aperto e mai chiuso** non viene finto valido: si ignora il
delimitatore e si esamina il testo grezzo, dove lo scanner dirà da sé se
l'oggetto è intero o mozzo.

### Più oggetti

Si restituisce il **primo oggetto completo** e si ignorano i successivi. Non si
fondono mai.

Se un recinto completo esiste, vince lui anche su un oggetto nudo che lo
precede: un oggetto prima del recinto è quasi sempre l'eco della domanda, e il
recinto è l'unico posto in cui il modello *dichiara* dove sia la risposta.

Se il primo oggetto è bilanciato ma sintatticamente invalido, **si fallisce**:
non si prova il secondo. Saltare in silenzio un oggetto rotto per accettarne un
altro significherebbe scegliere al posto del modello.

---

## 5. Errori

`parseModelJson` solleva un `Error` con `code = 'MODEL_JSON_UNPARSABLE'` e un
campo `failure` che distingue quattro cause:

| `failure` | Significa |
|---|---|
| `NOT_TEXT` | l'argomento non era una stringa |
| `NO_OBJECT` | nessuna graffa, oppure un array al posto di un oggetto |
| `INCOMPLETE_OBJECT` | graffa aperta mai chiusa, o stringa mai terminata |
| `INVALID_JSON` | delimitato correttamente, ma non è JSON valido |

Sono un vocabolario **interno**. Ogni modulo traduce nel proprio codice
operativo prima che qualcosa arrivi a schermo: `INVALID_RESPONSE` per l'Inbox,
`AI_INVALID_OUTPUT` per Admin AI e Finanze, `AI_REFUSED` per i
Contratti. Non sono stati creati codici nuovi per il prodotto.

### Che cosa si può distinguere in un log

| Situazione | Come si riconosce |
|---|---|
| nessun testo ricevuto | il chiamante fallisce **prima** del parser |
| output troncato dal tetto | `stop_reason === 'max_tokens'` → `AI_OUTPUT_TRUNCATED` |
| JSON non estraibile | `failure = NO_OBJECT` |
| JSON troncato | `failure = INCOMPLETE_OBJECT` |
| JSON sintatticamente invalido | `failure = INVALID_JSON` |
| JSON valido, schema di dominio invalido | l'errore **non** è un `ModelJsonError` |

### Che cosa NON viene registrato

§45. Il messaggio dell'errore e `describeModelJsonFailure()` contengono
**soltanto**: categoria, lunghezza dell'output, presenza di un recinto,
posizione approssimativa. Mai la risposta del modello, che è il documento,
l'email o il contratto di un cliente.

---

## 6. Retry

**Il parser non ritenta.** Riesce, oppure fallisce chiaramente. La decisione di
riprovare appartiene a chi chiama, e resta dov'era:

- **Inbox** — `INVALID_RESPONSE` è ripescabile **una volta sola**
  (`codeAfterRetry` in `_shared/email/classify.ts`): illeggibile due volte di
  fila diventa `CLASSIFY_FAILED`, terminale.
- **Contratti** — un output non leggibile scrive un verbale `AI_REFUSED`, che è
  definitivo. Non si ripete: lo stesso contratto con lo stesso prompt darebbe lo
  stesso esito.
- **Finanze** — `AI_INVALID_OUTPUT` mette la voce in `retry_later`, con il
  tetto di tentativi che il modulo aveva già.
- **Admin AI** — un parsing fallito scrive `AI_INVALID_OUTPUT` e **non** produce
  alcuna analisi.

---

## 7. Portabilità

`parse.ts` non importa niente: né moduli Node, né API del browser. È importato
da Deno (nove Edge Function) e da Node/tsx (test ed evaluation) senza
adattatori. Aggiungerci una dipendenza romperebbe uno dei due lati.

---

## 8. Le Edge Function che lo incorporano

Nove su diciannove, calcolate seguendo il grafo degli import e non a memoria:

| Funzione | Catena |
|---|---|
| `analyze-document` | `_shared/extract.ts` |
| `contract-worker` | `_shared/contracts/process.ts` → `contracts/validate.ts` |
| `email-disconnect` | `_shared/email/runtime.ts` → `pipeline.ts` |
| `email-maintenance` | `_shared/email/sync.ts` |
| `email-oauth` | `_shared/email/runtime.ts` → `pipeline.ts` |
| `email-sync` | `_shared/email/sync.ts` |
| `email-webhook` | `_shared/email/runtime.ts` → `pipeline.ts` |
| `finance-worker` | `_shared/finance/process.ts` → `finance/validate.ts` |
| `interpret-project` | diretto |

Le altre dieci non lo incorporano e **non vanno rideployate** per un cambiamento
che le riguarda.

---

## 9. Le prove

`npm run test:ai-json-parser-unit` — 72 casi offline, nel gruppo `unit`.

Contiene tre **parser degradati** che girano a ogni esecuzione: senza
bilanciamento, senza stato di stringa, senza stato di escape. Ognuno deve
FALLIRE dove quello vero riesce, e reggere su un caso semplice — altrimenti
sarebbe rotto a prescindere e non proverebbe niente.

Regressioni nei moduli: `test:inbox-unit`, `test:finance-unit`,
`test:contracts-unit`, `test:validate` (trascrizione OCR).

---

## 10. Limiti dichiarati

- Un oggetto JSON **dentro una stringa** di un altro oggetto non viene
  distinto: se il modello risponde `{"esempio":"{\"a\":1}"}` il parser
  restituisce l'oggetto esterno, che è il comportamento giusto, ma non esiste
  modo di chiedere quello interno.
- Il parser non sa **perché** un oggetto sia mozzo. `INCOMPLETE_OBJECT` non
  distingue «tagliato dal tetto di token» da «il modello ha smesso»: quella
  distinzione la fa il chiamante leggendo `stop_reason`, prima di chiamarlo.
- Un recinto il cui contenuto contiene a sua volta tre apici non è gestito.
  Nessuna risposta osservata lo fa.
