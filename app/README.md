# SwissAI Suite — App SaaS

SaaS per PMI svizzere con due moduli: **Swiss Admin AI** (analisi di documenti
amministrativi IT/DE/FR) e **Swiss Subsidy AI** (matching incentivi Confederazione +
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
                0008_analysis_truth
  functions/
    _shared/           cervello AI condiviso Edge/test (schema, prompt, validate, pipeline, persist)
    analyze-document   estrazione/OCR + analisi + persistenza server-side
    generate-reply     bozza di risposta on-demand
    interpret-project  interpretazione progetto per il Subsidy AI
    lookup-company     proxy Registro IDI (Zefix)
src/
  lib/            supabase, env, errori, hash (SHA-256), uid (IDI), formattazione
  types/          database.ts (schema) · models.ts (dominio)
  services/       auth · company · document · analysis · task · subsidy · reply
                  correction · program · interpret · companyLookup
  contexts/       AuthContext · CompanyContext (multi-tenant, nessuna company hardcoded)
  features/       auth · companies · admin-ai · subsidy-ai · tasks · dashboard · archive · pricing
scripts/          test-phase1 · test-phase2 · test-async · test-pipeline · eval-admin-ai
                  eval-subsidy · test-validate · test-uid · seed-subsidy-programs · subsidy-catalog-health
```

## Setup

### 1) Progetto Supabase
Su [supabase.com](https://supabase.com) crea un progetto. Da **Project Settings → API** annota
`Project URL`, chiave `anon`/`publishable`, chiave `service_role` (quest'ultima **solo** per i test locali).

### 2) Migrazioni
**Opzione A — SQL Editor:** esegui **in ordine** il contenuto di `supabase/migrations/0001…0008`.

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

## Variabili d'ambiente

| Variabile | Dove | Scopo |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env` (frontend) | URL del progetto |
| `VITE_SUPABASE_ANON_KEY` | `.env` (frontend) | Chiave pubblica; la sicurezza vera è la RLS |
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
- **Azioni**: `extracted` (richiesta dal documento) vs `suggested` (consiglio operativo di SwissAI),
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

## Database

Separazione netta, mai sovrascritta: **file originale** (Storage) / **testo estratto**
(`document_extractions`) / **analisi** (`document_analyses`).

| Tabella | Ruolo |
|---|---|
| `companies`, `company_members`, `company_profiles` | multi-tenant, ruoli, profilo operativo |
| `documents` | metadati, `file_hash` (dedup), `page_count`, stato |
| `document_extractions` | testo per pagina, `extraction_method`, confidence OCR |
| `document_analyses` | analisi: campi query-critical + JSONB (actions, amounts, risks, evidence, uncertainties) + provenienza (`provider`, `model`, `prompt_version`, `schema_version`, timestamp, `error_code`) |
| `document_replies` | bozze di risposta, modificabili e persistenti |
| `analysis_corrections` | correzioni umane **append-only**: l'analisi AI resta immutabile |
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
npm run test:phase2     # sicurezza + analisi reale via Edge Function (23 test)
npm run test:async      # processing asincrono reale, non simulato (17 test)
npm run test:pipeline   # end-to-end analisi → persistenza → task → bozza (18 test)
npm run eval:admin      # eval qualità analisi su documenti reali (35 test)
npm run eval:subsidy    # eval interpretazione progetto (14 test)
npm run test:validate   # regole di governance del validatore, offline (28 test)
npm run test:uid        # validazione numero IDI, funzione pura (26 test)
npm run subsidy:health  # integrità e freschezza del catalogo incentivi
npm run subsidy:seed    # popola/aggiorna il catalogo (idempotente; --write per scrivere)
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
- **`test:validate` (28)** — le regole di governance provate **senza rete e senza crediti**, con output di modello
  costruiti ad arte: scadenza con citazione falsa → marcata da verificare; azione senza citazione → declassata a
  suggerimento; rischi espliciti prima degli inferiti; importo dovuto scelto correttamente e tipizzato; ente ambiguo →
  null + incertezza; valori fuori range normalizzati; output vuoto che non produce dati dal nulla.

## Sicurezza

- **RLS** attiva su tutte le tabelle aziendali: si accede a una risorsa solo se si è membri della sua company.
  Policy basate su funzioni `SECURITY DEFINER` (`is_company_member`, `is_company_admin`, `is_case_member`) per evitare ricorsione.
- Le Edge Function **non si fidano della RLS client-side**: leggono con un client autenticato *come l'utente*,
  quindi un non-membro riceve 403. Nessuna logica di permessi duplicata.
- **Rate limit** per azienda sugli endpoint AI, con log in `ai_request_log`.
- **Prompt injection**: il documento è trattato come *dato non fidato*, racchiuso fra marcatori; istruzioni
  contenute nel file non modificano comportamento, schema o policy.
- **Data minimization**: al provider AI va solo il contesto aziendale utile (nome, cantone, comune, forma, settore).
- Storage: bucket **privato**, accesso via signed URL, policy per membership sul primo segmento del path.
- La `service_role` non è mai nel frontend.

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
- **Registro IDI (Zefix)**: implementato, ma richiede credenziali API rilasciate su richiesta
  (`zefix@bj.admin.ch`); senza `ZEFIX_AUTH` l'onboarding resta manuale e lo dichiara.
- **Catalogo incentivi**: 7 programmi verificati sulle fonti ufficiali; 3 cantonali marcati `recheck`
  perché variano per decreto. Copertura Confederazione + Ticino, non 26 Cantoni.
- **Non implementati**: invio email, calendar sync, notifiche push, Stripe/pagamenti,
  interfaccia fiduciaria completa, fine-tuning.

## Disclaimer

SwissAI Suite è uno **strumento di supporto amministrativo**. Le analisi sono generate automaticamente
e **non sostituiscono la consulenza legale, fiscale o fiduciaria**. Quando il sistema non è sicuro lo
segnala e invita a una verifica manuale; importi, requisiti e scadenze vanno confermati sulla fonte ufficiale.
