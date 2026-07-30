// ============================================================================
// Chiedi ad AI-Swisse — il servizio
//
// Due strade, e la divisione non è arbitraria.
//
//   PostgREST  — conversazioni, messaggi, citazioni, feedback. Sono letture e
//                scritture che la 0027 concede all'utente: farle passare da una
//                Edge Function significherebbe riscrivere in TypeScript
//                permessi che il database già applica.
//   Edge       — la domanda. È l'unica cosa che il client non può fare: parlare
//                con il modello e scrivere un messaggio con ruolo `assistant`.
//
// ⚠️ LA DOMANDA VIAGGIA IN FLUSSO, e non con `functions.invoke`. Non è una
// preferenza: `invoke` aspetta la risposta intera, e una domanda che attraversa
// più moduli impiega secondi durante i quali l'utente deve vedere che cosa sta
// succedendo (§112) e poter interrompere (§114). Nessuna delle due cose è
// possibile aspettando in silenzio, quindi qui si usa `fetch` con lettura
// incrementale e un `AbortController`.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { translate as tr } from '@/i18n';
import type {
  AssistantAnswerStatus, AssistantCitation, AssistantFeedbackReason, AssistantMessage,
  AssistantSourceType, AssistantStreamEvent, AssistantThread, AssistantVerification,
} from '@/types/models';

const THREAD_COLUMNS = 'id, title, locale, status, created_at, updated_at, archived_at';
const MESSAGE_COLUMNS =
  'id, role, content, answer_status, uncertainty, follow_ups, model, prompt_version, run_id, created_at';
const CITATION_COLUMNS =
  'message_id, citation_index, source_type, source_id, source_ids, group_size, route, title, ' +
  'subtitle, page_number, field_name, cited_text, value_snapshot, source_version';

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const n = (v: unknown): number | null => {
  if (v == null) return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};

function toThread(r: Row): AssistantThread {
  return {
    id: String(r.id),
    title: s(r.title) ?? '',
    locale: (r.locale === 'de' || r.locale === 'fr' ? r.locale : 'it') as AssistantThread['locale'],
    status: r.status === 'archived' ? 'archived' : 'active',
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function toCitation(r: Row): AssistantCitation {
  return {
    index: n(r.citation_index) ?? 0,
    sourceType: String(r.source_type) as AssistantSourceType,
    sourceId: s(r.source_id),
    groupSize: n(r.group_size),
    route: String(r.route),
    title: s(r.title) ?? '—',
    subtitle: s(r.subtitle),
    pageNumber: n(r.page_number),
    fieldName: s(r.field_name),
    citedText: s(r.cited_text),
    valueSnapshot: (r.value_snapshot ?? null) as AssistantCitation['valueSnapshot'],
    sourceVersion: s(r.source_version),
    // ⚠️ La verifica NON è una colonna: la 0027 non la conserva, perché è una
    // proprietà della LETTURA e non della fonte — un contratto in bozza oggi
    // può essere verificato domani. L'interfaccia la ricava dallo snapshot dove
    // c'è, e altrimenti non la mostra: meglio non dire nulla che dire un
    // livello di fiducia vecchio di un mese.
    verification: verificationFromSnapshot(r.value_snapshot),
  };
}

function verificationFromSnapshot(snapshot: unknown): AssistantVerification | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const o = snapshot as Record<string, unknown>;
  if (o.termsAreDraft === true) return 'ai_unverified';
  if (o.termsAreDraft === false) return 'human_verified';
  if (o.reviewStatus === 'ready') return 'human_verified';
  if (o.reviewStatus === 'needs_review') return 'ai_unverified';
  return null;
}

function toMessage(r: Row, citations: AssistantCitation[]): AssistantMessage {
  const followUps = Array.isArray(r.follow_ups)
    ? (r.follow_ups as unknown[]).filter((f): f is string => typeof f === 'string')
    : [];
  return {
    id: String(r.id),
    role: r.role === 'assistant' ? 'assistant' : 'user',
    content: typeof r.content === 'string' ? r.content : '',
    answerStatus: s(r.answer_status) as AssistantAnswerStatus | null,
    uncertainty: s(r.uncertainty),
    followUps,
    createdAt: String(r.created_at),
    citations: citations.sort((a, b) => a.index - b.index),
  };
}

// ---------------------------------------------------------------------------

export interface AskInput {
  companyId: string;
  threadId: string | null;
  question: string;
  locale: 'it' | 'de' | 'fr';
  entityContext?: { type: string; id: string } | null;
  onEvent: (event: AssistantStreamEvent) => void;
  signal?: AbortSignal;
}

export const assistantService = {
  async listThreads(companyId: string, includeArchived = false): Promise<AssistantThread[]> {
    let q = requireSupabase().from('assistant_threads')
      .select(THREAD_COLUMNS)
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false })
      .limit(50);
    if (!includeArchived) q = q.eq('status', 'active');
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => toThread(r as Row));
  },

  /**
   * I messaggi con le loro fonti.
   *
   * Due interrogazioni e non una join annidata: le citazioni di una
   * conversazione sono poche decine e prenderle in blocco costa una richiesta,
   * mentre una join per messaggio ne costerebbe una per riga (§165).
   */
  async getMessages(threadId: string): Promise<AssistantMessage[]> {
    const sb = requireSupabase();
    const { data: msgs, error } = await sb.from('assistant_messages')
      .select(MESSAGE_COLUMNS)
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw error;
    const rows = (msgs ?? []) as Row[];
    if (!rows.length) return [];

    const ids = rows.map((r) => String(r.id));
    const { data: cits } = await sb.from('assistant_citations')
      .select(CITATION_COLUMNS)
      .in('message_id', ids);

    const byMessage = new Map<string, AssistantCitation[]>();
    for (const c of ((cits ?? []) as unknown as Row[])) {
      const key = String(c.message_id);
      const list = byMessage.get(key) ?? [];
      list.push(toCitation(c));
      byMessage.set(key, list);
    }
    return rows.map((r) => toMessage(r, byMessage.get(String(r.id)) ?? []));
  },

  async renameThread(threadId: string, title: string): Promise<void> {
    const { error } = await requireSupabase().from('assistant_threads')
      .update({ title: title.slice(0, 200) }).eq('id', threadId);
    if (error) throw error;
  },

  async archiveThread(threadId: string, archived: boolean): Promise<void> {
    const { error } = await requireSupabase().from('assistant_threads')
      .update(archived
        ? { status: 'archived', archived_at: new Date().toISOString() }
        : { status: 'active', archived_at: null })
      .eq('id', threadId);
    if (error) throw error;
  },

  /**
   * §95 — l'eliminazione è vera.
   *
   * Se ne vanno messaggi, elaborazioni, chiamate, citazioni e voti, in cascata
   * dal database. Le FONTI aziendali non vengono toccate: la citazione era un
   * puntatore, e togliere il puntatore non toglie il documento.
   */
  async deleteThread(threadId: string): Promise<void> {
    const { error } = await requireSupabase().from('assistant_threads').delete().eq('id', threadId);
    if (error) throw error;
  },

  async sendFeedback(input: {
    messageId: string; companyId: string; userId: string;
    rating: 'helpful' | 'not_helpful'; reason?: AssistantFeedbackReason | null;
  }): Promise<void> {
    const { error } = await requireSupabase().from('assistant_feedback')
      .upsert({
        message_id: input.messageId,
        company_id: input.companyId,
        user_id: input.userId,
        rating: input.rating,
        reason: input.rating === 'not_helpful' ? (input.reason ?? null) : null,
      }, { onConflict: 'message_id,user_id' });
    if (error) throw error;
  },

  /**
   * La domanda.
   *
   * ⚠️ Gli eventi arrivano a pezzi e un pezzo può spezzarsi a metà di una riga:
   * il resto incompleto resta nel buffer fino all'arrivo del successivo.
   * Saltare questo dettaglio produce un errore che si vede solo con risposte
   * lunghe e connessioni lente — cioè in produzione e non in sviluppo.
   */
  async ask(input: AskInput): Promise<void> {
    const sb = requireSupabase();
    const { data: sessionData } = await sb.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new AppError(tr('errors.sessionInvalid'));

    let response: Response;
    try {
      response = await fetch(`${SUPABASE_URL}/functions/v1/company-assistant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          companyId: input.companyId,
          threadId: input.threadId,
          question: input.question,
          locale: input.locale,
          entityContext: input.entityContext ?? null,
        }),
        signal: input.signal,
      });
    } catch (e) {
      // Un'interruzione volontaria non è un guasto e non deve diventare un
      // messaggio d'errore rosso.
      if ((e as Error)?.name === 'AbortError') return;
      throw e;
    }

    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => null) as { code?: string } | null;
      input.onEvent({ type: 'error', code: payload?.code ?? 'UNKNOWN_ERROR', message: payload?.code ?? '' });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep = buffer.indexOf('\n\n');
        while (sep >= 0) {
          const chunk = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (line) {
            try {
              input.onEvent(JSON.parse(line.slice(6)) as AssistantStreamEvent);
            } catch {
              // Un evento illeggibile si scarta: perdere uno stato di
              // avanzamento non deve far perdere la risposta.
            }
          }
          sep = buffer.indexOf('\n\n');
        }
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') throw e;
    } finally {
      try { reader.cancel(); } catch { /* già chiuso */ }
    }
  },
};
