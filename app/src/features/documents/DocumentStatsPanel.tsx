// ============================================================================
// Statistiche documenti — sotto la lista, chiusa di default.
//
// ⚠️ PERCHÉ È QUI E NON IN PANORAMICA (§37). La Panoramica risponde a «cosa
// richiede la mia attenzione adesso»: un grafico di documenti per lingua non
// risponde a quella domanda, e per starci obbligava quella schermata a
// interrogare `document_analyses` — una tabella che non sa cosa sia
// `archived_at`. Il 2026-08-15 il risultato era misurato: la Panoramica diceva
// «19 documenti», l'archivio «2 di 2». Nessuno dei due era falso; nessuno dei
// due diceva quale insieme stava contando.
//
// ⚠️ QUI L'INSIEME LO SCEGLIE CHI GUARDA. L'interruttore Attivi/Archiviati sta
// due centimetri più in su ed è già premuto: questa sezione lo segue e lo
// RIPETE in testa, perché chi arriva scorrendo non vede l'interruttore.
//
// ⚠️ CHIUSA DI DEFAULT, e non per pudore: la lista è la risposta alla domanda
// della pagina, e i conteggi costano una lettura in più. Si aprono quando
// servono, e solo allora si leggono.
// ============================================================================
import { useEffect, useState } from 'react';
import { Bars } from '@/components/ui/Bars';
import { Icon } from '@/components/ui/Icon';
import { documentHubService } from '@/services/documentHubService';
import { toUserMessage } from '@/lib/errors';
import { useT } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { buildDocumentStats } from './documentModel';
import type { DocumentStatsSet } from '@/types/models';
import { cx } from '@/lib/cx';
import styles from './documents.module.css';

export function DocumentStatsPanel({ companyId, archived, reloadKey }: {
  companyId: string;
  archived: boolean;
  /** Cambia quando la lista cambia: le statistiche non restano indietro. */
  reloadKey: number;
}) {
  const t = useT();
  const L = useLabels();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DocumentStatsSet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ⚠️ Si legge solo da aperta, e si rilegge cambiando azienda o insieme. I dati
  // dell'insieme precedente non restano un fotogramma sotto l'intestazione
  // nuova: su un prodotto multi-azienda quel lampo è un difetto, non un
  // dettaglio (stessa regola di `useDocumentList`).
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    setData(null);
    documentHubService.stats(companyId, archived)
      .then((d) => { if (active) setData(d); })
      .catch((e) => { if (active) setError(toUserMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, companyId, archived, reloadKey]);

  const stats = data ? buildDocumentStats(data.rows) : null;
  const noneLabel = t('documents.stats.withoutAnalysis');

  return (
    <div className="card mt-16">
      <button
        className={styles.statsToggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={open ? 'arrowDown' : 'arrowRight'} className="ic-sm" />
        <span className="card-title m-0">{t('documents.stats.title')}</span>
      </button>

      {open && (
        <div className="mt-10">
          {loading && <div className="muted-sm">{t('common.loading')}</div>}
          {error && <div className="muted-sm">{error}</div>}
          {stats && data && (
            data.total === 0 ? (
              // A insieme vuoto NON si dice anche «Su 0 documenti attivi»: una
              // frase che conta il nulla e una che dice che non c'è nulla sono
              // la stessa informazione scritta due volte.
              <div className={styles.chartEmpty}>{t('documents.stats.empty')}</div>
            ) : (
              <>
                {/* ⚠️ L'INSIEME SI DICHIARA PRIMA DEI NUMERI, non dopo. «19
                    documenti» non è un'informazione finché non si sa se sono
                    gli attivi, gli archiviati o tutti.
                    ⚠️ Due chiavi per il singolare: senza, la frase è «Su 1
                    documenti attivi». */}
                <div className="muted-sm">
                  {data.archived
                    ? t(data.total === 1 ? 'documents.stats.scopeArchivedOne' : 'documents.stats.scopeArchived', { n: data.total })
                    : t(data.total === 1 ? 'documents.stats.scopeActiveOne' : 'documents.stats.scopeActive', { n: data.total })}
                  {/* Il tetto, quando morde, si DICE: una statistica parziale
                      che si presenta come totale è una bugia con un grafico
                      sopra. */}
                  {data.truncated && ` · ${t('documents.stats.partial', { n: stats.counted, total: data.total })}`}
                </div>

                <div className="grid-2 mt-10">
                  <div>
                    <div className="card-title">{t('documents.stats.byUrgency')}</div>
                    <Bars rows={[
                      { cat: L.urgency('alta'), val: stats.urgency.alta, cls: styles.sAlta, dotCls: styles.dotAlta },
                      { cat: L.urgency('media'), val: stats.urgency.media, cls: styles.sMedia, dotCls: styles.dotMedia },
                      { cat: L.urgency('bassa'), val: stats.urgency.bassa, cls: styles.sBassa, dotCls: styles.dotBassa },
                      // ⚠️ La quarta riga compare solo se esiste: una riga
                      // «Senza analisi 0» insegna che c'è un problema che non
                      // c'è. Un documento mai letto invece DEVE comparire —
                      // partendo dalle analisi spariva.
                      ...(stats.withoutAnalysis > 0
                        ? [{ cat: noneLabel, val: stats.withoutAnalysis }]
                        : []),
                    ]} />
                  </div>
                  <div>
                    <div className="card-title">{t('documents.stats.byType')}</div>
                    <Bars rows={stats.types.map((b) => ({
                      cat: b.key ? L.docType(b.key) : noneLabel, val: b.n,
                    }))} />
                  </div>
                </div>
                <div className={cx(styles.langCard, 'mt-16')}>
                  <span className={styles.langTitle}>{t('documents.stats.languages')}</span>
                  {stats.languages.map((b) => (
                    <span className={styles.langChip} key={b.key ?? 'none'}>
                      {b.key ? L.language(b.key) : noneLabel} <b>{b.n}</b>
                    </span>
                  ))}
                </div>
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}
