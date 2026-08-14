// ============================================================================
// AI-Swisse — Registro attività: test OFFLINE.
//   npm run test:audit-unit
//
// Niente database, niente rete, niente credito. Prova le cose che il typecheck
// NON può vedere e che sbagliano in silenzio:
//
//   1. SQL ↔ TypeScript — gli elenchi scritti due volte dicono lo stesso.
//   2. Etichette — ogni azione e ogni campo che i trigger scrivono ha una
//      traduzione nelle tre lingue. Senza, in pagina compare una chiave i18n.
//   3. SANIFICAZIONE — nessun trigger pubblica una colonna che non è ammessa.
//      È il controllo per cui esiste questo file: un `access_token` finito nel
//      registro non fa fallire niente, non si vede, e resta lì.
//   4. Filtri in URL — un valore assurdo non diventa un filtro invisibile.
//   5. Periodo — il confine si calcola, non si spera.
//   6. `changes` malformato — si scarta, non si mostra a metà.
//   7. Collegamenti — un documento eliminato non offre una pagina che non c'è.
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, AUDIT_FIELDS, AUDIT_PERIODS, DEFAULT_PERIOD,
  actorLabelKey, actorOf, changeEntries, entryHref, filtersFromParams, groupByDay,
  isAuditAction, paramsFromFilters, periodStart, toChanges,
} from '../src/features/audit/auditModel.ts';
import { it as dictIt } from '../src/i18n/locales/it.ts';
import { de as dictDe } from '../src/i18n/locales/de.ts';
import { fr as dictFr } from '../src/i18n/locales/fr.ts';
import type { AuditEntry } from '../src/types/models.ts';

const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${name}`); }
  else { fail++; console.log(`  ${R}✗ ${name}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(join(HERE, '..', 'supabase', 'migrations', '0039_audit_logs.sql'), 'utf8');

const sqlEnum = (name: string): string[] => {
  const i = MIGRATION.indexOf(`create type public.${name} as enum (`);
  if (i < 0) return [];
  const body = MIGRATION.slice(i, MIGRATION.indexOf(');', i));
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
};

// ---------------------------------------------------------------------------
section('1. SQL ↔ TypeScript — gli elenchi scritti due volte');

const sqlActions = sqlEnum('audit_action');
const sqlEntities = sqlEnum('audit_entity_type');

check('la migrazione dichiara l’enum delle azioni', sqlActions.length > 0,
  'nessun `create type public.audit_action as enum` trovato in 0039');
check('le azioni sono le stesse in SQL e in TypeScript',
  JSON.stringify([...sqlActions].sort()) === JSON.stringify([...AUDIT_ACTIONS].sort()),
  `SQL ${sqlActions.length}, TS ${AUDIT_ACTIONS.length}; solo in SQL: `
  + `${sqlActions.filter((a) => !(AUDIT_ACTIONS as readonly string[]).includes(a)).join(', ') || '—'}; solo in TS: `
  + `${AUDIT_ACTIONS.filter((a) => !sqlActions.includes(a)).join(', ') || '—'}`);
check('i tipi di entità sono gli stessi in SQL e in TypeScript',
  JSON.stringify([...sqlEntities].sort()) === JSON.stringify([...AUDIT_ENTITY_TYPES].sort()),
  `SQL: ${sqlEntities.join(', ')} — TS: ${AUDIT_ENTITY_TYPES.join(', ')}`);

// Ogni azione dell'enum deve essere prodotta da almeno un trigger: un valore che
// nessuno scrive è una promessa che il registro non mantiene.
for (const a of sqlActions) {
  check(`l’azione «${a}» è scritta da almeno un trigger`,
    MIGRATION.includes(`'${a}'::public.audit_action`),
    'presente nell’enum ma nessun trigger la produce');
}

// ---------------------------------------------------------------------------
section('2. Etichette — nessuna chiave i18n stampata in pagina');

const dicts = { it: dictIt, de: dictDe, fr: dictFr } as const;
type Dict = typeof dictIt;
const label = (d: Dict, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[k] : undefined), d);

for (const [lang, d] of Object.entries(dicts)) {
  const missingActions = AUDIT_ACTIONS.filter((a) => typeof label(d, `audit.action.${a}`) !== 'string');
  check(`${lang}: ogni azione ha un’etichetta`, missingActions.length === 0, `mancano: ${missingActions.join(', ')}`);
  const missingFields = AUDIT_FIELDS.filter((f) => typeof label(d, `audit.field.${f}`) !== 'string');
  check(`${lang}: ogni campo ha un’etichetta`, missingFields.length === 0, `mancano: ${missingFields.join(', ')}`);
  const missingPeriods = AUDIT_PERIODS.filter((p) => typeof label(d, `audit.period.${p}`) !== 'string');
  check(`${lang}: ogni periodo ha un’etichetta`, missingPeriods.length === 0, `mancano: ${missingPeriods.join(', ')}`);
}

// ---------------------------------------------------------------------------
section('3. SANIFICAZIONE — che cosa i trigger pubblicano davvero');

// I nomi di campo che compaiono in `jsonb_build_object('<nome>', …)` dentro la
// migrazione: è ciò che finisce in `changes`, letto dalla fonte e non dichiarato
// a mano da qualcuno che si ricorda di aggiornarlo.
const publishedFields = [...new Set(
  [...MIGRATION.matchAll(/jsonb_build_object\(([\s\S]*?)\n\s*\)/g)]
    .flatMap((m) => [...m[1]!.matchAll(/'([a-z_]+)',\s*public\.audit_pair/g)].map((x) => x[1]!)),
)];

check('la migrazione pubblica almeno un campo', publishedFields.length > 0,
  'la regex non ha trovato nessun `jsonb_build_object`: il controllo sarebbe un verde falso');
const unknownFields = publishedFields.filter((f) => !AUDIT_FIELDS.includes(f));
check('ogni campo pubblicato dai trigger è dichiarato in AUDIT_FIELDS',
  unknownFields.length === 0,
  `senza etichetta: ${unknownFields.join(', ')}`);

// Le COLONNE lette dai trigger. Una colonna fuori da questo elenco è un dato che
// nessuno ha deciso di pubblicare — ed è così che un segreto entra in un log.
const readColumns = [...new Set(
  [...MIGRATION.matchAll(/public\.audit_pair\(([^)]*)\)/g)]
    .flatMap((m) => [...m[1]!.matchAll(/\b(?:new|old)\.([a-z_]+)/g)].map((x) => x[1]!)),
)];
const ALLOWED_COLUMNS = [
  'title', 'original_filename', 'mime_type', 'file_size', 'source_type',
  'analysis_status', 'engine', 'provider', 'model', 'error_code',
  'field', 'language', 'tone',
  'status', 'priority', 'due_date', 'assignee_user_id', 'archived_at',
  'user_id', 'role',
];
check('i trigger leggono almeno una colonna', readColumns.length > 0,
  'la regex non ha trovato nessuna colonna: il controllo sarebbe un verde falso');
const forbidden = readColumns.filter((c) => !ALLOWED_COLUMNS.includes(c));
check('nessun trigger legge una colonna non ammessa',
  forbidden.length === 0,
  `colonne inattese nel registro: ${forbidden.join(', ')}`);

// Controllo esplicito e leggibile su ciò che non deve MAI comparire, anche se un
// giorno qualcuno allargasse ALLOWED_COLUMNS senza pensarci.
const NEVER = [
  'content', 'body_text', 'body_clean', 'summary', 'storage_path', 'file_hash',
  'original_ai_value', 'corrected_value', 'access_token', 'refresh_token',
  'token', 'password', 'secret', 'reply_draft', 'sender', 'deadline', 'amount',
];
for (const c of NEVER) {
  check(`la colonna «${c}» non finisce nel registro`, !readColumns.includes(c));
}

// ---------------------------------------------------------------------------
section('4. Filtri in URL — un valore assurdo non diventa un filtro invisibile');

check('senza parametri si usa il periodo predefinito e nessun filtro di tipo',
  filtersFromParams(new URLSearchParams()).period === DEFAULT_PERIOD
  && filtersFromParams(new URLSearchParams()).action === null);
check('un tipo inesistente diventa «tutti», non un filtro che non trova niente',
  filtersFromParams(new URLSearchParams('tipo=pippo')).action === null);
check('un tipo vero viene rispettato',
  filtersFromParams(new URLSearchParams('tipo=correction_saved')).action === 'correction_saved');
check('un periodo inesistente torna al predefinito',
  filtersFromParams(new URLSearchParams('periodo=mai')).period === DEFAULT_PERIOD);
check('un periodo vero viene rispettato',
  filtersFromParams(new URLSearchParams('periodo=90d')).period === '90d');
check('il periodo predefinito NON compare nell’indirizzo',
  paramsFromFilters({ period: DEFAULT_PERIOD, action: null }).toString() === '');
check('andata e ritorno conservano i filtri',
  filtersFromParams(paramsFromFilters({ period: '7d', action: 'task_updated' })).action === 'task_updated'
  && filtersFromParams(paramsFromFilters({ period: '7d', action: 'task_updated' })).period === '7d');
check('isAuditAction rifiuta ciò che non è un’azione',
  !isAuditAction('') && !isAuditAction(null) && !isAuditAction('document_upload') && isAuditAction('document_uploaded'));

// ---------------------------------------------------------------------------
section('5. Periodo — il confine si calcola');

const NOW = new Date('2026-08-06T12:00:00.000Z');
check('«tutto» non pone alcun confine', periodStart('all', NOW) === null);
check('7 giorni tolgono esattamente 7 giorni',
  periodStart('7d', NOW) === '2026-07-30T12:00:00.000Z', String(periodStart('7d', NOW)));
check('30 giorni attraversano il cambio di mese',
  periodStart('30d', NOW) === '2026-07-07T12:00:00.000Z', String(periodStart('30d', NOW)));
check('90 giorni attraversano più mesi',
  periodStart('90d', NOW) === '2026-05-08T12:00:00.000Z', String(periodStart('90d', NOW)));

// ---------------------------------------------------------------------------
section('6. `changes` — malformato si scarta, non si mostra a metà');

check('una coppia completa passa',
  changeEntries({ status: { before: 'open', after: 'completed' } }).length === 1);
check('una voce senza «after» viene scartata',
  changeEntries({ status: { before: 'open' } }).length === 0);
check('una voce senza «before» viene scartata',
  changeEntries({ status: { after: 'completed' } }).length === 0);
check('un valore non oggetto viene scartato',
  changeEntries({ status: 'completed' }).length === 0);
check('due valori nulli non sono un cambiamento',
  changeEntries({ status: { before: null, after: null } }).length === 0);
check('un campo comparso ha «before» nullo',
  changeEntries({ title: { before: null, after: 'Fattura' } })[0]?.before === null);
check('un numero diventa testo invece di sparire',
  changeEntries({ file_size: { before: null, after: 12345 } })[0]?.after === '12345');
check('null, array e stringa non fanno esplodere niente',
  changeEntries(null).length === 0 && changeEntries(['a']).length === 0 && changeEntries('x').length === 0);
check('l’ordine è stabile e alfabetico',
  changeEntries({ status: { before: 'a', after: 'b' }, assignee: { before: null, after: 'x' } })
    .map((c) => c.field).join(',') === 'assignee,status');
check('toChanges produce la mappa di dominio',
  toChanges({ role: { before: 'member', after: 'admin' } }).role?.after === 'admin');

// ---------------------------------------------------------------------------
section('7. Collegamenti — non si offre una pagina che non c’è');

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 'e', companyId: 'c', actorUserId: null, action: 'document_uploaded',
  entityType: 'document', entityId: 'x', changes: {}, correlationId: 'doc-1',
  createdAt: '2026-08-06T10:00:00.000Z', ...over,
});

check('un documento eliminato non ha collegamento',
  entryHref(entry({ action: 'document_deleted' })) === null);
check('un’analisi porta al DOCUMENTO, non a sé stessa',
  entryHref(entry({ action: 'analysis_completed', entityType: 'analysis' })) === '/documenti/doc-1');
check('una correzione porta al documento',
  entryHref(entry({ action: 'correction_saved', entityType: 'correction' })) === '/documenti/doc-1');
check('una risposta porta al documento',
  entryHref(entry({ action: 'reply_generated', entityType: 'reply' })) === '/documenti/doc-1');
check('un’attività porta all’attività',
  entryHref(entry({ action: 'task_created', entityType: 'task', correlationId: 't-1' })) === '/attivita/t-1');
check('una membership porta alle impostazioni azienda',
  entryHref(entry({ action: 'member_added', entityType: 'membership' })) === '/azienda');

check('i giorni si raggruppano nell’ordine in cui arrivano',
  groupByDay([
    entry({ id: '1', createdAt: '2026-08-06T10:00:00.000Z' }),
    entry({ id: '2', createdAt: '2026-08-06T09:00:00.000Z' }),
    entry({ id: '3', createdAt: '2026-08-05T23:00:00.000Z' }),
  ]).map((g) => `${g.day}:${g.entries.length}`).join(' ') === '2026-08-06:2 2026-08-05:1');

// ---------------------------------------------------------------------------
section('L’AUTORE — quattro casi, e due erano diventati uno');

{
  // ⚠️ IL CASO REALE, visto sul dominio il 2026-08-09: il registro diceva «di
  // una persona non più in azienda» di gente che in azienda c'era. La rubrica
  // restituisce stringa vuota per chi non ha compilato il profilo
  // (`display_name ?? ''`), e `if (name)` mandava vuoto e assente nello stesso
  // ramo. Sulla schermata: una frase falsa su una persona reale.
  const rubrica = { 'u-con-nome': 'Anna Rossi', 'u-senza-nome': '' };

  check('nessun autore → il sistema',
    actorLabelKey(actorOf(null, rubrica)) === 'audit.actor.system');
  check('autore in rubrica con nome → il nome, nessuna chiave',
    actorLabelKey(actorOf('u-con-nome', rubrica)) === null
    && actorOf('u-con-nome', rubrica).kind === 'name');
  check('⚠️ autore IN AZIENDA senza nome nel profilo → NON «non più in azienda»',
    actorLabelKey(actorOf('u-senza-nome', rubrica)) === 'audit.actor.noProfileName');
  check('autore che non è più nella rubrica → «non più in azienda»',
    actorLabelKey(actorOf('u-sparito', rubrica)) === 'audit.actor.former');
  // La controprova del confine: uno spazio non è un nome, ma nemmeno un'uscita.
  check('un nome fatto di soli spazi resta «senza nome», non «uscita»',
    actorLabelKey(actorOf('u-spazi', { 'u-spazi': '   ' })) === 'audit.actor.noProfileName');
  // ⚠️ E la chiave nuova deve esistere in TUTTE E TRE le lingue: una chiave
  // mancante si vedrebbe come testo grezzo in mezzo al registro.
  for (const [lingua, dz] of [['it', dictIt], ['de', dictDe], ['fr', dictFr]] as const) {
    const actor = (dz as { audit?: { actor?: Record<string, string> } }).audit?.actor ?? {};
    check(`${lingua}: le tre frasi dell'autore esistono e sono diverse fra loro`,
      !!actor.system && !!actor.noProfileName && !!actor.former
      && new Set([actor.system, actor.noProfileName, actor.former]).size === 3,
      JSON.stringify(actor));
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${B}Risultato:${X} ${fail === 0 ? `${G}${pass} passati${X}` : `${R}${fail} falliti${X} ${DIM}su ${pass + fail}${X}`}`);
process.exit(fail === 0 ? 0 : 1);
