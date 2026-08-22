// ============================================================================
// Edge Function: analyze-document (Fase 2, pipeline reale)
//
// Wrapper HTTP sottile attorno alla pipeline condivisa (_shared). Server-side:
// la chiave Anthropic è un secret e non tocca mai il browser.
//
// Sicurezza:
//  - richiede un JWT valido;
//  - autorizza VERIFICANDO la membership: legge il documento con il client
//    autenticato COME l'utente (RLS). Non membro → 403 (§49);
//  - rate limit per azienda (§50);
//  - il contenuto del documento è DATO, non istruzioni (§21, nel prompt).
// ============================================================================
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { runAnalysisPipeline, type CreateMessage, type ModelMessage } from '../_shared/pipeline.ts';
import { classifyProviderError, ERROR_MESSAGES, type ErrorCode, type ExtractionResult,
} from '../_shared/validate.ts';
import { logAiRequest, reserveAiSlot, finalizeAiRequest } from '../_shared/persist.ts';
// 2026-07-26 — la trascrizione è stata spostata in `_shared/extract.ts` perché
// serve anche alla sincronizzazione dell'Inbox. Stesso codice, un solo posto.
import { ocrExtract as sharedOcrExtract, MAX_FILE_BYTES as SHARED_MAX_FILE_BYTES } from '../_shared/extract.ts';
import { looksLikeScan, MIN_CHARS_ABSOLUTE } from '../_shared/extractionQuality.ts';
import {
  analisiGiaInCorso, STATI_IN_LAVORAZIONE, STUCK_ANALYSIS_MINUTES,
} from '../_shared/recoverStuckAnalyses.ts';
import type { CompanyContext } from '../_shared/prompt.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (code: ErrorCode, status: number) => json({ error: ERROR_MESSAGES[code], code }, status);

const RATE_LIMIT_PER_MINUTE = 12;   // §50
const MAX_CHARS = 120_000;          // §28 limite testo
const MAX_FILE_BYTES = 15 * 1024 * 1024; // §28 limite file per OCR

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return fail('PROVIDER_ERROR', 401);

  // Due client, con due ruoli distinti e non intercambiabili.
  //
  // `sb` porta il JWT dell'utente: TUTTE le letture di autorizzazione passano da
  // qui, così è la RLS a decidere se il documento è accessibile (§49). Non va
  // sostituito col service role, o il controllo cross-tenant sparirebbe.
  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  // `sbAdmin` scrive lo SNAPSHOT (document_analyses) e il TESTO ESTRATTO
  // (document_extractions). Dalla 0010 il client autenticato non ha più questi
  // permessi: se li avesse, l'analisi non sarebbe immutabile e il testo su cui si
  // verificano le citazioni (§20) sarebbe riscrivibile da chiunque sia membro.
  // Qui il bypass della RLS è legittimo perché l'autorizzazione è GIÀ avvenuta
  // sopra, con `sb`: companyId e documentId che seguono vengono da una riga che
  // l'utente ha potuto leggere, non dalla richiesta.
  const sbAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Sessione non valida.', code: 'PROVIDER_ERROR' }, 401);
  const userId = userData.user.id;

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return fail('AI_NOT_CONFIGURED', 503);

  const body = await req.json().catch(() => null);
  const documentId = body?.documentId;
  // §42 — lingua in cui l'utente legge l'app: i testi GENERATI la seguono
  // (le citazioni restano sempre nella lingua originale del documento).
  const outputLanguage: 'it' | 'de' | 'fr' =
    body?.outputLanguage === 'de' ? 'de' : body?.outputLanguage === 'fr' ? 'fr' : 'it';
  if (typeof documentId !== 'string') return json({ error: 'Richiesta non valida.', code: 'UNKNOWN_ERROR' }, 400);

  // §49 — autorizzazione via RLS: se non membro, la select non torna nulla → 403.
  const { data: doc, error: docErr } = await sb.from('documents')
    .select('id, company_id, storage_path, mime_type, file_size, status, updated_at').eq('id', documentId).maybeSingle();
  if (docErr) return fail('UNKNOWN_ERROR', 500);
  if (!doc) return json({ error: 'Documento non trovato o accesso negato.', code: 'PROVIDER_ERROR' }, 403);
  const companyId = doc.company_id as string;

  // ---- UNA LETTURA PER VOLTA ----------------------------------------------
  //
  // ⚠️⚠️ IL CASO REALE del 2026-08-21. Lo stesso PDF di 15 pagine è stato
  // analizzato DUE volte a 74 secondi di distanza: due chiamate a opus, due
  // righe in `document_analyses`, credito speso due volte. Fin qui questa
  // funzione del documento leggeva `id, company_id, storage_path, mime_type,
  // file_size` — lo stato non lo guardava nessuno, e niente rifiutava la
  // seconda partenza.
  //
  // ⚠️ È UNA PRESA ATOMICA, non una lettura seguita da una decisione: due
  // richieste simultanee leggerebbero entrambe «non in corso» e partirebbero
  // entrambe. La condizione sta DENTRO l'UPDATE, ed è il database a dire quale
  // delle due ha vinto — la stessa forma che i worker di Finanze e Contratti
  // usano già per prendere in carico un documento.
  //
  // ⚠️ CHI PERDE NON RICEVE UN ERRORE. Riceve `202 processing`, che è la verità:
  // un'analisi su questo documento è in corso. Il client la sta già aspettando
  // — `analyzeAndPersist` chiede sempre la modalità asincrona e su «processing»
  // si mette in ascolto del database — quindi vedrà l'esito della PRIMA analisi
  // invece di pagarne una seconda. Nessun codice d'errore nuovo, nessuna frase
  // nuova da tradurre.
  //
  // ⚠️ LA REGOLA È SCRITTA DUE VOLTE, E DEVE ESSERLO. `analisiGiaInCorso` la
  // dice in forma leggibile e PROVABILE — è lì che vive la soglia, controparte
  // di `recoverStuckAnalyses`: oltre venti minuti il documento è dichiarato
  // interrotto e ripartire torna legittimo. La stessa condizione è poi ripetuta
  // DENTRO l'UPDATE, perché una decisione presa in TypeScript su una riga letta
  // un istante prima non regge a due richieste simultanee. Le due forme non
  // divergono perché non hanno numeri propri: leggono entrambe
  // `STATI_IN_LAVORAZIONE` e `STUCK_ANALYSIS_MINUTES`.
  //
  // Il controllo leggibile viene per primo e chiude il caso normale — due clic,
  // un rientro — senza toccare il database. La presa atomica sotto è per la
  // corsa vera.
  if (analisiGiaInCorso({ status: doc.status as string | null, updatedAt: doc.updated_at as string | null })) {
    return json({ status: 'processing', documentId }, 202);
  }

  // ⚠️ DUE INTERROGAZIONI, NON UNA `or(...)`. La seconda confronta una data, e
  // il progetto ha già deciso — e pagato — che infilare un timestamp dentro la
  // sintassi dei filtri combinati di PostgREST significa doverlo sfuggire a
  // mano: `_shared/finance/store.ts:97-100` lo scrive per esteso, «una riga in
  // più qui vale più di un filtro che si rompe il giorno del cambio d'ora».
  // Ognuna delle due è atomica per conto suo, ed è quello che serve: la prima
  // prende ciò che non è in lavorazione, la seconda ciò che lo è da troppo.
  const sogliaInterrotta = new Date(Date.now() - STUCK_ANALYSIS_MINUTES * 60_000).toISOString();
  const statoPrimaDellaPresa = (doc.status as string | null) ?? 'uploaded';

  const libero = await sbAdmin.from('documents')
    .update({ status: 'extracting' })
    .eq('id', documentId)
    .not('status', 'in', `(${[...STATI_IN_LAVORAZIONE].join(',')})`)
    .select('id');
  if (libero.error) return fail('UNKNOWN_ERROR', 500);

  let presaVinta = (libero.data?.length ?? 0) > 0;
  if (!presaVinta) {
    // Risultava in lavorazione: si può prendere SOLO se è un lavoro abbandonato
    // oltre la soglia. Un solo confronto, su una sola colonna.
    const stantio = await sbAdmin.from('documents')
      .update({ status: 'extracting' })
      .eq('id', documentId)
      .lt('updated_at', sogliaInterrotta)
      .select('id');
    if (stantio.error) return fail('UNKNOWN_ERROR', 500);
    presaVinta = (stantio.data?.length ?? 0) > 0;
  }
  if (!presaVinta) return json({ status: 'processing', documentId }, 202);

  /**
   * Restituisce il documento allo stato di prima.
   *
   * ⚠️ Serve perché la presa avviene PRIMA delle validazioni sincrone: se una
   * di quelle respinge, il documento resterebbe «in estrazione» e nessuno
   * potrebbe rianalizzarlo per venti minuti. Un rifiuto immediato non deve
   * costare un blocco. Da quando il lavoro parte davvero, la proprietà dello
   * stato passa alla pipeline e a `markFailed`: `rilasciaPresa` non tocca più
   * niente.
   */
  let presaDaRilasciare = true;
  async function rilasciaPresa() {
    if (!presaDaRilasciare) return;
    presaDaRilasciare = false;
    // ⚠️⚠️ NON SI RIARMA UN LUCCHETTO STANTIO. Se la presa è stata vinta sul
    // secondo ramo, lo stato di prima era ESSO STESSO uno stato di lavorazione:
    // riscriverlo direbbe una cosa falsa sulla fase (era `analyzing`, noi
    // abbiamo scritto `extracting`) e costerebbe comunque gli stessi venti
    // minuti, perché il trigger `updated_at` riparte da adesso in entrambi i
    // casi. Si lascia il documento com'è: nessuno lo sta lavorando davvero, e
    // `recoverStuckAnalyses` lo chiude alla scadenza. ⚠️ Il costo — il recupero
    // riparte da capo — è reale e vale la pena saperlo: un tentativo RESPINTO su
    // un documento già appeso ne rimanda la chiusura di venti minuti.
    if ((STATI_IN_LAVORAZIONE as readonly string[]).includes(statoPrimaDellaPresa)) return;
    const { error: rilascioErr } = await sbAdmin.from('documents')
      .update({ status: statoPrimaDellaPresa }).eq('id', documentId);
    // ⚠️ NON si solleva: la richiesta è già stata respinta per un'altra ragione,
    // e trasformare un 422 onesto in un 500 direbbe a chi guarda una cosa falsa
    // sul perché. Ma non si TACE nemmeno: se il rilascio non riesce, il
    // documento resta «in estrazione» e nessuno potrà rianalizzarlo finché
    // `recoverStuckAnalyses` non lo dichiara interrotto — venti minuti in cui
    // sembra rotto senza che niente lo spieghi. Il log del server è l'unico
    // posto in cui qualcuno può accorgersene, e ci finisce il CODICE, non il
    // messaggio: un errore del database può portare dentro un valore.
    if (rilascioErr) console.error('presa non rilasciata:', rilascioErr.code ?? 'senza codice');
  }
  const rifiuta = async (code: ErrorCode, status: number) => {
    await rilasciaPresa();
    return fail(code, status);
  };

  // §50 — quota per azienda, verificata e consumata ATOMICAMENTE (0009): due
  // richieste concorrenti non possono più leggere lo stesso conteggio e passare
  // entrambe. La riga prenotata viene completata a fine lavoro.
  const slot = await reserveAiSlot(sb, {
    companyId, kind: 'analysis', limitPerMinute: RATE_LIMIT_PER_MINUTE,
    documentId, provider: 'anthropic', model: 'claude-opus-4-8',
  });
  if (!slot.allowed) return await rifiuta('RATE_LIMITED', 429);

  // §22 — contesto aziendale minimo.
  const { data: company } = await sb.from('companies')
    .select('legal_name, canton, municipality, legal_form').eq('id', companyId).maybeSingle();
  const { data: cprofile } = await sb.from('company_profiles').select('sector').eq('company_id', companyId).maybeSingle();
  const companyContext: CompanyContext = {
    legalName: company?.legal_name ?? null, canton: company?.canton ?? null,
    municipality: company?.municipality ?? null, legalForm: company?.legal_form ?? null,
    sector: cprofile?.sector ?? null,
  };

  const anthropic = new Anthropic({ apiKey });
  const createMessage: CreateMessage = (r) => anthropic.messages.create(r as never) as Promise<ModelMessage>;

  // ---- Validazione dell'input di estrazione (SEMPRE sincrona) --------------
  // Ciò che si può respingere subito viene respinto subito, anche in modalità
  // asincrona: il client non deve scoprire un 422 tramite polling.
  const inExtraction = body?.extraction;
  const hasClientExtraction = inExtraction && typeof inExtraction.fullText === 'string' && Array.isArray(inExtraction.pages);
  let clientExtraction: ExtractionResult | null = null;
  let truncated = false;   // §28 — il testo inviato al modello è stato tagliato?
  let reuseExtractionId: string | null = null;

  // ---- §28 · «Rianalizza il testo che hai già» -----------------------------
  //
  // ⚠️⚠️ IL SERVER RILEGGE LA PROPRIA RIGA, NON SI FIDA DEL CORPO DELLA RICHIESTA.
  // Rimandare indietro un'estrazione salvata e farla riscrivere produceva DUE
  // affermazioni false, e nessuna delle due lasciava traccia:
  //
  //   1. `extraction_method`. `ClientExtraction` conosce solo `native_pdf` e
  //      `text`: un'estrazione nata da un OCR tornava indietro come `'text'` e
  //      `saveExtraction` fa UPSERT, quindi la provenienza vera veniva
  //      sovrascritta con una falsa. La schermata diceva «testo del PDF» su un
  //      documento che nessun PDF aveva mai avuto.
  //   2. `truncated`, ed è la più grave. Il testo salvato È GIÀ tagliato a
  //      `MAX_CHARS`, quindi al ritorno `original.length > MAX_CHARS` confronta
  //      120000 con 120000 e risponde **falso**: la riga passava da `true` a
  //      `false` e un'analisi PARZIALE si presentava come completa. È esattamente
  //      la cosa che §28 esiste per impedire.
  //
  // ⚠️ ALTERNATIVA SCARTATA: allargare `ClientExtraction` per accettare `'ocr'`
  // dal corpo. Sposta la bugia invece di toglierla — resterebbe il client a
  // dichiarare la provenienza del proprio testo — e non tocca `truncated`.
  //
  // ⚠️ E NON SI RISALVA NULLA (`reuseExtractionId`): `saveExtraction` scrive
  // `ocr_confidence: null`, quindi anche un upsert con valori identici
  // cancellerebbe il punteggio di una trascrizione OCR.
  if (body?.reuseStoredExtraction === true) {
    const { data: stored } = await sb.from('document_extractions')
      .select('id, full_text, pages, extraction_method, truncated')
      .eq('document_id', documentId).eq('company_id', companyId).maybeSingle();
    const row = stored as {
      id: string; full_text: string | null; pages: unknown;
      extraction_method: string | null; truncated: boolean | null;
    } | null;
    if (!row?.full_text?.trim()) return await rifiuta('EXTRACTION_FAILED', 422);

    const original = row.full_text;
    // ⚠️ Il troncamento si EREDITA e si somma: già tagliato prima, oppure
    // tagliato adesso. Ricalcolarlo da capo è il difetto che questo ramo chiude.
    truncated = row.truncated === true || original.length > MAX_CHARS;
    reuseExtractionId = row.id;
    clientExtraction = {
      fullText: original.slice(0, MAX_CHARS),
      // La provenienza si riporta com'era, `'ocr'` compreso: qui il tipo del
      // server la conosce, ed è il motivo per cui la rilettura vive QUI.
      extractionMethod: row.extraction_method === 'native_pdf' ? 'native_pdf'
        : row.extraction_method === 'ocr' ? 'ocr' : 'text',
      pages: Array.isArray(row.pages)
        ? (row.pages as { pageNumber?: unknown; text?: unknown }[]).map((p, i) => ({
            pageNumber: typeof p?.pageNumber === 'number' ? p.pageNumber : i + 1,
            text: String(p?.text ?? ''),
          }))
        : [{ pageNumber: 1, text: original.slice(0, MAX_CHARS) }],
    };
    if (clientExtraction.fullText.trim().length < MIN_CHARS_ABSOLUTE) {
      return await rifiuta('EMPTY_DOCUMENT', 422);
    }
  } else if (hasClientExtraction) {
    const original: string = inExtraction.fullText;
    const fullText: string = original.slice(0, MAX_CHARS);
    // §28 — oltre il limite il modello vede solo l'inizio del documento: il
    // troncamento va DICHIARATO, altrimenti un'analisi parziale sembra completa
    // (una scadenza nell'ultima pagina sparirebbe senza lasciare traccia).
    truncated = original.length > MAX_CHARS;
    clientExtraction = {
      fullText,
      extractionMethod: inExtraction.extractionMethod === 'native_pdf' ? 'native_pdf' : 'text',
      // Le pagine seguono il testo troncato: si tengono finché rientrano nel
      // limite complessivo, così viewer e citazioni restano coerenti fra loro.
      pages: (() => {
        const out: { pageNumber: number; text: string }[] = [];
        let budget = MAX_CHARS;
        inExtraction.pages.forEach((p: { pageNumber?: number; text?: string }, i: number) => {
          if (budget <= 0) return;
          const t = String(p.text ?? '').slice(0, budget);
          budget -= t.length;
          out.push({ pageNumber: typeof p.pageNumber === 'number' ? p.pageNumber : i + 1, text: t });
        });
        if (out.length < inExtraction.pages.length) truncated = true;
        return out;
      })(),
    };

    // ⚠️⚠️ §4 — L'estrazione arrivata dal client è IMPLAUSIBILE per la forma del
    // file? Non la si rifiuta: la si IGNORA e si rilegge il file con l'OCR.
    //
    // Il 422 sarebbe la risposta comoda e sbagliata: all'utente non lascia
    // nessuna via d'uscita — il file È leggibile, semplicemente non da pdf.js.
    // Su un falso positivo questo ripiego costa una chiamata OCR in più; il
    // 422, su un falso negativo, costa un'analisi su 44 caratteri di rumore.
    //
    // `looksLikeScan` risponde `false` per ogni metodo diverso da `native_pdf`,
    // quindi un testo incollato non può finire qui: è la stessa ragione per cui
    // il controllo su `storage_path` che segue non lo manda a `ocrExtract` con
    // un `text/plain`, che l'OCR tratterebbe come `image/png`.
    if (looksLikeScan({
      chars: fullText.trim().length,
      pages: clientExtraction.pages.length,
      bytes: (doc.file_size as number | null) ?? null,
      extractionMethod: clientExtraction.extractionMethod,
    }) && doc.storage_path && (doc.file_size ?? 0) <= MAX_FILE_BYTES) {
      clientExtraction = null;
      truncated = false;   // il testo del client si butta: anche il suo troncamento
    } else if (fullText.trim().length < MIN_CHARS_ABSOLUTE) {
      return await rifiuta('EMPTY_DOCUMENT', 422);
    }
  }

  // ⚠️ Fuori dal ramo `else`: ora ci si arriva anche dal ripiego qui sopra, e
  // saltare queste due guardie manderebbe `ocrExtract` su un percorso nullo.
  if (!clientExtraction) {
    if (!doc.storage_path) return await rifiuta('EXTRACTION_FAILED', 422);
    if ((doc.file_size ?? 0) > MAX_FILE_BYTES) return await rifiuta('FILE_TOO_LARGE', 413);
  }

  /** Errore con fase e codice, per distinguere estrazione da analisi. */
  const phased = (code: ErrorCode, phase: 'extraction' | 'analysis') =>
    Object.assign(new Error(code), { code, phase });

  /** Il lavoro vero: estrazione (o OCR) + analisi + persistenza. */
  async function performWork() {
    const extractStart = Date.now();
    let extraction: ExtractionResult;
    try {
      extraction = clientExtraction ?? await ocrExtract(sb, anthropic, doc!.storage_path as string, doc!.mime_type as string | null);
      if (!extraction || extraction.fullText.trim().length < 20) throw phased('OCR_FAILED', 'extraction');
    } catch (e) {
      const code = ((e as { code?: ErrorCode }).code) ?? 'EXTRACTION_FAILED';
      const done = await finalizeAiRequest(sb, slot.logId, { status: 'error', errorCode: code }, 'utente');
      if (!done) await logAiRequest(sb, { companyId, userId, documentId, kind: 'extraction', provider: 'anthropic', model: null, status: 'error', errorCode: code });
      console.error('extraction error:', (e as Error)?.name);
      throw phased(code, 'extraction');
    }
    try {
      // sbAdmin: la pipeline scrive estrazione e analisi, che il client non può
      // più scrivere da sé (0010). L'accesso al documento è già stato verificato.
      return await runAnalysisPipeline(sbAdmin, createMessage, {
        documentId, companyId, userId,
        extraction, extractionDurationMs: Date.now() - extractStart, truncated, logId: slot.logId, outputLanguage,
        // ⚠️ `sb`, NON `sbAdmin`. La pipeline riceve il client amministrativo
        // perché deve scrivere lo snapshot (0010), ma la riga di quota l'ha
        // prenotata l'UTENTE (`try_consume_ai_quota` scrive `auth.uid()`) e solo
        // il suo JWT può chiuderla. Passare `sbAdmin` non dava errore: toccava
        // zero righe in silenzio, ed è così che quattro analisi riuscite su sei
        // sono rimaste `pending` mentre l'unica fallita si registrava.
        logSb: sb, logComeChi: 'utente',
        companyContext, todayIso: new Date().toISOString().slice(0, 10), provider: 'anthropic',
        // ⚠️ Solo sul percorso di rilettura: l'estrazione è già quella salvata e
        // riscriverla la peggiorerebbe (`ocr_confidence` azzerato). Se invece si
        // è passati dall'OCR di ripiego, `clientExtraction` è stato messo a
        // `null` e questo id non deve valere più — il testo nuovo va salvato.
        reuseExtractionId: clientExtraction ? reuseExtractionId : null,
      });
    } catch (e) {
      const err = e as Error & { code?: string; status?: number };
      // ⚠️ La classificazione sta in `_shared/validate.ts`, in un posto solo:
      // qui c'era una catena scritta a mano che non distingueva il credito
      // esaurito da un guasto qualunque, e diceva «riprova più tardi» a un
      // problema che aspettare non risolve.
      const code: ErrorCode = (err.code as ErrorCode) ?? classifyProviderError(err);
      console.error('analysis error:', err.name, err.message?.slice(0, 120));
      throw phased(code, 'analysis');
    }
  }

  /**
   * §27/§53 — documento e file restano; il fallimento è tracciabile e ri-tentabile.
   * IMPORTANTE: un tentativo fallito NON deve distruggere un'analisi valida
   * precedente. Si rimuovono solo gli esiti falliti già registrati (per non
   * accumularli) e si aggiunge il nuovo fallimento.
   */
  async function markFailed(code: ErrorCode) {
    await sb.from('documents').update({ status: 'failed' }).eq('id', documentId);
    // sbAdmin (0010): anche la registrazione di un FALLIMENTO è una scrittura
    // sullo snapshot, e il client non deve poterla fabbricare né cancellare.
    await sbAdmin.from('document_analyses').delete().eq('document_id', documentId).eq('analysis_status', 'failed');
    await sbAdmin.from('document_analyses').insert({
      document_id: documentId, company_id: companyId, analysis_status: 'failed',
      provider: 'anthropic', error_code: code, error_message_safe: ERROR_MESSAGES[code],
      processing_completed_at: new Date().toISOString(), engine: 'claude-opus-4-8',
    }).select('id').maybeSingle();
    const done = await finalizeAiRequest(sb, slot.logId, { status: 'error', errorCode: code }, 'utente');
    if (!done) await logAiRequest(sb, { companyId, userId, documentId, kind: 'analysis', provider: 'anthropic', model: 'claude-opus-4-8', status: 'error', errorCode: code });
  }

  // ⚠️ `AI_OUTPUT_TRUNCATED` è 500 e NON 502, che è il ripiego di questa mappa.
  // 502 dice «il servizio a monte ha risposto male»: qui il servizio a monte ha
  // risposto benissimo fino al tetto che gli abbiamo imposto noi. Il guasto è di
  // questa applicazione, e il codice di stato è la prima cosa che legge chi
  // guarda i log senza aprire il corpo della risposta.
  const httpStatusFor = (code: ErrorCode) =>
    code === 'RATE_LIMITED' ? 429 : code === 'AI_NOT_CONFIGURED' ? 503
      : code === 'FILE_TOO_LARGE' ? 413
        : code === 'AI_OUTPUT_TRUNCATED' ? 500
          : code === 'EXTRACTION_FAILED' || code === 'OCR_FAILED' || code === 'EMPTY_DOCUMENT' ? 422 : 502;

  // ---- §26 · modalità ASINCRONA (opt-in) -----------------------------------
  // La risposta torna subito; il lavoro prosegue in background sul server e lo
  // stato viaggia nel DB (documents.status + document_analyses.analysis_status),
  // che il client osserva. Nessun finto background: se il runtime non offre
  // waitUntil si resta sul percorso sincrono.
  const waitUntil = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime?.waitUntil;

  if (body?.async === true && typeof waitUntil === 'function') {
    await sb.from('documents').update({ status: clientExtraction ? 'analyzing' : 'extracting' }).eq('id', documentId);
    // Da qui la proprietà dello stato passa al lavoro: `performWork` lo porta
    // avanti e `markFailed` lo chiude su guasto. Rilasciarlo adesso
    // significherebbe rimettere il documento «libero» mentre è in mano a
    // qualcuno — cioè riaprire il difetto dall'altra parte.
    presaDaRilasciare = false;
    waitUntil((async () => {
      try { await performWork(); }
      catch (e) { await markFailed(((e as { code?: ErrorCode }).code) ?? 'UNKNOWN_ERROR'); }
    })());
    return json({ status: 'processing', documentId }, 202);
  }

  // ---- Modalità SINCRONA (comportamento storico, invariato) ----------------
  try {
    const result = await performWork();
    // La pipeline ha già scritto lo stato finale (`completed`/`needs_review`):
    // restituirlo a com'era lo cancellerebbe.
    presaDaRilasciare = false;
    return json({ status: result.status, analysis: result.analysis });
  } catch (e) {
    const code = ((e as { code?: ErrorCode }).code) ?? 'UNKNOWN_ERROR';
    const phase = (e as { phase?: string }).phase;
    // ⚠️⚠️ QUI LA PRESA SI RESTITUISCE, E PRIMA DI ESSA NON C'ERA NIENTE DA
    // RESTITUIRE. `markFailed` chiude il documento su `failed`, che è uno stato
    // finale: la presa si scioglie da sé. Ma viene chiamato SOLO per un guasto
    // di ANALISI — un guasto di ESTRAZIONE (`phased(code, 'extraction')`, righe
    // 328 e 334) non produce alcun verbale e non tocca lo stato. Prima della
    // presa in carico era innocuo, perché nessuno aveva marcato il documento;
    // adesso lascerebbe un `extracting` appeso per venti minuti su un guasto
    // già riferito al chiamante. Il ramo asincrono non ha questo problema: il
    // suo `catch` chiama `markFailed` sempre.
    if (phase === 'analysis') { presaDaRilasciare = false; await markFailed(code); }
    else await rilasciaPresa();
    return fail(code, httpStatusFor(code));
  }
});

// ---- OCR via Claude vision (§4) --------------------------------------------
// Il download dallo Storage resta qui — dipende dal client Supabase di questa
// funzione — mentre la trascrizione vera vive in `_shared/extract.ts`, condivisa
// con la sincronizzazione dell'Inbox.
async function ocrExtract(
  // ⚠️ La forma MINIMA che serve, non il client intero. `ReturnType<typeof
  // createClient>` stava qui e non combaciava con il client davvero passato:
  // `createClient(url, key, opts)` produce `SupabaseClient<any, "public", …>`,
  // mentre `createClient` senza argomenti di tipo ha altri parametri di
  // default, e i due non sono assegnabili. Descrivere ciò che si usa — qui solo
  // `storage.from(…).download(…)` — è insieme più vero e più corto.
  sb: {
    storage: {
      from: (bucket: string) => {
        download: (path: string) => Promise<{ data: Blob | null; error: unknown }>;
      };
    };
  },
  anthropic: Anthropic,
  storagePath: string,
  mimeType: string | null,
): Promise<ExtractionResult> {
  const { data: blob, error } = await sb.storage.from('company-documents').download(storagePath);
  if (error || !blob) throw new Error('download fallito');

  return await sharedOcrExtract({
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mimeType,
    maxBytes: SHARED_MAX_FILE_BYTES,
    createMessage: (request) => anthropic.messages.create(request as never) as Promise<ModelMessage>,
  });
}
