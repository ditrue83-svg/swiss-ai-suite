// Admin AI — upload reale + analisi (motore corrente) PERSISTITA su Supabase.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { documentService } from '@/services/documentService';
import { analysisService } from '@/services/analysisService';
import { toUserMessage } from '@/lib/errors';
import { formatBytes } from '@/lib/format';
import { readFileText, reconstructText } from './pdf';
import { SAMPLE_DOCUMENTS } from './engine';
import { ResultView } from './ResultView';
import type { DocumentAnalysis, DocumentRecord } from '@/types/models';

interface FileState { name: string; size?: number; state: 'loading' | 'ok' | 'err'; msg?: string }

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
        if (an && doc.storagePath) {
          try {
            const blob = await documentService.downloadBlob(doc.storagePath);
            an.originalText = await reconstructText(blob, doc.mimeType);
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

  async function runAnalysis(sourceText: string, docTitle: string, file?: File) {
    if (!user) return;
    setError(null);
    setAnalyzing(true);
    try {
      const doc = await documentService.create({
        companyId, userId: user.id,
        title: docTitle || (file ? file.name.replace(/\.[^.]+$/, '') : 'Documento'),
        sourceType: file ? 'upload' : 'pasted_text',
        file, text: file ? undefined : sourceText,
      });
      const { analysis: an, usedFallback } = await analysisService.analyzeAndPersist({
        document: doc, text: sourceText, companyName,
      });
      an.originalText = sourceText;
      setDocument(doc);
      setAnalysis(an);
      setSearchParams({ doc: doc.id }, { replace: true });
      showToast(usedFallback
        ? 'Analisi AI non disponibile: usato il motore locale'
        : 'Documento analizzato e salvato in archivio');
      scrollToResult();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setFileState({ name: file.name, size: file.size, state: 'loading' });
    try {
      const content = await readFileText(file);
      const derivedTitle = file.name.replace(/\.[^.]+$/, '');
      setText(content);
      setTitle(derivedTitle);
      setFileState({ name: file.name, size: file.size, state: 'ok' });
      await runAnalysis(content, derivedTitle, file);
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
    void runAnalysis(text, title);
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
          <span className="uz-formats"><span className="uz-fmt">PDF</span><span className="uz-fmt">EMAIL</span><span className="uz-fmt">TXT</span></span>
          <span className="uz-ocr"><Icon name="fileSearch" className="ic-sm" /><span>Scansioni e foto — supporto OCR previsto</span></span>
        </button>
        <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md,.eml,text/plain,application/pdf" hidden onChange={(e) => void handleFile(e.target.files?.[0])} />

        {fileState && (
          <div className="file-status">
            <div className={`file-chip${fileState.state === 'err' ? ' err' : ''}`}>
              {fileState.state === 'loading' ? <span className="spinner" /> : <span className="fc-ico"><Icon name={fileState.state === 'err' ? 'alert' : 'document'} /></span>}
              <div className="fc-main">
                <div className="fc-name">{fileState.name}</div>
                <div className="fc-sub">{fileState.state === 'loading' ? 'Estrazione del testo in corso…' : fileState.state === 'ok' ? `${formatBytes(fileState.size ?? 0)} · testo estratto` : fileState.msg}</div>
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
              <button key={s.id} className="btn btn-sm" disabled={analyzing} onClick={() => { setText(s.text); setTitle(s.title); void runAnalysis(s.text, s.title); }}>{s.label}</button>
            ))}
          </span>
        </div>
        {error && <div className="info-box mt-12" role="alert">{error}</div>}
      </div>

      <div ref={resultRef}>
        {loadingDoc && <div className="card mt-16"><span className="spinner" /> Caricamento analisi…</div>}
        {!loadingDoc && analysis && document && <div className="mt-16"><ResultView analysis={analysis} document={document} /></div>}
        {!loadingDoc && docParam && !analysis && !error && (
          <div className="card mt-16"><div className="muted-sm">Questo documento non ha ancora un’analisi.</div></div>
        )}
      </div>
    </>
  );
}
