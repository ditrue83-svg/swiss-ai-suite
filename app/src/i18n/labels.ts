// ============================================================================
// Etichette di dominio tradotte: enum del database → testo leggibile.
//
// Prima vivevano come costanti italiane in engine.ts (DOC_TYPE_LABEL, LANG_LABEL,
// AUTHORITY_LABEL…): erano l'ultimo punto in cui l'interfaccia restava italiana
// anche cambiando lingua, ed erano usate in cinque schermate diverse.
//
// Regola: se il valore non è fra quelli previsti si restituisce il valore GREZZO,
// non un'etichetta inventata. Meglio vedere `contract_related` e accorgersi che
// manca una traduzione, che leggere una categoria plausibile ma sbagliata.
// ============================================================================
import { useI18n, type TKey } from './index';

export function useLabels() {
  const { t } = useI18n();

  /**
   * Risolve `percorso.valore`. Il percorso è completo (es. `labels.docTypes`
   * oppure `subsidy.labels.supportTypes`): non si antepone nulla, altrimenti le
   * etichette del Subsidy finirebbero sotto una chiave inesistente.
   * Se la chiave non esiste si torna il valore GREZZO, non un'etichetta finta.
   */
  const pick = (path: string, value: string | null | undefined): string => {
    if (!value) return '—';
    const key = `${path}.${value}` as TKey;
    const out = t(key);
    return out === key ? value : out;   // t() ritorna la chiave quando manca
  };

  return {
    /** Tipo di documento (tassonomia AI §8 e chiavi storiche del motore locale). */
    docType: (v: string | null | undefined) => pick('labels.docTypes', v),
    /** Tipo di autorità mittente (§47). */
    authorityType: (v: string | null | undefined) => pick('labels.authorityTypes', v),
    /**
     * Categoria documentale (0017). NON è il tipo di documento: quello dice che
     * cosa è, questa dice dove sta nell'organizzazione dell'azienda.
     */
    category: (v: string | null | undefined) => pick('labels.categories', v),
    /** Natura dell'importo (§12): dovuto, multa, tassa… */
    amountType: (v: string | null | undefined) => pick('labels.amountTypes', v),
    /** Lingua del documento. */
    language: (v: string | null | undefined) => pick('labels.languages', v),
    urgency: (v: string | null | undefined) => pick('labels.urgency', v),
    /** Tono della bozza di risposta: formale, conciso, cordiale. */
    tone: (v: string | null | undefined) => pick('labels.tones', v),
    confidence: (v: string | null | undefined) => pick('labels.confidence', v),
    deadlineLevel: (v: string | null | undefined) => pick('labels.deadlineLevels', v),

    // ---- Finanze (0021) -------------------------------------------------
    /** Fattura fornitore, ricevuta, nota di credito. */
    financeType: (v: string | null | undefined) => pick('labels.financeTypes', v),
    /** Il lavoro della PERSONA: da verificare / verificata. */
    financeReview: (v: string | null | undefined) => pick('labels.financeReview', v),
    /** Lo stato della MACCHINA: in attesa, lettura in corso, letto, non riuscita. */
    financeProcessing: (v: string | null | undefined) => pick('labels.financeProcessing', v),
    /** Categoria di SPESA (§57): raggruppa, non registra. Non è un conto contabile. */
    expenseCategory: (v: string | null | undefined) => pick('labels.expenseCategories', v),
    /** Come è stata pagata una spesa, SE il documento lo dice (§59). */
    paymentMethod: (v: string | null | undefined) => pick('labels.paymentMethods', v),
    /** Riferimento QR, riferimento del creditore (SCOR), nessun riferimento. */
    referenceType: (v: string | null | undefined) => pick('labels.referenceTypes', v),
    /** Da dove viene un singolo campo: è ciò che rende verificabile la lettura. */
    fieldSource: (v: string | null | undefined) => pick('labels.fieldSources', v),
    /** Che cosa è cambiato su una fattura, nello storico (§87). */
    financeEvent: (v: string | null | undefined) => pick('finance.eventKinds', v),

    // ---- Subsidy AI ----------------------------------------------------
    /** Tipo di sostegno: contributo a fondo perso, prestito, fideiussione… */
    supportType: (v: string | null | undefined) => pick('subsidy.labels.supportTypes', v),
    /** Esito della verifica di idoneità (mai una promessa: è una stima). */
    eligibility: (v: string | null | undefined) => pick('subsidy.labels.eligibility', v),
    /** Affidabilità del dato di catalogo: verificato / da ricontrollare / demo. */
    dataStatus: (v: string | null | undefined) => pick('subsidy.labels.dataStatus', v),
    /** Settore economico dell'impresa. */
    sector: (v: string | null | undefined) => pick('subsidy.labels.sectors', v),
    /** Ambito del progetto (energia, digitalizzazione…). */
    projectType: (v: string | null | undefined) => pick('subsidy.labels.projectTypes', v),
  };
}
