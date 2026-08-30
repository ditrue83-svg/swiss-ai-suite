# Inbox — architettura, configurazione, esercizio

L'Inbox collega la casella aziendale (Google Workspace o Microsoft 365) e
individua le comunicazioni che possono richiedere attenzione. **Non è un client
di posta**: non invia, non risponde, non archivia, non modifica nulla nella
casella. È il punto d'ingresso da cui una comunicazione amministrativa diventa
un documento AI-Swisse e passa dalla pipeline Admin AI già esistente.

Dal CRM esiste un invio separato (0048): non cambia questo contratto. Gmail e
Microsoft restano con scope `readonly`/`Mail.Read`; il CRM usa il provider
transazionale configurato per l'installazione (Resend), mai Gmail API. Se il
provider non è configurato la funzione risponde esplicitamente **non
disponibile**, senza tentare un invio.

> **Stato al 2026-07-27.** **Attiva con Google**: le Edge Function sono
> deployate, una casella Gmail reale è collegata e la posta viene importata,
> classificata e analizzata. Microsoft non è configurato e l'applicazione lo
> dichiara («questo fornitore non è configurato su questo server»).
> Lo **scheduler della manutenzione è attivo** (pg_cron, ogni 15 minuti) e
> verificato in esercizio. Restano da fare: le notifiche push via Pub/Sub (4.4,
> richiede un account di fatturazione su Google Cloud — **rimandate per scelta**,
> perché senza push l'attesa massima è un quarto d'ora e le comunicazioni
> amministrative hanno termini che si misurano in settimane) e la verifica CASA
> dell'app Google, senza la quale possono collegarsi solo gli utenti di prova.
> Vedi «Cosa manca per andare in produzione» in fondo.

---

## 1. Architettura

```
Provider (Gmail / Microsoft Graph)
   │
   ├─ push  →  email-webhook  ──┐        notifica: «qualcosa è cambiato»
   │                            │        (mai il contenuto)
   ├─ cron  →  email-maintenance┤ ──→  email-sync
   │            rinnovi + riconciliazione   │
   └─ utente →  «Sincronizza»  ──┘         │
                                            ▼
                              adapter provider (google.ts / microsoft.ts)
                                            │
                                            ▼
                              NormalizedEmailMessage  ← modello unico
                                            │
                    ┌───────────────────────┼───────────────────────┐
                    ▼                       ▼                       ▼
              email_messages         email_attachments     pre-classificazione
              (testo, mai HTML)      (metadati sempre,     deterministica
                    │                 file solo se serve)   (costo zero)
                    │                       │                       │
                    │                       │                       ▼
                    │                       │              classificazione AI
                    │                       │              (solo se serve)
                    │                       │                       │
                    └───────────┬───────────┘                       │
                                ▼                                   │
                          documents  ←──────────────────────────────┘
                     (source_type = 'email')      solo likely_actionable
                                │
                                ▼
                    pipeline Admin AI esistente
                    (_shared/pipeline.ts — la stessa del caricamento manuale)
                                │
                                ▼
                        document_analyses
                                │
                                ▼
                    Inbox · dettaglio «Cosa richiede attenzione»
```

**Il punto architetturale principale**: non esiste una seconda pipeline AI. Una
email amministrativamente rilevante diventa una riga in `documents` — con il suo
file in Storage privato, il suo hash, la sua estrazione — e da lì in avanti è
indistinguibile da un documento caricato a mano. Le citazioni restano
verificabili, l'analisi resta immutabile, l'archivio la mostra come qualunque
altro documento.

### Moduli

| File | Ruolo |
|---|---|
| `_shared/email/types.ts` | Modello normalizzato + contratto `EmailProviderAdapter` |
| `_shared/email/html.ts` | HTML non fidato → testo (tokenizzatore, non regex) |
| `_shared/email/normalize.ts` | Oggetto, indirizzi, corpo, storico citato, header |
| `_shared/email/classify.ts` | Pre-classificazione deterministica, conservativa |
| `_shared/email/classifyPrompt.ts` | Prompt e validazione della classificazione AI |
| `_shared/email/attachments.ts` | Politica sugli allegati, riconoscimento dai byte |
| `_shared/email/crypto.ts` | AES-256-GCM, PKCE, confronti a tempo costante |
| `_shared/email/http.ts` | Timeout, errori tipizzati, backoff con jitter |
| `_shared/email/google.ts` | Adapter Gmail |
| `_shared/email/microsoft.ts` | Adapter Microsoft Graph |
| `_shared/email/store.ts` | Persistenza (service role) |
| `_shared/email/sync.ts` | Orchestrazione della sincronizzazione |
| `_shared/email/contract.ts` | Valori enum e limiti condivisi |
| `_shared/email/runtime.ts` | Collante Deno (l'unico file che legge l'ambiente) |
| `_shared/extract.ts` | Trascrizione OCR, **condivisa con `analyze-document`** |

I primi tredici sono **portabili**: nessuna API Deno, testabili in Node.

### Edge Functions

| Funzione | Chiamante | JWT |
|---|---|---|
| `email-oauth/start` · `/providers` | applicazione, utente autenticato | sì (nel codice) |
| `email-oauth/callback` | browser di ritorno dal provider | no — protetto dallo `state` |
| `email-sync` | utente, oppure sistema con service role | sì |
| `email-webhook/google` · `/microsoft` | Google Pub/Sub, Microsoft Graph | no — autenticati nel codice |
| `email-disconnect` | utente amministratore | sì |
| `email-maintenance` | scheduler | no — segreto dedicato |

---

## 2. Modello dei dati (migrazioni 0013 e 0014)

| Tabella | Contenuto | Accesso del client |
|---|---|---|
| `email_connections` | casella collegata, stato, cursore | `select` su **colonne selezionate** |
| `email_connection_secrets` | token OAuth cifrati | **nessuno** |
| `email_oauth_states` | stato OAuth monouso | **nessuno** |
| `email_messages` | messaggio normalizzato (testo, mai HTML) | `select`; `update` su `seen_at` e `attention_status` |
| `email_attachments` | metadati di **tutti** gli allegati, importati o no | `select` |
| `email_message_documents` | relazione email ↔ documento | `select` |
| `email_sync_runs` | audit tecnico della sincronizzazione | `select` solo owner/admin |
| `email_webhook_events` | impronte per l'idempotenza | **nessuno** |
| `email_audit_log` | chi ha collegato/scollegato | `select` solo owner/admin |

> ⚠️ **I permessi restrittivi arrivano dalla 0014, non dalla 0013.** La 0013 concedeva
> `grant select (colonne…)` credendo di restringere: un GRANT però *aggiunge* privilegi, e su
> Supabase ogni tabella nuova di `public` nasce già con i permessi di TABELLA completi per
> `anon` e `authenticated` (effetto di `alter default privileges … grant all on tables`). Risultato
> misurato sul database reale: un membro poteva eseguire
> `update email_messages set subject = …, body_text = …, relevance = …` sui messaggi della propria
> azienda. La 0014 fa `revoke all` **prima** di concedere, e verifica il risultato in migrazione.
>
> **Regola per ogni tabella futura di questo progetto**: un permesso di colonna non significa nulla
> senza un `revoke all` che lo preceda.

Enum separati per stati che descrivono cose diverse: `email_processing_status`
(dove è arrivata la macchina), `email_attention_status` (cosa deve fare una
persona), `email_relevance` (cosa ha concluso il classificatore).

**Indici** su `(company_id, received_at desc, id desc)` per la paginazione a
cursore, `(company_id, attention_status, received_at desc, id desc)` per i
filtri, GIN trigram su `search_text` per la ricerca, indici parziali per il
lavoro in sospeso e per le scadenze.

---

## 3. Sicurezza

### Dove vivono i token

In `email_connection_secrets`, **cifrati con AES-256-GCM**. La chiave è un
secret della Edge Function (`EMAIL_TOKEN_KEY`) e non sta nel database.

Chi può arrivarci:

| Soggetto | Esito |
|---|---|
| Browser / chiave anon | **No.** Nessun `GRANT` e RLS senza policy: PostgREST risponde `42501`. |
| Membro autenticato, anche owner | **No.** Identico al caso sopra. |
| Chi ottiene un dump del database | **Non basta.** I token sono cifrati e la chiave è altrove. |
| Chi ha service role **e** `EMAIL_TOKEN_KEY` | **Sì.** Limite dichiarato: vale già oggi per l'intero database. |

L'AAD della cifratura è l'id della connessione: un ciphertext spostato su
un'altra riga non si decifra. Chi potesse scrivere nel database non potrebbe
assegnarsi i token di un'altra azienda.

### Scope OAuth richiesti

| Provider | Scope | Cosa consente |
|---|---|---|
| Google | `openid` | identità stabile dell'account (`sub`) |
| Google | `https://www.googleapis.com/auth/gmail.readonly` | leggere messaggi e allegati |
| Microsoft | `offline_access` | ottenere il refresh token |
| Microsoft | `User.Read` | identità stabile dell'account |
| Microsoft | `Mail.Read` | leggere la casella dell'utente collegato |

Nessuno scope di invio, modifica, etichettatura o cancellazione. Il vincolo vive
nel token, non nella nostra disciplina: anche un errore di programmazione non
potrebbe modificare la casella. Il contratto `EmailProviderAdapter` non contiene
alcun metodo di scrittura, e un test lo verifica.

### Validazione dei webhook

**Google.** Il messaggio Pub/Sub arriva con un token OIDC firmato da Google. Si
verifica la **firma** (RS256 contro `https://www.googleapis.com/oauth2/v3/certs`,
con cache di un'ora), l'emittente, la scadenza e — se configurato — l'indirizzo
del service account autorizzato. In più, un segreto nella query string fa da
primo filtro. `alg: none` e algoritmi simmetrici sono rifiutati esplicitamente.

**Microsoft.** Ogni notifica riporta il `clientState` concordato alla creazione
della sottoscrizione: un segreto per connessione, confrontato **a tempo
costante**. La validazione iniziale (`validationToken`) risponde in testo
semplice, con limite di lunghezza, e non produce alcun effetto.

In entrambi i casi la notifica dice soltanto «qualcosa è cambiato»: il contenuto
si va a leggere dal provider, autenticati. Una notifica falsa provoca al più una
sincronizzazione a vuoto.

### Isolamento fra aziende

Ogni tabella ha RLS con `is_company_member` / `is_company_admin`, come dal 0001.
Le Edge Function usano la service role per scrivere, ma **verificano
l'autorizzazione con il client dell'utente** prima di farlo — la stessa
disciplina di `analyze-document` dalla 0010 — e ogni query filtra
esplicitamente per `company_id`. `npm run test:inbox` verifica che A non veda,
non legga e non modifichi nulla di B.

### Render del contenuto

**L'HTML del provider non viene conservato.** Il corpo viene ridotto a testo
server-side da un tokenizzatore che scarta script, stile, gestori di evento,
iframe e risorse remote; i collegamenti vengono estratti a parte con la loro
destinazione reale. Conseguenze:

- non esiste HTML non fidato da sanificare al momento del render, quindi non
  esiste il bug in cui la sanificazione viene dimenticata;
- nessuna immagine remota può essere caricata, perché nessuna è stata
  conservata: il pixel di tracciamento non parte, e la privacy non dipende da
  un'opzione lasciata spenta;
- nell'interfaccia non compare `dangerouslySetInnerHTML`.

Il prezzo è che la posta non si vede impaginata. In una Inbox che serve a
decidere cosa richiede attenzione, è un prezzo che vale la pena pagare.

---

## 4. Configurazione — Google Cloud Console

Passaggi esatti. Servono un progetto Google Cloud e un account con i permessi
per crearne le credenziali.

### 4.1 Progetto e API

1. [console.cloud.google.com](https://console.cloud.google.com) → crea (o
   seleziona) un progetto, per esempio `ai-swisse-inbox`.
2. **API e servizi → Libreria** → abilita **Gmail API**.
3. Nella stessa libreria → abilita **Cloud Pub/Sub API**.

### 4.2 Schermata di consenso OAuth

4. **API e servizi → Schermata consenso OAuth**.
5. Tipo di utente: **Esterno** (a meno che tutte le caselle siano nello stesso
   Workspace: in quel caso **Interno**, e non serve la verifica).
6. Nome dell'app: `AI-Swisse`. Email di assistenza e di contatto: la tua.
7. Dominio autorizzato: `ai-swisse.com`.
8. **Ambiti** → aggiungi `https://www.googleapis.com/auth/gmail.readonly`.
   Non aggiungerne altri.
9. **Utenti di test**: finché l'app è in «Test», solo gli indirizzi elencati qui
   possono collegarsi. Aggiungi il tuo.

> ⚠️ `gmail.readonly` è uno scope **sensibile e riservato**. Per superare la
> modalità «Test» e collegare caselle di clienti reali, Google richiede una
> verifica dell'app che include una **valutazione di sicurezza da parte di terzi
> (CASA)**, con costi e tempi propri. Fino ad allora l'Inbox funziona
> esattamente com'è, ma solo sugli indirizzi aggiunti come utenti di test. È il
> vincolo esterno più rilevante di tutta la funzione: vedi «Cosa manca».

### 4.3 Credenziali OAuth

10. **API e servizi → Credenziali → Crea credenziali → ID client OAuth**.
11. Tipo: **Applicazione web**. Nome: `AI-Swisse Inbox`.
12. **URI di reindirizzamento autorizzati** — esattamente questo, senza barra
    finale:
    ```
    https://tcjmagaqktmzijbfntvy.supabase.co/functions/v1/email-oauth/callback
    ```
13. Annota **ID client** e **Client secret**: diventeranno `GOOGLE_CLIENT_ID` e
    `GOOGLE_CLIENT_SECRET`.

### 4.4 Pub/Sub per le notifiche push

14. **Pub/Sub → Argomenti → Crea argomento**, id `ai-swisse-inbox`. Il nome
    completo (`projects/<PROGETTO>/topics/ai-swisse-inbox`) sarà
    `GOOGLE_PUBSUB_TOPIC`.
15. Sull'argomento → **Autorizzazioni → Aggiungi entità**:
    - entità: `gmail-api-push@system.gserviceaccount.com`
    - ruolo: **Publisher Pub/Sub**

    Senza questo passaggio `users.watch` fallisce: è Gmail a dover poter
    pubblicare sul tuo argomento.
16. **Pub/Sub → Sottoscrizioni → Crea sottoscrizione**:
    - argomento: quello appena creato
    - tipo di consegna: **Push**
    - endpoint:
      ```
      https://tcjmagaqktmzijbfntvy.supabase.co/functions/v1/email-webhook/google?token=<GOOGLE_PUBSUB_VERIFICATION_TOKEN>
      ```
      dove `<GOOGLE_PUBSUB_VERIFICATION_TOKEN>` è un valore casuale che genererai
      al punto 5.1 e che imposterai come secret con lo stesso nome.
    - **Abilita autenticazione**: sì. Scegli o crea un service account (per
      esempio `pubsub-push@<progetto>.iam.gserviceaccount.com`) e annota il suo
      indirizzo: diventerà `GOOGLE_PUBSUB_SERVICE_ACCOUNT`.
    - scadenza della sottoscrizione: **mai** (altrimenti smette di funzionare da
      sola dopo 31 giorni).
    - termine di conferma: 60 secondi.

---

## 5. Configurazione — Microsoft Entra ID

1. [entra.microsoft.com](https://entra.microsoft.com) → **Applicazioni →
   Registrazioni app → Nuova registrazione**.
2. Nome: `AI-Swisse Inbox`.
3. Tipi di account supportati: **Account in qualsiasi directory organizzativa
   (multi-tenant)** se vuoi collegare clienti diversi; **solo questa directory**
   se la userai per una sola organizzazione. Questa scelta determina
   `MICROSOFT_TENANT` (`common` per multi-tenant, l'id del tenant altrimenti).
4. **URI di reindirizzamento** → piattaforma **Web** →
   ```
   https://tcjmagaqktmzijbfntvy.supabase.co/functions/v1/email-oauth/callback
   ```
5. Dopo la creazione annota **ID applicazione (client)** → `MICROSOFT_CLIENT_ID`.
6. **Certificati e segreti → Nuovo segreto client**. Scadenza: 24 mesi (segna in
   agenda quando scade: alla scadenza le connessioni smettono di rinnovarsi).
   Copia il **valore** — non l'id — in `MICROSOFT_CLIENT_SECRET`.
7. **Autorizzazioni API → Aggiungi autorizzazione → Microsoft Graph →
   Autorizzazioni delegate**: `Mail.Read`, `User.Read`, `offline_access`.
   Nessun'altra.
8. Se colleghi caselle di un'organizzazione che non amministri, l'amministratore
   di quel tenant dovrà concedere il consenso.

> Microsoft non espone un endpoint per revocare il consenso di una singola
> applicazione dall'esterno. Allo scollegamento AI-Swisse elimina i token e la
> sottoscrizione, e la schermata dice all'utente che il permesso resta
> registrato nel suo account Microsoft e dove rimuoverlo. È un limite
> dichiarato, non una revoca simulata.

---

## 6. Configurazione — Supabase

### 6.1 Genera la chiave di cifratura dei token

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Conservala: se la perdi, le connessioni esistenti non si decifrano più e vanno
ricollegate (l'applicazione lo dichiara con «connessione da rinnovare», non
fallisce in silenzio).

Genera anche due segreti casuali per il webhook Google e per la manutenzione:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

### 6.2 Applica la migrazione

Dal **SQL editor** del dashboard, incolla ed esegui **in ordine**:

1. `supabase/migrations/0013_inbox.sql` — schema, RLS, indici, funzioni
2. `supabase/migrations/0014_inbox_grants.sql` — permessi restrittivi

Entrambe sono idempotenti. La 0014 si autoverifica in fondo: se trovasse ancora un permesso di
scrittura inatteso su `email_messages`, o un qualunque permesso sulle tabelle di servizio, solleva
un'eccezione e la transazione non passa. In esito positivo stampa
`NOTICE: Permessi Inbox verificati: il verbale non è riscrivibile dal client.`

Verifica subito dopo:

```bash
npm run test:inbox
```

### 6.3 Imposta i secret delle Edge Function

Dashboard → **Edge Functions → Secrets**, oppure da CLI:

```bash
npx supabase secrets set --project-ref tcjmagaqktmzijbfntvy \
  EMAIL_TOKEN_KEY='<base64 di 32 byte>' \
  APP_PUBLIC_URL='https://app.ai-swisse.com' \
  GOOGLE_CLIENT_ID='<id client>' \
  GOOGLE_CLIENT_SECRET='<client secret>' \
  GOOGLE_PUBSUB_TOPIC='projects/<progetto>/topics/ai-swisse-inbox' \
  GOOGLE_PUBSUB_VERIFICATION_TOKEN='<segreto casuale>' \
  GOOGLE_PUBSUB_SERVICE_ACCOUNT='pubsub-push@<progetto>.iam.gserviceaccount.com' \
  MICROSOFT_CLIENT_ID='<id applicazione>' \
  MICROSOFT_CLIENT_SECRET='<valore del segreto>' \
  MICROSOFT_TENANT='common' \
  INBOX_MAINTENANCE_SECRET='<segreto casuale>'
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e
`ANTHROPIC_API_KEY` esistono già.

Se un provider non viene configurato, l'applicazione lo dice: non mostra un
pulsante che porta a un errore. Si può quindi partire con il solo Google.

### 6.4 Deploy delle Edge Function

```bash
npx supabase functions deploy analyze-document --project-ref tcjmagaqktmzijbfntvy
npx supabase functions deploy email-sync       --project-ref tcjmagaqktmzijbfntvy
npx supabase functions deploy email-disconnect --project-ref tcjmagaqktmzijbfntvy
npx supabase functions deploy email-oauth      --project-ref tcjmagaqktmzijbfntvy --no-verify-jwt
npx supabase functions deploy email-webhook    --project-ref tcjmagaqktmzijbfntvy --no-verify-jwt
npx supabase functions deploy email-maintenance --project-ref tcjmagaqktmzijbfntvy --no-verify-jwt
```

> ⚠️ **`analyze-document` va rideployata**: la trascrizione OCR è stata spostata
> in `_shared/extract.ts` per condividerla con l'Inbox. Il comportamento è
> identico, ma la funzione deployata importa ora da un modulo nuovo.

> ⚠️ **`--no-verify-jwt` sulle tre funzioni indicate.** Senza, Supabase respinge
> i webhook con 401 prima che il codice li veda: le notifiche in tempo reale
> smettono di arrivare e nessun errore compare nell'applicazione, perché la
> riconciliazione periodica continua a funzionare. È un guasto silenzioso, ed è
> proprio il tipo di guasto che questo progetto cerca di non avere.

### 6.5 Manutenzione periodica

`email-maintenance` rinnova le sottoscrizioni push in scadenza, recupera i
lavori interrotti, riconcilia le caselle silenziose, smaltisce un lotto della
coda di analisi e ripulisce ciò che non serve più.

**Cadenza: ogni 15 minuti** (`*/15 * * * *`) sul progetto reale dal 2026-07-27.
Ogni ora basterebbe per la manutenzione in sé, ma senza le notifiche push la
cadenza dello scheduler È il tempo di risposta della Inbox: a un quarto d'ora
l'attesa media scende da mezz'ora a sette minuti. Un'esecuzione senza lavoro da
fare dura pochi secondi e non chiama nessun provider, quindi il costo di
guardare più spesso è trascurabile.

**Recupero dei lavori interrotti.** Un'Edge Function che supera il proprio tempo
massimo viene uccisa e il suo `finally` non gira: restano un messaggio in
`analyzing` e una sincronizzazione in `running` che nessun'altra parte del
sistema ripesca. Uno stato appeso è indistinguibile da un lavoro in corso —
cioè è un guasto che si presenta come normalità. Oltre
`STALE_PROCESSING_MINUTES` (30 minuti, molto più del lease di 5):

- un messaggio già riconosciuto come azionabile e interrotto durante
  importazione o analisi torna **in coda** (`awaiting_analysis`), perché
  riprenderlo è sicuro: l'analisi riparte dal documento già creato;
- tutto il resto diventa `failed` con codice **`INTERRUPTED`**, distinto da
  `ANALYSIS_FAILED` perché la persona può ancora premere «Analizza»;
- le sincronizzazioni rimaste `running` vengono chiuse come `failed`
  / `INTERRUPTED`, con `duration_ms` **vuoto**: quanto siano durate prima di
  morire non lo sappiamo, e un numero inventato in un registro diagnostico è
  peggio di un campo vuoto.

Il ritentativo è **uno solo**: `error_code` resta `INTERRUPTED` mentre il
messaggio è in coda, quindi una seconda interruzione lo trova già marcato e lo
ferma. Un'analisi che si interrompe sempre non può diventare una spesa
ricorrente. Al successo la pipeline azzera il codice: la traccia sparisce da sé.

### Ripescaggio delle CLASSIFICAZIONI cadute (`drainPendingClassifications`)

⚠️ **Fino al 2026-07-31 un messaggio chiuso come `failed` non lo riprendeva
nessuno**, e il buco era esattamente fra due meccanismi che facevano ciascuno
il proprio mestiere: `processMessage` salta i messaggi già acquisiti
(`if (!upserted.isNew) return`) e `recoverInterrupted` guarda solo gli stati *in
lavorazione*. Un messaggio caduto in classificazione non era né l'uno né
l'altro. Misura del 2026-07-31: **sedici messaggi mai classificati**, tredici
dei quali caduti mentre il credito Anthropic era esaurito — cioè per una ragione
che si era già risolta da sola.

`drainPendingClassifications` (in `_shared/email/sync.ts`, chiamata da
`email-maintenance` a ogni esecuzione) ripesca i messaggi `failed` che hanno
`relevance is null` e un `error_code` **d'ambiente**. Non è un meccanismo nuovo:
è la stessa forma che `drainPendingAnalyses` usa da mesi per `failed` +
`PROVIDER_RATE_LIMITED`.

| Codice | Si riprende? | Perché |
|---|---|---|
| `AI_CREDIT_EXHAUSTED` | **sì** | l'ambiente torna a posto da solo. Non consuma il tentativo: non è il messaggio a essere sbagliato |
| `PROVIDER_RATE_LIMITED` · `PROVIDER_UNAVAILABLE` | **sì** | idem |
| `INTERRUPTED` | **sì**, una volta | l'esecuzione non è arrivata in fondo |
| `INVALID_RESPONSE` | **sì, UNA volta sola** | la risposta del modello varia: un secondo tentativo è il rimedio normale a un formattatore non deterministico. Due risposte illeggibili di fila → `CLASSIFY_FAILED`, terminale |
| `CLASSIFY_FAILED` · `AI_OUTPUT_TRUNCATED` | **no** | il secchio del «non lo sappiamo» e il tetto di token: nessuno dei due si alza da solo, e riprovarli all'infinito brucia credito in silenzio |

Il conteggio del ritentativo non ha una colonna nuova: lo porta il codice
stesso (`codeAfterRetry`), come già fa `INTERRUPTED`. E si riprendono **solo** i
messaggi mai classificati: uno che una `relevance` ce l'ha è già passato di là,
e riclassificarlo cancellerebbe un giudizio già dato.

⚠️ **Il ciclo non è a costo zero, ma il costo è misurato.** Con il credito
esaurito ogni esecuzione tenta il messaggio più recente, riceve `400` — che
Anthropic restituisce **prima** di far ragionare il modello, quindi **zero
token** — e si ferma lì, perché se l'ambiente rifiuta uno rifiuterà anche gli
altri. Resta una chiamata al provider di posta ogni quindici minuti.

Non è configurata automaticamente dalla migrazione, di proposito: richiederebbe
di mettere un segreto dentro il database. Due modi:

**A — pg_cron + pg_net con il segreto nel Vault** (tutto dentro Supabase):

```sql
-- Una volta sola: estensioni e segreto.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;
select vault.create_secret('<INBOX_MAINTENANCE_SECRET>', 'inbox_maintenance_secret');

select cron.schedule(
  'inbox-maintenance',
  '*/15 * * * *',                    -- ogni quarto d'ora
  $$
  select net.http_post(
    url     := 'https://tcjmagaqktmzijbfntvy.supabase.co/functions/v1/email-maintenance',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-inbox-maintenance-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'inbox_maintenance_secret')
    ),
    body    := '{}'::jsonb,
    -- ⚠️ NON FACOLTATIVO. `pg_net` chiude la connessione dopo 5 secondi
    -- predefiniti: la manutenzione ne dura ottanta, e senza questa riga OGNI
    -- esecuzione risulterebbe fallita. Il job in esercizio ce l'ha; questo
    -- riquadro l'ha omesso fino al 2026-07-31, e chi avesse ricreato lo
    -- scheduler copiandolo avrebbe riprodotto la trappola già pagata una volta.
    timeout_milliseconds := 150000
  );
  $$
);
```

**B — uno scheduler esterno** (GitHub Actions, cron di un server) che esegue:

```bash
curl -fsS -X POST \
  -H "x-inbox-maintenance-secret: $INBOX_MAINTENANCE_SECRET" \
  -H 'Content-Type: application/json' -d '{}' \
  https://tcjmagaqktmzijbfntvy.supabase.co/functions/v1/email-maintenance
```

Il job è idempotente: eseguirlo più volte non fa danni. Se non viene configurato,
le notifiche push smettono di arrivare dopo qualche giorno (Gmail: 7 giorni;
Graph: ~3) e la posta si aggiorna solo con il pulsante «Sincronizza».

---

## 7. Comportamento: cosa viene analizzato e quando

| Esito della classificazione | Analisi automatica | Dove compare |
|---|---|---|
| `likely_actionable` | **Sì** — importa gli allegati e analizza | «Da gestire» |
| `possibly_actionable` | No — su richiesta, con «Analizza» | «Da verificare» |
| `informational` | No | «Tutte» |
| `clearly_irrelevant` | No | «Tutte», etichettata «Non amministrativa» |

Prima della classificazione AI c'è un filtro **deterministico e gratuito**, che
si ferma solo quando **tutti** i segnali concordano: posta di massa **e** nessun
indizio amministrativo (mittente non istituzionale, nessun allegato trattabile,
nessun numero di riferimento, non insieme importo e data, mittente mai visto
prima). Basta un solo indizio perché il messaggio prosegua: un falso negativo
amministrativo costa molto più di un falso positivo.

**Limiti di importazione**, dichiarati anche nell'interfaccia:

| Costante | Valore | Dove |
|---|---|---|
| Finestra del primo import | 30 giorni | `contract.ts` |
| Messaggi al primo import | 80 | `contract.ts` |
| Messaggi per sincronizzazione incrementale | 50 | `contract.ts` |
| Finestra di riconciliazione | 72 ore | `contract.ts` |
| Allegato massimo | 15 MB | allineato al bucket (0009) |
| Allegati per messaggio | 10 | `contract.ts` |
| Quota AI: classificazione | 30/minuto per azienda | `sync.ts` |
| Quota AI: analisi | 12/minuto per azienda | `sync.ts` |

Il consumo è tracciato in `ai_request_log` con `kind = 'inbox_classification'` e
`'inbox_analysis'`, accanto a quello esistente.

### Allegati o corpo?

Se c'è un PDF principale si analizza **quello**: le citazioni devono restare
verificabili contro il documento da cui provengono. Se non c'è, la richiesta è
nel corpo, e il corpo diventa un documento vero — con file in Storage, hash e
pipeline standard. Le due fonti non vengono mai mescolate in uno stesso snapshot.

### Deduplicazione

Se lo stesso PDF era già stato caricato a mano, o arriva in due email, non si
crea un secondo documento: si riusa quello esistente (hash per azienda, indice
della 0006). **La relazione con il nuovo messaggio viene comunque scritta**:
deduplicare il documento non fa perdere la provenienza.

### Ripresa di un'analisi interrotta

L'analisi può fermarsi **dopo** che il documento è stato creato: la quota si
esaurisce fra la creazione e la chiamata al modello, oppure l'esecuzione viene
uccisa a metà. Al ritentativo il documento c'è già, e va **analizzato**.

`planAnalysisTarget` (in `_shared/email/sync.ts`, funzione pura) decide cosa
analizzare, in quest'ordine:

| Situazione | Decisione |
|---|---|
| Allegato appena importato che merita l'analisi | si analizza quello |
| Documento già collegato, mai analizzato | **si riprende**: byte riletti dallo Storage |
| Documento già collegato e già analizzato | non si rianalizza, non si spende |
| Documento collegato il cui file non si scarica | guasto dichiarato (`ANALYSIS_FAILED`) |
| Nessun documento e corpo con contenuto | si crea il documento dal corpo |
| Nessun documento e corpo troppo breve | si dichiara che non c'era nulla da analizzare |

⚠️ **Perché è una funzione a parte, e perché ha i suoi test.** Fino al
2026-07-27 il codice chiedeva soltanto «esiste già un documento per questo
messaggio?» e, trovandolo, usciva senza fare nulla: il chiamante interpretava
quell'uscita come «niente da analizzare» e marcava il messaggio **`done`**.
Sul database di produzione c'erano **quattordici messaggi** in esattamente
quella condizione — documento in archivio, nessuna analisi — e allo smaltimento
successivo sarebbero passati a «fatto» senza che nessuno li leggesse. La coda si
sarebbe svuotata da sola, con «Da gestire» pulito e quattordici comunicazioni
amministrative mai lette: un fallimento che si presenta come successo.
I casi della tabella sono nella sezione 9 di `npm run test:inbox-unit`, e il
primo è quello che il codice precedente **non** superava.

Si rileggono i byte **dallo Storage** e non si ricostruisce il testo dal
messaggio: presso il provider il contenuto può essere cambiato (§117), e
analizzare qualcosa di diverso da ciò che è archiviato produrrebbe citazioni
che nel documento mostrato all'utente non si ritrovano.

---

## 8. Sviluppo locale

I webhook pubblici non raggiungono `localhost`. Tre strade, in ordine di
preferenza:

1. **Deployare le funzioni sul progetto reale e usare l'app in locale.** Il
   frontend su `localhost:5174` chiama le Edge Function deployate; i webhook
   arrivano al progetto Supabase, non alla tua macchina. È il modo più semplice
   e non richiede tunnel. `APP_PUBLIC_URL` resta il dominio di produzione, quindi
   il callback OAuth rimanda là: per provare il flusso completo in locale serve
   un secondo progetto Supabase di staging.

2. **Un progetto Supabase di staging** con i suoi secret, la sua app registrata
   su Google/Microsoft (con il redirect di staging) e `APP_PUBLIC_URL` puntato a
   `http://localhost:5174`. È la strada corretta per lavorare sul flusso di
   consenso.

3. **Un tunnel** (`cloudflared`, `ngrok`, quello che preferisci) verso
   `supabase functions serve`. Nessun tunnel è richiesto dal runtime né
   configurato nel progetto: resta una scelta di chi sviluppa.

La maggior parte della logica non ha bisogno di nulla di tutto questo:

```bash
npm run test:inbox-unit    # 148 asserzioni, nessuna rete, nessuna credenziale
```

---

## 9. Diagnostica

**«Questa casella non si aggiorna.»** In ordine:

1. `email_connections.status` — `reauth_required` significa consenso revocato o
   password cambiata: l'utente deve ricollegare.
2. `email_connections.watch_expires_at` — se è passata, il rinnovo non gira:
   controlla che `email-maintenance` venga richiamata.
3. `email_connections.last_error_code` — codice tecnico dell'ultimo guasto.
4. `email_sync_runs` (owner/admin) — l'ultima esecuzione, con conteggi e codice
   di errore. `partial` con `CURSOR_EXPIRED` significa che il cursore era troppo
   vecchio e si è ripartiti da una finestra recente.
5. `email_webhook_events` — se è vuota, le notifiche non arrivano: verifica
   `--no-verify-jwt` sul deploy e l'endpoint push su Pub/Sub.

**Codici che l'utente non vede mai** (§108): `invalid_grant`, `401 Graph`,
`historyId invalid`, `PGRST116`. Sono mappati in `inboxErrorMessage()`.

**Nei log non compaiono**: corpo delle email, oggetti, mittenti, token,
contenuto degli allegati. Solo identificatori, conteggi e codici.

---

## 10. Privacy — quali dati e dove

| Dato | Dove finisce | Quando |
|---|---|---|
| Oggetto, mittente, destinatari, data | `email_messages` | a ogni acquisizione |
| Corpo ridotto a testo | `email_messages.body_text` | a ogni acquisizione |
| Corpo depurato di firme e citazioni | `email_messages.body_clean` | a ogni acquisizione |
| HTML originale | **da nessuna parte** | mai conservato |
| Metadati degli allegati | `email_attachments` | a ogni acquisizione |
| File degli allegati | Storage privato `company-documents` | solo se `likely_actionable`, o su richiesta |
| Oggetto + mittente + primi 4000 caratteri | **inviati ad Anthropic** | solo se il filtro deterministico non ha già fermato il messaggio |
| Testo estratto dal documento principale | **inviato ad Anthropic** | solo per i messaggi analizzati |

**Non** vengono inviati al modello: header tecnici, destinatari, storico citato,
allegati non selezionati, contenuto degli allegati in fase di classificazione.

Anthropic ha sede negli Stati Uniti: è il trasferimento fuori UE/CH già
dichiarato nell'informativa della vetrina, e vale identico qui.

**Conservazione**: nessuna cancellazione automatica. Scollegare una casella
**non** cancella la posta già importata — sono due decisioni diverse, e solo una
è stata presa premendo quel pulsante. Un'azione «elimina dati importati» non è
implementata.

---

## 10bis. Dal messaggio al documento (2026-07-31)

Il percorso «posta → documento → analisi → attività» esisteva, ma dal dettaglio
di una comunicazione si arrivava **soltanto** alla schermata di analisi. Tre
conseguenze, tutte trovate seguendo il percorso invece di rileggerlo:

* con un corpo **e** un allegato importati comparivano **due pulsanti identici**
  «Apri analisi» che portavano in posti diversi, e niente diceva quale fosse quale;
* il **documento** — dove quel foglio si organizza, si archivia e diventa lavoro —
  non era raggiungibile dalla posta;
* su un allegato appena importato quel pulsante prometteva una schermata che non
  aveva ancora niente da mostrare.

Ora la scheda **«Documenti prodotti»** elenca ciò che quella comunicazione ha
generato: per ogni riga la **provenienza** (corpo o allegato), il nome del file e
un collegamento a `/documenti/:id`. L'analisi ha un collegamento **solo**, quello
del documento principale (§33). Nessun dato del Document Hub è copiato qui:
titolo, provenienza e stato viaggiano già con il messaggio.

⚠️ **Lo stato si mostra solo dove si SA.** `documents.status` e l'esito
dell'ultima analisi possono divergere — misurato in produzione il 2026-07-31: una
riga `status = 'completed'` con l'ultima analisi `needs_review`. Su quel
documento la posta avrebbe scritto «Analizzato» mentre la schermata del
documento, due clic più in là, dice «Da verificare». Perciò: sul documento
principale, di cui la schermata carica l'analisi, si usa `stateOf` — la stessa
funzione del Document Hub; sugli altri si mostra solo ciò che `documents.status`
decide da solo (in elaborazione, fallito, mai analizzato) e **nel dubbio nessuna
pastiglia**. Un'etichetta plausibile e sbagliata è peggio di un'etichetta assente.

### `/inbox?msg=…` — tre correzioni

1. ⚠️ **Un identificativo malformato** (`/inbox?msg=abc`) faceva arrivare a
   schermo `invalid input syntax for type uuid: "abc"` — stringa tecnica, in
   inglese, dentro un'interfaccia che può essere tedesca. È la stessa apertura
   già chiusa su `/incentivi?progetto=abc`. Ora un identificativo malformato non
   è una selezione e si ignora; uno **ben formato che non esiste resta** una
   selezione, perché «non trovato» è la risposta vera e va detta.
2. ⚠️ **Aprire un messaggio sostituiva la voce di cronologia**: il tasto indietro
   del browser usciva dall'Inbox in un colpo solo, saltando l'elenco. Ora aprire
   **aggiunge** una voce — dalla lista si torna alla lista, da un documento si
   torna al documento. Chiudere resta un `replace`, altrimenti il tasto indietro
   diventerebbe un clic a vuoto.
3. «Messaggio non trovato» rendeva un pulsante **«Riprova» che tornava indietro**.
   Ora dice quello che fa. I due casi — non esiste, oppure è di un'altra azienda —
   restano indistinguibili di proposito: dire quale sarebbe rivelare l'esistenza
   di una riga altrui.

**Verificato nel browser il 2026-07-31** su un'azienda tecnica, poi rimossa:
apertura a freddo di `/inbox?msg=<uuid>` (l'indirizzo sopravvive, si apre il
messaggio giusto), ritorno al documento e ritorno alla lista con il tasto
indietro, `?msg=abc` che mostra l'elenco senza errori tecnici in pagina.

---

## 11. Test

```bash
npm run test:inbox-unit   # 172 asserzioni offline: HTML/XSS, normalizzazione,
                          # allegati, classificazione, injection, adapter, crypto,
                          # e (sez. 10) il collegamento messaggio → documento
npm run test:inbox        # 50 asserzioni sul database reale: RLS, isolamento fra
                          # aziende, permessi di colonna, vincoli, quota di sistema
```

Il primo non richiede nulla. Il secondo richiede `.env.test` e le migrazioni 0013 + 0014, e lo
dichiara chiaramente se mancano. **Entrambi verdi al 2026-07-27** (148 e 50).

`test:inbox` non è decorativo: alla prima esecuzione sul database reale ha smontato la garanzia sui
permessi di colonna che la 0013 dichiarava nei commenti e che questo documento affermava. È il
motivo per cui esiste — provare ciò che si sostiene, invece di sostenerlo e basta.

**Non coperto dai test automatici**: il flusso OAuth reale, le notifiche push
reali, il rinnovo reale delle sottoscrizioni. Richiedono credenziali di provider
e non sono simulabili in modo onesto — si verificano collegando una casella vera.

---

## 12. Cosa manca per andare in produzione

1. **Credenziali Google e Microsoft** (sezioni 4 e 5). Senza, la funzione è
   inerte e lo dichiara. *(Migrazioni 0013 e 0014: applicate e verificate.)*
2. **Verifica dell'app Google.** `gmail.readonly` è uno scope riservato: fuori
   dalla modalità «Test» Google richiede una verifica con valutazione di
   sicurezza CASA. Fino ad allora si possono collegare solo gli indirizzi
   elencati come utenti di test. È il vincolo esterno più pesante.
3. ~~**Scheduler della manutenzione**~~ (sezione 6.5) — **FATTO il 2026-07-27**:
   pg_cron ogni 15 minuti, provato in esercizio. Finché non ci sono le notifiche
   push, questa cadenza È il tempo di risposta della Inbox.
4. **Prova end-to-end su una casella reale**: consenso, import iniziale, arrivo
   di una notifica, analisi di un allegato, scollegamento.
   *(2026-07-27: fatta fino all'analisi. Il primo collegamento reale ha mostrato
   due cose che nessun test aveva colto — l'import iniziale ucciso a metà lascia
   stati appesi, e il ritentativo di un'analisi in coda scambiava il documento
   già creato per lavoro già fatto. Entrambe corrette; restano da provare sul
   campo l'arrivo di una notifica push e lo scollegamento.)*
5. **Valutazione d'impatto sulla protezione dei dati.** Leggere la posta
   aziendale di un cliente è un trattamento di natura diversa dall'analizzare un
   PDF che ha caricato lui: va detto nell'informativa e nelle condizioni d'uso,
   che sono già in attesa di revisione legale.
