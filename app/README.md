# SwissAI Suite — App SaaS (Fase 1)

Base SaaS reale per SwissAI Suite (moduli **Swiss Admin AI** e **Swiss Subsidy AI**),
costruita su **Supabase** (Auth + PostgreSQL + Storage + Row Level Security).
Design e flussi del prototipo HTML sono preservati; il motore Admin AI resta
deterministico e i programmi Subsidy AI restano dati demo (nessuna AI/OCR reale in questa fase).

## Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Supabase (Auth, PostgreSQL, Storage privato, RLS)
- **Architettura**: UI ⟷ `contexts` ⟷ `services` ⟷ Supabase. La UI non chiama mai Supabase direttamente.

## Struttura

```
supabase/migrations/   0001_core · 0002_documents · 0003_subsidy · 0004_tasks · 0005_storage
src/
  lib/            client Supabase, env, errori, formattazione
  types/          database.ts (generated-style) · models.ts (dominio)
  services/       auth · company · document · analysis · task · subsidy
  contexts/       AuthContext · CompanyContext (activeCompanyId, multi-tenant ready)
  components/     ui/ (Icon, Toast, stati) · layout/ (AppShell, guards, nav)
  features/       auth · companies (onboarding) · admin-ai · subsidy-ai · tasks · dashboard · archive · pricing
scripts/          test-phase1.mjs (test d'integrazione TEST 1–7)
```

## Setup

### 1) Crea un progetto Supabase
Su [supabase.com](https://supabase.com) crea un progetto. Annota da **Project Settings → API**:
`Project URL`, chiave `anon public`, chiave `service_role` (quest'ultima **solo** per i test locali).

### 2) Applica le migrazioni
**Opzione A — SQL Editor (più semplice):** apri il SQL Editor del progetto ed esegui, **in ordine**,
il contenuto di `supabase/migrations/0001…0005`.

**Opzione B — Supabase CLI:**
```bash
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
```

### 3) Configura il frontend
```bash
cp .env.example .env
# imposta VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run dev            # http://localhost:5174
```

### 4) (Opzionale) Auth email
Di default Supabase può richiedere la conferma email. Per provare rapidamente, in
**Authentication → Providers → Email** puoi disattivare "Confirm email" in ambiente di sviluppo.

## Comandi

```bash
npm run dev          # server di sviluppo
npm run build        # typecheck + build di produzione
npm run typecheck    # solo type-check
npm run test:phase1  # test d'integrazione Fase 1 (richiede .env.test)
npm run test:phase2  # test analisi AI (richiede la Edge Function deployata)
```

## Test d'integrazione (TEST 1–7)

```bash
cp .env.test.example .env.test    # imposta URL, ANON e SERVICE_ROLE
npm run test:phase1
```

Lo script crea due utenti reali (via service_role, **solo lato script/locale**), esegue i flussi e
li rimuove alla fine. Copre:

1. Registrazione → onboarding azienda → dashboard (profilo, membership owner, company_profile).
2. Documento → file in Storage privato → record `documents` → analisi in `document_analyses` → visibile in archivio.
3. Attività → persiste dopo re-login.
4. Pratica incentivo (+ item) → persiste dopo logout/login.
5. **RLS cross-tenant**: l'utente B non legge documenti/analisi/task/pratiche/azienda di A, non scarica i file di A, non inserisce in azienda A.
6. Eliminazione documento → file rimosso da Storage + record + analisi (cascade).
7. Nessuna sessione → nessun accesso ai dati protetti.

## Sicurezza / RLS

- RLS attiva su **tutte** le tabelle aziendali. Regola: si accede a una risorsa **solo** se si è membri della sua company.
- Le policy usano funzioni `SECURITY DEFINER` (`is_company_member`, `is_company_admin`, `is_case_member`) per evitare ricorsione.
- L'onboarding usa l'RPC atomica `create_company_with_owner` (azienda + membership owner + profilo).
- Storage: bucket **privato** `company-documents`, accesso via signed URL, policy per membership sul primo segmento del path (`company_id/…`).
- La `service_role` non è mai nel frontend: solo `.env.test` (gitignored) per lo script di test.

## Cosa è stato verificato in questo ambiente

- ✅ `tsc --noEmit` — 0 errori.
- ✅ `vite build` — build di produzione riuscita.
- ✅ Avvio dev server e render dell'app (schermata di configurazione senza `.env`).
- ⏳ **TEST 1–7 contro DB reale**: da eseguire con `npm run test:phase1` sul **tuo** progetto Supabase
  (non era possibile provisionare Supabase in questo ambiente: nessun Docker/CLI/credenziali).

## Adattamenti rispetto al prototipo (dichiarati, non simulati)

- **Testo originale documenti**: NON salvato nel DB (requisito privacy #5/#20). Il file sta in Storage;
  la vista Admin AI ricostruisce il testo scaricandolo (evidenzia le citazioni; degrada alle sole «citazioni» se non disponibile).
- **Scadenze**: stato `open`/`completed` (come da schema #8), invece dei 3 stati del prototipo.
- **Tipo pratica** (candidatura/preliminare/riferimento): salvato in `eligibility_snapshot` (lo schema #10 non prevede una colonna dedicata).
- **Etichette/urgenza analisi**: ri-derivate a lettura dai campi persistiti (nessun dato ridondante nel DB).

## Fase 2 — Analisi AI reale (Claude)

Il motore deterministico è ora affiancato da un'analisi con **Claude Opus 4.8**. La UI non cambia:
`analysisService.analyzeAndPersist()` restituisce la stessa forma qualunque sia il motore.

### Architettura

La chiave API Anthropic **non può stare nel frontend** (finirebbe nel bundle). L'analisi gira quindi
in una **Supabase Edge Function** (`supabase/functions/analyze-document`) che:

1. richiede un JWT valido;
2. **riusa la RLS per autorizzare** — legge il documento con un client autenticato *come l'utente*:
   se non è membro della company, la query non restituisce nulla → 403. Nessuna logica di permessi duplicata;
3. chiama Claude con **structured outputs** (schema JSON forzato) + adaptive thinking;
4. restituisce l'analisi. La chiave resta un secret del server.

### La garanzia "non inventa dati"

Il modello deve restituire **citazioni verbatim** dal documento. Il client (`src/features/admin-ai/aiMapping.ts`)
**verifica ogni citazione** contro il testo reale e, se non la ritrova:

- scarta l'evidenza (una citazione non verificabile non viene mai mostrata);
- **declassa** un'azione da `extracted` a `suggested`;
- **declassa** un rischio da `explicit` a `possible`;
- aggiunge una nota fra le incertezze.

Gli offset per l'evidenziazione nel documento non vengono mai presi dal modello: sono ricalcolati localmente.

### Attivazione (2 passi legati al tuo account)

**1. Deploy della Edge Function**
```bash
npx supabase login && npx supabase link --project-ref <IL_TUO_PROJECT_REF>
npx supabase functions deploy analyze-document
```

**2. Chiave Anthropic come secret** (creala su [console.anthropic.com](https://console.anthropic.com)):
```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```
In alternativa dal dashboard: **Edge Functions → Secrets**. La chiave **non** va nel `.env` del frontend.

Poi verifica:
```bash
npm run test:phase2
```

### Modalità del motore (`VITE_ANALYSIS_PROVIDER`)

| Valore | Comportamento |
|---|---|
| `auto` (default) | Prova l'AI; se non disponibile ricade sul motore locale e lo segnala all'utente |
| `ai` | Solo AI: se la funzione non risponde, l'analisi fallisce (nessun risultato "finto") |
| `deterministic` | Solo motore locale — **nessun contenuto lascia Supabase** |

Il chip "Analisi AI" / "Motore locale" nella scheda risultato dichiara sempre quale motore ha prodotto l'analisi,
e la colonna `document_analyses.engine` lo registra nel database.

### Privacy — da valutare consapevolmente

In modalità `ai` o `auto`, **il testo del documento viene inviato all'API di Anthropic** per l'analisi.
È il compromesso necessario per l'AI reale. Se un cliente non lo accetta, `deterministic` mantiene tutto
dentro Supabase. Valuta questo punto nell'informativa privacy prima di andare in produzione con clienti reali.

## Non ancora implementato

OCR (scansioni/foto), Registro IDI live, database incentivi reale, email/calendar,
Stripe/pagamenti, interfaccia fiduciaria completa, 26 Cantoni.
```
