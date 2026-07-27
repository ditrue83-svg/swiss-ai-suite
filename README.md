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
| **Inbox** | Collega la casella aziendale e individua le comunicazioni che richiedono attenzione. Non è un client di posta: non invia, non risponde, non modifica nulla nella casella. |
| **Attività** | Il lavoro che nasce da un documento o da una comunicazione: responsabile, stato, scadenza, storico. |
| **Documenti** | La memoria documentale: dove ritrovare ciò che l'azienda ha ricevuto, con categoria, etichette, ricerca nel testo e provenienza. |
| **Calendario e notifiche** | Quando il lavoro richiede attenzione, e che cosa non si può permettere di dimenticare. Il calendario è una proiezione delle Attività, non un secondo elenco; verso Google e Outlook la sincronizzazione va in una direzione sola. |

Inbox → Documenti → Analisi → Attività → Calendario → Notifica → Completamento, e all'indietro:
sono un sistema solo, non sei strumenti affiancati.

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
| [`app/docs/design-system.md`](app/docs/design-system.md) | Scala tipografica, colori, contrasti, tema scuro, aree cliccabili. |
| [`site/README.md`](site/README.md) | Vetrina: contenuti, build, pubblicazione. |

## Stato

**Online**, verificato il 2026-07-27: l'applicazione su `app.ai-swisse.com` (Cloudflare Pages) e
la vetrina su `ai-swisse.com` (GitHub Pages).

**In esercizio**: Admin AI, Subsidy AI, Attività, Documenti. L'**Inbox è attiva con Google** —
una casella reale collegata, posta importata, classificata e analizzata, manutenzione periodica
automatica.

**Il limite che conta oggi**: lo scope Gmail è riservato, e fuori dalla modalità «Test» Google
impone una verifica dell'app con valutazione di sicurezza di terzi. Finché non c'è, **un cliente
reale non può collegare la propria casella**. Microsoft è implementato ma non configurato, e
l'applicazione lo dichiara invece di fallire.

**Calendario e notifiche** (migrazioni 0018 e 0019): **applicate e verificate** — 58 controlli sul
database reale, 158 offline, e le schermate provate nel browser con dati veri nelle tre lingue. Il
calendario **esterno** resta però **mai provato contro le API vive**: nessuna connessione OAuth reale
a Google o Microsoft è stata stabilita, perché le credenziali non sono configurate. Gli adapter sono
allineati alla documentazione ufficiale corrente, non a una risposta reale. Vedi
[`app/docs/calendar-notifications.md`](app/docs/calendar-notifications.md).

**Implementato ma non attivo**: le notifiche push dell'Inbox (rimandate per scelta motivata —
vedi [`app/docs/ai-inbox.md`](app/docs/ai-inbox.md)); la ricerca nel Registro IDI (Zefix), in
attesa delle credenziali — il codice è allineato alla specifica ufficiale ma **non ancora provato
contro l'API viva**.

**Catalogo incentivi**: 7 programmi verificati sulle fonti ufficiali, di cui 1 dichiarato
sospeso. Copertura Confederazione + Ticino, non i 26 Cantoni. I contenuti delle schede sono
mostrati in italiano anche in tedesco e francese: vivono nel database, non nei dizionari.

**Automazioni** (migrazione 0020): **in esercizio dal 2026-07-27**. 61 controlli sul database
reale, 103 offline, Edge Function deployate e scheduler ogni 5 minuti; la catena — analisi →
evento → cron → worker → attività — è stata provata **end-to-end in produzione** su un'azienda
temporanea, poi rimossa. La **schermata** `/automazioni` esiste però solo in locale: non è ancora
pubblicata su `app.ai-swisse.com`, quindi per ora le regole si creano solo via API. Le azioni disponibili sono sei e tutte reversibili:
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
