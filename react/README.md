# SwissAI Suite — Swiss Admin AI & Swiss Subsidy AI

MVP SaaS per le PMI svizzere, basato sul documento *«Due idee software per le PMI svizzere»*.
Un'unica piattaforma con due moduli:

- **Swiss Admin AI** — analizza lettere, PDF ed email amministrative (IT/DE/FR): identifica
  ente mittente, tipo di documento, importi e scadenze; produce spiegazione semplice,
  checklist operativa, elenco documenti richiesti, rischio in caso di inazione e bozza di
  risposta formale nella lingua del mittente.
- **Swiss Subsidy AI** — costruisce il profilo aziendale (IDI/CHE, Cantone, settore,
  dimensione, progetti previsti), interpreta la descrizione libera del progetto e confronta
  il profilo con un database strutturato di programmi (Confederazione + Ticino):
  compatibilità stimata con livello di confidenza, scheda incentivo con fonte ufficiale e
  data di ultima verifica, verifica di idoneità guidata, avvisi "domanda prima di agire".

Completano l'MVP: **scadenziario** con promemoria e stati, **archivio documenti** con filtri
per urgenza, pagina **piani e prezzi** (Basic 49 / Business 149 / Pro 299 / Fiduciarie su misura).

## Avvio

```bash
npm install
npm run dev   # http://localhost:5173
```

## Architettura

- Frontend: React 18 + Vite, senza backend (demo). Persistenza in `localStorage`.
- `src/engine/adminEngine.js` — motore di analisi documenti (deterministico: rilevamento
  lingua, enti, date/scadenze, classificazione, checklist, bozze). `analyzeDocument()` è il
  punto di integrazione per un LLM: stessa firma input/output.
- `src/engine/subsidyEngine.js` + `subsidyData.js` — motore "regole + AI": database
  strutturato di programmi (regola: programma → area → destinatari → settore → dimensione →
  tipo progetto → requisiti → esclusioni → contributo → scadenza → documenti → fonte → data
  verifica) e matching pesato; `interpretProjectDescription()` è il punto di integrazione LLM.
- Lettura PDF client-side con `pdfjs-dist` (OCR immagini in roadmap).

## Limiti (per progetto)

- Dati dei programmi **dimostrativi**: ogni scheda espone fonte ufficiale e data di verifica;
  la compatibilità è una stima, non un'idoneità ufficiale.
- L'output non costituisce consulenza legale, fiscale o fiduciaria; con confidenza bassa il
  sistema chiede verifica manuale invece di inventare.
- Produzione richiederebbe: backend con autenticazione e separazione dei dati per azienda,
  hosting in Svizzera (nLPD), pipeline di aggiornamento del database programmi, integrazione
  LLM nei due punti indicati.
