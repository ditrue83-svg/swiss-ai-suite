# Gli stati di un documento — censimento misurato

> **Che cos'è questo file.** L'elenco di tutti i campi che dichiarano «a che
> punto è» un documento, di che cosa dicono a schermo, e di dove si
> contraddicono. Ogni numero porta accanto **la data in cui è stato preso**:
> una misura senza data, fra un mese, è un racconto.
>
> **Come si rimisura.** `npm run stati:censimento` — sola lettura, nessun
> credito AI speso. Rifà **tutti** i conteggi di questo file contro il database
> vero e li stampa nello stesso ordine. La regola del progetto è che *il
> registro si rimisura, non si eredita*: prima di riportare un numero di qui
> altrove, si rilancia il comando.

---

## 0. Che cosa è stato misurato, e quando

| | |
|---|---|
| **Dati** | database di produzione (quello di `.env.test`), **2026-08-24 ore 16.10 UTC**, migrazioni applicate fino alla **0045** |
| **Codice** | albero al commit `ce933ea`, ramo `fix/inbox-ingresso-per-domini`, **2026-08-24** |
| **Aziende nel database** | 2 (`Rossi SA`, `Pilota Impianti Sagl`) — i documenti sono tutti di una sola |
| **Come** | `npm run stati:censimento` per i conteggi; la colonna «chi lo scrive» **a mano**, rileggendo i sorgenti |

⚠️ **Il codice misurato non è ancora tutto in produzione.** I quattro commit di
`fix/inbox-ingresso-per-domini` (ingresso per domini, aritmetica dei giorni,
gesto di promozione, ripristino) non sono uniti: il frontend servito è fermo
alla **PR #74 del 2026-08-22**. Le **migrazioni 0043/0044/0045 e le undici Edge
Function sì**, sono state applicate e deployate il 2026-08-24 — quindi i *dati*
di questo censimento sono già quelli del mondo nuovo, il *frontend* no.

⚠️ **«Chi lo scrive» non lo misura il comando, e non è una svista.** Un rilevatore
che cercasse `'completed'` nei sorgenti direbbe «vivo» per un valore nominato in
un banco di prova — ed è esattamente il difetto che questo progetto chiama *«il
banco che tiene in vita ciò che dovrebbe segnalare»*. Quella colonna è una
lettura umana del sorgente, con il `file:riga` accanto perché sia ricontrollabile.

---

## 1. I quattro assi — la mappa che serve per leggere il resto

Un documento risponde a **quattro domande diverse**, e ogni difetto di questo
censimento nasce dall'averne mescolate due:

| | Asse | La domanda | Chi risponde |
|---|---|---|---|
| **1** | **Lavorazione** | «la macchina ha finito?» | il sistema |
| **2** | **Incertezza della lettura** | «quanto è sicuro il modello di aver letto bene?» | il modello |
| **3** | **Verifica umana** | «una persona l'ha guardato e lo conferma?» | una persona |
| **4** | **Collocazione aziendale** | «dove sta, nell'organizzazione dell'azienda?» | l'azienda |

Lo stato misurato il 2026-08-24:

- **asse 1 — esiste**, ed è duplicato in due colonne (§6.1);
- **asse 2 — esiste ed è popolato**: 94 punti di incertezza su 21 analisi su 21,
  più `confidence`, i tetti di `analysisTrust` e le due colonne della scadenza;
- **asse 3 — NON esiste come campo del documento**, e i due luoghi in cui vive
  di riflesso hanno **0 e 1 riga** (§5, §7);
- **asse 4 — esiste**, ed è l'unico che una persona può cambiare liberamente;
  ma `archived_at` porta **17 righe su 20 senza un archiviatore** (§8).

⚠️ **Il rischio, dichiarato in testa perché non si ripeta.** Di «non
conclusivo» questo prodotto ha già **cinque vocabolari distinti sul documento**
— `documents.status='needs_review'`, `analysis_status='needs_review'`,
`confidence='bassa'|'media'`, `uncertainties[]`, `deadline_requires_verification`
— più un sesto sul messaggio (`attention_status='to_verify'`). Ciascuno dice una
cosa vera e diversa. **Il modo di sbagliare, qui, è aggiungerne un settimo.**

---

## 2. La tabella dei campi di stato

Righe per valore: **misurate il 2026-08-24**. «Chi lo scrive»: **letto nel
sorgente il 2026-08-24**.

### 2.1 `documents.status` — enum `document_status`, 8 valori dichiarati

| Valore | Righe (24.08) | Chi lo scrive | Asse |
|---|---|---|---|
| `needs_review` | **16** | [`persist.ts:244`](../supabase/functions/_shared/persist.ts) ← `reviewStatus(a)` | 1 **e 2** |
| `completed` | **4** | idem | 1 **e 2** |
| `uploaded` | 0 | default della colonna ([`0002:31`](../supabase/migrations/0002_documents.sql)) e [`email/store.ts:566`](../supabase/functions/_shared/email/store.ts) | 1 |
| `extracting` | 0 | [`analyze-document/index.ts:144,155,439`](../supabase/functions/analyze-document/index.ts) | 1 |
| `analyzing` | 0 | [`pipeline.ts:89`](../supabase/functions/_shared/pipeline.ts), `analyze-document:439` | 1 |
| `failed` | 0 | `analyze-document:406`, [`recoverStuckAnalyses.ts:144`](../supabase/functions/_shared/recoverStuckAnalyses.ts) | 1 |
| `analyzed` | 0 | [`analysisService.ts:356`](../src/services/analysisService.ts) — **solo nel percorso deterministico**, che in produzione non gira | 1 |
| `processing` | 0 | **nessuno**. È solo *letto*, in `STATI_IN_LAVORAZIONE` (`recoverStuckAnalyses.ts:60`) | — |

⚠️ **Una colonna, due domande.** `reviewStatus(a)` ([`persist.ts:97-99`](../supabase/functions/_shared/persist.ts))
è `overallConfidence < 0.45 || un'incertezza grave` → `'needs_review'`. Cioè:
in una colonna che si chiama «stato» e che per sei valori su otto dice *dove sta
la macchina*, gli altri due dicono **quanto il modello si fida**. È il punto
esatto in cui l'asse 1 e l'asse 2 si sono fusi.

⚠️ **E quella distinzione non la legge nessuno.** I lettori di `documents.status`
sono tre, misurati: `stateOf` ([`documentModel.ts:52`](../src/features/documents/documentModel.ts))
che la consulta **solo** per i tre valori di lavorazione; `waitForCompletion`
(`analysisService.ts:297-315`) che tratta `completed`, `needs_review` e
`analyzed` come **lo stesso fatto** («ha finito»); e la ripresa delle analisi
interrotte. Nessuno chiede a questa colonna se il documento sia dubbio: quello
lo chiede a `analysis_status`. **Il giudizio è scritto, e non è letto.**

⚠️ `documentService.setStatus` ([`documentService.ts:182`](../src/services/documentService.ts))
**non ha chiamanti** (misurato: `grep documentService.setStatus src/ scripts/` → 0).

### 2.2 `document_analyses.analysis_status` — enum `analysis_status`, 4 valori

| Valore | Righe (24.08) | Chi lo scrive | Asse |
|---|---|---|---|
| `needs_review` | **16** | [`persist.ts:158`](../supabase/functions/_shared/persist.ts) ← **lo stesso `reviewStatus(a)`** di §2.1 | 1 e 2 |
| `completed` | **5** | idem, e **default della colonna** (`0006:65`) | 1 e 2 |
| `failed` | 0 | `analyze-document:411`, `recoverStuckAnalyses.ts:153` | 1 |
| `pending` | 0 | **nessuno** — vedi §3 | — |

Totale: **21 analisi su 20 documenti** (un documento ne ha due: le rianalisi si
accumulano e vince la più recente, 0010).

### 2.3 L'incertezza (asse 2)

| Campo | Valori misurati il 24.08 | Chi lo scrive |
|---|---|---|
| `confidence` | `media`=15 · `alta`=5 · `bassa`=1 | il modello, via `persist.ts` |
| `overall_confidence` | valorizzato su **21 su 21** | idem |
| `uncertainties[]` | **94 punti su 21 analisi su 21** — gravità `medium`=38, `high`=28, `low`=28 | idem |
| `deadline_type` | `explicit`=9 · `inferred`=6 · `none`=4 · `relative`=2 | idem |
| `deadline_kind` (0040) | **NULL=19** · `term`=2 | idem |
| `deadline_requires_verification` | `true`=13 · `false`=8 | il validatore |

Campi dei 94 punti, per radice: `deadline`=22, `recipient`=18, `documentDate`=16,
`sender`=14, `documentType`=11, `amounts`=5, `language`=2, `authenticity`=2,
`content`/`security`/`requestedDocuments`/`risks`=1 ciascuno.

⚠️ **`deadline_kind` è quasi vuoto**: 19 analisi su 21 non hanno mai risposto
alla domanda «che cosa È questa data?», perché la 0040 è del 15 agosto e nessuno
rianalizza un documento archiviato. È la ragione per cui la regola vive **anche
in lettura** ([`deadlineNature.ts`](../supabase/functions/_shared/deadlineNature.ts)).

⚠️ **6 analisi hanno `deadline_type='inferred'` e NESSUNA data** (misurato). È il
motivo per cui i due tetti sulla scadenza in `analysisTrust.ts` sono vincolati a
`deadline != null`.

### 2.4 La verifica umana (asse 3)

| Campo | Righe (24.08) | Chi lo scrive |
|---|---|---|
| `analysis_corrections` (tutte) | **0** | [`DocumentDetailPage.tsx:346`](../src/features/documents/DocumentDetailPage.tsx) (appartenenza), `ResultView.tsx:319` (i quattro campi) |
| di cui `field='ownership'` | **0** | idem |
| `action_progress` | **1** (vedi §5) | il dettaglio del documento |
| una colonna sul documento | **non esiste** | — |

### 2.5 La collocazione aziendale (asse 4)

| Campo | Valori misurati il 24.08 | Chi lo scrive |
|---|---|---|
| `category` | NULL=16 · `invoices`=3 · `administration`=1 | il trigger `0017:355-377`, da regola o da persona |
| `category_source` | NULL=16 · `rule`=4 | il trigger; `'workflow'` lo scrive [`executors.ts:319`](../supabase/functions/_shared/automation/executors.ts) |
| `archived_at` | **20 su 20 valorizzato** | [`documentHubService.ts:714`](../src/services/documentHubService.ts) e `documents_bulk_archive` (`0017:973`) |
| `archived_by` | valorizzato su **3 su 20** | il trigger `0017:383-392`, da `auth.uid()` |
| `internal_notes` | non censito (testo libero, non uno stato) | — |
| `source_type` | `email`=17 · `upload`=2 · `pasted_text`=1 | alla creazione |

### 2.6 L'ingresso: `email_messages` (il documento nasce lì)

| Campo | Valori misurati il 24.08 (148 messaggi) | Chi lo scrive |
|---|---|---|
| `processing_status` | `done`=**148** (gli altri 6 valori: 0) | `email/sync.ts`, `email/store.ts` |
| `attention_status` | `ignored`=72 · `informational`=44 · `to_verify`=32 | derivato da `relevance` — vedi §6.2 |
| `relevance` | `clearly_irrelevant`=72 · `informational`=44 · `likely_actionable`=22 · `possibly_actionable`=10 | il classificatore |
| `email_message_documents` | **18 collegamenti**, tutti `body`; 17 documenti distinti, 18 messaggi | `email/store.ts` |

⚠️ **Un documento ha DUE messaggi dietro** (misurato: 18 collegamenti per 17
documenti). Una colonna scalare `promoted_from_message_id` sarebbe già falsa
oggi: la relazione è, ed è giusto che resti, una tabella.

---

## 3. Gli stati morti, nei due sensi

**Senso A — dichiarati e mai scritti da nessun codice.** Non «non ancora
capitati»: nessun percorso li produce.

| Valore | Dove è dichiarato | Chi lo legge | Verdetto |
|---|---|---|---|
| `document_status='processing'` | `0002:14` | `recoverStuckAnalyses.ts:60`, `documentModel.ts:41` | **morto in scrittura**: nessuno lo scrive, due lettori lo aspettano |
| `analysis_status='pending'` | `0006:23` | `documentModel.ts:57` (`→ 'processing'`) | **morto in scrittura**: il default della colonna è `completed`, e nessuno scrive `pending`. Il ramo di `stateOf` non può essere preso |
| `document_status='analyzed'` | `0002:14` | **un solo lettore**: `analysisService.ts:312`, che lo tratta come «ha finito» | **vivo solo nel percorso deterministico**, che in produzione non gira (`ANALYSIS_PROVIDER='ai'`) |

**Senso B — letti a schermo, ma irraggiungibili nei dati.** Un'etichetta che
esiste per uno stato che non arriva mai.

| Etichetta | Legge | Righe (24.08) | Verdetto |
|---|---|---|---|
| «In elaborazione» (`documents.states.processing`) | `stateOf` → `processing`/`extracting`/`analyzing`/`pending` | 0 | raggiungibile solo **durante** un'analisi: un istante, mai in archivio |
| «Non ancora analizzato» (`documents.states.none`) | assenza di analisi | **0 documenti senza analisi** | mai vista |
| «Analisi non riuscita» (`documents.states.failed`) | `analysis_status='failed'` | 0 | mai vista |
| «Analizzato» (`documents.states.analyzed`) | `analysis_status='completed'` | 4 | viva |
| «Da verificare» (`documents.states.to_verify`) | `analysis_status='needs_review'` | 16 | viva — **è lo stato normale, non l'eccezione** |

**Senso C — dichiarati, scritti da un gesto umano, mai esercitati.** Non sono
morti: sono *non usati*, ed è una differenza che va scritta.

| Valore | Chi lo scrive | Righe (24.08) |
|---|---|---|
| `email_attention_status='needs_attention'` («Da gestire») | **la promozione a documento**, [`0045:187`](../supabase/migrations/0045_inbox_promozione.sql) — dal 2026-08-23 **nessuna macchina lo produce più** ([`contract.ts:38-49`](../supabase/functions/_shared/email/contract.ts)) | **0** |
| `email_attention_status='handled'` | [`inboxService.ts:348`](../src/services/inboxService.ts) | **0** |
| `email_attention_status='dismissed'` (0044) | `inboxService.ts:340` | **0** |
| `document_category_source='workflow'` | `executors.ts:319` | **0** |
| `task_status` `in_progress`/`waiting`/`completed` | la tendina del dettaglio | **0** (5 attività, tutte `open`) |
| `contract_review_status='verified'` | Contratti | **0** (1 contratto, `needs_review`) |
| `finance_review_status='ready'` | Finanze | **0** (3 voci, tutte `needs_review`) |

**Senso D — un enum senza il valore che servirebbe.** `audit_action` ha 12
valori e **nessuno riguarda l'archiviazione**: i trigger di audit sui documenti
sono su `insert` e `delete` soltanto ([`0039:330,359`](../supabase/migrations/0039_audit_logs.sql)).
Sulle 40 righe di `audit_logs` misurate il 24.08 non c'è, e non può esserci,
traccia di chi ha archiviato che cosa. Per le **attività** invece sì:
`archived_at` è fra i campi confrontati dal trigger (`0039:574`).

Quattro valori di `audit_action` non hanno mai prodotto una riga: `analysis_failed`,
`correction_saved`, `reply_generated`, `member_role_changed` (misurato il 24.08).
`correction_saved` a zero è coerente con le **0 correzioni** di §2.4.

---

## 4. La tabella delle etichette a schermo

Quale campo legge ciascuna, e quale asse racconta. Letta nel sorgente il 2026-08-24.

| Etichetta (it) | Chiave | Legge | Asse |
|---|---|---|---|
| «Analizzato» | `documents.states.analyzed` | `analysis_status='completed'` | 1 |
| «Da verificare» | `documents.states.to_verify` | `analysis_status='needs_review'` | 1 **travestito da 2** |
| «Analisi non riuscita» | `documents.states.failed` | `analysis_status='failed'` | 1 |
| «In elaborazione» | `documents.states.processing` | `documents.status` ∈ {extracting, analyzing, processing} | 1 |
| «Non ancora analizzato» | `documents.states.none` | nessuna analisi | 1 |
| «L'ultimo tentativo non è riuscito…» | `documents.lastAttemptFailed` | `list_documents`: ultimo tentativo `failed` **e** ne esiste uno buono (`0040:292`) | 1 |
| «Attendibilità dell'analisi ●○○» | `documents.trust.title` + `ConfidenceBadge` | `analysisTrust()`: `confidence` abbassata dai tetti | **2** |
| «Confidenza di lettura» | `documents.trust.readingLabel` | `confidence` grezzo, nei dettagli tecnici | 2 |
| «N elementi da verificare» | `documents.trust.pointsOne/Many` | `uncertainties.length` — **non è un tetto**: è un altro fatto | 2 |
| «Punti da verificare» | `documents.uncertainties` | `uncertainties[]` | 2 |
| segno «da verificare» sul campo | `ProvenanceMark kind="toVerify"` | `segnoCampo()`: campo senza canale di citazione **e** con un punto | 2 |
| «Scadenza …» con segno | `DeadlineMark` | `deadlineRequiresVerification` **∨** `deadline_kind` non dichiarata | 2 |
| «non valutabile · appartenenza da confermare» | `documents.trust.unavailableOwnership` | `valutaAppartenenza()` sul destinatario | **3** (la sua assenza) |
| «appartenenza da confermare» | `documents.ownership.badge` | idem | 3 |
| «Appartenenza confermata da {nome} il {data}» | `documents.ownership.confirmedLine` | `analysis_corrections` con `field='ownership'` | **3** |
| «Corretto da una persona» | `documents.correctedBadge` | `analysis_corrections` sul campo | **3** |
| «Archiviati» (filtro) · avviso «archiviato» | `documents.viewArchived` · `documents.nextStep.noticeArchived` | `archived_at` | **4** |
| categoria e sua origine | `labels.categories.*` (via `useLabels`) | `category`, `category_source` | 4 |
| «Caricato / Ricevuto via email / Testo incollato» | `documents.sources.*` | `source_type` | 4 |

⚠️ **La riga che conta.** «Da verificare» è l'etichetta dell'**asse 1**
(`analysis_status`) ma il lettore la capisce come **asse 3** («qualcuno deve
guardarlo»). È la stessa parola con cui l'asse 2 marca un campo dubbio
(`ProvenanceMark`) e con cui l'Inbox marca un messaggio (`to_verify`, 32
messaggi). Tre assi, una parola.

⚠️ **Nessuna etichetta legge `documents.status` per il giudizio.** Solo per i
tre valori di lavorazione. Confermato leggendo `documentModel.ts:41-58`.

---

## 5. Che cosa dice `action_progress`, e su quante righe

`action_progress` (0010) è **l'unico posto in cui una persona dichiara di aver
fatto qualcosa su un documento**: una riga per azione spuntata, con `done`,
`done_by` e `done_at` messi dal trigger e non dal client (`0010:97-132`).

Misurato il **2026-08-24**:

- **1 riga in tutto**;
- `done = false` — quindi **nessuna azione è mai stata spuntata**;
- tocca **1 analisi su 21**;
- 0 righe con `done=true` e `done_at` nullo.

Cioè: la tabella **sa** dire «una persona ci sta lavorando», e non l'ha mai
detto. Sul lato lettura il fatto è disponibile — `openActions` e `stepsToCreate`
in [`nextStep.ts:108,113`](../src/features/documents/nextStep.ts) contano le
azioni aperte — ma **nessuna etichetta di stato del documento legge
`action_progress`**: non esiste un «in lavorazione» del documento derivato dalle
spunte. È il **lettore** che manca, non il dato.

---

## 6. I campi che dicono la stessa cosa, e quanto concordano

### 6.1 `documents.status` ↔ `document_analyses.analysis_status`

Misurato il 2026-08-24: **20 documenti confrontati con l'ultima analisi,
20 concordi, 0 discordi, 0 documenti senza analisi.**

Concordano perché è **la stessa espressione** a scriverli, nella stessa
funzione: `reviewStatus(a)` in [`persist.ts:158`](../supabase/functions/_shared/persist.ts)
(la riga di analisi) e in `persist.ts:244` (la riga del documento).

⚠️ **Non sono però ridondanti, e cancellarne una sarebbe un errore.** Divergono
per costruzione in un caso previsto: una **rianalisi fallita** lascia
`documents.status='failed'` mentre l'ultima analisi buona resta `completed`. Per
quel caso esiste già un'etichetta sua — `documents.lastAttemptFailed` — che però
**non legge `documents.status`**: la calcola `list_documents` dalle sole righe di
analisi (`0040:292`). Quindi le due colonne sono **una copia** dello stesso
giudizio più **due storie diverse dei tentativi**, e la seconda è già letta da
un'altra parte.

### 6.2 `email_messages.relevance` → `email_messages.attention_status`

Misurato il 2026-08-24 su **148 messaggi**: la mappa da `relevance` a
`attention_status` è una **funzione totale**, 0 valori ambigui.

```
clearly_irrelevant  → ignored         72
informational       → informational   44
likely_actionable   → to_verify       22
possibly_actionable → to_verify       10
```

Non è un caso: la scrive [`attentionForRelevance`](../supabase/functions/_shared/email/contract.ts)
(`contract.ts:50-58`), chiamata da `email/store.ts:376`. **Su tutti i dati di
oggi la seconda colonna non porta un fatto in più.**

⚠️ Con una differenza che la rende comunque necessaria: `attention_status` è
l'**unica delle due che una persona può cambiare** (`handled`, `dismissed`,
`needs_attention` — `inboxService.ts:340,348` e `0045:187`), mentre `relevance`
è il giudizio della macchina e non si tocca. Oggi coincidono perché **nessuno ha
ancora esercitato un gesto**: 0 righe `handled`, 0 `dismissed`, 0
`needs_attention`. Il giorno del primo gesto la funzione smetterà di essere
totale, ed è quello il punto in cui la colonna comincerà a servire.

### 6.3 `assistant_threads`: `status` ↔ `archived_at`

Due colonne per lo stesso fatto — ma il database **impedisce** che divergano:
il vincolo `assistant_threads_archived_coherent` ([`0027:181-184`](../supabase/migrations/0027_company_assistant.sql))
esige `status='archived' ⟺ archived_at is not null`. Misurato il 24.08:
1 conversazione, `active`, `archived_at` nullo, **0 discordanze** (e non
potrebbero essercene).

### 6.4 `workflow_definitions`: `status='archived'` ↔ `archived_at`

Stesso raddoppio, tenuto insieme da un **trigger** invece che da un vincolo
([`0020:1106-1119`](../supabase/migrations/0020_workflow_automation.sql)): il
timbro lo mette il database quando lo `status` diventa `archived`, e lo cancella
quando smette di esserlo. Misurato il 24.08: 1 automazione, `active`,
**0 discordanze**. Vedi però §8 — qui l'archiviazione **distrugge** un altro valore.

### 6.5 `subsidy_projects`: `stage` + `status` + `archived_at`

Tre colonne, due fatti: `stage` è l'avanzamento, `status` ∈ {`active`,`archived`}
è la collocazione, `archived_at` è il suo timbro (`0032:813-816`). Il codice
scrive solo `status` ([`incentivesService.ts:445-448`](../src/services/incentivesService.ts)).
Misurato il 24.08: **0 progetti** — la coerenza fra le tre non è mai stata messa
alla prova su un dato vero.

---

## 7. Separare gli assi: serve una migrazione?

Tre domande diverse, tre risposte diverse.

### 7.1 Separare l'asse 1 dall'asse 2 dentro `documents.status` → **no, non subito**

La lettura è **già** separata: `stateOf` consulta `documents.status` solo per i
tre valori di lavorazione, e il giudizio lo prende da `analysis_status`. Il
problema è in **scrittura**: `persist.ts:244` continua a mettere un giudizio in
una colonna di pipeline. Smettere non richiede una migrazione — richiede di
scegliere che cosa scriverci al suo posto (`'analyzed'` esiste già nell'enum e
oggi lo scrive solo il percorso deterministico), e di verificare i due lettori
che aspettano `completed|needs_review` per dire «ha finito»
(`analysisService.ts:312`). **Costo: nessuna migrazione, due lettori da
controllare.** Guadagno: la colonna smette di dire una cosa che nessuno le
chiede.

### 7.2 Togliere la duplicazione fra le due colonne → **no, e conviene non farlo**

Vedi §6.1: divergono in un caso previsto e utile. La duplicazione **non è**
il difetto; il difetto è che il valore duplicato mescola due assi.

### 7.3 Dare al documento un asse 3 → **sì, e questa è l'unica che serve davvero**

Il dato **non esiste**: non c'è modo, in lettura, di ricavare «una persona ha
guardato questo documento e lo conferma» da ciò che c'è. Oggi l'asse 3 vive
soltanto come **righe in `analysis_corrections`** (0 righe misurate il 24.08),
e quella tabella ha un vincolo che lo limita:

```sql
-- 0006:132
analysis_id  uuid not null references public.document_analyses (id) on delete cascade,
document_id  uuid not null references public.documents (id) on delete cascade,
```

Conseguenze **misurate nel codice** il 2026-08-24:

- la **lettura** è già a livello di documento — `useAnalysisTrust` chiama
  `documentHubService.corrections(analysis.documentId)`, non per analisi:
  **una conferma sopravvive a una rianalisi**;
- la **scrittura** no. `DocumentDetailPage.tsx:346` comincia con
  `if (!detail?.item.analysisId || !user) return;` → **su un documento senza
  analisi il pulsante «Confermo» non fa niente, in silenzio**. Oggi non morde
  (0 documenti senza analisi), ma è un ripiego muto, e il progetto ne vieta uno.

Le due forme possibili, con il loro costo:

| | Che cosa | Costo | Rischio |
|---|---|---|---|
| **A** | rendere `analysis_corrections.analysis_id` **nullable** | una migrazione di una riga | indebolisce un invariante giusto per le correzioni di *campo*, che un'analisi ce l'hanno per definizione |
| **B** | tabella nuova `document_verifications` (`document_id`, `verified_by`, `verified_at`, `kind`, append-only) | una migrazione + RLS + un lettore | è la forma che **due moduli hanno già**: `finance_items.reviewed_at/reviewed_by` (0021) e `contracts.review_status` (0024) |

**Raccomandazione: B**, perché rende la conferma di appartenenza e la verifica
del documento **la stessa cosa** che Finanze e Contratti chiamano già così, e
perché non tocca un vincolo che per le correzioni di campo è corretto.

⚠️ **Che cosa NON aggiungere.** Una colonna `documents.review_status` con dentro
`needs_review`: sarebbe il **sesto** vocabolario di «non conclusivo» sul
documento, con la stessa parola di due colonne che già esistono (§1).

---

## 8. L'archiviazione attraverso il prodotto

`archived_at` non è dei Documenti: attraversa **dodici tabelle in nove
migrazioni** (ricavate dalle migrazioni dal comando, non da un elenco a mano).
Quindi la domanda «archiviare è un riordino o un giudizio?» non si risolve per i
soli documenti.

⚠️ **Una correzione alla premessa, misurata.** Il **Calendario non ha un
`archived_at` suo**: un appuntamento *è* un'attività (`0041`), quindi eredita
`tasks.archived_at`. Le tabelle sono 12, le migrazioni 9 — non 10.

### 8.1 In quel modulo, l'archiviazione cambia un'etichetta di esito, completamento o verifica?

La stessa misura che ha trovato la fattura di Finanze (PR #71), rifatta su tutte.
Righe misurate il **2026-08-24**; punti nel codice letti lo stesso giorno.

| Modulo | Tabella | Righe · archiviate | Cambia un'etichetta di esito/verifica? | Il punto nel codice |
|---|---|---|---|---|
| **Finanze** | `finance_items` | 3 · 0 | **No — corretto il 12.08 (PR #71).** `financeState` restituisce ancora `'archived'` per primo, ma la **pastiglia** la sceglie `stateBadgeKey`, che in archivio legge `reviewStatus` VERO | [`financeModel.ts:106`](../src/features/finance/financeModel.ts) e `financeModel.ts:133-139` |
| **Contratti** | `contracts` | 1 · 0 | **SÌ, nella lista.** `contractState` restituisce `'archived'` **prima** di `verified` / `to_verify` / `amendment`, e la riga mostra **una sola** pastiglia: in archivio la verifica non si legge più | [`contractModel.ts:51`](../src/features/contracts/contractModel.ts) + [`ContractsPage.tsx:436-438`](../src/features/contracts/ContractsPage.tsx) |
| | | | **No, nel dettaglio**: `reviewStatus` è mostrato a parte | [`ContractDetailPage.tsx:165-167`](../src/features/contracts/ContractDetailPage.tsx) |
| **Documenti** | `documents` | 20 · **20** | **No.** `stateOf` non guarda `archived_at`; l'archivio aggiunge un avviso e non toglie niente | [`documentModel.ts:52`](../src/features/documents/documentModel.ts), [`nextStep.ts:106,132`](../src/features/documents/nextStep.ts) |
| **Attività** | `tasks` | 5 · 0 | **No.** `StatusMark` legge `task.status`; «Archiviata» si aggiunge al titolo | [`StatusMark.tsx:19-34`](../src/components/ui/StatusMark.tsx), [`TaskDetailPage.tsx:208`](../src/features/tasks/TaskDetailPage.tsx) |
| **Calendario** | *(nessuna: l'appuntamento è un'attività, 0041)* | — | come Attività | [`0041`](../supabase/migrations/0041_task_appointment.sql) |
| **Automazioni** | `workflow_definitions` | 1 · 0 | **Nessuna di esito — ma sì, un'altra.** `archived` è un **valore di `status`**: archiviare **sovrascrive** `active`/`paused`, e il ripristino riporta a **`draft`**, non a quel che era | [`automation-admin/index.ts:66`](../supabase/functions/automation-admin/index.ts), trigger [`0020:1106-1119`](../supabase/migrations/0020_workflow_automation.sql) |
| **Clienti — organizzazioni** | `crm_organizations` | 1 · 0 | **No di esito.** `organizationState` mette `archived` prima di `overdue_tasks`/`stale`: nasconde **avvisi**, non esiti | [`crmModel.ts:214`](../src/features/crm/crmModel.ts) |
| **Clienti — contatti** | `crm_contacts` | 0 · 0 | **No.** Solo un `Tag` «Archiviato» accanto al nome | [`ClientDetailPage.tsx:555-556`](../src/features/crm/ClientDetailPage.tsx) |
| **Clienti — opportunità** | `crm_opportunities` | 0 · 0 | **No, ma per un pelo.** `opportunityState` mette `archived` **prima di `won`/`lost`**; nessuna superficie però ne dipende: due delle tre stampano **anche** `L.crmStage(stage)` accanto, e nella terza la colonna del kanban **è** lo stadio | [`crmModel.ts:293`](../src/features/crm/crmModel.ts); [`OpportunityPages.tsx:295-296`](../src/features/crm/OpportunityPages.tsx), [`ClientDetailPage.tsx:596`](../src/features/crm/ClientDetailPage.tsx), [`ClientsPage.tsx:620-648`](../src/features/crm/ClientsPage.tsx) |
| **Assistente** | `assistant_threads` | 1 · 0 | **No.** Non esiste un esito di una conversazione; `status` e `archived_at` sono tenuti coerenti da un vincolo | [`0027:181-184`](../supabase/migrations/0027_company_assistant.sql), [`AssistantPage.tsx:699`](../src/features/assistant/AssistantPage.tsx) |
| **Incentivi — progetti** | `subsidy_projects` | 0 · 0 | **No.** Archiviare scrive `status`, e **`stage` resta intatto** | [`incentivesService.ts:445-448`](../src/services/incentivesService.ts) |
| **Incentivi — pratiche** | `subsidy_cases` | 0 · 0 | **No.** `archived_at` è un asse suo; `outcome` si mostra a parte | [`incentivesService.ts:591-594`](../src/services/incentivesService.ts), [`CasesTab.tsx:132,354`](../src/features/incentives/CasesTab.tsx) |
| **Inbox — catalogo domini** | `email_admin_domains` | 4 · 0 | **Non è un oggetto di lavoro**: è un catalogo, non ha esito | [`0043:75`](../supabase/migrations/0043_inbox_admin_domains.sql) |

**Il conto: una risposta «sì» su dodici** (Contratti, nella lista), più una
«sì, ma su un altro asse» (Automazioni), più una che regge solo perché tre
schermate stampano il valore vero accanto (opportunità).

### 8.2 Il numero che cambia la domanda

Sui **20 documenti archiviati su 20** misurati il 2026-08-24:

| | |
|---|---|
| archiviati **da una persona** (`archived_by` valorizzato) | **3** |
| archiviati **senza archiviatore** | **17** |
| e tutti e 17 **nello stesso istante**: | `2026-08-11T20:21:11` |

Gli altri: 2 il 2026-08-17, 1 il 2026-08-22.

Diciassette documenti — tutti arrivati via email — sono usciti dalle viste
correnti **in un colpo solo, senza che risulti chi**. Il trigger scrive
`archived_by := v_actor` (`0017:383-392`), e `v_actor` è nullo quando la
scrittura arriva col ruolo di servizio. E poiché `audit_action` non ha un valore
per l'archiviazione (§3, senso D), **quel gesto non ha lasciato traccia da
nessuna parte**: non si può sapere né chi né perché.

⚠️ È il fatto che risponde alla domanda meglio di qualunque ragionamento:
**oggi l'archiviazione è un riordino, perché per 17 documenti su 20 nessuno ha
giudicato niente** — e l'unica schermata che li mostra li chiama «Archiviati»,
che è vero, e non dice che nessuno li ha guardati.

---

## 9. Che cosa resta aperto

Voci **non** chiuse da questo censimento, elencate perché non si perdano:

1. **Asse 3 sul documento** (§7.3) — serve una migrazione; forma B raccomandata.
2. **`DocumentDetailPage.tsx:346`** — il pulsante «Confermo» esce in silenzio se
   il documento non ha un'analisi. È un ripiego muto, e il progetto li vieta.
3. **Contratti, la riga della lista** (§8.1) — in archivio la verifica non si
   legge. Stessa forma del difetto corretto in Finanze; la correzione è la
   stessa: una funzione pura che scelga la chiave della pastiglia.
4. **Automazioni** (§8.1) — archiviare distrugge `active`/`paused` e il
   ripristino riporta a `draft`.
5. **`archived_at` non è sorvegliato** (§3, senso D) — nessun valore di
   `audit_action` per l'archiviazione dei documenti.
6. **`documents.status` scrive un giudizio che nessuno legge** (§2.1).
7. **`documentService.setStatus` non ha chiamanti** (§2.1).
8. **`action_progress` non ha un lettore di stato** (§5).
9. **La conferma di appartenenza non è mai stata scritta in produzione**
   (0 righe in `analysis_corrections`, §2.4).

Nessuna di queste è stata toccata: questo file **misura**, non corregge.

---

## 10. Documenti vicini

- [`product-status.md`](product-status.md) — lo stato di ogni modulo e il registro dei limiti, **sede unica**.
- [`document-hub.md`](document-hub.md) — il modello dati dei Documenti.
- [`appartenenza-del-documento.md`](appartenenza-del-documento.md) — il cancello dell'appartenenza e i due difetti che la fattura di prova del 21 agosto ha portato a galla.
- [`ai-inbox.md`](ai-inbox.md) — l'ingresso della posta, sede unica dello stato operativo dell'Inbox.
