// ============================================================================
// La logica PURA del CRM: viste, filtri, stato di una riga, etichette.
//
// Sta qui e non nei componenti perché ciò che si può sbagliare in silenzio —
// dire «nessun contatto da 40 giorni» su un'organizzazione mai contattata,
// mostrare un totale di pipeline che somma franchi ed euro — deve poter essere
// provato offline, senza rete e senza database.
//
// ⚠️ NESSUNA FUNZIONE DI QUESTO FILE CONTA NIENTE. I conteggi li fa il database
// (`list_crm_organizations`, `crm_home_summary`, `crm_pipeline_summary`) e
// arrivano già fatti: qui si decide solo come MOSTRARLI e quando dichiarare che
// un dato non c'è.
// ============================================================================
import type { TKey } from '@/i18n';
import type {
  CrmOrganizationRole, CrmOpportunityStage, CrmInteractionType,
  CrmMatchReason, CrmSource, CrmRelationshipStatus,
} from '@/types/database';
import type { CrmOrganization, CrmOpportunity, CrmPipelineCell } from '@/types/models';
// ⚠️ La MEDESIMA funzione che l'Inbox usa sui link di una email, non una seconda
// scritta qui: lo schema di un URL si LEGGE con un parser, non si cerca con un
// pattern — `java\tscript:` inganna un pattern, non `new URL()`. Due guardie
// diverse sullo stesso pericolo divergono, e quella meno usata resta indietro.
import { safeHttpUrl } from '../../../supabase/functions/_shared/email/html.ts';

/**
 * Le sigle dei ventisei cantoni, più il Liechtenstein — che non è un cantone ma
 * è la controparte estera più frequente per un'impresa della Svizzera orientale.
 *
 * ⚠️ NON È l'elenco a sei valori di `programs.ts`: quello è il perimetro del
 * catalogo incentivi, e un cliente di Lucerna registrato come «Altro» sarebbe un
 * dato perso. Qui servono le sigle vere, perché il database ha
 * `check (length(canton) = 2)` e un campo di testo libero può violarlo: un
 * `23514` che `toUserMessage` non mappa arriverebbe a schermo come stringa
 * tecnica. Un elenco rende quel valore impossibile.
 */
export const SWISS_CANTONS: readonly string[] = [
  'AG', 'AI', 'AR', 'BE', 'BL', 'BS', 'FR', 'GE', 'GL', 'GR', 'JU', 'LU',
  'NE', 'NW', 'OW', 'SG', 'SH', 'SO', 'SZ', 'TG', 'TI', 'UR', 'VD', 'VS',
  'ZG', 'ZH', 'LI',
];

/**
 * Il sito web di una controparte, ma solo se è davvero un sito.
 *
 * ⚠️⚠️ UN CAMPO DI TESTO CHE FINISCE IN UN `href` NON È TESTO: È CODICE. Il
 * campo «Sito web» era libero e il servizio faceva solo `.trim()`; la scheda
 * cliente scriveva `<a href={o.website}>`. Un `javascript:…` salvato lì dentro
 * — da chi ha accesso al CRM, o da un'importazione — eseguiva codice nella
 * sessione di CHIUNQUE cliccasse quel link, con il suo token e la sua azienda.
 * Il campo era così dal 15.08.
 *
 * Ritorna il valore da mostrare o da scrivere, oppure `null` se non passa:
 * `javascript:`, `data:`, `vbscript:`, `file:` e un `//evil.com` senza schema
 * non passano. Chi chiama decide che cosa farne — la scheda mostra il testo
 * senza collegamento, il servizio rifiuta il salvataggio — ma nessuno dei due
 * decide DA SÉ che cosa è sicuro.
 */
export function safeWebsite(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  return safeHttpUrl(value) ? value : null;
}

export const CRM_PAGE_SIZE = 25;
export const CRM_TIMELINE_PAGE_SIZE = 30;
export const MAX_QUERY_LENGTH = 120;

/**
 * §69 — la soglia di inattività PREDEFINITA, e il fatto che sia predefinita è
 * il punto: trenta giorni non sono una verità, sono un'ipotesi ragionevole che
 * l'utente può cambiare dal filtro. Il database non la conosce: la riceve come
 * parametro.
 */
export const DEFAULT_STALE_DAYS = 30;

/**
 * §52 — quattro viste e non una di più. «Clienti» e «Prospect» sono i due
 * insiemi che una PMI guarda davvero; «Pipeline» è la stessa realtà per fase;
 * «Tutti» esiste perché fornitori, enti ed ex clienti devono restare
 * raggiungibili.
 *
 * ⚠️ §55 — la pipeline NON è la vista principale: un cliente attivo senza
 * trattative aperte è la maggioranza dei clienti di una PMI, e in una board a
 * colonne non comparirebbe da nessuna parte.
 */
export const CRM_VIEWS = ['customers', 'prospects', 'pipeline', 'all'] as const;
export type CrmView = (typeof CRM_VIEWS)[number];

export const CRM_SORTS = ['updated', 'name', 'last_contact', 'created'] as const;
export type CrmSort = (typeof CRM_SORTS)[number];

/** I ruoli che ogni vista comprende. `all` non filtra. */
const VIEW_ROLES: Record<CrmView, CrmOrganizationRole | null> = {
  customers: 'customer',
  prospects: 'prospect',
  pipeline: null,
  all: null,
};

export interface CrmFilters {
  view: CrmView;
  query: string | null;
  role: CrmOrganizationRole | null;
  owner: string | null;
  status: CrmRelationshipStatus | null;
  stage: CrmOpportunityStage | null;
  /** `null` = non filtrare per inattività. Un numero = «non contattati da almeno N giorni». */
  staleDays: number | null;
  onlyOverdueTasks: boolean;
  noOpenOpportunity: boolean;
  archived: boolean;
  sort: CrmSort;
  offset: number;
}

export const EMPTY_FILTERS: CrmFilters = {
  view: 'all', query: null, role: null, owner: null, status: null, stage: null,
  staleDays: null, onlyOverdueTasks: false, noOpenOpportunity: false,
  archived: false, sort: 'updated', offset: 0,
};

/**
 * I nomi dei parametri sono in ITALIANO, come in Documenti, Finanze e
 * Contratti. Mescolare le lingue fra moduli renderebbe i collegamenti che le
 * persone si scambiano incoerenti da modulo a modulo.
 */
export function filtersFromParams(params: URLSearchParams): CrmFilters {
  const view = params.get('vista');
  const sort = params.get('ordina');
  const stale = params.get('inattivi');
  const staleDays = stale === null ? null : Number(stale);
  return {
    view: CRM_VIEWS.includes(view as CrmView) ? (view as CrmView) : 'all',
    query: params.get('q')?.slice(0, MAX_QUERY_LENGTH) || null,
    role: (params.get('ruolo') as CrmOrganizationRole | null) || null,
    owner: params.get('responsabile') || null,
    status: (params.get('stato') as CrmRelationshipStatus | null) || null,
    stage: (params.get('fase') as CrmOpportunityStage | null) || null,
    // Un valore non numerico o non positivo NON diventa la soglia predefinita:
    // diventa «nessun filtro». Interpretare `?inattivi=pippo` come «trenta
    // giorni» mostrerebbe un elenco filtrato senza che nulla lo dichiari.
    staleDays: Number.isFinite(staleDays) && staleDays !== null && staleDays > 0 ? staleDays : null,
    onlyOverdueTasks: params.get('scadute') === '1',
    noOpenOpportunity: params.get('senzaOpportunita') === '1',
    archived: params.get('archiviati') === '1',
    sort: CRM_SORTS.includes(sort as CrmSort) ? (sort as CrmSort) : 'updated',
    offset: Number(params.get('da') ?? 0) || 0,
  };
}

export function paramsFromFilters(f: CrmFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.view !== 'all') p.set('vista', f.view);
  if (f.query) p.set('q', f.query);
  if (f.role) p.set('ruolo', f.role);
  if (f.owner) p.set('responsabile', f.owner);
  if (f.status) p.set('stato', f.status);
  if (f.stage) p.set('fase', f.stage);
  if (f.staleDays !== null) p.set('inattivi', String(f.staleDays));
  if (f.onlyOverdueTasks) p.set('scadute', '1');
  if (f.noOpenOpportunity) p.set('senzaOpportunita', '1');
  if (f.archived) p.set('archiviati', '1');
  if (f.sort !== 'updated') p.set('ordina', f.sort);
  if (f.offset > 0) p.set('da', String(f.offset));
  return p;
}

/**
 * Il ruolo che la vista impone, che NON sostituisce il filtro esplicito: se
 * qualcuno è nella vista «Clienti» e sceglie «Fornitori» dal filtro, vince il
 * filtro — altrimenti la schermata mostrerebbe un elenco che contraddice il
 * controllo che l'utente ha appena usato.
 */
export function effectiveRole(f: CrmFilters): CrmOrganizationRole | null {
  return f.role ?? VIEW_ROLES[f.view];
}

export function hasActiveFilters(f: CrmFilters): boolean {
  return Boolean(
    f.query || f.role || f.owner || f.status || f.stage
    || f.staleDays !== null || f.onlyOverdueTasks || f.noOpenOpportunity || f.archived,
  );
}

// ---------------------------------------------------------------------------
// Lo stato di una riga
// ---------------------------------------------------------------------------

/**
 * Lo stato che la riga mostra. UNO SOLO, il più importante: una riga con
 * quattro pastiglie non si legge.
 *
 * ⚠️ L'ORDINE È LA PRIORITÀ, e non è arbitrario. Prima ciò che è già in ritardo
 * (un'attività scaduta è un impegno mancato, non un promemoria), poi ciò che
 * richiede una decisione senza scadenza, poi lo stato normale.
 *
 * ⚠️ `never_contacted` viene PRIMA di `stale`, e non dopo: un'organizzazione
 * che nessuno ha mai contattato non è «un po' più trascurata» di una contattata
 * sei mesi fa — è il caso in cui non è mai cominciato niente.
 */
export type CrmOrganizationState =
  | 'archived' | 'merged' | 'overdue_tasks' | 'never_contacted' | 'stale'
  | 'active_deal' | 'inactive' | 'ok';

export function organizationState(
  o: Pick<CrmOrganization, 'archivedAt' | 'mergedIntoId' | 'overdueTaskCount'
    | 'lastContactAt' | 'openOpportunityCount' | 'relationshipStatus' | 'roles'>,
  staleDays: number = DEFAULT_STALE_DAYS,
  today: Date = new Date(),
): CrmOrganizationState {
  if (o.mergedIntoId) return 'merged';
  if (o.archivedAt) return 'archived';
  if (o.overdueTaskCount > 0) return 'overdue_tasks';
  if (o.relationshipStatus === 'inactive') return 'inactive';

  // §69 — l'inattività si misura SOLO su chi dovrebbe essere sentito. Un ente
  // pubblico che non scrive da sei mesi non è una relazione trascurata: è un
  // ente pubblico. Applicare la soglia a tutti riempirebbe la pagina iniziale
  // di allarmi che nessuno può risolvere.
  const commercial = o.roles.some((r) => r === 'customer' || r === 'prospect' || r === 'lead');
  if (commercial) {
    if (o.lastContactAt === null) return 'never_contacted';
    if (daysSince(o.lastContactAt, today) > staleDays) return 'stale';
  }

  if (o.openOpportunityCount > 0) return 'active_deal';
  return 'ok';
}

export function organizationStateKey(state: CrmOrganizationState): TKey {
  switch (state) {
    case 'archived': return 'crm.states.archived';
    case 'merged': return 'crm.states.merged';
    case 'overdue_tasks': return 'crm.states.overdueTasks';
    case 'never_contacted': return 'crm.states.neverContacted';
    case 'stale': return 'crm.states.stale';
    case 'active_deal': return 'crm.states.activeDeal';
    case 'inactive': return 'crm.states.inactive';
    case 'ok': return 'crm.states.ok';
  }
}

/**
 * Giorni di CALENDARIO da una data, non millisecondi diviso 86'400'000 su
 * orari: alle 23:30 «ieri» non deve diventare «oggi». È lo stesso calcolo di
 * `daysUntil` nei Contratti, con il segno rovesciato.
 */
export function daysSince(iso: string | null | undefined, today: Date = new Date()): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const target = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return Number.POSITIVE_INFINITY;
  const start = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export function daysUntil(iso: string | null | undefined, today: Date = new Date()): number | null {
  if (!iso) return null;
  const target = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Le opportunità
// ---------------------------------------------------------------------------

/** §41 — le cinque colonne della board. `lost` non è una colonna: è un esito. */
export const PIPELINE_STAGES: readonly CrmOpportunityStage[] = [
  'lead', 'contacted', 'proposal', 'negotiation', 'won',
];

export const ALL_STAGES: readonly CrmOpportunityStage[] = [
  'lead', 'contacted', 'proposal', 'negotiation', 'won', 'lost',
];

export function isOpen(stage: CrmOpportunityStage): boolean {
  return stage !== 'won' && stage !== 'lost';
}

export type CrmOpportunityState = 'archived' | 'won' | 'lost' | 'overdue_step' | 'no_step' | 'open';

/**
 * ⚠️ `no_step` è uno STATO e non un dettaglio: §99 — una trattativa aperta che
 * nessuno sa come proseguire è ferma, anche se sembra viva. Senza questo stato
 * la pipeline mostrerebbe venti caselle tutte uguali e nessuno saprebbe da
 * quale cominciare.
 */
export function opportunityState(
  o: Pick<CrmOpportunity, 'archivedAt' | 'stage' | 'nextStep' | 'nextStepDueDate'>,
  today: Date = new Date(),
): CrmOpportunityState {
  if (o.archivedAt) return 'archived';
  if (o.stage === 'won') return 'won';
  if (o.stage === 'lost') return 'lost';
  const days = daysUntil(o.nextStepDueDate, today);
  if (days !== null && days < 0) return 'overdue_step';
  if (!o.nextStep || o.nextStep.trim() === '') return 'no_step';
  return 'open';
}

export function opportunityStateKey(state: CrmOpportunityState): TKey {
  switch (state) {
    case 'archived': return 'crm.opp.states.archived';
    case 'won': return 'crm.opp.states.won';
    case 'lost': return 'crm.opp.states.lost';
    case 'overdue_step': return 'crm.opp.states.overdueStep';
    case 'no_step': return 'crm.opp.states.noStep';
    case 'open': return 'crm.opp.states.open';
  }
}

/**
 * §45 — RAGGRUPPA IL VALORE PER VALUTA, e non esiste un totale unico.
 *
 * ⚠️ La somma la fa il DATABASE (`crm_pipeline_summary`, in `numeric`). Questa
 * funzione riorganizza righe già sommate: se sommasse qui, lo farebbe in
 * virgola mobile e su denaro — che è esattamente ciò che il §186 vieta.
 *
 * Le opportunità senza valore NON diventano zero: `currency: null` è una riga a
 * sé che porta solo un conteggio. Contarle come CHF 0 farebbe sembrare più
 * povera una pipeline che semplicemente non è stata stimata.
 */
export function pipelineByCurrency(cells: readonly CrmPipelineCell[]): Array<{
  currency: string | null;
  opportunityCount: number;
  totalAmount: number | null;
}> {
  const byCurrency = new Map<string | null, { count: number; total: number | null }>();
  for (const c of cells) {
    if (!isOpen(c.stage)) continue;   // il valore di pipeline è quello APERTO
    const prev = byCurrency.get(c.currency) ?? { count: 0, total: null };
    const total = c.totalAmount === null
      ? prev.total
      : (prev.total ?? 0) + c.totalAmount;
    byCurrency.set(c.currency, { count: prev.count + c.opportunityCount, total });
  }
  return [...byCurrency.entries()]
    .map(([currency, v]) => ({ currency, opportunityCount: v.count, totalAmount: v.total }))
    // Le valute in ordine alfabetico, e quella ignota per ultima: un elenco
    // stabile fra due caricamenti, altrimenti le righe si scambiano di posto.
    .sort((a, b) => (a.currency ?? '￿').localeCompare(b.currency ?? '￿'));
}

export function countByStage(
  cells: readonly CrmPipelineCell[],
): Record<CrmOpportunityStage, number> {
  const out = {
    lead: 0, contacted: 0, proposal: 0, negotiation: 0, won: 0, lost: 0,
  } as Record<CrmOpportunityStage, number>;
  for (const c of cells) out[c.stage] += c.opportunityCount;
  return out;
}

// ---------------------------------------------------------------------------
// Etichette
// ---------------------------------------------------------------------------

/**
 * ⚠️ Nessuna di queste funzioni restituisce TESTO: restituiscono chiavi. Una
 * costante di modulo che contenesse `tr('…')` congelerebbe la lingua della
 * prima sessione — è un guasto realmente accaduto in questo progetto con
 * `STATUS_STEP`, e i passaggi di avanzamento restavano in italiano per tutta la
 * sessione anche in tedesco.
 */
export function roleLabelPath(role: CrmOrganizationRole): string {
  return `labels.crmRoles.${role}`;
}
export function stageLabelPath(stage: CrmOpportunityStage): string {
  return `labels.crmStages.${stage}`;
}
export function interactionLabelPath(type: CrmInteractionType): string {
  return `labels.crmInteractions.${type}`;
}
export function reasonLabelPath(reason: CrmMatchReason): string {
  return `labels.crmReasons.${reason}`;
}
export function sourceLabelPath(source: CrmSource): string {
  return `labels.crmSources.${source}`;
}

/**
 * Il nome da mostrare quando ragione sociale e nome d'uso differiscono.
 *
 * ⚠️ Restituisce `null` per il secondo nome quando coincidono: mostrare
 * «Rossi SA · Rossi SA» è il difetto che il Document Hub ha già pagato con
 * «Assicurazioni sociali · Assicurazioni sociali», visto solo aprendo la
 * schermata in tedesco dopo aver corretto la prima occorrenza.
 */
export function secondaryName(o: Pick<CrmOrganization, 'displayName' | 'legalName'>): string | null {
  const legal = (o.legalName ?? '').trim();
  if (legal === '') return null;
  if (legal.toLowerCase() === o.displayName.trim().toLowerCase()) return null;
  return legal;
}

/**
 * §60 — l'ordine della timeline: dal più recente. La seconda chiave è l'id,
 * perché due righe con lo stesso istante devono avere un ordine STABILE fra due
 * pagine: senza, qualcosa scompare fra la pagina 1 e la pagina 2.
 */
export function compareTimeline(
  a: { occurredAt: string; id: string },
  b: { occurredAt: string; id: string },
): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}
