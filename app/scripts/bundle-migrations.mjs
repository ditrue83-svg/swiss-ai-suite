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

// ---------------------------------------------------------------------------
// Controllo: un valore aggiunto a un enum non può essere USATO nello stesso file
//
// Postgres consente `alter type … add value` dentro una transazione, ma
// l'etichetta non è utilizzabile finché la transazione non è chiusa (55P04
// «unsafe use of new value»). Il SQL editor di Supabase esegue tutto in
// un'unica transazione, e questo file concatena TUTTE le migrazioni: basta una
// riga che nomini l'etichetta appena aggiunta per far fallire ogni
// installazione da zero.
//
// È successo il 2026-07-27 con la 0015, che creava un indice parziale sul
// valore appena aggiunto. Il guasto si sarebbe visto solo al primo cliente
// nuovo — chi ha già il database applica le migrazioni una alla volta e non se
// ne accorge mai.
//
// I valori dichiarati con `create type … as enum (…)` sono esclusi: quelli sono
// utilizzabili subito, ed è il caso della 0006, dove `analysis_status` nasce con
// 'completed' mentre `document_status` lo riceve per aggiunta. Stessa etichetta,
// due tipi diversi.
// ---------------------------------------------------------------------------
const senzaCommenti = (sql) =>
  sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

const problemi = [];
for (let i = 0; i < files.length; i++) {
  const sql = readFileSync(join(MIG_DIR, files[i]), 'utf8');
  const codice = senzaCommenti(sql);

  const aggiunti = [...codice.matchAll(/alter\s+type\s+[\w.]+\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'/gi)]
    .map((m) => m[1]);
  if (!aggiunti.length) continue;

  // Etichette che nello stesso file nascono anche da un CREATE TYPE: legittime.
  const creati = new Set(
    [...codice.matchAll(/create\s+type\s+[\w.]+\s+as\s+enum\s*\(([^)]*)\)/gi)]
      .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((v) => v[1])),
  );

  for (const valore of aggiunti) {
    if (creati.has(valore)) continue;
    const usi = [...codice.matchAll(new RegExp(`'${valore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'g'))]
      .filter((m) => {
        const prima = codice.slice(Math.max(0, m.index - 140), m.index);
        if (/add\s+value\s*(?:if\s+not\s+exists\s*)?$/i.test(prima)) return false;
        const rigaCorrente = prima.split('\n').pop() ?? '';
        return !/comment\s+on/i.test(rigaCorrente);
      });
    if (usi.length) problemi.push(`${names[i]}: il valore '${valore}' viene aggiunto E usato nello stesso file`);
  }
}

// ---------------------------------------------------------------------------
// Controllo: `full-setup.sql` deve essere RIESEGUIBILE, come dichiara la sua
// intestazione.
//
// `create trigger` e `create policy` non hanno una forma `if not exists`: su un
// database che li ha già, falliscono con 42710 e — siccome il SQL editor esegue
// tutto in una transazione sola — fanno fallire l'INTERO file. L'unica forma
// ripetibile è `drop … if exists` immediatamente prima.
//
// È successo il 2026-07-27: `full-setup.sql` dichiarava «rieseguirlo è sicuro»
// e si fermava alla prima riga della 0001 (`trg_profiles_updated already
// exists`). Non era un difetto di una migrazione, era un'AFFERMAZIONE FALSA in
// un file generato — la stessa classe di guasto del controllo i18n che diceva
// verde. Ora la promessa è verificata prima di essere scritta.
// ---------------------------------------------------------------------------
for (let i = 0; i < files.length; i++) {
  const codice = senzaCommenti(readFileSync(join(MIG_DIR, files[i]), 'utf8'));
  const protetti = {
    trigger: new Set([...codice.matchAll(/drop\s+trigger\s+if\s+exists\s+(\w+)/gi)].map((m) => m[1].toLowerCase())),
    policy: new Set([...codice.matchAll(/drop\s+policy\s+if\s+exists\s+(\w+)/gi)].map((m) => m[1].toLowerCase())),
  };
  for (const tipo of ['trigger', 'policy']) {
    const re = new RegExp(`create\\s+${tipo}\\s+(\\w+)`, 'gi');
    for (const m of codice.matchAll(re)) {
      if (!protetti[tipo].has(m[1].toLowerCase())) {
        problemi.push(`${names[i]}: ${tipo} ${m[1]} senza «drop ${tipo} if exists» che lo preceda`);
      }
    }
  }
}

if (problemi.length) {
  console.error('\n✗ Uso non sicuro di un valore enum appena aggiunto, oppure istruzione non ripetibile:');
  for (const p of problemi) console.error(`    ${p}`);
  console.error('  · Un valore enum appena aggiunto: Postgres lo rifiuta con 55P04 quando lo script');
  console.error('    gira in una transazione sola, cioè sempre nel SQL editor e sempre in full-setup.');
  console.error('    L\'etichetta nuova non deve comparire in nessun\'altra istruzione dello stesso file.');
  console.error('  · Un trigger o una policy senza «drop … if exists»: falliscono con 42710 su un');
  console.error('    database che li ha già, e fermano l\'intero file. full-setup.sql dichiara di');
  console.error('    essere rieseguibile: deve esserlo davvero.\n');
  process.exit(1);
}

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(OUT, 'utf8'); } catch { /* assente */ }
  if (current === bundled) { console.log(`✓ ${OUT} allineato alle ${files.length} migrazioni`); process.exit(0); }
  console.error(`✗ ${OUT} NON è allineato alle migrazioni (${names.join(', ')}).\n  Rigeneralo con: npm run db:bundle`);
  process.exit(1);
}

writeFileSync(OUT, bundled);
console.log(`✓ ${OUT} rigenerato da ${files.length} migrazioni: ${names.join(', ')}`);
