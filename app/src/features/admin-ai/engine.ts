// ============================================================================
// MOTORE ADMIN AI — deterministico (porting fedele dal prototipo).
// Funzione pura: nessun accesso a rete/DB. È il "provider" di analisi che il
// service layer può sostituire in futuro con un LLM mantenendo la stessa forma.
// ============================================================================
import type {
  ChecklistAction, Confidence, DeadlineLevel, DocLanguage, Evidence,
  RequestedDocument, Risk, Urgency,
} from '@/types/models';

// ---- Dizionari --------------------------------------------------------------
const MONTHS: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
  januar: 1, februar: 2, 'märz': 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
  janvier: 1, 'février': 2, fevrier: 2, mars: 3, avril: 4, juin: 6, juillet: 7, 'août': 8, aout: 8, septembre: 9, octobre: 10, 'décembre': 12, decembre: 12,
};

const LANG_HINTS: Record<DocLanguage, string[]> = {
  de: ['der', 'die', 'das', 'und', 'für', 'wir', 'sie', 'nicht', 'bitte', 'sehr geehrte', 'mit freundlichen', 'ihre', 'bis', 'frist', 'unterlagen', 'gemäss'],
  fr: ['le', 'la', 'les', 'nous', 'vous', 'madame', 'monsieur', 'veuillez', 'délai', 'salutations', 'votre', 'dans', 'concernant', 'agréer'],
  it: ['il', 'la', 'gli', 'che', 'per', 'gentile', 'spettabile', 'siamo', 'entro', 'cordiali', 'vostra', 'documenti', 'termine', 'distinti'],
};

export const LANG_LABEL: Record<string, string> = { de: 'Tedesco', fr: 'Francese', it: 'Italiano' };

interface EntityDef { keys: string[]; ente: string; categoria: string }
const ENTITIES: EntityDef[] = [
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
];

interface DocTypeDef { tipo: string; label: string; keys: string[] }
const DOC_TYPES: DocTypeDef[] = [
  { tipo: 'sollecito', label: 'Sollecito di pagamento', keys: ['mahnung', 'sollecito', 'rappel', 'diffida', 'zahlungserinnerung', 'mancato pagamento'] },
  { tipo: 'richiesta_documenti', label: 'Richiesta di documenti / informazioni', keys: ['einreichen', 'nachreichen', 'inviarci', 'trasmetterci', 'unterlagen', 'documenti seguenti', 'fornire i seguenti', 'veuillez nous faire parvenir', 'documents suivants', 'benötigen wir', 'vi invitiamo a presentare'] },
  { tipo: 'pagamento', label: 'Fattura / richiesta di pagamento', keys: ['rechnung', 'fattura', 'facture', 'zahlung', 'pagamento', 'versamento', 'importo dovuto', 'betrag', 'montant', 'conguaglio', 'acconti'] },
  { tipo: 'dichiarazione', label: 'Dichiarazione / conteggio da presentare', keys: ['deklaration', 'dichiarazione', 'déclaration', 'abrechnung', 'conteggio', 'décompte', 'rendiconto', 'formulario allegato'] },
  { tipo: 'controllo', label: 'Controllo / revisione', keys: ['kontrolle', 'controllo', 'contrôle', 'revision', 'revisione', 'verifica contabile', 'ispezione', 'audit'] },
  { tipo: 'decisione', label: 'Decisione / notifica ufficiale', keys: ['verfügung', 'decisione', 'décision', 'notifica', 'entscheid', 'reclamo', 'einsprache', 'opposizione', 'ricorso'] },
];

// Tassonomia NORMALIZZATA della pipeline AI (§8). È quella che viene persistita
// in `document_analyses.document_type`; le chiavi italiane qui sotto restano per
// il motore locale e per i dati storici. Senza queste etichette la UI mostrerebbe
// l'identificatore grezzo ("request_for_documents") come tipo di documento.
export const AI_DOC_TYPE_LABEL: Record<string, string> = {
  information: 'Comunicazione informativa',
  request_for_documents: 'Richiesta di documenti',
  payment_request: 'Richiesta di pagamento',
  reminder: 'Sollecito',
  invoice: 'Fattura',
  declaration_request: 'Dichiarazione / conteggio da presentare',
  official_decision: 'Decisione ufficiale',
  inspection_notice: 'Avviso di controllo',
  tax_document: 'Documento fiscale',
  social_insurance: 'Assicurazioni sociali',
  employment: 'Lavoro / personale',
  permit: 'Permesso / autorizzazione',
  contract_related: 'Documento contrattuale',
  other: 'Altro documento amministrativo',
};

export const DOC_TYPE_LABEL: Record<string, string> = {
  ...Object.fromEntries(DOC_TYPES.map((d) => [d.tipo, d.label])),
  informativa: 'Comunicazione informativa',
  ...AI_DOC_TYPE_LABEL,
};

const DEADLINE_KEYWORDS = ['entro', 'scadenza', 'termine', 'al più tardi', 'bis zum', 'bis am', 'bis spätestens', 'spätestens', 'frist', 'innert', 'innerhalb', 'délai', 'au plus tard', 'avant le', "jusqu'au", 'dans les'];

const REQUESTED_DOCS: { keys: string[]; label: string }[] = [
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
];

const CHECKLIST_BY_TYPE: Record<string, string[]> = {
  sollecito: ['Verificare se il pagamento è già stato effettuato', 'Controllare importo, riferimento e periodo indicati', 'Effettuare il pagamento entro la scadenza indicata', 'Conservare la ricevuta di pagamento', 'In caso di contestazione, rispondere per iscritto prima della scadenza'],
  richiesta_documenti: ["Leggere l'elenco dei documenti richiesti", 'Recuperare i documenti presso contabilità / fiduciaria', 'Verificare che i documenti siano completi e firmati', 'Inviare i documenti entro la scadenza (tenere copia)', 'Annotare la conferma di ricezione'],
  pagamento: ["Verificare la correttezza dell'importo e del periodo", 'Registrare la fattura in contabilità', 'Pianificare il pagamento entro la scadenza', 'Archiviare la comunicazione'],
  dichiarazione: ['Raccogliere i dati necessari per la dichiarazione', 'Compilare il formulario / portale online indicato', 'Far verificare i dati (interno o fiduciaria)', 'Inviare la dichiarazione entro la scadenza', 'Archiviare copia della dichiarazione inviata'],
  controllo: ['Annotare la data del controllo in agenda', 'Preparare i documenti indicati nella comunicazione', 'Informare la fiduciaria / il responsabile amministrativo', 'Predisporre uno spazio e una persona di riferimento per il giorno del controllo'],
  decisione: ['Leggere attentamente il contenuto della decisione', "Verificare il termine per un'eventuale opposizione o ricorso", 'Decidere se accettare o contestare la decisione', 'In caso di dubbio, consultare la fiduciaria o un legale prima della scadenza'],
  informativa: ['Leggere la comunicazione e valutare se richiede azioni', 'Inoltrare alla persona interessata in azienda', 'Archiviare il documento'],
};

const RISK_BY_TYPE: Record<string, string> = {
  sollecito: 'Possibili interessi di mora, spese di richiamo o avvio di una procedura esecutiva.',
  pagamento: 'In caso di mancato pagamento: richiami, interessi di mora e possibili spese aggiuntive.',
  decisione: 'Se il termine di opposizione scade, la decisione diventa definitiva e vincolante.',
  dichiarazione: "Possibile tassazione d'ufficio o multa per mancata presentazione.",
  richiesta_documenti: "L'ente può decidere sulla base degli atti disponibili o applicare una tassazione d'ufficio.",
};

const RISK_EXPLICIT_KEYWORDS = [
  'interessi di mora', 'procedura esecutiva', 'precetto esecutivo', 'esecuzione', 'diffida', "tassazione d'ufficio", 'multa', 'penale', 'spese di richiamo', 'sollecito',
  'intérêts moratoires', 'poursuite', 'majoration', 'amende', 'mise en demeure',
  'verzugszins', 'betreibung', 'mahngebühr', 'säumniszuschlag', 'ermessenseinschätzung', 'busse', 'mahnung',
];

type Tone = 'formale' | 'conciso' | 'cordiale';
export const TONI: Record<Tone, string> = { formale: 'Formale', conciso: 'Conciso', cordiale: 'Cordiale' };

interface ReplyTpl {
  saluti: Record<Tone, string>;
  chiusure: Record<Tone, string>;
  corpo: Record<string, string>;
}
const REPLY_TEMPLATES: Record<string, ReplyTpl> = {
  it: {
    saluti: { formale: 'Gentili Signore e Signori,', conciso: 'Salve,', cordiale: 'Buongiorno,' },
    chiusure: { formale: 'Distinti saluti,\n{azienda}', conciso: 'Cordiali saluti,\n{azienda}', cordiale: 'Un caro saluto,\n{azienda}' },
    corpo: {
      sollecito: 'facciamo riferimento al vostro sollecito. Il pagamento di {importo} è stato disposto in data odierna. Vi preghiamo di scusare il ritardo e restiamo a disposizione per eventuali chiarimenti.',
      richiesta_documenti: 'facciamo riferimento alla vostra comunicazione. In allegato vi trasmettiamo i documenti richiesti. Restiamo a disposizione per ulteriori informazioni.',
      pagamento: 'confermiamo la ricezione della vostra fattura. Il pagamento di {importo} sarà effettuato entro il termine indicato.',
      dichiarazione: 'facciamo riferimento alla vostra comunicazione. La dichiarazione richiesta sarà trasmessa entro il termine indicato. Vi preghiamo di contattarci in caso di necessità.',
      controllo: 'confermiamo la ricezione della vostra comunicazione relativa al controllo annunciato. La data proposta è confermata; i documenti richiesti saranno predisposti.',
      decisione: 'confermiamo la ricezione della vostra decisione. Ci riserviamo di esaminarla e, se necessario, di presentare osservazioni entro il termine indicato.',
      informativa: "confermiamo la ricezione della vostra comunicazione e vi ringraziamo per l'informazione.",
    },
  },
  de: {
    saluti: { formale: 'Sehr geehrte Damen und Herren,', conciso: 'Guten Tag,', cordiale: 'Guten Tag,' },
    chiusure: { formale: 'Freundliche Grüsse\n{azienda}', conciso: 'Freundliche Grüsse\n{azienda}', cordiale: 'Herzliche Grüsse\n{azienda}' },
    corpo: {
      sollecito: 'wir beziehen uns auf Ihre Mahnung. Die Zahlung von {importo} wurde heute veranlasst. Wir bitten, die Verspätung zu entschuldigen, und stehen für Rückfragen gerne zur Verfügung.',
      richiesta_documenti: 'wir beziehen uns auf Ihr Schreiben. In der Beilage erhalten Sie die gewünschten Unterlagen. Für weitere Auskünfte stehen wir gerne zur Verfügung.',
      pagamento: 'wir bestätigen den Erhalt Ihrer Rechnung. Die Zahlung von {importo} erfolgt innert der angegebenen Frist.',
      dichiarazione: 'wir beziehen uns auf Ihr Schreiben. Die verlangte Deklaration wird innert der angegebenen Frist eingereicht.',
      controllo: 'wir bestätigen den Erhalt Ihrer Ankündigung der Kontrolle. Der vorgeschlagene Termin ist bestätigt; die verlangten Unterlagen werden bereitgestellt.',
      decisione: 'wir bestätigen den Erhalt Ihrer Verfügung. Wir behalten uns vor, diese zu prüfen und innert Frist allfällige Einwände geltend zu machen.',
      informativa: 'wir bestätigen den Erhalt Ihres Schreibens und danken für die Information.',
    },
  },
  fr: {
    saluti: { formale: 'Madame, Monsieur,', conciso: 'Bonjour,', cordiale: 'Bonjour,' },
    chiusure: { formale: 'Veuillez agréer, Madame, Monsieur, nos salutations distinguées.\n{azienda}', conciso: 'Cordialement,\n{azienda}', cordiale: 'Bien cordialement,\n{azienda}' },
    corpo: {
      sollecito: "nous nous référons à votre rappel. Le paiement de {importo} a été effectué ce jour. Nous vous prions d'excuser ce retard et restons à votre disposition.",
      richiesta_documenti: 'nous nous référons à votre courrier. Vous trouverez en annexe les documents demandés. Nous restons à votre disposition pour tout complément.',
      pagamento: 'nous confirmons la réception de votre facture. Le paiement de {importo} sera effectué dans le délai indiqué.',
      dichiarazione: 'nous nous référons à votre courrier. La déclaration demandée sera transmise dans le délai indiqué.',
      controllo: 'nous confirmons la réception de votre annonce de contrôle. La date proposée est confirmée; les documents demandés seront préparés.',
      decisione: "nous confirmons la réception de votre décision. Nous nous réservons le droit de l'examiner et de formuler nos observations dans le délai imparti.",
      informativa: "nous confirmons la réception de votre courrier et vous remercions pour l'information.",
    },
  },
};

// ---- Helper -----------------------------------------------------------------
const norm = (text: string) => ' ' + text.toLowerCase().replace(/\s+/g, ' ') + ' ';

function detectLanguage(text: string): DocLanguage {
  const t = norm(text);
  let best: DocLanguage = 'it';
  let bestScore = -1;
  for (const [lang, hints] of Object.entries(LANG_HINTS) as [DocLanguage, string[]][]) {
    let score = 0;
    for (const h of hints) {
      const re = new RegExp('\\b' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
      score += (t.match(re) || []).length;
    }
    if (score > bestScore) { bestScore = score; best = lang; }
  }
  return best;
}

interface DateHit { date: Date; index: number; raw: string }
function parseDates(text: string): DateHit[] {
  const found: DateHit[] = [];
  const numeric = /\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = numeric.exec(text)) !== null) {
    const day = +m[1]; const month = +m[2];
    let year = +m[3];
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
      found.push({ date: new Date(year, month - 1, day), index: m.index, raw: m[0] });
    }
  }
  const monthNames = Object.keys(MONTHS).join('|');
  const textual = new RegExp('\\b(\\d{1,2})(?:er|o|\\.|)?\\s+(' + monthNames + ')\\s+(\\d{4})\\b', 'gi');
  while ((m = textual.exec(text)) !== null) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) found.push({ date: new Date(+m[3], month - 1, +m[1]), index: m.index, raw: m[0] });
  }
  return found;
}

function findDeadline(text: string): DateHit | null {
  const dates = parseDates(text);
  if (dates.length === 0) return null;
  const t = text.toLowerCase();
  const withKeyword = dates.filter((d) => {
    const ctx = t.slice(Math.max(0, d.index - 70), d.index + d.raw.length + 20);
    return DEADLINE_KEYWORDS.some((k) => ctx.includes(k));
  });
  const today = new Date();
  const future = (arr: DateHit[]) => arr.filter((d) => d.date >= today);
  const pick = (arr: DateHit[]) => arr.slice().sort((a, b) => a.date.getTime() - b.date.getTime())[0];
  if (withKeyword.length > 0) return pick(future(withKeyword)) || pick(withKeyword);
  const fut = future(dates);
  return fut.length > 0 ? pick(fut) : null;
}

function detectEntity(text: string): EntityDef & { uncertain?: boolean } {
  const t = norm(text);
  for (const e of ENTITIES) if (e.keys.some((k) => t.includes(k))) return e;
  return { keys: [], ente: 'Ente non identificato con certezza', categoria: 'Da verificare', uncertain: true };
}

function detectDocType(text: string): DocTypeDef {
  const t = norm(text);
  let best: DocTypeDef | null = null;
  let bestScore = 0;
  for (const d of DOC_TYPES) {
    const score = d.keys.reduce((s, k) => s + (t.includes(k) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best || { tipo: 'informativa', label: 'Comunicazione informativa', keys: [] };
}

export function evidenceAt(text: string, index: number | null, matchLen: number): Evidence | null {
  if (index == null || index < 0) return null;
  let s = text.lastIndexOf('\n', index); s = s < 0 ? 0 : s + 1;
  let e = text.indexOf('\n', index + matchLen); if (e < 0) e = text.length;
  let quote = text.slice(s, e).trim();
  if (quote.length > 240) {
    const from = Math.max(s, index - 90); const to = Math.min(e, index + matchLen + 90);
    quote = (from > s ? '… ' : '') + text.slice(from, to).trim() + (to < e ? ' …' : '');
  }
  return { quote, start: index, end: index + matchLen };
}

function findKeywordEvidence(text: string, keys: string[]): Evidence | null {
  const low = text.toLowerCase();
  for (const k of keys) {
    const i = low.indexOf(k.toLowerCase());
    if (i >= 0) return evidenceAt(text, i, k.length);
  }
  return null;
}

interface AmountHit { value: number; currency: string; display: string; evidence: Evidence | null }
function detectAmount(text: string): AmountHit | null {
  const m = text.match(/(?:CHF|Fr\.|SFr\.)\s?([\d'’.,]+\d)/);
  if (!m || m.index == null) return null;
  const raw = m[1];
  const numeric = Number(raw.replace(/['’\s]/g, '').replace(/,/g, '.'));
  return {
    value: Number.isFinite(numeric) ? numeric : 0,
    currency: 'CHF',
    display: 'CHF ' + raw,
    evidence: evidenceAt(text, m.index, m[0].length),
  };
}

function detectRequestedDocs(text: string, docType: DocTypeDef): RequestedDocument[] {
  const list: RequestedDocument[] = [];
  for (const d of REQUESTED_DOCS) {
    const ev = findKeywordEvidence(text, d.keys);
    if (ev) list.push({ label: d.label, evidence: ev });
  }
  if (list.length === 0 && docType.tipo === 'richiesta_documenti') {
    list.push({ label: 'Documenti indicati nella lettera (elenco da verificare manualmente)', evidence: null });
  }
  return list;
}

// Tipi che alzano l'urgenza anche senza una scadenza estratta. Include ENTRAMBE
// le tassonomie: quella dell'AI (§8) e quella storica del motore locale.
const URGENT_TYPES = new Set(['sollecito', 'reminder']);
const MEDIUM_TYPES = new Set([
  'decisione', 'controllo',
  'official_decision', 'inspection_notice', 'payment_request', 'invoice',
  'declaration_request', 'request_for_documents',
]);

export function urgencyFromType(tipo: string, days: number | null): Urgency {
  if (URGENT_TYPES.has(tipo)) return 'alta';
  if (days !== null && days <= 10) return 'alta';
  if (days !== null && days <= 30) return 'media';
  if (MEDIUM_TYPES.has(tipo)) return 'media';
  return 'bassa';
}

export function deadlineLevel(days: number | null): DeadlineLevel {
  if (days == null) return 'none';
  if (days < 0) return 'scaduta';
  if (days <= 7) return 'urgente';
  if (days <= 30) return 'prossima';
  return 'nessuna';
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function detectRisk(text: string, docType: DocTypeDef): Risk {
  const ev = findKeywordEvidence(text, RISK_EXPLICIT_KEYWORDS);
  if (ev) return { text: RISK_BY_TYPE[docType.tipo] || 'Il documento indica esplicitamente possibili conseguenze in caso di mancato adempimento.', level: 'explicit', evidence: ev };
  if (RISK_BY_TYPE[docType.tipo]) return { text: RISK_BY_TYPE[docType.tipo], level: 'possible', evidence: null };
  return { text: 'Non determinabile dal documento.', level: 'unknown', evidence: null };
}

export function buildReply(lang: string, tipo: string, amountDisplay: string | null, companyName: string | null, tone: string): string {
  const tpl = REPLY_TEMPLATES[lang] || REPLY_TEMPLATES.it;
  const t = (tone && (tpl.saluti as Record<string, string>)[tone] ? tone : 'formale') as Tone;
  const corpo = (tpl.corpo[tipo] || tpl.corpo.informativa).replace('{importo}', amountDisplay || '[importo]');
  return tpl.saluti[t] + '\n\n' + corpo + '\n\n' + tpl.chiusure[t].replace('{azienda}', companyName || '[Nome azienda]');
}

// ---- Output del motore ------------------------------------------------------
export interface EngineAnalysis {
  language: DocLanguage;
  languageLabel: string;
  sender: string | null;
  senderUncertain: boolean;
  senderEvidence: Evidence | null;
  documentType: string;
  documentTypeLabel: string;
  urgency: Urgency;
  deadline: string | null;          // YYYY-MM-DD
  deadlineLevel: DeadlineLevel;
  daysToDeadline: number | null;
  deadlineEvidence: Evidence | null;
  amount: number | null;
  amountCurrency: string | null;
  amountDisplay: string | null;
  amountEvidence: Evidence | null;
  summary: string;
  actions: ChecklistAction[];
  primaryAction: string | null;
  primaryActionSource: 'extracted' | 'suggested';
  requestedDocuments: RequestedDocument[];
  risk: Risk;
  uncertainties: string[];
  confidence: Confidence;
  replyDraft: string;
  replyLanguage: DocLanguage;
  replyTone: string;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('it-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
const toDateOnly = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Punto d'integrazione LLM: stessa firma (testo -> EngineAnalysis). */
export function analyzeText(text: string, opts: { companyName?: string | null } = {}): EngineAnalysis {
  const lang = detectLanguage(text);
  const entity = detectEntity(text);
  const docType = detectDocType(text);
  const deadlineHit = findDeadline(text);
  const amountObj = detectAmount(text);
  const requestedDocs = detectRequestedDocs(text, docType);
  const deadlineISO = deadlineHit ? toDateOnly(deadlineHit.date) : null;
  const days = daysUntil(deadlineISO);
  const urgency = urgencyFromType(docType.tipo, days);
  const rischio = detectRisk(text, docType);
  const tone = 'formale';
  const companyName = opts.companyName ?? null;

  const senderEvidence = entity.uncertain ? null : findKeywordEvidence(text, entity.keys);
  const deadlineEvidence = deadlineHit ? evidenceAt(text, deadlineHit.index, deadlineHit.raw.length) : null;

  let confidencePoints = 0;
  if (!entity.uncertain) confidencePoints++;
  if (docType.tipo !== 'informativa') confidencePoints++;
  if (deadlineHit) confidencePoints++;
  if (text.length > 200) confidencePoints++;
  const confidence: Confidence = confidencePoints >= 3 ? 'alta' : confidencePoints === 2 ? 'media' : 'bassa';

  const uncertainties: string[] = [];
  if (entity.uncertain) uncertainties.push('Ente mittente non identificato con certezza');
  if (docType.tipo === 'informativa') uncertainties.push('Tipo di documento non determinato con certezza');
  if (!deadlineHit) uncertainties.push('Nessuna scadenza esplicita individuata nel testo');
  if (rischio.level !== 'explicit') uncertainties.push('Conseguenze del mancato adempimento non confermate dal documento');
  if (lang !== 'it' && confidence !== 'alta') uncertainties.push('Traduzione/interpretazione da confermare per un documento non in italiano');

  const suggestedActions: ChecklistAction[] = (CHECKLIST_BY_TYPE[docType.tipo] || CHECKLIST_BY_TYPE.informativa)
    .map((c, i) => ({ id: i, text: c, done: false, sourceType: 'suggested' as const, evidence: null }));
  const extractedActions: ChecklistAction[] = [];
  if (deadlineEvidence && deadlineISO) {
    extractedActions.push({ id: suggestedActions.length, text: `Agire entro la scadenza indicata (${fmtDate(deadlineISO)})`, done: false, sourceType: 'extracted', evidence: deadlineEvidence });
  }
  const actions: ChecklistAction[] = [...suggestedActions, ...extractedActions].map((c, i) => ({ ...c, id: i }));

  const parts: string[] = [];
  parts.push(`Si tratta di: ${docType.label.toLowerCase()}${entity.uncertain ? '' : ' da parte di ' + entity.ente}.`);
  if (lang !== 'it') parts.push(`Il documento è in ${LANG_LABEL[lang].toLowerCase()}: qui sotto trovi la spiegazione in italiano.`);
  if (amountObj) parts.push(`È indicato un importo di ${amountObj.display}.`);
  if (deadlineISO) parts.push(`La scadenza individuata è il ${fmtDate(deadlineISO)}${days !== null && days >= 0 ? ` (tra ${days} giorni)` : ''}.`);
  else parts.push('Non è stata individuata una scadenza esplicita: verifica manualmente il documento.');

  return {
    language: lang,
    languageLabel: LANG_LABEL[lang],
    sender: entity.uncertain ? null : entity.ente,
    senderUncertain: !!entity.uncertain,
    senderEvidence,
    documentType: docType.tipo,
    documentTypeLabel: docType.label,
    urgency,
    deadline: deadlineISO,
    deadlineLevel: deadlineLevel(days),
    daysToDeadline: days,
    deadlineEvidence,
    amount: amountObj ? amountObj.value : null,
    amountCurrency: amountObj ? amountObj.currency : null,
    amountDisplay: amountObj ? amountObj.display : null,
    amountEvidence: amountObj ? amountObj.evidence : null,
    summary: parts.join(' '),
    actions,
    primaryAction: actions[0] ? actions[0].text : null,
    primaryActionSource: actions[0] ? actions[0].sourceType : 'suggested',
    requestedDocuments: requestedDocs,
    risk: rischio,
    uncertainties,
    confidence,
    replyDraft: buildReply(lang, docType.tipo, amountObj ? amountObj.display : null, companyName, tone),
    replyLanguage: lang,
    replyTone: tone,
  };
}

// ---- Documenti d'esempio (demo, caricabili solo su richiesta) ---------------
export interface SampleDocument { id: string; label: string; title: string; text: string }
export const SAMPLE_DOCUMENTS: SampleDocument[] = [
  {
    id: 'de-avs', label: 'Lettera in tedesco — Cassa AVS', title: 'Ausgleichskasse — Lohndeklaration 2025',
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
    id: 'fr-tva', label: 'Lettera in francese — AFC (sollecito IVA)', title: 'AFC — Rappel décompte TVA',
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
    id: 'it-comune', label: 'Lettera in italiano — Comune', title: 'Comune di Lugano — Controllo tassa rifiuti',
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
];
