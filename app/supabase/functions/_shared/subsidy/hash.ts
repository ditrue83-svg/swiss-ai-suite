// ============================================================================
// L'IMPRONTA DEI CONTENUTI — SHA-256 su WebCrypto.
//
// ⚠️ DIVERSA DAL FINGERPRINT DELLE VALUTAZIONI, e la distinzione è di merito.
// Il fingerprint (`assess.ts`) dice «gli ingressi sono gli stessi»: gli basta
// essere deterministico e sincrono. Questa impronta dice «la fonte ufficiale
// non è cambiata», e da lei dipende se un cambiamento nei requisiti di un
// programma viene notato o no — quindi serve una funzione su cui una
// collisione non sia plausibile.
//
// WebCrypto è disponibile in Deno, in Node 20 e nel browser: nessuna
// dipendenza, nessun ramo per runtime.
// ============================================================================

/** SHA-256 esadecimale di una stringa. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 esadecimale di byte grezzi (per i PDF). */
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  // ⚠️ Si passa una COPIA compatta, non `bytes.buffer`: un Uint8Array può
  //    essere una finestra su un buffer più grande, e passare l'intero buffer
  //    produrrebbe l'impronta di byte che non abbiamo letto. `slice()` restituisce
  //    sempre un Uint8Array su un ArrayBuffer proprio, il che chiude anche il
  //    caso di un eventuale SharedArrayBuffer.
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * L'impronta di un contenuto NORMALIZZATO.
 *
 * ⚠️ Si normalizza PRIMA di calcolare, e non è un dettaglio: una pagina che
 * cambia soltanto negli spazi, nel numero di visite o in un timestamp di
 * generazione produrrebbe un'impronta nuova a ogni controllo, e ogni controllo
 * diventerebbe una voce da revisionare. Dopo tre giorni nessuno leggerebbe più
 * la coda delle revisioni — che è il modo in cui un controllo utile muore.
 */
export function normalizeForHash(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    // ⚠️ GLI SPAZI AI BORDI DI RIGA VANNO TOLTI PRIMA di comprimere gli a capo.
    //    Senza, una pagina ripubblicata con un'indentazione diversa — cioè un
    //    deploy del sito, non una modifica del testo — produce un'impronta
    //    nuova, e ogni deploy dell'autorità diventa una voce da revisionare.
    //    Il difetto è stato trovato da `test:subsidy-unit`, non rileggendo.
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
