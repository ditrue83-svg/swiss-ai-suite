// ============================================================================
// IL RILEVAMENTO DEL CAMBIAMENTO — §20, §21, §22, §153.
//
// Quando una fonte cambia, il sistema NON riscrive niente: registra la nuova
// impronta, calcola che cosa è cambiato, e crea una voce da revisionare. La
// versione pubblicata resta quella, e con lei restano corrette tutte le
// pratiche che vi puntano.
//
// ⚠️ IL RISCHIO GOVERNA CIÒ CHE PUÒ ENTRARE DA SOLO (§23). Un titolo di pagina
// cambiato è `low` e non tocca niente di sostanziale; una scadenza o un
// requisito sono `critical` e non entrano mai senza una persona. La differenza
// non è la fiducia nell'adapter: è che cosa succede se sbaglia.
//
// ⚠️ NESSUNA AI IN QUESTO FILE (§153). Il confronto è deterministico —
// impronta, ETag, campi — e costa zero. Chiedere a un modello se due pagine
// siano diverse significherebbe pagare per una domanda a cui una funzione di
// hash risponde meglio.
//
// Modulo PORTABILE: nessun import di runtime.
// ============================================================================

import type { AdapterResult } from './adapters.ts';

export type ReviewChangeType =
  | 'new_program' | 'program_metadata' | 'program_requirements' | 'program_exclusions'
  | 'contribution' | 'deadline' | 'call_status' | 'new_call' | 'availability'
  | 'source_unreachable' | 'source_structure_changed' | 'other';

export type ReviewRisk = 'low' | 'medium' | 'high' | 'critical';

export interface FieldChange {
  field: string;
  previous: unknown;
  proposed: unknown;
}

export interface ChangeProposal {
  changeType: ReviewChangeType;
  risk: ReviewRisk;
  previousValues: Record<string, unknown>;
  proposedValues: Record<string, unknown>;
  /** Chiave di deduplicazione: lo stesso cambiamento non si propone due volte. */
  dedupeKey: string;
  notes: string;
}

/**
 * Il rischio per tipo di cambiamento.
 *
 * ⚠️ `deadline` è `critical` e non `high`: una scadenza sbagliata non produce
 * un'informazione imprecisa, produce una candidatura persa. È l'unico caso in
 * cui il danno è irreversibile per l'impresa.
 */
export const RISK_BY_CHANGE: Record<ReviewChangeType, ReviewRisk> = {
  deadline: 'critical',
  program_requirements: 'critical',
  program_exclusions: 'critical',
  availability: 'high',
  call_status: 'high',
  contribution: 'high',
  new_call: 'medium',
  new_program: 'medium',
  source_structure_changed: 'medium',
  source_unreachable: 'medium',
  program_metadata: 'low',
  other: 'low',
};

/**
 * ⚠️ I CAMPI CHE NON POSSONO ESSERE AGGIORNATI AUTOMATICAMENTE (§22).
 * Un cambiamento su uno di questi crea SEMPRE una revisione e non tocca mai la
 * versione pubblicata, qualunque cosa dica l'adapter.
 */
export const NEVER_AUTO_UPDATE: readonly string[] = [
  'requirements', 'exclusions', 'deadline_on', 'deadline_at',
  'contribution_description', 'contribution_rate', 'max_amount',
  'eligible_costs', 'availability', 'must_apply_before_start',
];

export function isAutoUpdatable(field: string): boolean {
  return !NEVER_AUTO_UPDATE.includes(field);
}

/** Confronta due mappe di campi normalizzati. Ordine irrilevante. */
export function diffFields(
  previous: Record<string, unknown>,
  proposed: Record<string, unknown>,
): FieldChange[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(proposed)]);
  const out: FieldChange[] = [];
  for (const k of [...keys].sort()) {
    const a = previous[k];
    const b = proposed[k];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      out.push({ field: k, previous: a ?? null, proposed: b ?? null });
    }
  }
  return out;
}

export interface DetectInput {
  sourceId: string;
  programId: string | null;
  previousHash: string | null;
  result: AdapterResult;
  /** Campi normalizzati dell'istantanea precedente, se c'è. */
  previousNormalized: Record<string, unknown>;
}

/**
 * Da un controllo di fonte alle proposte di revisione.
 *
 * ⚠️ RESTITUISCE UN ELENCO VUOTO QUANDO NULLA È CAMBIATO, e questo è il caso
 * normale: una fonte controllata ogni settimana cambia poche volte l'anno.
 * Creare una voce a ogni controllo trasformerebbe la coda delle revisioni in
 * rumore, e dopo tre giorni nessuno la guarderebbe più — che è il modo in cui
 * un controllo utile smette di esistere pur continuando a girare.
 */
export function detectChanges(input: DetectInput): ChangeProposal[] {
  const { result } = input;
  const out: ChangeProposal[] = [];

  if (!result.ok) {
    // §159 — una fonte che non risponde non aggiorna la freschezza e non
    // cancella nulla: si dichiara. La revisione serve a far vedere a qualcuno
    // che una fonte è caduta, prima che il dato invecchi in silenzio.
    out.push({
      changeType: 'source_unreachable',
      risk: RISK_BY_CHANGE.source_unreachable,
      previousValues: { lastHash: input.previousHash },
      proposedValues: { errorCode: result.errorCode ?? 'unknown', reason: result.reason ?? null },
      dedupeKey: `src:${input.sourceId}:unreachable:${result.errorCode ?? 'unknown'}`,
      notes: 'La fonte ufficiale non ha risposto. Il dato precedente resta visibile con la sua data di verifica.',
    });
    return out;
  }

  // 304 o impronta identica: non è cambiato niente.
  if (!result.contentHash || result.contentHash === input.previousHash) {
    return out;
  }

  // ⚠️ Le strutture non interpretate PRIMA del cambiamento di contenuto: se
  //    una pagina è diventata un'applicazione JavaScript, sapere che l'impronta
  //    è cambiata non serve — serve sapere che da lì non leggiamo più niente.
  const newlyUnsupported = result.unsupported.filter(
    (u) => !(Array.isArray(input.previousNormalized.unsupported)
      && (input.previousNormalized.unsupported as string[]).includes(u)),
  );
  if (newlyUnsupported.length) {
    out.push({
      changeType: 'source_structure_changed',
      risk: RISK_BY_CHANGE.source_structure_changed,
      previousValues: { unsupported: input.previousNormalized.unsupported ?? [] },
      proposedValues: { unsupported: result.unsupported },
      dedupeKey: `src:${input.sourceId}:structure:${newlyUnsupported.sort().join('|')}`,
      notes: 'La struttura della fonte è cambiata: alcune parti non sono più interpretabili automaticamente.',
    });
  }

  // ⚠️⚠️ `unsupported` ESCE DAL CONFRONTO DEI CAMPI, e non è un dettaglio di
  //    forma: è un campo FANTASMA che risultava cambiato a ogni controllo.
  //    L'istantanea lo conserva DENTRO `normalized`
  //    (`runSourceChecks`: `{ ...result.normalized, unsupported }`), mentre
  //    l'adapter lo restituisce accanto — quindi `diffFields` vedeva sempre un
  //    valore che «sparisce», su ogni fonte, per sempre.
  //
  //    Misurato il 2026-08-14 sulle fonti vere: la nota di `ti-lrilocc` diceva
  //    «1 campi normalizzati diversi» dove ne era cambiato **zero** (solo
  //    l'impronta: una modifica redazionale), e quella di `ti-linn` ne diceva
  //    due dove uno solo — `textLength` — si era mosso. Chi legge la coda
  //    decide su quel numero: gonfiarlo di uno trasforma «niente di sostanziale»
  //    in «qualcosa è cambiato», che è il modo più veloce per far smettere di
  //    fidarsi della coda.
  //
  //    Le strutture non interpretate NON perdono sorveglianza: hanno la loro
  //    proposta dedicata (`source_structure_changed`, qui sopra), che legge
  //    `previousNormalized.unsupported` apposta. Contarle due volte non era
  //    prudenza, era rumore.
  const { unsupported: _strutturePrecedenti, ...precedentiConfrontabili } = input.previousNormalized;
  const changes = diffFields(precedentiConfrontabili, result.normalized);
  const deadlineCandidates = result.evidence.filter((e) => e.field === 'deadline_candidate');

  // ⚠️ Una candidata di scadenza NON diventa una scadenza: diventa una
  //    revisione `critical` che una persona legge. §22 e §73 insieme.
  if (deadlineCandidates.length > 0) {
    out.push({
      changeType: 'deadline',
      risk: RISK_BY_CHANGE.deadline,
      previousValues: {},
      proposedValues: { candidates: deadlineCandidates.map((e) => e.quote) },
      // Nella chiave entra l'impronta del contenuto: la stessa pagina non
      // riapre la stessa revisione, una pagina modificata sì.
      dedupeKey: `src:${input.sourceId}:deadline:${result.contentHash.slice(0, 16)}`,
      notes: 'Nella fonte compaiono date che potrebbero essere termini di candidatura. Vanno lette e confermate: nessuna è stata scritta nel catalogo.',
    });
  }

  // ⚠️⚠️ SENZA UN'IMPRONTA PRECEDENTE NON C'È UN CAMBIAMENTO: C'È UNA PRIMA
  //    LETTURA. Fino al 2026-08-05 questa riga diceva «sempre registrato», e
  //    quel «sempre» ha prodotto le SETTE revisioni ferme dal 2026-07-30 —
  //    l'intera coda che il prodotto ha mostrato per una settimana.
  //
  //    Misurato riga per riga: in tutte e sette `previousHash` è **null** e
  //    `unsupported` era `true`, cioè l'adapter non sapeva ancora leggere quella
  //    pagina. `textLength`, `deadlineCandidateCount` e `declaredUpdatedAt` sono
  //    IDENTICI prima e dopo. L'unico campo normalizzato «diverso» era
  //    `unsupported` stesso. Quindi la nota «il contenuto della fonte è
  //    cambiato» era falsa: **non si è mossa la fonte, ha cominciato a
  //    funzionare il nostro lettore.**
  //
  //    Perché è un difetto e non un fastidio: la revisione chiede a una persona
  //    di confrontare «prima» e «adesso», e qui il «prima» non esiste. Confronto
  //    impossibile, decisione impossibile, coda che non si smaltisce. E una coda
  //    che nessuno smaltisce insegna a non guardarla — la fine di ogni controllo
  //    utile, come dice il commento in testa a questa funzione.
  //
  // ⚠️ Le altre proposte NON sono toccate: una candidata di scadenza o una
  //    struttura non interpretabile meritano una persona anche alla prima
  //    lettura, perché non sono confronti — sono cose da leggere.
  if (input.previousHash === null || input.previousHash === undefined) {
    return out;
  }

  // Il cambiamento di contenuto vero e proprio.
  out.push({
    changeType: input.programId ? 'program_metadata' : 'other',
    risk: RISK_BY_CHANGE.program_metadata,
    previousValues: { contentHash: input.previousHash, ...input.previousNormalized },
    proposedValues: { contentHash: result.contentHash, ...result.normalized, title: result.title },
    dedupeKey: `src:${input.sourceId}:content:${result.contentHash.slice(0, 16)}`,
    notes: changes.length
      ? `Il contenuto della fonte è cambiato (${changes.length} campi normalizzati diversi).`
      : 'L\'impronta del contenuto è cambiata senza differenze nei campi normalizzati: probabile modifica redazionale.',
  });

  return out;
}

/**
 * Il confronto fra l'istantanea con cui una pratica è nata e il catalogo di
 * oggi (§110).
 *
 * ⚠️ NON SOVRASCRIVE NULLA. Restituisce le differenze perché la schermata le
 * mostri accanto: la pratica continua a lavorare sui dati con cui è nata,
 * perché è con quelli che l'impresa ha preparato la candidatura.
 */
export function compareCaseSnapshot(
  snapshot: Record<string, unknown> | null,
  current: Record<string, unknown>,
): FieldChange[] {
  if (!snapshot) return [];
  const relevant = ['deadlineOn', 'deadlineAt', 'callStatus', 'versionNumber', 'availability', 'documentsRequired'];
  return diffFields(snapshot, current).filter((c) => relevant.includes(c.field));
}
