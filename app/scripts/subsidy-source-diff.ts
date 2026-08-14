// ============================================================================
// subsidy:sources — «le fonti ufficiali dicono ancora quello che pubblichiamo?»
//
//   npm run subsidy:sources                 → i sette programmi, uno per riga
//   npm run subsidy:sources -- --self-test  → prova il giudizio, senza rete
//
// ⚠️⚠️ NON SCRIVE NIENTE, e la ragione non è la prudenza: è la SEMANTICA.
// `subsidy_programs.last_checked_at` significa **«una persona ha guardato la
// fonte e ciò che pubblichiamo è ancora vero»** — lo muove solo la decisione
// `accepted` di `resolve_subsidy_catalog_review`, che registra CHI l'ha presa.
// Un comando che lo aggiornasse scriverebbe che una persona ha verificato
// quando a leggere è stato uno script: è la bugia esatta che il 2026-08-05 ha
// fatto scegliere `ignored` invece di `accepted` sulle sette revisioni.
// Questo comando dunque MOSTRA il confronto; la verifica resta un gesto umano.
//
// ⚠️ E NON È `runSourceChecks`, che è un'altra cosa e gira già da sola.
// `subsidy-worker` la esegue ogni quindici minuti e legge le fonti SCADUTE —
// ciascuna con la sua cadenza (7 giorni per una pagina critica, 180 per una
// base legale). Quel percorso scrive: istantanee, esiti, freschezza, revisioni.
// Qui invece si legge **ora, tutte e sette**, senza toccare niente, perché la
// domanda di una persona («che cosa è cambiato da quando l'ho verificato?») non
// coincide con la cadenza di uno scheduler.
//
// ⚠️ NON COSTA CREDITO ANTHROPIC. Il confronto è impronta contro impronta
// (`diff.ts`: «NESSUNA AI IN QUESTO FILE»). Costa sette richieste HTTP a sette
// siti ufficiali, con lo stesso User-Agent e la stessa guardia del percorso
// vero: si passa da `fetchSource`, quindi allowlist degli host, HTTPS imposto,
// redirect validati a ogni salto e tetto sui byte.
//
// ESITO
//   0  tutte le fonti lette, nessuna differenza rispetto all'ultima impronta
//   1  almeno una fonte è cambiata: c'è lavoro per una persona
//   2  almeno una fonte NON si è potuta leggere — e «non ho potuto guardare»
//      non è «non è cambiato niente»
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
import { fetchSource } from '../supabase/functions/_shared/subsidy/fetchGuard.ts';
import { findAdapter } from '../supabase/functions/_shared/subsidy/adapters.ts';
import { detectChanges, diffFields } from '../supabase/functions/_shared/subsidy/diff.ts';
if (!globalThis.WebSocket) (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';

export interface RigaConfronto {
  programma: string | null;
  fonte: string;
  /** 'uguale' · 'cambiata' · 'illeggibile' */
  esito: 'uguale' | 'cambiata' | 'illeggibile';
  codice?: string | null;
  /** Giorni dall'ultima lettura RIUSCITA registrata (non da questa). */
  ultimaLetturaGiorni: number | null;
  /** Giorni dall'ultima verifica UMANA del programma. */
  verificaUmanaGiorni: number | null;
  cambiamenti?: string[];
}

/**
 * Il giudizio, come funzione PURA.
 *
 * ⚠️ Tre esiti e non due: una fonte illeggibile pesa PIÙ di una cambiata, ed è
 * l'ordine che conta. Una fonte cambiata dà lavoro a una persona; una fonte che
 * non risponde toglie a chiunque la possibilità di sapere se sia cambiata — e
 * il catalogo continuerebbe a dichiararsi verificato appoggiandosi a una lettura
 * che non è mai avvenuta.
 */
export function giudicaConfronto(righe: RigaConfronto[]): { code: number; esito: string } {
  const illeggibili = righe.filter((r) => r.esito === 'illeggibile');
  const cambiate = righe.filter((r) => r.esito === 'cambiata');
  if (illeggibili.length) {
    return {
      code: 2,
      esito: `${illeggibili.length} fonti NON LETTE (${illeggibili.map((r) => r.programma ?? r.fonte).join(', ')})`
        + `${cambiate.length ? ` · ${cambiate.length} cambiate` : ''} — «non ho potuto guardare» non è «non è cambiato niente»`,
    };
  }
  if (cambiate.length) {
    return {
      code: 1,
      esito: `${cambiate.length} fonti CAMBIATE dall'ultima impronta registrata `
        + `(${cambiate.map((r) => r.programma ?? r.fonte).join(', ')}): serve una persona`,
    };
  }
  return { code: 0, esito: `tutte e ${righe.length} le fonti dicono ancora ciò che era stato registrato` };
}

// ---------------------------------------------------------------------------
// AUTOVERIFICA — i casi che devono far scattare ciascun esito.
// ---------------------------------------------------------------------------
function selfTest(): boolean {
  const r = (esito: RigaConfronto['esito'], programma = 'p'): RigaConfronto => ({
    programma, fonte: 'f', esito, ultimaLetturaGiorni: 1, verificaUmanaGiorni: 20,
  });
  const casi: Array<[string, () => boolean]> = [
    ['tutte uguali → 0', () => giudicaConfronto([r('uguale'), r('uguale')]).code === 0],
    ['una cambiata → 1, e la NOMINA', () => {
      const g = giudicaConfronto([r('uguale'), r('cambiata', 'pronovo')]);
      return g.code === 1 && g.esito.includes('pronovo');
    }],
    ['⚠️ una illeggibile → 2: non ho potuto guardare non è «niente è cambiato»',
      () => giudicaConfronto([r('uguale'), r('illeggibile', 'ti-fer')]).code === 2],
    ['⚠️ illeggibile E cambiata → 2, ma la cambiata resta nominata: una non nasconde l\'altra', () => {
      const g = giudicaConfronto([r('cambiata', 'a'), r('illeggibile', 'b')]);
      return g.code === 2 && g.esito.includes('1 cambiate');
    }],
    ['nessuna fonte → 0 con il conteggio vero (e il chiamante lo vede)',
      () => giudicaConfronto([]).esito.includes('tutte e 0')],
  ];
  console.log(`\n${B}Autoverifica del confronto con le fonti${X} ${DIM}(nessuna rete)${X}\n`);
  let bad = 0;
  for (const [nome, fn] of casi) {
    let ok = false;
    try { ok = fn(); } catch { ok = false; }
    if (ok) console.log(`  ${G}✓${X} ${nome}`);
    else { bad++; console.log(`  ${R}✗${X} ${nome}`); }
  }
  if (bad) { console.error(`\n${R}${bad} casi falliti: il giudizio non è affidabile.${X}\n`); return false; }
  console.log(`\n${G}Tutti i ${casi.length} casi superati.${X}\n`);
  return true;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
}

// ---------------------------------------------------------------------------

const U = process.env.SUPABASE_URL;
const S = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !S) {
  console.error('Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (usa --env-file=.env.test).');
  process.exit(2);
}
const admin = createClient(U, S, { auth: { persistSession: false, autoRefreshToken: false } });

const giorni = (iso: string | null | undefined, oggi: Date): number | null => {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : Math.floor((oggi.getTime() - d.getTime()) / 86_400_000);
};

const oggi = new Date();

const { data: fonti, error: eF } = await admin.from('subsidy_sources')
  .select('id, canonical_url, allowed_host, adapter_key, check_frequency_days, criticality, last_successful_check_at, last_content_hash, next_check_at, enabled');
if (eF) { console.error(`Lettura delle fonti fallita: ${eF.message}`); process.exit(2); }

const { data: programmi, error: eP } = await admin.from('subsidy_programs')
  .select('id, primary_source_id, last_checked_at, data_status');
if (eP) { console.error(`Lettura dei programmi fallita: ${eP.message}`); process.exit(2); }

const programmaDi = new Map<string, { id: string; last_checked_at: string | null }>();
for (const p of programmi ?? []) {
  if (p.primary_source_id) programmaDi.set(p.primary_source_id as string, p as never);
}

console.log(`\n${B}Le fonti ufficiali dicono ancora ciò che pubblichiamo?${X}`);
console.log(`${DIM}${(fonti ?? []).length} fonti · sola lettura: nessuna riga viene scritta${X}\n`);

const righe: RigaConfronto[] = [];

for (const f of (fonti ?? []) as Array<Record<string, string>>) {
  const prog = programmaDi.get(f.id as string) ?? null;
  const etichetta = (prog?.id ?? `fonte ${String(f.id).slice(0, 8)}`).padEnd(18);
  const verificaUmanaGiorni = giorni(prog?.last_checked_at ?? null, oggi);
  const ultimaLetturaGiorni = giorni(f.last_successful_check_at, oggi);

  const adapter = findAdapter(f.adapter_key as string);
  if (!adapter) {
    righe.push({ programma: prog?.id ?? null, fonte: f.id, esito: 'illeggibile', codice: 'adapter_unknown', ultimaLetturaGiorni, verificaUmanaGiorni });
    console.log(`  ${R}✗${X} ${etichetta} ${R}adapter sconosciuto${X} ${DIM}(${f.adapter_key})${X}`);
    continue;
  }

  const fetched = await fetchSource(
    f.canonical_url as string,
    f.allowed_host as string,
    { fetch, now: () => Date.now() },
    { etag: null, lastModified: null },
  );
  const risultato = await adapter.run(fetched);

  if (!fetched.ok || !risultato.ok) {
    const codice = fetched.errorCode ?? risultato.errorCode ?? 'unknown';
    righe.push({ programma: prog?.id ?? null, fonte: f.id, esito: 'illeggibile', codice, ultimaLetturaGiorni, verificaUmanaGiorni });
    console.log(`  ${R}✗${X} ${etichetta} ${R}non letta${X} ${DIM}${codice} · ${fetched.statusCategory ?? '—'}${X}`);
    continue;
  }

  const uguale = !!risultato.contentHash && risultato.contentHash === f.last_content_hash;
  if (uguale) {
    righe.push({ programma: prog?.id ?? null, fonte: f.id, esito: 'uguale', ultimaLetturaGiorni, verificaUmanaGiorni });
    console.log(`  ${G}✓${X} ${etichetta} ${DIM}impronta identica · letta ${ultimaLetturaGiorni ?? '—'}g fa · verifica umana ${verificaUmanaGiorni ?? '—'}g fa${X}`);
    continue;
  }

  // ⚠️⚠️ L'ISTANTANEA PRECEDENTE SI LEGGE, NON SI FINGE VUOTA. La prima
  //    stesura di questo comando passava `previousNormalized: {}`, e contro un
  //    oggetto vuoto OGNI campo risulta nuovo e OGNI struttura non interpretata
  //    risulta appena comparsa: usciva «struttura cambiata» su fonti che non si
  //    erano mosse. È lo stesso difetto delle sette revisioni del 2026-07-30 —
  //    un confronto senza un «prima» non è un confronto — commesso mentre lo si
  //    stava raccontando. Trovato eseguendo, non rileggendo.
  const { data: snap } = await admin.from('subsidy_source_snapshots')
    .select('normalized, content_hash, retrieved_at')
    .eq('source_id', f.id)
    .order('retrieved_at', { ascending: false })
    .limit(1).maybeSingle();

  const proposte = snap
    ? detectChanges({
      sourceId: f.id as string,
      programId: prog?.id ?? null,
      previousHash: (f.last_content_hash as string) ?? null,
      result: risultato,
      previousNormalized: (snap.normalized as Record<string, unknown>) ?? {},
    })
    : [];
  const cambiamenti = proposte.map((p) => `${p.changeType}/${p.risk}: ${p.notes}`);
  righe.push({ programma: prog?.id ?? null, fonte: f.id, esito: 'cambiata', ultimaLetturaGiorni, verificaUmanaGiorni, cambiamenti });
  console.log(`  ${Y}!${X} ${etichetta} ${Y}impronta DIVERSA${X} ${DIM}· letta ${ultimaLetturaGiorni ?? '—'}g fa · istantanea ${snap ? String(snap.retrieved_at).slice(0, 10) : 'ASSENTE'}${X}`);
  for (const c of cambiamenti) console.log(`      ${DIM}${c}${X}`);
  // ⚠️ CHE COSA è cambiato, campo per campo: «il contenuto è cambiato» non è
  //    una risposta con cui una persona possa decidere. I valori sono di pagine
  //    pubbliche e si stampano troncati.
  if (snap) {
    const breve = (v: unknown) => JSON.stringify(v ?? null).slice(0, 60);
    // ⚠️ Si confronta con la forma CHE VERREBBE SALVATA — `runSourceChecks`
    //    scrive `{ ...normalized, unsupported }` — e non con `normalized` nudo:
    //    altrimenti `unsupported` risulta sparito a ogni confronto, perché sta
    //    nell'istantanea e non nell'uscita dell'adapter. È lo stesso difetto che
    //    `detectChanges` ha ancora dentro (§ product-status.md).
    const attuale = { ...risultato.normalized, unsupported: risultato.unsupported };
    for (const c of diffFields((snap.normalized as Record<string, unknown>) ?? {}, attuale)) {
      console.log(`      ${DIM}· ${c.field}: ${breve(c.previous)} → ${breve(c.proposed)}${X}`);
    }
  }
  if (!snap) {
    console.log(`      ${Y}nessuna istantanea precedente: i campi non sono confrontabili — è una prima lettura, non un cambiamento${X}`);
  } else if (!proposte.length) {
    console.log(`      ${DIM}nessuna proposta di revisione: l'impronta cambia, i campi normalizzati no (modifica redazionale)${X}`);
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${B}— Riepilogo —${X}`);
const conVerifica = righe.map((r) => r.verificaUmanaGiorni).filter((n): n is number => n != null);
console.log(`  Fonti lette adesso: ${righe.filter((r) => r.esito !== 'illeggibile').length}/${righe.length}`);
console.log(`  Impronte diverse: ${righe.filter((r) => r.esito === 'cambiata').length}`);
console.log(`  Verifica UMANA più vecchia: ${conVerifica.length ? `${Math.max(...conVerifica)} giorni` : '—'}`);
console.log(`  ${DIM}La verifica umana la muove solo «accetta» su una revisione: questo comando non la tocca.${X}`);

const { code, esito } = giudicaConfronto(righe);
console.log(`\n${code === 0 ? G : code === 1 ? Y : R}Esito: ${esito} (exit ${code})${X}\n`);
process.exit(code);
