// ============================================================================
// Dizionario ITALIANO — è la LINGUA DI RIFERIMENTO del progetto.
//
// `de.ts` e `fr.ts` sono tipizzati come `typeof it`: se manca una chiave la
// compilazione FALLISCE. È così che si evita il problema classico dell'i18n,
// cioè le traduzioni che restano indietro senza che nessuno se ne accorga.
//
// Convenzione delle chiavi: area.contesto.elemento.
// I segnaposto sono `{nome}` e vengono sostituiti da t('chiave', { nome: … }).
// ============================================================================

export const it = {
  // ---- Generale / azioni ricorrenti ---------------------------------------
  common: {
    save: 'Salva',
    cancel: 'Annulla',
    delete: 'Elimina',
    edit: 'Modifica',
    close: 'Chiudi',
    open: 'Apri',
    back: 'Indietro',
    next: 'Avanti',
    retry: 'Riprova',
    copy: 'Copia',
    loading: 'Caricamento…',
    search: 'Cerca',
    confirm: 'Conferma',
    yes: 'Sì',
    no: 'No',
    dontKnow: 'Non so',
    required: 'obbligatorio',
    optional: 'facoltativo',
    verify: 'da verificare',
    error: 'Si è verificato un errore. Riprova.',
  },

  // ---- Marchio e navigazione ----------------------------------------------
  brand: {
    name: 'SwissAI Suite',
    tagline: 'per le PMI svizzere',
  },
  nav: {
    sectionPlatform: 'Piattaforma',
    sectionModules: 'Moduli',
    sectionAccount: 'Account',
    home: 'Panoramica',
    dashboard: 'Dashboard',
    tasks: 'Scadenziario',
    adminAi: 'Admin AI — Documenti',
    subsidyAi: 'Subsidy AI — Incentivi',
    archive: 'Archivio documenti',
    pricing: 'Piani e prezzi',
    activeCompany: 'Azienda attiva',
    switchCompany: 'Cambia azienda',
    signOut: 'Esci',
    signOutAria: 'Esci dall’account',
    menu: 'Menu',
    language: 'Lingua',
    mainNav: 'Navigazione principale',
    openMenu: 'Apri il menu di navigazione',
    closeMenu: 'Chiudi il menu',
  },
  roles: {
    owner: 'Titolare',
    admin: 'Amministratore',
    member: 'Collaboratore',
  },

  // ---- Autenticazione ------------------------------------------------------
  auth: {
    emailLabel: 'Email',
    passwordLabel: 'Password',
    login: {
      title: 'Accedi',
      subtitle: 'Entra nel tuo spazio di lavoro amministrativo.',
      submit: 'Accedi',
      forgot: 'Password dimenticata?',
      noAccount: 'Non hai un account?',
      createAccount: 'Crea account',
    },
    register: {
      title: 'Crea il tuo account',
      subtitle: 'Bastano pochi dati: l’impresa la configuri subito dopo.',
      firstName: 'Nome',
      lastName: 'Cognome',
      submit: 'Crea account',
      haveAccount: 'Hai già un account?',
      goToLogin: 'Accedi',
      checkEmail: 'Ti abbiamo inviato un’email di conferma: aprila per attivare l’account.',
      passwordHint: 'Almeno 8 caratteri.',
    },
    forgot: {
      title: 'Password dimenticata',
      subtitle: 'Ti inviamo un link per impostarne una nuova.',
      submit: 'Invia il link',
      sent: 'Se l’indirizzo è registrato, riceverai un’email con il link per reimpostare la password.',
      backToLogin: 'Torna all’accesso',
    },
    reset: {
      title: 'Nuova password',
      subtitle: 'Scegli una password che non usi altrove.',
      newPassword: 'Nuova password',
      submit: 'Aggiorna password',
      done: 'Password aggiornata: ora puoi accedere.',
    },
    confirmPassword: 'Conferma password',
    passwordsDiffer: 'Le due password non coincidono.',
    redirecting: 'Password aggiornata. Ti stiamo reindirizzando…',
    openFromLink: 'Apri questa pagina dal link ricevuto via email per reimpostare la password.',
    emailPlaceholder: 'nome@azienda.ch',
    errors: {
      emailRequired: 'Inserisci il tuo indirizzo email.',
      passwordRequired: 'Inserisci la password.',
      nameRequired: 'Inserisci nome e cognome.',
      passwordShort: 'La password deve avere almeno 8 caratteri.',
    },
  },

  // ---- Onboarding impresa --------------------------------------------------
  onboarding: {
    title: 'Configura la tua impresa',
    subtitle: 'Questi dati alimentano l’analisi documenti e il matching incentivi. Potrai modificarli in seguito.',
    registrySearch: 'Cerca nel Registro IDI (Zefix)',
    registryPlaceholder: 'Ragione sociale o numero IDI (es. CHE-123.456.789)',
    registryHint: 'Compila automaticamente i campi qui sotto; puoi sempre correggere a mano.',
    registryUnavailable: 'La ricerca automatica nel Registro IDI non è al momento attiva. Inserisci i dati manualmente qui sotto.',
    registryNoResults: 'Nessuna azienda trovata. Inserisci i dati manualmente qui sotto.',
    registryImported: 'Dati importati. Verifica e completa forma giuridica, settore e numero di dipendenti.',
    registryResultsAria: 'Risultati del Registro IDI',
    legalName: 'Ragione sociale',
    legalNamePlaceholder: 'Es. Rossi Impianti Sagl',
    uid: 'Numero IDI / CHE',
    uidInvalid: 'Questo numero IDI non supera la verifica della cifra di controllo: controlla di averlo digitato correttamente. Puoi comunque proseguire.',
    canton: 'Cantone',
    municipality: 'Comune',
    municipalityPlaceholder: 'Es. Lugano',
    legalForm: 'Forma giuridica',
    sector: 'Settore',
    sectorPlaceholder: '— Seleziona —',
    employees: 'Numero dipendenti',
    employeesPlaceholder: 'Es. 12',
    revenue: 'Fascia di fatturato (facoltativa)',
    submit: 'Crea impresa e continua',
    errorName: 'Inserisci la ragione sociale.',
  },

  // ---- Scadenziario --------------------------------------------------------
  tasks: {
    title: 'Scadenziario',
    subtitle: 'Tutte le scadenze e le attività, con priorità e stato.',
    empty: 'Nessuna scadenza registrata',
    emptySub: 'Le attività create dai documenti analizzati e dagli incentivi compaiono qui.',
    markDone: 'Completa',
    reopen: 'Riapri',
    completed: 'Completata',
    noDueDate: 'Senza data',
    dueOn: 'Scade il {date}',
    overdueBy: 'Scaduta da {days} giorni',
    dueToday: 'Scade oggi',
    dueIn: 'Tra {days} giorni',
    priority: { high: 'alta', medium: 'media', low: 'bassa' },
  },

  // ---- Archivio ------------------------------------------------------------
  archive: {
    title: 'Archivio documenti',
    subtitle: 'Tutti i documenti caricati, con filtri per urgenza e stato della checklist.',
    count: 'Documenti ({n})',
    empty: 'Nessun documento ancora',
    emptySub: 'Carica la tua prima comunicazione amministrativa e lascia che Admin AI la trasformi in azioni concrete.',
    emptyCta: 'Analizza un documento',
    noneWithFilter: 'Nessun documento con questo filtro.',
    filterAll: 'tutte',
    actionsProgress: '{done}/{total} azioni',
    processing: 'In elaborazione',
    analysisFailed: 'Analisi non riuscita',
    analysisFailedSub: 'Analisi non riuscita — il documento è conservato',
    needsReview: 'Da verificare',
    confirmDelete: 'Eliminare questo documento?',
    deleted: 'Documento eliminato',
    openFileAria: 'Apri il file: {title}',
  },

  // ---- Stati ed errori comuni ---------------------------------------------
  states: {
    loading: 'Caricamento…',
    errorTitle: 'Qualcosa non ha funzionato',
    retry: 'Riprova',
    verifyingSession: 'Verifica sessione…',
    loadingCompany: 'Caricamento azienda…',
    configRequired: 'Configurazione richiesta',
    configHint: 'Imposta VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nel file .env.',
  },

  // ---- Disclaimer ----------------------------------------------------------
  legal: {
    disclaimer: 'SwissAI Suite è uno strumento di supporto amministrativo. Le analisi sono generate automaticamente e non sostituiscono la consulenza legale, fiscale o fiduciaria. Quando il sistema non è sicuro, lo segnala e invita a una verifica manuale.',
  },
};
// NB: niente `as const`. Servono le CHIAVI come contratto, non i valori: con i
// tipi letterali una traduzione dovrebbe coincidere con l'italiano, che è
// esattamente il contrario dello scopo. Una chiave mancante resta un errore.

export type Dictionary = typeof it;
