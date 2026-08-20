// ============================================================================
// I BLOCCHI DELLA PANORAMICA — decisi dai numeri, non dalla griglia.
//
// Il censimento del 2026-08-19 ha misurato la produzione vera: 19 documenti su
// 19 archiviati, 16 analisi non conclusive, zero termini dichiarati in tutto il
// database, una valutazione incentivi mai eseguita. Una Home disegnata per
// l'abbondanza sarebbe una griglia di zeri; questa risponde a tre domande:
// cosa il sistema sa, cosa non ha potuto concludere, cosa non ha mai provato
// a fare.
//
// LE REGOLE, ciascuna legata a un numero misurato:
//   · UN SOLO INSIEME: ogni conteggio copre TUTTI i documenti, archiviati
//     compresi, e il piè di pagina lo dichiara una volta. «Da verificare: 0»
//     (solo attivi) accanto ad «appartenenza: 7» (anche archiviati) erano due
//     universi non dichiarati sulla stessa pagina.
//   · OGNI ZERO DICE COSA HA ESCLUSO: i blocchi compaiono solo con contenuto,
//     e lo stato davvero vuoto elenca cosa è stato controllato, non «tutto a
//     posto».
//   · NIENTE BLOCCO SCADENZE: zero `term` dichiarati in produzione. Le date di
//     natura non registrata sono UNA RIGA che le chiama col loro nome.
//   · APPUNTAMENTI ≠ TERMINI: le tre attività di Rossi hanno `appointment_date`
//     e nessun `due_date` — la distinzione di `deadlineNature` vale anche qui.
//   · NESSUN PUNTEGGIO COMPOSITO: con la gravità satura su 16 documenti su 19,
//     qualunque punteggio sarebbe inventato. L'ordine è quello di `list_tasks`.
//
// ⚠️ QUESTO MODULO È PURO. I servizi importano il client Supabase e non si
// caricano da Node: ogni decisione di visibilità e di etichetta sta qui, dove
// uno script di prova può romperla. (Stessa ragione di `lib/blocchi.ts` e
// `taskFormat.ts`.)
// ============================================================================

/** Ciò che serve del task per dividerlo: mai l'oggetto intero. */
export interface TaskDateFields {
  title: string;
  dueDate: string | null;
  appointmentDate: string | null;
}

/**
 * La divisione delle attività aperte: termini, appuntamenti, senza data.
 *
 * ⚠️ Un'attività con ENTRAMBE le date è un TERMINE: il `due_date` obbliga,
 * l'`appointment_date` racconta (0041). Contarla due volte gonfierebbe il
 * lavoro apparente.
 *
 * ⚠️ `scadute` si conta su `oggi` PASSATO DA FUORI, in ora locale: la vista
 * `overdue` di `list_tasks` usa `current_date` del server (UTC) — la stessa
 * famiglia del difetto già corretto nel filtro «Urgenti» — e qui non si
 * ripete. Il confronto lessicale su YYYY-MM-DD è il confronto di date.
 */
export interface TaskSplit {
  aperte: number;
  termini: number;
  appuntamenti: number;
  senzaData: number;
  scadute: number;
  /** Su quante righe è calcolata la ripartizione: quando è meno di `aperte`,
   *  la frase a schermo lo dice con questi due numeri. */
  lette: number;
  /** Il primo elemento dell'elenco già ordinato dal database, come esempio. */
  primo: TaskDateFields | null;
  /** true se le righe lette sono meno del totale: il diviso è parziale. */
  parziale: boolean;
}

export function splitOpenTasks(rows: TaskDateFields[], total: number, oggi: string): TaskSplit {
  const termini = rows.filter((r) => r.dueDate != null);
  const appuntamenti = rows.filter((r) => r.dueDate == null && r.appointmentDate != null);
  const senzaData = rows.filter((r) => r.dueDate == null && r.appointmentDate == null);
  return {
    aperte: total,
    termini: termini.length,
    appuntamenti: appuntamenti.length,
    senzaData: senzaData.length,
    scadute: termini.filter((r) => (r.dueDate as string) < oggi).length,
    lette: rows.length,
    primo: rows[0] ?? null,
    parziale: rows.length < total,
  };
}

/**
 * Le date dei documenti, contate per natura DICHIARATA.
 *
 * `term` è un termine; `event` e `reference` sono date che non obbligano
 * l'azienda; tutto il resto — NULL, lo storico 'none', valori mai visti — è
 * natura NON REGISTRATA, non «nessuna scadenza»: l'analisi non l'ha detto,
 * che è un'altra affermazione. (Stessa tavola di `deadlineNature.ts`.)
 */
export interface ContoNature {
  /** Quante date esistono in tutto: numero ESATTO, dalla funzione finestra. */
  totale: number;
  /**
   * Su quante date è calcolata la ripartizione qui sotto. Le tre voci
   * sommano SEMPRE a questo numero, mai a `totale`: le nature si contano
   * sulle righe lette (`DATE_MAX_DOCUMENTS` per popolazione), il totale no.
   * Stesso mestiere di `TaskSplit.lette`.
   */
  lette: number;
  termini: number;
  nonObbliganti: number;
  nonRegistrate: number;
}

export function contaNature(kinds: readonly (string | null)[]): ContoNature {
  let termini = 0, nonObbliganti = 0, nonRegistrate = 0;
  for (const k of kinds) {
    if (k === 'term') termini++;
    else if (k === 'event' || k === 'reference') nonObbliganti++;
    else nonRegistrate++;
  }
  return { totale: kinds.length, lette: kinds.length, termini, nonObbliganti, nonRegistrate };
}

/**
 * QUALE FRASE DICE LA RIGA DELLE DATE, e con quali numeri.
 *
 * ⚠️⚠️ LE NATURE E IL TOTALE NON CONTANO LO STESSO INSIEME. Il totale è esatto
 * (funzione finestra di `list_documents`); le nature stanno sulle sole righe
 * lette. Metterli sulla stessa riga faceva scrivere, con 250 documenti datati,
 * «250 date: 40 termini, 90 che non obbligano, 70 di natura non registrata» —
 * che fa 200. Il numero che accompagna una ripartizione è quello su cui la
 * ripartizione è stata fatta: `lette`, mai `totale`.
 *
 * ⚠️⚠️ E «nessuna riconosciuta come termine» detto sul TOTALE, quando il tetto
 * ha morso, è un'affermazione che può essere FALSA: un termine può stare fra
 * le 50 date non lette. Non è un numero impreciso, è una negazione su un
 * insieme che non si è guardato. Quando il conteggio è parziale la frase
 * cambia: dichiara l'insieme guardato invece di negare su quello intero.
 */
export type FraseDate = 'nessunTermine' | 'nessunTermineFraLette' | 'miste';

export interface RigaDate {
  frase: FraseDate;
  /** Il numero che la frase porta: sempre l'insieme su cui è vera. */
  n: number;
  /** Quante ne esistono in tutto — serve solo alle frasi che lo dichiarano. */
  tot: number;
  /**
   * true quando sotto la riga va la dichiarazione dello scarto, come già si fa
   * per le attività. Nel ramo `nessunTermineFraLette` è false: quella frase lo
   * scarto se lo dichiara da sé, e ripeterlo sarebbe la stessa cosa due volte.
   */
  scarto: boolean;
}

export function rigaDate(n: ContoNature & { parziale: boolean }): RigaDate {
  if (n.termini > 0) {
    return { frase: 'miste', n: n.lette, tot: n.totale, scarto: n.parziale };
  }
  return n.parziale
    ? { frase: 'nessunTermineFraLette', n: n.lette, tot: n.totale, scarto: false }
    : { frase: 'nessunTermine', n: n.totale, tot: n.totale, scarto: false };
}

/** I due totali di uno stato documento, uno per popolazione. La somma è il
 *  numero della pagina; le due parti servono ai collegamenti, perché
 *  `list_documents` mostra UNA popolazione alla volta e la destinazione deve
 *  rendere lo stesso numero che il blocco dichiara. */
export interface ContoDocumenti {
  attivi: number;
  archiviati: number;
}

export const totaleConto = (c: ContoDocumenti): number => c.attivi + c.archiviati;

/**
 * Lo stato del blocco Opportunità, deciso da ciò che si è potuto misurare.
 *
 *   `mai-eseguita`   0 valutazioni per l'azienda: il matching non è mai girato.
 *                    Lo zero delle opportunità NON significa «niente per te».
 *   `eseguita`       esiste almeno una valutazione: i numeri hanno senso.
 *   `non-misurabile` la lettura è fallita: non si inventa né l'uno né l'altro.
 *
 * ⚠️ NESSUN PULSANTE «Avvia la verifica»: `subsidy-worker` è invocabile solo da
 * uno scheduler con un segreto, e il matching parte dai PROGETTI. L'azione che
 * esiste davvero nel prodotto è descrivere un progetto, e il blocco porta lì.
 * Un pulsante che chiama una funzione non chiamabile è una funzione finta.
 */
export type StatoValutazione = 'mai-eseguita' | 'eseguita' | 'non-misurabile';

export function statoValutazione(assessments: number | null): StatoValutazione {
  if (assessments === null) return 'non-misurabile';
  return assessments === 0 ? 'mai-eseguita' : 'eseguita';
}

/** Tutto ciò che decide la visibilità dei blocchi, in un posto solo. */
export interface BlocchiInput {
  /** Documenti con appartenenza da confermare (null = lettura fallita). */
  ownership: number | null;
  aperte: number;
  dateRilevate: number;
  daVerificare: number;
  fallite: number;
  maiAnalizzati: number;
  /**
   * `null` = il catalogo NON si è potuto leggere, che non è un catalogo vuoto:
   * il blocco compare e dichiara il guasto. Collassare il null sullo zero
   * farebbe sparire il blocco proprio quando c'è qualcosa da dire — la stessa
   * confusione «non ho guardato = niente da fare» che questa pagina combatte.
   */
  programmiInCatalogo: number | null;
  /** Pratiche e progetti già esistenti: se ci sono, il blocco ha numeri veri. */
  openCases: number;
  activeProjects: number;
}

export interface Blocchi {
  decisioni: boolean;
  daFare: boolean;
  sistema: boolean;
  opportunita: boolean;
  /** Il riquadro «cosa è stato controllato»: quando il lavoro operativo è a
   *  zero, la pagina dice cosa ha guardato e quando — non «tutto a posto». */
  vuotoOperativo: boolean;
}

export function decidiBlocchi(i: BlocchiInput): Blocchi {
  const decisioni = (i.ownership ?? 0) > 0;
  const daFare = i.aperte > 0 || i.dateRilevate > 0;
  const sistema = i.daVerificare > 0 || i.fallite > 0 || i.maiAnalizzati > 0;
  // Il catalogo è condiviso: finché contiene programmi, lo stato della
  // valutazione aziendale è un'informazione che esiste per OGNI azienda.
  // E un catalogo NON LEGGIBILE (null) è un'informazione anche lui.
  const opportunita = i.programmiInCatalogo === null || i.programmiInCatalogo > 0
    || i.openCases > 0 || i.activeProjects > 0;
  return {
    decisioni,
    daFare,
    sistema,
    opportunita,
    vuotoOperativo: !decisioni && !daFare && !sistema,
  };
}
