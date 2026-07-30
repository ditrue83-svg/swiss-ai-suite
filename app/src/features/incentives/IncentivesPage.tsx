// ============================================================================
// INCENTIVI — Subsidy AI 2.0, l'orchestratore a QUATTRO SCHEDE.
//
// Il modulo 1.0 rispondeva «ecco alcuni programmi che potrebbero interessarti».
// Questo risponde «questa opportunità è pertinente a QUESTO progetto, questi
// criteri sembrano soddisfatti, questi mancano, questa call è aperta, questa è
// la fonte e la data in cui l'abbiamo verificata».
//
// LE QUATTRO SCHEDE, e perché sono quattro:
//   Opportunità  la risposta      — che cosa c'è per me, adesso
//   Progetti     la domanda       — senza un progetto non esiste una domanda
//   Pratiche     il lavoro        — a che punto sono le candidature
//   Catalogo     la provenienza   — da dove viene quello che vi dico
//
// ⚠️⚠️ IN QUESTA SCHERMATA NON ESISTE, E NON DEVE ESISTERE, un pulsante «Invia
// domanda», «Compila il formulario», «Firma», «Carica sul portale» o un numero
// che dica quante probabilità ci sono di ottenere il contributo. Il prodotto
// non ha alcun canale verso l'autorità, e la decisione resta all'autorità:
// nessuno stato di questo modulo la anticipa.
//
// ⚠️⚠️ E NON ESISTE UN PUNTEGGIO UNICO. Le sei misure — rilevanza, idoneità,
// completezza, tempistica, freschezza, prontezza — si mostrano separate perché
// sono separate. Comprimerle in un numero è precisamente il modo in cui un
// prodotto del genere comincia a mentire, e il punteggio interno che ordina
// l'elenco non compare da nessuna parte.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonKpiGrid } from '@/components/ui/states';
import { useCompany } from '@/contexts/CompanyContext';
import { useT, type TKey } from '@/i18n';
import { incentivesService } from '@/services/incentivesService';
import type { IncentiveProject, IncentiveSummary } from '@/types/models';
import {
  INCENTIVE_TABS, TAB_KEY, filtersFromParams, paramsFromFilters,
  summaryNotices, summaryTiles, type IncentiveFilters, type IncentiveTab,
} from './incentivesModel';
import { OpportunitiesTab } from './OpportunitiesTab';
import { ProjectsTab } from './ProjectsTab';
import { CasesTab } from './CasesTab';
import { CatalogTab } from './CatalogTab';

export function IncentivesPage() {
  const t = useT();
  const { activeCompany: company } = useCompany();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);

  const [summary, setSummary] = useState<IncentiveSummary | null>(null);
  const [projects, setProjects] = useState<IncentiveProject[]>([]);
  const [loading, setLoading] = useState(true);
  // ⚠️ UN errore e non due: i numeri e l'elenco dei progetti sono due
  // interrogazioni, e a migrazione mancante fallirebbero entrambe con lo stesso
  // messaggio. Due riquadri rossi identici sono il difetto già trovato in
  // Finanze, nel Calendario e nel CRM.
  const [error, setError] = useState<string | null>(null);
  // ⚠️ La chiave dell'azienda viaggia NELLO STATO: senza, cambiando azienda si
  // vedono per un istante le opportunità di quella precedente sotto il nome
  // della nuova. Non esiste alcuna invalidazione globale di cache in questo
  // prodotto, e ogni schermata deve portarsi la propria chiave.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  /** Cambia a ogni azione che può spostare i numeri: le schede rileggono. */
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!company) return;
    const key = company.id;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [sum, prj] = await Promise.all([
          incentivesService.summary(key),
          // I progetti servono a due schede — il filtro delle opportunità e
          // l'elenco — e si leggono una volta sola. Archiviati compresi: la
          // scheda Progetti li deve poter mostrare senza una seconda lettura.
          incentivesService.projects(key, true),
        ]);
        if (cancelled) return;
        setSummary(sum);
        setProjects(prj);
        setLoadedFor(key);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [company, revision]);

  function update(patch: Partial<IncentiveFilters>) {
    // Cambiando scheda o vista si torna alla prima pagina: restare a pagina tre
    // di un elenco che ora ne ha una sola mostrerebbe il vuoto.
    setParams(paramsFromFilters({ ...filters, ...patch, offset: patch.offset ?? 0 }));
  }

  function goTab(tab: IncentiveTab) { update({ tab, view: 'all' }); }

  const refresh = () => setRevision((n) => n + 1);
  const fresh = loadedFor === company?.id;
  const activeProjects = useMemo(() => projects.filter((p) => p.status === 'active'), [projects]);
  const tiles = summary ? summaryTiles(summary) : [];
  const notices = summary ? summaryNotices(summary) : [];

  if (!company) return null;

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('incentives.title')}</div>
        <div className="page-desc">{t('incentives.intro')}</div>
      </div>

      {error && <ErrorState message={t(error as TKey) || error} onRetry={refresh} />}

      {/* I numeri. Ognuno porta dove si agisce: guardare e agire sono lo stesso
          gesto, come per i quattro numeri del CRM.
          ⚠️ NESSUNO di questi è una percentuale o un punteggio: sono quantità
          di cose da guardare. */}
      {loading && !summary ? <SkeletonKpiGrid /> : summary && (
        <div className="kpi-grid">
          {tiles.map((tile) => (
            <button
              key={tile.key}
              type="button"
              className="kpi kpi-link"
              onClick={() => update({ tab: tile.tab, view: tile.view ?? 'all' })}
            >
              <div className="kpi-value">{tile.value}</div>
              <div className="kpi-label">{t(tile.key)}</div>
            </button>
          ))}
        </div>
      )}

      {/* ⚠️ Gli avvisi compaiono SOLO quando c'è qualcosa da dire. Un riquadro
          «tutto in ordine» sempre presente si smette di leggere, e il giorno in
          cui dice qualcosa non lo nota nessuno. */}
      {notices.map((key) => (
        <div key={key} className="info-box mt-8">
          <Icon name="alert" className="ic-sm" /> <span>{t(key)}</span>
        </div>
      ))}

      <div className="tabs mt-16" role="tablist">
        {INCENTIVE_TABS.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={filters.tab === tab}
            className={`tab${filters.tab === tab ? ' active' : ''}`}
            onClick={() => goTab(tab)}
          >
            {t(TAB_KEY[tab])}
          </button>
        ))}
      </div>

      {filters.tab === 'opportunities' && (
        <OpportunitiesTab
          companyId={company.id}
          filters={filters}
          projects={activeProjects}
          ready={fresh}
          onFilters={update}
          onChanged={refresh}
          onGoProjects={() => goTab('projects')}
        />
      )}

      {filters.tab === 'projects' && (
        <ProjectsTab
          companyId={company.id}
          projects={projects}
          showArchived={filters.archived}
          loading={loading && !fresh}
          onShowArchived={(v) => update({ archived: v })}
          onChanged={refresh}
          onOpenOpportunities={(projectId) => update({ tab: 'opportunities', projectId, view: 'all' })}
        />
      )}

      {filters.tab === 'cases' && (
        <CasesTab
          companyId={company.id}
          showArchived={filters.archived}
          onShowArchived={(v) => update({ archived: v })}
          onChanged={refresh}
        />
      )}

      {filters.tab === 'catalog' && <CatalogTab />}

      {/* ⚠️ LA NOTA IN FONDO NON È UN DISCLAIMER DI CORTESIA: dice le tre cose
          che il modulo non fa, e ognuna corrisponde a un'assenza reale nello
          schema — non a una funzione disattivata.

          ⚠️ L'apertura è un `<strong>` e NON `**testo**` dentro la stringa:
          in questa applicazione non esiste alcun renderer markdown, quindi gli
          asterischi arriverebbero a schermo così come sono. È quello che
          `subsidy.footnote` fa oggi in produzione — un difetto del 1.0 da non
          ricopiare qui. */}
      <div className="footnote">
        <strong>{t('incentives.footnoteLead')}</strong> {t('incentives.footnote')}
      </div>
    </>
  );
}
