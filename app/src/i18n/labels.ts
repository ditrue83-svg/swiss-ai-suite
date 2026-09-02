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

  /** Risolve una chiave di etichetta e conserva il valore grezzo se manca. */
  const pick = (path: string, value: string | null | undefined): string => {
    if (!value) return '—';
    const key = `${path}.${value}` as TKey;
    const out = t(key);
    return out === key ? value : out;   // t() ritorna la chiave quando manca
  };

  return {
    /** Tipo di documento (tassonomia AI §8 e chiavi storiche del motore locale). */
    docType: (v: string | null | undefined) => pick('labels.docTypes', v),
    // ---- CRM Light (0026) --------------------------------------------------
    // ⚠️ `crmRole` NON è `crmStage`, e la distinzione è di dominio: il ruolo
    // descrive il RAPPORTO («cliente»), la fase descrive UNA TRATTATIVA
    // («negoziazione»). Un'unica funzione per entrambi avrebbe reso possibile
    // stampare «negoziazione» come ruolo di un'impresa.
    crmRole: (v: string | null | undefined) => pick('labels.crmRoles', v),
    crmStage: (v: string | null | undefined) => pick('labels.crmStages', v),
    crmStatus: (v: string | null | undefined) => pick('labels.crmStatus', v),
    crmSource: (v: string | null | undefined) => pick('labels.crmSources', v),
    crmInteraction: (v: string | null | undefined) => pick('labels.crmInteractions', v),
    crmRelation: (v: string | null | undefined) => pick('labels.crmRelations', v),
    /** Perché due cose sono state avvicinate. Decide se il collegamento è automatico. */
    crmReason: (v: string | null | undefined) => pick('labels.crmReasons', v),
    /** Tipo di un campo personalizzato (0047): testo, numero, data, lista. */
    crmFieldType: (v: string | null | undefined) => pick('labels.crmFieldTypes', v),
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

    // ---- Contratti (0024) -----------------------------------------------
    // ⚠️ Come per tutte le altre: un valore fuori elenco mostra il valore
    // GREZZO, non un'etichetta inventata.
    contractType: (v: string | null | undefined) => pick('labels.contractTypes', v),
    contractReview: (v: string | null | undefined) => pick('labels.contractReview', v),
    contractLifecycle: (v: string | null | undefined) => pick('labels.contractLifecycle', v),
    /** ⚠️ «Non chiaro» è un valore pieno, non un'assenza: vedi la 0024. */
    contractRenewal: (v: string | null | undefined) => pick('labels.contractRenewal', v),
    contractFrequency: (v: string | null | undefined) => pick('labels.contractFrequency', v),
    contractRelation: (v: string | null | undefined) => pick('labels.contractRelations', v),
    contractUnit: (v: string | null | undefined) => pick('labels.contractUnits', v),
    /** L'ancoraggio del preavviso: è ciò che decide se una data si può ricavare. */
    contractAnchor: (v: string | null | undefined) => pick('labels.contractAnchors', v),
    contractTermination: (v: string | null | undefined) => pick('labels.contractTermination', v),
    milestoneKind: (v: string | null | undefined) => pick('labels.milestoneKinds', v),
    milestoneSource: (v: string | null | undefined) => pick('labels.milestoneSources', v),
    milestoneStatus: (v: string | null | undefined) => pick('labels.milestoneStatuses', v),
    contractFlag: (v: string | null | undefined) => pick('labels.contractFlags', v),

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

  };
}
