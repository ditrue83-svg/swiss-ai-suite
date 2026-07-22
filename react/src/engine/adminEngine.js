// Swiss Admin AI — motore di analisi documenti amministrativi.
// Analisi deterministica (lingua, ente, scadenze, classificazione, checklist,
// bozza di risposta). Il punto di integrazione per un LLM è analyzeDocument():
// mantiene la stessa firma input/output.

const MONTHS = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
  januar: 1, februar: 2, 'märz': 3, maerz: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
  janvier: 1, 'février': 2, fevrier: 2, mars: 3, avril: 4, juin: 6,
  juillet: 7, 'août': 8, aout: 8, septembre: 9, octobre: 10, novembre: 11,
  'décembre': 12, decembre: 12,
}

const LANG_HINTS = {
  de: ['der', 'die', 'das', 'und', 'für', 'wir', 'sie', 'nicht', 'bitte', 'sehr geehrte', 'mit freundlichen', 'ihre', 'bis', 'frist', 'unterlagen', 'gemäss'],
  fr: ['le', 'la', 'les', 'nous', 'vous', 'madame', 'monsieur', 'veuillez', 'délai', 'salutations', 'votre', 'dans', 'concernant', 'agréer'],
  it: ['il', 'la', 'gli', 'che', 'per', 'gentile', 'spettabile', 'siamo', 'entro', 'cordiali', 'vostra', 'documenti', 'termine', 'distinti'],
}

const LANG_LABEL = { de: 'Tedesco', fr: 'Francese', it: 'Italiano' }

const ENTITIES = [
  { keys: ['ausgleichskasse', 'cassa di compensazione', 'caisse de compensation', 'avs', 'ahv', ' ai ', 'assegni familiari'], ente: 'Cassa di compensazione AVS/AI', categoria: 'Assicurazioni sociali' },
  { keys: ['mehrwertsteuer', 'mwst', 'estv', 'afc', 'imposta sul valore aggiunto', 'tva', 'amministrazione federale delle contribuzioni', 'eidgenössische steuerverwaltung'], ente: 'Amministrazione federale delle contribuzioni (AFC) — IVA', categoria: 'Fisco federale' },
  { keys: ['suva', 'infortuni', 'unfallversicherung', 'assurance-accidents', 'laa', 'uvg'], ente: 'SUVA / Assicurazione infortuni', categoria: 'Assicurazioni' },
  { keys: ['divisione delle contribuzioni', 'steuerverwaltung', 'administration fiscale', 'imposta alla fonte', 'quellensteuer', 'ufficio circondariale di tassazione', 'dichiarazione fiscale', 'imposta cantonale'], ente: 'Autorità fiscale cantonale', categoria: 'Fisco cantonale' },
  { keys: ['betreibungsamt', 'ufficio esecuzione', 'office des poursuites', 'precetto esecutivo', 'zahlungsbefehl'], ente: 'Ufficio esecuzione e fallimenti', categoria: 'Esecuzioni' },
  { keys: ['comune di', 'gemeinde', 'municipio', 'commune de', 'cancelleria comunale', 'stadtverwaltung'], ente: 'Amministrazione comunale', categoria: 'Comune' },
  { keys: ['cassa pensioni', 'pensionskasse', 'caisse de pension', 'lpp', 'bvg', 'previdenza professionale'], ente: 'Cassa pensioni (LPP)', categoria: 'Previdenza' },
  { keys: ['cassa malati', 'krankenkasse', 'assicurazione malattia', 'perdita di guadagno', 'indennità giornaliera'], ente: 'Assicurazione malattia / perdita di guadagno', categoria: 'Assicurazioni' },
  { keys: ['ufficio del lavoro', 'arbeitsamt', 'seco', 'permesso di lavoro', 'arbeitsbewilligung', 'ufficio della migrazione', 'lavoro ridotto'], ente: 'Autorità del lavoro / migrazione', categoria: 'Lavoro' },
  { keys: ['registro di commercio', 'handelsregister', 'registre du commerce'], ente: 'Registro di commercio', categoria: 'Registro di commercio' },
  { keys: ['versicherung', 'assicurazione', 'assurance', 'polizza', 'police'], ente: 'Compagnia assicurativa', categoria: 'Assicurazioni' },
]

const DOC_TYPES = [
  {
    tipo: 'sollecito',
    label: 'Sollecito di pagamento',
    keys: ['mahnung', 'sollecito', 'rappel', 'diffida', 'zahlungserinnerung', 'mancato pagamento'],
  },
  {
    tipo: 'richiesta_documenti',
    label: 'Richiesta di documenti / informazioni',
    keys: ['einreichen', 'nachreichen', 'inviarci', 'trasmetterci', 'unterlagen', 'documenti seguenti', 'fornire i seguenti', 'veuillez nous faire parvenir', 'documents suivants', 'benötigen wir', 'vi invitiamo a presentare'],
  },
  {
    tipo: 'pagamento',
    label: 'Fattura / richiesta di pagamento',
    keys: ['rechnung', 'fattura', 'facture', 'zahlung', 'pagamento', 'versamento', 'importo dovuto', 'betrag', 'montant', 'conguaglio', 'acconti'],
  },
  {
    tipo: 'dichiarazione',
    label: 'Dichiarazione / conteggio da presentare',
    keys: ['deklaration', 'dichiarazione', 'déclaration', 'abrechnung', 'conteggio', 'décompte', 'rendiconto', 'formulario allegato'],
  },
  {
    tipo: 'controllo',
    label: 'Controllo / revisione',
    keys: ['kontrolle', 'controllo', 'contrôle', 'revision', 'revisione', 'verifica contabile', 'ispezione', 'audit'],
  },
  {
    tipo: 'decisione',
    label: 'Decisione / notifica ufficiale',
    keys: ['verfügung', 'decisione', 'décision', 'notifica', 'entscheid', 'reclamo', 'einsprache', 'opposizione', 'ricorso'],
  },
]

const DEADLINE_KEYWORDS = [
  'entro', 'scadenza', 'termine', 'al più tardi',
  'bis zum', 'bis am', 'bis spätestens', 'spätestens', 'frist', 'innert', 'innerhalb',
  'délai', 'au plus tard', 'avant le', "jusqu'au", 'dans les',
]

const REQUESTED_DOCS = [
  { keys: ['lohnausweis', 'certificato di salario', 'certificat de salaire'], label: 'Certificati di salario dei dipendenti' },
  { keys: ['jahresrechnung', 'bilancio', 'bilan', 'chiusura annuale', 'conti annuali'], label: 'Bilancio / conti annuali' },
  { keys: ['erfolgsrechnung', 'conto economico', 'compte de résultat'], label: 'Conto economico' },
  { keys: ['lohnliste', 'lista dei salari', 'liste des salaires', 'lohndeklaration', 'dichiarazione dei salari', 'massa salariale', 'lohnsumme'], label: 'Dichiarazione delle masse salariali' },
  { keys: ['belege', 'giustificativi', 'justificatifs', 'ricevute', 'pezze giustificative'], label: 'Giustificativi / ricevute' },
  { keys: ['vertrag', 'contratto', 'contrat'], label: 'Copia del contratto' },
  { keys: ['polizza', 'police', 'versicherungspolice'], label: 'Polizza assicurativa' },
  { keys: ['iban', 'coordinate bancarie', 'bankverbindung'], label: 'Coordinate bancarie (IBAN)' },
  { keys: ['formular', 'formulario', 'formulaire', 'modulo'], label: 'Formulario compilato e firmato' },
  { keys: ['estratto del registro di commercio', 'handelsregisterauszug', 'extrait du registre'], label: 'Estratto del registro di commercio' },
]

const CHECKLIST_BY_TYPE = {
  sollecito: [
    'Verificare se il pagamento è già stato effettuato',
    'Controllare importo, riferimento e periodo indicati',
    'Effettuare il pagamento entro la scadenza indicata',
    'Conservare la ricevuta di pagamento',
    'In caso di contestazione, rispondere per iscritto prima della scadenza',
  ],
  richiesta_documenti: [
    'Leggere l\'elenco dei documenti richiesti',
    'Recuperare i documenti presso contabilità / fiduciaria',
    'Verificare che i documenti siano completi e firmati',
    'Inviare i documenti entro la scadenza (tenere copia)',
    'Annotare la conferma di ricezione',
  ],
  pagamento: [
    'Verificare la correttezza dell\'importo e del periodo',
    'Registrare la fattura in contabilità',
    'Pianificare il pagamento entro la scadenza',
    'Archiviare la comunicazione',
  ],
  dichiarazione: [
    'Raccogliere i dati necessari per la dichiarazione',
    'Compilare il formulario / portale online indicato',
    'Far verificare i dati (interno o fiduciaria)',
    'Inviare la dichiarazione entro la scadenza',
    'Archiviare copia della dichiarazione inviata',
  ],
  controllo: [
    'Annotare la data del controllo in agenda',
    'Preparare i documenti indicati nella comunicazione',
    'Informare la fiduciaria / il responsabile amministrativo',
    'Predisporre uno spazio e una persona di riferimento per il giorno del controllo',
  ],
  decisione: [
    'Leggere attentamente il contenuto della decisione',
    'Verificare il termine per un\'eventuale opposizione o ricorso',
    'Decidere se accettare o contestare la decisione',
    'In caso di dubbio, consultare la fiduciaria o un legale prima della scadenza',
  ],
  informativa: [
    'Leggere la comunicazione e valutare se richiede azioni',
    'Inoltrare alla persona interessata in azienda',
    'Archiviare il documento',
  ],
}

const RISK_BY_TYPE = {
  sollecito: 'Possibili interessi di mora, spese di richiamo o avvio di una procedura esecutiva.',
  pagamento: 'In caso di mancato pagamento: richiami, interessi di mora e possibili spese aggiuntive.',
  decisione: 'Se il termine di opposizione scade, la decisione diventa definitiva e vincolante.',
  dichiarazione: 'Possibile tassazione d\'ufficio o multa per mancata presentazione.',
  richiesta_documenti: 'L\'ente può decidere sulla base degli atti disponibili o applicare una tassazione d\'ufficio.',
}

function norm(text) {
  return ' ' + text.toLowerCase().replace(/\s+/g, ' ') + ' '
}

export function detectLanguage(text) {
  const t = norm(text)
  let best = 'it'
  let bestScore = -1
  for (const [lang, hints] of Object.entries(LANG_HINTS)) {
    let score = 0
    for (const h of hints) {
      const re = new RegExp('\\b' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g')
      score += (t.match(re) || []).length
    }
    if (score > bestScore) { bestScore = score; best = lang }
  }
  return best
}

function parseDates(text) {
  const found = []
  const numeric = /\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})\b/g
  let m
  while ((m = numeric.exec(text)) !== null) {
    const day = +m[1], month = +m[2]
    let year = +m[3]
    if (year < 100) year += 2000
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
      found.push({ date: new Date(year, month - 1, day), index: m.index, raw: m[0] })
    }
  }
  const monthNames = Object.keys(MONTHS).join('|')
  const textual = new RegExp('\\b(\\d{1,2})(?:er|o|\\.|)?\\s+(' + monthNames + ')\\s+(\\d{4})\\b', 'gi')
  while ((m = textual.exec(text)) !== null) {
    const month = MONTHS[m[2].toLowerCase()]
    if (month) found.push({ date: new Date(+m[3], month - 1, +m[1]), index: m.index, raw: m[0] })
  }
  return found
}

function findDeadline(text) {
  const dates = parseDates(text)
  if (dates.length === 0) return null
  const t = text.toLowerCase()
  const withKeyword = dates.filter((d) => {
    const ctx = t.slice(Math.max(0, d.index - 70), d.index + d.raw.length + 20)
    return DEADLINE_KEYWORDS.some((k) => ctx.includes(k))
  })
  const today = new Date()
  const future = (arr) => arr.filter((d) => d.date >= today)
  const pick = (arr) => arr.sort((a, b) => a.date - b.date)[0]
  if (withKeyword.length > 0) {
    return pick(future(withKeyword)) || pick(withKeyword)
  }
  const fut = future(dates)
  return fut.length > 0 ? pick(fut) : null
}

function detectEntity(text) {
  const t = norm(text)
  for (const e of ENTITIES) {
    if (e.keys.some((k) => t.includes(k))) return e
  }
  return { ente: 'Ente non identificato con certezza', categoria: 'Da verificare', uncertain: true }
}

function detectDocType(text) {
  const t = norm(text)
  let best = null
  let bestScore = 0
  for (const d of DOC_TYPES) {
    const score = d.keys.reduce((s, k) => s + (t.includes(k) ? 1 : 0), 0)
    if (score > bestScore) { bestScore = score; best = d }
  }
  return best || { tipo: 'informativa', label: 'Comunicazione informativa' }
}

function detectAmount(text) {
  const m = text.match(/(?:CHF|Fr\.|SFr\.)\s?([\d'’’.,]+\d)/)
  return m ? 'CHF ' + m[1] : null
}

function detectRequestedDocs(text, docType) {
  const t = norm(text)
  const docs = REQUESTED_DOCS.filter((d) => d.keys.some((k) => t.includes(k))).map((d) => d.label)
  if (docs.length === 0 && docType.tipo === 'richiesta_documenti') {
    docs.push('Documenti indicati nella lettera (elenco da verificare manualmente)')
  }
  return docs
}

function urgencyFrom(docType, deadline) {
  const days = deadline ? Math.ceil((deadline.date - new Date()) / 86400000) : null
  if (docType.tipo === 'sollecito') return { level: 'alta', days }
  if (days !== null && days <= 10) return { level: 'alta', days }
  if (days !== null && days <= 30) return { level: 'media', days }
  if (docType.tipo === 'decisione' || docType.tipo === 'controllo') return { level: 'media', days }
  return { level: 'bassa', days }
}

const REPLY_TEMPLATES = {
  it: {
    saluto: 'Gentili Signore e Signori,',
    corpo: {
      sollecito: 'facciamo riferimento al vostro sollecito. Il pagamento di {importo} è stato disposto in data odierna. Vi preghiamo di scusare il ritardo e restiamo a disposizione per eventuali chiarimenti.',
      richiesta_documenti: 'facciamo riferimento alla vostra comunicazione. In allegato vi trasmettiamo i documenti richiesti. Restiamo a disposizione per ulteriori informazioni.',
      pagamento: 'confermiamo la ricezione della vostra fattura. Il pagamento di {importo} sarà effettuato entro il termine indicato.',
      dichiarazione: 'facciamo riferimento alla vostra comunicazione. La dichiarazione richiesta sarà trasmessa entro il termine indicato. Vi preghiamo di contattarci in caso di necessità.',
      controllo: 'confermiamo la ricezione della vostra comunicazione relativa al controllo annunciato. La data proposta è confermata; i documenti richiesti saranno predisposti.',
      decisione: 'confermiamo la ricezione della vostra decisione. Ci riserviamo di esaminarla e, se necessario, di presentare osservazioni entro il termine indicato.',
      informativa: 'confermiamo la ricezione della vostra comunicazione e vi ringraziamo per l\'informazione.',
    },
    chiusura: 'Distinti saluti,\n{azienda}',
  },
  de: {
    saluto: 'Sehr geehrte Damen und Herren,',
    corpo: {
      sollecito: 'wir beziehen uns auf Ihre Mahnung. Die Zahlung von {importo} wurde heute veranlasst. Wir bitten, die Verspätung zu entschuldigen, und stehen für Rückfragen gerne zur Verfügung.',
      richiesta_documenti: 'wir beziehen uns auf Ihr Schreiben. In der Beilage erhalten Sie die gewünschten Unterlagen. Für weitere Auskünfte stehen wir gerne zur Verfügung.',
      pagamento: 'wir bestätigen den Erhalt Ihrer Rechnung. Die Zahlung von {importo} erfolgt innert der angegebenen Frist.',
      dichiarazione: 'wir beziehen uns auf Ihr Schreiben. Die verlangte Deklaration wird innert der angegebenen Frist eingereicht.',
      controllo: 'wir bestätigen den Erhalt Ihrer Ankündigung der Kontrolle. Der vorgeschlagene Termin ist bestätigt; die verlangten Unterlagen werden bereitgestellt.',
      decisione: 'wir bestätigen den Erhalt Ihrer Verfügung. Wir behalten uns vor, diese zu prüfen und innert Frist allfällige Einwände geltend zu machen.',
      informativa: 'wir bestätigen den Erhalt Ihres Schreibens und danken für die Information.',
    },
    chiusura: 'Freundliche Grüsse\n{azienda}',
  },
  fr: {
    saluto: 'Madame, Monsieur,',
    corpo: {
      sollecito: 'nous nous référons à votre rappel. Le paiement de {importo} a été effectué ce jour. Nous vous prions d\'excuser ce retard et restons à votre disposition.',
      richiesta_documenti: 'nous nous référons à votre courrier. Vous trouverez en annexe les documents demandés. Nous restons à votre disposition pour tout complément.',
      pagamento: 'nous confirmons la réception de votre facture. Le paiement de {importo} sera effectué dans le délai indiqué.',
      dichiarazione: 'nous nous référons à votre courrier. La déclaration demandée sera transmise dans le délai indiqué.',
      controllo: 'nous confirmons la réception de votre annonce de contrôle. La date proposée est confirmée; les documents demandés seront préparés.',
      decisione: 'nous confirmons la réception de votre décision. Nous nous réservons le droit de l\'examiner et de formuler nos observations dans le délai imparti.',
      informativa: 'nous confirmons la réception de votre courrier et vous remercions pour l\'information.',
    },
    chiusura: 'Veuillez agréer, Madame, Monsieur, nos salutations distinguées.\n{azienda}',
  },
}

function buildReply(lang, docType, amount, companyName) {
  const tpl = REPLY_TEMPLATES[lang] || REPLY_TEMPLATES.it
  const corpo = (tpl.corpo[docType.tipo] || tpl.corpo.informativa)
    .replace('{importo}', amount || '[importo]')
  return tpl.saluto + '\n\n' + corpo + '\n\n' + tpl.chiusura.replace('{azienda}', companyName || '[Nome azienda]')
}

export function formatDate(d) {
  if (!d) return null
  return d.toLocaleDateString('it-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function analyzeDocument(text, opts = {}) {
  const lang = detectLanguage(text)
  const entity = detectEntity(text)
  const docType = detectDocType(text)
  const deadline = findDeadline(text)
  const amount = detectAmount(text)
  const requestedDocs = detectRequestedDocs(text, docType)
  const urgency = urgencyFrom(docType, deadline)

  let confidencePoints = 0
  if (!entity.uncertain) confidencePoints++
  if (docType.tipo !== 'informativa') confidencePoints++
  if (deadline) confidencePoints++
  if (text.length > 200) confidencePoints++
  const confidence = confidencePoints >= 3 ? 'alta' : confidencePoints === 2 ? 'media' : 'bassa'

  const parts = []
  parts.push(`Si tratta di: ${docType.label.toLowerCase()}${entity.uncertain ? '' : ' da parte di ' + entity.ente}.`)
  if (lang !== 'it') parts.push(`Il documento è in ${LANG_LABEL[lang].toLowerCase()}: qui sotto trovi la spiegazione in italiano.`)
  if (amount) parts.push(`È indicato un importo di ${amount}.`)
  if (deadline) {
    parts.push(`La scadenza individuata è il ${formatDate(deadline.date)}${urgency.days !== null && urgency.days >= 0 ? ` (tra ${urgency.days} giorni)` : ''}.`)
  } else {
    parts.push('Non è stata individuata una scadenza esplicita: verifica manualmente il documento.')
  }

  const risk = RISK_BY_TYPE[docType.tipo] || null

  return {
    id: 'doc-' + Date.now(),
    createdAt: new Date().toISOString(),
    title: opts.title || docType.label,
    inBreve: parts.join(' '),
    lingua: lang,
    linguaLabel: LANG_LABEL[lang],
    ente: entity.ente,
    enteCategoria: entity.categoria,
    enteIncerto: !!entity.uncertain,
    tipo: docType.tipo,
    tipoLabel: docType.label,
    urgenza: urgency.level,
    giorniAllaScadenza: urgency.days,
    scadenza: deadline ? deadline.date.toISOString() : null,
    scadenzaRaw: deadline ? deadline.raw : null,
    importo: amount,
    checklist: (CHECKLIST_BY_TYPE[docType.tipo] || CHECKLIST_BY_TYPE.informativa).map((c, i) => ({ id: i, text: c, done: false })),
    documentiRichiesti: requestedDocs,
    rischio: risk,
    rischioIncerto: !risk,
    bozzaRisposta: buildReply(lang, docType, amount, opts.companyName),
    confidenza: confidence,
    testoOriginale: text,
  }
}

export const SAMPLE_DOCUMENTS = [
  {
    id: 'de-avs',
    label: 'Lettera in tedesco — Cassa AVS (richiesta documenti)',
    title: 'Ausgleichskasse — Lohndeklaration 2025',
    text: `Ausgleichskasse des Kantons Zürich
Postfach, 8087 Zürich

Betreff: Lohndeklaration 2025 — fehlende Unterlagen

Sehr geehrte Damen und Herren

Für die Abrechnung der AHV/IV/EO-Beiträge 2025 benötigen wir noch folgende Unterlagen: die vollständige Lohnliste 2025 sowie die Lohnausweise der im Jahresverlauf ausgetretenen Mitarbeitenden.

Wir bitten Sie, uns die Unterlagen bis spätestens 15.08.2026 einzureichen. Ohne Ihre Angaben müssen wir die Lohnsumme einschätzen, was zu höheren Beiträgen führen kann.

Für Fragen stehen wir Ihnen gerne zur Verfügung.

Mit freundlichen Grüssen
Ausgleichskasse des Kantons Zürich`,
  },
  {
    id: 'fr-tva',
    label: 'Lettera in francese — AFC (sollecito IVA)',
    title: 'AFC — Rappel décompte TVA',
    text: `Administration fédérale des contributions AFC
Division principale de la TVA, 3003 Berne

Concerne: Rappel — décompte TVA 1er trimestre 2026

Madame, Monsieur,

Malgré notre courrier précédent, nous n'avons pas encore reçu votre décompte TVA pour le 1er trimestre 2026 ni le paiement correspondant.

Nous vous prions de nous faire parvenir le décompte et de verser le montant dû de CHF 8'450.00 au plus tard le 05.08.2026. À défaut, des intérêts moratoires seront perçus et une procédure de poursuite pourra être engagée.

Veuillez agréer, Madame, Monsieur, nos salutations distinguées.

Administration fédérale des contributions`,
  },
  {
    id: 'it-comune',
    label: 'Lettera in italiano — Comune (controllo annunciato)',
    title: 'Comune di Lugano — Controllo tassa rifiuti',
    text: `Comune di Lugano — Cancelleria comunale
Piazza della Riforma 1, 6900 Lugano

Oggetto: Verifica della tassa rifiuti aziendale — sopralluogo

Spettabile Ditta,

vi informiamo che il nostro servizio effettuerà un controllo relativo alla tassa rifiuti per le attività economiche. Il sopralluogo è previsto per il 10.09.2026 presso la vostra sede.

Vi invitiamo a presentare in tale occasione il formulario allegato debitamente compilato e i giustificativi relativi allo smaltimento dei rifiuti speciali.

Per eventuali domande potete contattare il nostro ufficio.

Distinti saluti
Cancelleria comunale di Lugano`,
  },
]
