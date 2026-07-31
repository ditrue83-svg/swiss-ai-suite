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

## ✅ IL CREDITO ANTHROPIC È STATO RIPRISTINATO (riverificato il 2026-07-31, la sera)

Questa sezione diceva il contrario fino a poche ore fa, e **la riga sbagliata è
sopravvissuta al ripristino**: il credito era stato ricaricato, il documento no.
Rimisurato chiamando l'API vera con la chiave di `.env.test`:

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

**Ripartono quindi**: analisi dei documenti (Admin AI), classificazione della
posta in arrivo, estrazione delle Finanze, `contract-worker`, interpretazione di
Subsidy AI, «Chiedi ad AI-Swisse».

✅ **Le tre valutazioni AI sono state rieseguite** la sera del 2026-07-31, tutte
verdi: `eval:assistant` **16/16**, `eval:admin` **35/35**, `eval:subsidy`
**14/14**. Dettaglio e limiti nella sezione dedicata più sotto.

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
| Inbox | `/inbox` | sì | sì | sì | sì | sì | **no** | Google Gmail API | scope riservato: fuori dalla modalità Test Google impone la verifica CASA, quindi **un cliente reale non può collegare la propria casella**. Microsoft implementato e non configurato. 11 messaggi su 124 fermi in `failed` senza ritentativo |
| Attività | `/attivita` | sì | — | sì | sì | — | sì | — | nessuna |
| Documenti | `/documenti` | sì | — | sì | sì | — | sì | — | nessuna politica di conservazione delle analisi |
| Calendario e notifiche | `/calendario` | sì | sì | sì | sì | **no** | **no** | Google/Microsoft Calendar, provider email | ⚠️ **i promemoria sono accesi dal 2026-07-31**, non prima: i due scheduler non esistevano e i secret non erano impostati. Dal 2026-07-31 li crea la **migrazione 0035** invece di un blocco SQL da incollare a mano, e il percorso è stato **provato dal capo alla coda** su un tenant tecnico (§sotto). Restano due cose: **nessuna email può partire** (`NOTIFICATION_EMAIL_API_KEY`/`_FROM` non configurati, `deliverEmails` esce subito) e **nessuna connessione OAuth reale è mai stata stabilita**, quindi la colonna «servizio reale» resta **no** |
| Automazioni | `/automazioni` | sì | sì | sì | sì | sì | sì | — | nessuna approvazione umana: solo azioni a rischio basso, e per questo non esiste nessuna azione che ne avrebbe bisogno. Le esecuzioni che non corrispondono non lasciano traccia |
| Finanze | `/finanze` | sì | sì | sì | sì | parziale | sì | — | il codice QR **binario** non viene decodificato; le aliquote storiche non ci sono; su 4 voci reali 2 sono `completed` e 2 `failed` con `NOT_FINANCIAL`, che è una classificazione corretta |
| Contratti | `/contratti` | sì | sì | sì | sì | **no** | parziale | — | ⚠️ **il worker non ha mai prodotto un'estrazione su un contratto vero**: `contract_extractions` è a zero. Il prompt è allineato a un ragionamento, non a una risposta reale |
| Clienti | `/clienti` | sì | — | sì | sì | sì | sì | Zefix (facoltativo) | l'abbinamento automatico non collega mai da solo: propone |
| Chiedi ad AI-Swisse | `/assistente` | sì | sì | sì | **sì** | sì | sì | Anthropic | `eval:assistant` chiudeva **15/16** con un caso diverso a ogni esecuzione; la causa era un difetto del **seed** (una versione dei termini duplicata, con l'errore scartato). ✅ **Rieseguita la sera del 2026-07-31 con `--runs 3`: 16/16, tutte e 48 le esecuzioni verdi.** ⚠️ Verde non vuol dire deterministico: su due casi l'ESITO cambia fra un giro e l'altro (vedi la sezione dedicata). Sola lettura, retention 180 giorni attiva |
| Incentivi | `/incentivi` | sì | sì | sì | sì | sì | sì | fonti ufficiali (7 siti) | dal 2026-07-31 `test:subsidy` copre su **database reale** le garanzie della 0032/0033/0034 **e il motore**: la sezione 11 esegue `runMatching`, la stessa funzione che chiama `subsidy-worker`. ⚠️ Restano scoperti l'**involucro HTTP** della Edge Function (segreto, budget di tempo) e il **percorso delle fonti** (`runSourceChecks`, che esce in rete). 7 revisioni del catalogo in attesa di una persona |

## Le integrazioni esterne

| Integrazione | Stato | Che cosa manca |
|---|---|---|
| Anthropic | in esercizio | — |
| Zefix / Registro IDI | in esercizio, provato contro l'API viva | l'UFRC sconsiglia le interrogazioni di massa: resta legata a un gesto |
| Google Gmail | in esercizio, una casella reale collegata | **verifica CASA**: oggi solo gli utenti di prova |
| Google Pub/Sub | implementato, **non attivato per scelta** | un account di fatturazione. Il cron a 15 minuti lo sostituisce |
| Microsoft Graph (posta) | implementato, non configurato | credenziali Entra. L'app lo **dichiara** invece di fallire |
| Google/Microsoft Calendar | implementato, **mai provato contro le API vive** | `GOOGLE_CALENDAR_CLIENT_ID`/`SECRET` espliciti |
| Provider email (Resend) | implementato, **non configurato** | `NOTIFICATION_EMAIL_API_KEY` e `NOTIFICATION_EMAIL_FROM`. Finché mancano, `deliverEmails` esce subito e **nessuna email può partire**: è una garanzia, non una svista |

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

⚠️⚠️ **`subsidy:health` verde NON vuol dire «niente in sospeso».** Esce 0 e
scrive «catalogo valido e aggiornato», ma guarda freschezza e integrità — **non
la coda di revisione**. Interrogando `subsidy_catalog_reviews`:

```
status = pending → 7   (tutte del 2026-07-30)
```

Le **sette revisioni in attesa di una persona ci sono ancora**, e nessun
controllo automatico le nomina. Chi legge solo l'esito della suite non le vede.

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

## Come si rimisura questa tabella

```bash
npm run test:all         # quality + unit + db
npm run verify:deploy    # scheduler ed Edge Function nel progetto reale (serve il token)
```

E le suite che **non** stanno in `test:all`, perché provano il progetto o
spendono credito — con i flag, che non sono facoltativi:

```bash
npm run test:production -- --no-skip          # check:auth · subsidy:health · test:functions
npm run check:auth -- https://app.ai-swisse.com   # ⚠️ senza argomento verifica localhost
npm run test:integration -- --allow-ai        # ⚠️ senza il flag esce 0 SENZA eseguire
npm run test:eval -- --allow-ai               # idem: eval assistant/admin/subsidy
```

⚠️⚠️ **DUE MODI DI OTTENERE UN VERDE CHE NON VALE NIENTE, incontrati entrambi il
2026-07-31 mentre si rimisurava questa tabella:**

1. **`test:integration` / `test:eval` senza `--allow-ai`** escono **0 in un
   millisecondo** senza eseguire un solo passo, stampando
   `ESITO: verde sui gruppi eseguiti · 1 SALTATI`. Il salto è dichiarato — ma
   uscita zero e la parola «verde» sulla stessa riga bastano a far scrivere un
   risultato inesistente. `--no-skip` trasforma il salto in un rosso.
2. **`check:auth` senza argomento** verifica `http://localhost:5174` e passa,
   dicendo che i link porteranno lì. È un verde su un'altra domanda: il dominio
   che conta va passato a mano.

⚠️ **Un esito verde non copre ciò che la suite non guarda.** `subsidy:health`
esce 0 con «catalogo valido e aggiornato» mentre **sette revisioni aspettano una
persona** in `subsidy_catalog_reviews`: nessun controllo automatico le nomina.

⚠️ **Nessuna riga va aggiornata da un commit message o da un ricordo.** Un
numero di test scritto in un messaggio di commit descrive l'albero di quel
momento; questa tabella descrive quello di adesso, e l'unico modo di saperlo è
eseguire.
