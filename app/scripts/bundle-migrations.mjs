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
-- SERVE A INSTALLARE DA ZERO. Su un database già in esercizio si applica UNA
-- MIGRAZIONE ALLA VOLTA: questo file non aggiunge niente e in caso di errore
-- fa fallire l'intera transazione, compresa la migrazione che si voleva applicare.
--
-- Rieseguirlo è comunque sicuro, e la promessa è VERIFICATA prima di essere
-- scritta — non solo dichiarata. Il generatore controlla che:
--   · nessun trigger e nessuna policy vengano creati senza un «drop … if exists»
--     che li preceda (42710 fermerebbe tutto il file), riconoscendo anche i nomi
--     fra virgolette;
--   · nessun valore enum appena aggiunto venga usato nello stesso file (55P04).
-- Ciò che NON controlla, e che quindi resta responsabilità di chi scrive una
-- migrazione: tabelle, indici, colonne, vincoli, tipi e inserimenti di dati,
-- che vanno resi ripetibili a mano («if not exists», «do $$ … exception»,
-- «on conflict», «drop constraint if exists»).
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
// ⚠️ IL CORPO DI UNA FUNZIONE NON VIENE ESEGUITO QUANDO LA FUNZIONE VIENE
// CREATA (2026-07-27, terzo giro).
//
// `create function … as $$ … $$` deposita il corpo come TESTO: Postgres non
// risolve le etichette enum che vi compaiono, e lo farà solo alla prima
// chiamata — cioè dopo il commit. Un'etichetta nuova nominata là dentro NON
// produce 55P04 durante l'applicazione.
//
// La prima versione di questo controllo cercava l'etichetta ovunque nel file, e
// avrebbe quindi bloccato una migrazione perfettamente valida: la 0021 deve
// emettere due eventi di automazione da un trigger, e un trigger nomina per
// forza il proprio tipo di evento. Un controllo che vieta ciò che è lecito
// viene aggirato, e un controllo aggirato non protegge più da nulla.
//
// ⚠️ La distinzione NON vale per `do $$ … $$`: quello viene ESEGUITO subito, e
// un'etichetta nuova al suo interno fa fallire l'applicazione davvero. I casi di
// autoverifica coprono entrambe le direzioni.
//
// ⚠️ CIÒ CHE QUESTO CONTROLLO NON PUÒ VEDERE, e va detto: un blocco `do $$` che
// CHIAMA una funzione il cui corpo nomina l'etichetta nuova la valuta comunque,
// e qui non risulta. Chi scrive una migrazione deve evitarlo — nella 0021 è
// scritto in chiaro accanto all'`alter type`.
const senzaCommenti = (sql) =>
  sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

/**
 * Gli intervalli `[inizio, fine)` occupati dai CORPI delle funzioni.
 *
 * Scorre il testo saltando i blocchi con quotatura a dollaro e tenendo il
 * confine dell'istruzione corrente: per ogni blocco guarda l'intestazione che
 * lo precede e decide se è il corpo di una `create function` (non eseguito)
 * oppure un `do` (eseguito). Funzione pura, così si può mettere alla prova.
 */
export function corpiDiFunzione(sql) {
  const intervalli = [];
  const dollaro = /\$([A-Za-z_]\w*)?\$/y;
  let i = 0;
  let inizioIstruzione = 0;
  while (i < sql.length) {
    if (sql[i] === ';') { inizioIstruzione = i + 1; i++; continue; }
    if (sql[i] === '$') {
      dollaro.lastIndex = i;
      const m = dollaro.exec(sql);
      if (m) {
        const tag = m[0];
        const apertura = i + tag.length;
        const chiusura = sql.indexOf(tag, apertura);
        if (chiusura < 0) break;                       // quotatura non chiusa
        const intestazione = sql.slice(inizioIstruzione, i);
        if (/\bcreate\b[\s\S]*\bfunction\b/i.test(intestazione)) {
          intervalli.push([apertura, chiusura]);
        }
        i = chiusura + tag.length;
        continue;
      }
    }
    i++;
  }
  return intervalli;
}

/**
 * I valori enum aggiunti E usati nello stesso file. Funzione pura, come
 * `problemiDiRipetibilita`: il controllo e la sua autoverifica devono guardare
 * esattamente la stessa cosa.
 */
export function problemiEnum(sql) {
  const codice = senzaCommenti(sql);
  const trovati = [];

  const aggiunti = [...codice.matchAll(/alter\s+type\s+[\w.]+\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'/gi)]
    .map((m) => m[1]);
  if (!aggiunti.length) return trovati;

  // Etichette che nello stesso file nascono anche da un CREATE TYPE: legittime.
  const creati = new Set(
    [...codice.matchAll(/create\s+type\s+[\w.]+\s+as\s+enum\s*\(([^)]*)\)/gi)]
      .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((v) => v[1])),
  );

  const corpi = corpiDiFunzione(codice);
  const dentroUnCorpoDiFunzione = (idx) => corpi.some(([a, b]) => idx >= a && idx < b);

  for (const valore of aggiunti) {
    if (creati.has(valore)) continue;
    const usi = [...codice.matchAll(new RegExp(`'${valore.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'g'))]
      .filter((m) => {
        const prima = codice.slice(Math.max(0, m.index - 140), m.index);
        if (/add\s+value\s*(?:if\s+not\s+exists\s*)?$/i.test(prima)) return false;
        const rigaCorrente = prima.split('\n').pop() ?? '';
        if (/comment\s+on/i.test(rigaCorrente)) return false;
        if (dentroUnCorpoDiFunzione(m.index)) return false;
        return true;
      });
    if (usi.length) trovati.push(`il valore '${valore}' viene aggiunto E usato nello stesso file`);
  }
  return trovati;
}

const problemi = [];
for (let i = 0; i < files.length; i++) {
  const sql = readFileSync(join(MIG_DIR, files[i]), 'utf8');
  for (const p of problemiEnum(sql)) problemi.push(`${names[i]}: ${p}`);
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
// ⚠️ IL BUCO DEL 2026-07-27 (secondo giro): I NOMI FRA VIRGOLETTE
//
// La prima versione cercava `create policy (\w+)`. In `0005_storage.sql` le
// quattro policy si chiamano `"company_documents_select"` e simili — con le
// VIRGOLETTE — e `\w` non le comprende: l'espressione non trovava proprio
// nulla, e il controllo dichiarava che il file era ripetibile. Non lo era.
// Riapplicando `full-setup.sql` si otteneva
//     42710: policy "company_documents_select" for table "objects" already exists
// esattamente il guasto che questo controllo era stato scritto per impedire.
//
// È la stessa forma di difetto già vista due volte nel controllo i18n: non
// sbagliava il ragionamento, non vedeva il caso. Per questo ora c'è
// `npm run db:bundle -- --self-test`, con casi che DEVONO farlo fallire.
//
// Un nome SQL può essere nudo (`trg_x`) o fra virgolette (`"trg x"`), e i due
// si riferiscono allo stesso oggetto quando il nome è tutto minuscolo. Qui si
// legge l'una o l'altra forma e si confronta in minuscolo.
const NOME = '(?:"([^"]+)"|([\\w$]+))';
const nomeDi = (m) => (m[1] ?? m[2] ?? '').toLowerCase();

/**
 * I problemi di ripetibilità di UNA migrazione. Funzione pura: riceve il testo,
 * restituisce l'elenco. Serve al controllo e alla sua autoverifica — un
 * controllo che non si può mettere alla prova è un controllo di cui ci si fida
 * senza motivo.
 */
export function problemiDiRipetibilita(sql) {
  const codice = senzaCommenti(sql);
  const trovati = [];
  for (const tipo of ['trigger', 'policy']) {
    const protetti = new Set(
      [...codice.matchAll(new RegExp(`drop\\s+${tipo}\\s+if\\s+exists\\s+${NOME}`, 'gi'))].map(nomeDi),
    );
    // `create or replace trigger` (Postgres 14+) è già ripetibile per conto suo:
    // pretendere un drop davanti sarebbe un falso positivo. Per le policy quella
    // forma non esiste, e infatti il gruppo resta sempre vuoto.
    const re = new RegExp(`create\\s+(or\\s+replace\\s+)?${tipo}\\s+${NOME}`, 'gi');
    for (const m of codice.matchAll(re)) {
      if (m[1]) continue;                       // or replace: si ricrea da sé
      const nome = (m[2] ?? m[3] ?? '').toLowerCase();
      if (!protetti.has(nome)) {
        trovati.push(`${tipo} ${nome} senza «drop ${tipo} if exists» che lo preceda`);
      }
    }
  }
  return trovati;
}

for (let i = 0; i < files.length; i++) {
  const sql = readFileSync(join(MIG_DIR, files[i]), 'utf8');
  for (const p of problemiDiRipetibilita(sql)) problemi.push(`${names[i]}: ${p}`);
}

// ---------------------------------------------------------------------------
// Autoverifica del controllo di ripetibilità.
//   npm run db:bundle -- --self-test
//
// Ogni caso porta il numero di problemi ATTESI. I casi negativi (attese 0)
// contano quanto i positivi: un controllo che segnala tutto verrebbe disattivato
// il giorno dopo, e uno che non segnala niente è già stato disattivato senza che
// nessuno lo sapesse — è quello che è successo con le policy fra virgolette.
// ---------------------------------------------------------------------------
const AUTOVERIFICA = [
  { nome: 'policy con nome nudo, senza drop', attesi: 1, sql: `
    create policy p_letture on public.t for select to authenticated using (true);` },
  { nome: 'policy con nome nudo, con drop', attesi: 0, sql: `
    drop policy if exists p_letture on public.t;
    create policy p_letture on public.t for select to authenticated using (true);` },
  // ⚠️ IL CASO DEL 2026-07-27: è questo che la versione precedente non vedeva.
  { nome: 'policy con nome FRA VIRGOLETTE, senza drop', attesi: 1, sql: `
    create policy "company_documents_select"
      on storage.objects for select to authenticated using (true);` },
  { nome: 'policy fra virgolette, con drop fra virgolette', attesi: 0, sql: `
    drop policy if exists "company_documents_select" on storage.objects;
    create policy "company_documents_select"
      on storage.objects for select to authenticated using (true);` },
  { nome: 'drop senza virgolette protegge un create con virgolette', attesi: 0, sql: `
    drop policy if exists company_documents_select on storage.objects;
    create policy "company_documents_select"
      on storage.objects for select to authenticated using (true);` },
  { nome: 'trigger senza drop', attesi: 1, sql: `
    create trigger trg_x before insert on public.t for each row execute function public.f();` },
  { nome: 'trigger con drop', attesi: 0, sql: `
    drop trigger if exists trg_x on public.t;
    create trigger trg_x before insert on public.t for each row execute function public.f();` },
  { nome: 'create or replace trigger si ricrea da sé', attesi: 0, sql: `
    create or replace trigger trg_x before insert on public.t for each row execute function public.f();` },
  { nome: 'un create policy dentro un commento non conta', attesi: 0, sql: `
    -- create policy p_finta on public.t for select using (true);
    select 1;` },
];

// ---------------------------------------------------------------------------
// Autoverifica del controllo sugli enum.
//
// I casi 2 e 3 sono il cuore: la stessa etichetta, nello stesso file, è LECITA
// dentro il corpo di una funzione e VIETATA dentro un blocco `do`. Un controllo
// che non distinguesse i due casi sbaglierebbe in una delle due direzioni —
// bloccando codice valido oppure lasciando passare un'installazione che
// fallisce al primo cliente nuovo.
// ---------------------------------------------------------------------------
const AUTOVERIFICA_ENUM = [
  { nome: 'valore aggiunto e usato in un indice parziale', attesi: 1, sql: `
    alter type public.t_stato add value if not exists 'nuovo';
    create index idx_x on public.t (a) where stato = 'nuovo';` },
  { nome: 'valore aggiunto e usato SOLO nel corpo di una funzione', attesi: 0, sql: `
    alter type public.t_stato add value if not exists 'nuovo';
    create or replace function public.f() returns void language plpgsql as $$
    begin
      perform public.g('nuovo');
    end $$;` },
  // ⚠️ IL CASO CHE DEVE RESTARE VIETATO: un blocco «do» viene ESEGUITO subito.
  { nome: 'valore aggiunto e usato dentro un blocco do', attesi: 1, sql: `
    alter type public.t_stato add value if not exists 'nuovo';
    do $$ begin
      update public.t set stato = 'nuovo' where a = 1;
    end $$;` },
  { nome: 'valore aggiunto e usato in un insert', attesi: 1, sql: `
    alter type public.t_stato add value if not exists 'nuovo';
    insert into public.t (stato) values ('nuovo');` },
  { nome: 'valore aggiunto e mai più nominato', attesi: 0, sql: `
    alter type public.t_stato add value if not exists 'nuovo';
    select 1;` },
  { nome: 'valore nato da create type: usabile subito', attesi: 0, sql: `
    create type public.altro as enum ('nuovo', 'vecchio');
    alter type public.t_stato add value if not exists 'nuovo';
    insert into public.t (altro) values ('nuovo');` },
  { nome: 'valore nominato solo in un comment on', attesi: 0, sql: `
    alter type public.t_stato add value if not exists 'nuovo';
    comment on type public.t_stato is 'ora comprende anche ''nuovo''';` },
  { nome: 'due funzioni: la seconda non eredita l’esenzione della prima', attesi: 1, sql: `
    alter type public.t_stato add value if not exists 'nuovo';
    create or replace function public.f() returns void language plpgsql as $$
    begin perform 1; end $$;
    insert into public.t (stato) values ('nuovo');` },
];

/** Esegue una batteria di autoverifica e restituisce i casi non superati. */
function casiNonSuperati(casi, controllo) {
  return casi.filter((c) => controllo(c.sql).length !== c.attesi);
}

if (process.argv.includes('--self-test')) {
  let falliti = 0;
  for (const [titolo, casi, controllo] of [
    ['Autoverifica del controllo di ripetibilità', AUTOVERIFICA, problemiDiRipetibilita],
    ['Autoverifica del controllo sugli enum', AUTOVERIFICA_ENUM, problemiEnum],
  ]) {
    console.log(`\n${titolo}\n`);
    for (const c of casi) {
      const trovati = controllo(c.sql).length;
      const ok = trovati === c.attesi;
      if (!ok) falliti++;
      console.log(`  ${ok ? '✓' : '✗'} ${c.nome} — attesi ${c.attesi}, trovati ${trovati}`);
    }
  }
  console.log(falliti
    ? `\n  ${falliti} casi non superati: il controllo NON è affidabile.\n`
    : '\n  Tutti i casi superati.\n');
  process.exit(falliti ? 1 : 0);
}

// Il controllo non gira mai senza essersi prima messo alla prova: un verde dato
// da un rilevatore rotto vale meno di nessun controllo.
const autoverificaFallita = [
  ...casiNonSuperati(AUTOVERIFICA, problemiDiRipetibilita),
  ...casiNonSuperati(AUTOVERIFICA_ENUM, problemiEnum),
];
if (autoverificaFallita.length) {
  console.error('\n✗ I controlli non riconoscono i propri casi noti:');
  for (const c of autoverificaFallita) console.error(`    ${c.nome}`);
  console.error('  Esegui: npm run db:bundle -- --self-test\n');
  process.exit(1);
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
