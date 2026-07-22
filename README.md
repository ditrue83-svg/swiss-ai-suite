# SwissAI Suite

SaaS per le PMI svizzere con due moduli:

- **Swiss Admin AI** — analizza lettere, PDF ed email amministrative (IT/DE/FR): identifica
  ente mittente, tipo di documento, importi e scadenze; produce spiegazione semplice,
  checklist operativa, elenco documenti richiesti, rischio in caso di inazione e bozza di
  risposta formale nella lingua del mittente.
- **Swiss Subsidy AI** — costruisce il profilo aziendale (IDI/CHE, Cantone, settore,
  dimensione, progetti previsti), interpreta la descrizione libera del progetto e la
  confronta con un database strutturato di programmi (Confederazione + Ticino):
  compatibilità stimata con livello di confidenza, scheda incentivo con fonte ufficiale e
  data di ultima verifica, verifica di idoneità guidata e avvisi "domanda prima di agire".

Completano la piattaforma: scadenziario con promemoria, archivio documenti con filtri per
urgenza e pagina piani/prezzi (Basic 49 / Business 149 / Pro 299 / Fiduciarie su misura).
Grafica allineata ai colori di [ai-swisse.com](https://ai-swisse.com).

## Due versioni nello stesso repository

| Cartella | Cos'è | Come si avvia |
|----------|-------|---------------|
| [`html/`](html/) | Sito statico in **un unico file** `index.html` (vanilla JS, nessuna dipendenza da installare). | Apri `html/index.html` nel browser, oppure servi la cartella con un server statico. Pronto per GitHub Pages. |
| [`react/`](react/) | Stessa app in **React + Vite**, con motori in `src/engine/`. | `cd react && npm install && npm run dev` → http://localhost:5173 |

Le due versioni sono funzionalmente equivalenti: stessi motori di analisi documenti e
matching incentivi, stessa interfaccia.

## Architettura

- I motori sono **deterministici** (rilevamento lingua, enti, date/scadenze, classificazione,
  checklist, bozze; matching "regole + interpretazione testo").
- I due punti previsti per l'integrazione di un LLM sono `analyzeDocument()` (Admin AI) e
  `interpretProjectDescription()` (Subsidy AI): mantengono la stessa firma input/output.
- Persistenza lato client in `localStorage` (demo).

## Limiti (per progetto)

- Dati dei programmi **dimostrativi**: ogni scheda espone fonte ufficiale e data di verifica;
  la compatibilità è una stima, non un'idoneità ufficiale.
- L'output non costituisce consulenza legale, fiscale o fiduciaria; con confidenza bassa il
  sistema chiede una verifica manuale invece di inventare.
- Una versione di produzione richiederebbe: backend con autenticazione e separazione dei dati
  per azienda, hosting in Svizzera (nLPD), pipeline di aggiornamento del database programmi e
  l'integrazione LLM nei due punti indicati.
