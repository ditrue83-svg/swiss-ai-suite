// ============================================================================
// KpiStrip — la striscia di quattro numeri in testa alla Panoramica
// (restyling 2026-08-26, modello Lovable).
//
// ⚠️ REGOLA MADRE, dal PRD (principio 6): un numero che non ha il dato NON si
// mostra — al suo posto «—» e una didascalia che dice perché. La striscia è il
// posto più in vista della pagina: è proprio qui che un numero inventato farebbe
// più danno. Le fonti:
//   · Importi in scadenza   → `importiInScadenza` (puro, sulle righe già lette)
//   · Richiedono attenzione → daVerificare + fallite (già caricati)
//   · Documenti analizzati  → `analisi` (serie settimanale vera: è la SOLA card
//                             con sparkline, perché è la sola con una storia)
//   · Appartenenza          → `ownership` (già caricato; null = non leggibile)
//
// ⚠️ «Campi da confermare» del modello NON c'è: non esiste una fonte che conti
// i campi letti con confidenza media, e un numero senza fonte sarebbe finto. Al
// suo posto l'appartenenza da confermare — la conferma vera che il prodotto
// chiede, e quella da cui dipende il gate delle attività.
//
// Ogni card è un collegamento alla pagina che rende LO STESSO numero — la
// regola «il numero e la destinazione non possono divergere» valeva per i
// blocchi e vale anche qui.
// ============================================================================
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Sparkline } from '@/components/ui/Sparkline';
import { formatCurrency } from '@/lib/format';
import { useT, useTn } from '@/i18n';
import { totaleConto } from './overviewBlocks';
import type { OverviewData } from './useOverview';

function KpiCard({ to, icon, label, children }: {
  to: string; icon: IconName; label: string; children: React.ReactNode;
}) {
  return (
    <Link to={to} className="kpi kpi-link">
      <div className="kpi-label">
        <Icon name={icon} className="ic-sm" />
        <span>{label}</span>
      </div>
      {children}
    </Link>
  );
}

export function KpiStrip({ data }: { data: OverviewData }) {
  const t = useT();
  const tn = useTn();
  const { importi, analisi, ownership, daVerificare, fallite } = data;

  const nAttenzione = totaleConto(daVerificare) + totaleConto(fallite);
  const importiParziale = data.date.attivi.parziale || data.date.archiviati.parziale;

  return (
    <div className="kpi-grid" role="group" aria-label={t('home.kpiGroup')}>
      {/* IMPORTI IN SCADENZA — la somma è `null` quando non è onesta: nessun
          importo estratto, o valute miste (CHF+EUR non si sommano). */}
      <KpiCard to="/documenti?scadenza=1&ordine=deadline" icon="banknote" label={t('home.kpiAmounts')}>
        <div className="kpi-value">
          {importi.totale !== null ? formatCurrency(importi.totale, importi.valuta) : '—'}
        </div>
        <div className="kpi-sub">
          {importi.totale !== null
            ? tn('home.kpiAmountsCaption', importi.nScadenze)
            : importi.valuteMiste
              ? t('home.kpiAmountsMixed')
              : t('home.kpiAmountsNone')}
          {importiParziale && <> {t('home.kpiAmountsPartial')}</>}
        </div>
      </KpiCard>

      {/* RICHIEDONO ATTENZIONE — da verificare + non riuscite, le due
          popolazioni sommate come già dichiara il piè di pagina. */}
      <KpiCard to="/documenti?stato=to_verify" icon="alert" label={t('home.kpiAttention')}>
        <div className="kpi-value">{nAttenzione}</div>
        <div className="kpi-sub">
          {t('home.kpiAttentionCaption', {
            v: totaleConto(daVerificare), f: totaleConto(fallite),
          })}
        </div>
      </KpiCard>

      {/* DOCUMENTI ANALIZZATI — la sola con sparkline: la serie settimanale
          esiste (`created_at` delle analisi). Trend solo quando è onesto
          (settimana precedente > 0). Lettura fallita: «—» e lo dice. */}
      <KpiCard to="/documenti" icon="fileSearch" label={t('home.kpiAnalyzed')}>
        {analisi === null ? (
          <>
            <div className="kpi-value">—</div>
            <div className="kpi-sub">{t('home.kpiAnalyzedUnknown')}</div>
          </>
        ) : (
          <>
            <div className="kpi-value">{analisi.ultimi30}</div>
            <div className="kpi-sub">
              {t('home.kpiAnalyzedCaption')}
              {analisi.trend !== null && (
                <span className={`kpi-trend${analisi.trend < 0 ? ' down' : ''}`}>
                  {t(analisi.trend < 0 ? 'home.kpiAnalyzedTrendDown' : 'home.kpiAnalyzedTrend', { n: Math.abs(analisi.trend) })}
                </span>
              )}
            </div>
            <Sparkline data={analisi.settimane} />
          </>
        )}
      </KpiCard>

      {/* APPARTENENZA DA CONFERMARE — `null` = non leggibile, mai zero finto. */}
      <KpiCard to="/documenti?appartenenza=1" icon="user" label={t('home.kpiOwnership')}>
        <div className="kpi-value">{ownership === null ? '—' : ownership.count}</div>
        <div className="kpi-sub">
          {ownership === null
            ? t('home.ownershipUnknown')
            : t('home.kpiOwnershipCaption')}
        </div>
      </KpiCard>
    </div>
  );
}
