// ============================================================================
// §27/§53 — I documenti rimasti «in elaborazione» per sempre.
//
// ⚠️⚠️ PERCHÉ ESISTE (2026-07-29). `EdgeRuntime.waitUntil` viene ucciso al
// limite dei 150 secondi di Supabase e il `finally` NON gira: il documento resta
// con `documents.status = 'analyzing'` e nessuno lo guarda più. La schermata
// dice «In elaborazione», che è indistinguibile da un lavoro davvero in corso —
// e uno stato appeso che sembra legittimo è la forma di guasto peggiore, perché
// non produce nemmeno la domanda «cosa è andato storto».
//
// Contratti e Finanze un recupero ce l'hanno (`requeueStale`, il ripescaggio dei
// `processing` stantii). Admin AI no, e il README lo dichiarava come limite:
// «manca una coda durevole (se l'istanza muore il documento resta in
// `analyzing`)». Questo modulo lo chiude senza introdurre una coda durevole:
// non riprende il lavoro, DICHIARA che non è arrivato in fondo.
//
// ⚠️ SI AGGANCIA AI `documents`, NON AL RAMO ASINCRONO, e la differenza conta.
// `runAnalysisPipeline` scrive `analyzing` su OGNI percorso — caricamento
// manuale, rianalisi, e anche l'Inbox, che passa dalla stessa pipeline. Un
// recupero costruito attorno al solo ramo `waitUntil` avrebbe lasciato scoperti
// proprio i documenti nati da un'email.
//
// ⚠️⚠️ NON BASTA SCRIVERE `documents.status = 'failed'`. `stateOf`
// (`src/features/documents/documentModel.ts`) decide leggendo PRIMA
// `document_analyses.analysis_status`: senza una riga di analisi fallita il
// documento tornerebbe allo stato `none` — «non ancora analizzato» — cioè un
// tentativo bruciato travestito da lavoro mai cominciato. Servono entrambe le
// scritture, ed è la stessa coppia che scrive `markFailed` in `analyze-document`.
//
// ⚠️ NESSUN RITENTATIVO AUTOMATICO, ed è deliberato. Un'analisi costa una
// chiamata al modello: riprovare da sé un documento che ha già consumato quota
// e tempo, senza sapere PERCHÉ si è interrotto, rischia di rifarlo all'infinito.
// Il documento diventa `failed` con un codice esplicito e la persona ha il
// pulsante «Riprova». È la stessa scelta della manutenzione dell'Inbox, dove il
// ritentativo automatico è UNO SOLO e il resto viene dichiarato.
// ============================================================================

/** Forma minima del client Supabase. Identica in Deno e in Node. */
type ServerClient = { from: (table: string) => any };

/**
 * Oltre quanti minuti un documento «in elaborazione» è considerato interrotto.
 *
 * ⚠️ Il tetto vero è 150 secondi: oltre, l'isolate non esiste più. Venti minuti
 * sono un margine ampio di proposito — un'analisi misurata costa 22–30 secondi,
 * e un documento entrato in coda un istante prima di questa esecuzione non deve
 * essere dichiarato morto mentre sta lavorando.
 */
export const STUCK_ANALYSIS_MINUTES = 20;

/**
 * Gli stati in cui una lettura è DICHIARATAMENTE in corso.
 *
 * Una lista sola per le due facce della stessa moneta: qui sotto decide chi va
 * dichiarato interrotto, in `analisiGiaInCorso` decide chi non va fatto
 * ripartire. Due elenchi tenuti allineati a mano divergono al primo stato
 * aggiunto da una parte sola, e la divergenza si vedrebbe come un'analisi
 * pagata due volte.
 */
export const STATI_IN_LAVORAZIONE = ['analyzing', 'extracting', 'processing'] as const;

/**
 * C'è già una lettura in corso su questo documento?
 *
 * ⚠️⚠️ PERCHÉ ESISTE (2026-08-21). Lo stesso PDF di 15 pagine è stato analizzato
 * DUE volte a 74 secondi di distanza — due chiamate a opus, due righe in
 * `document_analyses`, credito speso due volte. `analyze-document` leggeva del
 * documento solo `id, company_id, storage_path, mime_type, file_size`: lo stato
 * non lo guardava nessuno, e niente rifiutava la seconda partenza.
 *
 * ⚠️ LA SOGLIA NON È PRUDENZA, È LA CONTROPARTE DEL RECUPERO. Oltre
 * `STUCK_ANALYSIS_MINUTES` un documento «in elaborazione» è considerato
 * interrotto e `recoverStuckAnalyses` lo chiude: da quel momento ripartire è
 * legittimo e necessario. Sotto quella soglia, ripartire è pagare due volte.
 * Se le due soglie divergessero nascerebbe una terra di nessuno — o documenti
 * bloccati per sempre, o doppioni — ed è per questo che la costante è una sola.
 *
 * ⚠️ SENZA `updatedAt` SI CONSIDERA IN CORSO. Non è pessimismo: rifiutare costa
 * un'attesa e un messaggio, ripartire costa una chiamata al modello. Fra i due
 * errori possibili si sceglie quello che non si paga.
 */
export function analisiGiaInCorso(
  doc: { status: string | null; updatedAt: string | null },
  now: Date = new Date(),
): boolean {
  if (!doc.status) return false;
  if (!(STATI_IN_LAVORAZIONE as readonly string[]).includes(doc.status)) return false;
  const iniziata = doc.updatedAt ? Date.parse(doc.updatedAt) : Number.NaN;
  if (!Number.isFinite(iniziata)) return true;
  return now.getTime() - iniziata < STUCK_ANALYSIS_MINUTES * 60_000;
}

/** Quanti documenti al massimo per esecuzione: il tempo è la risorsa scarsa. */
const BATCH = 25;

export interface StuckReport {
  /** Documenti trovati appesi e dichiarati falliti. */
  recovered: number;
  /** Trovati appesi ma già in possesso di un esito: solo lo stato era rimasto indietro. */
  reconciled: number;
}

/**
 * Chiude i documenti rimasti in elaborazione oltre `STUCK_ANALYSIS_MINUTES`.
 *
 * Va chiamata con il SERVICE ROLE: scrive su `document_analyses`, che dalla 0010
 * il client non può scrivere. Non solleva mai — un guasto qui non deve far
 * fallire l'esecuzione di manutenzione che la ospita.
 */
export async function recoverStuckAnalyses(sb: ServerClient): Promise<StuckReport> {
  const report: StuckReport = { recovered: 0, reconciled: 0 };
  const cutoff = new Date(Date.now() - STUCK_ANALYSIS_MINUTES * 60_000).toISOString();

  const { data, error } = await sb.from('documents')
    .select('id, company_id')
    .in('status', [...STATI_IN_LAVORAZIONE])
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(BATCH);
  if (error || !Array.isArray(data)) return report;

  for (const row of data as { id: string; company_id: string }[]) {
    // ⚠️ SI GUARDA PRIMA SE UN ESITO C'È GIÀ. Fra la scrittura dell'analisi e
    // l'aggiornamento di `documents.status` c'è una finestra: un'esecuzione
    // uccisa lì in mezzo lascia un'analisi COMPLETA su un documento che si
    // dichiara ancora in lavorazione. Scriverci sopra un fallimento
    // cancellerebbe un risultato valido — il difetto che si sta correggendo,
    // ma al contrario.
    const { data: analyses } = await sb.from('document_analyses')
      .select('analysis_status')
      .eq('document_id', row.id).eq('company_id', row.company_id)
      .order('created_at', { ascending: false }).limit(1);
    const ultima = (analyses as { analysis_status?: string }[] | null)?.[0]?.analysis_status ?? null;

    if (ultima === 'completed' || ultima === 'needs_review') {
      // Il lavoro ERA finito: si allinea solo lo stato del documento, e non si
      // tocca l'analisi. `needs_review` e `completed` sono anche i due valori
      // che `documents.status` usa per la stessa cosa.
      await sb.from('documents').update({ status: ultima }).eq('id', row.id);
      report.reconciled++;
      continue;
    }

    await sb.from('documents').update({ status: 'failed' }).eq('id', row.id);
    // Stessa coppia di scritture di `markFailed`: si tolgono i fallimenti già
    // registrati per non accumularli, e NON si tocca nient'altro — un'analisi
    // valida precedente deve sopravvivere (§27/§53).
    await sb.from('document_analyses')
      .delete().eq('document_id', row.id).eq('analysis_status', 'failed');
    await sb.from('document_analyses').insert({
      document_id: row.id,
      company_id: row.company_id,
      analysis_status: 'failed',
      provider: 'anthropic',
      engine: 'claude-opus-4-8',
      // ⚠️ Lo stesso codice che l'Inbox usa per la stessa cosa: un'esecuzione
      // uccisa a metà. Un codice nuovo avrebbe raccontato due storie diverse
      // dello stesso guasto a seconda di come il documento era entrato.
      error_code: 'INTERRUPTED',
      error_message_safe:
        "L'analisi si è interrotta prima della fine e non è ripresa da sola. "
        + 'Il documento e il file sono intatti: si può riprovare.',
      processing_completed_at: new Date().toISOString(),
    });
    report.recovered++;
  }

  return report;
}
