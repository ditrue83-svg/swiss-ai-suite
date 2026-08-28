// ============================================================================
// IL CONTROLLO DELLE FONTI — dal registro alla coda delle revisioni.
//
// ⚠️ QUESTO PASSO NON AGGIORNA MAI IL CATALOGO (§22). Legge, confronta,
// registra un'istantanea e — se qualcosa è cambiato — crea una voce da
// revisionare. La versione pubblicata resta quella finché una persona non
// decide, e con lei restano corrette tutte le pratiche che vi puntano.
//
// ⚠️ UN CONTROLLO FALLITO NON AGGIORNA LA FRESCHEZZA (§159). `last_error_at`
// sì, `last_successful_check_at` no: dedurre «verificato oggi» da un tentativo
// andato male renderebbe fresco un dato che nessuno ha letto — che è
// esattamente la bugia che questo impianto esiste per non raccontare.
// ============================================================================

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { findAdapter } from './adapters.ts';
import { fetchSource } from './fetchGuard.ts';
import { detectChanges, detectRecheckDue } from './diff.ts';
import { SOURCE_CHECK_BATCH, SOURCE_CHECK_SLOT_MS, VERIFY_STALE_DAYS } from './contract.ts';

export interface SourceCheckReport {
  sourcesChecked: number;
  unchanged: number;
  changed: number;
  errors: number;
  blocked: number;
  reviewsCreated: number;
  snapshotsWritten: number;
  codes: string[];
}

export function emptySourceReport(): SourceCheckReport {
  return {
    sourcesChecked: 0, unchanged: 0, changed: 0, errors: 0, blocked: 0,
    reviewsCreated: 0, snapshotsWritten: 0, codes: [],
  };
}

export interface SourceCheckDeps {
  sb: SupabaseClient;
  fetch: typeof fetch;
  now: () => number;
  deadlineMs: number;
  limit?: number;
}

export async function runSourceChecks(deps: SourceCheckDeps): Promise<SourceCheckReport> {
  const report = emptySourceReport();
  const { sb } = deps;

  const { data: sources, error } = await sb.rpc('subsidy_sources_due', {
    p_limit: deps.limit ?? SOURCE_CHECK_BATCH,
  });
  if (error) {
    report.codes.push(`sources_due:${error.code ?? 'error'}`);
    return report;
  }

  for (const source of (sources ?? []) as Array<Record<string, unknown>>) {
    // ⚠️ Si controlla il tempo PRIMA di cominciare, non dopo: un controllo
    //    iniziato a 145 secondi non finisce, e l'isolate muore senza che il
    //    `finally` giri. È la lezione più cara del progetto.
    if (deps.now() + SOURCE_CHECK_SLOT_MS > deps.deadlineMs) break;

    const sourceId = source.id as string;
    const adapter = findAdapter(source.adapter_key as string);
    report.sourcesChecked++;

    if (!adapter) {
      // ⚠️ Nessun ripiego su un adapter generico: una chiave sconosciuta è un
      //    errore di configurazione, e leggere una pagina che nessuno ha
      //    esaminato produrrebbe dati plausibili e falsi.
      report.errors++;
      report.codes.push('adapter_unknown');
      await sb.from('subsidy_source_fetches').insert({
        source_id: sourceId, status: 'skipped', error_code: 'adapter_unknown',
        http_status_category: 'none',
      });
      await sb.from('subsidy_sources').update({
        last_error_at: new Date().toISOString(), last_error_code: 'adapter_unknown',
      }).eq('id', sourceId);
      continue;
    }

    const previousHash = (source.last_content_hash as string | null) ?? null;
    const { data: prevSnap } = await sb
      .from('subsidy_source_snapshots')
      .select('normalized, content_hash, id')
      .eq('source_id', sourceId)
      .order('retrieved_at', { ascending: false })
      .limit(1).maybeSingle();

    const fetched = await fetchSource(
      source.canonical_url as string,
      source.allowed_host as string,
      { fetch: deps.fetch, now: deps.now },
      // §153 — prima si chiede se è cambiato, e solo dopo si scarica.
      { etag: null, lastModified: null },
    );

    const result = await adapter.run(fetched);

    const status = !fetched.ok
      ? (fetched.errorCode === 'source_blocked' ? 'blocked' : 'error')
      : (result.contentHash && result.contentHash !== previousHash ? 'changed' : 'unchanged');

    if (status === 'blocked') report.blocked++;
    else if (status === 'error') report.errors++;
    else if (status === 'changed') report.changed++;
    else report.unchanged++;
    if (fetched.errorCode) report.codes.push(fetched.errorCode);

    const { data: fetchRow } = await sb.from('subsidy_source_fetches').insert({
      source_id: sourceId,
      status,
      http_status_category: fetched.statusCategory ?? 'none',
      content_hash: result.contentHash || null,
      etag: fetched.etag ?? null,
      last_modified: fetched.lastModified ?? null,
      detected_change: status === 'changed',
      error_code: fetched.errorCode ?? result.errorCode ?? null,
      duration_ms: Math.round(fetched.durationMs),
      content_bytes: fetched.bytes?.byteLength ?? (fetched.text?.length ?? null),
    }).select('id').single();

    // Un'istantanea si scrive solo quando c'è davvero qualcosa di nuovo da
    // conservare: una fonte immutata non produce una seconda copia identica.
    let snapshotId: string | null = null;
    if (status === 'changed' && result.ok) {
      const { data: snap } = await sb.from('subsidy_source_snapshots').insert({
        source_id: sourceId,
        fetch_id: fetchRow?.id ?? null,
        title: result.title,
        canonical_url: fetched.finalUrl ?? (source.canonical_url as string),
        content_hash: result.contentHash,
        language: result.language,
        source_published_at: result.sourcePublishedAt,
        source_updated_at: result.sourceUpdatedAt,
        parser_version: result.parserVersion,
        normalized: { ...result.normalized, unsupported: result.unsupported },
        evidence: result.evidence,
        unsupported: result.unsupported,
      }).select('id').single();
      snapshotId = snap?.id ?? null;
      if (snapshotId) report.snapshotsWritten++;
    }

    // ⚠️ IL LEGAME SI LEGGE AL CONTRARIO. `subsidy_sources` non ha una colonna
    //    `program_id`: è il programma a dichiarare la propria fonte primaria.
    //    Senza questa lettura ogni revisione nasceva come `other`/`low` invece
    //    che come `program_metadata`, cioè arrivava nella coda senza dire a
    //    quale programma appartenesse — e una coda di cambiamenti anonimi non
    //    la si può revisionare.
    const { data: owner } = await sb.from('subsidy_programs')
      .select('id, last_checked_at').eq('primary_source_id', sourceId).maybeSingle();

    const proposals = detectChanges({
      sourceId,
      programId: owner?.id ?? null,
      previousHash,
      result,
      previousNormalized: (prevSnap?.normalized as Record<string, unknown>) ?? {},
    });

    // ⚠️ LA RIVERIFICA UMANA HA UN PERCORSO (0046). Fino a qui una revisione
    //    nasceva solo se la FONTE si muoveva: a coda vuota `last_checked_at`
    //    invecchiava oltre soglia senza che nessuno potesse riaprirla da dentro
    //    il prodotto, e `subsidy:health` usciva 1 senza un gesto che lo
    //    chiudesse. Quando è la verifica a essere vecchia — non la fonte — si
    //    apre una scheda `recheck_due` con `proposedValues` vuoto: non c'è
    //    nulla da applicare, c'è una pagina ufficiale da rileggere.
    if (owner?.id) {
      const recheck = detectRecheckDue({
        sourceId,
        programId: owner.id as string,
        lastCheckedAt: (owner.last_checked_at as string | null) ?? null,
        now: new Date(deps.now()),
        staleDays: VERIFY_STALE_DAYS,
      });
      if (recheck) proposals.push(recheck);
    }

    for (const p of proposals) {
      // ⚠️ SELECT + INSERT e non `upsert`. L'indice unico su `dedupe_key` è
      //    PARZIALE (`where dedupe_key is not null`) e PostgREST rifiuta un
      //    `on_conflict` che non corrisponda a un vincolo pieno.
      //
      // ⚠️⚠️ IL DIFETTO CHE QUESTA RIGA CHIUDE ERA UN FALLBACK SILENZIOSO, ed è
      //    stato trovato guardando il database dopo la prima esecuzione in
      //    produzione — non rileggendo il codice. Il rapporto diceva
      //    `reviewsCreated: 0` su sette fonti cambiate, e quello zero sembrava
      //    «non c'era niente da revisionare» mentre significava «la scrittura è
      //    stata rifiutata sette volte». Un guasto travestito da risultato: la
      //    stessa forma della coda dell'Inbox che si sarebbe svuotata senza
      //    analizzare niente. Ora un errore si CONTA e finisce nei codici.
      const { data: already } = await sb.from('subsidy_catalog_reviews')
        .select('id').eq('dedupe_key', p.dedupeKey).maybeSingle();
      if (already) continue;

      const { error: rErr } = await sb.from('subsidy_catalog_reviews').insert({
        source_fetch_id: fetchRow?.id ?? null,
        snapshot_id: snapshotId,
        program_id: owner?.id ?? null,
        change_type: p.changeType,
        previous_values: p.previousValues,
        proposed_values: p.proposedValues,
        risk_level: p.risk,
        notes: p.notes,
        dedupe_key: p.dedupeKey,
      });
      if (rErr) {
        // Una corsa fra due esecuzioni non è un errore: l'indice ha fatto il
        // suo lavoro. Tutto il resto va dichiarato.
        if (rErr.code !== '23505') {
          report.errors++;
          report.codes.push(`review:${rErr.code ?? 'error'}`);
        }
      } else {
        report.reviewsCreated++;
      }
    }

    // ⚠️ La freschezza si aggiorna SOLO dopo un controllo riuscito.
    if (fetched.ok) {
      await sb.from('subsidy_sources').update({
        last_successful_check_at: new Date().toISOString(),
        last_content_hash: result.contentHash || previousHash,
        last_error_code: null,
      }).eq('id', sourceId);
    } else {
      await sb.from('subsidy_sources').update({
        last_error_at: new Date().toISOString(),
        last_error_code: fetched.errorCode ?? 'unknown',
        // Un errore non allontana la prossima verifica: una fonte rotta va
        // guardata di nuovo presto, non di rado.
        next_check_at: new Date(deps.now() + 6 * 3600 * 1000).toISOString(),
      }).eq('id', sourceId);
    }
  }

  return report;
}
