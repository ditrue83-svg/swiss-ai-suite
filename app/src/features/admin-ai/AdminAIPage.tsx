// Admin AI — upload reale + analisi AI server-side PERSISTITA su Supabase.
// Flusso: estrai testo (o rileva scansione→OCR server) → hash+dedup §28 →
// crea documento → invoca la pipeline (persiste server) → rilegge l'analisi dal DB.
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { documentService } from '@/services/documentService';
import { analysisService } from '@/services/analysisService';
import { sha256Hex } from '@/lib/hash';
import { toUserMessage } from '@/lib/errors';
import { useI18n, useT } from '@/i18n';
import { formatBytes } from '@/lib/format';
import { extractFromFile, reconstructText, type ClientExtraction } from './pdf';
import { analyzeStoredDocument } from './analyzeStored';
import { ResultView } from './ResultView';
import type { DocumentAnalysis, DocumentRecord } from '@/types/models';

interface FileState { name: string; size?: number; state: 'loading' | 'ok' | 'err'; msg?: string }
/**
 * ⚠️ `file` È OBBLIGATORIO, e non lo era. Da questa schermata si analizza SOLO
 * un file: il campo del testo incollato non c'è più, e i tre pulsanti «Prova con
 * un esempio» — l'ultimo percorso che creava documenti `pasted_text` — sono stati
 * tolti il 2026-07-29. Tenere `file` facoltativo avrebbe lasciato in piedi i
 * rami che quel percorso serviva, cioè del codice che descrive una strada che
 * non esiste più: chi lo legge fra un mese la crede percorribile.
 * `pasted_text` resta un valore legittimo in archivio per i documenti già
 * caricati così, e `documentService` continua a saperlo scrivere.
 */
interface RunSource { file: File; extraction: ClientExtraction | null }

export function AdminAIPage() {
  const { activeCompany, activeCompanyId } = useCompany();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { locale } = useI18n();   // §42 — i testi generati seguono la lingua dell'app
  const t = useT();
  const companyId = activeCompanyId as string;
  const companyName = activeCompany?.legalName ?? null;

  const [searchParams, setSearchParams] = useSearchParams();
  const docParam = searchParams.get('doc');

  const [title, setTitle] = useState('');
  const [fileState, setFileState] = useState<FileState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [retrySrc, setRetrySrc] = useState<{ src: RunSource; title: string } | null>(null);
  // Chi apre un documento dall'archivio vuole LEGGERE l'analisi, non caricarne
  // un'altra: in quel caso il modulo di caricamento parte chiuso e sta in fondo.
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [drag, setDrag] = useState(false);

  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Apertura da Archivio (?doc=id): carica documento + analisi + testo per il viewer.
  useEffect(() => {
    if (!docParam || docParam === document?.id) return;
    let active = true;
    setLoadingDoc(true);
    setError(null);
    (async () => {
      try {
        const doc = await documentService.get(docParam);
        if (!doc) throw new Error(t('adminAi.docNotFound'));
        const an = await analysisService.getForDocument(doc.id);
        if (an) {
          // Testo + pagine per il viewer (§31): prima l'estrazione salvata (affidabile anche
          // per OCR), poi, in mancanza, la ri-estrazione dal file originale.
          try {
            const ext = await documentService.getExtraction(doc.id);
            an.originalText = ext?.fullText ?? null;
            an.pages = ext?.pages ?? null;
            if (!an.originalText && doc.storagePath) {
              const blob = await documentService.downloadBlob(doc.storagePath);
              an.originalText = await reconstructText(blob, doc.mimeType);
            }
          } catch { /* viewer degrada alle citazioni */ }
        }
        if (!active) return;
        setDocument(doc);
        setAnalysis(an);
      } catch (e) {
        if (active) setError(toUserMessage(e));
      } finally {
        if (active) setLoadingDoc(false);
      }
    })();
    return () => { active = false; };
  }, [docParam]); // eslint-disable-line react-hooks/exhaustive-deps

  function scrollToResult() {
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  async function runAnalysis(src: RunSource, docTitle: string) {
    if (!user) return;
    setError(null);
    setRetrySrc(null);
    setAnalyzing(true);
    setProgress(t('adminAi.progressPreparing'));
    try {
      // §28/§29 — hash dei BYTE del file, per la deduplicazione.
      const fileHash = await sha256Hex(await src.file.arrayBuffer());

      // Dedup: stesso contenuto GIÀ ANALIZZATO con successo → mostralo, non rianalizzare.
      // Un documento in stato 'failed' NON blocca: si riprova l'analisi (§53).
      const existing = await documentService.findByHash(companyId, fileHash);
      if (existing && existing.status !== 'failed') {
        const an = await analysisService.getForDocument(existing.id);
        if (an) {
          if (src.extraction) { an.originalText = src.extraction.fullText; an.pages = src.extraction.pages; }
          else { const ext = await documentService.getExtraction(existing.id); an.originalText = ext?.fullText ?? null; an.pages = ext?.pages ?? null; }
          setDocument(existing);
          setAnalysis(an);
          setSearchParams({ doc: existing.id }, { replace: true });
          showToast(t('adminAi.alreadyAnalyzed'));
          scrollToResult();
          return;
        }
      }

      const doc = existing ?? await documentService.create({
        companyId, userId: user.id,
        title: docTitle || src.file.name.replace(/\.[^.]+$/, ''),
        sourceType: 'upload',
        file: src.file,
        fileHash,
        pageCount: src.extraction?.pages.length ?? null,
      });

      setProgress(src.extraction
        ? t('adminAi.progressAnalyzing')
        : t('adminAi.progressOcr'));
      const { analysis: an, status } = await analysisService.analyzeAndPersist({
        document: doc, extraction: src.extraction, companyName, outputLanguage: locale,
        onProgress: setProgress,   // §25/§26 — stati reali dal server, nessuna percentuale finta
      });
      setDocument(doc);
      setAnalysis(an);
      setSearchParams({ doc: doc.id }, { replace: true });
      showToast(status === 'needs_review' ? t('adminAi.savedNeedsReview') : t('adminAi.savedOk'));
      scrollToResult();
    } catch (e) {
      setRetrySrc({ src, title: docTitle });   // §53 — consenti di riprovare senza reimpostare tutto
      setError(toUserMessage(e));
    } finally {
      setAnalyzing(false);
      setProgress(null);
    }
  }

  function retryAnalysis() {
    if (retrySrc) void runAnalysis(retrySrc.src, retrySrc.title);
  }

  /**
   * §27 — rilancia l'analisi di un documento GIÀ salvato (tipicamente riaperto
   * dall'archivio dopo un fallimento). Riusa il testo già estratto: nessun nuovo
   * upload, nessuna nuova estrazione. Se l'estrazione non c'è (scansione mai
   * riuscita) si passa null e il server rifà l'OCR.
   */
  async function retryStored(forceOcr = false) {
    if (!document || analyzing) return;
    setAnalyzing(true);
    setError(null);
    setProgress(t(forceOcr ? 'adminAi.progressOcr' : 'adminAi.progressResuming'));
    try {
      // Stessa funzione che usa il dettaglio di un documento nel Document Hub:
      // due orchestrazioni della stessa rianalisi finirebbero per divergere.
      const { analysis: an, status } = await analyzeStoredDocument({
        document, companyName, outputLanguage: locale, onProgress: setProgress, forceOcr,
      });
      setAnalysis(an);
      showToast(status === 'needs_review' ? t('adminAi.savedNeedsReview') : t('adminAi.analysisDone'));
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setAnalyzing(false);
      setProgress(null);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setFileState({ name: file.name, size: file.size, state: 'loading' });
    // ⚠️ Il titolo scritto a mano VINCE sul nome del file. È l'unico momento in
    // cui si può dare un nome al documento: nell'archivio non si rinomina.
    // Prima questo campo lo leggeva solo l'analisi del testo incollato; tolta
    // quella, senza questa riga il campo resterebbe lì a non fare nulla.
    const derivedTitle = title.trim() || file.name.replace(/\.[^.]+$/, '');
    try {
      const outcome = await extractFromFile(file);
      setTitle(derivedTitle);
      if (outcome.kind === 'extraction') {
        setFileState({ name: file.name, size: file.size, state: 'ok' });
        await runAnalysis({ file, extraction: outcome.extraction }, derivedTitle);
      } else {
        // scansione/immagine: niente testo estraibile lato client → OCR server-side (§4).
        setFileState({ name: file.name, size: file.size, state: 'ok', msg: outcome.reason === 'image' ? t('adminAi.fileImageOcr') : t('adminAi.fileScanOcr') });
        await runAnalysis({ file, extraction: null }, derivedTitle);
      }
    } catch (err) {
      setFileState({ name: file.name, size: file.size, state: 'err', msg: (err as Error).message || t('adminAi.fileUnreadable') });
    }
  }

  const uploader = (
      <div className="card">
        <div className="card-title">{t('adminAi.stepDoc')}</div>
        <button
          type="button"
          className={`upload-zone${drag ? ' drag' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void handleFile(e.dataTransfer.files[0]); }}
          aria-label={t('adminAi.dropzoneAria')}
        >
          <span className="uz-icon" aria-hidden="true"><Icon name="document" /></span>
          <span className="uz-title">{t('adminAi.dropzone')}</span>
          <span className="uz-formats"><span className="uz-fmt">PDF</span><span className="uz-fmt">IMG</span><span className="uz-fmt">EMAIL</span><span className="uz-fmt">TXT</span></span>
          <span className="uz-ocr"><Icon name="fileSearch" className="ic-sm" /><span>{t('adminAi.ocrNote')}</span></span>
        </button>
        <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md,.eml,text/plain,application/pdf,image/*" hidden onChange={(e) => void handleFile(e.target.files?.[0])} />

        {fileState && (
          <div className="file-status">
            <div className={`file-chip${fileState.state === 'err' ? ' err' : ''}`}>
              {fileState.state === 'loading' ? <span className="spinner" /> : <span className="fc-ico"><Icon name={fileState.state === 'err' ? 'alert' : 'document'} /></span>}
              <div className="fc-main">
                <div className="fc-name">{fileState.name}</div>
                <div className="fc-sub">{fileState.state === 'loading' ? t('adminAi.extracting') : fileState.state === 'ok' ? `${formatBytes(fileState.size ?? 0)}${fileState.msg ? ` · ${fileState.msg}` : ''}` : fileState.msg}</div>
              </div>
              <button className="btn btn-sm btn-icon" onClick={() => { setFileState(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} aria-label={t('adminAi.removeFile')}><Icon name="close" className="ic-sm" /></button>
            </div>
          </div>
        )}

        {/* Il titolo si scrive PRIMA di scegliere il file: l'analisi parte da
            sola appena il file è selezionato, quindi dopo non c'è più momento. */}
        <div className="field mt-16">
          <label htmlFor="doc-title">{t('adminAi.titleField')}</label>
          <input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('adminAi.titlePlaceholder')} />
        </div>
        {error && (
          <div className="info-box mt-12" role="alert">
            <div>{error}</div>
            {retrySrc && !analyzing && (
              <div className="mt-3">
                <button className="btn btn-sm" onClick={retryAnalysis}><Icon name="fileSearch" className="ic-sm" /> {t('common.retry')}</button>
              </div>
            )}
          </div>
        )}
      </div>
  );

  // Aperto dall'archivio: c'è un'analisi da leggere e non se ne sta calcolando una.
  const readingStored = !!docParam && !!analysis && !analyzing && !loadingDoc;

  const result = (
      <div ref={resultRef}>
        {analyzing && progress && (
          <div className="card mt-16" role="status" aria-live="polite"><span className="spinner" /> {progress}</div>
        )}
        {loadingDoc && <div className="card mt-16"><span className="spinner" /> {t('adminAi.loadingAnalysis')}</div>}
        {!analyzing && !loadingDoc && analysis && document && (
          <div className="mt-16">
            <ResultView
              analysis={analysis}
              document={document}
              onRetry={() => void retryStored(false)}
              onForceOcr={() => void retryStored(true)}
            />
          </div>
        )}
        {!analyzing && !loadingDoc && docParam && !analysis && !error && (
          <div className="card mt-16"><div className="muted-sm">{t('adminAi.noAnalysisYet')}</div></div>
        )}
      </div>
  );

  // In lettura l'ordine si inverte: prima il risultato, poi — su richiesta — il
  // modulo per analizzare un altro documento.
  if (readingStored) {
    return (
      <>
        {/* In lettura l'intestazione descriveva ancora come CARICARE un
            documento, mentre il documento è già lì e lo si sta leggendo. */}
        <div className="page-head">
          <Link className="btn btn-sm btn-ghost mb-8" to={`/documenti/${document?.id ?? ''}`}><Icon name="arrowLeft" className="ic-sm" /> {t('adminAi.backToDocuments')}</Link>
          <div className="page-title">{t('adminAi.title')}</div>
          <div className="page-desc">{t('adminAi.introReading')}</div>
        </div>
        {result}
        <div className="mt-16">
          {uploaderOpen ? uploader : (
            <button className="btn" onClick={() => setUploaderOpen(true)}>
              <Icon name="document" className="ic-sm" /> {t('adminAi.analyzeAnother')}
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('adminAi.title')}</div>
        <div className="page-desc">{t('adminAi.intro')}</div>
      </div>
      {uploader}
      {result}
    </>
  );
}
