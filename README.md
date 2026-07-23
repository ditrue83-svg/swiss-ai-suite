# SwissAI Suite

SaaS per le PMI svizzere con due moduli:

- **Swiss Admin AI** — analizza lettere, PDF ed email amministrative (IT/DE/FR): identifica
  ente mittente, tipo di documento, importi e scadenze; produce spiegazione semplice,
  checklist operativa, elenco documenti richiesti, rischio in caso di inazione e bozza di
  risposta formale nella lingua del mittente.
- **Swiss Subsidy AI** — costruisce il profilo aziendale (IDI/CHE, Cantone, settore,
  dimensione, progetti previsti), interpreta la descrizione libera del progetto e la
  confronta con un database strutturato di programmi (Confederazione + Ticino):
  **rilevanza** (pertinenza al progetto) tenuta distinta dall'**idoneità** (hard/soft rule ed
  esclusioni valutabili), scheda incentivo con fonte ufficiale e data di verifica, verifica
  guidata e avvisi "domanda prima di agire".

Completano la piattaforma: scadenziario, archivio documenti, pratiche incentivi e pagina
piani/prezzi. Grafica allineata ai colori di [ai-swisse.com](https://ai-swisse.com).

## Cartelle

| Cartella | Cos'è | Come si avvia |
|----------|-------|---------------|
| [`app/`](app/) | **L'applicazione vera.** SaaS multi-tenant su **Supabase** (Auth, PostgreSQL, Storage privato, RLS) in React + TypeScript, con analisi documenti tramite **Claude** lato server. È la versione su cui prosegue lo sviluppo. | `cd app && npm install`, configura `.env` (vedi [app/README.md](app/README.md)) → `npm run dev` |
| [`html/`](html/) | Prototipo dimostrativo in **un unico file** `index.html` (vanilla JS, `localStorage`, nessuna dipendenza). Resta il riferimento del design. | Apri `html/index.html` nel browser. Pronto per GitHub Pages. |
| [`react/`](react/) | Primo scaffold React/JS senza backend. **Superato da `app/`**, conservato solo per storico. | `cd react && npm install && npm run dev` |

## Architettura di `app/`

- **Multi-tenant dal principio**: utente e azienda sono concetti separati (`profiles`,
  `companies`, `company_members`, `company_profiles`); un utente può appartenere a più aziende
  (base per la futura vista fiduciaria).
- **Row Level Security su tutte le tabelle aziendali**: si accede a una risorsa solo se si è
  membri della sua company. Le policy usano funzioni `SECURITY DEFINER` per evitare ricorsione;
  l'onboarding passa da un'RPC atomica. Migrazioni SQL versionate in `app/supabase/migrations`.
- **Storage privato** (`company-documents`) con signed URL e policy per membership: il contenuto
  dei documenti non sta nel database.
- **Service layer** che isola UI, logica e accesso al DB.
- **Analisi documenti**: `analysisService` sceglie il motore senza che la UI se ne accorga —
  Claude tramite Edge Function server-side (la chiave API non tocca mai il browser), oppure il
  motore deterministico locale come fallback o per chi non vuole inviare nulla all'esterno.
- **Le citazioni dell'AI sono verificate**: ogni frase citata deve esistere alla lettera nel
  documento, altrimenti viene scartata e l'azione declassata da "dal documento" a "suggerimento".
  Gli offset di evidenziazione sono ricalcolati localmente, mai presi dal modello.

## Stato e limiti

- Il **database dei programmi di incentivo è dimostrativo**: ogni scheda espone fonte ufficiale e
  data di verifica; la rilevanza è una stima di pertinenza, l'idoneità non sostituisce la
  valutazione dell'ente.
- L'output non costituisce consulenza legale, fiscale o fiduciaria; in caso di incertezza il
  sistema la dichiara invece di inventare.
- In modalità AI il testo del documento viene inviato all'API di Anthropic: da valutare
  nell'informativa privacy (la modalità `deterministic` tiene tutto dentro Supabase).
- Non ancora implementati: OCR, Registro IDI live, database incentivi reale, pagamenti,
  email/calendar, interfaccia fiduciaria completa, copertura dei 26 Cantoni.
