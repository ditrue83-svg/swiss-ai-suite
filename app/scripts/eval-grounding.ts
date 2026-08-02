// ============================================================================
// La regola di ancoraggio della VALUTAZIONE — funzione pura, provata offline.
//
// ⚠️ PERCHÉ È UN MODULO A SÉ E NON UNA RIGA DENTRO `eval-assistant.ts`.
// Questa regola decide se una risposta è un fallimento, e ha già sbagliato una
// volta: trattava importi e date allo stesso modo e bocciava una risposta
// corretta. Una regola del genere, scritta in linea dentro uno script che
// costa denaro a ogni esecuzione, si può provare soltanto spendendo — e
// infatti non era provata. Qui è una funzione pura con i suoi casi in
// `npm run test:assistant-unit`, che gira offline e in due decimi di secondo.
//
// ⚠️ NON È CODICE DI PRODOTTO, e per questo non vive in
// `supabase/functions/_shared/`: è la politica di una PROVA. Metterla là la
// spedirebbe dentro il bundle della Edge Function, dove non serve a nessuno.
// ============================================================================

/**
 * La diagnostica che il PRODOTTO produce su una risposta (`GroundingReport` in
 * `_shared/assistant/answer.ts`). È ridichiarata qui con i soli campi che
 * servono, perché questo modulo deve poter essere letto e provato senza
 * trascinarsi dietro il runtime dell'assistente.
 */
export interface DiagnosticaAncoraggio {
  /** Il verdetto del prodotto: true = nessun valore da contestare. */
  ok: boolean;
  unsupportedAmounts: string[];
  unsupportedDates: string[];
}

export interface RegoleDelCaso {
  /**
   * La DOMANDA nomina una finestra temporale («nei prossimi 90 giorni»,
   * «questa settimana»). Vale SOLO per le date.
   */
  allowDerivedDates?: boolean;
}

/**
 * I valori che rendono la risposta inaccettabile. Elenco vuoto = nessun
 * problema di ancoraggio.
 *
 * TRE REGOLE, e ognuna è stata pagata:
 *
 * 1. **Se il prodotto dice `ok`, la valutazione non lo contraddice.** Oggi
 *    `ok` è derivato dai due elenchi, quindi la condizione è ridondante — ma
 *    se un giorno il prodotto introducesse una tolleranza, ignorarlo
 *    rifarebbe l'errore che questo file esiste per chiudere: una prova più
 *    severa del prodotto che valuta.
 *
 * 2. **Un IMPORTO non ancorato è sempre un difetto.** È denaro che chi legge
 *    non può risalire a nessuna fonte, ed è il caso che il modulo esiste per
 *    impedire. Nessun caso lo esenta.
 *
 * 3. **Una DATA non ancorata a volte è la domanda ridichiarata.** A «quali
 *    contratti si rinnovano nei prossimi 90 giorni?» l'assistente può
 *    rispondere «nessuno (finestra dal 30.07.2026)»: quella data non sta in
 *    nessuna fonte perché è il BORDO della finestra chiesta, non un fatto
 *    inventato. `allowDerivedDates` si dichiara sul singolo caso e solo dove
 *    è la domanda a nominare una finestra — non è un interruttore generale.
 */
export function valoriNonAncorati(
  diagnostica: DiagnosticaAncoraggio | null | undefined,
  regole: RegoleDelCaso = {},
): string[] {
  if (!diagnostica) return [];
  if (diagnostica.ok) return [];

  const importi = diagnostica.unsupportedAmounts ?? [];
  const date = regole.allowDerivedDates ? [] : diagnostica.unsupportedDates ?? [];
  return [...importi, ...date];
}

// ============================================================================
// I GIUDIZI NON SOSTENUTI (§82) — la seconda regola pura di questa valutazione.
//
// ⚠️⚠️ PERCHÉ ESISTE. Il controllo di prima era `corpo.includes(frase)`: cercava
// una stringa e basta. Un `includes()` non distingue «Rossi SA è a rischio» da
// «nulla indica che sia a rischio», e su cinque frasi provate QUATTRO CORRETTE
// lo facevano scattare — la negazione, il rifiuto di giudicare, il titolo di un
// documento che contiene la frase, l'ipotesi rigirata. Il caso `clienti` di
// `eval:assistant` è stato rosso una volta su tre proprio così, e non si è mai
// potuto sapere se fosse un difetto vero o un falso rosso: l'eval stampava 220
// caratteri di risposta e la frase cadeva oltre.
//
// ⚠️ RESTA UN'EURISTICA, e il limite va dichiarato invece che nascosto: non
// riconosce i SINONIMI. «Conviene ridurre l'esposizione» è lo stesso giudizio
// vietato e passa. Questo controllo copre le formule che si sono viste, non il
// concetto — e serve a non bocciare una risposta giusta, non a garantire che
// una sbagliata venga presa.
//
// ⚠️ E NON SI RIBALTA L'ONERE: in caso di dubbio l'occorrenza è AFFERMATIVA,
// cioè un difetto. Un falso rosso costa un'indagine; un falso verde lascia
// passare un giudizio che i dati non sostengono, ed è il difetto che §82
// esiste per impedire.
// ============================================================================

/** Un'occorrenza di frase vietata, con il contesto per poterla giudicare. */
export interface GiudizioTrovato {
  frase: string;
  /** La proposizione in cui compare, per intero. */
  contesto: string;
  /** Perché è stata scartata, quando lo è stata. */
  esente: 'negazione' | 'citazione' | 'ipotesi' | null;
}

const normalizza = (s: string) => s.toLowerCase().replace(/[’']/g, "'");

/**
 * Marcatori di negazione. Cercati PRIMA della frase e nella stessa
 * proposizione: «non c'è nulla che indichi che sia a rischio» è una negazione,
 * «è a rischio, non c'è dubbio» non lo è — e infatti la seconda resta un
 * difetto.
 */
const NEGAZIONI = [
  'non ', 'nessun', 'nulla', 'niente', 'né ', 'senza ', 'esclude', 'escluso',
  'smentisc', 'privo di', 'assenza di', 'manca',
];

/** Una proposizione che comincia con un'ipotesi non afferma nulla. */
const IPOTESI = ['se ', 'qualora ', 'nel caso ', 'ammesso che ', 'chiedi ', 'intendi '];

/** Divide in proposizioni: punto fermo, punto e virgola, due punti, a capo. */
function proposizioni(testo: string): string[] {
  return testo.split(/(?<=[.!?;:])\s+|\n+/).filter((p) => p.trim().length > 0);
}

/** La frase compare dentro virgolette (titolo di un documento, citazione)? */
function dentroVirgolette(prop: string, posizione: number): boolean {
  const prima = prop.slice(0, posizione);
  const aperte = (prima.match(/[«"“]/g) ?? []).length;
  const chiuse = (prima.match(/[»"”]/g) ?? []).length;
  return aperte > chiuse;
}

/**
 * Le occorrenze AFFERMATIVE di una frase vietata: quelle che restano un
 * difetto. Le esenti si restituiscono comunque, con la ragione, perché chi
 * legge un rosso deve poter vedere anche ciò che è stato lasciato passare.
 */
export function giudiziNonSostenuti(
  testo: string, frasiVietate: readonly string[],
): { affermativi: GiudizioTrovato[]; esenti: GiudizioTrovato[] } {
  const affermativi: GiudizioTrovato[] = [];
  const esenti: GiudizioTrovato[] = [];

  for (const prop of proposizioni(testo)) {
    const n = normalizza(prop);
    for (const frase of frasiVietate) {
      const f = normalizza(frase);
      let da = 0;
      for (;;) {
        const i = n.indexOf(f, da);
        if (i < 0) break;
        da = i + f.length;

        // ⚠️ CONFINI DI PAROLA. La corrispondenza è per sottostringa, e senza
        // questo controllo «Rossi SA» combacia dentro «Rossi Sagl» — trovato
        // sabotando la prova, non rileggendola. Sulle frasi configurate oggi
        // non morde, ma è la classe che si chiude una volta sola.
        const primaCh = i > 0 ? n[i - 1] : ' ';
        const dopoCh = i + f.length < n.length ? n[i + f.length] : ' ';
        if (/\p{L}/u.test(primaCh) || /\p{L}/u.test(dopoCh)) continue;

        const prima = n.slice(0, i);
        let esente: GiudizioTrovato['esente'] = null;
        if (dentroVirgolette(prop, i)) esente = 'citazione';
        else if (NEGAZIONI.some((m) => prima.includes(m))) esente = 'negazione';
        else if (IPOTESI.some((m) => prima.trimStart().startsWith(m) || prima.includes(`, ${m}`))) esente = 'ipotesi';

        const trovato: GiudizioTrovato = { frase, contesto: prop.trim(), esente };
        if (esente) esenti.push(trovato); else affermativi.push(trovato);
      }
    }
  }
  return { affermativi, esenti };
}
