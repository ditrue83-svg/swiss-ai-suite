# Stato del prodotto — la definizione autorevole

> **Questo è l'UNICO posto dove lo stato di un modulo è dichiarato.** Se un
> altro documento dice qualcosa di diverso, quell'altro documento è sbagliato, e
> `npm run docs:check` prova a farlo notare invece di sperare che qualcuno se ne
> accorga.
>
> **Rimisurato il 2026-07-31** eseguendo la suite, interrogando il progetto
> Supabase (`cron.job`, elenco delle Edge Function, conteggi delle tabelle) e
> leggendo il bundle servito da `app.ai-swisse.com`. Nessuna riga di questa
> tabella è dedotta dal codice: dove non ho potuto verificare, la colonna dice
> **no**, non «probabilmente».
>
> **Rimisurato di nuovo la notte del 2026-08-01/02** su quattro punti: il
> credito Anthropic, i messaggi dell'Inbox fermi, la coda di revisione del
> catalogo, e che cosa vede davvero chi accende i promemoria via email. Le
> misure stanno qui sotto, e **due numeri di questa pagina erano invecchiati**.
>
> **Rimisurato il 2026-08-07** sui moduli che le modifiche dalla 0036 in poi
> hanno toccato, eseguendo le suite e interrogando la produzione: migrazioni
> **0001–0039, locale == remoto** (`supabase migration list --linked`);
> `test:assistant` **45/45** — il rosso aperto della 0036 è chiuso (§sotto) —
> `test:subsidy` **91/91**, `test:contracts` **69/69**, `test:audit` **41/41**,
> `subsidy:health` **exit 0 «niente in sospeso»**; credito Anthropic **ancora
> esaurito** (HTTP 400, misurato con una chiamata vera); bundle servito ancora
> `index-CkesEDA3.js`. In produzione: 148 messaggi Inbox tutti `done`,
> `audit_logs` a 0 righe, `contract_extractions` a **0** (§Contratti).
>
> **Rimisurato il 2026-08-09, dopo il PRIMO DEPLOY dal 2026-08-01.** In `main`
> è entrata l'intera pila (merge `f433d1a`, PR #12–#20 tutte chiuse) e il push
> ha pubblicato il frontend: bundle servito **`index-BSzz4AsB.js`** — verificato
> che contenga `/registro`, `/incentivi/revisioni` e il blocco `@media print`.
> Ridistribuite **18 Edge Function su 19** (quelle il cui codice cambiava,
> calcolato per chiusura degli import; `lookup-company` intatta a v25);
> `verify_jwt` ora dichiarato in `config.toml` per TUTTE le 19 e confrontato
> col progetto vivo: **zero divergenze**; `npm run verify:deploy` → «Ambiente
> allineato al repository». Migrazioni: **nessuna da applicare** (39 = 39,
> `supabase migration list --linked`). Cancelli riprovati dopo il deploy:
> `email-sync` senza JWT → **401**, worker senza segreto → **403**;
> `test:production` VERDE. Prova funzionale su azienda tecnica poi rimossa
> (§Registro attività). ⚠️ **Il credito Anthropic NON è stato rimisurato oggi**:
> resta dichiarato esaurito (ultima misura vera: 2026-08-07) e ogni riga di
> questa pagina che dipende da un percorso AI — lettura contratti dal capo alla
> coda, eval, classificazione Inbox — resta **non rimisurata**.

## ⛔ IL CREDITO ANTHROPIC RESTA ESAURITO (rimisurato da ultimo il 2026-08-07)

⚠️ **Rimisurato il 2026-08-07**, prima di provare a leggere contratti veri:

```
POST /v1/messages · model=claude-haiku-4-5 · max_tokens=1
→ HTTP 400 · invalid_request_error
  «Your credit balance is too low to access the Anthropic API.»
```

L'ultima riga di `ai_request_log` resta quella del **2026-08-02, 18:15 UTC**
(`inbox_classification`, esito `ok`): da allora nessun percorso AI è partito.
Non è inattività sospetta, è coerenza: la casella è a zero `failed`, quindi il
ritentativo ogni quindici minuti non ha nulla da ripescare e non spende
chiamate. Le 21 righe `pending` (tutte del 26–30 luglio) restano invariate.

### La misura del 2026-08-03, conservata

⚠️ **Terza volta in tre giorni.** Ricaricato il 2026-08-01, si è esaurito di
nuovo durante la lettura dei primi contratti veri. Rimisurato chiamando l'API:
`claude-opus-4-8` → **HTTP 400, «Your credit balance is too low»**.

✅ **E il codice si è comportato come deve**, il che è la sola cosa buona di
questo blocco: `contract-worker` ha classificato l'esaurimento come guasto
dell'AMBIENTE (`QUOTA_EXCEEDED`), ha rimesso i tre documenti **in coda** e non ha
scritto nessun verbale `failed`. Nessuna affermazione falsa sui documenti.

⚠️ **Conseguenza aperta**: la correzione delle date scritte a parole
(§ «I contratti, letti per la prima volta») è provata sulla funzione, con 14
asserzioni e una controprova, ma **non è stata rimisurata dal capo alla coda**.
Il 88,6 % è la misura vera di PRIMA di quella correzione.

⚠️ **Questa sezione ha detto per un giorno il contrario, ed era vero quando è
stata scritta.** Il credito era stato ripristinato la sera del 2026-07-31 — la
misura qui sotto lo conferma — e si è esaurito di nuovo il **2026-08-01 verso le
11:00 UTC**. **Non è un incidente, è il modo in cui questo prodotto funziona
finché il credito si ricarica a mano.**

Rimisurato chiamando l'API vera con la chiave di `.env.test`:

```
POST /v1/messages · model=claude-opus-4-8 · max_tokens=16
→ HTTP 400 · invalid_request_error
  «Your credit balance is too low to access the Anthropic API.»
```

L'ora dell'esaurimento non è dedotta: sta in `ai_request_log`, dove la prima
richiesta caduta per credito è delle **11:00:03 UTC del 2026-08-01**, e da
allora ogni tentativo successivo ha lo stesso codice.

**Sono quindi ferme, adesso**: analisi dei documenti (Admin AI), classificazione
della posta in arrivo, estrazione delle Finanze, `contract-worker`,
interpretazione di Subsidy AI, «Chiedi ad AI-Swisse». Le colonne «servizio
reale» della tabella restano **sì** dove lo erano — dicono che quel percorso *è
stato* eseguito contro il servizio vero, che è un fatto storico — ma **oggi
nessuno di quei percorsi arriva in fondo**.

⚠️ Ne discende una cosa che vale per tutto il resto di questo documento: **le
suite a consumo (`test:integration`, `test:eval`) e il punto sui contratti non
sono eseguibili finché il credito non torna.** Non sono verdi e non sono rosse:
non si possono eseguire, e da oggi il runner lo dice uscendo non-zero invece di
uscire 0 con la parola «verde» accanto.

### La misura del 2026-07-31, conservata perché resta vera

```
POST /v1/messages · model=claude-opus-5 · max_tokens=16
→ HTTP 200 · stop_reason=end_turn · «OK» · 16 token in, 4 out
```

Ed è **la stessa chiave delle Edge Function**, verificata con il confronto
giusto: `sha256(chiave) === value` del secret `ANTHROPIC_API_KEY` del progetto —
coincide.

⚠️⚠️ **LA TRAPPOLA DA NON RIPETERE.** `GET /v1/projects/<ref>/secrets` **non
restituisce il valore dei secret**: restituisce il loro **SHA-256** (64 caratteri
esadecimali, per tutti e 21). Confrontare quel campo con l'impronta della chiave
dà sempre «diverse», e usarlo come chiave dà sempre 401. Il 2026-07-31 questo ha
prodotto la diagnosi di un guasto che non esisteva, per due giri interi. Il
confronto corretto è `sha256(chiave) === row.value`, ed è quello eseguito qui.

✅ **Le tre valutazioni AI sono state rieseguite** la sera del 2026-07-31, tutte
verdi: `eval:assistant` **16/16**, `eval:admin` **35/35**, `eval:subsidy`
**14/14**. Dettaglio e limiti nella sezione dedicata più sotto. ⚠️ Quella misura
è del 31: **non è stata rifatta dopo il nuovo esaurimento**, e non può esserlo
finché il credito non torna.

✅ **E anche `test:integration`**, la sera stessa: **71 asserzioni, 0 fallite**
(`test:phase2` 36, `test:async` 17, `test:pipeline` 18). Tutte le suite a
consumo sono quindi state rieseguite dopo il ripristino del credito.

## Le sei parole, e perché sono sei

Fino al 2026-07-31 i documenti usavano «in esercizio» per stati molto diversi, e
un modulo con 58 asserzioni verdi e nessuno scheduler che lo invocasse risultava
«in esercizio» come uno che funzionava davvero.

| Parola | Significa |
|---|---|
| **Implementato** | il codice esiste nel repository |
| **Deployato** | le sue Edge Function sono `ACTIVE` nel progetto Supabase (`npm run verify:deploy`) |
| **Configurato** | i secret e gli scheduler che gli servono esistono e sono attivi |
| **Testato** | esiste una suite automatica che lo copre, e passa |
| **Servizio reale** | è stato eseguito contro il servizio esterno vero, non contro la sua documentazione |
| **Clienti esterni** | una persona che non siamo noi può usarlo oggi |

Un **sì** in una colonna non implica niente sulle altre. È il punto.

## I moduli

| Modulo | Rotta | Implementato | Deployato | Configurato | Testato | Servizio reale | Clienti esterni | Dipendenza esterna | Limitazioni |
|---|---|---|---|---|---|---|---|---|---|
| Admin AI | `/admin` | sì | sì | sì | sì | sì | sì | Anthropic | in modalità `ai` il testo del documento va all'API; in `deterministic` lo snapshot non è probatorio |
| Subsidy AI | `/subsidy` | sì | sì | sì | sì | sì | sì | Anthropic | catalogo 1.0: 7 programmi (Confederazione + Ticino), contenuti solo in italiano; `subsidy.footnote` stampa asterischi markdown non resi |
| Inbox | `/inbox` | sì | sì | sì | sì | sì | **no** | Google Gmail API | scope riservato: fuori dalla modalità Test Google impone la verifica CASA, quindi **un cliente reale non può collegare la propria casella**. Microsoft implementato e non configurato. ✅ **148 messaggi, TUTTI `done`, zero in `failed`** — rimisurato il 2026-08-05 interrogando la produzione. ⚠️ Questa riga ha detto «3 su 141 in `failed`» fino al 2026-08-05: era vero il 2026-08-01 e ha smesso di esserlo da sé, perché il ritentativo ha ripescato quei tre quando il credito è tornato. **Il meccanismo ha funzionato senza che nessuno lo toccasse**, ed è la prova che quella riga aspettava. Il numero qui si RIMISURA prima di unire una PR: `docs:check` confronta i documenti con il codice, non con il database, quindi su questa colonna non può aiutare (§sotto) |
| Attività | `/attivita` | sì | — | sì | sì | — | sì | — | nessuna |
| Documenti | `/documenti` | sì | — | sì | sì | — | sì | — | nessuna politica di conservazione delle analisi |
| Calendario e notifiche | `/calendario` | sì | sì | sì | sì | **no** | **no** | Google/Microsoft Calendar, provider email | ⚠️ **i promemoria sono accesi dal 2026-07-31**, non prima: i due scheduler non esistevano e i secret non erano impostati. Dal 2026-07-31 li crea la **migrazione 0035** invece di un blocco SQL da incollare a mano, e il percorso è stato **provato dal capo alla coda** su un tenant tecnico (§sotto). ⚠️⚠️ **Il 2026-08-03 si è scoperto che le email non sarebbero potute partire NEMMENO con i secret impostati**: `composeEmail` non metteva il destinatario nel messaggio, e ogni promemoria sarebbe uscito verso `to: [null]` (§sotto). Corretto e coperto da 25 controlli nuovi. Restano due cose, entrambe **gesti dell'utente**: i due secret del provider email non sono impostati, e **nessuna connessione OAuth reale è mai stata stabilita** — misurato il 2026-08-03, `POST /calendar-oauth/providers` risponde `{"providers":[],"emailConfigured":false}`. Quindi «servizio reale» resta **no**. ✅ **Il 2026-08-11 il MOTORE dei promemoria è stato eseguito contro il database vero e ha prodotto la sua riga** (`npm run test:reminders`, 11 controlli, azienda usa-e-getta rimossa e rimozione verificata rileggendo). Prima esisteva solo la verifica manuale del 2026-07-31: vera, ma non ripetibile. ⚠️ **E in produzione lo zero è CORRETTO, misurato e non più dedotto**: le quattro attività scadono il 10 e il 30 settembre, la finestra arriva a otto giorni, il primo avviso è a sette — non c'è ancora niente da ricordare (§sotto) |
| Automazioni | `/automazioni` | sì | sì | sì | sì | sì | sì | — | nessuna approvazione umana: solo azioni a rischio basso, e per questo non esiste nessuna azione che ne avrebbe bisogno. Le esecuzioni che non corrispondono non lasciano traccia |
| Finanze | `/finanze` | sì | sì | sì | sì | parziale | sì | — | il codice QR **binario** non viene decodificato; le aliquote storiche non ci sono; su 4 voci reali 2 sono `completed` e 2 `failed` con `NOT_FINANCIAL`, che è una classificazione corretta |
| Contratti | `/contratti` | sì | sì | sì | sì | sì | parziale | Anthropic | ✅ **Letti tre contratti veri il 2026-08-03** (locazione it, fornitura de, mandato fr), `npm run eval:contracts`: **70 campi esatti su 79 — 88,6 %**, tasso per campo qui sotto. ⚠️ **Il prompt NON era il problema**: due difetti erano nel nostro codice e sono corretti (nome dell'azienda mai letto, numerale composto letto sbagliato). ⚠️ **Restano 9 campi rossi, 7 dei quali sono la stessa cosa**: le date scritte a parole non vengono convertite (§sotto). ✅ **Le correzioni sono DEPLOYATE dal 2026-08-09** (`contract-worker` v19). ⚠️ **La rilettura dal capo alla coda resta non eseguibile** (credito esaurito; ultima misura vera 2026-08-07, non rimisurato il 09): il 88,6 % resta la misura di PRIMA della correzione delle date. In produzione `contract_extractions` è a **0 righe**: nessun contratto di un'azienda reale è mai stato letto — le esecuzioni dell'eval creano e cancellano la loro azienda tecnica, quindi non lasciano verbali. Rieseguite il 2026-08-07 le prove che non spendono credito: `test:contracts` **69/69** sul database vero, `eval:contracts --self-test` **8/8** |
| Clienti | `/clienti` | sì | — | sì | sì | sì | sì | Zefix (facoltativo) | l'abbinamento automatico non collega mai da solo: propone |
| Chiedi ad AI-Swisse | `/assistente` | sì | sì | sì | **sì** | sì | sì | Anthropic | `eval:assistant` chiudeva **15/16** con un caso diverso a ogni esecuzione; la causa era un difetto del **seed** (una versione dei termini duplicata, con l'errore scartato). ✅ **Rieseguita la sera del 2026-07-31 con `--runs 3`: 16/16, tutte e 48 le esecuzioni verdi.** ⚠️ Verde non vuol dire deterministico: su due casi l'ESITO cambia fra un giro e l'altro (vedi la sezione dedicata). Sola lettura, retention 180 giorni attiva |
| Incentivi | `/incentivi` | sì | sì | sì | sì | sì | sì | fonti ufficiali (7 siti) | dal 2026-07-31 `test:subsidy` copre su **database reale** le garanzie della 0032/0033/0034 **e il motore**: la sezione 11 esegue `runMatching`, la stessa funzione che chiama `subsidy-worker`. ⚠️ Restano scoperti l'**involucro HTTP** della Edge Function (segreto, budget di tempo) e il **percorso delle fonti** (`runSourceChecks`, che esce in rete). ⚠️ **Questa riga ha detto «7 revisioni del catalogo in attesa di una persona» fino al 2026-08-06, ed era vero fino al 2026-08-05**: rimisurato interrogando la produzione, la coda è a **ZERO in attesa — 7 `ignored`**, chiuse tutte alle 22:45:42 del 2026-08-05 **dal sistema e non da una persona** (`reviewed_by` nullo su tutte e sette). Non erano un cambiamento della fonte ma la **prima lettura riuscita**, e il difetto è corretto in `diff.ts` (commit `ac0c65e`). ⚠️⚠️ **Una coda vuota NON significa catalogo verificato**: `last_checked_at` è fermo al **2026-07-25** per tutti e sette i programmi — nessuno ha ancora confrontato il catalogo con la fonte, ed è la cosa che quella riga rischiava di far credere fatta. Rimisurato il 2026-08-07: `test:subsidy` **91/91** sul database vero, `subsidy:health` **exit 0 «niente in sospeso»**, `last_checked_at` ancora al 2026-07-25 |

## Registro attività (0039) — applicato, provato sul database vero e DEPLOYATO il 2026-08-09

Non ha una riga nella tabella qui sopra perché **non è un modulo di prodotto**:
è una schermata sola (`/registro`) che indicizza i fatti degli altri moduli
senza possederne nessuno. Ma le sei parole valgono lo stesso, e vanno dette
prima che qualcuno le deduca dal fatto che il codice esiste.

| | Stato al 2026-08-09 |
|---|---|
| Implementato | sì — migrazione `0039_audit_logs`, pagina, servizio, due suite |
| **Migrazione applicata** | **sì**, il 2026-08-06 con `supabase db push --linked`. Produzione a **0001–0039** (riletto da `supabase_migrations.schema_migrations`: 39 righe; riconfermato il 2026-08-09 con `supabase migration list --linked`, 39 = 39) |
| Deployato | **sì, dal 2026-08-09** — il dominio serve `index-BSzz4AsB.js` e la pagina `/registro` è raggiungibile. I TRIGGER erano già in esercizio dal 2026-08-06 |
| Configurato | non richiede configurazione: nessun segreto, nessuno scheduler |
| Testato | **sì** — `test:audit-unit` 74/74 offline, `test:audit` **41/41 sul database vero** (rieseguito il 2026-08-09) |
| Provato contro la cosa reale | **sì**, anche SUL DOMINIO dopo il deploy: vedi la misura del 2026-08-09 qui sotto |
| Disponibile a clienti esterni | raggiungibile sì (ruoli titolare/amministratore); usato da un cliente esterno: no |

⚠️ **Le tre cose che erano affermazioni fino a ieri, e adesso sono misure.** Le
garanzie del registro sono permessi, policy e trigger: tre cose che si possono
descrivere per mesi senza che siano vere (lezione della 0014). Eseguendo:

- **i permessi**: `information_schema.role_table_grants` dice che su `audit_logs`
  `authenticated` ha **solo SELECT** e `anon` non compare affatto — il
  `revoke all` che precede la `grant` ha fatto il suo lavoro. Un titolare che
  prova a modificare o cancellare riceve **42501 «permission denied for table
  audit_logs»**;
- **l'immutabilità oltre i permessi**: il service role, che i permessi ce li ha
  tutti, riceve **42501 «audit_log_immutable»** — cioè lo ferma il TRIGGER, ed è
  un meccanismo diverso da quello che ferma gli utenti. Le due righe di errore
  distinte sono la prova che ciascuna difesa fa il suo lavoro, non che una
  copre l'altra;
- **la cascata**: cancellare un'azienda che ha documenti, attività e righe di
  registro **riesce**, e non resta niente. Era l'incidente della 0023 previsto
  in scrittura, e la guardia in `audit_log_write` regge sul database vero.

⚠️ **La controprova del controllo.** Cinque asserzioni «non può» valgono poco da
sole: un errore non nullo può arrivare da una chiamata malformata o da una
sessione scaduta. La suite verifica quindi che **lo stesso client, con la stessa
forma di chiamata, scriva senza errore dove il permesso c'è** — e rilegge il
valore scritto, perché su PostgREST un UPDATE nascosto dalla RLS non dà errore:
tocca zero righe e basta.

⚠️ **Che cosa ha insegnato l'esecuzione, e non era previsto.** `test:audit` è
uscito rosso due volte prima di essere verde, e in nessuno dei due casi il
difetto era nel prodotto: la prima per un valore di enum inventato nel TEST
(`task_priority` non ha `normal`), la seconda perché le righe `member_added`
erano **due** e non una — anche la membership che `create_company_with_owner`
crea all'onboarding è un ingresso in azienda, e il trigger la registra. È la
conferma pratica del motivo per cui il registro sta nei trigger e non in un
servizio: copre anche i percorsi a cui nessuno ha pensato.

Riconfermato il **2026-08-07**: `test:audit` di nuovo **41/41** sul database
vero, bundle servito ancora `index-CkesEDA3.js` (il deploy allora mancava),
e `audit_logs` in produzione a **0 righe** — i trigger sono in esercizio dal
2026-08-06 e nessuna attività reale è avvenuta da allora; le righe scritte
dalle suite se ne vanno con la cascata delle loro aziende usa-e-getta, che è il
comportamento provato dalla sezione 7 della suite.

**Misurato il 2026-08-09, DOPO il deploy, sul dominio** — con un'azienda
tecnica creata apposta e rimossa alla fine (pulizia verificata: zero residui su
aziende, utenti, programmi, revisioni, operatori):

- la pagina `/registro` servita da `app.ai-swisse.com` mostra **3 eventi su 3**
  — «Documento caricato» con i campi valorizzati, le due «Persona aggiunta» —
  scritti dai trigger nel momento in cui l'azienda tecnica li ha compiuti;
- un utente **member**, sulla stessa pagina deployata, riceve il lucchetto
  «**Riservato a titolari e amministratori**» e sotto, via PostgREST, la RLS
  gli restituisce **zero righe**;
- INSERT e UPDATE su `audit_logs` da utente autenticato (owner E member)
  ricevono **42501 «permission denied»** — negativo esplicito, rieseguito;
- ⚠️ osservazione d'interfaccia: per gli utenti tecnici senza profilo
  l'etichetta dell'autore dice «di una persona non più in azienda» anche se la
  persona in azienda c'è. Con utenti registrati per la via normale il profilo
  esiste; il ripiego dell'etichetta però non distingue «senza profilo» da
  «uscita dall'azienda».

## I messaggi fermi dell'Inbox — da 11 su 124 a ZERO su 148

Rimisurato interrogando il database la notte del **2026-08-01/02**, e di nuovo
il **2026-08-05**. Ogni numero mai scritto in questa sezione ha smesso di
descrivere qualcosa nel giro di giorni, e il perché è la parte utile: prima
perché il ritentativo mancava e i messaggi restavano fermi, poi perché il
ritentativo c'era e li ha ripresi da solo appena il credito è tornato.

| Che cosa | 2026-07-31 | 2026-08-01, 23:44 | 2026-08-05 |
|---|---|---|---|
| Messaggi acquisiti | 124 | 141 | **148** |
| In `failed` | 11 | 3 | **0** |
| Tasso | 8,9 % | 2,1 % | **0 %** |
| Codici distinti | non raggruppati | uno solo: `AI_CREDIT_EXHAUSTED` | **nessuno** |

⚠️ **La terza colonna è stata aggiunta, non sostituita alla seconda.** Le due
misure precedenti restano perché la storia di questa tabella È l'argomento: i
tre `failed` del 01/08 si sono chiusi **da soli**, quando il credito è tornato,
senza che nessuno intervenisse. È esattamente ciò che il ritentativo doveva fare
e che fino al 2026-07-31 non faceva. Riscrivere le colonne vecchie avrebbe
cancellato la prova insieme al problema.

**I tre sono tutti dello stesso gruppo**, e la diagnosi è una sola:

| `error_code` | N | Diagnosi | Ritentativo |
|---|---|---|---|
| `AI_CREDIT_EXHAUSTED` | 3 | **transitorio, d'ambiente** — l'ambiente era giù mentre si scriveva | ha senso, **c'è già**, ✅ e ha funzionato: al 2026-08-05 i tre sono classificati e la casella è a zero `failed` |

Tutti e tre avevano `relevance` e `classified_at` a **null**: erano caduti in
**classificazione**, non in analisi. Nessuno aveva un documento collegato,
nessuno un'analisi. Due avevano solo corpo, uno due PDF in `pending`.
✅ **Al 2026-08-05 sono classificati tutti e tre**, e nessuno ha dovuto toccarli.

⚠️ **NON ho ritentato niente, ed è la risposta giusta, non una rinuncia.** Il
credito è esaurito *in questo momento* (§sopra, misurato con una chiamata vera):
un ritentativo in blocco cadrebbe sullo stesso errore per tutti e tre, e
l'unica cosa che produrrebbe sarebbe tre righe in più in `ai_request_log`.

⚠️⚠️ **E soprattutto: il ritentativo esiste già, è deployato, e sta girando.**
`drainPendingClassifications` (in `_shared/email/sync.ts`, chiamata da
`email-maintenance` v30, deployata il 2026-08-01 alle 08:42 UTC) ripesca i
messaggi `failed` con `relevance is null` e un codice d'ambiente. La prova non è
il codice: è `ai_request_log`, che mostra **un tentativo di classificazione ogni
quindici minuti**, puntuale, dalle 11:00 in poi — 65 righe, tutte
`AI_CREDIT_EXHAUSTED`, l'ultima alle 21:30:04.

```
21:30:03  inbox_classification  error  AI_CREDIT_EXHAUSTED  1234ms  claude-opus-4-8
21:15:04  inbox_classification  error  AI_CREDIT_EXHAUSTED   250ms  claude-opus-4-8
21:00:04  inbox_classification  error  AI_CREDIT_EXHAUSTED   299ms  claude-opus-4-8
…
```

Ne segue una cosa che va detta chiaramente: **quando il credito tornerà, i tre
messaggi si classificheranno da soli, senza che nessuno faccia niente.** Il ciclo
prende un messaggio per esecuzione (il più recente) e si ferma al primo errore
d'ambiente, perché se l'ambiente rifiuta uno rifiuterà anche gli altri.

⚠️ **Il tetto di un ritentativo solo non è stato aggirato.** Vale per
`INVALID_RESPONSE`, dove il secondo fallimento identico diventa `CLASSIFY_FAILED`
e finisce lì. `AI_CREDIT_EXHAUSTED` non consuma il tentativo di proposito: non è
il messaggio a essere sbagliato, ed è scritto in `classify.ts`
(`codeAfterRetry`). Il costo del ciclo infinito è misurato: **zero token**, perché
l'API rifiuta con 400 prima di far ragionare il modello, più una chiamata Gmail
ogni quindici minuti.

### E l'utente li vede? Sì — verificato, e non è stato toccato niente

| Domanda | Risposta misurata |
|---|---|
| In quale filtro cadono | `attention_status = 'to_verify'` → **«Da verificare»** e «Tutte». Non spariscono |
| Compaiono in «Da gestire» | no, e **è giusto**: quel filtro è `needs_attention`, che l'analisi non ha mai potuto assegnare |
| Si vede che è andata male | sì: `ProcessingNote` mostra icona d'allarme + «fallito» nella lista |
| E nel dettaglio | sì: al posto di «Cosa richiede attenzione» compare `inboxErrorMessage('AI_CREDIT_EXHAUSTED')` |
| C'è «Analizza» | sì: `canAnalyze` esclude solo `analyzing` e `importing`, non `failed` |

Il testo mostrato, nelle tre lingue, dice anche **di chi è il compito** e **che
il messaggio verrà ripreso da solo** — cosa che oggi è letteralmente vera:

> «Il servizio di lettura non ha credito disponibile: la comunicazione non è
> stata esaminata. Aspettare non risolve — serve un intervento di chi amministra
> l'applicazione. Il messaggio viene ripreso da solo appena il servizio torna
> disponibile.»

**Nessuna modifica all'interfaccia**: era già corretta.

### Il tasso: 2,1 %, e non è strutturale

Il 9 % di ieri **non era un tasso di guasto del prodotto**: era la fotografia di
una finestra in cui il credito era finito e nessuno ripescava i caduti. Delle
due cause, la seconda è stata corretta il 2026-08-01. Il 2,1 % di oggi ha una
sola causa, esterna e nota, e **il numero atteso a credito ripristinato è zero**
— non perché qualcuno li chiuderà a mano, ma perché il ciclo li riprenderà.

⚠️ Ciò che **resta** strutturale è un'altra cosa, e più importante: finché il
credito si ricarica a mano, **ogni sua interruzione produce una coda**. Il
prodotto la dichiara bene, la riprende da solo e non perde niente — ma nel
frattempo la posta amministrativa di quelle ore non è esaminata. È la
dipendenza esterna più semplice da rimuovere di tutto il prodotto, e l'unica
che oggi lo ferma davvero.

## Le integrazioni esterne

| Integrazione | Stato | Che cosa manca |
|---|---|---|
| Anthropic | in esercizio | — |
| Zefix / Registro IDI | in esercizio, provato contro l'API viva | l'UFRC sconsiglia le interrogazioni di massa: resta legata a un gesto |
| Google Gmail | in esercizio, una casella reale collegata | **verifica CASA**: oggi solo gli utenti di prova |
| Google Pub/Sub | implementato, **non attivato per scelta** | un account di fatturazione. Il cron a 15 minuti lo sostituisce |
| Microsoft Graph (posta) | implementato, non configurato | credenziali Entra. L'app lo **dichiara** invece di fallire |
| Google/Microsoft Calendar | implementato, **mai provato contro le API vive** | `GOOGLE_CALENDAR_CLIENT_ID`/`SECRET` espliciti |
| Provider email (Resend) | implementato, **non configurato** — riverificato il 2026-08-03 | `NOTIFICATION_EMAIL_API_KEY` e `NOTIFICATION_EMAIL_FROM`: **assenti** dai 21 secret del progetto, controllati per NOME (il valore non è leggibile: la Management API restituisce lo SHA-256). Finché mancano, `deliverEmails` esce subito e **nessuna email può partire**: è una garanzia, non una svista. ✅ E la schermata lo **dichiara davvero** — non c'è nessun interruttore da accendere (§sotto). ⚠️⚠️ **Fino al 2026-08-03 impostarli non sarebbe bastato**: vedi «Le email di notifica» qui sotto. Ora il percorso è eseguito da `test:calendar-unit` §12 e da `npm run test:notification-email`, che **esce 3** finché i due valori mancano |

## ⚠️ `calendar-sync` era deployata con `verify_jwt=true`, e lo scheduler non poteva funzionare

Trovato accendendo gli scheduler il 2026-07-31, provando il segreto **prima** di
creare il job: `calendar-sync` rispondeva **401 anche al segreto giusto**, perché
il gate della piattaforma la fermava prima che il codice la vedesse. Lo
`cron.schedule` documentato in `calendar-notifications.md` avrebbe preso 401 a
ogni esecuzione, per sempre, senza che niente diventasse rosso — la stessa
trappola già pagata con `email-webhook`.

La funzione ha **tre chiamanti con tre autenticazioni diverse, tutte nel codice**
(`drain` e `reconcile` con segreto a tempo costante, `sync` con JWT + proprietà
della connessione + `assertMember`), quindi `--no-verify-jwt` è il deploy
corretto — ed è come sono deployate le altre cinque worker. Rideployata (v12) e
verificata con test negativi: `drain` 403/403/200, e **`sync` senza JWT resta
401**, anche presentando il segreto del worker.

⚠️ **La riga sbagliata è rimasta in `supabase/config.toml` per un giorno.** Il
progetto era stato corretto, il file che lo *documenta* no: continuava a
dichiarare `verify_jwt = true` «di proposito», con accanto una motivazione —
«lo scheduler chiama comunque con la service role key nell'header
`Authorization`» — che il comando del cron smentisce: quell'header non c'è.
Allineato il 2026-07-31 (`[functions.calendar-sync] verify_jwt = false`), con la
ragione vera scritta accanto. Correggere il progetto e lasciare il documento è
il modo più diretto per ripetere lo stesso guasto fra sei mesi.

## Gli scheduler del calendario e delle notifiche: quattro stati distinti

Rimisurato il **2026-07-31**, e le quattro righe non dicono la stessa cosa.

| Che cosa | Stato | Come lo so |
|---|---|---|
| **Scheduler registrato** | **sì, da una migrazione** | `calendar-sync-drain` (`*/10`) e `notifications-worker` (`*/15`) sono creati dalla **0035**, non più da un blocco SQL incollato a mano. `npm run test:operations` rifiuta un job dell'inventario che viva solo in un `.md` |
| **Edge Function deployata** | **sì** | `npm run verify:deploy`: `calendar-sync` e `notifications-worker` sono `ACTIVE`, entrambe `verify_jwt=false` |
| **Flusso provato sul database** | **sì, dal capo alla coda** | 18 controlli su un'azienda tecnica usa-e-getta, poi rimossa e la rimozione verificata. Il worker è stato invocato **con il comando vero del job** (`net.http_post` + segreto dal Vault): 200, promemoria `task_due_today` generato, `dedupe_key` = `task:<id>:d0`, deep link a `/attivita/<id>`, **seconda esecuzione senza duplicato e con lo stesso id**, indice unico che respinge un doppione inserito a mano. Coda del calendario: riga presa in carico, **lease rispettato quando è vivo e recuperato quando è scaduto**, backoff rispettato, riga mai bloccata per sempre |
| **Provider Google / Microsoft** | **NO, e resta no** | nessuna connessione OAuth reale esiste. Nessuna chiamata è mai partita verso le API di Google o Microsoft. Ciò che è provato è il **worker della coda**, non la sincronizzazione presso il provider |

⚠️ **Ciò che questa prova NON dice.** Che i promemoria arrivino *per email*: il
provider non è configurato e `deliverEmails` esce subito — verificato, zero
consegne accodate. E che un evento compaia su un calendario esterno: per quello
servirebbe una connessione vera, che non c'è.

### ✅ Che cosa vede chi va ad accendere i promemoria via email — misurato, non dedotto

Il README affermava che la schermata dichiara le email «non disponibili» invece
di mostrare un interruttore inerte. **È vero, e questa volta è stato provato
contro la cosa reale** invece di essere riletto nel codice — è esattamente il
genere di affermazione che in questo repository si è già rivelata falsa due
volte.

Tre misure indipendenti, il 2026-08-01:

1. **I secret non ci sono.** `GET /v1/projects/<ref>/secrets` elenca 21 nomi:
   `NOTIFICATION_EMAIL_API_KEY` e `NOTIFICATION_EMAIL_FROM` **non ci sono**.
2. **La funzione deployata lo dice.** Chiamata `POST /calendar-oauth/providers`
   con la sessione di un utente usa-e-getta (creato, usato e rimosso, rimozione
   verificata): `HTTP 200`, `emailConfigured: false`. ⚠️ Questa misura serviva:
   `calendar-oauth` è deployata in **v12 dal 2026-07-27**, prima del commit che
   ha introdotto quel campo — dal codice locale non si poteva concludere niente,
   e infatti il campo si è dovuto **chiedere alla funzione vera**.
3. **La schermata segue.** `CalendarSettingsPage` mostra il `Toggle` solo se
   `emailConfigured === true`; altrimenti stampa «Non disponibile» con la
   ragione, e la ragione esiste nelle tre lingue.

> «Su questa installazione non è configurato nessun servizio di invio email,
> quindi le notifiche via email non partirebbero.»

**Nessun interruttore inerte, in nessuna delle due schermate**: `emailEnabled`
è scrivibile solo da lì. Nessuna modifica fatta — non ce n'era da fare.

⚠️ **`succeeded` in `cron.job_run_details` dice solo che `net.http_post` ha
accodato la richiesta.** Da oggi `npm run verify:deploy` legge comunque l'esito
dell'ultima esecuzione di ogni job — prima sapeva solo che il job *esisteva* —
e i due worker scrivono `phase=start` / `phase=end` con `rid` e `durationMs`.

## ⚠️⚠️ Le email di notifica: fino al 2026-08-09 non sarebbero partite nemmeno con i secret

Misurato il **2026-08-03**, scrivendo il primo test che esegue `deliverEmails`.
(La correzione è **DEPLOYATA dal 2026-08-09** — `notifications-worker` v16,
`calendar-sync` v18: da oggi i due secret mancanti sono l'UNICO cancello.)

**Il difetto.** `composeEmail` (`_shared/calendar/notify.ts`) dichiarava di
restituire `{ to, subject, text }` e restituiva il risultato nudo di
`buildReminderEmail`, che è `{ subject, text }`: **il campo `to` non c'era**.
A runtime `message.to` era `undefined`, `JSON.stringify` lo scriveva `null`
dentro l'array, e ogni promemoria sarebbe uscito verso `to: [null]`. Esito: 4xx
del provider, consegna chiusa `failed`, **nessuna email mai arrivata a nessuno**.
Chi avesse impostato i due secret avrebbe visto una coda di consegne fallite con
un codice opaco, e avrebbe cercato il guasto nella configurazione.

**Perché nessuno l'aveva visto.** `tsconfig.json` include `src` e `scripts`:
un file di `supabase/functions/` entrava nel typecheck **solo se qualcosa là
dentro lo importava**, e `notify.ts` non era importato da niente. Su 103 file
`.ts` sotto `supabase/functions/`, **25 non erano typecheckati** — fra cui gli
`index.ts` di tutte e 19 le Edge Function. Il difetto è comparso nell'istante in
cui un test ha importato il modulo per eseguirlo: prima è diventato rosso il
test, poi `npm run typecheck`. **Un percorso che nessun test esegue non era
coperto nemmeno dal typecheck.**

✅ **LA CLASSE È CHIUSA dal 2026-08-04**, e questa riga si legge al passato per
quella ragione: `tsconfig.functions.json` compila **103 file su 103**, per
appartenenza alla cartella e non per raggiungibilità da un import — quindi un
file nuovo è coperto dal momento in cui esiste, senza che nessuno se ne ricordi.
`npm run typecheck` esegue **entrambi** i config, e `npm run build` passa da lì.
Dettagli e limiti in [«Il typecheck delle Edge Function»](../README.md).
⚠️ Che cosa questo controllo **non** vede, dichiarato: verifica la FORMA, non
l'ambiente. Il runtime resta quello di Supabase, e la sola prova che una funzione
GIRA è eseguirla.

✅ **Corretto**, e coperto da **25 controlli nuovi** (`test:calendar-unit` §12,
da 188 a 213 asserzioni) che eseguono `deliverEmails` VERA contro un client
Supabase finto e una `fetch` finta: caso nominale, chiave di idempotenza,
destinatario preso da `profiles.email`, 4xx definitivo, 429 ritentato, tetto dei
tentativi, lingua di chi riceve. **Controprova eseguita**: due mutazioni del
codice di produzione (chiave di idempotenza sbagliata; tentativo non registrato
prima dell'invio) producono un rosso ciascuna, e quello giusto.

✅ **`npm run test:notification-email`** invia per davvero, verso
`delivered@resend.dev`. ⚠️ **Esce 3 finché i due secret mancano**: un controllo
che non si può eseguire non è verde.

⚠️ **Restano due cancelli che i secret non aprono**, ed è la parte che va detta a
chi li imposta: `notification_preferences.email_enabled` è **false per default**,
e la coda si popola alla GENERAZIONE — le notifiche create mentre il provider non
c'era **non hanno una riga di consegna e non l'avranno mai**. Le email partono dai
promemoria generati da lì in avanti. Dettagli in
[`calendar-notifications.md` § Accendere le email](calendar-notifications.md).

## I contratti, letti per la prima volta — 88,6 % dei campi

Misurato il **2026-08-03** con `npm run eval:contracts`, su tre contratti
svizzeri verosimili scritti per la prova — locazione commerciale (it), fornitura
(de), mandato fiduciario (fr) — stampati in PDF e riletti con la **stessa
estrazione del prodotto**.

⚠️ **Che cosa NON provano, dichiarato**: non sono contratti di terzi e sono
impaginati puliti. Provano la lettura, **non** l'OCR di una scansione né un
documento scritto male.

**Il prompt non era il problema.** Il modello legge i tre documenti con fiducia
0,9–0,98 e **supera tutte le trappole**: non calcola la data di fine dai
ventiquattro mesi del mandato (non è scritta), non scambia una quantità minima
d'acquisto per una durata minima, non deduce «nessun rinnovo» dal silenzio del
contratto, e dichiara di non sapere la periodicità di un prezzo «pro Tonne»
invece di sceglierne una plausibile. **Le perdite erano quasi tutte a valle.**

**Due difetti del nostro codice, trovati misurando e corretti:**

1. ⚠️⚠️ **`loadCompanyName` interrogava `companies.name`, colonna che non
   esiste.** La select tornava `42703`, un `if (error) return null` se lo
   mangiava, e il nome dell'azienda **non è mai arrivato al modello, per nessun
   contratto, dal primo giorno**. Non è estetica: il prompt usa quel nome solo
   per distinguere le due parti, e senza il modello legge correttamente i due
   nomi ma non sa quale sia il cliente — e abbassa onestamente la fiducia a
   **0,4–0,6**, sotto la soglia di 0,65 del validatore. Risultato: la scheda del
   contratto usciva **senza controparte**, con `missing_counterparty` acceso su
   ogni contratto. Un errore ingoiato a monte e un risultato plausibile a valle.
   ✅ Corretto (`legal_name`, e l'errore ora **solleva** invece di travestirsi da
   dato mancante), con una sezione nuova in `test:contracts` (66 → **69**) che
   esegue la funzione vera contro lo schema vero. Controprova: rimettendo la
   colonna sbagliata il test si ferma con `COMPANY_NAME_READ_FAILED:42703`.

2. ⚠️ **`parsePeriod('vingt-quatre mois')` restituiva `4`.** Non un vuoto: un
   numero **plausibile e sbagliato** su una durata minima, che non fa comparire
   nessuna bandiera. Il commento del file dichiarava «fino a dodici, e non oltre
   di proposito … oltre il dodici i contratti scrivono la cifra»: falso per il
   francese. `'trente-deux mois'` dava **2**. ✅ Corretto in due parti — i
   composti che i contratti usano davvero (18, 24, 36, 48, 60 nelle quattro
   lingue) e, soprattutto, **un composto sconosciuto ora torna `null` invece di
   un suo pezzo**. `test:contracts-unit` 93 → **102**; le 9 righe nuove sono
   rosse contro il codice di prima.

**Tasso per campo, dopo le correzioni — 70 su 79:**

| esito | campi |
|---|---|
| 3/3 | `document_language` `detected_type` `company_party` `counterparty` `counterparty_address` `end_date_kind` `minimum_term_value` `minimum_term_unit` `auto_renewal` `notice_period_value` `notice_period_unit` `notice_anchor_text` `termination_method` `termination_address` `cost_amount` `cost_currency` `cost_frequency` `cost_vat_included` `price_adjustment` `governing_law` `jurisdiction` `signed` |
| 2/3 | `end_date` · `renewal_period_value` |
| 0/3 | `document_date` · `start_date` |

⚠️⚠️ **I 9 rossi rimasti non sono nove difetti: sono due.**

- **Sette erano la stessa cosa: le date scritte a parole.** `toDateOrNull`
  accettava solo la forma ISO e `gg.mm.aaaa` con il giorno maggiore di 12. «12
  giugno 2026», «3. November 2026», «1er février 2027» — la forma **normale** in
  un contratto — diventavano `null`. Il modello le restituiva con fiducia 0,95 e
  la citazione si ritrovava: le scartavamo noi. ⚠️ Non era una svista: era una
  scelta dichiarata e **congelata in un test** («1er janvier 2026 non convertita
  → null»). La motivazione scritta parlava però di forme *ambigue*, e un mese
  scritto in lettere non lo è. Conseguenza misurata: senza `end_date` nessuna
  scadenza di disdetta è derivabile, e i tre contratti uscivano con
  `notice_not_derivable` — il modulo leggeva tutto e non sorvegliava niente.
  ✅ **Corretto il 2026-08-03**: mesi in lettere in it/de/fr/en, con il luogo
  davanti («Lugano, 12 giugno 2026») perché è così che i contratti li stampano.
  ⚠️ **La severità non si è persa, e le controprove lo verificano**: «03.04.2026»
  resta `null`, «31 febbraio 2026» resta `null`, e **due date diverse nella
  stessa stringa restano `null`** — scegliere sarebbe indovinare.
  `test:contracts-unit` 102 → **116**; le 14 righe nuove sono rosse contro il
  codice di prima (10 rossi misurati).
  ⚠️⚠️ **NON rimisurata dal capo alla coda**: il credito Anthropic si è esaurito
  subito dopo. Il 88,6 % qui sopra è la misura di PRIMA di questa correzione. Il
  numero atteso è ~77/79, ed è una previsione, non una misura. (Dal 2026-08-09
  la correzione è DEPLOYATA; la rimisurazione resta bloccata dal credito.)
- **Due sono `renewal_period` sul contratto italiano**: «di anno in anno» non è
  un numerale e `parsePeriod` torna `null`. È un limite, non un valore sbagliato.

✅ **Le due correzioni sono DEPLOYATE dal 2026-08-09** (`contract-worker` v19;
fino ad allora la produzione portava il codice vecchio). La misura del 88,6 %
era stata fatta eseguendo la pipeline vera (`processContractDocument`, lo
stesso modulo del worker) in Node, contro il database reale e il modello vivo.

✅ **Nessun residuo**: quattro esecuzioni dell'eval, ogni volta azienda tecnica
creata e cancellata, cancellazione verificata. Produzione riletta a fine giro —
2 aziende, 19 documenti, 0 aziende orfane, 0 verbali contrattuali.

⚠️ **Rimisurato il 2026-08-07 — che cosa si può eseguire oggi, e che cosa no.**
Il credito è ancora esaurito (misura in cima al documento), quindi la rilettura
dal capo alla coda — quella che darebbe il tasso DOPO la correzione delle date —
resta non eseguibile: il ~77/79 resta una previsione, non una misura. Ciò che
non spende credito è stato rieseguito: `eval:contracts --self-test` **8/8** (il
metro, senza rete), `test:contracts` **69/69** sul database vero. E una cosa va
detta con la stessa voce del tasso: `contract_extractions` in produzione è a
**0 righe**. Il contratto caricato da un'azienda vera non è mai stato letto —
il worker deployato porta il codice vecchio e il credito manca — e le
esecuzioni dell'eval non lasciano righe, perché l'azienda tecnica se ne va con
tutto ciò che possiede. «Il modulo ha letto tre contratti» e «il modulo non ha
mai letto il contratto di un cliente» sono entrambe vere.

## ✅ I DUE CONTROLLI CHE NON SI CONTROLLAVANO — chiusi il 2026-08-03

**`docs:check` dava un verde falso da `~/swiss-ai-suite-app`.** Il README della
radice vive nel monorepo, un livello sopra l'app; dalla directory di sviluppo non
c'è. Il controllo lo **dichiarava** — riga gialla, testo esplicito — e poi
stampava «Nessuna divergenza» e usciva **ZERO**, con due dei cinque controlli
(moduli e collegamenti della radice) mai eseguiti. Il salto era scritto, ma le
due cose che un lettore guarda davvero — la parola «verde» e il codice di uscita
— dicevano entrambe «a posto». È il difetto che quel file esiste per
intercettare, commesso da quel file.

Ora: **uscita 3** e la parola «PARZIALE», con tre modi dichiarati —
`--root ~/swiss-ai-suite-repo` esegue il controllo **completo** dalla directory
di sviluppo, `--allow-partial` accetta il parziale a occhi aperti, e dal monorepo
non serve niente. La decisione è stata estratta in una funzione pura
(`esitoFinale`) e provata su 5 casi, fra cui «⚠️ divergenze: `--allow-partial`
NON le perdona». L'autoverifica passa da 21 a **26 casi**.

**E la conseguenza sul runner è stata risolta, non subita.** Rendendo `docs:check`
severo, `npm run ci` da `~/swiss-ai-suite-app` diventava **ROSSO — 1 su 6
falliti**: falso, perché nessun controllo aveva fallito. Due correzioni:

- un passo che esce **3** non è più contato fra i falliti. Il gruppo diventa
  **`INCOMPL`**, il riepilogo NOMINA il passo, l'uscita resta 3, e gli altri
  gruppi vengono comunque eseguiti — prima ci si fermava lì e `unit` non girava
  affatto. `decidiEsito` ha un quarto stato, provato su **4 casi nuovi**
  (autoverifica del runner da 7 a **11**), fra cui «un rosso NON nasconde il
  passo non eseguito» e «il quarto stato non contagia i verdi»;
- **`npm run ci -- --root ~/swiss-ai-suite-repo`** esegue il controllo COMPLETO
  dalla directory di sviluppo. Misurato: senza `--root` uscita **3**
  (`INCOMPLETO — nessun controllo ha fallito, ma 1 non è stato eseguito`), con
  `--root` uscita **0, VERDE**. Dal monorepo — dove gira la CI — non serve
  niente ed era già verde.

⚠️ Ripiegare sul README dell'**app** non era un'opzione, ed è stato verificato
invece che supposto: non contiene la tabella dei moduli, e il controllo avrebbe
dichiarato mancanti Calendario, Contratti e l'Assistente. Falsi rossi al posto di
un verde falso non sono un miglioramento.

**`test:operations` non sapeva se un modulo fosse guardato dal typecheck.** Il
difetto del destinatario delle email è vissuto per settimane perché
`tsconfig.json` include `src` e `scripts`: un file di `supabase/functions/` entra
nel programma **solo se qualcosa là dentro lo importa**. È la stessa domanda che
`test:operations` pone già alle Edge Function — «qualcuno lo chiama?» — applicata
al typecheck: **qualcuno lo guarda?**

Il controllo 8 segue il grafo degli import da `src/` e `scripts/` e pretende che
ogni modulo **portabile** sia raggiunto. I file che usano `Deno.` o importano
`npm:`/`jsr:` sono esenti **per costruzione**, e il controllo lo verifica invece
di crederci. Il debito noto sta in `TYPECHECK_SCOPERTI`, con la stessa forma di
`CRON_SOLO_A_MANO`. Fino al 2026-08-10 le righe erano **due**; **al 2026-08-10
ne resta una**:

- ✅ `_shared/calendar/sync.ts` (451 righe che nessun test eseguiva) — **estinta
  il 2026-08-10** da `test:calendar-sync-unit`, che esegue le funzioni vere
  contro finzioni (**75 asserzioni, 25 controprove per mutazione** tutte rosse
  sull'asserzione giusta);
- `_shared/assistant/store.ts` (provato via HTTP attraverso la funzione
  deployata, non importato) — **resta al 2026-08-10**, ed è debito dichiarato.

Un modulo NUOVO non importato fa fallire il controllo: **controprova eseguita**
creando un file di prova sotto `_shared/`. E dal 2026-08-10 il debito **scade da
solo**: una riga il cui modulo è ormai raggiunto — o sparito — fa fallire il
controllo, come le eccezioni di `design:lint`.

⚠️⚠️ **E il controllo nuovo, appena scritto, poteva ORDINARE la bugia che
esiste per impedire.** Una revisione avversaria lo ha dimostrato lo stesso
giorno con un file di sonda: il rilevatore degli import leggeva il testo
**grezzo**, quindi un import soltanto *citato in un commento* bastava a far
credere raggiunto un modulo che nessuno importa. Da solo sarebbe stato un falso
raggiunto silenzioso; insieme alla scadenza del debito era peggio — la riga
**viva** veniva segnalata come stantia, e obbedire al suggerimento avrebbe
lasciato quel modulo senza typecheck **e senza rosso, per sempre**. Corretto con
uno scanner che riconosce commenti, stringhe ed espressioni regolari
(`senzaCommenti`), e coperto da cinque casi nuovi.

⚠️ Corrette nello stesso giro altre due debolezze dello stesso controllo, ed
entrambe erano «verdi che non distinguono»: l'**ordine dei rami** dava a un file
non-portabile la diagnosi «ormai qualcuno lo importa» (gesto giusto, ragione
falsa), e l'autoverifica contava i problemi **senza mai leggere il messaggio** —
fondendo i due rami in uno generico passavano tutti i casi. Ora dove il ramo
conta il caso dichiara la frase attesa. Autoverifica da 30 a **38 casi**.

## Il carattere dell'interfaccia — deployato il 2026-08-11 e PROVATO SUL DOMINIO

**Inter, ospitato da noi** (`inter-ui@4.1.1`, SIL OFL), al posto dello stack di
sistema. Il come e il perché stanno in [`design-system.md`](design-system.md);
qui c'è solo lo stato, con le sei parole.

| | Stato al 2026-08-11 |
|---|---|
| Implementato | sì — `src/styles/fonts.css`, tre pesi in `public/fonts/` |
| Deployato | **sì** — `app.ai-swisse.com` serve i tre `.woff2` con `HTTP 200`, `content-type: font/woff2` e `cache-control: immutable`, e le loro **impronte sha256 coincidono con quelle fissate in `fonts-check.mjs`**: i byte sono arrivati intatti fino al CDN |
| Configurato | non richiede configurazione: nessun segreto, nessuno scheduler |
| Testato | **sì** — `npm run fonts:check` in CI (impronte, copertura, cablaggio di preload e `@font-face`), 18 casi di autoverifica. ⚠️ Fino al 2026-08-13 la «copertura» era misurata contro la gamma chiesta al subsetter e non contro i file: vedi più avanti |
| Provato contro la cosa reale | **sì**, sul dominio: vedi la misura qui sotto |
| Disponibile a clienti esterni | sì — è l'interfaccia che vedono tutti |

⚠️ **La richiesta esterna che NON parte è il punto di tutto il lavoro.** Aprendo
`app.ai-swisse.com` l'unico host contattato fuori origine è il nostro Supabase:
nessuna chiamata a `fonts.googleapis.com`, quindi l'informativa privacy — che
dichiara di non caricare risorse esterne — **resta vera**. Il browser scarica il
solo 400 e il 600; il 500 resta `unloaded` finché non serve, che è ciò che il
preload del solo peso del testo doveva ottenere.

### Le schermate INTERNE, provate in produzione il 2026-08-11

> ⚠️ **Questa verifica riguarda il layout di quel momento.** Lo stesso giorno,
> più tardi, tre delle cinque schermate qui sotto — Panoramica, Documenti,
> dettaglio documento — sono state ristrutturate **e deployate**: vedi
> «Gerarchia e densità» più avanti. Le misure che seguono restano vere di ciò
> che erano, e non descrivono più ciò che i clienti vedono adesso.

La verifica del 2026-08-10 si era fermata al CSS compilato: le schermate dietro
autenticazione non erano state guardate, e questa pagina lo dichiarava. **Adesso
lo sono**, sull'app deployata, con i dati veri di un'azienda reale e **senza
scrivere niente** — nessun dato creato, nessun pulsante di conferma premuto; la
lingua si cambia in `localStorage` (`swissai.locale`), non sul profilo, ed è
stata rimessa com'era.

Cinque schermate — Panoramica, Documenti, Finanze, Attività, dettaglio documento
— in **it/de/fr**, confrontando ogni volta Inter con lo stack precedente sulla
stessa pagina: **219 elementi misurati, zero tagliati, zero scorrimenti
orizzontali**. Cambiano altezza due soli elementi, entrambi sottotitoli di KPI
che prendono una riga in più. Le etichette dei KPI stanno a 32 px in tutte e tre
le lingue: la riserva di due righe della regola 6 regge anche in tedesco.

⚠️ **Un difetto trovato e corretto**: in tedesco la voce
«Unternehmenseinstellungen» sporgeva dal proprio pulsante — 7 px già con lo stack
di sistema, **15 px con Inter** — lasciando 2 px dal bordo della barra invece di
10. Corretto con `hyphens: auto` sull'etichetta, che dà
«Unternehmenseinstel-lungen»; la barra resta a 264 px.

⚠️⚠️ **Che cosa resta NON osservato, e va detto invece di essere sottinteso**: i
due elementi a cui è stato aggiunto `tabular-nums` non compaiono nei dati di
quell'azienda — `.rb-num` vuole incentivi corrispondenti (l'azienda ne ha
**zero**) e `.dl-date` un documento con una scadenza estratta. La correzione è
quindi provata **sulla misura** — nell'app viva, `11.11.2026` e `30.09.2026`
misurano 102,3 px e 122,3 px senza `tabular-nums` e **122,7 px identiche** con —
ma **non su un elemento in pagina**. Servirebbe un'azienda con un progetto
incentivi attivo.

⚠️ Due osservazioni **preesistenti**, verificate con entrambi i caratteri e
quindi non causate dal cambio: nella riga dei KPI il terzo numero sta 4 px più in
alto (quella scheda è un link, `.kpi-link`), e le due voci di Finanze mostrano
«importo non indicato» — sono i due `NOT_FINANCIAL` già dichiarati sopra.

## ⚠️ Gerarchia e densità — DEPLOYATO il 2026-08-11, e non ancora guardato da nessuno

Tre livelli di superficie (`--surface-1/2/3`), una sola azione primaria per
schermata con menu di trabocco, colonna di lettura (`--measure`,
`--content-max`), elenco documenti ristrutturato, Panoramica con una gerarchia
dichiarata. Il come e il perché stanno in
[`design-system.md`](design-system.md); qui c'è solo lo stato.

| | Stato al 2026-08-11 |
|---|---|
| Implementato | sì — `app.css`, `ActionMenu.tsx`, `documentModel.ts`, tre schermate |
| Deployato | **sì** — PR #34 unita, e gli asset serviti da `app.ai-swisse.com` portano i marcatori del cambio: nel CSS `--surface-1`, `--surface-2: transparent`, `--fill-subtle`, `--measure`, `--content-max`, `.action-bar`, `.btn-toggle`, `.menu-panel`, `.doc-row-badges`; nel JS `action-bar-secondary`, `menu-panel`, `moreActions`, `greetingMorningNamed`, `Offene Massnahmen` |
| Configurato | non richiede configurazione |
| Testato | **in parte**: la regola «un solo colore forte per riga» è una funzione pura con 20 combinazioni provate (`test:documents-unit`, sez. 11) e `design:lint` resta verde. Il **layout** non ha test: si guarda |
| Provato contro la cosa reale | **NO** — è deployato, e non l'ha ancora guardato nessuno. Vedi qui sotto |
| Disponibile a clienti esterni | sì — è l'interfaccia che vedono tutti |

⚠️ **«Deployato» e «provato» sono due parole diverse, e questa riga è il caso in
cui la distinzione morde.** Il lavoro è in esercizio per tutti i clienti da
questo pomeriggio, e nessuno l'ha ancora aperto con dati veri: sono i marcatori
negli asset a dire che è arrivato, non un occhio. La quinta parola resta NO
finché quell'occhio non c'è — e proprio perché la prima è diventata sì, il
divario adesso conta più di prima.

⚠️⚠️ **LA VERIFICA DEL 2026-08-11 QUI SOPRA RIGUARDA IL LAYOUT PRECEDENTE, e
dirlo è metà del valore di questa pagina.** Le «cinque schermate provate in
produzione con i dati veri di un'azienda reale» sono state misurate su
Panoramica, Documenti e dettaglio documento **com'erano prima di questo
lavoro** — cioè su tre delle cinque schermate che questo lavoro riscrive. Quelle
219 misure restano vere di ciò che erano, e **non dicono niente** di ciò che
c'è adesso.

Che cosa è stato guardato davvero, e con che strumento: 375/768/1280, chiaro e
scuro, nelle tre lingue, su un **banco di prova usa-e-getta** fuori da `src/`
che monta il foglio di stile VERO e i componenti puri veri
(`NextStepCard`, `ActionMenu`, `rowBadgeTones`) dentro la cornice vera, **con
dati inventati**. Prova il CSS e il riflusso; non prova che i dati veri abbiano
quelle forme — un mittente più lungo di quelli inventati, una pastiglia in più,
un titolo che va a capo tre volte sono cose che solo i dati veri mostrano.

⚠️ Le schermate interne stanno dietro autenticazione e da questa postazione non
si aprono senza credenziali: **il banco di prova non è una scorciatoia scelta,
è l'unico strumento disponibile**. Per chiudere il divario serve il gesto che è
già stato fatto per il carattere — aprire `app.ai-swisse.com` con i dati di
un'azienda reale, e guardare. **Adesso si può**: il lavoro è deployato, quindi
quel gesto non aspetta più niente. Finché non succede, questa riga dice «no»
alla quinta parola.

⚠️ **E c'è una decisione di prodotto in sospeso, che nessun controllo può
chiudere**: nella Panoramica la metrica grande è «Azioni da completare», scelta
leggendo la richiesta come una conferma. Se la metrica che conta di più è
un'altra, è una classe da spostare (`kpi-hero` / `kpi-sm`) — ma va deciso da una
persona, non dedotto.

## Il marchio e i pesi del carattere — COMMITTATO il 2026-08-13, non ancora deployato

Il marchio non è più una lettera in un quadrato: è il wordmark che il titolare
usa già sulla vetrina («AI» in un blocco, poi «Swisse»), ricomposto in Inter. E
sotto ci sono tre difetti del carattere che nessun controllo vedeva. Il come e
il perché stanno in [`design-system.md`](design-system.md); qui c'è lo stato.

| | Stato al 2026-08-13 |
|---|---|
| Implementato | sì — `BrandMark.tsx` (nove punti di montaggio), favicon in `index.html`, `app.css`, `extra.css`, `fonts-check.mjs` |
| Deployato | **NO** — commit `19653fa` nello specchio, PR aperta, nessun merge |
| Configurato | non richiede configurazione |
| Testato | **sì** — `test:shell-unit` 115 casi (§3 favicon, §3b marchio, §8 cifre tabulari), `test:print-unit` 62, `fonts:check` con la copertura letta dalla cmap dei file. Ogni controllo nuovo è stato **provato sul rosso che deve dare** |
| Provato contro la cosa reale | **in parte, e va detto come**: il marchio, i KPI e le barre sono stati guardati a 1280/768/375, nei due temi e nelle tre lingue, **con le regole CSS vere ma dati inventati** — le schermate interne stanno dietro auth. La pagina di accesso è invece quella vera. Il **PDF del dettaglio documento non è stato riprodotto** |
| Disponibile a clienti esterni | **no** — finché non è unito |

⚠️ **Che cosa NON è stato riprovato, e non va sottinteso.** La stampa: che
`@media print` non tocchi `font-family` ora è presidiato da un test sul CSS
(`test:print-unit`), ma **un test sul CSS non è un PDF aperto**. L'unica prova su
un PDF vero resta quella del 2026-08-10, che non dice quale schermata sia stata
esportata e precede otto commit sui fogli di stile. La quinta parola per la
stampa vale «no» finché qualcuno non esporta il dettaglio documento e guarda i
font incorporati.

⚠️ **La coerenza fra il marchio dell'app e quello della vetrina non è
sorvegliata da niente.** `site/` è una base di codice separata, invisibile da
questo albero: nessun controllo di qui può leggerla. Oggi i due segni sono la
stessa forma, ma su fondi di **due blu diversi** — `--accent` nell'app,
`#00AEEF` sulla vetrina — ed è un divario **dichiarato**, non una svista: la
vetrina tiene i colori del marchio per scelta. Se il marchio cambia, i posti da
toccare a mano sono due.

## Le etichette — IN PRODUZIONE dal 2026-08-14, e GUARDATE con dei dati

Le pastiglie che **classificano** (ruolo, tipo, fase, valuta) passano da un
componente solo, `components/ui/Tag.tsx`, invece di essere scritte a mano in
ogni modulo. Il come e il perché stanno in
[`design-system.md`](design-system.md); qui c'è lo stato.

| | Stato al 2026-08-14 |
|---|---|
| Implementato | sì — `Tag.tsx` più 27 file toccati; 57 pastiglie scritte a mano tolte da 17 moduli |
| Deployato | **sì** — PR #48 unita, marcatori verificati nel bundle servito |
| Configurato | non richiede configurazione |
| Testato | **sì** — `test:shell-unit` 116 casi: §9 (nessuna pastiglia a mano nei moduli) e §7 estesa ai toni di `Tag`. Entrambi provati sul rosso che devono dare |
| Provato contro la cosa reale | **sì, e va detto COME**: con un'azienda usa-e-getta seminata in produzione (`scripts/seed-azienda-usa-e-getta.mjs`) e poi rimossa. CRM, Contratti, Automazioni e Incentivi guardati con dei dati, nelle tre lingue: nessuno sforo, nessuno scorrimento orizzontale, nessuna incoerenza di tono **dentro** una schermata. ⚠️ I dati erano **seminati, non di un'azienda che lavora**: le forme si sono viste, i casi che nascono dall'uso no |
| Disponibile a clienti esterni | sì — è l'interfaccia che vedono tutti |

⚠️ **PERCHÉ È SERVITA UN'AZIENDA FINTA, e non è un dettaglio di metodo.**
Il 2026-08-14, entrando in produzione con la sessione vera, **quattro moduli su
cinque erano VUOTI**: Rossi SA non ha clienti, contratti, automazioni né
progetti incentivi. Le etichette erano in esercizio e non le rendeva nulla — la
quinta parola non si poteva mettere a «sì» guardando meglio, perché non c'era
niente da guardare. È il caso in cui il divario si chiude solo mettendo dei dati
davanti agli occhi, e poi togliendoli.

⚠️ **Tre difetti che questo lavoro CORREGGE, e che nessun controllo vedeva** —
perché non c'era niente da controllare: erano stringhe.

1. Lo **stesso** stato di relazione era rosso/ambra/blu nell'elenco clienti e
   **grigio neutro** nella scheda dello stesso cliente. Un'azienda con attività
   scadute gridava in un posto e taceva nell'altro.
2. Gli **stessi** ruoli erano neutri nell'elenco e **blu** nella scheda — e
   `badge-blue` è il blu d'**azione**, che dal 2026-08-13 non marca più stati.
3. Lo stato di un'opportunità portava l'**ambra**, il colore che ovunque nel
   prodotto significa «attenzione», su un fatto del tutto normale.

⚠️ **Quattro cose restano senza famiglia**, dichiarate in `design-system.md`:
lo stato di salute di una relazione, lo stato di una pratica incentivi, il
punteggio di pertinenza, lo stato di un criterio. Nessuna delle nove famiglie
può ospitarle senza prestare il proprio segno a un'altra. Sono **decisioni di
prodotto**, non lavoro rimasto indietro.

⛔ **La provenienza delle attività NON è stata aggiunta, e non si può.**
`task.source` dice quale MODULO ha creato l'attività, non se il documento
chiedesse quella cosa: la distinzione vive su `ChecklistAction.sourceType`, e
`stepsFromActions` copia solo il testo — `task_checklist_items` ha la sola
colonna `text`. Marcare da `task.source` scriverebbe «suggerimento» su azioni
richieste nero su bianco. Il divario è dichiarato dal 2026-08-13 e resta;
chiuderlo richiede una **migrazione**.

## ⛔ APERTO — l'azienda attiva non sopravvive a un ricaricamento

Trovato il 2026-08-14 guardando la produzione con **due** aziende. **Non è
corretto**: è un cambio di comportamento in un contesto centrale, e la
decisione è di chi conduce il prodotto.

Si sceglie la seconda azienda nel selettore, si ricarica la pagina, e si torna
sulla **prima** — con la preferenza in `localStorage`
(`swissai.activeCompanyId`) **sovrascritta**, non semplicemente ignorata.

Il meccanismo, in `src/contexts/CompanyContext.tsx`: lo stato nasce da
`readStored()` (riga 50), ma al primo render l'autenticazione non è ancora
risolta, quindi `user` è `null`; il ramo «niente utente» (righe 88-100) esegue
`setActiveCompanyId(null)` e l'effetto di persistenza (righe 105-107) scrive
subito quel `null`, **cancellando la preferenza**. Quando l'utente arriva,
`loadMemberships` trova `prev === null` e sceglie `list[0]`.

**La causa in una frase**: quel ramo non distingue **«disconnesso»** da **«non
ancora saputo»**, e distrugge una preferenza a ogni caricamento di pagina.

⚠️ **Perché non l'aveva visto nessuno**: si vede solo con **più di un'azienda**,
e in produzione ce n'era una sola. Chi ne ha due legge documenti, scadenze e
contratti dell'azienda sbagliata **senza accorgersene** — non c'è nessun
segnale, perché dal punto di vista dell'applicazione quella È l'azienda attiva.

## ⚠️ APERTO — valori attaccati senza separatore in `.list-sub`

Si legge «Accordo di riservatezza**Keller Bau AG**» nell'elenco dei contratti e
«Zürich (ZH)**Nessun responsabile**Nessuna persona di contatto» in quello dei
clienti. `.list-sub` (`app.css`) non ha nessuna regola che separi gli `<span>`
adiacenti, e alcuni chiamanti ne mettono più d'uno di fila
(`contracts/ContractsPage.tsx:441-447`, `crm/ClientsPage.tsx`); altrove il `·` è
scritto **a mano** nel JSX (`tasks/TaskDetailPage.tsx:396`), che è la ragione
per cui la mancanza non salta all'occhio leggendo il codice.

Preesistente — nasce in `59d3245`, verificato con `git log -L`, e non è un
effetto della migrazione a `Tag`. Non corretto qui perché una regola su
`.list-sub span + span` toccherebbe ogni chiamante in una volta, compresi
quelli che il separatore ce l'hanno già: va guardata schermata per schermata.

## Le tre suite che provano IL PROGETTO — eseguite il 2026-07-31

`npm run test:production -- --no-skip` → **VERDE**, 3 passi, 10,8 s. Non provano
il prodotto: provano *questo* progetto Supabase, ed è per questo che restano
manuali e si rifiutano di girare contro `127.0.0.1`.

| Suite | Esito | Che cosa ha verificato |
|---|---|---|
| `check:auth` | **4/4** | i link inviati per email portano a `https://app.ai-swisse.com`, il redirect richiesto è rispettato, e un URL estraneo **non** viene accettato (niente open redirect) |
| `subsidy:health` | **exit 0** | 7 programmi, tutti `verified` e attivi, contenuti tradotti de+fr 7/7, **0 errori di integrità**, **0 da ricontrollare** |
| `test:functions` | **12/12** | `generate-reply` e `interpret-project` **deployate**: 405, 401, 400, **403 cross-tenant**, 422, e il **429** del limite per azienda — tutti respinti prima della chiamata al modello, quindi senza spendere credito |

✅ **Tutte e tre rieseguite il 2026-08-07** (il gruppo `production` gira dentro
`npm run test:all`, che oggi comprende anche lui): `check:auth` **4/4** contro
`https://app.ai-swisse.com`, `subsidy:health` **exit 0** — ma la frase è
cambiata, «niente in sospeso», e il perché sta nella sezione qui sotto —
`test:functions` **12/12**, compresi i due 429 del limite per azienda.

⚠️ **`check:auth` senza argomento verifica `http://localhost:5174`.** Il primo
lancio è passato dicendo «i link porteranno a http://localhost:5174» — verde su
una domanda diversa da quella che conta. Il risultato scritto qui sopra è della
riesecuzione esplicita:

```
npm run check:auth -- https://app.ai-swisse.com
```

✅ **`subsidy:health` ADESSO NOMINA LA CODA DI REVISIONE** (dal 2026-08-01).
Fino a ieri usciva 0 scrivendo «catalogo valido e aggiornato» mentre sette
schede aspettavano il giudizio di una persona: non era un difetto della suite —
faceva esattamente ciò che dichiarava, freschezza e integrità — era un difetto
di **copertura**, che è peggio, perché chi legge l'esito non ha modo di sapere
che cosa l'esito non guarda.

Le sette erano tutte della stessa forma: `change_type = program_metadata`,
`risk_level = low`, una per ciascuno dei 7 programmi, tutte del 2026-07-30,
tutte con la stessa nota — *«Il contenuto della fonte è cambiato (1 campi
normalizzati diversi)»*. Sembravano sette volte la stessa domanda, «la fonte
ufficiale è cambiata: quel che diciamo è ancora vero?» — e **non lo erano**:
`previousHash` nullo su tutte e sette, nessun termine di paragone. Non si era
mossa la fonte, aveva cominciato a funzionare il nostro lettore. **Chiuse il
2026-08-05 come `ignored` dal sistema** (`reviewed_by` nullo: nessuna persona ha
deciso, e `accepted` avrebbe scritto il falso — «una persona ha confrontato»).
Il difetto che le emetteva è corretto in `diff.ts` (dettaglio nella riga degli
Incentivi).

E dal 2026-08-05 **il codice d'uscita distingue tre stati** invece di lasciare
la coda sotto lo zero: **0** = niente in sospeso · **1** = catalogo valido ma
c'è lavoro per una persona · **2** = errori di integrità. Fino ad allora usciva
0 anche con sette revisioni in attesa, e sono rimaste ferme sei giorni sotto la
parola «verde»: nominare non basta, si legge il codice d'uscita.

Che cosa stampa oggi (rieseguito il **2026-08-07**):

```
  Programmi: 7  (verified 7 · recheck 0 · demo 0)
  Attivi: 7/7
  Concedibili: 6/7  (1 sospesi)
  Contenuti tradotti (de+fr): 7/7
  Errori di integrità: 0
  Da ricontrollare (freschezza): 0
  Revisioni in attesa di una persona: nessuna

Esito: catalogo valido e aggiornato, niente in sospeso (exit 0)
```

⚠️ **E questo zero va letto per ciò che è**: la coda è vuota, non «il catalogo è
stato ricontrollato». `last_checked_at` è fermo al **2026-07-25** su tutti e
sette i programmi — nessuna persona ha ancora confrontato le fonti con ciò che
pubblichiamo. La freschezza non lo segnala perché la soglia dei 180 giorni è
lontana, non perché il confronto sia avvenuto.

**Le soglie oltre le quali diventa un errore di integrità (exit 2), e perché.**
Una revisione in coda non è un errore — il dato è valido, è la sua conferma che
manca — e farla diventare subito rossa insegnerebbe a ignorare quel rosso, che
è il modo più sicuro di rendere inutile anche il rosso vero. Ma una coda che non
si smaltisce mai smette di essere un arretrato:

| Soglia | Valore | Perché |
|---|---|---|
| Età della più vecchia | **30 giorni** | il contenuto `verified` è fresco per 180 giorni, la sospensione per 120. Una revisione è una cosa diversa da entrambe: è il **segnale** che il contenuto potrebbe essere cambiato, e un segnale vale più di una scadenza. Trenta giorni significa «questa coda si guarda almeno una volta al mese». Le finestre di domanda svizzere si misurano in mesi: un mese di ritardo su un cambiamento a rischio basso non fa perdere un bando, due possono |
| Quante in coda | **25** | il catalogo ha 7 programmi. Una coda tre volte più grande del catalogo non è lavoro arretrato: vuol dire che il rilevatore segnala ripetutamente le stesse cose e nessuno le legge |

Entrambe si spostano da riga di comando (`--review-stale-days=`,
`--max-pending-reviews=`), e il giudizio è una funzione pura provata su sette
casi con `npm run subsidy:health:self-test`, che gira dentro `test:unit`.

Segnalato dalla suite stessa, e legittimo: **`ti-lrilocc` è SOSPESO** — attivo
ma non concedibile, stato verificato il 2026-07-25. Concedibili 6 su 7.

## `test:integration` — 71 asserzioni contro la funzione DEPLOYATA

Eseguito il **2026-07-31**, tre passi, 65,7 s, **0 fallimenti**:

| Suite | Esito | Che cosa prova che nient'altro prova |
|---|---|---|
| `test:phase2` | **36/36** | la Edge Function `analyze-document` **deployata** via HTTP: immutabilità dello snapshot (0010), 403 cross-tenant, 401 senza sessione, 422 su testo vuoto, **429 oltre il limite/minuto**, e che tutte e 9 le citazioni «verificate» esistano davvero nel documento (§20) |
| `test:async` | **17/17** | che l'asincronia sia **reale**: 202 in 0,5 s, `analyzing → completed` osservato nel database, lavoro concluso **senza altre chiamate del client**, e sicurezza che resta **sincrona** (cross-tenant 403 subito, non 202) |
| `test:pipeline` | **18/18** | il percorso dati completo: analisi → validazione → persistenza → **rilettura dopo re-login** → attività dallo scadenziario → bozza salvata che **non dichiara pagamenti mai effettuati** (§36) |

⚠️ **Il primo tentativo è uscito 0 senza eseguire niente.** Il gruppo si è
SALTATO da solo — «spende credito Anthropic vero: serve `--allow-ai`» — e il
riepilogo diceva `ESITO: verde sui gruppi eseguiti · 1 SALTATI`. Il runner si è
comportato bene (ha dichiarato il salto e la ragione), ma **uscita zero e la
parola «verde» nella stessa riga** sono esattamente ciò che fa scrivere un
risultato che non esiste. La misura qui sopra è del secondo lancio, con
`--allow-ai`.

⚠️ Una cosa che solo questa suite mostra: la provenienza registrata dice
`anthropic/claude-opus-4-8`. È il modello che la funzione **deployata** usa
davvero — non necessariamente quello che si userebbe scrivendo codice nuovo.

**Dati di prova rimossi**, verificato interrogando il database: restano le due
aziende vere (Pilota Impianti Sagl, Rossi SA), **zero utenti di prova**, e
**zero righe orfane** fra documenti, attività e bozze. I 19 documenti presenti
appartengono tutti a Rossi SA.

## Le valutazioni AI — tutte e tre eseguite il 2026-07-31

| Valutazione | Esito | Che cosa mette alla prova |
|---|---|---|
| `eval:assistant` | **16/16** (`--runs 3`, 48 esecuzioni) | esito dichiarato, fonti citate, frasi che il prodotto non deve mai dire |
| `eval:admin` | **35/35** su 8 documenti | lingua, mittente, tipo di autorità, scadenze, importi, rischio, **prompt injection** |
| `eval:subsidy` | **14/14** su 5 progetti | tipi di progetto, timing, investimento, evidence verbatim, **injection e governance** |

⚠️ **Le tre voci sono state eseguite singolarmente**, non invocando il gruppo
`npm run test:eval`: la copertura è la stessa (il gruppo esegue esattamente
questi tre script), ma il runner del gruppo non è stato lanciato.

### `eval:admin` — 35/35

Otto documenti contro il modello vero, usando **schema, prompt e validazione
della Edge Function** (i moduli `_shared`), non una loro imitazione. Coperti i
tre casi linguistici (AVS in tedesco, AFC in francese, Comune in italiano) e —
la parte che conta di più — i casi in cui la risposta giusta è **non inventare**:

- nessuna scadenza e nessun importo nel testo → `deadline.type = none`, data
  `null`, nessun importo prodotto;
- scadenza **relativa** → `deadline.type = relative`, nessuna data assoluta
  fabbricata, `requiresVerification = true`;
- **prompt injection** nel documento → `sender.name` non diventa `INJECTED_OK`,
  il riassunto non diventa `HACKED`, la lingua resta quella vera.

E su tutti e otto: **nessuna evidence dichiarata «verificata» è assente dal testo**
(§20). È l'asserzione che rende il resto affidabile — senza, un modello potrebbe
azzeccare i campi citando frasi che non esistono.

### `eval:subsidy` — 14/14

Cinque progetti. Riconosce i tipi (energia, edilizia, innovazione,
digitalizzazione, assunzioni), l'investimento, e il **timing** — che un progetto
già avviato sia dichiarato tale è ciò che separa un incentivo ottenibile da uno
perso. Reggono anche i due casi difensivi: un'iniezione non forza
`overallConfidence` a 1 e il progetto vero viene interpretato lo stesso; una
descrizione vaga **non produce tipi inventati**.

⚠️ **Nessuna delle due tocca il database**: chiamano l'API con i moduli
condivisi. Non c'è pulizia da verificare, al contrario di `eval:assistant`.

### `eval:assistant` — 16/16, e che cosa significa davvero

Rieseguita la sera del **2026-07-31**, la prima volta dopo la correzione del
seed e dopo il ripristino del credito:

```
npm run eval:assistant -- --runs 3
→ 16 superati su 16 · 48 esecuzioni, tutte verdi
  token in 96 548 · out 51 318 · da cache 1 914 676
  strumenti 7,4/domanda · fonti 6,8/domanda · 66 397 ms/domanda
```

Era **15/16 con un caso diverso a ogni esecuzione**. Tre giri per domanda, tutti
verdi, sono una prova sostanzialmente più forte di un giro solo: se il difetto
del seed fosse ancora lì, 48 esecuzioni avrebbero dovuto incontrarlo.

⚠️ **VERDE NON VUOL DIRE DETERMINISTICO, e qui si vede.** Su `claude-opus-5` i
parametri di campionamento sono stati rimossi, quindi la ripetibilità bit per
bit **non è ottenibile** — `--runs N` esiste per misurare la varianza, non per
eliminarla. In questa esecuzione due casi hanno cambiato ESITO fra un giro e
l'altro, pur passando tutte e tre le volte:

| Caso | Giro 1 | Giro 2 | Giro 3 |
|---|---|---|---|
| `contratti · rinnovi` | `answered` | `partial` | `answered` |
| `incrocio fra moduli` | `partial` | `answered` | `partial` |

Passano perché l'asserzione accetta entrambi gli esiti, non perché il modello si
comporti allo stesso modo. **È un margine, e va saputo prima di stringerlo**: se
un domani si pretendesse `answered` esatto su quei due casi, tornerebbero a
lampeggiare — e non sarebbe una regressione del prodotto.

Varia parecchio anche il PERCORSO, a esito invariato: `date` ha usato 4, 6 e 5
strumenti nei tre giri e citato 2, 5 e 2 fonti; `clienti` 5, 6 e 4 strumenti.
L'esito dichiarato e le fonti giuste reggono; quanto lavoro serva per arrivarci,
no.

⚠️ **Che cosa NON dice questa misura.** Che il modulo sia provato oltre le sedici
domande della verità di riferimento: `eval:assistant` misura l'esito dichiarato,
le fonti e le frasi vietate, non che ogni risposta «suoni bene».

**Dati di prova rimossi**, verificato interrogando il database e non fidandosi
dello script: zero aziende `Eval Assistant%`, zero utenti di prova, e le due
aziende vere (Pilota Impianti Sagl, Rossi SA) intatte.

## ✅ IL ROSSO DI `test:assistant` È CHIUSO — la 0036 è applicata, 45/45 il 2026-08-07

Eseguendo `npm run test:all` la notte del 2026-08-01/02: `quality` **verde** (6
passi), `unit` **verde** (19 passi), `production` **verde** (3 passi), `db`
**ROSSO** — una suite su undici, `test:assistant`, con 42 superate e 3 fallite.

```
✗ un gruppo VUOTO si può scrivere: «ho guardato e non c'era niente»
   new row for relation "assistant_citations" violates check constraint
   "assistant_citations_single_or_group"
✗ rileggendola, la dimensione è ZERO e non NULL      letto: null
✗ e l'elenco degli identificativi è VUOTO, non assente
```

**La causa è nota e non è un difetto del codice: la migrazione
`0036_assistant_empty_group_citation.sql` non è applicata al database.** Il test
pretende il vincolo nuovo — quello che permette di citare un insieme vuoto, cioè
di ancorare la risposta «non c'è nulla» — e il database ha ancora quello della
0027. Le tre asserzioni sono scritte bene: stanno chiedendo una cosa che non
c'è.

⚠️ **Non è stata applicata di proposito**, allora: applicare una migrazione
cambia la produzione, è una decisione, non un passaggio di un lavoro, e finché
la decisione non c'era il rosso è rimasto **dichiarato, non nascosto e non
aggirato**. La decisione poi c'è stata: la produzione è a **0001–0039**
(riletto il 2026-08-07 con `supabase migration list --linked`: 39 su 39,
locale == remoto).

✅ **Suite rieseguita il 2026-08-07: 45/45.** Le tre asserzioni che erano rosse
sono verdi — il gruppo vuoto si scrive, rileggendolo la dimensione è ZERO e non
NULL, l'elenco degli identificativi è vuoto e non assente — e le tre controprove
restano verdi anch'esse: un gruppo senza `source_ids` resta vietato, fonte
singola *e* gruppo insieme restano vietati, una dimensione negativa resta
vietata. Il vincolo nuovo permette ciò che doveva permettere senza smettere di
vietare ciò che vietava.

## ✅ Perché `notifications` è a ZERO — misurato il 2026-08-11, non più dedotto

`notifications-worker` è l'esempio che CLAUDE.md usa per spiegare le sei
parole: «implementata, deployata e testata, e non ha mai generato un
promemoria». Lo scheduler gira ogni quindici minuti e `cron.job_run_details`
dice `succeeded` ogni volta. La tabella `notifications` è a **0 righe**.

Fino a oggi «lo zero è corretto» era una **deduzione dal codice**. Ora è una
misura, presa interrogando la produzione:

| Che cosa | Misura del 2026-08-11 |
|---|---|
| attività non completate, non archiviate | **4** |
| le loro scadenze | **2026-09-10** (tre) e **2026-09-30** (una) |
| finestra che il worker legge oggi | `reminderWindow(oggi)` = **2026-07-12 → 2026-08-19** (da −30 giorni a +8) |
| attività dentro la finestra | **0** |
| righe in `notification_preferences` | **0** (valgono i default: in-app acceso, email spente) |
| attività con un responsabile | **0** — tutte e quattro sono senza |

Il primo promemoria scatta a **sette giorni** dalla scadenza. La più vicina è a
trenta. **Non c'è ancora niente da ricordare, e lo zero è la risposta giusta.**

### ⚠️⚠️ E QUI STAVA IL DIFETTO: lo zero giusto e lo zero rotto erano la stessa riga

`generateReminders` scartava l'errore della lettura delle attività. Un guasto
del database — un timeout, una politica RLS cambiata, la cache dello schema —
dava `data: null`, e la funzione restituiva `tasksScanned: 0`. Il worker
rispondeva `{"status":"ok"}` e lo scheduler segnava `succeeded`.

Che è **esattamente** ciò che accade quando va tutto bene.

Su un sistema in cui lo zero è la risposta normale, quel guasto non sarebbe
stato invisibile: sarebbe stato invisibile **due volte**. Nessun rosso, nessun
numero fuori posto, nessuna riga di registro diversa — per sempre.

Corretto il 2026-08-11 in quattro punti (lettura delle attività e dei titolari
in `notify.ts`, lettura delle preferenze e accodamento della consegna in
`store.ts`) e coperto dalla sezione 13 di `test:calendar-unit`, il cui cuore è
una **coppia**: un guasto DEVE sollevare, e zero attività davvero in finestra
NON deve sollevare. Se un giorno i due zeri tornassero a coincidere, quella
coppia diventa rossa.

### Che cosa resta scoperto, e quanto è grande

Lo stesso difetto — l'errore di una query scartato — è stato **cercato in tutte
le Edge Function** il 2026-08-11, non solo qui. Il conteggio, da una scansione
riga per riga di `supabase/functions/`:

| Categoria | Punti |
|---|---|
| **no-op invisibile** — l'elenco vuoto fa concludere «niente da fare» e il worker riporta successo avendo lavorato zero | 109 |
| **perdita di dato** — una registrazione (un verbale, un esito, un id) non viene scritta | 48 |
| **autorizzazione** — fallisce chiuso, ma il codice restituito mente sulla causa | 17 |
| **duplicato** — la ricerca di «esiste già» dà null e si crea una seconda riga | 12 |
| **innocuo** | 3 |
| **TOTALE**, in 25 file | **189** |

⚠️ **Questo numero è una misura, non una promessa di correzione.**

### ⚠️⚠️ E IL NUMERO CHE DICHIARAVA DI ESSERE RIFACIBILE NON SI RIFACEVA

Fino al 2026-08-11 questa pagina diceva «**147 restanti**», e aggiungeva che
quel conteggio vale «perché chiunque può rifarlo in un secondo e ottenere lo
stesso numero». Rifacendolo si ottiene un numero diverso. Le ragioni sono due, e
sono lezioni distinte.

**1. Il comando non era scritto da nessuna parte.** La pagina descriveva il
criterio a parole — «le due forme» — e non riportava la riga da eseguire. Un
criterio a parole non è rifacibile: chi lo rifà ottiene un numero vicino e
diverso, e nessuno può dire quale dei due sia sbagliato.

**2. ⚠️⚠️ Il comando era `grep`, e `grep` non vedeva tutto.**
`supabase/functions/_shared/email/store.ts` conteneva un **byte NUL scritto
crudo** (riga 282, dentro un `.join(…)` che separa i campi di un'impronta). Per
`grep(1)` di macOS un file con un NUL è **binario**: lo salta, non lo cerca, e
non lo dice. Ventisettemila byte — il modulo della posta, **l'unico con uso
reale in produzione**, 148 email sincronizzate — erano fuori da ogni scansione
fatta con grep. Il numero autorevole era il numero di un perimetro con un buco
dentro.

E il byte era invisibile anche a chi leggeva: un NUL stampato si vede come uno
**spazio**, quindi la riga diceva `.join(' ')`. Chi l'avesse «ripulita» mettendo
uno spazio vero avrebbe cambiato l'impronta di ogni email già acquisita, e
nessuna rilettura del diff se ne sarebbe accorta.

Corretto il 2026-08-11 scrivendo il separatore come escape (`'\0'`, stesso
valore a runtime, stessa impronta — verificato) e presidiato da
**`npm run bytes:check`**, che fa fallire la CI se un byte di controllo crudo
rientra in un file tracciato.

### Il conteggio, adesso: un comando, non una frase

```bash
npm run fallback:scan              # il numero, per forma e per file
npm run fallback:scan -- --report  # riga per riga
```

Legge i byte con Node e li analizza con **il parser TypeScript vero**
(`ts.createSourceFile`): niente grep, niente espressioni regolari sul sorgente.
**La misura non può più essere azzoppata dal difetto che sta misurando**, non si
fa ingannare da un commento che cita la forma sbagliata, e dà lo stesso numero
su macOS e in CI. Le regole — e ciò che dichiaratamente NON vedono — stanno in
testa a `scripts/fallback-scan.mjs`.

La definizione è una sola, e meccanica: **una chiamata al database il cui errore
non viene MAI consultato.** PostgREST non solleva — restituisce `{data, error}`
— quindi se `error` non viene legato a un nome, o viene legato e mai letto, il
guasto sparisce e `data` vale `null` esattamente come quando la riga non c'è.

| Forma | Punti |
|---|---|
| **l'errore non viene nemmeno chiesto** — la destrutturazione non prende `error`: è irraggiungibile | 87 |
| **il risultato non viene raccolto** — `await sb…` come istruzione a sé: l'oggetto `{data, error}` è distrutto appena creato | 86 |
| **l'errore è lì e non lo guarda nessuno** — il risultato è legato per intero, ma in tutta la funzione non c'è una lettura di `.error` | 17 |
| **TOTALE**, in 35 file su 103 | **190** |

⚠️ **Dodici punti restano FUORI da questo numero, ed è una scelta.** Sono quelli
in cui l'errore *è* letto e poi collassato su un valore plausibile — `if (error
|| !data) return null`, `if (!res.error) { … }` senza `else`, un ternario che
ripiega sul fuso predefinito. Per la regola di casa sono fallback silenziosi
eccome, ma deciderli richiede di sapere se quel `null` è un esito legittimo per
*quella* funzione: è una lettura, non una misura, e un numero con dentro dei
falsi positivi non lo si può usare come cricca. Fuori anche l'errore guardato
solo attraverso un campo (`if (code && code !== '23505')`), di cui ce n'è uno
vero in `upsertMessage`.

⚠️⚠️ **E QUESTO 190 NON SI SOTTRAE AL 147, né al 189.** Sono misure con criteri
diversi, e mescolarle sarebbe il terzo errore della stessa famiglia:

| | Punti | |
|---|---|---|
| triage a otto letture parallele | 189 | criteri di ciascun lettore |
| un `grep`, il 2026-08-11 | 193 → 147 | **cieco su `email/store.ts`** |
| la prima stesura di `fallback:scan`, a regex | 137 | ne mancava circa il 28% |
| **`npm run fallback:scan`, col parser** | **190** | regole scritte ed eseguibili |

⚠️ **La stesura a regex è durata mezz'ora e va raccontata, perché ha ripetuto lo
stesso errore in piccolo.** Contava 137 e ne mancava più di un quarto: non vedeva
`const { count } = await …` (pretendeva la parola `data`), non vedeva le
destrutturazioni dentro `Promise.all`, e soprattutto non *poteva* vedere la forma
«il risultato è legato per intero e `.error` non lo legge nessuno» — per
deciderla bisogna sapere che cosa succede nel resto della funzione, cioè serve un
albero sintattico, non una riga di testo. Una misura è affidabile quanto lo
strumento che la prende, ed è la terza volta in due giorni che questo progetto lo
impara sulla stessa domanda.

⚠️ **E non è più una frase che invecchia: è una cricca.** `fallback:scan` sta nel
gruppo `quality` e confronta il numero misurato con quello dichiarato in
`ATTESI`. Esce rosso se ne compare uno nuovo, **e rosso anche se ne sparisce uno
senza che il numero dichiarato scenda con lui**: correggere un punto e
aggiornare il conteggio diventano lo stesso commit, per forza.

I cinque interventi già fatti (misurati con il grep di allora): generazione dei
promemoria (4) · consegna e composizione dell'email (8) · sincronizzazione del
calendario (4) · i caricatori di fatti delle automazioni (20) · la coda delle
automazioni e il contatore della pausa (7).

#### ⚠️⚠️ Il peggiore dei sedici non era fra i promemoria: faceva PERDERE lavoro

`syncTask` scartava l'errore di tre letture. Con `failures: 0` come esito, e il
ciclo di `calendar-sync` che legge proprio quel numero
(`if (outcome.failures === 0) await queueDone(...)`), una lettura fallita faceva
**uscire l'attività dalla coda come se fosse stata sincronizzata**: evento mai
creato, coda che se ne dimentica, report che dice `claimed: 1, upserted: 0`.

Non un promemoria in ritardo — un lavoro perso, per sempre, senza una riga
rossa. E i due casi legittimi che escono con `failures: 0` a ragione — attività
sparita, nessuna connessione attiva — erano nella suite da sempre, il che
rendeva i tre esiti indistinguibili. Corretto il 2026-08-11; le asserzioni
nuove sono scritte come **coppia** di quelle vecchie.

#### ⚠️⚠️ E nelle automazioni non era un'azione mancata: era quella SBAGLIATA

Da una lettura fallita esce `null`, e da `null` nasce un `missing()` — un fatto
dichiarato assente. Ma in `conditions.ts` gli operatori `exists`/`not_exists`
rispondono anche sui fatti non noti, di proposito, e l'elenco che li mette in
guardia contiene `low_confidence` e `unverified_quote` — **non `missing`**.

Quindi una regola scritta «campo non_esiste» diventava **vera** perché il
database aveva singhiozzato, e l'azione partiva davvero: un'attività creata, un
avviso spedito. Il caso più chiaro è `addFinanceFacts`, dove un `if (!item)`
mette **undici fatti** a `missing()` in un colpo solo.

E il meccanismo che dovrebbe impedire a una regola guasta di girare per sempre
era battuto dallo stesso silenzio: `recordWorkflowFailure` leggeva il contatore
scartando l'errore, quindi `failures` ripartiva da 1 a ogni giro e la soglia
della pausa automatica non arrivava mai. Il commento sopra quella funzione
chiama «fallire diecimila volte» il difetto peggiore possibile su questo
progetto.

#### ⚠️⚠️ Il file che nessuna scansione aveva letto: 22 punti nel modulo della posta

Tolto il byte NUL, `_shared/email/store.ts` è entrato per la prima volta in una
scansione: **22 punti**, il file più carico del perimetro. Ed è il modulo con
l'uso reale più alto del prodotto — 148 email sincronizzate, contro zero
promemoria e zero conversazioni dell'assistente.

**Il peggiore è `listLinkedDocuments` (riga 544), e non produce un'omissione:
produce una RISPOSTA SBAGLIATA presentata come completa.** La lettura di
`email_message_documents` scarta l'errore, `data` è `null`, `rows` diventa `[]`
e la funzione ritorna «per questo messaggio non è mai stato creato alcun
documento». Il chiamante (`importAndAnalyze`) non trova né allegati freschi né
documenti collegati, ricade su `{kind:'body'}`, e manda alla pipeline **il corpo
del messaggio** mentre la fattura PDF già importata resta in archivio, collegata
e non letta.

La pipeline gira davvero, la quota si consuma davvero, l'analisi si salva
davvero, e il messaggio si chiude `done` con `error_code` null. L'utente legge
un'analisi completa e sicura di sé — scadenza, importi, citazioni — estratta
dalle due righe di accompagnamento invece che dal documento. Le citazioni sono
perfino verificabili: contro il documento sbagliato. È la regola di casa
violata alla lettera: *un guasto è un errore esplicito, mai un risultato
plausibile.*

⚠️ E c'è l'aggravante scritta nella docstring della funzione stessa:
`listLinkedDocuments` **esiste** per impedire che un documento già creato venga
scambiato per lavoro già fatto, dopo che quattordici messaggi reali erano
rimasti con il documento in archivio e nessuna analisi. Il presidio scritto per
quel difetto lo reintroduce, in forma peggiore, appena la sua lettura fallisce —
e proprio nel momento per cui è stato scritto, il ritentativo dopo
un'interruzione, cioè quando i documenti esistono già.

Gli altri tre che meritano il nome per esteso:

- **`readSecrets` (98)** — un guasto di lettura non si distingue da «non ci sono
  segreti», e `getValidAccessToken` ne deduce `AUTH_EXPIRED`: la connessione
  passa a `reauth_required` e la posta si ferma **finché una persona non rifà
  l'OAuth**. Un singolo guasto transitorio richiede un intervento umano.
- **`createOrReuseDocument` (497)** — l'update che scrive `storage_path` è
  scartato e la funzione ritorna comunque `{ storagePath }`: il valore di
  ritorno **afferma** che il percorso è registrato mentre nel database è `NULL`.
  Il conto arriva al ritentativo, come `ANALYSIS_FAILED` per sempre su un file
  che in archivio è intatto.
- **`startSyncRun` (205)** — nessuna riga in `email_sync_runs`: la
  sincronizzazione avviene per intero, e il registro non dice che è andata male,
  dice che **non è successo niente**.

Nessuno di questi è ancora corretto: sono il perimetro dell'intervento
successivo. `releaseLease` (181) è l'unico del file che si autoripara — il lease
scade da sé dopo 300 secondi.

#### Che cosa hanno insegnato i cinque interventi

- **`throw` non è la risposta giusta ovunque, e il discrimine è il LOTTO.** Chi
  legge una volta e decide deve sollevare; chi scorre venticinque elementi
  indipendenti no — morire sul primo abbandona gli altri ventiquattro. Lì il
  guasto diventa un **numero nel report**, che è esplicito quanto un'eccezione.
  Il divieto di casa è il fallback SILENZIOSO, non l'eccezione mancante.
- **Uno store solleva sempre**, perché non ha un report in cui contare: la
  politica la decide il chiamante, che è l'unico a sapere se sta in un lotto.
- **`sentUnrecorded`** è l'unico stato in cui il database dice MENO del mondo:
  l'email è partita e non ne abbiamo traccia. Se non è zero, `sent` è un minimo.
- ⚠️ **Un doppio di prova può avere il difetto che si sta cacciando.** Il
  `maybeSingle()` del finto PostgREST restituiva `error: null` fisso: il guasto
  iniettato non arrivava al codice, e la prova restava verde a correzione
  rimossa.

⚠️ **E il numero ha i suoi limiti, dichiarati.** La scansione è stata fatta da
otto letture parallele; la nona — quella che doveva contestare le
classificazioni «innocuo» e cercare le forme non previste — **è morta con un
errore del servizio**, quindi le tre voci «innocuo» non sono state contestate e
nessuno ha cercato le forme diverse da `const { data } = await …`. Un controllo
a campione su quattro punti (`eventDone`, `eventRetry`, `eventFailed`,
`eventDeadLetter` in `automation/store.ts`) li ha confermati alla lettera. Un
quinto — un presunto invio doppio di email in `deliverEmails` — **era
sbagliato**: la chiave di idempotenza passata al provider lo impedisce, e il
danno vero è un altro e minore (una consegna riuscita che finisce registrata
come `failed`).

I nove punti più vicini a quello appena corretto stanno nello STESSO file, nel
percorso di CONSEGNA: `deliverEmails` e `composeEmail`. Fra questi, uno merita
di essere scritto per esteso perché è la ricaduta di un difetto già pagato: un
guasto sulla lettura di `profiles` dà `profile = null`, `composeEmail`
restituisce `null`, e la consegna viene chiusa **definitivamente** come
`NO_RECIPIENT`. È lo stesso esito del difetto del 2026-08-03 — il promemoria
che usciva verso `to: [null]` — raggiunto per un'altra strada.

## Come si rimisura questa tabella

```bash
npm run test:all         # quality + unit + db + production (`production` è dentro di proposito: in locale `.env.test` punta al progetto reale)
npm run verify:deploy    # scheduler ed Edge Function nel progetto reale (serve il token)
```

E le suite che **non** stanno in `test:all`, perché provano il progetto o
spendono credito — con i flag, che non sono facoltativi:

```bash
npm run test:production -- --no-skip          # check:auth · subsidy:health · test:functions
npm run check:auth -- https://app.ai-swisse.com   # il dominio va INDICATO (senza, exit 2)
npm run test:integration -- --allow-ai        # senza il flag: exit 3, non 0
npm run test:eval -- --allow-ai               # idem: eval assistant/admin/subsidy
```

⚠️ **I flag non sono facoltativi, ma da oggi dimenticarli non produce più un
verde**: `--allow-ai` mancante fa uscire **3** con `ESITO: NON ESEGUITO`, e
`check:auth` senza dominio esce **2** senza verificare niente.

## ✅ I DUE VERDI CHE NON VALEVANO NIENTE — chiusi il 2026-08-01

Erano due, incontrati entrambi il 2026-07-31 **mentre si rimisurava questa
tabella**, cioè nel momento in cui fanno più danno. Adesso nessuno dei due è più
ottenibile, e ciascuno ha un `--self-test` che contiene il difetto vero: se
qualcuno lo rimettesse a mano, il self-test diventerebbe rosso.

| Difetto | Prima | Adesso |
|---|---|---|
| `test:integration` / `test:eval` senza `--allow-ai` | **exit 0** in un millisecondo, `ESITO: verde sui gruppi eseguiti · 1 SALTATI` | **exit 3**, `ESITO: NON ESEGUITO`, e la parola «verde» non compare |
| `check:auth` senza argomento | verificava `http://localhost:5174` ed **exit 0** | **exit 2**, non verifica niente e spiega che il dominio va indicato |

**La scelta sul runner, e perché non è l'altra.** Le strade erano due —
invertire il default di `--allow-ai` (eseguire, e chiedere un flag per saltare)
oppure far uscire non-zero su un salto. È stata scelta la seconda: invertire il
default avrebbe reso `npm run test:all` una spesa involontaria, e la regola «la
spesa si chiede, non si eredita» vale più di un flag da digitare. **Ciò che era
rotto non era il salto — era il verde che lo accompagnava.**

Tre codici invece di due, perché «rotto» e «non misurato» sono due cose:

| Codice | Significa |
|---|---|
| 0 | eseguito tutto ciò che era stato chiesto, nessun gruppo rosso |
| 1 | almeno un gruppo **ROSSO**: un test ha fallito |
| 3 | nessun rosso, ma **qualcosa non è stato eseguito** |

**La CI non è diventata rossa per la ragione sbagliata**, ed era il vincolo: i
tre job che eseguono queste suite passano già `--no-skip` esplicito, e
`npm run ci` esegue `quality`+`unit`, che non hanno requisiti e non possono
essere saltati. `--no-skip` resta accettato — oggi è il default — perché un flag
che sparisce trasforma un cancello in un errore di sintassi.

⚠️ **`check:auth` ora ha bisogno che il dominio sia dichiarato**, quindi il
gruppo `production` lo richiede: `VITE_PUBLIC_SITE_URL` in `.env.test`, che
segreto non è. Senza, il gruppo non parte **e lo dice** (exit 3) invece di
verificare la macchina di sviluppo. ⚠️ **Va aggiunto anche ai segreti della CI**:
il job `production-suites` compone `.env.test` da lì, e senza quella riga
salterebbe — rumorosamente, che è il punto, ma salterebbe.

### Gli altri script della stessa classe, cercati apposta

Passati in rassegna tutti i comandi di `package.json` con una domanda sola:
*esiste un modo in cui esce 0 senza aver verificato ciò che il nome promette?*
Trovati altri tre, tutti corretti:

| Comando | Come usciva 0 senza provare niente | Adesso |
|---|---|---|
| `test:functions` | `process.exit(fail ? 1 : 0)` **ignorava `skipped`**: se la pre-popolazione del log fosse fallita, le due asserzioni sul 429 sparivano e la suite stampava «10 passati, 0 falliti, 1 saltati» uscendo 0. In questa tabella sarebbe finito «12/12» per una misura da 10 | exit **3** se qualcosa è stato saltato |
| `subsidy:seed` | il dry-run è il **default**: senza `--write` non scriveva niente e usciva 0. La CI ci è già cascata — il passo risultava superato e a diventare rossa era la migrazione dopo | exit **3**, con «NON è stato scritto niente» |
| `subsidy:seed-catalog` | idem | exit **3** |

Passati e trovati **sani**: `verify:deploy` (senza token esce 1 dicendo «un'assenza
di risposta non è un verde»), `test:subsidy` (senza una versione pubblicata esce 2
invece di provare zero casi), `db:bundle --check`, `i18n:coverage`,
`i18n:typography`, `docs:check` e `test:operations` (tutti con autoverifica che
gira **prima** della scansione vera).

⚠️ Segnalato e **non** corretto: `scripts/dev-user.mjs` esce 0 quando l'utente
non esiste. Non è in `package.json`, non è un controllo e non entra in nessun
riepilogo: è un attrezzo da riga di comando, e cambiarlo sarebbe rumore.

⚠️ **Nessuna riga va aggiornata da un commit message o da un ricordo.** Un
numero di test scritto in un messaggio di commit descrive l'albero di quel
momento; questa tabella descrive quello di adesso, e l'unico modo di saperlo è
eseguire.
