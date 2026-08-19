// ============================================================================
// Validation layer (§19) + evidence verification (§20) + normalizzazione.
// Modulo portabile. NON si salva nel DB nulla che non passi di qui.
//
// Trasforma l'AiAnalysis grezza in una NormalizedAnalysis:
//  - valida date, currency, enum, range di confidence, stringhe/array;
//  - VERIFICA ogni citazione contro il testo estratto: se non c'è, la marca
//    non verificata, ne toglie gli offset e abbassa l'affidabilità (§20);
//  - impone le regole sulla scadenza (§11) e deriva la primaryAction (§14).
// ============================================================================
import type {
  AiAnalysis, AiEvidence, AuthorityType, DateKind, DeadlineType, DocumentType, Language, Severity,
} from './schema.ts';
import {
  AUTHORITY_TYPES, DATE_KINDS, DEADLINE_TYPES, DOCUMENT_TYPES, LANGUAGES, SEVERITIES,
} from './schema.ts';
// ⚠️ Si IMPORTA la normalizzazione delle valute invece di riscriverla: è la
// stessa domanda che si pone Finanze, e due risposte diverse alla stessa
// domanda divergono. `money.ts` non ha alcun import — né Deno, né npm, né il
// resto del progetto — quindi si può prendere così com'è.
import { normalizeCurrency } from './finance/money.ts';

// ---- Testo estratto (input della verifica) ----------------------------------
export interface ExtractionPage { pageNumber: number; text: string }
export interface ExtractionResult {
  fullText: string;
  pages: ExtractionPage[];
  extractionMethod: 'native_pdf' | 'ocr' | 'text';
}

// ---- Evidence normalizzata (output) -----------------------------------------
export interface Evidence {
  quote: string;
  pageNumber: number | null;
  verified: boolean;        // §20: la citazione esiste davvero nel testo
  start: number | null;     // offset nel fullText (per l'evidenziazione), mai dal modello
  end: number | null;
}

export interface NormAction {
  id: number;
  title: string;
  description: string;
  sourceType: 'extracted' | 'suggested';
  required: boolean | null;
  deadlineReference: string | null;
  confidence: number;
  evidence: Evidence | null;
}

export interface NormalizedAnalysis {
  language: Language;
  documentType: { value: DocumentType; confidence: number; evidence: Evidence | null };
  sender: { name: string | null; authorityType: AuthorityType; confidence: number; evidence: Evidence | null };
  recipient: string | null;
  subject: string | null;
  documentDate: string | null;
  referenceNumbers: { label: string; value: string; evidence: Evidence | null }[];
  summary: string;
  deadline: {
    date: string | null;
    type: DeadlineType;
    /**
     * Che cosa il modello ha DICHIARATO di aver estratto.
     *
     * `null` = non dichiarato: un'analisi anteriore al 2026-08-15, o un output
     * monco. Non è un `term` sottinteso — è una domanda senza risposta, e si
     * legge così (`requiresVerification`).
     */
    dateKind: DateKind | null;
    sourceText: string | null;
    /** Il MINIMO fra la fiducia sul valore e quella sulla natura (vedi schema). */
    confidence: number;
    evidence: Evidence | null;
    requiresVerification: boolean;
  };
  /**
   * La data in cui accade qualcosa, quando il documento ne fissa una.
   *
   * ⚠️ NON è una scadenza e non deve mai finire nel campo che ne fa le veci: da
   * lì nascono attività con la data sbagliata (tre, il 2026-07-26, dal
   * sopralluogo del Comune di Lugano). Ha un posto suo perché è un'altra cosa.
   */
  appointment: {
    date: string;
    sourceText: string | null;
    confidence: number;
    evidence: Evidence | null;
  } | null;
  amounts: { amount: number; currency: string | null; type: string; description: string; confidence: number; evidence: Evidence | null }[];
  actions: NormAction[];
  primaryAction: NormAction | null;
  requestedDocuments: { name: string; required: boolean | null; confidence: number; evidence: Evidence | null }[];
  risks: { text: string; sourceType: 'explicit' | 'inferred'; confidence: number; evidence: Evidence | null }[];
  legalReferences: { text: string; evidence: Evidence | null }[];
  replyNeeded: boolean;
  uncertainties: { field: string; description: string; severity: Severity }[];
  overallConfidence: number;
  meta: { droppedEvidence: number; warnings: string[] };
}

// ---- Utility ----------------------------------------------------------------
const clamp01 = (n: unknown): number => {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
};
const cleanStr = (s: unknown): string | null => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t.length ? t : null;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v)) ? (v as T) : fallback;

const isIsoDate = (s: string | null): s is string => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && s === d.toISOString().slice(0, 10);
};

const normWs = (s: string) => s.replace(/\s+/g, ' ').trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Cerca una citazione nel testo e ne calcola gli offset (mai presi dal modello). */
function locate(text: string, quote: string): { start: number; end: number } | null {
  const q = quote.trim();
  if (q.length < 4) return null;
  let i = text.indexOf(q);
  if (i >= 0) return { start: i, end: i + q.length };
  i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i >= 0) return { start: i, end: i + q.length };
  try {
    const pattern = q.split(/\s+/).filter(Boolean).map(escapeRe).join('\\s+');
    const m = new RegExp(pattern, 'i').exec(text);
    if (m && m.index >= 0) return { start: m.index, end: m.index + m[0].length };
  } catch { /* pattern non valido → non trovata */ }
  return null;
}

/** §20 — verifica una evidence contro il testo estratto. */
function verifyEvidence(ev: AiEvidence | null, extraction: ExtractionResult): { evidence: Evidence | null; dropped: boolean } {
  // Evidence non nullable nello schema: quote "" = "nessuna evidenza" (legittimo, non un errore).
  if (!ev || typeof ev.quote !== 'string') return { evidence: null, dropped: false };
  const quote = ev.quote.trim();
  if (quote.length < 4) return { evidence: null, dropped: false };

  const hit = locate(extraction.fullText, quote);
  if (hit) {
    // pageNumber 0/assente = sconosciuto; accettato solo se coerente con l'estrazione.
    let page = typeof ev.pageNumber === 'number' && ev.pageNumber > 0 ? ev.pageNumber : null;
    if (page != null && !extraction.pages.some((p) => p.pageNumber === page)) page = null;
    if (page == null) {
      const nq = normWs(quote);
      const found = extraction.pages.find((p) => normWs(p.text).includes(nq));
      if (found) page = found.pageNumber;
    }
    return { evidence: { quote, pageNumber: page, verified: true, start: hit.start, end: hit.end }, dropped: false };
  }
  // Non trovata: la teniamo solo come testo NON verificato (niente offset, niente "mostra nel documento").
  return { evidence: { quote, pageNumber: null, verified: false, start: null, end: null }, dropped: true };
}

// ---- Validazione + normalizzazione ------------------------------------------
export function validateAndNormalize(ai: AiAnalysis, extraction: ExtractionResult): NormalizedAnalysis {
  const warnings: string[] = [];
  let dropped = 0;
  const ver = (ev: AiEvidence | null): Evidence | null => {
    const r = verifyEvidence(ev, extraction);
    if (r.dropped) dropped++;
    return r.evidence;
  };

  const uncertainties = (Array.isArray(ai.uncertainties) ? ai.uncertainties : []).map((u) => ({
    field: cleanStr(u?.field) ?? 'generale',
    description: cleanStr(u?.description) ?? '',
    severity: oneOf<Severity>(u?.severity, SEVERITIES, 'medium'),
  })).filter((u) => u.description);

  // §11 — scadenza: la data assoluta è ammessa SOLO per il tipo explicit e se valida.
  let dType = oneOf<DeadlineType>(ai.deadline?.type, DEADLINE_TYPES, 'none');
  let dDate = cleanStr(ai.deadline?.date);
  // ⚠️ La data COM'È ARRIVATA, prima che una qualsiasi guardia qui sotto azzeri
  // `dDate`. Le guardie sono due e possono scattare tutte e due sullo stesso
  // documento — «non obbliga l'azienda» e «è un evento» —, e la prima cancellava
  // il dato che la seconda deve conservare: un avviso di sopralluogo perdeva la
  // data del sopralluogo. Ciò che si azzera è la SCADENZA, non la data.
  const rawDate = cleanStr(ai.deadline?.date);

  // ⚠️⚠️ CHI È OBBLIGATO DA QUELLA DATA — la domanda che mancava, aggiunta il
  // 2026-08-11 su un caso reale. Un'email di Stripe sulle nuove tariffe di Radar
  // ha prodotto «Scadenza 22.01.2027»: la data c'era davvero, scritta a chiare
  // lettere, ma era l'entrata in vigore di un LISTINO DI UN FORNITORE. L'azienda
  // non doveva fare niente entro quel giorno, e si è ritrovata una scadenza nel
  // cruscotto operativo.
  //
  // Il tipo di scadenza non può dipendere dalla FORMA della data — quella dice
  // solo se è assoluta o relativa. Deve dipendere da CHI la impone. Una data che
  // non obbliga nessuno non è una scadenza: è una notizia.
  //
  // ⚠️ Il campo è a TRE stati, non due, e il terzo conta: `undefined` significa
  // «il modello non ha risposto alla domanda» — un'analisi prodotta prima che
  // questo campo esistesse, o un output monco. Lì non si declassa niente, perché
  // trattare il silenzio come «non obbliga» cancellerebbe di colpo le scadenze
  // vere di ogni analisi vecchia. Solo un `false` ESPLICITO declassa.
  const obliga = ai.deadline?.obligesCompany;
  if (obliga === false && dType !== 'none') {
    warnings.push('deadline: data che non obbliga l\'azienda (termine del mittente) → non è una scadenza');
    dType = 'none';
    dDate = null;
  }

  // ⚠️⚠️ CHE COSA È QUELLA DATA — la domanda del 2026-08-15, e la terza dello
  // stesso genere delle due qui sopra. Il caso: «Comune di Lugano — Controllo
  // tassa rifiuti» ha prodotto «Scadenza 10.09.2026 · fra 26 giorni ·
  // affidabilità ALTA», sostenuta da una citazione esatta e verificata — «Il
  // sopralluogo è previsto per il 10.09.2026 presso la vostra sede». Nessuna
  // guardia poteva vederlo:
  //   · `type` guarda la FORMA (assoluta/relativa): explicit, ed era vero;
  //   · `obligesCompany` guarda CHI è obbligato: da un sopralluogo l'azienda è
  //     coinvolta eccome — risposta «sì», giusta, alla domanda sbagliata;
  //   · `evidence` guarda se la citazione ESISTE nel testo: c'era.
  // Tre guardie verdi su un dato falso, e da quel campo sono nate TRE attività
  // datate 10.09.2026.
  //
  // Una data di sopralluogo non è un termine: è il giorno in cui l'evento
  // ACCADE. Il termine per prepararsi, se esiste, è PRECEDENTE e implicito —
  // e ciò che non è scritto non si inventa. Quindi la data non sparisce (è
  // un'informazione vera e utile): cambia posto.
  //
  // ⚠️ NON È UN'EURISTICA SUL TESTO. Qui non si cercano le parole
  // «sopralluogo» o «controllo»: si legge un campo che il modello ha
  // COMPILATO dichiarando che cosa ha estratto. Una euristica testuale
  // sbaglierebbe sulle stesse parole in tedesco, in francese, o in una frase
  // costruita al contrario — e sarebbe una quarta guardia che guarda la forma.
  const dateKind: DateKind | null =
    typeof ai.deadline?.dateKind === 'string' && (DATE_KINDS as readonly string[]).includes(ai.deadline.dateKind)
      ? ai.deadline.dateKind as DateKind
      : null;

  // La data che l'evento fissa: si legge da `rawDate`, non da `dDate` — a questo
  // punto `dDate` può essere già stata azzerata dalla guardia di `obligesCompany`.
  //
  // ⚠️ E NON si richiede `obliga !== false`. «Che cosa è questa data» è una
  // risposta più specifica di «chi obbliga»: se il modello dichiara un evento,
  // la data è quella dell'evento anche quando l'azienda non è obbligata a nulla.
  // Il caso vero: `{dateKind:'event', obligesCompany:false}` — un sopralluogo
  // annunciato, non imposto. Con la vecchia condizione l'appuntamento spariva
  // del tutto: né scadenza, né appuntamento, né dettaglio, né calendario.
  let appointmentDate: string | null = null;
  if (dateKind === 'event' && isIsoDate(rawDate)) {
    appointmentDate = rawDate;
  }
  if ((dateKind === 'event' || dateKind === 'reference') && dType !== 'none') {
    warnings.push(dateKind === 'event'
      ? 'deadline: data di un evento (appuntamento), non un termine → spostata fuori dalla scadenza'
      : 'deadline: data amministrativa di riferimento, non un termine → non è una scadenza');
    dType = 'none';
    dDate = null;
    uncertainties.push(dateKind === 'event'
      ? {
        field: 'deadline',
        // ⚠️ `medium` e non `high`: una `high` manderebbe in `needs_review` ogni
        // avviso di sopralluogo, e qui l'analisi NON è dubbia — ha riconosciuto
        // bene un appuntamento. Ciò che manca è il termine, e il fatto che manchi
        // va detto a chi legge, non trasformato in un allarme sull'analisi.
        description: 'Il documento fissa un appuntamento, non un termine: se esiste una scadenza per prepararsi è anteriore e non è scritta nel documento',
        severity: 'medium',
      }
      : {
        field: 'deadline',
        description: 'La data trovata è un riferimento amministrativo (periodo, emissione, decorrenza), non un termine da rispettare',
        severity: 'medium',
      });
  }

  if (dType === 'explicit') {
    if (!isIsoDate(dDate)) {
      warnings.push('deadline.date non valida per un tipo explicit: azzerata');
      uncertainties.push({ field: 'deadline', description: 'Data di scadenza non confermabile: verificare manualmente', severity: 'high' });
      dDate = null;
    }
  } else {
    dDate = null; // relative/inferred/none: mai una data assoluta (§11)
  }
  // §20 — la scadenza è il dato più critico: una data "esplicita" vale solo se
  // la citazione che la sostiene esiste davvero nel testo. Senza citazione
  // verificata resta la data (è l'unica informazione che abbiamo) ma va
  // dichiarata DA VERIFICARE, esattamente come si declassano azioni e rischi.
  const dateEvidence = ver(ai.deadline?.evidence ?? null);
  // La citazione segue la data: se il 10.09.2026 è diventato un appuntamento, la
  // frase che lo prova sta sull'appuntamento — non su una scadenza che non c'è.
  const deadlineEvidence = appointmentDate ? null : dateEvidence;
  const deadlineUnverified = dType === 'explicit' && dDate != null && !deadlineEvidence?.verified;

  // ⚠️⚠️ LA NATURA NON DICHIARATA NON È UN «TERMINE» SOTTINTESO. Un output che
  // non risponde alla domanda (analisi anteriori al 2026-08-15, risposta monca)
  // lascia l'interpretazione NON verificata: la data resta — è l'unica
  // informazione che abbiamo, e buttarla cancellerebbe scadenze vere — ma non
  // può presentarsi come un fatto. È la stessa scelta fatta per una scadenza
  // esplicita senza citazione verificata: si tiene e si dichiara.
  // ⚠️⚠️ E `none` SU UNA DATA VALORIZZATA CONTA COME SILENZIO (2026-08-19). Il
  // prompt definisce `none` come «se non c'è alcuna data» (prompt.ts §deadline):
  // dichiararlo insieme a una data è una CONTRADDIZIONE, non una risposta. Fino
  // a oggi la guardia scattava solo su `dateKind === null`, quindi un output
  // `{type:'explicit', date:'2026-09-10', dateKind:'none'}` passava il filtro e
  // usciva come «Scadenza 10.09.2026 · affidabilità alta» — cioè il sopralluogo
  // di Lugano un'altra volta, imboccato da un'altra strada.
  //
  // ⚠️ Non si giudica se `none` sia sincero leggendo il testo: si constata che
  // due campi dello stesso oggetto dicono cose incompatibili. Il `dDate != null`
  // in coda vale per entrambi i rami — senza data `none` è la risposta GIUSTA, e
  // farla scattare lì sarebbe il difetto di segno opposto.
  const kindUndeclared = (dateKind === null || dateKind === 'none')
    && dType === 'explicit' && dDate != null;
  const deadlineRequiresVerification =
    dType === 'relative' || dType === 'inferred' || (dType === 'explicit' && dDate == null)
    || deadlineUnverified || kindUndeclared;

  if (kindUndeclared) {
    warnings.push('deadline: natura della data non dichiarata dal modello → marcata da verificare');
    uncertainties.push({
      field: 'deadline',
      description: 'Non è stato dichiarato se questa data sia un termine o la data di un appuntamento: verificarlo sul documento',
      severity: 'medium',
    });
  }

  // ⚠️⚠️ IL MINIMO, NON LA MEDIA E NON IL VALORE. `confidence` risponde a «ho
  // letto bene la data?», `kindConfidence` a «ho capito che cos'è?». Il
  // 2026-08-15 la prima valeva 0.9 ed era giusta, la seconda non esisteva, e
  // l'interfaccia ha scritto «●●● alta» su una data-evento presa per scadenza.
  // Una lettura non può essere più sicura della più debole delle sue certezze:
  // un valore perfetto nel campo sbagliato resta un dato sbagliato.
  const valueConfidence = clamp01(ai.deadline?.confidence);
  const rawKindConfidence = ai.deadline?.kindConfidence;
  const deadlineConfidence = typeof rawKindConfidence === 'number' && Number.isFinite(rawKindConfidence)
    ? Math.min(valueConfidence, clamp01(rawKindConfidence))
    : valueConfidence;

  if (dType === 'relative') {
    uncertainties.push({ field: 'deadline', description: 'Scadenza relativa: data esatta da verificare in base alla data di ricezione', severity: 'medium' });
  }
  if (deadlineUnverified) {
    warnings.push('scadenza explicit senza citazione verificata: marcata da verificare');
    uncertainties.push({
      field: 'deadline',
      description: 'La data di scadenza non è confermata da una citazione verificabile nel documento: controllarla sull’originale',
      severity: 'high',
    });
  }

  // §13/§14 — azioni: extracted resta tale solo con evidence verificata.
  const rawActions = Array.isArray(ai.requestedActions) ? ai.requestedActions.slice(0, 6) : [];
  const actions: NormAction[] = rawActions.map((a, i) => {
    const evidence = ver(a?.evidence ?? null);
    const claimedExtracted = a?.sourceType === 'extracted';
    const sourceType: 'extracted' | 'suggested' = claimedExtracted && evidence?.verified ? 'extracted' : 'suggested';
    if (claimedExtracted && sourceType === 'suggested') {
      warnings.push('azione dichiarata extracted senza citazione verificata: declassata a suggested');
    }
    return {
      id: i,
      title: cleanStr(a?.title) ?? 'Azione',
      description: cleanStr(a?.description) ?? '',
      sourceType,
      required: typeof a?.required === 'boolean' ? a.required : null,
      deadlineReference: cleanStr(a?.deadlineReference),
      confidence: clamp01(a?.confidence),
      evidence: sourceType === 'extracted' ? evidence : null,
    };
  });

  // §14 — primaryAction: obbligo estratto > estratta con scadenza > estratta > suggerita.
  const priority = (a: NormAction) =>
    a.sourceType === 'extracted' && a.required === true ? 0
      : a.sourceType === 'extracted' && (a.deadlineReference || dDate) ? 1
        : a.sourceType === 'extracted' ? 2 : 3;
  const primaryAction = actions.length
    ? actions.map((a, idx) => ({ a, idx, p: priority(a) })).sort((x, y) => x.p - y.p || x.idx - y.idx)[0].a
    : null;

  // §16 — rischi: explicit resta tale solo con evidence verificata.
  const risks = (Array.isArray(ai.risks) ? ai.risks : []).map((r) => {
    const evidence = ver(r?.evidence ?? null);
    const claimedExplicit = r?.sourceType === 'explicit';
    const sourceType: 'explicit' | 'inferred' = claimedExplicit && evidence?.verified ? 'explicit' : 'inferred';
    if (claimedExplicit && sourceType === 'inferred') {
      warnings.push('rischio dichiarato explicit senza citazione verificata: declassato a inferred');
    }
    return { text: cleanStr(r?.text) ?? '', sourceType, confidence: clamp01(r?.confidence), evidence: sourceType === 'explicit' ? evidence : null };
  }).filter((r) => r.text);

  // §12 — importi: numeri finiti; la valuta si normalizza, NON si inventa.
  //
  // ⚠️⚠️ Fino al 2026-07-29 qui c'era `?? 'CHF'`. Sembrava un ripiego comodo su
  // un'app svizzera, ed era una risposta inventata a una domanda non posta: una
  // fattura tedesca da «4.500,00 EUR» in cui il modello non ripete la valuta
  // usciva da qui come 4500 CHF. Peggio, disinnescava la guardia scritta apposta
  // in `automation/conditions.ts` («CHF 5'000 non è EUR 5'000»), che di fronte a
  // una valuta ASSENTE risponde «non lo so» e non fa scattare la regola — ma di
  // fronte a un CHF inventato risponde «sì» e la fa scattare.
  //
  // L'importo si TIENE: buttarlo cambierebbe l'esito delle regole `exists` /
  // `not_exists` già scritte dagli utenti. Sparisce solo la certezza falsa.
  const amounts = (Array.isArray(ai.amounts) ? ai.amounts : [])
    .filter((a) => typeof a?.amount === 'number' && Number.isFinite(a.amount))
    .map((a) => ({
      amount: a.amount,
      currency: normalizeCurrency(cleanStr(a?.currency)),
      type: oneOf(a?.type, ['due', 'fine', 'fee', 'contribution', 'other'] as const, 'other'),
      description: cleanStr(a?.description) ?? '',
      confidence: clamp01(a?.confidence),
      evidence: ver(a?.evidence ?? null),
    }));

  // ⚠️ Severità `medium` e non `high`: una `high` manderebbe l'intera analisi in
  // `needs_review` (vedi `reviewStatus`), e un importo senza valuta dichiarata è
  // un dettaglio da controllare, non un'analisi da rifare.
  if (amounts.some((a) => a.currency === null) && !uncertainties.some((u) => u.field === 'amounts')) {
    uncertainties.push({
      field: 'amounts',
      description: 'Valuta non indicata nel documento per almeno un importo: verificare prima di usarlo in un confronto',
      severity: 'medium',
    });
  }

  const senderName = cleanStr(ai.sender?.name);
  const authorityType = oneOf<AuthorityType>(ai.sender?.authorityType, AUTHORITY_TYPES, 'unknown');
  if (!senderName && !uncertainties.some((u) => u.field === 'sender')) {
    uncertainties.push({ field: 'sender', description: 'Ente mittente non identificato con certezza', severity: 'medium' });
  }

  const docDate = cleanStr(ai.documentDate);

  // ⚠️⚠️ UN'ANALISI NON PUÒ DICHIARARSI PIÙ SICURA DEL SUO DATO PIÙ CONSEGUENTE.
  // `overallConfidence` alimenta l'etichetta «●●● alta» in testa alla schermata,
  // ed è la frase che toglie a chi legge il motivo di controllare. Quando c'è
  // una scadenza, quella scadenza è l'unico campo da cui nascono attività e
  // promemoria: se la lettura di quella data non è sicura, l'analisi non lo è.
  // Il taglio vale SOLO in presenza di una data — senza, la scadenza non ha
  // opinioni da imporre al resto.
  const overallConfidence = dDate != null
    ? Math.min(clamp01(ai.overallConfidence), deadlineConfidence)
    : clamp01(ai.overallConfidence);

  const normalized: NormalizedAnalysis = {
    // ⚠️ Il ripiego è `other`, non `it`. Prima era `it`, e siccome l'elenco non
    // conteneva l'inglese, OGNI documento inglese usciva «italiano»: un dato
    // sbagliato prodotto con la stessa faccia di uno giusto.
    language: oneOf<Language>(ai.language, LANGUAGES, 'other'),
    documentType: {
      value: oneOf<DocumentType>(ai.documentType?.value, DOCUMENT_TYPES, 'other'),
      confidence: clamp01(ai.documentType?.confidence),
      evidence: ver(ai.documentType?.evidence ?? null),
    },
    sender: {
      name: senderName,
      authorityType,
      confidence: clamp01(ai.sender?.confidence),
      evidence: senderName ? ver(ai.sender?.evidence ?? null) : null,
    },
    recipient: cleanStr(ai.recipient),
    subject: cleanStr(ai.subject),
    documentDate: isIsoDate(docDate) ? docDate : null,
    referenceNumbers: (Array.isArray(ai.referenceNumbers) ? ai.referenceNumbers : [])
      .map((r) => ({ label: cleanStr(r?.label) ?? '', value: cleanStr(r?.value) ?? '', evidence: ver(r?.evidence ?? null) }))
      .filter((r) => r.value),
    summary: cleanStr(ai.summaryShort) ?? '',
    deadline: {
      date: dDate,
      type: dType,
      dateKind,
      sourceText: cleanStr(ai.deadline?.sourceText),
      confidence: deadlineConfidence,
      evidence: deadlineEvidence,   // già verificata sopra: non ri-verificare (falserebbe il conteggio)
      requiresVerification: deadlineRequiresVerification,
    },
    appointment: appointmentDate
      ? {
        date: appointmentDate,
        sourceText: cleanStr(ai.deadline?.sourceText),
        confidence: deadlineConfidence,
        evidence: dateEvidence,
      }
      : null,
    amounts,
    actions,
    primaryAction,
    requestedDocuments: (Array.isArray(ai.requestedDocuments) ? ai.requestedDocuments : [])
      .map((d) => ({ name: cleanStr(d?.name) ?? '', required: typeof d?.required === 'boolean' ? d.required : null, confidence: clamp01(d?.confidence), evidence: ver(d?.evidence ?? null) }))
      .filter((d) => d.name),
    risks,
    legalReferences: (Array.isArray(ai.legalReferences) ? ai.legalReferences : [])
      .map((l) => ({ text: cleanStr(l?.text) ?? '', evidence: ver(l?.evidence ?? null) }))
      .filter((l) => l.text),
    replyNeeded: typeof ai.replyNeeded === 'boolean' ? ai.replyNeeded : false,
    uncertainties: [],
    overallConfidence,
    meta: { droppedEvidence: dropped, warnings },
  };

  if (dropped > 0) {
    uncertainties.push({
      field: 'evidence',
      description: `${dropped} citazione/i del modello non ritrovate nel documento e scartate`,
      severity: 'low',
    });
  }
  // dedup incertezze per (field+description)
  const seen = new Set<string>();
  normalized.uncertainties = uncertainties.filter((u) => {
    const k = u.field + '¦' + u.description;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  return normalized;
}

// ---- Categorie d'errore (§46) -----------------------------------------------
export const ERROR_CODES = [
  'UNSUPPORTED_FILE', 'FILE_TOO_LARGE', 'EMPTY_DOCUMENT', 'EXTRACTION_FAILED', 'OCR_FAILED',
  'AI_TIMEOUT', 'AI_INVALID_OUTPUT', 'AI_OUTPUT_TRUNCATED', 'EVIDENCE_VALIDATION_FAILED',
  'RATE_LIMITED', 'PROVIDER_ERROR', 'AI_NOT_CONFIGURED', 'AI_CREDIT_EXHAUSTED', 'UNKNOWN_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Che genere di guasto ha restituito il fornitore del modello?
 *
 * ⚠️ SI GUARDA IL MESSAGGIO, e non è una scelta elegante: l'API risponde
 * `400 invalid_request_error` sia per un credito esaurito sia per una richiesta
 * malformata, e il `type` non li distingue. L'unica differenza osservabile è
 * nel testo. Verificato contro l'API vera il 2026-07-29, quando il credito del
 * progetto si è esaurito e Admin AI ha cominciato a rispondere «riprova più
 * tardi» a un problema che aspettare non risolve.
 *
 * ⚠️ IL CONFRONTO È LARGO DI PROPOSITO: se un giorno il testo cambiasse, il
 * caso ricadrebbe in `PROVIDER_ERROR` — cioè nel comportamento di prima, non in
 * uno peggiore. Un riconoscitore troppo stretto che smette di funzionare in
 * silenzio è la trappola che questo progetto ha già pagato due volte.
 */
export function classifyProviderError(error: unknown): ErrorCode {
  const err = error as { status?: number; name?: string; message?: string } | null;
  const message = (err?.message ?? '').toLowerCase();

  if (/credit balance|insufficient.{0,20}credit|billing|quota exceeded/.test(message)) {
    return 'AI_CREDIT_EXHAUSTED';
  }
  if (err?.status === 429) return 'RATE_LIMITED';
  if (err?.name === 'AbortError') return 'AI_TIMEOUT';
  return 'PROVIDER_ERROR';
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNSUPPORTED_FILE: 'Formato file non supportato.',
  FILE_TOO_LARGE: 'Il file supera la dimensione massima consentita.',
  EMPTY_DOCUMENT: 'Il documento sembra vuoto o senza testo leggibile.',
  EXTRACTION_FAILED: 'Non è stato possibile estrarre il testo dal documento.',
  OCR_FAILED: 'Il riconoscimento del testo (OCR) non è riuscito.',
  AI_TIMEOUT: "L'analisi ha impiegato troppo tempo. Riprova.",
  AI_INVALID_OUTPUT: "La risposta del modello non è in un formato valido.",
  // ⚠️ NON è `AI_INVALID_OUTPUT`, e la differenza non è una sfumatura: il modello
  // stava rispondendo bene ed è stato interrotto dal tetto di token che abbiamo
  // scelto NOI. «La risposta non è in un formato valido» accusa il fornitore di
  // un limite nostro, e manda chi legge a cercare il guasto dove non è. Alzare
  // il tetto è una decisione da prendere con i suoi conti (§28): con
  // `messages.create` sincrono si scambierebbe una troncatura rara con un
  // timeout nuovo, che è un guasto peggiore perché non dice nemmeno perché.
  AI_OUTPUT_TRUNCATED:
    "L'analisi si è interrotta prima della fine: il documento richiede una "
    + "risposta più lunga di quella prevista. Non dipende dal documento — "
    + "serve un intervento di chi amministra l'applicazione.",
  EVIDENCE_VALIDATION_FAILED: 'Le informazioni estratte non hanno superato la verifica.',
  RATE_LIMITED: 'Troppe analisi in poco tempo. Attendi qualche istante e riprova.',
  PROVIDER_ERROR: "Il servizio di analisi ha restituito un errore. Riprova più tardi.",
  AI_NOT_CONFIGURED: 'Servizio AI non configurato.',
  // ⚠️ NON dice «riprova più tardi», e la differenza è tutto il punto: aspettare
  // non risolve un credito esaurito. Un messaggio che manda nella direzione
  // sbagliata è peggio di uno generico — chi legge riprova per mezz'ora prima
  // di sospettare che il problema non sia suo.
  AI_CREDIT_EXHAUSTED:
    "Il servizio di analisi non ha credito disponibile. Non dipende dal documento: "
    + "serve un intervento di chi amministra l'applicazione.",
  UNKNOWN_ERROR: 'Analisi non riuscita. Riprova tra poco.',
};
