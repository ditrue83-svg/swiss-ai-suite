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

## ⚠️⚠️ IL CREDITO ANTHROPIC È ESAURITO (verificato il 2026-07-31)

Ogni chiamata all'API risponde **400 — «Your credit balance is too low»**, e
l'impronta della chiave in `.env.test` **coincide con quella del secret
`ANTHROPIC_API_KEY` delle Edge Function**: è la stessa chiave. Quindi non è un
problema dei soli test.

**Fermo adesso in produzione**: analisi dei documenti (Admin AI), classificazione
della posta in arrivo, estrazione delle Finanze, `contract-worker`,
interpretazione di Subsidy AI, «Chiedi ad AI-Swisse». Il prodotto **lo dichiara**
invece di fingere un guasto temporaneo (commit `dd7b2e0`), ma resta fermo.

Conseguenza per questa tabella: le colonne «testato» e «servizio reale» dei
moduli che dipendono dall'AI descrivono l'ultima misura riuscita, non una
misura di oggi. `test:integration` e `test:eval` **non sono eseguibili** finché
il credito non viene ricaricato.

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
| Chiedi ad AI-Swisse | `/assistente` | sì | sì | sì | parziale | sì | sì | Anthropic | ⚠️ `eval:assistant` chiudeva **15/16** con un caso diverso a ogni esecuzione. La causa era un difetto del **seed** (una versione dei termini duplicata, con l'errore scartato), corretta il 2026-07-31 e verificata contro il database vero; l'asserzione sull'ancoraggio è ora una funzione pura provata offline. ⚠️ **L'eval NON è stata rieseguita**: credito esaurito. Sola lettura, retention 180 giorni attiva |
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

## Come si rimisura questa tabella

```bash
npm run test:all         # quality + unit + db
npm run verify:deploy    # scheduler ed Edge Function nel progetto reale
```

⚠️ **Nessuna riga va aggiornata da un commit message o da un ricordo.** Un
numero di test scritto in un messaggio di commit descrive l'albero di quel
momento; questa tabella descrive quello di adesso, e l'unico modo di saperlo è
eseguire.
