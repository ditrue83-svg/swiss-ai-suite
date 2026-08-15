// ============================================================================
// documentHubService — Documenti: ricerca, organizzazione, provenienza.
//
// COSA FA E COSA NON FA. Questo servizio compone una LETTURA sopra dati che
// appartengono ad altri: l'analisi è di Admin AI ed è immutabile, la
// comunicazione di provenienza è dell'Inbox, l'attività è del Work Hub. Qui non
// si copia niente di tutto ciò e non si chiama nessuna AI: si mette insieme.
//
// L'unica cosa che il Hub POSSIEDE è l'organizzazione aziendale — categoria,
// etichette, archiviazione, titolo, nota interna — che è anche l'unica parte
// che una persona può cambiare liberamente senza toccare un'analisi.
//
// La lista passa dalla funzione `list_documents`: filtri, ricerca full-text,
// ordinamento, paginazione e composizione stanno nel database. Farlo qui
// vorrebbe dire una interrogazione per documento per relazione, e per sapere
// quali venticinque documenti mostrare bisognerebbe averli scaricati tutti.
//
// `documentService` resta responsabile del FILE: creazione, Storage, URL
// firmati, cancellazione. Le due cose non si mescolano.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import { translate as tr } from '@/i18n';
import { stateOf, toListArgs } from '@/features/documents/documentModel';
import { etichettaDocumento } from '@/lib/documentTitle';
import { analysisService } from './analysisService';
import type { Database } from '@/types/database';
import type {
  ActionCompletion, AnalysisCorrection, DocumentAttention, DocumentCategory, DocumentDetail,
  DocumentEmailSource, DocumentHubFilters, DocumentHubItem, DocumentLinkedTask, DocumentPage,
  DocumentRecord, DocumentStatsRow, DocumentStatsSet, DocumentTag, DocumentTechnicalInfo,
} from '@/types/models';

/**
 * I TETTI DELLE STATISTICHE, e perché sono due numeri diversi.
 *
 * Le statistiche dell'archivio leggono quattro campi per documento: mille righe
 * sono qualche decina di kilobyte. Il completamento deve invece scaricare le
 * checklist intere per contarne le voci, e una checklist è un oggetto vero:
 * duecento documenti è il punto in cui quella lettura resta onesta.
 *
 * ⚠️ Quando il tetto morde, chi legge lo SA — `truncated`, e l'etichetta lo
 * dice. Una statistica che tace di essere parziale è peggio di una assente.
 */
export const STATS_MAX_DOCUMENTS = 1000;
export const COMPLETION_MAX_DOCUMENTS = 200;

type ListRow = Database['public']['Functions']['list_documents']['Returns'][number];
type DocRow = Database['public']['Tables']['documents']['Row'];

/** Le categorie sono chiavi tecniche: nel database non entra mai «Contratti». */
export type { DocumentCategory };

function toItem(row: ListRow): DocumentHubItem {
  return {
    id: row.id,
    title: row.title,
    // ⚠️ LA DECISIONE SUL NOME DA MOSTRARE SI PRENDE QUI, dove la riga entra
    // nell'applicazione, e non in ciascuna schermata. `title` resta il valore
    // GREZZO del database — serve al campo «Titolo» dell'organizzazione, che
    // deve far modificare il dato vero — ma tutto ciò che si legge passa da
    // `label`. Finché la decisione stava nelle schermate, era presa in una
    // sola: la pagina di caricamento. L'elenco, la Panoramica e il dettaglio
    // mostravano «2.5».
    label: etichettaDocumento({
      titolo: row.title,
      nomeFile: row.original_filename,
      mittente: row.sender,
      mittenteCorretto: row.sender_corrected === true,
      confidenza: row.confidence,
      tipoDocumento: row.document_type,
    }),
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    storagePath: row.storage_path,
    sourceType: row.source_type,
    status: row.status,
    pageCount: row.page_count,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    category: row.category,
    categorySource: row.category_source,
    state: stateOf(row.analysis_status, row.status),
    analysisId: row.analysis_id,
    lastAttemptFailed: row.last_attempt_failed === true,
    errorCode: row.error_code,
    documentType: row.document_type,
    documentTypeCorrected: row.document_type_corrected === true,
    sender: row.sender,
    senderCorrected: row.sender_corrected === true,
    senderAuthorityType: row.sender_authority_type,
    documentDate: row.document_date,
    deadline: row.deadline,
    deadlineCorrected: row.deadline_corrected === true,
    deadlineRequiresVerification: row.deadline_requires_verification === true,
    amount: row.amount === null ? null : Number(row.amount),
    amountCurrency: row.amount_currency,
    amountCorrected: row.amount_corrected === true,
    confidence: row.confidence,
    tags: Array.isArray(row.tags) ? row.tags : [],
    openTaskCount: Number(row.open_task_count ?? 0),
    taskCount: Number(row.task_count ?? 0),
    emailCount: Number(row.email_count ?? 0),
    snippet: row.snippet,
  };
}

export function toDocumentRecord(row: DocRow): DocumentRecord {
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
    category: row.category,
    categorySource: row.category_source,
    categorySetBy: row.category_set_by,
    categorySetAt: row.category_set_at,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
    internalNotes: row.internal_notes,
    notesUpdatedAt: row.notes_updated_at,
    notesUpdatedBy: row.notes_updated_by,
    pageCount: row.page_count,
    fileHash: row.file_hash,
  };
}

/**
 * Messaggi comprensibili per i guasti che questo dominio produce davvero.
 * Un `23514` con dentro `tag_company_mismatch` non è un errore di sistema: è un
 * tentativo di collegare cose di aziende diverse, e va detto così.
 */
export function documentErrorMessage(error: unknown): string {
  const raw = error as { message?: string; code?: string; hint?: string; details?: string } | null;
  const text = `${raw?.message ?? ''} ${raw?.hint ?? ''} ${raw?.details ?? ''}`;
  if (text.includes('tag_company_mismatch')) return tr('documents.errors.wrongCompany');
  if (text.includes('documents_not_all_visible')) return tr('documents.errors.bulkNotAllVisible');
  if (text.includes('too_many_tags')) return tr('documents.errors.tooManyTags');
  if (text.includes('too_many_documents')) return tr('documents.errors.bulkTooMany');
  if (text.includes('no_documents_selected')) return tr('documents.errors.bulkEmpty');
  if (raw?.code === '23505') return tr('documents.errors.tagExists');
  return toUserMessage(error);
}

export const documentHubService = {
  /** Una pagina di documenti, già filtrata, ordinata e composta dal database. */
  async list(companyId: string, filters: DocumentHubFilters = {}): Promise<DocumentPage> {
    const { data, error } = await requireSupabase()
      .rpc('list_documents', toListArgs(companyId, filters));
    if (error) throw new AppError(documentErrorMessage(error), error);
    const rows = (data ?? []) as ListRow[];
    return {
      items: rows.map(toItem),
      // `total_count` è uguale su ogni riga (funzione finestra); senza righe è zero.
      total: rows.length ? Number(rows[0].total_count) : 0,
    };
  },

  /**
   * Conteggi per categoria, in un'unica aggregazione.
   * Escludono gli archiviati come la lista: un numero accanto a una categoria
   * deve corrispondere a ciò che si vede aprendola.
   */
  async counts(companyId: string, archived = false): Promise<Map<DocumentCategory | 'none', number>> {
    const { data, error } = await requireSupabase()
      .rpc('document_category_counts', { p_company_id: companyId, p_archived: archived });
    if (error) throw new AppError(documentErrorMessage(error), error);
    const out = new Map<DocumentCategory | 'none', number>();
    for (const row of data ?? []) out.set(row.category ?? 'none', Number(row.n));
    return out;
  },

  /**
   * I documenti che richiedono attenzione (§61): analisi da verificare o non
   * riuscita. Serve alla Home, che NON deve diventare un elenco di documenti —
   * per questo è una interrogazione filtrata e non una lista troncata.
   *
   * ⚠️ RENDE ANCHE I DUE TOTALI, e non è un di più: la Panoramica mostra il
   * numero «Documenti da verificare» e da lì si arriva a `/documenti?stato=
   * to_verify`. Il numero e l'elenco devono venire dalla STESSA interrogazione,
   * altrimenti la scheda dice 16 e la pagina ne mostra 4 — due verità sullo
   * stesso fatto. `total` conta prima di paginare (funzione finestra), quindi
   * è il totale vero anche se le righe rese sono `limit`. Nessuna query in più:
   * questi due totali arrivavano già e venivano buttati via.
   */
  async attention(companyId: string, limit = 8): Promise<DocumentAttention> {
    const [toVerify, failed] = await Promise.all([
      documentHubService.list(companyId, { state: 'to_verify', limit }),
      documentHubService.list(companyId, { state: 'failed', limit }),
    ]);
    return {
      items: [...failed.items, ...toVerify.items].slice(0, limit),
      toVerifyTotal: toVerify.total,
      failedTotal: failed.total,
    };
  },

  /**
   * GLI INGREDIENTI DEI CONTEGGI — una riga per documento, con l'ultima analisi
   * VALIDA agganciata. È l'unica lettura da cui nascono le statistiche dei
   * documenti, e ci passano sia la sezione dell'archivio sia il completamento
   * delle azioni in Panoramica.
   *
   * ⚠️ SI PARTE DA `documents`. Fino al 2026-08-15 la Panoramica partiva da
   * `document_analyses` filtrando solo `company_id`: quella tabella non conosce
   * `archived_at`, quindi i suoi grafici contavano anche i 17 documenti
   * archiviati mentre l'archivio ne mostrava 2. Qui l'archiviazione è un filtro
   * esplicito, e chi chiama DEVE dire quale insieme vuole.
   *
   * ⚠️ «Ultima analisi valida» è la stessa regola di `list_documents` (il ramo
   * `good`, 0017) e di `analysisService.getForDocument`: l'ultima riga che non
   * sia `failed`. Non è riscritta qui — è espressa come filtro sulla risorsa
   * incorporata, `analysis_status <> 'failed'` più ordinamento e limite — così
   * resta UNA regola e non tre. Un documento il cui ultimo tentativo è fallito
   * mostra il contenuto dell'analisi buona precedente, esattamente come nella
   * riga dell'archivio da cui si arriva.
   *
   * ⚠️ IL TETTO È DICHIARATO, non silenzioso: chi chiama riceve `truncated` e lo
   * dice a schermo. Un conteggio troncato che si presenta come totale è la
   * stessa bugia di un KPI che dice «20» perché ne ha caricate 20.
   */
  async statsRows(companyId: string, opts: {
    archived?: boolean;
    /** Serve solo al completamento: le checklist pesano, non si scaricano per niente. */
    withActions?: boolean;
    limit: number;
  }): Promise<DocumentStatsRow[]> {
    const inner = opts.withActions
      ? 'id, document_type, language, deadline, actions'
      : 'id, document_type, language, deadline';
    let q = requireSupabase()
      .from('documents')
      .select(`id, document_analyses(${inner})`)
      .eq('company_id', companyId)
      // Il confronto sull'azienda accompagna la RLS, non la sostituisce: è la
      // disciplina del progetto, ed è anche l'unica difesa che si vede leggendo.
      .neq('document_analyses.analysis_status', 'failed')
      .order('created_at', { referencedTable: 'document_analyses', ascending: false })
      .limit(1, { referencedTable: 'document_analyses' })
      .order('created_at', { ascending: false })
      .limit(opts.limit);
    q = opts.archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null);

    const { data, error } = await q;
    if (error) throw new AppError(documentErrorMessage(error), error);

    type Embedded = {
      id: string; document_type: string | null; language: string | null;
      deadline: string | null; actions?: unknown;
    };
    type Row = { id: string; document_analyses: Embedded[] };
    return ((data ?? []) as unknown as Row[]).map((r) => {
      const a = r.document_analyses[0] ?? null;
      return {
        id: r.id,
        documentType: a?.document_type ?? null,
        language: a?.language ?? null,
        deadline: a?.deadline ?? null,
        analysisId: a?.id ?? null,
        hasAnalysis: a !== null,
        actionCount: !opts.withActions ? null : Array.isArray(a?.actions) ? a.actions.length : 0,
      };
    });
  },

  /**
   * Le statistiche di un insieme DICHIARATO: attivi oppure archiviati.
   *
   * Il totale non è `rows.length`: arriva da `document_category_counts`, cioè
   * dalla stessa funzione che riempie i conteggi della barra laterale. Due
   * numeri sulla stessa pagina che contano lo stesso insieme devono venire
   * dalla stessa interrogazione, altrimenti si contraddicono appena i documenti
   * superano il tetto.
   */
  async stats(companyId: string, archived = false): Promise<DocumentStatsSet> {
    const [rows, counts] = await Promise.all([
      documentHubService.statsRows(companyId, { archived, limit: STATS_MAX_DOCUMENTS }),
      documentHubService.counts(companyId, archived),
    ]);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return { rows, total, truncated: rows.length < total, archived };
  },

  /**
   * Quante azioni della checklist sono spuntate, sui documenti ATTIVI.
   *
   * ⚠️ DUE FONTI, ED È VOLUTO. Il denominatore viene dallo SNAPSHOT, che è
   * l'unico posto in cui si sa quante azioni esistono; il numeratore viene da
   * `action_progress`, che dalla 0010 è l'unico posto in cui si sa quali sono
   * fatte (nello snapshot `done` è sempre `false`, e infatti la Panoramica
   * mostrava «0 di 40» — un numero che nessuna spunta poteva far salire).
   *
   * ⚠️ SOLO I DOCUMENTI ATTIVI: le azioni di un documento archiviato non sono
   * lavoro in sospeso, e contarle abbasserebbe una percentuale che descrive
   * ciò che resta da fare oggi.
   */
  async actionCompletion(companyId: string): Promise<ActionCompletion> {
    const [rows, documentsTotal] = await Promise.all([
      documentHubService.statsRows(companyId, {
        archived: false, withActions: true, limit: COMPLETION_MAX_DOCUMENTS,
      }),
      documentHubService.activeCount(companyId),
    ]);
    const total = rows.reduce((n, r) => n + (r.actionCount ?? 0), 0);
    const analysisIds = rows.map((r) => r.analysisId).filter((id): id is string => !!id);
    if (!analysisIds.length) return { done: 0, total, documents: rows.length, documentsTotal };

    const { count, error } = await requireSupabase()
      .from('action_progress')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('done', true)
      .in('analysis_id', analysisIds);
    if (error) throw new AppError(documentErrorMessage(error), error);
    return { done: count ?? 0, total, documents: rows.length, documentsTotal };
  },

  /** Quanti documenti attivi ha l'azienda. Interrogazione di sola testata. */
  async activeCount(companyId: string): Promise<number> {
    const { count, error } = await requireSupabase()
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .is('archived_at', null);
    if (error) throw new AppError(documentErrorMessage(error), error);
    return count ?? 0;
  },

  /**
   * Il dettaglio di un documento.
   *
   * La testata passa dalla STESSA funzione della lista (`p_document_id`): se il
   * dettaglio ricostruisse i valori effettivi per conto proprio, prima o poi
   * direbbe un mittente diverso da quello della riga da cui si è arrivati.
   * Attorno, sei letture mirate in parallelo — ognuna usa un indice — invece di
   * un'unica interrogazione con join annidati.
   */
  async get(documentId: string, companyId: string): Promise<DocumentDetail | null> {
    const sb = requireSupabase();

    const [{ data: docData, error: docErr }, { data: itemRows, error: itemErr }] = await Promise.all([
      sb.from('documents').select('*').eq('id', documentId).maybeSingle(),
      sb.rpc('list_documents', {
        p_company_id: companyId, p_document_id: documentId, p_limit: 1,
      }),
    ]);
    if (docErr) throw new AppError(documentErrorMessage(docErr), docErr);
    if (itemErr) throw new AppError(documentErrorMessage(itemErr), itemErr);
    if (!docData) return null;

    const document = toDocumentRecord(docData);
    // Difesa esplicita oltre alla RLS: dopo un cambio di azienda un documento
    // dell'azienda precedente non deve restare in pagina (§114).
    if (document.companyId !== companyId) return null;
    const rows = (itemRows ?? []) as ListRow[];
    if (!rows.length) return null;
    const item = toItem(rows[0]);

    const [analysis, corrections, tags, emails, tasks, technical, sameContent] = await Promise.all([
      analysisService.getForDocument(documentId),
      documentHubService.corrections(documentId),
      documentHubService.tagsOf(documentId),
      documentHubService.emailSources(documentId),
      documentHubService.linkedTasks(documentId),
      documentHubService.technical(documentId),
      documentHubService.sameContent(document),
    ]);

    return { document, item, analysis, corrections, tags, emails, tasks, technical, sameContentIds: sameContent };
  },

  async corrections(documentId: string): Promise<AnalysisCorrection[]> {
    const { data, error } = await requireSupabase()
      .from('analysis_corrections').select('*')
      .eq('document_id', documentId)
      .order('corrected_at', { ascending: false });
    if (error) throw new AppError(documentErrorMessage(error), error);
    return (data ?? []).map((row) => ({
      id: row.id,
      analysisId: row.analysis_id,
      documentId: row.document_id,
      companyId: row.company_id,
      field: row.field,
      originalAiValue: row.original_ai_value,
      correctedValue: row.corrected_value,
      correctedBy: row.corrected_by,
      correctedAt: row.corrected_at,
    }));
  },

  /**
   * Le comunicazioni da cui il documento è arrivato. Al plurale: lo STESSO
   * documento può essere allegato a più email — è quello che succede quando la
   * deduplicazione per contenuto riconosce un PDF già presente. Deduplicare il
   * documento non deve far perdere la traccia di dove è passato.
   */
  async emailSources(documentId: string): Promise<DocumentEmailSource[]> {
    const { data, error } = await requireSupabase()
      .from('email_message_documents')
      .select('email_message_id, relation, email_messages(subject, sender_name, sender_email, received_at, email_connections(email_address))')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false });
    if (error) throw new AppError(documentErrorMessage(error), error);
    type Row = {
      email_message_id: string; relation: 'body' | 'attachment';
      email_messages: {
        subject: string | null; sender_name: string | null; sender_email: string | null;
        received_at: string; email_connections: { email_address: string } | null;
      } | null;
    };
    return ((data ?? []) as unknown as Row[])
      .filter((r) => r.email_messages)
      .map((r) => ({
        messageId: r.email_message_id,
        relation: r.relation,
        subject: r.email_messages?.subject ?? null,
        senderName: r.email_messages?.sender_name ?? null,
        senderEmail: r.email_messages?.sender_email ?? null,
        receivedAt: r.email_messages?.received_at ?? '',
        accountEmail: r.email_messages?.email_connections?.email_address ?? null,
      }));
  },

  /**
   * Le attività che qualcuno ha aperto su questo documento (§38).
   *
   * ⚠️ NIENTE `profiles:assignee_user_id(…)` incorporato, e per due motivi
   * distinti, scoperti aprendo la pagina:
   *   1. non esiste alcuna relazione da incorporare — `tasks.assignee_user_id`
   *      punta a `auth.users`, non a `public.profiles` — e PostgREST rifiuta
   *      l'intera richiesta con PGRST200;
   *   2. anche se esistesse non servirebbe: `profiles` è leggibile SOLO dal
   *      proprietario (0001), quindi il nome di un collega tornerebbe comunque
   *      vuoto.
   * Il nome si risolve dove va risolto: dalla rubrica
   * `company_member_directory`, che espone `{user_id, display_name, role}` ai
   * soli membri. Qui si restituisce l'identificativo e basta.
   */
  async linkedTasks(documentId: string): Promise<DocumentLinkedTask[]> {
    const { data, error } = await requireSupabase()
      .from('tasks')
      .select('id, title, status, priority, due_date, archived_at, assignee_user_id')
      .eq('document_id', documentId)
      .order('created_at', { ascending: false });
    if (error) throw new AppError(documentErrorMessage(error), error);
    return (data ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueDate: r.due_date,
      assigneeUserId: r.assignee_user_id,
      archivedAt: r.archived_at,
    }));
  },

  /** Informazioni tecniche (§94): come è stato letto il file e da cosa analizzato. */
  async technical(documentId: string): Promise<DocumentTechnicalInfo | null> {
    const sb = requireSupabase();
    const [{ data: ext }, { data: an }] = await Promise.all([
      sb.from('document_extractions')
        .select('extraction_method, char_count, ocr_confidence, truncated')
        .eq('document_id', documentId).maybeSingle(),
      sb.from('document_analyses')
        .select('engine, provider, model, prompt_version, created_at')
        .eq('document_id', documentId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!ext && !an) return null;
    return {
      extractionMethod: ext?.extraction_method ?? null,
      charCount: ext?.char_count ?? null,
      ocrConfidence: ext?.ocr_confidence ?? null,
      truncated: ext?.truncated ?? false,
      provider: an?.provider ?? null,
      model: an?.model ?? null,
      promptVersion: an?.prompt_version ?? null,
      engine: an?.engine ?? null,
      analysisCreatedAt: an?.created_at ?? null,
    };
  },

  /**
   * Altri documenti dell'azienda con lo STESSO contenuto (§46).
   * Non è una «relazione semantica»: è lo stesso file, riconosciuto dall'hash.
   * La ricerca è per azienda e non globale — sapere che un'altra azienda ha lo
   * stesso file non deve essere deducibile in nessun modo (§89).
   */
  async sameContent(document: DocumentRecord): Promise<string[]> {
    if (!document.fileHash) return [];
    const { data, error } = await requireSupabase()
      .from('documents').select('id')
      .eq('company_id', document.companyId)
      .eq('file_hash', document.fileHash)
      .neq('id', document.id)
      .limit(10);
    if (error) throw new AppError(documentErrorMessage(error), error);
    return (data ?? []).map((r) => r.id);
  },

  // ---- Organizzazione ------------------------------------------------------

  /**
   * Cambia la categoria. NON produce una correzione dell'analisi: dove
   * l'azienda tiene un documento non è un'affermazione sul suo contenuto.
   * L'origine («impostata a mano») la scrive il database.
   */
  async setCategory(documentId: string, category: DocumentCategory | null): Promise<DocumentRecord> {
    return await documentHubService.patch(documentId, { category });
  },

  /**
   * Rinomina il titolo ORGANIZZATIVO. Il file in Storage non si tocca e il nome
   * originale resta visibile nel dettaglio: rinominare l'oggetto salvato
   * romperebbe il collegamento con quello che il mittente ha davvero inviato.
   */
  async rename(documentId: string, title: string): Promise<DocumentRecord> {
    const clean = title.trim().slice(0, 200);
    if (!clean) throw new AppError(tr('documents.errors.titleEmpty'));
    return await documentHubService.patch(documentId, { title: clean });
  },

  async setNotes(documentId: string, notes: string): Promise<DocumentRecord> {
    const clean = notes.trim().slice(0, 4000);
    return await documentHubService.patch(documentId, { internal_notes: clean || null });
  },

  /** Archivia: fuori dalle viste, dentro il sistema. Il timbro lo mette il server. */
  async archive(documentId: string): Promise<DocumentRecord> {
    return await documentHubService.patch(documentId, { archived_at: new Date().toISOString() });
  },

  async restore(documentId: string): Promise<DocumentRecord> {
    return await documentHubService.patch(documentId, { archived_at: null });
  },

  async patch(documentId: string, change: Database['public']['Tables']['documents']['Update']): Promise<DocumentRecord> {
    const { data, error } = await requireSupabase()
      .from('documents').update(change).eq('id', documentId).select('*').single();
    if (error || !data) throw new AppError(documentErrorMessage(error), error);
    return toDocumentRecord(data);
  },

  // ---- Etichette -----------------------------------------------------------

  async listTags(companyId: string): Promise<DocumentTag[]> {
    const { data, error } = await requireSupabase()
      .from('document_tags').select('id, name')
      .eq('company_id', companyId)
      .order('name', { ascending: true });
    if (error) throw new AppError(documentErrorMessage(error), error);
    return data ?? [];
  },

  async tagsOf(documentId: string): Promise<DocumentTag[]> {
    const { data, error } = await requireSupabase()
      .from('document_tag_links')
      .select('document_tags(id, name)')
      .eq('document_id', documentId);
    if (error) throw new AppError(documentErrorMessage(error), error);
    type Row = { document_tags: { id: string; name: string } | null };
    return ((data ?? []) as unknown as Row[])
      .map((r) => r.document_tags)
      .filter((t): t is DocumentTag => !!t)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  /** Crea un'etichetta. L'unicità senza maiuscole la impone un indice, non questo codice. */
  async createTag(companyId: string, name: string): Promise<DocumentTag> {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!clean) throw new AppError(tr('documents.errors.tagEmpty'));
    const { data, error } = await requireSupabase()
      .from('document_tags').insert({ company_id: companyId, name: clean })
      .select('id, name').single();
    if (error || !data) throw new AppError(documentErrorMessage(error), error);
    return data;
  },

  async attachTag(companyId: string, documentId: string, tagId: string): Promise<void> {
    const { error } = await requireSupabase()
      .from('document_tag_links').insert({ company_id: companyId, document_id: documentId, tag_id: tagId });
    if (error) throw new AppError(documentErrorMessage(error), error);
  },

  async detachTag(documentId: string, tagId: string): Promise<void> {
    const { error } = await requireSupabase()
      .from('document_tag_links').delete()
      .eq('document_id', documentId).eq('tag_id', tagId);
    if (error) throw new AppError(documentErrorMessage(error), error);
  },

  /** Cancella l'etichetta dall'azienda: la policy la riserva agli amministratori. */
  async deleteTag(tagId: string): Promise<void> {
    const { error } = await requireSupabase().from('document_tags').delete().eq('id', tagId);
    if (error) throw new AppError(documentErrorMessage(error), error);
  },

  // ---- Azioni di gruppo ----------------------------------------------------
  // Passano tutte da una funzione del database che verifica PRIMA che ogni
  // documento appartenga all'azienda: o si fa tutto o non si fa niente. Un
  // «fatto» su quattro righe su cinque, senza dire quale è rimasta indietro,
  // sarebbe il tipo di successo apparente che questo progetto evita.

  async bulkSetCategory(companyId: string, ids: string[], category: DocumentCategory | null): Promise<number> {
    const { data, error } = await requireSupabase()
      .rpc('documents_bulk_set_category', { p_company_id: companyId, p_ids: ids, p_category: category });
    if (error) throw new AppError(documentErrorMessage(error), error);
    return Number(data ?? 0);
  },

  async bulkArchive(companyId: string, ids: string[], archived: boolean): Promise<number> {
    const { data, error } = await requireSupabase()
      .rpc('documents_bulk_archive', { p_company_id: companyId, p_ids: ids, p_archived: archived });
    if (error) throw new AppError(documentErrorMessage(error), error);
    return Number(data ?? 0);
  },

  async bulkAddTag(companyId: string, ids: string[], tagId: string): Promise<number> {
    const { data, error } = await requireSupabase()
      .rpc('documents_bulk_add_tag', { p_company_id: companyId, p_ids: ids, p_tag_id: tagId });
    if (error) throw new AppError(documentErrorMessage(error), error);
    return Number(data ?? 0);
  },
};
