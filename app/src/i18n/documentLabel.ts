// ============================================================================
// L'etichetta di un documento, in parole — UNA implementazione.
//
// La DECISIONE sta in `lib/documentTitle.ts` ed è pura: dice se il titolo si
// può mostrare e, se no, di che cosa comporre l'etichetta. Qui si traduce, e
// basta.
//
// ⚠️ PERCHÉ NON DENTRO IL SERVICE. Comporre la frase mentre si mappa una riga
// del database vorrebbe dire tradurla al momento della LETTURA: cambiando
// lingua senza rifare la richiesta, le etichette resterebbero nella lingua
// precedente. È la stessa trappola di `tr()` a livello di modulo, spostata di
// un metro. Il servizio decide (`item.label`), la schermata traduce.
//
// ⚠️ DUE PORTE, UN CORPO SOLO. I componenti usano `useDocumentLabel()`, che
// segue la lingua per via del contesto; `overview.ts` non è un componente e usa
// `documentLabelText()`, che chiama la stessa funzione con `translate`. Il
// giorno in cui i livelli diventassero quattro, cambia un posto.
// ============================================================================
import { translate, useI18n, type TFunction, type TKey } from './index';
import type { EtichettaDocumento } from '@/lib/documentTitle';

/** Come `useLabels().docType`, ma senza il gancio: valore grezzo se manca la chiave. */
function tipoLeggibile(t: TFunction, tipo: string): string {
  const key = `labels.docTypes.${tipo}` as TKey;
  const out = t(key);
  return out === key ? tipo : out;
}

export function componiEtichetta(e: EtichettaDocumento, t: TFunction): string {
  switch (e.origine) {
    case 'titolo':
      return e.titolo;
    // Il trattino lungo con gli spazi è quello che il prodotto usa già fra un
    // ente e ciò che ha mandato: «Comune di Lugano — Avviso di controllo».
    case 'mittente_e_tipo':
      return `${e.mittente} — ${tipoLeggibile(t, e.tipo)}`;
    case 'tipo':
      return tipoLeggibile(t, e.tipo);
    case 'nessuno':
      return t('documents.untitled');
  }
}

/** Per i componenti: segue la lingua scelta. */
export function useDocumentLabel() {
  const { t } = useI18n();
  return (e: EtichettaDocumento) => componiEtichetta(e, t);
}

/**
 * Per il codice che non è un componente (le priorità della Panoramica).
 * ⚠️ Va chiamata DENTRO una funzione, mai a livello di modulo: `translate` letto
 * all'import congela la lingua iniziale per tutta la sessione.
 */
export function documentLabelText(e: EtichettaDocumento): string {
  return componiEtichetta(e, translate);
}
