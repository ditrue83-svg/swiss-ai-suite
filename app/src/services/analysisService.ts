// ============================================================================
// analysisService — orchestrazione dell'analisi documenti.
// La UI chiama analyzeAndPersist()/getForDocument() SENZA sapere se il
// risultato viene dal motore deterministico o (in futuro) da un LLM: basta
// sostituire `runEngine` con una chiamata a un servizio AI, la forma resta.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import { formatCurrency } from '@/lib/format';
// ⚠️ `document_analyses.deadline` è una colonna `date` (0002): il conto dei
// giorni è di CALENDARIO, non una differenza di istanti.
import { calendarDaysUntil } from '@/lib/calendarDays';
import { ANALYSIS_PROVIDER } from '@/lib/env';
import { translate as tr, type TKey } from '@/i18n';
import {
  analyzeText, buildReply, deadlineLevel, urgencyFromType,
  LANG_LABEL, DOC_TYPE_LABEL, type EngineAnalysis,
} from '@/features/admin-ai/engine';
import { deadlineRequiresVerification } from '../../supabase/functions/_shared/deadlineNature.ts';
import { invokeAnalyze, DETERMINISTIC_ENGINE } from './analysisProviders';
import { documentService } from './documentService';
import type { ClientExtraction } from '@/features/admin-ai/pdf';
import type {
  AnalysisAmount, AnalysisStatus, AnalysisUncertainty, ChecklistAction, Confidence, DocumentAnalysis,
  DocumentRecord, Evidence, LegalReference, ReferenceNumber, RequestedDocument, Risk, Urgency,
} from '@/types/models';
import type { Database, Json } from '@/types/database';

type AnalysisRow = Database['public']['Tables']['document_analyses']['Row'];

// ---- Mapping domain <-> DB --------------------------------------------------
function engineToInsert(
  e: EngineAnalysis,
  documentId: string,
  companyId: string,
  engine: string,
): Database['public']['Tables']['document_analyses']['Insert'] {
  return {
    document_id: documentId,
    company_id: companyId,
    analysis_version: 2,
    engine,
    language: e.language,
    sender: e.sender,
    sender_evidence: (e.senderEvidence as unknown as Json) ?? null,
    document_type: e.documentType,
    deadline: e.deadline,
    deadline_evidence: (e.deadlineEvidence as unknown as Json) ?? null,
    amount: e.amount,
    amount_currency: e.amountCurrency,
    amount_evidence: (e.amountEvidence as unknown as Json) ?? null,
    summary: e.summary,
    actions: e.actions as unknown as Json,
    requested_documents: e.requestedDocuments as unknown as Json,
    risks: e.risk as unknown as Json,
    uncertainties: e.uncertainties as unknown as Json,
    confidence: e.confidence,
    // 0010 — reply_draft/reply_language/reply_tone sono deprecate e non si
    // scrivono più: la bozza vive in document_replies (vedi replyService).
  };
}

/** ⚠️ Esportata per il BANCO di prova (.temp): il banco serve dati veri
 *  esportati e deve mapparli col mapper VERO, non con una copia che diverge.
 *  Il prodotto continua a usarla solo da qui dentro. */
export function rowToDomain(row: AnalysisRow): DocumentAnalysis {
  const days = calendarDaysUntil(row.deadline);
  const docType = row.document_type ?? 'informativa';
  const actions = (Array.isArray(row.actions) ? row.actions : []) as unknown as ChecklistAction[];
  const requested = (Array.isArray(row.requested_documents) ? row.requested_documents : []) as unknown as RequestedDocument[];
  // §17 — le incertezze possono essere righe testuali (dati storici) oppure
  // oggetti con gravità (formato attuale): si accettano entrambi.
  const rawUnc = (Array.isArray(row.uncertainties) ? row.uncertainties : []) as unknown[];
  const uncertaintyItems: AnalysisUncertainty[] = rawUnc.map((u) => {
    if (typeof u === 'string') return { field: 'generale', description: u, severity: 'medium' as const };
    const o = u as { field?: unknown; description?: unknown; severity?: unknown };
    const sev = o?.severity === 'high' || o?.severity === 'low' ? o.severity : 'medium';
    return {
      field: typeof o?.field === 'string' ? o.field : 'generale',
      description: typeof o?.description === 'string' ? o.description : '',
      severity: sev as AnalysisUncertainty['severity'],
    };
  }).filter((u) => u.description);
  const uncertainties = uncertaintyItems.map((u) => u.description);

  // §16 — `risks` può essere un oggetto singolo (dati storici) o un array (attuale).
  const NO_RISK: Risk = { text: tr('errors.notDeterminable'), level: 'unknown', evidence: null };
  const rawRisks = row.risks as unknown;
  const risks: Risk[] = Array.isArray(rawRisks)
    ? (rawRisks as unknown as Risk[]).filter((r) => r && typeof r.text === 'string' && r.text)
    : (rawRisks ? [rawRisks as unknown as Risk] : []);
  const risk = risks[0] ?? NO_RISK;
  const confidence = (row.confidence as Confidence) ?? 'bassa';
  const urgency: Urgency = urgencyFromType(docType, days);

  // §20/§31 — usa una citazione ricca solo se VERIFICATA (offset validi); altrimenti niente evidenza.
  const richEvidence = (e: unknown): Evidence | null => {
    const ev = e as { quote?: unknown; verified?: unknown; start?: unknown; end?: unknown; pageNumber?: unknown } | null;
    if (!ev || typeof ev.quote !== 'string' || ev.verified === false) return null;
    if (typeof ev.start !== 'number' || typeof ev.end !== 'number') return null;
    return { quote: ev.quote, start: ev.start, end: ev.end, pageNumber: typeof ev.pageNumber === 'number' ? ev.pageNumber : null };
  };
  const amounts: AnalysisAmount[] = (Array.isArray(row.amounts) ? row.amounts : [])
    .map((a) => a as { amount?: unknown; currency?: unknown; type?: unknown; description?: unknown; evidence?: unknown })
    .filter((a) => typeof a.amount === 'number' && Number.isFinite(a.amount))
    .map((a) => {
      // Nessun ripiego a 'CHF': la valuta assente resta assente fino a schermo
      // (vedi `formatCurrency`). Inventarla qui rimetterebbe in circolo il dato
      // falso appena tolto dal validatore.
      const cur = typeof a.currency === 'string' ? a.currency : null;
      return {
        amount: a.amount as number, currency: cur,
        type: typeof a.type === 'string' ? a.type : 'other',
        description: typeof a.description === 'string' ? a.description : '',
        display: formatCurrency(a.amount as number, cur) ?? '',
        evidence: richEvidence(a.evidence),
      };
    });
  const referenceNumbers: ReferenceNumber[] = (Array.isArray(row.reference_numbers) ? row.reference_numbers : [])
    .map((r) => r as { label?: unknown; value?: unknown; evidence?: unknown })
    .filter((r) => typeof r.value === 'string' && r.value)
    .map((r) => ({ label: typeof r.label === 'string' ? r.label : '', value: r.value as string, evidence: richEvidence(r.evidence) }));
  const legalReferences: LegalReference[] = (Array.isArray(row.legal_references) ? row.legal_references : [])
    .map((l) => l as { text?: unknown; evidence?: unknown })
    .filter((l) => typeof l.text === 'string' && l.text)
    .map((l) => ({ text: l.text as string, evidence: richEvidence(l.evidence) }));

  return {
    id: row.id,
    documentId: row.document_id,
    companyId: row.company_id,
    analysisVersion: row.analysis_version,
    schemaVersion: row.schema_version ?? 1,
    engine: row.engine,
    language: row.language,
    // §42 — come per il tipo di documento, l'etichetta della lingua segue la
    // lingua scelta: LANG_LABEL è italiano fisso («Tedesco», «Italiano») e
    // finiva così nell'archivio e nella dashboard anche in de e fr.
    languageLabel: (() => {
      if (!row.language) return '—';
      const k = `labels.languages.${row.language}` as TKey;
      const out = tr(k);
      return out === k ? (LANG_LABEL[row.language] ?? row.language) : out;
    })(),
    sender: row.sender,
    senderUncertain: !row.sender,
    senderEvidence: (row.sender_evidence as unknown as Evidence) ?? null,
    documentType: row.document_type,
    // §42 — l'etichetta segue la lingua scelta; se il tipo non è previsto si
    // mostra il valore grezzo invece di inventarne uno.
    documentTypeLabel: (() => {
      const k = `labels.docTypes.${docType}` as TKey;
      const out = tr(k);
      return out === k ? (DOC_TYPE_LABEL[docType] ?? docType) : out;
    })(),
    urgency,
    deadline: row.deadline,
    deadlineLevel: deadlineLevel(days),
    daysToDeadline: days,
    deadlineEvidence: (row.deadline_evidence as unknown as Evidence) ?? null,
    amount: row.amount,
    amountCurrency: row.amount_currency,
    amountDisplay: formatCurrency(row.amount, row.amount_currency),
    amountType: row.amount_type ?? null,
    amountEvidence: (row.amount_evidence as unknown as Evidence) ?? null,
    summary: row.summary,
    actions,
    primaryAction: actions[0]?.text ?? null,
    primaryActionSource: actions[0]?.sourceType ?? 'suggested',
    requestedDocuments: requested,
    risk,
    risks,
    uncertainties,
    uncertaintyItems,
    confidence,
    recipient: row.recipient ?? null,
    subject: row.subject ?? null,
    documentDate: row.document_date ?? null,
    senderAuthorityType: row.sender_authority_type ?? null,
    amounts,
    referenceNumbers,
    legalReferences,
    deadlineType: row.deadline_type ?? null,
    // ⚠️ NON è la colonna tale e quale. Il flag grezzo dice ciò che il
    // validatore sapeva IL GIORNO IN CUI HA SCRITTO; questa riga ci somma ciò
    // che si constata OGGI leggendola — se la natura della data non è mai stata
    // dichiarata, quella scadenza non è un fatto. Senza, le analisi anteriori al
    // 2026-08-15 continuerebbero a mostrare «●●● alta» su date che potrebbero
    // essere sopralluoghi. La regola sta in `deadlineNature.ts`, una volta sola.
    // ⚠️ QUI MANCA IL TERZO INGRESSO, `corrected`, E NON PER DIMENTICANZA:
    // `document_analyses` non ha una colonna di correzione. Le correzioni
    // vivono in `analysis_corrections` — un fatto a parte, perché l'analisi è
    // un verbale immutabile (0010) — e la riga `deadline_corrected` la compone
    // la RPC `list_documents`, che è ciò che legge `documentHubService`.
    // Passare `corrected: false` da qui sarebbe scrivere «nessuno l'ha
    // corretta» dove il vero valore è «da questa riga non si può sapere».
    //
    // Non è una lacuna scoperta: le due schermate che leggono QUESTO oggetto
    // sono `admin-ai/ResultView` e la stampa, e mostrano un'analisi appena
    // prodotta — dove una correzione non può ancora esistere. La scheda del
    // documento legge `item`, non questo, e là l'ingresso c'è.
    deadlineRequiresVerification: deadlineRequiresVerification({
      deadline: row.deadline,
      deadlineKind: row.deadline_kind,
      storedFlag: row.deadline_requires_verification ?? false,
    }),
    deadlineKind: row.deadline_kind ?? null,
    deadlineSourceText: row.deadline_source_text ?? null,
    appointmentDate: row.appointment_date ?? null,
    appointmentEvidence: (row.appointment_evidence as unknown as Evidence) ?? null,
    appointmentSourceText: row.appointment_source_text ?? null,
    overallConfidence: row.overall_confidence ?? null,
    // §25/§46 — l'esito tecnico arriva fino alla UI: un'analisi fallita non
    // deve mai essere resa come un risultato valido.
    analysisStatus: (row.analysis_status as AnalysisStatus | null) ?? 'completed',
    errorCode: row.error_code ?? null,
    errorMessageSafe: row.error_message_safe ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface AnalyzeInput {
  document: DocumentRecord;
  /** §42 — lingua dell'interfaccia: i testi generati dall'AI la seguono. */
  outputLanguage?: string;
  /** testo estratto lato client; null → il server fa l'OCR (solo modalità AI). */
  extraction: ClientExtraction | null;
  /**
   * §28 — il server rilegge la PROPRIA riga di estrazione invece di ricevere il
   * testo dal client. Vale solo con `extraction: null`, e serve alla rianalisi
   * di un documento già letto: rimandare indietro il testo salvato faceva
   * riscrivere `extraction_method` (l'OCR tornava indietro come «testo del PDF»)
   * e riportava `truncated` a `false` su un testo già tagliato.
   */
  reuseStoredExtraction?: boolean;
  companyName: string | null;
  /** §25 — avanzamento leggibile per la UI (stati reali, nessuna percentuale finta). */
  onProgress?: (step: string) => void;
}

/**
 * §25 — etichette degli stati del documento durante l'elaborazione.
 *
 * È una FUNZIONE e non una mappa di costanti: come mappa, `tr()` veniva
 * eseguito all'import del modulo, cioè prima che il provider avesse impostato
 * la lingua, e i passaggi restavano nella lingua iniziale per tutta la sessione
 * anche dopo il cambio. Qui la traduzione avviene quando serve.
 */
const STATUS_KEY: Record<string, TKey> = {
  uploaded: 'adminAi.progressPreparing',
  extracting: 'adminAi.extracting',
  processing: 'adminAi.extracting',
  analyzing: 'adminAi.progressAnalyzing',
};
function stepLabel(status: string | null): string {
  const key = STATUS_KEY[status ?? ''];
  return key ? tr(key) : tr('adminAi.progressGeneric');
}

/**
 * Il guasto dell'analisi, nella lingua di chi legge.
 *
 * ⚠️⚠️ PERCHÉ ESISTE (trovato il 2026-07-29). `error_message_safe` lo scrive il
 * server prendendolo da `ERROR_MESSAGES`, che è **in italiano fisso**: un utente
 * germanofono leggeva una frase italiana in mezzo a un'interfaccia tedesca.
 * La chiave `errors.errorCreditExhausted` era stata scritta nei TRE dizionari il
 * 2026-07-29 e non veniva usata da nessuno — la stessa trappola già annotata per
 * `home.module` e `amountsFound`: la traduzione c'era, il collegamento no.
 *
 * ⚠️ SI TRADUCONO SOLO I CODICI CHE QUESTA MAPPA CONOSCE. Per tutti gli altri
 * resta il messaggio del server: è il valore GREZZO invece di una categoria
 * inventata, che è la regola di governance. Aggiungere qui una voce senza la
 * chiave nei dizionari romperebbe il typecheck, ed è voluto.
 */
const ERROR_KEY: Record<string, TKey> = {
  AI_CREDIT_EXHAUSTED: 'adminAi.result.errorCreditExhausted',
  AI_OUTPUT_TRUNCATED: 'adminAi.result.errorOutputTruncated',
};
function messaggioDiErrore(code: unknown, serverMessage: unknown): string {
  const key = typeof code === 'string' ? ERROR_KEY[code] : undefined;
  if (key) return tr(key);
  return typeof serverMessage === 'string' && serverMessage
    ? serverMessage
    : tr('errors.analysisFailed');
}

/** §26 — attende il completamento dell'elaborazione server-side osservando il DB. */
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 4 * 60 * 1000;

async function waitForCompletion(documentId: string, onProgress?: (s: string) => void): Promise<string> {
  const sb = requireSupabase();
  const started = Date.now();
  let lastStep = '';
  for (;;) {
    const { data } = await sb.from('documents').select('status').eq('id', documentId).maybeSingle();
    const status = data?.status ?? null;

    if (status === 'failed') {
      // ⚠️ `.order().limit(1)` e non `.maybeSingle()` da solo: da quando
      // `saveAnalysis` non cancella più le analisi precedenti (per non portarsi
      // via correzioni e spunte in cascata), un documento rianalizzato ha più
      // righe. `maybeSingle()` su più righe non solleva qui — restituisce un
      // errore che questa destrutturazione ignora — e l'utente riceverebbe il
      // messaggio generico al posto della causa vera del fallimento.
      const { data: an } = await sb.from('document_analyses')
        .select('error_code, error_message_safe').eq('document_id', documentId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      throw new AppError(messaggioDiErrore(an?.error_code, an?.error_message_safe));
    }
    if (status === 'completed' || status === 'needs_review' || status === 'analyzed') {
      return status === 'needs_review' ? 'needs_review' : 'completed';
    }

    const step = stepLabel(status);
    if (step !== lastStep) { lastStep = step; onProgress?.(step); }

    if (Date.now() - started > POLL_TIMEOUT_MS) {
      throw new AppError(tr('errors.analysisTooLong'));
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

export interface AnalyzeOutcome {
  analysis: DocumentAnalysis;
  /** stato risultante dell'analisi: 'completed' | 'needs_review' (§25). */
  status: string;
}

export const analysisService = {
  /**
   * Analizza e PERSISTE. In modalità 'ai' l'estrazione/analisi/persistenza avvengono
   * server-side (Edge Function) e qui si RILEGGE dal DB (fonte di verità). In modalità
   * 'deterministic' (§60, motore locale esplicito) si esegue e persiste qui. La forma
   * del risultato è identica: la UI non deve distinguere i due percorsi.
   */
  async analyzeAndPersist({ document, extraction, reuseStoredExtraction, companyName, onProgress, outputLanguage }: AnalyzeInput): Promise<AnalyzeOutcome> {
    const sb = requireSupabase();

    if (ANALYSIS_PROVIDER === 'deterministic') {
      if (!extraction) {
        throw new AppError(tr('errors.deterministicNoImages'));
      }
      const engineResult = analyzeText(extraction.fullText, { companyName });
      // 0010 — niente delete: il client non può più cancellare un'analisi.
      // Le rianalisi si accumulano e vince la più recente (getForDocument ordina
      // per created_at, listForCompany tiene solo l'ultima per documento).
      const { data, error } = await sb
        .from('document_analyses')
        .insert(engineToInsert(engineResult, document.id, document.companyId, DETERMINISTIC_ENGINE))
        .select('*')
        .single();
      if (error || !data) throw new AppError(toUserMessage(error), error);
      await sb.from('documents').update({ status: 'analyzed' }).eq('id', document.id);
      const domain = rowToDomain(data);
      domain.originalText = extraction.fullText;
      return { analysis: domain, status: 'completed' };
    }

    // Percorso AI: la Edge Function estrae (o fa OCR), analizza e persiste.
    // §26 — richiesta asincrona: auth/autorizzazione/validazione restano sincrone
    // (401/403/422/429 arrivano subito), poi si osserva lo stato reale sul DB.
    // Se il runtime non supporta il background, il server risponde già completo.
    const invoked = await invokeAnalyze(document.id, extraction, { async: true, outputLanguage, reuseStoredExtraction });
    const status = invoked.status === 'processing'
      ? await waitForCompletion(document.id, onProgress)
      : invoked.status;

    const analysis = await analysisService.getForDocument(document.id);
    if (!analysis) throw new AppError(tr('errors.analysisUnavailable'));
    // Testo + pagine per il viewer (§31): l'estrazione client se presente, altrimenti quella salvata (OCR).
    if (extraction) {
      analysis.originalText = extraction.fullText;
      analysis.pages = extraction.pages;
    } else {
      const ext = await documentService.getExtraction(document.id);
      analysis.originalText = ext?.fullText ?? null;
      analysis.pages = ext?.pages ?? null;
    }
    return { analysis, status };
  },

  // ⚠️ `listForCompany()` È STATA RIMOSSA IL 2026-08-15, e non sostituita.
  // Leggeva tutte le analisi dell'azienda filtrando la sola `company_id` per
  // dare i grafici alla Panoramica. `document_analyses` non conosce
  // `archived_at` — non nomina nemmeno la tabella `documents` — quindi quei
  // conteggi comprendevano gli archiviati: su Rossi SA la Panoramica diceva
  // «19 documenti» e l'archivio «2 di 2». I conteggi partono ora da
  // `documents` con l'analisi agganciata accanto (`documentHubService.stats`),
  // che è l'unico verso in cui un documento mai analizzato resta visibile.
  // Non è dead code tolto per pulizia: finché la funzione esiste, il difetto
  // ha un modo comodo di rientrare.

  /**
   * Analisi del documento. Se l'ULTIMO tentativo è fallito ma esiste un'analisi
   * valida precedente, restituisce quella valida marcando `lastAttemptFailed`:
   * un fallimento non deve né essere spacciato per risultato né far sparire
   * un'analisi buona già ottenuta (§27/§53).
   */
  async getForDocument(documentId: string): Promise<DocumentAnalysis | null> {
    const { data, error } = await requireSupabase()
      .from('document_analyses')
      .select('*')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) throw new AppError(toUserMessage(error), error);
    const rows = data ?? [];
    if (!rows.length) return null;

    const latest = rowToDomain(rows[0]);
    if (latest.analysisStatus !== 'failed') return latest;

    const goodRow = rows.find((r) => r.analysis_status !== 'failed');
    if (!goodRow) return latest;                    // nessun risultato valido: si mostra il fallimento

    const good = rowToDomain(goodRow);
    good.lastAttemptFailed = true;
    good.lastAttemptError = latest.errorMessageSafe;
    return good;
  },

  // 0010 — updateActions() e updateReplyDraft() sono state RIMOSSE, non
  // sostituite altrove con lo stesso effetto: scrivevano su document_analyses e
  // per esistere richiedevano il permesso di update sull'intera riga, cioè anche
  // su scadenza, mittente e importi. Ora:
  //   · spunte della checklist → actionProgressService.setDone()
  //   · bozza di risposta       → replyService.saveLocalDraft() / saveEdit()

  /** Rigenera la bozza dal template (per il pulsante "Ripristina bozza"). */
  regenerateReply(analysis: DocumentAnalysis, language: string, tone: string, companyName: string | null): string {
    return buildReply(language, analysis.documentType ?? 'informativa', analysis.amountDisplay, companyName, tone);
  },
};
