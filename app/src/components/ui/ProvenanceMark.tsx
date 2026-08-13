import { useT, type TKey } from '../../i18n';
import type { ActionSource } from '../../types/models';

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

/**
 * LA PROVENIENZA DI UN'AZIONE, con le parole delle azioni.
 *
 * Stesse due forme della famiglia — filetto PIENO per ciò che il documento
 * chiede, filetto DOPPIO per ciò che proponiamo noi — ma non le stesse parole:
 * su un fatto «Dal documento» significa che il valore è scritto lì; su
 * un'azione significherebbe soltanto che la frase viene da lì, mentre la cosa
 * che cambia la giornata di chi legge è un'altra — QUESTA COSA IL DOCUMENTO LA
 * CHIEDE, oppure gliela stiamo proponendo noi. Confondere le due è il tipo di
 * errore che fa fare a un cliente una pratica che nessuno gli aveva chiesto.
 *
 * ⚠️ UNA SOLA IMPLEMENTAZIONE. Stava dentro `ResultView.tsx` come componente
 * privato di quella schermata: finché è rimasta là, ogni altro posto che mostra
 * un'azione poteva scegliersi un segno suo — ed è precisamente quello che
 * succedeva, perché nessun altro posto ne mostrava uno.
 */
export function ActionOriginMark({ source }: { source: ActionSource }) {
  const t = useT();
  const estratta = source === 'extracted';
  return (
    <span className={`mark mark-prov ${estratta ? PROVENANCE_KINDS.document.cls : PROVENANCE_KINDS.suggestion.cls}`}>
      {t(estratta ? 'marks.actionOrigin.required' : 'marks.actionOrigin.suggested')}
    </span>
  );
}
