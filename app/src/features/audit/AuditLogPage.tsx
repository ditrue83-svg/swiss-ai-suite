// ============================================================================
// Registro attività (0039) — chi ha fatto che cosa, e quando.
//
// ⚠️ NON È UNA SECONDA CRONOLOGIA. Il dettaglio di un fatto resta nel modulo che
// lo possiede: i valori di una correzione sulla scheda del documento, la storia
// di un'attività sull'attività. Qui c'è l'indice trasversale, in ordine di
// tempo, che prima non esisteva da nessuna parte.
//
// ⚠️ È PER TITOLARI E AMMINISTRATORI, e il cancello vero non è questa pagina:
// è la policy `audit_select_admin` della 0039. Qui si CHIEDE il ruolo invece di
// dedurlo da un elenco vuoto — «non puoi guardare» e «non è successo niente»
// sono due frasi diverse, e dedurre la prima dalla seconda darebbe una
// spiegazione tranquillizzante a un problema di permessi (stessa scelta della
// schermata di revisione del catalogo).
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Button, EmptyCta, ErrorState, SkeletonCard } from '@/components/ui/states';
import { useCompany } from '@/contexts/CompanyContext';
import { useT } from '@/i18n';
import { formatDate, formatDateTime } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { auditService } from '@/services/auditService';
import { memberService } from '@/services/memberService';
import type { AuditEntry } from '@/types/models';
import {
  AUDIT_ACTIONS, AUDIT_PAGE_SIZE, AUDIT_PERIODS, actionLabelKey, changeEntries,
  entryHref, fieldLabelKey, filtersFromParams, groupByDay, isAuditAction, isAuditPeriod,
  paramsFromFilters, type AuditFilters,
} from './auditModel';

export function AuditLogPage() {
  const t = useT();
  const { activeCompanyId, isAdmin, ready } = useCompany();
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params);

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le dipendenze del caricamento sono i due VALORI dei filtri, non l'oggetto
  // `filters` — che viene ricostruito a ogni render e farebbe ripartire la
  // lettura all'infinito.
  const { period, action } = filters;

  const load = useCallback(async () => {
    if (!activeCompanyId || !isAdmin) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const page = await auditService.list(activeCompanyId, { period, action }, 0);
      setEntries(page.entries);
      setTotal(page.total);
      // I nomi delle persone passano dalla rubrica: `profiles` è leggibile solo
      // dal proprietario, quindi senza questa chiamata il registro mostrerebbe
      // identificativi al posto dei colleghi (vedi memberService).
      const directory = await memberService.listAssignable(activeCompanyId);
      setNames(Object.fromEntries(directory.map((m) => [m.userId, m.name])));
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, isAdmin, period, action]);

  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!activeCompanyId) return;
    setLoadingMore(true);
    try {
      const page = await auditService.list(activeCompanyId, { period, action }, entries.length);
      setEntries((prev) => [...prev, ...page.entries]);
      setTotal(page.total);
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  function setFilter(patch: Partial<AuditFilters>) {
    setParams(paramsFromFilters({ ...filters, ...patch }), { replace: true });
  }

  /**
   * Un valore VUOTO si dice, non si mostra come niente: «Titolo impostato a »
   * lascerebbe credere a un difetto di visualizzazione invece che a un titolo
   * davvero vuoto.
   */
  const shownValue = (v: string | null): string => (v === null || v === '' ? t('audit.change.empty') : v);

  /** Chi ha agito. NULL = il sistema, e lo si dice — non «sconosciuto». */
  function actorLabel(entry: AuditEntry): string {
    if (entry.actorUserId === null) return t('audit.actor.system');
    const name = names[entry.actorUserId];
    if (name) return name;
    // Ha agito una persona che oggi non è più nell'azienda: l'identificativo
    // resta nel registro (nessuna chiave esterna, 0039), il nome no.
    return t('audit.actor.former');
  }

  // ⚠️ `ready` e non `!loading`: prima che le membership siano state lette per
  // QUESTO utente non si sa se sia amministratore, e mostrare la spiegazione
  // «non hai i permessi» in quell'istante sarebbe una risposta inventata.
  if (!ready) return <div className="ct-narrow"><SkeletonCard /></div>;

  if (!isAdmin) {
    return (
      <div className="ct-narrow">
        <div className="page-title">{t('audit.title')}</div>
        <EmptyCta icon="lock" title={t('audit.notAdmin.title')} subtitle={t('audit.notAdmin.body')} />
      </div>
    );
  }

  return (
    <div className="ct-narrow">
      <div className="page-title">{t('audit.title')}</div>
      <p className="muted-sm">{t('audit.intro')}</p>

      <div className="row-wrap" style={{ marginBottom: 12 }}>
        {/* ⚠️ Ogni campo dentro `.field`, o in tema scuro è bianco su bianco. */}
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="f-periodo">{t('audit.filter.period')}</label>
          <select
            id="f-periodo"
            className="select-inline"
            value={filters.period}
            onChange={(e) => { if (isAuditPeriod(e.target.value)) setFilter({ period: e.target.value }); }}
          >
            {AUDIT_PERIODS.map((p) => (
              <option key={p} value={p}>{t(`audit.period.${p}`)}</option>
            ))}
          </select>
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="f-tipo">{t('audit.filter.action')}</label>
          <select
            id="f-tipo"
            className="select-inline"
            value={filters.action ?? ''}
            onChange={(e) => setFilter({ action: isAuditAction(e.target.value) ? e.target.value : null })}
          >
            <option value="">{t('common.all')}</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>{t(actionLabelKey(a))}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <SkeletonCard />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : entries.length === 0 ? (
        <EmptyCta icon="clock" title={t('audit.empty.title')} subtitle={t('audit.empty.body')} />
      ) : (
        <>
          {/* ⚠️ Quante righe si stanno vedendo SU QUANTE. Un elenco troncato che
              non dichiara di esserlo è indistinguibile da un elenco completo. */}
          <p className="muted-sm">{t('audit.shown', { shown: String(entries.length), total: String(total) })}</p>

          <div className="stack-sm">
            {groupByDay(entries).map((group) => (
              <section key={group.day} className="card stack-sm">
                <header><strong>{formatDate(group.entries[0]!.createdAt)}</strong></header>
                {group.entries.map((entry) => {
                  const href = entryHref(entry);
                  const changes = changeEntries(entry.changes);
                  return (
                    <article key={entry.id} className="stack-sm">
                      <div className="row-wrap">
                        <strong>{t(actionLabelKey(entry.action))}</strong>
                        <span className="muted-sm">
                          {t('audit.by', { actor: actorLabel(entry) })}
                        </span>
                        <span className="muted-sm push-right">{formatDateTime(entry.createdAt)}</span>
                      </div>

                      {changes.length > 0 && (
                        <ul className="muted-sm">
                          {changes.map((c) => (
                            <li key={c.field}>
                              {t(fieldLabelKey(c.field))}{' — '}
                              {c.before === null
                                ? t('audit.change.added', { value: shownValue(c.after) })
                                : c.after === null
                                  ? t('audit.change.removed', { value: shownValue(c.before) })
                                  : t('audit.change.moved', { before: shownValue(c.before), after: shownValue(c.after) })}
                            </li>
                          ))}
                        </ul>
                      )}

                      {href && (
                        <p>
                          <Link to={href}>
                            <Icon name="external" className="ic-sm" /> {t('audit.open')}
                          </Link>
                        </p>
                      )}
                    </article>
                  );
                })}
              </section>
            ))}
          </div>

          {entries.length < total && (
            <div className="row-wrap" style={{ marginTop: 12 }}>
              <Button loading={loadingMore} onClick={() => void loadMore()}>
                {t('audit.loadMore', { count: String(Math.min(AUDIT_PAGE_SIZE, total - entries.length)) })}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
