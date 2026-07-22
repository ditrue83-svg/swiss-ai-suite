# SwissAI Suite — Swiss Admin AI & Swiss Subsidy AI

MVP SaaS per le PMI svizzere, in **un unico file HTML autonomo** (nessuna build, nessuna
dipendenza da installare). Due moduli in una piattaforma:

- **Swiss Admin AI** — analizza lettere, PDF ed email amministrative (IT/DE/FR): identifica
  ente mittente, tipo di documento, importi e scadenze; produce una spiegazione semplice,
  una checklist operativa, l'elenco dei documenti richiesti, il rischio in caso di inazione
  e una bozza di risposta formale nella lingua del mittente.
- **Swiss Subsidy AI** — costruisce il profilo aziendale (IDI/CHE, Cantone, settore,
  dimensione, progetti previsti), interpreta la descrizione libera del progetto e la
  confronta con un database strutturato di programmi (Confederazione + Ticino): compatibilità
  stimata con livello di confidenza, scheda incentivo con fonte ufficiale e data di ultima
  verifica, verifica di idoneità guidata e avvisi "domanda prima di agire".

Completano l'MVP: **scadenziario** con promemoria e stati, **archivio documenti** con filtri,
pagina **piani e prezzi** (Basic 49 / Business 149 / Pro 299 / Fiduciarie su misura).

## Come usarlo

Apri `index.html` con un doppio clic nel browser — è tutto qui, funziona offline.
In alternativa, servilo come sito statico:

```bash
python3 -m http.server 8744
# poi apri http://localhost:8744
```

L'unica risorsa esterna è `pdf.js` da CDN, usata solo per estrarre il testo dai PDF
caricati (funziona anche via `file://` se sei online). Tutto il resto — analisi, matching,
scadenziario, archivio — gira nel browser; i dati sono salvati nel `localStorage`.

## Architettura

File singolo, vanilla JS. Due motori indipendenti:

- **Motore Admin AI** (`analyzeDocument`) — deterministico: rilevamento lingua, enti,
  date/scadenze, classificazione del documento, checklist, bozze di risposta. È il punto di
  integrazione per un LLM: stessa firma input/output.
- **Motore Subsidy AI** (`matchPrograms` + `evaluateEligibility`) — "regole + AI": database
  strutturato di programmi (regola: programma → area → destinatari → settore → dimensione →
  tipo progetto → requisiti → esclusioni → contributo → scadenza → documenti → fonte → data
  verifica) e matching pesato; `interpretProjectDescription` è il punto di integrazione LLM.

Palette allineata ai colori di ai-swisse.com (tema chiaro, accento azzurro).

## Limiti (demo)

- I dati dei programmi sono **dimostrativi**: ogni scheda espone fonte ufficiale e data di
  verifica; la compatibilità è una stima, non un'idoneità ufficiale.
- L'output non costituisce consulenza legale, fiscale o fiduciaria; con confidenza bassa il
  sistema chiede una verifica manuale invece di inventare.
- Per la produzione servirebbero: backend con autenticazione e separazione dei dati per
  azienda, hosting in Svizzera (nLPD), pipeline di aggiornamento del database programmi e
  integrazione LLM nei due punti indicati.
