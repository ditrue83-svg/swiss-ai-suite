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
  totale: number;
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
  return { totale: kinds.length, termini, nonObbliganti, nonRegistrate };
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
  programmiInCatalogo: number;
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
  const opportunita = i.programmiInCatalogo > 0 || i.openCases > 0 || i.activeProjects > 0;
  return {
    decisioni,
    daFare,
    sistema,
    opportunita,
    vuotoOperativo: !decisioni && !daFare && !sistema,
  };
}
