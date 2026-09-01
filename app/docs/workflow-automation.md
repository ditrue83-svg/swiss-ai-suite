# Automazioni — il motore di regole operative (0020)

> QUANDO succede X, SE valgono le condizioni Y, ALLORA esegui Z.

Questo documento descrive lo **Step 5** di AI-Swisse: il modulo che trasforma
ciò che il prodotto ha capito in **processi ripetibili e controllati**.

**Stato al 2026-07-27**: ✅ **PUBBLICATO E IN ESERCIZIO.** Commit `a89d60a`,
deployment Cloudflare `de9a9f2c`, asset `index-Dj5JAe08.js` confermato identico
fra deployment e dominio, con i marcatori del codice nuovo verificati DENTRO il
bundle servito da `app.ai-swisse.com` nelle tre lingue. `typecheck` / `build` /
`i18n:coverage` verdi, `npm run test:workflows-unit` **103/103**.

✅ **Estensione CRM 0050 in esercizio dal 2026-09-01.** La migrazione è
applicata, `automation-worker` è stato ridistribuito con `verify_jwt=false` e
la scansione delle sequenze è stata provata sul database reale dentro
`test:crm` **191/191**. Crea soltanto attività e notifiche.

✅ **Migrazione 0020 APPLICATA dall'utente e verificata**: `npm run test:workflows`
**61/61 sul database reale**, alla prima esecuzione. Verdi dopo l'applicazione
anche `test:tasks` 30, `test:documents` 81, `test:calendar` 58, `test:inbox` 50,
`test:phase1` 26, `test:phase2` 36 — i quattro trigger nuovi su
`document_analyses`, `documents`, `email_messages` e `tasks` non hanno toccato
nulla di ciò che era già in esercizio.

✅ **IN ESERCIZIO dal 2026-07-27.** Le due Edge Function sono deployate
(`automation-worker` con `verify_jwt=false`, `automation-admin` con `true`,
riletto da `functions list`), il segreto è impostato e lo scheduler pg_cron gira
**ogni 5 minuti**.

**Provato end-to-end in produzione, non dedotto**: creata un'azienda temporanea
con una regola attiva, caricata un'analisi documentale vera, e la catena si è
chiusa da sola — il documento è stato classificato `taxes` dalla regola della
0017, il trigger ha scritto l'evento, il cron delle 19:45 ha svegliato la
funzione, il worker ha elaborato (`claimed=1 processed=1 matched=1 runs=1
actionsDone=1`) e l'attività è comparsa con titolo composto dal modello,
priorità alta, scadenza presa dal documento e provenienza «automazione».
L'azienda temporanea è stata poi rimossa, e la rimozione è stata **verificata**
(nessuna regola orfana, nessun evento orfano).

---

## 1. Che cos'è, e soprattutto che cosa NON è

Non è un clone di Zapier, non è un agente autonomo e non è «chiedi all'AI cosa
fare». È il motore di regole operative dell'azienda:

- **deterministico** — nessuna chiamata AI viene fatta per eseguire una regola.
  Il documento è già stato capito; qui si lavora sui dati strutturati che ne
  sono risultati. Costo zero, latenza zero, nessuna variabilità;
- **chiuso** — una condizione può nominare solo campi dichiarati nel registro,
  un'azione può essere solo una delle sei dichiarate;
- **reversibile** — tutte le azioni della versione 1 sono a basso rischio:
  creare un'attività, assegnarla, cambiarne la priorità, classificare un
  documento, aggiungere un'etichetta, mandare una notifica. Nessuna di queste
  muove denaro, manda posta, accetta impegni o cancella qualcosa;
- **verificabile** — ogni esecuzione conserva la configurazione usata, l'esito
  di ogni condizione e di ogni azione.

### La regola assoluta

> **Automatizzare il lavoro, non automatizzare il rischio.**

Creare un'attività: sì. Assegnarla: sì. Aggiungere un'etichetta: sì.
Classificare secondo una regola sicura: sì. Notificare: sì.
Pagare: **no**. Inviare email: **no in V1**. Accettare contratti: **no**.
Cancellare documenti: **no**. Cambiare coordinate bancarie: **no**.
Decidere questioni legali: **no**.

---

## 2. Architettura

```
   una persona carica un documento          arriva una email          nasce un'attività
                │                                  │                          │
                ▼                                  ▼                          ▼
        ┌───────────────────────────────────────────────────────────────────────┐
        │  IL FATTO viene scritto nella sua tabella (documents / email_messages │
        │  / tasks / document_analyses)                                          │
        └───────────────────────────────────────────────────────────────────────┘
                │  stessa transazione — un TRIGGER, non codice applicativo
                ▼
        ┌───────────────────────────────────────────────────────────────────────┐
        │  automation_emit()  →  automation_events   (l'OUTBOX)                  │
        │  · non scrive nulla se nessuna regola attiva ascolta                   │
        │  · eredita la catena causale se il fatto viene da un'automazione       │
        └───────────────────────────────────────────────────────────────────────┘
                │  asincrono: il processo di partenza è già finito
                ▼
        ┌───────────────────────────────────────────────────────────────────────┐
        │  automation-worker  (Edge Function, chiamata da pg_cron)               │
        │  1. automation_emit_overdue()   «questa attività è scaduta»            │
        │  1-bis. crm_emit_follow_up_due()  «questo follow-up è scaduto» (0026)  │
        │  1-ter. crm_emit_follow_up_sequences()  silenzio CRM (0050)             │
        │  1-quater. crm_scan_link_suggestions()  propone collegamenti CRM (0030) │
        │  2. automation_events_claim()   lotto con lease, tetto per azienda     │
        │  3. per ogni evento: processEvent()                                    │
        └───────────────────────────────────────────────────────────────────────┘
                │
                ▼
   loadFacts()  →  workflows_for_event()  →  evaluateConditions()  →  workflow_runs
        │                                            │                      │
   valori EFFETTIVI                          vero/falso/IGNOTO      planAction → applyAction
   (correzioni umane                         se ignoto: NON si            │
    applicate)                                esegue e si dichiara         ▼
                                                                  workflow_action_runs
                                                                           │
                                                                           ▼
                                                        tasks · documents · notifications
                                                                           │
                                                          (che a loro volta emettono eventi,
                                                           con la catena ereditata)
```

### Perché un outbox e non una chiamata diretta

Un'analisi che finisce e una regola che parte devono succedere **insieme o non
succedere affatto**. Se la seconda vivesse dentro la richiesta della prima —
`await salvaAnalisi(); await eseguiRegole();` — un guasto in mezzo lascerebbe
l'analisi scritta e le regole perse, e nessuno lo saprebbe. L'evento nasce nella
**stessa transazione** del fatto, scritto da un trigger: o ci sono entrambi o
non c'è nessuno dei due.

E il processo di partenza non aspetta: chi carica un PDF non deve attendere
venticinque secondi perché dieci regole hanno finito di girare.

### Perché i trigger e non il codice applicativo

Un evento emesso da un servizio copre solo i percorsi a cui qualcuno ha pensato.
Il trigger sta sulla tabella che possiede il fatto, quindi copre l'interfaccia,
le Edge Function, gli script di manutenzione e le migrazioni — tutti insieme,
senza doversene ricordare.

---

## 3. Gli inneschi (§9/§186)

**Sei, e tutti corrispondono a fatti che il prodotto produce davvero.** Un
innesco dichiarato e mai emesso comparirebbe in un menu a tendina e non
scatterebbe mai: sarebbe una funzione finta.

| chiave | quando | entità |
|---|---|---|
| `document_analysis_completed` | un'analisi valida viene scritta (caricamento o posta) | documento |
| `document_category_changed` | la categoria organizzativa cambia | documento |
| `email_attention_ready` | una comunicazione finisce il processamento | comunicazione |
| `task_created` | nasce un'attività | attività |
| `task_status_changed` | un'attività cambia stato | attività |
| `task_became_overdue` | un'attività supera la scadenza | attività |
| `crm_follow_up_sequence_due` | un passo CRM raggiunge la soglia di silenzio configurata | trattativa |

**NON implementati, e non per dimenticanza**: `invoice_received`,
`contract_expiring`, `client_created`, `subsidy_match_found`. Non esistono le
sorgenti — non c'è un modulo clienti, non c'è una scadenza contrattuale
strutturata, il catalogo incentivi non produce eventi. Il registro è pronto ad
accoglierli (§10), l'implementazione no.

### «È diventata scaduta» non ha un UPDATE

Nessuno scrive niente quando un'attività supera la scadenza: passa il tempo, e
basta. Serve una scansione, che è `automation_emit_overdue()`, chiamata dal
worker a ogni giro. **Non è un secondo rilevatore di scadenze**: usa la stessa
definizione della vista «Scadute» di `list_tasks` (`due_date < current_date`,
non conclusa, non archiviata).

Due limiti dichiarati:
- guarda indietro **3 giorni** (`OVERDUE_LOOKBACK_DAYS`). Senza, la prima
  esecuzione dopo l'attivazione rovescerebbe addosso all'azienda tutto
  l'arretrato — cioè farebbe il backfill che §164 vieta;
- emette **una volta sola per attività** (chiave di deduplicazione). Se
  un'attività viene completata e riaperta oltre la scadenza, non riparte.

### Le altre tre scansioni del giro (0026, 0030 e 0050)

Il worker ne esegue altre tre, per la stessa ragione per cui esegue la prima —
sono fatti che nessun UPDATE produce — e nello stesso giro, senza cron nuovi:

- **`crm_emit_follow_up_due()`**: «il prossimo passo di questa trattativa è
  scaduto». Stessa finestra all'indietro di tre giorni
  (`CRM_FOLLOW_UP_LOOKBACK_DAYS`, costante separata di proposito), stessa regola
  contro il backfill, e una chiave per opportunità **e per data**: spostare il
  prossimo passo a un'altra data è una scadenza nuova e vale.
- **`crm_scan_link_suggestions()`** (0030): il candidato automatico. Non emette
  eventi e non alimenta la coda — un suggerimento non è un fatto dell'azienda, è
  un'ipotesi del prodotto, e far scattare una regola su un'ipotesi
  significherebbe creare lavoro a partire da un sospetto.
- **`crm_emit_follow_up_sequences()`** (0050): emette il passo successivo di
  una sequenza quando l'ultima email uscente della trattativa è rimasta senza
  una email in o un'interazione successiva. Fase cambiata, risposta,
  interazione, `won`/`lost` e archiviazione fermano. La configurazione è nelle
  tabelle CRM; il workflow gestito usa solo `create_task` e
  `create_notification`, mai un'azione di contatto.

⚠️ **Nessuna delle due è terminale.** `automation_emit_overdue` appartiene alla
0020, cioè alla migrazione che crea la coda che questo worker consuma: se
fallisce, non c'è comunque niente da fare e il giro si chiude con un 500. Le due
scansioni del CRM appartengono a moduli successivi che un'azienda può non avere:
fermare l'intera coda perché manca il CRM spegnerebbe le automazioni di
Documenti, Finanze e Contratti. Il guasto **non è silenzioso** — il codice
compare nel rapporto (`crmFollowUpError`, `crmSuggestionsError`) e in una riga di
log propria. Un rapporto con quei campi valorizzati è un'affermazione, non
un'assenza.

Il rapporto del worker conta le quattro cose **separatamente** — `overdueEmitted`,
`crmFollowUpEmitted`, `crmFollowUpSequenceEmitted`, `crmSuggestionsCreated` — perché un numero solo non
direbbe quale scansione ha prodotto lavoro.

---

## 4. Le condizioni

### Il registro dei campi (§15/§23)

Ogni innesco dichiara i propri campi in
`supabase/functions/_shared/automation/registry.ts`. **Una condizione può
nominare solo quelli.** I «fatti» sono una mappa piatta con chiavi note: non
esiste alcun percorso in cui una stringa scritta da un utente diventi un accesso
a una proprietà, una query o un'espressione.

### Gli operatori (§21)

`equals` · `not_equals` · `contains` · `not_contains` · `starts_with` ·
`exists` · `not_exists` · `greater_than` · `greater_or_equal` · `less_than` ·
`less_or_equal` · `in` · `within_days`

Ognuno è una funzione scritta in `conditions.ts`, non una stringa interpretata.
Quali siano ammessi dipende dal tipo del campo (`OPERATORS_BY_TYPE`).

`within_days` è l'unico operatore delle date, ed è l'unica forma che serviva
davvero: «scade entro trenta giorni». Un confronto con una data **assoluta** non
è stato aggiunto di proposito — una regola che dice «scadenza prima del
31.12.2026» è giusta per due mesi e sbagliata per sempre dopo.

⚠️ **`within_days` comprende ciò che è GIÀ SCADUTO**, e la scelta è dichiarata:
una regola scritta per accorgersi di ciò che scade fra dieci giorni deve
accorgersi anche di ciò che è scaduto ieri. Il contrario produrrebbe silenzio
proprio quando il problema è più grave.

### Vero, falso e NON DETERMINABILE (§26)

La logica è **a tre valori**. Se il mittente non è stato riconosciuto, «il
mittente è l'AFC» non è falso: è una domanda a cui non sappiamo rispondere.

| modalità | esito |
|---|---|
| `all` con un FALSO | non corrisponde (anche in presenza di ignoti) |
| `all` con un IGNOTO e nessun falso | **non determinabile → NON si esegue** |
| `any` con un VERO | corrisponde (anche in presenza di ignoti) |
| `any` con solo falsi e ignoti | **non determinabile → NON si esegue** |
| nessuna condizione | corrisponde sempre (e la schermata lo dice) |

Quando non si può decidere, si scrive una `workflow_run` con stato `skipped` e
codice `condition_not_evaluable`. **Meglio non automatizzare che eseguire una
regola sbagliata.**

### Valori effettivi e correzioni umane (§24)

Se una persona ha corretto «Comune Lugamo» in «Comune di Lugano», la regola vede
**Comune di Lugano**. Le correzioni si applicano in ordine cronologico e
l'ultima vince — esattamente come fa `list_documents` (0017). Due definizioni di
«valore effettivo» sarebbero due schermate che prima o poi dicono due cose
diverse sullo stesso documento.

Un valore corretto a mano è anche **certo per definizione**: nessuna soglia di
affidabilità si applica a ciò che una persona ha confermato.

### Incertezza (§25)

Un fatto non è solo un valore: è un valore **e la sua certezza**.

1. corretto a mano → certo, sempre;
2. `overall_confidence < 0.5` (`MIN_ANALYSIS_CONFIDENCE`) → **incerto**;
3. `confidence = 'bassa'` → **incerto**;
4. nessun segnale di affidabilità → **utilizzabile**. Dedurre incertezza
   dall'assenza di una misura sarebbe inventare a rovescio.

Un fatto incerto rende la condizione `unknown`, non `false`.

### Valute (§27)

**CHF 5'000 non è EUR 5'000, e non lo diventa convertendo.** Una condizione su
un importo richiede la valuta; se la valuta del documento è diversa, la
condizione è **non determinabile**, non falsa. Dire «no» sarebbe una risposta, e
sarebbe sbagliata. **Nessuna conversione, mai.**

---

## 5. Le azioni

**Sei, tutte a basso rischio.**

| chiave | che cosa fa | idempotenza |
|---|---|---|
| `create_task` | crea un'attività collegata all'entità | chiave `evento:regola:posizione` |
| `assign_task` | assegna l'attività dell'innesco | no-op se già così |
| `set_task_priority` | imposta la priorità | no-op se già così |
| `set_document_category` | classifica il documento | **salta se la categoria è manuale** |
| `add_document_tag` | aggiunge un'etichetta | vincolo unico sul collegamento |
| `create_notification` | avviso in-app a responsabile / amministratori / persona | `dedupe_key` su `notifications` |

Tutte passano dalle **tabelle e dai trigger normali**: un'attività creata da una
regola nasce con `tasks.insert`, quindi prende lo stesso guardiano
(assegnatario membro dell'azienda, timbri scritti dal database), lo stesso
storico, la stessa coda del calendario, la stessa notifica di assegnazione.
Nessuna scorciatoia SQL che ricopia le regole di un dominio altrui (§87).

**Che cosa viene collegato all'attività creata** dipende dall'entità
dell'innesco: il documento o la comunicazione, il contratto e la sua data, e —
dal 2026-07-30 — la **controparte e la trattativa** del CRM. Fino a quel giorno
`crm_organization_id` e `crm_opportunity_id` non venivano scritti: la casella
«collega l'entità» era spuntata e non collegava niente, e l'attività compariva
nel Work Hub ma non sulla scheda del cliente. L'etichetta della casella nomina
ora ciò che collega davvero, invece di dire «il documento» ovunque.

**«Avvisa il responsabile»** è offerto dove un responsabile esiste davvero:
l'assegnatario di un'attività, il responsabile di un contratto, di una
controparte o di una trattativa (`triggerHasOwner`, usata dal validatore E dal
generatore — una regola sola, non due copie). Su un documento e su una
comunicazione resta rifiutato: là non c'è nessuno da avvisare, e una regola che
lo dicesse non avviserebbe mai nessuno. ⚠️ Fino al 2026-07-30 la condizione era
`entityType === 'task'`, scritta quando le entità erano tre: il motore calcolava
già il responsabile di contratti e CRM e il generatore non lasciava usarlo.

### Ogni azione è in due tempi

`planAction()` **decide** e non scrive niente; `applyAction()` **scrive**. La
prova a vuoto esegue solo il primo tempo — per questo mostra esattamente ciò che
accadrebbe, invece di una «simulazione» che prima o poi racconta un'altra storia.

### Provenienza (§41/§42)

- `tasks.source = 'workflow'` — provenienza di dominio, visibile nei filtri;
- `tasks.workflow_run_id` — **quale** esecuzione l'ha creata;
- `documents.category_source = 'workflow'` + `category_workflow_run_id`.

Nessuna frase «Created by workflow abc» dentro la descrizione: una descrizione è
testo per una persona, e infilarci un dato strutturato significa non poterlo più
interrogare.

### Ciò che NON esiste (§18)

`send_email` · `reply_email` · `pay_invoice` · `change_IBAN` · `delete_email` ·
`delete_document` · `sign_contract` · `accept_contract` · `submit_tax_form` ·
`submit_to_authority` · `bank_transfer` · `modify_provider_mailbox` ·
webhook arbitrari · richieste HTTP arbitrarie · SQL arbitrario · JavaScript
arbitrario · comandi di shell.

Il campo `riskLevel` esiste già su ogni azione e il motore esegue
automaticamente **solo** le azioni `low`. Il giorno in cui servirà un'azione
`medium` o `high`, il rifiuto è già scritto (`isAutoExecutable`) e servirà
aggiungere il percorso di approvazione umana — che oggi **non c'è**, e per
questo non c'è nessuna azione che ne avrebbe bisogno.

---

## 6. I modelli di testo (§29–§31)

`Verifica {{document.title}}`.

**Non è un motore di template**: nessuna espressione, nessun accesso a proprietà
arbitrarie, nessun ciclo, nessun filtro. Una sostituzione di segnaposto presi da
un **elenco chiuso dichiarato per ciascun innesco**. Il risultato è **testo
semplice**, mai interpretato come markup.

I segnaposto ammessi sono solo valori che **non hanno bisogno di essere
tradotti** — titolo, mittente, oggetto, data, importo. La categoria e il tipo di
documento non ci sono: nel database vivono come `taxes` e `reminder`, e metterli
in un titolo richiederebbe un dizionario lato server, cioè una quarta copia
delle etichette dopo `it`, `de` e `fr`.

⚠️ **Un segnaposto senza valore NON produce «Verifica undefined»** e nemmeno
«Verifica ». Per il **titolo** di un'attività e per il **messaggio** di una
notifica l'azione viene **saltata** con codice `template_value_missing`, e lo
storico lo dice. Per la **descrizione**, che è facoltativa, il segnaposto viene
semplicemente omesso.

---

## 7. Idempotenza, ritentativi, lettera morta

### Idempotenza a tre livelli (§43/§65/§66)

1. **Emissione** — `automation_events (company_id, dedupe_key)` unico e
   parziale: la scansione delle scadute non produce due eventi;
2. **Esecuzione** — `workflow_runs (workflow_id, trigger_event_id)` unico: lo
   stesso evento consegnato due volte non produce due esecuzioni, ne **riprende**
   una;
3. **Azione** — `workflow_action_runs.idempotency_key` unico
   (`evento:regola:posizione`): un'azione già riuscita non si rifà.

Le sequenze CRM aggiungono un vincolo di dominio prima dell'outbox:
`crm_follow_up_emissions` è unico per sequenza, passo, trattativa e ultima email
uscente, e anche per la stessa combinazione nello stesso giorno. Il doppio giro
non arriva quindi nemmeno a creare un secondo evento; i due livelli successivi
restano comunque in vigore.

**Il vincolo è nel database, non nel codice.** «Guarda se esiste, poi inserisci»
non è una garanzia: fra il guardare e l'inserire ci sta un'altra esecuzione del
worker.

### Transitorio e permanente si distinguono dalla FORMA

- un'azione che **ritorna** un fallimento è **permanente**: la configurazione è
  quella, riprovare darebbe lo stesso esito. L'evento si chiude, l'esecuzione
  diventa `partial` o `failed`, la schermata lo dice;
- un'**eccezione** che sale è **transitoria** — rete, database. L'evento torna
  in coda con attesa esponenziale e jitter.

Nessun elenco di codici da tenere aggiornato in due posti.

### Lettera morta (§63)

Dopo `MAX_EVENT_ATTEMPTS` (5) l'evento diventa `dead_letter` e **compare nella
schermata**: `automation_backlog()` lo conta, e l'elenco delle automazioni lo
dichiara in cima. Un guasto che nessuno vede è il difetto peggiore.

⚠️ **Il tentativo si conta quando si PRENDE, non quando si fallisce.** Se lo si
contasse al fallimento, un worker ucciso dai 150 secondi di Supabase lascerebbe
la riga con lo stesso numero di tentativi di prima: alla scadenza del lease
verrebbe ripresa, riuccisa, ripresa — per sempre, senza arrivare mai al tetto.

### Pausa automatica (§104)

Dopo `AUTO_PAUSE_AFTER_FAILURES` (5) fallimenti **permanenti consecutivi** la
regola si mette in pausa da sé, con `attention_code` e una riga di storico
`auto_paused`. Fallire diecimila volte non è resilienza.

---

## 8. Cicli e catene (§67–§72)

Ogni evento porta con sé:

- `correlation_id` — l'identità della **catena**;
- `causation_id` — l'evento che l'ha causato;
- `root_event_id` — il fatto iniziale;
- `chain_depth` — quanti passaggi;
- `origin` (`system` | `automation`) e `origin_run_id`.

### La regola che chiude tutto

> **Una regola gira al più UNA VOLTA per catena causale.**

È una riga di `workflows_for_event`:

```sql
and not exists (
  select 1 from public.workflow_runs r
  join public.automation_events e on e.id = r.trigger_event_id
  where r.workflow_id = w.id and e.correlation_id = p_correlation_id
)
```

Da sola chiude tre casi: il ciclo di una regola su sé stessa («quando nasce
un'attività, crea un'attività»), il ciclo **A → B → A**, e la ripetizione di una
regola già eseguita più in alto nella stessa storia. Le catene **utili** restano
possibili: A che causa B che causa C funziona, perché sono regole diverse.

### Come fa il trigger a sapere di essere in una catena

Non lo indovina: lo legge dalla **provenienza scritta sull'entità**.
`tasks.workflow_run_id` e `documents.category_workflow_run_id` sono il filo che
`automation_emit()` segue per risalire all'evento genitore ed ereditarne
correlazione, radice e profondità.

### Profondità massima (§70)

`MAX_CHAIN_DEPTH = 5`. Oltre, l'evento **non viene emesso** e si scrive una riga
di storico `chain_depth_exceeded`. Un taglio silenzioso sarebbe indistinguibile
da «non c'era altro da fare».

---

## 9. Permessi e isolamento

### Chi governa le automazioni (§5/§111)

**Solo `owner` e `admin`.** Il ruolo si chiede al database **con il JWT
dell'utente**: con il service role la risposta arriverebbe anche per aziende che
quell'utente non può vedere, e il controllo si sposterebbe dalla RLS a un `if`.

I membri normali **beneficiano** delle automazioni e **vedono** regole,
esecuzioni e azioni — non c'è nulla di riservato: una regola dice cosa fa
l'azienda, e chi riceve un'attività creata da una regola ha diritto di sapere
quale. Lo **storico dei gesti** (chi ha attivato, chi ha messo in pausa) è
riservato agli amministratori, come `email_audit_log`.

### Nessuna scrittura dal client (§107/§108/§109)

Su **nessuna** delle cinque tabelle il browser ha permessi di scrittura. Le
regole si scrivono solo dalla Edge Function `automation-admin`.

Non è prudenza: la validazione contro il registro (quali campi, quali operatori,
quali azioni, quali segnaposto) vive in TypeScript, e il database non può
ripeterla senza diventarne una seconda copia destinata a divergere. Invece di
duplicare l'elenco si è **tolto il permesso**.

Il database si difende comunque da solo con i vincoli **strutturali**: array,
dimensioni, numero di elementi, autore membro dell'azienda, azienda coerente fra
regola / esecuzione / azione, versione incrementata dal trigger.

### La coda non è nemmeno leggibile

`automation_events` non ha **alcun** grant: né lettura né scrittura, per nessun
ruolo diverso da `service_role`. Un browser che potesse dichiarare
`document_analysis_completed` con un payload inventato potrebbe far creare
attività e notifiche a nome di regole che non ha scritto.

### Payload minimo (§13/§117)

Nell'evento: identificativi e pochissimi metadati. **Mai** il corpo di una
email, il testo estratto di un documento, un allegato o un JSON di analisi. Chi
esegue ha il service role e rilegge dalle tabelle vere.

Nelle esecuzioni: tipo ed identificativo dell'entità, **non** il titolo — lo
rilegge la schermata passando dalla RLS. Conservarne una copia significherebbe
un dato in più da proteggere e un titolo che invecchia.

### Prompt injection (§120/§121)

Il motore lavora su **dati strutturati** e non fa nessuna chiamata AI. Una email
che contiene «ignora le regole precedenti» non ha nessun posto in cui essere
letta come istruzione: finisce, al massimo, dentro un confronto di stringhe.

---

## 10. La prova a vuoto (§51–§53/§148)

`Prova automazione` sceglie un elemento **vero e recente** e mostra:

- l'esito di ogni condizione, con il motivo quando non è determinabile;
- le azioni che verrebbero eseguite, con i valori già composti.

**Zero scritture.** Nessuna attività, nessuna notifica, nessuna categoria,
nemmeno una riga di audit. Una prova che lascia tracce non è più una prova.

Gli elementi su cui provare si leggono **con il JWT dell'utente**, non con il
service role: si può provare solo su ciò che quella persona può già vedere.

`Prova su dati recenti` risponde a «negli ultimi 30 giorni questa regola avrebbe
corrisposto a quanti elementi». **Solo condizioni, nessuna azione nemmeno
simulata**: è una domanda sul passato, e le azioni sul passato sono il backfill
che §164 vieta. Il limite di elementi esaminati è **dichiarato nel risultato**
(«7 su 25 esaminati»), non nascosto.

---

## 11. Messa in opera — che cosa manca

⚠️ **Niente di tutto questo è ancora in produzione.** Servono, in quest'ordine:

### 11.1 La migrazione — ✅ FATTA

`supabase/migrations/0020_workflow_automation.sql` applicata dal SQL editor il
2026-07-27. Verificata con `npm run test:workflows` (61/61) e con le suite dei
moduli già in esercizio, tutte rimaste verdi.

### 11.2 Le Edge Function — ✅ FATTE

Deployate il 2026-07-27. Per rideployarle dopo una modifica:

```bash
export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
npx supabase functions deploy automation-worker --project-ref tcjmagaqktmzijbfntvy --no-verify-jwt
npx supabase functions deploy automation-admin  --project-ref tcjmagaqktmzijbfntvy
```

⚠️ **`--no-verify-jwt` SOLO su `automation-worker`**, che è chiamato da pg_cron
con un segreto e non ha un JWT. `automation-admin` deve mantenere la verifica:
autentica una persona.

### 11.3 Il segreto — ✅ FATTO

`AUTOMATION_WORKER_SECRET` impostato il 2026-07-27 e copiato nel Vault come
`automation_worker_secret`. ⚠️ **Le due copie sono state confrontate per
IMPRONTA** (`sha256`, identiche) senza mai esporre il valore: è l'unico modo di
sapere che il cron manderà davvero il segreto che la funzione si aspetta.

Per ruotarlo servono ENTRAMBE le scritture, altrimenti il cron comincia a
prendere 403 senza che nulla nell'app lo dichiari:

```bash
npx supabase secrets set AUTOMATION_WORKER_SECRET="$(openssl rand -hex 32)" --project-ref tcjmagaqktmzijbfntvy
```
```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'automation_worker_secret'),
  'IL_NUOVO_VALORE', 'automation_worker_secret');
```

Serve anche `APP_PUBLIC_URL`, già impostato per il calendario.

### 11.4 Lo scheduler — ✅ FATTO

Job `automation-worker`, `*/5 * * * *`, attivo (jobid 2). Il comando registrato
legge il segreto dal Vault e porta `timeout_milliseconds := 150000`, entrambi
riletti da `cron.job`. Per ricrearlo:

```sql
select cron.schedule(
  'automation-worker',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://tcjmagaqktmzijbfntvy.supabase.co/functions/v1/automation-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-automation-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'automation_worker_secret')
    ),
    body := '{"action":"drain"}'::jsonb,
    timeout_milliseconds := 150000     -- ⚠️ senza questo, pg_net chiude a 5 secondi
  );
  $$
);
```

⚠️ **`timeout_milliseconds := 150000` non è opzionale**: il default di `pg_net`
è **5 secondi**, e chiuderebbe la connessione a un lavoro che ne dura ottanta —
ogni esecuzione risulterebbe fallita. È la trappola già pagata con l'Inbox.

Il segreto va messo nel Vault, non scritto nel comando:

```sql
select vault.create_secret('IL_VALORE', 'automation_worker_secret');
```

### 11.5 Verifica — ✅ FATTA

```sql
select jobid, jobname, schedule, active from cron.job where jobname = 'automation-worker';
```

⚠️ **`cron.job_run_details` NON basta**: là `succeeded` dice soltanto che
`net.http_post` ha accodato la richiesta. È la differenza fra «la chiamata è
partita» e «il lavoro è stato fatto», ed è già costata tempo con l'Inbox. La
prova vera sono i **log della funzione**, via Management API:

```
GET /v1/projects/<ref>/analytics/endpoints/logs.all
  sql=select function_logs.timestamp, event_message from function_logs
      where event_message like '%automation-worker%' order by timestamp desc limit 10
  iso_timestamp_start=…  iso_timestamp_end=…      ← espliciti, o la finestra è troppo stretta
```

Verificato il 2026-07-27: cron alle 19:40:00 → funzione alle 19:40:02; cron alle
19:45:00 → funzione alle 19:45:02 con `runs=1 actionsDone=1` sul caso di prova.

---

## 12. Diagnostica

| domanda | dove si guarda |
|---|---|
| il motore sta girando? | `automation_backlog(company_id)` — se `oldest_pending_seconds` cresce, qualcosa è fermo |
| perché questa regola non è scattata? | dettaglio della regola → ultime esecuzioni. Se non c'è nessuna riga, le condizioni non corrispondevano (§101: i non corrispondenti non producono righe) |
| perché questa attività è comparsa? | l'attività porta `workflow_run_id`; la run dice quale regola e con quali condizioni |
| perché l'azione è stata saltata? | dettaglio dell'esecuzione: ogni azione ha un esito in parole («esisteva già», «la categoria l'ha scelta una persona») |
| quanti eventi sono in lettera morta? | `automation_backlog()`, mostrato in cima all'elenco delle automazioni |

---

## 13. Estendere il motore

### Aggiungere un innesco (§173)

1. `automation_event_type`: nuovo valore nella **migrazione successiva**
   (⚠️ mai usato altrove nello stesso file — 55P04);
2. `registry.ts`: una voce in `TRIGGERS` con campi, etichette e segnaposto;
3. `store.ts`: il ramo di `loadFacts` che costruisce i fatti di quell'entità;
4. un trigger SQL che chiami `automation_emit()` dalla tabella che possiede il
   fatto;
5. i dizionari `it` / `de` / `fr`;
6. i test: il registro (sezione 1), la validazione (2), i fatti.

**Il motore non si tocca.**

### Aggiungere un'azione (§174)

1. `registry.ts`: una voce in `ACTIONS` con `riskLevel`, `entityTypes` e il tipo
   della configurazione;
2. `validate.ts`: la funzione che valida quella configurazione;
3. `executors.ts`: `planAction` (decide) e `applyAction` (scrive) — **in due
   tempi**, altrimenti la prova a vuoto smette di essere vera;
4. l'idempotenza: un vincolo unico nel database, non un controllo applicativo;
5. il generatore: il modulo della configurazione;
6. i dizionari e i test.

⚠️ Un'azione con `riskLevel` diverso da `low` **non verrà eseguita** finché non
esisterà un percorso di approvazione umana. È voluto.

---

## 14. Test

```bash
npm run test:workflows-unit   # 112 · offline, senza rete né crediti
npm run test:workflows        # su DB reale (richiede la 0020 applicata)
```

`test:workflows-unit` copre registro, validazione, tutti gli operatori, la
logica a tre valori, le valute, l'incertezza, i modelli di testo, la frase
riassuntiva, i modelli iniziali, le costanti — **ogni sezione con almeno una
controprova**, cioè un caso che deve fallire.

⚠️ La sezione 9 confronta `urgencyFrom` (portabile, gira in Deno) con
`urgencyFromType` + `daysUntil` del motore locale su una matrice di 14 tipi × 12
distanze dalla scadenza. È un doppione **dichiarato** — quel file vive nel
bundle del browser, questo in una Edge Function — e il test è ciò che impedisce
alle due implementazioni di divergere in silenzio.

`test:workflows` **non simula il motore: lo esegue.** `processEvent` è lo stesso
codice della Edge Function, e riceve il client per parametro proprio per poter
essere provato qui contro il database vero.

---

## 15. Limiti dichiarati

1. **Nessuna regola è mai stata creata dall'interfaccia in produzione.** Il
   percorso di SCRITTURA (`save` → `activate`) è provato dai test e dalla
   validazione, e `automation-admin` risponde correttamente in produzione su una
   chiamata di sola lettura; ma nessuno ha ancora premuto «Attiva automazione»
   su un'azienda vera. È il prossimo gesto, e va fatto da una persona.
2. **`task_became_overdue` guarda indietro 3 giorni.** Un'attività scaduta da un
   mese quando la regola viene attivata non produce alcun evento — è la scelta
   che evita il backfill.
3. **Nessuna azione ad alto rischio, e nessun percorso di approvazione.** Il
   campo `riskLevel` esiste, il flusso di approvazione no.
4. **Nessuna condizione AI.** Il motore lavora solo su dati strutturati (§122).
5. **Le run «non corrisponde» non si scrivono** (§101). È deliberato — con
   novecento documenti l'anno seppellirebbero le venti volte in cui la regola ha
   agito — ma significa che «la regola non è scattata e non capisco perché» si
   risponde con la prova a vuoto, non con lo storico.
6. **Nessuna conservazione programmata** delle esecuzioni: si accumulano, come
   le analisi dalla 0010.
7. **La deduplicazione delle notifiche di regola** usa
   `workflow:<run>:<azione>:<entità>`: due regole diverse che avvisano la stessa
   persona sulla stessa entità producono due notifiche. È voluto (sono due
   regole), ma va saputo.
8. **Il budget di tempo non è mai stato messo sotto pressione.** Le esecuzioni
   provate hanno trattato un evento alla volta e sono durate due secondi; il
   comportamento con decine di eventi in coda — e quindi il taglio a
   `EDGE_TIME_BUDGET_MS` — non è stato osservato. Si vedrà al primo carico vero,
   e il rapporto lo dichiara (`timeBudgetReached`).
9. ⚠️ **Una finestra di duplicazione resta aperta, ed è dichiarata.** L'azione
   viene prenotata (`workflow_action_runs` in stato `pending`) *prima* di essere
   eseguita e chiusa *dopo*. Se il worker viene ucciso **esattamente fra le due
   scritture** — dopo che l'attività è stata creata e prima che l'azione risulti
   riuscita — al ritentativo l'azione risulta ancora `pending` e viene rieseguita:
   due attività.

   È la conseguenza voluta di una scelta: il motore è progettato **at-least-once**
   (§65), come chiede il capitolato. L'alternativa — marcare l'azione come
   conclusa *prima* di eseguirla — chiuderebbe la finestra di duplicazione e ne
   aprirebbe una peggiore: un'azione interrotta risulterebbe fatta e non verrebbe
   mai ripresa, cioè un lavoro perso che nessuno vede. Fra un duplicato visibile
   e una perdita invisibile, questo progetto sceglie il duplicato.

   La finestra è larga quanto due istruzioni consecutive sullo stesso database e
   richiede che il processo muoia esattamente in mezzo. Tutte le altre azioni
   (assegna, priorità, categoria, etichetta, notifica) sono **idempotenti per
   costruzione** e non ne sono toccate: solo `create_task` può duplicare.
