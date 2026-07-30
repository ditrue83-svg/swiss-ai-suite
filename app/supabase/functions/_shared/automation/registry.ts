// ============================================================================
// IL REGISTRO: quali inneschi esistono, quali campi si possono confrontare,
// quali azioni si possono eseguire.
//
// ⚠️ È IL CUORE DELLA SICUREZZA DI QUESTO MODULO, non un elenco di comodo.
// Una condizione può nominare SOLO un campo dichiarato qui, e un'azione può
// essere SOLO una di quelle dichiarate qui. Non esiste alcun percorso in cui
// una stringa scritta da un utente diventi un accesso a una proprietà, una
// query, un'espressione o del codice: i «fatti» sono una mappa piatta con
// chiavi note, e ciò che non è nella mappa non esiste (§20/§23/§105).
//
// ⚠️ NESSUN IMPORT, NESSUNA DIPENDENZA, e va tenuto così.
// Questo file lo leggono tre runtime diversi: il worker (Deno), i test (Node) e
// il BROWSER, che lo importa attraverso `src/features/automations/registry.ts`.
// Un solo `import` verso qualcosa di Deno lo renderebbe non compilabile da
// Vite, e la divergenza si scoprirebbe al deploy.
//
// Le ETICHETTE sono chiavi di traduzione, non testo: nel database vive
// `document_analysis_completed`, e «Quando viene analizzato un documento» è
// solo il modo in cui lo si legge in italiano (§157).
// ============================================================================

// ---------------------------------------------------------------------------
// Tipi di base
// ---------------------------------------------------------------------------

export const AUTOMATION_EVENT_TYPES = [
  'document_analysis_completed',
  'document_category_changed',
  'email_attention_ready',
  'task_created',
  'task_status_changed',
  'task_became_overdue',
  // 0021 — i due inneschi di Finance. L'entità resta il DOCUMENTO: una fattura
  // è una lettura di un documento, e una regola che parla di fatture vuole
  // poter guardare anche la categoria e il mittente di quel documento. Anche
  // per questo `automation_events.entity_type` non ha dovuto cambiare.
  'finance_item_needs_review',
  'finance_item_ready',
  // 0024 — i quattro inneschi dei Contratti. ⚠️ NESSUNO DI ESSI NASCE DA UNA
  // PROPOSTA: si emettono quando una PERSONA ha verificato (§87). Una data
  // calcolata dal prodotto che facesse scattare una regola trasformerebbe un
  // calcolo in un'attività, ed è esattamente ciò che il modulo non deve fare.
  'contract_verified',
  'contract_review_required',
  'contract_milestone_verified',
  'contract_milestone_window_opened',
  // 0026 — i sei inneschi del CRM. Cinque nascono da un trigger sulla tabella;
  // `crm_follow_up_due` lo emette la scansione `crm_emit_follow_up_due`, che
  // gira dentro QUESTO worker a ogni giro, accanto ad `automation_emit_overdue`.
  // Nessun cron nuovo: è la regola scritta nella 0024 riga 2553.
  // ⚠️ NESSUN INNESCO SU «email arrivata da un cliente»: l'abbinamento fra una
  // email e una controparte è un SUGGERIMENTO da confermare (§21), e far
  // scattare una regola su un sospetto significherebbe creare lavoro a partire
  // da un'ipotesi.
  'crm_organization_created',
  'crm_role_added',
  'crm_opportunity_created',
  'crm_opportunity_stage_changed',
  'crm_opportunity_won',
  'crm_follow_up_due',
  // 0032 — i SETTE inneschi degli incentivi. Ognuno ha un produttore vero in
  // quella migrazione: cinque sono trigger sulle tabelle
  // (`subsidy_emit_opportunity` ne emette due, `subsidy_emit_case_status`,
  // `subsidy_emit_call_opened`) e due sono scansioni che girano dentro QUESTO
  // worker (`subsidy_emit_deadline_approaching`,
  // `subsidy_emit_stale_assessments`, `subsidy_emit_source_critical_change`).
  // Nessun cron nuovo, come per il CRM.
  //
  // ⚠️ NESSUN INNESCO SU «un programma sembra rilevante»: la rilevanza la
  //    ricalcola il motore a ogni giro e cambierebbe continuamente. Si scatta
  //    su `subsidy_opportunity_high_relevance`, che è un SUPERAMENTO DI SOGLIA
  //    deduplicato per opportunità — un fatto che accade una volta.
  'subsidy_opportunity_created',
  'subsidy_opportunity_high_relevance',
  'subsidy_call_opened',
  'subsidy_deadline_approaching',
  'subsidy_assessment_became_stale',
  'subsidy_case_status_changed',
  'subsidy_source_critical_change',
] as const;
export type AutomationEventType = (typeof AUTOMATION_EVENT_TYPES)[number];

/**
 * ⚠️ `contract` È UN'ENTITÀ NUOVA, e la 0021 aveva scelto di NON aggiungerne una.
 * La differenza è nel merito: una fattura È la lettura di un documento, e una
 * regola che ne parla vuole poter guardare anche la categoria e il mittente di
 * quel documento. Un contratto ha PIÙ documenti, può non averne nessuno, e le
 * sue date non appartengono ad alcuno di essi: agganciare l'evento all'accordo
 * principale direbbe una cosa falsa nel campo che serve a ritrovare l'entità.
 */
export type AutomationEntityType =
  | 'document' | 'email_message' | 'task' | 'contract'
  // 0026 — DUE entità nuove, e la distinzione è la stessa che vale fra
  // contratto e documento: un'organizzazione è la controparte, un'opportunità è
  // una singola trattativa con quella controparte. Agganciare l'evento di una
  // trattativa all'organizzazione renderebbe impossibile ritrovare DI QUALE
  // trattativa si parla — e sono spesso più di una.
  | 'crm_organization' | 'crm_opportunity'
  // 0032 — DUE entità nuove, e la distinzione è di merito: un'opportunità è
  // l'incontro fra un progetto e una versione di programma e vive e muore con
  // la rivalutazione; una pratica è il lavoro di candidatura e SOPRAVVIVE al
  // cambiamento del catalogo. Agganciare gli eventi della pratica
  // all'opportunità li renderebbe irrecuperabili al primo ricalcolo.
  | 'subsidy_opportunity' | 'subsidy_case';

export type FieldType = 'string' | 'number' | 'enum' | 'date' | 'boolean' | 'user';

/**
 * Gli operatori. Un insieme CHIUSO e piccolo (§21): ognuno di questi è una
 * funzione scritta in `conditions.ts`, non una stringa che finisce dentro
 * un'espressione da valutare.
 *
 * `within_days` esiste solo per le date ed è l'unica forma che serviva davvero
 * (§28): «scade entro trenta giorni». Un confronto con una data ASSOLUTA non è
 * stato aggiunto di proposito — una regola che dice «scadenza prima del
 * 31.12.2026» è giusta per due mesi e sbagliata per sempre dopo.
 */
export const OPERATORS = [
  'equals', 'not_equals', 'contains', 'not_contains', 'starts_with',
  'exists', 'not_exists',
  'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal',
  'in', 'within_days',
] as const;
export type Operator = (typeof OPERATORS)[number];

/** Operatori che non hanno un valore di confronto. */
export const UNARY_OPERATORS: readonly Operator[] = ['exists', 'not_exists'];

/** Quali operatori hanno senso su quale tipo. Fuori da qui, la regola è invalida. */
export const OPERATORS_BY_TYPE: Record<FieldType, readonly Operator[]> = {
  string: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'in', 'exists', 'not_exists'],
  number: ['equals', 'not_equals', 'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal', 'exists', 'not_exists'],
  enum: ['equals', 'not_equals', 'in', 'exists', 'not_exists'],
  // Le date non si confrontano con altre date scritte a mano: si guarda se
  // esistono e fra quanto cadono.
  date: ['exists', 'not_exists', 'within_days'],
  boolean: ['equals'],
  user: ['equals', 'not_equals', 'exists', 'not_exists'],
};

// ---------------------------------------------------------------------------
// Valori di dominio ripetuti
//
// Vengono dal database (enum delle migrazioni 0002/0006/0013/0017) e servono a
// costruire i menu a tendina del generatore. Sono elenchi di CHIAVI: le
// etichette stanno nei dizionari, sotto `labels.*`, che è dove le legge già
// tutto il resto del prodotto.
// ---------------------------------------------------------------------------

export const DOCUMENT_CATEGORIES = [
  'administration', 'taxes', 'social_insurance', 'invoices', 'contracts',
  'insurance', 'banking', 'employees', 'clients', 'suppliers', 'subsidies', 'other',
] as const;

export const DOCUMENT_TYPES = [
  'information', 'request_for_documents', 'payment_request', 'reminder', 'invoice',
  'declaration_request', 'official_decision', 'inspection_notice', 'tax_document',
  'social_insurance', 'employment', 'permit', 'contract_related', 'other',
] as const;

export const AUTHORITY_TYPES = [
  'federal', 'cantonal', 'municipal', 'social_insurance', 'insurance', 'pension',
  'private', 'unknown',
] as const;

export const URGENCY_VALUES = ['alta', 'media', 'bassa'] as const;
export const TASK_PRIORITIES = ['high', 'medium', 'low'] as const;
export const TASK_STATUSES = ['open', 'in_progress', 'waiting', 'completed'] as const;
export const TASK_SOURCES = ['admin_ai', 'subsidy_ai', 'manual'] as const;
export const DOCUMENT_SOURCE_TYPES = ['upload', 'pasted_text', 'email'] as const;
export const EMAIL_RELEVANCE = [
  'likely_actionable', 'possibly_actionable', 'informational', 'clearly_irrelevant',
] as const;
export const EMAIL_ATTENTION = [
  'needs_attention', 'to_verify', 'informational', 'ignored', 'handled',
] as const;
export const CATEGORY_SOURCES = ['rule', 'manual', 'workflow'] as const;

/** Le valute che il prodotto tratta. Nessuna conversione: mai (§27). */
export const CURRENCIES = ['CHF', 'EUR', 'USD'] as const;

// ---------------------------------------------------------------------------
// Campi
// ---------------------------------------------------------------------------

export interface TriggerField {
  /** Chiave del fatto. Piatta e nota: non è un percorso dentro un JSON (§23). */
  path: string;
  type: FieldType;
  labelKey: string;
  /** Dove stanno le etichette dei valori, per i menu a tendina. */
  optionsLabelPath?: string;
  options?: readonly string[];
  /**
   * Il valore viene da un'analisi AI: la sua certezza va valutata prima di
   * trattarlo come un fatto (§25). Una correzione umana lo rende certo (§24).
   */
  aiDerived?: boolean;
  /** Il valore ha una valuta: il confronto la richiede e non converte (§27). */
  hasCurrency?: boolean;
}

export interface TriggerDef {
  key: AutomationEventType;
  entityType: AutomationEntityType;
  /** Versione del contratto dell'evento (§15). */
  version: number;
  labelKey: string;
  descriptionKey: string;
  fields: readonly TriggerField[];
  /** I segnaposto ammessi nei modelli di testo, per questo innesco (§30). */
  templates: readonly string[];
}

// I campi del documento e dell'analisi, condivisi dai due inneschi documentali:
// scritti una volta perché due elenchi «quasi uguali» divergono al primo
// campo aggiunto da una parte sola.
const DOCUMENT_FIELDS: readonly TriggerField[] = [
  { path: 'document.category', type: 'enum', labelKey: 'automations.fields.documentCategory',
    options: DOCUMENT_CATEGORIES, optionsLabelPath: 'labels.categories' },
  { path: 'document.source_type', type: 'enum', labelKey: 'automations.fields.documentSource',
    options: DOCUMENT_SOURCE_TYPES, optionsLabelPath: 'automations.values.documentSource' },
  { path: 'document.title', type: 'string', labelKey: 'automations.fields.documentTitle' },
  { path: 'analysis.document_type', type: 'enum', labelKey: 'automations.fields.documentType',
    options: DOCUMENT_TYPES, optionsLabelPath: 'labels.docTypes', aiDerived: true },
  { path: 'analysis.sender', type: 'string', labelKey: 'automations.fields.sender', aiDerived: true },
  { path: 'analysis.sender_authority_type', type: 'enum', labelKey: 'automations.fields.authorityType',
    options: AUTHORITY_TYPES, optionsLabelPath: 'labels.authorityTypes', aiDerived: true },
  { path: 'analysis.urgency', type: 'enum', labelKey: 'automations.fields.urgency',
    options: URGENCY_VALUES, optionsLabelPath: 'labels.urgency', aiDerived: true },
  { path: 'analysis.deadline', type: 'date', labelKey: 'automations.fields.deadline', aiDerived: true },
  { path: 'analysis.amount', type: 'number', labelKey: 'automations.fields.amount',
    aiDerived: true, hasCurrency: true },
  { path: 'analysis.overall_confidence', type: 'number', labelKey: 'automations.fields.confidence' },
  { path: 'analysis.reply_needed', type: 'boolean', labelKey: 'automations.fields.replyNeeded', aiDerived: true },
];

/**
 * ⚠️ SOLO VALORI CHE NON HANNO BISOGNO DI ESSERE TRADOTTI.
 *
 * Un titolo, un mittente, una data, un importo si scrivono uguali in italiano,
 * tedesco e francese. La CATEGORIA e il TIPO DI DOCUMENTO no: nel database
 * vivono come `taxes` e `reminder`, e per metterli in un titolo servirebbe un
 * dizionario lato server — cioè una QUARTA copia delle etichette, dopo `it`,
 * `de` e `fr`, che prima o poi direbbe una cosa diversa dalle altre tre.
 * Si è preferito non offrirli: un segnaposto in meno vale meno di un'etichetta
 * che diverge.
 */
const DOCUMENT_TEMPLATES = [
  '{{document.title}}', '{{analysis.sender}}',
  '{{analysis.deadline}}', '{{analysis.amount}}',
] as const;

/**
 * I campi di una fattura o di una spesa (0021).
 *
 * ⚠️ Sono i valori EFFETTIVI — correzione umana se c'è, altrimenti estrazione —
 * ed è la stessa regola con cui il Document Hub compone i propri. Una regola
 * che decidesse sul valore letto dalla macchina invece che su quello che
 * l'azienda ha corretto agirebbe su un dato che nessuno considera più vero.
 *
 * ⚠️ Gli importi portano `hasCurrency`: senza, il motore confronterebbe in
 * silenzio CHF con EUR — e §22 vieta ogni conversione.
 */
const FINANCE_FIELDS: readonly TriggerField[] = [
  { path: 'finance.type', type: 'enum', labelKey: 'automations.fields.financeType',
    options: ['supplier_invoice', 'receipt', 'credit_note'] as const,
    optionsLabelPath: 'labels.financeTypes' },
  { path: 'finance.supplier', type: 'string', labelKey: 'automations.fields.financeSupplier',
    aiDerived: true },
  { path: 'finance.invoice_number', type: 'string', labelKey: 'automations.fields.financeInvoiceNumber',
    aiDerived: true },
  { path: 'finance.gross_amount', type: 'number', labelKey: 'automations.fields.financeGross',
    aiDerived: true, hasCurrency: true },
  { path: 'finance.vat_amount', type: 'number', labelKey: 'automations.fields.financeVat',
    aiDerived: true, hasCurrency: true },
  { path: 'finance.currency', type: 'string', labelKey: 'automations.fields.financeCurrency' },
  { path: 'finance.due_date', type: 'date', labelKey: 'automations.fields.financeDueDate',
    aiDerived: true },
  { path: 'finance.invoice_date', type: 'date', labelKey: 'automations.fields.financeInvoiceDate',
    aiDerived: true },
  { path: 'finance.review_status', type: 'enum', labelKey: 'automations.fields.financeReview',
    options: ['needs_review', 'ready'] as const, optionsLabelPath: 'labels.financeReview' },
  { path: 'finance.duplicate_suspected', type: 'boolean',
    labelKey: 'automations.fields.financeDuplicate' },
  { path: 'finance.has_quality_flags', type: 'boolean',
    labelKey: 'automations.fields.financeFlagged' },
];

/**
 * ⚠️ SOLO VALORI CHE NON HANNO BISOGNO DI ESSERE TRADOTTI, come per i
 * documenti: un fornitore, un numero, una data e un importo si scrivono uguali
 * nelle tre lingue. Il TIPO di documento finanziario no — nel database vive
 * `supplier_invoice` — e offrirlo come segnaposto richiederebbe un dizionario
 * lato server, cioè una quarta copia delle etichette.
 */
const FINANCE_TEMPLATES = [
  '{{document.title}}', '{{finance.supplier}}', '{{finance.invoice_number}}',
  '{{finance.gross_amount}}', '{{finance.due_date}}',
] as const;

const TASK_FIELDS: readonly TriggerField[] = [
  { path: 'task.title', type: 'string', labelKey: 'automations.fields.taskTitle' },
  { path: 'task.priority', type: 'enum', labelKey: 'automations.fields.taskPriority',
    options: TASK_PRIORITIES, optionsLabelPath: 'automations.values.taskPriority' },
  { path: 'task.status', type: 'enum', labelKey: 'automations.fields.taskStatus',
    options: TASK_STATUSES, optionsLabelPath: 'automations.values.taskStatus' },
  { path: 'task.source', type: 'enum', labelKey: 'automations.fields.taskSource',
    options: TASK_SOURCES, optionsLabelPath: 'automations.values.taskSource' },
  { path: 'task.assignee', type: 'user', labelKey: 'automations.fields.taskAssignee' },
  { path: 'task.due_date', type: 'date', labelKey: 'automations.fields.taskDueDate' },
  { path: 'task.authority', type: 'string', labelKey: 'automations.fields.taskAuthority' },
  { path: 'task.has_document', type: 'boolean', labelKey: 'automations.fields.taskHasDocument' },
];

const TASK_TEMPLATES = ['{{task.title}}', '{{task.due_date}}', '{{task.authority}}'] as const;

/**
 * I campi di un contratto (0024).
 *
 * ⚠️ SONO I TERMINI IN VIGORE — quelli di una versione VERIFICATA da una
 * persona, o della bozza se nessuno ha ancora verificato. `contract.terms_are_draft`
 * dice quale dei due casi, e permette di scrivere la regola più importante di
 * tutte: «agisci solo su termini verificati».
 *
 * ⚠️ `contract.notice_date` e `contract.renewal_date` NON compaiono come campi
 * del contratto, e non è una dimenticanza: una data del contratto è una
 * MILESTONE, che ha un proprio stato (proposta o verificata). Offrirla come
 * campo piatto significherebbe permettere a una regola di decidere su una data
 * che il prodotto ha calcolato e nessuno ha guardato. Le date si usano
 * attraverso gli inneschi delle milestone, dove lo stato viaggia con esse.
 */
const CONTRACT_FIELDS: readonly TriggerField[] = [
  { path: 'contract.type', type: 'enum', labelKey: 'automations.fields.contractType',
    options: ['insurance', 'leasing', 'rent', 'telecom', 'software_subscription',
      'supplier', 'maintenance', 'service', 'licensing', 'nda', 'other'] as const,
    optionsLabelPath: 'labels.contractTypes' },
  { path: 'contract.name', type: 'string', labelKey: 'automations.fields.contractName' },
  { path: 'contract.counterparty', type: 'string', labelKey: 'automations.fields.contractCounterparty' },
  { path: 'contract.owner', type: 'user', labelKey: 'automations.fields.contractOwner' },
  { path: 'contract.lifecycle_status', type: 'enum', labelKey: 'automations.fields.contractLifecycle',
    options: ['unknown', 'upcoming', 'active', 'ended', 'terminated'] as const,
    optionsLabelPath: 'labels.contractLifecycle' },
  { path: 'contract.auto_renewal', type: 'enum', labelKey: 'automations.fields.contractAutoRenewal',
    options: ['yes', 'no', 'unclear'] as const, optionsLabelPath: 'labels.contractRenewal' },
  { path: 'contract.cost_amount', type: 'number', labelKey: 'automations.fields.contractCost',
    aiDerived: true, hasCurrency: true },
  { path: 'contract.cost_currency', type: 'string', labelKey: 'automations.fields.contractCurrency' },
  { path: 'contract.cost_frequency', type: 'enum', labelKey: 'automations.fields.contractFrequency',
    options: ['one_time', 'monthly', 'quarterly', 'yearly', 'other', 'unknown'] as const,
    optionsLabelPath: 'labels.contractFrequency' },
  { path: 'contract.terms_are_draft', type: 'boolean', labelKey: 'automations.fields.contractTermsDraft' },
  { path: 'contract.has_quality_flags', type: 'boolean', labelKey: 'automations.fields.contractFlagged' },
  { path: 'contract.document_count', type: 'number', labelKey: 'automations.fields.contractDocuments' },
];

/** I campi di una DATA del contratto: presenti solo sugli inneschi che ne parlano. */
const MILESTONE_FIELDS: readonly TriggerField[] = [
  { path: 'milestone.type', type: 'enum', labelKey: 'automations.fields.milestoneType',
    options: ['contract_start', 'contract_end', 'renewal_date', 'notice_deadline',
      'review_date', 'other'] as const, optionsLabelPath: 'labels.milestoneKinds' },
  { path: 'milestone.date', type: 'date', labelKey: 'automations.fields.milestoneDate' },
  // ⚠️ La PROVENIENZA della data è un campo a sé, e serve: una regola può
  // volersi limitare alle date LETTE nel contratto e non a quelle calcolate.
  { path: 'milestone.source', type: 'enum', labelKey: 'automations.fields.milestoneSource',
    options: ['explicit', 'derived', 'manual'] as const,
    optionsLabelPath: 'labels.milestoneSources' },
];

/**
 * ⚠️ SOLO VALORI CHE NON HANNO BISOGNO DI ESSERE TRADOTTI, come per documenti e
 * fatture: un nome, una controparte e una data si scrivono uguali nelle tre
 * lingue. Il TIPO di contratto no — nel database vive `software_subscription` —
 * e offrirlo come segnaposto richiederebbe un dizionario lato server, cioè una
 * quarta copia delle etichette destinata a divergere.
 */
const CONTRACT_TEMPLATES = [
  '{{contract.name}}', '{{contract.counterparty}}', '{{contract.cost_amount}}',
] as const;
const MILESTONE_TEMPLATES = [...CONTRACT_TEMPLATES, '{{milestone.date}}'] as const;

// ---------------------------------------------------------------------------
// I campi del CRM (0026)
//
// ⚠️ PERCHÉ I RUOLI SONO BOOLEANI E NON UN ELENCO.
// I ruoli di un'organizzazione sono MULTIPLI, ma l'operatore `contains` di
// questo motore confronta SOTTOSTRINGHE (`conditions.ts`): su un elenco unito
// con le virgole, «il ruolo contiene customer» risponderebbe SÌ anche a
// `former_customer`, cioè a un ex cliente. Una regola «avvisa per i clienti»
// scatterebbe sui clienti persi, e nessuno capirebbe perché.
// Un booleano per ruolo è più prolisso e non è ambiguo. `organization.role`
// esiste solo sull'innesco «ruolo aggiunto», dove il ruolo è UNO e sta nel
// payload dell'evento: là è un dato, non una deduzione.
// ---------------------------------------------------------------------------

export const CRM_RELATIONSHIP_STATUSES = ['active', 'inactive'] as const;
export const CRM_ORGANIZATION_ROLES = [
  'lead', 'prospect', 'customer', 'former_customer',
  'supplier', 'partner', 'authority', 'other',
] as const;
export const CRM_OPPORTUNITY_STAGES = [
  'lead', 'contacted', 'proposal', 'negotiation', 'won', 'lost',
] as const;
export const CRM_SOURCES = [
  'manual', 'email', 'document', 'contract', 'finance', 'registry', 'import',
] as const;

const ORGANIZATION_FIELDS: readonly TriggerField[] = [
  { path: 'organization.name', type: 'string', labelKey: 'automations.fields.orgName' },
  { path: 'organization.owner', type: 'user', labelKey: 'automations.fields.orgOwner' },
  { path: 'organization.status', type: 'enum', labelKey: 'automations.fields.orgStatus',
    options: CRM_RELATIONSHIP_STATUSES, optionsLabelPath: 'labels.crmStatus' },
  { path: 'organization.canton', type: 'string', labelKey: 'automations.fields.orgCanton' },
  { path: 'organization.city', type: 'string', labelKey: 'automations.fields.orgCity' },
  { path: 'organization.source', type: 'enum', labelKey: 'automations.fields.orgSource',
    options: CRM_SOURCES, optionsLabelPath: 'labels.crmSources' },
  // §69 — «da quanto non li sentiamo». `within_days` è l'unico confronto che le
  // date accettano in questo motore, ed è esattamente quello che serve.
  { path: 'organization.last_contact_at', type: 'date', labelKey: 'automations.fields.orgLastContact' },
  { path: 'organization.role_customer', type: 'boolean', labelKey: 'automations.fields.orgIsCustomer' },
  { path: 'organization.role_prospect', type: 'boolean', labelKey: 'automations.fields.orgIsProspect' },
  { path: 'organization.role_supplier', type: 'boolean', labelKey: 'automations.fields.orgIsSupplier' },
  { path: 'organization.role_partner', type: 'boolean', labelKey: 'automations.fields.orgIsPartner' },
  { path: 'organization.open_opportunity_count', type: 'number', labelKey: 'automations.fields.orgOpenOpportunities' },
  { path: 'organization.open_task_count', type: 'number', labelKey: 'automations.fields.orgOpenTasks' },
];

const OPPORTUNITY_FIELDS: readonly TriggerField[] = [
  { path: 'opportunity.title', type: 'string', labelKey: 'automations.fields.oppTitle' },
  { path: 'opportunity.stage', type: 'enum', labelKey: 'automations.fields.oppStage',
    options: CRM_OPPORTUNITY_STAGES, optionsLabelPath: 'labels.crmStages' },
  { path: 'opportunity.owner', type: 'user', labelKey: 'automations.fields.oppOwner' },
  // §45 — l'importo porta la sua valuta, e `hasCurrency` è ciò che impedisce a
  // una condizione «valore > 10000» di confrontare franchi con euro.
  { path: 'opportunity.value_amount', type: 'number', labelKey: 'automations.fields.oppValue',
    hasCurrency: true },
  { path: 'opportunity.value_currency', type: 'string', labelKey: 'automations.fields.oppCurrency' },
  { path: 'opportunity.expected_close_date', type: 'date', labelKey: 'automations.fields.oppCloseDate' },
  // §99 — «senza prossimo passo» si esprime con `not_exists` su questo campo:
  // una trattativa aperta che nessuno sa come proseguire è ferma anche se
  // sembra viva.
  { path: 'opportunity.next_step', type: 'string', labelKey: 'automations.fields.oppNextStep' },
  { path: 'opportunity.next_step_due_date', type: 'date', labelKey: 'automations.fields.oppNextStepDue' },
];

// §30 — solo valori NON traducibili: un nome, un titolo, un importo, una data.
const CRM_ORG_TEMPLATES = ['{{organization.name}}'] as const;
const CRM_OPP_TEMPLATES = [
  '{{organization.name}}', '{{opportunity.title}}',
  '{{opportunity.value_amount}}', '{{opportunity.next_step}}',
] as const;

// ---------------------------------------------------------------------------
// I campi degli incentivi (0032)
//
// ⚠️⚠️ `relevance_score` NON È QUI, E NON PER DIMENTICANZA. Il punteggio è
//    INTERNO e serve solo a ordinare l'elenco: renderlo confrontabile in una
//    regola («quando la rilevanza supera 80») lo trasformerebbe in una soglia
//    di prodotto, cioè esattamente nella percentuale che tutto il modulo
//    esiste per non mostrare. Si confronta la FASCIA, che è un fatto.
//
// ⚠️ E non c'è alcun campo «probabilità», «punteggio di idoneità» o «importo
//    ottenibile»: non esistono nello schema, e non devono esistere qui.
// ---------------------------------------------------------------------------

// Gli stadi del progetto: gli stessi cinque di `_shared/subsidy/contract.ts`.
// ⚠️ Ricopiati e NON importati: questo file non ha e non deve avere import
//    (lo leggono tre runtime diversi). Un test li confronta con l'originale.
export const PROJECT_STAGE_VALUES = ['idea', 'planned', 'started', 'completed', 'cancelled'] as const;

export const SUBSIDY_RELEVANCE_LEVELS = ['high', 'medium', 'low'] as const;
export const SUBSIDY_ELIGIBILITY = [
  'not_assessed', 'insufficient_information', 'potentially_eligible',
  'likely_ineligible', 'ineligible',
] as const;
export const SUBSIDY_COMPLETENESS = ['complete', 'minor_gaps', 'major_gaps'] as const;
export const SUBSIDY_TIMING = ['open', 'upcoming', 'closed', 'continuous', 'unknown'] as const;
export const SUBSIDY_FRESHNESS = ['fresh', 'aging', 'stale', 'unverified'] as const;
export const SUBSIDY_READINESS = ['not_started', 'in_preparation', 'ready', 'submitted'] as const;
export const SUBSIDY_CASE_STATUSES = [
  'draft', 'assessing', 'collecting_documents', 'ready', 'submitted',
  'under_review', 'approved', 'rejected', 'withdrawn', 'closed',
] as const;
export const SUBSIDY_CASE_OUTCOMES = ['approved', 'rejected', 'withdrawn', 'unknown'] as const;
export const SUBSIDY_OPPORTUNITY_KINDS = ['project', 'general'] as const;
export const SUBSIDY_PROGRAM_AVAILABILITY = ['available', 'suspended'] as const;

/** Il programma, condiviso da opportunità e pratica: un elenco solo. */
const SUBSIDY_PROGRAM_FIELDS: readonly TriggerField[] = [
  { path: 'program.id', type: 'string', labelKey: 'automations.fields.subsidyProgramId' },
  { path: 'program.name', type: 'string', labelKey: 'automations.fields.subsidyProgramName' },
  { path: 'program.authority', type: 'string', labelKey: 'automations.fields.subsidyAuthority' },
  { path: 'program.support_type', type: 'string', labelKey: 'automations.fields.subsidySupportType' },
  // 0011 — «concedibile oggi» è una domanda diversa da «esiste ancora».
  { path: 'program.availability', type: 'enum', labelKey: 'automations.fields.subsidyAvailability',
    options: SUBSIDY_PROGRAM_AVAILABILITY, optionsLabelPath: 'automations.values.subsidyAvailability' },
];

const SUBSIDY_PROJECT_FIELDS: readonly TriggerField[] = [
  { path: 'project.title', type: 'string', labelKey: 'automations.fields.subsidyProjectTitle' },
  { path: 'project.stage', type: 'enum', labelKey: 'automations.fields.subsidyProjectStage',
    options: PROJECT_STAGE_VALUES, optionsLabelPath: 'automations.values.subsidyProjectStage' },
  { path: 'project.canton', type: 'string', labelKey: 'automations.fields.subsidyProjectCanton' },
];

const SUBSIDY_OPPORTUNITY_FIELDS: readonly TriggerField[] = [
  ...SUBSIDY_PROGRAM_FIELDS,
  ...SUBSIDY_PROJECT_FIELDS,
  { path: 'opportunity.kind', type: 'enum', labelKey: 'automations.fields.subsidyKind',
    options: SUBSIDY_OPPORTUNITY_KINDS, optionsLabelPath: 'automations.values.subsidyKind' },
  { path: 'opportunity.relevance', type: 'enum', labelKey: 'automations.fields.subsidyRelevance',
    options: SUBSIDY_RELEVANCE_LEVELS, optionsLabelPath: 'automations.values.subsidyRelevance' },
  { path: 'opportunity.eligibility', type: 'enum', labelKey: 'automations.fields.subsidyEligibility',
    options: SUBSIDY_ELIGIBILITY, optionsLabelPath: 'automations.values.subsidyEligibility' },
  { path: 'opportunity.completeness', type: 'enum', labelKey: 'automations.fields.subsidyCompleteness',
    options: SUBSIDY_COMPLETENESS, optionsLabelPath: 'automations.values.subsidyCompleteness' },
  { path: 'opportunity.timing', type: 'enum', labelKey: 'automations.fields.subsidyTiming',
    options: SUBSIDY_TIMING, optionsLabelPath: 'automations.values.subsidyTiming' },
  // §26 — con una fonte vecchia non si crea urgenza: una regola può volerlo
  // sapere prima di far partire un'attività.
  { path: 'opportunity.source_freshness', type: 'enum', labelKey: 'automations.fields.subsidyFreshness',
    options: SUBSIDY_FRESHNESS, optionsLabelPath: 'automations.values.subsidyFreshness' },
  { path: 'opportunity.readiness', type: 'enum', labelKey: 'automations.fields.subsidyReadiness',
    options: SUBSIDY_READINESS, optionsLabelPath: 'automations.values.subsidyReadiness' },
  { path: 'opportunity.open_criteria', type: 'number', labelKey: 'automations.fields.subsidyOpenCriteria' },
  { path: 'opportunity.missing_facts', type: 'number', labelKey: 'automations.fields.subsidyMissingFacts' },
  { path: 'opportunity.assessment_stale', type: 'boolean', labelKey: 'automations.fields.subsidyStale' },
  // ⚠️ `within_days` su questa data è il modo giusto di dire «scade presto»:
  //    un confronto con una data assoluta sarebbe giusto per due mesi.
  { path: 'call.deadline', type: 'date', labelKey: 'automations.fields.subsidyCallDeadline' },
];

const SUBSIDY_CASE_FIELDS: readonly TriggerField[] = [
  ...SUBSIDY_PROGRAM_FIELDS,
  ...SUBSIDY_PROJECT_FIELDS,
  { path: 'case.status', type: 'enum', labelKey: 'automations.fields.subsidyCaseStatus',
    options: SUBSIDY_CASE_STATUSES, optionsLabelPath: 'automations.values.subsidyCaseStatus' },
  { path: 'case.outcome', type: 'enum', labelKey: 'automations.fields.subsidyCaseOutcome',
    options: SUBSIDY_CASE_OUTCOMES, optionsLabelPath: 'automations.values.subsidyCaseOutcome' },
  // §118 — DUE scadenze, e restano due: quella dell'ente non si tocca, quella
  // interna la sceglie l'impresa. Una regola può parlare dell'una o dell'altra.
  { path: 'case.official_deadline', type: 'date', labelKey: 'automations.fields.subsidyOfficialDeadline' },
  { path: 'case.internal_deadline', type: 'date', labelKey: 'automations.fields.subsidyInternalDeadline' },
  { path: 'case.amount_requested', type: 'number', labelKey: 'automations.fields.subsidyAmountRequested',
    hasCurrency: true },
  { path: 'case.currency', type: 'string', labelKey: 'automations.fields.subsidyCurrency' },
  { path: 'case.required_steps_open', type: 'number', labelKey: 'automations.fields.subsidyStepsOpen' },
  // §166 — una pratica nata prima del catalogo versionato non ha istantanea, e
  // una regola che confronta con la fonte deve poterlo sapere.
  { path: 'case.legacy_snapshot', type: 'boolean', labelKey: 'automations.fields.subsidyLegacy' },
  { path: 'case.source_changed', type: 'boolean', labelKey: 'automations.fields.subsidySourceChanged' },
];

const SUBSIDY_OPP_TEMPLATES = [
  '{{program.name}}', '{{program.authority}}', '{{project.title}}',
  '{{opportunity.relevance}}', '{{call.deadline}}',
] as const;
const SUBSIDY_CASE_TEMPLATES = [
  '{{program.name}}', '{{program.authority}}', '{{project.title}}',
  '{{case.status}}', '{{case.official_deadline}}',
] as const;

export const TRIGGERS: readonly TriggerDef[] = [
  {
    key: 'document_analysis_completed',
    entityType: 'document',
    version: 1,
    labelKey: 'automations.triggers.documentAnalysed',
    descriptionKey: 'automations.triggers.documentAnalysedDesc',
    fields: DOCUMENT_FIELDS,
    templates: DOCUMENT_TEMPLATES,
  },
  {
    key: 'document_category_changed',
    entityType: 'document',
    version: 1,
    labelKey: 'automations.triggers.categoryChanged',
    descriptionKey: 'automations.triggers.categoryChangedDesc',
    fields: [
      ...DOCUMENT_FIELDS,
      { path: 'document.previous_category', type: 'enum', labelKey: 'automations.fields.previousCategory',
        options: DOCUMENT_CATEGORIES, optionsLabelPath: 'labels.categories' },
      { path: 'document.category_source', type: 'enum', labelKey: 'automations.fields.categorySource',
        options: CATEGORY_SOURCES, optionsLabelPath: 'automations.values.categorySource' },
    ],
    templates: DOCUMENT_TEMPLATES,
  },
  {
    key: 'email_attention_ready',
    entityType: 'email_message',
    version: 1,
    labelKey: 'automations.triggers.emailReady',
    descriptionKey: 'automations.triggers.emailReadyDesc',
    fields: [
      { path: 'email.sender_email', type: 'string', labelKey: 'automations.fields.emailSender' },
      // Il dominio è un campo a sé e non una sottostringa dell'indirizzo: «il
      // dominio è estv.admin.ch» e «l'indirizzo contiene estv.admin.ch» sono
      // due domande diverse, e la seconda risponde sì anche a
      // «truffa@estv.admin.ch.example.com».
      { path: 'email.sender_domain', type: 'string', labelKey: 'automations.fields.emailDomain' },
      { path: 'email.sender_name', type: 'string', labelKey: 'automations.fields.emailSenderName' },
      { path: 'email.subject', type: 'string', labelKey: 'automations.fields.emailSubject' },
      { path: 'email.relevance', type: 'enum', labelKey: 'automations.fields.emailRelevance',
        options: EMAIL_RELEVANCE, optionsLabelPath: 'automations.values.emailRelevance' },
      { path: 'email.attention_status', type: 'enum', labelKey: 'automations.fields.emailAttention',
        options: EMAIL_ATTENTION, optionsLabelPath: 'automations.values.emailAttention' },
      { path: 'email.has_attachments', type: 'boolean', labelKey: 'automations.fields.emailHasAttachments' },
      { path: 'email.attachment_count', type: 'number', labelKey: 'automations.fields.emailAttachmentCount' },
      { path: 'email.linked_document_count', type: 'number', labelKey: 'automations.fields.emailDocumentCount' },
    ],
    templates: ['{{email.subject}}', '{{email.sender_name}}', '{{email.sender_email}}'],
  },
  {
    key: 'finance_item_needs_review',
    entityType: 'document',
    version: 1,
    labelKey: 'automations.triggers.financeNeedsReview',
    descriptionKey: 'automations.triggers.financeNeedsReviewDesc',
    fields: [...DOCUMENT_FIELDS, ...FINANCE_FIELDS],
    templates: [...DOCUMENT_TEMPLATES, ...FINANCE_TEMPLATES],
  },
  {
    key: 'finance_item_ready',
    entityType: 'document',
    version: 1,
    labelKey: 'automations.triggers.financeReady',
    descriptionKey: 'automations.triggers.financeReadyDesc',
    fields: [...DOCUMENT_FIELDS, ...FINANCE_FIELDS],
    templates: [...DOCUMENT_TEMPLATES, ...FINANCE_TEMPLATES],
  },
  {
    key: 'contract_verified',
    entityType: 'contract',
    version: 1,
    labelKey: 'automations.triggers.contractVerified',
    descriptionKey: 'automations.triggers.contractVerifiedDesc',
    fields: CONTRACT_FIELDS,
    templates: CONTRACT_TEMPLATES,
  },
  {
    key: 'contract_review_required',
    entityType: 'contract',
    version: 1,
    labelKey: 'automations.triggers.contractReviewRequired',
    descriptionKey: 'automations.triggers.contractReviewRequiredDesc',
    fields: CONTRACT_FIELDS,
    templates: CONTRACT_TEMPLATES,
  },
  {
    key: 'contract_milestone_verified',
    entityType: 'contract',
    version: 1,
    labelKey: 'automations.triggers.contractMilestoneVerified',
    descriptionKey: 'automations.triggers.contractMilestoneVerifiedDesc',
    fields: [...CONTRACT_FIELDS, ...MILESTONE_FIELDS],
    templates: MILESTONE_TEMPLATES,
  },
  {
    key: 'contract_milestone_window_opened',
    entityType: 'contract',
    version: 1,
    labelKey: 'automations.triggers.contractWindowOpened',
    descriptionKey: 'automations.triggers.contractWindowOpenedDesc',
    fields: [...CONTRACT_FIELDS, ...MILESTONE_FIELDS],
    templates: MILESTONE_TEMPLATES,
  },
  {
    key: 'crm_organization_created',
    entityType: 'crm_organization',
    version: 1,
    labelKey: 'automations.triggers.crmOrgCreated',
    descriptionKey: 'automations.triggers.crmOrgCreatedDesc',
    fields: ORGANIZATION_FIELDS,
    templates: CRM_ORG_TEMPLATES,
  },
  {
    key: 'crm_role_added',
    entityType: 'crm_organization',
    version: 1,
    labelKey: 'automations.triggers.crmRoleAdded',
    descriptionKey: 'automations.triggers.crmRoleAddedDesc',
    fields: [
      ...ORGANIZATION_FIELDS,
      // Qui il ruolo è UNO e arriva dal payload dell'evento: è il ruolo appena
      // aggiunto, non una sintesi di quelli che l'organizzazione ha.
      { path: 'organization.role', type: 'enum', labelKey: 'automations.fields.orgRoleAdded',
        options: CRM_ORGANIZATION_ROLES, optionsLabelPath: 'labels.crmRoles' },
    ],
    templates: CRM_ORG_TEMPLATES,
  },
  {
    key: 'crm_opportunity_created',
    entityType: 'crm_opportunity',
    version: 1,
    labelKey: 'automations.triggers.crmOppCreated',
    descriptionKey: 'automations.triggers.crmOppCreatedDesc',
    fields: [...ORGANIZATION_FIELDS, ...OPPORTUNITY_FIELDS],
    templates: CRM_OPP_TEMPLATES,
  },
  {
    key: 'crm_opportunity_stage_changed',
    entityType: 'crm_opportunity',
    version: 1,
    labelKey: 'automations.triggers.crmOppStageChanged',
    descriptionKey: 'automations.triggers.crmOppStageChangedDesc',
    fields: [
      ...ORGANIZATION_FIELDS, ...OPPORTUNITY_FIELDS,
      { path: 'opportunity.previous_stage', type: 'enum', labelKey: 'automations.fields.oppPreviousStage',
        options: CRM_OPPORTUNITY_STAGES, optionsLabelPath: 'labels.crmStages' },
    ],
    templates: CRM_OPP_TEMPLATES,
  },
  {
    key: 'crm_opportunity_won',
    entityType: 'crm_opportunity',
    version: 1,
    labelKey: 'automations.triggers.crmOppWon',
    descriptionKey: 'automations.triggers.crmOppWonDesc',
    fields: [...ORGANIZATION_FIELDS, ...OPPORTUNITY_FIELDS],
    templates: CRM_OPP_TEMPLATES,
  },
  {
    key: 'crm_follow_up_due',
    entityType: 'crm_opportunity',
    version: 1,
    labelKey: 'automations.triggers.crmFollowUpDue',
    descriptionKey: 'automations.triggers.crmFollowUpDueDesc',
    fields: [...ORGANIZATION_FIELDS, ...OPPORTUNITY_FIELDS],
    templates: CRM_OPP_TEMPLATES,
  },
  // ---- Incentivi (0032) ----
  {
    key: 'subsidy_opportunity_created',
    entityType: 'subsidy_opportunity',
    version: 1,
    labelKey: 'automations.triggers.subsidyOppCreated',
    descriptionKey: 'automations.triggers.subsidyOppCreatedDesc',
    fields: SUBSIDY_OPPORTUNITY_FIELDS,
    templates: SUBSIDY_OPP_TEMPLATES,
  },
  {
    key: 'subsidy_opportunity_high_relevance',
    entityType: 'subsidy_opportunity',
    version: 1,
    labelKey: 'automations.triggers.subsidyOppHigh',
    descriptionKey: 'automations.triggers.subsidyOppHighDesc',
    fields: SUBSIDY_OPPORTUNITY_FIELDS,
    templates: SUBSIDY_OPP_TEMPLATES,
  },
  {
    key: 'subsidy_call_opened',
    entityType: 'subsidy_opportunity',
    version: 1,
    labelKey: 'automations.triggers.subsidyCallOpened',
    descriptionKey: 'automations.triggers.subsidyCallOpenedDesc',
    fields: SUBSIDY_OPPORTUNITY_FIELDS,
    templates: SUBSIDY_OPP_TEMPLATES,
  },
  {
    key: 'subsidy_assessment_became_stale',
    entityType: 'subsidy_opportunity',
    version: 1,
    labelKey: 'automations.triggers.subsidyStale',
    descriptionKey: 'automations.triggers.subsidyStaleDesc',
    fields: SUBSIDY_OPPORTUNITY_FIELDS,
    templates: SUBSIDY_OPP_TEMPLATES,
  },
  {
    key: 'subsidy_deadline_approaching',
    entityType: 'subsidy_case',
    version: 1,
    labelKey: 'automations.triggers.subsidyDeadline',
    descriptionKey: 'automations.triggers.subsidyDeadlineDesc',
    fields: SUBSIDY_CASE_FIELDS,
    templates: SUBSIDY_CASE_TEMPLATES,
  },
  {
    key: 'subsidy_case_status_changed',
    entityType: 'subsidy_case',
    version: 1,
    labelKey: 'automations.triggers.subsidyCaseStatus',
    descriptionKey: 'automations.triggers.subsidyCaseStatusDesc',
    fields: [
      ...SUBSIDY_CASE_FIELDS,
      // Lo stato PRECEDENTE non esiste più adesso: viene dal payload, come per
      // la categoria di un documento e la fase di una trattativa.
      { path: 'case.previous_status', type: 'enum', labelKey: 'automations.fields.subsidyPreviousStatus',
        options: SUBSIDY_CASE_STATUSES, optionsLabelPath: 'automations.values.subsidyCaseStatus' },
    ],
    templates: SUBSIDY_CASE_TEMPLATES,
  },
  {
    key: 'subsidy_source_critical_change',
    entityType: 'subsidy_case',
    version: 1,
    labelKey: 'automations.triggers.subsidySourceChange',
    descriptionKey: 'automations.triggers.subsidySourceChangeDesc',
    fields: SUBSIDY_CASE_FIELDS,
    templates: SUBSIDY_CASE_TEMPLATES,
  },
  {
    key: 'task_created',
    entityType: 'task',
    version: 1,
    labelKey: 'automations.triggers.taskCreated',
    descriptionKey: 'automations.triggers.taskCreatedDesc',
    fields: TASK_FIELDS,
    templates: TASK_TEMPLATES,
  },
  {
    key: 'task_status_changed',
    entityType: 'task',
    version: 1,
    labelKey: 'automations.triggers.taskStatusChanged',
    descriptionKey: 'automations.triggers.taskStatusChangedDesc',
    fields: [
      ...TASK_FIELDS,
      { path: 'task.previous_status', type: 'enum', labelKey: 'automations.fields.taskPreviousStatus',
        options: TASK_STATUSES, optionsLabelPath: 'automations.values.taskStatus' },
    ],
    templates: TASK_TEMPLATES,
  },
  {
    key: 'task_became_overdue',
    entityType: 'task',
    version: 1,
    labelKey: 'automations.triggers.taskOverdue',
    descriptionKey: 'automations.triggers.taskOverdueDesc',
    fields: TASK_FIELDS,
    templates: TASK_TEMPLATES,
  },
];

export function findTrigger(key: string): TriggerDef | null {
  return TRIGGERS.find((t) => t.key === key) ?? null;
}

export function findField(trigger: TriggerDef, path: string): TriggerField | null {
  return trigger.fields.find((f) => f.path === path) ?? null;
}

// ---------------------------------------------------------------------------
// Azioni
//
// ⚠️ SEI, E TUTTE A BASSO RISCHIO (§19/§191).
// Il livello di rischio è un dato dell'azione, non un commento: il motore
// esegue automaticamente SOLO le azioni `low`. Il giorno in cui servirà
// un'azione `medium` o `high` — inviare una email, accettare qualcosa — quel
// campo esiste già e il motore la rifiuterà finché non ci sarà un percorso di
// approvazione umana. Non c'è oggi, e per questo non c'è nessuna azione che ne
// avrebbe bisogno.
//
// Ciò che NON esiste, e non per dimenticanza: inviare o rispondere a email,
// pagare, cambiare coordinate bancarie, cancellare documenti o messaggi,
// firmare o accettare contratti, trasmettere alle autorità, chiamare un
// indirizzo esterno, eseguire SQL o JavaScript. Automatizzare il lavoro, non
// automatizzare il rischio.
// ---------------------------------------------------------------------------

export const ACTION_KEYS = [
  'create_task', 'assign_task', 'set_task_priority',
  'set_document_category', 'add_document_tag', 'create_notification',
] as const;
export type ActionKey = (typeof ACTION_KEYS)[number];

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ActionDef {
  key: ActionKey;
  labelKey: string;
  descriptionKey: string;
  riskLevel: RiskLevel;
  /** Su quali entità ha senso. Un'azione fuori posto non è offerta e non è valida. */
  entityTypes: readonly AutomationEntityType[];
  outputEntityType: 'task' | 'document' | 'notification' | 'document_tag';
}

export const ACTIONS: readonly ActionDef[] = [
  {
    key: 'create_task',
    labelKey: 'automations.actions.createTask',
    descriptionKey: 'automations.actions.createTaskDesc',
    riskLevel: 'low',
    // 0024 — vale anche sui contratti: è il modo in cui una data verificata
    // diventa lavoro concreto (§86). ⚠️ NON esiste, e non deve esistere,
    // un'azione «disdici» o «accetta rinnovo» (§101).
    // 0026 — vale anche sul CRM: è il modo in cui un «prossimo passo» diventa
    // lavoro assegnabile e tracciabile (§50). ⚠️ NON esiste, e non deve
    // esistere, un'azione che scriva a un cliente (§135).
    entityTypes: ['document', 'email_message', 'task', 'contract',
                  'crm_organization', 'crm_opportunity'],
    outputEntityType: 'task',
  },
  {
    key: 'assign_task',
    labelKey: 'automations.actions.assignTask',
    descriptionKey: 'automations.actions.assignTaskDesc',
    riskLevel: 'low',
    // Solo sugli inneschi che PARLANO di un'attività: assegnare «l'attività» a
    // partire da un documento non ha un referente, e offrirlo comunque
    // significherebbe far configurare una regola che non potrà mai funzionare.
    entityTypes: ['task'],
    outputEntityType: 'task',
  },
  {
    key: 'set_task_priority',
    labelKey: 'automations.actions.setTaskPriority',
    descriptionKey: 'automations.actions.setTaskPriorityDesc',
    riskLevel: 'low',
    entityTypes: ['task'],
    outputEntityType: 'task',
  },
  {
    key: 'set_document_category',
    labelKey: 'automations.actions.setDocumentCategory',
    descriptionKey: 'automations.actions.setDocumentCategoryDesc',
    riskLevel: 'low',
    entityTypes: ['document'],
    outputEntityType: 'document',
  },
  {
    key: 'add_document_tag',
    labelKey: 'automations.actions.addDocumentTag',
    descriptionKey: 'automations.actions.addDocumentTagDesc',
    riskLevel: 'low',
    entityTypes: ['document'],
    outputEntityType: 'document_tag',
  },
  {
    key: 'create_notification',
    labelKey: 'automations.actions.createNotification',
    descriptionKey: 'automations.actions.createNotificationDesc',
    riskLevel: 'low',
    // 0026 — §137: «opportunità senza responsabile» avvisa gli amministratori.
    // ⚠️ La notifica arriva a una persona DELL'AZIENDA, mai alla controparte:
    // il motore non ha alcun modo di scrivere a un indirizzo esterno, e questa
    // assenza è il vincolo (§135).
    entityTypes: ['document', 'email_message', 'task', 'contract',
                  'crm_organization', 'crm_opportunity'],
    outputEntityType: 'notification',
  },
];

export function findAction(key: string): ActionDef | null {
  return ACTIONS.find((a) => a.key === key) ?? null;
}

/** Le azioni offerte per un innesco: quelle che hanno senso sulla sua entità. */
export function actionsForTrigger(trigger: TriggerDef): readonly ActionDef[] {
  return ACTIONS.filter((a) => a.entityTypes.includes(trigger.entityType));
}

/**
 * Le entità che hanno un RESPONSABILE, cioè una persona che una notifica può
 * raggiungere senza sceglierla a mano.
 *
 * ⚠️ ELENCO E NON UN CONFRONTO SPARSO, perché deve coincidere con ciò che
 * `store.ts` calcola davvero in `assigneeUserId`: un'attività ha il proprio
 * assegnatario, un contratto e una controparte il proprio responsabile, una
 * trattativa il proprio (e in mancanza quello della relazione, §84/§136). Un
 * documento e una comunicazione non ne hanno alcuno: là «avvisa il
 * responsabile» non avviserebbe mai nessuno, e offrirlo significherebbe far
 * comporre una regola che non può funzionare.
 *
 * ⚠️ Fino al 2026-07-30 questo controllo era `entityType === 'task'`, scritto
 * quando le entità erano tre. Da allora la 0024 e la 0026 hanno aggiunto tre
 * entità CON un responsabile, e `store.ts` lo calcolava già citando §136 —
 * ma il validatore rifiutava la regola che avrebbe dovuto usarlo. Il motore
 * sapeva a chi scrivere e il generatore non lasciava dirlo.
 */
const ENTITIES_WITH_OWNER: readonly AutomationEntityType[] = [
  'task', 'contract', 'crm_organization', 'crm_opportunity',
];

export function triggerHasOwner(trigger: TriggerDef): boolean {
  return ENTITIES_WITH_OWNER.includes(trigger.entityType);
}

/**
 * ⚠️ IL MOTORE ESEGUE AUTOMATICAMENTE SOLO QUESTO LIVELLO (§19).
 * Esiste come funzione e non come confronto sparso nel codice perché il giorno
 * in cui nascerà l'approvazione umana la modifica dovrà essere in un posto solo.
 */
export function isAutoExecutable(action: ActionDef): boolean {
  return action.riskLevel === 'low';
}

// ---------------------------------------------------------------------------
// Configurazioni delle azioni
//
// Tipi ESPLICITI e non `Record<string, unknown>`: il generatore, il validatore
// e l'esecutore devono parlare della stessa cosa, e un campo scritto male deve
// rompere il typecheck invece di essere ignorato a runtime.
// ---------------------------------------------------------------------------

/** Come si ricava la scadenza dell'attività creata. */
/**
 * Come si ricava la scadenza dell'attività creata.
 *
 * ⚠️ `from_finance_due_date` esiste separata da `from_deadline` perché le due
 * date NON sono la stessa cosa: il termine letto dall'analisi amministrativa
 * («rispondere entro il…») e la scadenza di pagamento di una fattura possono
 * differire, e §47 vieta espressamente di sovrascrivere l'una con l'altra. Chi
 * crea un'attività su una fattura vuole la data in cui va pagata.
 */
export type DueDateMode =
  | 'none' | 'from_deadline' | 'before_deadline' | 'in_days'
  | 'from_finance_due_date' | 'before_finance_due_date'
  // 0024 — la data di una MILESTONE del contratto. ⚠️ Separata dalle altre per
  // la stessa ragione per cui `from_finance_due_date` è separata da
  // `from_deadline`: il termine di una comunicazione amministrativa, la
  // scadenza di pagamento di una fattura e il termine ultimo di disdetta di un
  // contratto sono tre date diverse, e sovrascriverne una con l'altra
  // significherebbe far agire una regola sul giorno sbagliato.
  // `before_milestone_date` esiste perché §86 chiede espressamente di poter
  // creare l'attività PRIMA del termine: arrivare il giorno della scadenza di
  // disdetta significa arrivare tardi.
  | 'from_milestone_date' | 'before_milestone_date';
/** Come si ricava la priorità. `from_urgency` solo dove l'urgenza esiste. */
export type PriorityMode = 'low' | 'medium' | 'high' | 'from_urgency';

export interface CreateTaskConfig {
  titleTemplate: string;
  descriptionTemplate?: string | null;
  priority: PriorityMode;
  assigneeUserId?: string | null;
  dueDate: DueDateMode;
  /** Giorni: prima della scadenza (`before_deadline`) o da oggi (`in_days`). */
  dueDateDays?: number | null;
  /** Collega il documento o la comunicazione all'attività creata. */
  linkEntity?: boolean;
}

export interface AssignTaskConfig { assigneeUserId: string }
export interface SetTaskPriorityConfig { priority: 'low' | 'medium' | 'high' }
export interface SetDocumentCategoryConfig { category: string }
export interface AddDocumentTagConfig { tagId: string }
export interface CreateNotificationConfig {
  recipient: 'assignee' | 'admins' | 'user';
  userId?: string | null;
  messageTemplate: string;
}

export type ActionConfig =
  | CreateTaskConfig | AssignTaskConfig | SetTaskPriorityConfig
  | SetDocumentCategoryConfig | AddDocumentTagConfig | CreateNotificationConfig;

export interface WorkflowAction {
  key: ActionKey;
  config: ActionConfig;
}

export interface WorkflowCondition {
  field: string;
  operator: Operator;
  /** Assente per `exists`/`not_exists`. Per `in` è un elenco. */
  value?: string | number | boolean | string[] | null;
  /** Obbligatoria sui campi con valuta: non si convertono valute (§27). */
  currency?: string | null;
}

export interface WorkflowConfig {
  triggerType: AutomationEventType;
  conditionMatch: 'all' | 'any';
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
}
