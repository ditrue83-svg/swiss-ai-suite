// ============================================================================
// L'INDICATORE DI ATTENDIBILITÀ — la resa a schermo del verdetto di
// `analysisTrust.ts`, in un componente solo per tutte le superfici.
//
// ⚠️ QUESTO COMPONENTE NON CALCOLA NIENTE: riceve un `TrustVerdict` già
// deciso. Se una schermata gli passasse un livello costruito in casa, il
// difetto sarebbe suo — e il guardiano nei test dei Documenti controlla che
// nessuna schermata mostri più il campo grezzo.
//
// LA FORMA. In intestazione: «Attendibilità dell'analisi — ●○○ bassa ·
// 3 elementi da verificare». Il livello risponde a «quanto posso fidarmi», il
// conteggio a «quanto lavoro resta aperto»: due fatti diversi, affiancati,
// nessuno dei due travestito da altro. Quando un tetto è attivo, sotto compare
// il SUO motivo e un «perché» che li elenca tutti: un livello abbassato senza
// motivo visibile è opaco quanto un livello sbagliato.
//
// ⚠️ «NON VALUTABILE» NON HA PALLINI. Non è un quarto livello e non è un
// livello vuoto: è l'assenza del giudizio, dichiarata a parole. I tre pallini
// restano il segno dei tre livelli veri (ConfidenceBadge, che è il segno di
// fiducia ESISTENTE: questo lavoro non ne introduce di nuovi).
//
// ⚠️ I MOTIVI SONO CHIAVI CON PARAMETRI, mai frasi incollate a pezzi: in de e
// fr l'ordine delle parole non è quello italiano. L'elenco dei campi dentro un
// parametro è un ELENCO (virgole), non sintassi.
// ============================================================================
import { useT, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { formatDate } from '@/lib/format';
import { ConfidenceBadge } from '@/components/ui/ConfidenceBadge';
import { radiceCampo, type TrustCap, type TrustVerdict } from './analysisTrust';
import styles from './documents.module.css';

/** I nomi tradotti dei campi coinvolti in un tetto, come elenco. */
function nomiCampi(fields: readonly string[], t: ReturnType<typeof useT>): string {
  const visti = new Set<string>();
  const nomi: string[] = [];
  for (const f of fields) {
    const radice = radiceCampo(f) || f;
    if (visti.has(radice)) continue;
    visti.add(radice);
    // Un campo fuori dalla tavola (non dovrebbe accadere) resta col suo nome
    // grezzo: meglio un identificatore che una traduzione inventata.
    const k = `documents.trust.fields.${radice}` as TKey;
    const out = t(k);
    nomi.push(out === k ? radice : out);
  }
  return nomi.join(', ');
}

/** La frase di UN tetto, completa e tradotta. */
export function reasonText(
  cap: TrustCap,
  t: ReturnType<typeof useT>,
  meta: { schemaVersion: number; analysedAt: string | null },
): string {
  switch (cap.reason) {
    case 'evidence_missing':
      return cap.fields.length > 1
        ? t('documents.trust.reasons.evidence_missing_many', { fields: nomiCampi(cap.fields, t) })
        : t('documents.trust.reasons.evidence_missing_one', { fields: nomiCampi(cap.fields, t) });
    case 'deadline_to_verify':
      return t('documents.trust.reasons.deadline_to_verify');
    case 'deadline_nature_unrecorded':
      // ⚠️ Il tetto nasce da un campo introdotto DOPO quest'analisi: lo si
      // dice con la versione dello schema e la data, e non si offre nessuna
      // azione — non c'è niente che l'utente possa correggere adesso.
      return t('documents.trust.reasons.deadline_nature_unrecorded', {
        version: meta.schemaVersion,
        date: meta.analysedAt ? formatDate(meta.analysedAt) : '—',
      });
    case 'deadline_inferred':
      return t('documents.trust.reasons.deadline_inferred');
    case 'point_high':
      return t('documents.trust.reasons.point_high', { fields: nomiCampi(cap.fields, t) });
    case 'point_medium':
      return t('documents.trust.reasons.point_medium', { fields: nomiCampi(cap.fields, t) });
  }
}

export function TrustIndicator({ verdict, schemaVersion, analysedAt, withTitle = true }: {
  verdict: TrustVerdict;
  schemaVersion: number;
  analysedAt: string | null;
  /** `false` dove il titolo lo porta già il contenitore (la `dt` di un elenco). */
  withTitle?: boolean;
}) {
  const t = useT();
  const L = useLabels();
  const meta = { schemaVersion, analysedAt };
  const points = verdict.pointCount === 1
    ? t('documents.trust.pointsOne')
    : t('documents.trust.pointsMany', { n: verdict.pointCount });

  return (
    <>
      <span className={styles.trustHead}>
        {withTitle && (
          <>
            <span className="trust-title">{t('documents.trust.title')}</span>
            {' — '}
          </>
        )}
        {verdict.unavailable === 'ownership'
          ? <span className={styles.trustUnavailable}>{t('documents.trust.unavailableOwnership')}</span>
          : (
            <>
              <ConfidenceBadge level={verdict.level ?? 'bassa'} />
              {verdict.pointCount > 0 && <span className={styles.trustPoints}>{' · '}{points}</span>}
            </>
          )}
      </span>

      {/* Il motivo che DECIDE, e il pannello con tutti. Compare anche quando
          l'indicatore è assente: chi non vede un livello ha ancora più diritto
          di sapere che cosa lo tratterrebbe. */}
      {verdict.binding && (
        <span className={styles.trustReason}>
          {reasonText(verdict.binding, t, meta)}
          <details className={styles.trustWhy}>
            <summary>{t('documents.trust.why')}</summary>
            <span className={styles.trustWhyPanel} role="note">
              <span className={styles.trustWhyTitle}>{t('documents.trust.whyTitle')}</span>
              <span>{t('documents.trust.whyModel', { level: L.confidence(verdict.modelLevel) })}</span>
              {verdict.caps.length === 0
                ? <span>{t('documents.trust.whyNoCaps')}</span>
                : verdict.caps.map((c, i) => (
                  <span key={i}>
                    {t('documents.trust.capLine', { reason: reasonText(c, t, meta), level: L.confidence(c.cap) })}
                  </span>
                ))}
            </span>
          </details>
        </span>
      )}
    </>
  );
}
