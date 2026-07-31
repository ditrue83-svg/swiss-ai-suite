# AI-Swisse

SaaS per le PMI svizzere: legge la posta amministrativa che arriva in italiano, tedesco e
francese, ne ricava scadenze, importi e cose da fare, e tiene insieme documenti e lavoro.

> **Questo file è un indice, non un manuale.** La documentazione vera sta accanto al codice che
> descrive, e questa pagina rimanda a quella. È una scelta deliberata: fino al 2026-07-27 la
> radice ripeteva lo stato del prodotto, è rimasta indietro di una settimana e ha finito per
> dichiarare il falso su otto punti — dal nome del prodotto alle funzioni «non ancora
> implementate» che nel frattempo esistevano. Un fatto raccontato in due posti diverge, e nessuno
> se ne accorge finché non li legge di fila.

## I moduli

| Modulo | Cosa fa |
|---|---|
| **Admin AI** | Analizza lettere, PDF ed email amministrative: ente mittente, tipo, importi, scadenze, azioni richieste, bozza di risposta. Ogni affermazione è legata a una citazione **verificata alla lettera** nel documento; ciò che non è certo viene dichiarato, non inventato. |
| **Subsidy AI** | Confronta il progetto dell'impresa con un catalogo di programmi di incentivo (Confederazione + Ticino), tenendo distinte la **rilevanza** (pertinenza al progetto) e l'**idoneità** (requisiti verificabili). |
| **Incentivi** | Subsidy AI 2.0: dal progetto dell'impresa alle opportunità pertinenti, criterio per criterio, fino alla pratica di candidatura. Sei misure separate — rilevanza, idoneità, completezza, tempistica, freschezza della fonte, prontezza — e nessuna è una probabilità di ottenere il contributo: non esiste lo stato «idoneo», il massimo è «potenzialmente idonea». **Comprende e prepara, non candida**: non invia domande, non accede ai portali, non compila formulari. Ogni criterio porta la citazione della fonte ufficiale e la data dell'ultimo controllo riuscito. |
| **Inbox** | Collega la casella aziendale e individua le comunicazioni che richiedono attenzione. Non è un client di posta: non invia, non risponde, non modifica nulla nella casella. |
| **Attività** | Il lavoro che nasce da un documento o da una comunicazione: responsabile, stato, scadenza, storico. |
| **Documenti** | La memoria documentale: dove ritrovare ciò che l'azienda ha ricevuto, con categoria, etichette, ricerca nel testo e provenienza. |
| **Calendario e notifiche** | Quando il lavoro richiede attenzione, e che cosa non si può permettere di dimenticare. Il calendario è una proiezione delle Attività, non un secondo elenco; verso Google e Outlook la sincronizzazione va in una direzione sola. |
| **Automazioni** | «Quando succede X, se valgono Y, allora Z». La configurazione è un dato, mai codice: una condizione può nominare solo campi dichiarati, un'azione solo una delle sei previste. In caso di ambiguità non si esegue. |
| **Finanze** | Fatture fornitori, ricevute e note di credito: comprendere e preparare il denaro, non muoverlo. Nessun pagamento, nessun file di pagamento, nessuna scrittura contabile — un IBAN si mostra, non si esegue. |
| **Contratti** | Con chi l'azienda è legata, fino a quando e a quali condizioni. Riporta che cosa il documento dice, non che cosa il diritto impone: ogni termine mostra la clausola da cui viene, e una data che non si può ricavare con certezza non viene inventata. |
| **Chiedi ad AI-Swisse** | Una domanda a parole al posto di nove schermate da aprire: l'assistente interroga i moduli e risponde citando la fonte. Non contiene dati aziendali — conserva domande, risposte e riferimenti. La ricerca semantica è stata valutata e **non** implementata, con i dati della valutazione scritti accanto alla decisione. |
| **Clienti** | Con chi l'azienda sta lavorando: clienti, prospect, fornitori, partner, enti — e tutto il lavoro collegato attorno a ognuno. Collega, non copia: il nome del fornitore letto su una fattura resta di Finanze, la controparte letta su un contratto resta dei Contratti, il mittente resta dell'Inbox. Nessuna anagrafica nasce da sola: le corrispondenze si propongono, non si applicano. |

Inbox → Documenti → Analisi → Attività → Calendario → Notifica → Completamento, e all'indietro:
sono un sistema solo, non nove strumenti affiancati. Finanze e Contratti sono LETTURE dei documenti
che l'archivio custodisce già, non un secondo posto dove scrivere.

## Cartelle

| Cartella | Cos'è | Come si avvia |
|---|---|---|
| [`app/`](app/) | **L'applicazione.** React + TypeScript su Supabase (Auth, PostgreSQL, Storage privato, RLS), con l'analisi eseguita da Claude lato server. È qui che prosegue lo sviluppo. | `cd app && npm install`, configura `.env` (vedi [`app/README.md`](app/README.md)) → `npm run dev` |
| [`site/`](site/) | **La vetrina** `ai-swisse.com`. Generatore statico senza dipendenze, contenuti in `content.mjs` (unica fonte, tre lingue), pubblicata da GitHub Actions. | `cd site && node build.mjs` → `site/dist` |
| [`html/`](html/) | Prototipo dimostrativo in un unico `index.html` (vanilla JS, `localStorage`). Resta come riferimento storico del design; non è più la fonte. | Apri `html/index.html` nel browser. |

> Un primo scaffold React senza backend (`react/`) è stato rimosso perché superato da `app/`;
> resta recuperabile dalla storia git (fino al commit `89588a8`).

## Dove sta la documentazione

| Documento | Cosa copre |
|---|---|
| [`app/README.md`](app/README.md) | Installazione, variabili d'ambiente, pipeline di analisi, database, comandi, test, sicurezza, **limitazioni dichiarate**. |
| [`app/docs/ai-inbox.md`](app/docs/ai-inbox.md) | Inbox: architettura, configurazione passo passo, modello di minaccia, diagnostica. **Sede unica dello stato operativo dell'Inbox.** |
| [`app/docs/document-hub.md`](app/docs/document-hub.md) | Documenti: modello dati, ricerca, categorie, provenienza, limiti della ricerca full-text. |
| [`app/docs/calendar-notifications.md`](app/docs/calendar-notifications.md) | Calendario e notifiche: stato desiderato degli eventi, promemoria e fusi orari, sincronizzazione a senso unico, configurazione Google e Microsoft, email. |
| [`app/docs/workflow-automation.md`](app/docs/workflow-automation.md) | Automazioni: outbox e catena causale, inneschi, condizioni a tre valori, azioni e loro limiti, idempotenza, protezione dei cicli, messa in opera. |
| [`app/docs/finance-operations.md`](app/docs/finance-operations.md) | Finanze: QR-fattura svizzera, aliquote IVA con fonte, duplicato sospetto, correzioni umane, confine con la contabilità. |
| [`app/docs/contract-manager.md`](app/docs/contract-manager.md) | Contratti: versioni dei termini, amendment che non sovrascrivono, date derivate e ciò che il prodotto **non** calcola, confine legal-safety. |
| [`app/docs/company-assistant.md`](app/docs/company-assistant.md) | Chiedi ad AI-Swisse: che cosa l'assistente interroga, come cita le fonti, che cosa NON conserva, messa in opera. |
| [`app/docs/company-assistant-search-eval.md`](app/docs/company-assistant-search-eval.md) | La valutazione della ricerca semantica e la decisione di non implementarla: il cancello non è stato superato perché su quel corpus non è misurabile. |
| [`app/docs/crm-light.md`](app/docs/crm-light.md) | Clienti: identità di organizzazioni e persone, ruoli multipli, abbinamento prudente e perché l'abbinamento automatico è quasi sempre sbagliato, duplicati senza fusione automatica, opportunità, privacy. |
| [`app/docs/product-status.md`](app/docs/product-status.md) | **Lo stato di ogni modulo, e l'unico posto dove è dichiarato.** Sei colonne distinte: implementato, deployato, configurato, testato, provato contro il servizio reale, disponibile a clienti esterni. |
| [`app/CLAUDE.md`](app/CLAUDE.md) | Le regole di lavoro sul repository: branch, consolidamento, verità, sicurezza, interfaccia. Sta in `app/` perché è lì che si lavora. |
| [`app/docs/incentivi.md`](app/docs/incentivi.md) | Incentivi (Subsidy AI 2.0): perché sei misure separate e non un punteggio, le quattro schede, la convivenza con Subsidy AI 1.0, lo scheduler, le due suite — e il limite che resta: il motore non è coperto da un test. |
| [`app/docs/design-system.md`](app/docs/design-system.md) | Scala tipografica, colori, contrasti, tema scuro, aree cliccabili. |
| [`site/README.md`](site/README.md) | Vetrina: contenuti, build, pubblicazione. |

## Stato

**Online**, verificato il 2026-07-27: l'applicazione su `app.ai-swisse.com` (Cloudflare Pages) e
la vetrina su `ai-swisse.com` (GitHub Pages).

⚠️ **Lo stato di ogni modulo è dichiarato in un posto solo:
[`app/docs/product-status.md`](app/docs/product-status.md).** Sei colonne distinte —
implementato, deployato, configurato, testato, provato contro il servizio reale, disponibile a
clienti esterni — perché fino al 2026-07-31 questa riga diceva «in esercizio» per stati molto
diversi, e un modulo con 58 asserzioni verdi e **nessuno scheduler che lo invocasse** risultava
in esercizio come uno che funzionava davvero. `npm run docs:check` ora fallisce se un documento
contraddice quella tabella.

**In esercizio**: Admin AI, Subsidy AI, Attività, Documenti, Automazioni, Finanze, Contratti,
Clienti, Chiedi ad AI-Swisse, Incentivi. L'**Inbox è attiva con Google** — una casella reale
collegata, posta importata, classificata e analizzata, manutenzione periodica automatica.
⚠️ **«Calendario e notifiche» NON è in esercizio**: il codice c'è ed è deployato, ma i suoi due
scheduler non esistono nel progetto e i suoi secret non sono impostati, quindi nessun promemoria
è mai stato generato e nessuna email è mai stata consegnata (`npm run verify:deploy`).

**Il limite che conta oggi**: lo scope Gmail è riservato, e fuori dalla modalità «Test» Google
impone una verifica dell'app con valutazione di sicurezza di terzi. Finché non c'è, **un cliente
reale non può collegare la propria casella**. Microsoft è implementato ma non configurato, e
l'applicazione lo dichiara invece di fallire.

**Calendario e notifiche** (migrazioni 0018, 0019 e **0035**): **applicate e verificate** — 58
controlli sul database reale, 188 offline, e le schermate provate nel browser con dati veri nelle tre
lingue. Dalla **0035** i due scheduler (`calendar-sync-drain` ogni 10 minuti, `notifications-worker`
ogni 15) sono creati da una **migrazione** e non più incollati a mano nel SQL editor: prima vivevano
solo dentro un documento, e un database rifatto sarebbe rimasto senza promemoria senza che nulla
diventasse rosso. Il percorso dei promemoria è stato **provato dal capo alla coda** su un tenant
tecnico, poi rimosso. Il calendario **esterno** resta però **mai provato contro le API vive**:
nessuna connessione OAuth reale a Google o Microsoft è stata stabilita, perché le credenziali non
sono configurate. Gli adapter sono allineati alla documentazione ufficiale corrente, non a una
risposta reale. Vedi [`app/docs/calendar-notifications.md`](app/docs/calendar-notifications.md).

**Implementato ma non attivo**: le notifiche push dell'Inbox (rimandate per scelta motivata —
vedi [`app/docs/ai-inbox.md`](app/docs/ai-inbox.md)).

**Registro IDI (Zefix)**: **acceso e provato contro l'API viva** il 2026-07-28, con credenziali
rilasciate dall'UFRC. Non più solo allineato alla specifica: la catena è stata verificata contro
risposte reali, e le misure che ne sono uscite — l'API non pagina, il cantone non torna nella
ricerca per nome, `activeOnly` non esclude le società in cancellazione — sono nel commento in testa
a `supabase/functions/lookup-company/index.ts`.

**Catalogo incentivi**: 7 programmi verificati sulle fonti ufficiali, di cui 1 dichiarato
sospeso. Copertura Confederazione + Ticino, non i 26 Cantoni. I contenuti delle schede sono
mostrati in italiano anche in tedesco e francese: vivono nel database, non nei dizionari.

**Automazioni** (migrazione 0020): **in esercizio dal 2026-07-27**. 61 controlli sul database
reale, 103 offline, Edge Function deployate e scheduler ogni 5 minuti; la catena — analisi →
evento → cron → worker → attività — è stata provata **end-to-end in produzione** su un'azienda
temporanea, poi rimossa. La **schermata** `/automazioni` è pubblicata su `app.ai-swisse.com`. Le azioni disponibili sono sei e tutte reversibili:
creare un'attività, assegnarla, cambiarne la priorità, classificare un documento, aggiungere
un'etichetta, notificare. Nessuna invia email, muove denaro o accetta impegni. Vedi
[`app/docs/workflow-automation.md`](app/docs/workflow-automation.md).

**Non implementati**: invio email, sincronizzazione calendario, pagamenti, interfaccia fiduciaria
completa.

Il dettaglio di ciascun punto, con le trappole già incontrate, sta in
[`app/README.md`](app/README.md) → «Limitazioni attuali (dichiarate, non nascoste)».

## Disclaimer

AI-Swisse è uno **strumento di supporto amministrativo**. Le analisi sono generate
automaticamente e **non sostituiscono la consulenza legale, fiscale o fiduciaria**. Quando il
sistema non è sicuro lo segnala e invita a una verifica manuale; importi, requisiti e scadenze
vanno confermati sulla fonte ufficiale.

In modalità AI il testo estratto dal documento viene inviato all'API di Anthropic (Stati Uniti):
è dichiarato nell'informativa privacy. La modalità `deterministic` tiene tutto dentro Supabase.
