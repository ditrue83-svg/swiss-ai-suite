import { useState } from 'react';
import { useT } from '../../i18n';
import { MarkGlyph } from './MarkGlyph';

/**
 * EVIDENZA — la citazione torna in primo piano. Ogni affermazione con evidenza
 * verificata può mostrare la frase originale IN LINEA, senza cambiare pagina:
 * la verificabilità è il prodotto, non un dettaglio dietro un secondo clic.
 *
 * La citazione aperta porta il filetto PIENO della provenienza «dal documento»
 * (app.css, `.evidence-quote`): è la stessa grammatica del sistema.
 *
 * ⚠️ Un campo SENZA evidenza verificata LO DICE, in maiuscoletto muto: tacere
 * lascerebbe credere che la prova esista e non sia stata mostrata.
 */
export function EvidenceLink({ quote, page, verified = true }: {
  quote: string | null | undefined;
  /** Pagina di provenienza, quando l'analisi la conosce. */
  page?: number | null;
  /** `false` quando la citazione esiste ma NON è stata trovata nel testo estratto. */
  verified?: boolean;
}) {
  const t = useT();
  const [aperta, setAperta] = useState(false);
  if (!quote || !verified) {
    return (
      <span className="evidence-none">
        <MarkGlyph name="question" />
        {t('marks.evidence.none')}
      </span>
    );
  }
  return (
    <span className="evidence-wrap">
      <button
        type="button"
        className="evidence-toggle"
        aria-expanded={aperta}
        onClick={() => setAperta((v) => !v)}
      >
        <MarkGlyph name="quote" />
        {aperta ? t('marks.evidence.hide') : t('marks.evidence.show')}
      </button>
      {aperta && (
        <blockquote className="evidence-quote">
          «{quote}»
          {page ? <span className="eq-page">{t('marks.evidence.page', { n: page })}</span> : null}
        </blockquote>
      )}
    </span>
  );
}
