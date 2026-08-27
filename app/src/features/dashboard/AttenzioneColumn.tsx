// ============================================================================
// AttenzioneColumn — la colonna «Richiede attenzione» della Panoramica
// (restyling 2026-08-26, modello Lovable).
//
// È la STESSA lista della pagina Documenti con `?stato=to_verify`, letta con la
// stessa interrogazione e lo stesso filtro: il numero della testata (`total`,
// funzione finestra, esatto) e quello della destinazione non possono
// divergere — la regola della pagina vale anche in colonna.
//
// ⚠️ GLI ARCHIVIATI NON CI SONO, e non è una dimenticanza: `list` qui legge la
// popolazione attiva, perché la destinazione mostra quella. Il blocco «Limiti
// del sistema», sotto, dichiara i due universi per esteso come sempre — la
// colonna è la scorciatoia operativa, il blocco è il censimento.
//
// ⚠️ LETTURA FALLITA = LA CARD RESTA E LO DICE. Sparirebbe altrimenti proprio
// quando c'è qualcosa da dire — la regola già scritta per il blocco Decisioni.
// ============================================================================
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency, formatDate } from '@/lib/format';
import { useDocumentLabel } from '@/i18n/documentLabel';
import { useT, useTn } from '@/i18n';
import type { OverviewData } from './useOverview';

export function AttenzioneColumn({ data }: { data: OverviewData }) {
  const t = useT();
  const tn = useTn();
  const etichetta = useDocumentLabel();
  const attenzione = data.attenzione;

  // Niente da segnalare E lettura riuscita: la colonna non compare — lo stato
  // «cosa è stato controllato» resta al blocco vuoto operativo, che è nato per
  // dirlo. Una card «0 elementi» sarebbe una griglia riempita a forza.
  if (attenzione !== null && attenzione.total === 0) return null;

  return (
    <section className="card att-col" aria-labelledby="att-col-title">
      <h2 className="card-title" id="att-col-title">
        {t('home.attentionTitle')}
        {attenzione !== null && (
          <span className="att-count muted-sm">{tn('home.attentionItems', attenzione.total)}</span>
        )}
      </h2>

      {attenzione === null ? (
        <div className="muted-sm">{t('home.attentionUnknown')}</div>
      ) : (
        <>
          <div className="att-list">
            {attenzione.items.map((item) => {
              const scaduta = item.deadline !== null && item.deadline < data.today;
              return (
                <Link key={item.id} to={`/documenti/${item.id}`} className="att-row">
                  <span className="att-main">
                    <span className="att-title">{etichetta(item.label)}</span>
                    {item.sender && <span className="att-sender">{item.sender}</span>}
                  </span>
                  <span className="att-figures">
                    {item.amount !== null && (
                      <span className="att-amount">{formatCurrency(item.amount, item.amountCurrency)}</span>
                    )}
                    {item.deadline !== null && (
                      <span className={`att-date${scaduta ? ' overdue' : ''}`}>
                        {formatDate(item.deadline)}
                      </span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
          <Link className="btn btn-sm mt-10" to="/documenti?stato=to_verify">
            {t('home.attentionSeeAll')} <Icon name="arrowRight" className="ic-sm" />
          </Link>
        </>
      )}
    </section>
  );
}
