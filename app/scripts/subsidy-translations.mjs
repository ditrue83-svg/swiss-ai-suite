// ============================================================================
// Traduzioni dei CONTENUTI del catalogo incentivi (de, fr).
// L'italiano resta nelle colonne base di `subsidy_programs`; qui c'è ciò che
// cambia lingua. Il seed le scrive nella colonna `translations` (0012).
//
// Criteri seguiti, perché tradurre un catalogo normativo non è tradurre parole:
//
//  · Le DENOMINAZIONI UFFICIALI si usano, non si traducono: "Il Programma
//    Edifici" è "Das Gebäudeprogramm" e "Le Programme Bâtiments", non una resa
//    letterale. ProKilowatt, Innosuisse e Pronovo restano invariati.
//  · Le SIGLE delle leggi ticinesi (LInn, FER, L-Rilocc) restano quelle
//    originali: sono il nome con cui l'ente le riconosce. Si traduce ciò che
//    le descrive, non il loro identificativo.
//  · La TERMINOLOGIA è quella amministrativa svizzera, non quella di Germania o
//    Francia: "Gesuch" e non "Antrag", "à fonds perdu" e non "subvention",
//    "AHV/IV/EO/ALV" e non "Sozialversicherung" generico.
//  · Gli IMPORTI, le percentuali e le date restano identici: non si toccano
//    numeri in una traduzione.
//
// ⚠️ Redatte internamente e NON riviste da un madrelingua. Come per
// l'interfaccia, una rilettura professionale va fatta prima di rivolgersi a
// clienti germanofoni o romandi: qui si parla di requisiti che decidono se una
// PMI ha diritto a un contributo.
// ============================================================================

export const TRANSLATIONS = {
  // --------------------------------------------------------------------------
  innosuisse: {
    de: {
      name: 'Innosuisse — Innovationsprojekte mit Umsetzungspartner',
      authority: 'Innosuisse (Schweizerische Agentur für Innovationsförderung)',
      contribution_description: 'Innosuisse finanziert die Kosten des Forschungspartners; das Unternehmen (Umsetzungspartner) trägt 40–60 % der gesamten Projektkosten, davon mindestens 5 % in bar.',
      application_window: 'Eingaben nach den Quartalsterminen des Innovation Council (mindestens 6 Wochen vor der Sitzung).',
      must_apply_before_start_text: 'Die Fördervereinbarung muss VOR dem Start abgeschlossen werden; das Projekt muss innert 3 Monaten nach Inkrafttreten der Vereinbarung beginnen.',
      source_title: 'Innosuisse — Innovation Projects with Implementation Partner',
      documents_required: ['Projektbeschrieb und Checkliste', 'Nachweise der Vorarbeiten (Recherche, Markt- und Konkurrenzanalyse)', 'Vereinbarung mit dem Forschungspartner', 'Erklärung zu den Rechten am geistigen Eigentum'],
      requirements: {
        partner: { text: 'Zusammenarbeit mit einem unabhängigen Schweizer Forschungspartner (Universität, Fachhochschule, ETH, Institut)', question: 'Sieht das Projekt eine Zusammenarbeit mit einer Schweizer Forschungsinstitution vor?' },
        vas: { text: 'Das Projekt schafft Wertschöpfung in der Schweiz', question: 'Schafft das Projekt Wertschöpfung in der Schweiz?' },
        innov: { text: 'Innovativer Gehalt mit Marktpotenzial', question: 'Entwickelt das Projekt ein für den Markt neues Produkt, eine neue Dienstleistung oder einen neuen Prozess?' },
        before: { text: 'Gesuch vor dem Projektstart bewilligt', question: 'Hat das Projekt NOCH NICHT begonnen?' },
        fin: { text: 'Das Unternehmen trägt 40–60 % der Gesamtkosten (davon ≥ 5 % in bar)', question: 'Kann das Unternehmen seinen Anteil (40–60 %) an den Projektkosten tragen?' },
      },
      exclusions: {
        routine: { text: 'Routinetätigkeiten ohne echten innovativen Gehalt', question: 'Handelt es sich um eine Routinetätigkeit ohne echten innovativen Gehalt?' },
      },
    },
    fr: {
      name: 'Innosuisse — Projets d’innovation avec partenaire chargé de la mise en œuvre',
      authority: 'Innosuisse (Agence suisse pour l’encouragement de l’innovation)',
      contribution_description: 'Innosuisse finance les coûts du partenaire de recherche ; l’entreprise (partenaire chargé de la mise en œuvre) couvre 40 à 60 % des coûts totaux du projet, dont au moins 5 % en espèces.',
      application_window: 'Dépôts selon les échéances trimestrielles de l’Innovation Council (au moins 6 semaines avant la séance).',
      must_apply_before_start_text: 'La convention de financement doit être conclue AVANT le début ; le projet doit démarrer dans les 3 mois suivant l’entrée en vigueur de la convention.',
      source_title: 'Innosuisse — Innovation Projects with Implementation Partner',
      documents_required: ['Description du projet et liste de contrôle', 'Preuves des travaux préalables (recherche, analyse du marché et de la concurrence)', 'Convention avec le partenaire de recherche', 'Déclaration relative aux droits de propriété intellectuelle'],
      requirements: {
        partner: { text: 'Collaboration avec un partenaire de recherche suisse indépendant (université, HES, EPF, institut)', question: 'Le projet prévoit-il une collaboration avec un institut de recherche suisse ?' },
        vas: { text: 'Le projet crée de la valeur ajoutée en Suisse', question: 'Le projet génère-t-il de la valeur ajoutée en Suisse ?' },
        innov: { text: 'Contenu innovant avec potentiel de marché', question: 'Le projet développe-t-il un produit, un service ou un procédé nouveau pour le marché ?' },
        before: { text: 'Demande approuvée avant le début du projet', question: 'Le projet n’a-t-il PAS encore commencé ?' },
        fin: { text: 'L’entreprise couvre 40 à 60 % des coûts totaux (dont ≥ 5 % en espèces)', question: 'L’entreprise peut-elle couvrir sa part (40–60 %) des coûts du projet ?' },
      },
      exclusions: {
        routine: { text: 'Activités de routine sans réel contenu innovant', question: 'S’agit-il d’une activité de routine sans réel contenu innovant ?' },
      },
    },
  },

  // --------------------------------------------------------------------------
  'programma-edifici': {
    de: {
      name: 'Das Gebäudeprogramm — energetische Sanierung',
      authority: 'Bund und Kantone',
      contribution_description: 'Beitrag pro m² gedämmter Fläche oder Pauschale pro Anlage. Die Beträge sind kantonal unterschiedlich (beim jeweils geltenden kantonalen Programm zu bestätigen).',
      application_window: 'Gesuch jederzeit möglich, immer vor Baubeginn. Ein GEAK Plus wird empfohlen.',
      must_apply_before_start_text: 'Das Gesuch muss VOR Baubeginn eingereicht und vom Kanton bewilligt werden, sonst entfällt der Beitrag.',
      source_title: 'Das Gebäudeprogramm — Förderbeiträge',
      documents_required: ['Kantonales Formular', 'Kostenvoranschläge der Arbeiten', 'GEAK / GEAK Plus (falls verlangt)', 'Grundbuchauszug'],
      requirements: {
        owner: { text: 'Liegenschaft in der Schweiz (im Eigentum oder im Baurecht)', question: 'Ist das Unternehmen Eigentümerin der zu sanierenden Liegenschaft (oder hat es ein Baurecht daran)?' },
        before: { text: 'Gesuch VOR Baubeginn beim Kanton eingereicht', question: 'Haben die Arbeiten NOCH NICHT begonnen?' },
        measure: { text: 'Förderfähige Massnahme: Wärmedämmung der Gebäudehülle oder Ersatz der fossilen Heizung durch erneuerbare Energien', question: 'Betrifft die Massnahme die Dämmung der Gebäudehülle oder den Ersatz einer fossilen Heizung?' },
      },
      exclusions: {
        newbuild: { text: 'Neubauten (gefördert werden nur Sanierungen)', question: 'Handelt es sich um einen Neubau (und nicht um eine Sanierung)?' },
      },
    },
    fr: {
      name: 'Le Programme Bâtiments — assainissement énergétique',
      authority: 'Confédération et cantons',
      contribution_description: 'Contribution par m² de surface isolée ou forfait par installation. Les montants varient selon le canton (à confirmer auprès du programme cantonal en vigueur).',
      application_window: 'Demande possible en tout temps, toujours avant le début des travaux. Un CECB Plus est recommandé.',
      must_apply_before_start_text: 'La demande doit être déposée et approuvée par le canton AVANT le début des travaux, faute de quoi la contribution est perdue.',
      source_title: 'Le Programme Bâtiments — contributions',
      documents_required: ['Formulaire cantonal', 'Devis des travaux', 'CECB / CECB Plus (si exigé)', 'Extrait du registre foncier'],
      requirements: {
        owner: { text: 'Bien immobilier en Suisse (en propriété ou en droit de superficie)', question: 'L’entreprise est-elle propriétaire du bien à assainir (ou en détient-elle le droit de superficie) ?' },
        before: { text: 'Demande déposée au canton AVANT le début des travaux', question: 'Les travaux n’ont-ils PAS encore commencé ?' },
        measure: { text: 'Mesure éligible : isolation thermique de l’enveloppe ou remplacement du chauffage fossile par des énergies renouvelables', question: 'La mesure concerne-t-elle l’isolation de l’enveloppe ou le remplacement d’un chauffage fossile ?' },
      },
      exclusions: {
        newbuild: { text: 'Bâtiments neufs (seuls les assainissements sont soutenus)', question: 'S’agit-il d’un bâtiment neuf (et non d’un assainissement) ?' },
      },
    },
  },

  // --------------------------------------------------------------------------
  prokilowatt: {
    de: {
      name: 'ProKilowatt — Stromeffizienz in Unternehmen',
      authority: 'Bund (Bundesamt für Energie BFE)',
      contribution_description: 'Beitrag von bis zu 30 % der Investitionskosten für nicht rentable Stromeffizienzmassnahmen, über periodische Ausschreibungen.',
      application_window: 'Periodische wettbewerbliche Ausschreibungen während des Jahres; Eingabe bei der laufenden Ausschreibung.',
      must_apply_before_start_text: 'Die Kaufverpflichtung darf erst NACH der Zusage des Beitrags eingegangen werden.',
      source_title: 'ProKilowatt (BFE) — Förderprogramm',
      documents_required: ['Beschrieb der Massnahmen', 'Berechnung der Stromeinsparung', 'Kostenvoranschläge'],
      requirements: {
        save: { text: 'Massnahmen, die den Stromverbrauch messbar senken (LED, Motoren, Kälte, Lüftung …)', question: 'Senkt das Projekt den Stromverbrauch messbar?' },
        before: { text: 'Kaufverpflichtung erst NACH der Zusage des Beitrags', question: 'Wurde die Investition NOCH NICHT bestellt oder bezahlt?' },
        notprofitable: { text: 'Massnahme ohne den Beitrag nicht rentabel', question: 'Wäre die Massnahme ohne den Beitrag wirtschaftlich nicht tragbar?' },
      },
      exclusions: {
        mandatory: { text: 'Gesetzlich bereits vorgeschriebene Massnahmen', question: 'Sind die vorgesehenen Massnahmen gesetzlich bereits vorgeschrieben?' },
      },
    },
    fr: {
      name: 'ProKilowatt — efficacité électrique dans les entreprises',
      authority: 'Confédération (Office fédéral de l’énergie OFEN)',
      contribution_description: 'Contribution jusqu’à 30 % des coûts d’investissement pour des mesures d’efficacité électrique non rentables, via des appels d’offres périodiques.',
      application_window: 'Appels d’offres concurrentiels périodiques durant l’année ; dépôt auprès de l’appel en cours.',
      must_apply_before_start_text: 'L’engagement d’achat ne doit intervenir qu’APRÈS la confirmation de la contribution.',
      source_title: 'ProKilowatt (OFEN) — programme d’encouragement',
      documents_required: ['Description des mesures', 'Calcul des économies d’électricité', 'Devis'],
      requirements: {
        save: { text: 'Mesures réduisant de manière mesurable la consommation d’électricité (LED, moteurs, froid, ventilation …)', question: 'Le projet réduit-il la consommation d’électricité de manière mesurable ?' },
        before: { text: 'Engagement d’achat seulement APRÈS la confirmation de la contribution', question: 'L’investissement n’a-t-il PAS encore été commandé ni payé ?' },
        notprofitable: { text: 'Mesure non rentable sans la contribution', question: 'La mesure serait-elle économiquement intenable sans la contribution ?' },
      },
      exclusions: {
        mandatory: { text: 'Mesures déjà obligatoires de par la loi', question: 'Les mesures prévues sont-elles déjà obligatoires de par la loi ?' },
      },
    },
  },

  // --------------------------------------------------------------------------
  pronovo: {
    de: {
      name: 'Pronovo — Einmalvergütung für Photovoltaikanlagen',
      authority: 'Bund (Pronovo AG)',
      contribution_description: 'Einmalvergütung, die einen Teil der Investitionskosten einer neuen, ans Netz angeschlossenen Photovoltaikanlage deckt.',
      application_window: 'Gesuch nach der Inbetriebnahme, gemäss dem Verfahren von Pronovo (kein vorgängiges Gesuch erforderlich).',
      source_title: 'Pronovo — Einmalvergütung (EIV)',
      documents_required: ['Anlagedaten und Inbetriebnahmeprotokoll', 'Schlussrechnung', 'Netzanschlussbestätigung'],
      requirements: {
        pv: { text: 'Neue, ans Netz angeschlossene Photovoltaikanlage in der Schweiz', question: 'Handelt es sich um eine neue, ans Netz angeschlossene Photovoltaikanlage?' },
        procedure: { text: 'Meldung und Gesuch nach dem Verfahren von Pronovo nach der Inbetriebnahme', question: 'Wird die Anlage gemäss dem Verfahren von Pronovo in Betrieb genommen und gemeldet?' },
      },
      exclusions: {},
    },
    fr: {
      name: 'Pronovo — rétribution unique pour installations photovoltaïques',
      authority: 'Confédération (Pronovo AG)',
      contribution_description: 'Rétribution unique couvrant une partie des coûts d’investissement d’une nouvelle installation photovoltaïque raccordée au réseau.',
      application_window: 'Demande après la mise en service, selon la procédure Pronovo (aucune demande préalable obligatoire).',
      source_title: 'Pronovo — rétribution unique (RU)',
      documents_required: ['Données de l’installation et procès-verbal de mise en service', 'Facture finale', 'Confirmation du raccordement au réseau'],
      requirements: {
        pv: { text: 'Nouvelle installation photovoltaïque raccordée au réseau en Suisse', question: 'S’agit-il d’une nouvelle installation photovoltaïque raccordée au réseau ?' },
        procedure: { text: 'Annonce et demande selon la procédure Pronovo après la mise en service', question: 'L’installation est-elle (ou sera-t-elle) mise en service et annoncée selon la procédure Pronovo ?' },
      },
      exclusions: {},
    },
  },

  // --------------------------------------------------------------------------
  // Programmi cantonali ticinesi. Le sigle restano quelle ufficiali: sono il
  // nome con cui il Cantone le riconosce, e un'impresa che scrive all'ufficio
  // deve poterle citare così.
  'ti-linn': {
    de: {
      name: 'Tessin — Gesetz zur Förderung der wirtschaftlichen Innovation (LInn)',
      authority: 'Kanton Tessin (Amt für Wirtschaftsentwicklung, DFE)',
      contribution_description: 'À-fonds-perdu-Beitrag an die anrechenbare Investition; Umfang und Ansätze richten sich nach den geltenden Ausführungsdekreten des Staatsrats. Geförderte Bereiche: Start-up-Coaching, Aufträge an Forschungszentren, Innosuisse-Projekte, internationale Forschungsprogramme, immaterielle Investitionen (F&E, Innovationsberatung), materielle Investitionen (innovative Maschinen, Digitalisierung), Steuererleichterungen, Internationalisierung und Messen.',
      application_window: 'Gesuch jederzeit möglich, vor Beginn des Projekts bzw. der Investition.',
      must_apply_before_start_text: 'Das Gesuch ist VOR Bestellungen, Verträgen, Baubeginn oder anderen verpflichtenden Handlungen einzureichen.',
      source_title: 'Tessin — LInn (RL 900.100), Ausführungsdekrete zu Lohn- und Wohnsitzkriterien (letzte Änderung 6. Februar 2026, BU 25/2026)',
      documents_required: ['Businessplan / Projektbeschrieb', 'Letzte zwei Jahresrechnungen', 'Kostenvoranschläge', 'Handelsregisterauszug', 'Logib-Analyse zur Lohngleichheit', 'ETP-Berechnung für die Lohn- und Wohnsitzkriterien'],
      requirements: {
        sede: { text: 'Sitz oder wirtschaftliche Tätigkeit im Tessin', question: 'Hat das Unternehmen Sitz oder wirtschaftliche Tätigkeit im Tessin?' },
        fte: { text: 'Mindestens 5 VZÄ (ordentliches Verfahren) oder 3 VZÄ (vereinfachtes Verfahren: Forschungsaufträge, Innosuisse-Projekte, Internationalisierung, Messen, Start-up-Coaching). Schwellen in Kraft seit 1. Januar 2024', question: 'Hat das Unternehmen mindestens 3–5 Vollzeitäquivalente (VZÄ) gemäss dem jeweiligen Verfahren?' },
        salary: { text: 'Mindestens 60 % der Mitarbeitenden in VZÄ (ohne Lernende) mit einem Basisstundenlohn von mindestens CHF 32.00. Reduzierte Schwelle von CHF 24.00 für Betriebe des Primärsektors und für dem Arbeitsgesetz unterstellte Industriebetriebe; für Landwirtschaftsbetriebe gilt der Mindestlohn nach kantonalem Mindestlohngesetz', question: 'Erhalten mindestens 60 % der Mitarbeitenden den für ihre Branche geltenden Mindest-Basisstundenlohn (CHF 32.00 bzw. CHF 24.00 für Primärsektor und Industrie)?' },
        residenti: { text: 'Mindestens 60 % des Personals in VZÄ (Lernende eingeschlossen) mit Wohnsitz in der Schweiz. Quellenbesteuerte Mitarbeitende ohne Wohnsitz in der Schweiz per 31. Dezember gelten für das ganze Jahr als nicht ansässig', question: 'Haben mindestens 60 % des Personals (Lernende eingeschlossen) Wohnsitz in der Schweiz?' },
        parita: { text: 'Lohngleichheit geprüft mit dem Instrument Logib des Bundes (Modul 1 ab 50 Mitarbeitenden, Modul 2 darunter)', question: 'Hält das Unternehmen die Lohngleichheit nach rechtskonformen Methoden ein (Logib)?' },
        innov: { text: 'Projekt zur Produkt- oder Prozessinnovation oder zur Internationalisierung', question: 'Führt das Projekt eine Produkt- oder Prozessinnovation oder eine Internationalisierung ein?' },
        before: { text: 'Gesuch vor Ausführung bzw. Beschluss der Investitionen', question: 'Wurde das Projekt bzw. die Investition NOCH NICHT begonnen oder beschlossen?' },
        impegno: { text: 'Mehrjährige Verpflichtung: Die Lohn- und Wohnsitzkriterien sind während 5 Jahren ab dem Entscheid einzuhalten (2 Jahre beim vereinfachten Verfahren), mit jährlicher Selbstdeklaration an das UAC. Bei Nichteinhaltung werden die Beiträge widerrufen und vollständig zurückgefordert', question: 'Kann das Unternehmen die Einhaltung der Kriterien für die folgenden 5 Jahre (2 Jahre beim vereinfachten Verfahren) gewährleisten?' },
      },
      exclusions: {
        'pure-commercial': { text: 'Rein kommerzielle Tätigkeiten ohne innovativen Anteil', question: 'Handelt es sich um eine rein kommerzielle Tätigkeit ohne innovativen Anteil?' },
      },
    },
    fr: {
      name: 'Tessin — Loi sur l’innovation économique (LInn)',
      authority: 'Canton du Tessin (Office du développement économique, DFE)',
      contribution_description: 'Contribution à fonds perdu sur l’investissement éligible ; l’ampleur et les taux sont fixés par les décrets d’exécution du Conseil d’État en vigueur. Domaines soutenus : coaching de start-up, mandats à des centres de recherche, projets Innosuisse, programmes de recherche internationaux, investissements immatériels (R&D, conseil en innovation), investissements matériels (machines innovantes, numérisation), allégements fiscaux, internationalisation et foires.',
      application_window: 'Demande possible en tout temps, avant le début du projet ou de l’investissement.',
      must_apply_before_start_text: 'La demande doit être déposée AVANT toute commande, contrat, début des travaux ou autre acte créant des obligations.',
      source_title: 'Tessin — LInn (RL 900.100), décrets d’exécution sur les critères salariaux et de résidence (dernière modification du 6 février 2026, BU 25/2026)',
      documents_required: ['Business plan / description du projet', 'Deux derniers comptes annuels', 'Devis', 'Extrait du registre du commerce', 'Analyse Logib sur l’égalité salariale', 'Calcul des EPT pour les critères de salaire et de résidence'],
      requirements: {
        sede: { text: 'Siège ou activité économique au Tessin', question: 'L’entreprise a-t-elle son siège ou une activité économique au Tessin ?' },
        fte: { text: 'Au moins 5 EPT (procédure ordinaire) ou 3 EPT (procédure simplifiée : mandats de recherche, projets Innosuisse, internationalisation, foires, coaching de start-up). Seuils en vigueur depuis le 1er janvier 2024', question: 'L’entreprise compte-t-elle au moins 3 à 5 équivalents plein temps (EPT) selon la procédure ?' },
        salary: { text: 'Au moins 60 % du personnel en EPT (apprentis exclus) avec un salaire horaire de base d’au moins CHF 32.00. Seuil réduit à CHF 24.00 pour les entreprises du secteur primaire et les entreprises industrielles soumises à la loi sur le travail ; pour les exploitations agricoles s’applique le minimum de la loi cantonale sur le salaire minimum', question: 'Au moins 60 % du personnel perçoit-il le salaire horaire de base minimum applicable à son secteur (CHF 32.00, ou CHF 24.00 pour le primaire et l’industrie) ?' },
        residenti: { text: 'Au moins 60 % du personnel en EPT (apprentis inclus) domicilié en Suisse. Les personnes imposées à la source non domiciliées en Suisse au 31 décembre comptent comme non-résidentes pour toute l’année', question: 'Au moins 60 % du personnel (apprentis inclus) est-il domicilié en Suisse ?' },
        parita: { text: 'Égalité salariale vérifiée avec l’outil Logib de la Confédération (module 1 dès 50 personnes, module 2 en dessous)', question: 'L’entreprise respecte-t-elle l’égalité salariale selon des méthodes conformes au droit (Logib) ?' },
        innov: { text: 'Projet d’innovation de produit ou de procédé, ou d’internationalisation', question: 'Le projet introduit-il une innovation de produit ou de procédé, ou une internationalisation ?' },
        before: { text: 'Demande avant l’exécution ou la décision d’investissement', question: 'Le projet ou l’investissement n’a-t-il PAS encore été engagé ni décidé ?' },
        impegno: { text: 'Engagement pluriannuel : les critères salariaux et de résidence doivent être respectés pendant 5 ans dès la décision (2 ans en procédure simplifiée), avec autodéclaration annuelle à l’UAC. Le non-respect entraîne la révocation et la restitution intégrale des contributions', question: 'L’entreprise peut-elle garantir le respect des critères durant les 5 années suivantes (2 ans en procédure simplifiée) ?' },
      },
      exclusions: {
        'pure-commercial': { text: 'Activités purement commerciales sans composante innovante', question: 'S’agit-il d’une activité purement commerciale, sans composante innovante ?' },
      },
    },
  },

  // --------------------------------------------------------------------------
  'ti-fer': {
    de: {
      name: 'Tessin — Fonds für erneuerbare Energien (FER)',
      authority: 'Kanton Tessin',
      contribution_description: 'Einmaliger Investitionsbeitrag (CU-FER) nach dem FER-Reglement (RL 741.260) und den geltenden Dekreten. Seit dem 1. Januar 2026 sieht das RFER zudem eine Mindestvergütung für den ins Netz eingespeisten Strom geförderter Photovoltaikanlagen vor (4.0 Rp./kWh unter 30 kW; 5.0 Rp./kWh zwischen 30 und 150 kW ohne Eigenverbrauch; zwischen 30 und 150 kW mit Eigenverbrauch richtet sich der Wert nach dem vierteljährlichen Marktmittelpreis) sowie die Möglichkeit, einer lokalen Elektrizitätsgemeinschaft (LEG) beizutreten. Die Beitragshöhe hängt von Leistung und Technologie ab: das geltende Dekret prüfen.',
      application_window: 'Photovoltaik ab 1. Januar 2024: keine Voranmeldung, Gesuch nach der Inbetriebnahme. Andere Technologien: Voranmeldung vor Baubeginn obligatorisch.',
      must_apply_before_start_text: 'Je nach Technologie unterschiedlich: für Photovoltaik ist seit 2024 keine Voranmeldung mehr nötig; für Wasserkraft, Wind, Geothermie und Biomasse bleibt sie vor Baubeginn obligatorisch.',
      source_title: 'Tessin — Fonds für erneuerbare Energien (FER), Reglement RFER RL 741.260, Änderungen in Kraft seit 1. Januar 2026',
      documents_required: ['FER-Formular (Online-Schalter)', 'Schlussrechnung und technische Anlagedokumentation', 'Voranmeldung, wo erforderlich'],
      requirements: {
        territory: { text: 'Anlage im Tessin realisiert', question: 'Wird die Anlage im Tessin realisiert?' },
        eligible: { text: 'Stromproduktion aus erneuerbarer Quelle: Photovoltaik (hauptsächlich), Wasserkraft, Wind, Geothermie, Biomasse. Der FER unterstützt zudem Studien, Beratungen und Forschungsprojekte zur Energieeffizienz', question: 'Erzeugt die Massnahme Strom aus erneuerbarer Quelle (oder handelt es sich um eine Studie bzw. Beratung im Energiebereich)?' },
        notifica: { text: 'Für andere Technologien als Photovoltaik (Wasserkraft, Wind, Geothermie, Biomasse) bleibt die Voranmeldung VOR Baubeginn obligatorisch. Für Photovoltaikanlagen, die ab dem 1. Januar 2024 in Betrieb genommen wurden, entfällt sie', question: 'Falls die Anlage NICHT photovoltaisch ist: wurde die Voranmeldung vor Baubeginn eingereicht?' },
      },
      exclusions: {
        calore: { text: 'Massnahmen im Wärmebereich (Wärmepumpen, Wärmedämmung, Heizungsersatz): sie fallen unter Das Gebäudeprogramm, nicht unter den FER', question: 'Betrifft die Massnahme die Heizung oder die Dämmung des Gebäudes statt der Stromproduktion?' },
      },
    },
    fr: {
      name: 'Tessin — Fonds pour les énergies renouvelables (FER)',
      authority: 'Canton du Tessin',
      contribution_description: 'Contribution unique à l’investissement (CU-FER) selon le règlement FER (RL 741.260) et les décrets en vigueur. Depuis le 1er janvier 2026, le RFER prévoit en outre une rétribution minimale pour l’électricité injectée dans le réseau par les installations photovoltaïques soutenues (4.0 ct./kWh en dessous de 30 kW ; 5.0 ct./kWh entre 30 et 150 kW sans autoconsommation ; entre 30 et 150 kW avec autoconsommation, la valeur suit le prix moyen trimestriel du marché) ainsi que la possibilité d’adhérer à une communauté électrique locale (CEL). Les montants varient selon la puissance et la technologie : vérifier le décret en vigueur.',
      application_window: 'Photovoltaïque dès le 1er janvier 2024 : aucune annonce préalable, demande après la mise en service. Autres technologies : annonce préalable obligatoire avant le début des travaux.',
      must_apply_before_start_text: 'Cela dépend de la technologie : pour le photovoltaïque, l’annonce préalable n’est plus requise depuis 2024 ; pour l’hydraulique, l’éolien, la géothermie et la biomasse, elle reste obligatoire avant le début des travaux.',
      source_title: 'Tessin — Fonds pour les énergies renouvelables (FER), règlement RFER RL 741.260, modifications en vigueur depuis le 1er janvier 2026',
      documents_required: ['Formulaire FER (guichet en ligne)', 'Facture finale et documentation technique de l’installation', 'Annonce préalable, pour les technologies qui l’exigent'],
      requirements: {
        territory: { text: 'Installation réalisée au Tessin', question: 'L’installation est-elle réalisée au Tessin ?' },
        eligible: { text: 'Production d’électricité d’origine renouvelable : photovoltaïque (principalement), hydraulique, éolien, géothermie, biomasse. Le FER soutient également des études, des conseils et des projets de recherche en efficacité énergétique', question: 'La mesure produit-elle de l’électricité d’origine renouvelable (ou s’agit-il d’une étude ou d’un conseil dans le domaine énergétique) ?' },
        notifica: { text: 'Pour les technologies autres que le photovoltaïque (hydraulique, éolien, géothermie, biomasse), l’annonce préalable AVANT le début des travaux reste obligatoire. Pour les installations photovoltaïques mises en service dès le 1er janvier 2024, elle a été supprimée', question: 'Si l’installation n’est PAS photovoltaïque : l’annonce préalable a-t-elle été déposée avant le début des travaux ?' },
      },
      exclusions: {
        calore: { text: 'Interventions sur la chaleur (pompes à chaleur, isolation thermique, remplacement du chauffage) : elles relèvent du Programme Bâtiments, non du FER', question: 'La mesure concerne-t-elle le chauffage ou l’isolation du bâtiment plutôt que la production d’électricité ?' },
      },
    },
  },

  // --------------------------------------------------------------------------
  'ti-lrilocc': {
    de: {
      name: 'Tessin — Anreiz für die Anstellung von Arbeitslosen (L-Rilocc)',
      authority: 'Kanton Tessin (Sektion Arbeit / RAV)',
      contribution_description: 'Finanzhilfe in der Höhe von 100 % der Sozialabgaben zulasten des Arbeitgebers (AHV/IV/EO/ALV, obligatorische BVG), höchstens berechnet auf dem massgebenden Höchstverdienst nach AVIG, für die tatsächliche Dauer des Arbeitsverhältnisses und maximal 12 Monate. Ausbezahlt, sobald das Arbeitsverhältnis mindestens doppelt so lange gedauert hat wie die subventionierte Periode.',
      application_window: 'Vor Beginn des Arbeitsverhältnisses.',
      must_apply_before_start_text: 'Das Gesuch ist VOR der Anstellung einzureichen: bereits begonnene Arbeitsverhältnisse sind nicht förderfähig.',
      source_title: 'Tessin — Gesetz über die Wiederbelebung der Beschäftigung und die Unterstützung Arbeitsloser (L-Rilocc, RL 857.100), Art. 3',
      availability_note: 'Art. 3 L-Rilocc knüpft die Massnahme an eine durchschnittliche Arbeitslosenquote des Vorjahres, die mindestens dem vom Staatsrat festgelegten Referenzsatz entspricht, mit einer Obergrenze von 4 %. Die Tessiner Quote liegt darunter, weshalb der Anreiz nicht gewährt wird. Er wird wieder verfügbar, wenn die Arbeitslosigkeit steigt: eine Überprüfung zu Jahresbeginn lohnt sich.',
      documents_required: ['Gesuchsformular', 'Entwurf des Arbeitsvertrags', 'Profil der kandidierenden Person / RAV-Anmeldung'],
      requirements: {
        urc: { text: 'Anstellung einer arbeitslosen Person, die bei der öffentlichen Arbeitsvermittlung (RAV) angemeldet ist', question: 'Ist die anzustellende Person bei einem RAV (öffentliche Arbeitsvermittlung) angemeldet?' },
        nolayoff: { text: 'Keine Entlassungen oder Stellenstreichungen aus wirtschaftlichen Gründen in den vorangegangenen 12 Monaten; Einhaltung der GAV', question: 'Hat das Unternehmen in den letzten 12 Monaten keine wirtschaftlich bedingten Entlassungen vorgenommen und hält es die GAV/NAV ein?' },
        durata: { text: 'Das Arbeitsverhältnis muss mindestens doppelt so lange dauern wie die subventionierte Periode: erst dann wird die Hilfe ausbezahlt', question: 'Ist das Arbeitsverhältnis für mindestens die doppelte Dauer der subventionierten Periode vorgesehen?' },
      },
      exclusions: {
        replace: { text: 'Ersatz von entlassenem Personal zur Schaffung der subventionierten Stelle', question: 'Ersetzt die Stelle kürzlich entlassenes Personal?' },
        'lavoro-ridotto': { text: 'Unternehmen in Kurzarbeit', question: 'Befindet sich das Unternehmen derzeit in Kurzarbeit?' },
      },
    },
    fr: {
      name: 'Tessin — incitation à l’engagement de personnes au chômage (L-Rilocc)',
      authority: 'Canton du Tessin (Section du travail / ORP)',
      contribution_description: 'Aide financière correspondant à 100 % des charges sociales à la charge de l’employeur (AVS/AI/APG/AC, LPP obligatoire), calculée au maximum sur le gain assuré maximal selon la LACI, pour la durée effective du rapport de travail et au maximum 12 mois. Versée une fois que le rapport de travail a duré au moins le double de la période subventionnée.',
      application_window: 'Avant le début du rapport de travail.',
      must_apply_before_start_text: 'La demande doit être déposée AVANT l’engagement : les contrats déjà commencés ne sont pas subventionnables.',
      source_title: 'Tessin — loi sur la relance de l’emploi et le soutien aux chômeurs (L-Rilocc, RL 857.100), art. 3',
      availability_note: 'L’art. 3 L-Rilocc subordonne la mesure à un taux de chômage moyen de l’année civile précédente au moins égal au taux de référence fixé par le Conseil d’État, plafonné à 4 %. Le taux tessinois est inférieur à ce seuil, de sorte que l’incitation n’est pas octroyée. Elle redeviendra disponible si le chômage remonte : une nouvelle vérification en début d’année est indiquée.',
      documents_required: ['Formulaire de demande', 'Projet de contrat de travail', 'Profil de la personne candidate / inscription ORP'],
      requirements: {
        urc: { text: 'Engagement d’une personne au chômage inscrite auprès du service public de l’emploi (ORP)', question: 'La personne à engager est-elle inscrite auprès d’un ORP (service public de l’emploi) ?' },
        nolayoff: { text: 'Aucun licenciement ni suppression de postes pour motifs économiques durant les 12 mois précédents ; respect des CCT', question: 'L’entreprise n’a-t-elle pas procédé à des licenciements économiques ces 12 derniers mois et respecte-t-elle les CCT/CTT ?' },
        durata: { text: 'Le rapport de travail doit durer au moins le double de la période subventionnée : l’aide n’est versée qu’à ce moment-là', question: 'Le rapport de travail est-il prévu pour une durée d’au moins le double de la période subventionnée ?' },
      },
      exclusions: {
        replace: { text: 'Remplacement de personnel licencié pour créer le poste subventionné', question: 'Le poste remplace-t-il du personnel licencié récemment ?' },
        'lavoro-ridotto': { text: 'Entreprises en période de réduction de l’horaire de travail', question: 'L’entreprise est-elle actuellement en réduction de l’horaire de travail ?' },
      },
    },
  },
};
