// ============================================================================
// documentService — metadati documento (DB) + file reale (Storage privato).
// Il contenuto dei PDF NON finisce nel DB: solo in Storage, con signed URL.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import type { DocumentRecord, DocumentSourceType, DocumentStatus } from '@/types/models';
import type { Database } from '@/types/database';

type DocRow = Database['public']['Tables']['documents']['Row'];

export const DOCUMENTS_BUCKET = 'company-documents';

function toDocument(row: DocRow): DocumentRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    uploadedBy: row.uploaded_by,
    title: row.title,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    storagePath: row.storage_path,
    sourceType: row.source_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeName(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120);
  return cleaned || 'documento';
}

export interface CreateDocumentInput {
  companyId: string;
  userId: string;
  title: string;
  sourceType: DocumentSourceType;
  /** file reale (upload) OPPURE testo (pasted_text/email). Uno dei due. */
  file?: File;
  text?: string;
  filename?: string;
  /** hash del contenuto per la deduplicazione (§28), calcolato dal chiamante. */
  fileHash?: string | null;
  /** numero di pagine noto dall'estrazione client (§25). */
  pageCount?: number | null;
}

export const documentService = {
  async list(companyId: string): Promise<DocumentRecord[]> {
    const { data, error } = await requireSupabase()
      .from('documents')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (error) throw new AppError(toUserMessage(error), error);
    return (data ?? []).map(toDocument);
  },

  async get(id: string): Promise<DocumentRecord | null> {
    const { data, error } = await requireSupabase().from('documents').select('*').eq('id', id).maybeSingle();
    if (error) throw new AppError(toUserMessage(error), error);
    return data ? toDocument(data) : null;
  },

  /** Deduplicazione (§28/§29): documento già presente NELL'AZIENDA con lo stesso contenuto. */
  async findByHash(companyId: string, fileHash: string): Promise<DocumentRecord | null> {
    const { data, error } = await requireSupabase()
      .from('documents')
      .select('*')
      .eq('company_id', companyId)
      .eq('file_hash', fileHash)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new AppError(toUserMessage(error), error);
    return data ? toDocument(data) : null;
  },

  /** Estrazione salvata dalla pipeline: testo + pagine (§31), per il viewer (incluso OCR). */
  async getExtraction(documentId: string): Promise<{
    fullText: string | null;
    pages: { pageNumber: number; text: string }[];
    /** Come è stato ricavato il testo. Serve a capire se ci si può fidare. */
    extractionMethod: 'native_pdf' | 'text' | 'ocr' | null;
  } | null> {
    const { data, error } = await requireSupabase()
      .from('document_extractions')
      .select('full_text, pages, extraction_method')
      .eq('document_id', documentId)
      .maybeSingle();
    if (error) throw new AppError(toUserMessage(error), error);
    if (!data) return null;
    const rawPages = Array.isArray(data.pages) ? data.pages : [];
    const pages = rawPages
      .map((p) => p as { pageNumber?: unknown; text?: unknown })
      .map((p, i) => ({ pageNumber: typeof p.pageNumber === 'number' ? p.pageNumber : i + 1, text: typeof p.text === 'string' ? p.text : '' }));
    const m = data.extraction_method as string | null;
    return {
      fullText: (data.full_text as string | null) ?? null,
      pages,
      extractionMethod: m === 'native_pdf' || m === 'text' || m === 'ocr' ? m : null,
    };
  },

  /**
   * Crea il record documento e carica il file in Storage.
   * 1) insert (status 'uploaded') → 2) upload su <company>/<doc>/<file>
   * → 3) update con storage_path. In caso di errore upload, rollback del record.
   */
  async create(input: CreateDocumentInput): Promise<DocumentRecord> {
    const sb = requireSupabase();

    const isFile = !!input.file;
    const filename = safeName(input.filename ?? input.file?.name ?? (isFile ? 'documento' : 'documento.txt'));
    const mimeType = input.file?.type || (isFile ? 'application/octet-stream' : 'text/plain');

    const insertPayload: Database['public']['Tables']['documents']['Insert'] = {
      company_id: input.companyId,
      uploaded_by: input.userId,
      title: input.title.trim() || filename,
      original_filename: filename,
      mime_type: mimeType,
      source_type: input.sourceType,
      status: 'uploaded',
      file_hash: input.fileHash ?? null,
      page_count: input.pageCount ?? null,
    };
    const { data: inserted, error: insErr } = await sb.from('documents').insert(insertPayload).select('*').single();
    if (insErr || !inserted) throw new AppError(toUserMessage(insErr), insErr);

    const doc = toDocument(inserted);
    const path = `${input.companyId}/${doc.id}/${filename}`;
    const body: Blob = input.file ?? new Blob([input.text ?? ''], { type: 'text/plain' });

    const { error: upErr } = await sb.storage.from(DOCUMENTS_BUCKET).upload(path, body, {
      contentType: mimeType,
      upsert: true,
    });
    if (upErr) {
      // rollback: rimuovi il record orfano
      await sb.from('documents').delete().eq('id', doc.id);
      throw new AppError(toUserMessage(upErr), upErr);
    }

    const size = input.file?.size ?? new Blob([input.text ?? '']).size;
    const { data: updated, error: updErr } = await sb
      .from('documents')
      .update({ storage_path: path, file_size: size })
      .eq('id', doc.id)
      .select('*')
      .single();
    if (updErr || !updated) throw new AppError(toUserMessage(updErr), updErr);
    return toDocument(updated);
  },

  async setStatus(id: string, status: DocumentStatus): Promise<void> {
    const { error } = await requireSupabase().from('documents').update({ status }).eq('id', id);
    if (error) throw new AppError(toUserMessage(error), error);
  },

  /** URL firmato temporaneo per aprire/scaricare il file (bucket privato). */
  async getSignedUrl(storagePath: string, expiresInSeconds = 120): Promise<string> {
    const { data, error } = await requireSupabase().storage.from(DOCUMENTS_BUCKET).createSignedUrl(storagePath, expiresInSeconds);
    if (error || !data) throw new AppError(toUserMessage(error), error);
    return data.signedUrl;
  },

  /** Scarica il contenuto testuale del file (per txt/pasted: ricostruisce il testo originale). */
  async downloadText(storagePath: string): Promise<string> {
    const { data, error } = await requireSupabase().storage.from(DOCUMENTS_BUCKET).download(storagePath);
    if (error || !data) throw new AppError(toUserMessage(error), error);
    return await data.text();
  },

  /** Scarica il file come Blob (per PDF: ri-estrazione testo per il viewer). */
  async downloadBlob(storagePath: string): Promise<Blob> {
    const { data, error } = await requireSupabase().storage.from(DOCUMENTS_BUCKET).download(storagePath);
    if (error || !data) throw new AppError(toUserMessage(error), error);
    return data;
  },

  /**
   * Cancellazione DEFINITIVA: record nel database (con tutto ciò che ne dipende)
   * e file in Storage.
   *
   * ⚠️ NON È ATOMICA, E NON SI FINGE CHE LO SIA. Postgres e Storage sono due
   * sistemi: una transazione che li comprenda entrambi non esiste. Quello che si
   * può scegliere è l'ORDINE, cioè quale metà del guasto si è disposti ad avere.
   *
   *   · Storage prima (com'era): se poi il database fallisce resta un documento
   *     VISIBILE il cui file non c'è più. La schermata continua a offrirlo, e
   *     «Apri originale» non trova niente: l'applicazione dice una cosa falsa.
   *   · Database prima (adesso): se poi Storage fallisce resta un file non
   *     referenziato da nessuno. Nessuno lo vede, nessuna schermata mente,
   *     occupa spazio.
   *
   * Fra un'informazione sbagliata e dello spazio sprecato si sceglie lo spazio.
   * E se la seconda metà fallisce lo si DICE a chi ha cancellato, invece di
   * riportare un successo pieno: `storageOrphan` risale fino alla schermata.
   */
  async remove(doc: DocumentRecord): Promise<{ storageOrphan: boolean }> {
    const sb = requireSupabase();

    const { error } = await sb.from('documents').delete().eq('id', doc.id);
    if (error) throw new AppError(toUserMessage(error), error);

    if (!doc.storagePath) return { storageOrphan: false };
    const { error: sErr } = await sb.storage.from(DOCUMENTS_BUCKET).remove([doc.storagePath]);
    if (!sErr) return { storageOrphan: false };
    // Un file già assente non è un guasto: l'esito voluto è che non ci sia.
    if (String(sErr.message ?? '').toLowerCase().includes('not found')) return { storageOrphan: false };
    return { storageOrphan: true };
  },
};
