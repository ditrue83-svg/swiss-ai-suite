// ============================================================================
// La versione stampata di un'analisi — le decisioni PURE.
//
// Il caso d'uso è uno: una fiduciaria stampa (o esporta in PDF) l'analisi di un
// documento per metterla nel fascicolo del cliente. Da lì discende tutto ciò
// che sta qui dentro, e in particolare la regola che governa il file:
//
//   ⚠️ CIÒ CHE A SCHERMO È UN COMANDO, SU CARTA DEVE ESSERE UN TESTO.
//   «Mostra nel documento» è un pulsante: porta l'occhio sulla frase originale.
//   Stampato, quel pulsante non si può premere — e se la frase non è sul foglio
//   la verificabilità sparisce PROPRIO nel supporto che finisce in archivio,
//   cioè dove serviva di più. Per questo `collectCitations` esiste.
//
// Sta qui e non nel componente perché un errore in queste funzioni non si vede:
// una citazione che si perde non rompe niente, non colora niente di rosso, e
// produce un foglio che sembra completo. `npm run test:print-unit` le prova.
// ============================================================================
import type {
  AnalysisAmount, ChecklistAction, DocumentAnalysis, Evidence, LegalReference,
  ReferenceNumber, RequestedDocument, Risk,
} from '@/types/models';
import type { TKey } from '@/i18n';

/** Una citazione pronta per la carta: che cosa sostiene, e la frase testuale. */
export interface PrintCitation {
  /** Chiave i18n del campo che la citazione sostiene (mittente, scadenza…). */
  labelKey: TKey;
  /** Testo aggiuntivo che identifica l'elemento (l'azione, l'importo…). */
  subject: string | null;
  /** La frase del documento, per esteso. Mai troncata. */
  quote: string;
  /** Pagina di provenienza, quando l'analisi la conosce. */
  page: number | null;
}

const cite = (labelKey: TKey, subject: string | null, ev: Evidence | null | undefined): PrintCitation | null => {
  // ⚠️ Una citazione senza frase NON diventa una riga vuota: sparisce. Una voce
  // «Scadenza: —» in un elenco di citazioni fa credere che il documento non
  // dicesse nulla, quando invece è l'analisi a non averlo registrato.
  const quote = ev?.quote?.trim();
  if (!quote) return null;
  return { labelKey, subject, quote, page: ev?.pageNumber ?? null };
};

/**
 * Tutte le citazioni dell'analisi, in un ordine stabile: prima ciò che
 * identifica il documento, poi ciò che ne deriva.
 *
 * ⚠️ L'ordine è FISSO e non dipende dall'oggetto: due stampe dello stesso
 * documento devono produrre lo stesso foglio, o il confronto fra due copie in
 * un fascicolo diventa impossibile.
 */
export function collectCitations(a: Pick<DocumentAnalysis,
  'senderEvidence' | 'deadlineEvidence' | 'amountEvidence' | 'actions' |
  'requestedDocuments' | 'amounts' | 'referenceNumbers' | 'legalReferences' | 'risks'>): PrintCitation[] {
  const out: (PrintCitation | null)[] = [
    cite('print.cite.sender', null, a.senderEvidence),
    cite('print.cite.deadline', null, a.deadlineEvidence),
    cite('print.cite.amount', null, a.amountEvidence),
  ];
  for (const am of (a.amounts ?? []) as AnalysisAmount[]) out.push(cite('print.cite.amount', am.description || am.display, am.evidence));
  for (const ac of (a.actions ?? []) as ChecklistAction[]) out.push(cite('print.cite.action', ac.text, ac.evidence));
  for (const rd of (a.requestedDocuments ?? []) as RequestedDocument[]) out.push(cite('print.cite.requestedDocument', rd.label, rd.evidence));
  for (const rf of (a.referenceNumbers ?? []) as ReferenceNumber[]) out.push(cite('print.cite.reference', `${rf.label ? `${rf.label}: ` : ''}${rf.value}`, rf.evidence));
  for (const lg of (a.legalReferences ?? []) as LegalReference[]) out.push(cite('print.cite.legal', lg.text, lg.evidence));
  for (const rk of (a.risks ?? []) as Risk[]) out.push(cite('print.cite.risk', rk.text, rk.evidence));

  const seen = new Set<string>();
  const citations: PrintCitation[] = [];
  for (const c of out) {
    if (!c) continue;
    // La stessa frase può sostenere due campi (la riga che porta insieme
    // scadenza e importo). Si stampa UNA volta: un fascicolo con la stessa
    // citazione ripetuta tre volte non è più verificabile, è più lungo.
    const key = `${c.labelKey}|${c.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push(c);
  }
  return citations;
}

/**
 * Le azioni divise per PROVENIENZA, che è la distinzione che conta su carta:
 * «lo chiede il documento» e «lo suggeriamo noi» non hanno lo stesso peso
 * davanti a un cliente, e confonderle è il modo in cui un suggerimento nostro
 * diventa un obbligo dell'autorità.
 */
export function splitActions(actions: ChecklistAction[] | null | undefined): {
  requested: ChecklistAction[];
  suggested: ChecklistAction[];
} {
  const list = actions ?? [];
  return {
    requested: list.filter((a) => a.sourceType === 'extracted'),
    suggested: list.filter((a) => a.sourceType !== 'extracted'),
  };
}

/**
 * Il tipo della scadenza, come etichetta traducibile.
 *
 * ⚠️ «Da verificare» VINCE su tutto: se l'analisi dice che la data va
 * controllata alla fonte, stamparla come esplicita sarebbe la bugia più cara di
 * questo foglio — una scadenza che sembra accertata dentro un fascicolo.
 */
export function deadlineKindKey(a: Pick<DocumentAnalysis, 'deadline' | 'deadlineType' | 'deadlineRequiresVerification'>): TKey | null {
  if (!a.deadline) return null;
  if (a.deadlineRequiresVerification) return 'print.deadline.toVerify';
  if (a.deadlineType === 'relative') return 'print.deadline.relative';
  if (a.deadlineType === 'explicit') return 'print.deadline.explicit';
  // Tipo non dichiarato: non si sceglie per lui. Nessuna etichetta è meglio di
  // una etichetta inventata.
  return null;
}

/** Chiave dell'etichetta per il tipo di importo (§12). */
export function amountTypeKey(type: string | null | undefined): TKey | null {
  if (!type) return null;
  const known = ['due', 'fine', 'fee', 'contribution', 'other'];
  return known.includes(type) ? (`print.amountType.${type}` as TKey) : null;
}

/** Dati del piè di pagina: chi, quando, con che cosa — e il limite. */
export interface PrintFooter {
  companyName: string;
  /** Istante della stampa, ISO. Lo formatta la schermata nella lingua attiva. */
  printedAt: string;
  /** Modello che ha prodotto l'analisi, o il motore locale. */
  model: string | null;
  /** Versione dell'analisi, come la dichiara lo snapshot. */
  version: string | null;
}

/**
 * ⚠️ Il modello e la versione si LEGGONO dallo snapshot, non si presumono. Un
 * foglio d'archivio che dichiara un modello sbagliato è peggio di uno che non
 * lo dichiara: il secondo si può ancora ricostruire, il primo no.
 */
export function buildFooter(input: {
  companyName: string | null | undefined;
  now: Date;
  model?: string | null;
  engine?: string | null;
  analysisVersion?: number | null;
  promptVersion?: string | null;
}): PrintFooter {
  const model = input.model?.trim() || input.engine?.trim() || null;
  const parts: string[] = [];
  if (typeof input.analysisVersion === 'number') parts.push(`v${input.analysisVersion}`);
  if (input.promptVersion?.trim()) parts.push(input.promptVersion.trim());
  return {
    companyName: input.companyName?.trim() || '',
    printedAt: input.now.toISOString(),
    model,
    version: parts.length > 0 ? parts.join(' · ') : null,
  };
}

/**
 * Le citazioni di un CONTRATTO.
 *
 * L'estrazione tiene le citazioni in `evidence`, una mappa `campo → frase`, con
 * i nomi dei campi in snake_case come li scrive `fieldsFromReading`. Qui
 * diventano righe leggibili accanto all'etichetta che la scheda usa già a
 * schermo: un fascicolo non deve contenere `notice_period`.
 *
 * ⚠️ Un campo SCONOSCIUTO non viene scartato e non riceve un'etichetta
 * inventata: si stampa col suo nome tecnico come soggetto. Perdere una
 * citazione perché è comparso un campo nuovo sarebbe il difetto peggiore
 * proprio qui — la citazione è la ragione per cui questo foglio esiste.
 */
export const CONTRACT_EVIDENCE_LABELS: Record<string, TKey> = {
  counterparty: 'contracts.detail.fields.counterparty',
  company_party: 'contracts.detail.fields.companyParty',
  start_date: 'contracts.detail.fields.start',
  end_date: 'contracts.detail.fields.end',
  minimum_term: 'contracts.detail.fields.minimumTerm',
  renewal_period: 'contracts.detail.fields.renewalPeriod',
  notice_period: 'contracts.detail.fields.noticePeriod',
  cost_amount: 'contracts.detail.fields.cost',
  termination_method: 'contracts.detail.fields.terminationMethod',
};

export function contractCitations(
  evidence: Record<string, { quote: string; page?: number | null }> | null | undefined,
): PrintCitation[] {
  if (!evidence) return [];
  const out: PrintCitation[] = [];
  // Ordine stabile: l'elenco delle citazioni non deve cambiare fra due stampe
  // dello stesso contratto solo perché l'oggetto ha un altro ordine di chiavi.
  for (const field of Object.keys(evidence).sort()) {
    const ev = evidence[field];
    const quote = ev?.quote?.trim();
    if (!quote) continue;
    const known = CONTRACT_EVIDENCE_LABELS[field];
    out.push({
      labelKey: known ?? 'print.cite.contractField',
      subject: known ? null : field,
      quote,
      page: ev?.page ?? null,
    });
  }
  return out;
}
