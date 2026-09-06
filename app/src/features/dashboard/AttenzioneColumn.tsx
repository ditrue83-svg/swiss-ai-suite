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
import { Tag } from '@/components/ui/Tag';
import { formatCurrency, formatDate } from '@/lib/format';
import { useDocumentLabel } from '@/i18n/documentLabel';
import { useT, useTn } from '@/i18n';
import type { OverviewData } from './useOverview';
import { cx } from '@/lib/cx';
import styles from './dashboard.module.css';

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
    <section className={cx('card', 'panel-hover', styles.attCol)} aria-labelledby="att-col-title">
      <h2 className="card-title" id="att-col-title">
        {t('home.attentionTitle')}
        {attenzione !== null && (
          <Tag tone="attention">{tn('home.attentionItems', attenzione.total)}</Tag>
        )}
      </h2>

      {attenzione === null ? (
        <div className="muted-sm">{t('home.attentionUnknown')}</div>
      ) : (
        <>
          <div className={styles.attList}>
            {attenzione.items.map((item) => {
              const scaduta = item.deadline !== null && item.deadline < data.today;
              return (
                <Link key={item.id} to={`/documenti/${item.id}`} className={cx(styles.attRow, 'row-hover')}>
                  <span className={styles.attLine}>
                    <span className={styles.attTitleWrap}>
                      <span className={cx(styles.attDot, scaduta ? styles.attDotDanger : styles.attDotWarn)} aria-hidden="true" />
                      <span className={styles.attTitle}>{etichetta(item.label)}</span>
                    </span>
                    {item.amount !== null && (
                      <span className={cx(styles.attAmount, 'num')}>{formatCurrency(item.amount, item.amountCurrency)}</span>
                    )}
                  </span>
                  {(item.sender || item.deadline !== null) && (
                    <span className={cx(styles.attLine, styles.attSub)}>
                      {item.sender && <span className={styles.attSender}>{item.sender}</span>}
                      {item.deadline !== null && (
                        <span className={cx(styles.attDate, 'num', scaduta ? styles.overdue : styles.dueSoon)}>
                          {formatDate(item.deadline)}
                          <Icon name="chevronRight" className={styles.attChevron} />
                        </span>
                      )}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
          <Link className={styles.attSeeAll} to="/documenti?stato=to_verify">
            {t('home.attentionSeeAll')} <Icon name="arrowRight" className="ic-sm" />
          </Link>
        </>
      )}
    </section>
  );
}
