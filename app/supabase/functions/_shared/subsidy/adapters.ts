// ============================================================================
// GLI ADAPTER DELLE FONTI — §14, §15.
//
// ⚠️ QUESTO FILE NON PROMETTE AUTOMAZIONE COMPLETA, e la promessa mancata è il
// contributo più utile che può dare. Un adapter «universale» che pretendesse di
// leggere requisiti, importi e scadenze da una qualunque pagina cantonale
// produrrebbe dati plausibili e sbagliati — e §22 vieta che un dato non
// verificato entri in produzione. Quindi:
//
//   · gli adapter RILEVANO IL CAMBIAMENTO e lo descrivono;
//   · NON riscrivono mai una versione pubblicata;
//   · ciò che non sanno interpretare lo DICHIARANO (`unsupported`), invece di
//     tacere e dare l'impressione di aver letto tutto.
//
// Il risultato di un controllo è una riga in `subsidy_catalog_reviews` che una
// persona guarda. È meno di uno scraper che «aggiorna il catalogo da solo», ed
// è esattamente ciò che §15 chiede: una procedura di revisione manuale
// assistita batte uno scraper fragile.
//
// Modulo PORTABILE: nessun import di runtime.
// ============================================================================

import type { SubsidyErrorCode } from './contract.ts';
import { SUBSIDY_PARSER_VERSION } from './contract.ts';
import { normalizeForHash, sha256Hex } from './hash.ts';
import type { FetchOutcome } from './fetchGuard.ts';

export interface SnapshotEvidence {
  field: string;
  quote: string;
  section: string | null;
  page: number | null;
}

export interface AdapterResult {
  ok: boolean;
  errorCode?: SubsidyErrorCode;
  reason?: string;
  title: string | null;
  language: 'it' | 'de' | 'fr' | 'en' | null;
  contentHash: string;
  /** I campi che l'adapter ha saputo leggere. Ciò che non sa NON compare. */
  normalized: Record<string, unknown>;
  evidence: SnapshotEvidence[];
  /** Strutture viste e non interpretate. Si dichiarano (§14). */
  unsupported: string[];
  sourcePublishedAt: string | null;
  sourceUpdatedAt: string | null;
  parserVersion: string;
}

export interface SubsidySourceAdapter {
  key: string;
  /** Che cosa sa fare, in chiaro. Finisce in `docs/subsidy-sources.md`. */
  describe: string;
  /** Campi che questo adapter è in grado di estrarre. */
  extracts: readonly string[];
  /** Limiti dichiarati. Un adapter senza limiti dichiarati è un adapter che mente. */
  limitations: readonly string[];
  run(fetched: FetchOutcome): Promise<AdapterResult>;
}

// ---------------------------------------------------------------------------
// Utilità di lettura HTML — un automa, non un'espressione regolare sul tutto
// ---------------------------------------------------------------------------

/**
 * Riduce l'HTML a testo. ⚠️ Rimuove PRIMA `script`, `style`, `noscript` e i
 * commenti con il loro CONTENUTO: togliere solo i tag lascerebbe il codice
 * JavaScript dentro il testo, e da lì dentro l'impronta — una pagina che cambia
 * soltanto in un token inline risulterebbe cambiata a ogni controllo.
 */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
  return normalizeForHash(s);
}

export function extractTitle(html: string): string | null {
  const t = html.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i);
  if (t) {
    const v = htmlToText(t[1]).trim();
    if (v) return v.slice(0, 200);
  }
  const h1 = html.match(/<h1[^>]*>([\s\S]{1,300}?)<\/h1>/i);
  if (h1) {
    const v = htmlToText(h1[1]).trim();
    if (v) return v.slice(0, 200);
  }
  return null;
}

const META_DATE_PATTERNS: readonly { field: 'published' | 'updated'; re: RegExp }[] = [
  { field: 'published', re: /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i },
  { field: 'updated', re: /<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']+)["']/i },
  { field: 'updated', re: /<meta[^>]+name=["']last-?modified["'][^>]+content=["']([^"']+)["']/i },
  { field: 'updated', re: /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i },
];

/**
 * La data DICHIARATA DALLA FONTE, quando c'è.
 *
 * ⚠️ Non si ripiega sull'header HTTP `Last-Modified`: quello dice quando si è
 * mosso un file su un server, non quando l'autorità ha aggiornato il testo. Un
 * deploy del sito cambierebbe la data di tutte le pagine e ogni requisito
 * risulterebbe «aggiornato oggi» senza che nessuno abbia scritto nulla.
 */
export function extractDeclaredDates(html: string): { published: string | null; updated: string | null } {
  const out: { published: string | null; updated: string | null } = { published: null, updated: null };
  for (const { field, re } of META_DATE_PATTERNS) {
    const m = html.match(re);
    if (!m) continue;
    const iso = toIsoDate(m[1]);
    if (iso && !out[field]) out[field] = iso;
  }
  return out;
}

/** Accetta solo forme NON ambigue. Una data ambigua non si indovina. */
export function toIsoDate(raw: string): string | null {
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Forma svizzera `31.12.2026`: il giorno viene prima e non c'è ambiguità
  // quando il primo numero supera 12; sotto, resta ambigua e si scarta.
  const ch = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ch) {
    const d = Number(ch[1]);
    const m = Number(ch[2]);
    if (d > 12 && m <= 12) return `${ch[3]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return null;
  }
  return null;
}

/**
 * Cerca CANDIDATE di scadenza nel testo.
 *
 * ⚠️ SONO CANDIDATE, NON SCADENZE. Finiscono in una revisione da approvare, mai
 * dentro `subsidy_calls`: una data trovata in una pagina può essere il termine
 * della call, la data di una conferenza o l'anno di una legge, e distinguerle
 * richiede di leggere la frase — che è ciò che fa una persona.
 */
export function findDeadlineCandidates(text: string): SnapshotEvidence[] {
  const out: SnapshotEvidence[] = [];
  const re = /((?:scadenz\w+|termin\w*|delai|délai|frist|eingabe\w*|deadline|entro il|jusqu'au|bis zum)[^.\n]{0,80}?)(\d{1,2}[.\/]\d{1,2}[.\/]\d{4}|\d{4}-\d{2}-\d{2})/gi;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(text)) !== null && guard++ < 20) {
    out.push({
      field: 'deadline_candidate',
      quote: `${m[1]}${m[2]}`.replace(/\s+/g, ' ').trim().slice(0, 200),
      section: null,
      page: null,
    });
  }
  return out;
}

function detectLanguage(text: string): 'it' | 'de' | 'fr' | 'en' | null {
  const sample = text.slice(0, 4000).toLowerCase();
  const score = {
    it: (sample.match(/\b(il|della|per|sono|richiesta|contributo|azienda)\b/g) ?? []).length,
    de: (sample.match(/\b(und|der|die|das|für|unternehmen|beitrag|gesuch)\b/g) ?? []).length,
    fr: (sample.match(/\b(le|les|des|pour|entreprise|demande|soutien)\b/g) ?? []).length,
    en: (sample.match(/\b(the|and|for|company|application|funding)\b/g) ?? []).length,
  };
  const best = (Object.entries(score) as [keyof typeof score, number][])
    .sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 3 ? best[0] : null;
}

// ---------------------------------------------------------------------------
// Adapter 1 — pagina HTML di un'autorità svizzera
// ---------------------------------------------------------------------------

export const HTML_ADAPTER: SubsidySourceAdapter = {
  key: 'ch-official-html',
  describe:
    'Legge una pagina HTML di un\'autorità svizzera: titolo, lingua, date dichiarate nei meta, '
    + 'testo normalizzato per l\'impronta e candidate di scadenza. NON estrae requisiti, importi '
    + 'né percentuali: quelli restano curati a mano e verificati da una persona.',
  extracts: ['title', 'language', 'source_updated_at', 'text_hash', 'deadline_candidate'],
  limitations: [
    'Non estrae requisiti, esclusioni, importi, aliquote, costi ammissibili: la struttura di '
    + 'quelle pagine non è stabile e un parser sbagliato produrrebbe criteri falsi (§22).',
    'Le date trovate nel testo sono CANDIDATE e finiscono in revisione, mai in subsidy_calls.',
    'Le pagine costruite interamente in JavaScript risultano quasi vuote: l\'adapter lo dichiara '
    + 'in `unsupported` invece di riportare un contenuto che non c\'è.',
    'Non risolve il DNS prima della richiesta: contro il DNS rebinding la difesa è l\'allowlist.',
  ],
  async run(fetched: FetchOutcome): Promise<AdapterResult> {
    const base: AdapterResult = {
      ok: false, title: null, language: null, contentHash: '',
      normalized: {}, evidence: [], unsupported: [],
      sourcePublishedAt: null, sourceUpdatedAt: null,
      parserVersion: SUBSIDY_PARSER_VERSION,
    };
    if (!fetched.ok) {
      return { ...base, errorCode: fetched.errorCode ?? 'source_unreachable', reason: fetched.reason };
    }
    if (fetched.status === 304) {
      // Non è cambiato niente: nessun contenuto da normalizzare, e va detto.
      return { ...base, ok: true, contentHash: '', unsupported: [], normalized: { notModified: true } };
    }

    const html = fetched.text ?? '';
    const text = htmlToText(html);
    const unsupported: string[] = [];

    // ⚠️ Una pagina che si riduce a poche decine di caratteri non è una pagina
    //    vuota per caso: quasi sempre è un'applicazione JavaScript. Dirlo è
    //    l'unico modo perché qualcuno decida di curarla a mano.
    if (text.length < 400) {
      unsupported.push('content_too_short_probably_javascript');
    }
    if (fetched.truncated) {
      unsupported.push('content_truncated_at_size_limit');
    }
    if (/<iframe\b/i.test(html)) {
      unsupported.push('content_inside_iframe_not_followed');
    }

    const dates = extractDeclaredDates(html);
    const evidence = findDeadlineCandidates(text);

    return {
      ...base,
      ok: true,
      title: extractTitle(html),
      language: detectLanguage(text),
      contentHash: await sha256Hex(text),
      normalized: {
        textLength: text.length,
        deadlineCandidateCount: evidence.length,
        declaredUpdatedAt: dates.updated,
      },
      evidence,
      unsupported,
      sourcePublishedAt: dates.published,
      sourceUpdatedAt: dates.updated,
    };
  },
};

// ---------------------------------------------------------------------------
// Adapter 2 — PDF ufficiale
// ---------------------------------------------------------------------------

export const PDF_ADAPTER: SubsidySourceAdapter = {
  key: 'ch-official-pdf',
  describe:
    'Riconosce un PDF ufficiale, ne calcola l\'impronta e rileva se è cambiato. '
    + 'NON ne estrae il testo: nel worker non esiste un estrattore PDF, e non se ne aggiunge uno '
    + 'per non far dipendere il catalogo da una libreria che nessuno rilegge.',
  extracts: ['content_hash', 'byte_size', 'is_scanned_guess'],
  limitations: [
    'Nessuna estrazione di testo, quindi nessuna evidenza con numero di pagina da questa fonte: '
    + 'i riferimenti ai PDF si curano a mano (§15).',
    'La distinzione fra PDF digitale e scansione è una STIMA sui marcatori del formato, e viene '
    + 'dichiarata come tale.',
    'Nessun contenuto attivo viene eseguito: i byte non vengono mai interpretati.',
  ],
  async run(fetched: FetchOutcome): Promise<AdapterResult> {
    const base: AdapterResult = {
      ok: false, title: null, language: null, contentHash: '',
      normalized: {}, evidence: [], unsupported: ['pdf_text_extraction_not_available'],
      sourcePublishedAt: null, sourceUpdatedAt: null,
      parserVersion: SUBSIDY_PARSER_VERSION,
    };
    if (!fetched.ok) {
      return { ...base, errorCode: fetched.errorCode ?? 'source_unreachable', reason: fetched.reason };
    }
    if (fetched.status === 304) {
      return { ...base, ok: true, normalized: { notModified: true } };
    }

    const bytes = fetched.bytes ?? new Uint8Array();
    const { sha256Bytes } = await import('./hash.ts');
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 4096));
    // Stima grossolana e DICHIARATA: un PDF con font incorporati contiene
    // quasi sempre `/Font`; una scansione è fatta di sole immagini.
    const looksScanned = !head.includes('/Font') && /\/Image|\/DCTDecode/.test(head);

    return {
      ...base,
      ok: true,
      contentHash: await sha256Bytes(bytes),
      normalized: {
        byteSize: bytes.byteLength,
        isScannedGuess: looksScanned,
        truncated: fetched.truncated === true,
      },
      unsupported: [
        'pdf_text_extraction_not_available',
        ...(looksScanned ? ['pdf_probably_scanned'] : []),
        ...(fetched.truncated ? ['content_truncated_at_size_limit'] : []),
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Adapter 3 — la fonte che NON si scarica
// ---------------------------------------------------------------------------

export const MANUAL_ADAPTER: SubsidySourceAdapter = {
  key: 'manual',
  describe:
    'La fonte è ufficiale ma non interrogabile in modo affidabile: niente API, niente feed, '
    + 'struttura instabile o accesso dietro un modulo. Si controlla A MANO, secondo il runbook, '
    + 'e il prodotto lo dichiara invece di fingere un controllo automatico (§15).',
  extracts: [],
  limitations: ['Nessun controllo automatico. La data di verifica la scrive una persona.'],
  run(): Promise<AdapterResult> {
    return Promise.resolve({
      ok: false,
      errorCode: 'adapter_unsupported',
      reason: 'manual_curation_required',
      title: null, language: null, contentHash: '',
      normalized: {}, evidence: [], unsupported: ['manual_curation_required'],
      sourcePublishedAt: null, sourceUpdatedAt: null,
      parserVersion: SUBSIDY_PARSER_VERSION,
    });
  },
};

export const ADAPTERS: readonly SubsidySourceAdapter[] = [HTML_ADAPTER, PDF_ADAPTER, MANUAL_ADAPTER];

/**
 * ⚠️ Una chiave sconosciuta NON ricade su un adapter generico: restituisce
 * `null`, e il worker registra `adapter_unknown`. Un ripiego «universale»
 * leggerebbe una pagina che nessuno ha esaminato e ne trarrebbe conclusioni,
 * che è il modo in cui un catalogo si riempie di dati falsi senza che nessuno
 * se ne accorga.
 */
export function findAdapter(key: string): SubsidySourceAdapter | null {
  return ADAPTERS.find((a) => a.key === key) ?? null;
}
