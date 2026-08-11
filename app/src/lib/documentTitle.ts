// ============================================================================
// Il titolo di un documento — e la dichiarazione di non saperlo.
//
// ⚠️⚠️ PERCHÉ ESISTE, e la data conta. Il 2026-08-11 nel Document Hub c'era un
// documento intitolato **«2.5»**. Il file caricato si chiamava `2.5.pdf`, e il
// titolo veniva da `file.name.replace(/\.[^.]+$/, '')`: il nome del file meno
// l'estensione, senza chiedersi se quel nome dicesse qualcosa.
//
// L'analisi, dal canto suo, aveva risposto onestamente `subject: null` — non era
// riuscita a determinare l'oggetto. Le due cose insieme producevano la forma
// peggiore: **un fallimento presentato come un risultato**. Chi apriva l'elenco
// leggeva «2.5» e non aveva modo di sapere che nessuno era riuscito a dire di
// che documento si trattasse.
//
// LA REGOLA. Un titolo che non si sa non si inventa e non si prende in prestito
// dal primo numero disponibile: si DICHIARA. Il nome del file resta accanto,
// perché è l'unica cosa che permette di riconoscere il documento — ma smette di
// spacciarsi per il suo oggetto.
//
// ⚠️ Questa funzione NON scrive testo per l'utente: restituisce un ESITO, e la
// frase la compone chi ha i dizionari. Un testo scritto qui sarebbe italiano
// dentro un prodotto trilingue, e `i18n:coverage` lo boccerebbe — giustamente.
// ============================================================================

/** Da dove viene il titolo che si sta mostrando. */
export type OrigineTitolo =
  /** L'ha scritto una persona. Vince su tutto: nessuno sa meglio di lei. */
  | 'persona'
  /** L'oggetto determinato dall'analisi del documento. */
  | 'analisi'
  /** Il nome del file, che in questo caso dice qualcosa. */
  | 'nome_file'
  /** Nessuno dei tre: l'oggetto non è determinabile, e va detto. */
  | 'non_determinato';

export interface EsitoTitolo {
  /** Il testo da mostrare quando l'origine NON è `non_determinato`. */
  titolo: string;
  origine: OrigineTitolo;
  /**
   * Il nome del file, sempre presente quando c'è: serve a comporre la frase
   * «oggetto non determinato — 2.5.pdf», che identifica il documento senza
   * fingere di descriverlo.
   */
  nomeFile: string | null;
}

/** Toglie l'estensione, se c'è, senza mangiare i punti interni al nome. */
export function senzaEstensione(nomeFile: string): string {
  return nomeFile.replace(/\.[A-Za-z0-9]{1,8}$/, '');
}

/**
 * Il nome di questo file dice qualcosa sul suo contenuto?
 *
 * ⚠️ La domanda NON è «è un numero?». Sono nomi muti anche `IMG_4821`,
 * `Scan_2026-08-11`, `documento (3)`, `Nuovo documento`: hanno lettere, e non
 * dicono niente lo stesso. Il criterio è che restino LETTERE VERE dopo aver
 * tolto le convenzioni degli apparecchi e dei sistemi operativi.
 */
export function nomeFileInformativo(nomeFile: string | null | undefined): boolean {
  const base = senzaEstensione((nomeFile ?? '').trim());
  if (!base) return false;

  const residuo = base
    // ⚠️ PRIMA di tutto il resto: il trattino basso è un carattere di PAROLA per
    // le espressioni regolari, quindi in `IMG_4821` non esiste alcun confine fra
    // `IMG` e `_` e `\bimg\b` non trova niente. Senza questa riga i due nomi più
    // comuni al mondo — quelli di fotocamere e scanner — passavano per
    // informativi. Trovato dai due casi rossi qui sotto, non per ispezione.
    .replace(/_/g, ' ')
    // I prefissi che mettono le fotocamere, gli scanner e i telefoni.
    .replace(/\b(img|dsc|dscn|scan|scansione|scanned|foto|photo|image|doc|document|documento|dokument|file|datei|fichier|copia|copy|neu|nuovo|new|nouveau|senza nome|untitled|unbenannt|sans titre)\b/gi, ' ')
    // Date e ore in qualunque forma: dicono QUANDO, mai CHE COSA.
    .replace(/\b\d{4}[-_.]\d{2}[-_.]\d{2}\b|\b\d{2}[-_.]\d{2}[-_.]\d{2,4}\b|\b\d{1,2}[.:]\d{2}(?:[.:]\d{2})?\b/g, ' ')
    // Numeri, contatori fra parentesi, separatori.
    .replace(/\(\s*\d+\s*\)/g, ' ')
    .replace(/[\d\W_]+/g, ' ')
    .trim();

  // Due lettere non sono un oggetto: «ok», «cv» da soli non descrivono niente.
  return residuo.replace(/\s+/g, '').length >= 3;
}

export interface IngressoTitolo {
  /** Quello che ha scritto la persona nel campo, se l'ha scritto. */
  titoloScritto?: string | null;
  /** L'oggetto determinato dall'analisi, `null` se non determinabile. */
  oggettoAnalisi?: string | null;
  /** Il nome del file caricato. */
  nomeFile?: string | null;
}

/**
 * La precedenza è: **la persona, poi l'analisi, poi il nome del file — e se
 * nessuno dei tre dice niente, lo si dichiara.**
 *
 * L'analisi viene prima del nome del file perché è l'unica delle due che ha
 * LETTO il documento; il nome del file lo ha scelto chi lo ha salvato, magari
 * un apparecchio.
 */
export function titoloDocumento(input: IngressoTitolo): EsitoTitolo {
  const nomeFile = (input.nomeFile ?? '').trim() || null;

  const scritto = (input.titoloScritto ?? '').trim();
  if (scritto) return { titolo: scritto, origine: 'persona', nomeFile };

  const oggetto = (input.oggettoAnalisi ?? '').trim();
  if (oggetto) return { titolo: oggetto, origine: 'analisi', nomeFile };

  if (nomeFile && nomeFileInformativo(nomeFile)) {
    return { titolo: senzaEstensione(nomeFile), origine: 'nome_file', nomeFile };
  }

  // ⚠️ Il titolo resta il nome del file: è ciò che permette di riconoscere la
  // riga in elenco. Ma l'origine dice che NON è un oggetto, e chi mostra la
  // riga deve dirlo — è tutta la differenza fra «2.5» e «oggetto non
  // determinato — 2.5.pdf».
  return { titolo: nomeFile ?? '', origine: 'non_determinato', nomeFile };
}
