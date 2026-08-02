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

## ⛔ IL CREDITO ANTHROPIC È DI NUOVO ESAURITO (misurato il 2026-08-01, 21:44 UTC)

⚠️ **Questa sezione ha detto per un giorno il contrario, ed era vero quando è
stata scritta.** Il credito era stato ripristinato la sera del 2026-07-31 — la
misura qui sotto lo conferma — e si è esaurito di nuovo il **2026-08-01 verso le
11:00 UTC**. È la seconda volta in due giorni: **non è un incidente, è il modo
in cui questo prodotto funziona finché il credito si ricarica a mano.**

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
| Inbox | `/inbox` | sì | sì | sì | sì | sì | **no** | Google Gmail API | scope riservato: fuori dalla modalità Test Google impone la verifica CASA, quindi **un cliente reale non può collegare la propria casella**. Microsoft implementato e non configurato. **3 messaggi su 141 in `failed`** (2,1%), tutti `AI_CREDIT_EXHAUSTED`, tutti del 2026-08-01: il ritentativo esiste, è deployato e gira ogni 15 minuti — è il credito a non esserci (§sotto) |
| Attività | `/attivita` | sì | — | sì | sì | — | sì | — | nessuna |
| Documenti | `/documenti` | sì | — | sì | sì | — | sì | — | nessuna politica di conservazione delle analisi |
| Calendario e notifiche | `/calendario` | sì | sì | sì | sì | **no** | **no** | Google/Microsoft Calendar, provider email | ⚠️ **i promemoria sono accesi dal 2026-07-31**, non prima: i due scheduler non esistevano e i secret non erano impostati. Dal 2026-07-31 li crea la **migrazione 0035** invece di un blocco SQL da incollare a mano, e il percorso è stato **provato dal capo alla coda** su un tenant tecnico (§sotto). Restano due cose: **nessuna email può partire** (`NOTIFICATION_EMAIL_API_KEY`/`_FROM` non configurati, `deliverEmails` esce subito) e **nessuna connessione OAuth reale è mai stata stabilita**, quindi la colonna «servizio reale» resta **no** |
| Automazioni | `/automazioni` | sì | sì | sì | sì | sì | sì | — | nessuna approvazione umana: solo azioni a rischio basso, e per questo non esiste nessuna azione che ne avrebbe bisogno. Le esecuzioni che non corrispondono non lasciano traccia |
| Finanze | `/finanze` | sì | sì | sì | sì | parziale | sì | — | il codice QR **binario** non viene decodificato; le aliquote storiche non ci sono; su 4 voci reali 2 sono `completed` e 2 `failed` con `NOT_FINANCIAL`, che è una classificazione corretta |
| Contratti | `/contratti` | sì | sì | sì | sì | **no** | parziale | Anthropic | ⚠️ **il worker non ha mai prodotto un'estrazione su un contratto vero**: `contract_extractions` è **ancora a zero**, riverificato il 2026-08-01 (`contracts` ha 1 riga, estrazioni 0). Il prompt è allineato a un ragionamento, non a una risposta reale. ⚠️ Oggi la prova è bloccata **due volte**: manca un contratto reale, e manca il credito Anthropic da cui `contract-worker` dipende |
| Clienti | `/clienti` | sì | — | sì | sì | sì | sì | Zefix (facoltativo) | l'abbinamento automatico non collega mai da solo: propone |
| Chiedi ad AI-Swisse | `/assistente` | sì | sì | sì | **sì** | sì | sì | Anthropic | `eval:assistant` chiudeva **15/16** con un caso diverso a ogni esecuzione; la causa era un difetto del **seed** (una versione dei termini duplicata, con l'errore scartato). ✅ **Rieseguita la sera del 2026-07-31 con `--runs 3`: 16/16, tutte e 48 le esecuzioni verdi.** ⚠️ Verde non vuol dire deterministico: su due casi l'ESITO cambia fra un giro e l'altro (vedi la sezione dedicata). Sola lettura, retention 180 giorni attiva |
| Incentivi | `/incentivi` | sì | sì | sì | sì | sì | sì | fonti ufficiali (7 siti) | dal 2026-07-31 `test:subsidy` copre su **database reale** le garanzie della 0032/0033/0034 **e il motore**: la sezione 11 esegue `runMatching`, la stessa funzione che chiama `subsidy-worker`. ⚠️ Restano scoperti l'**involucro HTTP** della Edge Function (segreto, budget di tempo) e il **percorso delle fonti** (`runSourceChecks`, che esce in rete). 7 revisioni del catalogo in attesa di una persona |

## I messaggi fermi dell'Inbox — 3 su 141, e non 11 su 124

Rimisurato interrogando il database la notte del **2026-08-01/02**. Il numero
scritto sopra fino a ieri — *11 su 124, fermi in `failed` senza ritentativo* —
**non descrive più niente**, e vale la pena dire perché, perché il perché è la
parte utile.

| Che cosa | 2026-07-31 | 2026-08-01, 23:44 |
|---|---|---|
| Messaggi acquisiti | 124 | **141** |
| In `failed` | 11 | **3** |
| Tasso | 8,9 % | **2,1 %** |
| Codici distinti | non raggruppati | **uno solo: `AI_CREDIT_EXHAUSTED`** |

**I tre sono tutti dello stesso gruppo**, e la diagnosi è una sola:

| `error_code` | N | Diagnosi | Ritentativo |
|---|---|---|---|
| `AI_CREDIT_EXHAUSTED` | 3 | **transitorio, d'ambiente** — e l'ambiente è ancora giù adesso | ha senso, e **c'è già** |

Tutti e tre hanno `relevance` e `classified_at` a **null**: sono caduti in
**classificazione**, non in analisi. Nessuno ha un documento collegato, nessuno
ha un'analisi. Due hanno solo corpo, uno ha due PDF in `pending`.

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
| Provider email (Resend) | implementato, **non configurato** — riverificato il 2026-08-01 | `NOTIFICATION_EMAIL_API_KEY` e `NOTIFICATION_EMAIL_FROM`: **assenti** dai 21 secret del progetto, controllati per NOME (il valore non è leggibile: la Management API restituisce lo SHA-256). Finché mancano, `deliverEmails` esce subito e **nessuna email può partire**: è una garanzia, non una svista. ✅ E la schermata lo **dichiara davvero** — non c'è nessun interruttore da accendere (§sotto) |

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

## Le tre suite che provano IL PROGETTO — eseguite il 2026-07-31

`npm run test:production -- --no-skip` → **VERDE**, 3 passi, 10,8 s. Non provano
il prodotto: provano *questo* progetto Supabase, ed è per questo che restano
manuali e si rifiutano di girare contro `127.0.0.1`.

| Suite | Esito | Che cosa ha verificato |
|---|---|---|
| `check:auth` | **4/4** | i link inviati per email portano a `https://app.ai-swisse.com`, il redirect richiesto è rispettato, e un URL estraneo **non** viene accettato (niente open redirect) |
| `subsidy:health` | **exit 0** | 7 programmi, tutti `verified` e attivi, contenuti tradotti de+fr 7/7, **0 errori di integrità**, **0 da ricontrollare** |
| `test:functions` | **12/12** | `generate-reply` e `interpret-project` **deployate**: 405, 401, 400, **403 cross-tenant**, 422, e il **429** del limite per azienda — tutti respinti prima della chiamata al modello, quindi senza spendere credito |

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

Le sette ci sono ancora, e sono tutte della stessa forma: `change_type =
program_metadata`, `risk_level = low`, una per ciascuno dei 7 programmi, tutte
del 2026-07-30, tutte con la stessa nota — *«Il contenuto della fonte è cambiato
(1 campi normalizzati diversi)»*. Non sono un arretrato di lavoro: sono sette
volte la stessa domanda, «la fonte ufficiale è cambiata: quel che diciamo è
ancora vero?», che nessun calcolo può chiudere.

Che cosa stampa adesso:

```
  Revisioni in attesa di una persona: 7 (la più vecchia da 2g, soglie: 30g · 25 in coda)

— In attesa di una persona —
  7 revisioni del catalogo in stato «pending», la più vecchia da 2 giorni.
  Nessun controllo automatico può chiuderle: contengono un giudizio, non un calcolo.

Esito: catalogo valido e aggiornato · 7 REVISIONI IN ATTESA DI UNA PERSONA (exit 0)
```

**La riga di esito non può più dire «catalogo valido e aggiornato» e basta**
mentre qualcosa aspetta: è il vincolo, ed è dove stava la bugia.

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
ma non concedibile, stato verificato 6 giorni fa. Concedibili 6 su 7.

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

## ⚠️ UN ROSSO APERTO: `test:assistant`, 3 asserzioni su 45

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

⚠️ **Non è stata applicata di proposito.** Applicare una migrazione cambia la
produzione: è una decisione, non un passaggio di un lavoro, e `CLAUDE.md` dice
che si chiede. Finché non viene applicata, questo rosso resta — **dichiarato,
non nascosto e non aggirato**: le tre controprove della stessa sezione (gruppo
senza `source_ids`, fonte singola *e* gruppo insieme, dimensione negativa) sono
verdi, quindi il vincolo vecchio funziona ancora come deve.

## Come si rimisura questa tabella

```bash
npm run test:all         # quality + unit + db
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
