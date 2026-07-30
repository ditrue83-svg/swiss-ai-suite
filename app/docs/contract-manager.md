# Contract Manager (0024)

Contratti e accordi aziendali: capire **con chi** si è legati, **da quando**, **fino a quando**,
**a quali condizioni**, e trasformare le date che ne derivano in lavoro concreto.

> **Il confine, in una riga.** Questo modulo riporta **che cosa il documento dice**. Non dice che
> cosa il diritto impone, non giudica se una clausola sia valida, non colma con la legge ciò che il
> contratto tace, non invia disdette e non accetta rinnovi.

    DOCUMENTI → ESTRAZIONE CONTRATTUALE → VERIFICA UMANA → TERMINI VERIFICATI
              → MILESTONE → ATTIVITÀ → CALENDARIO → NOTIFICA → DECISIONE UMANA

Il principio che governa ogni scelta di questo documento: **evidenza > fiducia > automazione**.
Se una clausola è ambigua si mostra; se una data non si può derivare non si inventa; se arriva una
modifica non si sovrascrive; se un termine è verificato allora — e solo allora — può diventare
lavoro.

---

## 1. Architettura

| Tabella | Che cosa contiene | Mutabile? |
|---|---|---|
| `contracts` | il rapporto: nome, tipo, controparte, responsabile, stato, bandiere | sì (organizzazione) |
| `contract_documents` | il RUOLO di un documento nel contratto + stato di lettura | sì (ruolo, coda) |
| `contract_extractions` | il verbale di lettura di **un** documento | **no**, versionato |
| `contract_term_versions` | i **termini**, versionati: bozza → verificata → superata | **no** una volta verificata |
| `contract_corrections` | correzioni umane su una bozza | **no**, append-only |
| `contract_milestones` | le date: esplicite, derivate, manuali | stato sì, data derivata no |
| `contract_events` | lo storico, scritto dai trigger | **no** |

Il file originale resta in **Documents** (§4): il Contract Manager non copia PDF, li **punta**.

### Perché l'estrazione è per DOCUMENTO e non per contratto

L'accordo principale dice preavviso 3 mesi, l'amendment dice 6. Se l'estrazione fosse del contratto,
la seconda lettura cancellerebbe la prima — e con essa la possibilità di rispondere a «da quale
documento viene questo termine?».

### Perché NON si è esteso `document_analyses`

Quella tabella descrive un documento amministrativo ed è letta da Admin AI, Document Hub, Attività,
Automazioni e Finance. Aggiungerle «ancoraggio del preavviso» e «modalità di disdetta»
significherebbe far portare a tutti il peso di un dominio che riguarda un documento su venti.

---

## 2. I termini: bozza e versione verificata

**È il cuore del modulo.** Una `contract_term_versions` in stato `draft` è ciò che il sistema
**propone**; una in stato `verified` è ciò che una **persona** ha confermato, ed è immutabile.

La bozza si ricalcola (`contract_refresh_draft`) in tre passaggi, e l'ordine è tutto:

1. si parte dalla **versione verificata in vigore**, se esiste;
2. si sovrascrive con le **estrazioni dei documenti non ancora incorporati**, in ordine di autorità:
   `altro < accordo principale < allegato < rinnovo < modifica`;
3. si sovrascrive con le **correzioni umane** della bozza, in ordine cronologico.

**Solo i valori non nulli sovrascrivono**: un amendment che parla soltanto del preavviso non
cancella la controparte e il costo. Il silenzio di un documento non è una dichiarazione di assenza.

### Perché non basta «correzione vince su estrazione» come in Finance

Su una fattura il valore giusto è uno solo e il tempo non lo cambia. Un contratto no: il preavviso
di tre mesi **era** vero fino all'amendment, e resta la risposta giusta alla domanda «che cosa
valeva a gennaio?». Una proiezione a valore unico cancellerebbe quella risposta ogni volta che
arriva un documento nuovo.

### Correggere un contratto già verificato

Una versione verificata è immutabile, quindi dopo la verifica non esiste più alcuna bozza.
`contract_open_draft(contract_id)` ne apre una nuova a partire dai termini in vigore, che restano
tali finché anche questa non viene verificata.

---

## 3. Amendment: come una modifica NON sovrascrive la storia

1. il documento viene collegato con `relation = 'amendment'` (o `renewal`);
2. il worker lo legge e scrive la propria estrazione, **senza toccare** quella dell'accordo;
3. la bozza si ricompone e il contratto passa a **`review_required_again`**;
4. la schermata mostra il **confronto** «Prima / Nuovo documento» sui campi che contano;
5. **i termini in vigore non cambiano** finché una persona non verifica;
6. alla verifica nasce la versione nuova, la precedente diventa `superseded` e **resta leggibile**.

⚠️ `verified_at`/`verified_by` della verifica precedente **non** vengono cancellati alla riapertura:
«era stato verificato il 3 marzo, poi è arrivata una modifica» è esattamente ciò che si vuole poter
dire.

---

## 4. Le date: che cosa si calcola e che cosa NO

L'aritmetica vive **in un posto solo**, la funzione SQL `contract_notice_deadline` (0024). Postgres
aggancia da sé la fine del mese, e il comportamento è verificato contro il database vero, non
supposto:

| Ingresso | Risultato | Verificato |
|---|---|---|
| 3 mesi prima del 31.12.2026 | 30.09.2026 | ✅ |
| 1 mese prima del 31.03.2024 (bisestile) | 29.02.2024 | ✅ |
| 1 mese prima del 31.03.2026 | 28.02.2026 | ✅ |
| 30 giorni prima del 15.01.2026 | 16.12.2025 | ✅ |
| 1 anno prima del 29.02.2024 | 28.02.2023 | ✅ |

### Che cosa NON produce alcuna data

| Ancoraggio | Perché no |
|---|---|
| `to_month_end` («auf Monatsende») | servirebbe sapere a quale scadenza il preavviso si riferisce e come le due regole si compongono: due letture legittime danno due date diverse |
| `to_quarter_end`, `to_year_end` | stessa ragione |
| `anytime` | non esiste una scadenza a cui ancorare |
| `unclear` / assente | §39 alla lettera |
| durata minima senza inizio certo | sommare mesi a una data incerta produce una scadenza che sembra un fatto |

In tutti questi casi l'interfaccia mostra il preavviso, mostra la **clausola originale** e dichiara
che una data non è derivabile.

⚠️ **L'AI non calcola mai una data.** Il modello legge «tre mesi prima della scadenza»; la data la
fa il codice deterministico.

### Candidata ≠ verificata

Una data derivata nasce `candidate`: è una **proposta**, e non può generare lavoro. Solo dopo che
una persona l'ha guardata diventa `verified`, e da lì è materia di attività, calendario e
automazioni. Nell'interfaccia, su una data non verificata il pulsante «Crea attività» **non
compare**: al suo posto c'è la ragione.

⚠️ Con rinnovo automatico dichiarato, la data di fine è una **`renewal_date`**, non una
`contract_end`: quel giorno il contratto non finisce, si rinnova — e chiamarla «scadenza» è il modo
più diretto per far perdere un termine di disdetta.

---

## 5. Estrazione ed evidenze

Il prompt (`_shared/contracts/prompt.ts`) vieta esplicitamente al modello di dire se una clausola è
valida, di citare norme non citate dal documento, di colmare i silenzi con la legge e di dire a
qualcuno che cosa deve fare.

La validazione (`_shared/contracts/validate.ts`) applica cinque regole:

1. **un campo non previsto non esiste** — difesa contro un documento che chieda di aggiungerne uno;
2. **fiducia sotto `0.65` → il valore non si salva** (soglia più alta di Finance: un importo
   sbagliato si scopre pagando, un preavviso sbagliato a rinnovo avvenuto);
3. **citazione obbligatoria** su date, preavviso, ancoraggio, rinnovo e costo;
4. **la conversione la fa il codice** (`periods.ts`): «drei Monate» → `{3, months}`;
5. **nessun giudizio entra**: obblighi, clausole e penali senza citazione **ritrovata nel testo**
   vengono scartati.

⚠️ **L'ancoraggio lo deduce il codice dalla clausola, non il modello.** Al modello si chiede la
frase; `detectAnchor()` riconosce a che cosa si riferisce, con regole leggibili e provate. E
l'ordine dei controlli è sostanziale: «tre mesi prima della scadenza **per fine mese**» si risolve
in `to_month_end`, perché quando una fine periodo è nominata la data non è più una sottrazione.

⚠️ **Nessuna lettura di ripiego senza modello.** A differenza di Finance — dove il codice sa leggere
un IBAN da solo, ed esattamente — qui una clausola non si riconosce con un'espressione regolare:
senza chiave AI il worker **non scrive alcun verbale**.

---

## 6. Integrazioni

- **Documents**: sorgente unica dei file. Da un documento di categoria `contracts` si arriva alla
  creazione con il documento già scelto (§79); il collegamento resta una decisione umana (§80).
- **Attività**: `tasks.contract_id` e `tasks.contract_milestone_id` sono **chiavi esterne**, non
  testo nella descrizione. Un trigger verifica che le aziende coincidano (§105).
- **Calendario e notifiche**: il modulo **non** crea eventi né notifiche proprie. Una milestone
  diventa attività, e l'attività passa dall'infrastruttura esistente (§91/§92).
- **Automazioni**: quattro inneschi nuovi, con `contract` come **entità nuova** del motore.

| Innesco | Quando |
|---|---|
| `contract_verified` | una persona conferma i termini |
| `contract_review_required` | arriva un documento che sembra modificarli |
| `contract_milestone_verified` | una persona conferma una data |
| `contract_milestone_window_opened` | una data verificata entra nei prossimi 60 giorni (una volta sola) |

⚠️ **Nessun innesco nasce da una proposta**: il motore non riceve mai una data `candidate`. E le
azioni restano le sei esistenti — non esiste, e non deve esistere, un'azione «disdici» o «accetta
rinnovo».

---

## 7. Sicurezza

- **RLS** su tutte e sette le tabelle, con `revoke all` **prima** dei grant (lezione della 0014).
- **Cross-tenant**: un contratto di A non può puntare a un documento di B, né un'attività di A a un
  contratto di B. I controlli stanno nei trigger, perché le funzioni `security definer` devono
  difendersi da sole (lezione della 0017).
- **Attori**: `verified_by`, `archived_by`, `corrected_by` li scrive il database da `auth.uid()`.
  Una correzione firmata a nome altrui viene **rifiutata**, non riscritta in silenzio.
- **Stato di verifica non scrivibile dal client**: nessun grant di colonna su `review_status`,
  `verified_at/by`, `current_term_version_id`, `origin`, `quality_flags`. Un tentativo **fallisce**
  invece di essere ignorato.
- **Riservatezza (§110)**: nei log e nello storico entrano solo identificativi, chiavi e conteggi —
  mai il testo di una clausola, un indirizzo, un importo o il nome di una controparte.

---

## 8. Test

    npm run test:contracts-unit    89 casi, offline

Copre: periodi nelle quattro lingue, ancoraggi e ordine dei controlli, derivabilità, ambiguità delle
date, validazione (citazioni, fiducia, campi scartati), prompt injection, **coerenza fra TypeScript
e SQL** (i due elenchi dichiarati due volte, letti dal file `.sql`), riservatezza dei log.

Verificato inoltre **contro il database vero**: applicazione della 0024, aritmetica delle date sui
casi limite, e la catena completa nell'interfaccia — creazione, correzioni, bozza ricalcolata, date
derivate, verifica, attività generata.

---

## 9. Configurazione

1. applicare `supabase/migrations/0024_contract_manager.sql`;
2. secret `CONTRACT_WORKER_SECRET`;
3. `npx supabase functions deploy contract-worker --project-ref <ref> --no-verify-jwt`
   (prima: `export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w)`);
4. il job pg_cron. ⚠️ **Fino al 2026-07-31 questo passaggio era una riga di prosa**
   («job pg_cron ogni 5 minuti») e non un comando: il job esisteva nel progetto
   Supabase e in nessun file del repository, quindi rifacendo il database non
   sarebbe tornato, e `contract-worker` risultava una funzione che nessuno chiama.
   Il blocco qui sotto è quello **in esercizio**, riletto da `cron.job`:

```sql
select vault.create_secret('<CONTRACT_WORKER_SECRET>', 'contract_worker_secret');

select cron.schedule(
  'contract-worker',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://<ref>.supabase.co/functions/v1/contract-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-contract-worker-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'contract_worker_secret')
    ),
    body    := '{}'::jsonb,
    -- La trappola dei 5 secondi di pg_net: senza, ogni esecuzione fallisce.
    timeout_milliseconds := 150000
  );
  $$
);
```

---

## 10. Limiti dichiarati

**Fuori perimetro per scelta (§3)**: contratti di lavoro, patti parasociali, M&A, finanziamenti
complessi, contenziosi, transazioni giudiziali. Se riconosciuti, il prodotto lo **dichiara** e il
documento resta nei Documenti.

**Non implementato, e non per dimenticanza**: invio di disdette, generazione di clausole o lettere,
firma elettronica, CRM delle controparti, sistema di gare, consulenza assicurativa, valutazione
finanziaria di un leasing, chat legale sul contratto.

**Limiti tecnici noti**:

- il **worker non è ancora stato eseguito su un contratto vero**: il prompt è allineato a un
  ragionamento, non a una risposta reale;
- ⚠️ **`test:contracts` ESISTE** e chiude **66 asserzioni** su database reale (RLS, cross-tenant,
  immutabilità). Fino al 2026-07-31 questa riga dichiarava che la suite non esistesse: era vera
  quando è stata scritta e non lo era più, e nessun controllo poteva vederlo perché `docs:check`
  verificava che i comandi documentati esistessero, non che le frasi sui comandi fossero vere;
- documenti oltre `CONTRACT_MAX_CHARS` vengono **troncati** — dichiarato con `partially_analysed`,
  e le clausole di disdetta stanno spesso in fondo;
- il costo ricorrente **non viene annualizzato** (§54) e le valute **non si sommano** (§55);
- `lifecycle_status` **non si deriva** da una data passata (§118): lo imposta una persona.
