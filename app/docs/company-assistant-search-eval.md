# Ricerca documentale per l'assistente — la valutazione, e la decisione

> **Esito: la ricerca semantica NON viene implementata.** Il cancello di
> valutazione non è stato superato, e la ragione non è che sia difficile: è che
> **su questo corpus non è misurabile**. Questo documento esiste perché una
> decisione presa senza dati e una decisione presa con i dati si somigliano
> molto quando sono scritte in una riga sola.

Documento di riferimento del modulo: [`company-assistant.md`](company-assistant.md).

---

## 1. Perché questa valutazione esiste

Il requisito è esplicito: *«Il semantic search è utile ma NON deve essere
implementato ciecamente. Prima creare un benchmark interno multilingue»*, e
*«Non dichiarare ricerca semantica funzionante senza eval»*.

È la stessa disciplina che il prodotto applica già altrove: l'analisi
documentale scarta una citazione che non si ritrova nel testo invece di fidarsi
del modello; le Finanze rifiutano un valore per un campo che non era stato
richiesto. Una ricerca vettoriale non valutata sarebbe l'eccezione a una regola
che il prodotto ha pagato per imparare.

---

## 2. Che cosa c'è oggi

### 2.1 Estensioni realmente installate

Cercate con `create extension` in tutte le 28 migrazioni:

| Estensione | Migrazione | A che cosa serve |
|---|---|---|
| `pgcrypto` | `0001_core` | `gen_random_uuid()` |
| `pg_trgm` | `0013_inbox` | indici trigram per la ricerca a sottostringa |

**`vector` / `pgvector` non è installata.** Implementare la ricerca semantica
significherebbe quindi anche abilitare un'estensione sul database di produzione,
scegliere un modello di embedding, costruire una pipeline di indicizzazione
asincrona, idempotente e versionata, e gestire cancellazione e reindicizzazione.
Non è un lavoro che si giustifica con «potrebbe servire».

### 2.2 La ricerca full-text esistente

| Oggetto | Dettaglio |
|---|---|
| Colonna | `document_extractions.search_tsv`, `generated always as stored` |
| Configurazione | `to_tsvector('simple', left(coalesce(full_text,''), 500000))` |
| Indice | `idx_extractions_search` — GIN |
| Interrogazione | `plainto_tsquery('simple', q)` |
| Estratto | `ts_headline('simple', …, MaxWords=22, MinWords=8, MaxFragments=1)` |

Più due indici trigram, che coprono la ricerca a sottostringa dove il full-text
non arriva:

- `idx_documents_text_trgm` su `title || original_filename`;
- `idx_analyses_text_trgm` su `sender || subject || recipient`.

### 2.3 La limitazione, dichiarata

La configurazione `'simple'` è una **scelta deliberata** della `0017`: il
prodotto vive in tre lingue, e una configurazione linguistica sola avrebbe
funzionato bene per una e male per due. Il prezzo è che `'simple'` **non fa
stemming**:

| Cercando | Non trova | Perché |
|---|---|---|
| `Kündigungsfrist` | `Kündigungsfristen` | nessuna riduzione alla radice |
| `fattura` | `fatture` | idem |
| `résiliation` | `résiliations` | idem |

Sui campi coperti dai trigram (titolo, nome del file, mittente, oggetto) la
sottostringa funziona e il singolare trova il plurale. **Sul corpo del
documento no.**

---

## 3. Il corpus reale

Misurato sul database di produzione il **2026-07-30**, in sola lettura:

| Insieme | Righe |
|---|---:|
| `documents` | 18 |
| `document_extractions` | 18 |
| `document_analyses` | 18 |
| `contracts` | 1 |
| `finance_items` | 2 |
| `email_messages` | 120 |

Lingua rilevata dall'analisi, su tutte e 18 le righe:

| Lingua | Documenti |
|---|---:|
| italiano | 18 |
| tedesco | 0 |
| francese | 0 |

Lunghezza media del testo estratto: **1 674 caratteri**. Documenti troncati:
**0** (la soglia è 500 000 caratteri).

---

## 4. Il cancello di §44, voce per voce

| Condizione richiesta | Esito | Perché |
|---|---|---|
| Modello di embedding adatto a IT/DE/FR | **non valutabile** | Non c'è un corpus DE/FR su cui valutarlo. |
| Recall misurata | **non misurabile** | 18 documenti in una lingua sola. Con un corpus così, una query trova tutto o niente e la misura è dominata dal rumore. |
| Precisione accettabile | **non misurabile** | Idem. |
| Isolamento fra aziende verificato | non verificato | Richiederebbe la pipeline che non esiste. |
| Costi noti | non noti | Dipendono dal modello di embedding e dal volume, entrambi ignoti. |
| Reindicizzazione supportata | non implementata | — |
| Cancellazione supportata | non implementata | — |

**Zero condizioni su sette superate.** Il cancello non è superato, e nessuna
delle sette dipende dalla bravura di chi scrive il codice: dipendono tutte dal
fatto che il corpus non esiste ancora.

### La domanda che conta

Le domande di esempio del requisito (`contratto internet`,
`Kündigungsfrist Telekom`, `délai de résiliation assurance`, `documenti IVA`,
`fattura software`, `richiesta di documenti AFC`) su 18 documenti italiani
avrebbero prodotto, nel migliore dei casi, sei confronti fra tre metodi su
insiemi di zero o una riga. Un numero così non distingue un metodo migliore da
un metodo fortunato — e un numero che non distingue nulla, messo in un
documento, diventa la giustificazione di qualunque scelta successiva.

---

## 5. La decisione

**Strutturato + full-text.** L'assistente cerca nei documenti con
`search_documents`, che passa da `list_documents` e quindi:

- cerca su titolo, nome del file, mittente, oggetto, destinatario, tipo, numeri
  di riferimento, correzioni umane, etichette **e** sul testo completo;
- restituisce **valori effettivi**, con la correzione umana già applicata;
- rispetta la RLS, perché è `SECURITY INVOKER`.

E l'assistente **dichiara la limitazione** quando non trova: la risposta è
«non ho trovato», mai «non esiste» — che è la mitigazione onesta di una recall
imperfetta.

### Che cosa fa questa scelta al prodotto

La maggior parte delle domande vere di una PMI («quali fatture scadono», «quali
attività sono scadute», «quando si rinnova il contratto Swisscom», «da quale
email è arrivata questa fattura») **non sono domande di ricerca semantica**:
sono interrogazioni strutturate, e su quelle l'assistente è esatto per
costruzione. La ricerca semantica servirebbe alla classe di domande «trova quel
documento che parlava di…», che è reale ma minoritaria e che oggi il full-text
copre in modo imperfetto ma dichiarato.

---

## 6. Quando rifare questa valutazione

Il cancello va riaperto quando **tutte** e tre le condizioni sono vere:

1. il corpus supera **200 documenti**;
2. almeno **50** sono in tedesco o in francese;
3. esistono domande vere di utenti veri a cui il full-text non ha saputo
   rispondere — raccolte dal feedback «non utile → risposta incompleta» di
   `assistant_feedback`, che esiste apposta.

A quel punto il confronto da fare è a tre vie sullo stesso insieme di domande:

| Metodo | Che cosa misurare |
|---|---|
| full-text (`'simple'`) | recall@5, precisione@5 |
| semantico (embedding multilingue) | recall@5, precisione@5, costo per documento, costo per query |
| ibrido (rilevanza full-text + similarità + filtri strutturati + recency) | recall@5, precisione@5 |

Con la regola già scritta nel requisito, che vale la pena ripetere qui perché è
la parte che si dimentica: **il punteggio del coseno non è la verità.** Un
ibrido che non usi anche la rilevanza testuale e i filtri strutturali è una
ricerca semantica travestita.

E la condizione preliminare, senza la quale il confronto non si fa: la ricerca
vettoriale deve applicare l'autorizzazione **dentro la query**, non filtrando in
JavaScript i risultati di una ricerca globale. Un `company_id` filtrato dopo il
recupero è una fuga di dati con un `filter()` davanti.
