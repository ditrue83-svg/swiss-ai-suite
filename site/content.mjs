// ============================================================================
// Contenuti della vetrina AI-Swisse, nelle tre lingue in cui una PMI svizzera
// riceve la posta amministrativa.
//
// UNICA FONTE: le pagine (it, de, fr + legali) sono generate da qui con
// `node build.mjs`. Scriverle a mano avrebbe significato tenere allineati nove
// file per ogni virgola.
//
// REGOLA: qui dentro non si promette niente che il prodotto non faccia già.
// In particolare NON si scrive:
//  · «prova gratuita» o «14 giorni» — non esiste un trial;
//  · «dati in Svizzera» — il progetto Supabase è a Francoforte (eu-central-1),
//    quindi si dice «in Europa», che è vero;
//  · «ricerca automatica nel registro IDI» — Zefix è deployato ma inerte;
//  · «consulenza fiscale» — è uno strumento di supporto, e lo dichiara;
//  · le funzioni dei piani alti dell'app (posta amministrativa automatica,
//    workflow, monitoraggio, gestione multi-cliente) — sono in progetto, non
//    esistono. Per questo la sezione prezzi elenca solo assi REALI di
//    differenza e dichiara che il listino si definisce con le imprese pilota.
//
// NESSUN DATO LEGALE È INVENTATO. Dove un dato manca non c'è un segnaposto: la
// frase è scritta in modo da reggere senza. I campi che aspettano un dato reale
// (`aboutRole`, `aboutPlace`, `contactAddress`, `contactPhone`) sono stringhe
// VUOTE e il generatore salta il blocco che li conterrebbe — una parentesi
// quadra in produzione è peggio di un'informazione assente.
//
// `LEGAL_COMPLETE` governa impressum, privacy e condizioni: finché è `false`
// quelle pagine hanno `noindex, nofollow` e non sono collegate dal piè di
// pagina, dove resta solo l'email. Mancano ragione sociale, forma giuridica,
// indirizzo, IDI e la revisione di un legale: sono pagine che dicono il vero ma
// non sono complete, e non devono farsi indicizzare come se lo fossero.
// Messi quei dati: `LEGAL_COMPLETE = true`, e tornano indicizzabili e collegate.
//
// ⚠️ Tedesco e francese sono stati redatti internamente, come quelli dell'app:
// vanno nella stessa revisione madrelingua (docs/revisione-traduzioni.md).
// ============================================================================

export const APP_URL = 'https://app.ai-swisse.com';
export const SITE_URL = 'https://ai-swisse.com';
export const CONTACT_EMAIL = 'info@ai-swisse.com';

/** Impressum, privacy e condizioni: complete e pubblicabili? Vedi in alto. */
export const LEGAL_COMPLETE = false;

/** Fornitore del modello: dichiarato nell'informativa, verificato nel codice
 *  (`supabase/functions/_shared/prompt.ts`, `@anthropic-ai/sdk`). */
export const AI_PROVIDER = 'Anthropic PBC';
export const AI_MODEL = 'Claude';

export const LOCALES = ['it', 'de', 'fr'];
export const LOCALE_LABEL = { it: 'Italiano', de: 'Deutsch', fr: 'Français' };
/** Percorso di ogni lingua: l'italiano sta nella radice. */
export const LOCALE_PATH = { it: '/', de: '/de/', fr: '/fr/' };
export const HTML_LANG = { it: 'it-CH', de: 'de-CH', fr: 'fr-CH' };
/** Pagine secondarie, una per lingua. */
export const LEGAL_PAGES = ['impressum', 'privacy', 'terms'];
export const LEGAL_SLUG = {
  it: { impressum: 'impressum', privacy: 'privacy', terms: 'condizioni' },
  de: { impressum: 'impressum', privacy: 'datenschutz', terms: 'nutzungsbedingungen' },
  fr: { impressum: 'impressum', privacy: 'confidentialite', terms: 'conditions' },
};

export const CONTENT = {
  it: {
    title: 'AI-Swisse — la posta amministrativa diventa cose da fare',
    description:
      'AI-Swisse legge lettere e PDF di enti svizzeri in italiano, tedesco e francese: estrae ente, scadenze e importi citando il punto esatto del documento, prepara la checklist e una bozza di risposta. E trova gli incentivi per cui la tua impresa è pertinente.',
    tagline: 'per le PMI svizzere',
    mainNav: 'Navigazione principale',
    nav: { how: 'Come funziona', trust: 'Verificabilità', pricing: 'Prezzi', about: 'Chi siamo', contact: 'Contatti' },
    login: 'Accedi',
    signup: 'Crea un account',
    demo: 'Chiedi una dimostrazione',
    skip: 'Vai al contenuto',

    heroTitle: 'La posta dell’amministrazione, tradotta in cose da fare.',
    heroLead:
      'Un sollecito dell’AFC, un controllo del Comune, una richiesta della cassa di compensazione. AI-Swisse legge il documento — anche in tedesco o in francese — e ti dice chi scrive, entro quando, quanto, e cosa devi fare. Ogni informazione è legata al punto del testo da cui è stata ricavata.',
    heroNote: 'Interfaccia e analisi in italiano, tedesco e francese.',

    howTitle: 'Come funziona',
    how: [
      { n: '1', t: 'Carichi il documento', d: 'Un PDF, una foto della lettera, oppure incolli il testo di un’email.' },
      { n: '2', t: 'Il sistema lo legge', d: 'Estrae ente, oggetto, scadenza, importi e azioni richieste, con la citazione di ogni informazione.' },
      { n: '3', t: 'Ottieni la checklist', d: 'Le cose da fare, spuntabili. E una bozza di risposta da rileggere e correggere.' },
      { n: '4', t: 'Le scadenze restano', d: 'Ogni termine finisce nello scadenziario, con i giorni che mancano.' },
    ],

    example: {
      title: 'Come si presenta un risultato',
      lead: 'A sinistra la lettera ricevuta, a destra quello che il sistema ne ricava. La frase evidenziata è quella da cui viene la scadenza: è così per ogni informazione.',
      label: 'Esempio illustrativo',
      note: 'Dati fittizi: serve a mostrare la forma del risultato, non un caso reale.',
      letterTitle: 'La lettera ricevuta',
      letterFrom: 'Amministrazione federale delle contribuzioni (AFC)\nDivisione principale IVA\n3003 Berna',
      letterSubject: 'Oggetto: rendiconto IVA — 2° trimestre',
      letterBefore: 'Spettabile Ditta,\n\ndai nostri sistemi risulta che il rendiconto dell’imposta sul valore aggiunto relativo al 2° trimestre non è ancora pervenuto.\n\n',
      letterHighlight: 'Vi invitiamo a trasmettere il rendiconto entro il {dataLettera}.',
      letterAfter: '\n\nIn caso di ulteriore ritardo l’Amministrazione procede secondo le disposizioni di legge.\n\nDistinti saluti\nAmministrazione federale delle contribuzioni',
      analysisTitle: 'Quello che ne ricava',
      docTitle: 'Amministrazione federale delle contribuzioni (AFC) — sollecito IVA',
      urgency: 'urgenza alta',
      confidence: 'confidenza alta',
      kicker: 'Cosa devi fare adesso',
      action: 'Trasmettere il rendiconto IVA del 2° trimestre',
      origin: 'Richiesto nel documento',
      when: 'Entro il {data} · Mancano {giorni} giorni',
      quoteLabel: 'Mostra nel documento',
      quote: 'Vi invitiamo a trasmettere il rendiconto entro il {dataLettera}.',
      verifyTitle: 'Da verificare',
      verify: 'Il documento non indica l’importo dell’eventuale multa.',
    },

    modulesTitle: 'Due moduli, un unico posto',
    modules: [
      {
        kicker: 'Modulo 1',
        name: 'Admin AI',
        lead: 'Documenti amministrativi',
        points: [
          'Riconosce l’ente che scrive e il tipo di comunicazione: sollecito, controllo, richiesta di documenti, decisione.',
          'Estrae scadenza, importi e numeri di riferimento, e per ognuno mostra la frase del documento da cui vengono.',
          'Prepara la checklist delle cose da fare e una bozza di risposta, nella lingua e nel tono che scegli.',
          'Legge PDF, lettere scansionate e anche una foto fatta col telefono.',
        ],
      },
      {
        kicker: 'Modulo 2',
        name: 'Subsidy AI',
        lead: 'Incentivi e contributi',
        points: [
          'Descrivi il progetto a parole tue: il sistema individua gli ambiti e cerca i programmi pertinenti.',
          'Distingue due cose che vengono spesso confuse: la pertinenza del programma e la tua idoneità.',
          'Verifica i requisiti uno per uno e dice quali restano da controllare, invece di dare un esito e basta.',
          'Avvisa quando la domanda va presentata prima di iniziare i lavori: è l’errore che costa il contributo.',
        ],
      },
    ],

    trustTitle: 'Perché puoi controllare quello che leggi',
    trustLead:
      'Un’analisi che sbaglia una scadenza senza dirtelo è peggio di nessuna analisi. Per questo il prodotto è costruito intorno alla verifica, non intorno alla fluidità della risposta.',
    trust: [
      {
        icon: 'quote',
        t: 'Ogni conclusione ha una citazione',
        d: 'Accanto a scadenza, mittente e importi c’è «Mostra nel documento»: la frase da cui l’informazione è stata ricavata, evidenziata nel testo originale. Se la citazione non si ritrova nel documento, viene scartata e l’affidabilità dichiarata scende.',
      },
      {
        icon: 'question',
        t: 'Ciò che non è certo lo dice',
        d: 'Non esistono scadenze, importi o enti di ripiego. Quando un dato non è nel documento compare fra le cose «da verificare», con il motivo. Un rischio non determinabile viene dichiarato tale, non trasformato in un avviso generico.',
      },
      {
        icon: 'tag',
        t: 'Le azioni dichiarano la provenienza',
        d: 'Ogni voce della checklist è marcata «dal documento» oppure «suggerimento AI-Swisse»: sai sempre cosa ti sta chiedendo l’ente e cosa è un consiglio operativo.',
      },
      {
        icon: 'history',
        t: 'Resta traccia di tutto',
        d: 'Il file che hai caricato, il testo estratto e l’analisi restano separati e non vengono mai sovrascritti. Anche a distanza di mesi puoi risalire a che cosa il sistema aveva letto quel giorno, e a chi ha corretto che cosa.',
      },
    ],

    langTitle: 'Tre lingue, come la posta che ricevi',
    langLead:
      'L’interfaccia e i testi generati seguono la lingua che scegli: italiano, tedesco o francese. Le citazioni restano nella lingua del documento — tradurle le renderebbe impossibili da ritrovare nel testo, e la verifica le scarterebbe.',

    limitsTitle: 'Quello che è giusto sapere prima',
    limits: [
      'AI-Swisse è uno strumento di supporto amministrativo: non sostituisce la consulenza legale, fiscale o fiduciaria. Quando il sistema non è sicuro, lo dichiara e invita a una verifica.',
      'Il catalogo incentivi copre oggi i programmi della Confederazione e del Cantone Ticino. Gli altri cantoni non sono ancora coperti.',
      'I dati sono ospitati in Europa (Francoforte), non in Svizzera. Per analizzare un documento, il testo estratto viene trasmesso al fornitore del modello linguistico. È spiegato nell’informativa sulla privacy.',
      'Le condizioni, gli importi e le scadenze dei programmi di incentivo vanno sempre verificati sulla fonte ufficiale prima di procedere: il prodotto indica la fonte e la data dell’ultimo controllo.',
    ],

    pricingTitle: 'Prezzi',
    pricingLead:
      'Il listino si sta definendo insieme alle prime imprese che usano il prodotto. Preferiamo dirlo invece di pubblicare quattro cifre che cambieranno.',
    pricingAxesTitle: 'Su cosa si differenzieranno i piani',
    pricingAxes: [
      { t: 'Quante analisi al mese', d: 'Un artigiano che riceve tre lettere al mese e uno studio che ne riceve trecento non possono pagare lo stesso.' },
      { t: 'Quante verifiche di idoneità', d: 'La ricerca degli incentivi e la verifica requisito per requisito hanno un costo per verifica.' },
      { t: 'Quante persone in azienda', d: 'Scadenziario personale oppure condiviso, con le attività assegnate a chi le deve fare.' },
      { t: 'Uso in studio fiduciario', d: 'Più imprese clienti seguite dallo stesso studio: è la direzione di sviluppo, oggi non ancora disponibile.' },
    ],
    pricingNote:
      'Chi entra adesso come impresa pilota concorda le condizioni direttamente con noi, e le tiene.',
    pricingCta: 'Chiedi una dimostrazione',

    aboutTitle: 'Chi c’è dietro',
    aboutLead:
      'Un prodotto che legge la posta della vostra impresa deve dire chi lo fa. Non è un marchio dietro cui non c’è nessuno.',
    aboutName: 'Andrea Cavalieri',
    aboutRole: '',
    aboutPlace: '',
    aboutWhy:
      'AI-Swisse nasce da un problema concreto: in una PMI svizzera la posta amministrativa arriva in tre lingue, ogni lettera nasconde una scadenza, e chi la apre di solito ha altro da fare. Gli strumenti che promettono di «riassumere» un documento non bastano: se sbagliano una data e non lo dicono, il danno è peggiore del lavoro risparmiato. Per questo qui ogni informazione è accompagnata dalla frase da cui viene, e ciò che il sistema non sa lo dichiara.',
    aboutContactLine: 'Per parlare direttamente:',

    ctaTitle: 'Provalo con una lettera che hai sul tavolo',
    ctaLead: 'Crei l’account, configuri l’impresa in un minuto e carichi il primo documento. Se preferisci prima vederlo in funzione, chiedi una dimostrazione.',
    contactTitle: 'Contatti',
    contactLead: 'Per domande, per una dimostrazione o per parlare di un uso in studio fiduciario.',
    contactEmailLabel: 'Email',
    contactDemoLabel: 'Dimostrazione',
    contactDemoText: 'Mezz’ora, in videochiamata o di persona. Portate una lettera vostra: la analizziamo insieme.',
    contactPhoneLabel: 'Telefono',
    contactAddressLabel: 'Sede',
    contactAddress: '',
    contactPhone: '',
    contactHoursLabel: 'Risposta',
    contactHours: 'Scriviamo di solito entro un giorno lavorativo.',

    footerNote: 'AI-Swisse — strumento di supporto amministrativo per le PMI svizzere.',
    footerApp: 'Vai all’applicazione',
    footerLegal: { impressum: 'Impressum', privacy: 'Privacy', terms: 'Condizioni d’uso' },

    legal: {
      backToSite: 'Torna al sito',
      updated: 'Ultimo aggiornamento: {data}',
      impressum: {
        title: 'Impressum',
        intro: 'Indicazioni sul gestore di questo sito e del servizio AI-Swisse.',
        sections: [
          { h: 'Titolare del servizio', p: ['AI-Swisse è gestito da Andrea Cavalieri.', 'Il servizio si rivolge a imprese e professionisti in Svizzera.'] },
          { h: 'Contatto', p: [`Email: ${CONTACT_EMAIL}`, 'Scriviamo di solito entro un giorno lavorativo.'] },
          { h: 'Responsabile dei contenuti', p: ['Andrea Cavalieri'] },
          { h: 'Esclusione di responsabilità', p: ['I contenuti di questo sito sono redatti con cura ma senza garanzia di completezza o attualità. AI-Swisse è uno strumento di supporto amministrativo e non sostituisce la consulenza legale, fiscale o fiduciaria.', 'I collegamenti a siti di terzi rimandano a contenuti di cui non rispondiamo.'] },
          { h: 'Diritto d’autore', p: ['Testi, grafica e codice di questo sito appartengono al titolare del servizio, salvo diversa indicazione.'] },
        ],
      },
      privacy: {
        title: 'Informativa sulla privacy',
        intro: 'Che cosa succede ai dati vostri e dei vostri documenti. È scritta in modo che si capisca senza un avvocato; dove la legge richiede formule precise, ci sono e sono segnalate.',
        sections: [
          { h: 'Chi tratta i dati', p: ['I dati sono trattati da Andrea Cavalieri, che gestisce AI-Swisse.', `Per qualunque questione sui vostri dati: ${CONTACT_EMAIL}`] },
          { h: 'Questo sito', p: ['La vetrina che state leggendo non usa cookie, non ha strumenti di analisi statistica e non carica risorse da altri siti: nessun carattere tipografico remoto, nessun tracciamento. Il server registra le richieste secondo la prassi ordinaria del fornitore di hosting.', 'Il sito è ospitato su GitHub Pages, servizio di GitHub, Inc. (Stati Uniti), che registra gli indirizzi IP delle richieste per il funzionamento e la sicurezza del servizio. Su questo sito non c’è nulla da accedere e nessun dato da inserire: per usare l’applicazione si passa da app.ai-swisse.com.'] },
          { h: 'Quali dati raccoglie l’applicazione', p: ['Dati di account: nome, cognome, indirizzo email.', 'Dati dell’impresa: ragione sociale, cantone, settore, dimensione e le informazioni che inserite nel profilo per la ricerca di incentivi.', 'Documenti: i file che caricate, il testo estratto e l’analisi prodotta.', 'Dati tecnici necessari al funzionamento: registro degli accessi e delle richieste all’AI, con data, esito e consumo.'] },
          { h: 'Dove stanno i dati', p: ['Account, documenti e analisi sono ospitati su Supabase, in un progetto situato a Francoforte, in Germania (Unione Europea). Non in Svizzera: è una differenza che per alcune imprese conta, quindi è scritta anche in home page.', 'I file caricati stanno in uno spazio privato: sono raggiungibili solo dagli utenti della vostra impresa, tramite collegamenti temporanei.'] },
          { h: 'Il testo dei documenti viene inviato a un fornitore esterno', p: [`Per analizzare un documento, il testo estratto viene trasmesso a ${AI_PROVIDER}, fornitore del modello linguistico ${AI_MODEL}, che elabora la richiesta e restituisce il risultato. Senza questa trasmissione l’analisi non può avvenire.`, 'Viene inviato il testo, non il file originale. Se il documento è una scansione o una foto, viene inviata l’immagine per il riconoscimento del testo.', 'Il fornitore ha sede negli Stati Uniti: il testo trasmesso per l’analisi esce quindi dalla Svizzera e dallo Spazio economico europeo. È la ragione per cui esiste anche la modalità locale descritta qui sotto.', 'Esiste anche una modalità di funzionamento locale, che non trasmette nulla all’esterno ed esegue l’analisi nel vostro browser: il risultato è più limitato ed è dichiarato come tale.'] },
          { h: 'Perché trattiamo questi dati', p: ['Per erogare il servizio che avete richiesto, cioè eseguire il contratto.', 'Per la sicurezza del servizio e per rispettare gli obblighi di legge.', 'Non usiamo i vostri documenti per addestrare modelli e non li cediamo a terzi per scopi commerciali.'] },
          { h: 'Per quanto tempo', p: ['I documenti e le analisi restano finché non li cancellate voi: nell’archivio ogni documento ha un comando di eliminazione, che rimuove il file, il testo estratto e l’analisi collegata.', 'Non esiste oggi una cancellazione automatica dopo un certo periodo: le analisi si accumulano finché non intervenite. Lo diciamo perché è così, non perché sia l’assetto definitivo.', 'I dati di account restano finché l’account esiste. Alla chiusura vengono rimossi su richiesta scritta all’indirizzo indicato sopra.'] },
          { h: 'I vostri diritti', p: ['Potete chiedere di accedere ai vostri dati, correggerli, cancellarli, limitarne il trattamento e riceverli in un formato leggibile da una macchina.', `Per esercitarli basta scrivere a ${CONTACT_EMAIL}.`, 'Se ritenete che il trattamento violi la legge potete rivolgervi all’autorità competente: in Svizzera l’Incaricato federale della protezione dei dati e della trasparenza (IFPDT), nell’Unione Europea l’autorità del vostro Paese.'] },
          { h: 'Modifiche', p: ['Se questa informativa cambia in modo sostanziale ve lo comunichiamo per email prima che la modifica abbia effetto.'] },
        ],
      },
      terms: {
        title: 'Condizioni d’uso',
        intro: 'Le regole del rapporto fra chi usa AI-Swisse e chi lo gestisce.',
        sections: [
          { h: 'Oggetto', p: ['AI-Swisse è un servizio in abbonamento che analizza documenti amministrativi e segnala programmi di incentivo pertinenti. Il servizio è rivolto a imprese e professionisti, non a consumatori privati.'] },
          { h: 'Che cosa il servizio NON è', p: ['Non è consulenza legale, fiscale, contabile o fiduciaria, e non la sostituisce.', 'Le analisi sono prodotte automaticamente e possono contenere errori. Ogni informazione va verificata sul documento originale, che resta sempre consultabile a fianco dell’analisi.', 'Le decisioni prese sulla base delle analisi restano vostre e sotto la vostra responsabilità.'] },
          { h: 'Account e uso corretto', p: ['Siete responsabili delle credenziali e di quello che viene fatto con il vostro account.', 'Caricate soltanto documenti che avete il diritto di trattare. Non caricate dati di terzi senza averne titolo.', 'Non è consentito usare il servizio per scopi illeciti, né tentare di aggirarne i limiti tecnici.'] },
          { h: 'Disponibilità', p: ['Ci impegniamo a mantenere il servizio disponibile, senza garantire un funzionamento ininterrotto. Interventi di manutenzione e guasti dei fornitori possono causare interruzioni. Non è previsto un livello di servizio garantito contrattualmente.'] },
          { h: 'Prezzi e pagamento', p: ['Nella fase attuale le condizioni economiche sono concordate individualmente con ciascuna impresa pilota, e sono riportate nell’accordo che ricevete prima dell’attivazione.'] },
          { h: 'Responsabilità', p: ['Si applicano le disposizioni del diritto svizzero.', 'Le analisi sono prodotte automaticamente e possono contenere errori: ogni informazione va verificata sul documento originale, che resta sempre consultabile a fianco dell’analisi, prima di prendere una decisione.'] },
          { h: 'Diritto applicabile', p: ['Si applica il diritto svizzero.'] },
        ],
      },
    },
  },

  de: {
    title: 'AI-Swisse — Behördenpost wird zu konkreten Aufgaben',
    description:
      'AI-Swisse liest Briefe und PDF von Schweizer Behörden auf Deutsch, Französisch und Italienisch: erkennt Absender, Fristen und Beträge und belegt jede Angabe mit der Stelle im Dokument, erstellt die Checkliste und einen Antwortentwurf. Und findet die Fördermittel, für die Ihr Unternehmen relevant ist.',
    tagline: 'für Schweizer KMU',
    mainNav: 'Hauptnavigation',
    nav: { how: 'So funktioniert es', trust: 'Nachprüfbarkeit', pricing: 'Preise', about: 'Über uns', contact: 'Kontakt' },
    login: 'Anmelden',
    signup: 'Konto erstellen',
    demo: 'Vorführung anfragen',
    skip: 'Zum Inhalt springen',

    heroTitle: 'Behördenpost, übersetzt in konkrete Aufgaben.',
    heroLead:
      'Eine Mahnung der ESTV, eine Kontrolle der Gemeinde, eine Anfrage der Ausgleichskasse. AI-Swisse liest das Dokument — auch auf Italienisch oder Französisch — und sagt Ihnen, wer schreibt, bis wann, wie viel und was zu tun ist. Jede Angabe ist mit der Stelle im Text verknüpft, aus der sie stammt.',
    heroNote: 'Oberfläche und Analyse auf Deutsch, Französisch und Italienisch.',

    howTitle: 'So funktioniert es',
    how: [
      { n: '1', t: 'Dokument hochladen', d: 'Ein PDF, ein Foto des Briefes, oder Sie fügen den Text einer E-Mail ein.' },
      { n: '2', t: 'Das System liest es', d: 'Es erfasst Behörde, Betreff, Frist, Beträge und verlangte Schritte — mit Belegstelle zu jeder Angabe.' },
      { n: '3', t: 'Sie erhalten die Checkliste', d: 'Die Aufgaben, zum Abhaken. Und einen Antwortentwurf zum Prüfen und Anpassen.' },
      { n: '4', t: 'Die Fristen bleiben', d: 'Jeder Termin landet im Fristenkalender, mit den verbleibenden Tagen.' },
    ],

    example: {
      title: 'So sieht ein Ergebnis aus',
      lead: 'Links der erhaltene Brief, rechts das, was das System daraus gewinnt. Der hervorgehobene Satz ist jener, aus dem die Frist stammt — und so ist es bei jeder Angabe.',
      label: 'Illustratives Beispiel',
      note: 'Fiktive Daten: zeigt die Form des Ergebnisses, keinen echten Fall.',
      letterTitle: 'Der erhaltene Brief',
      letterFrom: 'Eidgenössische Steuerverwaltung (ESTV)\nHauptabteilung MWST\n3003 Bern',
      letterSubject: 'Betreff: MWST-Abrechnung — 2. Quartal',
      letterBefore: 'Sehr geehrte Damen und Herren\n\nGemäss unseren Unterlagen ist die Abrechnung der Mehrwertsteuer für das 2. Quartal noch nicht bei uns eingegangen.\n\n',
      letterHighlight: 'Wir bitten Sie, die Abrechnung bis zum {dataLettera} einzureichen.',
      letterAfter: '\n\nBei weiterer Verzögerung geht die Verwaltung nach den gesetzlichen Bestimmungen vor.\n\nFreundliche Grüsse\nEidgenössische Steuerverwaltung',
      analysisTitle: 'Was es daraus gewinnt',
      docTitle: 'Eidgenössische Steuerverwaltung (ESTV) — Mahnung MWST',
      urgency: 'Dringlichkeit hoch',
      confidence: 'Zuverlässigkeit hoch',
      kicker: 'Was jetzt zu tun ist',
      action: 'MWST-Abrechnung des 2. Quartals einreichen',
      origin: 'Im Dokument verlangt',
      when: 'Bis {data} · {giorni} Tage verbleibend',
      quoteLabel: 'Im Dokument anzeigen',
      quote: 'Wir bitten Sie, die Abrechnung bis zum {dataLettera} einzureichen.',
      verifyTitle: 'Zu prüfen',
      verify: 'Das Dokument nennt die Höhe einer allfälligen Busse nicht.',
    },

    modulesTitle: 'Zwei Module, ein Ort',
    modules: [
      {
        kicker: 'Modul 1',
        name: 'Admin AI',
        lead: 'Behördliche Dokumente',
        points: [
          'Erkennt die schreibende Behörde und die Art des Schreibens: Mahnung, Kontrolle, Aktenanforderung, Verfügung.',
          'Erfasst Frist, Beträge und Referenznummern — und zeigt zu jeder Angabe den Satz im Dokument, aus dem sie kommt.',
          'Erstellt die Checkliste der Aufgaben und einen Antwortentwurf, in der Sprache und Tonalität Ihrer Wahl.',
          'Liest PDF, eingescannte Briefe und auch ein mit dem Handy aufgenommenes Foto.',
        ],
      },
      {
        kicker: 'Modul 2',
        name: 'Subsidy AI',
        lead: 'Fördermittel und Beiträge',
        points: [
          'Beschreiben Sie das Vorhaben in eigenen Worten: das System erkennt die Bereiche und sucht die relevanten Programme.',
          'Es unterscheidet zwei Dinge, die oft verwechselt werden: die Relevanz des Programms und Ihren Anspruch darauf.',
          'Es prüft die Voraussetzungen einzeln und benennt die offenen Punkte, statt nur ein Ergebnis zu liefern.',
          'Es warnt, wenn das Gesuch vor Beginn der Arbeiten einzureichen ist: der Fehler, der den Beitrag kostet.',
        ],
      },
    ],

    trustTitle: 'Warum Sie das Gelesene überprüfen können',
    trustLead:
      'Eine Analyse, die eine Frist falsch angibt, ohne es zu sagen, ist schlechter als keine Analyse. Deshalb ist dieses Produkt um die Überprüfbarkeit gebaut und nicht um die Eloquenz der Antwort.',
    trust: [
      {
        icon: 'quote',
        t: 'Jede Aussage hat eine Belegstelle',
        d: 'Neben Frist, Absender und Beträgen steht «Im Dokument anzeigen»: der Satz, aus dem die Angabe stammt, im Originaltext hervorgehoben. Lässt sich das Zitat im Dokument nicht finden, wird es verworfen und die ausgewiesene Zuverlässigkeit sinkt.',
      },
      {
        icon: 'question',
        t: 'Was unsicher ist, wird gesagt',
        d: 'Es gibt keine Ersatzfristen, Ersatzbeträge oder Ersatzbehörden. Fehlt eine Angabe im Dokument, erscheint sie unter «zu prüfen», mit Begründung. Ein nicht bestimmbares Risiko wird als solches ausgewiesen, nicht in eine allgemeine Warnung verwandelt.',
      },
      {
        icon: 'tag',
        t: 'Aufgaben nennen ihre Herkunft',
        d: 'Jeder Punkt der Checkliste ist als «aus dem Dokument» oder «Vorschlag von AI-Swisse» markiert: Sie wissen immer, was die Behörde verlangt und was ein betrieblicher Hinweis ist.',
      },
      {
        icon: 'history',
        t: 'Alles bleibt nachvollziehbar',
        d: 'Die hochgeladene Datei, der extrahierte Text und die Analyse bleiben getrennt und werden nie überschrieben. Auch nach Monaten können Sie nachvollziehen, was das System an jenem Tag gelesen hat und wer was korrigiert hat.',
      },
    ],

    langTitle: 'Drei Sprachen, wie Ihre Post',
    langLead:
      'Oberfläche und erzeugte Texte folgen der gewählten Sprache: Deutsch, Französisch oder Italienisch. Zitate bleiben in der Sprache des Dokuments — übersetzt liessen sie sich im Text nicht mehr finden, und die Prüfung würde sie verwerfen.',

    limitsTitle: 'Was Sie vorher wissen sollten',
    limits: [
      'AI-Swisse ist ein Hilfsmittel für administrative Aufgaben: es ersetzt keine rechtliche, steuerliche oder treuhänderische Beratung. Wenn das System unsicher ist, weist es darauf hin und empfiehlt eine Prüfung.',
      'Der Förderkatalog umfasst heute die Programme des Bundes und des Kantons Tessin. Weitere Kantone sind noch nicht abgedeckt.',
      'Die Daten liegen in Europa (Frankfurt), nicht in der Schweiz. Für die Analyse wird der extrahierte Text an den Anbieter des Sprachmodells übermittelt. Die Datenschutzerklärung erklärt es im Detail.',
      'Bedingungen, Beträge und Fristen der Förderprogramme sind vor dem Weitergehen stets an der offiziellen Quelle zu prüfen: das Produkt nennt die Quelle und das Datum der letzten Kontrolle.',
    ],

    pricingTitle: 'Preise',
    pricingLead:
      'Das Preismodell entsteht gerade zusammen mit den ersten Unternehmen, die das Produkt einsetzen. Das sagen wir lieber, als vier Zahlen zu veröffentlichen, die sich noch ändern.',
    pricingAxesTitle: 'Woran sich die Pläne unterscheiden werden',
    pricingAxes: [
      { t: 'Wie viele Analysen pro Monat', d: 'Ein Handwerksbetrieb mit drei Briefen im Monat und ein Büro mit dreihundert können nicht gleich viel bezahlen.' },
      { t: 'Wie viele Anspruchsprüfungen', d: 'Die Fördermittelsuche und die Prüfung Voraussetzung für Voraussetzung verursachen Kosten pro Prüfung.' },
      { t: 'Wie viele Personen im Betrieb', d: 'Persönlicher oder gemeinsamer Fristenkalender, mit Aufgaben, die den zuständigen Personen zugewiesen sind.' },
      { t: 'Einsatz im Treuhandbüro', d: 'Mehrere Mandanten aus demselben Büro betreut: das ist die Entwicklungsrichtung, heute noch nicht verfügbar.' },
    ],
    pricingNote:
      'Wer jetzt als Pilotunternehmen einsteigt, vereinbart die Konditionen direkt mit uns — und behält sie.',
    pricingCta: 'Vorführung anfragen',

    aboutTitle: 'Wer dahintersteht',
    aboutLead:
      'Ein Produkt, das die Post Ihres Unternehmens liest, muss sagen, wer es macht. Keine Marke, hinter der niemand steht.',
    aboutName: 'Andrea Cavalieri',
    aboutRole: '',
    aboutPlace: '',
    aboutWhy:
      'AI-Swisse ist aus einem konkreten Problem entstanden: In einem Schweizer KMU kommt die Behördenpost in drei Sprachen, hinter jedem Brief steckt eine Frist, und wer ihn öffnet, hat meist anderes zu tun. Werkzeuge, die ein Dokument «zusammenfassen», genügen dafür nicht: Wenn sie ein Datum falsch wiedergeben und es nicht sagen, ist der Schaden grösser als die gesparte Arbeit. Deshalb steht hier zu jeder Angabe der Satz, aus dem sie stammt — und was das System nicht weiss, sagt es.',
    aboutContactLine: 'Für ein direktes Gespräch:',

    ctaTitle: 'Testen Sie es mit einem Brief, der auf Ihrem Tisch liegt',
    ctaLead: 'Konto erstellen, Unternehmen in einer Minute einrichten, erstes Dokument hochladen. Wenn Sie es lieber zuerst in Aktion sehen: fragen Sie eine Vorführung an.',
    contactTitle: 'Kontakt',
    contactLead: 'Für Fragen, eine Vorführung oder den Einsatz in einem Treuhandbüro.',
    contactEmailLabel: 'E-Mail',
    contactDemoLabel: 'Vorführung',
    contactDemoText: 'Eine halbe Stunde, per Videoanruf oder vor Ort. Bringen Sie einen eigenen Brief mit: wir analysieren ihn gemeinsam.',
    contactPhoneLabel: 'Telefon',
    contactAddressLabel: 'Standort',
    contactAddress: '',
    contactPhone: '',
    contactHoursLabel: 'Antwort',
    contactHours: 'In der Regel antworten wir innerhalb eines Arbeitstages.',

    footerNote: 'AI-Swisse — Hilfsmittel für administrative Aufgaben, für Schweizer KMU.',
    footerApp: 'Zur Anwendung',
    footerLegal: { impressum: 'Impressum', privacy: 'Datenschutz', terms: 'Nutzungsbedingungen' },

    legal: {
      backToSite: 'Zurück zur Website',
      updated: 'Letzte Aktualisierung: {data}',
      impressum: {
        title: 'Impressum',
        intro: 'Angaben zum Betreiber dieser Website und des Dienstes AI-Swisse.',
        sections: [
          { h: 'Anbieter des Dienstes', p: ['AI-Swisse wird von Andrea Cavalieri betrieben.', 'Der Dienst richtet sich an Unternehmen und Fachpersonen in der Schweiz.'] },
          { h: 'Kontakt', p: [`E-Mail: ${CONTACT_EMAIL}`, 'In der Regel antworten wir innerhalb eines Arbeitstages.'] },
          { h: 'Verantwortlich für den Inhalt', p: ['Andrea Cavalieri'] },
          { h: 'Haftungsausschluss', p: ['Die Inhalte dieser Website werden sorgfältig erstellt, jedoch ohne Gewähr für Vollständigkeit und Aktualität. AI-Swisse ist ein Hilfsmittel für administrative Aufgaben und ersetzt keine rechtliche, steuerliche oder treuhänderische Beratung.', 'Links auf Websites Dritter führen zu Inhalten, für die wir nicht verantwortlich sind.'] },
          { h: 'Urheberrecht', p: ['Texte, Gestaltung und Code dieser Website liegen beim Anbieter des Dienstes, soweit nicht anders vermerkt.'] },
        ],
      },
      privacy: {
        title: 'Datenschutzerklärung',
        intro: 'Was mit Ihren Daten und denen Ihrer Dokumente geschieht. Verständlich geschrieben; wo das Gesetz genaue Formulierungen verlangt, stehen sie da und sind als solche erkennbar.',
        sections: [
          { h: 'Wer die Daten bearbeitet', p: ['Die Daten werden von Andrea Cavalieri bearbeitet, der AI-Swisse betreibt.', `Für alle Fragen zu Ihren Daten: ${CONTACT_EMAIL}`] },
          { h: 'Diese Website', p: ['Die Website, die Sie gerade lesen, verwendet keine Cookies, keine Analysewerkzeuge und lädt keine Ressourcen von anderen Servern: keine externen Schriften, kein Tracking. Der Server protokolliert die Zugriffe im üblichen Rahmen des Hosting-Anbieters.', 'Die Website wird über GitHub Pages betrieben, einen Dienst von GitHub, Inc. (Vereinigte Staaten), der die IP-Adressen der Zugriffe für Betrieb und Sicherheit protokolliert. Auf dieser Website gibt es keine Anmeldung und keine Eingabefelder: die Anwendung selbst läuft unter app.ai-swisse.com.'] },
          { h: 'Welche Daten die Anwendung erhebt', p: ['Kontodaten: Vorname, Name, E-Mail-Adresse.', 'Unternehmensdaten: Firmenbezeichnung, Kanton, Branche, Grösse und die Angaben, die Sie im Profil für die Fördermittelsuche erfassen.', 'Dokumente: die hochgeladenen Dateien, der extrahierte Text und die erstellte Analyse.', 'Technische Daten für den Betrieb: Protokoll der Zugriffe und der KI-Anfragen mit Datum, Ergebnis und Verbrauch.'] },
          { h: 'Wo die Daten liegen', p: ['Konten, Dokumente und Analysen liegen bei Supabase, in einem Projekt in Frankfurt am Main, Deutschland (Europäische Union). Nicht in der Schweiz: für manche Unternehmen ist das ein Unterschied, deshalb steht es auch auf der Startseite.', 'Die hochgeladenen Dateien liegen in einem privaten Speicher: erreichbar nur für die Benutzer Ihres Unternehmens, über zeitlich begrenzte Links.'] },
          { h: 'Der Text der Dokumente geht an einen externen Anbieter', p: [`Für die Analyse wird der extrahierte Text an ${AI_PROVIDER} übermittelt, den Anbieter des Sprachmodells ${AI_MODEL}, der die Anfrage verarbeitet und das Ergebnis zurückgibt. Ohne diese Übermittlung ist keine Analyse möglich.`, 'Übermittelt wird der Text, nicht die Originaldatei. Bei einem Scan oder Foto wird das Bild für die Texterkennung übermittelt.', 'Der Anbieter hat seinen Sitz in den Vereinigten Staaten: der zur Analyse übermittelte Text verlässt somit die Schweiz und den Europäischen Wirtschaftsraum. Aus diesem Grund gibt es auch den lokalen Betriebsmodus, der weiter unten beschrieben ist.', 'Es gibt auch einen lokalen Betriebsmodus, der nichts nach aussen übermittelt und die Analyse im Browser ausführt: das Ergebnis ist eingeschränkter und wird als solches deklariert.'] },
          { h: 'Warum wir diese Daten bearbeiten', p: ['Um den von Ihnen bestellten Dienst zu erbringen, also zur Vertragserfüllung.', 'Für die Sicherheit des Dienstes und zur Erfüllung gesetzlicher Pflichten.', 'Wir verwenden Ihre Dokumente nicht zum Trainieren von Modellen und geben sie nicht zu Werbezwecken an Dritte weiter.'] },
          { h: 'Wie lange', p: ['Dokumente und Analysen bleiben, bis Sie sie löschen: im Archiv hat jedes Dokument einen Löschbefehl, der die Datei, den extrahierten Text und die zugehörige Analyse entfernt.', 'Eine automatische Löschung nach einer bestimmten Frist gibt es heute nicht: die Analysen sammeln sich an, bis Sie eingreifen. Wir sagen es, weil es so ist — nicht weil es der Endzustand wäre.', 'Die Kontodaten bleiben, solange das Konto besteht. Nach der Kündigung werden sie auf schriftliche Anfrage an die oben genannte Adresse gelöscht.'] },
          { h: 'Ihre Rechte', p: ['Sie können Auskunft über Ihre Daten verlangen, sie berichtigen und löschen lassen, die Bearbeitung einschränken und die Daten in einem maschinenlesbaren Format erhalten.', `Dafür genügt eine Nachricht an ${CONTACT_EMAIL}.`, 'Wenn Sie die Bearbeitung für rechtswidrig halten, können Sie sich an die zuständige Behörde wenden: in der Schweiz an den Eidgenössischen Datenschutz- und Öffentlichkeitsbeauftragten (EDÖB), in der Europäischen Union an die Behörde Ihres Landes.'] },
          { h: 'Änderungen', p: ['Ändert sich diese Erklärung wesentlich, informieren wir Sie per E-Mail, bevor die Änderung wirksam wird.'] },
        ],
      },
      terms: {
        title: 'Nutzungsbedingungen',
        intro: 'Die Regeln zwischen denen, die AI-Swisse nutzen, und denen, die es betreiben.',
        sections: [
          { h: 'Gegenstand', p: ['AI-Swisse ist ein Abonnementsdienst, der behördliche Dokumente analysiert und relevante Förderprogramme aufzeigt. Der Dienst richtet sich an Unternehmen und Fachpersonen, nicht an private Konsumentinnen und Konsumenten.'] },
          { h: 'Was der Dienst NICHT ist', p: ['Keine rechtliche, steuerliche, buchhalterische oder treuhänderische Beratung — und kein Ersatz dafür.', 'Die Analysen werden automatisch erstellt und können Fehler enthalten. Jede Angabe ist am Originaldokument zu prüfen, das stets neben der Analyse einsehbar bleibt.', 'Entscheide auf Grundlage der Analysen bleiben Ihre und liegen in Ihrer Verantwortung.'] },
          { h: 'Konto und ordnungsgemässe Nutzung', p: ['Sie sind für Ihre Zugangsdaten und für die Nutzung Ihres Kontos verantwortlich.', 'Laden Sie nur Dokumente hoch, die Sie bearbeiten dürfen. Keine Daten Dritter ohne Berechtigung.', 'Die Nutzung zu rechtswidrigen Zwecken sowie das Umgehen technischer Beschränkungen sind nicht gestattet.'] },
          { h: 'Verfügbarkeit', p: ['Wir bemühen uns um einen verfügbaren Dienst, ohne unterbruchsfreien Betrieb zu garantieren. Wartungsarbeiten und Ausfälle von Anbietern können zu Unterbrüchen führen. Ein vertraglich zugesichertes Service-Level besteht nicht.'] },
          { h: 'Preise und Zahlung', p: ['In der jetzigen Phase werden die wirtschaftlichen Bedingungen individuell mit jedem Pilotunternehmen vereinbart und in der Vereinbarung festgehalten, die Sie vor der Aufschaltung erhalten.'] },
          { h: 'Haftung', p: ['Es gelten die Bestimmungen des schweizerischen Rechts.', 'Die Analysen werden automatisch erstellt und können Fehler enthalten: Jede Angabe ist vor einer Entscheidung am Originaldokument zu prüfen, das stets neben der Analyse einsehbar bleibt.'] },
          { h: 'Anwendbares Recht', p: ['Es gilt schweizerisches Recht.'] },
        ],
      },
    },
  },

  fr: {
    title: 'AI-Swisse — le courrier administratif devient une liste de tâches',
    description:
      'AI-Swisse lit les courriers et PDF des autorités suisses en français, allemand et italien : il identifie l’expéditeur, les délais et les montants en citant le passage exact du document, prépare la checklist et un projet de réponse. Et trouve les subventions pertinentes pour votre entreprise.',
    tagline: 'pour les PME suisses',
    mainNav: 'Navigation principale',
    nav: { how: 'Fonctionnement', trust: 'Vérifiabilité', pricing: 'Tarifs', about: 'Qui sommes-nous', contact: 'Contact' },
    login: 'Se connecter',
    signup: 'Créer un compte',
    demo: 'Demander une démonstration',
    skip: 'Aller au contenu',

    heroTitle: 'Le courrier de l’administration, traduit en tâches concrètes.',
    heroLead:
      'Un rappel de l’AFC, un contrôle de la commune, une demande de la caisse de compensation. AI-Swisse lit le document — même en allemand ou en italien — et vous dit qui écrit, pour quand, combien, et ce qu’il faut faire. Chaque information renvoie au passage du texte dont elle est issue.',
    heroNote: 'Interface et analyse en français, allemand et italien.',

    howTitle: 'Fonctionnement',
    how: [
      { n: '1', t: 'Vous chargez le document', d: 'Un PDF, une photo du courrier, ou vous collez le texte d’un e-mail.' },
      { n: '2', t: 'Le système le lit', d: 'Il extrait l’autorité, l’objet, le délai, les montants et les actions demandées, en citant chaque information.' },
      { n: '3', t: 'Vous obtenez la checklist', d: 'Les tâches, à cocher. Et un projet de réponse à relire et corriger.' },
      { n: '4', t: 'Les échéances restent', d: 'Chaque délai rejoint l’échéancier, avec les jours restants.' },
    ],

    example: {
      title: 'À quoi ressemble un résultat',
      lead: 'À gauche le courrier reçu, à droite ce que le système en tire. La phrase surlignée est celle dont provient le délai : il en va de même pour chaque information.',
      label: 'Exemple illustratif',
      note: 'Données fictives : montre la forme du résultat, pas un cas réel.',
      letterTitle: 'Le courrier reçu',
      letterFrom: 'Administration fédérale des contributions (AFC)\nDivision principale TVA\n3003 Berne',
      letterSubject: 'Objet : décompte TVA — 2e trimestre',
      letterBefore: 'Madame, Monsieur,\n\nselon nos systèmes, le décompte de la taxe sur la valeur ajoutée du 2e trimestre ne nous est pas encore parvenu.\n\n',
      letterHighlight: 'Nous vous invitons à transmettre le décompte avant le {dataLettera}.',
      letterAfter: '\n\nEn cas de retard supplémentaire, l’Administration procède conformément aux dispositions légales.\n\nVeuillez agréer nos salutations distinguées.\nAdministration fédérale des contributions',
      analysisTitle: 'Ce qu’il en tire',
      docTitle: 'Administration fédérale des contributions (AFC) — rappel TVA',
      urgency: 'urgence haute',
      confidence: 'fiabilité haute',
      kicker: 'Ce que vous devez faire maintenant',
      action: 'Transmettre le décompte TVA du 2e trimestre',
      origin: 'Demandé dans le document',
      when: 'Avant le {data} · Dans {giorni} jours',
      quoteLabel: 'Afficher dans le document',
      quote: 'Nous vous invitons à transmettre le décompte avant le {dataLettera}.',
      verifyTitle: 'À vérifier',
      verify: 'Le document n’indique pas le montant d’une éventuelle amende.',
    },

    modulesTitle: 'Deux modules, un seul endroit',
    modules: [
      {
        kicker: 'Module 1',
        name: 'Admin AI',
        lead: 'Documents administratifs',
        points: [
          'Identifie l’autorité qui écrit et le type de courrier : rappel, contrôle, demande de pièces, décision.',
          'Extrait le délai, les montants et les numéros de référence, et montre pour chacun la phrase du document dont il provient.',
          'Prépare la checklist des tâches et un projet de réponse, dans la langue et le ton que vous choisissez.',
          'Lit les PDF, les courriers scannés et même une photo prise au téléphone.',
        ],
      },
      {
        kicker: 'Module 2',
        name: 'Subsidy AI',
        lead: 'Subventions et contributions',
        points: [
          'Décrivez le projet avec vos mots : le système en dégage les domaines et cherche les programmes pertinents.',
          'Il distingue deux choses souvent confondues : la pertinence du programme et votre éligibilité.',
          'Il vérifie les conditions une par une et indique celles qui restent à contrôler, au lieu de livrer un simple verdict.',
          'Il alerte quand la demande doit être déposée avant le début des travaux : l’erreur qui coûte la contribution.',
        ],
      },
    ],

    trustTitle: 'Pourquoi vous pouvez vérifier ce que vous lisez',
    trustLead:
      'Une analyse qui se trompe sur un délai sans le dire vaut moins que pas d’analyse du tout. C’est pourquoi ce produit est construit autour de la vérification, et non autour de l’aisance de la réponse.',
    trust: [
      {
        icon: 'quote',
        t: 'Chaque conclusion a une citation',
        d: 'À côté du délai, de l’expéditeur et des montants figure « Afficher dans le document » : la phrase dont l’information est issue, surlignée dans le texte original. Si la citation ne se retrouve pas dans le document, elle est écartée et la fiabilité annoncée baisse.',
      },
      {
        icon: 'question',
        t: 'Ce qui n’est pas sûr est annoncé',
        d: 'Il n’existe pas de délai, de montant ou d’autorité de substitution. Quand une donnée n’est pas dans le document, elle apparaît parmi les points « à vérifier », avec le motif. Un risque non déterminable est déclaré comme tel, pas transformé en avertissement générique.',
      },
      {
        icon: 'tag',
        t: 'Les actions déclarent leur origine',
        d: 'Chaque point de la checklist est marqué « du document » ou « suggestion AI-Swisse » : vous savez toujours ce que l’autorité demande et ce qui est un conseil pratique.',
      },
      {
        icon: 'history',
        t: 'Tout reste traçable',
        d: 'Le fichier chargé, le texte extrait et l’analyse restent séparés et ne sont jamais écrasés. Même des mois plus tard, vous pouvez retrouver ce que le système avait lu ce jour-là, et qui a corrigé quoi.',
      },
    ],

    langTitle: 'Trois langues, comme votre courrier',
    langLead:
      'L’interface et les textes générés suivent la langue choisie : français, allemand ou italien. Les citations restent dans la langue du document — traduites, elles seraient introuvables dans le texte, et la vérification les écarterait.',

    limitsTitle: 'Ce qu’il est juste de savoir avant',
    limits: [
      'AI-Swisse est un outil de soutien administratif : il ne remplace pas le conseil juridique, fiscal ou fiduciaire. Lorsque le système n’est pas sûr, il le signale et recommande une vérification.',
      'Le catalogue des subventions couvre aujourd’hui les programmes de la Confédération et du canton du Tessin. Les autres cantons ne sont pas encore couverts.',
      'Les données sont hébergées en Europe (Francfort), pas en Suisse. Pour analyser un document, le texte extrait est transmis au fournisseur du modèle de langage. La politique de confidentialité l’explique en détail.',
      'Les conditions, montants et délais des programmes doivent toujours être vérifiés à la source officielle avant de poursuivre : le produit indique la source et la date du dernier contrôle.',
    ],

    pricingTitle: 'Tarifs',
    pricingLead:
      'La grille tarifaire se construit avec les premières entreprises qui utilisent le produit. Nous préférons le dire plutôt que publier quatre montants qui vont changer.',
    pricingAxesTitle: 'Ce qui distinguera les formules',
    pricingAxes: [
      { t: 'Le nombre d’analyses par mois', d: 'Un artisan qui reçoit trois courriers par mois et un bureau qui en reçoit trois cents ne peuvent pas payer la même chose.' },
      { t: 'Le nombre de vérifications d’éligibilité', d: 'La recherche de subventions et la vérification condition par condition ont un coût par vérification.' },
      { t: 'Le nombre de personnes dans l’entreprise', d: 'Échéancier personnel ou partagé, avec les tâches attribuées à qui doit les faire.' },
      { t: 'L’usage en fiduciaire', d: 'Plusieurs entreprises clientes suivies par le même bureau : c’est la direction de développement, pas encore disponible aujourd’hui.' },
    ],
    pricingNote:
      'Les entreprises qui entrent maintenant comme pilotes conviennent des conditions directement avec nous, et les gardent.',
    pricingCta: 'Demander une démonstration',

    aboutTitle: 'Qui est derrière',
    aboutLead:
      'Un produit qui lit le courrier de votre entreprise doit dire qui le fait. Pas une marque derrière laquelle il n’y a personne.',
    aboutName: 'Andrea Cavalieri',
    aboutRole: '',
    aboutPlace: '',
    aboutWhy:
      'AI-Swisse est né d’un problème concret : dans une PME suisse, le courrier administratif arrive en trois langues, chaque lettre cache un délai, et celui qui l’ouvre a généralement autre chose à faire. Les outils qui promettent de « résumer » un document n’y suffisent pas : s’ils se trompent de date sans le dire, le dommage dépasse le travail épargné. C’est pourquoi ici chaque information est accompagnée de la phrase dont elle provient — et ce que le système ne sait pas, il le déclare.',
    aboutContactLine: 'Pour en parler directement :',

    ctaTitle: 'Essayez-le avec un courrier posé sur votre bureau',
    ctaLead: 'Vous créez le compte, configurez l’entreprise en une minute et chargez le premier document. Si vous préférez d’abord le voir fonctionner, demandez une démonstration.',
    contactTitle: 'Contact',
    contactLead: 'Pour une question, une démonstration ou un usage en fiduciaire.',
    contactEmailLabel: 'E-mail',
    contactDemoLabel: 'Démonstration',
    contactDemoText: 'Une demi-heure, en visioconférence ou sur place. Apportez un de vos courriers : nous l’analysons ensemble.',
    contactPhoneLabel: 'Téléphone',
    contactAddressLabel: 'Adresse',
    contactAddress: '',
    contactPhone: '',
    contactHoursLabel: 'Réponse',
    contactHours: 'Nous répondons en général dans le jour ouvrable.',

    footerNote: 'AI-Swisse — outil de soutien administratif pour les PME suisses.',
    footerApp: 'Aller à l’application',
    footerLegal: { impressum: 'Impressum', privacy: 'Confidentialité', terms: 'Conditions d’utilisation' },

    legal: {
      backToSite: 'Retour au site',
      updated: 'Dernière mise à jour : {data}',
      impressum: {
        title: 'Impressum',
        intro: 'Informations sur l’exploitant de ce site et du service AI-Swisse.',
        sections: [
          { h: 'Fournisseur du service', p: ['AI-Swisse est exploité par Andrea Cavalieri.', 'Le service s’adresse aux entreprises et aux professionnels en Suisse.'] },
          { h: 'Contact', p: [`E-mail : ${CONTACT_EMAIL}`, 'Nous répondons en général dans le jour ouvrable.'] },
          { h: 'Responsable du contenu', p: ['Andrea Cavalieri'] },
          { h: 'Exclusion de responsabilité', p: ['Les contenus de ce site sont rédigés avec soin, sans garantie d’exhaustivité ni d’actualité. AI-Swisse est un outil de soutien administratif et ne remplace pas le conseil juridique, fiscal ou fiduciaire.', 'Les liens vers des sites tiers mènent à des contenus dont nous ne répondons pas.'] },
          { h: 'Droit d’auteur', p: ['Les textes, la présentation et le code de ce site appartiennent au fournisseur du service, sauf indication contraire.'] },
        ],
      },
      privacy: {
        title: 'Politique de confidentialité',
        intro: 'Ce qu’il advient de vos données et de celles de vos documents. Rédigée pour être comprise sans avocat ; là où la loi exige des formules précises, elles y sont et sont signalées.',
        sections: [
          { h: 'Qui traite les données', p: ['Les données sont traitées par Andrea Cavalieri, qui exploite AI-Swisse.', `Pour toute question sur vos données : ${CONTACT_EMAIL}`] },
          { h: 'Ce site', p: ['Le site vitrine que vous lisez n’utilise pas de cookies, n’a pas d’outil de mesure d’audience et ne charge aucune ressource depuis un autre serveur : pas de police distante, pas de traçage. Le serveur journalise les requêtes selon la pratique ordinaire de l’hébergeur.', 'Le site est hébergé sur GitHub Pages, service de GitHub, Inc. (États-Unis), qui journalise les adresses IP des requêtes pour le fonctionnement et la sécurité du service. Ce site ne comporte ni connexion ni champ de saisie : l’application elle-même se trouve sur app.ai-swisse.com.'] },
          { h: 'Quelles données l’application collecte', p: ['Données de compte : prénom, nom, adresse e-mail.', 'Données d’entreprise : raison sociale, canton, secteur, taille et les informations saisies dans le profil pour la recherche de subventions.', 'Documents : les fichiers chargés, le texte extrait et l’analyse produite.', 'Données techniques nécessaires au fonctionnement : journal des accès et des requêtes à l’IA, avec date, résultat et consommation.'] },
          { h: 'Où se trouvent les données', p: ['Comptes, documents et analyses sont hébergés chez Supabase, dans un projet situé à Francfort, en Allemagne (Union européenne). Pas en Suisse : pour certaines entreprises la différence compte, elle figure donc aussi en page d’accueil.', 'Les fichiers chargés résident dans un espace privé : accessibles uniquement aux utilisateurs de votre entreprise, par des liens à durée limitée.'] },
          { h: 'Le texte des documents est transmis à un fournisseur externe', p: [`Pour analyser un document, le texte extrait est transmis à ${AI_PROVIDER}, fournisseur du modèle de langage ${AI_MODEL}, qui traite la demande et renvoie le résultat. Sans cette transmission, l’analyse est impossible.`, 'C’est le texte qui est transmis, pas le fichier original. Si le document est un scan ou une photo, l’image est transmise pour la reconnaissance du texte.', 'Le fournisseur a son siège aux États-Unis : le texte transmis pour l’analyse quitte donc la Suisse et l’Espace économique européen. C’est la raison pour laquelle il existe aussi le mode local décrit ci-dessous.', 'Il existe aussi un mode de fonctionnement local, qui ne transmet rien à l’extérieur et exécute l’analyse dans votre navigateur : le résultat est plus limité et déclaré comme tel.'] },
          { h: 'Pourquoi nous traitons ces données', p: ['Pour fournir le service que vous avez demandé, c’est-à-dire exécuter le contrat.', 'Pour la sécurité du service et le respect des obligations légales.', 'Nous n’utilisons pas vos documents pour entraîner des modèles et ne les cédons pas à des tiers à des fins commerciales.'] },
          { h: 'Pendant combien de temps', p: ['Documents et analyses restent jusqu’à ce que vous les supprimiez : dans les archives, chaque document dispose d’une commande de suppression qui retire le fichier, le texte extrait et l’analyse liée.', 'Il n’existe pas aujourd’hui de suppression automatique après un certain délai : les analyses s’accumulent tant que vous n’intervenez pas. Nous le disons parce que c’est ainsi, non parce que ce serait l’état définitif.', 'Les données de compte subsistent tant que le compte existe. Après résiliation, elles sont supprimées sur demande écrite à l’adresse indiquée ci-dessus.'] },
          { h: 'Vos droits', p: ['Vous pouvez demander l’accès à vos données, leur rectification, leur effacement, la limitation du traitement et leur remise dans un format lisible par machine.', `Il suffit d’écrire à ${CONTACT_EMAIL}.`, 'Si vous estimez que le traitement viole la loi, vous pouvez vous adresser à l’autorité compétente : en Suisse le Préposé fédéral à la protection des données et à la transparence (PFPDT), dans l’Union européenne l’autorité de votre pays.'] },
          { h: 'Modifications', p: ['Si cette politique change de manière substantielle, nous vous en informons par e-mail avant que la modification prenne effet.'] },
        ],
      },
      terms: {
        title: 'Conditions d’utilisation',
        intro: 'Les règles entre celles et ceux qui utilisent AI-Swisse et celui qui l’exploite.',
        sections: [
          { h: 'Objet', p: ['AI-Swisse est un service par abonnement qui analyse des documents administratifs et signale les programmes de subvention pertinents. Le service s’adresse aux entreprises et aux professionnels, non aux consommateurs privés.'] },
          { h: 'Ce que le service N’EST PAS', p: ['Ni conseil juridique, fiscal, comptable ou fiduciaire, ni un substitut à celui-ci.', 'Les analyses sont produites automatiquement et peuvent contenir des erreurs. Chaque information doit être vérifiée sur le document original, qui reste consultable à côté de l’analyse.', 'Les décisions prises sur la base des analyses restent les vôtres et relèvent de votre responsabilité.'] },
          { h: 'Compte et usage correct', p: ['Vous êtes responsable de vos identifiants et de ce qui est fait avec votre compte.', 'Ne chargez que des documents que vous avez le droit de traiter. Pas de données de tiers sans titre.', 'L’usage à des fins illicites et le contournement des limites techniques ne sont pas autorisés.'] },
          { h: 'Disponibilité', p: ['Nous nous efforçons de maintenir le service disponible, sans garantir un fonctionnement ininterrompu. Maintenances et pannes de fournisseurs peuvent provoquer des interruptions. Aucun niveau de service n’est garanti contractuellement.'] },
          { h: 'Tarifs et paiement', p: ['Dans la phase actuelle, les conditions économiques sont convenues individuellement avec chaque entreprise pilote et figurent dans l’accord que vous recevez avant l’activation.'] },
          { h: 'Responsabilité', p: ['Les dispositions du droit suisse s’appliquent.', 'Les analyses sont produites automatiquement et peuvent contenir des erreurs : chaque information doit être vérifiée sur le document original, qui reste consultable à côté de l’analyse, avant toute décision.'] },
          { h: 'Droit applicable', p: ['Le droit suisse s’applique.'] },
        ],
      },
    },
  },
};
