// ============================================================================
// L'ATTENDIBILITÀ DI UN'ANALISI, IN LETTURA — una funzione sola, per tutti.
//
// ⚠️⚠️ PERCHÉ ESISTE, E CHE COSA NON È.
//
// Fino al 2026-08-18 la scheda «Analisi» stampava `analysis.confidence` come
// una voce dell'elenco dei campi, con l'etichetta «Affidabilità». Erano due
// difetti in uno:
//
//   · di POSIZIONE — un giudizio di sintesi messo alla pari dei campi che
//     riassume può contraddirli da pari. Il 15 agosto la testata diceva «alta»
//     sopra una data che era un sopralluogo preso per scadenza, e il «da
//     verificare» stava mezzo schermo più in basso;
//   · di DEFINIZIONE — quel numero misura quanto il modello è certo di aver
//     LETTO bene. «Affidabilità» promette che l'analisi sia CORRETTA e
//     pertinente, che è un'altra affermazione e più grande.
//
// Quindi due nomi per due cose:
//   `confidenza di lettura`   il valore grezzo del modello, che resta nel
//                             database e si legge nei dettagli tecnici;
//   `attendibilità`           ciò che si mostra, cioè il valore grezzo
//                             ABBASSATO dai tetti che questa funzione calcola.
//
// ⚠️ SI CALCOLA IN LETTURA, come `deadlineNature.ts`, e per la stessa ragione:
// l'analisi è un verbale immutabile (0010). Nessuna riscrittura dello snapshot
// (§59), nessuna rianalisi, nessuna migrazione. Una regola applicata solo in
// scrittura non protegge le righe già scritte — questo progetto l'ha pagata
// tre volte (il titolo non mostrabile, la natura della data, e ora questa).
//
// ⚠️ UNA SOLA SUPERFICIE NON CALCOLA MAI PER CONTO SUO. Dettaglio, archivio,
// panoramica, stampa ed esportazione chiamano questa funzione. Il campo grezzo
// `confidence` si legge solo per passarlo qui dentro e per mostrarlo, col suo
// nome vero, nei dettagli tecnici.
//
// ---------------------------------------------------------------------------
// LA TAVOLA DEI TETTI (2026-08-18), e la storia di come è cambiata.
//
// La prima stesura aveva due regole che misuravano la cosa sbagliata, ed è la
// sonda sul database vero ad averlo mostrato — non il disegno:
//
//   ⛔ «3+ punti da verificare → bassa». Tutte e 19 le analisi in archivio ne
//      hanno fra 3 e 6: il conteggio descriveva quanto è prolisso il prompt che
//      li produce, non quanto è dubbio il documento. Un segnale presente sul
//      100 % del corpus non porta informazione. Il conteggio è uscito dai
//      tetti e resta a schermo come numero suo — «quanto lavoro resta aperto»,
//      che è un fatto diverso da «quanto posso fidarmi».
//
//   ⛔ «1 campo portante senza evidenza → media». Trattava l'assenza di una
//      COLONNA come l'assenza di una CITAZIONE. Destinatario e data del
//      documento non hanno un canale di evidenza nello snapshot: marcarli
//      avrebbe addebitato al documento una lacuna nostra, e avrebbe portato
//      ogni analisi a «bassa» per costruzione.
//
// La tavola in vigore:
//
//   appartenenza in dubbio ............... indicatore ASSENTE (non «bassa»)
//   1 campo portante CON canale, senza
//     citazione .......................... media
//   2+ campi portanti idem ............... bassa
//   scadenza «da verificare» ............. media
//   scadenza dedotta (`inferred`) ........ bassa
//   punto `high` su campo portante ....... bassa
//   punto `medium` su campo portante ..... media
//   punto `low`, o punto su campo NON
//     portante ........................... nessun tetto
//   nessuna delle precedenti ............. passa il livello del modello
//
// ⚠️ ECCEZIONE DICHIARATA: `authenticity` con gravità `high` vale come campo
// portante pur non essendo un campo di dato. Un dubbio sull'autenticità non
// può lasciare il livello intatto.
//
// ⚠️ LE DUE REGOLE VINCOLATE A `deadline != null`, e non è pedanteria: nel
// database ci sono 6 analisi con `deadline_type = 'inferred'` e NESSUNA data.
// Abbassare il livello per una scadenza che non esiste sarebbe esattamente il
// difetto che si sta correggendo, con un altro segno.
//
// ⛔ NON C'È PIÙ una regola sulla qualità dell'OCR. C'era, e diceva il falso:
// `persist.ts` scrive `ocr_confidence: null` sempre, e la colonna è nulla su
// tutte le righe. Una regola che non PUÒ scattare non è inattiva, è una riga
// di specifica che mente. Se un giorno quel numero verrà valorizzato, si
// riaggiunge allora — con il suo test.
// ============================================================================
import type { AnalysisCorrection, AnalysisUncertainty, Confidence, DocumentAnalysis } from '@/types/models';

export type TrustLevel = Confidence;

/**
 * I sei campi che reggono un'analisi. Un dubbio su uno di questi cambia che
 * cosa il documento è; un dubbio sulla lingua o sulla valuta di un importo
 * secondario no.
 */
export const CAMPI_PORTANTI = [
  'sender', 'recipient', 'documentType', 'documentDate', 'deadline', 'amounts',
] as const;
export type CampoPortante = (typeof CAMPI_PORTANTI)[number];

/**
 * ⚠️ La radice PRIMA del punto. Il modello dichiara anche sotto-attributi —
 * `sender.authorityType`, `amounts.currency` — e sono dubbi sullo stesso campo.
 * Misurato sul database vero: contarli o non contarli non sposta un solo
 * livello (19 analisi, distribuzioni identiche). La scelta non è quindi
 * portante a sua volta, ed è documentata qui perché nessuno debba rimisurarla.
 */
export function radiceCampo(field: string | null | undefined): string {
  return String(field ?? '').split('.')[0] ?? '';
}

export function eCampoPortante(u: Pick<AnalysisUncertainty, 'field' | 'severity'>): boolean {
  if (u.field === 'authenticity' && u.severity === 'high') return true;
  return (CAMPI_PORTANTI as readonly string[]).includes(radiceCampo(u.field));
}

// ---------------------------------------------------------------------------
// LA DATA IN CUI `deadline_kind` HA COMINCIATO A ESISTERE (migrazione 0040).
//
// ⚠️ Serve a distinguere due tetti che si somigliano e non sono la stessa cosa
// (§ «i tetti che nascono da una lacuna nostra»):
//   · il documento non dichiara che cosa sia quella data  → è del DOCUMENTO,
//     e l'utente può correggere;
//   · il campo non esisteva quando l'analisi è stata prodotta → è NOSTRO, e
//     non c'è niente che l'utente possa correggere adesso.
// Il livello scende in entrambi i casi — non sappiamo davvero se quella data
// obblighi l'azienda — ma la riga del motivo non può far credere che sia il
// documento a essere poco chiaro quando il buco è nel nostro schema.
// ---------------------------------------------------------------------------
export const NATURA_SCADENZA_DA = '2026-08-15';

/**
 * Le nature che una riga può dichiarare. Vuoto/assente = nessuna risposta.
 *
 * ⚠️ `none` NON È QUI, e deve restare fuori: il prompt lo definisce come «se
 * non c'è alcuna data», quindi su una riga che una data ce l'ha è una
 * contraddizione e non una natura. È la stessa scelta di `deadlineNature.ts`,
 * e le due devono dire la stessa cosa — due verità sulla stessa domanda sono
 * il difetto che questo modulo esiste per non ripetere.
 */
const NATURE_DICHIARATE = new Set(['term', 'event', 'reference']);

export type TrustCapReason =
  | 'evidence_missing'
  | 'deadline_to_verify'
  | 'deadline_nature_unrecorded'
  | 'deadline_inferred'
  | 'point_high'
  | 'point_medium';

export interface TrustCap {
  reason: TrustCapReason;
  /** il livello massimo che questo tetto consente */
  cap: TrustLevel;
  /** i campi coinvolti, per comporre il motivo senza scriverlo qui */
  fields: string[];
  /**
   * Il tetto nasce da una lacuna DI SWISSAUDIT, non dal documento: non si offre
   * un'azione, si dichiara l'età dell'analisi.
   */
  fromOurGap: boolean;
}

/** Lo stato di un campo portante rispetto alla sua citazione. */
export interface StatoCampo {
  /** il campo porta un valore in questa analisi */
  hasValue: boolean;
  /**
   * Esiste un canale di citazione per questo campo nello snapshot?
   * `false` per destinatario, tipo documento e data del documento: il modello
   * non produce (o `persist.ts` non salva) una citazione per loro. Un campo
   * senza canale NON abbassa il livello.
   */
  hasChannel: boolean;
  /** la citazione c'è, ed è verificata (le colonne `*_evidence` sono già solo verificate) */
  hasEvidence: boolean;
}

export interface TrustCompany {
  legalName: string;
  /**
   * I cognomi dei membri, per riconoscere una persona fisica dell'azienda.
   * ⚠️ Assente o vuoto = «non confrontabile», e allora la persona NON fa
   * scattare l'avviso: è la regola, non un ripiego.
   */
  memberSurnames?: readonly string[];
}

export interface TrustInput {
  /** il livello grezzo del modello (`document_analyses.confidence`) */
  modelLevel: string | null;
  recipient: string | null;
  uncertainties: readonly AnalysisUncertainty[];
  deadline: string | null;
  deadlineKind: string | null;
  /** explicit | relative | inferred | none */
  deadlineType: string | null;
  /** il flag GREZZO scritto dal validatore all'epoca dell'analisi */
  deadlineRequiresVerificationRaw: boolean;
  /** quando l'analisi è stata prodotta (ISO). Serve solo a datare la lacuna. */
  analysedAt: string | null;
  campi: Partial<Record<CampoPortante, StatoCampo>>;
  company: TrustCompany;
  /**
   * L'azienda ha CONFERMATO che il documento la riguarda.
   *
   * ⚠️⚠️ SENZA QUESTO INGRESSO LA CONFERMA NON POTREBBE FUNZIONARE, e il
   * difetto l'ha trovato il test prima del codice. Il dubbio nasce anche dal
   * punto `recipient` con gravità alta, che vive nello snapshot e lo snapshot
   * è immutabile (0010): confermare l'appartenenza non può cancellarlo, quindi
   * senza un ingresso a parte l'avviso tornerebbe a ogni caricamento, per
   * sempre. La conferma è un fatto NUOVO che si affianca al verbale, non una
   * correzione del verbale — la stessa forma di `analysis_corrections`.
   *
   * Confermata l'appartenenza, i punti NON spariscono: `recipient` con gravità
   * alta resta un tetto come tutti gli altri e porta il livello a «bassa».
   * Si è risposto a «di chi è questo documento», non a «quanto è affidabile».
   */
  ownershipConfirmed?: boolean;
}

export interface TrustVerdict {
  /** `null` = non valutabile: l'appartenenza va confermata prima. */
  level: TrustLevel | null;
  /** perché non è valutabile. Oggi c'è una sola ragione, e resta nominata. */
  unavailable: 'ownership' | null;
  /** il livello grezzo del modello, normalizzato. NON si mostra come «attendibilità». */
  modelLevel: TrustLevel;
  /** tutti i tetti attivi, ciascuno col suo motivo. Vuoto = passa il modello. */
  caps: TrustCap[];
  /** il tetto che decide (il più restrittivo; a parità, il primo dichiarato) */
  binding: TrustCap | null;
  /** quanti elementi da verificare porta l'analisi. NON è un tetto: è un altro fatto. */
  pointCount: number;
  /** i campi portanti che in questa analisi non hanno un canale di citazione */
  campiSenzaCanale: CampoPortante[];
  /** perché l'appartenenza è in dubbio, quando lo è */
  ownership: OwnershipVerdict;
}

// ---------------------------------------------------------------------------
// L'APPARTENENZA — una condizione a sé, non un tetto fra gli altri.
//
// ⚠️ «Destinatario diverso» e «destinatario non determinabile» sono due
// affermazioni diverse e stavano finendo nello stesso stato. Un campo che non
// si è potuto leggere non è un documento di un'altra azienda: è un campo non
// determinato, e non fa sparire l'indicatore.
//
// ⚠️ IL TESTO DEL PUNTO NON È MAI LA FONTE. Si legge il NOME del campo che il
// modello dichiara (`uncertainties[].field`), che è un dato strutturato, e la
// sua gravità. La descrizione serve a mostrare all'utente perché, mai a
// decidere. Cercare parole chiave in un testo libero è il difetto che questa
// riscrittura sta togliendo, non un modo di farla.
// ---------------------------------------------------------------------------
export type OwnershipVerdict =
  | { doubt: false; recipient: 'assente' | 'cortesia' | 'membro' | 'stessa' | 'non-confrontabile' | 'confermata' }
  | { doubt: true; via: 'nome' | 'punto' | 'entrambi'; other: string | null };

/**
 * Formule di cortesia nelle tre lingue del prodotto più l'inglese dei
 * fornitori. ⚠️ È una TABELLA CHIUSA, non un'inferenza sul testo: «Spettabile
 * Ditta» non è il nome di un'altra azienda, e sul database vero era uno dei due
 * falsi positivi del confronto per nome.
 */
export const FORMULE_DI_CORTESIA: readonly string[] = [
  // it
  'spettabile ditta', 'spettabile', 'egregi signori', 'gentili signori',
  'gentile cliente', 'gentile signora', 'egregio signore', 'alla cortese attenzione',
  'a chi di competenza',
  // de
  'sehr geehrte damen und herren', 'sehr geehrte damen', 'sehr geehrter herr',
  'sehr geehrte frau', 'sehr geehrte kundin', 'sehr geehrter kunde',
  'an die zuständige stelle', 'an die zustaendige stelle',
  // fr
  'madame/monsieur', 'madame, monsieur', 'madame et monsieur', 'messieurs',
  'chère cliente', 'chere cliente', 'cher client', 'à qui de droit', 'a qui de droit',
  // en (i fornitori scrivono così)
  'dear sir or madam', 'dear customer', 'to whom it may concern',
];

/** I titoli che introducono una PERSONA fisica, nelle tre lingue. */
const TITOLI_PERSONA: readonly string[] = [
  'signor', 'signora', 'sig.', 'sig', 'egr.', 'gent.',
  'herr', 'frau', 'monsieur', 'madame', 'mme', 'm.', 'mr', 'mrs', 'ms',
];

const normalizza = (s: string | null | undefined): string =>
  String(s ?? '').toLowerCase().replace(/[.,;:]/g, ' ').replace(/\s+/g, ' ').trim();

/** Toglie la forma giuridica: «Rossi SA» e «Rossi» sono la stessa impresa. */
const senzaFormaGiuridica = (s: string): string =>
  s.replace(/\b(sa|sagl|ag|gmbh|srl|sarl|sa?rl|ltd|inc|plc)\b/g, '').replace(/\s+/g, ' ').trim();

export function valutaAppartenenza(
  recipient: string | null,
  uncertainties: readonly AnalysisUncertainty[],
  company: TrustCompany,
): OwnershipVerdict {
  // Il segnale del modello: il NOME del campo e la sua gravità, non il testo.
  const puntoAlto = uncertainties.some((u) => u.field === 'recipient' && u.severity === 'high');

  const n = normalizza(recipient);
  let nomeDiverso = false;
  let stato: 'assente' | 'cortesia' | 'membro' | 'stessa' | 'non-confrontabile' = 'assente';

  if (!n) {
    stato = 'assente';
  } else if (FORMULE_DI_CORTESIA.some((f) => n === f || n.startsWith(`${f} `) || n.startsWith(f))) {
    stato = 'cortesia';
  } else {
    const titolo = TITOLI_PERSONA.find((x) => n === x || n.startsWith(`${x} `));
    if (titolo) {
      // Una persona fisica. Il cognome è l'ultima parola dopo il titolo.
      const cognome = n.slice(titolo.length).trim().split(' ').pop() ?? '';
      const membri = (company.memberSurnames ?? []).map((s) => normalizza(s)).filter(Boolean);
      if (!cognome || membri.length === 0) {
        // ⚠️ NON confrontabile ⇒ NON fa scattare l'avviso. Il destinatario
        // resta «da verificare» come campo, e l'indicatore non sparisce.
        stato = 'non-confrontabile';
      } else if (membri.includes(cognome)) {
        stato = 'membro';
      } else {
        // Una persona che non risulta fra i membri: è un soggetto diverso.
        nomeDiverso = true;
        stato = 'non-confrontabile';
      }
    } else {
      const azienda = senzaFormaGiuridica(normalizza(company.legalName));
      const dest = senzaFormaGiuridica(n);
      const coincide = !!azienda && !!dest
        && (dest === azienda || dest.includes(azienda) || azienda.includes(dest));
      if (coincide) stato = 'stessa';
      else nomeDiverso = true;
    }
  }

  if (!nomeDiverso && !puntoAlto) return { doubt: false, recipient: stato };
  return {
    doubt: true,
    via: nomeDiverso && puntoAlto ? 'entrambi' : nomeDiverso ? 'nome' : 'punto',
    other: recipient?.trim() || null,
  };
}

// ---------------------------------------------------------------------------
const ORDINE: Record<TrustLevel, number> = { alta: 3, media: 2, bassa: 1 };
const normalizzaLivello = (v: string | null): TrustLevel =>
  v === 'alta' || v === 'media' || v === 'bassa' ? v : 'bassa';
const piuBasso = (a: TrustLevel, b: TrustLevel): TrustLevel => (ORDINE[a] <= ORDINE[b] ? a : b);

/**
 * Il verdetto completo. È l'UNICA funzione che decide che livello si mostra.
 */
export function analysisTrust(input: TrustInput): TrustVerdict {
  const modelLevel = normalizzaLivello(input.modelLevel);
  const punti = input.uncertainties ?? [];
  const ownership: OwnershipVerdict = input.ownershipConfirmed
    ? { doubt: false, recipient: 'confermata' }
    : valutaAppartenenza(input.recipient, punti, input.company);

  const caps: TrustCap[] = [];

  // --- 1. l'evidenza, SOLO sui campi che hanno un canale ---------------------
  const senzaCitazione: string[] = [];
  const campiSenzaCanale: CampoPortante[] = [];
  for (const campo of CAMPI_PORTANTI) {
    const s = input.campi[campo];
    if (!s) continue;
    if (!s.hasChannel) { campiSenzaCanale.push(campo); continue; }
    if (s.hasValue && !s.hasEvidence) senzaCitazione.push(campo);
  }
  if (senzaCitazione.length >= 2) {
    caps.push({ reason: 'evidence_missing', cap: 'bassa', fields: senzaCitazione, fromOurGap: false });
  } else if (senzaCitazione.length === 1) {
    caps.push({ reason: 'evidence_missing', cap: 'media', fields: senzaCitazione, fromOurGap: false });
  }

  // --- 2. la scadenza -------------------------------------------------------
  // ⚠️ VINCOLATE A `deadline != null`: senza una data non c'è niente da
  // qualificare, e `deadline_type` resta valorizzato anche quando la data manca.
  if (input.deadline) {
    const naturaDichiarata = typeof input.deadlineKind === 'string'
      && NATURE_DICHIARATE.has(input.deadlineKind);
    // ⚠️ PRECEDENZA NON OVVIA, E DICHIARATA: vince la LETTURA sul flag grezzo.
    // Sullo Stripe del 30.07.2026 `deadline_requires_verification` vale `false`
    // mentre `deadline_kind` è NULL — il validatore di allora non poteva porre
    // una domanda che non esisteva. Natura non dichiarata ⇒ «da verificare»,
    // qualunque cosa dica il flag. È la stessa somma di `deadlineNature.ts`.
    if (!naturaDichiarata) {
      const prima = !input.analysedAt || input.analysedAt < NATURA_SCADENZA_DA;
      caps.push({
        reason: prima ? 'deadline_nature_unrecorded' : 'deadline_to_verify',
        cap: 'media', fields: ['deadline'], fromOurGap: prima,
      });
    } else if (input.deadlineRequiresVerificationRaw) {
      caps.push({ reason: 'deadline_to_verify', cap: 'media', fields: ['deadline'], fromOurGap: false });
    }
    if (input.deadlineType === 'inferred') {
      caps.push({ reason: 'deadline_inferred', cap: 'bassa', fields: ['deadline'], fromOurGap: false });
    }
  }

  // --- 3. i punti, per GRAVITÀ e non per numero -----------------------------
  const portanti = punti.filter(eCampoPortante);
  const alti = portanti.filter((u) => u.severity === 'high');
  const medi = portanti.filter((u) => u.severity === 'medium');
  if (alti.length) {
    caps.push({ reason: 'point_high', cap: 'bassa', fields: alti.map((u) => u.field), fromOurGap: false });
  } else if (medi.length) {
    caps.push({ reason: 'point_medium', cap: 'media', fields: medi.map((u) => u.field), fromOurGap: false });
  }

  // --- l'esito ---------------------------------------------------------------
  const binding = caps.reduce<TrustCap | null>(
    (acc, c) => (acc === null || ORDINE[c.cap] < ORDINE[acc.cap] ? c : acc), null);

  if (ownership.doubt) {
    // ⚠️ NON scende a «bassa»: sparisce. Un livello basso è comunque un
    // giudizio sull'analisi di QUESTA azienda, e finché non si sa se il
    // documento la riguardi non c'è niente da giudicare. Niente pallini vuoti,
    // niente quarto livello: l'assenza dell'indicatore non è un segno.
    return {
      level: null, unavailable: 'ownership', modelLevel, caps, binding,
      pointCount: punti.length, campiSenzaCanale, ownership,
    };
  }

  const level = caps.reduce<TrustLevel>((acc, c) => piuBasso(acc, c.cap), modelLevel);
  return {
    level, unavailable: null, modelLevel, caps, binding,
    pointCount: punti.length, campiSenzaCanale, ownership,
  };
}

// ---------------------------------------------------------------------------
// IL SEGNO DI CAMPO — che cosa mostrare accanto a un valore estratto.
//
// Tre stati, e il terzo è la ragione per cui questa funzione esiste: un campo
// senza canale di citazione non è un campo dubbio, ed è un dubbio del modello
// — dichiarato sul NOME del campo — a renderlo tale. La lacuna del canale si
// dichiara UNA volta sola, nei dettagli tecnici, non su ogni riga.
// ---------------------------------------------------------------------------
export type SegnoCampo = 'evidenza' | 'senza-evidenza' | 'da-verificare' | null;

export function segnoCampo(
  campo: CampoPortante,
  stato: StatoCampo | undefined,
  uncertainties: readonly AnalysisUncertainty[],
): SegnoCampo {
  if (!stato || !stato.hasValue) return null;
  if (stato.hasChannel) return stato.hasEvidence ? 'evidenza' : 'senza-evidenza';
  return uncertainties.some((u) => radiceCampo(u.field) === campo) ? 'da-verificare' : null;
}

// ---------------------------------------------------------------------------
// LA CONFERMA DI APPARTENENZA COME CORREZIONE — la stessa forma di tutte le
// revisioni umane di questo prodotto: un record append-only in
// `analysis_corrections`, che si AFFIANCA al verbale senza toccarlo.
//
// ⚠️ La revoca non cancella la conferma: la SUPERA. Vince la riga più recente,
// esattamente come per le correzioni dei campi (`jsonb_object_agg` in
// `list_documents` tiene l'ultimo valore di ogni chiave). Così il registro
// racconta la storia intera — confermata, poi revocata — invece di fingere che
// la conferma non sia mai esistita.
// ---------------------------------------------------------------------------
export const OWNERSHIP_FIELD = 'ownership';
export const OWNERSHIP_CONFIRMED = 'confermata';
export const OWNERSHIP_REVOKED = 'revocata';

export interface OwnershipConfirmation {
  /** chi ha confermato (user id); il nome lo risolve la rubrica dei membri */
  by: string | null;
  /** quando (ISO) */
  at: string;
}

/**
 * La conferma in vigore, letta dal registro delle correzioni.
 * Le righe possono arrivare in qualunque ordine: decide la più recente.
 */
export function ownershipConfirmation(
  corrections: readonly Pick<AnalysisCorrection, 'field' | 'correctedValue' | 'correctedBy' | 'correctedAt'>[],
): OwnershipConfirmation | null {
  let latest: (typeof corrections)[number] | null = null;
  for (const c of corrections) {
    if (c.field !== OWNERSHIP_FIELD) continue;
    if (!latest || c.correctedAt > latest.correctedAt) latest = c;
  }
  if (!latest || latest.correctedValue !== OWNERSHIP_CONFIRMED) return null;
  return { by: latest.correctedBy, at: latest.correctedAt };
}

/**
 * I cognomi dalla rubrica dei membri (`company_member_directory` dà nomi
 * completi «Nome Cognome»): l'ultima parola. Un nome vuoto non produce niente
 * — meglio nessun cognome che un cognome inventato.
 */
export function cognomiDaRubrica(displayNames: readonly string[]): string[] {
  return displayNames
    .map((n) => (n ?? '').trim().split(/\s+/).pop() ?? '')
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// L'ADATTATORE DAL DOMINIO — dall'oggetto `DocumentAnalysis` all'ingresso
// della funzione, in un posto solo: cinque superfici che si costruissero
// l'ingresso a mano divergerebbero esattamente come cinque copie della regola.
//
// ⚠️ QUALI CAMPI HANNO UN CANALE È SCRITTO QUI, non dedotto: lo snapshot ha
// una colonna di citazione per mittente, scadenza e importi; destinatario,
// tipo documento e data del documento non ce l'hanno (misurato sul database il
// 2026-08-19 — per `documentType` il modello la produce e la persistenza la
// scarta: recuperarla è una voce aperta, con la sua colonna). Quando quel
// canale nascerà, questo è l'unico posto da aggiornare.
// ---------------------------------------------------------------------------
export function trustInputFromAnalysis(
  a: Pick<DocumentAnalysis,
    'confidence' | 'recipient' | 'uncertaintyItems' | 'deadline' | 'deadlineKind'
    | 'deadlineType' | 'deadlineRequiresVerification' | 'createdAt'
    | 'sender' | 'senderEvidence' | 'deadlineEvidence' | 'amount' | 'amountEvidence'
    | 'documentType' | 'documentDate'>,
  company: TrustCompany,
  ownershipConfirmed = false,
): TrustInput {
  return {
    modelLevel: a.confidence,
    recipient: a.recipient,
    uncertainties: a.uncertaintyItems,
    deadline: a.deadline,
    deadlineKind: a.deadlineKind,
    deadlineType: a.deadlineType,
    // ⚠️ Il dominio porta il flag EFFETTIVO (grezzo ∨ natura mai dichiarata),
    // non il grezzo — e va bene lo stesso, per costruzione: quando la natura
    // NON è dichiarata questa funzione non consulta il flag; quando È
    // dichiarata, effettivo e grezzo coincidono. Non è un'approssimazione,
    // è un'equivalenza — e la sezione dei test la tiene vera.
    deadlineRequiresVerificationRaw: a.deadlineRequiresVerification,
    analysedAt: a.createdAt,
    campi: {
      sender: { hasValue: !!a.sender, hasChannel: true, hasEvidence: a.senderEvidence != null },
      deadline: { hasValue: !!a.deadline, hasChannel: true, hasEvidence: a.deadlineEvidence != null },
      amounts: { hasValue: a.amount != null, hasChannel: true, hasEvidence: a.amountEvidence != null },
      recipient: { hasValue: !!a.recipient, hasChannel: false, hasEvidence: false },
      documentType: { hasValue: !!a.documentType, hasChannel: false, hasEvidence: false },
      documentDate: { hasValue: !!a.documentDate, hasChannel: false, hasEvidence: false },
    },
    company,
    ownershipConfirmed,
  };
}
