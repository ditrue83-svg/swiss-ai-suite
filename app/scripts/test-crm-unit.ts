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
  CRM_VIEWS, CRM_SORTS, PIPELINE_STAGES, ALL_STAGES, DEFAULT_STALE_DAYS,
  filtersFromParams, paramsFromFilters, effectiveRole, hasActiveFilters,
  organizationState, opportunityState, pipelineByCurrency, countByStage,
  daysSince, daysUntil, secondaryName, compareTimeline, isOpen,
  EMPTY_FILTERS, type CrmFilters,
} from '../src/features/crm/crmModel.ts';
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
check('sei inneschi CRM nel registro', crmEvents.length === 6, crmEvents.join(', '));
check('ogni innesco CRM del registro è aggiunto anche dalla migrazione',
  crmEvents.every((e) => addedEnumValues.includes(e)),
  crmEvents.filter((e) => !addedEnumValues.includes(e)).join(', '));
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
check('domani resta domani anche alle 23:30', daysUntil('2026-07-31', TARDI) === 1);
check('oggi è zero anche alle 23:30', daysUntil('2026-07-30', TARDI) === 0);
check('ieri è negativo', daysUntil('2026-07-29', TARDI) === -1);
check('senza data non c’è un numero di giorni', daysUntil(null) === null);
check('una data non valida non produce un numero', daysUntil('non-una-data') === null);
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
console.log(`\n${B}Risultato${X}: ${G}${pass} superati${X}${fail ? `, ${R}${fail} falliti${X}` : ''}`);
process.exit(fail ? 1 : 0);
