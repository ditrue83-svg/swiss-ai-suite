// ============================================================================
// Mappatura del risultato AI → EngineAnalysis (la forma che la UI già conosce).
//
// Qui vive la garanzia di prodotto: ogni citazione prodotta dal modello viene
// VERIFICATA contro il testo reale del documento. Se non la si ritrova:
//   - l'evidence viene scartata (non mostriamo mai una citazione non verificabile);
//   - un'azione dichiarata "extracted" viene declassata a "suggested";
//   - un rischio dichiarato "explicit" viene declassato a "possible".
// Così una citazione allucinata non può presentarsi all'utente come prova.
// ============================================================================
import type { ChecklistAction, Confidence, DocLanguage, Evidence, RequestedDocument, Risk } from '@/types/models';
import { LANG_LABEL, DOC_TYPE_LABEL, deadlineLevel, daysUntil, urgencyFromType, type EngineAnalysis } from './engine';
import { formatCurrency } from '@/lib/format';

export interface AiAnalysisPayload {
  language: DocLanguage;
  documentType: string;
  sender: string | null;
  senderEvidence: string | null;
  deadline: string | null;
  deadlineEvidence: string | null;
  amount: number | null;
  amountCurrency: string | null;
  amountEvidence: string | null;
  summary: string;
  actions: { text: string; sourceType: 'extracted' | 'suggested'; evidence: string | null }[];
  requestedDocuments: { label: string; evidence: string | null }[];
  risk: { text: string; level: 'explicit' | 'possible' | 'unknown'; evidence: string | null };
  uncertainties: string[];
  confidence: Confidence;
  replyDraft: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Ritrova una citazione nel testo originale e ne calcola gli offset.
 * Tollera differenze di spaziatura (i PDF spezzano spesso le righe) ma NON
 * inventa: se la frase non c'è, ritorna null. L'offset non viene mai preso
 * dal modello, sempre ricalcolato qui.
 */
export function locateQuote(text: string, quote: string | null | undefined): Evidence | null {
  if (!quote) return null;
  const q = quote.trim();
  if (q.length < 4) return null;

  let i = text.indexOf(q);
  if (i >= 0) return { quote: text.slice(i, i + q.length), start: i, end: i + q.length };

  i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i >= 0) return { quote: text.slice(i, i + q.length), start: i, end: i + q.length };

  // Tolleranza sugli spazi bianchi (a capo, spazi multipli).
  try {
    const pattern = q.split(/\s+/).filter(Boolean).map(escapeRe).join('\\s+');
    const m = new RegExp(pattern, 'i').exec(text);
    if (m && m.index >= 0) return { quote: m[0], start: m.index, end: m.index + m[0].length };
  } catch { /* pattern non valido: trattiamo come non trovata */ }

  return null;
}

const isIsoDate = (s: string | null): s is string => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  return !Number.isNaN(d.getTime());
};

/** Converte la risposta AI (già validata dallo schema) nella forma del motore. */
export function aiPayloadToEngineAnalysis(payload: AiAnalysisPayload, originalText: string): EngineAnalysis {
  let droppedCitations = 0;
  const locate = (q: string | null): Evidence | null => {
    if (!q) return null;
    const found = locateQuote(originalText, q);
    if (!found) droppedCitations++;
    return found;
  };

  const uncertainties = [...(payload.uncertainties ?? [])];

  // Scadenza: accettata solo se in formato valido.
  let deadline: string | null = null;
  if (payload.deadline) {
    if (isIsoDate(payload.deadline)) deadline = payload.deadline;
    else uncertainties.push('Data di scadenza proposta dal modello in formato non valido: verificare manualmente');
  }
  const days = daysUntil(deadline);
  const documentType = payload.documentType || 'informativa';

  const senderEvidence = locate(payload.senderEvidence);
  const deadlineEvidence = locate(payload.deadlineEvidence);
  const amountEvidence = locate(payload.amountEvidence);

  // Azioni: "extracted" resta tale solo se la citazione è verificata.
  const actions: ChecklistAction[] = (payload.actions ?? []).map((a, i) => {
    const evidence = locate(a.evidence);
    const sourceType = a.sourceType === 'extracted' && evidence ? 'extracted' : 'suggested';
    return { id: i, text: a.text, done: false, sourceType, evidence: sourceType === 'extracted' ? evidence : null };
  });

  const requestedDocuments: RequestedDocument[] = (payload.requestedDocuments ?? []).map((d) => ({
    label: d.label,
    evidence: locate(d.evidence),
  }));

  // Rischio: "explicit" richiede una citazione verificata.
  const riskEvidence = locate(payload.risk?.evidence ?? null);
  const riskLevel: Risk['level'] =
    payload.risk?.level === 'explicit' && !riskEvidence ? 'possible' : (payload.risk?.level ?? 'unknown');
  const risk: Risk = {
    text: payload.risk?.text ?? 'Non determinabile dal documento.',
    level: riskLevel,
    evidence: riskLevel === 'explicit' ? riskEvidence : null,
  };

  if (droppedCitations > 0) {
    uncertainties.push(
      `${droppedCitations} citazione/i proposte dal modello non sono state ritrovate nel documento e sono state scartate`,
    );
  }
  if (!deadline) uncertainties.push('Nessuna scadenza esplicita confermata nel testo');

  const language = (payload.language ?? 'it') as DocLanguage;

  return {
    language,
    languageLabel: LANG_LABEL[language] ?? language,
    sender: payload.sender,
    senderUncertain: !payload.sender,
    senderEvidence,
    documentType,
    documentTypeLabel: DOC_TYPE_LABEL[documentType] ?? documentType,
    urgency: urgencyFromType(documentType, days),
    deadline,
    deadlineLevel: deadlineLevel(days),
    daysToDeadline: days,
    deadlineEvidence,
    amount: payload.amount ?? null,
    amountCurrency: payload.amountCurrency ?? (payload.amount != null ? 'CHF' : null),
    amountDisplay: formatCurrency(payload.amount, payload.amountCurrency ?? 'CHF'),
    amountEvidence,
    summary: payload.summary ?? '',
    actions,
    primaryAction: actions[0]?.text ?? null,
    primaryActionSource: actions[0]?.sourceType ?? 'suggested',
    requestedDocuments,
    risk,
    uncertainties: Array.from(new Set(uncertainties)),
    confidence: (payload.confidence ?? 'media') as Confidence,
    replyDraft: payload.replyDraft ?? '',
    replyLanguage: language,
    replyTone: 'formale',
  };
}
