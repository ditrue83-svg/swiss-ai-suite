# Calendario e notifiche (migrazione 0018)

Il Work Hub sa **che cosa** c'è da fare. Questo modulo aggiunge **quando** lo si
vede nel tempo e **che cosa non si può permettere di dimenticare**.

> **Stato al 2026-07-27.** Migrazioni **0018 e 0019 applicate e verificate**:
> `npm run test:calendar` **58/58** sul database reale, `test:calendar-unit`
> 158/158 offline, e il calendario interno con le notifiche **provato nel
> browser con dati veri** nelle tre lingue, su desktop e a 375 pixel.
>
> Resta **non provato contro le API vive**: nessuna connessione reale a Google o
> Microsoft è mai stata stabilita, perché le credenziali non sono configurate.
> Gli adapter sono allineati alla documentazione ufficiale corrente, non a una
> risposta vera. È la stessa distinzione già dichiarata per Zefix, e vale la
> stessa cautela — alla prima chiamata reale vanno riverificati corpo accettato,
> campi presenti e forma degli errori.

## 0. La 0019, e perché esiste

`npm run test:calendar` alla **prima esecuzione** ha trovato 3 fallimenti su 57:
`notifications_mark_read` e `notifications_mark_all_read` erano `security
invoker`, quindi giravano con i permessi di chi le chiama — e su `notifications`
il ruolo `authenticated` ha soltanto `SELECT`. L'UPDATE veniva respinto con
`42501`, e la campanella non riusciva a segnare niente come letto.

Il ragionamento sbagliato, scritto nero su bianco nella 0018, era: *«l'UPDATE
esiste per far passare `read_at` scritto dalle funzioni, che girano security
invoker. Resta inutilizzabile dal client: non c'è alcun GRANT di UPDATE.»* La
seconda metà è vera. La prima no: **se la funzione gira come il chiamante, la
funzione È il chiamante**, e il permesso che manca a lui manca anche a lei.

⚠️ **E il test lo aveva quasi nascosto.** Il controllo «Andrea non può segnare
come letta una notifica di Marco» passava — ma perché la chiamata falliva,
`data` tornava `null`, e `Number(null)` è zero. Un test che scarta `error` e
guarda solo il risultato non distingue «zero righe» da «non ho potuto nemmeno
provarci». Ora ogni chiamata controlla l'errore, e c'è la controprova mancante:
dopo «segna tutte come lette» di Marco, le notifiche di Andrea devono essere
ancora non lette.

La 0019 rende le due funzioni `security definer` — e da quel momento
`user_id = auth.uid()` scritto dentro non è più una ridondanza ma **l'unica**
difesa — e toglie la policy `notifications_update_own`, che non apriva niente e
suggeriva una scrittura inesistente.

---

## 1. Il principio, e ciò che ne deriva

**La fonte di verità del lavoro resta `tasks`.** Il calendario è una
*proiezione*: non esiste nessuna tabella, in questo modulo, che contenga il
titolo, la scadenza o lo stato di un'attività. `calendar_event_links` contiene
solo la **corrispondenza** fra una task e l'evento che la rappresenta presso un
provider — un identificativo e un'impronta, non una copia.

Se domani qualcuno volesse leggere «quali scadenze ha l'azienda» da queste
tabelle non ci riuscirebbe, ed è voluto: due posti in cui vive una scadenza sono
due scadenze che possono divergere.

La catena del prodotto diventa:

```
INBOX → DOCUMENTI → ANALISI → ATTIVITÀ → CALENDARIO → NOTIFICA → COMPLETAMENTO
```

⚠️ **Una scadenza di un documento NON diventa da sola un evento** (§90). Il
modello resta: l'analisi propone, una persona crea o conferma un'attività,
l'attività entra nel calendario. Trasformare ogni `document_analyses.deadline`
in un evento avrebbe riempito il calendario di scadenze non confermate.

---

## 2. Architettura

### Due livelli, indipendenti

| | Calendario interno | Calendario esterno |
|---|---|---|
| Dove | `/calendario` | Google Calendar, Microsoft Outlook |
| Serve | sempre | opzionale |
| Dipende da | niente | consenso OAuth della singola persona |
| Direzione | — | **AI-Swisse → provider**, mai il contrario |

Il calendario interno funziona anche senza alcuna connessione esterna, e senza
che nessuno abbia mai aperto le impostazioni.

### Moduli

```
supabase/functions/_shared/calendar/
  types.ts        contratto CalendarProviderAdapter + errori tipizzati
  contract.ts     costanti condivise con l'interfaccia
  desired.ts      ⭐ getCalendarDesiredState — PURA, il cuore di tutto
  reminders.ts    ⭐ quando un promemoria è dovuto — PURA, con fuso e ora legale
  i18n.ts         i testi che il server manda fuori dal prodotto (it/de/fr)
  http.ts         riuso di providerFetch con la tassonomia di errori del calendario
  google.ts       adapter Google Calendar
  microsoft.ts    adapter Microsoft Graph
  email.ts        NotificationEmailProvider + implementazione Resend
  store.ts        persistenza (service role)
  sync.ts         il motore: dallo stato desiderato alle chiamate reali
  notify.ts       generazione promemoria + consegna email
  runtime.ts      collante Deno (⚠️ non importabile dai test)
```

**`desired.ts` e `reminders.ts` sono puri e senza dipendenze**: nessuna rete,
nessun database, nessun orologio implicito. È la ragione per cui i casi limite
si provano offline in un millisecondo invece che contro due API esterne.

### Edge Function

| Funzione | Chiamante | Autenticazione | `verify_jwt` |
|---|---|---|---|
| `calendar-oauth` | browser (start/providers) e redirect del provider (callback) | JWT sui primi due, `state` monouso sul terzo | **false** |
| `calendar-sync` | scheduler (`drain`, `reconcile`) e persona (`sync`) | segreto a tempo costante / JWT | true |
| `calendar-disconnect` | persona | JWT | true |
| `notifications-worker` | scheduler | segreto a tempo costante | **false** |

⚠️ `calendar-sync` tiene la verifica del JWT **attiva** di proposito: ha due
chiamanti e lo scheduler chiama comunque con la service role key
nell'`Authorization`. Disattivarla avrebbe allargato la superficie senza alcun
guadagno.

---

## 3. Lo stato desiderato — la funzione da cui dipende tutto

```ts
getCalendarDesiredState(task, connection): DesiredState
```

Tre esiti, non due:

- **`present`** — l'evento deve esistere e corrispondere al contenuto.
- **`absent`** — non deve esistere: se c'è, si cancella. Con il **motivo**:
  `no_due_date`, `completed`, `archived`, `not_assignee`, `wrong_company`,
  `sync_disabled`.
- **`untouchable`** — non si sa e non si può agire, perché la connessione non è
  in grado di parlare con il provider (`connection_reauth`, `connection_error`,
  `connection_disconnected`).

⚠️ **`untouchable` non è un lusso.** Trattare «da ricollegare» come «l'evento non
deve esserci» svuoterebbe il calendario di chi ha soltanto un token scaduto. Il
test lo verifica anche nel caso peggiore: un'attività *completata* su una
connessione rotta resta intoccabile, perché senza token non si cancella niente.

Il motivo dell'assenza non serve al codice ma ai test: senza, un caso limite
potrebbe dire soltanto «l'evento non c'è» e non distinguere due situazioni che
portano a comportamenti opposti del worker.

**In `sync.ts` non esiste nessun `if` sullo stato di un'attività.** Quel file
legge la funzione e obbedisce. Un `if` in più scritto là — «se è archiviata
salta» — creerebbe una seconda definizione che diverge alla prima modifica e che
nessun test coglierebbe, perché i test provano la funzione pura.

---

## 4. Il calendario interno

Rotta `/calendario`, voce di menu subito dopo **Attività**.

- **Mese** e **Agenda**. Su schermo stretto l'agenda è la vista predefinita.
- **Le mie / Tutte**, con «Le mie» come valore predefinito e scritto sul
  pulsante premuto: un calendario che sembra vuoto per un filtro attivo e
  invisibile è la trappola già trovata con le categorie dei documenti nella 0017.
- Filtri: priorità, stato, responsabile (solo in «Tutte»).
- **Le scadute stanno fuori dalla griglia**, in un pannello proprio sempre
  visibile — anche quando appartengono a un mese che non si sta guardando.
- **Le attività senza scadenza** non entrano nella griglia (non si inventa una
  data) ma il loro numero si dichiara, con il collegamento ad Attività.

### La query

`calendar_tasks(company_id, from, to, mine, status, priority, assignee, include_overdue, limit)`
chiede al database **solo le settimane disegnate** più le scadute pertinenti. Mai
`listAll`. Il modello di lettura è deliberatamente povero: niente descrizione,
checklist, commenti, storico o analisi — una vista mensile con quaranta attività
non deve caricare quaranta analisi documentali per disegnare quaranta righe.

⚠️ **La funzione non restituisce `is_overdue`.** Che cosa sia «in ritardo» lo
decide `isOverdue()` in `features/tasks/taskFormat`, la stessa funzione che usano
Attività e Panoramica. Due definizioni sono due schermate che prima o poi si
contraddicono — la notte del cambio d'ora, o a cavallo della mezzanotte.
La *selezione* usa `due_date <= current_date` con un giorno di margine, perché il
database vive in UTC e l'utente in `Europe/Zurich`.

### Creare un'attività da un giorno

Premere il numero di un giorno porta a `/attivita?nuova=YYYY-MM-DD`, dove si apre
**il modulo di creazione di Attività**, con la data compilata. Non esiste un
secondo modulo (§17): due moduli avrebbero significato due posti in cui
ricordarsi della priorità proposta e dei passaggi derivati da un'analisi.

### Su telefono la griglia cambia natura

⚠️ **Trovato misurando la schermata a 375 pixel, non leggendo il codice**: le
righe delle attività diventavano barre alte **sei pixel** e restavano
collegamenti. WCAG 2.2 chiede bersagli da 24, ed è la stessa classe di difetto
già corretta nella 0016 su `.mini-btn` e sulle caselle della checklist.

Ingrandirle non era una strada — tre bersagli da 24 pixel non stanno in una
casella alta 62. È cambiato **che cosa fa la griglia su un telefono**: diventa
una panoramica di dove si concentra il lavoro, le barre sono indicatori
(`<span aria-hidden>`, non collegamenti) e l'unico controllo della casella è il
numero del giorno. Le attività si aprono dall'**agenda**, che su telefono è la
vista predefinita proprio per questo.

Sul desktop `.cal-item` ha `min-height: 24px`: misurato a 20, corretto.

### Accessibilità

- Ogni casella porta un'etichetta con la data per esteso e il conteggio vero.
- **Oggi non è indicato solo dal colore**: è un cerchio pieno (una forma) e
  l'etichetta lo dice a parole.
- La griglia è una `<table>` con `<th scope="col">` e una didascalia nascosta
  visivamente ma presente nell'albero di accessibilità.
- Il titolo del mese ha `aria-live="polite"`: cambia senza che la pagina cambi.
- Nessuno scroll orizzontale a 375 e a 1280, verificato misurando.

---

## 5. Le notifiche

### I sette tipi

`task_assigned` · `task_due_soon` · `task_due_today` · `task_overdue` ·
`unassigned_task_due_soon` · `calendar_sync_failed` · `calendar_reauth_required`

### Quando arriva un promemoria

Le quattro finestre, valutate **nel fuso di chi riceve**:

| Finestra | Condizione | Chiave |
|---|---|---|
| sette giorni | `2 ≤ giorni ≤ 7` | `task:<id>:d7` |
| un giorno | `giorni == 1` | `task:<id>:d1` |
| il giorno stesso | `giorni == 0` | `task:<id>:d0` |
| scaduta | `giorni < 0`, **una volta sola** | `task:<id>:overdue` |

**Prima delle 8 locali non si sveglia nessuno.** Il job gira spesso e non decide
da solo se è «l'ora»: produce il promemoria alla prima esecuzione dopo le otto
del mattino di chi lo riceve, e non lo produce più per quel giorno perché la
chiave di deduplicazione glielo impedisce.

⚠️ **Le condizioni sono intervalli dove è possibile.** Se il job resta fermo un
giorno, il promemoria dei sette arriva a sei — tardi, non perso. La forma ovvia
(«se sono le 8, manda») perderebbe il promemoria di tutti al primo job fallito.

⚠️ **L'eccezione dichiarata**: il promemoria «un giorno prima» ha una condizione
esatta, perché un intervallo lo sovrapporrebbe a quello del giorno stesso. Se il
job resta fermo per l'intera giornata precedente quel promemoria non arriva — ma
il giorno dopo arriva quello «in scadenza oggi», che dice la stessa cosa con più
urgenza. È una perdita **accettata e scritta**, non una svista.

**Il fuso non si calcola a mano.** Nessuna somma di scostamenti, nessuna tabella
dell'ora legale: si chiede a `Intl.DateTimeFormat` che ore sono in quella zona.
L'ultima domenica di marzo non è un caso speciale da ricordarsi. Un fuso non
valido **solleva** invece di ripiegare su un altro: un promemoria all'ora
sbagliata è peggio di un promemoria mancante, perché sembra funzionare. La 0018
lo valida comunque in scrittura, provandolo davvero con `now() at time zone`.

### La deduplicazione è un vincolo, non un controllo

`unique (user_id, dedupe_key) where dedupe_key is not null`. Un worker eseguito
tre volte inserisce una riga la prima volta e viene respinto le altre due. Non
c'è nessun «leggi poi scrivi», che avrebbe una finestra in mezzo attraversabile
da due esecuzioni contemporanee.

⚠️ **`dedupe_key` è nullabile**, e l'indice è parziale. Le notifiche generate da
un **evento** (una riassegnazione) non si ritentano mai — il trigger scatta una
volta per UPDATE — e due assegnazioni successive sono due fatti distinti che
meritano due notifiche. Dare una chiave finta anche a quelle avrebbe significato
inventarla con un timestamp, cioè scrivere un vincolo che non vincola niente.

⚠️ La chiave **non contiene l'identificativo dell'utente**: l'unicità è su
`(user_id, dedupe_key)`, quindi l'utente è già metà della chiave.

### Chi riceve

- Promemoria e assegnazione → **il responsabile**, mai tutta l'azienda.
- Chi si assegna un'attività **da sé non riceve niente**: lo sa già, e un avviso
  per una cosa appena fatta insegna a ignorare la campanella.
- Un'attività **urgente e senza responsabile** avvisa owner e amministratori, una
  volta sola, e solo a priorità alta (§32).

### La campanella

Badge con il conteggio non letto dell'azienda attiva, «9+» oltre nove (il numero
esatto resta nell'etichetta per lo screen reader). Al cambio di azienda il
conteggio si azzera **prima** di ricaricare: senza, per la frazione di secondo
della nuova richiesta si vedrebbe il numero dell'azienda precedente sotto il nome
di quella nuova.

⚠️ **Il conteggio vive nell'`AppShell`, non nella campanella.** Nell'albero la
campanella è montata due volte — barra superiore per il telefono, colonna
laterale per il desktop — e il CSS ne nasconde una: due conteggi indipendenti
sarebbero due interrogazioni per ogni caricamento, una per un pulsante che
nessuno può premere.

⚠️ **«Non ho notifiche» e «non riesco a leggerle» sono due cose diverse.**
Trovato aprendo il pannello con la 0018 non applicata: diceva serenamente
«Nessuna notifica». È la stessa trappola dell'Inbox con la 0013 — un guasto
travestito da stato legittimo. Ora il guasto viene prima di qualunque
interpretazione.

**Nessun `setInterval` nel frontend** (§39): i promemoria li genera il server, e
non dipendono dal fatto che qualcuno tenga la scheda aperta.

---

## 6. Le email

`NotificationEmailProvider` è un'interfaccia; l'implementazione fornita usa
**Resend** via una POST HTTP diretta, senza aggiungere dipendenze.

Prima di scriverla si è controllato se il progetto avesse già un provider (§41):
**non ce l'ha.** L'unico SMTP è quello che Supabase Auth usa per conferma
indirizzo e reimpostazione password; è configurato nel dashboard, appartiene al
servizio di autenticazione e non è raggiungibile dall'applicazione. Riusarlo
avrebbe legato la posta di prodotto a quella di sicurezza.

### Notifica ≠ consegna

`notifications` è il **fatto**; `notification_deliveries` è il **tentativo**.
Se fossero un passo solo, un guasto del provider impedirebbe alla notifica in-app
di esistere — cioè un canale accessorio potrebbe far perdere quello principale.

- `unique (notification_id, channel)` — un worker eseguito tre volte non produce
  tre email.
- `Idempotency-Key: delivery:<id>` verso Resend — copre la richiesta il cui esito
  non è mai arrivato.
- **Il tentativo si registra PRIMA dell'invio**, con la prossima attesa già
  programmata: se l'isolate viene ucciso mentre la richiesta è in volo, il peggio
  che può succedere è un'email in meno, mai una in più.
- Errori transitori → attesa esponenziale con jitter, fino a 4 tentativi.
  Errori permanenti (indirizzo rifiutato, dominio non verificato, chiave
  revocata) → **si chiude subito**: ritentarli per giorni non li fa diventare
  validi.

### Che cosa NON entra in un'email (§45)

Corpo di documenti, contenuto di comunicazioni della Inbox, allegati, importi,
IBAN, citazioni dell'analisi, URL firmati verso file. Restano: **azienda, titolo
dell'attività, scadenza, un collegamento**, e la riga che dice *perché* il
messaggio arriva — senza la quale un promemoria è indistinguibile da posta non
richiesta. Testo semplice, nessun HTML: dove non c'è markup non esiste il difetto
«mi sono dimenticato di sanificare».

### ⚠️ Una conseguenza del modello, dichiarata

La consegna email è appesa alla notifica. **Spegnere le notifiche dentro
AI-Swisse spegne anche le email**: l'email è una copia di ciò che la campanella
mostra, non un canale indipendente. La schermata delle impostazioni lo scrive,
invece di lasciare due interruttori che sembrano indipendenti e non lo sono.

### Stato «non disponibile»

Se `NOTIFICATION_EMAIL_API_KEY` e `NOTIFICATION_EMAIL_FROM` non ci sono, il
server risponde `emailConfigured: false` e la schermata mostra le email come
**non disponibili** invece di offrire un interruttore che non farebbe partire
niente (§79). È un booleano, non la chiave: il client deve sapere *se*, non *cosa*.

### Accendere le email

**Due valori, e nient'altro da scrivere nel codice.**

| variabile | che cos'è | esempio |
| --- | --- | --- |
| `NOTIFICATION_EMAIL_API_KEY` | la chiave API del provider transazionale (Resend) | `re_a1b2c3…` |
| `NOTIFICATION_EMAIL_FROM` | il mittente, `Nome <indirizzo@dominio>`, su un dominio **verificato presso il provider** | `AI-Swisse <notifiche@ai-swisse.com>` |

**Dove vanno impostati — in due posti, per due ragioni diverse.**

1. **Come secret delle Edge Function**, ed è l'unico che conta in esercizio:
   è da lì che `notifications-worker` li legge.

   ```bash
   npx supabase secrets set --project-ref tcjmagaqktmzijbfntvy \
     NOTIFICATION_EMAIL_API_KEY='re_…' \
     NOTIFICATION_EMAIL_FROM='AI-Swisse <notifiche@ai-swisse.com>'
   ```

2. **In `.env.test`**, solo per poter eseguire `npm run test:notification-email`
   dalla propria macchina. Senza, quel comando **esce 3** e lo dichiara.

**Come si ottengono.** Un account su [resend.com](https://resend.com), poi
*Domains → Add domain* con il dominio del mittente e i record SPF/DKIM che
Resend indica, sul DNS di `ai-swisse.com`; infine *API Keys → Create*. La chiave
si vede **una volta sola**.

⚠️ **Il dominio dev'essere verificato PRIMA del primo invio.** Un mittente su un
dominio non verificato riceve un 4xx, che `deliverEmails` classifica — a
ragione — come guasto **definitivo**: la consegna si chiude `failed` e non
viene ritentata. Non è un difetto, è la regola di §44 applicata; ma se si
configura al contrario, la prima email non parte e la coda non la riprende.

⚠️ Per provare il percorso senza scrivere a una persona esiste
`delivered@resend.dev`, l'indirizzo tecnico che il provider accetta sempre. È il
destinatario predefinito di `npm run test:notification-email`.

#### ⚠️⚠️ I due cancelli che restano chiusi anche dopo i secret

Impostare le due variabili **non basta**, e nessuno dei due residui è visibile
da fuori:

- **`notification_preferences.email_enabled` è `false` per default** (lo
  dichiarano sia la 0018 sia `defaultPreferences`). Chi non ha mai aperto le
  impostazioni riceve le notifiche in-app e **nessuna email**. Va acceso da
  *Notifiche e calendario*, o con una riga in `notification_preferences`.
- **La coda si popola alla GENERAZIONE, non alla consegna.**
  `generateReminders` accoda una consegna solo `if (p.email_enabled &&
  deps.emailProvider)`. Quindi le notifiche già esistenti, create mentre il
  provider non c'era, **non hanno una riga in `notification_deliveries` e non la
  avranno mai**: configurare i secret non le recupera. Le email partono dai
  promemoria generati **da lì in avanti**.

E un terzo vincolo che non è un cancello ma un orario: `dueReminders` non
produce nulla **prima delle 8 locali** di chi riceve (`REMINDER_LOCAL_HOUR`).
Una prova fatta alle due di notte non genera niente, e non perché sia rotta.

#### Che cosa prova che funziona

```bash
npm run test:calendar-unit                # §12: `deliverEmails` VERA, provider finto
npm run test:notification-email           # invio VERO al destinatario tecnico
npm run test:notification-email -- tu@dominio.ch
```

⚠️⚠️ **Il difetto che questo percorso nascondeva, corretto il 2026-08-03.**
`composeEmail` dichiarava di restituire `{ to, subject, text }` e restituiva il
risultato nudo di `buildReminderEmail`, che è `{ subject, text }`: **il campo
`to` non c'era**. A runtime `message.to` era `undefined`, `JSON.stringify` lo
scriveva come `null` dentro l'array, e ogni promemoria sarebbe partito verso
`to: [null]` — 4xx del provider, consegna chiusa `failed`, nessuna email mai
arrivata a nessuno. Chi avesse impostato i due secret avrebbe visto una coda di
consegne fallite e un codice opaco.

Perché nessuno l'aveva visto: `tsconfig.json` include `src` e `scripts`, quindi
un file di `supabase/functions/` entra nel typecheck **solo se qualcosa là
dentro lo importa** — e `notify.ts` non era importato da niente. Il difetto è
comparso nel momento in cui la sezione 12 ha importato il modulo per eseguirlo:
prima il test è diventato rosso sul destinatario, poi anche `npm run typecheck`.
**Un percorso che nessun test esegue non è coperto nemmeno dal typecheck.**

---

## 7. Il calendario esterno

### La sincronizzazione va in una direzione sola

**AI-Swisse → provider.** Se una persona sposta un evento nel proprio calendario,
la scadenza dell'attività **non cambia**, e alla riconciliazione successiva
l'evento torna alla data dell'attività. La schermata lo dichiara:

> *Gli eventi di questo calendario sono gestiti da AI-Swisse: le modifiche fatte
> a mano vengono riportate allo stato dell'attività.*

La ragione è che «31 agosto in AI-Swisse, 2 settembre su Google» non deve avere
due risposte possibili. La bidirezionale è **fuori dallo scopo della versione 1**.

### Il calendario dedicato

Uno per connessione, chiamato `AI-Swisse — <Nome azienda>`. Gli eventi personali
non vengono mai toccati.

### ⚠️⚠️ Google e Microsoft NON danno le stesse garanzie

| | Google | Microsoft |
|---|---|---|
| Scope | `openid` + `calendar.app.created` | `openid profile email offline_access` + `Calendars.ReadWrite` |
| Copre | **solo i calendari creati da questa applicazione** | **tutti i calendari della persona** |
| «Non leggiamo il tuo calendario personale» | **fatto**, imposto dal token | **impegno**, non un limite tecnico |

Microsoft **non ha** un equivalente di `calendar.app.created`: le alternative
sono `Calendars.ReadWrite.Shared` (più larga) o le sole letture, che non
permettono di creare il calendario. Le *application permissions*
(`Calendars.ReadWrite.All`) non si usano: darebbero accesso ai calendari
dell'intera organizzazione senza che nessuno abbia acconsentito (§51).

**La schermata del consenso mostra due avvertenze diverse.** Dire la stessa cosa
per entrambi sarebbe dire il falso per uno dei due.

### ⚠️ Il prezzo dello scope minimo di Google

`calendarList.list` **non è fra i metodi che `calendar.app.created` autorizza**.
Non possiamo elencare i calendari dell'utente, quindi **non possiamo cercare il
nostro per nome**. L'unico modo di ritrovarlo è aver conservato il suo
identificativo in `calendar_connections.provider_calendar_id` e verificarlo con
`calendars.get`, che invece è autorizzato.

Conseguenze pratiche:
- l'identificativo si salva **subito**, prima di scriverci dentro qualunque
  evento: se si salvasse dopo e l'esecuzione morisse in mezzo, al giro successivo
  ne creeremmo un secondo con lo stesso nome, senza potercene accorgere;
- se l'utente cancella il calendario, `calendars.get` risponde 404 e se ne crea
  uno nuovo, dichiarandolo. I collegamenti che puntavano al vecchio si tolgono e
  le attività vengono riscritte nel calendario nuovo.

Su Microsoft potremmo cercare per nome, ma **non lo facciamo**: un calendario che
si chiama come il nostro potrebbe essere di chiunque, e adottarlo significherebbe
scrivere eventi dentro un calendario altrui perché i nomi coincidevano.

### L'evento

- **Giornata intera.** `tasks.due_date` è una **data**: inventare le 9, le 17 o
  mezzogiorno significherebbe scrivere nel calendario di una persona
  un'informazione che nessuno ha mai dato (§8).
- **La fine è esclusiva**, su entrambi i provider: Google lo documenta
  («the (exclusive) end time»), Microsoft lo ottiene chiedendo due mezzanotti
  nello stesso fuso quando `isAllDay` è vero.
- **Nessun partecipante, nessun invito, nessuna riunione online.** Su Microsoft
  `attendees` è dichiarato vuoto e non omesso: in aggiornamento, ometterlo
  lascerebbe intatti eventuali destinatari aggiunti a mano.
- **Nessun promemoria del provider** (`reminders.useDefault: false` /
  `isReminderOn: false`): il motore delle notifiche è AI-Swisse, e due
  promemoria per la stessa cosa si ignorano entrambi (§57).
- `showAs: free` su Microsoft: una scadenza non occupa la giornata di nessuno.
- Contenuto: **azienda, titolo, scadenza, priorità, collegamento**. Mai importi,
  IBAN, mittenti, allegati o contenuti di documenti (§95). Chi condivide il
  calendario può spegnere il titolo: l'evento diventa
  *«Attività AI-Swisse in scadenza»* e il titolo vero resta dentro AI-Swisse.

### L'idempotenza, per due strade diverse

**Google** accetta un identificativo dell'evento scelto dal client (alfabeto
base32hex, 5–1024 caratteri). Il nostro è `ais` + SHA-256 di
`taskId:connectionId` — l'esadecimale usa solo `0-9a-f`, che è un sottoinsieme
dell'alfabeto ammesso, quindi nessuna ricodifica da sbagliare. Il flusso è:
`PATCH` → se 404 `POST` con l'id → se 409 `PATCH`. Il conflitto significa che la
creazione precedente **era** riuscita e la risposta si era persa.

⚠️ Su Google una cancellazione lascia una riga con `status: cancelled` e
**non libera l'identificativo**. Per questo il corpo dichiara sempre
`status: 'confirmed'`: è ciò che *ripristina* un evento cancellato a mano.

**Microsoft** genera lui l'identificativo. Offre `transactionId` contro i
ritentativi, ma dopo un timeout non sapremmo comunque quale evento è: quindi,
quando non abbiamo un id, si **cerca prima per metadato** (una proprietà estesa
con l'id dell'attività, filtrabile via `$filter`) e si scrive solo se non c'è
nulla. Una chiamata in più che rende corretta la ricreazione dopo una
cancellazione manuale.

### L'outbox, e perché non si scrive dentro il clic

`await updateTask(); await googleCalendarUpdate();` — se la seconda metà
fallisce, la task è salvata e il calendario no, e nessuno lo sa.

Con `calendar_sync_queue` la task è salvata **sempre** e la sincronizzazione è un
lavoro ritentabile. La chiave primaria è `task_id`: **un'attività modificata otto
volte in un minuto produce una sola riga**. Non conta quante volte è cambiata,
conta com'è adesso.

⚠️ **Il cambio di responsabile produce UNA riga, non due.** Il worker guarda
tutti i collegamenti esistenti di quella task più la connessione che dovrebbe
averne uno: l'evento del vecchio responsabile viene rimosso e quello del nuovo
creato nello stesso passaggio. Una coda per coppia `(task, utente)` avrebbe
richiesto di sapere già nel trigger chi perde l'evento — cioè di duplicare lì la
logica dello stato desiderato.

La coda si prenota con `for update skip locked` e un lease **a scadenza**: due
esecuzioni sovrapposte non si pestano i piedi, e un worker ucciso a metà non
blocca la riga per sempre.

### La riconciliazione

La coda reagisce ai cambiamenti di AI-Swisse. Non sa nulla di ciò che succede
dall'altra parte: un evento cancellato a mano, un calendario svuotato, una
scrittura accettata e poi persa, un lavoro finito nel fosso perché il token era
scaduto proprio in quel momento. Senza la riconciliazione quei casi non si
riparerebbero mai.

Gira una connessione per esecuzione, quella non controllata da più tempo, e
**non scrive eventi: rimette in coda**. Un solo percorso di scrittura in tutto il
sistema.

### Scollegare

L'ordine è il contenuto della funzione:

1. si spegne la sincronizzazione;
2. **se l'utente lo ha chiesto**, si rimuovono gli eventi — finché il token è
   ancora valido;
3. si revoca il consenso presso il provider, dove è supportato;
4. si distruggono i segreti;
5. si marca la connessione come scollegata.

⚠️ **Gli eventi non si cancellano senza chiedere.** Sono nel calendario personale
di qualcuno e possono essere l'unica traccia che quella persona ha di una
scadenza. Non esiste un valore predefinito: se non viene detto, restano.

⚠️ **Microsoft non si può revocare dall'esterno.** Graph non espone un endpoint
di revoca: si toglie da `myapplications.microsoft.com`. La risposta lo dichiara
(`revoked: false`) e la schermata lo dice, invece di lasciar credere il contrario.

---

## 8. Il modello dei dati

| Tabella | Che cosa contiene | Permessi del client |
|---|---|---|
| `notifications` | il segnale, con payload di soli metadati | **sola lettura**, e solo le proprie |
| `notification_preferences` | consenso e fuso, per persona e azienda | lettura/scrittura delle **proprie** |
| `notification_deliveries` | i tentativi di consegna | **nessuno** |
| `calendar_connections` | il calendario collegato di **una persona** | sola lettura, **solo le proprie**, solo alcune colonne |
| `calendar_connection_secrets` | token cifrati AES-256-GCM | **nessuno** |
| `calendar_oauth_states` | stato anti-CSRF con triplo legame | **nessuno** |
| `calendar_event_links` | la corrispondenza task ↔ evento | sola lettura, solo le proprie |
| `calendar_sync_queue` | l'outbox | **nessuno** |
| `calendar_sync_runs` | osservabilità (conteggi, non testi) | **nessuno** |

### Le sei garanzie, tutte nel database

1. **Isolamento fra aziende** — A non vede niente di B.
2. **Isolamento fra persone** — e questa è nuova rispetto a tutti i moduli
   precedenti: due colleghi della stessa azienda non si leggono le notifiche, non
   si vedono le connessioni, non si toccano le preferenze. Un amministratore
   **non può** accendere le email a un collega: il consenso a essere contattati
   non è delegabile, e qui non lo è tecnicamente.
3. **Token irraggiungibili** — nessun GRANT, nessuna policy, RLS attiva.
4. **Notifiche non fabbricabili** — il client non ha alcuna scrittura; «segna
   come letta» passa da una funzione.
5. **Coda del solo server** — non si legge e non si scrive dal browser.
6. **Idempotenza come vincolo** — `unique (connection_id, task_id)` e
   `primary key (task_id)`: un worker eseguito due volte non può creare due
   eventi, qualunque cosa faccia il codice.

⚠️ Ogni tabella passa da `revoke all` **prima** dei grant. Su Supabase una
tabella nuova di `public` nasce con i permessi completi per `authenticated`, e un
grant scritto dopo *aggiunge* privilegi invece di restringerli — la lezione della
0014. La migrazione **si autoverifica** in fondo: se un domani qualcuno
concedesse per sbaglio la scrittura sulle notifiche o un permesso sui token,
rieseguirla lo direbbe subito.

### Indici

`idx_tasks_due_global (due_date, assignee_user_id)` parziale sulle attività
aperte con scadenza. **Non è un duplicato** di quelli della 0016: quelli iniziano
tutti con `company_id` perché servono alle liste di *una* azienda, mentre il
worker fa la domanda opposta — «quali attività di chiunque scadono in questa
finestra».

---

## 9. Configurazione — Google Cloud Console

> Le credenziali possono essere **le stesse dell'Inbox** (stesso progetto, stessa
> app OAuth) oppure diverse — ma vanno **impostate esplicitamente** in
> `GOOGLE_CALENDAR_CLIENT_ID`/`SECRET`, anche quando il valore è identico a
> quello di `GOOGLE_CLIENT_ID`.
>
> ⚠️ **Non c'è un ripiego, ed è deliberato.** La prima versione ripiegava sulle
> credenziali dell'Inbox, e in produzione il risultato è stato: `GOOGLE_CLIENT_ID`
> esiste già per la posta, quindi la schermata dichiarava Google «configurato» e
> offriva il pulsante — ma quell'app OAuth ha registrato **solo lo scope di
> Gmail**. Premendolo, Google avrebbe rifiutato `calendar.app.created` e il
> messaggio dell'applicazione («il permesso non è stato concesso, spunta la
> casella») avrebbe mandato a cercare nel posto sbagliato.
>
> Che una schermata di consenso abbia quello scope, il server **non può saperlo**.
> Quindi non lo deduce: chiede una variabile dedicata, e impostarla significa
> «ho preparato questa app anche per il calendario».

### 9.1 API da abilitare

Nel progetto `ai-swisse-inbox` (o in uno nuovo):

- **Google Calendar API** — *API e servizi → Libreria → Google Calendar API →
  Abilita*.

Nient'altro. Non serve Pub/Sub: la sincronizzazione è a senso unico e non riceve
notifiche dal provider.

### 9.2 Schermata di consenso OAuth

Se si riusa l'app dell'Inbox, va **aggiunto uno scope**:

- `https://www.googleapis.com/auth/calendar.app.created`

*API e servizi → Schermata consenso OAuth → Ambiti → Aggiungi o rimuovi ambiti →
Aggiungi manualmente* e incollare lo scope.

⚠️ **`calendar.app.created` NON è uno scope riservato** come `gmail.readonly`:
non richiede la valutazione di sicurezza CASA. In modalità Test valgono comunque
i limiti degli utenti di prova; per uscirne serve la verifica dell'app, ma senza
l'ostacolo più pesante che blocca l'Inbox.

### 9.3 Credenziali OAuth

*API e servizi → Credenziali → ID client OAuth* (tipo **Applicazione web**).

**URI di reindirizzamento autorizzati** — aggiungere:

```
https://tcjmagaqktmzijbfntvy.supabase.co/functions/v1/calendar-oauth/callback
```

⚠️ È un URI **diverso** da quello dell'Inbox (`/email-oauth/callback`): vanno
elencati entrambi.

Annotare **ID client** e **Client secret**.

⚠️ **La riga di §9.2 sull'assenza di valutazione CASA non è stata verificata da
questa parte**: è scritta qui dal 2026-07-31 e nessuno ha aperto la console per
controllarla. La console dichiara la classificazione dello scope nel momento in
cui lo si aggiunge: **quello è il posto dove leggerla**, non questo documento.
In modalità *Test* la connessione funziona comunque per gli indirizzi elencati
come utenti di prova, che è tutto ciò che serve per una prova.

### 9.4 Stabilire la connessione di prova — la sequenza esatta

**Stato misurato il 2026-08-03**, interrogando la funzione viva con il JWT
dell'account dimostrativo:

```
POST /calendar-oauth/providers → 200 {"providers":[],"scopes":{},"emailConfigured":false}
POST /calendar-oauth/start     → 503 PROVIDER_NOT_CONFIGURED
GET  /calendar-oauth/callback  → 302 …/calendario/impostazioni?calendar=error&code=STATE_INVALID
```

Cioè: **nessun provider è configurato**, e il server lo dice invece di offrire un
pulsante che porterebbe a un errore. Non manca il consenso: manca l'app OAuth.

I passi, nell'ordine, e chi li può fare:

1. **§9.1–9.3 nella console Google** — *solo l'utente*: creare o riusare il
   progetto, abilitare Google Calendar API, aggiungere lo scope
   `https://www.googleapis.com/auth/calendar.app.created` alla schermata di
   consenso, aggiungere il proprio indirizzo fra gli **utenti di prova**, creare
   l'ID client di tipo *Applicazione web* con l'URI di reindirizzamento di §9.3.
2. **Impostare i due secret** — `GOOGLE_CALENDAR_CLIENT_ID` e
   `GOOGLE_CALENDAR_CLIENT_SECRET`, come in §11.2. Sono **dedicati**: anche se
   il valore fosse identico a quello dell'Inbox va scritto qui (§9, riquadro).
3. **Verificare che il server abbia cambiato idea**: `POST /providers` deve
   rispondere `{"providers":["google"],"scopes":{"google":["openid","…/calendar.app.created"]}}`.
   Finché risponde `[]`, il resto non ha senso: i secret non sono arrivati alla
   funzione.
4. **Dare il consenso** — *solo l'utente*: da *Calendario → Impostazioni →
   Collega Google*. ⚠️ Nella schermata di Google il permesso è una **casella da
   spuntare**: chi preme «Continua» senza spuntarla ottiene un token valido
   **senza** lo scope, e il callback risponde `SCOPE_NOT_GRANTED`. È l'errore
   più probabile del percorso, ed è già stato pagato con l'Inbox.
5. **Che cosa deve essere successo, e si legge dal database**: una riga in
   `calendar_connections` con `status='active'` e `scopes` che contiene
   `calendar.app.created`; due righe di segreti cifrati; una voce in coda per la
   sincronizzazione iniziale. Poi `npm run test:calendar` resta verde e la
   riconciliazione crea il calendario dedicato al primo giro del worker.

---

## 10. Configurazione — Microsoft Entra ID

Solo se si vuole anche Outlook. Senza, la UI mostra Microsoft come
*non configurato* e non offre il pulsante.

1. **Registrazione app** — *Microsoft Entra ID → Registrazioni app → Nuova
   registrazione*. Tipi di account: *Account in qualsiasi directory
   organizzativa e account Microsoft personali*, se si vuole servire sia aziende
   sia utenti privati.
2. **URI di reindirizzamento** — piattaforma **Web**:
   ```
   https://tcjmagaqktmzijbfntvy.supabase.co/functions/v1/calendar-oauth/callback
   ```
3. **Autorizzazioni API** — *Aggiungi autorizzazione → Microsoft Graph →
   **Autorizzazioni delegate***:
   - `Calendars.ReadWrite`
   - `offline_access`
   - `openid`, `profile`, `email`

   ⚠️ **Delegate, non applicazione.** Le autorizzazioni di applicazione
   (`Calendars.ReadWrite.All`) darebbero accesso ai calendari dell'intera
   organizzazione.
4. **Segreto client** — *Certificati e segreti → Nuovo segreto client*. Copiarlo
   subito: dopo non è più leggibile.
5. **Consenso** — su un tenant aziendale un amministratore può concedere il
   consenso una volta per tutti; altrimenti lo concede ogni persona.

---

## 11. Configurazione — Supabase

### 11.1 Applicare la migrazione

Dal **SQL editor** del dashboard, incollare ed eseguire, **in quest'ordine**:

```
supabase/migrations/0018_calendar_notifications.sql
supabase/migrations/0019_notifications_mark_read.sql
supabase/migrations/0035_calendar_notification_schedulers.sql
```

⚠️ **Una migrazione alla volta.** `full-setup.sql` serve a installare da zero, su
un database in esercizio si applica il file singolo.

⚠️ **La 0035 vuole già configurato ciò che sta in §11.2 e §11.4.** Non fallisce
se manca — non potrebbe, perché deve poter essere applicata a un database vuoto
— ma i due scheduler che crea falliranno a ogni giro finché il Vault non
contiene `project_functions_base_url`. Lo dice con un `WARNING` mentre si
applica, e poi in `cron.job_run_details` a ogni esecuzione.

Verificare subito dopo:

```bash
npm run test:calendar
```

### 11.2 Secret delle Edge Function

```bash
cd ~/swiss-ai-suite-app

# Segreti dei due job periodici. Vanno GENERATI, non inventati.
openssl rand -base64 32   # → CALENDAR_WORKER_SECRET
openssl rand -base64 32   # → NOTIFICATIONS_WORKER_SECRET

npx supabase secrets set --project-ref tcjmagaqktmzijbfntvy \
  CALENDAR_WORKER_SECRET='<il primo valore>' \
  NOTIFICATIONS_WORKER_SECRET='<il secondo valore>' \
  GOOGLE_CALENDAR_CLIENT_ID='<id client Google>' \
  GOOGLE_CALENDAR_CLIENT_SECRET='<secret Google>'
```

Se si vuole Microsoft, aggiungere `MICROSOFT_CALENDAR_CLIENT_ID`,
`MICROSOFT_CALENDAR_CLIENT_SECRET` e, per un singolo tenant, `MICROSOFT_TENANT`.

Se si vogliono le email:

```bash
npx supabase secrets set --project-ref tcjmagaqktmzijbfntvy \
  NOTIFICATION_EMAIL_API_KEY='re_…' \
  NOTIFICATION_EMAIL_FROM='AI-Swisse <notifiche@ai-swisse.com>'
```

⚠️ Il dominio del mittente dev'essere **verificato presso il provider** (record
SPF/DKIM). Senza, gli invii falliscono con un errore permanente — che il worker
riconosce come tale e non ritenta.

Già presenti e riusati: `EMAIL_TOKEN_KEY` (la stessa chiave di cifratura
dell'Inbox — l'isolamento fra i due domini lo dà l'AAD, che è l'id della
connessione) e `APP_PUBLIC_URL`.

### 11.3 Deploy

```bash
cd ~/swiss-ai-suite-app
REF=tcjmagaqktmzijbfntvy

npx supabase functions deploy calendar-oauth        --project-ref $REF --no-verify-jwt
npx supabase functions deploy notifications-worker  --project-ref $REF --no-verify-jwt
npx supabase functions deploy calendar-sync         --project-ref $REF --no-verify-jwt
npx supabase functions deploy calendar-disconnect   --project-ref $REF
```

⚠️ **`--no-verify-jwt` sulle prime TRE.** Senza, il callback OAuth riceve 401
prima che il codice lo veda e il collegamento non si completa mai; e lo scheduler
non riesce a chiamare i worker.

⚠️⚠️ **`calendar-sync` è la terza, e qui c'era scritto il contrario.** Fino al
2026-07-31 questo documento e `supabase/config.toml` dicevano che
`calendar-sync` teneva la verifica del JWT **attiva** di proposito, «perché lo
scheduler chiama comunque con la service role key nell'header `Authorization`».
**Quell'header non c'è**: il comando di `calendar-sync-drain` manda
`Content-Type` e `x-calendar-worker-secret`, e nient'altro — si legge in
`cron.job` e ora nella migrazione 0035. Il risultato era **401 a ogni
esecuzione**, dal gate della piattaforma, prima che il codice della funzione lo
vedesse. La funzione autentica **tutti e tre** i propri chiamanti nel codice
(§11.5), quindi `--no-verify-jwt` è il deploy corretto — ed è come sono
deployate le altre cinque worker.

Verificare dopo il deploy:

```bash
npx supabase functions list --project-ref $REF
```

### 11.4 Gli scheduler

⚠️⚠️ **I due scheduler NON si creano più a mano: li crea la migrazione 0035.**
Fino al 2026-07-31 questa sezione conteneva due `cron.schedule` da incollare nel
SQL editor, ed è così che sono nati. Ha funzionato una volta, su un progetto
solo, e non sarebbe successo di nuovo: un blocco SQL dentro un documento è
un'istruzione per una persona, non un artefatto che qualcosa esegue. Un progetto
ricostruito, un ambiente di prova, un cliente installato da zero avrebbero avuto
`notifications-worker` deployata e mai chiamata, **senza che un solo test
diventasse rosso**. Dal 2026-07-31 `npm run test:operations` **rifiuta** un job
dell'inventario che viva solo in un `.md` (controllo 5).

Restano a mano **soltanto le tre voci del Vault**, che sono configurazione
dell'ambiente e non possono stare in una migrazione:

```sql
select vault.create_secret('<CALENDAR_WORKER_SECRET>',      'calendar_worker_secret');
select vault.create_secret('<NOTIFICATIONS_WORKER_SECRET>', 'notifications_worker_secret');

-- ⚠️ E l'origine del progetto: senza, i job non sanno chi chiamare.
select vault.create_secret('https://<ref>.supabase.co',     'project_functions_base_url');
```

Poi si applica `supabase/migrations/0035_calendar_notification_schedulers.sql`,
che crea entrambi i job, li verifica e fallisce se qualcosa non torna.

**Perché l'origine sta nel Vault e non nel comando.** Una migrazione finisce in
`supabase/full-setup.sql`, che la CI applica a un database effimero a ogni pull
request e che il README dà a chi installa da zero: con l'origine scritta dentro,
ogni installazione nuova programmerebbe due chiamate ogni 10 e 15 minuti verso
**la nostra** produzione. L'origine si legge quindi a ogni esecuzione, con
`public.functions_base_url()` — lo stesso idioma con cui si legge il segreto, e
per la stessa ragione: ruotarla non richiede di riscrivere il job.

⚠️ **Non è un parametro di database, e non per gusto.** La prima versione usava
`app.settings.functions_base_url`. Non si può: su Supabase ospitato `postgres`
possiede il database ma non è superutente, e
`alter database … set app.settings.…` risponde **42501 permission denied**
(provato contro il progetto vero, come pure `alter role`). Il Vault è l'unico
posto scrivibile da noi.

⚠️ **`public.functions_base_url()` SOLLEVA se l'origine manca o è malformata**,
invece di restituire `NULL`. Un `NULL` comporrebbe `net.http_post(url := null)`,
cioè un guasto che nessuno legge; così invece ogni esecuzione finisce `failed`
in `cron.job_run_details` con il messaggio che dice cosa manca. La funzione è
`security invoker` e **revocata a `anon` e `authenticated`**: verificato con la
chiave anon contro l'API vera, `rpc/functions_base_url` risponde **401
permission denied**.

⚠️ **`timeout_milliseconds := 150000` non è facoltativo.** `pg_net` ha un timeout
predefinito di **5 secondi**: senza, chiuderebbe la connessione a un lavoro che
ne dura ottanta e ogni esecuzione risulterebbe fallita. È la stessa trappola già
pagata con l'Inbox.

⚠️ In `cron.job_run_details`, `succeeded` dice soltanto che `net.http_post` ha
**accodato** la richiesta. Per sapere se il lavoro è stato fatto vanno letti i
log della funzione — che dalla stessa data portano `phase=start`/`phase=end`,
`rid` e `durationMs` (§11.6).

### 11.5 Chi chiama che cosa, e come si autentica

| Funzione | Chiamante | Autenticazione | `verify_jwt` |
|---|---|---|---|
| `calendar-sync` `{action:'drain'}` | scheduler `calendar-sync-drain` | `x-calendar-worker-secret`, confronto a tempo costante | `false` |
| `calendar-sync` `{action:'reconcile'}` | diagnostica | idem | `false` |
| `calendar-sync` `{action:'sync'}` | una persona, dal pulsante | JWT verificato in `authenticate()` + proprietà della connessione + `assertMember` | `false` |
| `notifications-worker` | scheduler `notifications-worker` | `x-notifications-worker-secret`, confronto a tempo costante | `false` |

Senza segreto → **403**; con il segreto sbagliato → **403**; senza il segreto
della funzione impostato → **503 `CONFIG_MISSING`**. Su `sync`, senza JWT →
**401**, anche presentando il segreto del worker.

⚠️ `verify_jwt = false` **non allarga** la superficie: le quattro righe qui sopra
sono verificate nel codice, non dal gate della piattaforma. Ciò che allargava la
superficie era il contrario — una funzione che si affidava a un header che
nessuno mandava.

### 11.6 Che cosa lasciano nei log

Entrambi i worker scrivono **due** righe per esecuzione:

```
[notifications-worker] phase=start rid=<id>
[notifications-worker] phase=end rid=<id> durationMs=812 status=ok tasksScanned=3 created=1 …
```

⚠️ **L'apertura si scrive prima di qualsiasi lavoro**, e non è pedanteria: i 150
secondi di Supabase uccidono l'isolate senza far girare il `finally`, quindi la
riga di chiusura di un'esecuzione morta **non arriva mai**. Senza un'apertura,
un'esecuzione morta a metà è indistinguibile da una mai partita — e sono due
guasti diversi, con due cause diverse.

`rid` è l'identificativo della piattaforma (`sb-request-id`, poi `x-request-id`,
poi `cf-ray`). Se non ce n'è nessuno se ne genera uno **con il prefisso `gen:`**:
chi legge deve poter distinguere «questo id lo ritrovi nei log del gateway» da
«questo id esiste solo qui dentro». Nei log non finiscono titoli, indirizzi né
token: solo numeri (§128).

---

## 12. Diagnostica

**Il calendario interno non mostra niente** — controllare il filtro «Le mie»: è
il valore predefinito, e un'attività assegnata a un collega non compare. Le
attività senza scadenza non entrano mai nella griglia; il loro numero è in fondo
alla pagina.

**Un evento non compare nel calendario esterno** — nell'ordine:
1. la connessione è `active` e la sincronizzazione accesa?
2. l'attività è assegnata **a quella persona**, ha una scadenza, non è conclusa e
   non è archiviata? (`getCalendarDesiredState` dice di no in tutti gli altri casi)
3. la riga è ancora in `calendar_sync_queue`? Se sì, con quale `last_error` e
   quanti `attempts`?
4. lo scheduler gira? `select * from cron.job where jobname = 'calendar-sync-drain'`

**Un promemoria non è arrivato** — la persona ha le notifiche in-app accese? La
finestra è attiva nelle sue preferenze? Il suo fuso è corretto? Il worker gira
solo **dopo le 8 locali** di chi riceve. Esiste già una riga in `notifications`
con quella `dedupe_key`? Se sì, il promemoria è già stato dato.

**Un'email non è partita** — `notification_deliveries` porta `status`,
`attempts`, `error_code` e `provider_message_id`. `failed` con un codice 4xx è
permanente (dominio non verificato, indirizzo rifiutato) e non verrà ritentato.

**Log delle Edge Function** — il CLI non ha `functions logs`: si usa la
Management API (`POST /v1/projects/<ref>/analytics/endpoints/logs.all`) con
`iso_timestamp_start/end` espliciti, altrimenti la finestra predefinita è troppo
stretta e torna vuoto.

---

## 13. Test

```bash
npm run test:calendar-unit   # 158/158, offline
npm run test:calendar        # 58/58 sul database reale (richiede 0018 + 0019)
```

### Che cosa coprono i 156 controlli offline

1. **Stato desiderato** — tutti i casi di §109, compreso quello che nessun test
   sul database coprirebbe: un'attività di un'altra azienda, e la distinzione fra
   `absent` e `untouchable`.
2. **Promemoria** — le quattro finestre, il recupero di un job saltato, e
   **l'ora legale**: alla stessa ora UTC, il 28 marzo a Zurigo sono le 07:30 e il
   29 le 08:30, e la soglia delle otto cade in mezzo. Nessun test dipende dal
   fuso della macchina.
3. **Deduplicazione** — tre esecuzioni producono la stessa chiave; quattro
   finestre producono quattro chiavi distinte.
4. **Adapter** — su un provider finto: giornata intera con la fine esclusiva,
   nessun partecipante, nessun promemoria del provider, metadati per la
   riconciliazione, e i **ritentativi**: un 409 di Google non crea un secondo
   evento, e su Microsoft la ricerca per metadato trova quello già creato.
5. **L'assenza come garanzia** — nessun adapter espone `listCalendars`,
   `listEvents`, `freeBusy`, `sendInvite`, `addAttendee`. Se un domani
   comparissero, il test lo direbbe.
6. **Contenuto** — nel calendario esterno non finiscono importi, IBAN, mittenti o
   contenuti di documenti.
7. **Griglia e agenda** — agosto 2026 comincia di sabato e finisce di lunedì:
   sei righe, e l'intervallo chiesto al database copre lo sconfinamento al 6
   settembre.
8. **Coerenza server ↔ interfaccia** — i default e il fuso predefinito coincidono
   con quelli della 0018. È la trappola già pagata con l'Inbox, dove una costante
   scritta due volte era divergente.

### Controprove eseguite

Un test che non fallisce quando il difetto c'è non è un test. Rimettendo i
difetti, i controlli falliscono:

| Difetto reintrodotto | Controlli falliti |
|---|---|
| `reauth_required` trattato come `absent` | 2 |
| fine dell'evento non esclusiva | 6 |
| promemoria dei 7 giorni con l'uguaglianza invece dell'intervallo | 1 |

---

## 14. Difetti trovati aprendo le schermate

Come in ogni fase di questo progetto, i difetti peggiori non erano nel codice
letto ma nella pagina aperta.

1. **La campanella diceva «Nessuna notifica»** con la 0018 non applicata, invece
   di dichiarare il guasto. Identico all'Inbox con la 0013: un guasto travestito
   da stato legittimo.
2. **Collegamenti alti 6 pixel** a 375px nella griglia, e 20 pixel sul desktop.
   WCAG 2.2 chiede 24. Ha cambiato il progetto della vista mobile, non solo il CSS.
3. **«Apri Attività» era un link inline da 18 pixel.** Ora è un pulsante.
4. **«Lunedì 27 Luglio»** — `text-transform: capitalize` maiuscolava ogni parola,
   e in italiano e francese i mesi sono minuscoli. In tedesco non si vedeva,
   perché i sostantivi sono già maiuscoli: il difetto era visibile in due lingue
   su tre.
5. **«Priorité: toutes»** — i due punti erano scritti nel JSX, e in francese
   vogliono uno spazio davanti. Non sono un segno «uguale in tutte le lingue».

E uno nel controllo stesso:

6. **`npm run i18n:coverage` dava un falso positivo** su una riga di commento.
   Un apostrofo dentro un commento scritto fra gli attributi di un tag veniva
   letto come apertura di stringa; con un numero pari di apostrofi prima del `>`,
   l'ultima «stringa» restava aperta e si mangiava il `>` del tag. Da lì in poi
   l'automa credeva di essere fra i figli di un elemento.
   Corretto saltando i commenti, con un caso nell'autoverifica (ora 12) —
   ottenuto per **delta debugging** dal file vero, perché tre tentativi di
   riscriverlo «in bello» avevano prodotto casi che non fallivano più nemmeno con
   il difetto rimesso, cioè test inerti.

---

## 15. Che cosa NON è stato implementato

Fuori dallo scopo, e dichiarato:

- sincronizzazione **bidirezionale**, importazione di eventi personali,
  disponibilità/free-busy;
- riunioni, partecipanti, inviti, pagine di prenotazione, Meet e Teams;
- notifiche push del browser o del telefono, SMS, WhatsApp, Slack;
- attività ricorrenti;
- vista settimanale a griglia oraria, trascinamento, scheduling orario, Gantt;
- regole automatiche («quando arriva una fattura sopra CHF 5'000, assegna
  Andrea») — sono **workflow**, non notifiche, e appartengono a un'altra fase.

## 16. Limiti noti

- **Nessuna prova contro le API vive.** Gli adapter sono allineati alla
  documentazione ufficiale corrente, non a una risposta reale.
- **Le notifiche non seguono per cascata la cancellazione di un'attività.**
  `notifications.entity_id` non ha una chiave esterna, perché è polimorfico
  (punta a una task oppure a una connessione). Nella pratica non succede: **nulla
  nell'applicazione cancella un'attività** — si archiviano (0016) — e le notifiche
  cascatano comunque su azienda e utente. L'orfano nasce solo cancellando una
  riga a mano dal SQL editor, e il suo collegamento porterebbe a un'attività che
  non c'è più. Si dichiara invece di aggiungere un trigger per un percorso che
  non esiste.
- **Un'attività cancellata davvero** (non archiviata) lascia l'evento orfano
  presso il provider: la cascata rimuove il collegamento e con esso l'unica
  informazione su dove cercarlo. Le attività si archiviano, e l'archiviazione
  passa dal percorso normale che l'evento lo rimuove.
- **`tasks.due_date` è una data.** Finché non esisterà un vero `due_at`, gli
  eventi restano di giornata intera.
- **Spegnere le notifiche in-app spegne anche le email** (vedi §6).
- **La riconciliazione tratta una connessione per esecuzione**: con molte
  connessioni il giro completo richiede più tempo. È una scelta di prudenza sul
  budget dei 150 secondi, non un limite dello schema.
- **Nessuna politica di conservazione** per `notifications`,
  `notification_deliveries` e `calendar_sync_runs`: si accumulano, come le
  analisi dalla 0010.
