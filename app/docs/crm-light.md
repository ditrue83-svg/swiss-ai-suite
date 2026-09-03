# CRM Light — Clienti e controparti

Stato: **in esercizio dal 2026-07-30**, interfaccia compresa.
Migrazioni fino alla **0050** applicate. Le sequenze di follow-up sono nel
database reale e `automation-worker` è stato ridistribuito il 2026-09-01.
Test: `npm run test:crm-unit` **254/254** offline · `npm run test:crm`
**191/191** sul database reale dopo la 0050, con pulizia verificata.

---

## 1. Che cosa risponde questo modulo

Fino alla 0025 il prodotto sapeva che cosa è arrivato (Inbox), che cosa sappiamo
(Documenti), che cosa dobbiamo fare (Attività), quando (Calendario), che cosa non
dimenticare (Notifiche), che cosa può fare da sé (Automazioni), quali operazioni
finanziarie richiedono attenzione (Finanze) e a quali obblighi siamo legati
(Contratti). Mancava il soggetto di tutte quelle frasi.

Il CRM aggiunge una sola domanda: **con chi stiamo lavorando?**

    COMUNICAZIONE → CONTROPARTE → PERSONE → DOCUMENTI → OPPORTUNITÀ
                  → ATTIVITÀ → CONTRATTI → FINANZE → STORICO DELLA RELAZIONE

### Le quattro regole

1. **Collegare, non copiare.** Il nome del fornitore letto su una fattura resta in
   `finance_extractions.supplier_name`; la controparte letta su un contratto resta
   in `contract_extractions.counterparty`; il mittente di una email resta in
   `email_messages.sender_email`. Il CRM aggiunge un **riferimento**.
2. **Suggerire, non inventare.** Un'anagrafica nasce da un gesto umano.
3. **Verificare, non fondere automaticamente.**
4. **Organizzare la relazione, non profilare le persone.**

### Perché questo modulo contraddice una decisione scritta, e come

La 0024, righe 332-335, sul campo `contracts.counterparty_name`:

> «la controparte è METADATO CONTRATTUALE, non un'anagrafica. Nessun riferimento a
> una tabella di clienti o fornitori: quella tabella non esiste, e crearla qui
> significherebbe cominciare un CRM di straforo».

E `docs/finance-operations.md` riga 63: «nessuna anagrafica fornitori: il fornitore
è un nome letto sul documento».

Erano affermazioni giuste **finché la tabella non esisteva**. Il modo in cui
vengono superate è il punto: **nessun nome estratto viene riscritto**. Accanto
compare una colonna di collegamento facoltativa e annullabile, e un contratto con
`counterparty_organization_id = null` resta valido.

**Provato**: collegando il contratto «Swisscom — Internet sede Lugano», il campo
`counterparty_name` è rimasto «Swisscom (Svizzera) SA» e accanto è comparso il
riferimento CRM. `test:crm` §10 sorveglia la stessa garanzia sui documenti.

---

## 2. Il modello dei dati

**13 tabelle, 11 tipi nuovi, 45 funzioni, 31 trigger, 40 policy, 39 indici**
(0026, 4242 righe), più 6 colonne su tabelle esistenti. La 0047 aggiunge
`crm_field_definitions` e `crm_field_values` (2 tabelle, 2 tipi, 5 funzioni,
2 trigger, 7 policy, 7 indici — §15-quater): il modello oggi conta **15
tabelle**.

| Tabella | Che cosa contiene |
|---|---|
| `crm_organizations` | la controparte: impresa, ente, studio, comune |
| `crm_organization_roles` | i ruoli, **al plurale** |
| `crm_contacts` | le persone |
| `crm_contact_methods` | email, telefoni, siti — di una persona **oppure** di un'organizzazione |
| `crm_contact_organizations` | dove lavora, e dove lavorava |
| `crm_opportunities` | le trattative |
| `crm_interactions` | note, telefonate, incontri |
| `crm_events` | lo storico, append-only, scritto solo dai trigger |
| `crm_organization_documents` · `crm_organization_emails` · `crm_contact_emails` · `crm_opportunity_documents` | i quattro ponti |
| `crm_link_suggestions` | ciò che il sistema sospetta e una persona conferma |
| `crm_field_definitions` | i campi personalizzati decisi **dall'azienda** (0047) |
| `crm_follow_up_sequences` · `crm_follow_up_steps` | le sequenze per fase e i loro passi, configurazione aziendale (0050) |
| `crm_follow_up_emissions` | il verbale idempotente di quale passo è stato emesso per trattativa e ciclo di email uscente |
| `crm_field_values` | i loro valori, uno per riga, in colonne tipate (0047) |

### Due entità distinte, mai una stringa sola

| Entità | Esempio |
|---|---|
| Organizzazione | `Rossi SA` |
| Persona | `Laura Bianchi` |

Non esiste `«Laura Bianchi — Rossi SA»` come valore unico: quando Laura cambia
azienda, la riga vecchia riceve `active_until` e ne nasce una nuova. Le email di
due anni fa restano email scambiate con Rossi SA, perché è quello che sono state.

### L'organizzazione NON è `public.companies`

`companies` è il **tenant**: l'impresa che *usa* AI-Swisse. Le controparti vivono
in una tabella nuova con `company_id` verso il tenant, come `documents`, `tasks`,
`contracts`, `finance_items`. Conseguenza: `companies.uid_che` è l'IDI di chi usa
il prodotto, `crm_organizations.uid_che` è l'IDI di una controparte — non sono la
stessa cosa e non si confrontano fra loro.

### Ruolo ≠ stato ≠ fase

- **Ruolo** (`crm_organization_roles`): `lead`, `prospect`, `customer`,
  `former_customer`, `supplier`, `partner`, `authority`, `other`. **Multipli**:
  la stessa impresa può essere insieme cliente, fornitore e partner.
- **Stato della relazione**: `active` | `inactive`.
- **Fase** (`crm_opportunities.stage`): `lead`, `contacted`, `proposal`,
  `negotiation`, `won`, `lost` — descrive **una trattativa**.

`customer` e `negotiation` non sono due valori dello stesso elenco.

### Tre proprietà distinte

| Concetto | Colonna |
|---|---|
| Responsabile della relazione | `crm_organizations.account_owner_user_id` |
| Responsabile della trattativa | `crm_opportunities.owner_user_id` |
| Responsabile dell'attività | `tasks.assignee_user_id` |

Tutti e tre puntano a `auth.users`, **mai a `public.profiles`** (leggibile solo dal
proprietario: una join mostrerebbe zero righe senza errore). L'appartenenza la
verifica un trigger; i nomi si risolvono con `company_member_directory`.

### Ciò che il modello NON contiene, per scelta

- **Nessun `primary_email`/`primary_phone` sull'organizzazione**: sarebbero una
  seconda verità accanto a `crm_contact_methods`, dove `is_primary` esiste già. Il
  recapito principale è un valore **composto in lettura**.
- **Nessun `archived` fra gli stati**: l'archiviazione è `archived_at`, come in
  documents, tasks, contracts, finance_items. Uno stato che duplica un timestamp
  diverge dal timestamp.
- **Nessuna probabilità di chiusura, nessun punteggio, nessuna previsione.**
- **Nessun campo personale oltre il necessario.**

### Le sei colonne aggiunte agli altri moduli

`tasks.crm_organization_id` · `tasks.crm_opportunity_id` ·
`contracts.counterparty_organization_id` · `finance_items.supplier_organization_id`
con i due timbri `supplier_organization_set_by/_at`.

Tutte facoltative e annullabili. **I record esistenti continuano a funzionare
senza.**

⚠️ **La difesa di queste colonne non può essere un grant.** Su `public.tasks` i
permessi sono di TABELLA dalla 0004 e nessuna migrazione li ha revocati: un
`grant (colonna)` scritto oggi **aggiunge** privilegi, non ne toglie. L'unica
difesa è un trigger, ed è quello che c'è — per tutte e tre, anche dove i grant di
colonna funzionerebbero, perché una difesa che vale in un posto solo si dimentica.

---

## 3. Fonte della verità, campo per campo

| Fatto | Proprietario | Che cosa aggiunge il CRM |
|---|---|---|
| Mittente di una email | `email_messages.sender_email` / `sender_name` | riga in `crm_organization_emails` / `crm_contact_emails` |
| Mittente di un documento | valore **effettivo** di `list_documents.sender` (analisi + correzioni) | riga in `crm_organization_documents` |
| Controparte di un contratto | `contract_extractions.counterparty` (letto), `contract_term_versions.counterparty_name` (effettivo) | `contracts.counterparty_organization_id` |
| Fornitore di una fattura | `finance_extractions.supplier_name`, `supplier_vat_id` | `finance_items.supplier_organization_id` |

Nessuna colonna d'origine viene mai riscritta. Scollegare (`… = null`) non cancella
nulla del fatto originario.

---

## 4. Abbinamento e deduplicazione

### Perché l'abbinamento automatico è quasi sempre sbagliato

Misurato sulle **117 email vere** della casella collegata in produzione:

| | |
|---|---|
| mittenti distinti | **54** |
| domini distinti | 44 |
| messaggi `is_bulk = true` | 57 su 117 |
| mittenti di tipo noreply/newsletter | 40 |
| `relevance = clearly_irrelevant` | 55 |

I domini più frequenti sono `stripe.com`, `amazon.it`, `mail.anthropic.com`,
`mail.adobe.com`, `cobratate.com`. **Creare un'organizzazione per ogni mittente
produrrebbe 44 anagrafiche di cui quasi nessuna è una controparte commerciale.**

Con il filtro del modulo — non massivo, rilevanza azionabile, mittente non di
servizio — i **54 mittenti diventano 6**. E fra quei sei restano `amazon.it` e
`info.interdiscount.ch`: **nemmeno il filtro migliore autorizza un'anagrafica
automatica.** Da qui la regola: quelle righe diventano *suggerimenti*.

Il filtro non introduce un classificatore nuovo: `is_bulk`, `relevance` e
`relevance_confidence` li calcola già l'Inbox, e il CRM li **legge**. Un secondo
classificatore avrebbe potuto dare un giudizio diverso sulla stessa email, e allora
due schermate del prodotto ne avrebbero raccontate due.

### La scala

| Grado | Segnale | Esito |
|---|---|---|
| 1 | IDI identico **e cifra di controllo valida** | collegamento automatico ammesso |
| 2 | Indirizzo email identico a un recapito registrato | collegamento automatico ammesso |
| 3 | Dominio del mittente = dominio del sito, **non pubblico** | suggerimento |
| 4 | Ragione sociale normalizzata identica (`finance_norm_supplier`) | suggerimento |
| 5 | Tutto il resto | niente |

Regole non negoziabili:

- **L'IBAN non è un criterio d'identità.** Due imprese possono condividere un
  conto, una può cambiarlo, e un IBAN sulla fattura è del creditore.
- **`finance_norm_supplier` non è un'identità.** Il commento della funzione lo
  dichiara: «*Swisscom* e *Swisscom SA* restano soggetti diversi finché nessuno
  dice il contrario. Serve solo a sospettare un duplicato, mai a fondere.»
- **I domini pubblici non provano nulla.** L'elenco vive in **due posti** — SQL
  (`crm_is_public_domain`) e TypeScript (`crmMatch.PUBLIC_EMAIL_DOMAINS`) — e
  `test:crm-unit` **legge la migrazione** per confrontarli: è l'unico controllo che
  può vedere la divergenza, perché il typecheck non guarda dentro l'SQL.
- **Nessun `+tag` rimosso, nessun punto Gmail tolto.** La normalizzazione è
  `lower(btrim(…))` e nient'altro: alterare l'indirizzo per «riconoscerlo meglio»
  significa inventare un'identità, e se sbaglia sbaglia **unendo persone**. Due
  asserzioni in `test:crm-unit` lo sorvegliano, e l'autoverifica della 0026 lo
  prova anche in SQL.
- **Due candidati forti in pareggio non collegano**: due organizzazioni con lo
  stesso indirizzo sono un duplicato da risolvere, e sceglierne una a caso
  attribuirebbe una comunicazione all'impresa sbagliata in silenzio.

### Duplicati

`unique (company_id, uid_norm) where uid_norm is not null`: **l'IDI è un'identità**,
e due righe con lo stesso IDI nella stessa azienda sono sempre un duplicato. Su
`public.companies` questo vincolo non esiste; il CRM non ripete quella lacuna.

⚠️ `uid_norm` è **NULL** quando la cifra di controllo mod-11 non torna. Un IDI non
verificato non identifica nessuno, quindi non deve né collegare né bloccare: due
IDI con la cifra errata non collidono fra loro (`test:crm` §7).

Per tutto il resto i duplicati si **mostrano**: `crm_duplicate_candidates` propone
righe con lo stesso dominio, la stessa email o la stessa ragione sociale
normalizzata, e si ferma lì.

La fusione (`crm_merge_organizations`) è un gesto **da amministratore**,
transazionale: trasferisce ruoli, contatti, recapiti, opportunità, interazioni,
collegamenti e storico sul record principale, **non duplica relazioni già
presenti**, e archivia il secondario lasciando un rimando (`merged_into_id`).

### Nessuna deduplicazione fra aziende diverse

`crm_duplicate_candidates` e `crm_match_email` sono rigorosamente dentro il tenant.
Non esiste, e non deve esistere, una risposta del tipo «questo cliente esiste in
un'altra azienda AI-Swisse»: sarebbe una fuga di dati travestita da funzione utile.
`test:crm` §1 lo prova su entrambe.

---

## 5. Opportunità

Campi: titolo, fase, responsabile, referente, valore + valuta, chiusura prevista,
prossimo passo + data, motivo della perdita, timbri `won_at`/`lost_at`.

- **Nessuna probabilità**: «Offerta = 50%» ha l'aria di una misura e non deriva da
  niente; sommata su venti trattative produce un numero che qualcuno userebbe per
  decidere.
- **I timbri li scrive il database.** `check ((stage = 'won') = (won_at is not
  null))`, e il guardiano li mette e li toglie. Riaprire una trattativa vinta
  azzera il timbro ma **non cancella la storia**: il passaggio resta in
  `crm_events`, che è append-only.
- **Vinta AGGIUNGE il ruolo `customer` e non toglie `prospect`**: cancellare il
  passato per aggiornare il presente è il modo più rapido di perdere la storia di
  come è nato un cliente.
- **Il valore porta sempre la sua valuta** (`check`), e **non si somma fra valute**:
  `crm_pipeline_summary` rende una riga per valuta e la somma la fa Postgres in
  `numeric`. Le opportunità senza valore non diventano zero: `currency: null` è una
  riga a sé con il solo conteggio.
- **Il prossimo passo non è un'attività** (§50): è la sintesi commerciale. Il
  pulsante «Crea attività dal prossimo passo» le collega, e se l'attività esiste
  già la **mostra** invece di crearne una seconda.

Lo storico dei passaggi conserva **da dove** e **verso dove**: senza il «da», la
domanda «questa trattativa è tornata indietro?» non ha risposta.

### Sequenze di follow-up (0050, Fase 1.3)

Una sequenza è configurazione dell'azienda, non codice: nome, fase aperta
(`lead`, `contacted`, `proposal`, `negotiation`) e da uno a dieci passi. Ogni
passo dichiara dopo quanti giorni di silenzio creare un'attività, il suo titolo
e, facoltativamente, un template email. Per una fase può esistere una sola
sequenza attiva: la scheda della trattativa deve poter rispondere in modo unico
alla domanda «qual è il prossimo passo?».

**«Senza risposta» ha una definizione stretta.** Si prende l'ultima email CRM
`direction = 'out'`, accettata o consegnata dal provider e collegata alla
trattativa. La sequenza prosegue solo se, dopo quell'istante, non esistono:

- una email `direction = 'in'` collegata alla trattativa o allo stesso contatto;
- un'interazione registrata sulla trattativa, oppure sullo stesso contatto
  senza una trattativa specifica.

Una risposta arrivata per telefono **non ferma da sola** la sequenza: qualcuno
deve registrare la telefonata fra le interazioni. È un limite deliberato della
misura, non un tentativo di indovinare ciò che è successo fuori dal prodotto.

La fase è parte del fatto. L'email uscente deve essere successiva all'ingresso
nella fase configurata; un cambio di fase ferma il ciclo, e tornare più tardi
alla fase richiede una nuova email uscente. `won`, `lost` e opportunità
archiviate non entrano mai nella scansione. Risposta, interazione e fase vengono
rilette anche dal worker dopo il claim: se lo stop arriva fra emissione ed
esecuzione, il workflow non agisce.

L'attivazione non recupera il passato: `activated_at` pretende una email
uscente successiva. Ogni passo viene emesso una sola volta per sequenza,
trattativa e ultima email uscente; un secondo vincolo impedisce due emissioni
dello stesso passo nello stesso giorno. Una nuova email uscente apre un nuovo
ciclo.

Il template collegato è **solo un suggerimento**: compare nella scheda e viene
preselezionato nel composer. L'invio resta il pulsante premuto da una persona.
Nessuna funzione della 0050 chiama il provider email.

### Preventivi PDF versionati (0049, Fase 1.2)

`proposal` resta la **fase commerciale della trattativa**; non diventa un file e
non inventa una probabilità. Il documento vive invece in un modello esplicito:

| Tabella | Responsabilità |
|---|---|
| `crm_quotes` | identità del preventivo, trattativa e numero `P-000001` progressivo per azienda |
| `crm_quote_versions` | lingua, validità, unica valuta, snapshot di emittente/destinatario, stato e PDF |
| `crm_quote_items` | descrizione, quantità, prezzo, aliquota IVA e importi calcolati in `numeric` |
| `crm_quote_documents` | provenienza del PDF generato dentro Documenti |

Una versione usa **una sola valuta**: la valuta sta sulla versione e non sulle
voci, quindi non esiste una somma mista. Imponibile, IVA e totale li calcola
PostgreSQL in decimali. Le aliquote sono le righe svizzere correnti di
`finance_vat_rates` — ordinaria 8,1 %, ridotta 2,6 %, speciale 3,8 % — e ogni
voce ne conserva aliquota, titolo della fonte AFC, URL e data di verifica. La
fonte primaria è [Amministrazione federale delle contribuzioni — aliquote IVA](https://www.estv.admin.ch/estv/de/home/mehrwertsteuer/mwst-steuersaetze.html),
verificata nel catalogo Finanze il 2026-07-27.

Gli stati sono `draft`, `sent`, `accepted`, `rejected`, `expired`. Solo una
bozza si modifica. Dopo l'invio il documento e le voci sono immutabili: per
cambiare qualcosa si crea una versione nuova, con `based_on_version_id`, senza
sovrascrivere quella consegnata al cliente. Accettare un preventivo **propone**
di portare la trattativa a `won`; la schermata chiede conferma e il database non
lo fa automaticamente.

Il PDF usa logo e dati dell'azienda, conserva lo snapshot delle due parti e ha
una lingua propria (`it`/`de`/`fr`), indipendente dalla lingua dell'interfaccia.
Entra in `documents` con `source_type = generated` e viene collegato a
organizzazione e opportunità. Una modifica alla bozza rende obsoleto il PDF:
`send-crm-email` lo rifiuta finché non viene rigenerato.

L'invio riusa il composer CRM e Resend della 0048. Una riga email può restare
temporaneamente senza `delivery_status` durante il tentativo idempotente; il
preventivo passa a `sent` **solo dopo** che il provider ha accettato il
messaggio. `delivered` resta l'unico esito che aggiorna `last_contact_at`.

---

## 6. Timeline

`crm_timeline` compone sei fonti: comunicazioni collegate, interazioni, storico
CRM, attività create e completate, contratti collegati.

⚠️ **Compone riferimenti, non contenuti.** Ogni riga porta oggetto o titolo, data,
tipo e l'identificativo per aprire la cosa vera: **nessun corpo di email, nessun
testo di documento, nessuna clausola, nessun commento**. `test:crm` verifica anche
che nel `detail` dello storico non entrino ragioni sociali né nomi di persone — uno
storico che li contenesse sarebbe una seconda copia dell'anagrafica, invecchierebbe,
e non si potrebbe ripulire quando qualcuno chiede la cancellazione dei propri dati.

Ordinamento **stabile**: `occurred_at desc, id desc`. Senza la seconda chiave, due
righe con lo stesso istante si scambiano fra una pagina e l'altra e qualcosa
scompare. Paginata.

`thread_key` viene restituito e il raggruppamento delle conversazioni lo fa la
**schermata**: scriverlo nel dato significherebbe che collegare un thread collega
anche i messaggi che nessuno ha ancora ricevuto.

### «Ultimo contatto»

`crm_organizations.last_contact_at` è una **copia denormalizzata dichiarata**, sul
modello di `email_messages.analysis_deadline`: la scrive `crm_refresh_last_contact`
dal massimo fra le email ricevute, le email CRM **consegnate** e le interazioni
di tipo `call`/`meeting`. Una email solo `inviata` al provider non e' ancora un
contatto; una `fallita` non lo diventa mai.

**Una nota non è un contatto**: annotare qualcosa su un cliente non significa
avergli parlato (`test:crm` §9). Il client non può scriverla — il guardiano la
ripristina da `old` a meno che il sentinella `ai_swisse.crm_internal` sia acceso,
quindi la difesa non dipende dai permessi.

`null` significa **mai contattata**, e nei confronti pesa come un'eternità, non come
zero: nell'elenco viene prima di una contattata sei mesi fa, perché è il caso in cui
non è mai cominciato niente.

---

## 7. Integrazioni

Un componente condiviso, `CrmLinkPicker`, in **quattro** schermate: Inbox,
Documenti, Contratti, Finanze. Le quattro dicono la stessa cosa sullo stesso gesto —
e la stessa cosa su ciò che il gesto **non** fa.

Ogni riquadro mostra **due nomi accanto**: quello letto dall'originale e l'identità
CRM. Non li fa coincidere: la differenza è la cosa più utile del riquadro.

Dall'Inbox, quando c'è un mittente, il riquadro chiede al database chi è quell'
indirizzo e mostra il **motivo**: `email_exact` è un'identità e la riga lo dice,
`domain_match` è un sospetto e la riga dice «da confermare». In nessun caso il
collegamento avviene da solo.

Lo stato del collegamento si legge con **quattro select su una riga**, non con una
colonna in più nelle funzioni di lista: aggiungere `counterparty_organization_id` al
`returns table` di `list_contracts` richiederebbe `drop function` con la firma a 15
argomenti, ricreare, rifare revoke e grant, e toccare quattro punti nei tipi. Per un
dato che serve solo nel dettaglio, quel rischio non si paga.

### Accounting Integrations: NON ESISTE

I punti 7, 38 e 149 delle specifiche non hanno oggetto. Nel repository non c'è
nessun modulo di integrazione contabile: nessuna migrazione, nessun servizio,
nessuno script, nessuna occorrenza della parola. Non è stato simulato.

---

## 8. Automazioni

Sette inneschi, e **tutti hanno una sorgente vera**: `crm_organization_created`,
`crm_role_added`, `crm_opportunity_created`, `crm_opportunity_stage_changed`,
`crm_opportunity_won`, `crm_follow_up_due`, `crm_follow_up_sequence_due`.

Due entità nuove (`crm_organization`, `crm_opportunity`), 23 campi nel registro,
`create_task` e `create_notification` allargate al CRM.

⚠️ **Nessuna azione di contatto automatica.** Un'automazione CRM può creare lavoro e avvisare
persone dell'azienda. Non può inviare follow-up, iscrivere a newsletter, creare
campagne o telefonare. Dal 0048 una persona può inviare una singola email dal
CRM, ma non esistono sequenze o invii automatici; l'Inbox resta di sola lettura.

`crm_follow_up_due` **riusa lo scheduler esistente**: la scansione
`crm_emit_follow_up_due` gira nel worker delle automazioni già acceso, accanto ad
`automation_emit_overdue`. Nessun cron nuovo. ✅ **La chiamata esiste dal
2026-07-30**: fino a quel giorno l'innesco era dichiarato e non scattava mai,
perché la funzione c'era nel database e non la chiamava nessuno.

Dal 0050 anche `crm_emit_follow_up_sequences` gira nello stesso worker. Scrive
un evento `crm_follow_up_sequence_due`; un solo workflow tecnico per azienda,
nascosto dal costruttore generico e governato dalle Impostazioni CRM, usa
esclusivamente `create_task` e `create_notification`. La configurazione resta
nelle tabelle delle sequenze; il workflow non contiene soglie né fasi.

### I tre modelli offerti nel generatore (§136–§138)

- **Follow-up scaduto** — quando il prossimo passo di una trattativa supera la
  sua data: crea un'attività per OGGI, collegata alla controparte e alla
  trattativa, e avvisa chi la segue. La data del passo mancato non si riusa:
  sarebbe una scadenza già passata scritta su lavoro nuovo.
- **Trattativa senza responsabile** — alla nascita di una trattativa che non è di
  nessuno, avvisa gli amministratori. Non «il responsabile»: è ciò che manca.
- **Nuovo cliente** — quando a una controparte viene aggiunto il ruolo `customer`,
  crea un'attività di avvio a cinque giorni. Sul ruolo APPENA AGGIUNTO (che
  arriva nel payload), non su `role_customer`, che sarebbe vero anche quando ad
  essere aggiunto è «fornitore».

⚠️ **Nessun modello scrive testo dentro un titolo o un messaggio.** Un titolo
creato da una regola resta nel database com'è nato: una parola italiana scritta
nel modello comparirebbe identica nella schermata tedesca di un'azienda di
Coira. Ci sono solo segnaposti — nomi propri, che non si traducono — e
`test:workflows-unit` lo sorveglia per tutti e otto i modelli.

### ⚠️ Il collegamento che l'interfaccia prometteva e il motore non faceva

Trovato scrivendo i modelli, non usando l'app. `create_task` non scriveva mai
`tasks.crm_organization_id` né `crm_opportunity_id`: un'attività creata da una
regola CRM nasceva **senza controparte**, cioè compariva nel Work Hub e non sulla
scheda del cliente — il solo posto per cui il modulo esiste. La casella «collega
l'entità» del generatore era spuntata e non faceva nulla, e l'etichetta diceva
«Collega il documento all'attività» anche dove un documento non c'era.
Ora il motore passa entrambe le chiavi, l'etichetta nomina ciò che collega
davvero, e l'anteprima della prova a vuoto lo dichiara.

### ⚠️ «Avvisa il responsabile» era rifiutato proprio dove serviva

`store.ts` calcola il responsabile per contratti, controparti e trattative — con
un commento che cita §84 e §136 — mentre il validatore accettava
`recipient: 'assignee'` solo sugli inneschi che parlano di un'attività: la
condizione era `entityType === 'task'`, scritta quando le entità erano tre. Il
motore sapeva a chi scrivere e il generatore non lasciava dirlo. Ora la regola
sta in un posto solo (`triggerHasOwner`), usata dal validatore E dal generatore,
e su documento e comunicazione resta rifiutata: là un responsabile non c'è.

### I ruoli nelle automazioni sono BOOLEANI, non un elenco

L'operatore `contains` del motore confronta **sottostringhe**: su un elenco unito
con le virgole, «il ruolo contiene customer» risponderebbe sì anche a
`former_customer`, cioè a un ex cliente. Una regola «avvisa per i clienti» sarebbe
scattata sui clienti persi e nessuno avrebbe capito perché. Quindi
`organization.role_customer`, `role_prospect`, `role_supplier`, `role_partner`.
`organization.role` al singolare esiste **solo** sull'innesco «ruolo aggiunto»,
dove il valore sta nel payload: là è un dato, non una deduzione.

Altre due scelte non ovvie: `opportunity.previous_stage` viene dal **payload** e non
dalla riga (la riga ha già la fase nuova, e una regola «da negoziazione a persa» non
sarebbe mai scattata); `organization.last_contact_at` è **assente** su chi non è mai
stato contattato, così `within_days` dà `unknown` e la regola **non esegue** — una
soglia non si applica a ciò che non è mai cominciato.

---

## 9. Sicurezza

- **RLS su tutte e 15 le tabelle**: `is_company_member(company_id)` per la lettura e
  la scrittura ordinaria; `is_company_admin` per la fusione e per le definizioni
  dei campi personalizzati (cambiano la forma dei dati di tutta l'azienda; i loro
  valori restano scrivibili da ogni membro, come ogni altro dato del modulo).
- **`revoke all … from anon, authenticated, public` PRIMA di ogni grant.** Su
  `public` un permesso di colonna scritto senza revoke non restringe niente:
  Supabase concede per default i privilegi di tabella pieni a ogni tabella nuova. È
  il difetto misurato della 0013, riparato dalla 0014, e qui non si ripete.
- **Le colonne timbrate dal database non entrano nei grant**: `created_by`,
  `uid_norm`, `website_domain`, `last_contact_at`, `merged_into_id`,
  `normalized_value`, `won_at`, `lost_at`, `resolved_at/_by`. Senza permesso un
  tentativo **fallisce** invece di essere ignorato in silenzio.
- **Guardie cross-tenant nei trigger.** Ogni collegamento confronta **tre**
  `company_id` — quello dichiarato, quello dell'entità CRM, quello dell'entità
  collegata — e solleva `…_company_mismatch` con `errcode 23514`. La sola RLS
  lascerebbe passare il caso di chi dichiara la propria azienda e aggancia
  un'entità altrui: `test:crm` §2 prova che **nemmeno il service role** riesce.
- **`crmErrorMessage`** traduce i sentinella: `toUserMessage` non mappa `23514`, e
  senza quella funzione `crm_owner_not_member` finirebbe a schermo così com'è — in
  italiano, dentro un'interfaccia tedesca.
- **URL diretto**: aprire `/clienti/<id di un'altra azienda>` dà «non trovato», e
  non si distingue da «non esiste»: la seconda risposta confermerebbe l'esistenza di
  un dato altrui.
- **Cambio azienda**: ogni schermata porta la chiave dell'azienda nel proprio stato.
  Non esiste alcuna invalidazione globale di cache in questo prodotto, e senza quella
  chiave si vedrebbero per un istante i clienti dell'azienda precedente sotto il nome
  della nuova.

### Limite dichiarato del modello di permessi

Il prodotto ha tre ruoli (`owner`, `admin`, `member`) e nessun permesso granulare
per modulo. **Ogni membro dell'azienda vede tutto il CRM**, comprese le note e i
recapiti delle persone. Non esiste oggi un modo di nasconderlo a una parte dei
membri, e il CRM non inventa un sistema di permessi parallelo.

---

## 10. Privacy

- Solo dati **professionali**: nome, ruolo, recapiti di lavoro, lingua preferita.
- **Nessuna creazione automatica di persone dai destinatari** (`to`/`cc`): chi è in
  copia non ha chiesto di stare in un CRM.
- **Nessun arricchimento dal web**: niente LinkedIn, niente ricerca del sito, niente
  fatturato, niente dipendenti, niente social.
- **Nessun tracciamento**: niente pixel, niente apertura email, niente visitatori,
  niente impronte digitali.
- **Nessuna inferenza su caratteristiche personali**: salute, religione, politica,
  etnia, orientamento, personalità, affidabilità.
- Le note sono **testo semplice**, con autore e data, e l'interfaccia ricorda con una
  riga discreta di inserire solo informazioni professionali necessarie.
- La **provenienza** è registrata, e `source` non significa «identità verificata»:
  una controparte suggerita da una fattura resta una proposta. Dal browser si
  possono dichiarare solo `manual`, `registry` e `import` — «nata da una email» la
  può affermare solo il codice server-side, che quella email l'ha vista.
- Lo storico contiene **identificativi e valori di enum, mai nomi**: così si può
  ripulire quando qualcuno chiede la cancellazione dei propri dati.

---

## 11. Registro imprese (Zefix)

«Nuovo cliente → cerca nel registro → precompila → l'utente conferma», riusando
`RegistryLookup` invece di reimplementarlo: quel componente rispetta già il vincolo
dell'UFRC (nessun debounce, nessuna ricerca a ogni tasto, nessun lotto).

Per riusarlo è stata aggiunta una prop `messages`: i testi cablati parlano
dell'azienda **dell'utente** («completa forma giuridica, settore e numero di
dipendenti») e su una scheda cliente non hanno senso. **I due disclaimer
(`registrySource`, `registryModified`) non sono sovrascrivibili per costruzione**,
perché sono condizioni d'uso dell'API e devono dire la stessa cosa in ogni schermata.

⚠️ **Il cantone che arriva dal registro è un'etichetta, non una sigla.**
`lookup-company` può restituire «Altro», quindi un cliente di Lucerna arriva come
«Altro». In quel caso il campo resta **vuoto** invece di ricevere una sigla
inventata: scrivere `TI` perché è il default del modulo è il difetto già pagato
nell'onboarding, dove «Comune Zug, Cantone Ticino» compariva sotto un avviso che
diceva «dati importati dal registro».

Il campo cantone è un **elenco di 27 sigle** e non testo libero: il database ha
`check (length(canton) = 2)` e un valore qualunque produrrebbe un `23514` che
nessun messaggio traduce.

**Zefix non è un elenco di persone**: da qui non nasce nessun contatto personale.

---

## 12. Test

```bash
npm run test:crm-unit   # 253 casi, offline, senza database e senza crediti
npm run test:crm        # database reale; la sezione 18 richiede la 0050
```

`test:crm-unit` — venti sezioni. La più importante **legge la migrazione 0026** ed
estrae l'array di `crm_is_public_domain`, i valori dei quattro enum e il blocco di
autoverifica, confrontandoli con le costanti TypeScript. Sorveglia anche che il file
**non contraddica se stesso**: nessuna colonna può essere insieme «timbrata dal
database» e concessa al client. Poi: normalizzazione e ciò che **non** si
normalizza, la cifra di controllo dell'IDI (confrontata con `isValidUid` su sette
IDI veri e inventati), il filtro anti-rumore sul campione reale, i pareggi
dell'abbinamento, l'ordine delle priorità di stato, nessuna somma fra valute, giorni
di calendario alle 23:30, filtri in URL, ordinamenti stabili, la chiave del
candidato scritta due volte, il sito web come link che può essere codice. Le
cinque dell'import CSV: parser (virgolette, separatori, codifiche),
auto-mappatura in quattro lingue senza indovinare, validazione di riga in codici,
duplicati dentro e fuori il file, instradamento dei recapiti. Le sezioni 18 e 19
coprono i campi personalizzati: la 18 **legge la migrazione 0047** (enum TS
contro enum SQL, revoke prima dei grant, grant di colonna — provati sul
contenuto della dichiarazione, non sul suo nome —, nessuna delete-policy sulle
definizioni, ogni sentinella tradotta da `crmErrorMessage`), la 19 prova parsing
delle opzioni e dei valori, formattazione e ordinamento su fixture tipizzate.
La 20 legge la 0050 e verifica configurazione come dato, revoke prima dei
grant, doppia idempotenza, stop e assenza di azioni email. `test:crm` aggiunge
la sezione 18 con le controprove sul database reale: doppio giro, risposta,
interazione, cambio fase, chiusura e guardia cross-tenant. Dopo l'applicazione
della 0050 la suite è verde **191/191**.

La misura reale corrente è **191/191**, eseguita dopo la 0050.
Il runner sul branch contiene ora diciannove sezioni; la 18 è quella nuova e la
19 verifica la cascata. Le sezioni storiche coprono:
isolamento (anche chiamando la RPC col
`p_company_id` altrui), cross-tenant (nemmeno il service role), responsabili,
referente, permessi verificati **rileggendo** e non guardando l'esito dell'update,
storico non falsificabile, identità dell'IDI, timbri delle fasi, ultimo contatto,
il nome estratto che sopravvive, fusione, entità ammesse dal motore, candidato
automatico, cascata. La quattordicesima — import CSV — prova sul database reale:
percorso della riga con provenienza dichiarata, doppione duro e email
duplicata fermati dal vincolo, IDI errato che non collide, confine fra tenant.
La quindicesima — campi personalizzati, 43 asserzioni — prova: definizioni
scritte solo da chi amministra, nome unico fra gli attivi, tipo ed entità
congelati, ogni sentinella del guardiano (tipo sbagliato, valore vuoto, voce
fuori lista, entità sbagliata, campo sconosciuto, campo archiviato),
cross-tenant anche col service role, membro che scrive e cancella valori,
rinomina che non stacca, fusione che trasferisce col principale che vince. La
sua controprova è stata eseguita prima dell'applicazione della 0047: 39 rossi,
tutti e soli nelle garanzie nuove con «relazione mancante».

**Regressioni (2026-07-30): 18 suite verdi, 1578 asserzioni.** Offline 1037,
su database reale 541. Nessun modulo rotto dal CRM. Dopo nove suite su database:
due aziende in produzione, entrambe vere, nessun residuo.

---

## 13. ⚠️ Il difetto che rendeva un'azienda incancellabile (0028)

Trovato da `npm run test:crm` **alla prima esecuzione**, non rileggendo il codice.

Cancellando un'azienda, la cascata porta via le controparti e con loro i ruoli. I
trigger di storico sono `after delete`: scattano su ogni riga figlia e
**inseriscono** in `crm_events` con `old.company_id` — che nella stessa transazione
è già sparito. La chiave esterna viola e l'**intera cancellazione va in rollback**.

Un'azienda con una sola controparte e un solo ruolo non si poteva più cancellare: né
da un test, né da una richiesta di cancellazione dei dati, né dal dashboard.

**È esattamente la classe della 0023**, dove i trigger di immutabilità di Finanze
vietavano anche il `delete` e nessun documento con una fattura era più cancellabile.
Stessa lezione: una garanzia scritta guardando il caso normale va provata anche
contro il caso in cui tutto se ne va.

**La correzione**: nel ramo `delete` dei quattro trigger si controlla che i genitori
esistano **ancora**. Due controlli e non uno — `companies` prende il caso «l'azienda
se ne va», `crm_organizations`/`crm_contacts` prendono il caso «si cancella una sola
controparte», dove l'azienda resta in piedi. La fusione continua a scrivere il
proprio «ruolo rimosso», perché là entrambi esistono.

⚠️ **Per ripulire a mano i residui di un test fallito** non basta svuotare
`crm_events`: i trigger lo riempiono di nuovo durante la cascata. Bisogna cancellare
i **figli** prima (ruoli, rapporti, collegamenti, interazioni, opportunità,
recapiti), poi lo storico, poi contatti e organizzazioni, poi l'azienda.

---

## 14. ⚠️ La 0026 è fallita alla prima applicazione, per una contraddizione interna

```
colonne del CRM che il database deve timbrare risultano scrivibili dal client:
crm_opportunities.company_id, crm_opportunities.organization_id
```

Il blocco di autoverifica le dichiarava non scrivibili e i grant ne concedevano
l'`insert`. **La verità era il permesso**: sono `not null` senza default, quindi
senza `insert` nessuno potrebbe creare un'opportunità. Ciò che non deve essere
possibile è **cambiarle dopo** — spostare una trattativa su un'altra controparte
riscriverebbe la storia di due relazioni invece di una.

Ora sono due controlli distinti: `(d)` colonne timbrate (vietate in `insert` e
`update`) e `(d-bis)` colonne di appartenenza (vietate al solo `update`). E
`test:crm-unit` sorveglia che il file non si contraddica più.

**La lezione**: un'autoverifica che si rifiuta di applicarsi ha pagato il proprio
costo prima che il difetto arrivasse in produzione. Senza quel blocco la migrazione
sarebbe passata, e per mesi `company_id` sarebbe risultata modificabile su
un'opportunità senza che nessuno lo notasse.

---

## 15. Difetti d'interfaccia trovati aprendo le schermate

La lezione ricorrente di questo progetto, di nuovo.

1. **`.field` impone `flex-direction: column` e `.ct-search` non lo sovrascrive**: il
   pulsante «Cerca» finisce **sotto** il campo, a piena larghezza. È un difetto
   **preesistente dei Contratti**; il CRM usa `.crm-search` con la direzione
   dichiarata.
2. **`.task-check` non dichiarava il layout.** L'allineamento e lo spazio erano uno
   `style` inline in **una sola** schermata: nelle altre tre che usano la classe —
   Calendario, Documenti, Clienti — la casella era **incollata** all'etichetta.
   Corretto in `app.css`, una riga, e ne beneficiano tutti e tre.
3. **`.tab.is-active` non esiste** nel CSS (esiste `.tab.active`): nei Contratti la
   scheda attiva non si evidenziava.
4. Il nome estratto era etichettato «Ruolo nel rapporto», che non è quello che è.
5. Il pulsante dei filtri diceva «Ruolo»; il numero diceva «Senza contatto da 30»
   senza «giorni», perché avevo concatenato invece di usare una chiave con parametro.

E uno trovato scrivendo, non rileggendo: `crm_log_entity_link` era **una** funzione
parametrizzata che leggeva `new.organization_id` anche su `crm_contact_emails`, che
quella colonna non ha — in plpgsql l'espressione si prepara per intero, non ramo per
ramo. Sono diventate due funzioni.

---

## 15-bis. Il candidato automatico (0030) — §171

Il pezzo che fa passare il CRM da «si riempie a mano» a «si riempie
confermando». Una funzione sola, `crm_scan_link_suggestions`, chiamata dal worker
delle automazioni nello stesso giro delle altre scansioni: nessuna Edge
Function nuova, nessun cron nuovo, nessuna tabella nuova.

**Che cosa legge**: le controparti dei **contratti** (`counterparty_name` dove
`counterparty_organization_id` è vuoto) e i fornitori di **Finanze**
(`eff_supplier_name` dove `supplier_organization_id` è vuoto). Confronta il nome
normalizzato con `finance_norm_supplier` — la stessa funzione che il database usa
già per `eff_supplier_norm`, non una seconda definizione.

**Che cosa scrive**: righe `crm_link_suggestions` in stato `pending`, e nient'altro.

| trovato | motivo | che cosa propone |
|---|---|---|
| una sola controparte con quel nome | `name_normalized` | collegare l'origine a quella scheda |
| nessuna controparte con quel nome | `extracted_name` | creare la scheda, col nome letto sul documento |
| più di una | — | **niente**: la decisione torna a una persona |

⚠️ **`extracted_name` è un valore enum NUOVO, e serviva.** Il campo `reason`
risponde a «perché me lo stai proponendo?»: quando nel CRM non c'è nessuna
controparte con quel nome, la proposta non nasce da una corrispondenza — nasce
dalla sua assenza. Riusare `name_normalized` avrebbe scritto «ragione sociale
simile» accanto a una riga dove non c'è niente a cui somigliare, e la schermata
lo avrebbe mostrato a una persona. È anche il motivo più debole della scala: non
collega niente da solo, e un test lo sorveglia.

⚠️ **Ambiguità uguale niente.** Due controparti con lo stesso nome normalizzato
non producono alcun suggerimento: sceglierne una significherebbe attribuire un
contratto all'impresa sbagliata in silenzio. Quel caso ha già il proprio posto,
«possibili duplicati».

⚠️ **Idempotenza.** La `dedupe_key` è `crm:<entità>:<id>:<motivo>:<bersaglio|new>`
— nessun timestamp, nessun indirizzo email — e ha **una copia dichiarata in
TypeScript** (`suggestionKey()` in `crmMatch.ts`). `test:crm-unit` legge la
migrazione e confronta le due forme: è l'unico controllo che può vedere la
divergenza, perché il typecheck non guarda dentro l'SQL. Se divergessero non si
romperebbe niente in modo visibile — l'elenco «da verificare» si riempirebbe di
copie nel giro di un'ora.

⚠️ **Non si riesamina ciò che ha già una proposta in sospeso.** Senza quel filtro
ogni passaggio del worker riguarderebbe le stesse duecento righe più recenti e
non arriverebbe mai alle altre. Una proposta risolta rende la riga di nuovo
esaminabile, e il vincolo unico impedisce che la stessa identica proposta torni:
**un «no» resta un no**.

⚠️ **Le proposte senza origine si tolgono.** `source_entity_id` è polimorfico e
non ha una chiave esterna: cancellato il contratto, il suggerimento in sospeso
resterebbe a chiedere di confermare qualcosa che non esiste più. Si cancellano
solo i `pending`, e solo delle due entità che questa scansione produce: una
proposta già risolta è storia.

### La schermata: «Da verificare»

⚠️⚠️ **Prima del 2026-07-30 nessuna schermata leggeva quella tabella.**
`crmService.suggestions()` esisteva, i permessi c'erano, le etichette erano nei
tre dizionari — e non li chiamava nessuno. Riempirla senza la scheda avrebbe
prodotto suggerimenti invisibili: la stessa trappola di `home.module`,
`amountsFound` e `errorCreditExhausted`, dove la parte scritta c'era e il
collegamento no.

La scheda sta in cima a `/clienti`, compare solo quando c'è qualcosa in sospeso e
offre tre gesti: **Collega** (scrive il collegamento e SOLO POI segna
`accepted`), **Non è questa** (`rejected`), **Non ora** (`ignored`). Quando non
c'è una scheda a cui collegare, il pulsante porta a crearla con il nome
precompilato: alla creazione il documento d'origine viene collegato e il
suggerimento si chiude. Se quella seconda metà fallisce, **la scheda resta e lo
si dice** — far sparire il lavoro riuscito per colpa di quello secondario sarebbe
peggio.

⚠️ Un guasto in lettura si dichiara: «niente da verificare» su una richiesta
fallita è il difetto trovato nell'Inbox con la 0013 non applicata.

**Provato nel browser** il 2026-07-30 sull'azienda demo, con dati veri e poi
rimossi (verifica di sparizione eseguita): «Non ora» scrive `ignored` con il
timbro del database; «Collega» collega il contratto e segna `accepted`, lasciando
intatto `counterparty_name`; «Crea la scheda» crea la controparte, collega il
contratto e chiude il suggerimento. Nessuno scroll orizzontale a 375 px, i tre
pulsanti a 37 px di altezza, tedesco e francese verificati a schermo — ed è così
che è saltato fuori «Pourquoi: …» senza lo spazio insecabile, perché i due punti
erano nel JSX (§ la stessa trappola di «Priorité: toutes» nel Calendario).

---

## 15-ter. L'import CSV

Il secondo modo in cui il CRM «si riempie confermando»: un file di contatti che
arriva da fuori — un foglio di calcolo, l'esportazione di un gestionale — entra
da `/clienti/importa`, con un wizard in tre passi.

**1. Il file.** Al massimo 1000 righe e 1 MB: oltre il primo tetto il file
viene troncato e la schermata lo dichiara, oltre il secondo viene rifiutato. Il
separatore (`;`, `,`, tab) si riconosce da solo contando fuori dalle virgolette;
un file non UTF-8 viene letto come Windows-1252 e la scelta è dichiarata a
schermo, con l'invito a risalvare come «CSV UTF-8» se le accentate non tornano.

**2. La mappatura.** Le intestazioni si confrontano con una tabella di alias in
quattro lingue e ogni colonna si PROPONE verso un campo: la persona conferma o
cambia, e un campo sta su una colonna sola. Una colonna non riconosciuta resta
«Non importata» invece di essere indovinata. Per proseguire serve almeno un
nome: l'organizzazione, oppure nome E cognome della persona.

**3. L'anteprima.** Ogni riga mostra il proprio stato PRIMA di toccare il
database: valida, con errori (nome mancante, email o sito malformati, cantone o
paese che non sono la sigla di due lettere, IDI con la cifra errata, ruolo
sconosciuto) oppure possibile duplicato, con il motivo. Le righe con errori
vengono saltate; sui duplicati decide la persona, riga per riga o in blocco.

**I duplicati si mostrano, non si risolvono da soli.** MAI fusione, MAI
aggiornamento dell'esistente, nessun arricchimento: l'import crea schede nuove
o non tocca niente. L'unica eccezione è quella che il database impone: un IDI
valido già presente non si può inserire (vincolo unico), quindi là la scelta
non esiste e la riga viene saltata col motivo scritto. Per lo stesso motivo
l'email già registrata non viene nemmeno tentata (`uq_crm_method_email`
risponderebbe 23505): viene omessa e dichiarata in nota, invece di mostrare un
errore atteso.

**L'esecuzione non è una transazione finta.** Va riga per riga: una che
fallisce viene registrata col motivo e le altre continuano. Se l'organizzazione
è creata ma la persona o i recapiti no, il riepilogo la conta come «parziale»
e lo dichiara — far sparire il lavoro riuscito per colpa di quello secondario
sarebbe peggio, e tacerlo una bugia.

**Provenienza.** Ogni scheda importata porta `source = 'import'` e
`source_detail` = nome del file: fra sei mesi si potrà rispondere a «da dove è
uscita questa scheda?». I duplicati interni al file si risolvono a favore della
prima occorrenza.

✅ **Stato della verifica (misurato il 2026-08-28).** La logica (parser,
mappatura, validazione, duplicati, instradamento dei recapiti) è coperta dalle
sezioni 13–17 di `test:crm-unit`, 96 casi verdi. La sezione 14 di `test:crm` è
stata **eseguita il 2026-08-28**: 94/94 asserzioni verdi in 14 sezioni. La
prova nel browser è stata fatta il 2026-08-28 su un tenant usa-e-getta poi
rimosso (rimozione verificata rileggendo tutte le tabelle `crm_*` e
`auth.users`: zero residui), su un'istanza Chrome separata pilotata via CDP —
il Chrome principale era in uso — e ha visto, in italiano: wizard completo con
errori di riga in prosa, doppione interno al file senza scelta, duplicato di
dominio deciso per riga, riepilogo «3 create, 3 saltate»; file Windows-1252 da
40 righe con il banner di codifica dichiarato e le accentate corrette; import
da 200 righe con il progresso «N di 200» avanzare riga per riga (~23 s); le
schede create in `/clienti` (443 con `source = 'import'`, misurato via service
role) e la provenienza «Da un'importazione» nel dettaglio. In tedesco e
francese i passi e le etichette chiave sono corretti, in francese i due punti
portano lo spazio insecabile stretto (U+202F, verificato nel DOM). A 375px
nessuno scroll orizzontale nei tre passi (`scrollWidth` = 375, `scrollX` = 0,
override di viewport CDP: le interazioni touch reali non sono state provate).

⚠️ **Il difetto che la prova a schermo ha pagato**: la persona importata
riceveva `first_name` e `last_name` giusti ma il `display_name` copiato dal
nome dell'organizzazione — in «Persone» la card di «Chiara Moreschi» si
intitolava «Galleria Ventuno Sagl». Corretto il 2026-08-28: il nome della
persona lo dà `personDisplayName` (nome + cognome, mai l'organizzazione), e
due asserzioni nella sezione 17 di `test:crm-unit` lo sorvegliano.

---

## 15-quater. I campi personalizzati (0047)

Il perimetro fisso della 0026 copre l'identità e la relazione; non copre ciò che
ogni azienda conta per conto proprio — il numero cliente nel gestionale
precedente, la data del prossimo rinnovo, la fascia di fatturato. I campi
personalizzati rispondono a quello, su **organizzazioni e opportunità** e
nient'altro: persone e contatti restano fuori, per scelta.

**Il modello, in tre affermazioni** (le stesse scritte nella migrazione):

1. **La definizione è dell'azienda.** `crm_field_definitions` porta nome, tipo
   (`text`, `number`, `date`, `select`), opzioni della lista, obbligatorietà e
   ordine di comparsa. Il nome è unico per scheda fra i campi attivi,
   insensibile alle maiuscole; archiviato il campo, il nome si libera.
2. **Un valore è una riga, e il tipo è un fatto del database.** Niente
   `value jsonb` da interpretare a schermo: `value_text`, `value_number` e
   `value_date` sono tre colonne, e il guardiano pretende che sia piena
   esattamente quella del tipo dichiarato — lo stesso rifiuto per il browser,
   per uno script e per il service role. La riga esiste **solo se porta un
   valore**: svuotare un campo la cancella.
3. **Sono attributi, non identità.** Non entrano in `crm_duplicate_candidates`,
   non entrano in `crm_match_email` né in `crm_scan_link_suggestions`, non
   entrano nella normalizzazione: un «numero cliente» identico su due schede NON
   le rende doppioni, perché l'identità restano l'IDI e l'email (§25). La
   fusione invece li trasferisce sul record principale — dove il principale ha
   già un valore per lo stesso campo vince il principale, come per ruoli e
   recapiti — e li trasferisce anche da un campo archiviato, perché sposta la
   storia senza riscriverla.

**Le definizioni le scrive chi amministra, i valori ogni membro.** Un campo
cambia la forma dei dati di tutta l'azienda, come la fusione (§118); un valore è
un dato come gli altri. Il pannello delle impostazioni lo dice al membro invece
di offrirgli campi che al salvataggio verrebbero rifiutati.

**Tipo ed entità sono congelati alla nascita.** Cambiare «numero» in «testo» con
i valori già scritti renderebbe quelle righe false, e spostare un campo dalle
organizzazioni alle opportunità lo staccherebbe dai suoi valori: un campo
diverso è un campo nuovo. La difesa è doppia — il grant di colonna non concede
l'update e il guardiano ripristinerebbe il valore — perché una difesa che vale
in un posto solo si dimentica. Rinominare invece non stacca niente: i valori
puntano all'`id`, non al nome.

**Si archiviano, mai si cancellano** (`archived_at`, §123/§125): sulle
definizioni non esiste una policy di DELETE. Un campo archiviato è
**congelato**: i valori esistenti restano leggibili e si possono cancellare, ma
nessuno se ne aggiunge e nessuno si riscrive. Restringere le opzioni di una
lista non cancella i valori già scritti; però un valore fuori lista non si può
più riscrivere tale e quale, perché il guardiano lo misura contro l'elenco
corrente.

**L'obbligatorietà (`is_required`) è una promessa della schermata, non un
vincolo del database.** Il database non può pretendere una riga che non esiste
su un'entità che nasce senza valori; ciò che garantisce è che nessun valore
salvato sia vuoto o del tipo sbagliato. Nessuno storico in `crm_events`: un
campo personalizzato è un attributo corrente, non un passaggio di relazione.

**La schermata.** Le definizioni si gestiscono in Impostazioni → «Campi
personalizzati» (e come pagina, `/campi-personalizzati`), dentro il modulo
legacy flaggato come il resto del CRM in sviluppo; i valori compaiono nella
scheda dell'organizzazione e della trattativa, in fondo ai campi nativi e con lo
stesso aspetto — nessun «recinto» visivo di serie B. Il numero in un campo
numero si formatta con i separatori delle migliaia della lingua dell'interfaccia
e in modifica si rilegge il valore grezzo, mai quello formattato.

✅ **Stato della verifica (misurato il 2026-08-29).** Le sezioni 18 e 19 di
`test:crm-unit` (offline) leggono la migrazione — revoke prima dei grant, grant
di colonna, nessuna delete-policy, sentinella tutti coperti da
`crmErrorMessage`, tetto delle opzioni coerente col client — e provano parsing,
formattazione e ordinamento su casi tipizzati. La sezione 15 di `test:crm` (43
asserzioni) è **eseguita verde** sul database reale: 139/139 in 16 sezioni, e la
controprova senza la 0047 era rossa esattamente lì (39 fallimenti, «relazione
mancante»). La prova a schermo è stata fatta lo stesso giorno su un tenant
usa-e-getta poi rimosso (rimozione verificata dal client di servizio), su
un'istanza Chrome separata pilotata via CDP: pannello Impostazioni e pagina
`/campi-personalizzati` in italiano, tedesco e francese (in francese i due punti
portano U+202F, misurato nel DOM); scheda della controparte con salvataggio e
numero formattato («12'500» in italiano, «12 500» in francese); scheda della
trattativa con l'errore «obbligatorio» a schermo e la data «31.03.2027»; tema
scuro su pannello e scheda; 375px senza scroll orizzontale (`scrollWidth` 360,
`scrollX` 0, override di viewport CDP: le interazioni touch reali non sono state
provate).

---

## 16. Configurazione

Nessun secret nuovo, nessuna Edge Function nuova, nessun job cron nuovo.

1. Applicare **0026_crm_light.sql** e **0028_crm_cascade_history.sql** dal SQL
   editor, in quest'ordine, un incollaggio ciascuna. Entrambe si autoverificano e
   fanno fallire l'applicazione se qualcosa non è come dichiarato.
2. Rideployare `automation-worker` e `automation-admin`: `_shared/automation/`
   (registro e fatti) è cambiato.
3. ✅ **FATTO il 2026-07-30**: `crm_emit_follow_up_due` viene chiamata dal worker
   delle automazioni, accanto ad `automation_emit_overdue`. Il rapporto la conta a
   parte (`crmFollowUpEmitted`), perché «un'attività è scaduta» e «un follow-up è
   scaduto» sono due fatti diversi.
4. Applicare **0030_crm_link_candidate.sql** per il candidato automatico, e
   rideployare `automation-worker`: la scansione `crm_scan_link_suggestions` gira
   nello stesso giro delle altre scansioni (`crmSuggestionsCreated` nel rapporto).
   ⚠️ Nessuna scansione del CRM è terminale per il worker: se fallisce,
   il codice finisce nel rapporto e in una riga di log, e la coda degli altri
   moduli continua. Un modulo non installato non deve spegnere le automazioni di
   Documenti, Finanze e Contratti.
5. ✅ **FATTO il 2026-08-29**: **0047_crm_custom_fields.sql** applicata dal SQL
   editor in un incollaggio, autoverifica superata. Nessun rideploy: il CRM vive
   dietro `VITE_LEGACY_MODULES`, lato client.
6. ✅ **FATTO il 2026-08-30**: **0048_crm_send_email.sql** applicata e
   `send-crm-email` / `crm-email-webhook` pubblicate.
7. ✅ **FATTO il 2026-09-01**: **0049_crm_quotes.sql** applicata,
   `generate-crm-quote` e `send-crm-email` pubblicate; `test:crm` 176/176.
8. ✅ **FATTO il 2026-09-01**: **0050_crm_follow_up_sequences.sql** applicata e
   `automation-worker` ridistribuito con `verify_jwt=false`; `test:crm`
   **191/191** sul database reale, inclusa la pulizia senza residui.

---

## 17. Limiti dichiarati

**Fuori perimetro per scelta**

- Nessuna campagna o invio automatico. Le sequenze della 0050 creano attività
  e notifiche e possono proporre un template; l'invio resta soltanto un
  gesto umano: una email singola dal CRM, via Resend/provider transazionale e
  non via Gmail API. Il mittente usa un dominio verificato configurato per
  l'azienda; se il provider manca la funzione e l'interfaccia lo dichiarano non
  disponibile. Il destinatario è un **solo recapito email già registrato** nel
  CRM: niente indirizzi digitati a mano e nessuna creazione implicita di persone.
  L'accettazione di Resend produce `sent`; il webhook firmato produce
  `delivered` oppure `failed` e conserva una ragione non tecnica. La firma usa
  `RESEND_WEBHOOK_SECRET` e gli header `svix-id`, `svix-timestamp`,
  `svix-signature`; duplicati e ordine di arrivo non possono applicare due volte
  lo stesso esito. Solo `delivered` conta come ultimo contatto.
- Nessuna probabilità di chiusura, nessun punteggio, nessun forecast, nessun
  sentiment.
- Le fatture cliente **esistono dal 2026-09-02** e stanno in Finanze (scheda
  «Emesse», migrazione 0053 — scritta, non risulta applicata alla produzione a
  questa data): questa riga diceva «nessuna fattura cliente, quindi nessun
  ricavo», ed era vera finché la 0053 non c'era. Il CRM conserva i riferimenti
  — organizzazione, trattativa, versione del preventivo — e la verità
  commerciale resta qui; il registro del denaro sta là. Un valore di
  opportunità resta una stima e un contratto non è un incasso, ma una
  trattativa vinta può ora diventare una fattura emessa: «Crea fattura» dal
  preventivo accettato precompila una bozza, mai una copia automatica. ⚠️ Al
  2026-09-02 quel gesto ha un difetto di indirizzo (`sezione=emesse` contro
  `issued`): atterra sulla scheda sbagliata e la precompilazione non si apre —
  dichiarato in [finance-operations.md](finance-operations.md) §12.6.
- Nessuna sincronizzazione rubriche, nessun OCR di biglietti da
  visita, nessun help desk, nessun portale clienti.
- I campi personalizzati esistono dal 0047 (§15-quater), solo su organizzazioni
  e opportunità: niente campi su persone e contatti, niente multi-selezione,
  niente «sì/no» dedicato, niente campo «collegamento».

**Non implementato, e non per dimenticanza**

- **Il quarto modello di regola, «cliente inattivo» (§139), NON è scritto**, e la
  ragione è tecnica: non esiste un innesco che scatti al PASSARE DEL TEMPO su una
  controparte. `crm_follow_up_due` guarda le trattative, non le relazioni.
  Costruirlo richiede un innesco periodico nuovo, e prima di aggiungerlo va risolto
  il problema che lo rende insidioso: un evento «inattivo» emesso ogni giorno
  farebbe creare un'attività al giorno, perché `create_task` non è idempotente; un
  evento emesso una volta sola alla trentesima giornata di silenzio, invece,
  renderebbe inservibile una regola che dica «più di novanta giorni», perché
  quando l'evento arriva i giorni sono trenta. Gli altri tre modelli (§136–§138)
  sono in `automationModel.ts` accanto ai cinque preesistenti.
- **Il filtro per cliente nel Work Hub** (§82): richiede un parametro nuovo in
  `list_tasks`, quindi `drop function` con la firma a 9 argomenti e i grant
  rifatti. È una migrazione a sé. Nel frattempo le attività di ogni controparte si
  vedono dalla sua scheda.
- Dal **0048_crm_send_email.sql** `email_messages.direction` distingue `in` e
  `out`: tutte le righe preesistenti sono `in`. Le uscenti sono registrate con
  stato `sent` / `delivered` / `failed`; il contenuto resta fuori da
  `crm_events`, che conserva solo riferimenti.
- Gli esiti si vedono sia in Comunicazioni sia nella timeline della scheda. Un
  bounce o un fallimento mostra una ragione umana; aperture e click non sono
  raccolti. `crm_email_webhook_events` non ha accesso browser e la funzione SQL
  che applica un evento è concessa soltanto al `service_role`.
- **La data del documento** nell'elenco dei documenti collegati è quella del
  **caricamento**: `documents` non ha una colonna di data, e la data del documento è
  un valore effettivo che vive nell'analisi. Chiamare `created_at` «data del
  documento» sarebbe più comodo e falso.
- **Nessun suggerimento dalle EMAIL.** `deservesSuggestion()` esiste, è misurata
  sulle 117 email vere e non la chiama nessuno: il candidato automatico della 0030
  legge contratti e Finanze, non l'Inbox. È il prossimo passo naturale, e ha già
  il proprio filtro scritto e provato.
- **Nessun collegamento automatico nemmeno sull'identità forte.** Il §25
  autorizzerebbe `uid_exact` e `email_exact` a collegare da soli; il candidato non
  lo fa, perché le sue due sorgenti portano un NOME letto su un documento, non
  un'identità.

**Rischi residui**

- ⚠️ **Le due righe che stavano qui erano false il 2026-07-31**, ed erano invecchiate
  senza che nulla potesse accorgersene. Dicevano che `docs:check` mostrava sette
  divergenze «documento orfano» (oggi ne mostra zero) e che il modulo non era ancora
  online (lo è da `a1b6487`). Lo stato del modulo si legge in
  [`product-status.md`](product-status.md), che è l'unico posto dove è dichiarato:
  `docs:check` ora fallisce se un documento lo contraddice, ed è così che queste due
  righe sono state trovate.
