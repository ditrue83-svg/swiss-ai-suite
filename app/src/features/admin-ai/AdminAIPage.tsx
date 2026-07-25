// Admin AI — upload reale + analisi AI server-side PERSISTITA su Supabase.
// Flusso: estrai testo (o rileva scansione→OCR server) → hash+dedup §28 →
// crea documento → invoca la pipeline (persiste server) → rilegge l'analisi dal DB.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { documentService } from '@/services/documentService';
import { analysisService } from '@/services/analysisService';
import { sha256Hex } from '@/lib/hash';
import { toUserMessage } from '@/lib/errors';
import { formatBytes } from '@/lib/format';
import { extractFromFile, fromPlainText, reconstructText, type ClientExtraction } from './pdf';
import { SAMPLE_DOCUMENTS } from './engine';
import { ResultView } from './ResultView';
import type { DocumentAnalysis, DocumentRecord } from '@/types/models';

interface FileState { name: string; size?: number; state: 'loading' | 'ok' | 'err'; msg?: string }
interface RunSource { file?: File; text?: string; extraction: ClientExtraction | null }

export function AdminAIPage() {
  const { activeCompany, activeCompanyId } = useCompany();
  const { user } = useAuth();
  const { showToast } = useToast();
  const companyId = activeCompanyId as string;
  const companyName = activeCompany?.legalName ?? null;

  const [searchParams, setSearchParams] = useSearchParams();
  const docParam = searchParams.get('doc');

  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [fileState, setFileState] = useState<FileState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [retrySrc, setRetrySrc] = useState<{ src: RunSource; title: string } | null>(null);
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
        if (!doc) throw new Error('Documento non trovato.');
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
    setProgress('Preparazione del documento…');
    try {
      // §28/§29 — hash del CONTENUTO (byte del file o testo), per la deduplicazione.
      const fileHash = src.file
        ? await sha256Hex(await src.file.arrayBuffer())
        : await sha256Hex(src.text ?? src.extraction?.fullText ?? '');

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
          showToast('Documento già analizzato: mostro l’analisi esistente.');
          scrollToResult();
          return;
        }
      }

      const doc = existing ?? await documentService.create({
        companyId, userId: user.id,
        title: docTitle || (src.file ? src.file.name.replace(/\.[^.]+$/, '') : 'Documento'),
        sourceType: src.file ? 'upload' : 'pasted_text',
        file: src.file,
        text: src.file ? undefined : (src.text ?? src.extraction?.fullText ?? ''),
        fileHash,
        pageCount: src.extraction?.pages.length ?? null,
      });

      setProgress(src.extraction
        ? 'Analisi AI in corso… può richiedere qualche istante.'
        : 'Riconoscimento del testo (OCR) e analisi AI in corso…');
      const { analysis: an, status } = await analysisService.analyzeAndPersist({
        document: doc, extraction: src.extraction, companyName,
        onProgress: setProgress,   // §25/§26 — stati reali dal server, nessuna percentuale finta
      });
      setDocument(doc);
      setAnalysis(an);
      setSearchParams({ doc: doc.id }, { replace: true });
      showToast(status === 'needs_review'
        ? 'Analizzato — alcune informazioni sono da verificare'
        : 'Documento analizzato e salvato in archivio');
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
  async function retryStored() {
    if (!document || analyzing) return;
    setAnalyzing(true);
    setError(null);
    setProgress('Ripresa dell’analisi…');
    try {
      const ext = await documentService.getExtraction(document.id);
      const extraction: ClientExtraction | null = ext?.fullText
        ? { fullText: ext.fullText, pages: ext.pages, extractionMethod: 'text' }
        : null;
      const { analysis: an, status } = await analysisService.analyzeAndPersist({
        document, extraction, companyName, onProgress: setProgress,
      });
      setAnalysis(an);
      showToast(status === 'needs_review'
        ? 'Analizzato — alcune informazioni sono da verificare'
        : 'Analisi completata');
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
    const derivedTitle = file.name.replace(/\.[^.]+$/, '');
    try {
      const outcome = await extractFromFile(file);
      setTitle(derivedTitle);
      if (outcome.kind === 'extraction') {
        setText(outcome.extraction.fullText);
        setFileState({ name: file.name, size: file.size, state: 'ok' });
        await runAnalysis({ file, extraction: outcome.extraction }, derivedTitle);
      } else {
        // scansione/immagine: niente testo estraibile lato client → OCR server-side (§4).
        setText('');
        setFileState({ name: file.name, size: file.size, state: 'ok', msg: outcome.reason === 'image' ? 'immagine · OCR lato server' : 'scansione · OCR lato server' });
        await runAnalysis({ file, extraction: null }, derivedTitle);
      }
    } catch (err) {
      setFileState({ name: file.name, size: file.size, state: 'err', msg: (err as Error).message || 'Impossibile leggere il file.' });
    }
  }

  function analyzePasted() {
    setError(null);
    if (text.trim().length < 40) {
      setError('Inserisci il testo completo della comunicazione (almeno qualche riga).');
      return;
    }
    void runAnalysis({ text, extraction: fromPlainText(text) }, title);
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">Swiss Admin AI</div>
        <div className="page-desc">Carica un PDF, incolla un’email o una lettera: il sistema identifica ente, lingua, scadenze e genera checklist e bozza di risposta.</div>
      </div>

      <div className="card">
        <div className="card-title">1 · Documento da analizzare</div>
        <button
          type="button"
          className={`upload-zone${drag ? ' drag' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void handleFile(e.dataTransfer.files[0]); }}
          aria-label="Carica un PDF, un'email o un file di testo da analizzare"
        >
          <span className="uz-icon" aria-hidden="true"><Icon name="document" /></span>
          <span className="uz-title">Trascina qui un file o clicca per selezionarlo</span>
          <span className="uz-formats"><span className="uz-fmt">PDF</span><span className="uz-fmt">IMG</span><span className="uz-fmt">EMAIL</span><span className="uz-fmt">TXT</span></span>
          <span className="uz-ocr"><Icon name="fileSearch" className="ic-sm" /><span>Scansioni e foto — riconoscimento del testo (OCR) lato server</span></span>
        </button>
        <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md,.eml,text/plain,application/pdf,image/*" hidden onChange={(e) => void handleFile(e.target.files?.[0])} />

        {fileState && (
          <div className="file-status">
            <div className={`file-chip${fileState.state === 'err' ? ' err' : ''}`}>
              {fileState.state === 'loading' ? <span className="spinner" /> : <span className="fc-ico"><Icon name={fileState.state === 'err' ? 'alert' : 'document'} /></span>}
              <div className="fc-main">
                <div className="fc-name">{fileState.name}</div>
                <div className="fc-sub">{fileState.state === 'loading' ? 'Estrazione del testo in corso…' : fileState.state === 'ok' ? `${formatBytes(fileState.size ?? 0)} · ${fileState.msg ?? 'testo estratto'}` : fileState.msg}</div>
              </div>
              <button className="btn btn-sm btn-icon" onClick={() => { setFileState(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} aria-label="Rimuovi il file"><Icon name="close" className="ic-sm" /></button>
            </div>
          </div>
        )}

        <div className="field mt-16">
          <label htmlFor="doc-text">Oppure incolla il testo della comunicazione</label>
          <textarea id="doc-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Incolla qui il contenuto della lettera o dell'email…" />
        </div>
        <div className="field">
          <label htmlFor="doc-title">Titolo (facoltativo)</label>
          <input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Es. Lettera cassa AVS agosto" />
        </div>
        <div className="row-wrap">
          <button className="btn btn-primary btn-block-mobile" onClick={analyzePasted} disabled={analyzing} aria-busy={analyzing || undefined}>
            {analyzing ? <span className="spinner" aria-hidden="true" /> : null} Analizza documento
          </button>
          <span className="muted-sm">Prova con un esempio:</span>
          <span className="row-wrap">
            {SAMPLE_DOCUMENTS.map((s) => (
              <button key={s.id} className="btn btn-sm" disabled={analyzing} onClick={() => { setText(s.text); setTitle(s.title); void runAnalysis({ text: s.text, extraction: fromPlainText(s.text) }, s.title); }}>{s.label}</button>
            ))}
          </span>
        </div>
        {error && (
          <div className="info-box mt-12" role="alert">
            <div>{error}</div>
            {retrySrc && !analyzing && (
              <div style={{ marginTop: 10 }}>
                <button className="btn btn-sm" onClick={retryAnalysis}><Icon name="fileSearch" className="ic-sm" /> Riprova</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div ref={resultRef}>
        {analyzing && progress && (
          <div className="card mt-16" role="status" aria-live="polite"><span className="spinner" /> {progress}</div>
        )}
        {loadingDoc && <div className="card mt-16"><span className="spinner" /> Caricamento analisi…</div>}
        {!analyzing && !loadingDoc && analysis && document && (
          <div className="mt-16"><ResultView analysis={analysis} document={document} onRetry={retryStored} /></div>
        )}
        {!analyzing && !loadingDoc && docParam && !analysis && !error && (
          <div className="card mt-16"><div className="muted-sm">Questo documento non ha ancora un’analisi.</div></div>
        )}
      </div>
    </>
  );
}
