// Estrazione SINTATTICA del JSON prodotto da un modello. Questo modulo non sa
// nulla del dominio: non conosce schemi, non conosce campi obbligatori, non
// decide se una risposta sia buona. Isola il primo oggetto JSON completo e lo
// consegna a `JSON.parse`. Chi lo chiama valida (Admin AI, Inbox, Incentivi,
// Contratti, Finanze hanno ciascuno il proprio validatore, e restano separati).
//
// ⚠️⚠️ IL COMMENTO DI QUESTO FILE HA DICHIARATO IL FALSO PER DUE MESI. Diceva
// «isola il primo oggetto { … } bilanciato» e il codice non bilanciava: prendeva
// la prima graffa e teneva TUTTO fino alla fine della stringa. Una risposta
// perfettamente valida come
//
//     Ecco il risultato:
//     {"status":"ok","items":[]}
//     Ho mantenuto i dati separati.
//
// finiva in `JSON.parse` insieme alla frase finale e falliva. Il difetto è
// emerso consolidando l'Inbox, e riguardava tutti i chiamanti del parser
// condiviso — non solo quello.
//
// ⚠️ NIENTE `eval`, niente `Function`, nessuna dipendenza esterna, nessuna
// riparazione creativa. Una virgola di troppo resta un errore; una chiave senza
// virgolette resta un errore. Un oggetto «aggiustato» è un oggetto di cui
// nessuno conosce più la provenienza.
//
// ⚠️ Importato sia da Deno (Edge Function) sia da Node/tsx (test ed
// evaluation): nessuna API del browser, nessun modulo Node.

/** Perché l'estrazione non è riuscita. Vocabolario INTERNO del parser. */
export type ModelJsonFailure =
  /** L'argomento non era una stringa. */
  | 'NOT_TEXT'
  /** Nessun oggetto JSON: nessuna graffa, oppure un array al posto di un oggetto. */
  | 'NO_OBJECT'
  /** Una graffa aperta che non si chiude, o una stringa JSON mai terminata. */
  | 'INCOMPLETE_OBJECT'
  /** L'oggetto è delimitato correttamente ma non è JSON valido. */
  | 'INVALID_JSON';

/**
 * L'errore del parser. Porta `code` come tutto il resto del repository, più
 * `failure` per chi vuole distinguere le quattro cause.
 *
 * ⚠️ §45 — il messaggio NON contiene la risposta del modello. Quel testo è il
 * documento, l'email o il contratto di un cliente: qui entrano solo la
 * categoria, la lunghezza e una posizione approssimativa.
 */
export interface ModelJsonError extends Error {
  code: 'MODEL_JSON_UNPARSABLE';
  failure: ModelJsonFailure;
  /** Lunghezza dell'output ricevuto. Utile a distinguere «vuoto» da «lungo». */
  outputLength: number;
  /** L'output conteneva un recinto markdown completo. */
  fenced: boolean;
  /** Offset approssimativo (nella regione esaminata) in cui ci si è fermati. */
  at: number | null;
}

function fail(
  failure: ModelJsonFailure,
  outputLength: number,
  fenced: boolean,
  at: number | null,
): never {
  // Il messaggio è per uno sviluppatore che legge un log, non per l'utente: i
  // moduli traducono nel proprio vocabolario (`INVALID_RESPONSE`,
  // `AI_INVALID_OUTPUT`, `AI_REFUSED`) prima che arrivi a schermo.
  const err = new Error(
    `${failure} (len=${outputLength}${fenced ? ', fenced' : ''}${at === null ? '' : `, at=${at}`})`,
  ) as ModelJsonError;
  err.name = 'ModelJsonError';
  err.code = 'MODEL_JSON_UNPARSABLE';
  err.failure = failure;
  err.outputLength = outputLength;
  err.fenced = fenced;
  err.at = at;
  throw err;
}

/** Un errore del parser, riconosciuto senza dipendere da `instanceof`. */
export function isModelJsonError(e: unknown): e is ModelJsonError {
  return e instanceof Error && (e as Partial<ModelJsonError>).code === 'MODEL_JSON_UNPARSABLE';
}

/**
 * Descrizione registrabile di un guasto di parsing. Da usare nei log al posto
 * della risposta: `[inbox] json non estraibile: NO_OBJECT len=412 fenced=false`.
 * Non contiene un solo carattere dell'output.
 */
export function describeModelJsonFailure(e: unknown): string {
  if (!isModelJsonError(e)) {
    const cause = e instanceof Error ? e : new Error(String(e));
    return `${cause.name} (non-parser)`;
  }
  return `${e.failure} len=${e.outputLength} fenced=${e.fenced}${e.at === null ? '' : ` at=${e.at}`}`;
}

/**
 * Il contenuto del PRIMO recinto markdown COMPLETO, oppure `null`.
 *
 * ⚠️ «Completo» vuol dire che esiste anche il delimitatore di chiusura. Un
 * recinto aperto e mai chiuso è quasi sempre una risposta troncata: non lo si
 * finge valido, si ignora il delimitatore e si esamina il testo grezzo, dove lo
 * scanner dirà da sé se l'oggetto è intero o mozzo.
 * ⚠️ I delimitatori NON entrano nel contenuto: era proprio questo a lasciare i
 * tre apici finali dentro il testo da interpretare quando lo `slice` partiva
 * dalla prima graffa.
 */
function firstFencedBlock(s: string): { body: string; offset: number } | null {
  const open = s.indexOf('```');
  if (open < 0) return null;
  // Dopo i tre apici può esserci un identificatore di linguaggio (`json`, `JSON`,
  // `js`…) fino a fine riga. Non si assume che sia `json`: un recinto senza
  // linguaggio è altrettanto comune.
  const nl = s.indexOf('\n', open + 3);
  const bodyStart = nl < 0 ? open + 3 : nl + 1;
  const close = s.indexOf('```', bodyStart);
  if (close < 0) return null; // recinto incompleto
  return { body: s.slice(bodyStart, close), offset: bodyStart };
}

/**
 * Lo scanner bilanciato. Lineare, deterministico, senza espressioni regolari.
 *
 * Stato mantenuto: posizione iniziale, profondità delle graffe, dentro/fuori
 * stringa, escape. Una `}` chiude l'oggetto SOLO se non si trova dentro una
 * stringa e la profondità torna a zero — è la riga che il vecchio codice non
 * aveva, ed è per questo che una graffa dentro `"testo con } dentro"` e una
 * frase dopo l'oggetto producevano lo stesso guasto.
 *
 * Ritorna gli estremi del primo oggetto completo, oppure la ragione del guasto.
 */
function scanFirstObject(
  region: string,
): { start: number; end: number } | { stopped: 'NO_OBJECT' | 'INCOMPLETE_OBJECT'; at: number } {
  const start = region.indexOf('{');
  if (start < 0) return { stopped: 'NO_OBJECT', at: region.length };

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < region.length; i++) {
    const ch = region[i];

    if (inString) {
      if (escaped) {
        // Un carattere qualsiasi dopo il backslash è consumato: è così che
        // `\"` non chiude la stringa e `\\` non fa da escape al carattere dopo.
        // Due backslash di fila si annullano e la virgoletta successiva chiude.
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') { inString = true; continue; }
    if (ch === '{') { depth++; continue; }
    if (ch === '}') {
      depth--;
      // Il testo che segue questa graffa NON entra in `JSON.parse`: è tutto
      // il difetto, in una riga.
      if (depth === 0) return { start, end: i };
      if (depth < 0) return { stopped: 'INCOMPLETE_OBJECT', at: i };
    }
    // Le graffe dentro gli array (`[{…}]`) sono coperte dalla profondità; le
    // parentesi quadre non hanno bisogno di uno stato proprio, perché un array
    // non può chiudere un oggetto.
  }

  // Fine della regione con la profondità ancora aperta, o dentro una stringa:
  // in entrambi i casi l'oggetto è mozzo. Distinguere «tagliato dal tetto di
  // token» da «il modello ha smesso» non tocca a questo modulo.
  return { stopped: 'INCOMPLETE_OBJECT', at: region.length };
}

/**
 * Estrae e interpreta il primo oggetto JSON completo contenuto nell'output di
 * un modello.
 *
 * TOLLERA: spazi esterni · testo prima dell'oggetto · testo dopo l'oggetto ·
 * recinti markdown con o senza linguaggio · oggetti annidati · array dentro
 * l'oggetto · graffe e virgolette dentro le stringhe · escape, backslash
 * multipli, newline ed Unicode · più oggetti (prende il primo).
 *
 * NON CORREGGE: virgole finali · chiavi senza virgolette · virgolette
 * sbagliate · campi mancanti. Non aggiunge nulla, non restituisce mai `{}` e
 * non trasforma un array in un oggetto.
 *
 * PIÙ OGGETTI: restituisce il primo oggetto COMPLETO e ignora i successivi; non
 * li fonde. Se quel primo oggetto è bilanciato ma sintatticamente invalido,
 * FALLISCE — non prova il secondo. Saltare in silenzio un oggetto rotto per
 * accettarne un altro significherebbe scegliere al posto del modello.
 *
 * RECINTO: se ne esiste uno completo, il suo contenuto ha la precedenza. Se
 * dentro il recinto non c'è alcun candidato (nessuna graffa, o un array) si
 * riparte dal testo grezzo; se invece un candidato c'è e non regge, l'errore è
 * quello — non si va a cercare altrove.
 *
 * @throws {ModelJsonError} con `failure` in NOT_TEXT · NO_OBJECT ·
 *         INCOMPLETE_OBJECT · INVALID_JSON. Il messaggio non contiene output.
 */
export function parseModelJson(text: string): unknown {
  if (typeof text !== 'string') fail('NOT_TEXT', 0, false, null);

  const whole = text.trim();
  const fence = firstFencedBlock(whole);
  const fenced = fence !== null;

  // Regioni in ordine di precedenza. Il recinto per primo, il testo grezzo
  // come riserva: quest'ultima si usa solo se nel recinto non c'era proprio
  // niente da esaminare.
  //
  // ⚠️ IL RECINTO BATTE UN OGGETTO NUDO CHE LO PRECEDE, e la ragione è che il
  // recinto è l'unico segnale ESPLICITO che il modello dà su dove sia la
  // risposta. «L'ingresso era {"a":1}; ecco l'esito: ```json{"b":2}```» è una
  // risposta in cui il primo oggetto è la citazione della domanda. Prendere il
  // primo oggetto in senso assoluto restituirebbe l'eco dell'input.
  const regions: string[] = fence ? [fence.body, whole] : [whole];

  let lastStop: 'NO_OBJECT' | 'INCOMPLETE_OBJECT' = 'NO_OBJECT';
  let lastAt = 0;

  for (let r = 0; r < regions.length; r++) {
    const region = regions[r].trim();

    // ⚠️ Un array in cima NON è un oggetto e non lo si fa diventare tale
    // restituendone il primo elemento: `[{"a":1}]` è una lista, e consegnare
    // `{"a":1}` a un validatore che aspetta un oggetto trasformerebbe «il
    // modello ha risposto con la forma sbagliata» in un dato plausibile.
    //
    // ⚠️ E NON SI RIPIEGA SUL TESTO GREZZO: un array DENTRO il recinto è la
    // risposta del modello, non un'assenza di risposta. Cercare altrove
    // troverebbe la prima graffa dell'array — cioè il suo primo elemento — e
    // sarebbe esattamente la trasformazione che questa riga vieta. (Difetto
    // trovato dal caso 31-bis, che la prima stesura di questo file ACCETTAVA.)
    if (region.startsWith('[')) fail('NO_OBJECT', whole.length, fenced, 0);

    const found = scanFirstObject(region);
    if ('stopped' in found) {
      lastStop = found.stopped;
      lastAt = found.at;
      // Un oggetto MOZZO è un esito, non un motivo per cercare altrove: se il
      // recinto conteneva una risposta troncata, la risposta è troncata.
      if (found.stopped === 'INCOMPLETE_OBJECT') break;
      continue;
    }

    const candidate = region.slice(found.start, found.end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Bilanciato ma non JSON: virgola finale, chiave nuda, virgolette
      // tipografiche. Resta invalido — non si ripara e non si cerca il
      // prossimo oggetto.
      fail('INVALID_JSON', whole.length, fenced, found.start);
    }
  }

  fail(lastStop, whole.length, fenced, lastAt);
}
