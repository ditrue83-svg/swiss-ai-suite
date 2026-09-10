// ============================================================================
// noteService — «Struttura con AI» della nota rapida (Fase 3.1, 2026-09-10).
//
// La nota rapida nasce da parole libere — scritte di fretta o dettate. Questa
// chiamata le rende una NOTA: un oggetto di una riga e un testo ordinato. Il
// lavoro lo fa la Edge Function `structure-note`, perché la chiave del modello
// non esce dal server; il risultato torna nei campi EDITABILI, mai nel
// database: l'AI propone, la persona guarda, corregge e poi salva — il patto
// di sempre fra questo prodotto e l'AI (è quello delle bozze di risposta, §35).
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError } from '@/lib/errors';
import { translate as tr } from '@/i18n';

export interface StructuredNote {
  subject: string;
  notes: string;
}

interface StructureNoteResponse {
  subject?: unknown;
  notes?: unknown;
  error?: string;
}

/** L'errore della funzione, se il suo corpo lo dichiara: com'è in replyService. */
async function readFunctionError(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = (await (ctx as Response).json()) as StructureNoteResponse;
      if (body?.error) return body.error;
    } catch { /* corpo non JSON */ }
  }
  return fallback;
}

export const noteService = {
  /**
   * Struttura un testo libero in { oggetto, note }. `lang` è la lingua
   * DELL'INTERFACCIA: la nota si scrive nella lingua in cui si sta lavorando.
   * Il testo NON viene salvato dalla funzione: torna qui e resta editabile.
   */
  async structure(text: string, lang: string): Promise<StructuredNote> {
    const { data, error } = await requireSupabase().functions.invoke<StructureNoteResponse>('structure-note', {
      body: { text, lang },
    });
    if (error) throw new AppError(await readFunctionError(error, tr('quicknote.structureFailed')), error);
    // La risposta è un CONTRATTO: un JSON con due stringhe. Qualunque altra
    // cosa — testo libero, campi mancanti — è un guasto della funzione e si
    // dichiara tale, non si «sistema» qui.
    if (typeof data?.subject !== 'string' || typeof data?.notes !== 'string') {
      throw new AppError(data?.error ?? tr('quicknote.structureFailed'));
    }
    return { subject: data.subject, notes: data.notes };
  },
};
