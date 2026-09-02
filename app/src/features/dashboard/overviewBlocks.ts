// ============================================================================
// I BLOCCHI DELLA PANORAMICA — decisi dai numeri, non dalla griglia.
//
// Il censimento del 2026-08-19 ha misurato la produzione vera: 19 documenti su
// 19 archiviati, 16 analisi non conclusive, zero termini dichiarati in tutto il
// database. Una Home disegnata per
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
//   · UN TERMINE È UNA VOCE, UNA DATA IGNOTA È UN LIMITE: finché esistono zero
//     `term` (produzione, 2026-08-19) non c'è nessun elenco di scadenze; dal
//     primo termine vero, ogni termine è una riga con giorno, titolo e
//     collegamento dentro «Da fare». Le date di natura non registrata non sono
//     lavoro — sono ciò che il sistema non ha capito — e stanno fra i limiti.
//   · «DA FARE» SOLO SE C'È DA FARE: un titolo sopra una riga che non chiede
//     niente insegna a saltare quel titolo.
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

// ⚠️ SOLI TIPI, e per questo il modulo resta puro: `import type` sparisce alla
// trasformazione. Servono perché le CHIAVI della ripartizione si decidono qui,
// non nella schermata — vedi `chiaviTaskSplit`.
import type { PluralBase, TKey } from '@/i18n';

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
 * QUALE PAROLA VA SU QUALE NUMERO — e la decisione sta QUI, non nella pagina.
 *
 * ⚠️⚠️ È LA CLASSE D'ERRORE CHE QUESTO PRODOTTO TEME DI PIÙ: una data
 * presentata come un obbligo quando non lo è. La classificazione
 * (`splitOpenTasks`) era guardata; il NOME a schermo no, ed è il nome che
 * l'utente legge. Rendere gli appuntamenti con la chiave dei termini —
 * «3 termini» sopra tre sopralluoghi — sarebbe rimasto verde in tutta la
 * suite. Finché la coppia sta in una funzione pura, un banco può romperla.
 *
 * `base` è la coppia plurale (la forma la sceglie la lingua); `chiave` è la
 * frase INTERA dei due zeri dichiarati — «nessun termine», «nessuno scaduto» —
 * che sono affermazioni e non assenze, e non portano numero.
 */
export type ParteConteggio =
  | { base: PluralBase; chiave: null; n: number }
  | { base: null; chiave: TKey; n: number };

export function chiaviTaskSplit(s: TaskSplit): ParteConteggio[] {
  const parti: ParteConteggio[] = [];
  if (s.appuntamenti > 0) {
    parti.push({ base: 'home.tasksAppts', chiave: null, n: s.appuntamenti });
  }
  parti.push(s.termini === 0
    ? { base: null, chiave: 'home.tasksTermsNone', n: 0 }
    : { base: 'home.tasksTerms', chiave: null, n: s.termini });
  if (s.senzaData > 0) {
    parti.push({ base: 'home.tasksNoDate', chiave: null, n: s.senzaData });
  }
  parti.push(s.scadute === 0
    ? { base: null, chiave: 'home.tasksOverdueNone', n: 0 }
    : { base: 'home.tasksOverdue', chiave: null, n: s.scadute });
  return parti;
}

/**
 * LE DATE DEI DOCUMENTI — e un termine NON è un numero, è una voce.
 *
 * `term` è un termine; `event` e `reference` sono date che non obbligano
 * l'azienda; tutto il resto — NULL, lo storico 'none', valori mai visti — è
 * natura NON REGISTRATA, non «nessuna scadenza»: l'analisi non l'ha detto,
 * che è un'altra affermazione. (Stessa tavola di `deadlineNature.ts`.)
 *
 * ⚠️⚠️ PERCHÉ I TERMINI ESCONO INTERI E IL RESTO NO. «3 date nei documenti:
 * 1 termini, 1 che non obbligano l'azienda, 1 di natura non registrata» è il
 * censimento delle nature di un archivio: chi ha un termine vero non vuole
 * sapere quante nature esistono, vuole vedere QUELLA data, che cosa riguarda,
 * e arrivarci. Perciò i termini restano righe INTERE — giorno, titolo,
 * collegamento al documento — e le altre due nature restano numeri.
 *
 * ⚠️ IL TOTALE E LA RIPARTIZIONE NON CONTANO LO STESSO INSIEME. Il totale è
 * esatto (funzione finestra di `list_documents`); le nature stanno sulle sole
 * righe lette (`DATE_MAX_DOCUMENTS` per popolazione). Chi mostra un numero
 * dichiara su quale dei due sta parlando: `lette`, mai `totale`, quando
 * accompagna una ripartizione.
 */
export interface DataDocumento {
  /** La natura dichiarata dall'analisi: 'term' | 'event' | 'reference' | … */
  kind: string | null;
  /** Il giorno, `YYYY-MM-DD`. Le righe arrivano da una lettura `hasDeadline`,
   *  quindi in pratica non è mai nullo — ma il tipo del servizio lo ammette e
   *  l'ordinamento non deve inventarsi un posto per il nulla. */
  deadline: string | null;
}

export interface ContoDate<T extends DataDocumento> {
  /** Quante date esistono in questa popolazione: numero ESATTO. */
  totale: number;
  /** Su quante righe è fatta la ripartizione qui sotto. */
  lette: number;
  /** true se le righe lette sono meno del totale: un termine può nascondersi
   *  fra quelle non guardate, e chi mostra i termini deve dirlo. */
  parziale: boolean;
  /** I TERMINI, dal più vicino in avanti: voci, non un conteggio. */
  termini: T[];
  nonObbliganti: number;
  nonRegistrate: number;
}

/**
 * ⚠️ L'ORDINE È QUELLO DEL GIORNO, crescente: il più scaduto per primo, poi il
 * più vicino. Non è un punteggio e non è una priorità — è la sola cosa che una
 * data dice da sé. Una riga senza giorno finisce in coda: non si inventa una
 * posizione per un dato che non c'è.
 */
export function contoDate<T extends DataDocumento>(righe: readonly T[], totale: number): ContoDate<T> {
  const termini: T[] = [];
  let nonObbliganti = 0, nonRegistrate = 0;
  for (const r of righe) {
    if (r.kind === 'term') termini.push(r);
    else if (r.kind === 'event' || r.kind === 'reference') nonObbliganti++;
    else nonRegistrate++;
  }
  termini.sort((a, b) => {
    if (a.deadline === b.deadline) return 0;
    if (a.deadline === null) return 1;
    if (b.deadline === null) return -1;
    return a.deadline < b.deadline ? -1 : 1;
  });
  return { totale, lette: righe.length, parziale: righe.length < totale, termini, nonObbliganti, nonRegistrate };
}

/**
 * Quanti termini si ELENCANO nella Panoramica prima di dichiarare il resto.
 *
 * ⚠️ NON È UN FILTRO, È UN TETTO CHE SI DICHIARA. La regola resta «ogni termine
 * è una voce»; questo numero esiste perché la Home non è l'elenco delle
 * scadenze e cento righe di seguito non sono più una panoramica. Quando morde,
 * la pagina dice quanti ne restano e porta all'elenco completo — che è la
 * stessa forma dei tetti di lettura già dichiarati altrove.
 */
export const TERMINI_IN_PANORAMICA = 5;

export interface Termini<T> {
  /** Le voci da rendere, già ordinate per giorno. */
  voci: T[];
  /** Quanti termini restano fuori dall'elenco: 0 quando il tetto non morde. */
  altri: number;
  /** Quanti termini si sono trovati in tutto fra le righe LETTE. */
  trovati: number;
  /**
   * ⚠️⚠️ LE RIGHE LETTE SONO MENO DI QUELLE ESISTENTI: un termine può stare
   * fra quelle non guardate, quindi l'elenco NON è «tutti i tuoi termini» e la
   * pagina non può presentarlo come tale. È la stessa affermazione-che-poteva-
   * essere-falsa già corretta per la negazione «nessun termine».
   */
  parziale: boolean;
  /** I due numeri della dichiarazione: quante date lette, su quante esistenti. */
  lette: number;
  totaleDate: number;
}

/** I termini delle DUE popolazioni, uniti e ordinati per giorno: un termine
 *  archiviato resta un obbligo, e il collegamento porta al documento — non a
 *  un elenco — quindi la popolazione non cambia la destinazione. */
export function termini<T extends DataDocumento>(
  attivi: ContoDate<T>, archiviati: ContoDate<T>, tetto = TERMINI_IN_PANORAMICA,
): Termini<T> {
  const tutti = contoDate(
    [...attivi.termini, ...archiviati.termini],
    attivi.termini.length + archiviati.termini.length,
  ).termini;
  return {
    voci: tutti.slice(0, tetto),
    altri: Math.max(0, tutti.length - tetto),
    trovati: tutti.length,
    parziale: attivi.parziale || archiviati.parziale,
    lette: attivi.lette + archiviati.lette,
    totaleDate: attivi.totale + archiviati.totale,
  };
}

/**
 * LA RIGA DELLE DATE DI NATURA NON REGISTRATA, per una popolazione.
 *
 * ⚠️ PERCHÉ STA FRA I LIMITI E NON FRA IL LAVORO. Una data di cui l'analisi non
 * ha dichiarato la natura non chiede niente a nessuno: dice che il sistema non
 * ha capito che cosa fosse. Un titolo «Da fare» sopra una riga che non chiede
 * niente insegna a saltare quel titolo.
 *
 * ⚠️ E IL NUMERO DELLA RIGA NON È SEMPRE QUELLO DELLA DESTINAZIONE. Il
 * collegamento porta a `?scadenza=1`, che rende TUTTE le date della
 * popolazione: quando le non registrate sono meno, la riga lo dichiara invece
 * di lasciar credere che la pagina d'arrivo mostrerà lo stesso numero.
 * `null` = non c'è niente da dire.
 */
export interface RigaNature {
  n: number;
  totale: number;
  /** true quando la pagina d'arrivo mostra più righe del numero dichiarato. */
  destinazionePiuAmpia: boolean;
  /** true quando le nature sono contate su meno righe del totale. */
  parziale: boolean;
  lette: number;
}

export function rigaNature(c: ContoDate<DataDocumento>): RigaNature | null {
  if (c.nonRegistrate === 0) return null;
  return {
    n: c.nonRegistrate,
    totale: c.totale,
    destinazionePiuAmpia: c.nonRegistrate < c.totale,
    parziale: c.parziale,
    lette: c.lette,
  };
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

/** Tutto ciò che decide la visibilità dei blocchi, in un posto solo. */
export interface BlocchiInput {
  /** Documenti con appartenenza da confermare (null = lettura fallita). */
  ownership: number | null;
  aperte: number;
  /**
   * I TERMINI trovati nei documenti: sono lavoro, e accendono «Da fare».
   * ⚠️ Non «le date rilevate»: una data di natura non registrata non chiede
   * niente, e teneva acceso un blocco «Da fare» che non aveva da fare niente.
   */
  terminiNeiDocumenti: number;
  /** Le date di cui l'analisi non ha dichiarato la natura: un limite, e
   *  accendono il blocco dei limiti. */
  dateNonRegistrate: number;
  daVerificare: number;
  fallite: number;
  maiAnalizzati: number;
}

export interface Blocchi {
  decisioni: boolean;
  daFare: boolean;
  sistema: boolean;
  /**
   * L'appartenenza NON si è potuta leggere. Il blocco Decisioni COMPARE lo
   * stesso e lo dichiara: dentro non c'è nessun conteggio inventato, c'è la
   * frase che dice che il controllo non è stato eseguito. Stesso mestiere di
   * una frase esplicita nel blocco Decisioni.
   */
  ownershipIgnota: boolean;
  /** Il riquadro «cosa è stato controllato»: quando il lavoro operativo è a
   *  zero, la pagina dice cosa ha guardato e quando — non «tutto a posto». */
  vuotoOperativo: boolean;
}

export function decidiBlocchi(i: BlocchiInput): Blocchi {
  const ownershipIgnota = i.ownership === null;
  // ⚠️⚠️ UN BLOCCO CHE NON HA POTUTO LEGGERE I SUOI DATI RESTA A SCHERMO. Il
  // una lettura fallita sull'appartenenza faceva SPARIRE il blocco
  // Decisioni. Due risposte opposte allo stesso guasto sulla stessa pagina, e
  // quella che sparisce è indistinguibile da un blocco vuoto perché non c'è
  // niente da fare. Ora il blocco compare e dichiara il guasto: il conteggio
  // resta non inventato — dentro, la riga dice «non leggibile», non «0».
  const decisioni = ownershipIgnota || (i.ownership ?? 0) > 0;
  const daFare = i.aperte > 0 || i.terminiNeiDocumenti > 0;
  const sistema = i.daVerificare > 0 || i.fallite > 0 || i.maiAnalizzati > 0
    || i.dateNonRegistrate > 0;
  return {
    decisioni,
    daFare,
    sistema,
    ownershipIgnota,
    vuotoOperativo: !decisioni && !daFare && !sistema && !ownershipIgnota,
  };
}
