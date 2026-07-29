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
    .in('status', ['analyzing', 'extracting', 'processing'])
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
