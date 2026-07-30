// ============================================================================
// Scheda 4 — CATALOGO. «Da dove viene quello che vi dico».
//
// È la scheda che rende il modulo verificabile invece che credibile. Per ogni
// programma dice: la versione dei requisiti in vigore, quanti criteri contiene,
// quali finestre esistono, quale fonte UFFICIALE lo alimenta e quando è stata
// controllata con successo l'ultima volta.
//
// ⚠️ SOLA LETTURA, E NON PER PRUDENZA. §28 — non esiste un editor di catalogo
//    per il cliente: il catalogo è condiviso, e un'impresa che potesse
//    riscriverlo riscriverebbe i requisiti che il prodotto presenta a tutte le
//    altre. La 0032 non concede al client alcun permesso di scrittura.
//
// ⚠️ LE REVISIONI IN ATTESA NON SI VEDONO, e non è un permesso dimenticato: la
//    0032 non ha alcuna policy su `subsidy_catalog_reviews` proprio perché
//    contengono proposte che nessuno ha ancora guardato. Mostrarle
//    significherebbe presentare come dato del catalogo qualcosa di non
//    verificato — il contrario esatto di ciò a cui la revisione serve.
//
// ⚠️ «ULTIMA VERIFICA» È L'ULTIMO CONTROLLO RIUSCITO. Un tentativo fallito non
//    la aggiorna: dedurre la freschezza da un errore renderebbe «verificato
//    oggi» un dato mai letto.
// ============================================================================
import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { EmptyCta, ErrorState, SkeletonCard } from '@/components/ui/states';
import { useT, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { formatDate } from '@/lib/format';
import { incentivesService } from '@/services/incentivesService';
import type { IncentiveCatalogProgram } from '@/types/models';
import { CALL_STATUS_KEY } from './incentivesModel';

export function CatalogTab() {
  const t = useT();
  const L = useLabels();
  const [items, setItems] = useState<IncentiveCatalogProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const list = await incentivesService.catalog();
        if (!cancelled) setItems(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  if (loading && items.length === 0) return <SkeletonCard />;
  if (error) return <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />;
  if (items.length === 0) {
    // ⚠️ «Il catalogo è vuoto» e non «nessun programma per te»: la differenza è
    // fra un guasto di caricamento e una risposta. Confonderle è il fallback
    // silenzioso che la governance vieta.
    return (
      <EmptyCta
        icon="archive"
        title={t('incentives.catalog.emptyTitle')}
        subtitle={t('incentives.catalog.emptySub')}
      />
    );
  }

  return (
    <>
      <p className="muted-sm">{t('incentives.catalog.intro')}</p>

      <div className="card mt-8">
        {items.map((p) => {
          const open = openId === p.id;
          return (
            <div key={p.id} className="list-row inc-cat-row">
              <div className="list-main">
                <div className="list-title">
                  <button type="button" className="inc-open" onClick={() => setOpenId(open ? null : p.id)}>
                    {p.name}
                  </button>
                </div>
                <div className="list-sub">
                  {p.authority} · {L.supportType(p.supportType)}
                  {p.geography.length > 0 && <> · {p.geography.join(', ')}</>}
                </div>

                <div className="badge-row">
                  {/* Le DUE pastiglie che cambiano quello che fai (regola 7 del
                      sistema di design): se è concedibile oggi, e se la domanda
                      va presentata prima di iniziare. Il resto è testo. */}
                  {p.availability === 'suspended' && (
                    <span className="badge badge-media">{t('incentives.catalog.suspended')}</span>
                  )}
                  {p.lifecycle === 'retired' && (
                    <span className="badge badge-neutral">{t('incentives.catalog.retired')}</span>
                  )}
                  {p.mustApplyBeforeStart && (
                    <span className="badge badge-blue">{t('incentives.catalog.applyBeforeStart')}</span>
                  )}
                </div>

                <div className="list-sub">
                  {p.version
                    ? t('incentives.catalog.versionLine', {
                      n: p.version.versionNumber,
                      criteria: p.version.criteriaCount,
                    })
                    // ⚠️ Un programma senza versione pubblicata si DICHIARA: è
                    // un programma su cui il motore non può valutare nulla, e
                    // tacerlo lo farebbe sembrare completo.
                    : t('incentives.catalog.noVersion')}
                  {' · '}
                  {p.source?.lastSuccessfulCheckAt
                    ? t('incentives.catalog.lastChecked', {
                      date: formatDate(p.source.lastSuccessfulCheckAt),
                    })
                    // «Mai verificata» è diverso da «vecchia»: si scrive.
                    : t('incentives.catalog.neverChecked')}
                </div>

                {open && <CatalogDetail program={p} />}
              </div>

              <div className="inc-row-side">
                <a
                  className="mini-btn"
                  href={p.officialSourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <Icon name="external" className="ic-sm" /> {t('incentives.catalog.officialPage')}
                </a>
                <button type="button" className="mini-btn" onClick={() => setOpenId(open ? null : p.id)}>
                  {open ? t('incentives.catalog.hide') : t('incentives.catalog.details')}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="footnote">{t('incentives.catalog.footnote')}</div>
    </>
  );
}

function CatalogDetail({ program: p }: { program: IncentiveCatalogProgram }) {
  const t = useT();
  const L = useLabels();

  return (
    <div className="inc-cat-detail">
      {p.contributionDescription && (
        <p className="mt-8">{p.contributionDescription}</p>
      )}

      {p.availability === 'suspended' && p.availabilityNote && (
        <div className="info-box mt-8">
          <Icon name="alert" className="ic-sm" /> <span>{p.availabilityNote}</span>
        </div>
      )}

      <dl className="crm-kv mt-8">
        <dt>{t('incentives.catalog.dataStatus')}</dt>
        <dd>{L.dataStatus(p.dataStatus)}</dd>
        {p.projectTypes.length > 0 && (
          <>
            <dt>{t('incentives.catalog.projectTypes')}</dt>
            <dd>{p.projectTypes.map((tp) => L.projectType(tp)).join(', ')}</dd>
          </>
        )}
        {p.version && (
          <>
            <dt>{t('incentives.catalog.inForceSince')}</dt>
            <dd>
              {p.version.effectiveFrom
                ? formatDate(p.version.effectiveFrom)
                : t('incentives.catalog.notDeclared')}
              {p.version.publishedAt && (
                <> · {t('incentives.catalog.recordedOn', { date: formatDate(p.version.publishedAt) })}</>
              )}
            </dd>
          </>
        )}
        {p.source && (
          <>
            <dt>{t('incentives.catalog.source')}</dt>
            <dd>
              <a href={p.source.canonicalUrl} target="_blank" rel="noreferrer noopener">
                {p.source.canonicalUrl} <Icon name="external" className="ic-sm" />
              </a>
              <div className="muted-sm">
                {t(`incentives.sourceTypes.${p.source.sourceType}` as TKey)}
                {' · '}
                {t('incentives.catalog.checkEvery', { days: p.source.checkFrequencyDays })}
                {/* ⚠️ Un errore recente si dice: significa che ciò che vedi
                    potrebbe non essere l'ultima parola della fonte. */}
                {p.source.lastErrorAt && (
                  <> · {t('incentives.catalog.lastError', { date: formatDate(p.source.lastErrorAt) })}</>
                )}
              </div>
            </dd>
          </>
        )}
      </dl>

      {p.documentsRequired.length > 0 && (
        <div className="crm-sec">
          <div className="section-title">{t('incentives.catalog.documents')}</div>
          <ul className="detail-list">
            {p.documentsRequired.map((d) => <li key={d}>{d}</li>)}
          </ul>
        </div>
      )}

      <div className="crm-sec">
        <div className="section-title">{t('incentives.catalog.calls')}</div>
        {p.calls.length === 0 ? (
          // ⚠️ «Nessuna finestra registrata» non è «non ci si può candidare»:
          // dice che il catalogo non ne conosce, e la fonte ufficiale resta la
          // risposta. Trasformarlo in «chiuso» sarebbe un'invenzione.
          <p className="muted-sm">{t('incentives.catalog.noCalls')}</p>
        ) : (
          <ul className="state-list">
            {p.calls.map((c) => (
              <li key={c.id}>
                <span className="badge badge-neutral">{t(CALL_STATUS_KEY[c.status])}</span>
                {' '}
                {c.title ?? c.externalReference ?? t('incentives.catalog.callUnnamed')}
                {c.deadlineOn && <> · {t('incentives.catalog.deadline', { date: formatDate(c.deadlineOn) })}</>}
                {c.continuous && <> · {t('incentives.catalog.continuous')}</>}
                {/* Testo e non data: le autorità scrivono «autunno 2026», e
                    trasformarlo in 01.09.2026 sarebbe inventare un giorno. */}
                {c.expectedNextCall && (
                  <> · {t('incentives.catalog.expectedNext', { text: c.expectedNextCall })}</>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
