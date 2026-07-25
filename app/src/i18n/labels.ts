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

  /** Risolve `gruppo.valore`; se la chiave non esiste torna il valore grezzo. */
  const pick = (group: string, value: string | null | undefined): string => {
    if (!value) return '—';
    const key = `labels.${group}.${value}` as TKey;
    const out = t(key);
    return out === key ? value : out;   // t() ritorna la chiave quando manca
  };

  return {
    /** Tipo di documento (tassonomia AI §8 e chiavi storiche del motore locale). */
    docType: (v: string | null | undefined) => pick('docTypes', v),
    /** Tipo di autorità mittente (§47). */
    authorityType: (v: string | null | undefined) => pick('authorityTypes', v),
    /** Natura dell'importo (§12): dovuto, multa, tassa… */
    amountType: (v: string | null | undefined) => pick('amountTypes', v),
    /** Lingua del documento. */
    language: (v: string | null | undefined) => pick('languages', v),
    urgency: (v: string | null | undefined) => pick('urgency', v),
    confidence: (v: string | null | undefined) => pick('confidence', v),
    deadlineLevel: (v: string | null | undefined) => pick('deadlineLevels', v),
  };
}
