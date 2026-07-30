// ============================================================================
// Chiedi ad AI-Swisse — le corrispondenze dell'interfaccia
//
// Solo mappe e funzioni pure: nessuna chiamata, nessuno stato. Sta a parte
// dalla schermata per la stessa ragione di `financeModel.ts` e `crmModel.ts` —
// così si può provare senza montare React.
// ============================================================================
import type { IconName } from '@/components/ui/Icon';
import type { TKey } from '@/i18n';
import type { AssistantAnswerStatus, AssistantCitation, AssistantSourceType } from '@/types/models';

/**
 * §113 — che cosa mostrare mentre il sistema lavora.
 *
 * ⚠️ Nessuna di queste frasi descrive un pensiero. «Cerco nelle attività» dice
 * che cosa il SISTEMA sta facendo; «sto ragionando passo per passo» direbbe che
 * cosa il modello sta pensando, e quel racconto non è verificabile né utile.
 * Il modulo arriva dall'evento: la corrispondenza strumento → modulo la conosce
 * il registro server-side, e ricostruirla qui sarebbe una seconda copia.
 */
const RUNNING_KEY: Record<string, TKey> = {
  overview: 'assistant.running.overview',
  tasks: 'assistant.running.tasks',
  documents: 'assistant.running.documents',
  inbox: 'assistant.running.inbox',
  finance: 'assistant.running.finance',
  contracts: 'assistant.running.contracts',
  crm: 'assistant.running.crm',
  workflows: 'assistant.running.workflows',
  answer: 'assistant.running.answer',
};

export const runningKey = (module: string): TKey =>
  RUNNING_KEY[module] ?? 'assistant.running.start';

/** L'icona di una fonte. Solo nomi già presenti in `Icon.tsx`. */
const SOURCE_ICON: Record<AssistantSourceType, IconName> = {
  document: 'document',
  document_evidence: 'fileSearch',
  email_message: 'mail',
  task: 'checkCircle',
  finance_item: 'receipt',
  contract: 'fileSignature',
  contract_milestone: 'calendar',
  contract_term: 'fileSignature',
  crm_organization: 'user',
  crm_opportunity: 'star',
  workflow_run: 'settings',
  workflow_definition: 'settings',
  company_overview: 'home',
};

export const sourceIcon = (type: AssistantSourceType): IconName => SOURCE_ICON[type] ?? 'document';
export const sourceTypeKey = (type: AssistantSourceType): TKey =>
  `assistant.types.${type}` as TKey;

export const statusKey = (status: AssistantAnswerStatus): TKey =>
  `assistant.status.${status}` as TKey;

/**
 * La classe della pastiglia di esito.
 *
 * ⚠️ Il colore NON è l'unico segnale (§167): accanto c'è sempre l'etichetta
 * testuale, e la pastiglia esiste solo per gli esiti che NON sono una risposta
 * piena — una risposta normale non ha bisogno di essere annunciata.
 */
export function statusBadgeClass(status: AssistantAnswerStatus): string | null {
  switch (status) {
    case 'answered': return null;
    case 'partial': return 'badge badge-media';
    case 'insufficient_evidence': return 'badge badge-neutral';
    case 'needs_disambiguation': return 'badge badge-blue';
    case 'out_of_scope': return 'badge badge-neutral';
  }
}

/** Gli esiti che meritano una riga di spiegazione sotto la risposta. */
export const statusNeedsHint = (status: AssistantAnswerStatus): boolean => status !== 'answered';

/**
 * Il testo della pastiglia di una fonte: «Fattura · Swisscom 847291».
 * Il tipo e il conteggio li traduce chi chiama, perché qui non si entra in React.
 *
 * ⚠️ UN GRUPPO DI UNO NON È «1 elementi». Fino al 2026-07-30 ogni citazione
 * aggregata mostrava soltanto il conteggio: a schermo comparivano cinque
 * pastiglie identiche — «1 elementi», «1 elementi», … — distinguibili solo
 * dall'icona, e due avevano pure la stessa icona. Un gruppo di uno si NOMINA;
 * il conteggio serve solo quando gli elementi sono davvero più d'uno.
 */
export function citationLabel(
  citation: AssistantCitation, typeLabel: string, countLabel: (count: number) => string,
): string {
  const title = citation.title.trim();
  const named = title && title !== '—' ? title : null;
  if (!isGroupCitation(citation)) return named ? `${typeLabel} · ${named}` : typeLabel;
  // ⚠️ Per un gruppo il titolo DESCRIVE GIÀ l'insieme — «Contratti da
  // verificare», «Attività non assegnate» — ed è l'unica cosa che distingue due
  // letture dello stesso elenco con filtri diversi. Ripetergli davanti il tipo
  // direbbe «Contratto · Contratti da verificare»; usare invece il nome
  // dell'unico elemento farebbe tornare due pastiglie identiche quando le due
  // ricerche cadono sullo stesso record. I nomi dei record stanno nel pannello
  // delle fonti, che esiste per quello.
  const base = named ?? typeLabel;
  const size = citation.groupSize ?? 0;
  return size > 1 ? `${base} · ${countLabel(size)}` : base;
}

/**
 * §57 — due citazioni indistinguibili sono una sola pastiglia.
 *
 * Una domanda può passare due volte dallo stesso elenco con filtri diversi. Se
 * ne escono la stessa rotta, lo stesso titolo e gli stessi elementi, le due
 * schede sono identiche per chi legge — visto il 2026-07-30 con «Contratti
 * trovati» ripetuto due volte, uguale in tutto tranne un parametro invisibile
 * nell'indirizzo — e ripeterle è solo rumore. Si tiene la prima.
 *
 * ⚠️ NON si accorpano citazioni che differiscono per rotta o per titolo: là la
 * differenza si vede a schermo, ed è informazione. Questa funzione toglie i
 * doppioni, non riassume.
 */
export function dedupeCitations(list: AssistantCitation[]): AssistantCitation[] {
  const seen = new Set<string>();
  const out: AssistantCitation[] = [];
  for (const c of list) {
    const key = [
      c.sourceType, c.route, c.title, c.sourceId ?? '',
      groupItems(c).map((i) => i.route).join(','),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * §126 — una fonte eliminata non deve produrre un collegamento morto.
 *
 * Non si può sapere da qui se la riga esiste ancora: la citazione conserva un
 * puntatore, non la fonte. Ciò che si può fare è distinguere le due forme —
 * una fonte singola porta a una scheda, un gruppo porta a un elenco — e lasciare
 * che sia la pagina di destinazione a dire «non trovato», come già fa per ogni
 * altro indirizzo del prodotto. Inventare qui un controllo di esistenza
 * significherebbe una interrogazione per ogni pastiglia (§165).
 */
export const isGroupCitation = (c: AssistantCitation): boolean => c.groupSize != null;

/** Gli elementi di una citazione aggregata, se l'istantanea li porta con sé. */
export function groupItems(c: AssistantCitation): { title: string; route: string }[] {
  const raw = c.valueSnapshot?.items;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i): i is { title: string; route: string } =>
      !!i && typeof i === 'object'
      && typeof (i as { title?: unknown }).title === 'string'
      && typeof (i as { route?: unknown }).route === 'string')
    .slice(0, 12);
}

/** §120 — il contesto entità arriva dall'indirizzo, in forma `tipo:identificativo`. */
export const ENTITY_PARAM = 'su';
export const ENTITY_LABEL_PARAM = 'nome';

const ENTITY_TYPES = ['contract', 'crm_organization', 'finance_item', 'document', 'task'] as const;
export type EntityContextType = (typeof ENTITY_TYPES)[number];

export function parseEntityContext(
  raw: string | null, label: string | null,
): { type: EntityContextType; id: string; label: string } | null {
  if (!raw) return null;
  const [type, id] = raw.split(':');
  if (!id || !(ENTITY_TYPES as readonly string[]).includes(type)) return null;
  return { type: type as EntityContextType, id, label: (label ?? '').slice(0, 120) };
}

/** L'indirizzo che apre l'assistente con una scheda già in contesto. */
export function askAboutHref(type: EntityContextType, id: string, label: string): string {
  const params = new URLSearchParams();
  params.set(ENTITY_PARAM, `${type}:${id}`);
  if (label) params.set(ENTITY_LABEL_PARAM, label.slice(0, 120));
  return `/assistente?${params.toString()}`;
}
