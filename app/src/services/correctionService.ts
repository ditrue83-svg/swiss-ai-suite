// ============================================================================
// correctionService — revisione umana dei dati estratti (§34).
// L'analisi AI resta IMMUTABILE: ogni correzione è un record append-only in
// analysis_corrections, tracciato (chi, quando, valore AI originale → corretto).
// La UI mostra il valore corretto "accanto" a quello dell'AI, non lo sovrascrive.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import type { Database, Json } from '@/types/database';
import type { AnalysisCorrection } from '@/types/models';

type Row = Database['public']['Tables']['analysis_corrections']['Row'];

function toCorrection(row: Row): AnalysisCorrection {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    documentId: row.document_id,
    companyId: row.company_id,
    field: row.field,
    originalAiValue: row.original_ai_value,
    correctedValue: row.corrected_value,
    correctedBy: row.corrected_by,
    correctedAt: row.corrected_at,
  };
}

export interface SaveCorrectionInput {
  analysisId: string;
  documentId: string;
  companyId: string;
  userId: string;
  field: string;
  originalValue: unknown;
  correctedValue: unknown;
}

export const correctionService = {
  /** Correzioni di un'analisi, più recente per prima. */
  async listForAnalysis(analysisId: string): Promise<AnalysisCorrection[]> {
    const { data, error } = await requireSupabase()
      .from('analysis_corrections')
      .select('*')
      .eq('analysis_id', analysisId)
      .order('corrected_at', { ascending: false });
    if (error) throw new AppError(toUserMessage(error), error);
    return (data ?? []).map(toCorrection);
  },

  /** Registra una correzione (append-only). La RLS richiede corrected_by = utente corrente. */
  async save(input: SaveCorrectionInput): Promise<AnalysisCorrection> {
    const { data, error } = await requireSupabase()
      .from('analysis_corrections')
      .insert({
        analysis_id: input.analysisId,
        document_id: input.documentId,
        company_id: input.companyId,
        field: input.field,
        original_ai_value: (input.originalValue ?? null) as Json,
        corrected_value: (input.correctedValue ?? null) as Json,
        corrected_by: input.userId,
      })
      .select('*')
      .single();
    if (error || !data) throw new AppError(toUserMessage(error), error);
    return toCorrection(data);
  },
};
