// ============================================================================
// La revisione del catalogo: che cosa è cambiato sulla fonte.
//
// Modulo PURO — nessuna rete, nessun React. È la parte che decide che cosa una
// persona legge prima di approvare, quindi è la parte che va provata.
//
// ⚠️⚠️ CHE COSA SONO DAVVERO QUESTE SCHEDE, perché il disegno dipende da qui e
// non dal nome «revisione». I `proposed_values` NON sono campi di catalogo: le
// sette schede ferme al 2026-08-05 contengono `textLength`, `contentHash`,
// `declaredUpdatedAt`, `deadlineCandidateCount`, `unsupported`, `title`. Sono
// IMPRONTE DELLA PAGINA sorgente. Dicono «la fonte si è mossa», non «il nome del
// programma adesso è X». Non c'è nulla da «applicare»: c'è da guardare la fonte
// e dire se ciò che il catalogo afferma è ancora vero.
//
// Perciò questo modulo non costruisce una patch: costruisce un CONFRONTO
// leggibile, e distingue i campi che una persona può giudicare da quelli che
// sono solo rumore tecnico.
// ============================================================================

/** Un valore JSON come arriva da `previous_values` / `proposed_values`. */
export type ReviewValue = string | number | boolean | null;

export type ChangeKind = 'added' | 'removed' | 'changed';

export interface FieldChange {
  key: string;
  kind: ChangeKind;
  before: ReviewValue;
  after: ReviewValue;
  /**
   * ⚠️ `technical` NON nasconde il campo: lo ordina dopo e lo marca. Un'impronta
   * come `contentHash` non aiuta a decidere, ma toglierla significherebbe
   * mostrare un confronto che non è il confronto — e chi approva deve poter
   * vedere tutto ciò su cui sta mettendo la firma.
   */
  technical: boolean;
}

/**
 * I campi che un essere umano può giudicare guardando la pagina ufficiale.
 * Tutto il resto è impronta: utile a un programma, inutile a una persona.
 *
 * ⚠️ L'elenco è di ciò che è LEGGIBILE, non di ciò che è importante. `textLength`
 * conta: un salto da 4000 a 400 caratteri vuol dire che la pagina è stata
 * svuotata. Ma è un numero che si giudica solo aprendo la fonte, ed è
 * esattamente ciò che questa schermata chiede di fare.
 */
const HUMAN_FIELDS = new Set([
  'title', 'name', 'authority', 'deadline', 'deadlines', 'declaredUpdatedAt',
  'applicationWindow', 'amount', 'amounts', 'status', 'availability', 'unsupported',
]);

function norm(v: unknown): ReviewValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  // Oggetti e array si riducono a JSON: non si inventa una resa «carina» di una
  // forma che non conosciamo.
  return JSON.stringify(v);
}

/** Due valori sono uguali per chi legge? `1` e `'1'` non lo sono: il tipo è un dato. */
function same(a: ReviewValue, b: ReviewValue): boolean {
  return a === b;
}

/**
 * Il confronto fra ciò che dicevamo e ciò che la fonte dice adesso.
 *
 * ⚠️ SOLO LE DIFFERENZE. Un elenco che ripete venti campi identici per
 * evidenziarne due è un elenco che nessuno legge fino in fondo, e la revisione
 * che nessuno legge è quella che è rimasta ferma sei giorni.
 * ⚠️ I campi COMPARSI e SPARITI ci sono entrambi: nelle sette schede reali
 * `unsupported` sparisce e `title` compare, e sono le due informazioni più
 * significative dell'intero confronto.
 */
export function diffValues(
  previous: Record<string, unknown> | null | undefined,
  proposed: Record<string, unknown> | null | undefined,
): FieldChange[] {
  const prev = previous ?? {};
  const next = proposed ?? {};
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(next)])];

  const out: FieldChange[] = [];
  for (const key of keys) {
    const hasPrev = Object.prototype.hasOwnProperty.call(prev, key);
    const hasNext = Object.prototype.hasOwnProperty.call(next, key);
    const before = hasPrev ? norm(prev[key]) : null;
    const after = hasNext ? norm(next[key]) : null;

    let kind: ChangeKind;
    if (!hasPrev && hasNext) kind = 'added';
    else if (hasPrev && !hasNext) kind = 'removed';
    else if (!same(before, after)) kind = 'changed';
    else continue;

    out.push({ key, kind, before, after, technical: !HUMAN_FIELDS.has(key) });
  }

  // Prima ciò che una persona può giudicare, poi le impronte; a parità, in
  // ordine alfabetico, così due schede uguali si leggono allo stesso modo.
  return out.sort((a, b) =>
    (a.technical ? 1 : 0) - (b.technical ? 1 : 0) || a.key.localeCompare(b.key));
}

export type Decision = 'accepted' | 'rejected' | 'ignored';

export interface DecisionCheck {
  ok: boolean;
  /** La chiave i18n dell'errore, mai un messaggio scritto a mano. */
  errorKey?: 'noteRequired' | 'invalidDecision';
}

/**
 * Si può inviare questa decisione?
 *
 * ⚠️ LA STESSA REGOLA È NELLA 0037, e la doppia scrittura è voluta: qui serve a
 * non far partire una richiesta che il database rifiuterebbe, là serve perché
 * la regola non si possa aggirare. Se una delle due sparisse, l'altra reggerebbe
 * — è il senso di metterla in tutti e due i posti, non una svista.
 * ⚠️ Il controllo è su `trim()`: una nota di soli spazi è una nota assente, e
 * accettarla renderebbe la regola una formalità.
 */
export function checkDecision(decision: string, note: string): DecisionCheck {
  if (decision !== 'accepted' && decision !== 'rejected' && decision !== 'ignored') {
    return { ok: false, errorKey: 'invalidDecision' };
  }
  if (decision === 'rejected' && note.trim() === '') {
    return { ok: false, errorKey: 'noteRequired' };
  }
  return { ok: true };
}

/**
 * Da quanti giorni aspetta questa scheda.
 *
 * ⚠️ Torna `null` se la data non si legge, e chi mostra deve dirlo. «Non lo so»
 * e «zero giorni» sono due cose diverse, e la seconda tranquillizza a torto.
 */
export function waitingDays(createdAt: string | null | undefined, now: Date): number | null {
  if (!createdAt) return null;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}
