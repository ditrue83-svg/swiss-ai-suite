// ============================================================================
// Rigenera `supabase/full-setup.sql` concatenando TUTTE le migrazioni.
//   npm run db:bundle          rigenera
//   npm run db:bundle -- --check   verifica soltanto (exit 1 se disallineato)
//
// Esiste perché il file di setup completo era rimasto fermo alla 0006: chi
// installava da zero otteneva un database senza il catalogo incentivi. Ora è
// un artefatto GENERATO, non un file da mantenere a mano.
// ============================================================================
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const MIG_DIR = 'supabase/migrations';
const OUT = 'supabase/full-setup.sql';

const files = readdirSync(MIG_DIR).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
if (!files.length) { console.error('Nessuna migrazione trovata in', MIG_DIR); process.exit(1); }
const names = files.map((f) => basename(f, '.sql'));

const header = `-- ============================================================================
-- SwissAI Suite — SETUP COMPLETO DATABASE
-- Incolla TUTTO questo file nel SQL Editor di Supabase ed esegui.
--
-- GENERATO dalle migrazioni versionate: NON modificarlo a mano.
-- Per rigenerarlo dopo aver aggiunto una migrazione:  npm run db:bundle
--
-- Contiene, in ordine:
${names.map((n) => `--   ${n}`).join('\n')}
--
-- È idempotente quanto lo sono le singole migrazioni: rieseguirlo è sicuro.
-- ============================================================================

`;

const body = files.map((f, i) =>
  `-- >>>>>>>>>>>>>>>>>>>>  ${names[i]}  <<<<<<<<<<<<<<<<<<<<\n\n${readFileSync(join(MIG_DIR, f), 'utf8').trimEnd()}\n\n`,
).join('');

const bundled = header + body;

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(OUT, 'utf8'); } catch { /* assente */ }
  if (current === bundled) { console.log(`✓ ${OUT} allineato alle ${files.length} migrazioni`); process.exit(0); }
  console.error(`✗ ${OUT} NON è allineato alle migrazioni (${names.join(', ')}).\n  Rigeneralo con: npm run db:bundle`);
  process.exit(1);
}

writeFileSync(OUT, bundled);
console.log(`✓ ${OUT} rigenerato da ${files.length} migrazioni: ${names.join(', ')}`);
