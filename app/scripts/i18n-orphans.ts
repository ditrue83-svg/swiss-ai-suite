// ============================================================================
// Chiavi di traduzione ORFANE: voci dei dizionari che nessuno chiama più.
//   npm run i18n:orphans
//   npm run i18n:orphans -- --list        (elenca tutte le orfane, non solo le prime)
//   npm run i18n:orphans -- --self-test   (solo l'autoverifica del rilevatore)
//
// PERCHÉ ESISTE, con due casi veri e datati.
// Il 2026-08-13, dopo la PR #44, `subsidy.results.priority` è rimasta in tre
// dizionari senza un chiamante (le due schermate che la usavano erano passate a
// `PriorityMark`) e `L.eligibility` senza nessuno che la invocasse. Nessun
// guardiano se ne è accorto: `i18n:coverage` cerca il TESTO SCRITTO A MANO nei
// componenti, cioè il difetto opposto — una frase che NON passa dal dizionario.
// Una chiave che non passa più da nessun codice è invisibile a quel controllo,
// e le due sono state trovate solo cercando i marcatori nel bundle SERVITO da
// app.ai-swisse.com dopo il merge. Una chiave orfana è una seconda fonte di
// verità che aspetta di essere ripescata: la frase resta lì, invecchia con il
// prodotto, e un giorno qualcuno la richiama credendola viva.
//
// PERCHÉ LEGGE IL DIZIONARIO IMPORTANDOLO, e non con una regex.
// La storia di questo progetto è piena di rilevatori che mentivano perché
// leggevano un sorgente con un'espressione regolare (i18n:coverage due volte,
// `grep` cieco su un byte NUL). Qui il dizionario si IMPORTA: `it` è l'oggetto
// vero, con le sue foglie vere. Basta `it` perché `de.ts` e `fr.ts` sono
// tipizzati `Dictionary`: una chiave mancante o una di troppo rompe
// `npm run typecheck` prima di arrivare qui — l'insieme delle chiavi è uno solo
// e lo garantisce il compilatore, non questo file.
//
// COME RICONOSCE UN USO
// Un tokenizzatore percorre ogni sorgente una volta sola distinguendo codice,
// commenti, stringhe, template ed espressioni regolari, e raccoglie:
//   · i letterali con dei punti          t('tasks.dueNone'), labelKey: 'a.b.c'
//   · il prefisso statico dei template   `subsidy.cases.statuses.${k}` → nodo
//   · i letterali che finiscono in punto 'incentives.reasons.' + r.key → nodo
// Un token che corrisponde a un NODO (non a una foglia) vale per tutto ciò che
// gli sta sotto: è così che `pick('subsidy.labels.eligibility', v)` in
// `labels.ts` copre i quattro stati senza che nessuno li nomini.
//
// ⚠️ I COMMENTI NON CONTANO COME USO, ed è il motivo del tokenizzatore.
// Una chiave citata solo in un commento — e questo codice ne cita parecchie,
// per spiegare perché una scelta è stata fatta — resterebbe «viva» per sempre.
// Toglierli con una regex `//.*$` non si può: `'https://…'` perderebbe metà
// riga, ed è esattamente il difetto già pagato da `i18n-coverage` («i commenti
// vanno saltati PRIMA delle virgolette»).
//
// ⚠️ IL LIMITE, DICHIARATO. Una chiave raggiunta per ACCESSO A PROPRIETÀ e mai
// scritta come stringa (`it.tasks.areaSubtitle` dentro un test) non è vista
// come usata. È deliberato: quello è l'uso di un CONTROLLO, non del prodotto —
// una chiave che solo un test nomina è comunque una chiave che l'interfaccia
// non mostra a nessuno. Se un giorno servisse il contrario, si dichiara
// un'eccezione con la sua riga.
//
// ⚠️⚠️ E IL ROVESCIO DEL PREFISSO: UNA SEZIONE COPERTA PER INTERO È UNA SEZIONE
// CIECA. Il prefisso statico di un template è la regola giusta per
// `t(`stati.${k}`)`, ma il 2026-08-20 la controprova ha mostrato DIECI sezioni
// intere in cui nessuna chiave, presente o futura, poteva più risultare orfana
// (cancellata l'unica chiamante di `home.datesMixed`, il verde restava verde).
// I colpevoli erano di tre specie, tutti dentro `scripts/`: un check che
// COMPONE la chiave da cercare (`home.${chiave}` in `test-shell-unit.ts`),
// quattro `startsWith('tasks.')` e simili nei test unitari (nav, tasks,
// notifications, finance), e le email usa-e-getta `subsidy.${label}.…@` di
// cinque test d'integrazione (subsidy, assistant, contracts, crm, audit).
// Sotto quella coperta si erano accumulate 103 orfane vere. Da allora la
// scansione pretende che in ogni sezione di primo livello una foglia
// inesistente POSSA uscire orfana: se non può, il colpevole è un token da
// correggere alla fonte, o una cecità da dichiarare in CECITA_DICHIARATE.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from '../src/i18n/locales/it.ts';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Le cartelle in cui si cerca un uso. `src/i18n/locales` NO: là le chiavi
 *  sono DEFINITE, e contarne la definizione come uso renderebbe tutto vivo. */
const CERCA_IN = ['src', 'supabase/functions', 'scripts'];
const NON_CERCARE = new Set([join(APP, 'src/i18n/locales')]);

/**
 * ⚠️ QUESTO FILE NON GUARDA SÉ STESSO, e senza questa riga il meccanismo delle
 * eccezioni non funzionava affatto: le chiavi scritte in `ECCEZIONI` sono
 * letterali in un sorgente dentro `scripts/`, quindi il rilevatore le contava
 * come USI — l'orfana spariva dall'elenco, l'eccezione restava senza niente
 * dietro, e ogni eccezione dichiarata nasceva morta. Trovato con la
 * controprova, non con un caso inventato: il caso «un'eccezione copre
 * un'orfana vera» usciva rosso invece che verde. Qui una chiave è DICHIARATA,
 * come nei dizionari, non usata.
 */
const NON_LEGGERE = new Set([join(APP, 'scripts/i18n-orphans.ts')]);

// ---------------------------------------------------------------------------
// LE ECCEZIONI, una riga ciascuna con il motivo.
//
// ⚠️ Come in `design:lint` e nella sezione 7 di `test:shell-unit`: ciò che non
// passa dal controllo passa da una frase che si può contestare, e un'eccezione
// SENZA PIÙ NIENTE DIETRO fa fallire il controllo. Un'esenzione sopravvissuta a
// ciò che esentava è una porta lasciata aperta.
//
// Si dichiara una CHIAVE ESATTA o un NODO (che copre le sue foglie).
// ---------------------------------------------------------------------------
// ⚠️⚠️ IL DEBITO RIVELATO IL 2026-08-20, quando le dieci sezioni cieche sono
// tornate visibili: 103 chiavi che nessun codice chiama, accumulate mentre il
// rilevatore non poteva vederle. NON sono benedette: ogni riga aspetta lo
// smaltimento — cancellare dai TRE dizionari, dopo il controllo che la chiave
// non sia composta a runtime in un modo che il rilevatore non vede — in un
// intervento suo. Il controllo delle «eccezioni morte» qui sotto pretende che
// ogni riga sparisca il giorno che la sua chiave viene usata o cancellata:
// nessuna può sopravvivere in silenzio a ciò che la giustifica.
const MOTIVO_RIVELATE = "orfana rivelata il 2026-08-20 dal ritorno alla vista delle sezioni cieche; da smaltire in un intervento dedicato";

export const ECCEZIONI: { chiave: string; motivo: string }[] = [
  // —   tasks  (37)
  { chiave: 'tasks.title', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.subtitle', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.empty', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.emptySub', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.markDone', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.reopen', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.completed', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.noDueDate', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.dueOn', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.added', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.deleted', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.addManual', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.dueDate', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.noneInView', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.authorityField', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.authorityPlaceholder', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.listTitle', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.filterOpen', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.filterDone', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.filterAll', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.daysLeft', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.overdueShort', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.statusDone', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.statusAria', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.deleteAria', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.filterSource', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.assignTo', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.sourceLabel', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.descriptionEmpty', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.linkedEmail', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.openEmail', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.edit', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.save', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.errors.titleRequired', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.priority.high', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.priority.medium', motivo: MOTIVO_RIVELATE },
  { chiave: 'tasks.priority.low', motivo: MOTIVO_RIVELATE },
  // —   crm  (27)
  { chiave: 'crm.kpi.suggestions', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.detail.edit', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.detail.merge', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.detail.linkItem', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.detail.contactMethods', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.timeline.title', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.people.firstName', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.people.lastName', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.people.department', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.people.language', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.people.languageUnknown', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.people.archive', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.opp.stageHistory', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.suggestions.empty', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.suggestions.reason', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.duplicates.merge', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.duplicates.mergeWarning', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.duplicates.mergeConfirm', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.duplicates.empty', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.registry.modified', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.form.country', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.form.status', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.form.owner', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.form.merged', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.form.unlinkedOk', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.errors.duplicateEmail', motivo: MOTIVO_RIVELATE },
  { chiave: 'crm.errors.duplicateUid', motivo: MOTIVO_RIVELATE },
  // —   contracts  (23)
  { chiave: 'contracts.detail.explanation', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.detail.sections.documents', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.detail.sections.tasks', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.detail.fields.vatIncluded', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.detail.fields.governingLaw', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.detail.fields.jurisdiction', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.detail.fields.note', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.terms.verifying', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.terms.editHint', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.terms.correct', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.terms.corrected', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.terms.readValue', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.terms.history', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.terms.supersededOn', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.amendment.noChanges', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.milestones.title', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.milestones.calculatedFrom', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.milestones.addManual', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.milestones.addManualHint', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.documents.suggestions', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.documents.suggestionHint', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.tasks.open', motivo: MOTIVO_RIVELATE },
  { chiave: 'contracts.archiveHint', motivo: MOTIVO_RIVELATE },
  // —   finance  (6)
  { chiave: 'finance.list.loadError', motivo: MOTIVO_RIVELATE },
  { chiave: 'finance.detail.retryHint', motivo: MOTIVO_RIVELATE },
  { chiave: 'finance.errors.generic', motivo: MOTIVO_RIVELATE },
  { chiave: 'finance.errors.correctionFailed', motivo: MOTIVO_RIVELATE },
  { chiave: 'finance.errors.fieldNotEditable', motivo: MOTIVO_RIVELATE },
  { chiave: 'finance.add.alreadyPresent', motivo: MOTIVO_RIVELATE },
  // —   assistant  (6)
  { chiave: 'assistant.threads.open', motivo: MOTIVO_RIVELATE },
  { chiave: 'assistant.threads.rename', motivo: MOTIVO_RIVELATE },
  { chiave: 'assistant.threads.renamePrompt', motivo: MOTIVO_RIVELATE },
  { chiave: 'assistant.sources.show', motivo: MOTIVO_RIVELATE },
  { chiave: 'assistant.degraded', motivo: MOTIVO_RIVELATE },
  { chiave: 'assistant.disambiguation', motivo: MOTIVO_RIVELATE },
  // —   notifications  (3)
  { chiave: 'notifications.unreadOne', motivo: MOTIVO_RIVELATE },
  { chiave: 'notifications.unreadMany', motivo: MOTIVO_RIVELATE },
  { chiave: 'notifications.noDeadline', motivo: MOTIVO_RIVELATE },
  // —   subsidy  (1)
  { chiave: 'subsidy.results.eligibilityToVerify', motivo: MOTIVO_RIVELATE },
];

// ---------------------------------------------------------------------------
// Il tokenizzatore
// ---------------------------------------------------------------------------

/**
 * DOVE PUÒ COMINCIARE UN'ESPRESSIONE REGOLARE, e perché non è la domanda che
 * sembra.
 *
 * ⚠️ LA PRIMA VERSIONE DI QUESTO FILE HA MENTITO SU 125 CHIAVI. Diceva «un `/`
 * apre una regex se NON segue un identificatore», che è la regola giusta per il
 * JavaScript e sbagliata per il JSX: in
 *     <MarkGlyph name="question" />{t('adminAi.result.needsReview')}</span>
 * il `/` di `/>` segue una virgoletta, veniva preso per l'inizio di una regex, e
 * la finta regex si chiudeva sul `/` di `</span>` — portandosi dentro la chiave.
 * Sei chiavi su sei del primo elenco erano usate e visibili con un grep. Non
 * l'ha scoperto un caso di prova: l'ha scoperto il confronto con il codice vero.
 *
 * Quindi si guarda dove una regex può DAVVERO cominciare — dopo un operatore,
 * una parentesi aperta, una virgola, un due punti — invece di elencare dove non
 * può. `>` è l'unico ambiguo: chiude una lambda (`=> /re/`) e chiude un tag
 * JSX (`/>`), e si distingue guardando la coppia.
 */
const APRE_REGEX = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', ';', '{', '+', '-', '*', '%', '^', '~']);

/**
 * I letterali di testo di un sorgente, commenti esclusi.
 *
 * Ritorna le stringhe complete (virgolette singole, doppie, template senza
 * interpolazione) e, per i template CON interpolazione, la sola parte statica
 * che precede il primo `${` — che è il prefisso da cui la chiave si compone.
 *
 * ⚠️⚠️ E ENTRA DENTRO LE INTERPOLAZIONI. La prima versione le SALTAVA contando
 * le graffe, e ha dichiarato orfane quattro chiavi vive che stavano proprio lì:
 *     `${t('calendar.dayAriaToday')}`   `· ${t('automations.runDuration', …)}`
 * Comporre una frase con dentro una traduzione è normale in questo codice, e un
 * lettore che si ferma sul bordo dell'interpolazione non legge il codice: legge
 * la sua cornice. Qui `${…}` torna a essere CODICE — con le sue stringhe, i
 * suoi commenti e i suoi template annidati.
 */
export function letterali(src: string): string[] {
  const out: string[] = [];
  scanCodice(src, 0, out, false);
  return out;
}

/** Gli ultimi `quanti` caratteri non-spazio prima di `at`, in ordine di lettura. */
function precedenti(src: string, at: number, quanti: number): string {
  const out: string[] = [];
  let k = at - 1;
  while (k >= 0 && out.length < quanti) {
    if (!/\s/.test(src[k])) out.push(src[k]);
    k--;
  }
  return out.reverse().join('');
}

function apreRegex(src: string, at: number): boolean {
  const p = precedenti(src, at, 1);
  if (p === '') return true;                     // inizio del file
  if (APRE_REGEX.has(p)) return true;
  // ⚠️ `>` è ambiguo: `=> /re/` è una lambda, `/>` è un tag JSX che si chiude.
  if (p === '>') return precedenti(src, at, 2) === '=>';
  return false;
}

/**
 * Percorre del CODICE da `start`, raccogliendo i letterali che incontra.
 * Con `fermaSuGraffa` si ferma sulla `}` che chiude l'interpolazione in cui
 * si trova, e ritorna l'indice dopo di essa.
 */
function scanCodice(src: string, start: number, out: string[], fermaSuGraffa: boolean): number {
  const n = src.length;
  let i = start;
  let graffe = 0;

  while (i < n) {
    const c = src[i];

    if (fermaSuGraffa && c === '}' && graffe === 0) return i + 1;
    if (c === '{') { graffe++; i++; continue; }
    if (c === '}') { graffe--; i++; continue; }

    // -- commenti: si saltano PRIMA di tutto il resto -----------------------
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // -- espressioni regolari: possono contenere virgolette ----------------
    if (c === '/' && apreRegex(src, i)) {
      i++;
      let classe = false;
      while (i < n) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '[') classe = true;
        else if (d === ']') classe = false;
        else if (d === '/' && !classe) { i++; break; }
        else if (d === '\n') break; // non era una regex: si esce e si prosegue
        i++;
      }
      continue;
    }

    // -- stringhe con virgolette -------------------------------------------
    if (c === "'" || c === '"') {
      const chiusura = c;
      let buf = '';
      i++;
      while (i < n) {
        const d = src[i];
        if (d === '\\') { buf += src[i + 1] ?? ''; i += 2; continue; }
        if (d === chiusura) { i++; break; }
        if (d === '\n') break; // stringa non chiusa: non si tira dietro il file
        buf += d;
        i++;
      }
      out.push(buf);
      continue;
    }

    if (c === '`') { i = scanTemplate(src, i, out); continue; }

    i++;
  }
  return i;
}

/** Percorre un template a partire dal suo backtick; ritorna l'indice dopo la chiusura. */
function scanTemplate(src: string, start: number, out: string[]): number {
  const n = src.length;
  let i = start + 1;
  let buf = '';
  let interpolato = false;

  while (i < n) {
    const d = src[i];
    if (d === '\\') { buf += src[i + 1] ?? ''; i += 2; continue; }
    if (d === '$' && src[i + 1] === '{') {
      interpolato = true;                        // da qui in poi la parte statica finisce
      i = scanCodice(src, i + 2, out, true);     // ⚠️ dentro è CODICE, non cornice
      continue;
    }
    if (d === '`') { i++; break; }
    if (!interpolato) buf += d;
    i++;
  }
  out.push(buf);
  return i;
}

/** Ha la forma di un percorso nel dizionario? (anche troncato col punto finale) */
const SEMBRA_CHIAVE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*\.?$/;

/** I token che possono nominare una chiave, presi da un sorgente. */
export function tokenChiave(src: string): string[] {
  return letterali(src)
    .map((s) => s.trim())
    .filter((s) => s.includes('.') && SEMBRA_CHIAVE.test(s));
}

// ---------------------------------------------------------------------------
// Il dizionario e il confronto
// ---------------------------------------------------------------------------

/** Tutte le foglie di un dizionario, come percorsi puntati. */
export function foglie(dict: unknown, prefisso = ''): string[] {
  if (typeof dict !== 'object' || dict === null) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(dict as Record<string, unknown>)) {
    const percorso = prefisso ? `${prefisso}.${k}` : k;
    if (v && typeof v === 'object') out.push(...foglie(v, percorso));
    else out.push(percorso);
  }
  return out;
}

/**
 * Le foglie che nessun token nomina.
 *
 * Un token vale per sé E per tutto ciò che gli sta sotto: un NODO nominato
 * (`pick('subsidy.labels.eligibility', v)`) copre le sue foglie, ed è
 * l'unico modo di non gridare su una chiave composta a runtime.
 *
 * Funzione PURA: si prova sui casi che devono farla fallire senza leggere un
 * file e senza un dizionario vero.
 */
export function orfane(tutteLeFoglie: string[], token: Iterable<string>): string[] {
  const nomi = new Set<string>();
  const prefissi: string[] = [];
  for (const t of token) {
    if (t.endsWith('.')) prefissi.push(t);
    else { nomi.add(t); prefissi.push(`${t}.`); }
  }
  return tutteLeFoglie.filter((f) => {
    if (nomi.has(f)) return false;
    return !prefissi.some((p) => f.startsWith(p));
  });
}

/**
 * Le sezioni di primo livello in cui il rilevatore è CIECO.
 *
 * Una sezione è cieca quando una sua foglia INESISTENTE non uscirebbe orfana:
 * vuol dire che un token copre l'intera sezione, e ogni chiave lì dentro —
 * presente e futura — è «viva» per definizione, non per uso. La domanda si fa
 * al meccanismo vero (`orfane`), con una sentinella che nessun dizionario può
 * contenere: se il modo di coprire un prefisso cambia là, questa risposta lo
 * segue da sola.
 *
 * Un prefisso a DUE o più segmenti non è cecità: coprire un sotto-nodo è la
 * funzione disegnata per `pick('subsidy.labels.eligibility', v)`.
 */
export function sezioniCieche(sezioni: string[], token: Iterable<string>): string[] {
  const t = [...token];
  return sezioni.filter((s) => orfane([`${s}.__sentinella_orfana__`], t).length === 0);
}

/**
 * Le cecità DICHIARATE, una riga ciascuna con il motivo: l'unico modo lecito
 * di comporre le chiavi di un'intera sezione a runtime (`t(`home.${k}`)` nel
 * PRODOTTO, non in un controllo). Come per ECCEZIONI: una dichiarazione senza
 * più niente dietro — la sezione torna visibile — fa fallire il controllo.
 */
export const CECITA_DICHIARATE: { sezione: string; motivo: string }[] = [];

// ---------------------------------------------------------------------------
// L'autoverifica: casi che DEVONO far fallire il rilevatore se si rompe
// ---------------------------------------------------------------------------
const DIZIONARIO_FINTO = {
  tasks: { titolo: 'x', sottotitolo: 'y' },
  stati: { aperto: 'a', chiuso: 'b' },
  etichette: { idoneita: { nota: 'n', probabile: 'p' } },
};

const CASI: { nome: string; src: string; attese: string[] }[] = [
  {
    nome: 'una chiave che nessuno chiama è orfana',
    src: "const a = t('tasks.titolo');",
    attese: ['tasks.sottotitolo', 'stati.aperto', 'stati.chiuso', 'etichette.idoneita.nota', 'etichette.idoneita.probabile'],
  },
  {
    nome: 'un letterale la tiene viva',
    src: "t('tasks.titolo'); t('tasks.sottotitolo'); t('stati.aperto'); t('stati.chiuso');\n"
      + "t('etichette.idoneita.nota'); t('etichette.idoneita.probabile');",
    attese: [],
  },
  {
    nome: 'un template con interpolazione copre il suo nodo',
    src: "t('tasks.titolo'); t('tasks.sottotitolo'); t(`stati.${k}` as TKey);\n"
      + "t('etichette.idoneita.nota'); t('etichette.idoneita.probabile');",
    attese: [],
  },
  {
    nome: 'un nodo nominato (pick) copre le sue foglie',
    src: "t('tasks.titolo'); t('tasks.sottotitolo'); t('stati.aperto'); t('stati.chiuso');\n"
      + "pick('etichette.idoneita', v);",
    attese: [],
  },
  {
    nome: 'un letterale che finisce in punto è un prefisso',
    src: "t('tasks.titolo'); t('tasks.sottotitolo'); const k = 'stati.' + v;\n"
      + "pick('etichette.idoneita', v);",
    attese: [],
  },
  {
    // ⚠️ IL CASO CHE GIUSTIFICA IL TOKENIZZATORE.
    nome: 'una chiave citata solo in un commento NON è usata',
    src: "// vedi t('tasks.sottotitolo'), che spiega la scelta\n"
      + "/* e anche stati.aperto, stati.chiuso */\n"
      + "t('tasks.titolo'); pick('etichette.idoneita', v);",
    attese: ['tasks.sottotitolo', 'stati.aperto', 'stati.chiuso'],
  },
  {
    // ⚠️ L'ALTRA METÀ: un commento non deve nemmeno MANGIARE il codice vero.
    nome: 'un indirizzo dentro una stringa non apre un commento',
    src: "const u = 'https://esempio.ch/x'; t('tasks.titolo'); t('tasks.sottotitolo');\n"
      + "t('stati.aperto'); t('stati.chiuso'); pick('etichette.idoneita', v);",
    attese: [],
  },
  {
    // ⚠️ Una regex con dentro una virgoletta non deve aprire una stringa che
    // si chiude molto più avanti, portandosi via le chiavi che incontra.
    nome: 'una regex con virgolette dentro non nasconde il codice che segue',
    src: "const r = /['\"]/g; t('tasks.titolo'); t('tasks.sottotitolo'); t('stati.aperto');\n"
      + "t('stati.chiuso'); pick('etichette.idoneita', v);",
    attese: [],
  },
  {
    // ⚠️⚠️ IL CASO CHE HA SMASCHERATO LA PRIMA VERSIONE, riprodotto alla
    // lettera dal file dove è successo. Un tag JSX che si chiude da solo, e
    // subito dopo la chiave: `/>` veniva letto come inizio di regex e la finta
    // regex si chiudeva sul `/` di `</span>`, mangiandosi la chiave in mezzo.
    nome: 'un tag JSX che si chiude da solo non nasconde la chiave che segue',
    src: "export function P() { return (\n"
      + "  <span className=\"vn-title\"><MarkGlyph name=\"question\" />{t('tasks.sottotitolo')}</span>\n"
      + "); }\n"
      + "t('tasks.titolo'); t('stati.aperto'); t('stati.chiuso'); pick('etichette.idoneita', v);",
    attese: [],
  },
  {
    // ⚠️⚠️ IL SECONDO CASO CHE HA SMASCHERATO IL RILEVATORE, e non l'ha trovato
    // un caso di prova: l'ha trovato il confronto col codice vero. Comporre una
    // frase con dentro una traduzione è normale qui, e chi salta il contenuto
    // di `${…}` non legge il codice — legge la sua cornice.
    nome: 'una chiave dentro un\'interpolazione conta come uso',
    src: "const a = `— ${t('tasks.sottotitolo')}`;\n"
      + "const b = `· ${t('stati.aperto', { n })} / ${t('stati.chiuso')}`;\n"
      + "t('tasks.titolo'); pick('etichette.idoneita', v);",
    attese: [],
  },
  {
    // Un template annidato dentro l'interpolazione di un altro: la stessa
    // funzione deve poter rientrare in sé stessa senza perdere il filo.
    nome: 'un template annidato non fa perdere il filo',
    src: "const a = `${x ? `— ${t('tasks.sottotitolo')}` : ''}`;\n"
      + "t('tasks.titolo'); t('stati.aperto'); t('stati.chiuso'); pick('etichette.idoneita', v);",
    attese: [],
  },
  {
    // L'altra metà: la freccia di una lambda apre davvero una regex, e se non
    // la si riconosce le virgolette che contiene aprono una finta stringa.
    nome: 'la regex dopo una freccia resta una regex',
    src: "const f = (s) => /['\"]/.test(s);\n"
      + "t('tasks.titolo'); t('tasks.sottotitolo'); t('stati.aperto'); t('stati.chiuso');\n"
      + "pick('etichette.idoneita', v);",
    attese: [],
  },
  {
    nome: 'una chiave che assomiglia a un percorso di file non conta come uso',
    src: "import x from './tasks.sottotitolo.js';\nt('tasks.titolo'); pick('etichette.idoneita', v);\n"
      + "t('stati.aperto'); t('stati.chiuso');",
    attese: ['tasks.sottotitolo'],
  },
];

/**
 * I casi della CECITÀ: sezioni intere che un token copre per sbaglio.
 * I primi due sono i casi VERI del 2026-08-20, riprodotti alla lettera.
 */
const CASI_CECITA: { nome: string; src: string; attese: string[] }[] = [
  {
    // ⚠️⚠️ IL CASO CHE HA SMASCHERATO LA CECITÀ, da `test-shell-unit.ts:1258`:
    // un check che COMPONE la chiave da cercare regala il prefisso `home.`,
    // e l'intera Panoramica smette di poter avere orfane. Trovato per
    // mutazione: tolta l'unica chiamante di `home.datesMixed`, verde immutato.
    nome: 'un check che compone la chiave col template rende cieca la sezione',
    src: 'check(`la pagina usa stati.${chiave}`, testo.includes(`stati.${chiave}`));',
    attese: ['stati'],
  },
  {
    // ⚠️ Il secondo caso vero: l'email di un utente usa-e-getta che porta il
    // nome del modulo. Cinque test d'integrazione coprivano così cinque
    // sezioni — un indirizzo di posta non nomina nessuna chiave.
    nome: 'un\'email usa-e-getta col nome di una sezione la rende cieca',
    src: 'const email = `stati.${label}.${stamp}@esempio.ch`;',
    attese: ['stati'],
  },
  {
    nome: 'un prefisso a due segmenti copre il sotto-nodo, non acceca la sezione',
    src: 't(`etichette.idoneita.${k}`);',
    attese: [],
  },
  {
    nome: 'una chiave esatta non acceca la sua sezione',
    src: "t('tasks.titolo'); t('stati.aperto');",
    attese: [],
  },
];

/** Un caso, valutato: le orfane per CASI, le sezioni cieche per CASI_CECITA. */
function valuta(caso: { src: string }, cecita: boolean): string[] {
  return cecita
    ? sezioniCieche(Object.keys(DIZIONARIO_FINTO), tokenChiave(caso.src)).sort()
    : orfane(foglie(DIZIONARIO_FINTO), tokenChiave(caso.src)).sort();
}

function casiRotti(): { nome: string; attese: string[]; trovate: string[] }[] {
  const rotti: { nome: string; attese: string[]; trovate: string[] }[] = [];
  for (const [gruppo, cecita] of [[CASI, false], [CASI_CECITA, true]] as const) {
    for (const caso of gruppo) {
      const trovate = valuta(caso, cecita);
      const attese = [...caso.attese].sort();
      if (trovate.join('|') !== attese.join('|')) rotti.push({ nome: caso.nome, attese, trovate });
    }
  }
  return rotti;
}

function autoverifica(): void {
  const rotti = new Map(casiRotti().map((r) => [r.nome, r]));
  console.log('\nAutoverifica del rilevatore\n');
  for (const caso of [...CASI, ...CASI_CECITA]) {
    const rotto = rotti.get(caso.nome);
    console.log(`  ${rotto ? '\x1b[31m✗\x1b[0m' : '\x1b[32m✓\x1b[0m'} ${caso.nome}`);
    if (rotto) console.log(`      attese: ${rotto.attese.join(', ') || '—'}\n      trovate: ${rotto.trovate.join(', ') || '—'}`);
  }
  if (rotti.size) {
    console.error(`\n  ${rotti.size} casi non superati: il rilevatore NON è affidabile.\n`);
    process.exit(1);
  }
  console.log('\n  Tutti i casi superati.\n');
}

// ---------------------------------------------------------------------------
// Esecuzione
// ---------------------------------------------------------------------------
const argomenti = process.argv.slice(2);
const ignoti = argomenti.filter((a) => a !== '--list' && a !== '--self-test');
if (ignoti.length) {
  console.error(`\n✗ Argomenti non riconosciuti: ${ignoti.join(' ')}`);
  console.error('  Si accettano: --list, --self-test.\n');
  process.exit(2);
}

if (argomenti.includes('--self-test')) {
  autoverifica();
  process.exit(0);
}

// L'autoverifica gira SEMPRE prima della scansione: se il rilevatore è rotto,
// il verde della scansione non significa niente e non va nemmeno stampato.
{
  const rotti = casiRotti();
  if (rotti.length) {
    console.error('\n✗ Il rilevatore non supera la propria autoverifica:');
    for (const c of rotti) console.error(`    ${c.nome}`);
    console.error('  Esegui: npm run i18n:orphans -- --self-test\n');
    process.exit(1);
  }
}

const sorgenti: string[] = [];
for (const radice of CERCA_IN) {
  const base = join(APP, radice);
  try { statSync(base); } catch { continue; }
  (function cammina(dir: string) {
    if (NON_CERCARE.has(dir)) return;
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) { if (nome !== 'node_modules') cammina(p); }
      else if (/\.(tsx?|mjs|js)$/.test(nome) && !NON_LEGGERE.has(p)) sorgenti.push(p);
    }
  })(base);
}

const token = new Set<string>();
// Da quale sorgente arriva ogni token: serve solo a NOMINARE il colpevole
// quando una sezione risulta cieca — un errore senza il file è una caccia.
const origine = new Map<string, string[]>();
for (const f of sorgenti) {
  for (const t of tokenChiave(readFileSync(f, 'utf8'))) {
    token.add(t);
    const dove = origine.get(t) ?? [];
    if (!dove.length) origine.set(t, dove);
    const rel = relative(APP, f);
    if (!dove.includes(rel)) dove.push(rel);
  }
}

// ⚠️⚠️ PRIMA DELLE ORFANE, LE SEZIONI DOVE LE ORFANE NON POSSONO ESISTERE.
// Senza questo controllo il verde qui sotto vale solo per le sezioni visibili:
// il 2026-08-20 erano cieche in sei, e nessuno lo sapeva.
{
  const cieche = sezioniCieche(Object.keys(it), token);
  const dichiarate = new Set(CECITA_DICHIARATE.map((c) => c.sezione));
  const mute = cieche.filter((s) => !dichiarate.has(s));
  const guarite = CECITA_DICHIARATE.filter((c) => !cieche.includes(c.sezione));

  if (mute.length) {
    console.error('\n\x1b[31m✗ Sezioni del dizionario in cui il rilevatore è CIECO:\x1b[0m');
    for (const s of mute) {
      const file = origine.get(`${s}.`) ?? [];
      console.error(`    ${s}.* — il token «${s}.» viene da: ${file.sort().join(', ') || '(nessun file: token composto?)'}`);
    }
    console.error('\n  Un token che copre un\'intera sezione rende «viva» ogni sua foglia, presente');
    console.error('  e futura: nessuna chiave lì dentro potrà mai risultare orfana. Si corregge il');
    console.error('  sorgente che produce il token (un template `sezione.${…}`, un letterale');
    console.error('  «sezione.») — o, se comporre quelle chiavi a runtime è il disegno del');
    console.error('  prodotto, si dichiara la sezione in CECITA_DICHIARATE con il suo motivo.\n');
    process.exit(1);
  }
  if (guarite.length) {
    console.error('\n\x1b[31m✗ Cecità dichiarate senza più niente dietro:\x1b[0m');
    for (const c of guarite) console.error(`    ${c.sezione} — ${c.motivo}`);
    console.error('\n  La sezione è tornata visibile: la riga va tolta da CECITA_DICHIARATE,');
    console.error('  non dimenticata — un\'esenzione sopravvissuta a ciò che esentava è una');
    console.error('  porta lasciata aperta.\n');
    process.exit(1);
  }
}

const tutteLeFoglie = foglie(it);
const trovate = orfane(tutteLeFoglie, token);

// Le eccezioni si applicano DOPO, e si pretende che servano a qualcosa.
const coperta = (chiave: string, e: string) => chiave === e || chiave.startsWith(`${e}.`);
const usate = new Set<string>();
const residue = trovate.filter((k) => {
  const e = ECCEZIONI.find((x) => coperta(k, x.chiave));
  if (e) { usate.add(e.chiave); return false; }
  return true;
});
const morte = ECCEZIONI.filter((e) => !usate.has(e.chiave));

console.log('\nChiavi di traduzione orfane — voci che nessun codice chiama più');
console.log(`\x1b[2m(rilevatore verificato su ${CASI.length + CASI_CECITA.length} casi noti · `
  + `${tutteLeFoglie.length} chiavi, ${sorgenti.length} sorgenti, ${token.size} riferimenti)\x1b[0m\n`);

if (morte.length) {
  console.error('\x1b[31m✗ Eccezioni senza più niente dietro:\x1b[0m');
  for (const e of morte) console.error(`    ${e.chiave} — ${e.motivo}`);
  console.error('\n  Un\'esenzione sopravvissuta a ciò che esentava è una porta lasciata aperta:');
  console.error('  la riga va tolta da ECCEZIONI, non dimenticata.\n');
  process.exit(1);
}

if (!residue.length) {
  // Il verde dice la verità: «ogni chiave ha un chiamante» solo se nessuna
  // eccezione ha assorbito niente — altrimenti le orfane ci sono, e si contano.
  const assorbite = trovate.length - residue.length;
  console.log(assorbite
    ? `  \x1b[32mNessuna nuova\x1b[0m: le ${assorbite} note restano dichiarate in ECCEZIONI, in attesa di smaltimento.\n`
    : '  \x1b[32mNessuna: ogni chiave dei dizionari ha almeno un chiamante.\x1b[0m\n');
  process.exit(0);
}

const perGruppo = new Map<string, string[]>();
for (const k of residue) {
  const g = k.split('.')[0];
  perGruppo.set(g, [...(perGruppo.get(g) ?? []), k]);
}
const mostraTutte = argomenti.includes('--list') || residue.length <= 40;
for (const [g, keys] of [...perGruppo].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${g}  (${keys.length})`);
  if (mostraTutte) for (const k of keys) console.log(`    ${k}`);
}
if (!mostraTutte) console.log('\n  (elenco completo: npm run i18n:orphans -- --list)');
console.log(`\n  ${residue.length} orfane su ${tutteLeFoglie.length} chiavi, in ${perGruppo.size} sezioni`);
console.log('  Ogni voce va tolta dai TRE dizionari, oppure dichiarata in ECCEZIONI con il suo motivo.');
console.log('  ⚠️ Prima di cancellare: controllare che non sia composta a runtime in un modo');
console.log('     che questo rilevatore non vede — una chiave viva tolta è peggio di una morta.\n');
process.exit(1);
