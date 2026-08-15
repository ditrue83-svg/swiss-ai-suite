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

// ---------------------------------------------------------------------------
// L'ETICHETTA MOSTRABILE (§6, 2026-08-15)
//
// ⚠️ PERCHÉ ESISTE, quattro giorni dopo il resto di questo file. La regola qui
// sopra era scritta, provata e usata in UN posto solo: la pagina di
// caricamento, cioè il momento in cui un titolo NASCE. Ogni schermata che lo
// LEGGE — Panoramica, elenco, dettaglio, stampa — mostrava `documents.title`
// grezzo. Il documento «2.5» era ancora lì, e il 2026-08-15 era la PRIMA RIGA
// della Panoramica, sotto «Ecco cosa richiede attenzione nella tua azienda».
//
// Una regola applicata solo dove il dato entra non protegge i dati già
// entrati. Questa vale in lettura, e non tocca il database: `documents.title`
// resta esattamente com'è: cambia che cosa si mostra.
//
// LA DECISIONE È IN DUE PEZZI, e la separazione non è formale:
//   · `titoloMostrabile` dice se il titolo si può mostrare;
//   · `etichettaDocumento` dice CHE COSA mostrare al suo posto, e restituisce
//     un ESITO STRUTTURATO — non una frase. La frase la compone chi ha i
//     dizionari, altrimenti sarebbe italiana dentro un prodotto trilingue.
// ---------------------------------------------------------------------------

/**
 * Un titolo si può mostrare?
 *
 * Le condizioni sono quattro e sono TUTTE quelle che ci sono: nessuna euristica
 * in più. Un titolo dubbio che non ricade qui si mostra — il rischio di
 * nascondere un titolo vero è peggio di quello di mostrarne uno brutto.
 *
 * ⚠️ «Contiene almeno una lettera» usa `\p{L}`, non `[a-z]`: un titolo in
 * cirillico o in greco è un titolo, e un controllo sull'alfabeto latino lo
 * avrebbe dichiarato illeggibile.
 */
export function titoloMostrabile(
  titolo: string | null | undefined,
  nomeFile?: string | null,
): boolean {
  const t = (titolo ?? '').trim();
  if (!t) return false;
  if (t.length < 3) return false;
  if (!/\p{L}/u.test(t)) return false;

  // ⚠️ LA QUARTA CONDIZIONE, che è quella che ha prodotto «2.5». Un titolo che
  // COINCIDE con il nome del file senza estensione non è un titolo: è il nome
  // del file travestito. Vale però solo quando quel nome a sua volta non è
  // mostrabile — `Disdetta locazione.pdf` dà un titolo perfetto, e rifiutarlo
  // perché somiglia al file sarebbe zelo.
  const base = senzaEstensione((nomeFile ?? '').trim()).trim();
  if (base && t.toLocaleLowerCase() === base.toLocaleLowerCase()) {
    return base.length >= 3 && /\p{L}/u.test(base);
  }
  return true;
}

/**
 * Che cosa mostrare al posto di un titolo che non si può mostrare.
 *
 * ⚠️ È un ESITO, non un testo: `mittente` e `tipo` sono valori grezzi, e
 * l'etichetta tradotta la compone `documentLabel` (i18n/documentLabel.ts).
 */
export type EtichettaDocumento =
  /** Il titolo è mostrabile: si mostra quello, e non c'è niente da dichiarare. */
  | { origine: 'titolo'; titolo: string }
  | { origine: 'mittente_e_tipo'; mittente: string; tipo: string }
  | { origine: 'tipo'; tipo: string }
  /** Non sappiamo nemmeno di che tipo di documento si tratti. */
  | { origine: 'nessuno' };

export interface IngressoEtichetta {
  titolo?: string | null;
  nomeFile?: string | null;
  mittente?: string | null;
  /** Una persona ha corretto il mittente: allora è certo, qualunque cosa dica l'analisi. */
  mittenteCorretto?: boolean;
  /** La confidenza complessiva dell'analisi: `alta` | `media` | `bassa` | null. */
  confidenza?: string | null;
  tipoDocumento?: string | null;
}

/**
 * ⚠️ IL MITTENTE SI USA SOLO SE È CERTO. «Mai comporre da dati incerti»: un
 * nome di ente sbagliato incollato davanti al tipo produce un'etichetta che
 * SEMBRA precisa e non lo è — che è esattamente il difetto di «2.5», una
 * casella in più.
 *
 * Certo significa: l'ha corretto una persona, OPPURE l'analisi non si è
 * dichiarata a bassa confidenza. ⚠️ Una confidenza ASSENTE non vale «alta»:
 * non aver guardato non è aver visto, e in quel caso si scende di livello.
 */
function mittenteUtilizzabile(i: IngressoEtichetta): string | null {
  const m = (i.mittente ?? '').trim();
  if (!m) return null;
  if (i.mittenteCorretto === true) return m;
  const c = (i.confidenza ?? '').trim();
  if (!c || c === 'bassa') return null;
  return m;
}

export function etichettaDocumento(i: IngressoEtichetta): EtichettaDocumento {
  const titolo = (i.titolo ?? '').trim();
  if (titoloMostrabile(titolo, i.nomeFile)) return { origine: 'titolo', titolo };

  const tipo = (i.tipoDocumento ?? '').trim();
  const mittente = mittenteUtilizzabile(i);
  if (mittente && tipo) return { origine: 'mittente_e_tipo', mittente, tipo };
  if (tipo) return { origine: 'tipo', tipo };
  // ⚠️ Il mittente DA SOLO non è un'etichetta: «Comune di Lugano» come nome di
  // un documento fa credere che il documento sia il Comune. I livelli sono
  // quelli del §6 e sono tre.
  return { origine: 'nessuno' };
}

/** L'etichetta è stata composta da noi, e va dichiarato a chi legge. */
export function etichettaComposta(e: EtichettaDocumento): boolean {
  return e.origine !== 'titolo';
}

/**
 * L'ultima analisi VALIDA fra quelle incorporate.
 *
 * ⚠️ È la stessa regola del ramo `good` di `list_documents` e di
 * `analysisService.getForDocument`: l'ultima riga che non sia `failed`. Sta qui
 * perché non tutte le letture possono ordinare e limitare la risorsa
 * incorporata — l'incorporamento a due livelli dell'Inbox no — e allora la
 * selezione la fa questa funzione. Un posto solo: tre implementazioni della
 * stessa scelta darebbero tre mittenti diversi per lo stesso documento.
 */
function ultimaAnalisiValida(righe: unknown): Record<string, unknown> | null {
  if (!Array.isArray(righe)) return null;
  const valide = (righe as Record<string, unknown>[])
    .filter((a) => a && a.analysis_status !== 'failed');
  if (!valide.length) return null;
  // Senza `created_at` (letture che non lo chiedono) l'ordine è quello ricevuto,
  // che è già quello dell'interrogazione: non si inventa un ordinamento.
  return valide.reduce((piuRecente, a) => {
    const x = typeof a.created_at === 'string' ? a.created_at : '';
    const y = typeof piuRecente.created_at === 'string' ? piuRecente.created_at : '';
    return x > y ? a : piuRecente;
  });
}

/**
 * L'adattatore per le righe `documents` con l'ultima analisi INCORPORATA
 * (`document_analyses(...)` con ordinamento e limite): la forma che leggono
 * contratti e CRM, che al Document Hub non passano.
 *
 * ⚠️ Esiste perché la stessa conversione scritta in due servizi diverge: uno dei
 * due si dimenticherebbe il mittente, o la confidenza, e due schermate
 * chiamerebbero lo stesso documento in due modi. `sender_corrected` qui non
 * c'è — quelle letture non portano le correzioni — quindi un mittente vale solo
 * per la confidenza dell'analisi, che è la condizione più severa delle due.
 */
export function etichettaDaRigaDocumento(row: Record<string, unknown> | null | undefined): EtichettaDocumento {
  const analisi = ultimaAnalisiValida(row?.document_analyses);
  return etichettaDocumento({
    titolo: (row?.title as string | null) ?? null,
    nomeFile: (row?.original_filename as string | null) ?? null,
    mittente: (analisi?.sender as string | null) ?? null,
    confidenza: (analisi?.confidence as string | null) ?? null,
    tipoDocumento: (analisi?.document_type as string | null) ?? null,
  });
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
