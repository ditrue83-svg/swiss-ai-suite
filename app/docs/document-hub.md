# Documenti — Smart Document Hub (migrazione 0017)

L'Archivio è diventato **Documenti**. Non è un cambio di nome: l'Archivio
elencava i file caricati in ordine di data, il Document Hub risponde a domande
che una PMI si pone davvero.

> Dov'è il contratto Swisscom? Cosa ci ha mandato l'AFC quest'anno? Quali
> documenti hanno una scadenza? Da quale email è arrivato questo PDF? Quali
> attività sono collegate a questo documento?

Nessuna di queste si risponde con un elenco ordinato per data, e per questo la
ricerca è l'elemento dominante della pagina.

---

## Il principio: comporre, non copiare

Il Hub **non possiede** dati sui documenti. Mittente, tipo, data, importi,
scadenze, riferimenti, citazioni e incertezze stanno dove stavano:

```
FILE ORIGINALE (Storage privato)
   └─ TESTO ESTRATTO      document_extractions      mai sovrascritto
        └─ ANALISI        document_analyses         immutabile dalla 0010
             └─ CORREZIONE UMANA  analysis_corrections  append-only
                  └─ DOCUMENT HUB   organizzazione aziendale
                       ├─ EMAIL     email_message_documents   (AI Inbox)
                       └─ ATTIVITÀ  tasks.document_id         (Work Hub)
```

L'unica cosa che il Hub aggiunge è l'**organizzazione aziendale**: categoria,
etichette, archiviazione, titolo mostrato, nota interna. È anche l'unica parte
che una persona può cambiare liberamente — cambiare categoria non produce una
`analysis_correction` e non tocca l'analisi, perché dove tenete un documento non
è un'affermazione sul suo contenuto.

**Non è stata creata nessuna tabella `document_ai_metadata`** con copie dei dati
dell'analisi, e **nessuna seconda pipeline AI**: un documento già analizzato non
viene rimandato al modello per comparire nel Hub.

## Categoria ≠ tipo di documento

`document_type` dice **che cosa è** un documento (un sollecito, una decisione,
una fattura). La categoria dice **dove sta** nell'organizzazione dell'azienda.
Un sollecito dell'AFC è di tipo «sollecito» e di categoria «imposte»: chi lo
cerca fra sei mesi lo cerca fra le imposte.

Le dodici categorie: `administration`, `taxes`, `social_insurance`, `invoices`,
`contracts`, `insurance`, `banking`, `employees`, `clients`, `suppliers`,
`subsidies`, `other`. Nel database si salva **la chiave tecnica**, mai
l'etichetta tradotta.

`social_insurance` è una categoria a sé e non sta dentro «assicurazioni» né
dentro «personale»: in Svizzera AVS/AI/IPG, LPP e LAINF sono il flusso
amministrativo più regolare di una PMI e arrivano da enti diversi dalle
assicurazioni private.

### La classificazione è deterministica, e si ferma dove non sa

Nessuna chiamata AI: il documento è già stato analizzato, e dalla sua analisi si
ricava la categoria **quando il segnale è forte**. La regola vive in SQL
(`document_category_from_analysis`) e scatta da un trigger quando nasce
un'analisi.

| Segnale | Categoria |
|---|---|
| tipo `tax_document` | imposte |
| tipo `social_insurance` | assicurazioni sociali |
| tipo `employment` | personale |
| tipo `contract_related` | contratti |
| tipo `invoice` | fatture |
| tipo `permit` · `official_decision` · `inspection_notice` | amministrazione |
| tipo `payment_request`/`reminder` **da un privato** | fatture |
| ente `social_insurance` · `pension` | assicurazioni sociali |
| ente `insurance` | assicurazioni |
| ente `federal` · `cantonal` · `municipal` | amministrazione |
| tutto il resto | **nessuna categoria** |

Deliberatamente non classificati: `declaration_request`,
`request_for_documents`, `information`. Una dichiarazione da presentare può
essere fiscale, sociale o statistica; una richiesta di documenti può venire da
chiunque. **Assegnare «altro» per non lasciare un vuoto sarebbe inventare una
certezza**: senza categoria il documento compare fra quelli «da classificare»,
che è la verità e per di più è azionabile.

`NULL` (nessuno ha classificato) e `other` (una persona ha scelto «altro») sono
due cose diverse e restano distinte.

### La scelta di una persona non si tocca

Cambiando categoria a mano, `category_source` diventa `manual` con il nome di
chi ha scelto — lo scrive un trigger, non il browser. Da quel momento **nessuna
rianalisi la sovrascrive**.

Il trigger distingue una persona dal sistema con due segnali non falsificabili
da un browser: `pg_trigger_depth() > 1` (l'aggiornamento arriva dalla regola
automatica) oppure `auth.uid() is null` (service role o migrazione). Un client
non può dichiarare «automatico» ciò che ha scelto lui, ed è verificato dal test.

## Ricerca

Una sola funzione, `list_documents`, fa filtri, ricerca, ordinamento,
paginazione e composizione delle relazioni.

**Sui metadati** (a sottostringa, indice trigram): titolo, nome del file
originale, mittente, oggetto, destinatario, tipo di documento, numeri di
riferimento, valori corretti a mano, nomi delle etichette.

**Nel testo** (full-text, indice GIN su `document_extractions.search_tsv`).

### Perché la configurazione `simple`

I documenti di una PMI svizzera arrivano in italiano, tedesco e francese, spesso
nella stessa settimana. Una configurazione con radici (`italian`, `german`…)
migliora una lingua e **peggiora le altre due**, perché applica a tutti i testi
le regole di una sola.

**Il prezzo, dichiarato:** cercando `Rechnung` non si trovano i documenti che
dicono `Rechnungen`. La ricerca sui metadati resta a sottostringa, quindi in
titolo, mittente e oggetto `Rechnung` trova comunque `Rechnungen`.

**Secondo limite dichiarato:** l'indice copre i primi **500'000 caratteri** del
testo estratto (circa 250 pagine). Non è un arrotondamento: un `tsvector` non
può superare 1 MB e una colonna generata che solleva un'eccezione farebbe
fallire il salvataggio dell'estrazione, cioè spegnerebbe l'analisi dei documenti
molto lunghi.

### Isolamento fra aziende

Tre strati, non uno:

1. la funzione è **`security invoker`**: la RLS di ogni tabella continua ad
   applicarsi riga per riga;
2. filtro esplicito `d.company_id = p_company_id`;
3. `is_company_member(p_company_id)` come sottointerrogazione scalare.

Il test lo verifica nel modo più diretto possibile: una parola rara
(`ALPHATESTSECRET`) scritta nel testo di **un solo documento di una sola
azienda**, cercata dall'altra azienda. Zero risultati, anche chiedendo
esplicitamente `p_company_id` dell'altra impresa.

I caratteri jolly digitati da una persona cercano sé stessi: un `%` in una
ricerca è un per cento, non «qualsiasi cosa». La ricerca è limitata a 120
caratteri, e una ricerca vuota **non è un errore**: è l'assenza di filtro.

### Estratti

Quando c'è una ricerca, la riga mostra un estratto del punto in cui la parola
compare. `ts_headline` marca i punti trovati con `[[` e `]]`; il browser
**spezza il testo e costruisce elementi**, non inserisce HTML. Nel Document Hub
non esiste markup proveniente da un documento — la stessa scelta fatta per il
corpo delle email.

L'estratto si calcola **solo sulle righe che si mostrano davvero**: sta nella
parte esterna della query, dopo il `limit`.

### Paginazione

A scorrimento (offset), non a cursore, e la scelta è motivata: la pagina mostra
«venticinque di duecentodiciotto», la barra laterale mostra i conteggi per
categoria e l'ordinamento cambia con un menu. Un cursore keyset — che
nell'Inbox è la scelta giusta, perché lì si scorre una sola lista sempre nello
stesso ordine — qui impedirebbe di dire quanti sono.

L'ordinamento porta **sempre `id` come ultimo criterio**: senza, due documenti
creati nello stesso istante potrebbero scambiarsi di posto fra una pagina e
l'altra, e uno dei due non comparirebbe mai. L'ordine della query esterna
ripete espressione per espressione quello della selezione.

### Nessun N+1

Venticinque righe = **una** interrogazione. Etichette, attività collegate,
comunicazioni di provenienza e correzioni arrivano da `lateral` che lavorano
sulle sole righe restituite. La funzione non restituisce mai il testo estratto,
il JSON dell'analisi o il corpo di un'email.

## Provenienza

| Origine | Cosa mostra il dettaglio |
|---|---|
| `upload` | chi l'ha caricato e quando |
| `email` | oggetto, mittente, data, casella, e **«Apri comunicazione»** |
| `pasted_text` | testo incollato, con la data |

Le comunicazioni sono al **plurale**: lo stesso documento può essere allegato a
più email — è quello che succede quando la deduplicazione per contenuto
riconosce un PDF già presente. Si riusa `email_message_documents`, che esiste
dalla 0013; non è stata creata nessuna seconda relazione.

Documenti con lo **stesso contenuto** (stesso `file_hash`) vengono segnalati
come *stessa risorsa*, non come «documenti collegati». La ricerca è per azienda:
sapere che un'altra impresa possiede lo stesso file non è deducibile in nessun
modo.

## Archiviare, e solo in fondo cancellare

**Archiviare** toglie un documento dalle viste correnti e non perde niente:
analisi, testo estratto, correzioni, email di provenienza e attività restano.
`archived_at`/`archived_by` li scrive il database da `auth.uid()` e `now()`.
L'indirizzo diretto di un documento archiviato continua a funzionare —
altrimenti «archivia» sarebbe indistinguibile da «fai sparire».

**Cancellare per sempre** sta in fondo al dettaglio, in una sezione separata,
con conferma esplicita e con l'elenco di ciò che si porta via *verificato contro
lo schema*, non dichiarato: file, testo estratto, analisi, correzioni,
collegamenti alle etichette e alle comunicazioni. Le **attività collegate
restano**, con `document_id` a null.

Chi può: chi amministra l'azienda (owner/admin), oppure chi ha caricato
personalmente quel documento — che copre anche il caso in cui l'upload del file
fallisce e il servizio deve rimuovere il record appena creato. I documenti
arrivati dalla posta hanno `uploaded_by` nullo, quindi restano agli
amministratori.

### Storage e database non sono atomici, e non si finge che lo siano

Una transazione che comprenda Postgres e Supabase Storage non esiste. Quello che
si può scegliere è l'**ordine**, cioè quale metà del guasto si è disposti ad
avere:

* **Storage prima** (com'era): se poi il database fallisce resta un documento
  *visibile* il cui file non c'è più. «Apri originale» non trova niente:
  l'applicazione dice una cosa falsa.
* **Database prima** (adesso): se poi Storage fallisce resta un file non
  referenziato da nessuno. Nessuno lo vede, nessuna schermata mente.

Fra un'informazione sbagliata e dello spazio sprecato si sceglie lo spazio. E se
la seconda metà fallisce **lo si dice** a chi ha cancellato, invece di riportare
un successo pieno.

## Etichette

Categoria e etichette rispondono a domande diverse: la categoria è una sola e
dice dove sta il documento, le etichette sono molte e dicono a cosa si
riferisce (`IVA`, `2026`, `Sede Lugano`, `Veicoli`).

Nessun albero di cartelle: una gerarchia costringe a scegliere un solo ramo e
produce lavoro amministrativo invece di ridurlo.

* nome unico per azienda **senza distinzione di maiuscole** (indice unico su
  `lower(btrim(name))`): «IVA» e «Iva» sono la stessa etichetta;
* massimo 40 caratteri, massimo 20 etichette per documento (trigger);
* un trigger verifica che **documento, etichetta e azienda dichiarata**
  coincidano: la sola RLS lascerebbe passare il caso obliquo di chi dichiara la
  propria azienda e aggancia l'etichetta a un documento altrui;
* cancellare un'etichetta la toglie da tutti i documenti, quindi è riservata
  agli amministratori.

## Azioni di gruppo: tutte o nessuna

Categoria, etichetta e archiviazione si possono applicare a più documenti. Le
tre funzioni passano da `documents_assert_all_mine`, che **confronta il
conteggio prima di scrivere**: se anche un solo documento non appartiene
all'azienda, non si scrive niente e si dice perché.

La RLS impedirebbe comunque di toccare il documento altrui, ma il risultato
sarebbe «fatto» su quattro righe su cinque, senza che nessuno sappia quale è
rimasta indietro. Massimo duecento documenti per volta.

## Integrazioni

| Modulo | Dal Hub | Verso il Hub |
|---|---|---|
| **AI Inbox** | «Apri comunicazione» → `/inbox?msg=…` | «Documenti prodotti» → `/documenti/:id`, con corpo/allegato e stato |
| **Admin AI** | «Apri analisi completa» → `/admin?doc=…` | l'analisi alimenta valori e categoria |
| **Attività** | «Crea attività» / «Apri attività» | `tasks.document_id` → sezione Attività |
| **Panoramica** | solo i documenti che richiedono attenzione | — |

La conversione documento → attività e la rianalisi vivono in **un solo posto**
(`features/tasks/taskFromDocument.ts` e `features/admin-ai/analyzeStored.ts`),
usato sia da Admin AI sia dal Hub: due copie della stessa regola col tempo
divergono, e a divergere sarebbe proprio la parte che decide cosa **non**
copiare.

⚠️ **Azioni dell'analisi e attività non sono la stessa cosa.** Dopo la
conversione non esiste un collegamento fra le due liste (è una derivazione una
tantum). Per questo l'avviso «N azioni non ancora diventate attività» compare
**solo quando non è nata nessuna attività** da quel documento: è l'unico caso in
cui la deduzione è certa. Il resto sarebbe una deduzione fragile.

## Il percorso «documento → attività» (2026-07-31)

Il dettaglio mostrava tutto ciò che si sa e non diceva mai che cosa restasse da
fare. Ora, sotto l'intestazione e l'origine, c'è **«Prossimo passo»**: un
riquadro compatto che legge soltanto dati già presenti e mette in primo piano
**una** azione.

| Situazione | Azione primaria | Creare un'attività |
|---|---|---|
| nessuna analisi | Analizza | possibile, con l'avvertenza che nascerà senza scadenza e senza passaggi |
| analisi in elaborazione | *nessuna: si aspetta* | **impedito** |
| analisi fallita | Riprova analisi | possibile |
| analisi da verificare | Verifica analisi | possibile, con avvertenza esplicita |
| analisi utilizzabile, nessuna attività | Crea attività | — |
| una o più attività | Apri attività / Vedi attività | secondaria: «Crea un'altra attività» |

⚠️ **Un solo caso impedisce la creazione**: mentre l'analisi lavora. Non è una
restrizione di comodo — in quell'istante l'attività nascerebbe senza la scadenza
e senza i passaggi che stanno per arrivare, cioè un dato incompleto prodotto da
un'attesa.

⚠️ **Più attività su uno stesso documento restano legittime** (§40). Non esiste
nessun vincolo che lo impedisca, né nel database né nell'interfaccia: quando
un'attività esiste già, «crearne un'altra» smette solo di essere l'azione
primaria. Nascondere quella possibilità avrebbe risolto un problema di
distrazione creandone uno di verità.

### La revisione prima di creare

Premendo «Crea attività» compare il **modulo condiviso** (`TaskCreateForm`,
lo stesso dell'elenco Attività, §17) con i valori derivati dai dati **effettivi**
— correzioni umane comprese. I valori iniziali NON sono ricostruiti dalla
schermata: li calcola `documentTaskDraft`, la stessa funzione che poi scrive.
Due derivazioni della stessa cosa prima o poi mostrano una priorità e ne salvano
un'altra.

Le avvertenze del riquadro sono ripetute accanto ai campi: chi apre il modulo
dal fondo della pagina non ha necessariamente letto quello in cima.

### La protezione dal doppio invio, e il rischio che resta

⚠️ **Il pulsante disabilitato NON basta, ed è stato misurato**: `saving` è uno
stato React, due clic nello stesso tick lo leggono entrambi a `false`. Il
2026-07-31, provando nel browser, due clic hanno creato **due attività
identiche a 14 millisecondi di distanza** sul database vero. La difesa che
regge è `createSubmitLatch`, una variabile che cambia nell'istante del primo
clic; il modulo si chiude dopo un successo, quindi da una apertura nasce al
massimo un'attività.

⚠️ **Rischio residuo dichiarato**: due schede aperte, oppure un invio il cui
esito si perde in rete e viene ritentato dal browser, possono ancora produrre un
duplicato. È **visibile** (due righe nell'elenco) e si cancella. Chiuderlo
davvero richiederebbe una chiave di idempotenza lato database, cioè una
migrazione: non è stata introdotta, e il servizio non ne ha già una da riusare.

### Dopo la creazione

L'esito resta a schermo con il collegamento all'attività appena creata, e
l'elenco si aggiorna: cercare in «Attività» una cosa fatta un istante fa è
lavoro in più. Se i passaggi della checklist non si sono potuti aggiungere,
**non si dichiara un successo pieno** (`stepsFailed`): l'attività esiste, è
raggiungibile, e la mancanza dei passaggi è un fatto che viene detto.

## Test

```
npm run test:documents-unit   107 · offline: stati, argomenti, estratti, indirizzo, etichette,
                                    «Prossimo passo» (sez. 8) e la scrittura dell'attività (sez. 9)
npm run test:documents              su DB reale: richiede la 0017 applicata
```

Il test sul database prova le garanzie, non il codice: isolamento della ricerca,
classificazione che si ferma dove non sa, scelta manuale che non viene
sovrascritta, correzioni rispettate senza toccare l'analisi, etichette che non
attraversano le aziende, archiviazione che non perde niente, cancellazione
riservata, azioni di gruppo che non lavorano a metà.

## Cosa NON è stato implementato

Per scelta, e dichiarato:

* nessun **embedding**, nessun database vettoriale, nessun RAG. La ricerca
  esatta e full-text è più economica, verificabile e veloce; il recupero
  semantico arriverà quando avrà un obiettivo concreto;
* nessuna **anagrafica** clienti/fornitori: la controparte è il mittente
  (corretto se qualcuno l'ha corretto). Il CRM è un altro passo;
* nessuna funzione di **contratti** (rinnovi, preavvisi, clausole) né di
  **fatture** (pagato/non pagato, contabilità): le categorie omonime servono
  solo a organizzare;
* nessun **filtro per importo**, che appartiene al modulo finanziario;
* nessun **albero di cartelle**;
* nessuna relazione semantica fra documenti: solo l'identità di contenuto per
  hash, che è un fatto e non un'inferenza;
* nessuna **cancellazione di gruppo**: cancellare è raro e si fa uno alla volta,
  guardando cosa si sta cancellando.

## Limiti noti

* **Ricerca full-text senza radici** (vedi sopra): `Rechnung` non trova
  `Rechnungen` nel corpo del testo.
* **Indice sui primi 500'000 caratteri** del testo estratto.
* La **Dashboard** continua a leggere tutte le analisi dell'azienda: è una
  pagina di statistiche e i suoi grafici, per dire il vero, devono contarle
  tutte. Troncare renderebbe i numeri sbagliati invece che lenti. La Panoramica
  invece non le carica più.
* Il filtro per **etichetta** accetta una etichetta alla volta nell'interfaccia,
  benché la funzione del database ne accetti più di una.
