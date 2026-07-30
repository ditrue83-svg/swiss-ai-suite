# CRM Light — Clienti e controparti

Stato: **in esercizio dal 2026-07-30**, interfaccia compresa.
Migrazioni: **0026** (il modulo) e **0028** (la correzione della cascata), entrambe applicate.
Test: `npm run test:crm-unit` **122/122** · `npm run test:crm` **74/74**.

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
(0026, 4242 righe), più 6 colonne su tabelle esistenti.

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
dal massimo fra le email collegate e le interazioni di tipo `call`/`meeting`.

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

Sei inneschi, e **tutti hanno una sorgente vera**: `crm_organization_created`,
`crm_role_added`, `crm_opportunity_created`, `crm_opportunity_stage_changed`,
`crm_opportunity_won`, `crm_follow_up_due`.

Due entità nuove (`crm_organization`, `crm_opportunity`), 23 campi nel registro,
`create_task` e `create_notification` allargate al CRM.

⚠️ **Nessuna azione di contatto.** Un'automazione CRM può creare lavoro e avvisare
persone dell'azienda. Non può inviare follow-up, iscrivere a newsletter, creare
campagne o telefonare: quelle azioni non esistono nel motore, e l'Inbox è di sola
lettura per contratto.

`crm_follow_up_due` **riusa lo scheduler esistente**: la scansione
`crm_emit_follow_up_due` gira nel worker delle automazioni già acceso, accanto ad
`automation_emit_overdue`. Nessun cron nuovo.

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

- **RLS su tutte e 13 le tabelle**: `is_company_member(company_id)` per la lettura e
  la scrittura ordinaria; `is_company_admin` per la fusione.
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
`lookup-company` lo appiattisce a sei valori più «Altro» — è il perimetro del
catalogo incentivi, non della Svizzera — quindi un cliente di Lucerna arriva come
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
npm run test:crm-unit   # 122 casi, offline, senza database e senza crediti
npm run test:crm        # 74 asserzioni in 13 sezioni, sul database reale
```

`test:crm-unit` — dieci sezioni. La più importante **legge la migrazione 0026** ed
estrae l'array di `crm_is_public_domain`, i valori dei quattro enum e il blocco di
autoverifica, confrontandoli con le costanti TypeScript. Sorveglia anche che il file
**non contraddica se stesso**: nessuna colonna può essere insieme «timbrata dal
database» e concessa al client. Poi: normalizzazione e ciò che **non** si
normalizza, la cifra di controllo dell'IDI (confrontata con `isValidUid` su sette
IDI veri e inventati), il filtro anti-rumore sul campione reale, i pareggi
dell'abbinamento, l'ordine delle priorità di stato, nessuna somma fra valute, giorni
di calendario alle 23:30, filtri in URL, ordinamenti stabili.

`test:crm` — tredici sezioni: isolamento (anche chiamando la RPC col `p_company_id`
altrui), cross-tenant (nemmeno il service role), responsabili, referente, permessi
verificati **rileggendo** e non guardando l'esito dell'update, storico non
falsificabile, identità dell'IDI, timbri delle fasi, ultimo contatto, il nome
estratto che sopravvive, fusione, entità ammesse dal motore, cascata.

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

## 16. Configurazione

Nessun secret nuovo, nessuna Edge Function nuova, nessun job cron nuovo.

1. Applicare **0026_crm_light.sql** e **0028_crm_cascade_history.sql** dal SQL
   editor, in quest'ordine, un incollaggio ciascuna. Entrambe si autoverificano e
   fanno fallire l'applicazione se qualcosa non è come dichiarato.
2. Rideployare `automation-worker` e `automation-admin`: `_shared/automation/`
   (registro e fatti) è cambiato.
3. Per far girare `crm_emit_follow_up_due` va aggiunta la sua chiamata nel worker
   delle automazioni, accanto ad `automation_emit_overdue`.

---

## 17. Limiti dichiarati

**Fuori perimetro per scelta**

- Nessun invio di comunicazioni: né singole, né sequenze, né campagne.
- Nessuna probabilità di chiusura, nessun punteggio, nessun forecast, nessun
  sentiment.
- Nessun modulo preventivi: `proposal` è uno stato, non un PDF.
- Nessuna fattura cliente, quindi **nessun ricavo**: Finanze gestisce fatture
  fornitore e spese. Un valore di opportunità è una stima e un contratto non è un
  incasso.
- Nessun import CSV, nessuna sincronizzazione rubriche, nessun OCR di biglietti da
  visita, nessun help desk, nessun portale clienti.
- Nessun campo personalizzato.

**Non implementato, e non per dimenticanza**

- **I quattro modelli di regola** (§136-§139): gli inneschi esistono e i fatti si
  caricano, ma nessun modello è offerto nel generatore. Una regola CRM si scrive a
  mano dal builder.
- **Il filtro per cliente nel Work Hub** (§82): richiede un parametro nuovo in
  `list_tasks`, quindi `drop function` con la firma a 9 argomenti e i grant
  rifatti. È una migrazione a sé. Nel frattempo le attività di ogni controparte si
  vedono dalla sua scheda.
- **Nessuna direzione inviata/ricevuta nelle email**: `email_messages` non ha una
  colonna di direzione e la sincronizzazione legge **solo** la posta in arrivo. «Ultima
  comunicazione inviata» non è calcolabile e non viene mostrata.
- **La data del documento** nell'elenco dei documenti collegati è quella del
  **caricamento**: `documents` non ha una colonna di data, e la data del documento è
  un valore effettivo che vive nell'analisi. Chiamare `created_at` «data del
  documento» sarebbe più comodo e falso.
- **Il candidato automatico** (§171) non è scritto: nessun job produce suggerimenti
  dalle controparti dei contratti o dai fornitori di Finanze. La tabella
  `crm_link_suggestions` esiste e l'interfaccia la legge; a riempirla, per ora, non
  c'è nessuno.

**Rischi residui**

- `docs:check` mostra sette divergenze «documento orfano» in `~/swiss-ai-suite-app`:
  il controllo cerca il README della radice del monorepo, che lì non esiste. Non è
  un difetto del CRM ed erano sei prima.
- Il modulo non è ancora **pubblicato**: la cartella condivisa contiene anche un
  modulo di un'altra sessione in costruzione.
