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
  migrations/   0001_core · 0002_documents · 0003_subsidy · 0004_tasks
                0005_storage · 0006_admin_ai_pipeline · 0007_subsidy_programs
                0008_analysis_truth · 0009_quota_and_upload_limits
                0010_analysis_immutability · 0011_program_availability
                0012_program_translations · 0013_inbox · 0014_inbox_grants
  functions/
    _shared/           cervello AI condiviso Edge/test (schema, prompt, validate, pipeline, persist,
                       extract) + email/ (adapter provider, normalizzazione, classificazione, sync)
    analyze-document   estrazione/OCR + analisi + persistenza server-side
    generate-reply     bozza di risposta on-demand
    interpret-project  interpretazione progetto per il Subsidy AI
    lookup-company     proxy Registro IDI (Zefix)
    email-oauth        consenso e callback OAuth delle caselle di posta
    email-sync         sincronizzazione e analisi su richiesta
    email-webhook      notifiche push Google Pub/Sub e Microsoft Graph
    email-disconnect   scollegamento di una casella
    email-maintenance  rinnovo sottoscrizioni, riconciliazione, pulizia
src/
  lib/            supabase, env, errori, hash (SHA-256), uid (IDI), formattazione
  types/          database.ts (schema) · models.ts (dominio)
  services/       auth · company · document · analysis · task · subsidy · reply
                  correction · program · interpret · companyLookup · emailConnection · inbox
  contexts/       AuthContext · CompanyContext (multi-tenant, nessuna company hardcoded)
  features/       auth · companies · admin-ai · subsidy-ai · tasks · dashboard · archive · pricing · inbox
scripts/          test-phase1 · test-phase2 · test-async · test-pipeline · test-inbox · test-inbox-unit
                  eval-admin-ai
                  eval-subsidy · test-validate · test-uid · seed-subsidy-programs · subsidy-catalog-health
                  subsidy-translations (contenuti de/fr) · check-auth-config · bundle-migrations
docs/             design-system.md · revisione-traduzioni.md · ai-inbox.md
```

## Setup

### 1) Progetto Supabase
Su [supabase.com](https://supabase.com) crea un progetto. Da **Project Settings → API** annota
`Project URL`, chiave `anon`/`publishable`, chiave `service_role` (quest'ultima **solo** per i test locali).

### 2) Migrazioni
**Opzione A — SQL Editor:** incolla ed esegui `supabase/full-setup.sql` (contiene tutte le migrazioni in
ordine; è un file **generato** — si rigenera con `npm run db:bundle`), oppure esegui in ordine i singoli
file di `supabase/migrations/`.

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
| `documents` | metadati, `file_hash` (dedup), `page_count`, stato |
| `document_extractions` | testo per pagina, `extraction_method`, confidence OCR |
| `document_analyses` | analisi: campi query-critical + JSONB (actions, amounts, risks, evidence, uncertainties) + provenienza (`provider`, `model`, `prompt_version`, `schema_version`, timestamp, `error_code`). **Immutabile**: dalla 0010 il client ha solo `select` e un `insert` vincolato al motore locale — niente `update`, niente `delete` |
| `action_progress` | spunte della checklist: una riga per azione spuntata, con autore e momento assegnati dal database. Sta qui, e non dentro l'analisi, perché è uno stato dell'utente |
| `document_replies` | bozze di risposta, modificabili e persistenti — **unica sede** della bozza corrente, sia AI sia motore locale |
| `analysis_corrections` | correzioni umane **append-only**: l'analisi AI non viene mai riscritta |
| `tasks` | scadenziario (creato solo su conferma dell'utente) |
| `subsidy_programs`, `subsidy_matches`, `subsidy_cases` | catalogo incentivi + attività utente |
| `ai_request_log` | osservabilità e rate limit — **senza contenuto del documento** |

Stati documento: `uploaded → extracting → analyzing → completed | needs_review | failed`.
Lo stato arriva **fino alla UI**: un'analisi `failed` non viene mai resa come un risultato (niente mittente o
tipo "di default"), e un tentativo fallito non cancella un'analisi valida ottenuta in precedenza.

## Comandi

```bash
npm run dev             # server di sviluppo (5174)
npm run build           # typecheck + build di produzione
npm run typecheck       # solo type-check
npm run test:phase1     # integrazione Fase 1 su DB reale (26 test)
npm run test:phase2     # immutabilità snapshot + sicurezza + analisi reale (36 test)
npm run test:async      # processing asincrono reale, non simulato (17 test)
npm run test:functions  # sicurezza di generate-reply e interpret-project (12 test)
npm run test:pipeline   # end-to-end analisi → persistenza → task → bozza (18 test)
npm run eval:admin      # eval qualità analisi su documenti reali (35 test)
npm run eval:subsidy    # eval interpretazione progetto (14 test)
npm run test:validate   # regole di governance del validatore, offline (28 test)
npm run test:uid        # validazione numero IDI, funzione pura (26 test)
npm run test:inbox-unit # Inbox offline: XSS, normalizzazione, adapter, crypto (148 test)
npm run test:inbox      # Inbox su DB reale: RLS, isolamento, permessi, vincoli
npm run subsidy:health  # integrità e freschezza del catalogo incentivi
npm run subsidy:seed    # popola/aggiorna il catalogo (idempotente; --write per scrivere)
npm run db:bundle       # rigenera supabase/full-setup.sql dalle migrazioni (--check per verificare)
npm run check:auth      # verifica la configurazione Auth del progetto (redirect dei link email)
npm run i18n:coverage   # testo d'interfaccia scritto a mano nel codice (esce 1 se ne trova)
npm run i18n:coverage -- --self-test   # verifica che il RILEVATORE stesso funzioni
```

Gli script che toccano il DB o l'AI richiedono `.env.test` (copia da `.env.test.example`).
Creano dati reali e li rimuovono alla fine.

## Test — cosa coprono

- **`test:phase1` (26)** — onboarding, documenti, Storage privato, task, pratiche, **RLS cross-tenant**
  (B non legge/scarica/scrive nulla di A), cascade delete, nessun accesso senza sessione, persistenza dopo re-login.
- **`test:phase2` (23)** — autorizzazione via membership (403 cross-tenant), 401/400/422, **rate limit** (429),
  analisi reale end-to-end con verifica che **tutte** le citazioni esistano nel testo, persistenza della provenienza.
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
- **`test:inbox-unit` (148)** — i livelli dell'Inbox che decidono la sicurezza, provati **offline**:
  dodici vettori XSS reali (`<script>`, `onerror`, `iframe`, `javascript:`, SVG, form, pixel di
  tracciamento, tag spezzato) di cui non resta traccia nel testo; URL validati da un parser e non da un
  pattern; normalizzazione RFC 2047, indirizzi, storico citato con le sue condizioni di rinuncia;
  politica sugli allegati e **riconoscimento dai byte** (un eseguibile rinominato `.pdf` e dichiarato
  `application/pdf` viene respinto); pre-classificazione conservativa (posta di massa **con** un indizio
  amministrativo NON viene fermata); prompt injection nel corpo che non altera l'esito; adapter Google e
  Microsoft che da payload diversi producono lo **stesso** modello; cifratura dei token con AAD, IV
  irripetuto e rilevamento delle manomissioni.
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

- **Processing asincrono senza coda persistente**: la richiesta ritorna subito (202) e il lavoro
  prosegue sul server (background task del runtime Edge), con lo stato osservabile nel DB. Non c'è
  però una *coda durevole*: se l'istanza muore a metà, il documento resta in `analyzing` finché non
  si rilancia l'analisi. Per volumi elevati servirebbe una vera job queue (pg_cron / worker dedicato).
- **Viewer PDF senza highlighting a coordinate**: il PDF originale viene renderizzato e «Mostra nel
  documento» porta alla **pagina** della citazione, mostrando il passaggio accanto. L'evidenziazione
  esatta della riga esiste solo nella vista testo, dove la citazione è verificata carattere per carattere.
- **Nessuna politica di conservazione delle analisi**: dalla 0010 il client non può più cancellarle,
  quindi rianalizzare un documento accumula righe e vince la più recente (la panoramica ne mostra una
  sola per documento). È voluto, ma lo storico cresce e prima o poi va deciso per quanto conservarlo.
- **Registro IDI (Zefix)**: implementato, ma richiede credenziali API rilasciate su richiesta
  (`zefix@bj.admin.ch`); senza `ZEFIX_AUTH` l'onboarding resta manuale e lo dichiara.
  ⚠️ Gli endpoint sono stati **corretti il 2026-07-27** contro il documento OpenAPI ufficiale
  (2.7.2.3): la versione precedente chiamava `/api/v1/firm/*`, rotte inesistenti, e avrebbe
  risposto 404 anche con credenziali valide. **Il codice non è però ancora stato provato contro
  l'API viva**, perché le credenziali non sono state rilasciate: è allineato a una specifica, non
  a una risposta reale. Alla prima chiamata vera vanno riverificati corpo accettato, campi
  presenti e numero di risultati.
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
- **Inbox**: il codice è completo e verificato offline, ma **non è attiva in produzione** finché non
  vengono configurate le credenziali dei provider (vedi `docs/ai-inbox.md`). Lo scope Gmail richiesto
  è riservato: fuori dalla modalità «Test» Google impone una verifica dell'app con valutazione di
  sicurezza di terzi. Il flusso OAuth reale, le notifiche push reali e il rinnovo delle sottoscrizioni
  non sono coperti da test automatici: richiedono credenziali di provider e si verificano collegando una
  casella vera. La posta acquisita non viene mai cancellata automaticamente e scollegare una casella non
  elimina i dati già importati.
- **Non implementati**: invio email, calendar sync, notifiche push, Stripe/pagamenti,
  interfaccia fiduciaria completa, fine-tuning.

## Disclaimer

AI-Swisse è uno **strumento di supporto amministrativo**. Le analisi sono generate automaticamente
e **non sostituiscono la consulenza legale, fiscale o fiduciaria**. Quando il sistema non è sicuro lo
segnala e invita a una verifica manuale; importi, requisiti e scadenze vanno confermati sulla fonte ufficiale.
