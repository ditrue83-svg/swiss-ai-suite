// ============================================================================
// LA RILEVANZA — quanto un programma è pertinente A QUESTO PROGETTO.
//
// ⚠️ LA RILEVANZA NON È LA PROBABILITÀ DI OTTENERE IL CONTRIBUTO (§44). È il
// principio che il modulo 1.0 aveva già e che va conservato: un programma può
// essere perfettamente pertinente e l'impresa non averne diritto, e può essere
// poco pertinente e l'impresa averlo. Sono due domande diverse, e questo file
// risponde solo alla prima.
//
// ⚠️ IL PUNTEGGIO È INTERNO (§45). Serve a ordinare l'elenco. Fuori di qui
// esiste solo la FASCIA — alta, media, bassa — perché un numero su cento letto
// da un imprenditore diventa una percentuale di successo, che è una cosa che
// nessuno in questo sistema sa.
//
// ⚠️ LE RAGIONI SONO CHIAVI DI TRADUZIONE CON PARAMETRI, MAI FRASI (§46). Una
// frase italiana scritta qui finirebbe dentro `subsidy_assessments` e
// comparirebbe identica nell'interfaccia tedesca — è la trappola che il
// generatore di automazioni ha già pagato.
//
// Modulo PORTABILE: nessun import di runtime.
// ============================================================================

import type { RelevanceLevel } from './contract.ts';
import {
  RELEVANCE_FLOOR, RELEVANCE_HIGH_MIN, RELEVANCE_MEDIUM_MIN, RELEVANCE_REQUIRES_SIGNAL,
} from './contract.ts';

/** Il profilo su cui si misura la pertinenza. */
export interface RelevanceInput {
  /** Cantone del PROGETTO se dichiarato, altrimenti quello dell'impresa. */
  canton: string | null;
  country: string | null;
  sector: string | null;
  employeeCount: number | null;
  projectTypes: readonly string[];
  budgetAmount: number | null;
  budgetCurrency: string | null;
  hasResearchPartner: boolean | null;
  stage: string | null;
}

/** Ciò che il catalogo dichiara del programma, dalla versione pubblicata. */
export interface RelevanceProgram {
  programId: string;
  geography: readonly string[];
  targetSectors: readonly string[];
  companySizeMin: number;
  companySizeMax: number;
  projectTypes: readonly string[];
  mustApplyBeforeStart: boolean;
  requiresResearchPartner?: boolean;
  availability: 'available' | 'suspended';
  lifecycle: 'active' | 'retired' | 'draft';
}

/** Una ragione, come chiave + parametri. Il testo lo compone l'interfaccia. */
export interface RelevanceReason {
  key: string;
  params?: Record<string, string | number>;
}

export interface RelevanceResult {
  score: number;
  level: RelevanceLevel;
  reasons: RelevanceReason[];
  /** Che cosa manca per misurare meglio: alimenta «cosa manca» (§100). */
  gaps: RelevanceReason[];
  /** I segnali concreti trovati (§63). Senza almeno uno, niente opportunità. */
  signals: string[];
}

export function levelFromScore(score: number): RelevanceLevel {
  if (score >= RELEVANCE_HIGH_MIN) return 'high';
  if (score >= RELEVANCE_MEDIUM_MIN) return 'medium';
  return 'low';
}

/**
 * Calcola la rilevanza. Restituisce `null` quando il programma NON è pertinente
 * — e `null` significa «non creare l'opportunità», non «rilevanza zero»: una
 * riga con punteggio zero in un elenco è comunque una riga da leggere.
 *
 * ⚠️ DUE FILTRI DURI, e sono gli unici due che possono dire di no da soli:
 *    1. la GEOGRAFIA — un programma ticinese non riguarda un progetto zughese;
 *    2. il TIPO DI PROGETTO — un incentivo al fotovoltaico non riguarda
 *       l'assunzione di un apprendista.
 *    Tutto il resto — settore, dimensione, partner — non esclude: pesa. È la
 *    differenza fra un filtro e un giudizio, e §51 vuole che un dato mancante
 *    non si trasformi in un no.
 */
export function computeRelevance(input: RelevanceInput, prog: RelevanceProgram): RelevanceResult | null {
  // §160 — un programma ritirato non entra nei match nuovi. Resta nelle
  // pratiche storiche, che puntano alla loro versione.
  if (prog.lifecycle === 'retired') return null;

  const reasons: RelevanceReason[] = [];
  const gaps: RelevanceReason[] = [];
  const signals: string[] = [];

  // ---- Filtro 1: geografia ----
  const nationwide = prog.geography.includes('ALL') || prog.geography.includes('CH');
  const cantonMatch = input.canton != null && prog.geography.includes(input.canton);
  if (!nationwide && !cantonMatch) return null;
  // ⚠️ Un progetto realizzato fuori dalla Svizzera non accede ai programmi
  //    svizzeri, e il paese è un dato che il progetto porta con sé.
  if (input.country != null && input.country !== 'CH') return null;

  let score = 0;
  if (!nationwide) {
    score += 20;
    reasons.push({ key: 'geographyCanton', params: { canton: input.canton ?? '' } });
    signals.push('geography');
  } else {
    score += 14;
    reasons.push({ key: 'geographyNationwide' });
  }

  // ---- Filtro 2: tipo di progetto ----
  const matched = prog.projectTypes.filter((t) => input.projectTypes.includes(t));
  if (matched.length === 0) return null;
  // La quota di sovrapposizione conta: un programma con un solo tipo, che è
  // proprio quello del progetto, è più pertinente di uno che ne elenca otto.
  score += Math.round(26 + 14 * (matched.length / Math.max(1, prog.projectTypes.length)));
  reasons.push({ key: 'projectType', params: { types: matched.join(',') } });
  signals.push('project_type');

  // ---- Settore: pesa, non esclude ----
  if (prog.targetSectors.includes('ALL')) {
    score += 12;
  } else if (input.sector && prog.targetSectors.includes(input.sector)) {
    score += 18;
    reasons.push({ key: 'sector', params: { sector: input.sector } });
    signals.push('sector');
  } else if (!input.sector) {
    // ⚠️ §51/§182 — un settore non indicato è una LACUNA, non un'esclusione.
    //    Il programma resta, e la schermata dice quale dato lo chiarirebbe.
    score += 7;
    gaps.push({ key: 'sectorMissing' });
  } else {
    score += 3;
    gaps.push({ key: 'sectorOutside', params: { sector: input.sector } });
  }

  // ---- Dimensione: pesa, non esclude ----
  const n = input.employeeCount;
  if (n == null || !Number.isFinite(n)) {
    score += 7;
    gaps.push({ key: 'employeeCountMissing' });
  } else if (n >= prog.companySizeMin && n <= prog.companySizeMax) {
    score += 16;
    reasons.push({ key: 'companySize', params: { count: n } });
    signals.push('company_size');
  } else {
    // Fuori dalla fascia dichiarata: il programma resta visibile — la fascia
    // può avere eccezioni che solo l'ente conosce — ma non guadagna punti, e
    // il criterio corrispondente lo dirà chiaramente.
    gaps.push({
      key: 'companySizeOutside',
      params: { min: prog.companySizeMin, max: prog.companySizeMax === 100000 ? -1 : prog.companySizeMax },
    });
  }

  // ---- Partner di ricerca, quando il programma lo richiede ----
  if (prog.requiresResearchPartner) {
    if (input.hasResearchPartner === true) {
      score += 12;
      reasons.push({ key: 'researchPartner' });
      signals.push('partner');
    } else if (input.hasResearchPartner === null) {
      gaps.push({ key: 'researchPartnerUnknown' });
    }
    // ⚠️ `false` non toglie punti: il partner si può ancora trovare, e il
    //    criterio obbligatorio dirà che oggi non c'è. Togliere rilevanza
    //    nasconderebbe il programma proprio a chi potrebbe procurarselo.
  }

  // ---- Investimento dichiarato ----
  // ⚠️ Non entra nel punteggio come IMPORTO — non esiste una soglia universale
  //    e non si convertono valute (§67). Vale solo come SEGNALE: un progetto
  //    con un budget è un progetto pensato, e §63 chiede segnali concreti.
  if (input.budgetAmount != null && input.budgetCurrency) {
    score += 5;
    signals.push('investment');
  }

  // ---- Tempistica: il caso «domanda prima dell'avvio» ----
  if (prog.mustApplyBeforeStart) {
    if (input.stage === 'idea' || input.stage === 'planned') {
      score += 8;
      reasons.push({ key: 'timingBeforeStart' });
      signals.push('timing');
    } else if (input.stage === 'started' || input.stage === 'completed') {
      // §71 — NON si nasconde il programma e NON si azzera la rilevanza:
      // si segnala. Un progetto avviato può avere lotti successivi, e
      // soprattutto l'imprenditore ha diritto di sapere che quel programma
      // esisteva. Il criterio obbligatorio dirà che oggi non risulta
      // soddisfatto; è quella la sede, non il punteggio.
      gaps.push({ key: 'timingAlreadyStarted' });
    }
  }

  // §63 — SENZA UN SEGNALE CONCRETO NON SI CREA UN'OPPORTUNITÀ.
  // ⚠️ La geografia nazionale da sola non è un segnale: «disponibile in tutta
  //    la Svizzera» vale per chiunque, e un elenco che vale per chiunque non è
  //    una risposta a nessuno.
  if (RELEVANCE_REQUIRES_SIGNAL) {
    const concrete = signals.filter((s) => s !== 'geography' || !nationwide);
    if (concrete.length === 0) return null;
  }

  const finalScore = Math.max(0, Math.min(100, score));
  if (finalScore < RELEVANCE_FLOOR) return null;

  return { score: finalScore, level: levelFromScore(finalScore), reasons, gaps, signals };
}
