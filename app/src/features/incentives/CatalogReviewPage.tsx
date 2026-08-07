// ============================================================================
// Revisione del catalogo — UNA schermata, non un modulo.
//
// Serve a smaltire sette schede in mezz'ora: che cosa è cambiato sulla fonte,
// che cosa dice il catalogo oggi, e tre gesti. Non è un sistema di redazione, e
// non c'è alcun editor di catalogo: le correzioni vere restano nel seed, che è
// come questo catalogo è scritto.
//
// ⚠️ NON È PER I CLIENTI. Il catalogo è globale — non ha `company_id` — e ciò
// che dice vale per tutti i tenant insieme. L'autorità qui non è `member_role`,
// che è per azienda, ma l'appartenenza a `subsidy_catalog_editors` (0037),
// controllata DENTRO le RPC. Chi non è operatore vede una spiegazione, non un
// errore e non una pagina vuota.
//
// ⚠️ «APPROVA» NON APPLICA NIENTE, e vale la pena saperlo prima di premerlo. I
// `proposed_values` di queste schede sono impronte della pagina sorgente
// (`textLength`, `contentHash`, `declaredUpdatedAt`…), non campi di catalogo:
// dicono «la fonte si è mossa». Approvare significa «ho aperto la fonte, ciò che
// diciamo resta vero» e aggiorna `last_checked_at`. Nient'altro.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { EmptyCta, ErrorState, SkeletonCard } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { useT } from '@/i18n';
import { formatDate } from '@/lib/format';
import { catalogReviewService, type CatalogReview } from '@/services/catalogReviewService';
import { checkDecision, diffValues, waitingDays, type Decision } from './reviewModel';

export function CatalogReviewPage() {
  const t = useT();
  const { showToast } = useToast();
  const [items, setItems] = useState<CatalogReview[]>([]);
  const [editor, setEditor] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // ⚠️ Si chiede PRIMA se si è operatori, invece di dedurlo dal fallimento
      // della lettura: «non puoi guardare» e «la rete è caduta» sono due cose
      // diverse, e dedurre la prima dalla seconda produrrebbe una spiegazione
      // tranquillizzante per un guasto.
      const isEditor = await catalogReviewService.isEditor();
      setEditor(isEditor);
      setItems(isEditor ? await catalogReviewService.list() : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function decide(review: CatalogReview, decision: Decision) {
    const note = notes[review.id] ?? '';
    // La stessa regola sta nella 0037: qui evita una richiesta che il database
    // rifiuterebbe, là impedisce di aggirarla.
    const check = checkDecision(decision, note);
    if (!check.ok) {
      showToast(t(`catalogReview.error.${check.errorKey!}`));
      return;
    }
    setBusy(review.id);
    try {
      const { lastCheckedAt } = await catalogReviewService.resolve(review.id, decision, note);
      setItems((prev) => prev.filter((r) => r.id !== review.id));
      showToast(
        decision === 'accepted' && lastCheckedAt
          ? t('catalogReview.done.accepted', { date: formatDate(lastCheckedAt) })
          : t(`catalogReview.done.${decision}`),
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="ct-narrow"><SkeletonCard /></div>;
  if (error) return <div className="ct-narrow"><ErrorState message={error} /></div>;

  // ⚠️ Non è un errore: è la risposta corretta a chi non ha titolo per decidere
  // sul catalogo di tutti. Dirlo con una schermata d'errore suggerirebbe che
  // qualcosa si è rotto.
  if (editor === false) {
    return (
      <div className="ct-narrow">
        <div className="page-title">{t('catalogReview.title')}</div>
        <EmptyCta
          icon="lock"
          title={t('catalogReview.notEditor.title')}
          subtitle={t('catalogReview.notEditor.body')}
        />
      </div>
    );
  }

  return (
    <div className="ct-narrow">
      <div className="page-title">{t('catalogReview.title')}</div>
      <p className="muted-sm">{t('catalogReview.intro')}</p>

      {items.length === 0 ? (
        <EmptyCta icon="star" title={t('catalogReview.empty.title')} subtitle={t('catalogReview.empty.body')} />
      ) : (
        <div className="stack-sm">
          {items.map((r) => {
            const changes = diffValues(r.previousValues, r.proposedValues);
            const days = waitingDays(r.createdAt, new Date());
            const note = notes[r.id] ?? '';
            const working = busy === r.id;
            return (
              <section key={r.id} className="card stack-sm">
                <header className="row-wrap">
                  <div>
                    <strong>{r.programName ?? r.programId ?? t('catalogReview.unknownProgram')}</strong>
                    {r.programAuthority && <span className="muted-sm"> · {r.programAuthority}</span>}
                  </div>
                  <span className="muted-sm push-right">
                    {days === null
                      ? t('catalogReview.waitingUnknown')
                      : t('catalogReview.waiting', { days: String(days) })}
                  </span>
                </header>

                {/* Che cosa dice il catalogo OGGI: è il termine di paragone. */}
                <p className="muted-sm">
                  {t('catalogReview.catalogSays', {
                    checked: r.lastCheckedAt ? formatDate(r.lastCheckedAt) : t('catalogReview.never'),
                    status: r.dataStatus ?? '—',
                  })}
                </p>

                {/* Che cosa è cambiato sulla fonte. */}
                {changes.length === 0 ? (
                  <p className="muted-sm">{t('catalogReview.changes.none')}</p>
                ) : (
                  <table className="ct-cmp">
                    <thead>
                      <tr>
                        <th>{t('catalogReview.changes.field')}</th>
                        <th>{t('catalogReview.changes.before')}</th>
                        <th>{t('catalogReview.changes.after')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map((c) => (
                        <tr key={c.key}>
                          <th scope="row">
                            {c.key}
                            {/* ⚠️ Marcato, non nascosto: chi approva deve vedere
                                tutto ciò su cui mette la firma. */}
                            {c.technical && <span className="muted-sm"> · {t('catalogReview.changes.technical')}</span>}
                          </th>
                          <td>{c.kind === 'added' ? <span className="muted-sm">{t('catalogReview.changes.absent')}</span> : String(c.before)}</td>
                          <td>{c.kind === 'removed' ? <span className="muted-sm">{t('catalogReview.changes.absent')}</span> : String(c.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {r.sourceUrl && (
                  <p>
                    <a href={r.sourceUrl} target="_blank" rel="noreferrer noopener">
                      <Icon name="external" /> {t('catalogReview.openSource')}
                    </a>
                  </p>
                )}

                {/* ⚠️ Dentro `.field`, o in tema scuro è bianco su bianco. */}
                <div className="field">
                  <label htmlFor={`note-${r.id}`}>{t('catalogReview.note.label')}</label>
                  <textarea
                    id={`note-${r.id}`}
                    rows={2}
                    value={note}
                    placeholder={t('catalogReview.note.placeholder')}
                    onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value }))}
                  />
                  <p className="muted-sm">{t('catalogReview.note.hint')}</p>
                </div>

                <div className="row-wrap">
                  <button type="button" className="btn" disabled={working} onClick={() => void decide(r, 'accepted')}>
                    {t('catalogReview.decision.accept')}
                  </button>
                  <button type="button" className="btn btn-ghost" disabled={working} onClick={() => void decide(r, 'ignored')}>
                    {t('catalogReview.decision.ignore')}
                  </button>
                  <button type="button" className="btn btn-ghost" disabled={working} onClick={() => void decide(r, 'rejected')}>
                    {t('catalogReview.decision.reject')}
                  </button>
                </div>
                <p className="muted-sm">{t('catalogReview.decision.hint')}</p>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
