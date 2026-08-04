// ============================================================================
// PERIODI E ANCORAGGI: dal testo stampato al dato strutturato.
//
// ⚠️ PERCHÉ NON LO FA IL MODELLO. Per la stessa ragione per cui in Finance non
// converte gli importi: il modello copia ciò che è scritto — «drei Monate»,
// «tre mesi», «90 jours» — e la conversione la fa questo codice, che è esatto,
// ripetibile e verificabile su casi noti. Chiedere al modello «il preavviso in
// mesi» significherebbe affidargli l'unica operazione in cui un errore non si
// vede: «drei Monate auf Monatsende» risponderebbe «3 mesi» e l'ancoraggio, che
// è la parte che decide se una data si può calcolare, sparirebbe nel numero.
//
// ⚠️ QUESTO FILE NON CALCOLA DATE. L'aritmetica sta in SQL, in un posto solo
// (`contract_notice_deadline`, 0024). Qui si legge un periodo; là si sottrae.
//
// Modulo PORTABILE: funzioni pure. Nessun accesso al database, nessun `Deno`.
// ============================================================================
import {
  DERIVABLE_ANCHORS, NOTICE_ANCHORS, PERIOD_UNITS,
  type ContractNoticeAnchor, type ContractPeriodUnit,
} from './contract.ts';

export interface ParsedPeriod {
  value: number;
  unit: ContractPeriodUnit;
}

/**
 * I numerali scritti in lettere, nelle tre lingue del prodotto più l'inglese.
 *
 * ⚠️⚠️ «FINO A DODICI, E NON OLTRE DI PROPOSITO» — QUI C'ERA SCRITTO QUESTO, E
 * LA MISURA LO HA SMENTITO IL 2026-08-03. La riga diceva: «i periodi
 * contrattuali reali stanno tutti qui dentro … oltre il dodici i contratti
 * scrivono la cifra». Su un mandato fiduciario francese di prova, «vingt-quatre
 * mois» — la forma normale in un contratto francese — non tornava `null` come
 * la nota lasciava supporre: tornava **4**. Il numerale composto non era nel
 * l'elenco, la ricerca cadeva su «quatre», e nel database finiva una durata
 * minima di quattro mesi al posto di ventiquattro.
 *
 * ⚠️ È il guasto peggiore che questo file possa produrre, e non perché il numero
 * sia sbagliato: perché è PLAUSIBILE. Un `null` fa comparire la bandiera e manda
 * una persona a leggere la clausola; un «4 mesi» non fa comparire niente.
 *
 * Le due correzioni sono separate e fanno cose diverse:
 *   1. i composti che i contratti usano DAVVERO (18, 24, 36, 48, 60) sono
 *      elencati qui sotto, come parole intere;
 *   2. un composto NON elencato non deve più cadere su un suo pezzo — `18` in
 *      `parsePeriod` fa sì che «trente-deux mois» torni `null` invece di «2».
 * L'elenco resta corto per scelta; ciò che è cambiato è che uscirne non produce
 * più un numero sbagliato.
 */
const WORD_NUMBERS: Record<string, number> = {
  // I composti delle durate contrattuali: 18, 24, 36, 48, 60 mesi sono
  // praticamente tutte le durate minime che si incontrano.
  // italiano (parole singole)
  diciotto: 18, ventiquattro: 24, trentasei: 36, quarantotto: 48, sessanta: 60,
  // francese (con trattino)
  'dix-huit': 18, 'vingt-quatre': 24, 'trente-six': 36, 'quarante-huit': 48, soixante: 60,
  // tedesco (parole singole; `fold` toglie i diacritici ma NON scioglie la ß)
  achtzehn: 18, vierundzwanzig: 24,
  sechsunddreissig: 36, 'sechsunddreißig': 36,
  achtundvierzig: 48, sechzig: 60,
  // inglese
  eighteen: 18, 'twenty-four': 24, 'thirty-six': 36, 'forty-eight': 48, sixty: 60,

  // italiano
  uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6,
  sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12,
  // tedesco
  // ⚠️ LE CHIAVI VANNO SCRITTE GIÀ SENZA DIACRITICI. `fold()` normalizza il
  // testo prima di cercarle: «zwölf» arriva qui come «zwolf», e una chiave
  // scritta con l'umlaut non verrebbe MAI trovata. Trovato dal test, non
  // rileggendo — «zwölf Monate» tornava null e il preavviso spariva.
  ein: 1, eine: 1, einem: 1, einer: 1, eins: 1, zwei: 2, drei: 3, vier: 4,
  funf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
  elf: 11, zwolf: 12, zwoelf: 12,
  // francese
  un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7,
  huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
  // inglese
  one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/**
 * Le unità, nelle quattro lingue.
 * ⚠️ L'ordine dei controlli conta: `mois` contiene `mo`, e `Monat` contiene
 * `Mona`. Si confrontano radici intere, non prefissi.
 */
const UNIT_WORDS: { unit: ContractPeriodUnit; words: readonly string[] }[] = [
  { unit: 'years',  words: ['anno', 'anni', 'jahr', 'jahre', 'jahren', 'an', 'ans', 'année', 'annee', 'années', 'annees', 'year', 'years'] },
  { unit: 'months', words: ['mese', 'mesi', 'monat', 'monate', 'monaten', 'mois', 'month', 'months'] },
  { unit: 'weeks',  words: ['settimana', 'settimane', 'woche', 'wochen', 'semaine', 'semaines', 'week', 'weeks'] },
  { unit: 'days',   words: ['giorno', 'giorni', 'tag', 'tage', 'tagen', 'jour', 'jours', 'day', 'days'] },
];

/** Toglie diacritici e normalizza gli spazi: «Kündigungsfrist» e «annees». */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Legge un periodo da un testo stampato.
 *
 * Riconosce: «3 mesi», «tre mesi», «drei Monate», «90 giorni», «12 Monate»,
 * «trois (3) mois», «6-monatige». Restituisce `null` quando non è sicuro —
 * `null` è un esito, un periodo indovinato no.
 *
 * ⚠️ SE IL TESTO CONTIENE PIÙ DI UN PERIODO, NON SI SCEGLIE.
 * «tre mesi per il primo anno, sei mesi in seguito» è una clausola che una
 * persona deve leggere: prenderne uno a caso produrrebbe un preavviso sbagliato
 * per metà della durata del contratto, e nessuno saprebbe che il testo diceva
 * un'altra cosa. Si torna `null` e la clausola resta visibile.
 */
export function parsePeriod(raw: string | null | undefined): ParsedPeriod | null {
  if (!raw) return null;
  const text = fold(raw);
  if (!text) return null;

  const found: ParsedPeriod[] = [];

  for (const { unit, words } of UNIT_WORDS) {
    for (const word of words) {
      // La quantità precede l'unità, con al più due parole in mezzo — abbastanza
      // per «trois (3) mois» e «6 volle Monate», non per attraversare una virgola.
      //
      // ⚠️ IL GRUPPO COL TRATTINO È LA CORREZIONE DEL 2026-08-03. Senza,
      // «vingt-quatre mois» non poteva agganciarsi da «vingt» (il trattino non è
      // nella classe), il motore riprovava più avanti e trovava «quatre mois»:
      // ventiquattro mesi diventavano quattro. Ora il numerale composto si
      // aggancia intero, e la parola più lunga vince perché il match più a
      // sinistra è quello che il motore restituisce.
      //
      // ⚠️ Il limite passa da 8 a 20 caratteri perché i composti tedeschi sono
      // parole sole: «vierundzwanzig» ne ha quattordici. Allargarlo non allarga
      // ciò che si accetta — una parola sconosciuta resta `null` in
      // `readQuantity` — allarga solo ciò che si riesce a GUARDARE.
      const re = new RegExp(
        `(\\d{1,4}|[a-zà-ÿ]{2,20}(?:-[a-zà-ÿ]{2,20})?)\\s*(?:\\([^)]{0,8}\\))?\\s*[- ]?\\s*${word}\\b`,
        'g',
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        // ⚠️ Il pezzo di una parola più grande NON è una quantità. Se subito
        // prima del token c'è una lettera o un trattino, quello che abbiamo in
        // mano è un frammento — «-quatre» dentro «vingt-quatre» — e leggerlo
        // come numero è esattamente il guasto che questa riga esiste per
        // impedire. Si scarta: `null` è un esito, un periodo indovinato no.
        const prima = m.index > 0 ? text[m.index - 1] : '';
        if (prima && /[a-zà-ÿ-]/.test(prima)) continue;
        const quantity = readQuantity(m[1]);
        if (quantity === null) continue;
        found.push({ value: quantity, unit });
      }
    }
  }

  if (!found.length) return null;

  // Tutte le occorrenze devono dire la stessa cosa. Se il testo contiene due
  // periodi diversi, la clausola è da leggere e non da riassumere.
  const first = found[0];
  const allEqual = found.every((p) => p.value === first.value && p.unit === first.unit);
  return allEqual ? first : null;
}

function readQuantity(token: string): number | null {
  if (/^\d+$/.test(token)) {
    const n = Number(token);
    // Un periodo contrattuale plausibile. Oltre, quasi certamente il numero
    // letto è un anno («2026 mesi») o un importo finito nella frase sbagliata.
    return n > 0 && n <= 999 ? n : null;
  }
  const word = WORD_NUMBERS[token];
  return word ?? null;
}

/** Un'unità dichiarata dal modello, se è una di quelle previste. */
export function normalizeUnit(raw: unknown): ContractPeriodUnit | null {
  if (typeof raw !== 'string') return null;
  const value = fold(raw);
  const direct = PERIOD_UNITS.find((u) => u === value);
  if (direct) return direct;
  for (const { unit, words } of UNIT_WORDS) {
    if (words.some((w) => value === w || value.startsWith(w))) return unit;
  }
  return null;
}

/**
 * ⚠️ L'ANCORAGGIO — la funzione più delicata del file, e la ragione per cui
 * questo modulo può dire «non è possibile derivare una data» invece di tacere.
 *
 * Riconosce a quale evento il preavviso si riferisce. Nel dubbio torna
 * `unclear`, e `unclear` è un esito PIENO: fa comparire la bandiera, fa
 * mostrare la clausola originale e impedisce ogni calcolo.
 *
 * ⚠️ L'ORDINE DEI CONTROLLI È SOSTANZIALE. «tre mesi prima della scadenza per
 * fine mese» contiene ENTRAMBE le forme, e la seconda vince: quando una fine
 * periodo è nominata, la data non è più una semplice sottrazione, e trattarla
 * come tale produrrebbe esattamente la scadenza sbagliata che §46 vieta.
 */
export function detectAnchor(raw: string | null | undefined): ContractNoticeAnchor {
  if (!raw) return 'unclear';
  const text = fold(raw);
  if (!text) return 'unclear';

  // (1) Le fini periodo, per prime: se ci sono, comandano loro.
  if (/(fine|termine) (del )?(mese|mesi)|monatsende|zum monatsende|auf monatsende|fin (du|de) mois|end of (the )?month/.test(text)) {
    return 'to_month_end';
  }
  if (/(fine|termine) (del )?trimestre|quartalsende|auf quartalsende|fin (du|de) trimestre|end of (the )?quarter/.test(text)) {
    return 'to_quarter_end';
  }
  if (/(fine|termine) (dell')?anno|jahresende|auf jahresende|fin (de l'|d')annee|end of (the )?year/.test(text)) {
    return 'to_year_end';
  }

  // (2) «In qualsiasi momento»: non c'è nulla a cui ancorare.
  if (/in (qualsiasi|ogni) momento|jederzeit|a tout moment|at any time/.test(text)) {
    return 'anytime';
  }

  // (3) Prima del rinnovo — distinto dalla scadenza, anche se spesso coincidono.
  if (/prima (del|della) (rinnovo|proroga)|vor (der )?(verlangerung|erneuerung)|avant (le )?renouvellement|before (the )?renewal/.test(text)) {
    return 'before_renewal_date';
  }

  // (4) Prima della scadenza: la forma calcolabile più comune.
  if (/prima (della|del) (scadenza|termine|fine)|vor (dem )?(ablauf|vertragsende|ende)|avant (l'|le |la )?(echeance|expiration|terme|fin)|before (the )?(expiry|expiration|end|term)/.test(text)) {
    return 'before_fixed_end';
  }

  return 'unclear';
}

/** Un valore di ancoraggio dichiarato dal modello, se è fra quelli previsti. */
export function normalizeAnchor(raw: unknown): ContractNoticeAnchor | null {
  if (typeof raw !== 'string') return null;
  const value = fold(raw).replace(/[\s-]/g, '_');
  return NOTICE_ANCHORS.find((a) => a === value) ?? null;
}

/**
 * Una data si può derivare da questi termini?
 *
 * ⚠️ NON CALCOLA LA DATA — dice soltanto se esiste. Serve all'interfaccia per
 * scegliere fra «Ultima disdetta: 30.09.2026» e «Il preavviso è indicato, ma non
 * è possibile derivare con sicurezza una data», e al validatore per accendere la
 * bandiera giusta. Il calcolo lo fa SQL, e `npm run test:contracts` verifica che
 * le due risposte coincidano su ogni ancoraggio.
 */
export function canDeriveNoticeDeadline(input: {
  noticeValue: number | null;
  noticeUnit: ContractPeriodUnit | null;
  anchor: ContractNoticeAnchor | null;
  hasExplicitEndDate: boolean;
}): boolean {
  if (!input.noticeValue || input.noticeValue <= 0) return false;
  if (!input.noticeUnit) return false;
  if (!input.anchor) return false;
  if (!(DERIVABLE_ANCHORS as readonly string[]).includes(input.anchor)) return false;
  return input.hasExplicitEndDate;
}

/**
 * Perché una data non si può derivare. CHIAVE, non frase: la frase la scrive
 * l'interfaccia nella lingua di chi legge (§124).
 */
export type NoticeBlockReason =
  | 'no_notice_period' | 'anchor_unclear' | 'anchor_not_derivable' | 'no_end_date';

export function noticeBlockReason(input: {
  noticeValue: number | null;
  noticeUnit: ContractPeriodUnit | null;
  anchor: ContractNoticeAnchor | null;
  hasExplicitEndDate: boolean;
}): NoticeBlockReason | null {
  if (!input.noticeValue || !input.noticeUnit) return 'no_notice_period';
  if (!input.anchor || input.anchor === 'unclear') return 'anchor_unclear';
  if (!(DERIVABLE_ANCHORS as readonly string[]).includes(input.anchor)) {
    return 'anchor_not_derivable';
  }
  if (!input.hasExplicitEndDate) return 'no_end_date';
  return null;
}
