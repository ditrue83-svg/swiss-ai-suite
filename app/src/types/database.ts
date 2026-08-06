// ============================================================================
// Tipi del database (stile "Supabase generated types").
// Se in futuro usi la CLI: `supabase gen types typescript --linked > src/types/database.ts`
// sostituirà questo file mantenendo la stessa forma (Database → public → Tables…).
// I campi jsonb sono tipati come `Json`; le forme applicative precise stanno in models.ts
// e la mappatura avviene nel service layer.
//
// Allineato alla migrazione 0006 (pipeline Admin AI reale): estrazioni per pagina,
// schema ricco su document_analyses, bozze, correzioni umane, log tecnico.
// ============================================================================

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type MemberRole = 'owner' | 'admin' | 'member';
export type DocumentSourceType = 'upload' | 'pasted_text' | 'email';
// §25 — nuovi stati della pipeline. I legacy 'processing'/'analyzed' restano validi.
export type DocumentStatus =
  | 'uploaded' | 'extracting' | 'analyzing' | 'completed' | 'needs_review' | 'failed'
  | 'processing' | 'analyzed';
export type AnalysisStatus = 'pending' | 'completed' | 'needs_review' | 'failed';
/**
 * Registro attività (0039). ⚠️ Questi due elenchi sono la copia TypeScript di
 * due enum SQL: due copie divergono sempre, e il typecheck non può accorgersene
 * perché guarda solo il TypeScript. La rete è `npm run test:audit-unit`, che
 * legge gli enum dalla migrazione e li confronta con questi — la stessa cosa che
 * `test:crm-unit` fa con la 0026.
 */
export type AuditAction =
  | 'document_uploaded' | 'document_deleted'
  | 'analysis_started' | 'analysis_completed' | 'analysis_failed'
  | 'correction_saved' | 'reply_generated'
  | 'task_created' | 'task_updated'
  | 'member_added' | 'member_removed' | 'member_role_changed';
export type AuditEntityType = 'document' | 'analysis' | 'correction' | 'reply' | 'task' | 'membership';
export type ExtractionMethod = 'native_pdf' | 'ocr' | 'text';
/**
 * Categoria documentale (0017). NON è il tipo di documento: `DocumentType` dice
 * che cosa è un documento, la categoria dice dove sta nell'organizzazione
 * dell'azienda. Un sollecito dell'AFC è di tipo «sollecito» e di categoria
 * «imposte». Nel database si salva la chiave tecnica; l'etichetta si risolve al
 * render dai dizionari.
 * L'assenza di categoria (`null`) è uno stato legittimo — nessuno ha ancora
 * classificato — e va tenuta distinta da `other`, che è una scelta esplicita.
 */
export type DocumentCategory =
  | 'administration' | 'taxes' | 'social_insurance' | 'invoices' | 'contracts'
  | 'insurance' | 'banking' | 'employees' | 'clients' | 'suppliers' | 'subsidies' | 'other';
/** Chi ha deciso la categoria. Nessun valore `ai`: nessuna AI classifica. */
/**
 * Chi ha deciso la categoria. Nessun valore `ai`: nessuna AI classifica.
 * `rule` = la regola deterministica del prodotto (tipo di documento + ente),
 * `workflow` = una regola scritta dall'azienda (0020). Sono due cose diverse e
 * il documento deve poter dire quale delle due.
 */
export type DocumentCategorySource = 'rule' | 'manual' | 'workflow';
export type TaskPriority = 'low' | 'medium' | 'high';
/**
 * Stato di un'attività. `open` è il nome storico del database e nell'interfaccia
 * si chiama «Da fare»: rinominarlo avrebbe richiesto una migrazione distruttiva
 * su dati esistenti, per guadagnare solo una parola.
 */
export type TaskStatus = 'open' | 'in_progress' | 'waiting' | 'completed';
export type TaskEventKind =
  | 'created' | 'status_changed' | 'assignee_changed' | 'priority_changed'
  | 'due_date_changed' | 'completed' | 'reopened' | 'archived' | 'restored'
  | 'checklist_item_completed' | 'comment_added';
/**
 * Da dove nasce il lavoro. `workflow` (0020) è la provenienza di un'attività
 * creata da una REGOLA aziendale: non l'ha scritta una persona e non viene da
 * un modulo, e chi la riceve ha diritto di saperlo. Quale regola lo dice
 * `tasks.workflow_run_id`.
 */
/**
 * Da dove nasce il lavoro. `crm` (0026) è l'attività nata da una controparte o
 * da una trattativa — il «prossimo passo» che diventa lavoro assegnabile.
 * Quale controparte lo dicono `tasks.crm_organization_id` e `crm_opportunity_id`.
 */
export type TaskSource = 'admin_ai' | 'subsidy_ai' | 'manual' | 'workflow' | 'crm';
/**
 * ⚠️ NON È `SubsidyEligibilityStatus`, e i due non vanno confusi.
 *
 * Questo è `public.eligibility_status` della 0003, che il modulo 1.0 usa e che
 * `subsidy_cases.eligibility_status_at_creation` continua a portare. Il 2.0 ha
 * un tipo Postgres DIVERSO (`public.subsidy_eligibility_status`, 0032) con
 * cinque valori e senza alcun `eligible`. Sono due colonne, due tipi, due
 * significati: unificarli in TypeScript farebbe passare il compilatore su un
 * assegnamento che il database rifiuta.
 */
export type EligibilityStatus = 'unknown' | 'likely' | 'unlikely' | 'ineligible';
/**
 * ⚠️ CINQUE VALORI NUOVI DALLA 0032, e non sono cosmetici: il modulo 1.0
 * descriveva solo la preparazione, e mancava tutto ciò che accade DOPO l'invio
 * — cioè il momento in cui una PMI ha davvero bisogno di sapere a che punto è.
 * `approved` e `rejected` NON sono dedotti da niente: li registra una persona.
 */
export type SubsidyCaseStatus =
  | 'draft' | 'assessing' | 'collecting_documents' | 'ready' | 'submitted'
  | 'under_review' | 'approved' | 'rejected' | 'withdrawn' | 'closed';

// ---- Incentivi / Subsidy AI 2.0 (0032) -------------------------------------
// Gli enum del catalogo, dei dati d'impresa e della valutazione. Sono elencati
// qui e non dedotti da nessuna parte: il compilatore deve poter fallire quando
// una schermata dimentica un valore, che è precisamente ciò che i `Record`
// completi di `incentivesModel.ts` sfruttano.

export type SubsidySourceType =
  | 'official_program_page' | 'official_call_page' | 'official_database'
  | 'official_law' | 'official_regulation' | 'official_guideline'
  | 'official_pdf' | 'manual_official_source';
export type SubsidySourceCriticality = 'low' | 'normal' | 'high' | 'critical';
export type SubsidyVersionStatus = 'draft' | 'published' | 'superseded' | 'withdrawn';
/**
 * ⚠️ `unknown` NON è un ripiego: significa che la fonte non dice se la finestra
 * sia aperta, e presentarla come aperta o come chiusa sarebbe in entrambi i
 * casi un'invenzione. `continuous` è una finestra permanente, che è una cosa
 * diversa da «aperta fino a una data».
 */
export type SubsidyCallStatus =
  | 'upcoming' | 'open' | 'closed' | 'continuous' | 'suspended' | 'unknown';
export type SubsidyRuleHardness = 'hard' | 'soft' | 'exclusion' | 'informative';
export type SubsidyRuleEvaluability = 'auto' | 'question' | 'manual';
export type SubsidyProjectStage = 'idea' | 'planned' | 'started' | 'completed' | 'cancelled';
/** Da dove viene un fatto usato nella valutazione: è ciò che la rende verificabile. */
export type SubsidyFactSource =
  | 'company_profile' | 'company_registry' | 'project'
  | 'user_answer' | 'document' | 'interpretation' | 'unknown';
/**
 * ⚠️ NON ESISTE `eligible`, ed è la decisione più importante dello schema. Il
 * valore più alto è `potentially_eligible`: «i criteri che possiamo valutare
 * sembrano soddisfatti». Dichiarare un'impresa idonea sarebbe sostituirsi
 * all'autorità.
 */
export type SubsidyEligibilityStatus =
  | 'not_assessed' | 'insufficient_information' | 'potentially_eligible'
  | 'likely_ineligible' | 'ineligible';
/** Una FASCIA, non una percentuale: «82/100» letto da un imprenditore diventa «82%». */
export type SubsidyRelevanceLevel = 'high' | 'medium' | 'low';
export type SubsidyCriterionState =
  | 'satisfied' | 'not_satisfied' | 'unknown' | 'conflicting' | 'not_evaluable';
/** ⚠️ `unverified` non è «vecchio»: è «non l'abbiamo mai controllato». */
export type SubsidyFreshness = 'fresh' | 'aging' | 'stale' | 'unverified';
export type SubsidyCompleteness = 'complete' | 'minor_gaps' | 'major_gaps';
export type SubsidyTiming = 'open' | 'upcoming' | 'closed' | 'continuous' | 'unknown';
export type SubsidyReadiness = 'not_started' | 'in_preparation' | 'ready' | 'submitted';
export type SubsidyDismissalReason =
  | 'not_relevant' | 'already_applied' | 'not_now' | 'project_cancelled' | 'other';
export type SubsidyOpportunityKind = 'project' | 'general';
export type SubsidyCaseOutcome = 'approved' | 'rejected' | 'withdrawn' | 'unknown';
export type SubsidyDocumentRelation =
  | 'application_form' | 'business_plan' | 'budget' | 'financial_statement'
  | 'quotation' | 'partner_letter' | 'proof' | 'decision' | 'correspondence' | 'other';
export type SubsidyChecklistKind =
  | 'document' | 'verification' | 'contact' | 'preparation' | 'submission' | 'other';
export type SubsidyCaseEventKind =
  | 'case_created' | 'owner_changed' | 'status_changed' | 'assessment_updated'
  | 'document_linked' | 'document_unlinked' | 'checklist_completed'
  | 'checklist_reopened' | 'submitted' | 'outcome_recorded'
  | 'source_changed' | 'archived';
export type SubsidyPartnerRole =
  | 'research' | 'implementation' | 'supplier' | 'consortium' | 'other';

// ---- Inbox (0013) ----------------------------------------------------------
// Enum separati per stati che descrivono cose diverse (§8 del capitolato):
// dove è arrivata la macchina (`EmailProcessingStatus`), cosa deve fare una
// persona (`EmailAttentionStatus`), cosa ha concluso il classificatore
// (`EmailRelevance`). Fonderli renderebbe un guasto tecnico indistinguibile da
// «niente da fare».
export type EmailProvider = 'google' | 'microsoft';
export type EmailConnectionStatus = 'active' | 'reauth_required' | 'error' | 'disconnected';
export type EmailSyncType = 'initial' | 'incremental' | 'manual' | 'reconciliation';
export type EmailSyncStatus = 'running' | 'ok' | 'partial' | 'failed';
export type EmailProcessingStatus =
  | 'pending' | 'classifying' | 'importing' | 'awaiting_analysis' | 'analyzing' | 'done' | 'failed';
export type EmailAttentionStatus = 'needs_attention' | 'to_verify' | 'informational' | 'ignored' | 'handled';
export type EmailRelevance = 'likely_actionable' | 'possibly_actionable' | 'informational' | 'clearly_irrelevant';
export type EmailDocumentRelation = 'body' | 'attachment';
export type EmailAttachmentImportStatus =
  | 'pending' | 'imported' | 'skipped_inline' | 'skipped_unsupported' | 'skipped_too_large' | 'failed';

// ---- Calendario e notifiche (0018) -----------------------------------------
// `CalendarProvider` è un tipo PROPRIO e non un alias di `EmailProvider`: oggi
// hanno gli stessi due valori per coincidenza, e legarli significherebbe che
// aggiungere un provider di calendario ne aggiunge uno di posta.
export type CalendarProvider = 'google' | 'microsoft';
export type CalendarConnectionStatus = 'active' | 'reauth_required' | 'error' | 'disconnected';
/** Stato di un collegamento fra attività ed evento. `pending` è normale, non un guasto. */
export type CalendarSyncStatus = 'pending' | 'synced' | 'failed';
export type NotificationType =
  | 'task_assigned' | 'task_due_soon' | 'task_due_today' | 'task_overdue'
  | 'unassigned_task_due_soon' | 'calendar_sync_failed' | 'calendar_reauth_required'
  // 0020 — l'avviso prodotto da una regola aziendale. Il TESTO lo scrive
  // l'azienda dentro la regola: non è traducibile, ed è dichiarato come tale.
  | 'workflow_alert'
  // 0026 — la trattativa affidata a qualcuno. Non c'è una notifica «cliente
  // inattivo»: l'inattività è un giudizio con una soglia, e diventa lavoro
  // passando da una regola di automazione, non da una campanella automatica.
  | 'crm_opportunity_assigned'
  // 0032 — gli incentivi. QUATTRO e non dodici: si notifica ciò che cambia il
  // lavoro di una persona, non ogni rivalutazione.
  // ⚠️ Stanno qui perché il database li ammette: senza, lo `switch` di
  //    `notificationTitleKey` resta esaustivo per il compilatore e una riga
  //    reale gli passa accanto restituendo `undefined` — cioè la campanella va
  //    in crash su `t(undefined)`. È la stessa forma del `NEXT_STEP_TEXT`
  //    parziale della Panoramica: un elenco incompleto non sbaglia, rompe.
  | 'subsidy_new_opportunity' | 'subsidy_call_opened'
  | 'subsidy_deadline_approaching' | 'subsidy_program_changed';

// ---- CRM Light (0026) ------------------------------------------------------
// «Con chi stiamo lavorando». Il modulo COLLEGA le entità degli altri moduli
// senza copiarle: il nome del fornitore letto su una fattura resta in Finanze,
// la controparte letta su un contratto resta nei Contratti, il mittente di una
// email resta nell'Inbox. Qui si aggiunge un'identità, non si riscrive un fatto.

/**
 * Che rapporto abbiamo. Sono RUOLI e sono MULTIPLI: la stessa impresa può
 * essere insieme cliente, fornitore e partner — il caso che un campo unico
 * `type` rendeva inesprimibile. Da non confondere con `CrmOpportunityStage`,
 * che descrive una singola trattativa e non un rapporto.
 */
export type CrmOrganizationRole =
  | 'lead' | 'prospect' | 'customer' | 'former_customer'
  | 'supplier' | 'partner' | 'authority' | 'other';
/**
 * Lo stato del rapporto. DUE valori, non tre: «archiviata» non è uno stato ma
 * un `archived_at`, come in documents, tasks, contracts e finance_items. Uno
 * stato che duplica un timestamp finisce per divergere dal timestamp.
 */
export type CrmRelationshipStatus = 'active' | 'inactive';
/**
 * Come è nata questa riga. NON è una verifica d'identità: una controparte
 * suggerita da una fattura resta una proposta finché una persona non conferma.
 * Dal browser si possono dichiarare solo `manual`, `registry` e `import`.
 */
export type CrmSource =
  | 'manual' | 'email' | 'document' | 'contract' | 'finance' | 'registry' | 'import';
export type CrmContactMethodType = 'email' | 'phone' | 'mobile' | 'website' | 'other';
/** La fase di una TRATTATIVA, non il ruolo della controparte. */
export type CrmOpportunityStage =
  | 'lead' | 'contacted' | 'proposal' | 'negotiation' | 'won' | 'lost';
/** Le email non sono interazioni manuali: restano in `email_messages` e si collegano. */
export type CrmInteractionType = 'note' | 'call' | 'meeting' | 'other';
export type CrmDocumentRelation =
  | 'sender' | 'recipient' | 'counterparty' | 'customer' | 'supplier' | 'other';
/**
 * Perché due cose sono state avvicinate, e non è decorativo: decide se il
 * collegamento può avvenire da solo. `uid_exact` ed `email_exact` sono
 * identità; `domain_match` e `name_normalized` sono sospetti e restano
 * suggerimenti da confermare.
 */
export type CrmMatchReason =
  | 'uid_exact' | 'email_exact' | 'domain_match' | 'name_normalized' | 'manual'
  // 0030 — «il documento nomina qualcuno che nel CRM non c'è». Non è una
  // corrispondenza: è la sua assenza, e riusare `name_normalized` avrebbe
  // scritto «ragione sociale simile» dove non c'è niente a cui somigliare.
  | 'extracted_name';
/** `ignored` non è `rejected`: «non ora» e «no» sono risposte diverse. */
export type CrmLinkStatus = 'pending' | 'accepted' | 'rejected' | 'ignored';
export type CrmEventKind =
  | 'organization_created' | 'organization_updated'
  | 'role_added' | 'role_removed' | 'owner_changed'
  | 'contact_added' | 'contact_linked' | 'contact_unlinked'
  | 'opportunity_created' | 'opportunity_stage_changed'
  | 'opportunity_won' | 'opportunity_lost'
  | 'interaction_created' | 'entity_linked' | 'entity_unlinked'
  | 'archived' | 'restored' | 'merged';
export type CrmLinkedEntity =
  | 'document' | 'email_message' | 'task' | 'contract' | 'finance_item' | 'opportunity';

/** L'in-app non è un canale: l'in-app È la notifica. Vedi 0018. */
export type NotificationChannel = 'email';

// ---- Automazioni (0020) ----------------------------------------------------
// Gli inneschi sono SEI e corrispondono a fatti che il prodotto produce
// davvero: un innesco dichiarato e mai emesso sarebbe una funzione finta.
export type AutomationEventType =
  | 'document_analysis_completed' | 'document_category_changed' | 'email_attention_ready'
  | 'task_created' | 'task_status_changed' | 'task_became_overdue'
  // 0021 — i due inneschi di Finance. L'entità resta il DOCUMENTO: vedi il
  // registro, dove è spiegato perché non è stata introdotta un'entità nuova.
  | 'finance_item_needs_review' | 'finance_item_ready'
  // 0024 — i quattro inneschi dei Contratti. Qui l'entità è il CONTRATTO, e la
  // differenza con Finance è sostanziale: una fattura È la lettura di un
  // documento, un contratto ha PIÙ documenti e milestone che non appartengono a
  // nessuno di essi.
  | 'contract_verified' | 'contract_review_required'
  | 'contract_milestone_verified' | 'contract_milestone_window_opened'
  // 0026 — i sei inneschi del CRM. `crm_follow_up_due` non ha un trigger
  // proprio: lo emette la scansione periodica `crm_emit_follow_up_due`, che
  // gira dentro il worker delle automazioni già acceso. Nessun cron nuovo.
  | 'crm_organization_created' | 'crm_role_added'
  | 'crm_opportunity_created' | 'crm_opportunity_stage_changed'
  | 'crm_opportunity_won' | 'crm_follow_up_due'
  // 0032 — i sette inneschi degli incentivi. ⚠️ Stanno qui perché il database
  // li ammette: l'unione TypeScript deve SEGUIRE l'enum SQL, non inseguirlo.
  // Il registro condiviso li dichiara e un test confronta i due elenchi.
  | 'subsidy_opportunity_created' | 'subsidy_opportunity_high_relevance'
  | 'subsidy_call_opened' | 'subsidy_deadline_approaching'
  | 'subsidy_assessment_became_stale' | 'subsidy_case_status_changed'
  | 'subsidy_source_critical_change';
export type AutomationEventStatus = 'pending' | 'processing' | 'done' | 'failed' | 'dead_letter';
/**
 * Stato di una regola. L'archiviazione è uno STATO — non una data come per le
 * attività — perché ogni interrogazione del motore filtra proprio su questo
 * campo, e una regola archiviata non deve comparire in nessun elenco operativo.
 */
export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'archived';
export type WorkflowRunStatus = 'pending' | 'running' | 'succeeded' | 'partial' | 'failed' | 'skipped';
export type WorkflowActionStatus = 'pending' | 'succeeded' | 'skipped' | 'failed';
export type WorkflowAuditKind =
  | 'created' | 'updated' | 'activated' | 'paused' | 'archived' | 'restored'
  | 'retried' | 'auto_paused' | 'chain_depth_exceeded';
export type NotificationDeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

// ---- Finance Operations (0021) ---------------------------------------------
// Fatture fornitori, ricevute e note di credito. Il modulo COMPRENDE e PREPARA
// il denaro: non lo muove. Non esiste alcun tipo che descriva un pagamento, un
// ordine bancario o una registrazione contabile, e non è una dimenticanza.
export type FinanceItemType = 'supplier_invoice' | 'receipt' | 'credit_note';
/** A che punto è la MACCHINA. Non dice nulla su che cosa debba fare una persona. */
export type FinanceProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';
/**
 * Che cosa deve fare una PERSONA. Separato dal precedente di proposito (§109):
 * «l'estrazione è fallita» e «i dati vanno verificati» sono cose diverse.
 * `archived` NON è qui: l'archiviazione è un `archived_at`, come su documenti e
 * attività — altrimenti archiviare una fattura verificata cancellerebbe
 * l'informazione che era stata verificata.
 */
export type FinanceReviewStatus = 'needs_review' | 'ready';
/** Chi ha deciso che il documento è finanziario. Nessun valore `ai`. */
export type FinanceOrigin = 'rule' | 'manual' | 'workflow';
/** Da dove viene UN SINGOLO campo (§101). */
export type FinanceFieldSource = 'qr' | 'deterministic' | 'ai' | 'human';
/** Riferimento di pagamento svizzero: QR, creditore ISO 11649, oppure nessuno. */
export type FinanceReferenceType = 'qrr' | 'scor' | 'non';
/** Organizzazione di una spesa. ⚠️ NON è un conto contabile (§57). */
export type FinanceExpenseCategory =
  | 'travel' | 'meals' | 'office' | 'software' | 'vehicle' | 'other';
export type FinancePaymentMethod = 'card' | 'cash' | 'other';
export type FinanceExtractionStatus = 'completed' | 'failed';
/** Che cosa non torna. Chiavi, non frasi: la frase la scrive l'interfaccia. */
export type FinanceQualityFlag =
  | 'amount_mismatch' | 'vat_mismatch' | 'qr_text_mismatch'
  | 'missing_currency' | 'missing_total' | 'missing_supplier'
  | 'duplicate_suspected' | 'low_ocr_confidence'
  | 'invalid_iban' | 'invalid_reference' | 'reference_type_mismatch'
  | 'inconsistent_due_date' | 'ambiguous_date' | 'qr_not_read' | 'negative_amount';
export type FinanceEventKind =
  | 'created' | 'extraction_completed' | 'extraction_failed' | 'corrected'
  | 'reviewed' | 'reopened' | 'archived' | 'restored' | 'type_changed'
  | 'category_changed' | 'retry_requested';

// ---- Contract Manager (0024) -----------------------------------------------
// Contratti e accordi. Il modulo RIPORTA che cosa il documento dice: non dice
// che cosa il diritto impone. In questi tipi non esiste nulla che descriva una
// disdetta inviata, una firma, un rinnovo accettato o un parere legale — e non è
// una dimenticanza, è il confine del prodotto.
export type ContractType =
  | 'insurance' | 'leasing' | 'rent' | 'telecom' | 'software_subscription'
  | 'supplier' | 'maintenance' | 'service' | 'licensing' | 'nda' | 'other';
/**
 * Che cosa deve fare una PERSONA. ⚠️ `review_required_again` non è «da
 * verificare»: è «era verificato, poi è arrivato un documento che sembra
 * cambiare i termini». Fonderli farebbe sparire l'informazione per cui esiste
 * la gestione degli amendment (§9/§84).
 */
export type ContractReviewStatus = 'needs_review' | 'verified' | 'review_required_again';
/**
 * Lo stato operativo del rapporto. ⚠️ NON si deriva da una data passata (§118):
 * un contratto con rinnovo tacito e scadenza superata non è finito, e
 * dichiararlo tale spegnerebbe la sorveglianza su un impegno ancora in vigore.
 */
export type ContractLifecycleStatus = 'unknown' | 'upcoming' | 'active' | 'ended' | 'terminated';
/** Che ruolo ha un documento dentro il contratto (§5). */
export type ContractDocumentRelation =
  | 'main_agreement' | 'amendment' | 'annex' | 'renewal' | 'termination_notice' | 'other';
export type ContractOrigin = 'manual' | 'rule' | 'workflow';
export type ContractProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ContractExtractionStatus = 'completed' | 'failed';
/** §25 — una bozza si ricalcola; una versione verificata è immutabile. */
export type ContractTermVersionStatus = 'draft' | 'verified' | 'superseded';
/**
 * §33 — ⚠️ `none` («il contratto è a tempo indeterminato») e `unknown` («non
 * l'ho trovata») sono due affermazioni diverse: confonderle trasformerebbe
 * un'ignoranza in una dichiarazione.
 */
export type ContractEndKind = 'explicit' | 'none' | 'unknown';
/**
 * §35 — TRE valori e mai un booleano: un documento che non parla di rinnovo non
 * dice «no», dice niente. Un `false` al posto di `unclear` è la bugia più
 * costosa che questo modulo possa raccontare.
 */
export type ContractAutoRenewal = 'yes' | 'no' | 'unclear';
export type ContractPeriodUnit = 'days' | 'weeks' | 'months' | 'years';
/**
 * §38 — l'ancoraggio del preavviso. «Tre mesi» non è un termine: è un numero in
 * cerca di una data. Solo i primi due producono un calcolo di cui il prodotto
 * risponde; gli altri esistono per poter dire «non è possibile derivare una
 * data» invece di tacere o, peggio, di calcolare.
 */
export type ContractNoticeAnchor =
  | 'before_fixed_end' | 'before_renewal_date'
  | 'to_month_end' | 'to_quarter_end' | 'to_year_end'
  | 'anytime' | 'other' | 'unclear';
export type ContractTerminationMethod =
  | 'written_notice' | 'email' | 'registered_mail' | 'portal' | 'other';
export type ContractCostFrequency =
  | 'one_time' | 'monthly' | 'quarterly' | 'yearly' | 'other' | 'unknown';
export type ContractMilestoneKind =
  | 'contract_start' | 'contract_end' | 'renewal_date' | 'notice_deadline'
  | 'review_date' | 'other';
/** §41 — `explicit` è letta nel contratto, `derived` calcolata, `manual` decisa. */
export type ContractMilestoneSource = 'explicit' | 'derived' | 'manual';
/**
 * ⚠️ §43/§44 — LA DISTINZIONE FONDAMENTALE. `candidate` è una proposta del
 * sistema e NON può generare lavoro; `verified` è una data che una persona ha
 * confermato. `dismissed` è un giudizio umano, `superseded` un fatto.
 */
export type ContractMilestoneStatus = 'candidate' | 'verified' | 'dismissed' | 'superseded';
/** Che cosa va guardato. Chiavi, non frasi: la frase la scrive l'interfaccia. */
export type ContractQualityFlag =
  | 'missing_counterparty' | 'ambiguous_start_date' | 'ambiguous_end_date'
  | 'renewal_unclear' | 'notice_anchor_unclear' | 'notice_not_derivable'
  | 'conflicting_terms' | 'missing_referenced_annex' | 'low_extraction_confidence'
  | 'amendment_requires_review' | 'partially_analysed' | 'out_of_scope_contract_kind'
  | 'cost_unclear' | 'multiple_currencies';
export type ContractEventKind =
  | 'created' | 'document_added' | 'document_removed' | 'extraction_completed'
  | 'extraction_failed' | 'corrected' | 'verified' | 'review_reopened'
  | 'owner_changed' | 'term_version_verified' | 'milestone_verified'
  | 'milestone_dismissed' | 'milestone_added' | 'amendment_added'
  | 'archived' | 'restored' | 'lifecycle_changed' | 'retry_requested';
/** Le clausole che si RILEVANO, senza giudicarle (§59/§60). */
export type ContractAttentionClauseKind =
  | 'automatic_renewal' | 'minimum_duration' | 'termination_fee' | 'exclusivity'
  | 'price_adjustment' | 'notice_requirement' | 'confidentiality' | 'data_processing'
  | 'minimum_purchase_commitment' | 'liability_limitation' | 'other';


// ---------------------------------------------------------------------------
// Company Assistant (0027) — «Chiedi ad AI-Swisse»
//
// ⚠️ Nessuna di queste tabelle contiene dati aziendali: domande, risposte e
// RIFERIMENTI. `assistant_citations.value_snapshot` porta l'istantanea minima
// che serve a sapere su quale stato della fonte la risposta si basava (§92),
// non una copia della fonte.
// ---------------------------------------------------------------------------
export type AssistantThreadStatus = 'active' | 'archived';
export type AssistantMessageRole = 'user' | 'assistant';
export type AssistantRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';
export type AssistantAnswerStatusDb =
  | 'answered' | 'partial' | 'insufficient_evidence' | 'needs_disambiguation' | 'out_of_scope';
export type AssistantToolStatus = 'ok' | 'empty' | 'denied' | 'error' | 'timeout';
export type AssistantSourceTypeDb =
  | 'document' | 'document_evidence' | 'email_message' | 'task' | 'finance_item'
  | 'contract' | 'contract_milestone' | 'contract_term' | 'crm_organization'
  | 'crm_opportunity' | 'workflow_run' | 'workflow_definition' | 'company_overview';
export type AssistantFeedbackRating = 'helpful' | 'not_helpful';
export type AssistantFeedbackReasonDb = 'wrong_data' | 'wrong_source' | 'incomplete' | 'misunderstood';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; first_name: string; last_name: string; email: string | null; created_at: string; updated_at: string };
        Insert: { id: string; first_name?: string; last_name?: string; email?: string | null };
        Update: { first_name?: string; last_name?: string; email?: string | null };
        Relationships: [];
      };
      companies: {
        Row: { id: string; legal_name: string; uid_che: string | null; canton: string | null; municipality: string | null; legal_form: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; legal_name: string; uid_che?: string | null; canton?: string | null; municipality?: string | null; legal_form?: string | null };
        Update: { legal_name?: string; uid_che?: string | null; canton?: string | null; municipality?: string | null; legal_form?: string | null };
        Relationships: [];
      };
      company_members: {
        Row: { id: string; company_id: string; user_id: string; role: MemberRole; created_at: string };
        Insert: { id?: string; company_id: string; user_id: string; role?: MemberRole };
        Update: { role?: MemberRole };
        Relationships: [];
      };
      company_profiles: {
        Row: { company_id: string; sector: string | null; employee_count: number | null; revenue_band: string | null; owns_property: boolean; vehicle_count: number; current_projects: Json; created_at: string; updated_at: string };
        Insert: { company_id: string; sector?: string | null; employee_count?: number | null; revenue_band?: string | null; owns_property?: boolean; vehicle_count?: number; current_projects?: Json };
        Update: { sector?: string | null; employee_count?: number | null; revenue_band?: string | null; owns_property?: boolean; vehicle_count?: number; current_projects?: Json };
        Relationships: [];
      };
      documents: {
        Row: {
          id: string; company_id: string; uploaded_by: string | null; title: string;
          original_filename: string | null; mime_type: string | null; file_size: number | null;
          storage_path: string | null; source_type: DocumentSourceType; status: DocumentStatus;
          file_hash: string | null; page_count: number | null; created_at: string; updated_at: string;
          // 0017 — organizzazione aziendale. Il dato del documento resta nell'analisi.
          category: DocumentCategory | null; category_source: DocumentCategorySource | null;
          category_set_by: string | null; category_set_at: string | null;
          archived_at: string | null; archived_by: string | null;
          internal_notes: string | null; notes_updated_at: string | null; notes_updated_by: string | null;
          // 0020 — quale esecuzione di quale regola ha messo la categoria.
          category_workflow_run_id: string | null;
        };
        Insert: { id?: string; company_id: string; uploaded_by?: string | null; title: string; original_filename?: string | null; mime_type?: string | null; file_size?: number | null; storage_path?: string | null; source_type?: DocumentSourceType; status?: DocumentStatus; file_hash?: string | null; page_count?: number | null };
        // 0017 — `category_source`, `category_set_by/at`, `archived_by` e i timbri
        // della nota NON compaiono: li scrive il trigger `documents_guard`, e un
        // client che li mandasse li vedrebbe comunque sovrascritti. `archived_at`
        // c'è perché è il modo in cui si DICHIARA di voler archiviare; il valore
        // vero lo mette il database.
        Update: {
          title?: string; original_filename?: string | null; mime_type?: string | null;
          file_size?: number | null; storage_path?: string | null; source_type?: DocumentSourceType;
          status?: DocumentStatus; file_hash?: string | null; page_count?: number | null;
          category?: DocumentCategory | null; archived_at?: string | null; internal_notes?: string | null;
        };
        Relationships: [];
      };
      document_tags: {
        Row: { id: string; company_id: string; name: string; created_by: string | null; created_at: string };
        // `created_by` lo imposta il trigger: chi crea un'etichetta è chi sta scrivendo.
        Insert: { id?: string; company_id: string; name: string };
        Update: { name?: string };
        Relationships: [];
      };
      document_tag_links: {
        Row: { company_id: string; document_id: string; tag_id: string; created_by: string | null; created_at: string };
        Insert: { company_id: string; document_id: string; tag_id: string };
        // Un collegamento non si modifica: si toglie e si rimette.
        Update: Record<string, never>;
        Relationships: [];
      };
      document_extractions: {
        Row: {
          id: string; document_id: string; company_id: string; extraction_method: ExtractionMethod;
          full_text: string | null; pages: Json; page_count: number | null; char_count: number | null;
          ocr_confidence: number | null; truncated: boolean; duration_ms: number | null; created_at: string;
        };
        // 0010 — la scrive solo la pipeline con service role (_shared/persist.ts).
        // Dal client è in sola lettura: è il testo su cui si verificano le
        // citazioni (§20), riscriverlo permetterebbe di far "verificare" una
        // citazione assente dal documento.
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      document_analyses: {
        Row: {
          id: string; document_id: string; company_id: string; extraction_id: string | null;
          analysis_version: number; analysis_status: AnalysisStatus; engine: string;
          provider: string | null; model: string | null; prompt_version: string | null; schema_version: number;
          processing_started_at: string | null; processing_completed_at: string | null;
          error_code: string | null; error_message_safe: string | null; input_tokens: number | null; output_tokens: number | null;
          // legacy (consumate dalla UI attuale)
          language: string | null; sender: string | null; sender_evidence: Json | null; document_type: string | null;
          deadline: string | null; deadline_evidence: Json | null; amount: number | null; amount_currency: string | null; amount_type: string | null; amount_evidence: Json | null;
          summary: string | null; actions: Json; requested_documents: Json; risks: Json | null; uncertainties: Json;
          confidence: string | null; reply_draft: string | null; reply_language: string | null; reply_tone: string | null;
          // ricche (§6–18/§23)
          overall_confidence: number | null; document_type_confidence: number | null;
          sender_authority_type: string | null; sender_confidence: number | null;
          recipient: string | null; subject: string | null; document_date: string | null; reply_needed: boolean | null;
          deadline_type: string | null; deadline_source_text: string | null; deadline_confidence: number | null; deadline_requires_verification: boolean;
          amounts: Json; reference_numbers: Json; legal_references: Json; sender_evidence_list: Json;
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; document_id: string; company_id: string; extraction_id?: string | null;
          analysis_version?: number; analysis_status?: AnalysisStatus; engine?: string;
          provider?: string | null; model?: string | null; prompt_version?: string | null; schema_version?: number;
          processing_started_at?: string | null; processing_completed_at?: string | null;
          error_code?: string | null; error_message_safe?: string | null; input_tokens?: number | null; output_tokens?: number | null;
          language?: string | null; sender?: string | null; sender_evidence?: Json | null; document_type?: string | null;
          deadline?: string | null; deadline_evidence?: Json | null; amount?: number | null; amount_currency?: string | null; amount_type?: string | null; amount_evidence?: Json | null;
          summary?: string | null; actions?: Json; requested_documents?: Json; risks?: Json | null; uncertainties?: Json;
          // 0010 — reply_draft/reply_language/reply_tone non sono più inseribili:
          // deprecate, la bozza vive in document_replies.
          confidence?: string | null;
          overall_confidence?: number | null; document_type_confidence?: number | null;
          sender_authority_type?: string | null; sender_confidence?: number | null;
          recipient?: string | null; subject?: string | null; document_date?: string | null; reply_needed?: boolean | null;
          deadline_type?: string | null; deadline_source_text?: string | null; deadline_confidence?: number | null; deadline_requires_verification?: boolean;
          amounts?: Json; reference_numbers?: Json; legal_references?: Json; sender_evidence_list?: Json;
        };
        // 0010 — lo snapshot è immutabile: il client non ha più il permesso di
        // update sulla tabella. Il tipo vuoto rende l'errore visibile in fase di
        // typecheck invece che a runtime come errore RLS.
        Update: Record<string, never>;
        Relationships: [];
      };
      action_progress: {
        Row: {
          id: string; analysis_id: string; company_id: string; action_index: number;
          action_text: string | null; done: boolean; done_by: string | null; done_at: string | null;
          created_at: string; updated_at: string;
        };
        // done_by/done_at li imposta il trigger set_action_progress_actor: non
        // vanno inviati dal client.
        Insert: {
          id?: string; analysis_id: string; company_id: string; action_index: number;
          action_text?: string | null; done?: boolean;
        };
        Update: { done?: boolean; action_text?: string | null };
        Relationships: [];
      };
      document_replies: {
        Row: {
          id: string; document_id: string; company_id: string; analysis_id: string | null; created_by: string | null;
          language: string; tone: string; content: string; provider: string | null; model: string | null;
          prompt_version: string | null; is_edited: boolean; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; document_id: string; company_id: string; analysis_id?: string | null; created_by?: string | null;
          language: string; tone: string; content: string; provider?: string | null; model?: string | null;
          prompt_version?: string | null; is_edited?: boolean;
        };
        Update: { content?: string; language?: string; tone?: string; is_edited?: boolean };
        Relationships: [];
      };
      analysis_corrections: {
        Row: {
          id: string; analysis_id: string; document_id: string; company_id: string; field: string;
          original_ai_value: Json | null; corrected_value: Json | null; corrected_by: string | null; corrected_at: string;
        };
        Insert: {
          id?: string; analysis_id: string; document_id: string; company_id: string; field: string;
          original_ai_value?: Json | null; corrected_value?: Json | null; corrected_by?: string | null;
        };
        Update: { corrected_value?: Json | null };
        Relationships: [];
      };
      ai_request_log: {
        Row: {
          id: string; company_id: string; user_id: string | null; document_id: string | null; kind: string;
          provider: string | null; model: string | null; status: string; error_code: string | null;
          duration_ms: number | null; input_tokens: number | null; output_tokens: number | null; created_at: string;
        };
        Insert: {
          id?: string; company_id: string; user_id?: string | null; document_id?: string | null; kind: string;
          provider?: string | null; model?: string | null; status: string; error_code?: string | null;
          duration_ms?: number | null; input_tokens?: number | null; output_tokens?: number | null;
        };
        Update: { status?: string };
        Relationships: [];
      };
      // Registro attività (0039). ⚠️ `Insert` e `Update` sono VUOTI di
      // proposito: il client non scrive qui e non deve poterlo fare nemmeno per
      // sbaglio. Le righe le scrivono i trigger delle tabelle sorgente, e il
      // database rifiuta comunque — il tipo serve a fermare la riga prima, in
      // compilazione, invece di lasciarla arrivare a un errore a runtime.
      audit_logs: {
        Row: {
          id: string; company_id: string; actor_user_id: string | null;
          action: AuditAction; entity_type: AuditEntityType; entity_id: string;
          changes: Json; correlation_id: string; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      tasks: {
        Row: { id: string; company_id: string; created_by: string | null; document_id: string | null; subsidy_case_id: string | null; title: string; description: string | null; authority: string | null; due_date: string | null; priority: TaskPriority; status: TaskStatus; source: TaskSource; assignee_user_id: string | null; completed_at: string | null; completed_by: string | null; archived_at: string | null; archived_by: string | null; created_at: string; updated_at: string; workflow_run_id: string | null; contract_id: string | null; contract_milestone_id: string | null; crm_organization_id: string | null; crm_opportunity_id: string | null;};
        Insert: { id?: string; company_id: string; created_by?: string | null; document_id?: string | null; subsidy_case_id?: string | null; title: string; description?: string | null; authority?: string | null; due_date?: string | null; priority?: TaskPriority; status?: TaskStatus; source?: TaskSource; assignee_user_id?: string | null; contract_id?: string | null; contract_milestone_id?: string | null; crm_organization_id?: string | null; crm_opportunity_id?: string | null };
        // `completed_at`, `completed_by`, `archived_by` non compaiono in Update:
        // li scrive il trigger `tasks_guard`, e un client che li mandasse li
        // vedrebbe comunque sovrascritti. `archived_at` c'è perché è il modo in
        // cui si DICHIARA di voler archiviare; il valore vero lo mette il server.
        Update: { title?: string; description?: string | null; authority?: string | null; due_date?: string | null; priority?: TaskPriority; status?: TaskStatus; assignee_user_id?: string | null; archived_at?: string | null; contract_id?: string | null; contract_milestone_id?: string | null; crm_organization_id?: string | null; crm_opportunity_id?: string | null };
        Relationships: [];
      };
      task_checklist_items: {
        Row: { id: string; company_id: string; task_id: string; text: string; position: number; done: boolean; done_at: string | null; done_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; company_id: string; task_id: string; text: string; position?: number; done?: boolean };
        Update: { text?: string; position?: number; done?: boolean };
        Relationships: [];
      };
      task_comments: {
        Row: { id: string; company_id: string; task_id: string; author_user_id: string; body: string; created_at: string; updated_at: string };
        Insert: { id?: string; company_id: string; task_id: string; author_user_id: string; body: string };
        Update: { body?: string };
        Relationships: [];
      };
      task_events: {
        // Sola lettura per il client: le righe le scrivono i trigger.
        Row: { id: string; company_id: string; task_id: string; actor_user_id: string | null; kind: TaskEventKind; detail: Json; created_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      notifications: {
        // Sola lettura per il client (0018): le righe le scrivono i trigger e il
        // worker, e «segna come letta» passa da una funzione.
        Row: {
          id: string; company_id: string; user_id: string; type: NotificationType;
          entity_type: string; entity_id: string; payload: Json;
          dedupe_key: string | null; read_at: string | null; created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      notification_preferences: {
        Row: {
          company_id: string; user_id: string;
          in_app_enabled: boolean; email_enabled: boolean;
          remind_7_days: boolean; remind_1_day: boolean; remind_due_day: boolean; remind_overdue: boolean;
          timezone: string; locale: string; show_task_title: boolean;
          created_at: string; updated_at: string;
        };
        Insert: {
          company_id: string; user_id: string;
          in_app_enabled?: boolean; email_enabled?: boolean;
          remind_7_days?: boolean; remind_1_day?: boolean; remind_due_day?: boolean; remind_overdue?: boolean;
          timezone?: string; locale?: string; show_task_title?: boolean;
        };
        Update: {
          in_app_enabled?: boolean; email_enabled?: boolean;
          remind_7_days?: boolean; remind_1_day?: boolean; remind_due_day?: boolean; remind_overdue?: boolean;
          timezone?: string; locale?: string; show_task_title?: boolean;
        };
        Relationships: [];
      };
      calendar_connections: {
        // ⚠️ La 0018 concede al client la SELECT su un elenco di colonne, non
        // sulla tabella: `select('*')` fallisce con «permission denied for
        // column». È il motivo per cui il service le elenca una per una.
        Row: {
          id: string; company_id: string; user_id: string; provider: CalendarProvider;
          email_address: string; provider_calendar_id: string | null; calendar_name: string | null;
          status: CalendarConnectionStatus; scopes: string[]; sync_enabled: boolean;
          initial_sync_completed_at: string | null; last_sync_at: string | null;
          last_successful_sync_at: string | null; last_error_code: string | null; last_error_at: string | null;
          created_at: string; updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      calendar_event_links: {
        Row: {
          id: string; company_id: string; user_id: string; connection_id: string; task_id: string;
          provider_event_id: string; provider_calendar_id: string;
          sync_status: CalendarSyncStatus; content_hash: string | null;
          last_synced_at: string | null; error_code: string | null;
          created_at: string; updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      subsidy_matches: {
        Row: { id: string; company_id: string; program_id: string; relevance_score: number | null; eligibility_status: EligibilityStatus; answers: Json; satisfied_requirements: Json; unknown_requirements: Json; failed_requirements: Json; source_last_checked_at: string | null; evaluated_at: string; created_at: string; updated_at: string };
        Insert: { id?: string; company_id: string; program_id: string; relevance_score?: number | null; eligibility_status?: EligibilityStatus; answers?: Json; satisfied_requirements?: Json; unknown_requirements?: Json; failed_requirements?: Json; source_last_checked_at?: string | null; evaluated_at?: string };
        Update: { relevance_score?: number | null; eligibility_status?: EligibilityStatus; answers?: Json; satisfied_requirements?: Json; unknown_requirements?: Json; failed_requirements?: Json; source_last_checked_at?: string | null; evaluated_at?: string };
        Relationships: [];
      };
      // ⚠️ La 0032 ha rifatto i permessi di questa tabella: si è passati dai
      // permessi di TABELLA della 0003 a permessi di COLONNA, perché adesso ci
      // sono colonne che deve timbrare il database (`submitted_at`,
      // `submitted_by`) e colonne che non si riscrivono mai (`program_snapshot`,
      // `snapshot_hash`, `program_version_id`, `legacy_snapshot`). `Insert` e
      // `Update` qui sotto rispecchiano ESATTAMENTE i grant: un campo in più
      // prometterebbe una scrittura che il database rifiuta.
      subsidy_cases: {
        Row: {
          id: string; company_id: string; created_by: string | null;
          program_id: string; program_name: string | null; authority: string | null;
          status: SubsidyCaseStatus; eligibility_status_at_creation: EligibilityStatus | null;
          relevance_score: number | null; source_last_checked_at: string | null;
          eligibility_snapshot: Json | null; created_at: string; updated_at: string;
          // ---- 0032 ----
          opportunity_id: string | null; project_id: string | null;
          program_version_id: string | null; call_id: string | null;
          owner_user_id: string | null;
          official_deadline: string | null; official_deadline_at: string | null;
          internal_deadline: string | null;
          amount_requested: number | null; amount_awarded: number | null; currency: string | null;
          submitted_at: string | null; submitted_by: string | null;
          decision_at: string | null; outcome: SubsidyCaseOutcome;
          outcome_document_id: string | null;
          program_snapshot: Json | null; snapshot_hash: string | null;
          legacy_snapshot: boolean; source_changed_at: string | null;
          archived_at: string | null; archived_by: string | null;
          workflow_run_id: string | null;
        };
        Insert: {
          id?: string; company_id: string; created_by?: string | null;
          opportunity_id?: string | null; project_id?: string | null;
          program_id: string; program_name?: string | null; authority?: string | null;
          program_version_id?: string | null; call_id?: string | null;
          owner_user_id?: string | null; status?: SubsidyCaseStatus;
          official_deadline?: string | null; official_deadline_at?: string | null;
          internal_deadline?: string | null;
          amount_requested?: number | null; currency?: string | null;
          program_snapshot?: Json | null; snapshot_hash?: string | null;
          eligibility_status_at_creation?: EligibilityStatus | null;
          relevance_score?: number | null; source_last_checked_at?: string | null;
          eligibility_snapshot?: Json | null;
        };
        // ⚠️ NIENTE `submitted_at`/`submitted_by`: li timbra il trigger quando
        // lo stato passa a `submitted`. §107 — l'invio lo registra una persona,
        // e la data non la sceglie il browser.
        Update: {
          status?: SubsidyCaseStatus; owner_user_id?: string | null;
          internal_deadline?: string | null;
          amount_requested?: number | null; amount_awarded?: number | null;
          currency?: string | null; decision_at?: string | null;
          outcome?: SubsidyCaseOutcome; outcome_document_id?: string | null;
          archived_at?: string | null; archived_by?: string | null;
          source_changed_at?: string | null;
        };
        Relationships: [];
      };
      subsidy_case_items: {
        Row: {
          id: string; subsidy_case_id: string; company_id: string | null;
          title: string; completed: boolean; sort_order: number;
          kind: SubsidyChecklistKind; document_id: string | null; task_id: string | null;
          due_date: string | null; required: boolean; source_requirement_key: string | null;
          completed_at: string | null; completed_by: string | null;
          created_at: string; updated_at: string;
        };
        // `company_id` NON compare: lo scrive il guardiano leggendolo dalla
        // pratica, e concederlo permetterebbe di dichiarare un'azienda diversa.
        Insert: {
          subsidy_case_id: string; title: string; completed?: boolean; sort_order?: number;
          kind?: SubsidyChecklistKind; document_id?: string | null; task_id?: string | null;
          due_date?: string | null; required?: boolean; source_requirement_key?: string | null;
        };
        Update: {
          title?: string; completed?: boolean; sort_order?: number;
          kind?: SubsidyChecklistKind; document_id?: string | null; task_id?: string | null;
          due_date?: string | null; required?: boolean;
        };
        Relationships: [];
      };
      subsidy_projects: {
        Row: {
          id: string; company_id: string; title: string; description: string | null;
          stage: SubsidyProjectStage; owner_user_id: string | null;
          location_canton: string | null; location_country: string;
          sector: string | null;
          estimated_start_date: string | null; estimated_end_date: string | null;
          budget_amount: number | null; budget_currency: string | null;
          employee_impact: number | null;
          // ⚠️ Tre valori: true/false/NULL. `null` è «non lo sappiamo» e NON
          // deve diventare `false`: un criterio su un fatto ignoto resta
          // `unknown`, non «non soddisfatto».
          has_research_partner: boolean | null;
          has_innovation_partner: boolean | null;
          has_international_partners: boolean | null;
          project_types: string[]; goals: string | null;
          status: string; created_by: string | null;
          archived_at: string | null; archived_by: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          company_id: string; title: string; description?: string | null;
          stage?: SubsidyProjectStage; owner_user_id?: string | null;
          location_canton?: string | null; location_country?: string;
          sector?: string | null;
          estimated_start_date?: string | null; estimated_end_date?: string | null;
          budget_amount?: number | null; budget_currency?: string | null;
          employee_impact?: number | null;
          has_research_partner?: boolean | null;
          has_innovation_partner?: boolean | null;
          has_international_partners?: boolean | null;
          project_types?: string[]; goals?: string | null; status?: string;
        };
        // ⚠️ NESSUN `delete` esiste su questa tabella: un progetto si ARCHIVIA
        // scrivendo `status`, e i timbri li mette il trigger. Cancellarlo
        // porterebbe via opportunità, valutazioni e il legame delle pratiche.
        Update: {
          title?: string; description?: string | null; stage?: SubsidyProjectStage;
          owner_user_id?: string | null; location_canton?: string | null;
          location_country?: string; sector?: string | null;
          estimated_start_date?: string | null; estimated_end_date?: string | null;
          budget_amount?: number | null; budget_currency?: string | null;
          employee_impact?: number | null;
          has_research_partner?: boolean | null;
          has_innovation_partner?: boolean | null;
          has_international_partners?: boolean | null;
          project_types?: string[]; goals?: string | null; status?: string;
        };
        Relationships: [];
      };
      subsidy_project_documents: {
        Row: {
          id: string; company_id: string; project_id: string; document_id: string;
          relation: SubsidyDocumentRelation; added_by: string | null; created_at: string;
        };
        Insert: {
          company_id: string; project_id: string; document_id: string;
          relation?: SubsidyDocumentRelation;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      subsidy_project_partners: {
        Row: {
          id: string; company_id: string; project_id: string; organization_id: string;
          role: SubsidyPartnerRole; added_by: string | null; created_at: string;
        };
        Insert: {
          company_id: string; project_id: string; organization_id: string;
          role: SubsidyPartnerRole;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      // Le scrive la Edge Function con il ruolo di servizio: un client che
      // potesse inserirle scriverebbe un'interpretazione che nessun modello ha
      // prodotto.
      subsidy_project_interpretations: {
        Row: {
          id: string; company_id: string; project_id: string; version: number;
          description_hash: string; model: string; prompt_version: string;
          schema_version: string; content: Json; dropped_evidence: number;
          overall_confidence: number | null; created_by: string | null; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      // ⚠️ APPEND-ONLY: rispondere di nuovo scrive una riga NUOVA, e la corrente
      // è la più recente per (progetto, versione, criterio). Non esiste
      // `Update`, e non è una dimenticanza — la risposta di marzo resta un
      // fatto che riguarda una pratica aperta.
      subsidy_answers: {
        Row: {
          id: string; company_id: string; project_id: string | null;
          program_version_id: string; rule_key: string;
          value: string; note: string | null;
          answered_by: string | null; answered_at: string; created_at: string;
        };
        Insert: {
          company_id: string; project_id?: string | null; program_version_id: string;
          rule_key: string; value: 'yes' | 'no' | 'unknown'; note?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      // ⚠️ Il client può fare TRE cose: salvare, mettere da parte, riaprire. Le
      // sei misure, i conteggi e la valutazione corrente le scrive il MOTORE —
      // un'opportunità la cui rilevanza si cambia dal browser non è una
      // valutazione, è un'opinione. `dismissed_at` e `dismissed_by` li timbra
      // il trigger dalla presenza del motivo.
      subsidy_opportunities: {
        Row: {
          id: string; company_id: string; project_id: string | null;
          kind: SubsidyOpportunityKind; program_id: string;
          program_version_id: string; call_id: string | null;
          relevance_level: SubsidyRelevanceLevel; relevance_score: number;
          eligibility_status: SubsidyEligibilityStatus;
          completeness: SubsidyCompleteness; timing: SubsidyTiming;
          source_freshness: SubsidyFreshness; readiness: SubsidyReadiness;
          missing_fact_count: number; open_criteria_count: number;
          current_assessment_id: string | null; assessment_version: number;
          last_fingerprint: string | null; assessment_stale: boolean;
          first_matched_at: string; last_assessed_at: string | null;
          saved_at: string | null; dismissed_at: string | null;
          dismissed_by: string | null; dismissed_reason: SubsidyDismissalReason | null;
          dismissed_note: string | null; reopen_suggested_at: string | null;
          workflow_run_id: string | null; created_at: string; updated_at: string;
        };
        Insert: Record<string, never>;
        Update: {
          saved_at?: string | null;
          dismissed_reason?: SubsidyDismissalReason | null;
          dismissed_note?: string | null;
        };
        Relationships: [];
      };
      subsidy_assessments: {
        Row: {
          id: string; company_id: string; opportunity_id: string; version: number;
          program_version_id: string; call_id: string | null;
          interpretation_id: string | null;
          relevance_level: SubsidyRelevanceLevel; relevance_score: number;
          relevance_reasons: Json;
          eligibility_status: SubsidyEligibilityStatus;
          completeness: SubsidyCompleteness; timing: SubsidyTiming;
          source_freshness: SubsidyFreshness;
          facts_used: Json; missing_facts: Json; conflicts: Json;
          fingerprint: string; engine_version: string; trigger_source: string;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      subsidy_criterion_results: {
        Row: {
          id: string; company_id: string; assessment_id: string; rule_key: string;
          hardness: SubsidyRuleHardness; state: SubsidyCriterionState;
          observed_value: string | null; value_source: SubsidyFactSource | null;
          reason_code: string | null; sort_order: number; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      subsidy_case_documents: {
        Row: {
          id: string; company_id: string; subsidy_case_id: string; document_id: string;
          requirement_key: string | null; relation_type: SubsidyDocumentRelation;
          status: string; added_by: string | null; created_at: string;
        };
        Insert: {
          company_id: string; subsidy_case_id: string; document_id: string;
          requirement_key?: string | null; relation_type?: SubsidyDocumentRelation;
          status?: string;
        };
        Update: {
          requirement_key?: string | null; relation_type?: SubsidyDocumentRelation;
          status?: string;
        };
        Relationships: [];
      };
      // ⚠️ Lo scrivono i TRIGGER: il client non ha alcun permesso di scrittura,
      // quindi nessuno può firmare un'azione a nome di un collega.
      subsidy_case_events: {
        Row: {
          id: string; company_id: string; subsidy_case_id: string;
          kind: SubsidyCaseEventKind; detail: Json;
          actor_user_id: string | null; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      // ---- Il catalogo: SOLA LETTURA per il client (§28, §143) --------------
      // Nessun editor di catalogo per il cliente, e il modo di garantirlo è che
      // `Insert` e `Update` non ammettano alcun campo.
      subsidy_sources: {
        Row: {
          id: string; authority: string; source_type: SubsidySourceType;
          canonical_url: string; allowed_host: string; locale: string;
          jurisdiction: string; adapter_key: string; check_frequency_days: number;
          criticality: SubsidySourceCriticality; enabled: boolean;
          // ⚠️ Aggiornata SOLO da un controllo RIUSCITO: un errore non la tocca.
          // La freschezza non si deduce da un tentativo fallito.
          last_successful_check_at: string | null;
          last_error_at: string | null; last_error_code: string | null;
          next_check_at: string; last_content_hash: string | null;
          notes: string | null; created_at: string; updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      subsidy_program_versions: {
        Row: {
          id: string; program_id: string; version_number: number;
          status: SubsidyVersionStatus;
          effective_from: string | null; effective_until: string | null;
          published_at: string | null; reviewed_at: string | null; reviewed_by: string | null;
          source_snapshot_id: string | null; normalized_content: Json;
          content_hash: string; created_by: string | null; notes: string | null;
          created_at: string; updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      subsidy_program_rules: {
        Row: {
          id: string; program_version_id: string; rule_key: string; label: string;
          fact_key: string | null; operator: string | null; expected_value: Json;
          hardness: SubsidyRuleHardness; evaluability: SubsidyRuleEvaluability;
          question: string | null; source_evidence: Json; notes: string | null;
          sort_order: number; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      subsidy_calls: {
        Row: {
          id: string; program_id: string; program_version_id: string | null;
          external_reference: string | null; title: string | null;
          status: SubsidyCallStatus; opens_on: string | null;
          deadline_on: string | null;
          // ⚠️ Valorizzato SOLO se la fonte dichiara un'ora: nessun 23:59
          // dedotto da una data. Un termine che scade alle 12:00 e che noi
          // mostriamo alle 23:59 fa perdere la candidatura.
          deadline_at: string | null; timezone: string | null;
          continuous: boolean;
          // Testo e non data: le autorità scrivono «autunno 2026», e
          // trasformarlo in 01.09.2026 sarebbe inventare un giorno.
          expected_next_call: string | null;
          source_snapshot_id: string | null; checked_at: string | null;
          published_at: string | null; closed_at: string | null;
          notes: string | null; created_at: string; updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      subsidy_programs: {
        Row: {
          id: string; name: string; authority: string; support_type: string;
          geography: string[]; target_sectors: string[]; company_size_min: number; company_size_max: number;
          project_types: string[]; requirements: Json; exclusions: Json;
          contribution_description: string | null; application_window: string | null;
          must_apply_before_start: boolean; must_apply_before_start_text: string | null; documents_required: string[];
          official_source_url: string; source_title: string | null; last_checked_at: string | null;
          data_status: string; active: boolean; created_at: string; updated_at: string;
          translations: Json;   // 0012 — contenuti tradotti per lingua
          // 0011 — disponibilità: distinta da `active` (che nasconde il programma)
          // e da `data_status` (che riguarda l'affidabilità del dato).
          availability: string; availability_note: string | null;
          availability_source_url: string | null; availability_checked_at: string | null;
          // 0032 — il ciclo di vita del PROGRAMMA, che è la quarta domanda
          // distinta: `active` dice se lo mostriamo, `availability` se oggi è
          // concedibile, `data_status` quanto è affidabile il dato, e
          // `lifecycle` se lo strumento esiste ancora. Quattro domande diverse.
          lifecycle: string;
          primary_source_id: string | null;
          // ⚠️ COPIA DICHIARATA della versione pubblicata: la verità è l'indice
          // unico parziale su `subsidy_program_versions`, e un trigger la tiene
          // allineata. Si legge per non doverla cercare a ogni riga.
          current_version_id: string | null;
        };
        // Catalogo condiviso: la 0007 concede al client la sola `select`. Lo
        // scrive il seed con service_role (scripts/seed-subsidy-programs.mjs).
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };

      // ---- Inbox (0013) ----------------------------------------------------
      // Le Row rispecchiano SOLO le colonne che la 0013 concede al ruolo
      // `authenticated`. `sync_cursor`, `watch_resource_id`, `history_floor_at`
      // e le colonne dei segreti non compaiono qui perché il client non ha il
      // permesso di leggerle: se comparissero, il tipo prometterebbe un dato
      // che il database rifiuta di dare.
      email_connections: {
        Row: {
          id: string; company_id: string; connected_by: string | null;
          provider: EmailProvider; provider_account_id: string; email_address: string; display_name: string | null;
          status: EmailConnectionStatus; scopes: string[]; sync_enabled: boolean;
          initial_sync_completed_at: string | null; last_sync_at: string | null; last_successful_sync_at: string | null;
          last_error_code: string | null; last_error_at: string | null;
          watch_expires_at: string | null; sync_lease_until: string | null;
          created_at: string; updated_at: string;
        };
        // Il ciclo di vita della connessione passa dalle Edge Function, che
        // verificano il ruolo: al client non serve alcuna scrittura.
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      email_messages: {
        Row: {
          id: string; company_id: string; connection_id: string;
          provider_message_id: string; provider_thread_id: string | null; internet_message_id: string | null;
          subject: string | null; sender_name: string | null; sender_email: string | null;
          to_recipients: Json; cc_recipients: Json;
          received_at: string; sent_at: string | null;
          body_text: string | null; body_preview: string | null; body_links: Json; body_char_count: number | null;
          body_clean: string | null; quoted_removed: boolean;
          has_attachments: boolean; attachment_count: number; importance: string | null; is_bulk: boolean;
          processing_status: EmailProcessingStatus; attention_status: EmailAttentionStatus;
          relevance: EmailRelevance | null; relevance_confidence: number | null; relevance_reason: string | null;
          classifier_version: string | null; classifier_provider: string | null; classifier_model: string | null;
          classifier_prompt_version: string | null; classified_at: string | null;
          error_code: string | null; error_message_safe: string | null;
          seen_at: string | null; handled_at: string | null; handled_by: string | null;
          source_fingerprint: string | null; analysis_deadline: string | null;
          created_at: string; updated_at: string;
        };
        Insert: Record<string, never>;
        // 0013 — il grant di colonna concede solo queste due. `handled_by` e
        // `handled_at` li scrive il trigger, e il ripristino ricalcola lo stato
        // dalla classificazione ignorando il valore inviato.
        Update: { seen_at?: string | null; attention_status?: EmailAttentionStatus };
        Relationships: [];
      };
      email_attachments: {
        Row: {
          id: string; company_id: string; email_message_id: string; provider_attachment_id: string;
          filename: string | null; safe_filename: string | null;
          declared_mime_type: string | null; mime_type: string | null; size_bytes: number | null;
          content_id: string | null; is_inline: boolean;
          storage_path: string | null; file_hash: string | null;
          import_status: EmailAttachmentImportStatus; skip_reason: string | null; error_code: string | null;
          created_at: string; updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      email_message_documents: {
        Row: {
          id: string; company_id: string; email_message_id: string; document_id: string;
          relation: EmailDocumentRelation; attachment_id: string | null; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      email_sync_runs: {
        Row: {
          id: string; company_id: string; connection_id: string;
          sync_type: EmailSyncType; status: EmailSyncStatus; triggered_by: string | null;
          started_at: string; completed_at: string | null; duration_ms: number | null;
          messages_seen: number; messages_new: number; messages_updated: number;
          attachments_imported: number; documents_created: number; analyses_started: number;
          cursor_before: string | null; cursor_after: string | null;
          error_code: string | null; error_detail_safe: string | null; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      email_audit_log: {
        Row: {
          id: string; company_id: string; connection_id: string | null; actor_user_id: string | null;
          action: string; detail: Json; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };

      // ---- Automazioni (0020) ------------------------------------------
      // ⚠️ Tutte in SOLA LETTURA per il client, e non per prudenza: le regole
      // si scrivono passando dalla Edge Function `automation-admin`, che
      // verifica il ruolo e valida la configurazione contro il registro
      // tipizzato. Il database quel registro non ce l'ha, e ripeterlo in SQL
      // avrebbe creato un secondo elenco destinato a divergere dal primo.
      workflow_definitions: {
        Row: {
          id: string; company_id: string; name: string; description: string | null;
          status: WorkflowStatus; trigger_type: AutomationEventType;
          condition_match: 'all' | 'any'; conditions: Json; actions: Json;
          version: number; activated_at: string | null;
          attention_code: string | null; attention_at: string | null;
          consecutive_failures: number;
          last_run_at: string | null; last_run_status: WorkflowRunStatus | null;
          created_by: string | null; updated_by: string | null;
          created_at: string; updated_at: string;
          archived_at: string | null; archived_by: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workflow_runs: {
        Row: {
          id: string; company_id: string; workflow_id: string; workflow_version: number;
          config_snapshot: Json; trigger_event_id: string | null;
          entity_type: string | null; entity_id: string | null;
          status: WorkflowRunStatus; condition_results: Json;
          started_at: string; completed_at: string | null; duration_ms: number | null;
          error_code: string | null; created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workflow_action_runs: {
        Row: {
          id: string; company_id: string; workflow_run_id: string;
          action_key: string; action_position: number; status: WorkflowActionStatus;
          idempotency_key: string;
          output_entity_type: string | null; output_entity_id: string | null;
          error_code: string | null;
          started_at: string | null; completed_at: string | null; created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // ---- Finance Operations (0021) -----------------------------------
      // ⚠️ Le colonne `eff_*` NON compaiono in Insert né in Update: sono la
      // PROIEZIONE che il trigger ricalcola da estrazione più correzioni, e il
      // client non ha alcun permesso di scrittura su di esse. Un tipo che le
      // rendesse scrivibili prometterebbe qualcosa che il database rifiuta.
      // ---- Contract Manager (0024) ----------------------------------------
      // ⚠️ Ciò che il client PUÒ scrivere è molto meno di ciò che legge: i
      // verbali e i termini si leggono e basta, lo stato di verifica passa da
      // `contract_verify_terms`. `Insert`/`Update` qui descrivono esattamente i
      // permessi di colonna concessi dalla 0024 — dichiararne di più
      // significherebbe promettere al codice una scrittura che il database
      // rifiuta.
      contracts: {
        Row: {
          id: string; company_id: string; display_name: string;
          contract_type: ContractType; counterparty_name: string | null;
          owner_user_id: string | null;
          review_status: ContractReviewStatus; lifecycle_status: ContractLifecycleStatus;
          origin: ContractOrigin; current_term_version_id: string | null;
          quality_flags: ContractQualityFlag[]; internal_note: string | null;
          verified_at: string | null; verified_by: string | null;
          archived_at: string | null; archived_by: string | null;
          created_by: string | null; workflow_run_id: string | null;
          // 0026 — il collegamento FACOLTATIVO alla controparte nel CRM.
          // `counterparty_name` resta l'etichetta e `contract_extractions.
          // counterparty` resta il nome letto: qui si aggiunge un riferimento.
          counterparty_organization_id: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          company_id: string; display_name: string; contract_type?: ContractType;
          counterparty_name?: string | null; owner_user_id?: string | null;
          counterparty_organization_id?: string | null;
        };
        Update: {
          display_name?: string; contract_type?: ContractType;
          counterparty_name?: string | null; owner_user_id?: string | null;
          lifecycle_status?: ContractLifecycleStatus; internal_note?: string | null;
          archived_at?: string | null; counterparty_organization_id?: string | null;
        };
        Relationships: [];
      };
      contract_documents: {
        Row: {
          id: string; company_id: string; contract_id: string; document_id: string;
          relation: ContractDocumentRelation; origin: ContractOrigin;
          processing_status: ContractProcessingStatus;
          current_extraction_id: string | null; extraction_attempts: number;
          error_code: string | null; suggested: boolean;
          added_by: string | null; added_at: string;
        };
        Insert: {
          company_id: string; contract_id: string; document_id: string;
          relation?: ContractDocumentRelation; suggested?: boolean;
        };
        Update: {
          relation?: ContractDocumentRelation;
          processing_status?: ContractProcessingStatus;
        };
        Relationships: [];
      };
      contract_extractions: {
        Row: {
          id: string; company_id: string; contract_id: string; document_id: string;
          extraction_version: number; status: ContractExtractionStatus;
          method: string; provider: string | null; model: string | null;
          prompt_version: string | null; schema_version: number;
          detected_type: ContractType | null; out_of_scope_kind: string | null;
          company_party: string | null; counterparty: string | null;
          counterparty_address: string | null;
          document_date: string | null; signature_date: string | null;
          start_date: string | null; end_date: string | null;
          end_date_kind: ContractEndKind;
          minimum_term_value: number | null; minimum_term_unit: ContractPeriodUnit | null;
          auto_renewal: ContractAutoRenewal;
          renewal_period_value: number | null; renewal_period_unit: ContractPeriodUnit | null;
          notice_period_value: number | null; notice_period_unit: ContractPeriodUnit | null;
          notice_anchor: ContractNoticeAnchor | null; notice_anchor_text: string | null;
          termination_method: ContractTerminationMethod | null;
          termination_address: string | null;
          cost_amount: number | null; cost_currency: string | null;
          cost_frequency: ContractCostFrequency; cost_vat_included: boolean | null;
          price_adjustment: boolean;
          obligations: Json; attention_clauses: Json; penalties: Json;
          referenced_annexes: Json;
          governing_law: string | null; jurisdiction: string | null; signed: boolean | null;
          field_sources: Json; field_confidence: Json; evidence: Json; uncertainties: Json;
          quality_flags: ContractQualityFlag[]; document_language: string | null;
          truncated: boolean; content_hash: string | null; error_code: string | null;
          input_tokens: number | null; output_tokens: number | null;
          duration_ms: number | null; created_at: string;
        };
        // ⚠️ Nessun Insert e nessun Update: un verbale lo scrive il worker con il
        // service role, e i trigger della 0024 rifiutano ogni modifica.
        Insert: never;
        Update: never;
        Relationships: [];
      };
      contract_term_versions: {
        Row: {
          id: string; company_id: string; contract_id: string; version: number;
          status: ContractTermVersionStatus; effective_from: string | null;
          counterparty_name: string | null; company_party: string | null;
          start_date: string | null; end_date: string | null; end_date_kind: ContractEndKind;
          minimum_term_value: number | null; minimum_term_unit: ContractPeriodUnit | null;
          auto_renewal: ContractAutoRenewal;
          renewal_period_value: number | null; renewal_period_unit: ContractPeriodUnit | null;
          notice_period_value: number | null; notice_period_unit: ContractPeriodUnit | null;
          notice_anchor: ContractNoticeAnchor | null; notice_anchor_text: string | null;
          termination_method: ContractTerminationMethod | null;
          termination_address: string | null;
          cost_amount: number | null; cost_currency: string | null;
          cost_frequency: ContractCostFrequency; cost_vat_included: boolean | null;
          price_adjustment: boolean;
          source_extraction_ids: string[]; based_on_version_id: string | null;
          verified_at: string | null; verified_by: string | null;
          superseded_at: string | null; created_at: string; updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      contract_corrections: {
        Row: {
          id: string; company_id: string; contract_id: string; term_version_id: string;
          extraction_id: string | null; field: string;
          original_value: Json; corrected_value: Json;
          corrected_by: string | null; corrected_at: string;
        };
        Insert: {
          company_id: string; contract_id: string; term_version_id: string;
          field: string; original_value?: Json; corrected_value?: Json;
        };
        // Append-only: un trigger rifiuta update e delete.
        Update: never;
        Relationships: [];
      };
      contract_milestones: {
        Row: {
          id: string; company_id: string; contract_id: string;
          term_version_id: string | null;
          kind: ContractMilestoneKind; due_date: string;
          source: ContractMilestoneSource; status: ContractMilestoneStatus;
          calculation: string | null; calculation_version: number | null;
          calculation_inputs: Json; label: string | null;
          window_opened_at: string | null;
          verified_at: string | null; verified_by: string | null;
          dismissed_at: string | null; dismissed_by: string | null;
          created_by: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          company_id: string; contract_id: string;
          kind: ContractMilestoneKind; due_date: string; label?: string | null;
        };
        Update: { status?: ContractMilestoneStatus; label?: string | null };
        Relationships: [];
      };
      contract_events: {
        Row: {
          id: string; company_id: string; contract_id: string;
          actor_user_id: string | null; kind: ContractEventKind;
          detail: Json; created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      finance_items: {
        Row: {
          id: string; company_id: string; document_id: string;
          type: FinanceItemType;
          processing_status: FinanceProcessingStatus;
          review_status: FinanceReviewStatus;
          origin: FinanceOrigin;
          current_extraction_id: string | null;
          extraction_attempts: number; error_code: string | null;
          expense_category: FinanceExpenseCategory | null;
          expense_category_set_by: string | null; expense_category_set_at: string | null;
          payment_method: FinancePaymentMethod | null;
          quality_flags: FinanceQualityFlag[];
          reviewed_at: string | null; reviewed_by: string | null;
          archived_at: string | null; archived_by: string | null;
          created_by: string | null; workflow_run_id: string | null;
          eff_supplier_name: string | null; eff_supplier_norm: string | null;
          eff_invoice_number: string | null; eff_invoice_number_norm: string | null;
          eff_invoice_date: string | null; eff_due_date: string | null;
          eff_currency: string | null;
          eff_gross_amount: number | null; eff_net_amount: number | null; eff_vat_amount: number | null;
          eff_iban: string | null; eff_reference_type: FinanceReferenceType | null;
          eff_payment_reference: string | null;
          eff_merchant: string | null; eff_expense_date: string | null;
          dup_key: string | null;
          // 0026 — il fornitore collegato al CRM, con i due timbri scritti dal
          // database sul modello di `expense_category_set_by/_at`.
          // `eff_supplier_name` resta intatto.
          supplier_organization_id: string | null;
          supplier_organization_set_by: string | null;
          supplier_organization_set_at: string | null;
          created_at: string; updated_at: string;
        };
        // Il grant di colonna della 0021 concede solo queste tre: il resto lo
        // scrivono i trigger e il worker.
        Insert: { company_id: string; document_id: string; type: FinanceItemType };
        // `processing_status` c'è solo per poter DICHIARARE «riprova»: il
        // guardiano rifiuta ogni transizione che non parta da uno stato fermo.
        Update: {
          type?: FinanceItemType;
          review_status?: FinanceReviewStatus;
          archived_at?: string | null;
          expense_category?: FinanceExpenseCategory | null;
          payment_method?: FinancePaymentMethod | null;
          processing_status?: FinanceProcessingStatus;
          // 0026 — il collegamento al CRM. I due timbri (`_set_by`, `_set_at`)
          // NON sono qui: li scrive il guardiano, e un client che li mandasse
          // riceverebbe un errore di permesso invece di essere ignorato.
          supplier_organization_id?: string | null;
        };
        Relationships: [];
      };
      finance_extractions: {
        Row: {
          id: string; company_id: string; finance_item_id: string; document_id: string;
          extraction_version: number; status: FinanceExtractionStatus;
          method: string; provider: string | null; model: string | null;
          prompt_version: string | null; schema_version: number;
          invoice_number: string | null; supplier_name: string | null;
          supplier_address: string | null; supplier_vat_id: string | null;
          supplier_country: string | null;
          invoice_date: string | null; due_date: string | null; currency: string | null;
          gross_amount: number | null; net_amount: number | null; vat_amount: number | null;
          vat_breakdown: Json;
          creditor_iban: string | null; iban_is_qr: boolean | null;
          reference_type: FinanceReferenceType | null; payment_reference: string | null;
          qr_present: boolean; qr_valid: boolean | null;
          qr_spec_version: string | null; qr_errors: string[];
          merchant: string | null; expense_date: string | null;
          payment_method_detected: FinancePaymentMethod | null;
          field_sources: Json; field_confidence: Json; evidence: Json;
          uncertainties: Json; quality_flags: FinanceQualityFlag[];
          document_language: string | null; error_code: string | null;
          input_tokens: number | null; output_tokens: number | null; duration_ms: number | null;
          created_at: string;
        };
        // Il verbale lo scrive SOLO il worker con il service role, e non si
        // modifica: i trigger rifiutano update e delete anche a lui.
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      finance_corrections: {
        Row: {
          id: string; company_id: string; finance_item_id: string; document_id: string;
          extraction_id: string | null; field: string;
          original_value: Json | null; corrected_value: Json | null;
          corrected_by: string | null; corrected_at: string;
        };
        // `document_id` ed `extraction_id` li stabilisce il trigger dall'elemento:
        // farli dichiarare al client permetterebbe di agganciare una correzione
        // al documento sbagliato.
        Insert: {
          company_id: string; finance_item_id: string; field: string;
          original_value?: Json | null; corrected_value?: Json | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      finance_events: {
        // Sola lettura: lo storico lo scrivono i trigger.
        Row: {
          id: string; company_id: string; finance_item_id: string;
          actor_user_id: string | null; kind: FinanceEventKind; detail: Json; created_at: string;
        };
        Insert: never; Update: never;
        Relationships: [];
      };
      finance_vat_rates: {
        // Catalogo comune, in sola lettura. Sono SUGGERIMENTI per la correzione
        // manuale: un'aliquota fuori elenco è accettata, non rifiutata (§52).
        Row: {
          id: string; country_code: string; kind: string; rate: number;
          valid_from: string; valid_to: string | null;
          source_url: string; source_title: string | null; checked_at: string; created_at: string;
        };
        Insert: Record<string, never>; Update: Record<string, never>;
        Relationships: [];
      };

      workflow_events: {
        // Chi ha creato, attivato, messo in pausa. Solo amministratori.
        Row: {
          id: string; company_id: string; workflow_id: string;
          actor_user_id: string | null; kind: WorkflowAuditKind; detail: Json; created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // ---- CRM Light (0026) ------------------------------------------------
      // `Insert` e `Update` sono ristretti alle SOLE colonne che i grant della
      // 0026 concedono. Non è una comodità: le colonne timbrate dal database
      // (created_by, uid_norm, website_domain, last_contact_at, normalized_value,
      // won_at, lost_at, merged_into_id) non sono scrivibili, e un tentativo
      // FALLISCE invece di essere ignorato in silenzio. Il tipo lo rispecchia
      // perché l'errore si veda alla compilazione e non a runtime.
      crm_organizations: {
        Row: {
          id: string; company_id: string;
          display_name: string; legal_name: string | null;
          uid_che: string | null; uid_norm: string | null; vat_number: string | null;
          website: string | null; website_domain: string | null;
          street: string | null; postal_code: string | null; city: string | null;
          canton: string | null; country_code: string | null;
          relationship_status: CrmRelationshipStatus;
          account_owner_user_id: string | null;
          source: CrmSource; source_detail: string | null;
          notes: string | null;
          last_contact_at: string | null;
          archived_at: string | null; archived_by: string | null;
          merged_into_id: string | null; workflow_run_id: string | null;
          created_by: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          company_id: string; display_name: string; legal_name?: string | null;
          uid_che?: string | null; vat_number?: string | null; website?: string | null;
          street?: string | null; postal_code?: string | null; city?: string | null;
          canton?: string | null; country_code?: string | null;
          relationship_status?: CrmRelationshipStatus;
          account_owner_user_id?: string | null;
          // Dal browser il guardiano ammette solo manual | registry | import:
          // «nata da una email» la può affermare solo il codice server-side.
          source?: Extract<CrmSource, 'manual' | 'registry' | 'import'>;
          source_detail?: string | null; notes?: string | null;
          archived_at?: string | null;
        };
        Update: {
          display_name?: string; legal_name?: string | null;
          uid_che?: string | null; vat_number?: string | null; website?: string | null;
          street?: string | null; postal_code?: string | null; city?: string | null;
          canton?: string | null; country_code?: string | null;
          relationship_status?: CrmRelationshipStatus;
          account_owner_user_id?: string | null;
          source_detail?: string | null; notes?: string | null;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      crm_organization_roles: {
        Row: {
          id: string; company_id: string; organization_id: string;
          role: CrmOrganizationRole; created_by: string | null; created_at: string;
        };
        Insert: { company_id: string; organization_id: string; role: CrmOrganizationRole };
        // Un ruolo non si modifica: si aggiunge o si toglie.
        Update: never;
        Relationships: [];
      };
      crm_contacts: {
        Row: {
          id: string; company_id: string;
          first_name: string | null; last_name: string | null; display_name: string;
          preferred_language: 'it' | 'de' | 'fr' | null;
          notes: string | null;
          archived_at: string | null; archived_by: string | null;
          created_by: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          company_id: string; display_name: string;
          first_name?: string | null; last_name?: string | null;
          preferred_language?: 'it' | 'de' | 'fr' | null;
          notes?: string | null; archived_at?: string | null;
        };
        Update: {
          display_name?: string; first_name?: string | null; last_name?: string | null;
          preferred_language?: 'it' | 'de' | 'fr' | null;
          notes?: string | null; archived_at?: string | null;
        };
        Relationships: [];
      };
      crm_contact_methods: {
        Row: {
          id: string; company_id: string;
          contact_id: string | null; organization_id: string | null;
          type: CrmContactMethodType; value: string; normalized_value: string | null;
          label: string | null; is_primary: boolean;
          created_by: string | null; created_at: string;
        };
        Insert: {
          company_id: string; type: CrmContactMethodType; value: string;
          contact_id?: string | null; organization_id?: string | null;
          label?: string | null; is_primary?: boolean;
        };
        Update: {
          type?: CrmContactMethodType; value?: string;
          label?: string | null; is_primary?: boolean;
        };
        Relationships: [];
      };
      crm_contact_organizations: {
        Row: {
          id: string; company_id: string; contact_id: string; organization_id: string;
          job_title: string | null; department: string | null; is_primary: boolean;
          active_from: string | null; active_until: string | null;
          created_by: string | null; created_at: string;
        };
        Insert: {
          company_id: string; contact_id: string; organization_id: string;
          job_title?: string | null; department?: string | null; is_primary?: boolean;
          active_from?: string | null; active_until?: string | null;
        };
        Update: {
          job_title?: string | null; department?: string | null; is_primary?: boolean;
          active_from?: string | null; active_until?: string | null;
        };
        Relationships: [];
      };
      crm_opportunities: {
        Row: {
          id: string; company_id: string; organization_id: string;
          primary_contact_id: string | null;
          title: string; stage: CrmOpportunityStage; owner_user_id: string | null;
          value_amount: number | null; value_currency: string | null;
          expected_close_date: string | null;
          next_step: string | null; next_step_due_date: string | null;
          lost_reason: string | null;
          won_at: string | null; lost_at: string | null;
          archived_at: string | null; archived_by: string | null;
          workflow_run_id: string | null;
          created_by: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          company_id: string; organization_id: string; title: string;
          primary_contact_id?: string | null;
          stage?: CrmOpportunityStage; owner_user_id?: string | null;
          value_amount?: number | null; value_currency?: string | null;
          expected_close_date?: string | null;
          next_step?: string | null; next_step_due_date?: string | null;
          lost_reason?: string | null; archived_at?: string | null;
        };
        // `company_id` e `organization_id` NON ci sono: spostare una trattativa
        // su un'altra controparte riscriverebbe la storia di due relazioni.
        Update: {
          title?: string; primary_contact_id?: string | null;
          stage?: CrmOpportunityStage; owner_user_id?: string | null;
          value_amount?: number | null; value_currency?: string | null;
          expected_close_date?: string | null;
          next_step?: string | null; next_step_due_date?: string | null;
          lost_reason?: string | null; archived_at?: string | null;
        };
        Relationships: [];
      };
      crm_interactions: {
        Row: {
          id: string; company_id: string; organization_id: string;
          contact_id: string | null; opportunity_id: string | null;
          type: CrmInteractionType; occurred_at: string;
          subject: string | null; notes: string | null;
          created_by: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          company_id: string; organization_id: string; type: CrmInteractionType;
          contact_id?: string | null; opportunity_id?: string | null;
          occurred_at?: string; subject?: string | null; notes?: string | null;
        };
        Update: {
          type?: CrmInteractionType; occurred_at?: string;
          subject?: string | null; notes?: string | null;
        };
        Relationships: [];
      };
      // Lo storico: si legge e basta. Lo scrivono i trigger.
      crm_events: {
        Row: {
          id: string; company_id: string;
          organization_id: string | null; contact_id: string | null;
          opportunity_id: string | null;
          kind: CrmEventKind; detail: Json;
          actor_user_id: string | null; occurred_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      crm_organization_documents: {
        Row: {
          id: string; company_id: string; organization_id: string; document_id: string;
          relation: CrmDocumentRelation; match_reason: CrmMatchReason;
          confirmed_by: string | null; created_at: string;
        };
        Insert: {
          company_id: string; organization_id: string; document_id: string;
          relation?: CrmDocumentRelation;
        };
        Update: { relation?: CrmDocumentRelation };
        Relationships: [];
      };
      crm_organization_emails: {
        Row: {
          id: string; company_id: string; organization_id: string; email_message_id: string;
          match_reason: CrmMatchReason; confirmed_by: string | null; created_at: string;
        };
        Insert: { company_id: string; organization_id: string; email_message_id: string };
        Update: never;
        Relationships: [];
      };
      crm_contact_emails: {
        Row: {
          id: string; company_id: string; contact_id: string; email_message_id: string;
          match_reason: CrmMatchReason; confirmed_by: string | null; created_at: string;
        };
        Insert: { company_id: string; contact_id: string; email_message_id: string };
        Update: never;
        Relationships: [];
      };
      crm_opportunity_documents: {
        Row: {
          id: string; company_id: string; opportunity_id: string; document_id: string;
          added_by: string | null; created_at: string;
        };
        Insert: { company_id: string; opportunity_id: string; document_id: string };
        Update: never;
        Relationships: [];
      };
      // Un suggerimento si LEGGE e si RISOLVE. Il contenuto lo produce il
      // codice server-side: dal client non si inserisce.
      crm_link_suggestions: {
        Row: {
          id: string; company_id: string;
          source_entity_type: CrmLinkedEntity; source_entity_id: string;
          suggested_organization_id: string | null; suggested_contact_id: string | null;
          suggested_name: string | null; suggested_email: string | null;
          reason: CrmMatchReason; reason_detail: string | null;
          status: CrmLinkStatus;
          resolved_at: string | null; resolved_by: string | null;
          created_at: string; dedupe_key: string;
        };
        Insert: never;
        Update: { status?: CrmLinkStatus };
        Relationships: [];
      };
      // ---- Company Assistant (0027) ----------------------------------------
      assistant_threads: {
        Row: {
          id: string; company_id: string; created_by: string;
          title: string; locale: string; status: AssistantThreadStatus;
          created_at: string; updated_at: string; archived_at: string | null;
        };
        Insert: {
          company_id: string; created_by: string;
          title?: string; locale?: string;
        };
        Update: {
          title?: string; status?: AssistantThreadStatus; archived_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      assistant_messages: {
        Row: {
          id: string; thread_id: string; company_id: string;
          role: AssistantMessageRole; content: string; created_by: string | null;
          answer_status: AssistantAnswerStatusDb | null; uncertainty: string | null;
          follow_ups: string[]; model: string | null; prompt_version: string | null;
          run_id: string | null; created_at: string;
        };
        // ⚠️ Solo il messaggio dell'UTENTE: la risposta la scrive il servizio.
        // Una policy della 0027 rifiuta un insert con ruolo `assistant` dal
        // client, e il tipo lo rende anche impossibile da scrivere per sbaglio.
        Insert: {
          thread_id: string; company_id: string;
          role: 'user'; content: string; created_by: string;
        };
        Update: never;
        Relationships: [];
      };
      assistant_runs: {
        Row: {
          id: string; thread_id: string; company_id: string; user_id: string | null;
          status: AssistantRunStatus; model: string; prompt_version: string;
          tool_registry_version: string; retrieval_version: string; citation_strategy: string;
          started_at: string; completed_at: string | null;
          input_tokens: number | null; output_tokens: number | null;
          cache_read_tokens: number | null; cache_write_tokens: number | null;
          tool_call_count: number; error_code: string | null; duration_ms: number | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      assistant_tool_calls: {
        Row: {
          id: string; run_id: string; company_id: string; seq: number;
          tool_key: string; sanitized_input: Json; result_count: number | null;
          status: AssistantToolStatus; duration_ms: number | null;
          error_code: string | null; created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      assistant_citations: {
        Row: {
          id: string; message_id: string; company_id: string; citation_index: number;
          source_type: AssistantSourceTypeDb; source_id: string | null;
          source_ids: string[] | null; group_size: number | null;
          route: string; title: string; subtitle: string | null;
          evidence_id: string | null; page_number: number | null; field_name: string | null;
          cited_text: string | null; value_snapshot: Json; source_version: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      assistant_feedback: {
        Row: {
          id: string; message_id: string; run_id: string | null; company_id: string;
          user_id: string; rating: AssistantFeedbackRating;
          reason: AssistantFeedbackReasonDb | null; prompt_version: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          message_id: string; company_id: string; user_id: string;
          rating: AssistantFeedbackRating; reason?: AssistantFeedbackReasonDb | null;
        };
        Update: { rating?: AssistantFeedbackRating; reason?: AssistantFeedbackReasonDb | null };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      // ---- CRM Light (0026) ------------------------------------------------
      // ⚠️ `Returns: Record<string, unknown>[]` è la stessa scelta di
      // `list_contracts` e `list_documents`: le funzioni di lista tornano righe
      // snake_case con colonne composte, e il tipo preciso vive nel service
      // layer (`toOrganization`, `toOpportunity`). Dichiararlo qui a mano
      // produrrebbe una quarta copia dell'elenco delle colonne — e il repository
      // ha già pagato una dichiarazione FALSA di questo tipo su `list_tasks`,
      // dove `Returns` promette colonne che la funzione SQL non restituisce.
      list_crm_organizations: {
        Args: {
          p_company_id: string; p_query?: string | null;
          p_role?: CrmOrganizationRole | null; p_owner_user_id?: string | null;
          p_status?: CrmRelationshipStatus | null; p_stage?: CrmOpportunityStage | null;
          p_stale_days?: number | null; p_only_overdue_tasks?: boolean;
          p_no_open_opportunity?: boolean; p_archived?: boolean;
          p_sort?: string; p_limit?: number; p_offset?: number;
          p_organization_id?: string | null;
        };
        Returns: Record<string, unknown>[];
      };
      list_crm_opportunities: {
        Args: {
          p_company_id: string; p_query?: string | null;
          p_stage?: CrmOpportunityStage | null; p_owner_user_id?: string | null;
          p_organization_id?: string | null;
          p_only_overdue_next_step?: boolean; p_only_without_next_step?: boolean;
          p_archived?: boolean; p_sort?: string;
          p_limit?: number; p_offset?: number; p_opportunity_id?: string | null;
        };
        Returns: Record<string, unknown>[];
      };
      // §45 — una riga per valuta. Non esiste un totale unico, e non è una
      // mancanza: CHF ed EUR sommati darebbero un numero che non esiste.
      crm_pipeline_summary: {
        Args: { p_company_id: string };
        Returns: {
          stage: CrmOpportunityStage; currency: string | null;
          opportunity_count: number; total_amount: number | null;
        }[];
      };
      /**
       * ⚠️ Torna ZERO righe a chi non è membro dell'azienda, non una riga di
       * zeri. Il servizio deve distinguere i due casi: «il CRM è vuoto» e «non
       * hai accesso» portano ad azioni diverse, e mostrare zeri al secondo
       * sarebbe un guasto travestito da stato legittimo — la stessa trappola
       * dell'Inbox che diceva «collega la posta» invece dell'errore.
       */
      crm_home_summary: {
        Args: { p_company_id: string; p_stale_days?: number };
        Returns: {
          open_opportunities: number; without_next_step: number;
          overdue_follow_ups: number; stale_relationships: number;
          pending_suggestions: number;
        }[];
      };
      crm_timeline: {
        Args: {
          p_company_id: string; p_organization_id: string;
          p_limit?: number; p_offset?: number;
        };
        Returns: Record<string, unknown>[];
      };
      crm_duplicate_candidates: {
        Args: { p_company_id: string; p_organization_id?: string | null; p_limit?: number };
        Returns: {
          organization_id: string; display_name: string;
          duplicate_id: string; duplicate_name: string;
          reason: CrmMatchReason; reason_detail: string | null;
        }[];
      };
      /**
       * Chi è questo indirizzo, DENTRO questa azienda. `email_exact` è
       * un'identità e autorizza il collegamento automatico; `domain_match` è un
       * sospetto e resta un suggerimento (§22-§24).
       */
      crm_match_email: {
        Args: { p_company_id: string; p_email: string };
        Returns: {
          organization_id: string | null; organization_name: string | null;
          contact_id: string | null; contact_name: string | null;
          reason: CrmMatchReason; reason_detail: string | null;
        }[];
      };
      crm_organization_options: {
        Args: { p_company_id: string; p_query?: string | null; p_limit?: number };
        Returns: { id: string; display_name: string; city: string | null; roles: string[] }[];
      };
      /** Solo amministratori, transazionale, nessuna fusione automatica (§30, §31). */
      crm_merge_organizations: {
        Args: { p_target_id: string; p_source_id: string };
        Returns: undefined;
      };
      crm_norm_uid: { Args: { p_value: string | null }; Returns: string | null };
      crm_norm_email: { Args: { p_value: string | null }; Returns: string | null };
      crm_norm_domain: { Args: { p_value: string | null }; Returns: string | null };
      crm_norm_phone: { Args: { p_value: string | null }; Returns: string | null };
      crm_is_public_domain: { Args: { p_domain: string | null }; Returns: boolean };
      is_company_member: { Args: { p_company_id: string }; Returns: boolean };
      is_company_admin: { Args: { p_company_id: string }; Returns: boolean };
      is_case_member: { Args: { p_case_id: string }; Returns: boolean };
      create_company_with_owner: {
        Args: {
          p_legal_name: string; p_uid_che?: string | null; p_canton?: string | null; p_municipality?: string | null;
          p_legal_form?: string | null; p_sector?: string | null; p_employee_count?: number | null; p_revenue_band?: string | null;
        };
        Returns: string;
      };
      /** Rubrica dei membri: `profiles` è leggibile solo dal proprietario. */
      company_member_directory: {
        Args: { p_company_id: string };
        Returns: { user_id: string; display_name: string | null; role: MemberRole }[];
      };
      /**
       * Document Hub (0017): una riga di lista già composta dal database —
       * documento, ultima analisi, correzioni umane applicate, etichette,
       * attività collegate, comunicazioni di provenienza, estratto di ricerca.
       * NON restituisce mai il testo estratto né il JSON dell'analisi.
       */
      list_documents: {
        Args: {
          p_company_id: string; p_query?: string | null;
          p_category?: DocumentCategory | null; p_uncategorized?: boolean;
          p_source?: DocumentSourceType | null; p_state?: string | null;
          p_tag_ids?: string[] | null; p_date_from?: string | null; p_date_to?: string | null;
          p_has_deadline?: boolean; p_archived?: boolean; p_sort?: string;
          p_limit?: number; p_offset?: number; p_document_id?: string | null;
        };
        Returns: {
          id: string; title: string; original_filename: string | null; mime_type: string | null;
          file_size: number | null; storage_path: string | null;
          source_type: DocumentSourceType; status: DocumentStatus; page_count: number | null;
          created_at: string; archived_at: string | null;
          category: DocumentCategory | null; category_source: DocumentCategorySource | null;
          analysis_id: string | null; analysis_status: AnalysisStatus | null;
          last_attempt_failed: boolean; error_code: string | null;
          document_type: string | null; document_type_corrected: boolean;
          sender: string | null; sender_corrected: boolean; sender_authority_type: string | null;
          document_date: string | null; deadline: string | null; deadline_corrected: boolean;
          deadline_requires_verification: boolean;
          amount: number | null; amount_currency: string | null; amount_corrected: boolean;
          confidence: string | null;
          tags: { id: string; name: string }[];
          open_task_count: number; task_count: number; email_count: number;
          snippet: string | null; total_count: number;
        }[];
      };
      /** Conteggi per categoria in un'unica aggregazione (§102). */
      document_category_counts: {
        Args: { p_company_id: string; p_archived?: boolean };
        Returns: { category: DocumentCategory | null; n: number }[];
      };
      /** Azioni di gruppo: tutte o nessuna, mai a metà (§84). */
      documents_bulk_set_category: {
        Args: { p_company_id: string; p_ids: string[]; p_category: DocumentCategory | null };
        Returns: number;
      };
      documents_bulk_archive: {
        Args: { p_company_id: string; p_ids: string[]; p_archived: boolean };
        Returns: number;
      };
      documents_bulk_add_tag: {
        Args: { p_company_id: string; p_ids: string[]; p_tag_id: string };
        Returns: number;
      };
      /**
       * Calendario interno (0018): le attività con scadenza in un intervallo,
       * più le scadute che restano pertinenti anche fuori intervallo.
       * NON restituisce checklist, commenti, storico né analisi: una vista
       * mensile con quaranta attività non deve caricare quaranta analisi.
       * ⚠️ Non c'è `is_overdue`: che cosa sia «in ritardo» lo decide
       * `isOverdue()` in `taskFormat`, una definizione sola per tutto il prodotto.
       */
      calendar_tasks: {
        Args: {
          p_company_id: string; p_from: string; p_to: string;
          p_mine?: boolean; p_status?: TaskStatus | null; p_priority?: TaskPriority | null;
          p_assignee?: string | null; p_include_overdue?: boolean; p_limit?: number;
        };
        Returns: {
          id: string; title: string; due_date: string;
          priority: TaskPriority; status: TaskStatus; source: TaskSource;
          assignee_user_id: string | null; assignee_name: string | null; document_id: string | null;
        }[];
      };
      /** Quante attività aperte non hanno scadenza. Si mostra il numero, non si inventa una data. */
      calendar_undated_count: { Args: { p_company_id: string; p_mine?: boolean }; Returns: number };
      notifications_mark_read: { Args: { p_ids: string[] }; Returns: number };
      notifications_mark_all_read: { Args: { p_company_id: string }; Returns: number };
      notifications_unread_count: { Args: { p_company_id: string }; Returns: number };
      /** Lista attività: filtri, ordinamento e paginazione nel database. */
      list_tasks: {
        Args: {
          p_company_id: string; p_view?: string; p_status?: TaskStatus | null;
          p_priority?: TaskPriority | null; p_source?: TaskSource | null;
          p_assignee?: string | null; p_search?: string | null;
          p_limit?: number; p_offset?: number;
        };
        Returns: (Database['public']['Tables']['tasks']['Row'] & {
          assignee_name: string | null; email_message_id: string | null; total_count: number;
        })[];
      };
      /** Quante esecuzioni, quante azioni, quanti errori negli ultimi N giorni (§102). */
      workflow_metrics: {
        Args: { p_workflow_id: string; p_days?: number };
        Returns: { runs: number; actions_done: number; actions_failed: number; errors: number }[];
      };
      /**
       * Lo stato della coda del motore: quanti eventi aspettano, da quanto, e
       * quanti hanno smesso di essere ritentati. Risponde a «sta girando?» con
       * un numero invece che con un'impressione (§169). Solo amministratori.
       */
      automation_backlog: {
        Args: { p_company_id: string };
        Returns: { pending: number; dead_letter: number; oldest_pending_seconds: number }[];
      };
      /** I limiti che il database APPLICA. Il test li confronta con il contratto TypeScript. */
      automation_limits: { Args: Record<string, never>; Returns: Json };

      /**
       * Finance (0021): una riga di lista già composta dal database — elemento
       * operativo, valori effettivi, documento, duplicato sospetto CALCOLATO,
       * attività e provenienza. Non restituisce mai il testo del documento né
       * il JSON dell'estrazione.
       */
      list_finance_items: {
        Args: {
          p_company_id: string; p_tab?: string | null; p_query?: string | null;
          p_review?: string | null; p_processing?: string | null;
          p_supplier?: string | null; p_currency?: string | null;
          p_date_from?: string | null; p_date_to?: string | null;
          p_due_from?: string | null; p_due_to?: string | null;
          p_source?: DocumentSourceType | null;
          p_category?: FinanceExpenseCategory | null;
          p_duplicates?: boolean; p_flagged?: boolean; p_archived?: boolean;
          p_sort?: string; p_limit?: number; p_offset?: number;
          p_item_id?: string | null;
        };
        Returns: {
          id: string; document_id: string; type: FinanceItemType;
          processing_status: FinanceProcessingStatus; review_status: FinanceReviewStatus;
          origin: FinanceOrigin; error_code: string | null;
          expense_category: FinanceExpenseCategory | null;
          payment_method: FinancePaymentMethod | null;
          quality_flags: FinanceQualityFlag[];
          duplicate_suspected: boolean; duplicate_count: number;
          supplier_name: string | null; invoice_number: string | null;
          invoice_date: string | null; due_date: string | null; expense_date: string | null;
          merchant: string | null; currency: string | null;
          gross_amount: number | null; net_amount: number | null; vat_amount: number | null;
          iban: string | null; reference_type: FinanceReferenceType | null;
          payment_reference: string | null;
          corrected_fields: string[];
          reviewed_at: string | null; reviewed_by: string | null;
          archived_at: string | null; created_at: string;
          extraction_id: string | null; extraction_version: number | null;
          document_title: string; document_source: DocumentSourceType;
          document_status: DocumentStatus; storage_path: string | null; mime_type: string | null;
          open_task_count: number; task_count: number; email_count: number;
          total_count: number;
        }[];
      };
      /**
       * I quattro numeri del cruscotto, UNA RIGA PER VALUTA (§113).
       * ⚠️ `total` è `null` sulla riga dei conteggi senza importo e quando la
       * valuta non è nota: un importo senza valuta non è un importo, e
       * sommarlo ne inventerebbe una.
       */
      finance_summary: {
        Args: { p_company_id: string; p_due_days?: number };
        Returns: { bucket: string; currency: string | null; n: number; total: number | null }[];
      };
      /** Le controparti di un possibile duplicato. Non fonde niente (§72). */
      finance_duplicates: {
        Args: { p_item_id: string };
        Returns: {
          id: string; document_id: string; supplier_name: string | null;
          invoice_number: string | null; invoice_date: string | null;
          currency: string | null; gross_amount: number | null;
          review_status: FinanceReviewStatus; created_at: string;
        }[];
      };
      // ---- Contract Manager (0024) ----------------------------------------
      list_contracts: {
        Args: {
          p_company_id: string; p_view?: string | null; p_query?: string | null;
          p_type?: ContractType | null; p_lifecycle?: ContractLifecycleStatus | null;
          p_review?: ContractReviewStatus | null; p_owner?: string | null;
          p_auto_renewal?: ContractAutoRenewal | null; p_without_owner?: boolean;
          p_window_days?: number; p_archived?: boolean; p_sort?: string;
          p_limit?: number; p_offset?: number; p_contract_id?: string | null;
        };
        Returns: Record<string, unknown>[];
      };
      contract_summary: {
        Args: { p_company_id: string; p_window_days?: number };
        Returns: {
          needs_review: number; renewals_soon: number; notices_soon: number;
          without_owner: number; processing: number;
        }[];
      };
      /**
       * ⚠️ L'UNICO percorso che rende un termine «in vigore». Cinque cose
       * accadono insieme o non accadono affatto: senza questa funzione, una
       * schermata interrotta a metà lascerebbe un contratto «verificato» senza
       * termini verificati.
       */
      contract_verify_terms: { Args: { p_version_id: string }; Returns: string };
      /** Riapre una bozza: una versione verificata è immutabile. */
      contract_open_draft: { Args: { p_contract_id: string }; Returns: string | null };
      /** I documenti che POTREBBERO appartenere al contratto: si suggerisce (§77). */
      contract_document_suggestions: {
        Args: { p_contract_id: string; p_limit?: number };
        Returns: {
          document_id: string; title: string; created_at: string;
          category: DocumentCategory | null; reason: string;
        }[];
      };
      /** Serve all'interfaccia per SPIEGARE una data derivata, non per calcolarla. */
      contract_notice_deadline: {
        Args: {
          p_notice_value: number | null; p_notice_unit: ContractPeriodUnit | null;
          p_anchor: ContractNoticeAnchor | null; p_reference_date: string | null;
        };
        Returns: string | null;
      };
      assistant_reserve_slot: {
        Args: {
          p_company_id: string; p_company_limit?: number; p_user_limit?: number;
          p_provider?: string | null; p_model?: string | null;
        };
        Returns: string | null;
      };

      // ---- Incentivi / Subsidy AI 2.0 (0032) -------------------------------
      // ⚠️ `Returns: Record<string, unknown>[]` è la stessa scelta di
      // `list_crm_organizations`, `list_contracts` e `list_documents`: queste
      // funzioni tornano righe snake_case con colonne composte, e il tipo
      // preciso vive nel service layer (`toOpportunity`, `toProject`, `toCase`).
      // Dichiararlo qui a mano produrrebbe una seconda copia dell'elenco delle
      // colonne, e il repository ha già pagato una dichiarazione FALSA di
      // questo tipo su `list_tasks`.
      //
      // ⚠️ `p_view` accetta SETTE valori: all · new · high · to_verify ·
      // deadline · saved · dismissed. Un valore diverso non è un errore per la
      // funzione SQL: cade nel ramo `else`, cioè «tutte». L'elenco chiuso sta
      // in `OPPORTUNITY_VIEWS` (incentivesModel.ts) e un test lo confronta con
      // l'SQL — un elenco non filtrato presentato come filtrato sarebbe una
      // bugia silenziosa.
      list_subsidy_opportunities: {
        Args: {
          p_company_id: string; p_project_id?: string | null;
          p_view?: string; p_limit?: number; p_offset?: number;
        };
        Returns: Record<string, unknown>[];
      };
      /** I criteri di UNA valutazione, con il requisito e la sua evidenza. */
      subsidy_assessment_criteria: {
        Args: { p_assessment_id: string };
        Returns: Record<string, unknown>[];
      };
      list_subsidy_projects: {
        Args: { p_company_id: string; p_include_archived?: boolean };
        Returns: Record<string, unknown>[];
      };
      list_subsidy_cases: {
        Args: { p_company_id: string; p_include_archived?: boolean };
        Returns: Record<string, unknown>[];
      };
      /**
       * ⚠️ LE TRE FUNZIONI DELLA REVISIONE DEL CATALOGO (0037) NON PRENDONO UN
       * `p_company_id`, e l'assenza è il punto: **il catalogo è globale**, non
       * appartiene a un'azienda. L'autorità non è `member_role` — che è per
       * azienda — ma l'appartenenza a `subsidy_catalog_editors`, controllata
       * DENTRO le funzioni, che sono `security definer`. Le due tabelle restano
       * con `revoke all`: qui si concede solo l'esecuzione.
       *
       * ⚠️ A chi non è operatore rispondono con un ERRORE (42501), non con un
       * elenco vuoto: un vuoto direbbe «non c'è niente da revisionare», che è
       * un'altra affermazione, e falsa.
       */
      subsidy_is_catalog_editor: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      list_subsidy_catalog_reviews: {
        Args: { p_include_resolved?: boolean; p_limit?: number };
        Returns: Record<string, unknown>[];
      };
      resolve_subsidy_catalog_review: {
        Args: { p_id: string; p_decision: string; p_note?: string | null };
        Returns: Record<string, unknown>[];
      };
      /**
       * ⚠️ Torna un `jsonb`, non righe: è un oggetto solo. Come
       * `crm_home_summary`, a chi non è membro non risponde con zeri per gentilezza
       * — la RLS filtra le sottointerrogazioni e i conteggi risultano nulli. Il
       * servizio deve distinguere «non ci sono opportunità» da «non hai accesso»:
       * mostrare zeri al secondo sarebbe un guasto travestito da stato legittimo.
       */
      subsidy_home_summary: {
        Args: { p_company_id: string; p_days?: number };
        Returns: Json;
      };
    };
    Enums: {
      member_role: MemberRole;
      document_source_type: DocumentSourceType;
      document_status: DocumentStatus;
      document_category: DocumentCategory;
      document_category_source: DocumentCategorySource;
      analysis_status: AnalysisStatus;
      extraction_method: ExtractionMethod;
      task_priority: TaskPriority;
      task_status: TaskStatus;
      task_source: TaskSource;
      task_event_kind: TaskEventKind;
      eligibility_status: EligibilityStatus;
      subsidy_case_status: SubsidyCaseStatus;
      email_provider: EmailProvider;
      email_connection_status: EmailConnectionStatus;
      email_sync_type: EmailSyncType;
      email_sync_status: EmailSyncStatus;
      email_processing_status: EmailProcessingStatus;
      email_attention_status: EmailAttentionStatus;
      email_relevance: EmailRelevance;
      email_document_relation: EmailDocumentRelation;
      email_attachment_import_status: EmailAttachmentImportStatus;
      calendar_provider: CalendarProvider;
      calendar_connection_status: CalendarConnectionStatus;
      calendar_link_status: CalendarSyncStatus;
      notification_type: NotificationType;
      notification_channel: NotificationChannel;
      notification_delivery_status: NotificationDeliveryStatus;
      automation_event_type: AutomationEventType;
      automation_event_status: AutomationEventStatus;
      workflow_status: WorkflowStatus;
      workflow_run_status: WorkflowRunStatus;
      workflow_action_status: WorkflowActionStatus;
      workflow_audit_kind: WorkflowAuditKind;
      finance_item_type: FinanceItemType;
      finance_processing_status: FinanceProcessingStatus;
      finance_review_status: FinanceReviewStatus;
      finance_origin: FinanceOrigin;
      finance_field_source: FinanceFieldSource;
      finance_reference_type: FinanceReferenceType;
      finance_expense_category: FinanceExpenseCategory;
      finance_payment_method: FinancePaymentMethod;
      finance_extraction_status: FinanceExtractionStatus;
      finance_quality_flag: FinanceQualityFlag;
      finance_event_kind: FinanceEventKind;
      contract_type: ContractType;
      contract_review_status: ContractReviewStatus;
      contract_lifecycle_status: ContractLifecycleStatus;
      contract_document_relation: ContractDocumentRelation;
      contract_origin: ContractOrigin;
      contract_processing_status: ContractProcessingStatus;
      contract_extraction_status: ContractExtractionStatus;
      contract_term_version_status: ContractTermVersionStatus;
      contract_end_kind: ContractEndKind;
      contract_auto_renewal: ContractAutoRenewal;
      contract_period_unit: ContractPeriodUnit;
      contract_notice_anchor: ContractNoticeAnchor;
      contract_termination_method: ContractTerminationMethod;
      contract_cost_frequency: ContractCostFrequency;
      contract_milestone_kind: ContractMilestoneKind;
      contract_milestone_source: ContractMilestoneSource;
      contract_milestone_status: ContractMilestoneStatus;
      contract_quality_flag: ContractQualityFlag;
      contract_event_kind: ContractEventKind;
      crm_organization_role: CrmOrganizationRole;
      crm_relationship_status: CrmRelationshipStatus;
      crm_source: CrmSource;
      crm_contact_method_type: CrmContactMethodType;
      crm_opportunity_stage: CrmOpportunityStage;
      crm_interaction_type: CrmInteractionType;
      crm_document_relation: CrmDocumentRelation;
      crm_match_reason: CrmMatchReason;
      crm_link_status: CrmLinkStatus;
      crm_event_kind: CrmEventKind;
      crm_linked_entity: CrmLinkedEntity;
      assistant_thread_status: AssistantThreadStatus;
      assistant_message_role: AssistantMessageRole;
      assistant_run_status: AssistantRunStatus;
      assistant_answer_status: AssistantAnswerStatusDb;
      assistant_tool_status: AssistantToolStatus;
      assistant_source_type: AssistantSourceTypeDb;
      assistant_feedback_rating: AssistantFeedbackRating;
      assistant_feedback_reason: AssistantFeedbackReasonDb;
    };
    CompositeTypes: Record<string, never>;
  };
}
