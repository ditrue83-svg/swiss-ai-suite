// ============================================================================
// Dettaglio di una comunicazione.
//
// SICUREZZA DEL RENDER — la regola sta in una riga: in questo file non c'è, e
// non deve mai comparire, `dangerouslySetInnerHTML`. Il corpo arriva dal
// database GIÀ ridotto a testo dal tokenizzatore server-side, e React lo
// inserisce come nodo di testo: un `<script>` scritto nell'email finisce sullo
// schermo come cinque caratteri, che è esattamente ciò che deve succedere.
// Nessuna immagine remota viene caricata, perché nessuna immagine remota è mai
// stata conservata (§55): il pixel di tracciamento non può partire.
//
// I collegamenti sono l'unica eccezione, e sono trattati come tali: l'URL è
// stato validato server-side (solo http/https, letto da un parser), si apre in
// una scheda nuova con `rel="noopener noreferrer"`, e accanto all'etichetta
// scelta dal mittente si mostra il DOMINIO REALE di destinazione (§56).
// ============================================================================
import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Button, ErrorState, SkeletonLine } from '@/components/ui/states';
import { useCompany } from '@/contexts/CompanyContext';
import { CrmLinkPicker } from '@/features/crm/CrmLinkPicker';
import { useCrmLink } from '@/features/crm/useCrmLink';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { useI18n, useT } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { formatBytes, formatDate } from '@/lib/format';
import { toUserMessage } from '@/lib/errors';
import { analysisService } from '@/services/analysisService';
import { documentService } from '@/services/documentService';
import { emailConnectionService, inboxErrorMessage } from '@/services/emailConnectionService';
import { inboxService } from '@/services/inboxService';
import { senderLabel, subjectLabel } from './parts';
import { messageDocumentRows, primaryDocumentOf } from './messageDocuments';
import type { DocumentAnalysis, EmailAttachment, EmailMessageDetail } from '@/types/models';

interface Props {
  messageId: string;
  onBack: () => void;
  onChanged: () => void;
}

export function MessageDetail({ messageId, onBack, onChanged }: Props) {
  const t = useT();
  const { activeCompany } = useCompany();
  // 0026 — il collegamento alla controparte. L'hook rilegge dopo ogni scrittura:
  // i guardiani possono rifiutare, e lo stato locale non deve raccontare un
  // collegamento che il database non ha.
  const crmLink = useCrmLink('email', activeCompany?.id, messageId);
  const L = useLabels();
  const { locale, localeTag } = useI18n();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const { loading, error, data, reload } = useAsync<{
    message: EmailMessageDetail | null;
    analysis: DocumentAnalysis | null;
  }>(async () => {
    const message = await inboxService.get(messageId);
    if (!message) return { message: null, analysis: null };

    // «Visto» è uno stato locale di AI-Swisse (§36): non tocca il letto/non
    // letto del provider, e con uno scope di sola lettura non potrebbe farlo.
    if (!message.seenAt) {
      inboxService.markSeen(messageId).catch(() => { /* non è un'operazione critica */ });
    }

    // L'analisi da mostrare è quella del documento PRINCIPALE: l'allegato se
    // c'è, il corpo altrimenti. Non si fondono evidenze di fonti diverse (§33).
    // La scelta la fa `primaryDocumentOf`, ed è la stessa che marca la riga
    // nell'elenco dei documenti: due copie indicherebbero due «principali».
    const primary = primaryDocumentOf(message.documents);
    const analysis = primary ? await analysisService.getForDocument(primary.documentId) : null;
    return { message, analysis };
  }, [messageId]);

  const message = data?.message ?? null;
  const analysis = data?.analysis ?? null;

  const refresh = useCallback(() => { reload(); onChanged(); }, [reload, onChanged]);

  async function openAttachment(attachment: EmailAttachment) {
    if (!attachment.storagePath) return;
    setBusy(true);
    try {
      const url = await documentService.getSignedUrl(attachment.storagePath, 120);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    setBusy(true);
    try {
      const result = await emailConnectionService.analyze(messageId, locale);
      showToast(result.status === 'analyzed' ? t('inbox.detail.analyzed') : t('inbox.errors.analysisFailed'));
      refresh();
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleHandled(handled: boolean) {
    setBusy(true);
    try {
      await inboxService.setHandled(messageId, handled);
      refresh();
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="card">
        <SkeletonLine width="40%" /><SkeletonLine width="70%" /><SkeletonLine width="90%" /><SkeletonLine width="80%" />
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={reload} />;
  // ⚠️ Il messaggio non c'è. Sono due casi che da qui NON si distinguono, ed è
  // giusto così: non esiste più, oppure è di un'altra azienda e la RLS non lo
  // consegna. Dire quale dei due sarebbe rivelare l'esistenza di una riga
  // altrui. Prima questo caso rendeva un pulsante «Riprova» che in realtà
  // TORNAVA INDIETRO: un comando che dice una cosa e ne fa un'altra.
  if (!message) {
    return (
      <div className="state-error" role="alert">
        <Icon name="alert" />
        <div>
          <div>{t('errors.notFound')}</div>
          <button className="btn btn-sm mt-8" onClick={onBack}>
            <Icon name="arrowLeft" className="ic-sm" /> {t('inbox.detail.back')}
          </button>
        </div>
      </div>
    );
  }
  const documentRows = messageDocumentRows(
    message.documents, message.attachments, analysis?.analysisStatus ?? null,
  );

  const received = new Date(message.receivedAt);
  const receivedLabel = Number.isNaN(received.getTime())
    ? '—'
    : `${formatDate(message.receivedAt)} · ${received.toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' })}`;
  const handled = message.attentionStatus === 'handled';
  const canAnalyze = !analysis && message.processingStatus !== 'analyzing' && message.processingStatus !== 'importing';

  // ⚠️ `relevance_reason` porta DUE cose diverse nella stessa colonna: una frase
  // scritta dal modello, già nella lingua dell'utente, oppure una CHIAVE scritta
  // dal filtro deterministico — che una lingua non ce l'ha, perché a scriverla è
  // un processo. Fino al 2026-08-11 la chiave finiva a schermo così com'era:
  // l'utente leggeva «prescreen:bulk_no_administrative_signal».
  // Una chiave sconosciuta si mostra com'è invece di sparire: un testo grezzo è
  // brutto, un motivo scomparso è una spiegazione che non c'è (§58).
  const reasonText = (raw: string): string => {
    switch (raw) {
      case 'prescreen:service_notification': return t('inbox.detail.reasonServiceNotification');
      case 'prescreen:bulk_no_administrative_signal': return t('inbox.detail.reasonBulkNoAdministrative');
      default: return raw;
    }
  };

  return (
    <>
      <div className="page-head">
        <button className="btn btn-sm btn-link" onClick={onBack}>
          <Icon name="arrowLeft" className="ic-sm" /> {t('inbox.detail.back')}
        </button>
        <div className="page-title">{subjectLabel(message.subject, t)}</div>
        <div className="page-desc">
          {senderLabel(message, t)}
          {message.senderEmail && message.senderName ? ` · ${message.senderEmail}` : ''}
        </div>
      </div>

      {/* Intestazione: chi, quando, su quale casella. */}
      <div className="card">
        <dl className="inbox-fields">
          <div><dt>{t('inbox.detail.from')}</dt><dd>{message.senderEmail ?? t('inbox.unknownSender')}</dd></div>
          {message.toRecipients.length > 0 && (
            <div><dt>{t('inbox.detail.to')}</dt><dd>{message.toRecipients.map((r) => r.email).join(', ')}</dd></div>
          )}
          {message.ccRecipients.length > 0 && (
            <div><dt>{t('inbox.detail.cc')}</dt><dd>{message.ccRecipients.map((r) => r.email).join(', ')}</dd></div>
          )}
          <div><dt>{t('inbox.detail.received')}</dt><dd>{receivedLabel}</dd></div>
          {message.connection && (
            <div>
              <dt>{t('inbox.detail.accountLabel')}</dt>
              <dd>{message.connection.emailAddress} · {message.connection.provider === 'google' ? t('inbox.connect.google') : t('inbox.connect.microsoft')}</dd>
            </div>
          )}
          {message.threadCount > 1 && (
            <div><dt>{t('inbox.detail.thread', { n: message.threadCount })}</dt><dd /></div>
          )}
        </dl>

        <div className="inbox-actions">
          {handled ? (
            <Button icon="refresh" loading={busy} onClick={() => toggleHandled(false)}>{t('inbox.detail.restore')}</Button>
          ) : (
            <Button icon="archive" loading={busy} onClick={() => toggleHandled(true)}>{t('inbox.detail.markHandled')}</Button>
          )}
          {canAnalyze && (
            <Button variant="primary" icon="fileSearch" loading={busy} onClick={analyze}>{t('inbox.detail.analyze')}</Button>
          )}
        </div>

        {/* §71 e §145 — l'Inbox rappresenta la COMUNICAZIONE, il CRM la
            RELAZIONE. Da qui si collega, non si copia: il mittente resta in
            `email_messages.sender_email` e il collegamento vive in una tabella
            propria, perché su `email_messages` il client può scrivere soltanto
            `seen_at` e `attention_status`.
            ⚠️ `senderEmail` alimenta il suggerimento: il riquadro chiede al
            database chi è quell'indirizzo e mostra il MOTIVO — un'identità o un
            sospetto — senza collegare da sé. */}
        <CrmLinkPicker
          linkedId={crmLink.linked?.id ?? null}
          linkedName={crmLink.linked?.displayName ?? null}
          extractedName={message.senderName ?? message.senderEmail}
          senderEmail={message.senderEmail}
          onLink={crmLink.link}
          onUnlink={crmLink.unlink}
          disabled={busy}
        />
        <p className="muted-sm">{t('inbox.detail.archiveNotice')}</p>
      </div>

      {/* §85 — segnali di cautela. Non nascondono nulla e non automatizzano
          nulla: avvisano prima che qualcuno esegua un versamento. */}
      <CautionNotice message={message} />

      {/* Cosa richiede attenzione: SOLO ciò che l'analisi ha verificato. */}
      <div className="card">
        <div className="card-title"><span>{t('inbox.detail.attentionTitle')}</span></div>
        {message.processingStatus === 'analyzing' || message.processingStatus === 'importing' ? (
          <div className="empty"><span className="spinner" aria-hidden="true" /> {t('inbox.detail.attentionPending')}</div>
        ) : analysis && analysis.analysisStatus !== 'failed' ? (
          <>
            <dl className="inbox-fields">
              {analysis.deadline && (
                <div>
                  <dt>{t('adminAi.result.deadline')}</dt>
                  <dd>
                    {formatDate(analysis.deadline)}
                    {' '}<span className={`badge badge-neutral lvl-${analysis.deadlineLevel}`}>{L.deadlineLevel(analysis.deadlineLevel)}</span>
                  </dd>
                </div>
              )}
              {analysis.amountDisplay && (
                <div>
                  <dt>{t('adminAi.result.amount')}</dt>
                  <dd>{analysis.amountDisplay}{analysis.amountType ? ` · ${L.amountType(analysis.amountType)}` : ''}</dd>
                </div>
              )}
              {analysis.primaryAction && (
                <div><dt>{t('adminAi.result.whatToDoNow')}</dt><dd>{analysis.primaryAction}</dd></div>
              )}
              <div><dt>{t('adminAi.result.urgencyChip', { level: '' }).trim()}</dt><dd>{L.urgency(analysis.urgency)}</dd></div>
              <div><dt>{t('adminAi.result.confidenceChip', { level: '' }).trim()}</dt><dd>{L.confidence(analysis.confidence)}</dd></div>
            </dl>

            {/* §13/§119 — l'incertezza non è una nota a piè di pagina: sta
                accanto alla conclusione a cui si riferisce. */}
            {analysis.uncertaintyItems.length > 0 && (
              <div className="warn-box">
                <Icon name="alert" className="ic-sm" />
                <ul className="stack-sm">
                  {analysis.uncertaintyItems.map((u, i) => <li key={i}>{u.description}</li>)}
                </ul>
              </div>
            )}

            {/* UN solo collegamento all'analisi, quella del documento
                principale: è l'analisi che questa scheda sta mostrando.
                Prima ce n'era uno per documento, tutti con la stessa
                etichetta, e con un corpo e un allegato importati comparivano
                due pulsanti identici che portavano in posti diversi. Gli altri
                documenti stanno nell'elenco qui sotto, con il loro stato. */}
            {documentRows.filter((d) => d.isPrimary).map((d) => (
              <div className="inbox-actions" key={d.documentId}>
                <button className="btn btn-sm" onClick={() => navigate(`/admin?doc=${d.documentId}`)}>
                  <Icon name="fileSearch" className="ic-sm" /> {t('inbox.detail.openAnalysis')}
                </button>
              </div>
            ))}
          </>
        ) : (
          <div className="empty">
            {message.errorCode
              ? inboxErrorMessage(message.errorCode)
              : t('inbox.detail.attentionNone')}
          </div>
        )}
        {message.relevanceReason && (
          <p className="muted-sm">
            <strong>{t('inbox.detail.reason')}</strong> — {reasonText(message.relevanceReason)}
          </p>
        )}
      </div>

      {/* Che cosa ha PRODOTTO questa comunicazione.
          Il percorso «posta → documento → analisi → attività» esisteva già, ma
          da qui si arrivava soltanto alla schermata di analisi: il documento —
          dove si organizza, si archivia e diventa lavoro — non era
          raggiungibile. Nessun dato del Document Hub è copiato qui: titolo,
          provenienza e stato viaggiano già con il messaggio. */}
      <div className="card">
        <div className="card-title"><span>{t('inbox.detail.documents')}</span></div>
        {documentRows.length === 0 ? (
          <div className="empty">{t('inbox.detail.documentsNone')}</div>
        ) : (
          <ul className="stack-sm">
            {documentRows.map((d) => (
              <li key={d.documentId} className="list-row">
                <span className="list-main">
                  <span className="list-title">{d.title}</span>
                  <span className="list-sub">
                    {[
                      d.relation === 'attachment'
                        ? t('documents.originAttachment')
                        : t('documents.originBody'),
                      d.filename,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {/* Lo stato è TESTO e usa le parole del Document Hub: un
                    secondo vocabolario per «in elaborazione» sarebbero due
                    parole per la stessa cosa. */}
                {/* La pastiglia compare solo se lo stato si SA: vedi
                    `messageDocuments.ts`. Un'etichetta plausibile e sbagliata
                    è peggio di un'etichetta assente. */}
                {d.state && (
                  <span className="badge badge-neutral">{t(`documents.states.${d.state}` as const)}</span>
                )}
                <Link className="btn btn-sm" to={`/documenti/${d.documentId}`}>
                  <Icon name="document" className="ic-sm" /> {t('inbox.detail.openDocument')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Allegati: presenti anche quando NON sono stati importati, con il
          motivo. L'assenza di un'analisi non deve far credere che non ci fosse
          niente da leggere (§41). */}
      <div className="card">
        <div className="card-title"><span>{t('inbox.detail.attachments')}</span></div>
        {message.attachments.length === 0 ? (
          <div className="empty">{t('inbox.detail.attachmentsNone')}</div>
        ) : (
          <ul className="stack-sm">
            {message.attachments.map((a) => (
              <li key={a.id} className="list-row">
                <span className="list-main">
                  <span className="list-title">{a.filename ?? '—'}</span>
                  <span className="list-sub">
                    {a.mimeType ?? a.declaredMimeType ?? '—'}
                    {a.sizeBytes ? ` · ${formatBytes(a.sizeBytes)}` : ''}
                  </span>
                </span>
                <span className="badge badge-neutral">
                  {t(`inbox.attachmentStatus.${a.importStatus}` as const)}
                </span>
                {a.storagePath && (
                  <button className="btn btn-sm" disabled={busy} onClick={() => openAttachment(a)}>
                    <Icon name="download" className="ic-sm" /> {t('inbox.detail.openFile')}
                  </button>
                )}
                {/* Porta al DOCUMENTO e non all'analisi: un allegato appena
                    importato un'analisi può non averla ancora, e un pulsante
                    che promette una schermata vuota è un pulsante che porta a
                    un rifiuto. */}
                {a.documentId && (
                  <Link className="btn btn-sm" to={`/documenti/${a.documentId}`}>
                    {t('inbox.detail.openDocument')}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Contenuto: testo puro. Nessun HTML, per costruzione. */}
      <div className="card">
        <div className="card-title"><span>{t('inbox.detail.body')}</span></div>
        {message.bodyText?.trim()
          ? <div className="inbox-body">{message.bodyText}</div>
          : <div className="empty">{t('inbox.detail.bodyEmpty')}</div>}
        <p className="muted-sm">{t('inbox.detail.bodyNotice')}</p>
        {message.isBulk && <p className="muted-sm">{t('inbox.detail.bulk')}</p>}
      </div>

      {message.bodyLinks.length > 0 && (
        <div className="card">
          <div className="card-title"><span>{t('inbox.detail.links')}</span></div>
          <ul className="stack-sm">
            {message.bodyLinks.map((link, i) => (
              <li key={`${link.url}-${i}`} className="inbox-link-row">
                {/* L'URL è già validato server-side: solo http/https, letto da
                    un parser. `noopener noreferrer` impedisce alla pagina
                    aperta di raggiungere questa finestra. */}
                <a href={link.url} target="_blank" rel="noopener noreferrer" className="btn-link">
                  {link.label} <Icon name="external" className="ic-sm" />
                </a>
                <span className="text-muted">{link.host}</span>
              </li>
            ))}
          </ul>
          <p className="muted-sm">{t('inbox.detail.linksHint')}</p>
        </div>
      )}

      <p className="muted-sm">{t('inbox.detail.readOnlyNotice')}</p>
    </>
  );
}

/**
 * Avviso di cautela (§85). Compare quando il messaggio contiene coordinate
 * bancarie, una richiesta di pagamento o una richiesta di credenziali.
 *
 * I segnali vengono ricalcolati qui sul testo già acquisito, e non letti da una
 * colonna: sono un aiuto alla lettura, non una conclusione dell'analisi, e non
 * devono poter essere scambiati per un verdetto memorizzato. Nessuna azione
 * viene automatizzata in nessun caso.
 */
function CautionNotice({ message }: { message: EmailMessageDetail }) {
  const t = useT();
  const haystack = `${message.subject ?? ''}\n${message.bodyText ?? ''}`;
  const payment = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}\b/.test(haystack)
    || /\b(nuove? coordinate|nuovo iban|neue kontoverbindung|neue bankverbindung|nouvelles? coordonnées|nouvel iban)\b/i.test(haystack);
  const credentials = /\b(password|passwort|mot de passe|credenziali|zugangsdaten|identifiants)\b/i.test(haystack);
  if (!payment && !credentials) return null;

  return (
    <div className="warn-box" role="note">
      <Icon name="alert" className="ic-sm" />
      <div>
        <strong>{t('inbox.detail.caution')}</strong>
        {payment && <div>{t('inbox.detail.cautionPayment')}</div>}
        {credentials && <div>{t('inbox.detail.cautionCredentials')}</div>}
      </div>
    </div>
  );
}
