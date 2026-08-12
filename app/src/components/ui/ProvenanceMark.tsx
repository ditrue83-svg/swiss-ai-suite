import { useT, type TKey } from '../../i18n';

/**
 * PROVENIENZA — il filetto verticale di revisione dei documenti amministrativi.
 * Lo STILE del bordo è il segno (pieno · doppio · tratteggiato · puntinato);
 * il colore è rinforzo, mai unico portatore: si distingue anche in bianco e nero.
 *
 * Aggiungere una provenienza = una riga in PROVENANCE_KINDS (la legenda la
 * elenca da sola). Le classi stanno in app.css, sezione «MARCATURE».
 */
export type ProvenanceKind = 'document' | 'suggestion' | 'inference' | 'toVerify';

export const PROVENANCE_KINDS: Record<ProvenanceKind, { cls: string; labelKey: TKey }> = {
  document: { cls: 'mp-doc', labelKey: 'marks.provenance.document' },
  suggestion: { cls: 'mp-sugg', labelKey: 'marks.provenance.suggestion' },
  inference: { cls: 'mp-inf', labelKey: 'marks.provenance.inference' },
  toVerify: { cls: 'mp-verify', labelKey: 'marks.provenance.toVerify' },
};

export function ProvenanceMark({ kind }: { kind: ProvenanceKind }) {
  const t = useT();
  const k = PROVENANCE_KINDS[kind];
  return <span className={`mark mark-prov ${k.cls}`}>{t(k.labelKey)}</span>;
}
