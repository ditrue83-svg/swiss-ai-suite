// ============================================================================
// CRM — import CSV dei contatti (logica PURA)
//
// Niente rete, niente Supabase, niente React: parsing del file, suggerimento
// della mappatura, validazione delle righe, classificazione dei duplicati.
// Sta qui e non nel componente perché un parser sbagliato non si vede: un
// separatore riconosciuto male sposta una colonna e importa la città nel CAP,
// e il risultato SEMBRA giusto finché qualcuno non apre la scheda.
//
// ⚠️⚠️ IL PARSER È SCRITTO QUI E NON PRESO DA UNA LIBRERIA, ed è una scelta
// dichiarata nel commit: il progetto ha quattro dipendenze (supabase-js,
// pdfjs, react, react-router) e un parser CSV generalista peserebbe più del
// resto della UI per coprire casi che qui non servono (separatori esotici,
// stream). Quello che serve davvero — virgolette con escape `""`, ritorni a
// capo dentro le virgolette, `;` degli export Excel svizzeri, BOM, windows-1252
// — sta in poche decine di righe, e ognuna è provata in `test-crm-unit`.
//
// ⚠️ LA CIFRA DI CONTROLLO DELL'IDI NON SI RISCRIVE: è `normUid` di
// `crmMatch.ts`, la stessa copia che decide se un collegamento è lecito.
// ============================================================================
import type { CrmOrganizationRole } from '@/types/database';
import { isPublicDomain, normDomain, normEmail, normUid } from './crmMatch';
import { safeWebsite } from './crmModel';

// ---------------------------------------------------------------------------
// I tetti — dichiarati, e la schermata li dice quando scattano
// ---------------------------------------------------------------------------

/**
 * Quante righe dati si importano al massimo. Mille anagrafiche in un colpo solo
 * sono già oltre ciò che una PMI carica a mano; oltre, l'anteprima diventa
 * illeggibile e una riga sbagliata non la trova nessuno.
 */
export const IMPORT_MAX_ROWS = 1000;

/**
 * Quanto può pesare il file. Mille righe di una rubrica stanno in poche
 * centinaia di KB: un megabyte è largo, e oltre c'è quasi sempre un export
 * sbagliato (l'intera contabilità, non i contatti).
 */
export const IMPORT_MAX_FILE_BYTES = 1_048_576;

// ---------------------------------------------------------------------------
// Decodifica: UTF-8, e se non torna, windows-1252
// ---------------------------------------------------------------------------

export type CsvEncoding = 'utf-8' | 'windows-1252';

/**
 * Dai byte al testo. Gli export di Excel in Svizzera escono spesso in
 * windows-1252 («Zürich» con la ü in un byte solo): decodificarli come UTF-8
 * produce il glifo di sostituzione, cioè nomi rovinati in silenzio. Quindi
 * UTF-8 in modo rigoroso, e se non decodifica si ripiega su windows-1252 — un
 * ripiego DICHIARATO nel risultato, non silenzioso.
 */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
  // Il BOM UTF-8 (EF BB BF) si toglie prima: lasciato, diventerebbe parte della
  // prima intestazione e «\uFEFFNome» non riconoscerebbe più nessun alias.
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = bom ? bytes.subarray(3) : bytes;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(body), encoding: 'windows-1252' };
  }
}

// ---------------------------------------------------------------------------
// Il separatore: `;` è il default svizzero, poi `,` e tab
// ---------------------------------------------------------------------------

export type CsvDelimiter = ';' | ',' | '\t';

/**
 * Riconosce il separatore dalla prima riga non vuota, contando le occorrenze
 * FUORI dalle virgolette: un «Mario; Bianchi, Rossi» non deve far vincere la
 * virgola che sta dentro un campo. A parità — o senza nessun separatore — vince
 * `;`, perché è quello che Excel produce nelle impostazioni locali svizzere.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const firstLine = text.split(/\r\n|\r|\n/).find((l) => l.trim() !== '') ?? '';
  const counts: Record<CsvDelimiter, number> = { ';': 0, ',': 0, '\t': 0 };
  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i += 1) {
    const c = firstLine[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (firstLine[i + 1] === '"') i += 1;
        else inQuotes = false;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ';' || c === ',' || c === '\t') {
      counts[c] += 1;
    }
  }
  if (counts[','] > counts[';'] && counts[','] >= counts['\t']) return ',';
  if (counts['\t'] > counts[';']) return '\t';
  return ';';
}

// ---------------------------------------------------------------------------
// Il parser
// ---------------------------------------------------------------------------

export interface ParsedCsv {
  /** La prima riga non vuota del file, cella per cella. */
  headers: string[];
  /** Le righe dati (vuote saltate), al massimo `IMPORT_MAX_ROWS`. */
  rows: string[][];
  delimiter: CsvDelimiter;
  /** Quante righe dati il file contiene DAVVERO, anche oltre il tetto. */
  totalDataRows: number;
  /** Vero quando il file aveva più righe del tetto: la schermata lo dichiara. */
  rowLimitHit: boolean;
}

/**
 * Il CSV in righe e celle. Regole: campi fra doppi apici con `""` come escape;
 * ritorni a capo ammessi DENTRO le virgolette; `\r\n`, `\n` e il `\r` dei vecchi
 * Mac come fine riga; righe vuote (o di soli spazi) saltate; prima riga non
 * vuota = intestazione.
 *
 * ⚠️ Un doppio apice apre un campo quotato solo se il campo è ancora vuoto:
 * dopo del testo nudo è un carattere come un altro, e buttarlo via perderebbe
 * un dato senza dirlo.
 */
export function parseCsv(text: string, maxRows = IMPORT_MAX_ROWS): ParsedCsv {
  // Il BOM può arrivare anche dentro una stringa già decodificata: lasciato,
  // diventerebbe parte della prima intestazione e nessun alias la riconoscerebbe.
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const delimiter = detectDelimiter(source);
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  const closeField = () => { row.push(field); field = ''; };
  const closeRow = () => {
    closeField();
    records.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"' && field === '') { inQuotes = true; i += 1; continue; }
    if (c === delimiter) { closeField(); i += 1; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      closeRow(); i += 1; continue;
    }
    field += c; i += 1;
  }
  // La riga in coda senza ritorno a capo finale.
  if (field !== '' || row.length > 0) closeRow();

  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ''));
  const headers = (nonEmpty[0] ?? []).map((h) => h.trim());
  const data = nonEmpty.slice(1);
  return {
    headers,
    rows: data.slice(0, maxRows),
    delimiter,
    totalDataRows: data.length,
    rowLimitHit: data.length > maxRows,
  };
}

// ---------------------------------------------------------------------------
// I campi di destinazione
// ---------------------------------------------------------------------------

export const IMPORT_FIELDS = [
  'org.display_name', 'org.legal_name', 'org.uid_che', 'org.vat_number',
  'org.website', 'org.street', 'org.postal_code', 'org.city', 'org.canton',
  'org.country_code', 'org.notes', 'org.role',
  'person.first_name', 'person.last_name', 'person.job_title',
  'contact.email', 'contact.phone', 'contact.mobile',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Colonna per colonna: il campo scelto, oppure `null` = non importata. */
export type ColumnMapping = ReadonlyArray<ImportField | null>;

/**
 * Le intestazioni come si scrivono davvero, in quattro lingue, già in forma
 * normalizzata (minuscole, senza accenti, spazi singoli). Non è un
 * riconoscimento «intelligente»: è un elenco dichiarato, e un'intestazione che
 * non c'è resta non mappata — indovinare è il modo più rapido di importare la
 * città nel CAP.
 */
export const HEADER_ALIASES: Record<ImportField, readonly string[]> = {
  'org.display_name': [
    'azienda', 'ditta', 'impresa', 'societa', 'ragione sociale', 'nome azienda',
    'nome impresa', 'denominazione', 'firma', 'unternehmen', 'firmenname', 'betrieb',
    'gesellschaft', 'entreprise', 'societe', 'raison sociale', 'nom de l entreprise',
    'nom entreprise', 'company', 'company name', 'organization', 'organisation',
    'organization name', 'organisation name', 'cliente', 'kunde', 'client',
  ],
  'org.legal_name': [
    'legal name', 'company legal name', 'raison sociale complete', 'firma legale',
  ],
  'org.uid_che': [
    'uid', 'ide', 'idi', 'che', 'numero uid', 'numero ide', 'numero idi',
    'ide uid', 'uid ide', 'numero che', 'ide no', 'no ide', 'uid nummer',
    'numero d identification', 'numero d identification des entreprises',
  ],
  'org.vat_number': [
    'iva', 'numero iva', 'partita iva', 'vat', 'vat number', 'vat no', 'tva',
    'numero tva', 'mwst', 'mwst nummer', 'mwst-nummer', 'ust id', 'ust-id',
    'ust idnr', 'vat id',
  ],
  'org.website': [
    'sito', 'sito web', 'website', 'web site', 'webseite', 'homepage', 'internet',
    'site web', 'site internet', 'web',
  ],
  'org.street': [
    'indirizzo', 'via', 'strada', 'via e numero', 'indirizzo e numero', 'adresse',
    'strasse', 'strasse und nummer', 'rue', 'adresse rue', 'address', 'street',
    'street address',
  ],
  'org.postal_code': [
    'cap', 'nap', 'plz', 'code postal', 'postal code', 'zip', 'zip code',
    'codice postale', 'cp',
  ],
  'org.city': [
    'localita', 'citta', 'comune', 'luogo', 'ort', 'stadt', 'ortschaft', 'ville',
    'localite', 'city', 'town',
  ],
  'org.canton': ['cantone', 'kanton', 'canton', 'state', 'province'],
  'org.country_code': [
    'paese', 'nazione', 'stato', 'land', 'pays', 'country', 'country code',
    'codice paese',
  ],
  'org.notes': [
    'note', 'notizie', 'commenti', 'bemerkungen', 'notizen', 'kommentare',
    'notes', 'remarques', 'commentaires', 'comments',
  ],
  'org.role': [
    'ruolo', 'rolle', 'role', 'tipo controparte', 'tipo di controparte',
    'art der gegenpartei', 'type de contrepartie',
  ],
  'person.first_name': [
    'nome', 'vorname', 'prenom', 'first name', 'firstname', 'given name',
  ],
  'person.last_name': [
    'cognome', 'nachname', 'familienname', 'nom', 'nom de famille', 'last name',
    'lastname', 'surname', 'family name',
  ],
  'person.job_title': [
    'funzione', 'qualifica', 'ruolo in azienda', 'titolo', 'position', 'funktion',
    'fonction', 'job title', 'jobtitle', 'poste',
  ],
  'contact.email': [
    'email', 'e-mail', 'e mail', 'mail', 'e-mail adresse', 'e-mail-adresse',
    'adresse email', 'adresse e-mail', 'courriel', 'courrier electronique',
    'indirizzo email', 'indirizzo e-mail', 'posta elettronica', 'email address',
  ],
  'contact.phone': [
    'telefono', 'tel', 'tel.', 'telefono fisso', 'telefon', 'telefonnummer',
    'telephone', 'phone', 'phone number', 'telephone fixe',
  ],
  'contact.mobile': [
    'cellulare', 'mobile', 'handy', 'natel', 'portable', 'telefono cellulare',
    'mobiltelefon', 'mobil', 'gsm', 'cell phone', 'mobile phone',
  ],
};

/**
 * L'intestazione in forma di confronto: minuscole, accenti tolti (NFD),
 * punteggiatura in spazio, spazi singoli. «E-Mail:» e «E Mail» diventano la
 * stessa cosa, ed è quello che serve.
 */
function normHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const ALIAS_LOOKUP: ReadonlyMap<string, ImportField> = (() => {
  const map = new Map<string, ImportField>();
  for (const field of IMPORT_FIELDS) {
    for (const alias of HEADER_ALIASES[field]) {
      // ⚠️ La chiave è l'alias NORMALIZZATO: la ricerca avviene sulla forma di
      // `normHeader`, e un alias indicizzato grezzo («e-mail adresse») non
      // verrebbe trovato mai. Il test sulle collisioni lo sorveglia.
      const key = normHeader(alias);
      // Un alias conteso fra due campi terrebbe il primo: l'elenco è scritto
      // perché non ce ne siano, e il test lo sorveglia.
      if (!map.has(key)) map.set(key, field);
    }
  }
  return map;
})();

/**
 * Propone la mappatura dalle intestazioni. Colonna irriconosciuta = `null`
 * (non importata): la decisione tocca a una persona, e il passo due gliela
 * mostra. Se due colonne chiedono lo stesso campo vince la PRIMA: la seconda
 * resta da decidere, perché due fonti per lo stesso dato non si scelgono da
 * sole.
 */
export function suggestMapping(headers: readonly string[]): Array<ImportField | null> {
  const taken = new Set<ImportField>();
  return headers.map((h) => {
    const field = ALIAS_LOOKUP.get(normHeader(h)) ?? null;
    if (field && taken.has(field)) return null;
    if (field) taken.add(field);
    return field;
  });
}

/** Vero se la mappatura copre almeno un modo di dare un nome alla riga. */
export function mappingHasName(mapping: ColumnMapping): boolean {
  return mapping.includes('org.display_name')
    || (mapping.includes('person.first_name') && mapping.includes('person.last_name'));
}

// ---------------------------------------------------------------------------
// I ruoli: dalla parola al valore dell'enum
// ---------------------------------------------------------------------------

const ROLE_ALIASES: Record<CrmOrganizationRole, readonly string[]> = {
  lead: ['lead'],
  prospect: ['prospect', 'prospetto'],
  customer: ['cliente', 'kunde', 'client', 'customer'],
  former_customer: [
    'ex cliente', 'ex-cliente', 'ehemaliger kunde', 'ancien client',
    'former customer', 'former_customer',
  ],
  supplier: ['fornitore', 'lieferant', 'fournisseur', 'supplier'],
  partner: ['partner', 'partenaire'],
  authority: ['ente', 'autorita', 'behorde', 'autorite', 'authority', 'amt'],
  other: ['altro', 'sonstige', 'andere', 'autre', 'other'],
};

const ROLE_LOOKUP: ReadonlyMap<string, CrmOrganizationRole> = (() => {
  const map = new Map<string, CrmOrganizationRole>();
  for (const [role, aliases] of Object.entries(ROLE_ALIASES) as Array<[CrmOrganizationRole, readonly string[]]>) {
    map.set(role.replace(/_/g, ' '), role);
    for (const alias of aliases) {
      const key = alias.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (!map.has(key)) map.set(key, role);
    }
  }
  return map;
})();

/**
 * Il campo ruolo, che può portarne più di uno separati da virgola («cliente,
 * fornitore»). Le parole sconosciute non si indovinano: vengono restituite
 * perché la riga le dichiari come errore, invece di importarle come «altro».
 */
export function parseRoles(raw: string): { roles: CrmOrganizationRole[]; unknown: string[] } {
  const roles: CrmOrganizationRole[] = [];
  const unknown: string[] = [];
  for (const piece of raw.split(',')) {
    const key = piece.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    if (key === '') continue;
    const role = ROLE_LOOKUP.get(key);
    if (role) {
      if (!roles.includes(role)) roles.push(role);
    } else {
      unknown.push(piece.trim());
    }
  }
  return { roles, unknown };
}

// ---------------------------------------------------------------------------
// La riga: dai valori grezzi alla bozza validata
// ---------------------------------------------------------------------------

/** I valori di una riga, già assegnati ai campi ma non ancora giudicati. */
export interface ImportDraft {
  /** Il numero della riga NEL FILE, intestazione compresa: serve a dirla all'utente. */
  fileRow: number;
  displayName: string;
  legalName: string;
  uidChe: string;
  vatNumber: string;
  website: string;
  street: string;
  postalCode: string;
  city: string;
  canton: string;
  countryCode: string;
  notes: string;
  roleRaw: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  email: string;
  phone: string;
  mobile: string;
}

const EMPTY_DRAFT: Omit<ImportDraft, 'fileRow'> = {
  displayName: '', legalName: '', uidChe: '', vatNumber: '', website: '',
  street: '', postalCode: '', city: '', canton: '', countryCode: '', notes: '',
  roleRaw: '', firstName: '', lastName: '', jobTitle: '',
  email: '', phone: '', mobile: '',
};

const DRAFT_KEY: Record<ImportField, keyof Omit<ImportDraft, 'fileRow'>> = {
  'org.display_name': 'displayName',
  'org.legal_name': 'legalName',
  'org.uid_che': 'uidChe',
  'org.vat_number': 'vatNumber',
  'org.website': 'website',
  'org.street': 'street',
  'org.postal_code': 'postalCode',
  'org.city': 'city',
  'org.canton': 'canton',
  'org.country_code': 'countryCode',
  'org.notes': 'notes',
  'org.role': 'roleRaw',
  'person.first_name': 'firstName',
  'person.last_name': 'lastName',
  'person.job_title': 'jobTitle',
  'contact.email': 'email',
  'contact.phone': 'phone',
  'contact.mobile': 'mobile',
};

/** Applica la mappatura: ogni riga del file diventa una bozza. */
export function buildDrafts(parsed: ParsedCsv, mapping: ColumnMapping): ImportDraft[] {
  return parsed.rows.map((cells, idx) => {
    const draft: ImportDraft = { ...EMPTY_DRAFT, fileRow: idx + 2 };
    cells.forEach((cell, col) => {
      const field = mapping[col];
      if (!field) return;
      const key = DRAFT_KEY[field];
      // La prima colonna non vuota vince: due colonne sullo stesso campo non
      // dovrebbero arrivare qui (suggestMapping lo impedisce), ma la mano
      // dell'utente no.
      if (draft[key] === '') draft[key] = cell.trim();
    });
    return draft;
  });
}

/** Il nome con cui la riga diventerebbe un'anagrafica: l'organizzazione, o la persona. */
export function effectiveName(d: Pick<ImportDraft, 'displayName' | 'firstName' | 'lastName'>): string {
  const org = d.displayName.trim();
  if (org !== '') return org;
  // La persona conta solo se c'è TUTTA: con un nome solo non si sa chi sia, e
  // una riga così non è importabile — non deve nemmeno produrre un nome.
  const first = d.firstName.trim();
  const last = d.lastName.trim();
  return first !== '' && last !== '' ? `${first} ${last}` : '';
}

/**
 * A CHI vanno i recapiti della riga. §127 — se c'è una persona, l'email e i
 * telefoni sono SUOI; senza persona, sono dell'organizzazione. «C'è una
 * persona» vuol dire nome E cognome: con uno solo non si sa chi sia, e creare
 * una persona a metà riempie il CRM di sconosciuti.
 */
export function contactRoute(d: Pick<ImportDraft, 'firstName' | 'lastName'>): 'person' | 'organization' {
  return d.firstName.trim() !== '' && d.lastName.trim() !== '' ? 'person' : 'organization';
}

// ---------------------------------------------------------------------------
// La validazione — i codici, MAI il testo: le parole stanno nei dizionari
// ---------------------------------------------------------------------------

export type ImportRowErrorCode =
  | 'missingName'
  | 'invalidEmail'
  | 'invalidCanton'
  | 'invalidUid'
  | 'unknownRole'
  | 'invalidCountry'
  | 'invalidWebsite';

// Volutamente semplice: la verifica vera la fa il recapito quando qualcuno
// scrive a quell'indirizzo. Qui si rifiuta solo ciò che è malformato senza
// dubbio — spazi, chiocciola mancante, dominio senza punto.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Giudica una bozza. Ogni errore è un CODICE che la schermata traduce in
 * linguaggio umano: qui non si scrive nemmeno una parola, perché una frase
 * italiana in questo file finirebbe dentro un'interfaccia tedesca.
 *
 * ⚠️ L'IDI lo giudica `normUid` (la cifra di controllo del modulo, terza copia
 * dichiarata dell'algoritmo): un IDI che non torna è un errore DELLA RIGA, non
 * un valore da salvare tanto `uid_norm` resta null.
 */
export function validateDraft(d: ImportDraft): ImportRowErrorCode[] {
  const errors: ImportRowErrorCode[] = [];
  if (effectiveName(d) === '') errors.push('missingName');
  if (d.email !== '' && !EMAIL_RE.test(d.email.toLowerCase())) errors.push('invalidEmail');
  if (d.canton !== '' && !/^[a-z]{2}$/i.test(d.canton)) errors.push('invalidCanton');
  if (d.uidChe !== '' && normUid(d.uidChe) === null) errors.push('invalidUid');
  if (d.roleRaw !== '' && parseRoles(d.roleRaw).unknown.length > 0) errors.push('unknownRole');
  if (d.countryCode !== '' && !/^[a-z]{2}$/i.test(d.countryCode)) errors.push('invalidCountry');
  // Il servizio RIFIUTA un sito che non è http(s) — meglio dirlo qui che far
  // fallire la riga a metà import.
  if (d.website !== '' && safeWebsite(d.website) === null) errors.push('invalidWebsite');
  return errors;
}

// ---------------------------------------------------------------------------
// I duplicati — mostrati, MAI risolti da soli
// ---------------------------------------------------------------------------

/**
 * L'indice delle anagrafiche esistenti, caricato UNA volta prima dell'anteprima.
 * Sono chiavi normalizzate, non righe: la deduplicazione confronta chiavi, e
 * meno dati girano meglio è.
 */
export interface ExistingIndex {
  /** `uid_norm` delle organizzazioni del tenant (solo IDI con cifra valida). */
  uids: ReadonlySet<string>;
  /** `normalized_value` dei recapiti email del tenant. */
  emails: ReadonlySet<string>;
  /** `website_domain` delle organizzazioni del tenant. */
  domains: ReadonlySet<string>;
  /** Ragioni sociali normalizzate con `normNameKey`. */
  names: ReadonlySet<string>;
}

export type DuplicateKind =
  /** IDI valido già presente: il vincolo unico VIETA l'insert. Solo «salta». */
  | 'hardUid'
  /** Stesso IDI valido su due righe del file: si importa la prima. */
  | 'internalUid'
  /** Email già registrata su un recapito del tenant. */
  | 'email'
  /** Stessa email su due righe del file. */
  | 'internalEmail'
  /** Dominio del sito identico (non pubblico). */
  | 'domain'
  /** Ragione sociale normalizzata identica. */
  | 'name';

export interface DuplicateFlag {
  kind: DuplicateKind;
}

/**
 * La ragione sociale in forma di confronto: minuscole, accenti tolti, tutto ciò
 * che non è lettera o cifra in spazio. «Rossi SA» e «rossi  sa» collidono,
 * «Rossi» e «Rossi SA» NO — la normalizzazione è un SOSPETTO e non
 * un'identità (§24: «Swisscom» e «Swisscom SA» restano soggetti diversi finché
 * nessuno dice il contrario), quindi non si toglie MAI la forma giuridica.
 */
export function normNameKey(value: string | null | undefined): string | null {
  const v = (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return v === '' ? null : v;
}

/**
 * Classifica ogni bozza contro l'indice e contro il file stesso, nella scala di
 * §25: IDI valido → duro; email → mostrato; dominio non pubblico → mostrato;
 * nome normalizzato → mostrato. I duplicati DENTRO il file contano come gli
 * altri: due righe con lo stesso IDI valido non possono essere importate
 * entrambe, e la seconda è marcata.
 *
 * ⚠️ Un flag solo per riga, il più forte: la schermata mostra un motivo, non
 * una pila. L'ordine dei controlli È l'ordine della scala.
 */
export function flagDuplicates(
  drafts: readonly ImportDraft[],
  existing: ExistingIndex,
): Array<DuplicateFlag | null> {
  const seenUids = new Set<string>();
  const seenEmails = new Set<string>();
  return drafts.map((d) => {
    const uid = normUid(d.uidChe);
    if (uid && existing.uids.has(uid)) return { kind: 'hardUid' as const };
    if (uid && seenUids.has(uid)) return { kind: 'internalUid' as const };
    if (uid) seenUids.add(uid);

    const email = normEmail(d.email);
    if (email && existing.emails.has(email)) return { kind: 'email' as const };
    if (email && seenEmails.has(email)) return { kind: 'internalEmail' as const };
    if (email) seenEmails.add(email);

    const domain = normDomain(d.website);
    if (domain && !isPublicDomain(domain) && existing.domains.has(domain)) {
      return { kind: 'domain' as const };
    }

    const name = normNameKey(effectiveName(d));
    if (name && existing.names.has(name)) return { kind: 'name' as const };
    return null;
  });
}
