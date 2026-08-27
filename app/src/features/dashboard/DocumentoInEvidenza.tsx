// ============================================================================
// DocumentoInEvidenza — la scheda centrale della Panoramica (restyling
// 2026-08-26, modello Lovable): il documento «da verificare» con la scadenza
// più vicina, coi suoi campi estratti e la citazione di origine.
//
// ⚠️ I CAMPI VENGONO DALLA RIGA GIÀ LETTA (`DocumentHubItem`), non da una
// seconda estrazione: ente, tipo, importo e scadenza sono gli stessi valori che
// l'archivio mostra, con gli stessi segni di conferma («corretto» / «da
// verificare»). L'unica lettura aggiunta è l'analisi, e serve a due cose che
// la riga non porta: la data dell'analisi e la CITAZIONE.
//
// ⚠️ LA CITAZIONE COMPARE SOLO SE VERIFICATA: le evidenze dell'analisi sono già
// passate dal controllo degli offset (`richEvidence`, §20/§31) — una citazione
// non verificata nel database qui non arriva proprio (è null). Se nessuna delle
// tre evidenze principali esiste, il blocco non si mostra: una citazione
// inventata è peggio di nessuna (principi 1 e 3).
//
// ⚠️ NESSUN PULSANTE «Conferma estrazione»: la conferma vera vive nel dettaglio
// del documento (`document_corrections`), e un pulsante qui che non la scrive
// sarebbe una funzione finta. L'azione primaria porta LÀ — dove il gesto
// esiste davvero.
// ============================================================================
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useAsync } from '@/hooks/useAsync';
import { analysisService } from '@/services/analysisService';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { useDocumentLabel } from '@/i18n/documentLabel';
import { useLabels } from '@/i18n/labels';
import { useT, useTn } from '@/i18n';
import type { DocumentHubItem } from '@/types/models';

function CampoEstratto({ nome, valore, nota, corretto }: {
  nome: string; valore: string; nota?: string | null; corretto?: boolean;
}) {
  const t = useT();
  return (
    <div className="spot-field">
      <div className="spot-field-name">{nome}</div>
      <div className="spot-field-value">{valore}</div>
      {corretto && <div className="spot-field-note ok">{t('home.spotCorrected')}</div>}
      {!corretto && nota && <div className="spot-field-note">{nota}</div>}
    </div>
  );
}

export function DocumentoInEvidenza({ item, today }: { item: DocumentHubItem; today: string }) {
  const t = useT();
  const tn = useTn();
  const L = useLabels();
  const etichetta = useDocumentLabel();

  // L'analisi serve per la citazione e la data dell'analisi stessa. Il guasto
  // non spegne la scheda: restano i campi della riga, e la citazione manca —
  // che è ciò che la scheda sa mostrare con onestà.
  const { data: analisi } = useAsync(
    () => analysisService.getForDocument(item.id),
    [item.id],
  );

  const citazione = analisi
    ? (analisi.senderEvidence ?? analisi.deadlineEvidence ?? analisi.amountEvidence)
    : null;
  const scaduta = item.deadline !== null && item.deadline < today;
  const importo = formatCurrency(item.amount, item.amountCurrency);

  return (
    <section className="card spot" aria-labelledby="spot-title">
      <div className="spot-head">
        <div className="spot-head-main">
          <h2 className="spot-title" id="spot-title">{etichetta(item.label)}</h2>
          <div className="muted-sm">
            {analisi?.createdAt
              ? t('home.spotAnalyzedAt', { time: formatDateTime(analisi.createdAt) })
              : t('home.spotToVerify')}
          </div>
        </div>
        {item.pageCount !== null && item.pageCount !== undefined && (
          <span className="spot-chip">
            <Icon name="document" className="ic-sm" />
            {tn('home.spotPages', item.pageCount)}
          </span>
        )}
      </div>

      <div className="spot-body">
        <div className="spot-fields">
          <div className="spot-fields-title">{t('home.spotFields')}</div>
          <CampoEstratto
            nome={t('home.spotSender')}
            valore={item.sender ?? '—'}
            corretto={item.senderCorrected}
          />
          <CampoEstratto
            nome={t('home.spotType')}
            valore={L.docType(item.documentType)}
            corretto={item.documentTypeCorrected}
          />
          <CampoEstratto
            nome={t('home.spotAmount')}
            valore={importo ?? '—'}
            corretto={item.amountCorrected}
          />
          <CampoEstratto
            nome={t('home.spotDeadline')}
            valore={item.deadline ? formatDate(item.deadline) : '—'}
            nota={item.deadlineRequiresVerification
              ? t('home.spotDeadlineToVerify')
              : scaduta ? t('home.spotDeadlineOverdue') : null}
          />
          <div className="spot-actions">
            <Link className="btn btn-primary btn-sm" to={`/documenti/${item.id}`}>
              <Icon name="checkCircle" className="ic-sm" /> {t('home.spotOpen')}
            </Link>
          </div>
        </div>

        {citazione && (
          <div className="spot-quote">
            <div className="spot-fields-title">{t('home.spotQuote')}</div>
            <blockquote className="spot-quote-text">«{citazione.quote}»</blockquote>
            <div className="muted-sm">
              {citazione.pageNumber
                ? t('home.spotQuoteSourcePage', { page: citazione.pageNumber })
                : t('home.spotQuoteSource')}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
