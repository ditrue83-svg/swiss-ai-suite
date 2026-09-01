// ============================================================================
// AI-Swisse — CRM Light: test OFFLINE.
//   npm run test:crm-unit
//
// Non richiede database, non richiede rete, non spende crediti. Prova le
// funzioni PURE del modulo, cioè quelle in cui un errore non si vede: togliere
// i punti di un indirizzo Gmail «per riconoscerlo meglio» unisce due persone
// diverse, e nessuno va a cercare quell'errore perché il risultato sembra
// giusto.
//
// LE SEZIONI
//   1. Coerenza TS ↔ SQL — gli elenchi scritti due volte dicono lo stesso.
//   2. Normalizzazione — e soprattutto ciò che NON si normalizza.
//   3. L'IDI — la cifra di controllo decide se un collegamento è lecito.
//   4. Il filtro anti-rumore — 54 mittenti veri diventano 6.
//   5. Abbinamento — identità contro sospetto, e i pareggi.
//   6. Stato di una riga — l'ordine delle priorità.
//   7. Opportunità e denaro — nessuna somma fra valute.
//   8. Giorni di calendario — alle 23:30 «ieri» non è «oggi».
//   9. Filtri in URL — un valore assurdo non diventa un filtro invisibile.
//  10. Etichette e ordinamenti stabili.
//  11. Il candidato automatico (0030) — la chiave scritta due volte.
//  12. Il sito web è un link, e un link può essere codice.
//  13. Il parser CSV — virgolette, separatori, codifiche.
//  14. L'auto-mappatura — quattro lingue, e nessun indovino.
//  15. La validazione di una riga — errori in codice, mai in prosa.
//  16. I duplicati — la scala di §25, dentro e fuori dal file.
//  17. A chi vanno i recapiti — la persona, se c'è.
//  18. La migrazione 0047 letta da fuori — revoke, grant, sentinelle.
//  19. crmFields — le regole pure della schermata, uguali al guardiano.
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PUBLIC_EMAIL_DOMAINS, AUTO_LINK_REASONS,
  normEmail, normDomain, normPhone, normUid, isPublicDomain, isServiceAddress,
  deservesSuggestion, canAutoLink, reasonRank, pickAutoLink, domainSuggests, suggestionKey,
  type MatchCandidate,
} from '../src/features/crm/crmMatch.ts';
import {
  IMPORT_FIELDS, IMPORT_MAX_ROWS, HEADER_ALIASES,
  decodeCsvBytes, detectDelimiter, parseCsv, suggestMapping, mappingHasName,
  parseRoles, buildDrafts, effectiveName, personDisplayName, contactRoute, validateDraft,
  normNameKey, flagDuplicates,
  type ExistingIndex, type ImportDraft,
} from '../src/features/crm/csvImport.ts';
import {
  CRM_VIEWS, CRM_SORTS, PIPELINE_STAGES, ALL_STAGES, DEFAULT_STALE_DAYS,
  filtersFromParams, paramsFromFilters, effectiveRole, hasActiveFilters,
  organizationState, opportunityState, pipelineByCurrency, countByStage,
  daysSince,  secondaryName, compareTimeline, isOpen,
  safeWebsite,
  EMPTY_FILTERS, type CrmFilters,
} from '../src/features/crm/crmModel.ts';
import {
  CRM_FIELD_ENTITIES, CRM_FIELD_OPTIONS_MAX, CRM_FIELD_TYPES,
  parseFieldOptions, parseFieldValue, valueColumns, formatFieldValue,
  sortFieldDefinitions, nextFieldPosition,
} from '../src/features/crm/crmFields.ts';
import type { CrmFieldDefinition } from '../src/types/models.ts';
// ⚠️ `daysUntil` di `crmModel` non esiste più: era una copia letterale di quella
// dei Contratti, e nessuna delle due sapeva dell'altra. Una risposta sola.
import { calendarDaysUntil } from '../src/lib/calendarDays.ts';
import { isValidUid } from '../src/lib/uid.ts';
import {
  CRM_ORGANIZATION_ROLES, CRM_OPPORTUNITY_STAGES, CRM_SOURCES, CRM_RELATIONSHIP_STATUSES,
  AUTOMATION_EVENT_TYPES, TRIGGERS,
} from '../supabase/functions/_shared/automation/registry.ts';

const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${name}`); }
  else { fail++; console.log(`  ${R}✗ ${name}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(
  join(HERE, '..', 'supabase', 'migrations', '0026_crm_light.sql'), 'utf8');
const FOLLOW_UP_MIGRATION = readFileSync(
  join(HERE, '..', 'supabase', 'migrations', '0050_crm_follow_up_sequences.sql'), 'utf8');

// ---------------------------------------------------------------------------
section('1. Coerenza TS ↔ SQL — gli elenchi scritti due volte');

// ⚠️ IL CONTROLLO PIÙ IMPORTANTE DEL FILE. `crm_is_public_domain` in SQL e
// `PUBLIC_EMAIL_DOMAINS` in TypeScript sono la stessa regola scritta due volte,
// e due copie divergono sempre. Il typecheck non può vederlo: guarda solo il
// TypeScript. Questa è l'unica rete.
const sqlDomains = (() => {
  const fn = MIGRATION.slice(MIGRATION.indexOf('function public.crm_is_public_domain'));
  const arr = fn.slice(fn.indexOf('array['), fn.indexOf(']'));
  return [...arr.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort();
})();
check('i domini pubblici sono gli stessi in SQL e in TypeScript',
  JSON.stringify(sqlDomains) === JSON.stringify([...PUBLIC_EMAIL_DOMAINS].sort()),
  `SQL ${sqlDomains.length}, TS ${PUBLIC_EMAIL_DOMAINS.length}; solo in SQL: `
  + `${sqlDomains.filter((d) => !PUBLIC_EMAIL_DOMAINS.includes(d)).join(', ') || '—'}; solo in TS: `
  + `${PUBLIC_EMAIL_DOMAINS.filter((d) => !sqlDomains.includes(d)).join(', ') || '—'}`);

const sqlEnum = (name: string): string[] => {
  const i = MIGRATION.indexOf(`create type public.${name} as enum (`);
  if (i < 0) return [];
  const body = MIGRATION.slice(i, MIGRATION.indexOf(');', i));
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
};

check('crm_organization_role: stessi valori nel registro e nella migrazione',
  JSON.stringify(sqlEnum('crm_organization_role')) === JSON.stringify([...CRM_ORGANIZATION_ROLES]),
  `SQL: ${sqlEnum('crm_organization_role').join('|')}`);
check('crm_opportunity_stage: stessi valori nel registro e nella migrazione',
  JSON.stringify(sqlEnum('crm_opportunity_stage')) === JSON.stringify([...CRM_OPPORTUNITY_STAGES]));
check('crm_source: stessi valori nel registro e nella migrazione',
  JSON.stringify(sqlEnum('crm_source')) === JSON.stringify([...CRM_SOURCES]));
check('crm_relationship_status: due valori, non tre — «archiviata» è un timestamp',
  JSON.stringify(sqlEnum('crm_relationship_status')) === JSON.stringify([...CRM_RELATIONSHIP_STATUSES])
  && sqlEnum('crm_relationship_status').length === 2);

// ⚠️ 55P04: un valore aggiunto a un enum ESISTENTE non è utilizzabile in
// nessun'altra istruzione dello stesso file. Il blocco di autoverifica gira
// nella stessa transazione, quindi non deve nominarli — nemmeno in un commento,
// perché questo controllo non sa distinguere un commento da un'istruzione.
const addedEnumValues = [...MIGRATION.matchAll(
  /alter type public\.\w+ add value if not exists '([^']+)'/g)].map((m) => m[1]!);
check('otto valori aggiunti a enum esistenti', addedEnumValues.length === 8,
  addedEnumValues.join(', '));
const selfCheck = MIGRATION.slice(MIGRATION.lastIndexOf('-- 25. AUTOVERIFICA'));
check('il blocco di autoverifica non nomina i valori enum aggiunti (55P04)',
  addedEnumValues.every((v) => !selfCheck.includes(`'${v}'`)),
  addedEnumValues.filter((v) => selfCheck.includes(`'${v}'`)).join(', '));

// I sei inneschi CRM esistono nel registro E nella migrazione.
const crmEvents = AUTOMATION_EVENT_TYPES.filter((e) => e.startsWith('crm_'));
check('sette inneschi CRM nel registro: i sei della 0026 e la sequenza della 0050',
  crmEvents.length === 7 && crmEvents.includes('crm_follow_up_sequence_due'), crmEvents.join(', '));
check('i sei inneschi CRM originari restano nella 0026 e la sequenza sta nella 0050',
  crmEvents.filter((e) => e !== 'crm_follow_up_sequence_due').every((e) => addedEnumValues.includes(e))
    && FOLLOW_UP_MIGRATION.includes("add value if not exists 'crm_follow_up_sequence_due'"));
check('ogni innesco CRM ha una voce in TRIGGERS con campi ed entità',
  crmEvents.every((e) => {
    const t = TRIGGERS.find((x) => x.key === e);
    return Boolean(t) && t!.fields.length > 0 && t!.entityType.startsWith('crm_');
  }));

// ⚠️ I RUOLI SONO BOOLEANI E NON UN ELENCO, e il motivo è nel registro:
// `contains` confronta sottostringhe, quindi «customer» risponderebbe sì anche
// su «former_customer». Se qualcuno reintroducesse un campo elenco, questo
// controllo lo dice.
const orgFields = TRIGGERS.find((t) => t.key === 'crm_organization_created')!.fields;
check('nessun campo «organization.roles» al plurale: sarebbe ambiguo con contains',
  !orgFields.some((f) => f.path === 'organization.roles'));
check('i ruoli commerciali sono campi booleani distinti',
  ['role_customer', 'role_prospect', 'role_supplier', 'role_partner'].every(
    (r) => orgFields.some((f) => f.path === `organization.${r}` && f.type === 'boolean')));

// Le tabelle nuove hanno tutte la RLS accesa e il revoke PRIMA dei grant.
const crmTables = [...MIGRATION.matchAll(
  /create table if not exists public\.(crm_\w+)/g)].map((m) => m[1]!);
check('tredici tabelle CRM', crmTables.length === 13, crmTables.join(', '));
check('RLS accesa su tutte e tredici',
  crmTables.every((t) => MIGRATION.includes(`alter table public.${t}          enable row level security`)
    || MIGRATION.includes(`alter table public.${t} enable row level security`)
    || new RegExp(`alter table public\\.${t}\\s+enable row level security`).test(MIGRATION)),
  crmTables.filter((t) => !new RegExp(`alter table public\\.${t}\\s+enable row level security`).test(MIGRATION)).join(', '));
check('ogni tabella ha «revoke all» PRIMA di qualunque grant (lezione 0013/0014)',
  crmTables.every((t) => {
    const rev = MIGRATION.indexOf(`revoke all on public.${t}`);
    const gr = MIGRATION.indexOf(`grant select on public.${t}`);
    return rev >= 0 && gr >= 0 && rev < gr;
  }),
  crmTables.filter((t) => {
    const rev = MIGRATION.indexOf(`revoke all on public.${t}`);
    const gr = MIGRATION.indexOf(`grant select on public.${t}`);
    return !(rev >= 0 && gr >= 0 && rev < gr);
  }).join(', '));

// ⚠️ Il difetto che ha fatto fallire questa migrazione alla PRIMA applicazione:
// una colonna dichiarata «non scrivibile» dall'autoverifica e insieme concessa
// dai grant. Il file non deve contraddirsi.
const grants = new Map<string, Map<string, Set<string>>>();
for (const m of MIGRATION.matchAll(
  /grant (insert|update) \(([^)]*)\)\s*\n?\s*on public\.(\w+) to authenticated;/g)) {
  const [, op, cols, tab] = m;
  const byOp = grants.get(tab!) ?? new Map<string, Set<string>>();
  const set = byOp.get(op!) ?? new Set<string>();
  for (const c of cols!.replace(/\n/g, ' ').split(',')) if (c.trim()) set.add(c.trim());
  byOp.set(op!, set); grants.set(tab!, byOp);
}
const stampedBlock = MIGRATION.slice(
  MIGRATION.indexOf('-- (d) Le colonne timbrate'), MIGRATION.indexOf('-- (d-bis)'));
const contradictions: string[] = [];
for (const m of stampedBlock.matchAll(/table_name = '(\w+)'\s*\n\s*and column_name in \(([^)]*)\)/g)) {
  const tab = m[1]!;
  const cols = [...m[2]!.matchAll(/'(\w+)'/g)].map((x) => x[1]!);
  for (const op of ['insert', 'update']) {
    for (const c of cols) {
      if (grants.get(tab)?.get(op)?.has(c)) contradictions.push(`${tab}.${op}(${c})`);
    }
  }
}
check('nessuna colonna è insieme «timbrata dal database» e concessa al client',
  contradictions.length === 0, contradictions.join(', '));

// ---------------------------------------------------------------------------
section('2. Normalizzazione — e ciò che NON si normalizza');

check('l’email va in minuscolo e senza spazi',
  normEmail('  Laura@Rossi.CH ') === 'laura@rossi.ch');
check('un’email vuota è null, non stringa vuota', normEmail('   ') === null);
// ⚠️ I DUE CONTROLLI CHE PROTEGGONO DALL'ERRORE PEGGIORE: se qualcuno
// «migliorasse» la normalizzazione, due persone diverse diventerebbero la
// stessa e il collegamento automatico le unirebbe in silenzio.
check('i punti di Gmail NON si rimuovono: sono un’altra identità',
  normEmail('l.a.u.r.a@gmail.com') === 'l.a.u.r.a@gmail.com');
check('il +tag NON si rimuove: è un’altra identità',
  normEmail('laura+contabilita@rossi.ch') === 'laura+contabilita@rossi.ch');

check('dominio da un indirizzo email', normDomain('laura@rossi.ch') === 'rossi.ch');
check('dominio da un URL con schema, www e percorso',
  normDomain('https://www.rossi.ch/chi-siamo') === 'rossi.ch');
check('dominio scritto a mano in maiuscolo', normDomain('  ROSSI.CH  ') === 'rossi.ch');
check('dominio con porta e query', normDomain('http://rossi.ch:8080/x?y=1') === 'rossi.ch');
check('sottodominio conservato: mail.anthropic.com non è anthropic.com',
  normDomain('info@mail.anthropic.com') === 'mail.anthropic.com');
check('dominio da valore vuoto è null', normDomain('') === null && normDomain(null) === null);

check('il prefisso internazionale si conserva',
  normPhone('+41 91 123 45 67') === '+41911234567');
check('un numero senza prefisso NON ne riceve uno inventato',
  normPhone('091 123 45 67') === '0911234567');
check('un telefono senza cifre è null', normPhone('---') === null);

// ---------------------------------------------------------------------------
section('3. L’IDI — la cifra di controllo decide se un collegamento è lecito');

// CHE-107.721.785 è un IDI reale, lo stesso provato contro l'API Zefix viva.
check('un IDI valido produce la forma canonica',
  normUid('CHE-107.721.785') === 'CHE107721785');
check('la forma senza punteggiatura produce la stessa chiave',
  normUid('che107721785') === 'CHE107721785');
// ⚠️ IL CASO CHE CONTA DI PIÙ: §25 grado 1 dice che un IDI valido AUTORIZZA un
// collegamento automatico. Se questo tornasse una chiave, un IDI inventato
// unirebbe due imprese diverse senza che nessuno lo chieda.
check('una cifra di controllo errata NON identifica nessuno',
  normUid('CHE-107.721.786') === null);
check('un IDI incompleto NON identifica nessuno', normUid('CHE-107.721') === null);
check('un IDI assente NON identifica nessuno',
  normUid(null) === null && normUid('') === null);
check('un IDI con dieci cifre NON identifica nessuno', normUid('CHE-107.721.7851') === null);

// ⚠️ TERZA COPIA DELL'ALGORITMO. `isValidUid` (src/lib/uid.ts) avvisa mentre si
// scrive, `checkUid` (finance/checksums.ts) valida l'IDI letto su una fattura,
// `normUid` produce la CHIAVE. Se una delle tre cambiasse, il CRM collegherebbe
// dove l'interfaccia dice «non valido», o viceversa.
const uidCases = [
  'CHE-107.721.785', 'CHE-107.721.786', 'CHE-116.281.710', 'CHE-105.805.117',
  'CHE-000.000.000', 'CHE-999.999.999', 'CHE-123.456.789',
];
const disagreements = uidCases.filter((u) => isValidUid(u) !== (normUid(u) !== null));
check('normUid e isValidUid concordano su sette IDI reali e inventati',
  disagreements.length === 0,
  disagreements.map((u) => `${u}: uid.ts=${isValidUid(u)}, crmMatch=${normUid(u) !== null}`).join('; '));

// ---------------------------------------------------------------------------
section('4. Il filtro anti-rumore — 54 mittenti veri diventano 6');

check('gmail.com e bluewin.ch sono domini pubblici',
  isPublicDomain('gmail.com') && isPublicDomain('bluewin.ch'));
check('un dominio aziendale non è pubblico', !isPublicDomain('rossi.ch'));
check('un dominio pubblico scritto in maiuscolo è comunque pubblico',
  isPublicDomain('GMAIL.COM'));

check('noreply@ è un indirizzo di servizio', isServiceAddress('noreply@stripe.com'));
check('no-reply@ con trattino è un indirizzo di servizio',
  isServiceAddress('no-reply@amazon.it'));
check('newsletter@ è un indirizzo di servizio', isServiceAddress('newsletter@adobe.com'));
// ⚠️ IL TRATTINO È SIA SEPARATORE SIA PARTE DELLA PAROLA: spezzando anche sui
// trattini, «no-reply» diventava «no» + «reply» e nessuno dei due è nell'elenco.
// È il difetto che questo caso ha trovato alla prima esecuzione.
check('un pezzo di servizio dentro l’indirizzo basta',
  isServiceAddress('no-reply.marketing@shophunter.io'));
check('anche con il trattino sostituito da un trattino basso',
  isServiceAddress('no_reply@shophunter.io'));
check('mailer-daemon è riconosciuto', isServiceAddress('mailer-daemon@rossi.ch'));
check('una persona NON è un indirizzo di servizio',
  !isServiceAddress('laura.bianchi@rossi.ch'));
// ⚠️ Il confronto è a SEGMENTI e non per sottostringa: un `includes` scarterebbe
// «annalisa» perché contiene «anna»… e soprattutto scarterebbe i mittenti veri.
check('«annalisa@…» non viene scartata', !isServiceAddress('annalisa@rossi.ch'));
// ⚠️ §127 — un indirizzo GENERICO appartiene all'organizzazione, non a una
// persona, ed è proprio da lì che vale la pena proporre una controparte. Un
// elenco troppo largo scarterebbe i mittenti che contano.
check('«info@» NON è un indirizzo di servizio: è la casella di un’impresa vera',
  !isServiceAddress('info@rossi.ch'));
check('«mail@» NON è un indirizzo di servizio', !isServiceAddress('mail@rossi.ch'));

const azionabile = { isBulk: false, relevance: 'likely_actionable' };
check('un mittente azionabile, non massivo e non di servizio merita un suggerimento',
  deservesSuggestion({ senderEmail: 'laura@rossi.ch', ...azionabile }));
check('un messaggio massivo NON merita un suggerimento',
  !deservesSuggestion({ senderEmail: 'laura@rossi.ch', isBulk: true, relevance: 'likely_actionable' }));
check('un messaggio irrilevante NON merita un suggerimento',
  !deservesSuggestion({ senderEmail: 'laura@rossi.ch', isBulk: false, relevance: 'clearly_irrelevant' }));
// ⚠️ `null` compreso: una email non ancora classificata non ha un giudizio, e
// dedurne uno sarebbe inventarlo. Sui dati veri erano 11 messaggi su 117.
check('una rilevanza NON ANCORA calcolata non merita un suggerimento',
  !deservesSuggestion({ senderEmail: 'laura@rossi.ch', isBulk: false, relevance: null }));
check('«informational» non basta: serve azionabile',
  !deservesSuggestion({ senderEmail: 'laura@rossi.ch', isBulk: false, relevance: 'informational' }));
check('un indirizzo di servizio non merita un suggerimento nemmeno se azionabile',
  !deservesSuggestion({ senderEmail: 'noreply@stripe.com', ...azionabile }));
check('un indirizzo assente o malformato non merita un suggerimento',
  !deservesSuggestion({ senderEmail: null, ...azionabile })
  && !deservesSuggestion({ senderEmail: 'non-un-indirizzo', ...azionabile }));

// La riproduzione del campione reale: gli stessi mittenti misurati sul database.
const CAMPIONE = [
  { senderEmail: 'noreply@stripe.com', isBulk: true, relevance: 'clearly_irrelevant' },
  { senderEmail: 'no-reply@amazon.it', isBulk: true, relevance: 'clearly_irrelevant' },
  { senderEmail: 'newsletter@cobratate.com', isBulk: true, relevance: 'clearly_irrelevant' },
  { senderEmail: 'support@mail.anthropic.com', isBulk: false, relevance: 'likely_actionable' },
  { senderEmail: 'info@bj.admin.ch', isBulk: false, relevance: 'likely_actionable' },
  { senderEmail: 'cancelleria@lugano.ch', isBulk: false, relevance: 'possibly_actionable' },
  { senderEmail: 'noreply@mail.adobe.com', isBulk: true, relevance: 'informational' },
  { senderEmail: 'marketing@email.shophunter.io', isBulk: true, relevance: 'clearly_irrelevant' },
];
const ammessi = CAMPIONE.filter(deservesSuggestion);
check('sul campione reale il filtro ammette solo i mittenti plausibili',
  ammessi.length === 3
  && ammessi.every((s) => /anthropic|bj\.admin\.ch|lugano\.ch/.test(s.senderEmail!)),
  `ammessi: ${ammessi.map((s) => s.senderEmail).join(', ')}`);

// ---------------------------------------------------------------------------
section('5. Abbinamento — identità contro sospetto');

check('solo IDI ed email esatta autorizzano il collegamento automatico',
  AUTO_LINK_REASONS.length === 2
  && canAutoLink('uid_exact') && canAutoLink('email_exact'));
check('dominio e ragione sociale NON autorizzano il collegamento automatico',
  !canAutoLink('domain_match') && !canAutoLink('name_normalized'));
check('un collegamento manuale non è un abbinamento automatico',
  !canAutoLink('manual'));
check('l’IDI è il segnale più forte',
  reasonRank('uid_exact') < reasonRank('email_exact')
  && reasonRank('email_exact') < reasonRank('domain_match'));

const uno: MatchCandidate = { organizationId: 'A', contactId: null, reason: 'email_exact', reasonDetail: null };
const altro: MatchCandidate = { organizationId: 'B', contactId: null, reason: 'email_exact', reasonDetail: null };
const debole: MatchCandidate = { organizationId: 'C', contactId: null, reason: 'domain_match', reasonDetail: null };
check('un solo candidato forte viene scelto', pickAutoLink([uno, debole])?.organizationId === 'A');
check('nessun candidato forte: nessun collegamento automatico',
  pickAutoLink([debole]) === null);
// ⚠️ IL CASO CHE EVITA DI ATTRIBUIRE UNA COMUNICAZIONE ALL'IMPRESA SBAGLIATA:
// due organizzazioni con lo stesso indirizzo sono un DUPLICATO da risolvere, e
// scegliere a caso sarebbe un errore invisibile.
check('due candidati forti in pareggio: la decisione torna a una persona',
  pickAutoLink([uno, altro]) === null);
check('un elenco vuoto non produce collegamenti', pickAutoLink([]) === null);

check('lo stesso dominio non pubblico è un sospetto',
  domainSuggests('laura@rossi.ch', 'https://www.rossi.ch'));
check('un dominio pubblico non suggerisce niente',
  !domainSuggests('laura@gmail.com', 'gmail.com'));
check('domini diversi non suggeriscono niente',
  !domainSuggests('laura@rossi.ch', 'bianchi.ch'));

const k = suggestionKey('email_message', 'abc', 'domain_match', 'org-1');
check('la chiave di un suggerimento è stabile fra due chiamate',
  k === suggestionKey('email_message', 'abc', 'domain_match', 'org-1'));
check('la chiave non contiene un indirizzo email (§122)', !k.includes('@'));
check('senza destinatario la chiave dice «new»',
  suggestionKey('email_message', 'abc', 'domain_match', null).endsWith(':new'));

// ---------------------------------------------------------------------------
section('6. Stato di una riga — l’ordine delle priorità');

const base = {
  archivedAt: null as string | null, mergedIntoId: null as string | null,
  overdueTaskCount: 0, lastContactAt: '2026-07-29T10:00:00Z',
  openOpportunityCount: 0, relationshipStatus: 'active' as const,
  roles: ['customer'] as never[],
};
const OGGI = new Date('2026-07-30T09:00:00');
check('unita vince su tutto', organizationState({ ...base, mergedIntoId: 'x', archivedAt: 'y' }, 30, OGGI) === 'merged');
check('archiviata vince su un’attività scaduta',
  organizationState({ ...base, archivedAt: 'y', overdueTaskCount: 3 }, 30, OGGI) === 'archived');
// ⚠️ Un'attività scaduta è un impegno MANCATO, non un promemoria: viene prima
// dell'inattività, che è solo un'assenza.
check('un’attività scaduta viene prima dell’inattività',
  organizationState({ ...base, overdueTaskCount: 1, lastContactAt: null }, 30, OGGI) === 'overdue_tasks');
check('mai contattata viene prima di «senza contatto recente»',
  organizationState({ ...base, lastContactAt: null }, 30, OGGI) === 'never_contacted');
check('senza contatto da oltre la soglia',
  organizationState({ ...base, lastContactAt: '2026-05-01T10:00:00Z' }, 30, OGGI) === 'stale');
check('dentro la soglia e con una trattativa: trattativa in corso',
  organizationState({ ...base, openOpportunityCount: 2 }, 30, OGGI) === 'active_deal');
// ⚠️ §69 — l'inattività si misura SOLO su chi dovrebbe essere sentito: un ente
// pubblico che non scrive da sei mesi non è una relazione trascurata.
check('un ente pubblico mai contattato NON è una relazione trascurata',
  organizationState({ ...base, lastContactAt: null, roles: ['authority'] as never[] }, 30, OGGI) === 'ok');
check('un fornitore mai contattato NON è una relazione trascurata',
  organizationState({ ...base, lastContactAt: null, roles: ['supplier'] as never[] }, 30, OGGI) === 'ok');
check('un rapporto non attivo lo dichiara',
  organizationState({ ...base, relationshipStatus: 'inactive' }, 30, OGGI) === 'inactive');
check('la soglia è un parametro, non una costante nascosta',
  organizationState({ ...base, lastContactAt: '2026-07-10T10:00:00Z' }, 10, OGGI) === 'stale'
  && organizationState({ ...base, lastContactAt: '2026-07-10T10:00:00Z' }, 90, OGGI) === 'ok');
check('la soglia predefinita è dichiarata e vale trenta giorni', DEFAULT_STALE_DAYS === 30);

// ---------------------------------------------------------------------------
section('7. Opportunità e denaro — nessuna somma fra valute');

const opp = { archivedAt: null as string | null, stage: 'proposal' as const, nextStep: 'Chiamare Laura', nextStepDueDate: '2026-08-10' };
check('archiviata vince', opportunityState({ ...opp, archivedAt: 'x' }, OGGI) === 'archived');
check('vinta si dichiara', opportunityState({ ...opp, stage: 'won' }, OGGI) === 'won');
check('persa si dichiara', opportunityState({ ...opp, stage: 'lost' }, OGGI) === 'lost');
check('un prossimo passo scaduto viene prima di «senza prossimo passo»',
  opportunityState({ ...opp, nextStepDueDate: '2026-07-01', nextStep: null }, OGGI) === 'overdue_step');
// ⚠️ §99 — una trattativa aperta che nessuno sa come proseguire è FERMA, anche
// se sembra viva. Senza questo stato la pipeline mostra caselle tutte uguali.
check('senza prossimo passo è uno stato, non un dettaglio',
  opportunityState({ ...opp, nextStep: null, nextStepDueDate: null }, OGGI) === 'no_step');
check('un prossimo passo di soli spazi non conta come prossimo passo',
  opportunityState({ ...opp, nextStep: '   ', nextStepDueDate: null }, OGGI) === 'no_step');
check('vinta e persa non sono aperte', !isOpen('won') && !isOpen('lost'));
check('la board ha cinque colonne, «persa» non è una colonna',
  PIPELINE_STAGES.length === 5 && !PIPELINE_STAGES.includes('lost') && ALL_STAGES.length === 6);

const celle = [
  { stage: 'proposal' as const, currency: 'CHF', opportunityCount: 2, totalAmount: 84000 },
  { stage: 'negotiation' as const, currency: 'CHF', opportunityCount: 1, totalAmount: 18000 },
  { stage: 'proposal' as const, currency: 'EUR', opportunityCount: 1, totalAmount: 12000 },
  { stage: 'won' as const, currency: 'CHF', opportunityCount: 5, totalAmount: 200000 },
  { stage: 'lead' as const, currency: null, opportunityCount: 3, totalAmount: null },
];
const perValuta = pipelineByCurrency(celle);
// ⚠️ §45 — CHF ed EUR non si sommano: il totale unico sarebbe un numero che non
// esiste. E §46: le opportunità senza valore NON diventano zero.
check('i valori restano separati per valuta', perValuta.length === 3,
  JSON.stringify(perValuta));
check('CHF somma solo le opportunità APERTE, non quelle vinte',
  perValuta.find((r) => r.currency === 'CHF')?.totalAmount === 102000);
check('EUR resta a sé', perValuta.find((r) => r.currency === 'EUR')?.totalAmount === 12000);
check('le opportunità senza valuta portano un conteggio e nessun importo',
  perValuta.find((r) => r.currency === null)?.totalAmount === null
  && perValuta.find((r) => r.currency === null)?.opportunityCount === 3);
check('l’ordine delle valute è stabile e la valuta ignota è ultima',
  perValuta[perValuta.length - 1]!.currency === null);
const perFase = countByStage(celle);
check('i conteggi per fase tornano',
  perFase.proposal === 3 && perFase.won === 5 && perFase.lost === 0);

// ---------------------------------------------------------------------------
section('8. Giorni di calendario — alle 23:30 «ieri» non è «oggi»');

// ⚠️ La trappola già pagata nel Work Hub: millisecondi diviso 86'400'000 su un
// orario fa dire «oggi» a una scadenza di domani alle 23:30.
const TARDI = new Date('2026-07-30T23:30:00');
check('domani resta domani anche alle 23:30', calendarDaysUntil('2026-07-31', TARDI) === 1);
check('oggi è zero anche alle 23:30', calendarDaysUntil('2026-07-30', TARDI) === 0);
check('ieri è negativo', calendarDaysUntil('2026-07-29', TARDI) === -1);
check('senza data non c’è un numero di giorni', calendarDaysUntil(null) === null);
check('una data non valida non produce un numero', calendarDaysUntil('non-una-data') === null);
check('giorni trascorsi da ieri, alle 23:30, sono uno',
  daysSince('2026-07-29T00:10:00Z', TARDI) === 1);
// «Mai contattata» deve pesare come un'eternità nei confronti, non come zero.
check('senza data i giorni trascorsi sono infiniti, non zero',
  daysSince(null) === Number.POSITIVE_INFINITY);

// ---------------------------------------------------------------------------
section('9. Filtri in URL — un valore assurdo non diventa un filtro invisibile');

check('quattro viste e quattro ordinamenti dichiarati',
  CRM_VIEWS.length === 4 && CRM_SORTS.length === 4);
const f = filtersFromParams(new URLSearchParams(
  'vista=prospects&q=rossi&ruolo=supplier&inattivi=45&scadute=1&ordina=name&da=50'));
check('i filtri si leggono dall’URL',
  f.view === 'prospects' && f.query === 'rossi' && f.role === 'supplier'
  && f.staleDays === 45 && f.onlyOverdueTasks && f.sort === 'name' && f.offset === 50);
// ⚠️ La trappola della barra delle categorie nel Document Hub: un filtro ATTIVO
// e INVISIBILE. Un valore assurdo non deve diventare la soglia predefinita.
check('«inattivi=pippo» non diventa la soglia predefinita: nessun filtro',
  filtersFromParams(new URLSearchParams('inattivi=pippo')).staleDays === null);
check('«inattivi=0» non è un filtro',
  filtersFromParams(new URLSearchParams('inattivi=0')).staleDays === null);
check('«inattivi=-5» non è un filtro',
  filtersFromParams(new URLSearchParams('inattivi=-5')).staleDays === null);
check('una vista sconosciuta ricade su «tutti», non su un elenco vuoto',
  filtersFromParams(new URLSearchParams('vista=pippo')).view === 'all');
check('una ricerca lunghissima viene troncata e non rifiutata',
  (filtersFromParams(new URLSearchParams(`q=${'a'.repeat(500)}`)).query ?? '').length === 120);
const round = filtersFromParams(paramsFromFilters(f));
check('i filtri sopravvivono a un giro completo URL → filtri → URL',
  JSON.stringify(round) === JSON.stringify(f), `${JSON.stringify(round)} vs ${JSON.stringify(f)}`);
check('i filtri vuoti non producono parametri',
  paramsFromFilters(EMPTY_FILTERS).toString() === '');
// ⚠️ Il filtro esplicito VINCE sulla vista: altrimenti la schermata mostrerebbe
// un elenco che contraddice il controllo appena usato.
check('la vista impone un ruolo quando il filtro non lo dice',
  effectiveRole({ ...EMPTY_FILTERS, view: 'customers' }) === 'customer');
check('un filtro esplicito vince sulla vista',
  effectiveRole({ ...EMPTY_FILTERS, view: 'customers', role: 'supplier' }) === 'supplier');
check('la vista pipeline non impone alcun ruolo',
  effectiveRole({ ...EMPTY_FILTERS, view: 'pipeline' }) === null);
check('la sola vista non conta come filtro attivo',
  !hasActiveFilters({ ...EMPTY_FILTERS, view: 'customers' } as CrmFilters)
  && hasActiveFilters({ ...EMPTY_FILTERS, query: 'x' } as CrmFilters));

// ---------------------------------------------------------------------------
section('10. Etichette e ordinamenti stabili');

// ⚠️ La trappola «Assicurazioni sociali · Assicurazioni sociali» del Document
// Hub: la stessa etichetta stampata due volte, vista solo aprendo la schermata.
check('la ragione sociale identica al nome non si stampa due volte',
  secondaryName({ displayName: 'Rossi SA', legalName: 'Rossi SA' }) === null);
check('una ragione sociale diversa si mostra',
  secondaryName({ displayName: 'Swisscom', legalName: 'Swisscom (Svizzera) SA' }) === 'Swisscom (Svizzera) SA');
check('il confronto ignora maiuscole e spazi',
  secondaryName({ displayName: 'Rossi SA ', legalName: 'rossi sa' }) === null);
check('senza ragione sociale non si mostra niente',
  secondaryName({ displayName: 'Rossi SA', legalName: null }) === null);

// ⚠️ §109 — senza la seconda chiave d'ordine, due righe con lo stesso istante si
// scambiano fra una pagina e l'altra e qualcosa scompare.
const righe = [
  { id: 'b', occurredAt: '2026-07-30T10:00:00Z' },
  { id: 'a', occurredAt: '2026-07-30T10:00:00Z' },
  { id: 'c', occurredAt: '2026-07-29T10:00:00Z' },
];
const ordinate = [...righe].sort(compareTimeline).map((r) => r.id);
check('la timeline ordina dal più recente, con l’id come seconda chiave',
  JSON.stringify(ordinate) === JSON.stringify(['b', 'a', 'c']), ordinate.join(','));
check('l’ordinamento è stabile fra due esecuzioni',
  JSON.stringify([...righe].sort(compareTimeline).map((r) => r.id)) === JSON.stringify(ordinate));

// ---------------------------------------------------------------------------
section('11. Il candidato automatico (0030) — la chiave scritta due volte');

// ⚠️ STESSA CLASSE DEL CONTROLLO SUI DOMINI PUBBLICI, ed è il motivo per cui
// questa sezione esiste. `suggestionKey()` in TypeScript e la stringa composta
// dentro `crm_scan_link_suggestions` in SQL sono la stessa chiave di
// idempotenza scritta due volte. Se divergono non si rompe niente in modo
// visibile: la scansione ricrea a ogni giro proposte che il frontend considera
// nuove, e l'elenco «da verificare» diventa illeggibile nel giro di un'ora.
// Il typecheck non guarda dentro l'SQL: questa è l'unica rete.
const CANDIDATE = readFileSync(
  join(HERE, '..', 'supabase', 'migrations', '0030_crm_link_candidate.sql'), 'utf8');

const sqlKeyParts = [...CANDIDATE.matchAll(
  /v_key := '([^']+)' \|\| r\.id::text \|\| ':' \|\| v_reason::text \|\| ':'\s*\|\| coalesce\(v_target::text, '([^']+)'\)/g)]
  .map((m) => ({ prefix: m[1]!, fallback: m[2]! }));

check('le due chiavi composte in SQL hanno la forma di suggestionKey()',
  sqlKeyParts.length === 2, `trovate ${sqlKeyParts.length}`);

const keysMatch = sqlKeyParts.every(({ prefix, fallback }) => {
  // `crm:contract:` → entità «contract», e la chiave TS con lo stesso motivo e
  // lo stesso bersaglio deve venire identica, carattere per carattere.
  const entity = prefix.replace(/^crm:/, '').replace(/:$/, '');
  const withTarget = `${prefix}00000000-0000-4000-8000-000000000001:name_normalized:org-1`;
  const withoutTarget = `${prefix}00000000-0000-4000-8000-000000000001:extracted_name:${fallback}`;
  return suggestionKey(entity, '00000000-0000-4000-8000-000000000001', 'name_normalized', 'org-1') === withTarget
    && suggestionKey(entity, '00000000-0000-4000-8000-000000000001', 'extracted_name', null) === withoutTarget;
});
check('SQL e TypeScript compongono la STESSA chiave di idempotenza', keysMatch,
  sqlKeyParts.map((p) => `${p.prefix}…:${p.fallback}`).join(' | '));

// Le due sorgenti sono quelle dichiarate, e sono valori dell'enum
// `crm_linked_entity`: una entità sbagliata verrebbe rifiutata dal database
// solo al primo inserimento vero, cioè in produzione.
check('il candidato legge contratti e voci di Finanze, e nient’altro',
  JSON.stringify(sqlKeyParts.map((p) => p.prefix).sort())
    === JSON.stringify(['crm:contract:', 'crm:finance_item:']),
  sqlKeyParts.map((p) => p.prefix).join(', '));

// ⚠️ `extracted_name` NON deve autorizzare un collegamento automatico: dice che
// una scheda NON c'è, ed è il più debole dei motivi. Se qualcuno lo aggiungesse
// ad AUTO_LINK_REASONS, il prodotto comincerebbe a collegare documenti a
// controparti inesistenti.
check('«nome letto sul documento» non collega niente da solo',
  !canAutoLink('extracted_name') && !AUTO_LINK_REASONS.includes('extracted_name'));
check('«nome letto sul documento» è il motivo più debole della scala',
  reasonRank('extracted_name') > reasonRank('name_normalized'));

// La migrazione aggiunge UN valore enum e non lo nomina nel blocco che gira
// (55P04, terza volta in questo repository).
const addedByCandidate = [...CANDIDATE.matchAll(
  /alter type public\.\w+ add value if not exists '([^']+)'/g)].map((m) => m[1]!);
check('la 0030 aggiunge un solo valore all’enum dei motivi',
  addedByCandidate.length === 1 && addedByCandidate[0] === 'extracted_name',
  addedByCandidate.join(', '));
const candidateSelfCheck = CANDIDATE.slice(CANDIDATE.lastIndexOf('-- 4. Autoverifica'));
check('il blocco di autoverifica della 0030 non nomina il valore aggiunto (55P04)',
  addedByCandidate.every((v) => !candidateSelfCheck.includes(`'${v}'`)));

// ⚠️ La funzione si difende da sola: `revoke` più il controllo su `auth.uid()`.
// È la lezione della 0029 — su Supabase un `revoke` senza la seconda serratura
// dipende dal fatto che nessuno riconceda i privilegi per default.
check('la scansione rifiuta la chiamata di un utente autenticato',
  CANDIDATE.includes('auth.uid() is not null'));
check('la scansione è revocata a public, anon e authenticated',
  /revoke all on function public\.crm_scan_link_suggestions\(integer\) from public, anon, authenticated/
    .test(CANDIDATE));
// Propone e basta: nessuna scrittura sulle anagrafiche né sui documenti.
check('il candidato non scrive MAI su crm_organizations, contracts o finance_items',
  !/insert into public\.crm_organizations|update public\.(contracts|finance_items|crm_organizations)/
    .test(CANDIDATE));

// ---------------------------------------------------------------------------
section('12. Il sito web è un link, e un link può essere codice');

// ⚠️⚠️ IL CAMPO ERA LIBERO DAL 15.08. Il servizio faceva `.trim()`, la scheda
// scriveva `<a href={o.website}>`: un `javascript:…` salvato lì dentro eseguiva
// codice nella sessione di chiunque cliccasse il link — il suo token, la sua
// azienda. Non serviva bucare niente: bastava avere accesso al campo.
check('javascript: non è un sito web', safeWebsite('javascript:alert(1)') === null,
  String(safeWebsite('javascript:alert(1)')));
check('data:text/html non è un sito web', safeWebsite('data:text/html,<script>alert(1)</script>') === null,
  String(safeWebsite('data:text/html,<script>alert(1)</script>')));
check('vbscript: non è un sito web', safeWebsite('vbscript:msgbox') === null);
check('file:// non è un sito web', safeWebsite('file:///etc/passwd') === null);
// ⚠️ `//evil.com` è la forma che INGANNA CHI GUARDA: sembra un percorso, e il
// browser lo risolve sull'origine corrente come URL assoluto verso evil.com.
check('//evil.com senza schema non è un sito web', safeWebsite('//evil.com') === null,
  String(safeWebsite('//evil.com')));
// ⚠️ LO SCHEMA SI LEGGE, NON SI CERCA. Un pattern su «javascript:» non vede né
// le maiuscole né il tab in mezzo; `new URL()` sì. È il motivo per cui questa è
// la stessa funzione dell'Inbox e non una seconda scritta per il CRM.
check('JavaScript: con maiuscole e spazi non passa', safeWebsite('  JavaScript:alert(1)') === null);
check('java\\tscript: non passa', safeWebsite('java\tscript:alert(1)') === null);

// LA CONTROPROVA — senza queste, «rifiuta tutto» sarebbe verde.
check('https://esempio.ch è un sito web', safeWebsite('https://esempio.ch') === 'https://esempio.ch',
  String(safeWebsite('https://esempio.ch')));
check('http://www.admin.ch/ è un sito web', safeWebsite('http://www.admin.ch/') === 'http://www.admin.ch/');
check('gli spazi intorno si tolgono', safeWebsite('  https://esempio.ch  ') === 'https://esempio.ch');
check('campo vuoto: nessun sito, e nessun errore', safeWebsite('') === null && safeWebsite(null) === null);
// ⚠️ `esempio.ch` senza schema NON passa, ed è una scelta: indovinare `https://`
// sarebbe inventare un dato che l'utente non ha scritto. Il messaggio glielo dice.
check('un dominio nudo non si completa da solo', safeWebsite('esempio.ch') === null,
  String(safeWebsite('esempio.ch')));

// ⚠️ LA GUARDIA SCOLLEGATA. Le prove qui sopra restano verdi anche se il
// servizio e la scheda smettono di chiamare `safeWebsite`: è il difetto vero, e
// una funzione giusta che non chiama nessuno non protegge niente. Qui si legge
// il sorgente dei DUE punti che scrivono e mostrano quel campo.
const SERVICE = readFileSync(join(HERE, '..', 'src', 'services', 'crmService.ts'), 'utf8');
const DETAIL = readFileSync(
  join(HERE, '..', 'src', 'features', 'crm', 'ClientDetailPage.tsx'), 'utf8');

check('crmService non scrive più il campo grezzo (create e update)',
  !/website\s*[:=]\s*(input|patch)\.website\?\.trim\(\)/.test(SERVICE));
// Ogni lettura del campo in ARRIVO — `input.website` alla creazione,
// `patch.website` alla modifica — deve stare dentro la guardia. L'unica che non
// conta è il `patch.website !== undefined`, che chiede se il campo è nella
// patch e non che valore abbia. Due punti: se qualcuno ne riporta indietro uno,
// qui si vede.
const websiteReads = [...SERVICE.matchAll(/(.{0,20}?)((?:input|patch)\.website)(?!\s*!==)/g)];
check('entrambe le scritture passano dalla guardia',
  websiteReads.length === 2 && websiteReads.every((m) => m[1]!.endsWith('websiteDaSalvare(')),
  websiteReads.map((m) => `${m[1]}${m[2]}`).join(' | '));
check('e la guardia rifiuta invece di ripulire in silenzio',
  /crm\.errors\.websiteNotHttp/.test(SERVICE));
check('la scheda cliente non mette più il valore grezzo in un href',
  !/href=\{o\.website\}\s*target/.test(DETAIL.replace(/safeWebsite\(o\.website\)[\s\S]{0,80}?href=\{o\.website\}/, 'GUARDATO')));
check('la scheda cliente chiama safeWebsite prima di collegare',
  /safeWebsite\(o\.website\)/.test(DETAIL));

// ---------------------------------------------------------------------------
section('13. Il parser CSV — virgolette, separatori, codifiche');

// Ogni controllo di questa sezione è scritto per FALLIRE se il parser cambia:
// un separatore riconosciuto male sposta una colonna e importa la città nel
// CAP, e il risultato sembra giusto finché qualcuno non apre la scheda.
check('il punto e virgola è il separatore degli export svizzeri',
  detectDelimiter('Nome;Citta;Cantone') === ';');
check('la virgola si riconosce quando domina',
  detectDelimiter('name,city,canton') === ',');
check('il tab si riconosce',
  detectDelimiter('name\tcity\tcanton') === '\t');
check('una virgola DENTRO le virgolette non fa vincere la virgola',
  detectDelimiter('"Bianchi, Rossi";Citta') === ';');
check('senza separatori resta il default svizzero',
  detectDelimiter('Nome') === ';');

check('i campi si dividono sul separatore',
  JSON.stringify(parseCsv('a;b;c\n1;2;3').rows) === JSON.stringify([['1', '2', '3']]));
check('le virgolette proteggono il separatore dentro un campo',
  JSON.stringify(parseCsv('a;b\n"x;y";2').rows) === JSON.stringify([['x;y', '2']]));
check('l’escape "" produce un doppio apice',
  parseCsv('a\n"dett ""virgolette"""').rows[0]![0] === 'dett "virgolette"');
check('un ritorno a capo DENTRO le virgolette non chiude la riga',
  parseCsv('a;b\n"riga\nuno";2').rows.length === 1
  && parseCsv('a;b\n"riga\nuno";2').rows[0]![0] === 'riga\nuno');
check('il \\r\\n di Windows è un solo fine riga',
  parseCsv('a;b\r\n1;2\r\n3;4').rows.length === 2);
check('il \\r dei vecchi Mac è un fine riga',
  parseCsv('a;b\r1;2').rows.length === 1 && parseCsv('a;b\r1;2').rows[0]![0] === '1');
check('la riga finale senza ritorno a capo non si perde',
  parseCsv('a;b\n1;2').rows.length === 1);
check('le righe vuote si saltano, anche quelle di soli spazi',
  parseCsv('a;b\n\n1;2\n   \n3;4\n').rows.length === 2);
check('il BOM dentro la stringa non finisce nella prima intestazione',
  parseCsv('﻿Nome;Citta\nRossi;Lugano').headers[0] === 'Nome');
check('l’intestazione è la prima riga e non una riga dati',
  parseCsv('Nome;Citta\nRossi;Lugano').rows.length === 1
  && parseCsv('Nome;Citta\nRossi;Lugano').totalDataRows === 1);
// Il numero della riga NEL FILE serve a dirla all'utente: header = 1, quindi
// la prima riga dati è la 2.
check('la bozza porta il numero della riga nel file, intestazione compresa',
  buildDrafts(parseCsv('Azienda\nRossi\nBianchi'), suggestMapping(['Azienda']))
    .map((d) => d.fileRow).join(',') === '2,3');

check('UTF-8 si dichiara tale',
  decodeCsvBytes(new TextEncoder().encode('Zürich')).encoding === 'utf-8'
  && decodeCsvBytes(new TextEncoder().encode('Zürich')).text === 'Zürich');
// 0xFC è la ü di windows-1252: in UTF-8 rigoroso non decodifica, e il ripiego
// deve DICHIARARSI — «Zürich» rovinato in silenzio diventerebbe «Z�rich»
// dentro un'anagrafica.
check('un byte windows-1252 ripiega sulla sua codifica, dichiarandola',
  decodeCsvBytes(new Uint8Array([0x5a, 0xfc, 0x72, 0x69, 0x63, 0x68])).encoding === 'windows-1252'
  && decodeCsvBytes(new Uint8Array([0x5a, 0xfc, 0x72, 0x69, 0x63, 0x68])).text === 'Zürich');
check('il BOM UTF-8 si toglie e la codifica resta utf-8',
  decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x4e, 0x6f, 0x6d, 0x65])).text === 'Nome'
  && decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x4e])).encoding === 'utf-8');

const troppe = 'a\n' + Array.from({ length: IMPORT_MAX_ROWS + 5 }, (_, i) => `r${i}`).join('\n');
const limite = parseCsv(troppe);
check('oltre il tetto si importano solo le prime righe',
  limite.rows.length === IMPORT_MAX_ROWS && limite.rowLimitHit);
check('ma il numero VERO delle righe si dichiara',
  limite.totalDataRows === IMPORT_MAX_ROWS + 5);
check('il tetto dichiarato è mille righe', IMPORT_MAX_ROWS === 1000);

// ---------------------------------------------------------------------------
section('14. L’auto-mappatura — quattro lingue, e nessun indovino');

check('italiano: Azienda, Cognome, E-Mail, UID',
  JSON.stringify(suggestMapping(['Azienda', 'Cognome', 'E-Mail', 'UID']))
    === JSON.stringify(['org.display_name', 'person.last_name', 'contact.email', 'org.uid_che']));
check('tedesco: Unternehmen, Vorname, Telefon, Kanton',
  JSON.stringify(suggestMapping(['Unternehmen', 'Vorname', 'Telefon', 'Kanton']))
    === JSON.stringify(['org.display_name', 'person.first_name', 'contact.phone', 'org.canton']));
check('francese: Société, Prénom, Code postal',
  JSON.stringify(suggestMapping(['Société', 'Prénom', 'Code postal']))
    === JSON.stringify(['org.display_name', 'person.first_name', 'org.postal_code']));
check('inglese: Company, Last name, Job title',
  JSON.stringify(suggestMapping(['Company', 'Last name', 'Job title']))
    === JSON.stringify(['org.display_name', 'person.last_name', 'person.job_title']));
check('«Firma» è la ragione sociale, «IDE» è l’IDI',
  suggestMapping(['Firma'])[0] === 'org.display_name' && suggestMapping(['IDE'])[0] === 'org.uid_che');
check('gli accenti non contano: «Société» e «societe» sono la stessa intestazione',
  suggestMapping(['societe'])[0] === 'org.display_name');
check('una colonna irriconosciuta resta NON importata, non indovinata',
  suggestMapping(['pippo sconosciuto'])[0] === null);
// ⚠️ Due colonne che chiedono lo stesso campo non si scelgono da sole: vince
// la prima, la seconda resta da decidere a una persona.
check('due colonne sullo stesso campo: la seconda resta da decidere',
  JSON.stringify(suggestMapping(['Azienda', 'Ditta']))
    === JSON.stringify(['org.display_name', null]));

// ⚠️ LA COLLISIONE CHE IL COMPILATORE NON VEDE: un alias scritto sotto due
// campi terrebbe il primo in silenzio, e l'altro campo smetterebbe di essere
// riconosciuto. Il controllo itera gli elenchi VERI del modulo: nessuna copia
// letterale qui, che invecchierebbe.
const collisioni: string[] = [];
for (const field of IMPORT_FIELDS) {
  for (const alias of HEADER_ALIASES[field]) {
    if (suggestMapping([alias])[0] !== field) collisioni.push(`${field}:${alias}`);
  }
}
check('nessun alias è conteso fra due campi', collisioni.length === 0, collisioni.join(', '));

check('una mappatura senza alcun nome non apre l’anteprima',
  !mappingHasName([null, 'contact.email', null]));
check('il nome dell’organizzazione basta',
  mappingHasName(['org.display_name']));
check('nome e cognome insieme bastano, uno solo no',
  mappingHasName(['person.first_name', 'person.last_name'])
  && !mappingHasName(['person.first_name']));

check('il ruolo si legge nelle quattro lingue e nei valori dell’enum',
  parseRoles('cliente').roles[0] === 'customer'
  && parseRoles('Lieferant').roles[0] === 'supplier'
  && parseRoles('ancien client').roles[0] === 'former_customer'
  && parseRoles('customer').roles[0] === 'customer'
  && parseRoles('Behörde').roles[0] === 'authority');
check('più ruoli separati da virgola, senza doppioni',
  JSON.stringify(parseRoles('cliente, fornitore, cliente').roles)
    === JSON.stringify(['customer', 'supplier']));
check('un ruolo sconosciuto NON diventa «altro»: si dichiara',
  parseRoles('pippo').unknown.join('') === 'pippo' && parseRoles('pippo').roles.length === 0);
check('il campo ruolo vuoto non è un errore',
  parseRoles('').roles.length === 0 && parseRoles('').unknown.length === 0);

// ---------------------------------------------------------------------------
section('15. La validazione di una riga — errori in codice, mai in prosa');

const BOZZA_VUOTA: ImportDraft = {
  fileRow: 2, displayName: '', legalName: '', uidChe: '', vatNumber: '',
  website: '', street: '', postalCode: '', city: '', canton: '', countryCode: '',
  notes: '', roleRaw: '', firstName: '', lastName: '', jobTitle: '',
  email: '', phone: '', mobile: '',
};
const bozza = (patch: Partial<ImportDraft>): ImportDraft => ({ ...BOZZA_VUOTA, ...patch });

check('una riga senza né organizzazione né persona non è importabile',
  validateDraft(bozza({})).includes('missingName'));
check('il nome dell’organizzazione toglie l’errore',
  !validateDraft(bozza({ displayName: 'Rossi SA' })).includes('missingName'));
check('nome e cognome insieme tolgono l’errore, uno solo no',
  !validateDraft(bozza({ firstName: 'Laura', lastName: 'Bianchi' })).includes('missingName')
  && validateDraft(bozza({ firstName: 'Laura' })).includes('missingName'));
check('un’email malformata è un errore della riga',
  validateDraft(bozza({ displayName: 'X', email: 'non-un-indirizzo' })).includes('invalidEmail'));
check('un’email sensata non lo è',
  !validateDraft(bozza({ displayName: 'X', email: 'laura@rossi.ch' })).includes('invalidEmail'));
check('il cantone vuole due lettere: «Ticino» non passa',
  validateDraft(bozza({ displayName: 'X', canton: 'Ticino' })).includes('invalidCanton')
  && !validateDraft(bozza({ displayName: 'X', canton: 'TI' })).includes('invalidCanton'));
// ⚠️ La STESSA cifra di controllo della sezione 3: qui si prova che il modulo
// dell'import NON ne ha una quarta copia che potrebbe divergere.
check('un IDI con la cifra di controllo errata è un errore della riga',
  validateDraft(bozza({ displayName: 'X', uidChe: 'CHE-107.721.786' })).includes('invalidUid')
  && !validateDraft(bozza({ displayName: 'X', uidChe: 'CHE-107.721.785' })).includes('invalidUid'));
check('un ruolo non riconosciuto è un errore della riga',
  validateDraft(bozza({ displayName: 'X', roleRaw: 'pippo' })).includes('unknownRole')
  && !validateDraft(bozza({ displayName: 'X', roleRaw: 'cliente' })).includes('unknownRole'));
check('il paese vuole due lettere',
  validateDraft(bozza({ displayName: 'X', countryCode: 'Svizzera' })).includes('invalidCountry')
  && !validateDraft(bozza({ displayName: 'X', countryCode: 'CH' })).includes('invalidCountry'));
// ⚠️ Il servizio RIFIUTA un sito che non è http(s): meglio dirlo in anteprima
// che far fallire la riga a metà import. E `javascript:` non è un sito (§12).
check('un sito senza schema o pericoloso è un errore della riga',
  validateDraft(bozza({ displayName: 'X', website: 'www.rossi.ch' })).includes('invalidWebsite')
  && validateDraft(bozza({ displayName: 'X', website: 'javascript:alert(1)' })).includes('invalidWebsite')
  && !validateDraft(bozza({ displayName: 'X', website: 'https://www.rossi.ch' })).includes('invalidWebsite'));
check('una riga completa e corretta non ha errori',
  validateDraft(bozza({
    displayName: 'Rossi SA', uidChe: 'CHE-107.721.785', canton: 'TI', countryCode: 'CH',
    email: 'info@rossi.ch', roleRaw: 'cliente', website: 'https://www.rossi.ch',
  })).length === 0);

// ---------------------------------------------------------------------------
section('16. I duplicati — la scala di §25, dentro e fuori dal file');

const NESSUNO: ExistingIndex = {
  uids: new Set(), emails: new Set(), domains: new Set(), names: new Set(),
};
const ESISTENTI: ExistingIndex = {
  uids: new Set(['CHE107721785']),
  emails: new Set(['laura@rossi.ch']),
  domains: new Set(['rossi.ch']),
  names: new Set([normNameKey('Bianchi Sagl')!]),
};

check('un IDI valido già presente è un duplicato DURO',
  flagDuplicates([bozza({ uidChe: 'CHE-107.721.785' })], ESISTENTI)[0]?.kind === 'hardUid');
check('un IDI valido nuovo non è un duplicato',
  flagDuplicates([bozza({ uidChe: 'CHE-116.281.710' })], ESISTENTI)[0] === null);
// ⚠️ §25: un IDI con la cifra errata NON identifica nessuno — quindi non può
// né collidere col database né fra due righe del file.
check('un IDI con la cifra errata non collide con niente, nemmeno con sé stesso',
  flagDuplicates(
    [bozza({ uidChe: 'CHE-107.721.786' }), bozza({ uidChe: 'CHE-107.721.786' })],
    NESSUNO,
  ).every((f) => f === null));
check('lo stesso IDI valido su due righe del file: la seconda è marcata',
  flagDuplicates(
    [bozza({ uidChe: 'CHE-116.281.710' }), bozza({ uidChe: 'CHE-116.281.710' })],
    NESSUNO,
  ).map((f) => f?.kind ?? 'nessuno').join(',') === 'nessuno,internalUid');
check('un’email già registrata è un duplicato MOSTRATO',
  flagDuplicates([bozza({ displayName: 'X', email: 'LAURA@rossi.ch' })], ESISTENTI)[0]?.kind === 'email');
check('la stessa email su due righe del file: la seconda è marcata',
  flagDuplicates(
    [bozza({ displayName: 'A', email: 'x@y.ch' }), bozza({ displayName: 'B', email: 'x@y.ch' })],
    NESSUNO,
  ).map((f) => f?.kind ?? 'nessuno').join(',') === 'nessuno,internalEmail');
check('il dominio del sito coincide: duplicato mostrato',
  flagDuplicates([bozza({ displayName: 'X', website: 'https://www.rossi.ch' })], ESISTENTI)[0]?.kind === 'domain');
// ⚠️ §24 — un dominio PUBBLICO non prova nulla nemmeno nell'import.
check('un dominio pubblico non prova niente',
  flagDuplicates(
    [bozza({ displayName: 'X', website: 'https://gmail.com' })],
    { ...NESSUNO, domains: new Set(['gmail.com']) },
  )[0] === null);
check('la ragione sociale normalizzata identica è un duplicato mostrato',
  flagDuplicates([bozza({ displayName: 'Bianchi   Sagl' })], ESISTENTI)[0]?.kind === 'name');
// ⚠️ §24 — «Bianchi» e «Bianchi Sagl» restano soggetti DIVERSI: la
// normalizzazione non toglie la forma giuridica, o fonderebbe estranei.
check('«Bianchi» non è «Bianchi Sagl»: la forma giuridica non si toglie',
  flagDuplicates([bozza({ displayName: 'Bianchi' })], ESISTENTI)[0] === null);
check('il motivo più forte vince: IDI duro prima dell’email',
  flagDuplicates(
    [bozza({ uidChe: 'CHE-107.721.785', email: 'laura@rossi.ch' })],
    ESISTENTI,
  )[0]?.kind === 'hardUid');
check('il nome della persona si normalizza come quello dell’organizzazione',
  normNameKey('Rossi  SA') === normNameKey('rossi sa'));
check('senza corrispondenze nessuna riga è marcata',
  flagDuplicates([bozza({ displayName: 'Nuova Sagl' })], ESISTENTI)[0] === null);

// ---------------------------------------------------------------------------
section('17. A chi vanno i recapiti — la persona, se c’è');

// §127 — la regola del modulo: un recapito sta dove sta davvero. Se la riga
// porta una persona (nome E cognome), l'email e i telefoni sono suoi; senza
// persona, sono dell'organizzazione.
check('con nome e cognome i recapiti vanno alla persona',
  contactRoute({ firstName: 'Laura', lastName: 'Bianchi' }) === 'person');
check('senza persona vanno all’organizzazione',
  contactRoute({ firstName: '', lastName: '' }) === 'organization');
// ⚠️ Con UN SOLO nome non si sa chi sia: una persona a metà riempirebbe il CRM
// di sconosciuti, e il recapito resta dell'organizzazione.
check('un solo nome non fa una persona: il recapito resta dell’organizzazione',
  contactRoute({ firstName: 'Laura', lastName: '' }) === 'organization');
check('il nome effettivo deriva dalla persona quando l’organizzazione manca',
  effectiveName({ displayName: '', firstName: 'Laura', lastName: 'Bianchi' }) === 'Laura Bianchi');
check('e resta quello dell’organizzazione quando c’è',
  effectiveName({ displayName: 'Rossi SA', firstName: 'Laura', lastName: 'Bianchi' }) === 'Rossi SA');
// ⚠️ IL DIFETTO VISTO A SCHERMO IL 2026-08-28: la persona importata riceveva
// come `display_name` il nome DELL'ORGANIZZAZIONE — la card di «Chiara
// Moreschi» si intitolava «Galleria Ventuno Sagl». Il nome della persona è
// il suo, anche quando la riga porta un'organizzazione.
check('il nome della persona è il suo anche quando c’è l’organizzazione',
  personDisplayName({ firstName: 'Laura', lastName: 'Bianchi' }) === 'Laura Bianchi'
  && personDisplayName({ firstName: 'Laura', lastName: 'Bianchi' }) !== 'Rossi SA');
check('persona a metà: nessun nome di persona (e contactRoute non la crea)',
  personDisplayName({ firstName: 'Laura', lastName: '' }) === ''
  && contactRoute({ firstName: 'Laura', lastName: '' }) === 'organization');

// ---------------------------------------------------------------------------
section('18. La migrazione 0047, letta da fuori — i campi personalizzati');

// Le stesse reti della sezione 1, tese fra il TypeScript e il file SQL della
// 0047: ciò che è scritto due volte deve dire la stessa cosa, e il
// typecheck non può vederlo perché guarda solo il TypeScript.
const M47 = readFileSync(
  join(HERE, '..', 'supabase', 'migrations', '0047_crm_custom_fields.sql'), 'utf8');

const sqlEnum47 = (name: string): string[] => {
  const i = M47.indexOf(`create type public.${name} as enum (`);
  if (i < 0) return [];
  const body = M47.slice(i, M47.indexOf(');', i));
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
};

check('crm_field_entity: stessi valori nel TS e nella migrazione',
  JSON.stringify(sqlEnum47('crm_field_entity')) === JSON.stringify([...CRM_FIELD_ENTITIES]),
  `SQL: ${sqlEnum47('crm_field_entity').join(', ')} · TS: ${CRM_FIELD_ENTITIES.join(', ')}`);
check('crm_field_type: stessi valori nel TS e nella migrazione',
  JSON.stringify(sqlEnum47('crm_field_type')) === JSON.stringify([...CRM_FIELD_TYPES]),
  `SQL: ${sqlEnum47('crm_field_type').join(', ')} · TS: ${CRM_FIELD_TYPES.join(', ')}`);

// REVOKE PRIMA DEI GRANT, come ovunque dalla 0014: su `public` una tabella
// nasce con i privilegi completi, e un grant di colonna scritto dopo
// AGGIUNGE invece di togliere. L'ordine nel file è la garanzia.
for (const tabella of ['crm_field_definitions', 'crm_field_values'] as const) {
  const revoke = M47.indexOf(`revoke all on public.${tabella}`);
  const grant = M47.indexOf(`grant select on public.${tabella}`);
  check(`${tabella}: revoke all prima del primo grant`, revoke > -1 && grant > revoke);
}

// I grant di colonna sono la seconda argine del congelamento: tipo, entità e
// azienda non si riscrivono, e un campo nasce attivo (archived_at non si
// concede in insert). Il guardiano lo impone; qui si prova che il permesso
// non lo smentisca.
//
// ⚠️ L'ESTRATTO DEVE ESISTERE, altrimenti il controllo è VACUO: una fetta
// vuota non contiene `field_type` e il test passerebbe senza aver guardato
// (misurato con la controprova del 2026-08-29: grant manomesso, verde finto).
// La fetta è il singolo statement, dal `grant` al suo `;`.
const statementDa = (ancora: string, daIdx?: number): string => {
  const i = daIdx ?? M47.indexOf(ancora);
  return i < 0 ? '' : M47.slice(i, M47.indexOf(';', i));
};
const grantDefUpd = statementDa('grant update (');
check('update delle definizioni: concessi solo nome, opzioni, obbligatorietà, posizione, archiviazione',
  grantDefUpd.includes('on public.crm_field_definitions')
  && !grantDefUpd.includes('entity') && !grantDefUpd.includes('field_type') && !grantDefUpd.includes('company_id'),
  grantDefUpd);
const grantDefIns = statementDa('grant insert (');
check('insert delle definizioni: archived_at non si concede (un campo nasce attivo)',
  grantDefIns.includes('on public.crm_field_definitions') && !grantDefIns.includes('archived_at'),
  grantDefIns);
const grantValUpd = statementDa('grant update (value_');
check('update dei valori: solo le tre colonne del valore',
  grantValUpd.includes('on public.crm_field_values')
  && !grantValUpd.includes('field_id') && !grantValUpd.includes('organization_id')
  && !grantValUpd.includes('opportunity_id') && !grantValUpd.includes('company_id'), grantValUpd);

// Nessuna policy di DELETE sulle definizioni: si archiviano, non si cancellano.
const policyDefs = [...M47.matchAll(/create policy \w+ on public\.crm_field_definitions\s+for (\w+)/g)]
  .map((m) => m[1]!).sort();
check('le definizioni non hanno una policy di delete (si archiviano)',
  JSON.stringify(policyDefs) === JSON.stringify(['insert', 'select', 'update']),
  `trovate: ${policyDefs.join(', ')}`);

// Il tetto delle opzioni è scritto due volte: nel guardiano SQL e nella
// costante TS che la schermata usa per spiegarlo.
check('il tetto delle opzioni è lo stesso nel guardiano e nel TS',
  M47.includes(`v_len > ${CRM_FIELD_OPTIONS_MAX}`), `TS: ${CRM_FIELD_OPTIONS_MAX}`);

// La fusione impara i campi personalizzati: la sezione 7 della 0047 riscrive
// `crm_merge_organizations` perché trasferisca anche i valori.
check('la fusione trasferisce anche i valori dei campi personalizzati',
  M47.includes('crm_merge_organizations') && M47.includes('crm_field_values')
  && M47.indexOf('crm_field_values') < M47.indexOf('-- 8. RLS'));

// ⚠️ OGNI SENTINELLA DEVE AVERE UN MESSAGGIO. Un `crm_field_…` non mappato
// arriverebbe a schermo come stringa tecnica, in italiano, dentro
// un'interfaccia tedesca — la trappola che `crmErrorMessage` esiste per
// chiudere. Quelli che finiscono in `_company_mismatch` li copre la regola
// generale: per chi legge la causa è la stessa.
const SERVICE_SRC = readFileSync(join(HERE, '..', 'src', 'services', 'crmService.ts'), 'utf8');
// Il guardiano solleva i sentinelle in due modi: `raise exception 'nome'`
// diretto, e `raise exception '%', v_problem` dove il nome lo decide la
// funzione pura (`return 'nome'`). Si raccolgono entrambe le forme.
const sentinelleDirette = [...M47.matchAll(/raise exception '(crm_field_\w+)'/g)].map((m) => m[1]!);
const sentinellePure = [...M47.matchAll(/return '(crm_field_\w+)'/g)].map((m) => m[1]!);
const tutte = [...new Set([...sentinelleDirette, ...sentinellePure])].sort();
const scoperte = tutte.filter((s) =>
  !SERVICE_SRC.includes(s) && !s.endsWith('_company_mismatch'));
check('ogni sentinella della 0047 ha un messaggio in crmErrorMessage',
  scoperte.length === 0, `senza messaggio: ${scoperte.join(', ') || '—'}`);

// ---------------------------------------------------------------------------
section('19. crmFields — le regole pure della schermata');

// Le stesse regole del guardiano, dalla parte di chi scrive: la schermata
// SPIEGA, il database RIFIUTA, e le due risposte devono coincidere.
const defTesto: Pick<CrmFieldDefinition, 'fieldType' | 'options'> = { fieldType: 'text', options: [] };
const defNumero: Pick<CrmFieldDefinition, 'fieldType' | 'options'> = { fieldType: 'number', options: [] };
const defData: Pick<CrmFieldDefinition, 'fieldType' | 'options'> = { fieldType: 'date', options: [] };
const defLista: Pick<CrmFieldDefinition, 'fieldType' | 'options'> = { fieldType: 'select', options: ['Piccola', 'Media', 'Grande'] };

check('testo: si misura dopo il trim, e il vuoto è «nessun valore»',
  JSON.stringify(parseFieldValue(defTesto, '  Rossi  ')) === JSON.stringify({ kind: 'ok', value: 'Rossi' })
  && parseFieldValue(defTesto, '').kind === 'empty'
  && parseFieldValue(defTesto, '   ').kind === 'empty');
check('numero: la virgola decimale è un numero, in tutte e tre le lingue',
  JSON.stringify(parseFieldValue(defNumero, '12,5')) === JSON.stringify({ kind: 'ok', value: 12.5 })
  && JSON.stringify(parseFieldValue(defNumero, '18000')) === JSON.stringify({ kind: 'ok', value: 18000 }));
check('numero: lettere e doppi punti non sono un numero',
  JSON.stringify(parseFieldValue(defNumero, 'abc')) === JSON.stringify({ kind: 'error', code: 'number' })
  && JSON.stringify(parseFieldValue(defNumero, '12.5.6')) === JSON.stringify({ kind: 'error', code: 'number' })
  && parseFieldValue(defNumero, '').kind === 'empty');
check('data: solo la data pura, e solo se esiste nel calendario',
  JSON.stringify(parseFieldValue(defData, '2026-08-29')) === JSON.stringify({ kind: 'ok', value: '2026-08-29' })
  && JSON.stringify(parseFieldValue(defData, '2026-02-30')) === JSON.stringify({ kind: 'error', code: 'date' })
  && JSON.stringify(parseFieldValue(defData, '29.08.2026')) === JSON.stringify({ kind: 'error', code: 'date' })
  && parseFieldValue(defData, '').kind === 'empty');
check('lista: solo ciò che elenca, come il guardiano — «media» non è «Media»',
  JSON.stringify(parseFieldValue(defLista, 'Media')) === JSON.stringify({ kind: 'ok', value: 'Media' })
  && JSON.stringify(parseFieldValue(defLista, 'media')) === JSON.stringify({ kind: 'error', code: 'option' })
  && JSON.stringify(parseFieldValue(defLista, 'Enorme')) === JSON.stringify({ kind: 'error', code: 'option' })
  && parseFieldValue(defLista, '').kind === 'empty');

check('opzioni: le righe vuote si ignorano, il resto si misura',
  JSON.stringify(parseFieldOptions('\nPiccola\n\nMedia\n')) === JSON.stringify({ kind: 'ok', options: ['Piccola', 'Media'] })
  && parseFieldOptions('   \n  ').kind === 'empty');
check('opzioni: il doppione è un ERRORE, non qualcosa da togliere in silenzio',
  JSON.stringify(parseFieldOptions('Piccola\nPiccola')) === JSON.stringify({ kind: 'duplicate', value: 'Piccola' }));
check('opzioni: il trim pareggia prima di misurare — « Verde » e «Verde» sono un doppione',
  parseFieldOptions('Verde\n Verde ').kind === 'duplicate');
check('opzioni: oltre il tetto del guardiano si ferma la schermata, non il database',
  parseFieldOptions(Array.from({ length: CRM_FIELD_OPTIONS_MAX + 1 }, (_, i) => `Voce ${i}`).join('\n')).kind === 'tooMany'
  && parseFieldOptions(Array.from({ length: CRM_FIELD_OPTIONS_MAX }, (_, i) => `Voce ${i}`).join('\n')).kind === 'ok');

check('valueColumns: esattamente una colonna piena, quella del tipo',
  JSON.stringify(valueColumns(defTesto, 'x')) === JSON.stringify({ value_text: 'x', value_number: null, value_date: null })
  && JSON.stringify(valueColumns(defNumero, 12.5)) === JSON.stringify({ value_text: null, value_number: 12.5, value_date: null })
  && JSON.stringify(valueColumns(defData, '2026-08-29')) === JSON.stringify({ value_text: null, value_number: null, value_date: '2026-08-29' }));

// La formattazione segue la lingua: il banco gira con il default italiano
// (it-CH). L'oracolo è il raggruppamento SEMPRE acceso — il difetto misurato
// in `formatCurrency` era il separatore che compariva solo da cinque cifre —
// non il GLIFO del separatore, che è affare del runtime (U+2019 in CLDR,
// apostrofo ASCII nel Node di oggi).
const RAGGRUPPATO = new Intl.NumberFormat('it-CH', { useGrouping: true, maximumFractionDigits: 20 });
check('il numero si mostra raggruppato SEMPRE, anche sotto le cinque cifre',
  formatFieldValue(defNumero, 18000) === RAGGRUPPATO.format(18000)
  && formatFieldValue(defNumero, 18000) !== '18000',
  `trovato: «${formatFieldValue(defNumero, 18000)}»`);
check('la data pura si mostra come giorno, nella lingua dell’interfaccia',
  formatFieldValue(defData, '2026-08-29') === '29.08.2026',
  `trovato: «${formatFieldValue(defData, '2026-08-29')}»`);
check('testo e lista si mostrano come sono, e l’assenza è «—»',
  formatFieldValue(defTesto, 'Rossi') === 'Rossi'
  && formatFieldValue(defLista, 'Media') === 'Media'
  && formatFieldValue(defTesto, null) === '—'
  && formatFieldValue(defNumero, null) === '—');

const defAt = (position: number, createdAt: string, id: string): CrmFieldDefinition => ({
  id, companyId: 'a', entity: 'organization', name: id, fieldType: 'text',
  options: [], isRequired: false, position, archivedAt: null, createdAt, updatedAt: createdAt,
});
check('l’ordine è position, e a parità createdAt e id: stabile, mai un terno al lotto',
  JSON.stringify(sortFieldDefinitions([
    defAt(1, '2026-08-29T10:00:00Z', 'b'), defAt(0, '2026-08-29T10:00:00Z', 'z'),
    defAt(0, '2026-08-29T09:00:00Z', 'y'), defAt(0, '2026-08-29T09:00:00Z', 'x'),
  ]).map((d) => d.id)) === JSON.stringify(['x', 'y', 'z', 'b']));
check('il prossimo campo nasce in fondo agli altri',
  nextFieldPosition([]) === 0
  && nextFieldPosition([defAt(3, 't', 'a'), defAt(1, 't', 'b')]) === 4);

// ---------------------------------------------------------------------------
section('20. Sequenze di follow-up (0050) — dati, stop e nessun invio');

const followUpTables = ['crm_follow_up_sequences', 'crm_follow_up_steps', 'crm_follow_up_emissions'];
check('la configurazione è in tabelle, non in condizioni scritte nel codice',
  followUpTables.every((table) => FOLLOW_UP_MIGRATION.includes(`create table if not exists public.${table}`)));
check('revoke all precede ogni grant sulle tre tabelle della 0050',
  followUpTables.every((table) => {
    const revoke = FOLLOW_UP_MIGRATION.indexOf(`revoke all on public.${table}`);
    const grant = FOLLOW_UP_MIGRATION.indexOf(`grant select on public.${table}`);
    return revoke >= 0 && (grant < 0 || revoke < grant);
  }));
check('la stessa regola non può emettere due volte per trattativa nello stesso giorno',
  FOLLOW_UP_MIGRATION.includes('unique (sequence_id, step_id, opportunity_id, emitted_on)'));
check('un secondo giro dello stesso ciclo è fermato anche indipendentemente dal giorno',
  FOLLOW_UP_MIGRATION.includes('unique (sequence_id, step_id, opportunity_id, outbound_email_id)'));
check('la misura del silenzio cerca una email in successiva alla email out',
  FOLLOW_UP_MIGRATION.includes("incoming.direction = 'in'")
  && FOLLOW_UP_MIGRATION.includes("e.direction = 'out'"));
check('una interazione successiva ferma la sequenza',
  FOLLOW_UP_MIGRATION.includes('from public.crm_interactions i')
  && FOLLOW_UP_MIGRATION.includes('i.occurred_at >')
  && FOLLOW_UP_MIGRATION.includes('(i.opportunity_id = o.id or i.opportunity_id is null)'));
check('una risposta è confrontata con tutti i destinatari della email uscente',
  FOLLOW_UP_MIGRATION.includes('recipient.email_message_id = outmail.email_id')
  && FOLLOW_UP_MIGRATION.includes('ice.contact_id = method.contact_id'));
check('won, lost, archiviata e cambio fase non producono lavoro',
  FOLLOW_UP_MIGRATION.includes("o.stage not in ('won', 'lost')")
  && FOLLOW_UP_MIGRATION.includes('o.archived_at is null')
  && FOLLOW_UP_MIGRATION.includes("ev.kind = 'opportunity_stage_changed'"));
const managedActions = FOLLOW_UP_MIGRATION.slice(
  FOLLOW_UP_MIGRATION.indexOf("'[{\"key\":\"create_task\""),
  FOLLOW_UP_MIGRATION.indexOf("'[{\"key\":\"create_task\"") + 600,
);
check('il workflow gestito usa solo attività e notifica: nessuna azione di contatto',
  managedActions.includes('create_task') && managedActions.includes('create_notification')
  && !managedActions.includes('send_email') && !managedActions.includes('reply_email'));
check('il template email è un suggerimento e non un comando di invio',
  FOLLOW_UP_MIGRATION.includes('Suggerimento per il composer umano'));

// ---------------------------------------------------------------------------
console.log(`\n${B}Risultato${X}: ${G}${pass} superati${X}${fail ? `, ${R}${fail} falliti${X}` : ''}`);
process.exit(fail ? 1 : 0);
