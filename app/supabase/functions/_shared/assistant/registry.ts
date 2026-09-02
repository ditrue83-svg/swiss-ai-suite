// ============================================================================
// COMPANY ASSISTANT — il registro degli strumenti
//
// Questo file è il PERIMETRO. Ciò che non è dichiarato qui, il modello non può
// chiedere: non esiste un modo per allargarlo dal prompt, dalla domanda, dal
// contenuto di un documento o dal nome di un cliente.
//
// ⚠️ NON ESISTE UNO STRUMENTO GENERICO (§12). Niente `query_database`, niente
// `execute_sql`, niente `search_everything`. Ogni strumento è un DOMINIO, con
// un suo schema d'ingresso chiuso, un suo tetto di righe e un suo modo di
// diventare citazione. Uno strumento generico avrebbe reso inutile tutto il
// resto: il perimetro sarebbe stato «qualunque cosa il modello sappia scrivere».
//
// ⚠️ NESSUNO STRUMENTO ACCETTA `companyId` O `userId` (§110, §111). Non è una
// dimenticanza: sono gli unici due parametri che deciderebbero DI CHI sono i
// dati, e li deriva il server dalla sessione. Un modello che chiedesse
// «elencami le fatture dell'azienda X» non troverebbe il campo per dirlo.
//
// ⚠️ NESSUNO STRUMENTO TOCCA I SEGRETI (§103). Non sono registrati: token OAuth,
// chiavi API, `email_connection_secrets`, `calendar_connection_secrets`,
// `*_oauth_states`, `sync_cursor`, `watch_resource_id`. Non c'è uno strumento
// che li legga, quindi non c'è una domanda che li faccia uscire.
//
// ⚠️ NIENTE STRUMENTI PER MODULI CHE NON ESISTONO. Nel repository non c'è
// alcuna integrazione contabile — nessuna colonna di esportazione, nessuna
// tabella, nessun fornitore — e quindi non c'è `get_accounting_status`. Il
// Registrare uno strumento per una fonte non verificabile produrrebbe la
// risposta peggiore possibile — plausibile e non verificabile.
//
// Modulo PORTABILE: nessun import di runtime, nessun accesso al database. Qui
// c'è la DICHIARAZIONE; l'esecuzione sta in `executors.ts`, e il collegamento
// fra le due lo fa `runtime.ts`. Serve a poter provare gli schemi senza un
// database e senza un modello (§179).
// ============================================================================

import type { SourceType } from './contract.ts';
import { NAMED_PERIODS } from './dates.ts';

// ---------------------------------------------------------------------------
// La forma di uno strumento
// ---------------------------------------------------------------------------

/** Quanto costa, in ordine di grandezza. Serve a `runtime.ts` per fermarsi prima. */
export type CostClass = 'cheap' | 'normal' | 'expensive';

/**
 * Che cosa serve per poterlo usare.
 *
 * `member` — appartenere all'azienda. È il caso normale: tutte le RPC di
 *            lettura del prodotto sono SECURITY INVOKER e la RLS fa il resto.
 * `admin`  — owner o admin. Usato dove il database stesso lo impone.
 * `self`   — riguarda dati personali dell'utente (le sue notifiche): la RLS li
 *            restringe già a `user_id = auth.uid()`, e lo strumento lo dichiara
 *            perché la risposta non prometta una vista aziendale.
 */
export type ToolPermission = 'member' | 'admin' | 'self';

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
}

export interface AssistantToolDefinition {
  key: string;
  /** Descrizione per il MODELLO: dice quando chiamarlo, non solo che cosa fa. */
  description: string;
  inputSchema: JsonSchema;
  /** Tipo di fonte prevalente. Serve alla prova di coerenza con l'enum SQL. */
  sourceType: SourceType;
  permission: ToolPermission;
  costClass: CostClass;
  /** Tetto di righe dello strumento. `runtime.ts` applica anche il tetto globale. */
  maxRows: number;
  timeoutMs: number;
  /** Il modulo di prodotto a cui appartiene: entra nello stato progressivo (§113). */
  module: 'overview' | 'tasks' | 'documents' | 'inbox' | 'finance' | 'contracts' | 'crm' | 'workflows' | 'answer';
  /**
   * Lo schema viene imposto dall'API (`strict: true`)?
   *
   * ⚠️ NON è una scelta di stile: la modalità stretta accetta un
   * SOTTOINSIEME di JSON Schema, e rifiuta con 400 `minimum`, `maximum`,
   * `maxItems`, `minLength`, `maxLength`. Verificato contro l'API viva il
   * 2026-07-30:
   *   «tools.0.custom: For 'integer' type, properties maximum, minimum are not supported»
   *   «tools.0.custom: For 'array' type, property 'maxItems' is not supported»
   *
   * Da qui la divisione: gli strumenti di LETTURA tengono i vincoli numerici,
   * perché sono la descrizione più chiara che il modello possa ricevere («fino
   * a 25 righe»), e la garanzia la dà comunque il server — `clampLimit` taglia
   * qualunque valore fuori intervallo. Lo strumento TERMINALE invece rinuncia
   * ai vincoli e tiene la modalità stretta, perché lì ciò che conta è che la
   * FORMA della risposta non possa sbagliare (§65).
   */
  strictSchema?: boolean;
}

// ---------------------------------------------------------------------------
// Frammenti di schema riusati
//
// Scritti una volta sola: un `limit` con due tetti diversi in due strumenti è
// il genere di incoerenza che nessuno nota finché non produce una risposta
// troncata dove non doveva.
// ---------------------------------------------------------------------------

const LIMIT = (max: number, def: number) => ({
  type: 'integer', minimum: 1, maximum: max, default: def,
  description: `Quante righe al massimo (fino a ${max}).`,
});

const PERIOD = {
  type: 'string',
  enum: [...NAMED_PERIODS],
  description:
    'Periodo nominato. Il server lo trasforma in due date esatte nel fuso orario ' +
    'dell\'utente: NON calcolare tu le date. Usa `from`/`to` solo se l\'utente ha ' +
    'detto una data precisa.',
};

const ISO_DATE = (what: string) => ({
  type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  description: `${what} in forma AAAA-MM-GG.`,
});

const UUID = (what: string) => ({
  type: 'string',
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  description: what,
});

/**
 * Chi. `me` è l'utente che sta chiedendo — il server lo risolve dalla sessione.
 * §72 — «Cosa devo fare oggi?» è `me`; una domanda sulla squadra è `anyone`.
 */
const ASSIGNEE_SCOPE = {
  type: 'string', enum: ['me', 'anyone', 'unassigned'], default: 'anyone',
  description:
    'A chi è assegnato. «me» = chi sta facendo la domanda (lo risolve il server, ' +
    'non passare un identificativo). Se la domanda è personale («cosa devo fare»), ' +
    'usa «me»; se riguarda l\'azienda («cosa deve fare il team»), usa «anyone».',
};

const obj = (properties: Record<string, unknown>, required: string[] = []): JsonSchema => ({
  type: 'object', properties, required, additionalProperties: false,
});

// ---------------------------------------------------------------------------
// Gli strumenti
// ---------------------------------------------------------------------------

export const ASSISTANT_TOOLS: AssistantToolDefinition[] = [
  // -- Panoramica ----------------------------------------------------------
  {
    key: 'get_company_overview',
    description:
      'Conteggi d\'insieme dell\'azienda: attività aperte e scadute, documenti da verificare, ' +
      'voci finanziarie da verificare e in scadenza, contratti da verificare e in rinnovo, ' +
      'opportunità aperte, automazioni che richiedono attenzione, messaggi che richiedono ' +
      'attenzione. Usalo per «cosa richiede attenzione oggi» e come primo passo quando la ' +
      'domanda è generica. NON restituisce elenchi: per i dettagli servono gli strumenti del modulo.',
    inputSchema: obj({}),
    sourceType: 'company_overview',
    permission: 'member', costClass: 'normal', maxRows: 1, timeoutMs: 8000, module: 'overview',
  },

  // -- Attività ------------------------------------------------------------
  {
    key: 'list_tasks',
    description:
      'Attività, filtrate per stato, priorità, responsabile o testo. Usalo per «cosa devo fare», ' +
      '«quali attività sono scadute», «quali non sono assegnate». Per una domanda su un ' +
      'INTERVALLO DI DATE usa invece list_tasks_by_due_date.',
    inputSchema: obj({
      view: {
        type: 'string', enum: ['todo', 'overdue', 'completed', 'all'], default: 'todo',
        description: '«todo» = aperte; «overdue» = con scadenza già passata; «all» = tutte le non archiviate.',
      },
      assignee: ASSIGNEE_SCOPE,
      priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      status: { type: 'string', enum: ['open', 'in_progress', 'waiting', 'completed'] },
      search: { type: 'string', maxLength: 80, description: 'Testo nel titolo, nella descrizione o nell\'ente.' },
      limit: LIMIT(25, 10),
    }),
    sourceType: 'task',
    permission: 'member', costClass: 'cheap', maxRows: 25, timeoutMs: 8000, module: 'tasks',
  },
  {
    key: 'list_tasks_by_due_date',
    description:
      'Attività con scadenza in un intervallo. Usalo per «questa settimana», «domani», ' +
      '«nei prossimi 7 giorni». Le attività già scadute possono essere incluse a parte.',
    inputSchema: obj({
      period: PERIOD,
      from: ISO_DATE('Inizio dell\'intervallo'),
      to: ISO_DATE('Fine dell\'intervallo'),
      assignee: ASSIGNEE_SCOPE,
      includeOverdue: {
        type: 'boolean', default: false,
        description: 'Se vero, aggiunge le attività già scadute anche se fuori dall\'intervallo.',
      },
      limit: LIMIT(25, 15),
    }),
    sourceType: 'task',
    permission: 'member', costClass: 'cheap', maxRows: 25, timeoutMs: 8000, module: 'tasks',
  },
  {
    key: 'get_task_details',
    description:
      'Una singola attività con i suoi collegamenti: documento, contratto, cliente, opportunità, ' +
      'messaggio email di provenienza, elenco di controllo. Usalo quando serve sapere da dove nasce.',
    inputSchema: obj({ taskId: UUID('Identificativo dell\'attività.') }, ['taskId']),
    sourceType: 'task',
    permission: 'member', costClass: 'cheap', maxRows: 1, timeoutMs: 8000, module: 'tasks',
  },

  // -- Documenti -----------------------------------------------------------
  {
    key: 'search_documents',
    description:
      'Cerca nei documenti per testo, mittente, categoria, stato o data. La ricerca copre titolo, ' +
      'mittente, oggetto, tipo, numeri di riferimento e il testo completo del documento. ' +
      'I valori restituiti sono già quelli EFFETTIVI: se una persona ha corretto un campo, ' +
      'vedi la correzione, non il valore dell\'AI.',
    inputSchema: obj({
      query: { type: 'string', maxLength: 120, description: 'Parole da cercare. Per un mittente scrivi il nome così com\'è.' },
      category: {
        type: 'string',
        enum: ['administration', 'taxes', 'social_insurance', 'invoices', 'contracts', 'insurance',
               'banking', 'employees', 'clients', 'suppliers', 'other'],
      },
      state: {
        type: 'string', enum: ['to_verify', 'analyzed', 'failed', 'processing', 'none'],
        description: '«to_verify» = l\'analisi chiede una verifica umana.',
      },
      period: PERIOD,
      from: ISO_DATE('Data del documento, da'),
      to: ISO_DATE('Data del documento, a'),
      hasDeadline: { type: 'boolean', default: false, description: 'Solo documenti con una scadenza rilevata.' },
      limit: LIMIT(25, 10),
    }),
    sourceType: 'document',
    permission: 'member', costClass: 'normal', maxRows: 25, timeoutMs: 8000, module: 'documents',
  },
  {
    key: 'get_document_details',
    description:
      'Un singolo documento: mittente, tipo, data, scadenza, importo — con l\'indicazione di quali ' +
      'campi sono stati corretti da una persona e quali vengono dall\'analisi automatica.',
    inputSchema: obj({ documentId: UUID('Identificativo del documento.') }, ['documentId']),
    sourceType: 'document',
    permission: 'member', costClass: 'cheap', maxRows: 1, timeoutMs: 8000, module: 'documents',
  },
  {
    key: 'get_document_evidence',
    description:
      'Le citazioni testuali su cui l\'analisi di un documento si basa: la frase esatta e la pagina. ' +
      'Usalo quando l\'utente chiede «da dove viene questo dato» o quando devi citare una fonte ' +
      'testuale. Il testo restituito viene DAL DOCUMENTO: riportalo, non riscriverlo.',
    inputSchema: obj({
      documentId: UUID('Identificativo del documento.'),
      field: {
        type: 'string', enum: ['sender', 'deadline', 'amount', 'all'], default: 'all',
        description: 'Quale campo interessa.',
      },
    }, ['documentId']),
    sourceType: 'document_evidence',
    permission: 'member', costClass: 'normal', maxRows: 10, timeoutMs: 8000, module: 'documents',
  },
  {
    key: 'get_document_email_origin',
    description:
      'Da quale messaggio email è arrivato un documento: mittente, oggetto, data, casella. ' +
      'Usalo per «da quale email è arrivata questa fattura». Uno stesso documento può essere ' +
      'collegato a più messaggi.',
    inputSchema: obj({ documentId: UUID('Identificativo del documento.') }, ['documentId']),
    sourceType: 'email_message',
    permission: 'member', costClass: 'cheap', maxRows: 10, timeoutMs: 8000, module: 'inbox',
  },

  // -- Posta ---------------------------------------------------------------
  {
    key: 'list_inbox_messages',
    description:
      'Messaggi email ricevuti: mittente, oggetto, data, stato di attenzione, allegati. ' +
      '⚠️ Il CORPO del messaggio non è disponibile e non lo sarà: rispondi su mittente, oggetto ' +
      'e data, oppure sui documenti che ne sono nati.',
    inputSchema: obj({
      attention: {
        type: 'string', enum: ['needs_attention', 'to_verify', 'informational', 'ignored', 'handled'],
        description: 'Stato di attenzione per la persona.',
      },
      sender: { type: 'string', maxLength: 120, description: 'Parte del nome o dell\'indirizzo del mittente.' },
      period: PERIOD,
      from: ISO_DATE('Data di ricezione, da'),
      to: ISO_DATE('Data di ricezione, a'),
      limit: LIMIT(25, 10),
    }),
    sourceType: 'email_message',
    permission: 'member', costClass: 'normal', maxRows: 25, timeoutMs: 8000, module: 'inbox',
  },
  {
    key: 'get_email_details',
    description:
      'Un singolo messaggio: mittente, oggetto, data, allegati e documenti che ne sono nati. ' +
      '⚠️ Senza il corpo.',
    inputSchema: obj({ messageId: UUID('Identificativo del messaggio.') }, ['messageId']),
    sourceType: 'email_message',
    permission: 'member', costClass: 'cheap', maxRows: 1, timeoutMs: 8000, module: 'inbox',
  },

  // -- Finanze -------------------------------------------------------------
  {
    key: 'list_finance_items',
    description:
      'Fatture di fornitori, ricevute e note di credito. Usalo per «quali fatture scadono», ' +
      '«quali sono da verificare», «ci sono duplicati». ' +
      '⚠️ Il prodotto NON conosce i pagamenti: «scaduta» significa che la data di scadenza è ' +
      'passata, MAI che è rimasta non pagata.',
    inputSchema: obj({
      type: { type: 'string', enum: ['supplier_invoice', 'receipt', 'credit_note'] },
      review: { type: 'string', enum: ['needs_review', 'ready'], description: '«needs_review» = una persona deve ancora verificarla.' },
      supplier: { type: 'string', maxLength: 120, description: 'Nome del fornitore.' },
      currency: { type: 'string', pattern: '^[A-Za-z]{3}$', description: 'Codice valuta ISO, per esempio CHF.' },
      duePeriod: PERIOD,
      dueFrom: ISO_DATE('Scadenza, da'),
      dueTo: ISO_DATE('Scadenza, a'),
      onlyDuplicates: { type: 'boolean', default: false, description: 'Solo i possibili duplicati.' },
      onlyFlagged: { type: 'boolean', default: false, description: 'Solo quelli con qualcosa che non torna.' },
      sort: { type: 'string', enum: ['default', 'due_date', 'amount', 'recent', 'supplier'], default: 'default' },
      limit: LIMIT(25, 10),
    }),
    sourceType: 'finance_item',
    permission: 'member', costClass: 'normal', maxRows: 25, timeoutMs: 8000, module: 'finance',
  },
  {
    key: 'get_finance_item_details',
    description:
      'Una singola voce finanziaria: importi, valuta, scadenza, fornitore, riferimento di pagamento, ' +
      'quali campi ha corretto una persona, quali incoerenze sono state rilevate e da dove viene ' +
      'ogni valore (codice QR, lettura deterministica o AI).',
    inputSchema: obj({ itemId: UUID('Identificativo della voce finanziaria.') }, ['itemId']),
    sourceType: 'finance_item',
    permission: 'member', costClass: 'normal', maxRows: 1, timeoutMs: 8000, module: 'finance',
  },
  {
    key: 'get_finance_summary',
    description:
      'Totali finanziari PER VALUTA: da verificare, in scadenza, scaduti, spese del mese. ' +
      '⚠️ Non sommare valute diverse: riporta «CHF 8\'200 e EUR 1\'400», mai un totale unico.',
    inputSchema: obj({
      dueDays: { type: 'integer', minimum: 1, maximum: 90, default: 7, description: 'Finestra «in scadenza», in giorni.' },
    }),
    sourceType: 'finance_item',
    permission: 'member', costClass: 'cheap', maxRows: 20, timeoutMs: 8000, module: 'finance',
  },
  {
    key: 'get_finance_duplicates',
    description:
      'Le altre voci che sembrano lo stesso documento di quella indicata (stesso fornitore, numero, ' +
      'importo e valuta). Sono SOSPETTI calcolati, non una dichiarazione che siano duplicati.',
    inputSchema: obj({ itemId: UUID('Identificativo della voce da confrontare.') }, ['itemId']),
    sourceType: 'finance_item',
    permission: 'member', costClass: 'cheap', maxRows: 20, timeoutMs: 8000, module: 'finance',
  },

  // -- Contratti -----------------------------------------------------------
  {
    key: 'list_contracts',
    description:
      'Contratti, con la finestra di rinnovo e quella di preavviso. Usalo per «quali contratti si ' +
      'rinnovano nei prossimi 90 giorni», «quali devo verificare», «chi ne è responsabile». ' +
      '⚠️ Riporta ciò che il contratto DICE. Non dire mai che cosa si deve fare per legge.',
    inputSchema: obj({
      view: {
        type: 'string', enum: ['all', 'needs_review', 'active', 'renewals', 'notices'], default: 'all',
        description: '«renewals» = rinnovo entro la finestra; «notices» = termine di preavviso entro la finestra.',
      },
      windowDays: { type: 'integer', minimum: 1, maximum: 365, default: 90, description: 'Ampiezza della finestra, in giorni.' },
      contractType: {
        type: 'string',
        enum: ['insurance', 'leasing', 'rent', 'telecom', 'software_subscription', 'supplier',
               'maintenance', 'service', 'licensing', 'nda', 'other'],
      },
      query: { type: 'string', maxLength: 120, description: 'Nome del contratto o della controparte.' },
      withoutOwner: { type: 'boolean', default: false, description: 'Solo quelli senza responsabile.' },
      limit: LIMIT(25, 10),
    }),
    sourceType: 'contract',
    permission: 'member', costClass: 'normal', maxRows: 25, timeoutMs: 8000, module: 'contracts',
  },
  {
    key: 'get_contract_details',
    description:
      'Un singolo contratto: controparte, durata, rinnovo automatico, preavviso, costo, e — questo ' +
      'è il punto — se i termini mostrati sono VERIFICATI da una persona o sono ancora una BOZZA ' +
      'proposta dal sistema. Dillo sempre nella risposta.',
    inputSchema: obj({ contractId: UUID('Identificativo del contratto.') }, ['contractId']),
    sourceType: 'contract',
    permission: 'member', costClass: 'normal', maxRows: 1, timeoutMs: 8000, module: 'contracts',
  },
  {
    key: 'list_contract_milestones',
    description:
      'Le date di un contratto — inizio, fine, rinnovo, termine di preavviso — con lo stato di ' +
      'ciascuna: «verified» = confermata da una persona, «candidate» = proposta dal sistema e NON ' +
      'ancora verificata. Include la provenienza: letta nel documento, calcolata, o inserita a mano. ' +
      'Usalo quando l\'utente chiede da dove viene una data o se è certa.',
    inputSchema: obj({
      contractId: UUID('Identificativo del contratto.'),
      status: { type: 'string', enum: ['candidate', 'verified', 'all'], default: 'all' },
    }, ['contractId']),
    sourceType: 'contract_milestone',
    permission: 'member', costClass: 'cheap', maxRows: 20, timeoutMs: 8000, module: 'contracts',
  },

  // -- Clienti -------------------------------------------------------------
  {
    key: 'search_crm_organizations',
    description:
      'Cerca clienti, fornitori e controparti per nome, ruolo o responsabile. Usalo per ' +
      '«che cosa sappiamo su …», «quali clienti non sentiamo da un mese».',
    inputSchema: obj({
      query: { type: 'string', maxLength: 120, description: 'Nome, anche parziale.' },
      role: {
        type: 'string',
        enum: ['lead', 'prospect', 'customer', 'former_customer', 'supplier', 'partner', 'authority', 'other'],
      },
      staleDays: {
        type: 'integer', minimum: 1, maximum: 365,
        description: 'Solo chi non ha comunicazioni collegate da almeno N giorni (chi non è mai stato contattato rientra).',
      },
      onlyOverdueTasks: { type: 'boolean', default: false, description: 'Solo chi ha attività scadute collegate.' },
      onlyWithoutOpenOpportunity: { type: 'boolean', default: false },
      limit: LIMIT(25, 10),
    }),
    sourceType: 'crm_organization',
    permission: 'member', costClass: 'normal', maxRows: 25, timeoutMs: 8000, module: 'crm',
  },
  {
    key: 'get_crm_organization_details',
    description:
      'Una singola organizzazione: ruoli, sede, responsabile, ultimo contatto, e quanti documenti, ' +
      'contratti, voci finanziarie, attività e opportunità sono collegati. ' +
      '⚠️ Non restituisce note interne né recapiti di singole persone, e non deve dedurne giudizi.',
    inputSchema: obj({ organizationId: UUID('Identificativo dell\'organizzazione.') }, ['organizationId']),
    sourceType: 'crm_organization',
    permission: 'member', costClass: 'normal', maxRows: 1, timeoutMs: 8000, module: 'crm',
  },
  {
    key: 'list_crm_opportunities',
    description:
      'Opportunità commerciali. Usalo per «quali non hanno un prossimo passo», «quali follow-up ' +
      'sono scaduti». ⚠️ Nessuna probabilità di chiusura e nessun totale che mescoli valute.',
    inputSchema: obj({
      stage: { type: 'string', enum: ['lead', 'contacted', 'proposal', 'negotiation', 'won', 'lost'] },
      organizationId: UUID('Limita a una sola organizzazione.'),
      onlyWithoutNextStep: { type: 'boolean', default: false },
      onlyOverdueNextStep: { type: 'boolean', default: false },
      limit: LIMIT(25, 15),
    }),
    sourceType: 'crm_opportunity',
    permission: 'member', costClass: 'normal', maxRows: 25, timeoutMs: 8000, module: 'crm',
  },
  {
    key: 'get_crm_timeline',
    description:
      'Che cosa è successo con un\'organizzazione, in ordine di tempo: comunicazioni, interazioni, ' +
      'attività, contratti. Serve a rispondere «da quanto non li sentiamo» con un fatto e non con ' +
      'un\'impressione. ⚠️ Non contiene il testo delle note né il corpo delle email.',
    inputSchema: obj({
      organizationId: UUID('Identificativo dell\'organizzazione.'),
      limit: LIMIT(20, 10),
    }, ['organizationId']),
    sourceType: 'crm_organization',
    permission: 'member', costClass: 'normal', maxRows: 20, timeoutMs: 8000, module: 'crm',
  },

  // -- Automazioni ---------------------------------------------------------
  {
    key: 'list_workflow_failures',
    description:
      'Automazioni che richiedono attenzione: quelle con esecuzioni fallite, quelle messe in pausa ' +
      'dal sistema dopo troppi errori, e il codice del problema. ' +
      '⚠️ L\'assenza di esecuzioni NON significa che l\'automazione non abbia mai visto nulla: ' +
      'un\'esecuzione si registra solo quando le condizioni corrispondono.',
    inputSchema: obj({ limit: LIMIT(20, 10) }),
    sourceType: 'workflow_definition',
    permission: 'member', costClass: 'cheap', maxRows: 20, timeoutMs: 8000, module: 'workflows',
  },
  {
    key: 'get_workflow_run_details',
    description:
      'Una singola esecuzione di un\'automazione: esito, azioni compiute o fallite, codice d\'errore. ' +
      '⚠️ Non restituisce la configurazione tecnica della regola.',
    inputSchema: obj({ runId: UUID('Identificativo dell\'esecuzione.') }, ['runId']),
    sourceType: 'workflow_run',
    permission: 'member', costClass: 'cheap', maxRows: 1, timeoutMs: 8000, module: 'workflows',
  },

  // -- Disambiguazione -----------------------------------------------------
  {
    key: 'resolve_entity',
    description:
      'Trova a che cosa si riferisce un nome: organizzazioni del CRM, controparti di contratti, ' +
      'fornitori di voci finanziarie. ' +
      '⚠️ USALO PRIMA di rispondere quando l\'utente nomina qualcuno senza precisare («Rossi»). ' +
      'Se restituisce più candidati, NON sceglierne uno: chiedi all\'utente quale, con ' +
      'submit_answer e status «needs_disambiguation».',
    inputSchema: obj({
      name: { type: 'string', minLength: 2, maxLength: 120, description: 'Il nome così come l\'utente l\'ha scritto.' },
    }, ['name']),
    sourceType: 'crm_organization',
    permission: 'member', costClass: 'normal', maxRows: 10, timeoutMs: 8000, module: 'crm',
  },
];

// ---------------------------------------------------------------------------
// Lo strumento terminale
//
// §64/§65 — la risposta NON è testo libero da riparsare: è l'ingresso di uno
// strumento con schema stretto (`strict: true`), validato dall'API prima ancora
// di arrivare qui. È la Strategia B del requisito, realizzata con uno strumento
// invece che con `output_config.format`, per una ragione verificata contro
// l'API corrente: dentro un ciclo di tool use un formato d'uscita imposto
// vincolerebbe anche i turni intermedi, che devono poter essere chiamate a
// strumenti. Lo strumento terminale non ha quel problema e dà lo stesso
// risultato — uno schema garantito.
//
// ⚠️ `citedRefs` accetta SOLO i riferimenti opachi (`f1`, `f2`, …) che il server
// ha assegnato ai risultati. Il modello non ha mai visto un identificativo di
// riga e non può inventarne uno che superi la validazione (§60).
// ---------------------------------------------------------------------------
export const SUBMIT_ANSWER_TOOL: AssistantToolDefinition = {
  key: 'submit_answer',
  description:
    'Consegna la risposta definitiva. Chiamalo UNA SOLA VOLTA, come ultima azione. ' +
    'Ogni affermazione sui dati aziendali deve avere un riferimento in citedRefs.',
  // ⚠️ NESSUN VINCOLO NUMERICO O DI LUNGHEZZA in questo schema, e non per
  // dimenticanza: la modalità stretta li rifiuta con 400. I limiti («al massimo
  // tre», «al massimo dodici») restano scritti nelle descrizioni — che il
  // modello legge — e IMPOSTI da `validateAnswerShape`, che taglia gli elenchi
  // e scarta i riferimenti malformati. La garanzia non si è persa: si è
  // spostata dove non può essere rifiutata.
  inputSchema: obj({
    status: {
      type: 'string',
      enum: ['answered', 'partial', 'insufficient_evidence', 'needs_disambiguation', 'out_of_scope'],
      description:
        '«answered» = risposta sostenuta dalle fonti. «partial» = uno strumento ha fallito e lo dichiari. ' +
        '«insufficient_evidence» = nei dati accessibili non c\'è abbastanza per rispondere. ' +
        '«needs_disambiguation» = più entità possibili, deve scegliere l\'utente. ' +
        '«out_of_scope» = non è una domanda sui dati dell\'azienda.',
    },
    text: {
      type: 'string',
      description:
        'La risposta per la persona, al massimo 4000 caratteri. Prima il fatto, poi il dettaglio. ' +
        'Date e importi concreti. Testo semplice: niente tabelle, titoli o grassetto.',
    },
    citedRefs: {
      type: 'array',
      items: { type: 'string' },
      description:
        'I riferimenti delle fonti usate (`f1`, `f2`, …), nell\'ordine in cui compaiono nel testo. ' +
        'Al massimo dodici. Solo riferimenti che uno strumento ti ha davvero restituito.',
    },
    uncertainty: {
      type: 'string',
      description:
        'Che cosa non è verificato, se stai usando un dato proposto e non confermato. ' +
        'Altrimenti stringa vuota.',
    },
    followUps: {
      type: 'array', items: { type: 'string' },
      description: 'Al massimo tre domande successive, brevi e strettamente pertinenti ai dati appena mostrati.',
    },
    disambiguationRefs: {
      type: 'array', items: { type: 'string' },
      description:
        'Solo con status «needs_disambiguation»: i riferimenti (`f1`, `f2`, …) fra cui l\'utente deve scegliere.',
    },
  }, ['status', 'text', 'citedRefs', 'uncertainty', 'followUps', 'disambiguationRefs']),
  sourceType: 'company_overview',
  permission: 'member', costClass: 'cheap', maxRows: 0, timeoutMs: 1000, module: 'answer',
  strictSchema: true,
};

/**
 * Le parole chiave che la modalità stretta rifiuta.
 * Elencate qui e non solo nel commento perché la prova unitaria le usa: una
 * regola verificata vale più di una regola ricordata.
 */
export const STRICT_UNSUPPORTED_KEYWORDS = [
  'minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength',
  'minItems', 'maxItems', 'pattern', 'default',
] as const;

// ---------------------------------------------------------------------------
// Accessori
// ---------------------------------------------------------------------------

const BY_KEY = new Map<string, AssistantToolDefinition>(
  [...ASSISTANT_TOOLS, SUBMIT_ANSWER_TOOL].map((t) => [t.key, t]),
);

export const findTool = (key: string): AssistantToolDefinition | null => BY_KEY.get(key) ?? null;

/** Le chiavi ammesse. Serve al server per rifiutare uno strumento non registrato (§109). */
export const TOOL_KEYS: readonly string[] = ASSISTANT_TOOLS.map((t) => t.key);

/**
 * La forma che l'API si aspetta.
 *
 * `strict` solo dove lo schema è compatibile con la modalità stretta — cioè
 * sullo strumento terminale. Sugli strumenti di lettura la garanzia sui valori
 * la danno gli esecutori: `clampLimit` riporta un `limit` fuori intervallo
 * dentro i suoi estremi, `str()` scarta ciò che non è una stringa, e ogni
 * enumerazione passa dalla RPC che la conosce. Un valore fuori posto non
 * arriva al database: viene corretto prima.
 */
export function toApiTools(tools: AssistantToolDefinition[]): unknown[] {
  return tools.map((t) => ({
    name: t.key,
    description: t.description,
    input_schema: t.inputSchema,
    ...(t.strictSchema ? { strict: true } : {}),
  }));
}
