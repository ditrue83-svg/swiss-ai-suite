# Finance Operations — fatture, ricevute, note di credito (0021) e fatture emesse (0053)

> Comprendere e preparare il denaro. **Non muoverlo.**

Questo documento descrive il modulo **Finanze** (`/finanze`, dettaglio
`/finanze/:id` per i documenti in entrata, `/finanze/emesse/:id` per le fatture
verso i clienti): che cosa fa, che cosa deliberatamente non fa, come è costruito,
e quali sono i limiti che si dichiarano invece di attenuarli. Il modulo lavora
nelle **due direzioni del denaro**: ciò che l'azienda deve pagare (la 0021) e ciò
che deve incassare (la 0053, §12). In entrambe: non muoverlo.

**Stato**: la migrazione `supabase/migrations/0021_finance_operations.sql` è
scritta ed è entrata nel bundle `supabase/full-setup.sql`. La sua applicazione al
database di produzione e l'esecuzione di `npm run test:finance` **non sono state
verificate in questa sessione**: finché quel test non gira sul database vero,
tutto ciò che questo documento dice sul comportamento del database descrive il
CODICE della migrazione, non un'installazione osservata. `npm run test:finance-unit`
invece è stato eseguito: **202 asserzioni superate**, offline.

**Stato della direzione in uscita** (misurato il 2026-09-02): le migrazioni
`supabase/migrations/0053_finance_issued_invoices.sql` e
`0054_issued_invoice_entity_type.sql` sono scritte ed entrate nel bundle, e
**non risultano applicate alla produzione al momento di questa riga**. La
sezione 15 di `npm run test:finance` è scritta e **non è mai stata eseguita**:
finché non gira sul database vero, ciò che §12 dice sul comportamento del
database descrive il CODICE delle due migrazioni, non un'installazione
osservata. La suite offline `npm run test:finance-invoices-unit` invece è stata
eseguita il 2026-09-02: **117 asserzioni superate** — il QR è stato decodificato
dai pixel e il testo dei PDF estratto, non dedotto.

---

## 1. Che cosa fa

Un documento che è una fattura fornitore, una ricevuta o una nota di credito
entra in Finanze e diventa una riga con:

- **chi**, **quanto**, **quando**, **con quale riferimento**;
- da dove viene ogni singolo campo (codice QR · lettura deterministica · modello
  · persona);
- che cosa non torna, come elenco di bandiere che una persona può leggere;
- lo stato del lavoro: da verificare oppure verificata.

Attorno: ricerca e filtri, quattro numeri di cruscotto **per valuta**, il
sospetto di duplicato con il confronto affiancato, lo storico di ogni cambiamento,
e gli agganci verso attività, automazioni, calendario e notifiche.

E nella direzione opposta: l'azienda **emette** fatture verso i propri clienti —
numerate, con l'IVA per riga e la polizza QR svizzera — e ne tiene il registro
delle scadenze e dei pagamenti dichiarati. È la 0053, e sta in §12.

## 2. Che cosa NON fa — l'elenco fa parte del modulo

Questa sezione non è un'appendice: è metà della definizione del modulo. Ciò che
segue **non è implementato**, e in nessun caso per mancanza di tempo.

**Denaro.**

- nessun **pagamento**, in nessuna forma;
- nessun **file di pagamento** (né pain.001, né camt, né alcun formato bancario);
- nessuna **chiamata a una banca**, nessun collegamento bancario, nessun EBICS;
- nessun pulsante «**Paga ora**», e nessuna azione raggiungibile da un IBAN. Un
  IBAN si mostra accanto alla sua provenienza; non è un collegamento, non apre
  niente, non innesca niente;
- nessuna **riconciliazione bancaria**: il prodotto non sa se una fattura è stata
  pagata, e non lo scrive da nessuna parte. «Scaduta» in questo modulo significa
  **scadenza superata**, mai «non pagata».

**Contabilità e fisco.**

- nessuna **registrazione contabile**, nessuna partita doppia, nessun piano dei
  conti. La `finance_expense_category` si chiama «Categoria spesa» proprio per
  non promettere un conto contabile;
- nessuna **dichiarazione IVA** e nessun rendiconto;
- nessuna **determinazione fiscale**: il prodotto non dice mai se una spesa è
  deducibile, a quale aliquota va assoggettata un'operazione, o quale trattamento
  fiscale si applichi.

**Dati.**

- nessuna **anagrafica fornitori**: il fornitore è un nome letto sul documento,
  eventualmente corretto da una persona. Due grafie dello stesso nome restano due
  nomi finché nessuno dice il contrario;
- nessuna **fusione di duplicati** (§7);
- nessun **conto economico**, nessun budget, nessuna previsione di cassa;
- nessuna **conversione di valuta**, in nessun punto del modulo.

**Lettura.**

- nessuna **decodifica dell'immagine** del codice QR (§5.4);
- nessuno **spezzamento** di un PDF che contenga più fatture: in V1 un documento
  produce al più un elemento finanziario, ed è un vincolo unico nel database
  (`uq_finance_items_document`), non una convenzione.

**Emissione (0053).**

- nessuna **riconciliazione automatica** e nessuna lettura bancaria, nemmeno
  sulle fatture emesse: «pagata» esiste, ma è la dichiarazione di una persona
  con la data effettiva del versamento — il prodotto la registra, non la
  verifica;
- nessun **invio automatico dei solleciti**: un sollecito è un documento
  generato (fino a tre livelli); spedirlo resta un gesto umano, come per la
  fattura;
- nessuna **polizza QR fuori da CHF/EUR**: lo standard SIX non ammette altre
  valute, e una fattura in un'altra valuta non si emette — il gesto si ferma,
  non esce un documento senza polizza;
- nessuna **determinazione IVA**, nemmeno in emissione: le aliquote arrivano da
  `finance_vat_rates` con la loro fonte, e quale si applica lo decide la
  persona, riga per riga — il prodotto congela sul documento la scelta e la sua
  fonte, non la prende;
- nessun **riutilizzo dei numeri** e nessuna chiusura dei buchi: la numerazione
  è `max + 1` sotto lock per azienda, dal prodotto una fattura non si cancella
  (§12.1) e nessun percorso va a riempire i numeri mancanti;
- nessuna **nota di credito senza annullo**: il numero NC- esiste solo su una
  fattura stornata, e il PDF della nota si genera solo lì.

Il giorno in cui una di queste cose servirà davvero, servirà prima ciò che oggi
manca: approvazioni, permessi granulari, riconciliazione, tracciamento dei
pagamenti. Finché non ci sono, il prodotto non deve poter muovere denaro.

---

## 3. Architettura

```
   DOCUMENTO                       documents + Storage privato
       │                           (caricato, o arrivato dalla posta)
       ▼
   ESTRAZIONE TESTO                document_extractions
       │                           testo per pagina; `native_pdf` significa che
       │                           il file non è mai stato scaricato dal server
       ▼
   ANALISI (Admin AI)              document_analyses — immutabile dalla 0010
       │                           tipo di documento, tipo di ente, scadenza
       │
       │  trigger `finance_autocreate` su document_analyses
       │  classificatore DETERMINISTICO `finance_type_from_analysis`
       ▼
   ELEMENTO FINANZIARIO            finance_items — processing_status = 'pending'
       │                           review_status  = 'needs_review'
       │
       │  la coda la legge finance-worker (Edge Function, chiamata da uno scheduler)
       ▼
   ESTRAZIONE FINANCE              _shared/finance/process.ts, in TRE passaggi:
       │                             (1) codice QR      → dato strutturato
       │                             (2) testo, deterministico → cifre di controllo
       │                             (3) modello        → SOLO ciò che manca
       ▼
   VERBALE                         finance_extractions — IMMUTABILE, versionato
       │
       │  trigger `finance_after_extraction` → `finance_refresh_effective`
       ▼
   PROIEZIONE                      finance_items.eff_* + dup_key + quality_flags
       │
       ├───────────► VERIFICA UMANA  correzioni (append-only) e «Verificata»
       │                                     │
       │                                     ▼
       └───────────► AUTOMAZIONI      automation_events → workflow_runs
                     ATTIVITÀ         tasks → calendario → notifiche
```

### L'ordine di lettura è il cuore del modulo

Non è negoziabile, ed è scritto in `_shared/finance/process.ts`:

1. **Codice QR** — un payload Swiss QR è dato strutturato scritto dal fornitore
   stesso e verificato riga per riga da `qrbill.ts`. È la fonte più forte che
   esista su una fattura svizzera. Fiducia `1`, e non «alta»: non è una stima.
2. **Testo, deterministico** — IBAN, riferimento a 27 cifre, riferimento
   creditore ISO 11649, IDI, valuta, importi con un'etichetta esplicita. Ciò che
   supera una cifra di controllo non è un'interpretazione: è aritmetica.
3. **Modello** — **solo ciò che manca** dopo (1) e (2). Non si paga l'AI per
   riestrarre ciò che il codice ha già letto con certezza, e soprattutto non si
   sostituisce mai un dato verificato con uno probabile.

**Quando due fonti divergono non si sceglie in silenzio**: si alza
`qr_text_mismatch`, il candidato scartato resta fra le citazioni, e l'elemento
resta da verificare. Sui tre campi che toccano il denaro — `creditor_iban`,
`payment_reference`, `reference_type` — un disaccordo non si liquida mai.

### Perché un worker e non il browser

Nessun `setInterval` da nessuna parte nel frontend. Una fattura che viene letta
solo mentre qualcuno tiene AI-Swisse aperto non è un'automazione: è una cosa che
succede a chi stava già guardando.

Il worker ha un **budget di tempo** di `EDGE_TIME_BUDGET_MS = 100'000 ms` e non
comincia una nuova lettura se non ha almeno `FINANCE_SLOT_MS = 40'000 ms` davanti
a sé: Supabase chiude la richiesta a 150 secondi e **uccide l'isolate**, quindi
il `finally` non gira. Ciò che è stato preso in carico e non finito lo recupera il
meccanismo degli interrotti (`FINANCE_STALE_MINUTES = 30`), che è la sola cosa
che impedisce a un elemento di restare «in lavorazione» per sempre — uno stato
appeso è indistinguibile da un lavoro in corso.

Un'esecuzione prende al massimo `FINANCE_BATCH = 5` elementi e ritenta al massimo
`FINANCE_MAX_ATTEMPTS = 3` volte. Il tetto di spesa AI per azienda è
`FINANCE_RATE_LIMIT_PER_MINUTE = 12` al minuto — **lo stesso** di `analyze-document`
e dell'Inbox, perché è il tetto dell'azienda, non un dettaglio di questo modulo.

### Che cosa succede quando la chiave AI non è configurata

La lettura deterministica gira lo stesso, e ciò che manca resta `null`,
**dichiarato** con il codice `AI_NOT_CONFIGURED`. Non si finge un'estrazione
riuscita, e non si finge nemmeno un guasto generico.

---

## 4. Il modello dati, tabella per tabella

Cinque tabelle nuove. Nessuna di esse duplica un dato che vive già altrove: il
file resta del documento, il testo resta dell'estrazione, la lettura
amministrativa resta dell'analisi, la provenienza resta dell'Inbox, il lavoro
resta delle attività.

### 4.1 `finance_items` — lo stato operativo

Qui sta ciò che una **persona decide** (l'ho verificata, l'ho archiviata, è una
spesa di viaggio) e ciò che serve per **filtrare, ordinare e sommare**. I fatti
letti dal documento stanno altrove.

| colonna | perché |
|---|---|
| `document_id` + `on delete cascade` | se il documento sparisce non deve restare una fattura che rimanda al nulla |
| `uq (company_id, document_id)` | in V1 un documento produce al più un elemento. Il giorno in cui servirà spezzare un PDF con dieci fatture, questo vincolo è il punto in cui la decisione andrà presa esplicitamente |
| `processing_status` **≠** `review_status` | «l'estrazione è fallita» e «i dati vanno verificati» sono due cose diverse. Fonderle renderebbe un guasto tecnico indistinguibile dal lavoro |
| `origin` (`rule` · `manual` · `workflow`) | chi ha deciso che questo documento è un documento finanziario. Lo scrive il trigger, non il client |
| `quality_flags` | chiavi, non frasi: la frase la scrive l'interfaccia nella lingua di chi legge |
| `check (review_status <> 'ready' or current_extraction_id is not null)` | «pronta» senza dati letti sarebbe una dichiarazione a vuoto |
| nessun `delete`, né grant né policy | un elemento finanziario non si cancella: si archivia, oppure si cancella il documento e la cascata porta via anche questo |

**`archived` non è uno stato di verifica**, ed è una scelta: se lo fosse,
archiviare una fattura verificata cancellerebbe l'informazione che era stata
verificata. L'archiviazione è un `archived_at`, come su `documents` e su `tasks`.

**I tre valori di `finance_item_type`** sono `supplier_invoice`, `receipt`,
`credit_note`, e non esiste un «altro documento finanziario»: nel dubbio il
documento resta **fuori** da Finance e lo si dice, invece di creare una fattura
incerta che poi qualcuno tratterà come certa.

#### ⚠️ Perché le colonne `eff_*` sono una PROIEZIONE e non una seconda verità

Le `eff_*` (`eff_supplier_name`, `eff_gross_amount`, `eff_due_date`, `eff_iban`…)
contengono il **valore effettivo** di ogni campo: l'ultima estrazione riuscita
più le correzioni umane in ordine cronologico, l'ultima di ogni campo vince.

Sono una proiezione, e la differenza rispetto a una seconda verità è precisa:

1. **le scrive un solo pezzo di codice** — `finance_refresh_effective(uuid)` — che
   le ricalcola **per intero** ogni volta, da zero. Non esiste un percorso che ne
   aggiorni una sola;
2. **il client non ha alcun permesso di scrittura su di esse**: il `grant update`
   elenca solo `type`, `review_status`, `archived_at`, `expense_category`,
   `payment_method`, `processing_status`;
3. **il guardiano annulla qualunque altra scrittura**, anche dal service role,
   anche per sbaglio;
4. **qualcuno lo verifica**: `test:finance` (sezione 6) prova che la proiezione si
   ricalcola e che il guardiano non la annulla quando è il ricalcolo a scrivere.

Perché esistono invece di essere ricomposte in lettura, come fa `list_documents`
per i documenti: i totali per valuta sono un `sum() group by`, e l'ordinamento
per scadenza più il riconoscimento dei duplicati hanno bisogno di **indici**. Su
un jsonb ricomposto riga per riga non si indicizza niente, e ogni numero del
cruscotto diventerebbe una scansione di tutte le fatture dell'azienda. Il
precedente nel progetto è dichiarato: `email_messages.analysis_deadline` è una
copia sulla riga del messaggio tenuta per poter filtrare e ordinare senza join.

##### La sentinella del guardiano è esplicita, e non `pg_trigger_depth()`

Merita di essere raccontato perché è un difetto trovato e corretto. La prima
versione del guardiano riconosceva il ricalcolo dalla profondità dei trigger,
dando per scontato che arrivasse sempre da un altro trigger. Ma
`finance_refresh_effective` è chiamabile **anche direttamente** — dal worker con
il service role, o da uno script di ripopolamento — e in quel caso il suo UPDATE
fa scattare il guardiano a profondità 1: la proiezione appena calcolata verrebbe
**rimessa com'era**, riga per riga, senza alcun errore. I totali del cruscotto
resterebbero vuoti e nessuno saprebbe perché.

La sentinella è quindi un `set_config('ai_swisse.finance_refresh', '1', true)`,
valido per la sola transazione corrente. Una sentinella che dipende da **come** si
arriva a una funzione, invece che da **che cosa** la funzione sta facendo, è un
difetto in attesa del primo chiamante diverso.

##### `dup_key`

Impronta del duplicato sospetto: fornitore normalizzato · numero normalizzato ·
importo lordo · valuta. È `null` quando manca anche uno solo dei quattro pezzi, e
in quel caso non si sospetta niente — sospettare su due campi su quattro
produrrebbe accuse a caso.

### 4.2 `finance_extractions` — il verbale, immutabile e versionato

Stessa disciplina di `document_analyses` dalla 0010: **uno snapshot non si
corregge, si affianca**. Un secondo tentativo produce la versione 2 e la 1 resta
leggibile — è ciò che permette di rispondere a «prima diceva un altro importo?»
con un fatto invece che con un'impressione.

Il divieto vale **anche per il service role**: il trigger
`finance_extractions_immutable` rifiuta `update` e `delete` da chiunque. Il worker
gira proprio con il service role, e un giorno qualcuno potrebbe pensare di
«aggiornare» un'estrazione invece di scriverne una nuova. Un verbale che si
corregge non è un verbale.

Dettagli non ovvi:

- **`numeric` senza precisione dichiarata** sugli importi. Un `numeric(18,2)`
  arrotonderebbe **in silenzio** un importo con tre decimali, che è esattamente il
  tipo di modifica invisibile che questo progetto non fa;
- **`vat_breakdown` con gli importi come STRINGHE decimali**
  (`[{"rate":8.1,"taxableBase":"100.00","taxAmount":"8.10","source":"ai"}]`):
  passare da un numero JSON significherebbe farli transitare per un `double`;
- **`field_sources`** — campo → `qr` | `deterministic` | `ai`. Un'estrazione
  ibrida è la norma, non l'eccezione: l'IBAN dal codice, il fornitore dal testo,
  l'IVA dal modello. Le origini non si mescolano mai dentro un campo, perché
  mescolarle toglierebbe a chi verifica l'unica cosa che gli serve sapere;
- **`field_confidence`**, **`evidence`** (citazione, offset, pagina) e
  **`uncertainties`**: un valore senza la sua certezza e senza il punto del
  documento da cui viene non è verificabile;
- **`iban_is_qr`** — un QR-IBAN (QR-IID 30000–31999) non è un formato diverso: è
  un **istituto** diverso, e determina quale riferimento è ammesso.

### 4.3 `finance_corrections` — le correzioni umane, in aggiunta

Append-only: si aggiunge, non si riscrive. L'ordine cronologico decide, e l'ultima
correzione di un campo vince. `update` e `delete` sono rifiutati da un trigger
**e** non hanno grant: due difese, perché una sola è quella che manca il giorno in
cui qualcuno cambia un grant.

#### ⚠️ Perché NON si riusa `analysis_corrections`

Non è una preferenza di stile, ed è la ragione più concreta dell'intero schema.

`list_documents` (0017) aggrega **tutte** le correzioni di un documento in una
mappa `jsonb_object_agg(field, corrected_value)` e poi fa
`coalesce(corrections->>'amount', a_amount)`. Una correzione finanziaria salvata
là con `field = 'amount'` **cambierebbe l'importo che il Document Hub mostra per
quel documento** — un campo che descrive l'analisi amministrativa, non la fattura.

Lo stesso vale per la coppia più insidiosa:

| campo | che cosa significa | dove vive |
|---|---|---|
| `deadline` | il **termine del documento** letto dall'analisi («rispondere entro il…») | `document_analyses` |
| `due_date` | la **scadenza di pagamento** della fattura | `finance_extractions` |

Sono due date diverse che il capitolato vuole esplicitamente distinte **e
confrontabili fra loro**: quando differiscono, il ricalcolo alza
`inconsistent_due_date` invece di sceglierne una in silenzio. Riusare la stessa
tabella le avrebbe fuse, e con esse la possibilità stessa di accorgersi che non
coincidono.

**I campi correggibili sono un elenco chiuso** (`finance_correction_field_known`,
quindici campi). Un campo fuori elenco non è «un campo che non conosciamo»: è una
scrittura che non deve avvenire, perché la proiezione non saprebbe che farsene e
il dato resterebbe invisibile. L'elenco SQL e
`FINANCE_CORRECTABLE_FIELDS` di `contract.ts` devono coincidere **esattamente**:
`test:finance-unit` legge il vincolo **dal file SQL** e li confronta.

**Una correzione malformata viene rifiutata all'ingresso, non a valle.** Il
ricalcolo converte con `try_date`/`try_numeric`, che tornano `null` su un testo
non convertibile e farebbero quindi ripiegare sul valore dell'estrazione:
conseguenza, una correzione con un valore malformato verrebbe **salvata**,
comparirebbe fra i «campi corretti a mano», e la schermata continuerebbe a
mostrare il valore vecchio. Una persona convinta di aver corretto un importo, e un
importo che non è cambiato. È esattamente il fallback silenzioso che questo
progetto non ammette. I codici di rifiuto sono `finance_correction_bad_date`,
`…_bad_amount`, `…_bad_currency`, `…_bad_reference_type`, `…_bad_iban`.

**L'IBAN corretto a mano deve superare la propria cifra di controllo**: è il campo
a rischio più alto del modulo, e un IBAN che non torna è quasi sempre un refuso di
trascrizione.

**Una correzione si firma con il proprio nome, e il rifiuto è esplicito.** Chi
prova a firmare come un collega riceve `finance_correction_author_mismatch`, non
una conferma. È la lezione dei commenti delle attività (0016): là la versione
precedente sostituiva l'autore in silenzio e rispondeva «inserito» — il risultato
era sicuro, ma un fallback silenzioso resta un fallback silenzioso anche quando il
suo esito è innocuo.

### 4.4 `finance_events` — lo storico

Lo scrivono i trigger; il client ha solo `select`. Uno storico che una schermata
può fabbricare non è uno storico. **Non si registra la lettura**: tracciare ogni
visualizzazione è espressamente escluso.

Gli eventi: `created`, `extraction_completed`, `extraction_failed`, `corrected`,
`reviewed`, `reopened`, `archived`, `restored`, `type_changed`,
`category_changed`, `retry_requested`.

### 4.5 `finance_vat_rates` — le aliquote come dato

Vedi §6.

---

## 5. ⚠️ Lo standard QR-fattura

### 5.1 Le versioni, verificate

Il modulo `supabase/functions/_shared/finance/qrbill.ts` è scritto contro le
**Swiss Implementation Guidelines for the QR-bill** di SIX — il documento
ufficiale, non una descrizione di seconda mano.

| | |
|---|---|
| **Versione letta e verificata** | **2.4 del 24.02.2026**, valida **dal 14 novembre 2026** |
| **Versione in vigore alla data di verifica** | **2.3 del 21.11.2025**, che secondo il controllo delle versioni della 2.4 resta valida **fino a novembre 2027** |
| **Data della verifica** | **2026-07-27** |
| **Fonte primaria** | `https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.4-en.pdf` |

Le due versioni **convivono**: un lettore deve saperle leggere entrambe.

Fra la 2.3 e la 2.4 la **struttura** del codice non cambia — stesso ordine, stesse
occorrenze, stesso separatore — e la 2.4 lo dichiara: l'aggiornamento non comporta
adeguamenti tecnici per la fatturazione in franchi. L'unica differenza tecnica
riguarda l'**euro**, per la dismissione di euroSIC. Per un **lettore** le due
versioni si trattano quindi allo stesso modo, ed è per questo che il modulo può
dichiarare di supportarle entrambe senza doverle distinguere.

Una conseguenza è già scritta nel codice: la regola «riferimento QR solo per
fatture in CHF» compare nella **2.4** e **non** nella 2.3, che è quella in vigore.
Una fattura in euro con riferimento QR emessa oggi è ancora conforme, quindi
`qrr_only_chf` è una violazione **non bloccante**: si dichiara e basta. Segnalarla
come errore bloccante vorrebbe dire rifiutare un documento valido in nome di una
regola non ancora entrata in vigore.

### 5.2 Che cosa il parser supporta

**Struttura.** Le 31 righe obbligatorie (da `QRType` a `Trailer`) e fino a 34 con
le informazioni di fatturazione e due procedure alternative. Il ritorno a capo è
CR+LF oppure LF, normalizzato in lettura — la struttura è posizionale, quindi
accettare entrambi non indebolisce nulla. Tetto di 997 caratteri: oltre, il codice
non sarebbe generabile, quindi un testo più lungo non è una QR-fattura.

**Versione.** `QRType = SPC`, `Version = 0200`, `Coding = 1`, `Trailer = EPD`. Una
designazione diversa dentro la versione **principale 02** è una violazione **non
bloccante**, e la scelta è deliberata: una versione futura della 02 resta
leggibile con questa disposizione, e rifiutarla renderebbe il prodotto cieco il
giorno dell'aggiornamento invece che semplicemente prudente.

**IBAN e QR-IBAN.** Formato, **paese ammesso** (solo `CH` e `LI` su una
QR-fattura), lunghezza 21, cifra di controllo ISO 7064 MOD 97-10. L'ordine dei
controlli decide il messaggio e il messaggio è metà del valore della funzione: un
IBAN tedesco è di 22 caratteri, e verificando prima la lunghezza si otterrebbe
«formato non valido», che manda a cercare un refuso inesistente. Il QR-IBAN si
riconosce dal QR-IID **30000–31999**.

**Riferimenti**, con le loro cifre di controllo:

| tipo | forma | controllo | regole incrociate |
|---|---|---|---|
| `QRR` | 27 cifre | modulo 10 ricorsivo | richiede un QR-IBAN (`qrr_requires_qr_iban`) |
| `SCOR` | ISO 11649 (`RF…`) | modulo 97 | — |
| `NON` | vuoto | — | un riferimento presente è dichiarato (`reference_present_with_non`) |

Un **QR-IBAN senza riferimento QR** è un errore del documento
(`reference_required_for_qr_iban`): quel conto esiste proprio per essere abbinato a
un riferimento.

**Indirizzo strutturato E combinato in lettura.** Il tipo `S` (strutturato) è
l'unico ammesso dalla 2.3 in poi per le fatture **nuove**; il tipo `K` (combinato)
non lo è più, ma le fatture emesse prima **restano in circolazione e vanno lette**.
Rifiutarle significherebbe non saper leggere documenti perfettamente legittimi.
`formatQrAddress()` rende le due forme allo stesso modo: chi legge non deve sapere
quale forma aveva il codice.

**Il parser non «aggiusta» niente.** Se qualcosa non torna lo dichiara e, se è
bloccante, **si rifiuta di restituire i dati**. Un codice QR letto a metà e
presentato come completo sarebbe peggio di un codice non letto: ci sarebbe un IBAN
accanto a un importo, e nessuno saprebbe che uno dei due non è affidabile.

**Il contenuto è dato, non comandi.** Un codice QR è scritto da un terzo: le
stringhe si troncano alle lunghezze dello standard, i caratteri di controllo si
rimuovono, e non se ne ricava nessun URL da aprire, nessun HTML, nessun comando.

### 5.3 Le violazioni sono chiavi, non frasi

`QrIssueCode` elenca 23 codici, ognuno corrispondente a una regola scritta nelle
Implementation Guidelines — non a un'opinione su come dovrebbe essere fatta una
fattura. Ogni violazione porta il campo interessato e se è **bloccante**.

### 5.4 ⚠️ I LIMITI

**La decodifica dell'immagine del codice QR non è implementata.**

`decodeSwissQrFromDocument()` esiste, è tipizzata, e restituisce sempre
`{ available: false, reason: 'RASTERIZER_NOT_AVAILABLE' }`. Due ragioni, entrambe
strutturali:

1. **la pipeline non ha un rasterizzatore**. Servirebbe trasformare la pagina PDF
   in un'immagine e poi leggere il codice a barre da quei pixel;
2. **sul percorso `native_pdf` il file non arriva nemmeno al server**. È il
   percorso della grande maggioranza delle fatture svizzere: il worker lavora sul
   testo già estratto, e non c'è nulla da decodificare, nemmeno volendo.

**E non si chiede a un modello linguistico di «leggere l'IBAN dal QR».** Un codice
QR è una struttura binaria con una correzione d'errore, non un testo da
interpretare. Farlo indovinare sarebbe l'esatto contrario di una decodifica
deterministica, e produrrebbe un IBAN **plausibile** — cioè il tipo di dato che
questo modulo esiste per non produrre.

**Conseguenza sulla provenienza dei dati di pagamento**, e va detta con
precisione:

- **nel caso ordinario** — una fattura con il suo codice QR stampato e nient'altro
  — il payload **non viene letto**. IBAN, riferimento e valuta vengono dal
  **testo**, letti da `readDeterministic()`, e la loro `field_sources` è
  **`deterministic`**, mai `qr`. Se nel testo ci sono indizi di una QR-fattura (un
  QR-IBAN, o un riferimento a 27 cifre) ma nessun payload leggibile, si alza la
  bandiera **`qr_not_read`**: da qualche parte su quel foglio c'è un codice che non
  abbiamo decodificato, e lo si dice. La bandiera si alza **solo** in questo caso —
  alzarla su ogni documento senza payload la renderebbe rumore su ogni ricevuta di
  taxi;
- **`field_sources = 'qr'` compare comunque**, e non è una contraddizione: capita
  davvero che alcuni generatori scrivano il contenuto del codice **anche come
  testo** nel PDF, e che alcuni motori di OCR restituiscano il payload accanto
  all'immagine. `findSwissQrPayload()` lo cerca nel testo (comincia per `SPC`,
  finisce con `EPD`, almeno 31 righe) e quando c'è è dato strutturato al cento per
  cento, verificato riga per riga. Quello — e solo quello — è `qr`.

Detto altrimenti: **il modulo non decodifica immagini; legge un payload QR solo se
qualcun altro lo ha già scritto in chiaro nel documento.** Il rapporto del worker
conta i due casi separatamente (`qrRead`).

### 5.5 Come si aggiorna quando esce una versione nuova

**Il punto unico è `SPEC` in `qrbill.ts`.** È l'unico posto in cui una versione
dello standard è nominata: `verifiedVersion`, `verifiedOn`, `inForceVersion`,
`nextVersionFrom`, `sourceUrl`, più i valori ammessi (`qrType`, `version`,
`coding`, `trailer`, `minLines`, `maxLines`, `currencies`, `maxPayloadChars`).

Il procedimento:

1. **leggere il PDF ufficiale di SIX**, non una descrizione di seconda mano;
2. aggiornare `SPEC`, compresi `verifiedOn` e `sourceUrl`;
3. **se e solo se la disposizione delle righe cambia**, diramare in
   `lineLayout()` — è l'unica funzione che dipende dalla versione. Tutto il resto
   ragiona su un oggetto già interpretato;
4. aggiornare questa sezione del documento con la nuova data di verifica;
5. rieseguire `npm run test:finance-unit`: la sezione 4 legge l'esempio ufficiale
   delle guideline e prova che **ogni regola può fallire**.

Il giorno in cui una versione cambierà davvero la struttura, i punti in cui
intervenire sono quei due e nient'altro.

---

## 6. L'IVA

### Perché le aliquote sono un DATO, non una costante nel codice

`finance_vat_rates` tiene le aliquote ufficiali con **validità e fonte**:

| colonna | |
|---|---|
| `country_code`, `kind` (`standard` · `reduced` · `special`), `rate` | l'aliquota |
| `valid_from`, `valid_to` | da quando, fino a quando (`null` = ancora in vigore) |
| `source_url`, `source_title` | **da dove viene il numero** |
| `checked_at` | **quando qualcuno l'ha verificato** |

Un'aliquota cambia per decisione politica, e il giorno in cui cambierà nessuno
dovrà ricompilare niente. Un numero fiscale senza fonte e senza data di verifica
non è un dato: è una voce.

### Le aliquote seminate, verificate

| tipo | aliquota | dal | fonte | verificata |
|---|---|---|---|---|
| `standard` | **8.1 %** | 01.01.2024 | AFC/ESTV — *Schweizer Mehrwertsteuersätze* | **2026-07-27** |
| `reduced` | **2.6 %** | 01.01.2024 | idem | 2026-07-27 |
| `special` (alloggio) | **3.8 %** | 01.01.2024 | idem | 2026-07-27 |

`https://www.estv.admin.ch/estv/de/home/mehrwertsteuer/mwst-steuersaetze.html`

### ⚠️ Le aliquote STORICHE non sono state seminate

E non per dimenticanza: **non sono state verificate su una fonte primaria**. La
pagina dell'AFC che le elenca non era leggibile al momento della verifica.
Seminarle a memoria avrebbe messo nel database dei numeri fiscali non verificati,
che è peggio di non averli — perché un numero nel database viene trattato come un
fatto.

Conseguenza pratica, dichiarata: per una fattura del 2023 il prodotto **non ha
un'aliquota da suggerire**. Non ne inventa una.

### ⚠️ Sono SUGGERIMENTI, non un validatore

Un'aliquota che non compare in questa tabella — una fattura del 2023, una fattura
estera, un'aliquota di un altro paese — è **perfettamente valida e viene accettata
così com'è**. Non si trattano le aliquote svizzere correnti come gli unici valori
ammessi: farlo significherebbe rifiutare documenti veri.

Che cosa il prodotto fa davvero sull'IVA:

- **conserva** il dettaglio letto (`vat_breakdown`: aliquota, base imponibile,
  imposta, provenienza della riga);
- **verifica l'aritmetica**: se il dettaglio non somma al totale IVA alza
  `vat_mismatch`; se lordo ≠ netto + IVA oltre la tolleranza alza
  `amount_mismatch`. La tolleranza è di **un centesimo per aliquota** (da 1 a 10
  righe), perché l'arrotondamento di riga è reale e segnalare una fattura corretta
  insegnerebbe a ignorare le segnalazioni;
- **non deduce e non decide**: non dice quale aliquota si sarebbe dovuta
  applicare, non calcola un'IVA mancante, non prepara un rendiconto.

### ⚠️ Limite dichiarato: sul lato fornitori la tabella resta seminata e non consumata

Questo limite era «nessun codice dell'applicazione la legge», ed era vero fino
alla 0049. Dal 2026-09-01 i preventivi la leggono (`crmQuoteService.vatRates`)
e dal 2026-09-02 le fatture emesse la consumano riga per riga, con la fonte
congelata sul documento (§12.1). Ciò che resta vero è il caso per cui la
tabella era nata: il **suggerimento delle aliquote in fase di correzione
manuale** di una fattura fornitore **non è stato collegato all'interfaccia**. È
un lavoro rimasto aperto, non una funzione presente.

---

## 7. Duplicati: esatto contro sospetto

Sono due cose diverse e non vanno confuse.

### Duplicato ESATTO — è un fatto

Stesso **contenuto del file**, cioè stesso `documents.file_hash`. È
identità di risorsa, non un'inferenza, e vive già nel Document Hub dalla 0017: lo
stesso PDF allegato a due email produce **un** documento, con due comunicazioni di
provenienza. La ricerca è sempre dentro l'azienda — che un'altra impresa possieda
lo stesso file non è deducibile in alcun modo.

### Duplicato SOSPETTO — è un'ipotesi

Stessa **impronta semantica**: fornitore normalizzato · numero normalizzato ·
importo lordo · valuta (`finance_dup_key`). È `null` se manca anche uno solo dei
quattro, e allora non si sospetta niente.

**Normalizzare non è ripulire.** Le funzioni producono una chiave di **confronto**;
il valore mostrato resta quello letto. «Swisscom (Svizzera) SA» si mostra così
com'è e si confronta come `swisscom svizzera sa`.

Sul numero di fattura si tolgono **solo** spazi, punti e cancelletti — ornamenti
tipografici — e **non** si toccano lettere né trattini, che portano informazione:

| | |
|---|---|
| `847 291` ≡ `847291` ≡ `N. 847291` → stesso numero | gli spazi e il punto sono ornamenti |
| `2026-1` ≠ `20261` | il trattino separa l'anno dal progressivo |
| `N847291` ≠ `847291` | la lettera può essere una serie |

**Il prezzo, dichiarato:** se un'estrazione legge `N847291` e un'altra `847291`, il
duplicato **non viene sospettato**. È il verso giusto in cui sbagliare — un
sospetto mancato costa una verifica in più, un sospetto sbagliato insegna a
ignorare i sospetti.

### ⚠️ Il sospetto non si memorizza, si calcola

Una prima versione lo scriveva fra le bandiere e aggiornava anche la controparte.
Ma il sospetto **dipende da che cosa c'è intorno** e cambia senza che quella riga
venga toccata: basta archiviare l'altra fattura, o correggerne il numero, perché
la bandiera memorizzata resti accesa su un duplicato che non esiste più.

Si calcola dove serve — `list_finance_items` lo aggiunge alle bandiere di ogni
riga con una `lateral` — e così non può invecchiare. L'etichetta
`duplicate_suspected` resta nell'enum perché è il vocabolario con cui
l'interfaccia spiega perché una fattura va guardata.

### Perché non si fonde MAI

`finance_duplicates(item_id)` restituisce le controparti — fino a venti, sempre
dentro l'azienda — perché una **persona** possa guardarle accanto. Non fonde,
non cancella, non archivia niente per conto proprio.

Fondere significherebbe decidere quale delle due letture è quella giusta, e quella
decisione richiede di guardare i due documenti. Due fatture con lo stesso numero
esistono davvero: un fornitore che rimanda la stessa fattura, un acconto e un
saldo mal numerati, una nota di credito che ripete il numero dell'originale. Una
fusione automatica farebbe sparire un documento vero, e il costo di sbagliare è
asimmetrico: un confronto in più costa un minuto, una fattura scomparsa costa un
sollecito.

Per la stessa ragione «Swisscom» e «Swisscom SA» restano **soggetti diversi**
finché nessuno dice il contrario: la normalizzazione serve a sospettare, mai a
identificare.

---

## 8. Integrazione con il resto del prodotto

### Automazioni (0020)

Due inneschi nuovi, e sono gli unici due momenti in cui una persona vuole essere
avvisata:

| innesco | quando |
|---|---|
| `finance_item_needs_review` | la lettura è **riuscita** e nessuno l'ha ancora verificata |
| `finance_item_ready` | una persona l'ha **verificata**: da qui i dati si possono usare |

⚠️ **Una lettura fallita non emette niente.** Un'estrazione non riuscita non
descrive nulla, e far scattare una regola su di essa significherebbe creare lavoro
o classificare sulla base di dati che non esistono. Il fallimento resta visibile
nella schermata, che è il posto giusto per una persona.

**L'entità dell'evento è il `document`, non l'elemento finanziario.** Due ragioni:
`automation_events` e `workflow_runs` hanno un `check (entity_type in
('document','email_message','task'))` e un'entità nuova andrebbe cambiata in sei
punti coordinati; ed è la scelta giusta nel merito — una fattura è una **lettura**
di un documento, e una regola che parla di fatture vuole poter guardare anche la
categoria, il mittente e la scadenza di quel documento.

I campi disponibili alle condizioni: `finance.type`, `finance.supplier`,
`finance.invoice_number`, `finance.gross_amount`, `finance.vat_amount`,
`finance.currency`, `finance.due_date`, `finance.invoice_date`,
`finance.review_status`, `finance.duplicate_suspected`,
`finance.has_quality_flags`.

⚠️ **Nessun campo di automazione tocca un IBAN o un riferimento di pagamento**, ed
è verificato dal test: un IBAN si mostra, non innesca nulla. I due campi che sono
importi portano `hasCurrency`, quindi una condizione su un importo richiede la
valuta e, se la valuta del documento è diversa, la condizione è **non
determinabile** — mai falsa, e mai convertita.

**La catena causale non si spezza**: `finance_items.workflow_run_id` eredita
`documents.category_workflow_run_id` quando il documento è finito in quella
categoria per via di una regola aziendale. Senza quel filo, l'evento emesso da
Finance aprirebbe una catena **nuova** e la protezione contro i cicli non avrebbe
appiglio.

### Attività, calendario e notifiche

Dal dettaglio di una fattura si crea un'attività con **lo stesso codice** del
Document Hub (`features/tasks/taskFromDocument.ts`): due copie della stessa regola
col tempo divergono, e a divergere sarebbe proprio la parte che decide cosa **non**
copiare.

Nel motore delle automazioni la modalità di scadenza `from_finance_due_date` /
`before_finance_due_date` esiste **separata** da `from_deadline`, e per la ragione
di §4.3: il termine letto dall'analisi amministrativa e la scadenza di pagamento
di una fattura possono differire, e sovrascrivere l'una con l'altra è vietato. Chi
crea un'attività su una fattura vuole la data in cui va pagata.

Da lì in avanti il percorso è quello già in esercizio: l'attività ha una scadenza →
il calendario la proietta → i promemoria arrivano nelle finestre dichiarate (sette
giorni, un giorno, il giorno stesso, e una volta sola quando diventa scaduta), mai
prima delle 8 locali di chi li riceve. **Finanze non aggiunge nessuna coda, nessun
promemoria proprio e nessuna notifica propria**: aggiungerne avrebbe significato un
secondo posto in cui vive una scadenza.

⚠️ **In un'email di notifica non finiscono importi, IBAN, mittenti né contenuti di
documenti** — è la regola già scritta per il calendario, e questo modulo non la
allenta.

### Documenti e Inbox

Il documento resta la fonte: titolo, provenienza (caricamento · email · testo
incollato), file originale, testo estratto, analisi. Il dettaglio della fattura
rimanda al documento e alla comunicazione da cui è arrivato, e non ne conserva
copie. Cancellato il documento, la cascata porta via l'elemento finanziario, il
verbale, le correzioni e lo storico: non resta niente.

---

## 9. Sicurezza

### RLS e permessi

RLS attiva su tutte e cinque le tabelle, e la migrazione **lo verifica prima di
dirsi riuscita**.

⚠️ **Il `revoke all` viene prima dei `grant`, e non è una formalità.** Su Supabase
esiste `alter default privileges in schema public grant all on tables to anon,
authenticated, service_role`: ogni tabella nuova di `public` nasce con i permessi
di **tabella completi** per `authenticated`, e un `grant` di colonna scritto dopo
**aggiunge** privilegi, non ne toglie. È la lezione della 0014, e qui pesa il
doppio: senza quelle righe `finance_extractions` sarebbe scrivibile e cancellabile
dal browser da chiunque sia autenticato — una tabella che contiene IBAN,
riferimenti di pagamento e importi.

Che cosa può fare il client, per intero:

| tabella | client autenticato |
|---|---|
| `finance_items` | `select`; `insert` di **tre colonne** (`company_id`, `document_id`, `type`); `update` di **sei** (`type`, `review_status`, `archived_at`, `expense_category`, `payment_method`, `processing_status`). **Nessun `delete`** |
| `finance_extractions` | **solo `select`** |
| `finance_corrections` | `select` e `insert`. Mai `update`, mai `delete` |
| `finance_events` | **solo `select`** |
| `finance_vat_rates` | **solo `select`** |

Tutto il resto — proiezione, bandiere, timbri, estrazione corrente, tentativi,
provenienza — è materia del database e del worker. `service_role` non viene
toccato: il worker deve poter scrivere.

**Il timbro lo scrive il database**, mai il client: `reviewed_at`/`reviewed_by`,
`archived_at`/`archived_by`, `expense_category_set_by`/`_set_at` vengono da
`auth.uid()` e `now()`. Il client dichiara l'intenzione, il valore vero lo mette il
guardiano. Quando il worker gira con il service role `auth.uid()` è `null`, e resta
`null`: **attribuire a una persona un'azione della macchina è un dato inventato**.

**Isolamento fra aziende, tre strati e non uno.** `list_finance_items`,
`finance_summary` e `finance_duplicates` sono `security invoker` — la RLS di ogni
tabella continua ad applicarsi riga per riga — **più** il filtro esplicito su
`company_id`, **più** `is_company_member()` come sottointerrogazione scalare. Su una
funzione che restituisce IBAN e importi gli strati sono tre.

**L'autoverifica della migrazione** controlla, prima di dichiararsi riuscita: che i
verbali non siano scrivibili dal client, che le correzioni non siano modificabili
né cancellabili, che gli elementi non siano cancellabili, che **nulla** sia
raggiungibile da `anon`, e che la RLS sia accesa su tutte e cinque. Il controllo
cerca il ruolo `PUBLIC` **in maiuscolo e in minuscolo**: `information_schema` lo
riporta in maiuscolo, e cercare solo `public` lascerebbe scoperto proprio il ruolo
che vale per chiunque — un controllo che guarda dalla parte sbagliata e dichiara
verde.

### Che cosa NON finisce nei log

Nei log del worker entrano **soltanto identificativi e codici**:

```
[finance-worker] item=<uuid> company=<uuid> outcome=completed code=-
```

Mai IBAN, mai riferimenti di pagamento, mai nomi di fornitori, mai importi, mai
testo del documento, mai il messaggio grezzo di un errore. Quest'ultima non è
pedanteria: **un messaggio del database può contenere il valore che ha violato un
vincolo**, e in questo modulo quel valore è un IBAN. Per questo `codeOf()` estrae
al massimo la prima parola, e solo se è un identificatore.

Il rapporto restituito dalla Edge Function è fatto di conteggi e bandiere:
`claimed`, `completed`, `failed`, `retryLater`, `noText`, `scannedNoText`,
`notFinancial`, `outputTruncated`, `qrRead`, `aiCalls`, `pendingLeft`,
`timeBudgetReached`. Niente che descriva un documento, un fornitore o un pagamento.

⚠️ I quattro conteggi di fallimento non sono un dettaglio contabile: `failed` da
solo non dice che cosa fare. «Non era una fattura» si archivia, «non sono riuscito
a leggerlo» (`scannedNoText`) chiede di rileggere il file con l'OCR, e
`outputTruncated` non riguarda affatto il documento — è il nostro tetto di token
da rivedere. Tre azioni diverse dietro lo stesso numero.

Anche verso il client escono **codici**, non messaggi grezzi: `FINANCE_ERROR_CODES`
è un elenco chiuso di dodici chiavi, e la frase la scrive l'interfaccia nella lingua
di chi legge. Un messaggio del database contiene nomi di tabelle, che a chi legge
non dicono niente e a chi guarda dicono troppo.

### Perché non esiste alcun percorso di pagamento

Non è una scelta di interfaccia da poter cambiare con un pulsante. Non esiste:

- nessuna colonna che rappresenti un ordine, un mandato o uno stato di pagamento;
- nessuna funzione SQL che produca un file o un messaggio di pagamento;
- nessuna Edge Function che chiami un servizio bancario;
- nessuna azione delle automazioni che possa toccare un IBAN — il registro non ha
  `pay_invoice`, non ha `change_IBAN`, non ha `bank_transfer`, e il campo
  `riskLevel` fa eseguire automaticamente **solo** le azioni `low`;
- nessun campo di condizione che nomini un IBAN, verificato dal test.

L'IBAN è conservato perché serve a **preparare** il pagamento, che una persona
eseguirà altrove, nel proprio e-banking. È un testo da mostrare accanto alla sua
provenienza.

### Input non fidato

Il contenuto di un codice QR, il testo di un documento e il nome di un fornitore
sono scritti da terzi. Il payload QR diventa **solo dati** (§5.2). Il testo del
documento passa dal modello, ma:

- **la validazione è a valle**: output malformato, campi fuori schema, importi non
  numerici e citazioni non ritrovabili nel testo vengono **scartati e dichiarati**;
- un tentativo di **prompt injection** dentro il documento non sposta di un
  centesimo i valori strutturati, ed è provato da `test:finance-unit` sezione 5;
- ciò che ha superato una **cifra di controllo** non viene mai sostituito da ciò
  che il modello ha detto.

---

## 10. Configurazione manuale necessaria

⚠️ **Due cose vanno fatte a mano, e senza di esse la coda non viene mai letta.**
Un elemento resterebbe `pending` per sempre — visibile nella schermata, ma senza
dati.

### 10.1 Il segreto del worker

`finance-worker` è chiamata da uno scheduler, non da una persona, e si autentica
con un segreto confrontato **a tempo costante**. Senza segreto configurato la
funzione risponde **503** (`CONFIG_MISSING`) e non **403**: «non sono pronto» e
«non sei tu» sono due cose diverse, e chi mette in esercizio il prodotto deve
poterle distinguere.

```bash
export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w)

# 1. deploy della funzione — ⚠️ --no-verify-jwt: la chiama il cron, non ha un JWT
npx supabase functions deploy finance-worker --project-ref <ref> --no-verify-jwt

# 2. il segreto lato funzione
npx supabase secrets set FINANCE_WORKER_SECRET="$(openssl rand -hex 32)" --project-ref <ref>
```

```sql
-- 3. la stessa stringa nel Vault, da cui il cron la legge
select vault.create_secret('IL_VALORE', 'finance_worker_secret');
```

⚠️ **Le due copie devono essere lo stesso valore.** Il modo di saperlo senza mai
esporlo è confrontarne l'**impronta** `sha256`, come è stato fatto per
`AUTOMATION_WORKER_SECRET`. Se divergono, il cron comincia a prendere **403** e
nulla nell'applicazione lo dichiara.

Serve anche `ANTHROPIC_API_KEY`: senza, la lettura deterministica gira lo stesso e
ciò che manca resta dichiarato mancante con `AI_NOT_CONFIGURED` (§3).

### 10.2 Il job cron

```sql
select cron.schedule(
  'finance-worker',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/finance-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-finance-worker-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'finance_worker_secret')
    ),
    body := '{"action":"drain"}'::jsonb,
    timeout_milliseconds := 150000     -- ⚠️ senza questo, pg_net chiude a 5 secondi
  );
  $$
);
```

⚠️ **`timeout_milliseconds := 150000` non è opzionale**: il default di `pg_net` è
**5 secondi**, e chiuderebbe la connessione a un lavoro che ne dura ottanta — ogni
esecuzione risulterebbe fallita. È la trappola già pagata con l'Inbox e con le
Automazioni.

### 10.3 Come si verifica che stia davvero girando

⚠️ **`cron.job_run_details` non basta**: là `succeeded` dice soltanto che
`net.http_post` ha **accodato** la richiesta. È la differenza fra «la chiamata è
partita» e «il lavoro è stato fatto».

```sql
select jobid, jobname, schedule, active from cron.job where jobname = 'finance-worker';
```

La prova vera sono i **log della funzione** (Management API,
`analytics/endpoints/logs.all`, con `iso_timestamp_start`/`_end` **espliciti**,
altrimenti la finestra è troppo stretta): una riga `[finance-worker] …` per ogni
elemento trattato, più il rapporto finale.

---

## 11. Test

```bash
npm run test:finance-unit            # 202 · offline, senza rete, senza credenziali, senza crediti AI
npm run test:finance-invoices-unit   # 117 · offline, stesse regole (0053: payload QR, PDF, contratto sorgente)
npm run test:finance                 # su DB reale (richiede la 0021 applicata; la sezione 15 richiede 0053/0054)
```

`test:finance-unit` **si esegue senza `--env-file`, e non è una dimenticanza**:
non deve poter toccare il database. Otto sezioni — importi, date, cifre di
controllo, QR-fattura, validazione dell'estrazione, contratto, modello puro,
registro delle automazioni — **ognuna con almeno una controprova**, cioè un caso
che deve fallire oppure un caso legittimo che non deve essere segnalato. Su questo
progetto due versioni del controllo i18n e due di quello sulle migrazioni sono
passate per verdi senza guardare niente: un test che non sa fallire non è un test.

Due controlli meritano di essere nominati:

- la sezione 6 legge il vincolo `finance_correction_field_known` **dal file SQL
  della 0021** e lo confronta con `FINANCE_CORRECTABLE_FIELDS`, e verifica che ogni
  bandiera di qualità esista nell'enum e abbia una frase nei **tre** dizionari;
- la sezione 4 legge l'**esempio ufficiale delle Implementation Guidelines v2.4**
  (pagina 51) e prova che si legge senza violazioni, che ogni regola **può**
  fallire, e che una fattura con indirizzo combinato resta leggibile.

`test:finance` contiene **138 asserzioni** (conteggio delle chiamate a `check(...)`
nel file: `scripts/test-finance.ts`; **il test non è stato eseguito in questa
sessione**, quindi il numero è misurato sul sorgente e non su un'esecuzione).
Quattordici sezioni provano le **garanzie**, non il codice: i due valori nuovi
dell'enum, l'isolamento fra aziende, che cosa un membro non può scrivere,
l'immutabilità del verbale, la correzione che vince e la firma che non si
falsifica, la proiezione che si ricalcola, il duplicato che si calcola e non si
memorizza, due valute che non si sommano, le note di credito che non gonfiano il
«da pagare», l'ingestione che si ferma dove non sa, l'outbox, la cancellazione a
cascata, il **doppione dichiarato** dell'IBAN fra SQL e TypeScript, e il codice
condiviso **eseguito** contro il database vero. La **quindicesima** prova le
fatture emesse — numerazione, guardiani, ciclo di vita, isolamento fra aziende —
e la pulizia rilegge anche le tre tabelle della 0053 e i PDF generati: 43
asserzioni in tutto (41 nella sezione, 2 nella pulizia). La sezione 15 richiede
la 0053 e la 0054 applicate e **non è mai stata eseguita** (2026-09-02).

⚠️ Il doppione dell'IBAN esiste per una ragione scritta: quando una persona
corregge a mano un IBAN, la bandiera `invalid_iban` va **ricalcolata**, e farlo
chiamando il TypeScript vorrebbe dire far ripartire il worker — cioè una chiamata
AI a pagamento — per una modifica già fatta a mano. Come per `urgencyFrom` delle
automazioni, la copia non è lasciata alla buona fede: il test confronta le due
implementazioni su una matrice, divergenza compresa.

---

## 12. Fatture emesse — il registro di ciò che va incassato (0053, 0054)

La 0021 legge i documenti che arrivano; la 0053 scrive i documenti che escono.
Una fattura verso un cliente è una riga di `finance_issued_invoices`, le righe
stanno in `finance_issued_invoice_items`, i PDF in
`finance_issued_invoice_documents`: il registro delle emissioni, delle scadenze
e dello stato dei pagamenti. Il confine non si sposta: **il modulo non muove
denaro**, e l'elenco di §2 vale intero anche in questa direzione — «pagata» è
una dichiarazione registrata, non un movimento.

### 12.1 Il modello: numerazione, riferimenti, snapshot

- **La numerazione è per azienda e non torna indietro.** Fatture `F-000001`,
  note di credito `NC-000001` con una serie propria, assegnate come `max + 1`
  sotto lock per azienda (`pg_advisory_xact_lock`): due salvataggi
  contemporanei non si dividono un numero. Dal prodotto una fattura non si
  cancella — RLS in sola lettura, nessuna RPC di cancellazione — quindi un
  numero assegnato resta con la sua riga, e nessun codice va a riempire i
  buchi.
- **Il cliente è un riferimento CRM, non una copia.** `organization_id` è
  obbligatorio, `opportunity_id` e `quote_version_id` facoltativi, ricontrollati
  cross-tenant a ogni scrittura. E però sul documento vanno gli **snapshot**:
  emittente e destinatario si fotografano sulla riga a ogni salvataggio della
  bozza, IBAN compreso, perché un trasloco non deve cambiare retroattivamente
  un PDF già emesso. Collegare, non copiare — e ciò che finisce sulla carta si
  congela.
- **L'IVA è per riga, con la fonte congelata.** Ogni riga salva aliquota, URL e
  titolo della fonte e data di verifica, copiati da `finance_vat_rates` — che
  qui è finalmente **consumata** (§6): un'aliquota non valida alla data di
  emissione fa rifiutare il salvataggio. Quale aliquota si applica lo decide la
  persona; il database congela la scelta e la sua provenienza.
- **I totali li scrive solo il database.** `finance_issued_invoice_refresh_totals()`
  in SQL decimale, mai il browser; gli importi di riga sono colonne generate.
  La valuta vive sulla testata e due valute non entrano nello stesso totale:
  l'elenco mostra un totale **per valuta**, e le stornate non contano —
  sommarle dipingerebbe un incasso che la nota di credito ha già annullato.
- **`due_date >= issued_on`** è un vincolo, non una convenzione. Fino a 100
  righe per fattura.

### 12.2 I sei stati, e chi scrive ogni timbro

`draft` · `issued` · `sent` · `paid` · `overdue` · `voided`. Ogni transizione
ha un solo autore, e il guardiano della tabella l'ammette solo se la scrittura
dichiara la sua modalità nel GUC `ai_swisse.invoice_write` (`totals` · `pdf` ·
`issue` · `send` · `lifecycle` · `overdue`):

| stato | chi lo scrive | che cosa esige |
|---|---|---|
| `draft` | la creazione stessa | nessun timbro, mai: il vincolo è una doppia implicazione |
| `issued` | `finance_issue_invoice` | PDF generato, almeno una riga, IBAN aziendale, valuta CHF/EUR |
| `sent` | **solo** `finance_mark_attached_invoices_sent`, chiamata da `send-crm-email` dopo che il provider ha accettato il messaggio | il PDF della fattura fra gli allegati dell'email registrata; dal browser non si scrive |
| `paid` | il gesto «pagata» di una persona | la data effettiva del versamento: l'interfaccia propone oggi, la decide la persona |
| `overdue` | la scansione `finance_emit_issued_invoice_overdue`, dentro il worker delle automazioni | scadenza superata e stato ancora aperto |
| `voided` | il gesto «storna» di una persona | motivo obbligatorio; assegna il numero NC-; irreversibile |

Tre cose contano.

**«Scaduta» è uno stato MEMORIZZATO, e lo scrive la scansione.** Sul lato
fornitori la scadenza superata si calcola a lettura; qui no: «scaduta» è una
conseguenza del calendario, non la scrittura di nessuno, quindi la scrive il
giro del worker — una volta sola per fattura e scadenza, con l'evento di
automazione reso idempotente dalla chiave di deduplicazione. Chi paga in
ritardo passa da `overdue` a `paid` senza rientrare nella scansione. Il
rovescio è dichiarato (§13): se il worker non gira, una fattura oltre scadenza
resta «emessa».

**Fuori da bozza niente si tocca.** Dopo `issued` la fattura è immutabile: le
correzioni passano per annullo + nota di credito, non per modifica. Lo dice il
guardiano, non l'interfaccia.

**Qualunque modifica commerciale alla bozza invalida il PDF.** Il guardiano
riporta `pdf_generated_at` a null a ogni salvataggio, e `send-crm-email`
rifiuta un allegato diventato obsoleto con `INVOICE_PDF_STALE`: un PDF che non
rispecchia più la bozza non esce dall'azienda.

### 12.3 Il PDF e la polizza QR

La Edge Function `generate-finance-invoice` produce tre documenti: **fattura**
(solo in bozza), **nota di credito** (solo su stornata), **sollecito** (solo su
emessa/inviata/scaduta, livello da 1 a 3). Le regole di tipo stanno nella RPC
del payload, letta con il JWT della persona; il service role serve solo a
scrivere il file nello Storage, e i guardiani ricontrollano azienda, fattura e
documento.

Il documento è un A4 nella lingua della fattura (it/de/fr), con gli importi che
arrivano come stringhe decimali già calcolate da PostgreSQL: il PDF
**formatta**, non ricalcola. Sulla fattura la polizza di pagamento segue le
Implementation Guidelines di SIX — ricevuta a sinistra, parte di pagamento a
destra, Swiss QR Code di 46 mm con la croce svizzera di 7 mm sovrapposta al
centro — e non è un optional:

- il **riferimento** lo decide il conto: QRR a 27 cifre su QR-IBAN, altrimenti
  SCOR con riferimento creditore RF (ISO 11649) derivato dal numero di fattura;
- il **payload** lo compone `qrbill.ts` — lo stesso modulo che li legge (§5) —
  e prima di uscire **rilegge ciò che ha scritto**: un payload che non supera
  la propria verifica non diventa un'immagine;
- senza **IBAN aziendale** la fattura non si genera e non si emette; l'IBAN sta
  nelle impostazioni `/azienda` e lo verifica la stessa cifra di controllo
  della 0021: il numero è trascritto bene, non detto vero;
- su **nota di credito e sollecito la polizza non c'è**: sono documenti
  contabili, non richieste di pagamento — e l'assenza è asserita dai test, non
  supposta.

Ogni PDF è un Documento con `source_type = 'generated'` e il ponte
`finance_issued_invoice_documents` ne dichiara la provenienza: una fattura, una
nota di credito, un sollecito per livello — e un documento non si sposta mai di
fattura. Lo stesso PDF compare nella scheda CRM del cliente e, se c'è, della
trattativa, come i preventivi della 0049.

### 12.4 Invio, pagamento, solleciti

- **L'invio è un'email CRM** con il PDF allegato, dal compositore già usato per
  i preventivi. «Inviata» arriva **dopo** l'accettazione del provider, scritta
  da `finance_mark_attached_invoices_sent` sugli allegati dell'email registrata
  — non dal body del browser, sul modello di `crm_mark_attached_quotes_sent`
  (0049). I codici di errore della funzione arrivano al compositore dal corpo
  della risposta, non indovinati.
- **«Pagata» è un gesto umano** con la data effettiva del versamento. Il
  prodotto non sa se il denaro è arrivato: registra la dichiarazione.
- **I solleciti si generano, non si inviano.** Fino a tre livelli, ciascuno il
  suo PDF; spedirli resta un gesto umano.

### 12.5 L'innesco di automazione

`finance_issued_invoice_overdue` entra nel registro degli eventi con entità
`finance_issued_invoice` — e la 0054 la ammette nei tre vincoli condivisi
`entity_type` (eventi, esecuzioni, notifiche), con autoverifica letta dal
catalogo: finché nessuna regola ascoltava l'innesco il buco sarebbe restato
invisibile, e alla prima regola attiva l'INSERT sarebbe fallito. Il template
pronto crea **un'attività** — con la scadenza a oggi, non alla data già
passata: chi sollecita lo fa oggi — e **una notifica** al responsabile della
relazione col cliente; se la relazione non ha un responsabile, l'azione si
ferma con `no_recipient` invece di avvisare tutta l'azienda. La visibilità in
Calendario arriva attraverso le attività: nessuna nuova fonte di calendario.

### 12.6 L'interfaccia

La terza scheda di `/finanze` è «Emesse» (l'indirizzo porta `?sezione=issued`),
il dettaglio sta su `/finanze/emesse/:id`, la bozza si scrive in una finestra
con righe e aliquote, e l'elenco segna «obsoleto» il PDF di una bozza
modificata dopo l'ultima generazione. Dal preventivo **accettato** il gesto
«Crea fattura» apre la finestra precompilata da quella versione — righe,
lingua, riferimenti; una valuta fuori CHF/EUR ripiega su CHF, visibile — e si
ferma lì: è una proposta da rivedere e salvare, mai una copia automatica.

⚠️ **Difetto noto, scoperto il 2026-09-02 e dichiarato qui perché la
documentazione non racconta un gesto che non riesce**: i tre indirizzi scritti
a mano — il «Crea fattura» di `CrmQuotesPanel` e i due ritorni dalla pagina di
dettaglio — portano `sezione=emesse`, mentre l'identificativo della scheda è
`issued`. Il lettore dei parametri ripiega sulla scheda principale, quindi il
gesto dal preventivo atterra sulla scheda sbagliata e la precompilazione non si
apre, e «indietro» dal dettaglio non torna all'elenco delle emesse. La
correzione è meccanica e appartiene al codice, non a questo documento.

### 12.7 Prove

- **Offline**: `npm run test:finance-invoices-unit` — **117 asserzioni superate
  il 2026-09-02**, senza rete e senza credenziali, sul codice vero condiviso
  con la Edge Function. Il QR non è «un'immagine presente»: viene
  **decodificato dai pixel** (pngjs + jsQR), in partenza e dentro il PDF
  finale, e il testo dei documenti è **estratto** con pdfjs nelle tre lingue;
  il contratto delle migrazioni e delle funzioni è riletto dal sorgente, e ogni
  sezione ha almeno una controprova.
- **Sul database reale**: la sezione 15 di `npm run test:finance` (§11) è
  **scritta e non eseguita** — le 0053/0054 non risultano applicate alla
  produzione al momento della scrittura (2026-09-02). Finché non gira, ciò che
  questa sezione dice sul comportamento del database descrive il codice, non
  un'installazione osservata.

---

## 13. Limiti e rischi residui

1. **La 0021 non risulta applicata e provata sul database in questa sessione.**
   Finché `npm run test:finance` non gira, quanto detto qui sul comportamento del
   database descrive il codice della migrazione. Resta anche da verificare sul
   database vero che l'applicazione della 0021 **non sollevi 55P04**: i due valori
   nuovi di `automation_event_type` compaiono solo dentro il corpo di una funzione
   — che Postgres deposita come testo e non valuta fino alla chiamata — ma questa è
   una proprietà che si osserva applicando il file, non leggendolo.
2. **La decodifica dell'immagine del codice QR non esiste** (§5.4). Sulle fatture
   ordinarie i dati di pagamento vengono dal testo, con provenienza
   `deterministic`, e `qr_not_read` dichiara quando c'è un codice che non è stato
   letto.
3. **Sul lato fornitori `finance_vat_rates` resta non consumata** (§6): il
   suggerimento delle aliquote in correzione manuale non è collegato
   all'interfaccia. La tabella la leggono i preventivi (0049) e le fatture
   emesse (0053).
4. **Le aliquote storiche non ci sono**, perché non verificate su fonte primaria.
5. **Un documento produce al più un elemento finanziario.** Un PDF con dieci
   fatture dentro non viene spezzato.
6. **Il classificatore automatico si ferma dove il segnale non basta**: solo
   `invoice`, e `payment_request`/`reminder` **da un privato**, diventano una
   fattura fornitore. Ricevute e note di credito **non nascono mai da sole** — le
   aggiunge una persona con «Aggiungi a Finanze». Conseguenza: una ricevuta caricata
   e non aggiunta a mano resta fuori da Finanze, e nessuno la conta fra le spese del
   mese.
7. **Un sollecito o una richiesta di pagamento da un ente pubblico non entra in
   Finanze.** Un sollecito dell'AFC è una richiesta di pagamento ma non è una
   fattura fornitore: metterlo fra le fatture da verificare mescolerebbe imposte e
   acquisti, che è proprio la confusione che il modulo deve evitare.
8. **Il duplicato sospetto non riconosce due grafie diverse dello stesso numero**
   (`N847291` contro `847291`), ed è il verso voluto dell'errore (§7).
9. **Il prodotto non sa se una fattura è stata pagata.** «Scaduta» significa
   scadenza superata. Senza dati bancari, dire altro sarebbe la prima affermazione
   falsa di questo modulo.
10. **Nessuna conservazione programmata** dei verbali: si accumulano, come le
    analisi dalla 0010. `finance_items.current_extraction_id` è `on delete set
    null` proprio perché, il giorno in cui si potassero i verbali vecchi,
    l'elemento operativo debba sopravvivere alla potatura invece di sparire con
    essa.
11. **Il budget di tempo del worker non è mai stato messo sotto pressione.** Il
    comportamento con una coda lunga — e quindi il taglio a `EDGE_TIME_BUDGET_MS` —
    non è stato osservato. Il rapporto lo dichiara (`timeBudgetReached`), e
    `timeBudgetReached` si alza **solo** se il tempo è finito **con del lavoro
    davanti**: un'esecuzione che ha svuotato la coda e si è chiusa al
    novantanovesimo secondo non è stata interrotta da niente.
12. **Un'estrazione dichiarata `completed` può avere campi mancanti.** «Incompleto»
    non è «fallito»: `finance_extraction_status` ha due soli valori, e un verbale
    con le sue incertezze è un verbale. Ciò che manca resta `null` e compare fra le
    bandiere (`missing_total`, `missing_currency`, `missing_supplier`), non viene
    riempito con un ripiego.
13. **Una cifra di controllo valida non dice che il conto esista**, né che
    appartenga al fornitore indicato. Dice che il numero è stato **trascritto**
    bene. È la sola cosa che il prodotto può affermare su un IBAN, ed è la sola che
    afferma.
14. **Le 0053/0054 non risultano applicate alla produzione** (2026-09-02), e la
    sezione 15 di `test:finance` non è mai stata eseguita: ciò che §12 dice sul
    comportamento del database descrive il codice delle due migrazioni, non
    un'installazione osservata. La 0054 va applicata **insieme** alla 0053:
    senza, il primo evento `finance_issued_invoice_overdue` con una regola
    attiva fallirebbe sui vincoli `entity_type` — il buco descritto in testa
    alla migrazione.
15. **«Scaduta» la scrive la scansione, non il calendario.** Se il worker delle
    automazioni non gira, una fattura oltre scadenza resta `issued` o `sent`:
    lo stato è memorizzato proprio perché nessun trigger di tabella può
    scriverlo (§12.2), e il prezzo è che dipende dal giro del worker.
16. **Il gesto «Crea fattura» dal preventivo ha un difetto di indirizzo**
    (`sezione=emesse` contro l'identificativo `issued`, §12.6), scoperto il
    2026-09-02: la navigazione dal preventivo accettato non apre la
    precompilazione, e i ritorni dal dettaglio non riportano alla scheda
    «Emesse». Le tre righe sono nel frontend; la correzione è meccanica e non è
    di questo documento.
