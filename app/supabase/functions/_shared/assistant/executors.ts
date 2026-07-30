// ============================================================================
// COMPANY ASSISTANT — gli esecutori
//
// Ogni strumento dichiarato in `registry.ts` ha qui una funzione che lo esegue.
// Tre regole governano ogni riga di questo file.
//
// ⚠️ 1. SI LEGGE CON IL CLIENT DELL'UTENTE, MAI CON IL RUOLO DI SERVIZIO.
// Tutte le RPC di lettura del prodotto (`list_tasks`, `list_documents`,
// `list_finance_items`, `list_contracts`, `list_crm_*`, `calendar_tasks`) sono
// SECURITY INVOKER: la loro difesa è la RLS di chi chiama. Con il ruolo di
// servizio la RLS sparisce e quelle stesse funzioni restituirebbero i dati di
// chiunque. Il permesso non è quindi qualcosa che questi esecutori applicano:
// è qualcosa che NON POSSONO aggirare, perché il client che ricevono è quello
// dell'utente. È la ragione per cui `deps.db` non espone il ruolo di servizio.
//
// ⚠️ 2. SI RESTITUISCE IL MINIMO NECESSARIO (§53, §74, §81).
// Le RPC restituiscono anche colonne che il modello non deve vedere:
// `list_crm_organizations` include `notes`, `list_crm_opportunities` include
// `lost_reason`, e le colonne del corpo delle email esistono su
// `email_messages`. Il filtro NON è nella RLS — la RLS quelle colonne le
// concede — ma qui, nella proiezione di ogni esecutore. Ogni riga costruita in
// questo file è un elenco esplicito di campi, mai uno `...row`.
//
// ⚠️ 3. IL MODELLO NON VEDE MAI UN IDENTIFICATIVO.
// Ogni riga porta un `ref` opaco (`f1`, `f2`, …). Gli uuid restano nella fonte
// che il server tiene per sé. Così una citazione non può essere inventata: per
// citare bisogna nominare un `ref`, e i `ref` esistono solo se uno strumento
// ha davvero restituito quella riga (§60).
// ============================================================================

import {
  type AssistantContext, type AssistantSourceReference, type SourceType,
  type SourceVerification, type ToolExecutionResult, ASSISTANT_LIMITS, emptyResult, truncate,
} from './contract.ts';
import { resolveRange, todayIn } from './dates.ts';

// ---------------------------------------------------------------------------
// Il client minimo
//
// Si dichiara la forma invece di importare il tipo di `@supabase/supabase-js`:
// è la stessa scelta di `persist.ts` (`SupabaseLike`), e serve a poter provare
// gli esecutori con un finto client, senza rete e senza database (§179).
// ---------------------------------------------------------------------------
export interface DbResult { data: unknown; error: unknown }

/**
 * ⚠️ `QueryLike` estende `PromiseLike`: un costruttore di query di PostgREST è
 * già una promessa, e dichiararlo tale permette di scrivere `await query` senza
 * il `` che altrimenti servirebbe per farla partire. È anche il
 * motivo per cui non si dichiara `any`: la catena resta tipizzata fino in fondo.
 */
export interface QueryLike extends PromiseLike<DbResult> {
  select: (columns: string) => QueryLike;
  eq: (column: string, value: unknown) => QueryLike;
  in: (column: string, values: unknown[]) => QueryLike;
  is: (column: string, value: unknown) => QueryLike;
  not: (column: string, op: string, value: unknown) => QueryLike;
  gte: (column: string, value: unknown) => QueryLike;
  lte: (column: string, value: unknown) => QueryLike;
  ilike: (column: string, value: unknown) => QueryLike;
  order: (column: string, opts?: { ascending?: boolean }) => QueryLike;
  limit: (n: number) => QueryLike;
  maybeSingle: () => PromiseLike<DbResult>;
}

export interface DbLike {
  from: (table: string) => QueryLike;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<DbResult>;
}

export interface ExecutorDeps {
  db: DbLike;
  ctx: AssistantContext;
  /** Assegna il prossimo `ref`. Il contatore è di tutta la domanda, non del singolo strumento. */
  allocRef: () => string;
  /**
   * Nome delle persone dell'azienda.
   * ⚠️ Serve perché `list_tasks` è SECURITY INVOKER e la RLS di `profiles`
   * concede solo la PROPRIA riga: `assignee_name` arriva NULL per chiunque non
   * sia il chiamante, senza errori e senza avvisi. Il nome giusto si prende da
   * `company_member_directory`, che è SECURITY DEFINER e verifica la membership.
   */
  members: Map<string, string>;
}

export type Executor = (input: Record<string, unknown>, deps: ExecutorDeps) => Promise<ToolExecutionResult>;

// ---------------------------------------------------------------------------
// Conversioni difensive
//
// PostgREST consegna `numeric` e `bigint` come STRINGA quando eccedono la
// precisione sicura di JavaScript. Convertirli con `Number()` senza guardia
// produce `NaN` là dove il valore c'era.
// ---------------------------------------------------------------------------
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown): number => {
  const n = num(v);
  return n == null ? 0 : Math.trunc(n);
};
const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
};
const rows = (data: unknown): Record<string, unknown>[] =>
  Array.isArray(data) ? (data as Record<string, unknown>[]) : [];

const clampLimit = (v: unknown, max: number, def: number): number => {
  const n = num(v);
  if (n == null) return def;
  return Math.max(1, Math.min(Math.trunc(n), max));
};

/** Un errore di PostgREST diventa un esito, non un'eccezione: §144 vuole risposte parziali. */
function failed(error: unknown): ToolExecutionResult {
  const code = (error as { code?: string } | null)?.code ?? '';
  // 42501 = la RLS ha detto di no. Non è un guasto: è il permesso che funziona.
  const denied = code === '42501' || code === 'PGRST301';
  return { status: denied ? 'denied' : 'error', rows: [], sources: [], errorCode: code || 'query_failed' };
}

// ---------------------------------------------------------------------------
// Costruzione delle fonti
// ---------------------------------------------------------------------------

interface SourceInit {
  sourceType: SourceType;
  sourceId: string | null;
  route: string;
  title: string;
  subtitle?: string | null;
  verification: SourceVerification;
  evidenceId?: string | null;
  pageNumber?: number | null;
  fieldName?: string | null;
  citedText?: string | null;
  valueSnapshot?: Record<string, unknown> | null;
  sourceVersion?: string | null;
  sourceIds?: string[];
  groupSize?: number;
}

const mkSource = (ref: string, init: SourceInit): AssistantSourceReference => ({
  ref,
  sourceType: init.sourceType,
  sourceId: init.sourceId,
  sourceIds: init.sourceIds,
  groupSize: init.groupSize,
  route: init.route,
  title: truncate(init.title || '—', 160),
  subtitle: init.subtitle ? truncate(init.subtitle, 160) : null,
  evidenceId: init.evidenceId ?? null,
  pageNumber: init.pageNumber ?? null,
  fieldName: init.fieldName ?? null,
  citedText: init.citedText ? truncate(init.citedText, ASSISTANT_LIMITS.maxCitedTextChars) : null,
  valueSnapshot: init.valueSnapshot ?? null,
  sourceVersion: init.sourceVersion ?? null,
  verification: init.verification,
});

/**
 * §57 — la citazione aggregata.
 *
 * `value_snapshot` porta titolo e rotta di ciascun elemento: così il pannello
 * delle fonti può elencare «3 fatture» con i loro nomi senza una seconda
 * interrogazione, e senza copiare importi o testi — è lo «snapshot minimo» che
 * §86 consente.
 */
function groupSource(
  ref: string, sourceType: SourceType, route: string, title: string,
  items: { id: string; title: string; route: string }[], verification: SourceVerification,
): AssistantSourceReference {
  return mkSource(ref, {
    sourceType, sourceId: null, route, title, verification,
    sourceIds: items.map((i) => i.id),
    groupSize: items.length,
    valueSnapshot: { items: items.slice(0, 12).map((i) => ({ title: truncate(i.title, 90), route: i.route })) },
  });
}

// ---------------------------------------------------------------------------
// Rotte
//
// ⚠️ Solo percorsi INTERNI, costruiti qui e mai dal modello (§106). I nomi dei
// parametri sono quelli che le pagine leggono davvero: un parametro inventato
// produrrebbe un collegamento che apre l'elenco senza applicare il filtro —
// una promessa non mantenuta, che è peggio di nessun filtro.
// ---------------------------------------------------------------------------
const ROUTES = {
  task: (id: string) => `/attivita/${id}`,
  tasks: (view?: string) => (view ? `/attivita?vista=${view}` : '/attivita'),
  document: (id: string) => `/documenti/${id}`,
  documents: (q?: string) => (q ? `/documenti?q=${encodeURIComponent(q)}` : '/documenti'),
  email: (id: string) => `/inbox?msg=${id}`,
  inbox: () => '/inbox',
  finance: (id: string) => `/finanze/${id}`,
  financeList: (params?: string) => (params ? `/finanze?${params}` : '/finanze'),
  contract: (id: string) => `/contratti/${id}`,
  contracts: (view?: string) => (view ? `/contratti?vista=${view}` : '/contratti'),
  client: (id: string) => `/clienti/${id}`,
  clients: () => '/clienti',
  opportunity: (orgId: string, oppId: string) => `/clienti/${orgId}/opportunita/${oppId}`,
  workflow: (id: string) => `/automazioni/${id}`,
  workflows: () => '/automazioni',
  workflowRun: (wfId: string, runId: string) => `/automazioni/${wfId}/esecuzioni/${runId}`,
  home: () => '/',
};

const memberName = (deps: ExecutorDeps, userId: unknown): string | null =>
  typeof userId === 'string' ? (deps.members.get(userId) ?? null) : null;

// ===========================================================================
// PANORAMICA
// ===========================================================================

const getCompanyOverview: Executor = async (_input, deps) => {
  const { db, ctx } = deps;
  const today = todayIn(ctx.now, ctx.timeZone);

  // Le interrogazioni partono INSIEME (§165): otto letture in sequenza
  // costerebbero otto volte la latenza per una schermata d'insieme.
  const [tasksTodo, tasksOverdue, docsToVerify, finance, contracts, crm, workflows, unread] =
    await Promise.all([
      db.rpc('list_tasks', { p_company_id: ctx.companyId, p_view: 'todo', p_limit: 1 }),
      db.rpc('list_tasks', { p_company_id: ctx.companyId, p_view: 'overdue', p_limit: 1 }),
      db.rpc('list_documents', { p_company_id: ctx.companyId, p_state: 'to_verify', p_limit: 1 }),
      db.rpc('finance_summary', { p_company_id: ctx.companyId, p_due_days: 7 }),
      db.rpc('contract_summary', { p_company_id: ctx.companyId, p_window_days: 90 }),
      db.rpc('crm_home_summary', { p_company_id: ctx.companyId, p_stale_days: 30 }),
      db.from('workflow_definitions')
        .select('id, name, status, attention_code, consecutive_failures')
        .eq('company_id', ctx.companyId)
        .not('attention_code', 'is', null)
        .limit(20)
        ,
      db.rpc('notifications_unread_count', { p_company_id: ctx.companyId }),
    ]);

  // `total_count` è una funzione finestra: esiste solo se almeno una riga è
  // tornata. Con zero righe il totale è 0 per costruzione, non «sconosciuto».
  const totalOf = (res: { data: unknown; error: unknown }): number | null => {
    if (res.error) return null;
    const r = rows(res.data);
    return r.length ? int(r[0].total_count) : 0;
  };

  const fin = rows(finance.data);
  const financeByBucket = (bucket: string) => fin.filter((r) => r.bucket === bucket);
  // Gli importi restano SEPARATI per valuta (§20): qui non si somma niente.
  const amounts = (bucket: string) =>
    financeByBucket(bucket)
      .filter((r) => str(r.currency) && num(r.total) != null)
      .map((r) => ({ currency: str(r.currency), amount: num(r.total), count: int(r.n) }));

  const ct = rows(contracts.data)[0] ?? {};
  const cr = rows(crm.data)[0] ?? {};
  const wf = rows(workflows.data);

  const ref = deps.allocRef();
  const overview = {
    ref,
    today,
    tasks: {
      open: totalOf(tasksTodo),
      overdue: totalOf(tasksOverdue),
    },
    documents: { needingReview: totalOf(docsToVerify) },
    finance: {
      needsReview: int(financeByBucket('needs_review')[0]?.n ?? 0),
      dueWithin7Days: amounts('due_soon'),
      overdue: amounts('overdue'),
      note: 'Scaduta significa che la data di scadenza è passata. Il prodotto non conosce i pagamenti.',
    },
    contracts: {
      needsReview: int(ct.needs_review),
      renewalsWithin90Days: int(ct.renewals_soon),
      noticeDeadlinesWithin90Days: int(ct.notices_soon),
      withoutOwner: int(ct.without_owner),
    },
    crm: {
      openOpportunities: int(cr.open_opportunities),
      withoutNextStep: int(cr.without_next_step),
      overdueFollowUps: int(cr.overdue_follow_ups),
      staleRelationships: int(cr.stale_relationships),
    },
    automations: { needingAttention: wf.length },
    myUnreadNotifications: int(notificationsCount(unread)),
  };

  const failedParts: string[] = [];
  for (const [name, res] of [
    ['attività', tasksTodo], ['documenti', docsToVerify], ['finanze', finance],
    ['contratti', contracts], ['clienti', crm], ['automazioni', workflows],
  ] as const) {
    if ((res as { error: unknown }).error) failedParts.push(name);
  }

  return {
    status: 'ok',
    rows: [overview],
    sources: [mkSource(ref, {
      sourceType: 'company_overview', sourceId: null, route: ROUTES.home(),
      title: 'Panoramica dell\'azienda',
      verification: 'deterministic',
      groupSize: 1, sourceIds: [],
      valueSnapshot: { day: today },
    })],
    note: failedParts.length
      ? `Non ho potuto leggere: ${failedParts.join(', ')}. Dichiara che la risposta è parziale.`
      : undefined,
  };
};

const notificationsCount = (res: { data: unknown; error: unknown }): unknown =>
  res.error ? 0 : (typeof res.data === 'number' ? res.data : rows(res.data)[0]?.count ?? 0);

// ===========================================================================
// ATTIVITÀ
// ===========================================================================

/** §72 — «me» lo risolve il server dalla sessione, non il modello. */
function assigneeFilter(input: Record<string, unknown>, deps: ExecutorDeps): {
  p_assignee: string | null; unassignedOnly: boolean;
} {
  const scope = str(input.assignee) ?? 'anyone';
  if (scope === 'me') return { p_assignee: deps.ctx.userId, unassignedOnly: false };
  if (scope === 'unassigned') return { p_assignee: null, unassignedOnly: true };
  return { p_assignee: null, unassignedOnly: false };
}

function taskRow(r: Record<string, unknown>, ref: string, deps: ExecutorDeps, today: string) {
  const due = str(r.due_date);
  return {
    ref,
    title: str(r.title),
    dueDate: due,
    isOverdue: !!due && due < today && r.status !== 'completed',
    status: str(r.status),
    priority: str(r.priority),
    assignee: memberName(deps, r.assignee_user_id),
    assigned: !!r.assignee_user_id,
    source: str(r.source),
    fromDocument: !!r.document_id,
  };
}

function taskSource(r: Record<string, unknown>, ref: string): AssistantSourceReference {
  return mkSource(ref, {
    sourceType: 'task', sourceId: String(r.id), route: ROUTES.task(String(r.id)),
    title: str(r.title) ?? 'Attività',
    subtitle: str(r.due_date),
    // Un'attività è un fatto scritto da una persona o da una regola: non è
    // un'estrazione, e non ha bisogno di essere «verificata».
    verification: 'deterministic',
    sourceVersion: str(r.updated_at),
    valueSnapshot: { dueDate: str(r.due_date), status: str(r.status), priority: str(r.priority) },
  });
}

const listTasks: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const limit = clampLimit(input.limit, ASSISTANT_LIMITS.maxRowsPerTool, 10);
  const { p_assignee, unassignedOnly } = assigneeFilter(input, deps);
  const view = str(input.view) ?? 'todo';

  const res = await db.rpc('list_tasks', {
    p_company_id: ctx.companyId,
    p_view: view,
    p_status: str(input.status),
    p_priority: str(input.priority),
    p_assignee,
    p_search: str(input.search),
    // Il filtro «non assegnate» non esiste nella RPC: si chiede qualche riga in
    // più e si filtra qui. È l'unico posto in cui vale la pena, perché è una
    // domanda frequente («quali attività non sono assegnate?») e la sola
    // alternativa sarebbe una RPC nuova.
    p_limit: unassignedOnly ? Math.min(limit * 4, 100) : limit,
  });
  if (res.error) return failed(res.error);

  const today = todayIn(ctx.now, ctx.timeZone);
  let list = rows(res.data);
  const total = list.length ? int(list[0].total_count) : 0;
  if (unassignedOnly) list = list.filter((r) => !r.assignee_user_id);
  list = list.slice(0, limit);

  if (!list.length) {
    return { ...emptyResult('Nessuna attività corrisponde a questi filtri.'), totalCount: 0 };
  }

  const out: Record<string, unknown>[] = [];
  const sources: AssistantSourceReference[] = [];
  for (const r of list) {
    const ref = deps.allocRef();
    out.push(taskRow(r, ref, deps, today));
    sources.push(taskSource(r, ref));
  }
  // La citazione aggregata: una sola pastiglia per «hai 5 attività» (§57).
  const gref = deps.allocRef();
  sources.push(groupSource(
    gref, 'task', ROUTES.tasks(view === 'overdue' ? 'overdue' : undefined),
    unassignedOnly ? 'Attività non assegnate' : 'Elenco delle attività',
    list.map((r) => ({ id: String(r.id), title: str(r.title) ?? 'Attività', route: ROUTES.task(String(r.id)) })),
    'deterministic',
  ));

  return {
    status: 'ok',
    rows: out,
    sources,
    totalCount: unassignedOnly ? out.length : total,
    truncated: !unassignedOnly && total > list.length,
    note: `Riferimento per l'elenco completo: ${gref}. Oggi è ${today}.` +
      (!unassignedOnly && total > list.length ? ` Ne esistono ${total} in tutto, ne vedi ${list.length}.` : ''),
  };
};

const listTasksByDueDate: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const limit = clampLimit(input.limit, ASSISTANT_LIMITS.maxRowsPerTool, 15);
  const range = resolveRange(
    { period: input.period, from: input.from, to: input.to }, ctx.now, ctx.timeZone,
  );
  if (!range) {
    return { status: 'error', rows: [], sources: [], errorCode: 'missing_period',
      note: 'Serve un periodo: usa `period` (per esempio this_week) oppure `from` e `to`.' };
  }
  const { p_assignee } = assigneeFilter(input, deps);

  const res = await db.rpc('calendar_tasks', {
    p_company_id: ctx.companyId,
    p_from: range.from,
    p_to: range.to,
    // ⚠️ `p_mine` vale TRUE per difetto: una domanda aziendale che non lo
    // spegnesse mostrerebbe solo le attività di chi chiede, senza dirlo.
    p_mine: str(input.assignee) === 'me',
    p_assignee,
    p_include_overdue: input.includeOverdue === true,
    p_limit: Math.min(limit * 2, 200),
  });
  if (res.error) return failed(res.error);

  const today = todayIn(ctx.now, ctx.timeZone);
  const list = rows(res.data).slice(0, limit);
  if (!list.length) {
    return { ...emptyResult(`Nessuna attività con scadenza fra il ${range.from} e il ${range.to}.`), totalCount: 0 };
  }

  const out: Record<string, unknown>[] = [];
  const sources: AssistantSourceReference[] = [];
  for (const r of list) {
    const ref = deps.allocRef();
    out.push(taskRow(r, ref, deps, today));
    sources.push(taskSource(r, ref));
  }
  const gref = deps.allocRef();
  sources.push(groupSource(
    gref, 'task', ROUTES.tasks(), `Attività dal ${range.from} al ${range.to}`,
    list.map((r) => ({ id: String(r.id), title: str(r.title) ?? 'Attività', route: ROUTES.task(String(r.id)) })),
    'deterministic',
  ));

  return {
    status: 'ok', rows: out, sources, totalCount: list.length,
    note: `Intervallo applicato: dal ${range.from} al ${range.to} (fuso ${ctx.timeZone}). ` +
      `Riferimento per l'elenco: ${gref}.` +
      (input.includeOverdue === true ? ' Sono incluse anche le attività già scadute fuori dall\'intervallo.' : ''),
  };
};

const getTaskDetails: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const id = str(input.taskId);
  if (!id) return failed({ code: 'missing_id' });

  const [taskRes, checklistRes] = await Promise.all([
    db.from('tasks')
      .select('id, title, description, authority, due_date, status, priority, source, assignee_user_id, ' +
              'document_id, contract_id, contract_milestone_id, crm_organization_id, crm_opportunity_id, ' +
              'workflow_run_id, completed_at, archived_at, created_at, updated_at, company_id')
      .eq('id', id).eq('company_id', ctx.companyId).maybeSingle(),
    db.from('task_checklist_items')
      .select('text, done').eq('task_id', id).order('position').limit(20),
  ]);
  if (taskRes.error) return failed(taskRes.error);
  const t = taskRes.data as Record<string, unknown> | null;
  if (!t) return emptyResult('Nessuna attività con questo identificativo fra quelle accessibili.');

  const today = todayIn(ctx.now, ctx.timeZone);
  const ref = deps.allocRef();
  const checklist = rows(checklistRes.data).map((c) => ({ text: str(c.text), done: c.done === true }));

  // La provenienza dalla posta: la stessa lettura che il Document Hub fa già.
  let emailOrigin: Record<string, unknown> | null = null;
  if (t.document_id) {
    const e = await db.from('email_message_documents')
      .select('email_message_id, relation, email_messages(subject, sender_name, sender_email, received_at)')
      .eq('document_id', String(t.document_id)).limit(1);
    const first = rows(e.data)[0];
    const m = first?.email_messages as Record<string, unknown> | undefined;
    if (m) emailOrigin = { subject: str(m.subject), sender: str(m.sender_name) ?? str(m.sender_email), receivedAt: str(m.received_at) };
  }

  const due = str(t.due_date);
  return {
    status: 'ok',
    rows: [{
      ref,
      title: str(t.title),
      description: str(t.description) ? truncate(String(t.description), 600) : null,
      authority: str(t.authority),
      dueDate: due,
      isOverdue: !!due && due < today && t.status !== 'completed',
      status: str(t.status),
      priority: str(t.priority),
      assignee: memberName(deps, t.assignee_user_id),
      source: str(t.source),
      checklist,
      linkedTo: {
        document: !!t.document_id,
        contract: !!t.contract_id,
        contractMilestone: !!t.contract_milestone_id,
        client: !!t.crm_organization_id,
        opportunity: !!t.crm_opportunity_id,
        automationRun: !!t.workflow_run_id,
      },
      emailOrigin,
      archived: !!t.archived_at,
    }],
    sources: [taskSource(t, ref)],
  };
};

// ===========================================================================
// DOCUMENTI
// ===========================================================================

function documentRow(r: Record<string, unknown>, ref: string) {
  return {
    ref,
    title: str(r.title),
    sender: str(r.sender),
    senderCorrectedByPerson: r.sender_corrected === true,
    documentType: str(r.document_type),
    documentTypeCorrectedByPerson: r.document_type_corrected === true,
    category: str(r.category),
    documentDate: str(r.document_date),
    deadline: str(r.deadline),
    deadlineCorrectedByPerson: r.deadline_corrected === true,
    deadlineNeedsVerification: r.deadline_requires_verification === true,
    // L'importo va SEMPRE con la sua valuta, e la valuta può mancare: in quel
    // caso non si scrive CHF (§20).
    amount: num(r.amount),
    currency: str(r.amount_currency),
    amountCorrectedByPerson: r.amount_corrected === true,
    analysisState: str(r.analysis_status),
    confidence: str(r.confidence),
    source: str(r.source_type),
    excerpt: str(r.snippet) ? truncate(String(r.snippet).replace(/\[\[|\]\]/g, ''), 220) : null,
  };
}

/**
 * §23/§24 — quanto è affidabile la testata di un documento.
 * Una correzione umana su uno qualsiasi dei campi porta la riga al primo
 * livello; altrimenti resta un'estrazione, e se l'analisi chiede una verifica
 * la riga è dichiaratamente non confermata.
 */
function documentVerification(r: Record<string, unknown>): SourceVerification {
  if (r.sender_corrected === true || r.deadline_corrected === true
    || r.amount_corrected === true || r.document_type_corrected === true) return 'human_verified';
  if (str(r.analysis_status) === 'needs_review' || r.deadline_requires_verification === true) return 'ai_unverified';
  return 'ai_with_evidence';
}

function documentSource(r: Record<string, unknown>, ref: string): AssistantSourceReference {
  return mkSource(ref, {
    sourceType: 'document', sourceId: String(r.id), route: ROUTES.document(String(r.id)),
    title: str(r.title) ?? 'Documento',
    subtitle: [str(r.sender), str(r.document_date)].filter(Boolean).join(' · ') || null,
    verification: documentVerification(r),
    sourceVersion: str(r.analysis_id),
    valueSnapshot: {
      sender: str(r.sender), deadline: str(r.deadline),
      amount: num(r.amount), currency: str(r.amount_currency),
    },
  });
}

const searchDocuments: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const limit = clampLimit(input.limit, ASSISTANT_LIMITS.maxRowsPerTool, 10);
  const range = resolveRange({ period: input.period, from: input.from, to: input.to }, ctx.now, ctx.timeZone);

  const res = await db.rpc('list_documents', {
    p_company_id: ctx.companyId,
    p_query: str(input.query),
    p_category: str(input.category),
    p_state: str(input.state),
    p_date_from: range?.from ?? null,
    p_date_to: range?.to ?? null,
    p_has_deadline: input.hasDeadline === true,
    p_sort: 'recent',
    p_limit: limit,
  });
  if (res.error) return failed(res.error);

  const list = rows(res.data);
  if (!list.length) {
    return { ...emptyResult('Nessun documento corrisponde a questa ricerca fra quelli accessibili.'), totalCount: 0 };
  }
  const total = int(list[0].total_count);

  const out: Record<string, unknown>[] = [];
  const sources: AssistantSourceReference[] = [];
  for (const r of list) {
    const ref = deps.allocRef();
    out.push(documentRow(r, ref));
    sources.push(documentSource(r, ref));
  }
  const gref = deps.allocRef();
  sources.push(groupSource(
    gref, 'document', ROUTES.documents(str(input.query) ?? undefined), 'Documenti trovati',
    list.map((r) => ({ id: String(r.id), title: str(r.title) ?? 'Documento', route: ROUTES.document(String(r.id)) })),
    'deterministic',
  ));

  return {
    status: 'ok', rows: out, sources, totalCount: total, truncated: total > list.length,
    note: `Riferimento per l'elenco: ${gref}.` +
      (total > list.length ? ` Ne esistono ${total}, ne vedi ${list.length}.` : '') +
      ' I valori mostrati sono quelli effettivi: dove una persona ha corretto, vedi la correzione.',
  };
};

const getDocumentDetails: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const id = str(input.documentId);
  if (!id) return failed({ code: 'missing_id' });

  const res = await db.rpc('list_documents', { p_company_id: ctx.companyId, p_document_id: id, p_limit: 1 });
  if (res.error) return failed(res.error);
  const r = rows(res.data)[0];
  if (!r) return emptyResult('Nessun documento con questo identificativo fra quelli accessibili.');

  const ref = deps.allocRef();
  return { status: 'ok', rows: [documentRow(r, ref)], sources: [documentSource(r, ref)] };
};

/**
 * §62 — le citazioni testuali.
 *
 * Il testo viene DA `document_analyses`, dove la pipeline lo ha già verificato
 * contro il documento estratto: una citazione che non si ritrovava nel testo è
 * stata scartata a monte. Qui non si verifica di nuovo — si riporta ciò che è
 * già stato verificato, e il modello non ha modo di riscriverlo perché non è
 * lui a comporre la fonte.
 */
const getDocumentEvidence: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const id = str(input.documentId);
  if (!id) return failed({ code: 'missing_id' });
  const wanted = str(input.field) ?? 'all';

  const [anaRes, docRes] = await Promise.all([
    db.from('document_analyses')
      .select('id, sender, sender_evidence, deadline, deadline_evidence, amount, amount_currency, amount_evidence, ' +
              'document_type, analysis_status, created_at')
      .eq('document_id', id).eq('company_id', ctx.companyId)
      .not('analysis_status', 'eq', 'failed')
      .order('created_at', { ascending: false }).limit(1),
    db.rpc('list_documents', { p_company_id: ctx.companyId, p_document_id: id, p_limit: 1 }),
  ]);
  if (anaRes.error) return failed(anaRes.error);
  const a = rows(anaRes.data)[0];
  if (!a) return emptyResult('Questo documento non ha un\'analisi con citazioni.');

  const doc = rows(docRes.data)[0] ?? {};
  const docTitle = str(doc.title) ?? 'Documento';
  const corrected = {
    sender: doc.sender_corrected === true,
    deadline: doc.deadline_corrected === true,
    amount: doc.amount_corrected === true,
  };

  const fields: { field: string; value: unknown; evidence: unknown }[] = [
    { field: 'sender', value: str(a.sender), evidence: a.sender_evidence },
    { field: 'deadline', value: str(a.deadline), evidence: a.deadline_evidence },
    { field: 'amount', value: num(a.amount), evidence: a.amount_evidence },
  ].filter((f) => wanted === 'all' || f.field === wanted);

  const out: Record<string, unknown>[] = [];
  const sources: AssistantSourceReference[] = [];
  for (const f of fields) {
    const ev = f.evidence as { quote?: unknown; pageNumber?: unknown } | null;
    const quote = str(ev?.quote);
    if (!quote) continue;
    const page = num(ev?.pageNumber);
    const ref = deps.allocRef();
    const wasCorrected = (corrected as Record<string, boolean>)[f.field] === true;
    out.push({
      ref,
      field: f.field,
      valueFromAnalysis: f.value,
      // Se una persona ha corretto il campo, la citazione resta la prova di che
      // cosa il DOCUMENTO dice — non del valore in vigore. Dirlo è §26.
      correctedByPerson: wasCorrected,
      quote,
      page,
      currency: f.field === 'amount' ? str(a.amount_currency) : undefined,
    });
    sources.push(mkSource(ref, {
      sourceType: 'document_evidence', sourceId: id, route: ROUTES.document(id),
      title: `${docTitle} — ${f.field}`,
      subtitle: page ? `pagina ${page}` : null,
      evidenceId: String(a.id), pageNumber: page, fieldName: f.field, citedText: quote,
      verification: wasCorrected ? 'human_verified' : 'ai_with_evidence',
      sourceVersion: String(a.id),
      valueSnapshot: { value: f.value },
    }));
  }

  if (!out.length) return emptyResult('L\'analisi di questo documento non ha citazioni verificate per i campi richiesti.');
  return {
    status: 'ok', rows: out, sources,
    note: 'Le citazioni sono testo del documento, già verificato contro l\'originale. Riportalo, non riscriverlo. ' +
      'Se la citazione è in un\'altra lingua, mostrala così com\'è e spiega a parte.',
  };
};

const getDocumentEmailOrigin: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const id = str(input.documentId);
  if (!id) return failed({ code: 'missing_id' });

  const res = await db.from('email_message_documents')
    .select('email_message_id, relation, email_messages(id, subject, sender_name, sender_email, received_at, ' +
            'attention_status, email_connections(email_address))')
    .eq('document_id', id).eq('company_id', ctx.companyId)
    .order('created_at', { ascending: false }).limit(10);
  if (res.error) return failed(res.error);

  const list = rows(res.data);
  if (!list.length) {
    return emptyResult('Questo documento non risulta arrivato da un messaggio email fra quelli accessibili. ' +
      'Può essere stato caricato a mano.');
  }

  const out: Record<string, unknown>[] = [];
  const sources: AssistantSourceReference[] = [];
  for (const link of list) {
    const m = link.email_messages as Record<string, unknown> | null;
    if (!m) continue;
    const conn = m.email_connections as Record<string, unknown> | null;
    const ref = deps.allocRef();
    out.push({
      ref,
      subject: str(m.subject),
      senderName: str(m.sender_name),
      senderEmail: str(m.sender_email),
      receivedAt: str(m.received_at),
      mailbox: str(conn?.email_address),
      // Il documento è nato dal corpo o da un allegato: cambia la risposta a
      // «da quale email è arrivata questa fattura».
      arrivedAs: str(link.relation),
    });
    sources.push(mkSource(ref, {
      sourceType: 'email_message', sourceId: String(m.id), route: ROUTES.email(String(m.id)),
      title: str(m.subject) ?? 'Messaggio senza oggetto',
      subtitle: [str(m.sender_name) ?? str(m.sender_email), str(m.received_at)].filter(Boolean).join(' · ') || null,
      verification: 'deterministic',
      valueSnapshot: { sender: str(m.sender_email), receivedAt: str(m.received_at) },
    }));
  }
  if (!out.length) return emptyResult('Il collegamento esiste ma il messaggio non è più accessibile.');
  return { status: 'ok', rows: out, sources,
    note: list.length > 1 ? 'Lo stesso documento è collegato a più messaggi: succede quando lo stesso file arriva due volte.' : undefined };
};

// ===========================================================================
// POSTA
//
// ⚠️ NESSUNA COLONNA DEL CORPO. `body_text`, `body_clean`, `body_preview`,
// `body_links` e la colonna generata `search_text` — che contiene
// `body_preview` in chiaro — non compaiono in nessuna select di questa
// sezione. §74 chiede il minimo necessario, e il corpo di una email non lo è
// per rispondere a «che cosa è arrivato».
// ===========================================================================

const EMAIL_SAFE_COLUMNS =
  'id, subject, sender_name, sender_email, received_at, attention_status, relevance, ' +
  'has_attachments, attachment_count, is_bulk, seen_at, handled_at, analysis_deadline';

const listInboxMessages: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const limit = clampLimit(input.limit, ASSISTANT_LIMITS.maxRowsPerTool, 10);
  const range = resolveRange({ period: input.period, from: input.from, to: input.to }, ctx.now, ctx.timeZone);

  let q = db.from('email_messages').select(EMAIL_SAFE_COLUMNS).eq('company_id', ctx.companyId);
  const attention = str(input.attention);
  if (attention) q = q.eq('attention_status', attention);
  const sender = str(input.sender);
  // I caratteri jolly di `ilike` si neutralizzano: chi cerca «100%» cerca
  // «100%», non «100» seguito da qualunque cosa.
  if (sender) q = q.ilike('sender_email', `%${sender.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if (range) q = q.gte('received_at', `${range.from}T00:00:00Z`).lte('received_at', `${range.to}T23:59:59Z`);

  const res = await q.order('received_at', { ascending: false }).limit(limit);
  if (res.error) {
    // Un mittente che non corrisponde per nome ma per indirizzo, o viceversa:
    // si riprova sul nome prima di dichiarare vuoto.
    return failed(res.error);
  }
  let list = rows(res.data);

  if (!list.length && sender) {
    // ⚠️ L'intervallo si riapplica anche qui. Senza, una domanda con un periodo
    // («messaggi di Swisscom di luglio») che non trova nulla sull'indirizzo
    // ripiegherebbe sul nome SENZA filtro di data, e restituirebbe messaggi di
    // mesi diversi da quello chiesto — con la data giusta accanto, quindi in
    // un modo che nessuno rilegge.
    let altQ = db.from('email_messages').select(EMAIL_SAFE_COLUMNS)
      .eq('company_id', ctx.companyId)
      .ilike('sender_name', `%${sender.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    if (attention) altQ = altQ.eq('attention_status', attention);
    if (range) altQ = altQ.gte('received_at', `${range.from}T00:00:00Z`).lte('received_at', `${range.to}T23:59:59Z`);
    const alt = await altQ.order('received_at', { ascending: false }).limit(limit);
    if (!alt.error) list = rows(alt.data);
  }

  if (!list.length) return { ...emptyResult('Nessun messaggio corrisponde a questi filtri.'), totalCount: 0 };

  const out: Record<string, unknown>[] = [];
  const sources: AssistantSourceReference[] = [];
  for (const m of list) {
    const ref = deps.allocRef();
    out.push({
      ref,
      subject: str(m.subject),
      senderName: str(m.sender_name),
      senderEmail: str(m.sender_email),
      receivedAt: str(m.received_at),
      attention: str(m.attention_status),
      hasAttachments: m.has_attachments === true,
      attachmentCount: int(m.attachment_count),
      bulk: m.is_bulk === true,
    });
    sources.push(mkSource(ref, {
      sourceType: 'email_message', sourceId: String(m.id), route: ROUTES.email(String(m.id)),
      title: str(m.subject) ?? 'Messaggio senza oggetto',
      subtitle: [str(m.sender_name) ?? str(m.sender_email), str(m.received_at)].filter(Boolean).join(' · ') || null,
      verification: 'deterministic',
      valueSnapshot: { sender: str(m.sender_email), receivedAt: str(m.received_at) },
    }));
  }
  const gref = deps.allocRef();
  sources.push(groupSource(gref, 'email_message', ROUTES.inbox(), 'Messaggi trovati',
    list.map((m) => ({ id: String(m.id), title: str(m.subject) ?? 'Messaggio', route: ROUTES.email(String(m.id)) })),
    'deterministic'));

  return { status: 'ok', rows: out, sources, totalCount: out.length,
    note: `Il corpo dei messaggi non è disponibile: rispondi su mittente, oggetto e data. Riferimento per l'elenco: ${gref}.` };
};

const getEmailDetails: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const id = str(input.messageId);
  if (!id) return failed({ code: 'missing_id' });

  const [msgRes, docsRes] = await Promise.all([
    db.from('email_messages').select(EMAIL_SAFE_COLUMNS)
      .eq('id', id).eq('company_id', ctx.companyId).maybeSingle(),
    db.from('email_message_documents')
      .select('document_id, relation, documents(id, title, status)')
      .eq('email_message_id', id).limit(20),
  ]);
  if (msgRes.error) return failed(msgRes.error);
  const m = msgRes.data as Record<string, unknown> | null;
  if (!m) return emptyResult('Nessun messaggio con questo identificativo fra quelli accessibili.');

  const linked = rows(docsRes.data).map((l) => {
    const d = l.documents as Record<string, unknown> | null;
    return d ? { title: str(d.title), arrivedAs: str(l.relation) } : null;
  }).filter(Boolean);

  const ref = deps.allocRef();
  return {
    status: 'ok',
    rows: [{
      ref,
      subject: str(m.subject),
      senderName: str(m.sender_name),
      senderEmail: str(m.sender_email),
      receivedAt: str(m.received_at),
      attention: str(m.attention_status),
      attachmentCount: int(m.attachment_count),
      documentsFromThisMessage: linked,
    }],
    sources: [mkSource(ref, {
      sourceType: 'email_message', sourceId: id, route: ROUTES.email(id),
      title: str(m.subject) ?? 'Messaggio senza oggetto',
      subtitle: [str(m.sender_name) ?? str(m.sender_email), str(m.received_at)].filter(Boolean).join(' · ') || null,
      verification: 'deterministic',
      valueSnapshot: { sender: str(m.sender_email), receivedAt: str(m.received_at) },
    })],
    note: 'Il corpo del messaggio non è disponibile.',
  };
};

// ===========================================================================
// FINANZE
// ===========================================================================

function financeRow(r: Record<string, unknown>, ref: string, today: string) {
  const due = str(r.due_date);
  const flags = Array.isArray(r.quality_flags) ? (r.quality_flags as string[]) : [];
  const corrected = Array.isArray(r.corrected_fields) ? (r.corrected_fields as string[]) : [];
  return {
    ref,
    type: str(r.type),
    supplier: str(r.supplier_name),
    invoiceNumber: str(r.invoice_number),
    invoiceDate: str(r.invoice_date),
    dueDate: due,
    // §76 — «scadenza superata», non «non pagata». La distinzione è nel nome
    // del campo, non solo nella prosa del prompt.
    dueDatePassed: !!due && due < today,
    amount: num(r.gross_amount),
    currency: str(r.currency),
    reviewStatus: str(r.review_status),
    correctedFieldsByPerson: corrected,
    issues: flags,
    duplicateSuspected: r.duplicate_suspected === true,
    duplicateCount: int(r.duplicate_count),
    documentTitle: str(r.document_title),
  };
}

/** §23 — una correzione umana su un campo porta la voce al primo livello. */
function financeVerification(r: Record<string, unknown>): SourceVerification {
  const corrected = Array.isArray(r.corrected_fields) ? (r.corrected_fields as string[]) : [];
  if (corrected.length) return 'human_verified';
  if (str(r.review_status) === 'ready') return 'human_verified';
  return 'ai_unverified';
}

function financeSource(r: Record<string, unknown>, ref: string): AssistantSourceReference {
  return mkSource(ref, {
    sourceType: 'finance_item', sourceId: String(r.id), route: ROUTES.finance(String(r.id)),
    title: [str(r.supplier_name), str(r.invoice_number)].filter(Boolean).join(' · ') || (str(r.document_title) ?? 'Voce finanziaria'),
    subtitle: str(r.due_date) ? `scadenza ${str(r.due_date)}` : str(r.invoice_date),
    verification: financeVerification(r),
    sourceVersion: str(r.extraction_id),
    valueSnapshot: {
      amount: num(r.gross_amount), currency: str(r.currency),
      dueDate: str(r.due_date), reviewStatus: str(r.review_status),
    },
  });
}

const listFinanceItems: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const limit = clampLimit(input.limit, ASSISTANT_LIMITS.maxRowsPerTool, 10);
  const dueRange = resolveRange({ period: input.duePeriod, from: input.dueFrom, to: input.dueTo }, ctx.now, ctx.timeZone);
  const type = str(input.type);

  const res = await db.rpc('list_finance_items', {
    p_company_id: ctx.companyId,
    // La RPC divide in due sezioni: le fatture di fornitori da una parte, le
    // ricevute dall'altra. Il tipo esatto si filtra dopo, perché `p_tab` non
    // distingue nota di credito da fattura.
    p_tab: type === 'receipt' ? 'expenses' : type ? 'invoices' : null,
    p_review: str(input.review),
    p_supplier: str(input.supplier),
    p_currency: str(input.currency)?.toUpperCase() ?? null,
    p_due_from: dueRange?.from ?? null,
    p_due_to: dueRange?.to ?? null,
    p_duplicates: input.onlyDuplicates === true,
    p_flagged: input.onlyFlagged === true,
    p_sort: str(input.sort) ?? 'default',
    p_limit: type ? Math.min(limit * 2, 100) : limit,
  });
  if (res.error) return failed(res.error);

  let list = rows(res.data);
  const total = list.length ? int(list[0].total_count) : 0;
  if (type) list = list.filter((r) => str(r.type) === type);
  list = list.slice(0, limit);
  if (!list.length) return { ...emptyResult('Nessuna voce finanziaria corrisponde a questi filtri.'), totalCount: 0 };

  const today = todayIn(ctx.now, ctx.timeZone);
  const out: Record<string, unknown>[] = [];
  const sources: AssistantSourceReference[] = [];
  for (const r of list) {
    const ref = deps.allocRef();
    out.push(financeRow(r, ref, today));
    sources.push(financeSource(r, ref));
  }
  const gref = deps.allocRef();
  const listParams = [
    str(input.review) ? `verifica=${str(input.review)}` : '',
    input.onlyDuplicates === true ? 'duplicati=1' : '',
    input.onlyFlagged === true ? 'segnalati=1' : '',
  ].filter(Boolean).join('&');
  sources.push(groupSource(
    gref, 'finance_item', ROUTES.financeList(listParams || undefined), 'Voci finanziarie trovate',
    list.map((r) => ({
      id: String(r.id),
      title: [str(r.supplier_name), str(r.invoice_number)].filter(Boolean).join(' · ') || 'Voce',
      route: ROUTES.finance(String(r.id)),
    })),
    'deterministic',
  ));

  // Totali PER VALUTA, calcolati qui in codice e non dal modello (§19, §20).
  const byCurrency = new Map<string, { amount: number; count: number }>();
  let withoutCurrency = 0;
  for (const r of list) {
    const c = str(r.currency); const a = num(r.gross_amount);
    if (!c || a == null) { withoutCurrency++; continue; }
    const acc = byCurrency.get(c) ?? { amount: 0, count: 0 };
    acc.amount += a; acc.count++; byCurrency.set(c, acc);
  }

  return {
    status: 'ok', rows: out, sources, totalCount: total, truncated: total > list.length,
    note: `Oggi è ${today}. Riferimento per l'elenco: ${gref}. ` +
      `Totali di queste righe per valuta (già calcolati, non rifarli): ` +
      `${[...byCurrency].map(([c, v]) => `${c} ${v.amount.toFixed(2)} su ${v.count} voci`).join('; ') || 'nessuno'}` +
      (withoutCurrency ? `; ${withoutCurrency} voci senza importo o senza valuta` : '') + '. ' +
      'NON sommare valute diverse.' +
      (total > list.length ? ` Ne esistono ${total}, ne vedi ${list.length}.` : ''),
  };
};

const getFinanceItemDetails: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const id = str(input.itemId);
  if (!id) return failed({ code: 'missing_id' });

  const res = await db.rpc('list_finance_items', { p_company_id: ctx.companyId, p_item_id: id, p_limit: 1 });
  if (res.error) return failed(res.error);
  const r = rows(res.data)[0];
  if (!r) return emptyResult('Nessuna voce finanziaria con questo identificativo fra quelle accessibili.');

  // La provenienza campo per campo: codice QR, lettura deterministica o AI.
  let provenance: Record<string, unknown> | null = null;
  const exId = str(r.extraction_id);
  if (exId) {
    const ex = await db.from('finance_extractions')
      .select('field_sources, qr_present, qr_valid, document_language, quality_flags')
      .eq('id', exId).eq('company_id', ctx.companyId).maybeSingle();
    const e = ex.data as Record<string, unknown> | null;
    if (e) {
      provenance = {
        fieldSources: e.field_sources ?? null,
        qrCodeRead: e.qr_present === true && e.qr_valid === true,
        documentLanguage: str(e.document_language),
      };
    }
  }

  const today = todayIn(ctx.now, ctx.timeZone);
  const ref = deps.allocRef();
  const base = financeRow(r, ref, today);
  return {
    status: 'ok',
    rows: [{
      ...base,
      netAmount: num(r.net_amount),
      vatAmount: num(r.vat_amount),
      paymentReference: str(r.payment_reference) ? 'presente' : null,
      iban: str(r.iban) ? 'presente' : null,
      provenance,
    }],
    sources: [financeSource(r, ref)],
    note: 'Il riferimento di pagamento e l\'IBAN esistono ma non vengono mostrati: non servono a rispondere ' +
      'e sono i due campi su cui un documento contraffatto punta.',
  };
};

const getFinanceSummary: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const dueDays = clampLimit(input.dueDays, 90, 7);
  const res = await db.rpc('finance_summary', { p_company_id: ctx.companyId, p_due_days: dueDays });
  if (res.error) return failed(res.error);

  const list = rows(res.data);
  const bucket = (name: string) => list.filter((r) => r.bucket === name);
  const money = (name: string) => bucket(name).map((r) => ({
    currency: str(r.currency), count: int(r.n), total: num(r.total),
  }));

  const ref = deps.allocRef();
  const today = todayIn(ctx.now, ctx.timeZone);
  return {
    status: 'ok',
    rows: [{
      ref,
      today,
      needsReviewCount: int(bucket('needs_review')[0]?.n ?? 0),
      dueWithinDays: dueDays,
      dueSoonByCurrency: money('due_soon'),
      overdueByCurrency: money('overdue'),
      expensesThisMonthByCurrency: money('expenses_month'),
    }],
    sources: [mkSource(ref, {
      sourceType: 'finance_item', sourceId: null, route: ROUTES.financeList(),
      title: 'Totali finanziari', subtitle: `finestra di ${dueDays} giorni`,
      verification: 'deterministic', groupSize: 1, sourceIds: [],
      valueSnapshot: { day: today, dueDays },
    })],
    note: 'Una riga per valuta. Le voci senza valuta sono CONTATE ma senza totale: non attribuirle ai franchi. ' +
      'Le note di credito sono escluse da «in scadenza» e «scaduto». «Scaduto» = data passata, non «non pagato».',
  };
};

const getFinanceDuplicates: Executor = async (input, deps) => {
  const { db } = deps;
  const id = str(input.itemId);
  if (!id) return failed({ code: 'missing_id' });

  const res = await db.rpc('finance_duplicates', { p_item_id: id });
  if (res.error) return failed(res.error);
  const list = rows(res.data);
  if (!list.length) return emptyResult('Nessun'+'a altra voce con lo stesso fornitore, numero, importo e valuta.');

  const out: Record<string, unknown>[] = [];
  const sources: AssistantSourceReference[] = [];
  for (const r of list) {
    const ref = deps.allocRef();
    out.push({
      ref, supplier: str(r.supplier_name), invoiceNumber: str(r.invoice_number),
      invoiceDate: str(r.invoice_date), amount: num(r.gross_amount), currency: str(r.currency),
      reviewStatus: str(r.review_status),
    });
    sources.push(mkSource(ref, {
      sourceType: 'finance_item', sourceId: String(r.id), route: ROUTES.finance(String(r.id)),
      title: [str(r.supplier_name), str(r.invoice_number)].filter(Boolean).join(' · ') || 'Voce finanziaria',
      subtitle: str(r.invoice_date),
      verification: str(r.review_status) === 'ready' ? 'human_verified' : 'ai_unverified',
      valueSnapshot: { amount: num(r.gross_amount), currency: str(r.currency) },
    }));
  }
  return { status: 'ok', rows: out, sources,
    note: 'Sono SOSPETTI calcolati su fornitore, numero, importo e valuta identici. Non è una dichiarazione ' +
      'che siano duplicati: due fatture possono legittimamente coincidere su quei quattro campi.' };
};

// ===========================================================================
// CONTRATTI
// ===========================================================================

function contractRow(r: Record<string, unknown>, ref: string, deps: ExecutorDeps) {
  return {
    ref,
    name: str(r.display_name),
    counterparty: str(r.counterparty_name),
    contractType: str(r.contract_type),
    owner: memberName(deps, r.owner_user_id),
    reviewStatus: str(r.review_status),
    lifecycle: str(r.lifecycle_status),
    // ⚠️ Il campo può arrivare NULL quando non esiste alcuna versione dei
    // termini: NULL significa bozza, non «verificata». È la stessa lettura del
    // servizio dell'applicazione (`terms_are_draft !== false`).
    termsAreDraft: r.terms_are_draft !== false,
    startDate: str(r.start_date),
    endDate: str(r.end_date),
    endDateKind: str(r.end_date_kind),
    autoRenewal: str(r.auto_renewal),
    noticePeriod: num(r.notice_period_value) != null
      ? { value: num(r.notice_period_value), unit: str(r.notice_period_unit), anchor: str(r.notice_anchor) }
      : null,
    nextRenewalDate: str(r.next_renewal_date),
    nextRenewalStatus: str(r.next_renewal_status),
    nextNoticeDate: str(r.next_notice_date),
    nextNoticeStatus: str(r.next_notice_status),
    cost: num(r.cost_amount) != null
      ? { amount: num(r.cost_amount), currency: str(r.cost_currency), frequency: str(r.cost_frequency) }
      : null,
    issues: Array.isArray(r.quality_flags) ? r.quality_flags : [],
  };
}

function contractSource(r: Record<string, unknown>, ref: string): AssistantSourceReference {
  return mkSource(ref, {
    sourceType: 'contract', sourceId: String(r.id), route: ROUTES.contract(String(r.id)),
    title: str(r.display_name) ?? 'Contratto',
    subtitle: str(r.counterparty_name),
    // §79 — i termini in bozza sono una PROPOSTA. Il livello lo dice.
    verification: r.terms_are_draft === false ? 'human_verified' : 'ai_unverified',
    sourceVersion: str(r.term_version_id),
    valueSnapshot: {
      counterparty: str(r.counterparty_name),
      nextRenewalDate: str(r.next_renewal_date),
      nextNoticeDate: str(r.next_notice_date),
      termsAreDraft: r.terms_are_draft !== false,
    },
  });
}

/**
 * Il titolo dell'elenco dice QUALE elenco.
 *
 * ⚠️ Una stessa domanda passa spesso due volte da qui con filtri diversi — «da
 * verificare» e «preavvisi in scadenza» — e con un titolo unico ne uscivano due
 * schede fonte identiche in tutto tranne un parametro invisibile
 * nell'indirizzo (visto a schermo il 2026-07-30). Il titolo è ciò che l'utente
 * legge: deve distinguere ciò che le due letture hanno davvero cercato.
 * Le viste sono quelle dichiarate nel registro degli strumenti.
 */
export function contractsGroupTitle(view: string): string {
  switch (view) {
    case 'needs_review': return 'Contratti da verificare';
    case 'active': return 'Contratti attivi';
    case 'renewals': return 'Contratti in rinnovo';
    case 'notices': return 'Contratti con preavviso in scadenza';
    default: return 'Contratti trovati';
  }
}

const listContracts: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const limit = clampLimit(input.limit, ASSISTANT_LIMITS.maxRowsPerTool, 10);
  const windowDays = clampLimit(input.windowDays, 365, 90);
  const view = str(input.view) ?? 'all';

  const res = await db.rpc('list_contracts', {
    p_company_id: ctx.companyId,
    p_view: view,
    p_query: str(input.query),
    p_type: str(input.contractType),
    p_without_owner: input.withoutOwner === true,
    p_window_days: windowDays,
    p_sort: 'default',
    p_limit: limit,
  });
  if (res.error) return failed(res.error);

  const list = rows(res.data);
  if (!list.length) return { ...emptyResult('Nessun contratto corrisponde a questi filtri.'), totalCount: 0 };
  const total = int(list[0].total_count);

  const out: Record<string, unknown>[] = [];
  const sources: AssistantSourceReference[] = [];
  for (const r of list) {
    const ref = deps.allocRef();
    out.push(contractRow(r, ref, deps));
    sources.push(contractSource(r, ref));
  }
  const gref = deps.allocRef();
  sources.push(groupSource(
    gref, 'contract', ROUTES.contracts(view !== 'all' ? view : undefined), contractsGroupTitle(view),
    list.map((r) => ({ id: String(r.id), title: str(r.display_name) ?? 'Contratto', route: ROUTES.contract(String(r.id)) })),
    'deterministic',
  ));

  return {
    status: 'ok', rows: out, sources, totalCount: total, truncated: total > list.length,
    note: `Finestra applicata: ${windowDays} giorni. Riferimento per l'elenco: ${gref}. ` +
      'Per ogni contratto dichiara se i termini sono verificati o ancora una bozza. ' +
      'Riporta che cosa il contratto dice; non dire che cosa si deve fare per legge.',
  };
};

const getContractDetails: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const id = str(input.contractId);
  if (!id) return failed({ code: 'missing_id' });

  const res = await db.rpc('list_contracts', { p_company_id: ctx.companyId, p_contract_id: id, p_limit: 1 });
  if (res.error) return failed(res.error);
  const r = rows(res.data)[0];
  if (!r) return emptyResult('Nessun contratto con questo identificativo fra quelli accessibili.');

  const ref = deps.allocRef();
  const row = contractRow(r, ref, deps);
  return {
    status: 'ok',
    rows: [{
      ...row,
      documentCount: int(r.document_count),
      amendmentCount: int(r.amendment_count),
      openTaskCount: int(r.open_task_count),
      hasPendingDraft: !!r.pending_draft_id,
      noticeAnchorText: str(r.notice_anchor_text),
      terminationMethod: str(r.termination_method),
    }],
    sources: [contractSource(r, ref)],
    note: row.termsAreDraft
      ? 'ATTENZIONE: i termini di questo contratto sono una BOZZA proposta dal sistema e non sono stati ' +
        'verificati da una persona. Dichiaralo nella risposta.'
      : 'I termini di questo contratto sono stati verificati da una persona.',
  };
};

const listContractMilestones: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const id = str(input.contractId);
  if (!id) return failed({ code: 'missing_id' });
  const wanted = str(input.status) ?? 'all';

  const [msRes, cRes] = await Promise.all([
    db.from('contract_milestones')
      .select('id, kind, due_date, source, status, calculation, calculation_inputs, label, term_version_id')
      .eq('contract_id', id).eq('company_id', ctx.companyId)
      .order('due_date').limit(20),
    db.rpc('list_contracts', { p_company_id: ctx.companyId, p_contract_id: id, p_limit: 1 }),
  ]);
  if (msRes.error) return failed(msRes.error);

  const contract = rows(cRes.data)[0] ?? {};
  const contractName = str(contract.display_name) ?? 'Contratto';
  let list = rows(msRes.data).filter((m) => str(m.status) !== 'superseded' && str(m.status) !== 'dismissed');
  if (wanted !== 'all') list = list.filter((m) => str(m.status) === wanted);
  if (!list.length) return emptyResult('Nessuna data registrata per questo contratto.');

  const out: Record<string, unknown>[] = [];
  const sources: AssistantSourceReference[] = [];
  for (const m of list) {
    const ref = deps.allocRef();
    const verified = str(m.status) === 'verified';
    out.push({
      ref,
      kind: str(m.kind),
      date: str(m.due_date),
      // §79 — «candidate» è una PROPOSTA, non una scadenza certa.
      verified,
      state: verified ? 'verificata da una persona' : 'proposta dal sistema, non verificata',
      origin: str(m.source),
      calculatedFrom: str(m.calculation) ? m.calculation_inputs ?? null : null,
      label: str(m.label),
    });
    sources.push(mkSource(ref, {
      sourceType: 'contract_milestone', sourceId: String(m.id), route: ROUTES.contract(id),
      title: `${contractName} — ${str(m.kind) ?? 'data'}`,
      subtitle: str(m.due_date),
      fieldName: str(m.kind),
      verification: verified ? 'human_verified' : (str(m.source) === 'derived' ? 'deterministic' : 'ai_unverified'),
      sourceVersion: str(m.term_version_id),
      valueSnapshot: { date: str(m.due_date), status: str(m.status), source: str(m.source) },
    }));
  }
  return { status: 'ok', rows: out, sources,
    note: 'Una data «proposta dal sistema» non è una scadenza confermata: dillo esplicitamente.' };
};

// ===========================================================================
// CLIENTI
//
// ⚠️ `list_crm_organizations` restituisce anche `notes` e `list_crm_opportunities`
// restituisce `lost_reason`: sono testo libero scritto da persone, spesso
// giudizi su altre persone. Non compaiono in nessuna riga costruita qui (§81).
// Non compaiono nemmeno i recapiti dei singoli contatti.
// ===========================================================================

function orgSource(r: Record<string, unknown>, ref: string): AssistantSourceReference {
  const id = String(r.id);
  // Un'organizzazione fusa non sparisce: rimanda al record principale, altrimenti
  // la citazione porterebbe a una scheda archiviata.
  const target = str(r.merged_into_id) ?? id;
  return mkSource(ref, {
    sourceType: 'crm_organization', sourceId: id, route: ROUTES.client(target),
    title: str(r.display_name) ?? 'Organizzazione',
    subtitle: [str(r.city), (r.roles as string[] | null)?.join(', ')].filter(Boolean).join(' · ') || null,
    verification: 'human_verified',
    sourceVersion: str(r.updated_at),
    valueSnapshot: { lastContactAt: str(r.last_contact_at), archived: !!r.archived_at },
  });
}

const searchCrmOrganizations: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const limit = clampLimit(input.limit, ASSISTANT_LIMITS.maxRowsPerTool, 10);

  const res = await db.rpc('list_crm_organizations', {
    p_company_id: ctx.companyId,
    p_query: str(input.query),
    p_role: str(input.role),
    p_stale_days: num(input.staleDays),
    p_only_overdue_tasks: input.onlyOverdueTasks === true,
    p_no_open_opportunity: input.onlyWithoutOpenOpportunity === true,
    p_sort: 'updated',
    p_limit: limit,
  });
  if (res.error) return failed(res.error);
  const list = rows(res.data);
  if (!list.length) return { ...emptyResult('Nessuna organizzazione corrisponde a questa ricerca.'), totalCount: 0 };
  const total = int(list[0].total_count);

  const out: Record<string, unknown>[] = [];
  const sources: AssistantSourceReference[] = [];
  for (const r of list) {
    const ref = deps.allocRef();
    out.push({
      ref,
      name: str(r.display_name),
      legalName: str(r.legal_name),
      roles: r.roles ?? [],
      city: str(r.city),
      canton: str(r.canton),
      relationshipStatus: str(r.relationship_status),
      accountOwner: memberName(deps, r.account_owner_user_id),
      lastContactAt: str(r.last_contact_at),
      openOpportunities: int(r.open_opportunity_count),
      overdueTasks: int(r.overdue_task_count),
      linked: {
        contracts: int(r.contract_count), documents: int(r.document_count),
        emails: int(r.email_count), financeItems: int(r.finance_count),
      },
      mergedInto: str(r.merged_into_id) ? 'questa scheda è stata unita a un\'altra' : null,
    });
    sources.push(orgSource(r, ref));
  }
  const gref = deps.allocRef();
  sources.push(groupSource(gref, 'crm_organization', ROUTES.clients(), 'Organizzazioni trovate',
    list.map((r) => ({ id: String(r.id), title: str(r.display_name) ?? 'Organizzazione', route: ROUTES.client(String(r.id)) })),
    'deterministic'));

  return { status: 'ok', rows: out, sources, totalCount: total, truncated: total > list.length,
    note: `Riferimento per l'elenco: ${gref}. «Ultimo contatto» conta email collegate, telefonate e incontri ` +
      'registrati — non le note. Se manca, non è mai stato registrato un contatto: non dedurne un rischio.' };
};

const getCrmOrganizationDetails: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const id = str(input.organizationId);
  if (!id) return failed({ code: 'missing_id' });

  const res = await db.rpc('list_crm_organizations', { p_company_id: ctx.companyId, p_organization_id: id, p_limit: 1 });
  if (res.error) return failed(res.error);
  const r = rows(res.data)[0];
  if (!r) return emptyResult('Nessuna organizzazione con questo identificativo fra quelle accessibili.');

  const ref = deps.allocRef();
  return {
    status: 'ok',
    rows: [{
      ref,
      name: str(r.display_name),
      legalName: str(r.legal_name),
      uid: str(r.uid_che),
      roles: r.roles ?? [],
      address: [str(r.street), str(r.postal_code), str(r.city), str(r.canton)].filter(Boolean).join(', ') || null,
      website: str(r.website),
      relationshipStatus: str(r.relationship_status),
      accountOwner: memberName(deps, r.account_owner_user_id),
      lastContactAt: str(r.last_contact_at),
      contactCount: int(r.contact_count),
      openOpportunities: int(r.open_opportunity_count),
      wonOpportunities: int(r.won_opportunity_count),
      openTasks: int(r.open_task_count),
      overdueTasks: int(r.overdue_task_count),
      linked: {
        contracts: int(r.contract_count), documents: int(r.document_count),
        emails: int(r.email_count), financeItems: int(r.finance_count),
      },
      archived: !!r.archived_at,
    }],
    sources: [orgSource(r, ref)],
    note: 'Le note interne e i recapiti delle singole persone non sono disponibili, per scelta. ' +
      'Non dedurre giudizi («cliente a rischio») da questi numeri: riporta i fatti.',
  };
};

const listCrmOpportunities: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const limit = clampLimit(input.limit, ASSISTANT_LIMITS.maxRowsPerTool, 15);
  const today = todayIn(ctx.now, ctx.timeZone);

  const res = await db.rpc('list_crm_opportunities', {
    p_company_id: ctx.companyId,
    p_stage: str(input.stage),
    p_organization_id: str(input.organizationId),
    p_only_without_next_step: input.onlyWithoutNextStep === true,
    p_only_overdue_next_step: input.onlyOverdueNextStep === true,
    p_sort: 'updated',
    p_limit: limit,
  });
  if (res.error) return failed(res.error);
  const list = rows(res.data);
  if (!list.length) return { ...emptyResult('Nessuna opportunità corrisponde a questi filtri.'), totalCount: 0 };
  const total = int(list[0].total_count);

  const out: Record<string, unknown>[] = [];
  const sources: AssistantSourceReference[] = [];
  for (const r of list) {
    const ref = deps.allocRef();
    const nextDue = str(r.next_step_due_date);
    out.push({
      ref,
      title: str(r.title),
      organization: str(r.organization_name),
      stage: str(r.stage),
      owner: memberName(deps, r.owner_user_id),
      value: num(r.value_amount) != null ? { amount: num(r.value_amount), currency: str(r.value_currency) } : null,
      expectedCloseDate: str(r.expected_close_date),
      hasNextStep: !!str(r.next_step),
      nextStepDueDate: nextDue,
      nextStepOverdue: !!nextDue && nextDue < today,
      overdueTasks: int(r.overdue_task_count),
    });
    sources.push(mkSource(ref, {
      sourceType: 'crm_opportunity', sourceId: String(r.id),
      route: ROUTES.opportunity(String(r.organization_id), String(r.id)),
      title: str(r.title) ?? 'Opportunità',
      subtitle: str(r.organization_name),
      verification: 'human_verified',
      sourceVersion: str(r.updated_at),
      valueSnapshot: { stage: str(r.stage), nextStepDueDate: nextDue },
    }));
  }
  const gref = deps.allocRef();
  sources.push(groupSource(gref, 'crm_opportunity', ROUTES.clients(), 'Opportunità trovate',
    list.map((r) => ({
      id: String(r.id), title: str(r.title) ?? 'Opportunità',
      route: ROUTES.opportunity(String(r.organization_id), String(r.id)),
    })), 'deterministic'));

  return { status: 'ok', rows: out, sources, totalCount: total, truncated: total > list.length,
    note: `Oggi è ${today}. Riferimento per l'elenco: ${gref}. Nessuna probabilità di chiusura è disponibile: ` +
      'non stimarne una. Non sommare importi di valute diverse.' };
};

const getCrmTimeline: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const id = str(input.organizationId);
  if (!id) return failed({ code: 'missing_id' });
  const limit = clampLimit(input.limit, 20, 10);

  const res = await db.rpc('crm_timeline', { p_company_id: ctx.companyId, p_organization_id: id, p_limit: limit });
  if (res.error) return failed(res.error);
  const list = rows(res.data);
  if (!list.length) return emptyResult('Nessun evento registrato per questa organizzazione.');

  const ref = deps.allocRef();
  return {
    status: 'ok',
    rows: [{
      ref,
      events: list.map((e) => ({
        kind: str(e.kind),
        occurredAt: str(e.occurred_at),
        // `title` per un'interazione è l'oggetto scritto da una persona: si
        // accorcia, non si riporta per intero.
        label: str(e.title) ? truncate(String(e.title), 120) : null,
        entityType: str(e.entity_type),
      })),
    }],
    sources: [mkSource(ref, {
      sourceType: 'crm_organization', sourceId: id, route: ROUTES.client(id),
      title: 'Storico della relazione', verification: 'deterministic',
      groupSize: list.length, sourceIds: [],
      valueSnapshot: { events: list.length, mostRecent: str(list[0]?.occurred_at) },
    })],
    note: 'Il corpo delle email e il testo delle note non sono inclusi.',
  };
};

// ===========================================================================
// AUTOMAZIONI
// ===========================================================================

const listWorkflowFailures: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const limit = clampLimit(input.limit, 20, 10);

  const res = await db.from('workflow_definitions')
    .select('id, name, status, attention_code, attention_at, consecutive_failures, last_run_at, last_run_status')
    .eq('company_id', ctx.companyId)
    .not('attention_code', 'is', null)
    .order('attention_at', { ascending: false })
    .limit(limit);
  if (res.error) return failed(res.error);

  const list = rows(res.data);
  if (!list.length) {
    return emptyResult('Nessuna automazione richiede attenzione: nessuna ha un problema registrato.');
  }

  const out: Record<string, unknown>[] = [];
  const sources: AssistantSourceReference[] = [];
  for (const w of list) {
    const ref = deps.allocRef();
    out.push({
      ref,
      name: str(w.name),
      state: str(w.status),
      pausedBySystem: str(w.status) === 'paused',
      problemCode: str(w.attention_code),
      problemSince: str(w.attention_at),
      consecutiveFailures: int(w.consecutive_failures),
      lastRunAt: str(w.last_run_at),
      lastRunStatus: str(w.last_run_status),
    });
    sources.push(mkSource(ref, {
      sourceType: 'workflow_definition', sourceId: String(w.id), route: ROUTES.workflow(String(w.id)),
      title: str(w.name) ?? 'Automazione',
      subtitle: str(w.attention_code),
      verification: 'deterministic',
      valueSnapshot: { problemCode: str(w.attention_code), failures: int(w.consecutive_failures) },
    }));
  }
  const gref = deps.allocRef();
  sources.push(groupSource(gref, 'workflow_definition', ROUTES.workflows(), 'Automazioni con problemi',
    list.map((w) => ({ id: String(w.id), title: str(w.name) ?? 'Automazione', route: ROUTES.workflow(String(w.id)) })),
    'deterministic'));

  return { status: 'ok', rows: out, sources,
    note: `Riferimento per l'elenco: ${gref}. La configurazione tecnica non è inclusa. ` +
      'Un\'automazione senza esecuzioni non è un\'automazione rotta: un\'esecuzione si registra solo ' +
      'quando le condizioni corrispondono.' };
};

const getWorkflowRunDetails: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const id = str(input.runId);
  if (!id) return failed({ code: 'missing_id' });

  const [runRes, actionsRes] = await Promise.all([
    db.from('workflow_runs')
      .select('id, workflow_id, status, error_code, started_at, finished_at, entity_type')
      .eq('id', id).eq('company_id', ctx.companyId).maybeSingle(),
    db.from('workflow_action_runs')
      .select('action_type, status, error_code').eq('run_id', id).limit(10),
  ]);
  if (runRes.error) return failed(runRes.error);
  const run = runRes.data as Record<string, unknown> | null;
  if (!run) return emptyResult('Nessuna esecuzione con questo identificativo fra quelle accessibili.');

  const wfId = String(run.workflow_id);
  const wf = await db.from('workflow_definitions').select('name')
    .eq('id', wfId).eq('company_id', ctx.companyId).maybeSingle();
  const name = str((wf.data as Record<string, unknown> | null)?.name) ?? 'Automazione';

  const ref = deps.allocRef();
  return {
    status: 'ok',
    rows: [{
      ref,
      automation: name,
      result: str(run.status),
      errorCode: str(run.error_code),
      startedAt: str(run.started_at),
      finishedAt: str(run.finished_at),
      actions: rows(actionsRes.data).map((a) => ({
        action: str(a.action_type), result: str(a.status), errorCode: str(a.error_code),
      })),
    }],
    sources: [mkSource(ref, {
      sourceType: 'workflow_run', sourceId: id, route: ROUTES.workflowRun(wfId, id),
      title: `${name} — esecuzione`, subtitle: str(run.started_at),
      verification: 'deterministic',
      valueSnapshot: { status: str(run.status), errorCode: str(run.error_code) },
    })],
  };
};

// ===========================================================================
// DISAMBIGUAZIONE (§29, §30)
//
// «Mostrami Rossi» può essere Rossi SA, Rossi Sagl o Marco Rossi. Questo
// strumento raccoglie i candidati e li restituisce SENZA sceglierne uno: la
// scelta è dell'utente, e sceglierla al posto suo sarebbe il modo più elegante
// di dare una risposta giusta sull'entità sbagliata.
//
// La ricerca è DETERMINISTICA e non consuma una seconda chiamata al modello
// (§30): tre interrogazioni parallele su tre tabelle, ordinate per esattezza.
// ===========================================================================

const resolveEntity: Executor = async (input, deps) => {
  const { db, ctx } = deps;
  const name = str(input.name);
  if (!name || name.length < 2) return failed({ code: 'missing_name' });

  const [orgs, contracts, finance] = await Promise.all([
    db.rpc('crm_organization_options', { p_company_id: ctx.companyId, p_query: name, p_limit: 8 }),
    db.rpc('list_contracts', { p_company_id: ctx.companyId, p_query: name, p_limit: 8 }),
    db.rpc('list_finance_items', { p_company_id: ctx.companyId, p_supplier: name, p_limit: 8 }),
  ]);

  const out: Record<string, unknown>[] = [];
  const sources: AssistantSourceReference[] = [];
  const seenSuppliers = new Set<string>();
  const norm = (s: string) => s.trim().toLowerCase();

  for (const o of rows(orgs.data)) {
    const ref = deps.allocRef();
    const label = str(o.display_name) ?? 'Organizzazione';
    out.push({
      ref, kind: 'cliente o fornitore', label,
      hint: [(o.roles as string[] | null)?.join(', '), str(o.city)].filter(Boolean).join(' · ') || null,
      exactMatch: norm(label) === norm(name),
    });
    sources.push(mkSource(ref, {
      sourceType: 'crm_organization', sourceId: String(o.id), route: ROUTES.client(String(o.id)),
      title: label, subtitle: str(o.city), verification: 'human_verified',
    }));
  }

  for (const c of rows(contracts.data)) {
    const cp = str(c.counterparty_name);
    if (!cp || !norm(cp).includes(norm(name))) continue;
    const ref = deps.allocRef();
    out.push({
      ref, kind: 'controparte di un contratto',
      label: `${cp} — ${str(c.display_name) ?? 'contratto'}`,
      hint: str(c.contract_type), exactMatch: norm(cp) === norm(name),
    });
    sources.push(mkSource(ref, {
      sourceType: 'contract', sourceId: String(c.id), route: ROUTES.contract(String(c.id)),
      title: str(c.display_name) ?? 'Contratto', subtitle: cp,
      verification: c.terms_are_draft === false ? 'human_verified' : 'ai_unverified',
    }));
  }

  for (const f of rows(finance.data)) {
    const sup = str(f.supplier_name);
    if (!sup) continue;
    const key = norm(sup);
    if (seenSuppliers.has(key)) continue;
    seenSuppliers.add(key);
    const ref = deps.allocRef();
    out.push({
      ref, kind: 'fornitore su una fattura', label: sup,
      hint: str(f.invoice_number) ? `fattura ${str(f.invoice_number)}` : null,
      exactMatch: key === norm(name),
    });
    sources.push(mkSource(ref, {
      sourceType: 'finance_item', sourceId: String(f.id), route: ROUTES.finance(String(f.id)),
      title: sup, subtitle: str(f.invoice_number), verification: 'ai_unverified',
    }));
  }

  if (!out.length) {
    return emptyResult(`Non ho trovato nulla che corrisponda a «${name}» nei dati accessibili. ` +
      'Dì che non l\'hai trovato, non che non esiste.');
  }

  const exact = out.filter((r) => r.exactMatch === true);
  return {
    status: 'ok', rows: out, sources,
    note: exact.length === 1
      ? 'Un solo riscontro esatto: puoi procedere con quello.'
      : `${out.length} candidati e ${exact.length} riscontri esatti. Se resta ambiguo, NON scegliere: ` +
        'rispondi con status «needs_disambiguation» e metti i riferimenti in disambiguationRefs.',
  };
};

// ===========================================================================
// La tavola
// ===========================================================================

export const EXECUTORS: Record<string, Executor> = {
  get_company_overview: getCompanyOverview,
  list_tasks: listTasks,
  list_tasks_by_due_date: listTasksByDueDate,
  get_task_details: getTaskDetails,
  search_documents: searchDocuments,
  get_document_details: getDocumentDetails,
  get_document_evidence: getDocumentEvidence,
  get_document_email_origin: getDocumentEmailOrigin,
  list_inbox_messages: listInboxMessages,
  get_email_details: getEmailDetails,
  list_finance_items: listFinanceItems,
  get_finance_item_details: getFinanceItemDetails,
  get_finance_summary: getFinanceSummary,
  get_finance_duplicates: getFinanceDuplicates,
  list_contracts: listContracts,
  get_contract_details: getContractDetails,
  list_contract_milestones: listContractMilestones,
  search_crm_organizations: searchCrmOrganizations,
  get_crm_organization_details: getCrmOrganizationDetails,
  list_crm_opportunities: listCrmOpportunities,
  get_crm_timeline: getCrmTimeline,
  list_workflow_failures: listWorkflowFailures,
  get_workflow_run_details: getWorkflowRunDetails,
  resolve_entity: resolveEntity,
};

/**
 * §90 — i parametri che finiscono nel registro delle chiamate.
 *
 * Restano i filtri (periodo, stato, tetto di righe); spariscono i testi liberi,
 * perché una ricerca può contenere il nome di una persona e questa tabella è
 * fatta di metriche, non di dati aziendali. Si conserva la LUNGHEZZA del testo
 * cercato: dice se la ricerca era mirata o generica, senza dire che cosa era.
 */
const FREE_TEXT_KEYS = new Set(['query', 'search', 'name', 'supplier', 'sender']);

export function sanitizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (FREE_TEXT_KEYS.has(k)) {
      if (typeof v === 'string' && v.length) out[`${k}Length`] = v.length;
      continue;
    }
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}
