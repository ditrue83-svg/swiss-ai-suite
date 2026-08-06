# AI-Swisse — App SaaS

SaaS per PMI svizzere con due moduli: **Admin AI** (analisi di documenti
amministrativi IT/DE/FR) e **Subsidy AI** (matching incentivi Confederazione +
Cantone Ticino). Costruito su **Supabase** (Auth + PostgreSQL + Storage privato + RLS).

Principio guida: **correttezza, trasparenza e verificabilità prima della completezza.**
L'AI interpreta e spiega, ma ogni conclusione importante è collegata a una **citazione
verificata** del documento; ciò che non è certo viene dichiarato come incertezza, mai inventato.

## Stack

- **Frontend**: React 18 + TypeScript + Vite (porta dev `5174`)
- **Backend**: Supabase (Auth, PostgreSQL, Storage privato, RLS, Edge Functions Deno)
- **AI**: Anthropic Claude (`claude-opus-4-8`), chiamato **solo server-side**
- **Architettura**: UI ⟷ `contexts` ⟷ `services` ⟷ Supabase. La UI non chiama mai Supabase direttamente.

## Struttura

```
supabase/
  migrations/   0001_core · 0002_documents · 0003_subsidy · 0004_tasks · … · 0018_calendar_notifications
                0005_storage · 0006_admin_ai_pipeline · 0007_subsidy_programs
                0008_analysis_truth · 0009_quota_and_upload_limits
                0010_analysis_immutability · 0011_program_availability
                0012_program_translations · 0013_inbox · 0014_inbox_grants
                0015_inbox_awaiting_analysis · 0016_work_hub · 0017_document_hub
                0018_calendar_notifications · 0019_notifications_mark_read
                0020_workflow_automation · 0021_finance_operations
                0022_finance_event_kind_cast · 0023_finance_immutable_allows_cascade
                0024_contract_manager · 0025_contract_fixes
                0026_crm_light · 0027_company_assistant · 0028_crm_cascade_history
                0029_assistant_purge_lockdown · 0030_crm_link_candidate
                0031_assistant_purge_schedule · 0032_subsidy_ai_2
                0033_subsidy_answers_cascade · 0034_subsidy_answers_project_cascade
                0035_calendar_notification_schedulers
                0036_assistant_empty_group_citation
                0037_subsidy_catalog_review
                0038_subsidy_review_source_url
                0039_audit_logs
  functions/
    _shared/           cervello AI condiviso Edge/test (schema, prompt, validate, pipeline, persist,
                       extract) + email/ (adapter provider, normalizzazione, classificazione, sync)
                       + calendar/ (stato desiderato PURO, promemoria con fuso, adapter, invio email)
                       + automation/ (REGISTRO di inneschi e azioni, valutatore a tre valori,
                       modelli di testo, motore — tutti moduli portabili, provati in Node)
                       + finance/ (QR-fattura, cifre di controllo, aritmetica esatta degli importi)
                       + contracts/ (periodi e ancoraggi in quattro lingue, validazione con
                       citazioni verificate, pipeline di lettura)
                       + assistant/ (REGISTRO degli strumenti — il perimetro —, esecutori con
                       proiezioni esplicite, aritmetica delle date nel fuso dell'utente,
                       validazione delle citazioni e ancoraggio ai dati, ciclo con i suoi limiti)
    analyze-document   estrazione/OCR + analisi + persistenza server-side
    generate-reply     bozza di risposta on-demand
    interpret-project  interpretazione progetto per il Subsidy AI
    lookup-company     proxy Registro IDI (Zefix)
    email-oauth        consenso e callback OAuth delle caselle di posta
    email-sync         sincronizzazione e analisi su richiesta
    email-webhook      notifiche push Google Pub/Sub e Microsoft Graph
    email-disconnect   scollegamento di una casella
    automation-worker  consuma la coda degli eventi ed esegue le regole (scheduler)
    automation-admin   crea, attiva, mette in pausa, prova a vuoto (JWT + ruolo)
    email-maintenance  rinnovo sottoscrizioni, riconciliazione, pulizia
    calendar-oauth        consenso e callback OAuth dei calendari (personale, non aziendale)
    calendar-sync         coda di sincronizzazione, «Sincronizza ora», riconciliazione
    calendar-disconnect   scollegamento, con scelta esplicita sugli eventi già scritti
    notifications-worker  promemoria e consegna delle email
    finance-worker        legge la coda delle fatture (scheduler, segreto condiviso)
    contract-worker       legge la coda dei documenti contrattuali e apre le finestre
                          di attenzione delle date verificate (scheduler)
    subsidy-worker        Incentivi: rivaluta le opportunità dei progetti attivi contro le
                          versioni PUBBLICATE del catalogo, controlla le fonti ufficiali
                          scadute e apre le revisioni. ⚠️ NON aggiorna mai il catalogo da
                          sé: un cambiamento critico diventa una voce da revisionare, e la
                          versione pubblicata resta quella finché una persona non decide.
                          Non presenta domande e non parla con nessuna autorità (scheduler)
    company-assistant     «Chiedi ad AI-Swisse»: una domanda, un ciclo LIMITATO di strumenti
                          tipizzati, una risposta con le sue fonti. Risponde IN FLUSSO
                          (text/event-stream) — l'unica del prodotto — perché §112 chiede di
                          mostrare che cosa sta succedendo e §114 di poterlo interrompere.
                          ⚠️ Si pubblica SENZA --no-verify-jwt: la chiama sempre una persona
src/
  lib/            supabase, env, errori, hash (SHA-256), uid (IDI), formattazione
  types/          database.ts (schema) · models.ts (dominio)
  services/       auth · company · document · documentHub · analysis · task · subsidy · reply
                  correction · program · interpret · companyLookup · emailConnection · inbox
                  calendar · calendarConnection · notification · assistant
  contexts/       AuthContext · CompanyContext (multi-tenant, nessuna company hardcoded)
  features/       auth · companies · admin-ai · subsidy-ai · tasks · documents · dashboard · pricing
                  inbox · calendar · notifications · automations · finance · contracts · crm
                  assistant (Chiedi ad AI-Swisse) · incentives (Incentivi, Subsidy AI 2.0)
                  audit (Registro attività: una schermata, non un modulo — 0039)
scripts/          test-phase1 · test-phase2 · test-async · test-pipeline · test-inbox · test-inbox-unit
                  eval-admin-ai
                  eval-subsidy · test-validate · test-uid · seed-subsidy-programs · subsidy-catalog-health
                  subsidy-translations (contenuti de/fr) · check-auth-config · bundle-migrations
                  test-workflows · test-finance · test-contracts · test-assistant
                  (+ le versioni -unit, offline) · eval-assistant
                  docs-check (la documentazione descrive il codice che c'è davvero?)
docs/             design-system.md · revisione-traduzioni.md · ai-inbox.md · document-hub.md
                  calendar-notifications.md · workflow-automation.md · finance-operations.md
                  contract-manager.md · crm-light.md · company-assistant.md
                  company-assistant-search-eval.md
```

### Dove sta la documentazione

L'elenco qui sopra è un albero, e dentro un blocco di codice nessun nome è
cliccabile: sette documenti su undici non erano raggiungibili da nessun
collegamento, e `docs:check` lo segnalava da tempo. Questo è l'indice vero.

| Documento | Di che cosa parla |
| --- | --- |
| [`design-system.md`](docs/design-system.md) | Colori, spaziature, tema chiaro e scuro |
| [`revisione-traduzioni.md`](docs/revisione-traduzioni.md) | Come si rivedono i dizionari de/fr |
| [`ai-inbox.md`](docs/ai-inbox.md) | Inbox: Gmail, modello di minaccia, limiti |
| [`document-hub.md`](docs/document-hub.md) | Documenti: acquisizione, analisi, evidenze |
| [`calendar-notifications.md`](docs/calendar-notifications.md) | Calendario, promemoria, preferenze |
| [`workflow-automation.md`](docs/workflow-automation.md) | Automazioni: regole, esecuzioni, worker |
| [`finance-operations.md`](docs/finance-operations.md) | Finanze: fatture, spese, duplicati |
| [`contract-manager.md`](docs/contract-manager.md) | Contratti: termini, rinnovi, preavvisi |
| [`crm-light.md`](docs/crm-light.md) | Clienti: organizzazioni, opportunità, contatti |
| [`incentivi.md`](docs/incentivi.md) | Incentivi (Subsidy AI 2.0): sei misure, quattro schede, scheduler, limiti |
| [`company-assistant.md`](docs/company-assistant.md) | Chiedi ad AI-Swisse: ciclo, fonti, limiti |
| [`company-assistant-search-eval.md`](docs/company-assistant-search-eval.md) | La prova di ricerca dell'assistente |
| [`ai-output-parsing.md`](docs/ai-output-parsing.md) | Il contratto di lettura dell'output dei modelli: che cosa il parser condiviso tollera, che cosa non ripara, dove finisce la sintassi e comincia il dominio |

## Setup

### 1) Progetto Supabase
Su [supabase.com](https://supabase.com) crea un progetto. Da **Project Settings → API** annota
`Project URL`, chiave `anon`/`publishable`, chiave `service_role` (quest'ultima **solo** per i test locali).

### 2) Migrazioni
**Installazione da zero:** applica `supabase/full-setup.sql` (contiene tutte le migrazioni in ordine; è un
file **generato** — si rigenera con `npm run db:bundle`):

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/full-setup.sql   # oppure: npx supabase db push --linked
```

⚠️⚠️ **NON si incolla nel SQL Editor di Supabase, e non è una preferenza: è stato misurato.** Il SQL editor
esegue tutto in **una transazione**, e in una transazione sola questo file **fallisce** con
`55P04 unsafe use of new value "extracting"` — la 0006 aggiunge quell'etichetta a `document_status`,
`list_documents` (0017, `language sql`, quindi con il corpo analizzato alla creazione) la usa. Applicando
**una migrazione alla volta** non succede niente, perché ogni migrazione ha la sua transazione, ed è così
che è nato il database in esercizio. La CI applica questo file a un database vuoto a ogni pull request:
la procedura qui sopra è **provata**, non dichiarata.

⚠️ **Il file comincia con un preambolo di privilegi, e non è un dettaglio.** Nessuna migrazione concede
la DML di base: in produzione `companies` si legge perché il progetto, creato a luglio, porta un default
di piattaforma (`pg_default_acl`: tabelle `arwdDxtm` ad `anon`/`authenticated`/`service_role`). **Sugli
stack Supabase recenti quel default concede solo `Dxt`**, e senza il preambolo l'installazione riesce,
lo schema è perfetto e **l'applicazione risponde «permission denied» su ogni tabella**. Il preambolo
riproduce esattamente la produzione; ciò che protegge i dati resta la RLS più i `revoke all` espliciti
delle migrazioni. `npm run db:bundle` si rifiuta di generare un file che ne sia privo, e la CI applica
questo file su un database vuoto a ogni pull request — quindi il percorso d'installazione è **provato**,
non dichiarato.

⚠️ **Su un database che ha già le migrazioni precedenti si applica UNA migrazione alla volta**, il singolo
file di `supabase/migrations/`. `full-setup.sql` è rieseguibile — `npm run db:bundle` lo verifica riga per
riga — ma rieseguirlo per aggiungere l'ultima migrazione significa ricreare policy e trigger di tutto lo
schema per ottenere una cosa sola, ed è lavoro inutile su un database in esercizio.

**Opzione B — CLI:**
```bash
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
```

### 3) Frontend
```bash
cp .env.example .env      # imposta VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run dev               # http://localhost:5174
```

### 4) Edge Functions + chiave AI
```bash
npx supabase functions deploy analyze-document --project-ref <PROJECT_REF>
npx supabase functions deploy generate-reply   --project-ref <PROJECT_REF>
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref <PROJECT_REF>
```
La chiave Anthropic vive **solo** come secret della Edge Function: mai nel `.env` del frontend.

### 5) Autenticazione (obbligatorio prima di andare online)

Registrazione e reimpostazione password funzionano via **link inviati per email**. Supabase accetta
quel link solo se l'URL è nell'allowlist del progetto: se non lo è, il link punta al *Site URL* e
l'utente **non completa mai il flusso**, senza vedere alcun errore.

Nel dashboard → **Authentication → URL Configuration**:

| Campo | Valore |
|---|---|
| **Site URL** | l'URL pubblico dell'app (es. `https://app.esempio.ch`) |
| **Redirect URLs** | `https://app.esempio.ch/**` e, per lo sviluppo, `http://localhost:5174/**` |

Poi imposta `VITE_PUBLIC_SITE_URL` nel `.env` di produzione con lo stesso dominio, così i link
generati sono deterministici anche se l'utente apre l'app da un'origine diversa (www, preview…).

**Verifica** che tutto combaci — non a mano, con lo script:

```bash
npm run check:auth -- https://app.esempio.ch
```

Controlla che i redirect di conferma e reset vengano rispettati e che un URL estraneo venga
respinto (difesa open redirect). La configurazione attesa è versionata in `supabase/config.toml`,
che però il progetto hosted **non legge**: è documentazione + configurazione per l'ambiente locale.

**SMTP.** Il servizio email predefinito di Supabase ha limiti stretti ed è pensato per lo sviluppo:
per la produzione configura un SMTP proprio (Authentication → Emails → SMTP Settings), altrimenti
le email di conferma e reset possono non arrivare.

### 6) Deploy del frontend (Cloudflare Pages)

L'app è una **SPA statica**: la build produce solo file: nessun server applicativo, nessuna
funzione lato host. Tutto il backend è Supabase. Di conseguenza l'hosting **non decide dove
stanno i dati**: i documenti restano su Supabase e i testi da analizzare passano dall'API
Anthropic. La domanda «dove sono i dati dei clienti» si risponde guardando la regione del
progetto Supabase (Project Settings → General → Region), non l'host del frontend.

Cloudflare Pages è gratuito **anche per uso commerciale** (il piano gratuito di Vercel non lo è),
distribuisce da PoP svizzeri, e include TLS e dominio personalizzato.

**Nel repository ci sono già i tre file che servono** — non vanno ricreati a mano:

| File | Serve a |
|---|---|
| `public/_redirects` | Rewrite SPA. **Senza, ogni refresh su una rotta interna dà 404**, compresi i link di conferma email |
| `public/_headers` | Header di sicurezza + politica di cache. Contiene una CSP in *Report-Only*, da promuovere dopo verifica (istruzioni nel file) |
| `.node-version` | Fissa Node 20 sulla build remota, la stessa versione su cui gira la build locale |

Vite copia `public/` in `dist/`, quindi i file finiscono nella cartella pubblicata.

**Configurazione del progetto** su Cloudflare → Workers & Pages → Create → Pages → Connect to Git,
scegliendo il repository `swiss-ai-suite`:

| Campo | Valore | Perché |
|---|---|---|
| Root directory | `app` | L'app sta in quella sottocartella del repo |
| Build command | `npm run build` | Fa anche `tsc --noEmit`: un errore di tipo ferma il deploy |
| Build output directory | `dist` | Relativo alla root directory |

**Variabili d'ambiente** (Settings → Environment variables, ambiente *Production*). Servono perché
`.env` non è nel repository: senza queste due la build riesce ma l'app parte **non configurata** e
lo dichiara invece di fingere di funzionare.

| Variabile | Valore |
|---|---|
| `VITE_SUPABASE_URL` | l'URL del progetto Supabase |
| `VITE_SUPABASE_ANON_KEY` | la chiave `anon`/`publishable` — è pubblica per definizione, finisce nel bundle JS; la sicurezza è la RLS |
| `VITE_ANALYSIS_PROVIDER` | `ai` |
| `VITE_PUBLIC_SITE_URL` | l'URL pubblico dell'app (vedi ordine sotto) |

**Ordine da rispettare.** `VITE_PUBLIC_SITE_URL` è letto *durante la build*, ma l'URL definitivo si
conosce solo dopo il primo deploy: va quindi fatto un secondo deploy, oppure il valore va previsto
in anticipo (il nome che dai al progetto Cloudflare determina `https://<nome>.pages.dev`, a meno che
sia già occupato e Cloudflare aggiunga un suffisso).

1. primo deploy → prendi nota dell'URL assegnato;
2. Supabase → Authentication → URL Configuration: **Site URL** = quell'URL, **Redirect URLs** =
   `<URL>/**` più `http://localhost:5174/**` per lo sviluppo;
3. imposta `VITE_PUBLIC_SITE_URL` su Cloudflare e **ridistribuisci** (le variabili valgono dal
   deploy successivo, non retroattivamente);
4. verifica, senza fidarti dell'aspetto della pagina:
   ```bash
   npm run check:auth -- https://<URL-pubblico>
   ```

**Quando arriverà il dominio definitivo** cambiano tre valori e nient'altro: Site URL e Redirect URLs
su Supabase, `VITE_PUBLIC_SITE_URL` su Cloudflare — poi si ridistribuisce e si rilancia `check:auth`
sul nuovo dominio. Conviene lasciare l'URL `pages.dev` nei Redirect URLs finché la migrazione non è
confermata.

### Stato dell'installazione di produzione

| | |
|---|---|
| Applicazione | `https://app.ai-swisse.com` (Cloudflare Pages, CNAME dal DNS del registrar) |
| Site URL / Redirect | dominio + indirizzo `pages.dev` + `localhost:5174` — verificato con `check:auth` |
| SMTP | server del provider di posta del dominio, porta **587** (STARTTLS), mittente dedicato |
| Limite email | 30/ora, con intervallo minimo di 60 s verso lo stesso indirizzo |
| Autenticazione email | SPF, **DKIM** (RSA 2048) e DMARC (`p=none`) tutti attivi sul dominio |

Due avvertenze imparate mettendo online questo:

- **Il blocco SMTP della Management API di Supabase è atomico.** Un `PATCH` con un solo campo
  (es. la porta) azzera host, utente, mittente **e password**. La configurazione SMTP va fatta dal
  dashboard, non via API.
- **Una casella di posta ordinaria non è un servizio di invio applicativo.** Il provider può
  disabilitarne l'invio come misura antiabuso (si sblocca cambiando la password della casella), e
  i limiti giornalieri sono pensati per l'uso umano. Se i volumi crescono, il passaggio naturale è
  un servizio di invio transazionale: cambiano solo i cinque campi SMTP.

## Variabili d'ambiente

| Variabile | Dove | Scopo |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env` (frontend) | URL del progetto |
| `VITE_SUPABASE_ANON_KEY` | `.env` (frontend) | Chiave pubblica; la sicurezza vera è la RLS |
| `VITE_PUBLIC_SITE_URL` | `.env` (frontend) | URL canonico per i link nelle email; vuoto in sviluppo |
| `VITE_ANALYSIS_PROVIDER` | `.env` (frontend) | `ai` (default) o `deterministic` — vedi sotto |
| `ANTHROPIC_API_KEY` | **secret Edge Function** | Chiamate AI server-side |
| `ZEFIX_AUTH` | **secret Edge Function** | `utente:password` per il Registro IDI (opzionale) |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.test` (mai committato) | Solo per gli script di test locali |

Nessun secret sta nel repository: solo i file `.example` con segnaposto.

## Pipeline Admin AI

```
DOCUMENTO
  ↓ validazione (MIME, dimensione, hash SHA-256 → dedup)
ESTRAZIONE TESTO            pdfjs per i PDF digitali · OCR (Claude vision) per scansioni/immagini
  ↓                          extractionMethod: native_pdf | text | ocr
NORMALIZZAZIONE             testo + struttura per pagina
  ↓
ANALISI AI STRUTTURATA      JSON guidato dal prompt (vedi nota sotto), difesa prompt-injection
  ↓
VALIDAZIONE OUTPUT          schema + business rules + enum + date + importi + confidence
  ↓
EVIDENCE MAPPING            ogni citazione verificata contro il testo estratto
  ↓
CONFIDENCE / UNCERTAINTIES  ciò che non è certo viene dichiarato
  ↓
DATABASE                    originale / testo estratto / analisi separati
  ↓
UI ADMIN AI
```

Il codice della pipeline è **condiviso** fra Edge Function e test (`supabase/functions/_shared/`),
così ciò che viene valutato negli eval è esattamente ciò che gira in produzione.

**Esecuzione asincrona (§26).** Il client invoca con `async: true`: autenticazione, membership,
rate limit e validazione dell'input restano **sincroni** (401/403/422/429 arrivano subito), poi la
funzione risponde `202 processing` e prosegue il lavoro in background. L'avanzamento viaggia nel
database (`documents.status`: `extracting → analyzing → completed | needs_review | failed`) e la UI
lo osserva, mostrando stati reali senza percentuali inventate. Se il runtime non offre background
task si resta sul percorso sincrono: **nessun finto background processing**.

**Nota sugli structured outputs:** la grammatica forzata (`format: {json_schema}`) è stata provata e
**rifiutata dall'API** per questo schema (limite di 16 union e "grammar too large" su strutture
annidate). Si usa quindi **JSON guidato dal prompt + validazione robusta lato server**: l'output è
comunque strutturato e tipizzato, ma la garanzia viene dal validatore, non dal decoder.

### La garanzia "non inventa dati"

- Ogni `evidence.quote` deve essere **verbatim** dal documento; il server la **verifica** contro il
  testo estratto. Se non la ritrova: la citazione viene scartata, l'affidabilità abbassata e viene
  aggiunta un'incertezza tecnica. «Mostra nel documento» appare solo per citazioni verificate.
- **Scadenze**: `explicit` (data certa nel testo) · `relative` («entro 30 giorni») → nessuna data
  assoluta inventata, si mostra «data da verificare» · `none` → «scadenza non individuata».
- **Azioni**: `extracted` (richiesta dal documento) vs `suggested` (consiglio operativo di AI-Swisse),
  mai confuse; la `primaryAction` non antepone mai un suggerimento a un obbligo esplicito.
- **Rischi**: `explicit` (dichiarato dal documento) vs `inferred` (conseguenza plausibile, mostrata
  come «da verificare»).
- **Mittente**: se non identificabile → `null` + incertezza, mai un ente inventato.
- Gli **offset** per l'evidenziazione non vengono mai dal modello: sono ricalcolati localmente.

### Modalità del motore (`VITE_ANALYSIS_PROVIDER`)

| Valore | Comportamento |
|---|---|
| `ai` (default) | Solo AI reale server-side. Se la Edge Function non è disponibile l'analisi **fallisce esplicitamente**: nessun risultato locale spacciato per AI |
| `deterministic` | Scelta esplicita: motore locale, **nessun contenuto lascia Supabase**. Etichettato «Motore locale», non è un fallback |

Non esiste alcun fallback silenzioso. Il chip nella scheda risultato dichiara sempre quale motore ha
prodotto l'analisi e la colonna `document_analyses.engine` lo registra nel database.

## Interfaccia e design

Il sistema di design — scale tipografiche, spaziature, colore, contrasti, tema
scuro — è documentato in [`docs/design-system.md`](docs/design-system.md), con le
regole da rispettare per le modifiche future. Il codice sta in `src/styles/app.css`.

Le traduzioni dell'interfaccia hanno superato i controlli oggettivi (uso svizzero,
terminologia federale, tipografia francese) ma **non sono state riviste da un
madrelingua**: il materiale pronto per quella revisione, ordinato per rischio, è
in [`docs/revisione-traduzioni.md`](docs/revisione-traduzioni.md).

## Multilingua (it · de · fr)

L'interfaccia esiste nelle tre lingue in cui una PMI svizzera riceve la posta amministrativa.
La lingua si rileva dal browser, si può cambiare in ogni momento (anche prima di accedere) e resta
salvata; date e importi seguono il locale svizzero corrispondente (`it-CH` / `de-CH` / `fr-CH`).

**Nessuna dipendenza esterna**: dizionari, interpolazione e cambio lingua sono ~80 righe in
`src/i18n/`. La completezza non è controllata a runtime ma **dal compilatore**: `de.ts` e `fr.ts`
sono tipizzati come `Dictionary`, quindi una chiave mancante rompe `npm run typecheck`. Non esiste
un fallback silenzioso che mostri l'italiano dentro un'interfaccia tedesca.

**Anche i testi generati dall'AI seguono la lingua scelta** (§42) — riassunto, azioni, rischi e
incertezze. Le **citazioni** restano invece nella lingua originale del documento: tradurle le
renderebbe impossibili da ritrovare nel testo e la verifica automatica le scarterebbe.

`npm run i18n:coverage` verifica che **nessun testo d'interfaccia** resti scritto a mano nel
codice: testo dentro il JSX, attributi che l'utente legge (`placeholder`, `aria-label`, `title`,
`alt`, `label`) e messaggi passati a `showToast()`.

⚠️ Fino al 2026-07-26 lo script cercava invece *parole italiane*, con una lista di articoli e verbi
al singolare. Dichiarava «nessuna stringa da tradurre» mentre un centinaio di etichette era ancora
in italiano: erano quasi tutte al plurale — «Azioni da completare», «Documenti da verificare» — e
quindi invisibili a quella lista. La dashboard in tedesco era metà in italiano con il controllo
verde. Un controllo che dice verde quando non lo è vale meno di nessun controllo: ora la regola è
«questo testo passa dai dizionari?», che non richiede di conoscere la lingua e non ha falsi verdi.

## Database

Separazione netta, mai sovrascritta: **file originale** (Storage) / **testo estratto**
(`document_extractions`) / **analisi** (`document_analyses`).

| Tabella | Ruolo |
|---|---|
| `companies`, `company_members`, `company_profiles` | multi-tenant, ruoli, profilo operativo |
| `documents` | metadati, `file_hash` (dedup), `page_count`, stato + **organizzazione** (0017): `category`, `category_source`, `archived_at/by`, `internal_notes` |
| `document_tags`, `document_tag_links` | etichette aziendali; nome unico per azienda senza distinzione di maiuscole |
| `document_extractions` | testo per pagina, `extraction_method`, confidence OCR |
| `document_analyses` | analisi: campi query-critical + JSONB (actions, amounts, risks, evidence, uncertainties) + provenienza (`provider`, `model`, `prompt_version`, `schema_version`, timestamp, `error_code`). **Immutabile**: dalla 0010 il client ha solo `select` e un `insert` vincolato al motore locale — niente `update`, niente `delete` |
| `action_progress` | spunte della checklist: una riga per azione spuntata, con autore e momento assegnati dal database. Sta qui, e non dentro l'analisi, perché è uno stato dell'utente |
| `document_replies` | bozze di risposta, modificabili e persistenti — **unica sede** della bozza corrente, sia AI sia motore locale |
| `analysis_corrections` | correzioni umane **append-only**: l'analisi AI non viene mai riscritta |
| `tasks` | **Attività** (Work Hub): il lavoro da fare, con responsabile, stato e provenienza |
| `task_checklist_items` | i passaggi operativi di un'attività — non è `action_progress` |
| `task_comments` | la conversazione attorno a un'attività (testo semplice, mai markup) |
| `task_events` | storico: lo scrivono i trigger, il client può solo leggerlo |
| `automation_events` | **outbox** dei fatti del dominio (0020). Lo scrivono i TRIGGER nella stessa transazione del fatto; il client non ha alcun permesso, né di lettura né di scrittura. Porta la catena causale: `correlation_id`, `causation_id`, `root_event_id`, `chain_depth` |
| `workflow_definitions` | la **regola**: quando / se / allora. Configurazione JSONB validata contro il registro tipizzato; il browser non può scriverla, si passa da `automation-admin` |
| `workflow_runs` | un'esecuzione, con la **configurazione usata** e l'esito di ogni condizione. `unique (workflow_id, trigger_event_id)`: lo stesso evento due volte non produce due esecuzioni |
| `workflow_action_runs` | ogni azione con la propria **chiave di idempotenza** — l'unicità la impone il database, non un controllo applicativo |
| `workflow_events` | chi ha creato, attivato, messo in pausa, archiviato una regola. Solo amministratori |
| `subsidy_projects`, `subsidy_opportunities`, `subsidy_assessments`, `subsidy_criterion_results` | **Incentivi** (0032): il progetto dell'impresa, il suo incontro con una versione di programma, e la storia append-only delle valutazioni criterio per criterio. Le sei misure — rilevanza, idoneità, completezza, tempistica, freschezza, prontezza — sono sei colonne separate e nessuna è una probabilità: il client può scrivere solo `saved_at`, `dismissed_reason` e `dismissed_note` |
| `subsidy_answers` | risposte ai criteri, **append-only**: rispondere di nuovo scrive una riga nuova. ⚠️ Dalla **0033** (azienda) e dalla **0034** (progetto) la cancellazione diretta resta vietata ma la CASCATA di un genitore già cancellato passa — prima il guardiano sollevava anche lì, e una sola risposta rendeva l'azienda indistruttibile (stessa classe di 0023, 0025, 0028; riprodotto su un'azienda usa-e-getta prima di correggerlo) |
| `subsidy_sources`, `subsidy_program_versions`, `subsidy_program_rules`, `subsidy_calls` | il catalogo **condiviso e in sola lettura** per il client: da dove viene ogni requisito, in quale versione, con quale finestra e quando la fonte è stata controllata con successo l'ultima volta |
| `finance_items` | **Finanze** (0021): lo stato operativo di un documento finanziario — tipo, verifica, archiviazione, categoria di spesa. Le colonne `eff_*` sono una **proiezione** ricalcolata dal trigger, non una seconda verità; il client non ha alcun permesso di scrittura su di esse |
| `finance_extractions` | il **verbale** della lettura finanziaria: **immutabile e versionato** come `document_analyses`. Un secondo tentativo produce la versione 2 e la 1 resta leggibile. Porta la provenienza **campo per campo** (`qr` · `deterministic` · `ai`), la fiducia, le citazioni e le incertezze |
| `finance_corrections` | correzioni umane **append-only**, con un elenco **chiuso** di campi correggibili. Non riusa `analysis_corrections`: là il campo «amount» descrive l'analisi amministrativa, e scriverci un importo di fattura cambierebbe ciò che il Document Hub mostra |
| `finance_events` | storico di Finanze: lo scrivono i trigger, il client può solo leggerlo. Non si registra la lettura |
| `finance_vat_rates` | aliquote IVA ufficiali con **validità, fonte e data di verifica**. Sono suggerimenti: un'aliquota fuori elenco è accettata, non rifiutata |

### Attività (Work Hub) — migrazione 0016

Lo Scadenziario è diventato **Attività**: la scadenza è una proprietà del lavoro,
non il lavoro stesso. `/scadenziario` reindirizza a `/attivita`, perché i vecchi
collegamenti stanno negli appunti delle persone.

Quattro garanzie, tutte imposte dal **database** e non dal browser:

| Garanzia | Come |
|---|---|
| L'assegnatario è un membro della stessa azienda | trigger `tasks_guard`, che rifiuta l'inserimento |
| Chi ha completato e quando | scritti da `auth.uid()`/`now()`; un valore del client viene ignorato |
| L'autore di un commento | policy + trigger: firmare a nome d'altri viene **rifiutato**, non corretto in silenzio |
| Lo storico | lo scrivono i trigger; `task_events` non è scrivibile dal client |

**Stati**: `open` (mostrato come «Da fare»), `in_progress`, `waiting`, `completed`.
Il nome storico `open` è rimasto nel database: rinominarlo avrebbe richiesto una
migrazione distruttiva su dati veri per guadagnare una parola.

**Non si cancella, si archivia** (`archived_at`): su un prodotto B2B un clic di
troppo faceva sparire il lavoro senza lasciare traccia.

**L'ordine della lista** — prima le scadute, poi la priorità alta, poi la
scadenza più vicina — sta nella funzione SQL `list_tasks`, che filtra e pagina
nel database. Lo stesso criterio esiste in `taskFormat.compareTasks` per gli
elenchi già in memoria (la Home): la duplicazione è deliberata e i test la
sorvegliano.

⚠️ **`task_checklist_items` non è `action_progress`.** Le azioni di Admin AI
appartengono all'analisi, che è immutabile, e dicono cosa il documento chiede;
la checklist sono i passaggi che una persona decide.

Convertendo un'analisi in attività, le azioni ancora **aperte** diventano i
passaggi: una **derivazione una tantum**, non una sincronizzazione. Da lì le due
liste vivono separate — spuntare un passaggio non riscrive l'analisi. Le azioni
già completate non si copiano: rimetterle come «da fare» sarebbe falso, e
copiarle già spuntate farebbe riscrivere data e autore con quelli di adesso,
cancellando un fatto registrato con i suoi veri estremi.
La regola è `stepsFromActions()` in `features/tasks/taskFormat.ts`, con i suoi
casi nella sezione 6 di `npm run test:tasks-unit`.
| `subsidy_programs`, `subsidy_matches`, `subsidy_cases` | catalogo incentivi + attività utente |
| `ai_request_log` | osservabilità e rate limit — **senza contenuto del documento** |

Stati documento: `uploaded → extracting → analyzing → completed | needs_review | failed`.
Lo stato arriva **fino alla UI**: un'analisi `failed` non viene mai resa come un risultato (niente mittente o
tipo "di default"), e un tentativo fallito non cancella un'analisi valida ottenuta in precedenza.

### Documenti (Smart Document Hub) — migrazione 0017

L'Archivio è diventato **Documenti**: `/archivio` reindirizza a `/documenti`, e
il dettaglio di un documento vive su `/documenti/:id`.

Il Hub **compone, non copia**. Mittente, tipo, data, importi e scadenze restano
in `document_analyses` (immutabile dalla 0010) e in `analysis_corrections`; la
provenienza resta in `email_message_documents`; il lavoro resta in `tasks`.
Il Hub aggiunge solo l'**organizzazione aziendale** — categoria, etichette,
archiviazione, titolo mostrato, nota interna — che è anche l'unica parte
liberamente modificabile: cambiare categoria **non** produce una correzione
dell'analisi.

Non esiste nessuna tabella con copie dei dati dell'analisi, e nessuna seconda
pipeline AI: un documento già analizzato non viene rimandato al modello per
comparire qui.

| Garanzia | Come |
|---|---|
| La ricerca non esce dalla propria azienda | `list_documents` è `security invoker` (la RLS resta in vigore) **più** filtro esplicito su `company_id` **più** `is_company_member`. Il test cerca una parola rara presente in un solo documento di una sola azienda |
| La categoria automatica non sovrascrive una scelta umana | trigger che scrive `category_source`; una persona la si riconosce da `auth.uid()` e `pg_trigger_depth()`, che un browser non può falsificare |
| Chi ha archiviato e quando | `archived_at`/`archived_by` scritti dal database, come nelle attività |
| Le etichette non attraversano le aziende | trigger che confronta azienda del documento, dell'etichetta e dichiarata |
| Un'azione di gruppo non lavora a metà | `documents_assert_all_mine` confronta il conteggio **prima** di scrivere |
| La cancellazione definitiva | policy: amministratori, oppure chi ha caricato quel documento |

**Categoria ≠ tipo di documento.** Il tipo dice che cosa è (un sollecito); la
categoria dice dove sta (imposte). La classificazione è **deterministica**,
ricavata dal tipo di documento e dal tipo di ente, e **si ferma dove non sa**:
un documento non classificato resta senza categoria e compare fra quelli da
classificare, invece di ricevere «altro» — che sarebbe una certezza inventata.

**Ricerca full-text con configurazione `simple`**, senza radici: i documenti
arrivano in tre lingue e le regole di una sola peggiorerebbero le altre due. Il
prezzo, dichiarato: `Rechnung` non trova `Rechnungen` nel corpo del testo (li
trova nei metadati, che sono a sottostringa). L'indice copre i primi **500'000
caratteri** del testo estratto: oltre quella soglia un `tsvector` rischierebbe
di superare il limite di 1 MB e farebbe fallire il salvataggio dell'estrazione.

**Archiviare non perde niente** (analisi, email di provenienza e attività
restano) e la cancellazione definitiva sta in una sezione separata, con l'elenco
di ciò che si porta via verificato contro lo schema. Storage e database non sono
atomici: si cancella **prima la riga** e poi il file, perché un file orfano è
invisibile mentre un documento senza file farebbe dire una cosa falsa alla
schermata — e se la seconda metà fallisce, lo si dice.

Documento completo: **`docs/document-hub.md`**.

### Calendario e notifiche — migrazioni 0018 e 0019

Il Work Hub sa **che cosa** c'è da fare. Questo modulo aggiunge **quando** lo si
vede nel tempo (`/calendario`) e **che cosa non si può permettere di dimenticare**
(la campanella, i promemoria, le email opzionali).

La fonte di verità del lavoro resta `tasks`. Il calendario è una **proiezione**:
in questo modulo non esiste nessuna tabella che contenga titolo, scadenza o stato
di un'attività. `calendar_event_links` contiene solo la corrispondenza fra una
task e l'evento presso un provider — un identificativo e un'impronta, non una
copia. Due posti in cui vive una scadenza sono due scadenze che possono divergere.

**La sincronizzazione esterna va in una direzione sola: AI-Swisse → provider.**
Se una persona sposta un evento nel proprio calendario, la scadenza dell'attività
non cambia, e alla riconciliazione successiva l'evento torna alla data
dell'attività. La schermata lo dichiara.

| Garanzia | Come |
|---|---|
| Isolamento **fra persone** della stessa azienda | RLS su `user_id = auth.uid()`: due colleghi non si leggono le notifiche, non si vedono le connessioni, non si toccano le preferenze. Un amministratore **non può** accendere le email a un collega |
| Token irraggiungibili | `calendar_connection_secrets`: nessun GRANT, nessuna policy, AES-256-GCM con la chiave in un secret della Edge Function |
| Nessuno si fabbrica una notifica | il client non ha alcuna scrittura; «segna come letta» passa da una funzione |
| Un worker eseguito due volte non duplica | `unique (user_id, dedupe_key)` per i promemoria, `unique (connection_id, task_id)` per gli eventi |
| Otto modifiche rapide = una sola sincronizzazione | la coda ha `task_id` come chiave primaria |
| Un guasto del calendario non tocca il lavoro | la coda è un outbox: la task è salvata sempre, la sincronizzazione è un lavoro ritentabile |

**Google e Microsoft non danno le stesse garanzie, e non si finge il contrario.**
Su Google lo scope è `calendar.app.created`, che copre **solo i calendari creati
da questa applicazione**: «non leggiamo il tuo calendario personale» è un fatto
imposto dal token. Su Microsoft un permesso equivalente non esiste — il minimo
utile è `Calendars.ReadWrite`, che copre tutti i calendari della persona — quindi
là la stessa frase sarebbe un impegno, non un limite tecnico. La schermata del
consenso mostra **due avvertenze diverse**.

⚠️ Il prezzo dello scope minimo di Google: `calendarList.list` non è autorizzato,
quindi il calendario dedicato **non si può cercare per nome**. Il suo
identificativo si conserva in `calendar_connections.provider_calendar_id` e si
salva *prima* di scriverci dentro qualunque evento — altrimenti un'esecuzione
interrotta a metà ne farebbe creare un secondo senza che ce ne accorgessimo.

**I promemoria non dipendono dal browser**: li genera uno scheduler server-side.
Le finestre sono sette giorni, un giorno, il giorno stesso e — una volta sola —
quando l'attività diventa scaduta; nessuna prima delle **8 locali** di chi la
riceve, con il fuso letto da `notification_preferences.timezone` e calcolato con
`Intl`, non a mano. Le condizioni sono **intervalli**: un job saltato fa arrivare
un promemoria tardi, non lo fa perdere.

**Le email sono opzionali e spente per impostazione predefinita.** Se
l'installazione non ha un servizio di invio configurato, la schermata le dichiara
**non disponibili** invece di mostrare un interruttore che non farebbe partire
niente. In un'email finiscono azienda, titolo, scadenza e un collegamento: mai
importi, IBAN, mittenti, allegati o contenuti di documenti.

⚠️ La **0019** corregge un difetto della 0018 emerso alla PRIMA esecuzione di
`npm run test:calendar` sul database reale: `notifications_mark_read` era
`security invoker`, quindi girava con i permessi del chiamante — che su
`notifications` ha solo `SELECT` — e l'UPDATE veniva respinto con 42501. La
campanella non riusciva a segnare niente come letto. Se la funzione gira come il
chiamante, **la funzione è il chiamante**: un GRANT che manca a lui manca anche a
lei. Ora sono `security definer`, e la condizione `user_id = auth.uid()` scritta
dentro è l'unica difesa — non più una ridondanza.

Documento completo: **`docs/calendar-notifications.md`**.

### Finanze (Finance Operations) — migrazione 0021

Fatture fornitori, ricevute e note di credito su `/finanze`, con il dettaglio su
`/finanze/:id`. Il modulo **comprende e prepara il denaro, non lo muove**.

⚠️ **Che cosa NON fa, e non per mancanza di tempo**: nessun pagamento, nessun file
di pagamento, nessuna chiamata bancaria, nessun pulsante «Paga ora», nessuna
riconciliazione, nessuna registrazione contabile, nessuna dichiarazione IVA,
nessuna determinazione fiscale. **Un IBAN si mostra, non si trasforma mai in
un'azione**: non esiste una colonna, una funzione, una Edge Function né un'azione
delle automazioni che possa toccarlo. «Scaduta» significa **scadenza superata**,
mai «non pagata» — senza dati bancari il prodotto non sa se una fattura è stata
pagata.

Il modulo **non crea una seconda verità sui documenti**: il file resta del
documento, il testo dell'estrazione, la lettura amministrativa dell'analisi
immutabile, la provenienza dell'Inbox, il lavoro delle attività. Qui si aggiunge
solo la lettura finanziaria specializzata e lo stato operativo che ne deriva.

```
DOCUMENTO → ESTRAZIONE TESTO → ANALISI → ESTRAZIONE FINANCE → VERIFICA → ATTIVITÀ/REGOLE
```

**L'ordine di lettura è il cuore del modulo**: (1) codice QR — dato strutturato
verificato riga per riga; (2) testo, deterministico — ciò che supera una cifra di
controllo non è un'interpretazione; (3) modello, **solo per ciò che manca**. Non si
paga l'AI per riestrarre ciò che il codice ha già letto con certezza, e non si
sostituisce mai un dato verificato con uno probabile. Quando due fonti divergono
non si sceglie in silenzio: si alza `qr_text_mismatch` e l'elemento resta da
verificare.

| Garanzia | Come |
|---|---|
| Il verbale non si riscrive | `finance_extractions` immutabile: un trigger rifiuta `update` e `delete` **anche al service role**, che è il ruolo con cui gira il worker |
| Le correzioni si aggiungono, non sostituiscono | `finance_corrections` append-only, elenco **chiuso** di campi. Un valore malformato viene **rifiutato all'ingresso**, non salvato per poi non comparire |
| Una correzione si firma con il proprio nome | il guardiano **rifiuta** (`finance_correction_author_mismatch`) invece di riscrivere l'autore in silenzio |
| I valori effettivi sono uno solo | `finance_refresh_effective` ricalcola per intero la proiezione da estrazione + correzioni; il client non ha permesso di scrittura sulle `eff_*` e il guardiano annulla qualunque altra scrittura |
| Nessun totale che sommi valute diverse | `finance_summary` restituisce **una riga per valuta**. Una fattura senza valuta viene contata ma il suo totale resta `null` |
| Il duplicato si sospetta, mai si fonde | l'impronta è `null` se manca uno dei quattro elementi, e il sospetto si **calcola** in lettura invece di essere memorizzato — archiviare la controparte lo fa sparire da solo |
| I verbali non sono scrivibili dal browser | `revoke all` **prima** dei `grant` (lezione della 0014), e la migrazione lo **verifica** prima di dirsi riuscita |
| Nei log solo identificativi e codici | mai IBAN, riferimenti, fornitori, importi, né il messaggio grezzo di un errore — che può contenere il valore che ha violato un vincolo |

**Lo standard QR-fattura, verificato il 2026-07-27**: Swiss Implementation
Guidelines di SIX, versione **2.4 del 24.02.2026** (valida dal 14 novembre 2026)
letta e verificata, versione **2.3 del 21.11.2025** in vigore e valida fino a
novembre 2027. Il lettore le tratta allo stesso modo perché fra le due la
struttura non cambia. ⚠️ **La decodifica dell'immagine del codice QR non è
implementata**: la pipeline non ha un rasterizzatore e sul percorso `native_pdf` il
file non arriva nemmeno al server. I dati di pagamento vengono quindi dal **testo**
e la loro provenienza è `deterministic`, non `qr`; dove c'è un indizio di
QR-fattura senza payload leggibile si alza la bandiera `qr_not_read`. Il punto
unico da aggiornare quando esce una versione nuova è `SPEC` in `qrbill.ts`.

**Le aliquote IVA sono un DATO, non una costante**: `finance_vat_rates` con
validità, fonte e data di verifica — 8.1 % / 2.6 % / 3.8 % dal 1.1.2024, fonte
AFC/ESTV, verificate il 2026-07-27. Sono **suggerimenti, non un validatore**:
un'aliquota fuori elenco è accettata. Le aliquote **storiche non sono state
seminate** perché non verificate su fonte primaria.

⚠️ **Configurazione manuale necessaria**: il segreto `FINANCE_WORKER_SECRET` (con
la stessa stringa nel Vault come `finance_worker_secret`) e il job cron che chiama
`finance-worker` con `timeout_milliseconds := 150000`. Senza, la coda non viene mai
letta e gli elementi restano `pending` per sempre.

Documento completo: **`docs/finance-operations.md`**.

### Chiedi ad AI-Swisse (Company Assistant) — migrazioni 0027, 0029 e 0031

> **In esercizio dal 2026-07-30.** Migrazioni `0027`, `0029` e `0031` applicate,
> Edge Function pubblicata e verificata end-to-end. Alla prima valutazione con
> verità di riferimento: **16 domande su 16**, 2,3 strumenti e 2,1 fonti per
> domanda.
>
> La `0031` pianifica la retention: `assistant-purge`, ogni notte alle 04:00,
> chiama `assistant_purge_expired(180)`. Fino ad allora la funzione esisteva ed
> era chiusa a chiunque non fosse il ruolo di servizio, ma non la chiamava
> nessuno — e una retention che nessuno esegue è una riga di documentazione.

Una domanda sola invece di cinque schermate: «quali fatture scadono nei prossimi
dieci giorni?», «da quale email è arrivata questa fattura?», «qual è il preavviso
del contratto Swisscom, e la data è verificata?».

La regola che governa il modulo è una: **nessuna risposta aziendale senza dati
accessibili e citabili**. Da lì discende tutto il resto.

- **Sola lettura.** Non esiste uno strumento di scrittura nel registro, quindi
  non esiste una domanda che ne provochi una. Niente «Crea attività», niente
  «Disdici», niente «Paga» — la stessa regola per cui i Contratti non disdicono
  e le Finanze non pagano.
- **Nessuno strumento generico.** Niente `query_database`, niente SQL generato
  dal modello. Ventiquattro strumenti tipizzati, uno per dominio, con schema
  d'ingresso chiuso. **Nessuno accetta `companyId` o `userId`**: sono i due
  parametri che deciderebbero *di chi* sono i dati, e li deriva il server dalla
  sessione.
- **I permessi non si applicano: non si possono aggirare.** Le letture passano
  dalle RPC del prodotto, che sono `SECURITY INVOKER`, **con il client
  dell'utente**. Il ruolo di servizio scrive la risposta e non legge mai un dato
  aziendale.
- **Le citazioni non si inventano.** Ogni riga letta riceve un riferimento opaco
  (`f1`, `f2`…) e il modello vede solo quello: gli identificativi restano nel
  server. Un riferimento che nessuno strumento ha prodotto viene scartato.
- **Gli importi e le date si verificano.** Per le risposte che toccano denaro o
  scadenze, un controllo deterministico confronta ogni valore scritto con quelli
  realmente letti; se non tornano, la risposta viene declassata a parziale e lo
  dichiara.
- **Nessuna ricerca semantica**, e la decisione è misurata, non supposta: al
  2026-07-30 il corpus è di 18 documenti tutti in italiano, e `pgvector` non è
  installata. Il confronto a tre vie e le condizioni per rifarlo stanno in
  [`docs/company-assistant-search-eval.md`](docs/company-assistant-search-eval.md).
- **Nessun ragionamento del modello viene memorizzato**, e nessuna delle sei
  tabelle nuove contiene un dato aziendale: domande, risposte e riferimenti.

⚠️ È il primo punto del prodotto che risponde **in flusso** (`text/event-stream`):
una domanda che attraversa più moduli impiega secondi, e in quei secondi
l'utente deve vedere che cosa sta succedendo e poter interrompere.

Documento completo: [`docs/company-assistant.md`](docs/company-assistant.md).

### Registro attività — migrazione 0039

Chi ha fatto che cosa, in ordine di tempo, per tutta l'azienda: `/registro`,
riservato a titolari e amministratori. Chiude una promessa che la vetrina faceva
e che il prodotto manteneva solo a metà — risalire a ciò che il sistema aveva
letto e a chi ha corretto che cosa era vero per le analisi documento (0010) e
per l'Inbox (0013), e per nient'altro.

- **Non è una seconda fonte di verità.** `task_events`, `contract_events`,
  `crm_events`, `email_audit_log` e `analysis_corrections` restano i proprietari
  dei loro fatti: là c'è il dettaglio, qui l'indice trasversale. Perché non
  possano divergere, `audit_logs` **non viene scritta da nessun servizio**: la
  scrivono i TRIGGER delle tabelle che possiedono il fatto, nella stessa
  transazione della scrittura che lo produce — la regola già adottata dalla 0020.
- **Il client non ha alcun permesso di scrittura**, e non è una convenzione:
  `revoke all` precede la sola `grant select`, perché su Supabase i privilegi
  predefiniti dello schema `public` concedono tutto ad `anon` e `authenticated`.
- **Non si modifica**, e il divieto vale anche per il service role: è un trigger.
  Non si **cancella** perché nessun ruolo applicativo ha `delete` — e non per un
  trigger, che renderebbe le aziende indistruttibili (lezione della 0023). Una
  riga muore solo con la sua azienda.
- **Dodici eventi e nient'altro**: documento caricato ed eliminato, analisi
  avviata / conclusa / fallita, correzione manuale, risposta generata, attività
  creata e modificata, persona aggiunta e rimossa, ruolo cambiato. L'elenco è un
  enum, quindi un tredicesimo evento non entra per distrazione.
- **Che cosa NON entra mai nel payload**: token, password, segreti e contenuto
  di documenti. I campi pubblicati sono una lista di AMMESSI scritta a mano in
  ogni trigger, non una lista di vietati: una colonna nuova su una tabella
  sorvegliata non finisce nel registro perché nessuno l'ha ammessa. Di una
  correzione si registra **quale campo** è stato corretto, non i due valori —
  che sono dati letti dal documento e restano in `analysis_corrections`.

Provato da `npm run test:audit-unit` (offline) e `npm run test:audit` (DB reale,
con i negativi espliciti: né titolare, né membro, né chiave anon, né service role
modificano o cancellano una riga).

## Comandi

### La suite, in un comando solo

I trenta comandi qui sotto restano tutti validi e si possono ancora eseguire uno
per uno. Ma l'elenco non diceva la cosa che conta di più — **che cosa serve per
eseguirli** — e chi non lo sapeva a memoria doveva scegliere fra eseguire tutto
(e pagare credito Anthropic) o eseguire a caso. `scripts/run-test-suite.mjs`
raggruppa i test per **requisito**, non per modulo.

```bash
npm run test:quality    # typecheck, build, docs, i18n, bundle SQL — nessuna credenziale
npm run test:unit       # tutte le suite offline — nessuna credenziale, nessuna rete
npm run test:db         # le suite che servono UN database col nostro schema — in locale
                        #   è quello di .env.test, nella CI è un Supabase effimero
npm run test:production # le tre che provano QUEL progetto: configurazione auth, catalogo
                        #   vero, Edge Function deployate. Si RIFIUTA di girare su localhost
npm run test:all        # quality + unit + db + production (NON ciò che spende credito)
npm run ci              # quality + unit: ciò che una CI può eseguire senza segreti
npm run test:integration -- --allow-ai   # phase2, async, pipeline — SPENDONO credito
npm run test:eval -- --allow-ai          # eval:subsidy, eval:admin, eval:assistant — SPENDONO
npm run suite -- --list                  # i gruppi, i passi e ciò che ciascuno richiede
```

⚠️⚠️ **UN GRUPPO SALTATO ESCE NON-ZERO (codice 3), dal 2026-08-01.** Prima
usciva **0** stampando `ESITO: verde sui gruppi eseguiti · 1 SALTATI`: il salto
era dichiarato, ma le due cose che un lettore guarda per prime — il codice di
uscita e la parola «verde» — dicevano entrambe «a posto». Il 2026-07-31
`npm run test:integration` senza `--allow-ai` è uscito 0 in un millisecondo
senza eseguire un passo, e quel non-risultato è finito in `product-status.md`
come se le 71 asserzioni fossero passate. Dichiarare il salto **non bastava**.

I tre codici, e la differenza fra i due non-zero:

| Codice | Significa |
|---|---|
| **0** | tutto ciò che era stato chiesto è stato eseguito, e nessun gruppo è rosso |
| **1** | almeno un gruppo è **ROSSO**: un test ha fallito |
| **3** | nessun rosso, ma **qualcosa non è stato eseguito**. Non è un difetto del prodotto: è una misura che manca |

La parola «verde» non compare **mai** su una riga di riepilogo che parla di un
salto — nemmeno con `--allow-skip`, dove l'esito si chiama `INCOMPLETO`.
`npm run suite -- --self-test` prova questa decisione sui casi che devono farla
fallire, «gruppo saltato» compreso, e gira dentro `test:unit`.

⚠️ **UN PASSO NON ESEGUIBILE NON È UN PASSO FALLITO, dal 2026-08-03.** Un passo
che esce 3 dentro un gruppo senza rossi rendeva il gruppo **ROSSO**, con
`1 su 6 falliti` — mentre nessun controllo aveva fallito. Mandava a cercare un
difetto dove c'era un ambiente incompleto, che è lo stesso genere di bugia che
questo runner esiste per non dire. Ora quel gruppo è **`INCOMPL`**, il riepilogo
nomina il passo, l'uscita resta 3, e gli altri gruppi vengono comunque eseguiti.

```bash
npm run ci -- --root ~/swiss-ai-suite-repo
```

⚠️ **Serve perché `docs:check` verifica la tabella dei moduli contro il README
della RADICE**, che vive nel monorepo: da `~/swiss-ai-suite-app` non esiste, e
due dei cinque controlli non sono eseguibili. Senza `--root`, `npm run ci` esce
**3** e lo dichiara; con `--root` il controllo è completo anche dalla directory
di sviluppo. Dal monorepo non serve niente. ⚠️ Ripiegare sul README dell'app
**non** è un'opzione: non contiene la tabella dei moduli, e il controllo
segnalerebbe come mancanti Calendario, Contratti e l'Assistente — falsi rossi al
posto di un verde falso.

Opzioni: `--continue-on-error` prosegue dopo un rosso (uso locale; senza, ci si
ferma al primo, che è la modalità CI) · `--allow-skip` accetta che un gruppo non
eseguito non faccia uscire non-zero, per chi sa che cosa **non** ha provato ·
`--no-skip` resta accettato ed è oggi il comportamento predefinito (la CI lo
passa esplicitamente in tre job).

⚠️ **Non si è invertito il default di `--allow-ai`**, che era l'altra strada
possibile: eseguire per difetto e chiedere un flag per *non* spendere avrebbe
reso `npm run test:all` una spesa involontaria. Ciò che era rotto non era il
salto — era il verde che lo accompagnava.

⚠️ **Prima di ogni gruppo che scrive, il runner stampa CONTRO QUALE database sta
per farlo** — l'host, mai le chiavi. Undici di quelle suite creano e cancellano
righe, e «ho lanciato `test:db`» e «ho lanciato `test:db` contro la produzione»
sono due frasi diverse. L'host non è un segreto: sta nel bundle pubblicato come
`VITE_SUPABASE_URL`.

⚠️ **`db` e `production` sono separati perché rispondono a domande diverse.**
`db` chiede «il prodotto funziona?» e gli basta un database qualunque con il
nostro schema: nella CI è un Supabase **effimero** avviato dal runner, quindi
quelle undici suite girano **a ogni pull request, senza segreti**, anche da un
fork. `production` chiede «quel progetto è configurato bene?» — configurazione
di autenticazione, catalogo vero, Edge Function deployate — e su un database
effimero passerebbe senza provare niente: per questo si **rifiuta** di girare
se `SUPABASE_URL` punta a `127.0.0.1`, invece di dare un verde vuoto.

### I comandi singoli

```bash
npm run dev             # server di sviluppo (5174)
npm run build           # typecheck + build di produzione
npm run typecheck       # type-check di TUTTO: app + Edge Function (i due tsconfig)
npm run typecheck:app        # solo src/ e scripts/ (tsconfig.json)
npm run typecheck:functions  # solo supabase/functions/ (tsconfig.functions.json).
                             # ⚠️ Config separato perché le funzioni girano su Deno:
                             # `"types": []` toglie i globali di Node, che là non
                             # esistono. Vedi «Il typecheck delle Edge Function».
npm run test:phase1     # integrazione Fase 1 su DB reale (26 test)
npm run test:phase2     # immutabilità snapshot + sicurezza + analisi reale (36 test)
npm run test:async      # processing asincrono reale, non simulato (17 test)
npm run test:functions  # sicurezza di generate-reply e interpret-project (12 test)
npm run test:pipeline   # end-to-end analisi → persistenza → task → bozza (18 test)
npm run eval:admin      # eval qualità analisi su documenti reali (35 test)
npm run eval:subsidy    # eval interpretazione progetto (14 test)
npm run eval:contracts             # estrazione contrattuale su TRE CONTRATTI VERI (it/de/fr):
                                   # tasso di esattezza per campo. Crea un'azienda tecnica,
                                   # la misura e la cancella verificando la cancellazione.
                                   # -- --local esegue la pipeline qui invece di attendere il worker
npm run eval:contracts:self-test   # prova il metro del confronto, offline
npm run test:validate   # regole di governance del validatore, offline (28 test)
npm run test:uid        # validazione numero IDI, funzione pura (26 test)
npm run test:routing    21  NUOVO il 2026-07-30. Le guardie di rotta come funzione PURA
                        (`components/layout/routeGate.ts`). Chiude il difetto per cui un
                        indirizzo profondo aperto A FREDDO finiva sulla Panoramica passando
                        per l'onboarding: `loading: false` non significa «ho guardato», e la
                        guardia leggeva quel falso come una risposta. 64 combinazioni.
npm run test:ai-json-parser-unit  # Il parser CONDIVISO dell'output dei modelli, offline. Estrazione
                        # SINTATTICA soltanto: scanner bilanciato con stato di stringa e di escape,
                        # recinti markdown, testo prima E DOPO l'oggetto. Non ripara JSON invalido,
                        # non trasforma un array in un oggetto, non restituisce mai `{}`. Tre parser
                        # degradati girano come CONTROPROVE a ogni esecuzione. (72 test)
npm run test:inbox-unit # Inbox offline: XSS, normalizzazione, adapter, crypto, ripresa (151 test)
npm run test:tasks-unit # Attività offline: scadenze, ritardo, ordinamento, etichette (35 test)
npm run test:tasks      # Attività su DB: isolamento, assegnazione, autore, completamento
npm run test:inbox      # Inbox su DB reale: RLS, isolamento, permessi, vincoli
npm run test:documents-unit  # Documenti offline: stati, ricerca, estratti, indirizzo (60 test)
npm run test:documents       # Documenti su DB: isolamento della RICERCA, categorie, etichette, archivio
npm run test:calendar-unit   # Calendario e notifiche offline: stato desiderato, promemoria con ora
                             # legale, idempotenza degli adapter, griglia del mese (158 test)
npm run test:calendar        # Calendario su DB: isolamento fra aziende E FRA PERSONE, coda, trigger
npm run test:notification-email          # Invio VERO al provider di posta. Esce 3 se i due secret
                                         # NOTIFICATION_EMAIL_* non ci sono: saltato ≠ verde
npm run test:notification-email:self-test  # prova il controllo stesso, offline
npm run test:workflows-unit  # Automazioni offline: registro, validazione, operatori, logica a tre
                             # valori, valute, incertezza, modelli di testo, frase (112 test)
npm run test:workflows       # Automazioni su DB: esegue il MOTORE VERO — outbox, idempotenza,
                             # cicli, profondità della catena, guardie (richiede la 0020)
npm run test:finance-unit    # Finanze offline: importi esatti, date ambigue, cifre di controllo,
                             # QR-fattura, validazione dell'estrazione, contratto (202 test)
npm run test:finance         # Finanze su DB: immutabilità del verbale, correzioni, proiezione,
                             # duplicati, valute mai sommate (95 test — richiede la 0021)
npm run test:contracts-unit  # Contratti offline: periodi nelle quattro lingue, ancoraggi del
                             # preavviso, derivabilità, date ambigue, citazioni, prompt injection,
                             # coerenza fra gli elenchi dichiarati in TypeScript e in SQL (89 test)
npm run test:contracts       # Contratti su DB: isolamento, cross-tenant su documenti e attività,
                             # immutabilità della versione verificata, correzioni append-only,
npm run test:crm-unit        # CRM offline: la copia SQL↔TypeScript dei domini pubblici, la cifra
                             #   di controllo dell'IDI, il filtro anti-rumore dei mittenti, i
                             #   pareggi dell'abbinamento, la chiave di idempotenza del
                             #   candidato scritta due volte, nessuna somma fra valute (132 casi)
                             # aritmetica delle date sui casi limite, amendment che non sovrascrive
                             # (66 test — richiede la 0024 e la 0025)
npm run test:subsidy-unit    # Incentivi offline: gli operatori dei criteri e soprattutto QUANDO
                             #   non rispondono (un confronto impossibile vale `null`, mai `false`:
                             #   `false` su un obbligatorio dichiara non idonea un'impresa che lo è),
                             #   l'esclusione non attivata che NON è un requisito fallito, il
                             #   progetto avviato che si segnala invece di sparire, l'urgenza che
                             #   non nasce da testo libero, la guardia SSRF sulle fonti, e gli
                             #   elenchi scritti due volte in TS e in SQL (176 casi)
npm run test:subsidy         # Incentivi su DB: isolamento fra aziende anche chiamando le quattro
                             #   funzioni di lettura col p_company_id altrui, cross-tenant che
                             #   nemmeno il service role attraversa, catalogo in sola lettura,
                             #   risposte append-only firmate dal database, e soprattutto LA
                             #   CASCATA — una risposta rendeva l'azienda indistruttibile finché
                             #   non sono arrivate la 0033 e la 0034. Dalla sezione 11 esegue anche
                             #   IL MOTORE VERO (runMatching) (richiede 0032+0033+0034)
npm run test:audit-unit      # Registro attività offline: gli enum scritti due volte in SQL e in
                             #   TypeScript, ogni azione e ogni campo con la sua etichetta nelle
                             #   tre lingue, e soprattutto LA SANIFICAZIONE — quali colonne i
                             #   trigger pubblicano davvero, letta dalla migrazione e non
                             #   dichiarata a mano (74 casi)
npm run test:audit           # Registro attività su DB: ogni evento previsto produce la sua riga
                             #   senza che il client la chieda, i valori di una correzione e il
                             #   testo di una risposta NON ci entrano, un membro non amministratore
                             #   legge zero righe, e i negativi espliciti — né titolare, né membro,
                             #   né chiave anon, né service role modificano o cancellano una riga.
                             #   Più la cascata: un'azienda con registro resta cancellabile
                             #   (richiede la 0039)
npm run subsidy:seed-catalog # scrive il CATALOGO 2.0: fonti ufficiali, versioni immutabili,
                             #   criteri tipizzati e call. Dry-run senza `-- --write`. ⚠️ Non
                             #   sostituisce `subsidy:seed`, che scrive l'identità dei programmi
npm run test:assistant-unit  # Chiedi ad AI-Swisse offline: il PERIMETRO degli strumenti (nessuna
                             #   query generica, nessun companyId accettato dal modello, nessun
                             #   segreto), l'aritmetica delle date con ora legale e mezzanotte
                             #   svizzera, le citazioni che non si possono inventare, l'ancoraggio
                             #   di importi e date, ciò che NON esce dagli esecutori (122 casi)
npm run test:assistant       # Chiedi ad AI-Swisse su DB: isolamento fra aziende, privatezza della
                             #   conversazione anche fra colleghi, revoca dell'accesso, nessuna
                             #   risposta fabbricata dal client, messaggi immutabili, quota per
                             #   persona (richiede la 0027)
npm run eval:assistant       # valutazione con VERITÀ DI RIFERIMENTO: 16 domande su dati noti,
                             #   esito atteso, fonti attese, frasi vietate. Costa denaro vero
npm run subsidy:health  # integrità e freschezza del catalogo incentivi, E la CODA DI REVISIONE.
                        #   ⚠️ VERDE VUOL DIRE «NIENTE IN SOSPESO», dal 2026-08-05:
                        #     exit 0  niente in sospeso
                        #     exit 1  c'è lavoro per una PERSONA — programmi da ricontrollare
                        #             o revisioni in coda, a qualunque età
                        #     exit 2  errori di integrità, o coda oltre 30 giorni / 25 schede
                        #   Prima la coda veniva solo nominata e l'uscita restava 0: sette
                        #   revisioni sono rimaste ferme sei giorni sotto la parola «verde».
npm run subsidy:health:self-test   # verifica che il GIUDIZIO sulla coda e l'ESITO sappiano
                        #   diventare rossi: 14 casi, compresa la regola vecchia come controprova
npm run subsidy:seed    # popola/aggiorna il catalogo. ⚠️ Senza --write NON scrive ed esce 3
                        #   («non eseguito»): un no-op che esce 0 è un fallback silenzioso, e la
                        #   CI ci è già cascata una volta
npm run db:bundle       # rigenera supabase/full-setup.sql dalle migrazioni (--check per verificare).
                        # Rifiuta di generare se una migrazione usa un valore enum appena aggiunto,
                        # o se crea un trigger/una policy senza «drop … if exists» che li preceda —
                        # anche quando il nome è fra virgolette, che è il caso che gli era sfuggito
npm run db:bundle -- --self-test   # verifica che il CONTROLLO stesso riconosca i propri casi noti
npm run check:auth -- https://app.ai-swisse.com   # configurazione Auth: i link inviati per email
                        #   portano a QUEL dominio? ⚠️ IL DOMINIO VA INDICATO. Senza argomento
                        #   esce 2 e non verifica niente: fino al 2026-08-01 ripiegava su
                        #   http://localhost:5174 e usciva ZERO dicendo «i link porteranno lì» —
                        #   vero, e su una domanda diversa da quella che conta
npm run check:auth -- --local      # la macchina di sviluppo, dichiarata invece che indovinata
npm run check:auth:self-test       # verifica che il CONTROLLO si rifiuti quando non sa rispondere
npm run inbox:diagnose  # «perché questa casella non si aggiorna»: stati, sync run, conteggi.
                        # Solo metadati tecnici: mai oggetti, mittenti o contenuti
npm run i18n:coverage   # testo d'interfaccia scritto a mano nel codice (esce 1 se ne trova)
npm run i18n:coverage -- --self-test   # verifica che il RILEVATORE stesso funzioni
npm run i18n:typography # spazi insecabili (U+202F) prima dei segni doppi francesi
npm run i18n:typography -- --self-test
npm run test:operations # ogni Edge Function ha un invocante? ogni scheduler è inventariato,
                        #   dichiara il timeout di pg_net e punta a una funzione che esiste?
npm run test:operations -- --self-test  # verifica che il CONTROLLO sappia fallire (11 casi)
npm run verify:deploy   # l'altra metà: quegli scheduler esistono DAVVERO nel progetto?
                        #   Richiede SUPABASE_ACCESS_TOKEN e FALLISCE se non ce l'ha:
                        #   «non ho potuto verificare» non è un verde. Fuori da test:all
                        #   di proposito — giudica l'ambiente, non il codice.
npm run docs:check      # la documentazione descrive il codice che c'è davvero? Confronta i README
                        # con il filesystem: moduli, migrazioni, documenti, comandi, Edge Function.
                        # Esce 1 se divergono, e dice COSA manca e DOVE. ⚠️ Il controllo sui moduli
                        # ha bisogno del README della radice: eseguilo dal monorepo
npm run docs:check -- --self-test      # verifica che il CONTROLLO sappia fallire (12 casi)
```

Gli script che toccano il DB o l'AI richiedono `.env.test` (copia da `.env.test.example`).
Creano dati reali e li rimuovono alla fine.

### Il typecheck delle Edge Function

Due `tsconfig`, non uno, e `npm run typecheck` li esegue entrambi.

**Perché due.** `tsconfig.json` descrive i due mondi che esistono davvero nel
repository — il browser (`src/`) e Node (`scripts/`) — e concede a entrambi i
tipi di Node. Le Edge Function girano su **Deno**, dove `process`, `Buffer` e
`require` non esistono: compilarle con i globali di Node avrebbe dichiarato
valido del codice che a runtime non parte. `tsconfig.functions.json` ha quindi
`"types": []` e la sola libreria standard del web, che è ciò che Deno offre.
Misurato prima di scegliere: sotto `supabase/functions/` non c'è un solo
`node:`, `process.env`, `Buffer` o `require(`.

**Che cosa risolve.** Fino al 2026-08-04 un file di `supabase/functions/` entrava
nel typecheck **solo se qualcosa in `src/` o `scripts/` lo importava**: 25 file su
103 non erano compilati da nessuno, fra cui gli `index.ts` di **tutte e 19** le
Edge Function. È così che è passato inosservato un `composeEmail` senza
destinatario. Ora la copertura è per **appartenenza alla cartella**, non per
raggiungibilità: un file nuovo è coperto dal momento in cui esiste.

**I due file di dichiarazioni**, e perché stanno dove stanno:
- `scripts/deno-modules.d.ts` spiega a TypeScript gli specificatori `jsr:` e
  `npm:`. È incluso da **entrambi** i config — una seconda copia divergerebbe
  senza che nulla diventi rosso.
- `types/deno-globals.d.ts` dichiara `Deno.env.get` e `Deno.serve`, ed è incluso
  **solo** dal config delle funzioni. Se lo vedesse anche quello principale,
  scrivere `Deno.env.get(…)` in uno script Node passerebbe il typecheck e
  fallirebbe a runtime. La superficie è minima di proposito: c'è dentro solo ciò
  che le funzioni usano davvero.

⚠️ **Che cosa NON prova**, dichiarato: verifica la **forma**, non l'ambiente. Il
runtime resta quello di Supabase, la versione nello specificatore `npm:…@2` non
è confrontata con quella di `node_modules`, e la sola prova che una funzione
GIRA è eseguirla.

## Test — cosa coprono

- **`test:audit-unit` (74)** — Registro attività offline. Il controllo per cui il file esiste è
  **la sanificazione**: quali colonne i trigger della 0039 pubblicano davvero, estratte dalla
  migrazione invece che dichiarate a mano, e confrontate con una lista di ammessi. Più gli enum
  scritti due volte (SQL e TypeScript), un'azione dichiarata che nessun trigger produce, le
  etichette nelle tre lingue, i filtri in URL (un tipo inesistente diventa «tutti», non un elenco
  vuoto senza spiegazione) e `changes` malformato, che si scarta invece di mostrarsi a metà.
  Controprove eseguite: aggiungendo una colonna proibita a un trigger falliscono 3 controlli;
  togliendo un valore all'enum SQL ne fallisce 1; e rinominando `audit_pair` il file dice «la
  migrazione non pubblica nessun campo» invece di passare a vuoto.
- **`test:audit` (DB — richiede la 0039)** — che le garanzie siano IN VIGORE, non descritte: ogni
  evento previsto nasce dal database anche quando il client non fa nulla per registrarlo; i valori
  di una correzione e il testo di una risposta non entrano nel payload; un membro non
  amministratore legge zero righe; **nessun utente modifica o cancella** (titolare, membro, chiave
  anon) e **nemmeno il service role modifica**; e la cascata — un'azienda con registro resta
  cancellabile, che è la trappola della 0023.

- **`test:phase1` (26)** — onboarding, documenti, Storage privato, task, pratiche, **RLS cross-tenant**
  (B non legge/scarica/scrive nulla di A), cascade delete, nessun accesso senza sessione, persistenza dopo re-login.
- **`test:phase2` (36)** — autorizzazione via membership (403 cross-tenant), 401/400/422, **rate limit** (429),
  analisi reale end-to-end con verifica che **tutte** le citazioni esistano nel testo, persistenza della provenienza.
- **`test:calendar-unit` (156)** — le decisioni che si sbagliano in silenzio: lo **stato desiderato**
  di un evento (compresa la distinzione fra «non deve esserci» e «non si può toccare», che salva il
  calendario di chi ha solo un token scaduto), i **promemoria attraverso il cambio dell'ora legale**,
  la deduplicazione, l'**idempotenza degli adapter** contro un provider finto (un 409 di Google non
  crea un secondo evento), e l'**assenza** dei metodi che leggerebbero i calendari personali.
  Controprove eseguite: rimettendo i difetti, 2, 6 e 1 controlli falliscono.
- **`test:calendar` (DB)** — isolamento fra aziende e, per la prima volta, **fra persone della stessa
  azienda**: due colleghi non si leggono le notifiche, non si vedono le connessioni, non si toccano
  le preferenze. Più: token irraggiungibili, notifiche non fabbricabili, coda del solo server,
  coalescenza del trigger (otto modifiche → una riga), prenotazione atomica della coda.
- **`test:pipeline` (18)** — il flusso completo del *Definition of Done*: analisi → persistenza → re-login → task → bozza.
- **`eval:admin` (35)** — qualità su documenti reali (AVS tedesco, AFC francese, Comune italiano) e **casi difficili**:
  nessuna scadenza → `null`; scadenza relativa → nessuna data inventata; due importi → array corretto;
  ente ambiguo → `null` + incertezza; rischio esplicito vs assente; **prompt injection ignorata**; documento quasi vuoto.
- **`eval:subsidy` (14)** — interpretazione progetto, evidence verbatim, governance (mai dichiarare idoneità).
- **`test:functions` (12)** — le due Edge Function che non avevano test: metodo, autenticazione, input,
  **cross-tenant 403** e **rate limit 429** su `generate-reply` e `interpret-project`. Non consuma crediti:
  tutti i casi vengono rifiutati prima della chiamata al modello.
- **`test:validate` (28)** — le regole di governance provate **senza rete e senza crediti**, con output di modello
  costruiti ad arte: scadenza con citazione falsa → marcata da verificare; azione senza citazione → declassata a
  suggerimento; rischi espliciti prima degli inferiti; importo dovuto scelto correttamente e tipizzato; ente ambiguo →
  null + incertezza; valori fuori range normalizzati; output vuoto che non produce dati dal nulla.
- **`test:inbox-unit` (151)** — i livelli dell'Inbox che decidono la sicurezza, provati **offline**:
  dodici vettori XSS reali (`<script>`, `onerror`, `iframe`, `javascript:`, SVG, form, pixel di
  tracciamento, tag spezzato) di cui non resta traccia nel testo; URL validati da un parser e non da un
  pattern; normalizzazione RFC 2047, indirizzi, storico citato con le sue condizioni di rinuncia;
  politica sugli allegati e **riconoscimento dai byte** (un eseguibile rinominato `.pdf` e dichiarato
  `application/pdf` viene respinto); pre-classificazione conservativa (posta di massa **con** un indizio
  amministrativo NON viene fermata); prompt injection nel corpo che non altera l'esito; adapter Google e
  Microsoft che da payload diversi producono lo **stesso** modello; cifratura dei token con AAD, IV
  irripetuto e rilevamento delle manomissioni.
- **`test:crm-unit` (132)** — le decisioni del CRM che si sbagliano in silenzio. La più
  importante: legge la migrazione 0026 ed estrae l'elenco dei domini pubblici di
  `crm_is_public_domain`, confrontandolo con la costante TypeScript — due copie della stessa
  regola divergono, e il typecheck non guarda dentro l'SQL. Sorveglia anche che il file non
  contraddica se stesso (nessuna colonna insieme «timbrata dal database» e concessa al client),
  che i punti di Gmail e il `+tag` NON vengano rimossi da un indirizzo, che un IDI con la cifra
  di controllo errata non identifichi nessuno, e che i valori di valute diverse non si sommino.
  Dalla 0030 confronta anche la **chiave di idempotenza** del candidato automatico — composta
  una volta in SQL e una in `suggestionKey()` — perché due forme diverse riempirebbero l'elenco
  «da verificare» di copie senza rompere nulla di visibile.
- **`test:finance-unit` (202)** — le decisioni finanziarie che si sbagliano in silenzio, provate
  **offline**: le quattro convenzioni di importo che convivono su una scrivania svizzera lette con
  aritmetica **esatta** (`0.10 + 0.20` fa `0.30`), due valute che non si sommano mai e un importo senza
  valuta che resta senza valuta; `02.03.2026` **dichiarata ambigua** invece di essere risolta; le cifre
  di controllo di IBAN, riferimento QR a 27 cifre, ISO 11649 e IDI; l'**esempio ufficiale delle Swiss
  Implementation Guidelines v2.4** letto senza violazioni, con la prova che ogni regola *può* fallire;
  un tentativo di prompt injection nel documento che non sposta di un centesimo i valori strutturati;
  e il **contratto letto dal file SQL della 0021** — l'elenco dei campi correggibili e ogni bandiera di
  qualità con la sua frase nei tre dizionari. Ogni sezione porta almeno una controprova.
- **`test:finance` (95 asserzioni)** — richiede la 0021 applicata. ⚠️ Fino al 2026-07-31 questa
  riga diceva «non ancora eseguito»: la suite gira ed è verde. I conteggi qui sotto invecchiano —
  il numero vero lo dà `npm run test:db`, non questo elenco.
  Prova le garanzie sul database vero: il verbale immutabile che si affianca invece di riscriversi, la
  correzione umana che vince con la firma di chi la scrive, la proiezione `eff_*` che si ricalcola e
  che il guardiano non annulla, il duplicato **calcolato** e mai fuso, due valute che restano due righe,
  le note di credito che non gonfiano il «da pagare», e il **doppione dichiarato** della cifra di
  controllo dell'IBAN fra SQL e TypeScript confrontato su una matrice.
- **`test:inbox`** — i permessi VERI del database: A non vede né tocca nulla di B; i segreti non sono
  raggiungibili nemmeno dall'owner; dal client si può cambiare solo `seen_at` e «metti via», e il
  ripristino ricalcola lo stato dalla classificazione ignorando il valore inviato; i duplicati sono
  respinti dai vincoli, non da un `if`.

## Sicurezza

- **RLS** attiva su tutte le tabelle aziendali: si accede a una risorsa solo se si è membri della sua company.
  Policy basate su funzioni `SECURITY DEFINER` (`is_company_member`, `is_company_admin`, `is_case_member`) per evitare ricorsione.
- Le Edge Function **non si fidano della RLS client-side**: ogni lettura di autorizzazione avviene con un
  client autenticato *come l'utente*, quindi un non-membro riceve 403. Nessuna logica di permessi duplicata.
  Le sole **scritture** su `document_analyses` e `document_extractions` usano un secondo client con
  `service_role` (0010), perché il client autenticato non ha più quei permessi: il bypass della RLS è
  circoscritto alla persistenza e agisce su identificativi già validati dalla lettura precedente.
- **Rate limit** per azienda sugli endpoint AI: la quota è verificata e consumata in modo **atomico**
  (funzione SQL con lock per azienda), quindi richieste concorrenti non possono superarla tutte insieme.
  Se la migrazione 0009 non è applicata si ricade sul conteggio semplice, senza garanzia di atomicità.
- **Limiti di upload** imposti dal bucket (dimensione e tipi MIME): il client non può aggirarli dichiarando
  una dimensione falsa. Per l'OCR il limite è ricontrollato sulla dimensione **reale** del file scaricato.
- **Prompt injection**: il documento è trattato come *dato non fidato*, racchiuso fra marcatori; istruzioni
  contenute nel file non modificano comportamento, schema o policy.
- **Data minimization**: al provider AI va solo il contesto aziendale utile (nome, cantone, comune, forma, settore).
- Storage: bucket **privato**, accesso via signed URL, policy per membership sul primo segmento del path.
- La `service_role` non è mai nel frontend.

### Immutabilità dell'analisi (0010)

`document_analyses` è uno **snapshot**: una volta scritto non si modifica. Il vincolo è nel database,
non nella documentazione — il client non ha il permesso di `update` né di `delete` sulla tabella,
quindi non è aggirabile chiamando l'API Supabase direttamente con la chiave anon, che è pubblica
per costruzione.

Fino alla 0009 non era così. Per permettere all'utente di spuntare la checklist e di salvare la
bozza di risposta, la 0002 concedeva `update` e `delete` sull'intera tabella a ogni membro: un
membro poteva quindi riscrivere scadenza, mittente e importi di un'analisi, cioè proprio i campi su
cui poggia la promessa di verificabilità. Lo stato dell'utente è stato separato:

| Cosa | Dove sta ora |
|---|---|
| spunte della checklist | `action_progress` — `done_by` e `done_at` li scrive un trigger, non il client, quindi una spunta non è attribuibile a un collega né databile a piacere |
| bozza di risposta | `document_replies` |
| correzioni ai campi estratti | `analysis_corrections`, append-only (già dalla 0006) |

`document_extractions` — il testo su cui si verificano le citazioni (§20) — è in **sola lettura** per
il client: poterlo riscrivere avrebbe permesso di far «verificare» una citazione che il documento non
contiene.

Verificato da `npm run test:phase2`, che tenta davvero l'`update`, il `delete` e la scrittura del
testo estratto come membro autenticato, e controlla che lo snapshot resti intatto.

### Programmi sospesi: esistono ma non sono ottenibili (0011)

Un incentivo può essere documentato, corretto in ogni dettaglio e ciononostante **non concedibile**,
perché la legge lo subordina a una condizione che oggi non ricorre. È il caso dell'incentivo
ticinese all'assunzione di disoccupati (L-rilocc, RL 857.100): l'art. 3 lo attiva solo se il tasso
di disoccupazione medio dell'anno precedente raggiunge il riferimento fissato dal Consiglio di
Stato, con massimale del 4%. Il tasso ticinese è sotto quella soglia.

Il catalogo aveva solo `active` (mostrarlo o no) e `data_status` (quanto è affidabile il dato):
nessuno dei due esprime «esiste ma non si ottiene». Spegnere `active` lo fa sparire — e l'utente non
sa che esiste né che può tornare; lasciarlo attivo lo presenta come disponibile, che è falso. Da qui
una terza informazione:

| Campo | Domanda a cui risponde |
|---|---|
| `active` | lo mostriamo? |
| `data_status` | quanto è affidabile il dato? |
| `availability` | è concedibile **oggi**? |

Un programma sospeso resta visibile con il motivo e la fonte che lo attesta, ma non compare fra le
«Priorità di oggi», non è conteggiato fra le idoneità da verificare, ha priorità bassa e viene
ordinato in fondo ai risultati. `npm run subsidy:health` tratta una sospensione **senza motivo o
senza fonte** come errore di integrità, e ne richiede la riverifica ogni 120 giorni, perché dipende
da una statistica annuale.

### Modalità `deterministic`: lo snapshot non è probatorio

In modalità `ai` — il default, e ciò che gira in produzione — l'analisi è prodotta e persistita
**server-side**: il client non la scrive mai.

In modalità `deterministic` (§60) l'analisi è invece prodotta nel browser dal motore locale e
inserita dal client. Questo `insert` resta consentito ma **vincolato**: `engine` deve dichiarare il
motore locale e i campi di provenienza AI (`provider`, `model`, `prompt_version`) devono restare
vuoti. Un membro non può quindi fabbricare una riga che, riletta, sembrerebbe prodotta dal modello —
ma **può** creare un'analisi locale con contenuto arbitrario.

Va detto esplicitamente: **in modalità `deterministic` lo snapshot non ha valore probatorio.**
Attesta ciò che il browser ha calcolato, non ciò che un servizio indipendente ha osservato.

Non spostarla dietro una Edge Function è una scelta, non una dimenticanza: quella modalità esiste
perché il contenuto del documento **non venga trasmesso** — l'estrazione e l'analisi avvengono nel
browser e il testo pieno non viene nemmeno salvato in `document_extractions`. Metterla sul server
significherebbe inviare comunque il documento in rete, cancellando la ragione per cui esiste, in
cambio di una garanzia che il default (`ai`) offre già. Chi ha bisogno di uno snapshot probatorio
usa la modalità AI; chi sceglie il motore locale sta scegliendo riservatezza, e ora sa cosa scambia.

### Inbox: token, scope e webhook

I token OAuth delle caselle collegate stanno in `email_connection_secrets`, **cifrati con
AES-256-GCM** con una chiave che vive come secret della Edge Function e **non nel database**. La
tabella non ha alcuna policy e nessun `GRANT` al ruolo `authenticated`: un client con la chiave anon
non la raggiunge in nessun modo, nemmeno con un `select('*')` scritto per errore. L'AAD della
cifratura è l'id della connessione, quindi un ciphertext spostato su un'altra riga non si decifra.

Gli scope richiesti sono di **sola lettura** — `gmail.readonly` per Google, `Mail.Read` per
Microsoft — e il contratto dell'adapter non contiene alcun metodo di scrittura: inviare, cancellare
o spostare un messaggio non è impedito da una nostra regola, è impossibile con il token che abbiamo.

Dal client si possono scrivere **due sole colonne** di `email_messages`: `seen_at` e
`attention_status`. Oggetto, mittente, corpo, classificazione e impronta della fonte sono il verbale
di ciò che è arrivato e non sono riscrivibili. ⚠️ Questo vale **dalla 0014**: la 0013 concedeva i
permessi di colonna senza revocare prima quelli di tabella, e su Supabase ogni tabella nuova di
`public` nasce con i permessi completi per `authenticated` — quindi la restrizione non restringeva
nulla e un membro poteva riscrivere l'oggetto di un messaggio. Trovato da `npm run test:inbox` alla
prima esecuzione sul database reale. **Regola generale del progetto: su `public` un permesso di
colonna non significa niente senza un `revoke all` che lo preceda.**

Gli endpoint webhook sono pubblici per definizione e vengono autenticati nel codice: **firma OIDC**
verificata contro le chiavi pubbliche di Google per Pub/Sub, `clientState` confrontato a **tempo
costante** per Microsoft Graph. Ogni evento è idempotente per vincolo unico sull'impronta.

L'HTML dei messaggi **non viene conservato**: il corpo è ridotto a testo server-side da un
tokenizzatore, quindi non esiste HTML non fidato da sanificare al momento del render e nessuna
immagine remota può essere caricata. Dettagli e modello di minaccia in `docs/ai-inbox.md`.

## Privacy

- In modalità `ai` **il testo del documento viene inviato all'API di Anthropic**: è il compromesso necessario
  per l'analisi reale. `deterministic` mantiene tutto dentro Supabase. Da dichiarare nell'informativa privacy.
- **Non** vengono loggati: testo completo, PDF, contenuti nelle analytics o negli error log del client.
  Il log tecnico contiene solo `document_id`, `company_id`, stato, durata, provider, token, codice errore.
- L'eliminazione di un documento rimuove file, estrazione e analisi collegate (cascade).

## Limitazioni attuali (dichiarate, non nascoste)

- **Automazioni: lo stato sta in [`docs/product-status.md`](docs/product-status.md).**
  ⚠️ Fino al 2026-07-31 questa riga negava che la schermata fosse online, mentre il README della
  radice la dava per online: una delle due era falsa da settimane, e nessun controllo poteva
  vederlo, perché tutti e cinque verificavano che le cose *esistessero* — non che le affermazioni
  su di esse fossero vere. Ora lo stato di ogni modulo è dichiarato **in un posto solo**, e
  `docs:check` fallisce se un altro documento lo contraddice.
  Il limite che resta, e che è un limite e non uno stato:
  ⚠️ Il **budget di tempo** non è mai stato messo sotto pressione: le esecuzioni provate trattavano
  un evento alla volta. Il comportamento con decine di eventi in coda si vedrà al primo carico vero,
  e il rapporto del worker lo dichiara (`timeBudgetReached`).
- **Le automazioni non hanno azioni ad alto rischio, e non hanno un percorso di approvazione.**
  Il campo `riskLevel` esiste su ogni azione e il motore esegue automaticamente solo quelle `low`;
  il flusso di approvazione umana non è implementato, e per questo non esiste nessuna azione che ne
  avrebbe bisogno. Nessuna azione invia email, muove denaro, accetta impegni o cancella qualcosa.
- **Le esecuzioni che NON corrispondono non lasciano traccia** (scelta deliberata: con novecento
  documenti l'anno seppellirebbero le venti volte in cui la regola ha agito). Conseguenza da sapere:
  «la regola non è scattata e non capisco perché» si risponde con la **prova a vuoto**, non con lo
  storico.
- **Processing asincrono senza coda persistente**: la richiesta ritorna subito (202) e il lavoro
  prosegue sul server (background task del runtime Edge), con lo stato osservabile nel DB. Non c'è
  una *coda durevole*: se l'istanza muore a metà — il runtime Edge chiude la richiesta a 150 secondi
  e il `finally` non gira — il lavoro **non riprende da solo**. Dal 2026-07-29 però non resta
  nemmeno appeso: `recoverStuckAnalyses`, che gira nella manutenzione periodica, dopo venti minuti
  chiude il documento come `failed` con codice `INTERRUPTED` **e scrive la riga di analisi
  corrispondente** — senza quella la schermata direbbe «non ancora analizzato», cioè un tentativo
  bruciato travestito da lavoro mai cominciato. Da lì c'è il pulsante «Riprova».
  ⚠️ Non si ritenta da soli di proposito: un'analisi costa una chiamata al modello, e riprovare
  senza sapere *perché* si è interrotta rischia di rifarlo all'infinito. Per volumi elevati
  servirebbe comunque una vera job queue (pg_cron / worker dedicato).
- **Viewer PDF senza highlighting a coordinate**: il PDF originale viene renderizzato e «Mostra nel
  documento» porta alla **pagina** della citazione, mostrando il passaggio accanto. L'evidenziazione
  esatta della riga esiste solo nella vista testo, dove la citazione è verificata carattere per carattere.
- **Nessuna politica di conservazione delle analisi**: dalla 0010 il client non può più cancellarle,
  quindi rianalizzare un documento accumula righe e vince la più recente (la panoramica ne mostra una
  sola per documento). È voluto, ma lo storico cresce e prima o poi va deciso per quanto conservarlo.
- **Calendario esterno: mai provato contro le API vive.** Gli adapter Google e Microsoft sono
  allineati alla documentazione ufficiale corrente, non a una risposta reale — la stessa distinzione
  già dichiarata per Zefix, e vale la stessa cautela. Le migrazioni 0018 e 0019 sono applicate e
  `npm run test:calendar` è verde, ma nessuna connessione OAuth reale è mai stata stabilita —
  e soprattutto i suoi due scheduler NON esistono nel progetto: vedi `docs/product-status.md`
  e `npm run verify:deploy`.
- **Le notifiche non seguono per cascata la cancellazione di un'attività**: `entity_id` è polimorfico
  e non ha una chiave esterna. Nella pratica non succede — nulla nell'applicazione cancella una
  task, si archiviano — e cascatano comunque su azienda e utente.
- **Spegnere le notifiche in AI-Swisse spegne anche le email**: la consegna è appesa alla notifica,
  quindi l'email è una copia dell'avviso in-app e non un canale indipendente. La schermata delle
  impostazioni lo scrive, invece di lasciare due interruttori che sembrano scollegati e non lo sono.
- **Un'attività cancellata davvero** (non archiviata) lascia l'evento orfano presso il provider: la
  cascata rimuove il collegamento e con esso l'unica informazione su dove cercarlo. Le attività si
  archiviano, e l'archiviazione passa dal percorso normale che l'evento lo rimuove.
- **`tasks.due_date` è una DATA, non un istante**: gli eventi sul calendario esterno sono di giornata
  intera. Inventare un orario — le 9, le 17 — significherebbe scrivere nel calendario di una persona
  un'informazione che nessuno ha mai dato. Quando esisterà un vero `due_at`, cambierà in un punto solo.
- **Nessuna politica di conservazione** per notifiche, consegne email ed esecuzioni di
  sincronizzazione: si accumulano, come le analisi dalla 0010.
- **Registro IDI (Zefix)**: **attivo dal 2026-07-28** — credenziali rilasciate dall'UFRC, secret
  `ZEFIX_AUTH` impostato, catena provata contro l'API viva (dettagli misurati nel commento in testa
  a `supabase/functions/lookup-company/index.ts`, che è l'unico posto dove questo stato è raccontato).
  Senza il secret l'onboarding resta manuale e lo dichiara.
  I limiti che **restano**, e che non dipendono da noi:
  l'API **non pagina** — restituisce tutti i risultati (95 per «Rossi»), il taglio a 15 è nostro;
  la ricerca per nome **non restituisce il cantone**, che arriva solo dal dettaglio per IDI, quindi
  cercando per nome il campo resta vuoto e lo compila la persona;
  l'UFRC **sconsiglia le interrogazioni di massa regolari** (la sola app web ne genera oltre 400'000
  al giorno, e chi disturba viene bloccato): la ricerca resta legata a un gesto in onboarding.
  ⚠️ I cantoni fuori dai sei di `CANTONI` diventano «Altro» nel modulo: è il perimetro del catalogo
  incentivi, non un dato che Zefix non abbia dato.
  ⚠️ **Zefix non è Regix**: quest'ultimo è il servizio dell'UFRC per verificare la disponibilità
  del NOME di una ditta nuova — altre credenziali, nessuna API pubblica, non utilizzabile qui.
- **Catalogo incentivi**: 7 programmi verificati sulle fonti ufficiali (0 in stato `recheck`), di cui
  **1 sospeso** — vedi sotto. Copertura Confederazione + Ticino, non 26 Cantoni.
- **Contenuti del catalogo solo in italiano**: l'interfaccia è tradotta, ma i testi dei programmi
  (requisiti, descrizione del contributo, finestra di domanda) sono mostrati in italiano anche in
  tedesco e francese, perché vivono nel database e non nei dizionari. Si nota subito con un utente
  germanofono o romando.
- **Traduzioni riviste internamente, non da un madrelingua indipendente.** L'interfaccia è completa
  in italiano, tedesco e francese (`npm run i18n:coverage` → nessun testo scritto a mano) e i
  dizionari sono garantiti dal compilatore. Il 2026-07-26 il titolare ha deciso di non
  commissionare una rilettura esterna: i testi sono stati rivisti con i controlli che si possono
  verificare — «ss» al posto di «ß», terminologia federale, forma di cortesia costante, coerenza dei
  termini chiave, ricerca di calchi dall'italiano, confronto delle lunghezze per scovare omissioni —
  e le correzioni trovate sono state applicate (fra cui «Incitation», calco dall'italiano
  «incentivo», che in francese significa istigazione).
  **Il limite resta e va detto**: chi ha riletto è lo stesso strumento che ha scritto, quindi un
  errore di registro o una formulazione innaturale che sia coerente con sé stessa non emerge da
  nessuno di questi controlli. Se un cliente germanofono o romando segnala che «suona straniero»,
  è quello il segnale che manca. Prima del lancio è consigliata una rilettura professionale,
  soprattutto del disclaimer legale.
- **Inbox — in esercizio con Google, non utilizzabile da clienti reali.**
  ⚠️ Fino al 2026-07-27 questa riga diceva che l'Inbox «non è attiva in produzione»: era rimasta
  indietro e contraddiceva `docs/ai-inbox.md`, che nel frattempo raccontava lo stato vero. La
  correzione è stata anche strutturale — **lo stato operativo dell'Inbox si racconta in UN SOLO
  posto**, `docs/ai-inbox.md`, e qui resta solo ciò che è un limite. Due sedi che descrivono lo
  stesso fatto divergono, e nessuno se ne accorge finché qualcuno non le legge di fila.
  Il limite che resta è **esterno e pesante**: `gmail.readonly` è uno scope riservato e fuori dalla
  modalità «Test» Google impone una verifica dell'app con valutazione di sicurezza di terzi (CASA).
  Oggi possono collegarsi solo gli indirizzi elencati come utenti di prova: **un cliente reale non
  può collegare la propria casella.** Microsoft è implementato ma non configurato, e
  l'applicazione lo dichiara invece di fallire.
  **Notifiche push implementate ma non attivate**, per scelta motivata e non per lavoro incompleto:
  richiedono un account di fatturazione su Google Cloud, e senza di esse l'attesa massima è la
  cadenza dello scheduler — un quarto d'ora — su comunicazioni con termini che si misurano in
  settimane. Motivazione, conseguenze e passaggi per accenderla: `docs/ai-inbox.md` §4.4 e §12.
  **Non coperti da test automatici** e verificabili solo collegando una casella vera: il flusso
  OAuth reale, l'arrivo di una notifica push e lo scollegamento. Dei tre, i primi due percorsi sono
  stati provati sul campo il 2026-07-27 fino all'analisi; **notifica push e scollegamento no**.
  La posta acquisita non viene mai cancellata automaticamente e scollegare una casella non elimina
  i dati già importati.
- **Non implementati**: Stripe/pagamenti, interfaccia fiduciaria
  completa, fine-tuning.
  ⚠️ Fino al 2026-07-27 questo elenco comprendeva anche le **notifiche push**, che invece sono
  implementate e solo non attivate (vedi il punto sull'Inbox qui sopra). «Non fatto» e «fatto, non
  acceso per decisione» sono stati diversi, ed è lo stesso errore che il catalogo incentivi evita
  con il campo `availability`: un programma sospeso non è né assente né disponibile. Confonderli
  fa sottovalutare ciò che manca davvero — qui, la verifica CASA di Google.

## Disclaimer

AI-Swisse è uno **strumento di supporto amministrativo**. Le analisi sono generate automaticamente
e **non sostituiscono la consulenza legale, fiscale o fiduciaria**. Quando il sistema non è sicuro lo
segnala e invita a una verifica manuale; importi, requisiti e scadenze vanno confermati sulla fonte ufficiale.
