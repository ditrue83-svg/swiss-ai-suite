// ============================================================================
// Persistenza del motore delle automazioni. Tutto ciò che tocca il database.
//
// Gira SEMPRE con service role, perché scrive tabelle che il client non può
// scrivere. Il bypass della RLS è legittimo solo se l'autorizzazione è avvenuta
// a monte, e per non dipendere dalla memoria di chi scriverà il prossimo
// chiamante ogni query qui filtra ESPLICITAMENTE per azienda: la RLS non è un
// secondo controllo disponibile, qui non c'è (§112).
//
// ⚠️ IL CONTROLLO DI APPARTENENZA È RIPETUTO A OGNI LETTURA DI ENTITÀ.
// `loadFacts` non si limita a leggere il documento indicato dall'evento:
// verifica che quel documento sia DELL'AZIENDA dell'evento. Un payload
// manomesso non basterebbe a farlo — la coda non è scrivibile da nessuno — ma
// la disciplina di questo progetto è che una funzione che scavalca la RLS si
// difenda da sola (§113/§116).
// ============================================================================
import {
  aiFact, emailDomain, known, missing, optional, urgencyFrom,
  type Facts,
} from './facts.ts';
import type { AutomationEntityType, AutomationEventType, WorkflowAction } from './registry.ts';
import type { ConditionResult } from './conditions.ts';

/** Forma minima del client Supabase usata qui. Identica in Deno e Node. */
export interface ServerClient {
  from: (table: string) => any;
  // ⚠️ `PromiseLike`, NON `Promise`: `sb.rpc(…)` torna un `PostgrestFilterBuilder`,
  // che ha `then` e NON ha `catch` né `finally`. Dichiararlo `Promise` rendeva il
  // client vero non assegnabile a questa interfaccia, e ha coperto un `.catch()`
  // che a runtime sollevava. Vedi `persist.ts` → `SupabaseWithRpc`.
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

// ---------------------------------------------------------------------------
// La coda
// ---------------------------------------------------------------------------

export interface ClaimedEvent {
  id: string;
  company_id: string;
  event_type: AutomationEventType;
  entity_type: AutomationEntityType;
  entity_id: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  origin: 'system' | 'automation';
  correlation_id: string;
  root_event_id: string | null;
  chain_depth: number;
  attempts: number;
  lock_id: string;
}

export async function claimEvents(
  sb: ServerClient, limit: number, lockSeconds: number, perCompany: number,
): Promise<ClaimedEvent[]> {
  const { data, error } = await sb.rpc('automation_events_claim', {
    p_limit: limit, p_lock_seconds: lockSeconds, p_per_company: perCompany,
  });
  if (error) throw new Error(`claim: ${(error as { message?: string }).message ?? 'errore'}`);
  return (data ?? []) as ClaimedEvent[];
}

/**
 * L'evento è stato trattato. Il `lock_id` nella condizione non è pignoleria:
 * senza, un worker che ha perso il lease per scadenza sovrascriverebbe il
 * lavoro di quello che nel frattempo ha preso la riga.
 */
export async function eventDone(sb: ServerClient, id: string, lockId: string): Promise<void> {
  await sb.from('automation_events').update({
    processing_status: 'done', processed_at: new Date().toISOString(),
    locked_until: null, lock_id: null, error_code: null,
  }).eq('id', id).eq('lock_id', lockId);
}

/** Guasto TRANSITORIO: si riprova più tardi, con attesa crescente (§62). */
export async function eventRetry(
  sb: ServerClient, id: string, lockId: string, delaySeconds: number, code: string,
): Promise<void> {
  await sb.from('automation_events').update({
    processing_status: 'pending',
    next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
    locked_until: null, lock_id: null, error_code: code,
  }).eq('id', id).eq('lock_id', lockId);
}

/**
 * Guasto PERMANENTE: riprovare non cambierebbe l'esito. Una configurazione
 * invalida resta invalida, un documento cancellato resta cancellato (§62).
 */
export async function eventFailed(
  sb: ServerClient, id: string, lockId: string, code: string,
): Promise<void> {
  await sb.from('automation_events').update({
    processing_status: 'failed', processed_at: new Date().toISOString(),
    locked_until: null, lock_id: null, error_code: code,
  }).eq('id', id).eq('lock_id', lockId);
}

/** Tetto dei tentativi raggiunto: si smette, e si DICHIARA (§63). */
export async function eventDeadLetter(
  sb: ServerClient, id: string, lockId: string, code: string,
): Promise<void> {
  await sb.from('automation_events').update({
    processing_status: 'dead_letter', processed_at: new Date().toISOString(),
    locked_until: null, lock_id: null, error_code: code,
  }).eq('id', id).eq('lock_id', lockId);
}

// ---------------------------------------------------------------------------
// Le regole
// ---------------------------------------------------------------------------

export interface WorkflowRow {
  id: string;
  name: string;
  version: number;
  trigger_type: AutomationEventType;
  condition_match: 'all' | 'any';
  conditions: unknown;
  actions: unknown;
}

/**
 * Le regole che ascoltano questo evento.
 *
 * Le due garanzie difficili — «attivare non processa il passato» e «una regola
 * gira al più una volta per catena» — stanno DENTRO la funzione SQL, non qui.
 * È deliberato: un filtro scritto nel worker è un filtro che il prossimo
 * chiamante può dimenticare, e questi due non si possono dimenticare.
 */
export async function workflowsForEvent(
  sb: ServerClient, event: ClaimedEvent,
): Promise<WorkflowRow[]> {
  const { data, error } = await sb.rpc('workflows_for_event', {
    p_company_id: event.company_id,
    p_event_type: event.event_type,
    p_occurred_at: event.occurred_at,
    p_correlation_id: event.correlation_id,
  });
  if (error) throw new Error(`workflows: ${(error as { message?: string }).message ?? 'errore'}`);
  return (data ?? []) as WorkflowRow[];
}

// ---------------------------------------------------------------------------
// I fatti
// ---------------------------------------------------------------------------

export interface EntityFacts {
  facts: Facts;
  /** Per collegare l'attività creata al documento o alla comunicazione. */
  documentId: string | null;
  emailMessageId: string | null;
  taskId: string | null;
  /** 0024 — il contratto e la sua data, quando l'innesco ne parla. */
  contractId: string | null;
  contractMilestoneId: string | null;
  /**
   * 0026 — la controparte e la trattativa, quando l'innesco ne parla.
   *
   * ⚠️ SENZA QUESTI DUE CAMPI IL CRM NON COLLEGAVA NIENTE. Un'attività creata
   * da una regola «follow-up scaduto» nasceva senza `crm_organization_id`:
   * compariva nel Work Hub e non compariva sulla scheda del cliente, cioè
   * proprio nel posto in cui il modulo esiste per farla comparire. La casella
   * «collega l'entità» del generatore era spuntata e non faceva nulla — una
   * promessa dell'interfaccia che nessuno manteneva.
   */
  crmOrganizationId: string | null;
  crmOpportunityId: string | null;
  /** Il responsabile dell'attività, quando l'innesco parla di un'attività. */
  assigneeUserId: string | null;
}

/**
 * Costruisce i fatti di un'entità leggendo le tabelle vere.
 *
 * ⚠️ SI RILEGGE, NON SI USA IL PAYLOAD.
 * L'evento porta pochissimo (§13), e ciò che porta è la fotografia del momento
 * in cui è stato emesso. Fra quel momento e adesso possono essere passati
 * minuti: una persona può aver corretto il mittente, cambiato la categoria,
 * completato l'attività. La regola deve decidere su ciò che è VERO ORA, e il
 * payload serve solo per i fatti che ADESSO non esistono più — il valore
 * PRECEDENTE di una categoria, lo stato da cui un'attività è uscita.
 */
export async function loadFacts(
  sb: ServerClient, event: ClaimedEvent, now: Date = new Date(),
): Promise<EntityFacts | null> {
  if (event.entity_type === 'document') return await documentFacts(sb, event, now);
  if (event.entity_type === 'email_message') return await emailFacts(sb, event);
  if (event.entity_type === 'task') return await taskFacts(sb, event);
  if (event.entity_type === 'contract') return await contractFacts(sb, event);
  // 0026 — le due entità del CRM. `crm_organization` e `crm_opportunity` sono
  // separate per la stessa ragione per cui contratto e documento lo sono: una
  // trattativa è UNA fra le tante con la stessa controparte, e agganciare il suo
  // evento all'organizzazione renderebbe impossibile ritrovare quale.
  if (event.entity_type === 'crm_organization') return await crmOrganizationFacts(sb, event);
  if (event.entity_type === 'crm_opportunity') return await crmOpportunityFacts(sb, event);
  // 0032 — le due entità degli incentivi. ⚠️ Senza questi due rami una regola
  // sugli incentivi si sarebbe potuta CREARE dall'interfaccia e non avrebbe
  // valutato niente: `loadFacts` tornava `null` e l'evento veniva scartato in
  // silenzio. Un innesco dichiarato senza fatti è la stessa bugia di un innesco
  // dichiarato senza produttore.
  if (event.entity_type === 'subsidy_opportunity') return await subsidyOpportunityFacts(sb, event);
  if (event.entity_type === 'subsidy_case') return await subsidyCaseFacts(sb, event);
  return null;
}

/**
 * I fatti di un PROGRAMMA, condivisi da opportunità e pratica.
 *
 * ⚠️ NON c'è `relevance_score`, e non è una dimenticanza: il punteggio è
 * interno e serve solo a ordinare. Renderlo confrontabile in una regola lo
 * trasformerebbe nella percentuale che tutto il modulo esiste per non mostrare.
 */
function subsidyProgramFactMap(p: Record<string, unknown> | null): Facts {
  return {
    'program.id': optional(p?.id as string | null),
    'program.name': optional(p?.name as string | null),
    'program.authority': optional(p?.authority as string | null),
    'program.support_type': optional(p?.support_type as string | null),
    'program.availability': optional(
      p?.availability === 'suspended' ? 'suspended' : p ? 'available' : null,
    ),
  };
}

function subsidyProjectFactMap(pr: Record<string, unknown> | null): Facts {
  return {
    'project.title': optional(pr?.title as string | null),
    'project.stage': optional(pr?.stage as string | null),
    'project.canton': optional(pr?.location_canton as string | null),
  };
}

async function subsidyOpportunityFacts(
  sb: ServerClient, event: ClaimedEvent,
): Promise<EntityFacts | null> {
  const { data: opp } = await sb.from('subsidy_opportunities')
    .select('id, company_id, project_id, program_id, kind, relevance_level, eligibility_status, '
      + 'completeness, timing, source_freshness, readiness, open_criteria_count, '
      + 'missing_fact_count, assessment_stale, call_id')
    .eq('id', event.entity_id).eq('company_id', event.company_id).maybeSingle();
  // ⚠️ Un'opportunità che non c'è più NON è un errore: il motore la ricalcola,
  //    e fra l'emissione dell'evento e adesso può essere sparita. Si scarta.
  if (!opp) return null;
  const o = opp as Record<string, unknown>;

  const [{ data: prog }, { data: proj }, { data: call }] = await Promise.all([
    sb.from('subsidy_programs').select('id, name, authority, support_type, availability')
      .eq('id', o.program_id).maybeSingle(),
    o.project_id
      ? sb.from('subsidy_projects').select('title, stage, location_canton')
        .eq('id', o.project_id).eq('company_id', event.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    o.call_id
      ? sb.from('subsidy_calls').select('deadline_on').eq('id', o.call_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    facts: {
      ...subsidyProgramFactMap(prog as Record<string, unknown> | null),
      ...subsidyProjectFactMap(proj as Record<string, unknown> | null),
      'opportunity.kind': known(o.kind as string),
      'opportunity.relevance': known(o.relevance_level as string),
      'opportunity.eligibility': known(o.eligibility_status as string),
      'opportunity.completeness': known(o.completeness as string),
      'opportunity.timing': known(o.timing as string),
      'opportunity.source_freshness': known(o.source_freshness as string),
      'opportunity.readiness': known(o.readiness as string),
      'opportunity.open_criteria': known(Number(o.open_criteria_count ?? 0)),
      'opportunity.missing_facts': known(Number(o.missing_fact_count ?? 0)),
      'opportunity.assessment_stale': known(o.assessment_stale === true),
      // ⚠️ La scadenza è quella della CALL collegata, e manca quando non c'è una
      //    call o quando la fonte non dichiara un termine. `not_exists` è
      //    l'unico modo onesto di dire «non lo sappiamo».
      'call.deadline': optional((call as Record<string, unknown> | null)?.deadline_on as string | null),
    },
    documentId: null,
    emailMessageId: null,
    taskId: null,
    contractId: null,
    contractMilestoneId: null,
    crmOrganizationId: null,
    crmOpportunityId: null,
    // ⚠️ Un'opportunità non ha un responsabile: nessuno l'ha ancora presa in
    //    carico, ed è proprio ciò che la distingue da una pratica. Il
    //    destinatario «assegnatario» non esiste, e fingere che sia qualcuno
    //    manderebbe l'avviso alla persona sbagliata.
    assigneeUserId: null,
  };
}

async function subsidyCaseFacts(
  sb: ServerClient, event: ClaimedEvent,
): Promise<EntityFacts | null> {
  const { data: kase } = await sb.from('subsidy_cases')
    .select('id, company_id, project_id, program_id, status, outcome, owner_user_id, '
      + 'official_deadline, internal_deadline, amount_requested, currency, '
      + 'legacy_snapshot, source_changed_at')
    .eq('id', event.entity_id).eq('company_id', event.company_id).maybeSingle();
  if (!kase) return null;
  const k = kase as Record<string, unknown>;

  const [{ data: prog }, { data: proj }, { data: items }] = await Promise.all([
    sb.from('subsidy_programs').select('id, name, authority, support_type, availability')
      .eq('id', k.program_id).maybeSingle(),
    k.project_id
      ? sb.from('subsidy_projects').select('title, stage, location_canton')
        .eq('id', k.project_id).eq('company_id', event.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    sb.from('subsidy_case_items').select('required, completed').eq('subsidy_case_id', k.id),
  ]);

  const requiredOpen = ((items ?? []) as Record<string, unknown>[])
    .filter((x) => x.required === true && x.completed !== true).length;
  const amount = k.amount_requested === null || k.amount_requested === undefined
    ? null : Number(k.amount_requested);
  const currency = (k.currency as string | null) ?? null;
  // Lo stato PRECEDENTE non esiste più adesso: viene dal payload dell'evento.
  const previous = (event.payload as Record<string, unknown> | null)?.from;

  return {
    facts: {
      ...subsidyProgramFactMap(prog as Record<string, unknown> | null),
      ...subsidyProjectFactMap(proj as Record<string, unknown> | null),
      'case.status': known(k.status as string),
      'case.outcome': known(k.outcome as string),
      'case.official_deadline': optional(k.official_deadline as string | null),
      'case.internal_deadline': optional(k.internal_deadline as string | null),
      // §70 — l'importo porta la sua valuta: `hasCurrency` impedisce di
      // confrontare franchi con euro.
      'case.amount_requested': amount === null ? missing() : known(amount, currency),
      'case.currency': optional(currency),
      'case.required_steps_open': known(requiredOpen),
      'case.legacy_snapshot': known(k.legacy_snapshot === true),
      'case.source_changed': known(k.source_changed_at !== null && k.source_changed_at !== undefined),
      'case.previous_status': typeof previous === 'string' ? known(previous) : missing(),
    },
    documentId: null,
    emailMessageId: null,
    taskId: null,
    contractId: null,
    contractMilestoneId: null,
    crmOrganizationId: null,
    crmOpportunityId: null,
    // La pratica HA un responsabile, e un avviso deve raggiungere lui.
    assigneeUserId: (k.owner_user_id as string | null) ?? null,
  };
}

/**
 * I fatti di un'ORGANIZZAZIONE del CRM (0026).
 *
 * ⚠️⚠️ I RUOLI SONO BOOLEANI, UNO PER RUOLO, e non un elenco. L'operatore
 * `contains` di questo motore confronta SOTTOSTRINGHE (`conditions.ts`): su un
 * elenco unito con le virgole, «il ruolo contiene customer» risponderebbe SÌ
 * anche a `former_customer`, cioè a un ex cliente. Una regola «avvisa per i
 * clienti» sarebbe scattata sui clienti persi e nessuno avrebbe capito perché.
 *
 * ⚠️ `organization.role` — al SINGOLARE — esiste solo quando l'evento è
 * «ruolo aggiunto», e in quel caso il valore sta nel PAYLOAD dell'evento: là è
 * un dato, non una deduzione. Su ogni altro innesco resta `missing()`, cioè
 * `unknown`, cioè la regola NON esegue: la logica a tre valori fa il suo lavoro.
 *
 * ⚠️ OGNI select porta `.eq('company_id', event.company_id)`. Qui la RLS non
 * c'è — questo codice gira con il service role — e dimenticare quel filtro
 * perderebbe l'isolamento fra aziende senza alcun sintomo.
 */
async function crmOrganizationFacts(
  sb: ServerClient, event: ClaimedEvent,
): Promise<EntityFacts | null> {
  const { data: org } = await sb.from('crm_organizations')
    .select('id, company_id, display_name, account_owner_user_id, relationship_status, '
      + 'canton, city, source, last_contact_at')
    .eq('id', event.entity_id).eq('company_id', event.company_id).maybeSingle();
  if (!org) return null;
  const o = org as Record<string, unknown>;

  const { data: roleRows } = await sb.from('crm_organization_roles')
    .select('role').eq('organization_id', o.id).eq('company_id', event.company_id);
  const roles = new Set(((roleRows ?? []) as Record<string, unknown>[]).map((r) => r.role as string));

  const { data: opps } = await sb.from('crm_opportunities')
    .select('id, stage').eq('organization_id', o.id).eq('company_id', event.company_id)
    .is('archived_at', null);
  const openOpportunities = ((opps ?? []) as Record<string, unknown>[])
    .filter((p) => p.stage !== 'won' && p.stage !== 'lost').length;

  const { data: tasks } = await sb.from('tasks')
    .select('id, status').eq('crm_organization_id', o.id).eq('company_id', event.company_id)
    .is('archived_at', null);
  const openTasks = ((tasks ?? []) as Record<string, unknown>[])
    .filter((k) => k.status !== 'completed').length;

  const payloadRole = (event.payload as Record<string, unknown> | null)?.role;

  return {
    facts: {
      ...crmOrganizationFactMap(o, roles, openOpportunities, openTasks),
      'organization.role': typeof payloadRole === 'string' ? known(payloadRole) : missing(),
    },
    documentId: null,
    emailMessageId: null,
    taskId: null,
    contractId: null,
    contractMilestoneId: null,
    // L'innesco parla della CONTROPARTE: l'attività creata le appartiene.
    // Nessuna trattativa, perché qui non ce n'è una — e indovinarne una fra le
    // aperte significherebbe attribuire il lavoro alla trattativa sbagliata.
    crmOrganizationId: o.id as string,
    crmOpportunityId: null,
    // ⚠️ Il destinatario «assegnatario» punta al RESPONSABILE DELLA RELAZIONE:
    // è la persona che una notifica su questa controparte deve raggiungere.
    assigneeUserId: (o.account_owner_user_id as string | null) ?? null,
  };
}

/** I fatti condivisi fra i due inneschi: l'organizzazione compare in entrambi. */
function crmOrganizationFactMap(
  o: Record<string, unknown>,
  roles: Set<string>,
  openOpportunities: number,
  openTasks: number,
): Facts {
  return {
    'organization.name': optional(o.display_name as string | null),
    'organization.owner': optional(o.account_owner_user_id as string | null),
    'organization.status': known(o.relationship_status as string),
    'organization.canton': optional(o.canton as string | null),
    'organization.city': optional(o.city as string | null),
    'organization.source': known(o.source as string),
    // §67 — «mai contattata» è un fatto ASSENTE, non una data lontanissima:
    // `within_days` su un `missing()` dà `unknown` e la regola non esegue, che
    // è il comportamento giusto — una soglia non si applica a ciò che non è
    // mai cominciato.
    'organization.last_contact_at': optional(o.last_contact_at as string | null),
    'organization.role_customer': known(roles.has('customer')),
    'organization.role_prospect': known(roles.has('prospect')),
    'organization.role_supplier': known(roles.has('supplier')),
    'organization.role_partner': known(roles.has('partner')),
    'organization.open_opportunity_count': known(openOpportunities),
    'organization.open_task_count': known(openTasks),
  };
}

/**
 * I fatti di un'OPPORTUNITÀ (0026), che portano con sé quelli della sua
 * organizzazione: una regola su una trattativa vuole poter dire «solo per i
 * clienti» o «solo se non li sentiamo da un mese».
 *
 * ⚠️ `opportunity.previous_stage` viene dal PAYLOAD dell'evento e non dalla
 * riga: la riga ha già la fase NUOVA, e leggerla da lì darebbe due volte lo
 * stesso valore — una regola «da negoziazione a persa» non scatterebbe mai.
 *
 * ⚠️ `opportunity.value_amount` porta la VALUTA (`known(n, currency)`): senza,
 * una condizione «valore maggiore di 10'000» confronterebbe franchi con euro.
 */
async function crmOpportunityFacts(
  sb: ServerClient, event: ClaimedEvent,
): Promise<EntityFacts | null> {
  const { data: opp } = await sb.from('crm_opportunities')
    .select('id, company_id, organization_id, title, stage, owner_user_id, value_amount, '
      + 'value_currency, expected_close_date, next_step, next_step_due_date')
    .eq('id', event.entity_id).eq('company_id', event.company_id).maybeSingle();
  if (!opp) return null;
  const p = opp as Record<string, unknown>;

  const { data: org } = await sb.from('crm_organizations')
    .select('id, company_id, display_name, account_owner_user_id, relationship_status, '
      + 'canton, city, source, last_contact_at')
    .eq('id', p.organization_id).eq('company_id', event.company_id).maybeSingle();
  if (!org) return null;
  const o = org as Record<string, unknown>;

  const { data: roleRows } = await sb.from('crm_organization_roles')
    .select('role').eq('organization_id', o.id).eq('company_id', event.company_id);
  const roles = new Set(((roleRows ?? []) as Record<string, unknown>[]).map((r) => r.role as string));

  const { data: opps } = await sb.from('crm_opportunities')
    .select('id, stage').eq('organization_id', o.id).eq('company_id', event.company_id)
    .is('archived_at', null);
  const openOpportunities = ((opps ?? []) as Record<string, unknown>[])
    .filter((x) => x.stage !== 'won' && x.stage !== 'lost').length;

  const { data: tasks } = await sb.from('tasks')
    .select('id, status').eq('crm_organization_id', o.id).eq('company_id', event.company_id)
    .is('archived_at', null);
  const openTasks = ((tasks ?? []) as Record<string, unknown>[])
    .filter((k) => k.status !== 'completed').length;

  const currency = (p.value_currency as string | null) ?? null;
  const amount = p.value_amount === null || p.value_amount === undefined
    ? null : Number(p.value_amount);
  const previous = (event.payload as Record<string, unknown> | null)?.from;

  return {
    facts: {
      ...crmOrganizationFactMap(o, roles, openOpportunities, openTasks),
      'opportunity.title': optional(p.title as string | null),
      'opportunity.stage': known(p.stage as string),
      'opportunity.owner': optional(p.owner_user_id as string | null),
      'opportunity.value_amount': amount === null ? missing() : known(amount, currency),
      'opportunity.value_currency': optional(currency),
      'opportunity.expected_close_date': optional(p.expected_close_date as string | null),
      // §99 — «senza prossimo passo» si esprime con `not_exists` su questo
      // fatto: una trattativa aperta che nessuno sa come proseguire è ferma.
      'opportunity.next_step': optional(p.next_step as string | null),
      'opportunity.next_step_due_date': optional(p.next_step_due_date as string | null),
      'opportunity.previous_stage': typeof previous === 'string' ? known(previous) : missing(),
    },
    documentId: null,
    emailMessageId: null,
    taskId: null,
    contractId: null,
    contractMilestoneId: null,
    // La trattativa E la sua controparte. Le passiamo entrambe pur sapendo che
    // `tasks_crm_guard` riempirebbe l'organizzazione da sola: scrivere solo
    // l'opportunità farebbe dipendere da un trigger un dato che qui è già noto,
    // e il giorno in cui quel trigger cambiasse non fallirebbe nessun test.
    crmOrganizationId: (p.organization_id as string | null) ?? null,
    crmOpportunityId: p.id as string,
    // §84 e §136 — l'avviso e l'attività vanno al responsabile della TRATTATIVA;
    // se non c'è, al responsabile della relazione. Senza nessuno dei due resta
    // null, e l'azione «assegna» viene saltata dichiarandolo.
    assigneeUserId: (p.owner_user_id as string | null)
      ?? (o.account_owner_user_id as string | null) ?? null,
  };
}

/**
 * I fatti di un CONTRATTO (0024).
 *
 * ⚠️⚠️ I TERMINI SONO QUELLI IN VIGORE, E LO STATO DELLA VERSIONE È UN FATTO.
 * Si legge la versione VERIFICATA se esiste, altrimenti la bozza — e
 * `contract.terms_are_draft` dice quale delle due, perché una regola deve poter
 * dire «agisci solo su termini che una persona ha verificato». Senza quel fatto,
 * una regola agirebbe su una proposta della macchina credendola una decisione
 * dell'azienda.
 *
 * ⚠️ LE DATE DEL CONTRATTO NON SONO FATTI DEL CONTRATTO. Una data è una
 * milestone e ha un proprio stato (proposta o verificata): i fatti
 * `milestone.*` esistono SOLO quando l'evento ne porta una, e l'evento la porta
 * solo quando una persona l'ha verificata o quando la sua finestra si è aperta.
 * Un campo piatto `contract.notice_date` avrebbe permesso a una regola di
 * decidere su una data che il prodotto ha calcolato e nessuno ha guardato.
 */
async function contractFacts(
  sb: ServerClient, event: ClaimedEvent,
): Promise<EntityFacts | null> {
  const { data: contract } = await sb.from('contracts')
    .select('id, company_id, display_name, contract_type, counterparty_name, owner_user_id, '
      + 'lifecycle_status, review_status, quality_flags, current_term_version_id')
    .eq('id', event.entity_id).eq('company_id', event.company_id).maybeSingle();
  if (!contract) return null;
  const c = contract as Record<string, unknown>;

  // I termini in vigore; in mancanza, la bozza — dichiarata come tale.
  const { data: versions } = await sb.from('contract_term_versions')
    .select('id, status, auto_renewal, cost_amount, cost_currency, cost_frequency, '
      + 'counterparty_name')
    .eq('contract_id', c.id).eq('company_id', event.company_id)
    .in('status', ['verified', 'draft'])
    .order('version', { ascending: false });
  const rows = ((versions ?? []) as Record<string, unknown>[]);
  const current = c.current_term_version_id
    ? rows.find((v) => v.id === c.current_term_version_id) ?? null
    : rows.find((v) => v.status === 'draft') ?? null;

  const { data: docs } = await sb.from('contract_documents')
    .select('id').eq('contract_id', c.id).eq('company_id', event.company_id);
  const documentCount = ((docs ?? []) as unknown[]).length;

  const flags = (c.quality_flags as string[] | null) ?? [];
  const currency = (current?.cost_currency as string | null) ?? null;
  const costAmount = current?.cost_amount === null || current?.cost_amount === undefined
    ? null : Number(current.cost_amount);

  const facts: Facts = {
    'contract.type': known(c.contract_type as string),
    'contract.name': optional(c.display_name as string | null),
    'contract.counterparty': optional(
      (current?.counterparty_name as string | null) ?? (c.counterparty_name as string | null)),
    'contract.owner': optional(c.owner_user_id as string | null),
    'contract.lifecycle_status': known(c.lifecycle_status as string),
    // ⚠️ `unclear` è un valore NOTO, non un fatto mancante: «il documento non
    // chiarisce il rinnovo» è un'informazione su cui una regola può decidere —
    // ed è anzi la regola più utile che si possa scrivere su un contratto.
    'contract.auto_renewal': known((current?.auto_renewal as string | null) ?? 'unclear'),
    'contract.cost_amount': costAmount === null ? missing() : known(costAmount, currency),
    'contract.cost_currency': optional(currency),
    'contract.cost_frequency': known((current?.cost_frequency as string | null) ?? 'unknown'),
    'contract.terms_are_draft': known(current ? current.status === 'draft' : true),
    'contract.has_quality_flags': known(flags.length > 0),
    'contract.document_count': known(documentCount),
  };

  // I fatti della DATA, solo se l'evento ne porta una.
  const milestoneId = (event.payload.milestoneId as string | null) ?? null;
  if (milestoneId) {
    const { data: ms } = await sb.from('contract_milestones')
      .select('id, kind, due_date, source, status')
      .eq('id', milestoneId).eq('company_id', event.company_id).maybeSingle();
    const m = ms as Record<string, unknown> | null;
    // ⚠️ Si RILEGGE lo stato invece di fidarsi del payload: fra l'emissione e
    // adesso una persona può aver scartato quella data, e far nascere
    // un'attività su una data scartata sarebbe creare lavoro su una decisione
    // già presa in senso contrario.
    if (m && (m.status === 'verified')) {
      facts['milestone.type'] = known(m.kind as string);
      facts['milestone.date'] = known(m.due_date as string);
      facts['milestone.source'] = known(m.source as string);
    } else {
      facts['milestone.type'] = missing();
      facts['milestone.date'] = missing();
      facts['milestone.source'] = missing();
    }
  }

  return {
    facts,
    documentId: null,
    emailMessageId: null,
    taskId: null,
    contractId: c.id as string,
    contractMilestoneId: milestoneId,
    // ⚠️ La controparte del contratto NON viene propagata all'attività, e non
    // è una dimenticanza: `contracts.counterparty_organization_id` è
    // FACOLTATIVA e spesso vuota, e un'attività agganciata a un cliente che
    // qualcuno collegherà domani direbbe oggi una cosa che oggi non è vera.
    // Il collegamento fra contratto e cliente si legge dal contratto.
    crmOrganizationId: null,
    crmOpportunityId: null,
    assigneeUserId: (c.owner_user_id as string | null) ?? null,
  };
}

/**
 * ⚠️ I VALORI EFFETTIVI, NON QUELLI DELL'AI (§24).
 *
 * Se una persona ha corretto «Comune Lugamo» in «Comune di Lugano», la regola
 * deve vedere «Comune di Lugano». Le correzioni si applicano in ordine
 * cronologico e l'ultima vince — è esattamente ciò che fa `list_documents`
 * nella 0017, e la ragione per cui qui si legge nello stesso modo: due
 * definizioni di «valore effettivo» sono due schermate che prima o poi
 * dicono due cose diverse sullo stesso documento.
 *
 * Un valore corretto a mano è anche CERTO per definizione: nessuna soglia di
 * affidabilità si applica a ciò che una persona ha confermato.
 */
async function documentFacts(
  sb: ServerClient, event: ClaimedEvent, now: Date,
): Promise<EntityFacts | null> {
  const { data: doc } = await sb.from('documents')
    .select('id, company_id, title, source_type, category, category_source')
    .eq('id', event.entity_id).eq('company_id', event.company_id).maybeSingle();
  if (!doc) return null;

  const { data: analyses } = await sb.from('document_analyses')
    .select('id, document_type, sender, sender_authority_type, deadline, amount, amount_currency, '
      + 'confidence, overall_confidence, reply_needed, analysis_status, created_at, amount_evidence')
    .eq('document_id', doc.id).eq('company_id', event.company_id)
    .neq('analysis_status', 'failed')
    .order('created_at', { ascending: false }).limit(1);
  const analysis = ((analyses ?? []) as Record<string, unknown>[])[0] ?? null;

  const { data: corrections } = await sb.from('analysis_corrections')
    .select('field, corrected_value, corrected_at')
    .eq('document_id', doc.id).eq('company_id', event.company_id)
    .order('corrected_at', { ascending: true });

  const corrected = new Map<string, string>();
  for (const c of (corrections ?? []) as { field: string; corrected_value: string }[]) {
    corrected.set(c.field, c.corrected_value);
  }

  const conf = analysis
    ? {
        overallConfidence: analysis.overall_confidence as number | null,
        confidenceLabel: analysis.confidence as string | null,
      }
    : { overallConfidence: null, confidenceLabel: null };

  const documentType = corrected.get('document_type') ?? (analysis?.document_type as string | null) ?? null;
  const deadlineRaw = corrected.get('deadline') ?? (analysis?.deadline as string | null) ?? null;
  const deadline = /^\d{4}-\d{2}-\d{2}/.test(String(deadlineRaw ?? '')) ? String(deadlineRaw).slice(0, 10) : null;
  const amountRaw = corrected.get('amount') ?? (analysis?.amount as number | null) ?? null;
  const amount = amountRaw === null || amountRaw === '' ? null : Number(amountRaw);

  const facts: Facts = {
    'document.category': optional(doc.category as string | null),
    'document.source_type': known(doc.source_type as string),
    'document.title': optional(doc.title as string | null),
    'document.category_source': optional(doc.category_source as string | null),
    // Il valore PRECEDENTE esiste solo nell'evento: adesso non c'è più da
    // nessuna parte, ed è l'unico caso in cui il payload è la fonte.
    'document.previous_category': optional((event.payload.previousCategory as string | null) ?? null),

    'analysis.document_type': aiFact({
      value: documentType, corrected: corrected.has('document_type'), ...conf,
    }),
    'analysis.sender': aiFact({
      value: corrected.get('sender') ?? (analysis?.sender as string | null) ?? null,
      corrected: corrected.has('sender'), ...conf,
    }),
    'analysis.sender_authority_type': aiFact({
      value: (analysis?.sender_authority_type as string | null) ?? null, ...conf,
    }),
    'analysis.deadline': aiFact({
      value: deadline, corrected: corrected.has('deadline'), ...conf,
    }),
    // ⚠️ §20 — L'IMPORTO È L'UNICO NUMERO CHE PUÒ FAR PARTIRE UN'AZIONE DA SOLO,
    // ed è quindi l'unico su cui vale la pena chiedersi da dove viene.
    // `amount_evidence` è scritto da `legacyEvidence`, che restituisce `null`
    // quando la citazione non si ritrova nel testo estratto — cioè quando quella
    // cifra non ha una provenienza verificabile. In quel caso il fatto è
    // INCERTO: sulla logica a tre valori la condizione diventa `unknown` e la
    // regola NON SI ESEGUE, che è la stessa scelta già fatta per le valute
    // diverse. L'importo resta scritto nell'analisi e visibile a schermo: non si
    // cancella un dato, si toglie il permesso di agire da solo.
    'analysis.amount': aiFact({
      value: Number.isFinite(amount as number) ? (amount as number) : null,
      corrected: corrected.has('amount'), ...conf,
      currency: (analysis?.amount_currency as string | null) ?? null,
      unverifiedQuote: !!analysis && amount !== null && !analysis.amount_evidence,
    }),
    'analysis.overall_confidence': optional((analysis?.overall_confidence as number | null) ?? null),
    'analysis.reply_needed': analysis?.reply_needed === null || analysis?.reply_needed === undefined
      ? missing() : known(analysis.reply_needed as boolean),
    // L'urgenza è DERIVATA da tipo e scadenza, non salvata: si calcola con la
    // stessa funzione che usa la schermata di analisi (vedi `urgencyFrom`).
    // Se non c'è nessuna analisi non c'è urgenza: non si deduce da un documento
    // di cui non si sa niente.
    'analysis.urgency': analysis
      ? known(urgencyFrom(documentType, deadline, now))
      : missing(),
  };

  // ---- I fatti finanziari (0021) ------------------------------------------
  //
  // ⚠️ SI AGGIUNGONO SEMPRE, non solo per gli inneschi di Finance, e la ragione
  // è che `loadFacts` dispaccia sull'ENTITÀ (`document`) e non sul tipo di
  // evento: costruire i fatti in due modi diversi a seconda dell'evento
  // significherebbe che la stessa regola, letta due volte, vede due mondi
  // diversi. Dove non c'è un elemento finanziario i fatti sono `missing()` — e
  // una condizione su un fatto assente vale `unknown`, quindi NON si esegue.
  //
  // ⚠️ I VALORI SONO GIÀ QUELLI EFFETTIVI: le colonne `eff_*` sono la
  // proiezione che il database ricalcola da estrazione più correzioni umane.
  // Rileggere qui estrazione e correzioni sarebbe una seconda definizione di
  // «valore effettivo», e prima o poi direbbe un importo diverso da quello che
  // la schermata mostra sulla stessa fattura.
  await addFinanceFacts(sb, facts, String(doc.id), event.company_id);

  return {
    facts, documentId: String(doc.id), emailMessageId: null, taskId: null,
    contractId: null, contractMilestoneId: null,
    crmOrganizationId: null, crmOpportunityId: null, assigneeUserId: null,
  };
}

/**
 * I fatti della fattura o della spesa collegata a un documento.
 * Il duplicato sospetto si CALCOLA (non è memorizzato: dipende da che cosa c'è
 * intorno e cambia archiviando la controparte), con la stessa impronta che usa
 * la lista.
 */
async function addFinanceFacts(
  sb: ServerClient, facts: Facts, documentId: string, companyId: string,
): Promise<void> {
  const { data: rows } = await sb.from('finance_items')
    .select('id, type, review_status, dup_key, quality_flags, '
      + 'eff_supplier_name, eff_invoice_number, eff_currency, '
      + 'eff_gross_amount, eff_vat_amount, eff_due_date, eff_invoice_date')
    .eq('document_id', documentId).eq('company_id', companyId).limit(1);
  const item = ((rows ?? []) as Record<string, unknown>[])[0] ?? null;

  if (!item) {
    for (const path of [
      'finance.type', 'finance.supplier', 'finance.invoice_number', 'finance.gross_amount',
      'finance.vat_amount', 'finance.currency', 'finance.due_date', 'finance.invoice_date',
      'finance.review_status', 'finance.duplicate_suspected', 'finance.has_quality_flags',
    ]) facts[path] = missing();
    return;
  }

  const currency = (item.eff_currency as string | null) ?? null;
  const gross = item.eff_gross_amount === null || item.eff_gross_amount === undefined
    ? null : Number(item.eff_gross_amount);
  const vat = item.eff_vat_amount === null || item.eff_vat_amount === undefined
    ? null : Number(item.eff_vat_amount);
  const flags = Array.isArray(item.quality_flags) ? item.quality_flags as string[] : [];

  let duplicates = 0;
  if (item.dup_key) {
    const { data: dups } = await sb.from('finance_items')
      .select('id')
      .eq('company_id', companyId).eq('dup_key', item.dup_key)
      .neq('id', item.id).is('archived_at', null);
    duplicates = (dups ?? []).length;
  }

  facts['finance.type'] = known(item.type as string);
  facts['finance.review_status'] = known(item.review_status as string);
  facts['finance.supplier'] = optional(item.eff_supplier_name as string | null);
  facts['finance.invoice_number'] = optional(item.eff_invoice_number as string | null);
  facts['finance.currency'] = optional(currency);
  // ⚠️ La valuta accompagna SEMPRE l'importo: senza, il motore confronterebbe
  // in silenzio franchi con euro (§22).
  facts['finance.gross_amount'] = gross === null || !Number.isFinite(gross)
    ? { value: null, known: false, reason: 'missing', currency }
    : known(gross, currency);
  facts['finance.vat_amount'] = vat === null || !Number.isFinite(vat)
    ? { value: null, known: false, reason: 'missing', currency }
    : known(vat, currency);
  facts['finance.due_date'] = optional(item.eff_due_date as string | null);
  facts['finance.invoice_date'] = optional(item.eff_invoice_date as string | null);
  facts['finance.duplicate_suspected'] = known(duplicates > 0);
  facts['finance.has_quality_flags'] = known(flags.length > 0 || duplicates > 0);
}

async function emailFacts(sb: ServerClient, event: ClaimedEvent): Promise<EntityFacts | null> {
  const { data: msg } = await sb.from('email_messages')
    .select('id, company_id, subject, sender_name, sender_email, relevance, attention_status, '
      + 'has_attachments, attachment_count')
    .eq('id', event.entity_id).eq('company_id', event.company_id).maybeSingle();
  if (!msg) return null;

  const { data: links } = await sb.from('email_message_documents')
    .select('document_id, relation')
    .eq('email_message_id', msg.id).eq('company_id', event.company_id);
  const rows = (links ?? []) as { document_id: string; relation: string }[];

  const facts: Facts = {
    'email.sender_email': optional(msg.sender_email as string | null),
    'email.sender_domain': optional(emailDomain(msg.sender_email as string | null)),
    'email.sender_name': optional(msg.sender_name as string | null),
    'email.subject': optional(msg.subject as string | null),
    'email.relevance': optional(msg.relevance as string | null),
    'email.attention_status': known(msg.attention_status as string),
    'email.has_attachments': known(msg.has_attachments === true),
    'email.attachment_count': known(Number(msg.attachment_count ?? 0)),
    'email.linked_document_count': known(rows.length),
  };

  // Il documento a cui collegare un'attività creata: il corpo se c'è,
  // altrimenti il primo allegato importato. Non si sceglie a caso.
  const body = rows.find((r) => r.relation === 'body');
  const documentId = body?.document_id ?? rows[0]?.document_id ?? null;

  return {
    facts, documentId, emailMessageId: String(msg.id), taskId: null,
    contractId: null, contractMilestoneId: null,
    crmOrganizationId: null, crmOpportunityId: null, assigneeUserId: null,
  };
}

async function taskFacts(sb: ServerClient, event: ClaimedEvent): Promise<EntityFacts | null> {
  const { data: task } = await sb.from('tasks')
    .select('id, company_id, title, priority, status, source, assignee_user_id, due_date, '
      + 'authority, document_id')
    .eq('id', event.entity_id).eq('company_id', event.company_id).maybeSingle();
  if (!task) return null;

  const facts: Facts = {
    'task.title': optional(task.title as string | null),
    'task.priority': known(task.priority as string),
    'task.status': known(task.status as string),
    'task.source': known(task.source as string),
    'task.assignee': optional(task.assignee_user_id as string | null),
    'task.due_date': optional(task.due_date as string | null),
    'task.authority': optional(task.authority as string | null),
    'task.has_document': known(task.document_id !== null),
    'task.previous_status': optional((event.payload.from as string | null) ?? null),
  };

  return {
    facts,
    documentId: (task.document_id as string | null) ?? null,
    emailMessageId: null,
    taskId: String(task.id),
    contractId: null,
    contractMilestoneId: null,
    // L'innesco parla di un'ATTIVITÀ che esiste già: non se ne crea un'altra da
    // collegare, e le azioni di questi inneschi lavorano su quella.
    crmOrganizationId: null,
    crmOpportunityId: null,
    assigneeUserId: (task.assignee_user_id as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Le esecuzioni
// ---------------------------------------------------------------------------

export interface RunRow { id: string; status: string }

/**
 * Apre (o ritrova) l'esecuzione di una regola per un evento.
 *
 * ⚠️ È QUI CHE VIVE L'IDEMPOTENZA DI PIÙ ALTO LIVELLO.
 * Il vincolo unico `(workflow_id, trigger_event_id)` fa fallire il secondo
 * inserimento; invece di trattarlo come un errore, lo si legge per quello che
 * è — «questa esecuzione esiste già» — e si RIPRENDE quella. Un evento
 * consegnato due volte non produce due esecuzioni, e un ritentativo non
 * ricomincia da capo: riprende le azioni rimaste (§43/§135).
 */
export async function openRun(
  sb: ServerClient,
  input: {
    companyId: string; workflowId: string; workflowVersion: number;
    eventId: string; entityType: string; entityId: string;
    snapshot: Record<string, unknown>; conditionResults: ConditionResult[];
  },
): Promise<RunRow> {
  const payload = {
    company_id: input.companyId,
    workflow_id: input.workflowId,
    workflow_version: input.workflowVersion,
    config_snapshot: input.snapshot,
    trigger_event_id: input.eventId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    status: 'running',
    condition_results: input.conditionResults,
    started_at: new Date().toISOString(),
  };

  const { data, error } = await sb.from('workflow_runs')
    .insert(payload).select('id, status').single();

  if (!error && data) return data as RunRow;

  const code = (error as { code?: string } | null)?.code;
  if (code === '23505') {
    const { data: existing } = await sb.from('workflow_runs')
      .select('id, status')
      .eq('workflow_id', input.workflowId).eq('trigger_event_id', input.eventId)
      .maybeSingle();
    if (existing) return existing as RunRow;
  }
  throw new Error(`run: ${(error as { message?: string } | null)?.message ?? 'errore'}`);
}

export async function finishRun(
  sb: ServerClient, runId: string,
  input: { status: string; errorCode?: string | null },
): Promise<void> {
  await sb.from('workflow_runs').update({
    status: input.status,
    completed_at: new Date().toISOString(),
    error_code: input.errorCode ?? null,
  }).eq('id', runId);
}

/**
 * Registra una run SALTATA per un motivo che va detto: le condizioni non erano
 * determinabili, la configurazione non è valida, l'entità non c'è più.
 *
 * ⚠️ Le run «non corrisponde» NON si scrivono (§101): una regola su «categoria
 * = Imposte» vedrebbe passare ogni documento dell'azienda, e novecento righe
 * «saltata» seppellirebbero le venti volte in cui ha davvero agito.
 */
export async function recordSkippedRun(
  sb: ServerClient,
  input: {
    companyId: string; workflowId: string; workflowVersion: number;
    eventId: string; entityType: string; entityId: string;
    snapshot: Record<string, unknown>; conditionResults: ConditionResult[];
    errorCode: string; status?: string;
  },
): Promise<void> {
  const run = await openRun(sb, input);
  await finishRun(sb, run.id, { status: input.status ?? 'skipped', errorCode: input.errorCode });
}

export interface ActionRunRow { id: string; status: string; idempotency_key: string }

/**
 * Prenota l'esecuzione di un'azione. Il ritorno dice se si deve procedere.
 *
 * `duplicate` significa che quell'azione, per quell'evento e quella regola, è
 * già stata trattata: non si rifà, e non è un errore. È il caso normale di un
 * ritentativo dopo un guasto a metà run.
 */
export async function claimAction(
  sb: ServerClient,
  input: {
    companyId: string; runId: string; actionKey: string; position: number; eventId: string;
    workflowId: string;
  },
): Promise<{ proceed: true; id: string } | { proceed: false; reason: 'duplicate' | 'done' }> {
  const key = `${input.eventId}:${input.workflowId}:${input.position}`;
  const { data, error } = await sb.from('workflow_action_runs').insert({
    company_id: input.companyId,
    workflow_run_id: input.runId,
    action_key: input.actionKey,
    action_position: input.position,
    idempotency_key: key,
    status: 'pending',
    started_at: new Date().toISOString(),
  }).select('id').single();

  if (!error && data) return { proceed: true, id: (data as { id: string }).id };

  if ((error as { code?: string } | null)?.code === '23505') {
    const { data: existing } = await sb.from('workflow_action_runs')
      .select('id, status').eq('idempotency_key', key).maybeSingle();
    const status = (existing as { status?: string } | null)?.status;
    // Un'azione rimasta `pending` è un'azione interrotta a metà: si può
    // riprendere. Una già conclusa — riuscita, saltata o fallita — no.
    if (status === 'pending') return { proceed: true, id: (existing as { id: string }).id };
    return { proceed: false, reason: 'done' };
  }
  throw new Error(`action: ${(error as { message?: string } | null)?.message ?? 'errore'}`);
}

export async function finishAction(
  sb: ServerClient, actionRunId: string,
  input: {
    status: 'succeeded' | 'skipped' | 'failed';
    errorCode?: string | null;
    outputEntityType?: string | null;
    outputEntityId?: string | null;
  },
): Promise<void> {
  await sb.from('workflow_action_runs').update({
    status: input.status,
    error_code: input.errorCode ?? null,
    output_entity_type: input.outputEntityType ?? null,
    output_entity_id: input.outputEntityId ?? null,
    completed_at: new Date().toISOString(),
  }).eq('id', actionRunId);
}

// ---------------------------------------------------------------------------
// Lo stato della regola dopo un'esecuzione
// ---------------------------------------------------------------------------

export async function markWorkflowRun(
  sb: ServerClient, workflowId: string, status: string,
): Promise<void> {
  await sb.from('workflow_definitions').update({
    last_run_at: new Date().toISOString(), last_run_status: status,
  }).eq('id', workflowId);
}

/**
 * Un guasto PERMANENTE di configurazione: la regola resta attiva ma «richiede
 * attenzione» (§103), e dopo N fallimenti consecutivi si mette in pausa da sé
 * (§104). Fallire diecimila volte non è resilienza — è un guasto che nessuno
 * vede, cioè il difetto peggiore possibile su questo progetto.
 */
export async function recordWorkflowFailure(
  sb: ServerClient, workflowId: string, code: string, autoPauseAfter: number,
): Promise<'attention' | 'paused'> {
  const { data } = await sb.from('workflow_definitions')
    .select('consecutive_failures, status').eq('id', workflowId).maybeSingle();
  const failures = Number((data as { consecutive_failures?: number } | null)?.consecutive_failures ?? 0) + 1;

  if (failures >= autoPauseAfter) {
    // ⚠️ `updated_by: null` NON è una svista: questa pausa non l'ha decisa
    // nessuno. Il trigger dello storico legge `coalesce(auth.uid(), updated_by)`
    // e senza questa riga attribuirebbe la pausa all'ultima persona che aveva
    // toccato la regola — una riga di registro che dice il falso.
    await sb.from('workflow_definitions').update({
      consecutive_failures: failures, attention_code: code, status: 'paused',
      updated_by: null,
    }).eq('id', workflowId);
    // Lo storico deve dire che a metterla in pausa è stato il SISTEMA e
    // perché: il trigger scriverebbe solo «messa in pausa», che sembrerebbe la
    // decisione di una persona.
    const { data: wf } = await sb.from('workflow_definitions')
      .select('company_id').eq('id', workflowId).maybeSingle();
    if (wf) {
      await sb.from('workflow_events').insert({
        company_id: (wf as { company_id: string }).company_id,
        workflow_id: workflowId, actor_user_id: null, kind: 'auto_paused',
        detail: { reason: code, failures },
      });
    }
    return 'paused';
  }

  await sb.from('workflow_definitions').update({
    consecutive_failures: failures, attention_code: code,
  }).eq('id', workflowId);
  return 'attention';
}

/** Un'esecuzione riuscita azzera il contatore e toglie l'avviso. */
export async function clearWorkflowFailures(sb: ServerClient, workflowId: string): Promise<void> {
  await sb.from('workflow_definitions')
    .update({ consecutive_failures: 0, attention_code: null })
    .eq('id', workflowId).neq('consecutive_failures', 0);
}

// ---------------------------------------------------------------------------
// Riferimenti: esistono ancora le cose che la regola nomina? (§56)
// ---------------------------------------------------------------------------

export interface ReferenceProblem { code: string; actionIndex: number }

/**
 * ⚠️ SI VERIFICA PRIMA DI OGNI ESECUZIONE, NON SOLO ALLA CREAZIONE.
 * Una regola valida a gennaio può essere invalida a marzo: il responsabile ha
 * lasciato l'azienda, l'etichetta è stata cancellata. Fidarsi della validazione
 * fatta al salvataggio significherebbe scoprire il problema come un errore del
 * database, ripetuto a ogni evento, invece che come una frase che dice cosa
 * fare (§55/§171).
 */
export async function checkReferences(
  sb: ServerClient, companyId: string, actions: readonly WorkflowAction[],
): Promise<ReferenceProblem[]> {
  const problems: ReferenceProblem[] = [];

  const userIds = new Set<string>();
  const tagIds = new Set<string>();
  actions.forEach((a) => {
    const c = a.config as unknown as Record<string, unknown>;
    if (typeof c.assigneeUserId === 'string') userIds.add(c.assigneeUserId);
    if (typeof c.userId === 'string') userIds.add(c.userId);
    if (typeof c.tagId === 'string') tagIds.add(c.tagId);
  });

  const members = new Set<string>();
  if (userIds.size) {
    const { data } = await sb.from('company_members')
      .select('user_id').eq('company_id', companyId).in('user_id', [...userIds]);
    for (const m of (data ?? []) as { user_id: string }[]) members.add(m.user_id);
  }

  const tags = new Set<string>();
  if (tagIds.size) {
    const { data } = await sb.from('document_tags')
      .select('id').eq('company_id', companyId).in('id', [...tagIds]);
    for (const t of (data ?? []) as { id: string }[]) tags.add(t.id);
  }

  actions.forEach((a, index) => {
    const c = a.config as unknown as Record<string, unknown>;
    if (typeof c.assigneeUserId === 'string' && !members.has(c.assigneeUserId)) {
      problems.push({ code: 'assignee_not_member', actionIndex: index });
    }
    if (typeof c.userId === 'string' && !members.has(c.userId)) {
      problems.push({ code: 'assignee_not_member', actionIndex: index });
    }
    if (typeof c.tagId === 'string' && !tags.has(c.tagId)) {
      problems.push({ code: 'tag_missing', actionIndex: index });
    }
  });

  return problems;
}

/** Chi guida l'azienda: owner e amministratori. Destinatari di «avvisa gli amministratori». */
export async function companyLeaders(sb: ServerClient, companyId: string): Promise<string[]> {
  const { data } = await sb.from('company_members')
    .select('user_id').eq('company_id', companyId).in('role', ['owner', 'admin']);
  return ((data ?? []) as { user_id: string }[]).map((m) => m.user_id);
}
