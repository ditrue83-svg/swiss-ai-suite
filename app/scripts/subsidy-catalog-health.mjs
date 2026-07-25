// ============================================================================
// Manutenzione catalogo (S4) — health check di `subsidy_programs`.
// Legge la tabella REALE e verifica INTEGRITÀ (campi, id validi, coerenza) e
// FRESCHEZZA (data_status 'recheck' + last_checked_at oltre soglia). Sola lettura.
//   node --env-file=.env.test scripts/subsidy-catalog-health.mjs
//   npm run subsidy:health   [-- --stale-days=120]
//
// Exit code:  0 = tutto valido e aggiornato · 1 = valido ma qualcosa da
//             ricontrollare · 2 = errori di integrità (dati malformati).
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

// Insiemi ammessi (allineati a TIPI_PROGETTO/SETTORI/SupportType e alla 0007).
const PROJECT_TYPES = ['innovazione', 'energia', 'digitalizzazione', 'formazione', 'mobilita', 'assunzioni', 'export', 'edilizia'];
const SECTORS = ['industria', 'costruzioni', 'commercio', 'servizi', 'ict', 'turismo', 'sanita', 'trasporti'];
const SUPPORT_TYPES = ['grant', 'tax_relief', 'guarantee', 'loan', 'reimbursement', 'advisory', 'other'];
const DATA_STATUS = ['verified', 'recheck', 'demo'];
const ANSWERS = ['si', 'no'];

const staleArg = process.argv.find((a) => a.startsWith('--stale-days='));
const STALE_DAYS = staleArg ? Math.max(1, parseInt(staleArg.split('=')[1], 10) || 180) : 180;

const { SUPABASE_URL: U, SUPABASE_SERVICE_ROLE_KEY: S } = process.env;
if (!U || !S) { console.error('Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (usa --env-file=.env.test).'); process.exit(2); }
const admin = createClient(U, S, { auth: { persistSession: false, autoRefreshToken: false } });

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isArr = (v) => Array.isArray(v);
const daysBetween = (fromISO, to) => {
  const d = new Date(fromISO + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((to.getTime() - d.getTime()) / 86_400_000);
};

// Controlli di integrità su una riga. Ritorna array di messaggi di errore.
function lint(p) {
  const errs = [];
  const need = (cond, msg) => { if (!cond) errs.push(msg); };

  for (const f of ['id', 'name', 'authority', 'support_type', 'contribution_description', 'application_window', 'official_source_url', 'source_title'])
    need(isStr(p[f]), `campo obbligatorio mancante/vuoto: ${f}`);
  need(SUPPORT_TYPES.includes(p.support_type), `support_type non valido: ${p.support_type}`);
  need(DATA_STATUS.includes(p.data_status), `data_status non valido: ${p.data_status}`);
  need(isStr(p.official_source_url) && /^https?:\/\//.test(p.official_source_url), `official_source_url non è un URL http(s): ${p.official_source_url}`);

  need(isArr(p.geography) && p.geography.length > 0 && p.geography.every(isStr), 'geography vuota o malformata');
  need(isArr(p.target_sectors) && p.target_sectors.length > 0, 'target_sectors vuoto o malformato');
  if (isArr(p.target_sectors)) for (const s of p.target_sectors) need(s === 'ALL' || SECTORS.includes(s), `target_sectors: settore non valido '${s}'`);
  need(isArr(p.project_types) && p.project_types.length > 0, 'project_types vuoto o malformato');
  if (isArr(p.project_types)) for (const t of p.project_types) need(PROJECT_TYPES.includes(t), `project_types: tipo non valido '${t}'`);

  need(Number.isFinite(p.company_size_min) && p.company_size_min >= 0, 'company_size_min non valido');
  need(Number.isFinite(p.company_size_max) && p.company_size_max >= 0, 'company_size_max non valido');
  if (Number.isFinite(p.company_size_min) && Number.isFinite(p.company_size_max)) need(p.company_size_min <= p.company_size_max, `company_size_min (${p.company_size_min}) > max (${p.company_size_max})`);

  need(typeof p.must_apply_before_start === 'boolean', 'must_apply_before_start non booleano');

  const reqIds = new Set();
  need(isArr(p.requirements), 'requirements non è un array');
  if (isArr(p.requirements)) for (const [i, r] of p.requirements.entries()) {
    need(r && isStr(r.id) && isStr(r.text) && isStr(r.question) && typeof r.hard === 'boolean', `requirements[${i}] malformato`);
    if (r && isStr(r.id)) { need(!reqIds.has(r.id), `requirements: id duplicato '${r.id}'`); reqIds.add(r.id); }
  }
  need(isArr(p.exclusions), 'exclusions non è un array');
  if (isArr(p.exclusions)) for (const [i, x] of p.exclusions.entries()) {
    need(x && isStr(x.id) && isStr(x.text), `exclusions[${i}] malformato`);
    if (x && x.evaluable) {
      need(isStr(x.question), `exclusions[${i}] valutabile senza question`);
      need(ANSWERS.includes(x.triggeringAnswer), `exclusions[${i}] triggeringAnswer non valido: ${x.triggeringAnswer}`);
    }
  }
  return errs;
}

const run = async () => {
  const { data, error } = await admin.from('subsidy_programs').select('*').order('data_status', { ascending: true }).order('id', { ascending: true });
  if (error) { console.error('Lettura fallita:', error.message); process.exit(2); }
  const rows = data ?? [];
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);

  console.log(`\nCatalogo subsidy_programs — health check (${todayISO}, soglia freschezza ${STALE_DAYS}g)\n`);

  const integrityIssues = [];
  const toRecheck = [];
  const warnings = [];
  const byStatus = { verified: 0, recheck: 0, demo: 0, other: 0 };
  let activeCount = 0;

  for (const p of rows) {
    byStatus[DATA_STATUS.includes(p.data_status) ? p.data_status : 'other']++;
    if (p.active) activeCount++;

    const errs = lint(p);
    const age = isStr(p.last_checked_at) ? daysBetween(p.last_checked_at, today) : null;
    const ageTxt = age == null ? 'mai' : `${age}g`;

    // Freschezza: recheck sempre; verified se oltre soglia; demo/senza data sempre.
    const stale = p.data_status === 'recheck' || p.data_status === 'demo' || age == null || (p.data_status === 'verified' && age > STALE_DAYS);
    const reason = p.data_status === 'recheck' ? 'recheck' : p.data_status === 'demo' ? 'demo' : age == null ? 'mai verificato' : `verified, ${age}g > ${STALE_DAYS}g`;

    if (p.must_apply_before_start === true && !isStr(p.must_apply_before_start_text))
      warnings.push(`${p.id}: must_apply_before_start=true ma manca must_apply_before_start_text`);
    if (p.active === false) warnings.push(`${p.id}: NON attivo (nascosto agli utenti)`);

    const flag = errs.length ? '✗ ERRORI' : stale ? '· da ricontrollare' : '✓ ok';
    console.log(`  [${String(p.data_status).padEnd(8)}] ${String(p.id).padEnd(18)} chk ${String(p.last_checked_at ?? '—').padEnd(10)} (${ageTxt.padStart(4)})  ${flag}`);
    for (const e of errs) { console.log(`             ✗ ${e}`); integrityIssues.push(`${p.id}: ${e}`); }
    if (stale && !errs.length) toRecheck.push(`${p.id} (${reason})`);
  }

  console.log('\n— Riepilogo —');
  console.log(`  Programmi: ${rows.length}  (verified ${byStatus.verified} · recheck ${byStatus.recheck} · demo ${byStatus.demo}${byStatus.other ? ` · altro ${byStatus.other}` : ''})`);
  console.log(`  Attivi: ${activeCount}/${rows.length}`);
  console.log(`  Errori di integrità: ${integrityIssues.length}`);
  console.log(`  Da ricontrollare (freschezza): ${toRecheck.length}`);

  if (warnings.length) { console.log('\n— Avvisi —'); for (const w of warnings) console.log(`  ! ${w}`); }
  if (toRecheck.length) { console.log('\n— Da ricontrollare —'); for (const r of toRecheck) console.log(`  - ${r}`); }
  if (integrityIssues.length) { console.log('\n— Errori di integrità (da correggere nel seed) —'); for (const e of integrityIssues) console.log(`  ✗ ${e}`); }

  const code = integrityIssues.length ? 2 : toRecheck.length ? 1 : 0;
  console.log(`\nEsito: ${code === 0 ? 'catalogo valido e aggiornato' : code === 1 ? 'valido, ma ci sono programmi da ricontrollare' : 'ERRORI DI INTEGRITÀ — correggere il seed'} (exit ${code})\n`);
  process.exit(code);
};

run().catch((e) => { console.error('Errore inatteso:', e?.message ?? e); process.exit(2); });
