// Viewer PDF reale (§31): renderizza le pagine del documento originale e, quando
// l'utente clicca «Mostra nel documento», porta alla PAGINA CORRETTA mostrando la
// citazione accanto. NON simula un highlighting a coordinate sul PDF: l'evidenza
// viene dal testo estratto, quindi si dichiara la pagina e si cita il passaggio
// (la specifica ammette esplicitamente questo grado di precisione).
import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Icon } from '@/components/ui/Icon';
import { documentService } from '@/services/documentService';
import { useT } from '@/i18n';
import type { Evidence } from '@/types/models';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const MAX_RENDERED_PAGES = 30;   // guardia: documenti amministrativi sono brevi
const MAX_SCALE = 2;             // limite di nitidezza (memoria/CPU)

export function PdfViewer({ storagePath, highlight }: {
  storagePath: string;
  highlight: Evidence | null;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(0);
  const [rendered, setRendered] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carica e renderizza il PDF una sola volta per documento.
  useEffect(() => {
    let cancelled = false;
    let pdf: pdfjsLib.PDFDocumentProxy | null = null;
    const container = containerRef.current;
    if (container) container.innerHTML = '';
    setPageCount(0); setRendered(0); setTruncated(false); setError(null);

    (async () => {
      try {
        const blob = await documentService.downloadBlob(storagePath);
        if (cancelled) return;
        const buf = new Uint8Array(await blob.arrayBuffer());
        if (cancelled) return;

        pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled || !containerRef.current) return;

        const total = pdf.numPages;
        const limit = Math.min(total, MAX_RENDERED_PAGES);
        setPageCount(total);
        setTruncated(total > limit);

        // Larghezza disponibile: le pagine si adattano alla colonna.
        const available = containerRef.current.clientWidth || 640;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        for (let n = 1; n <= limit; n++) {
          if (cancelled) return;
          const page = await pdf.getPage(n);
          if (cancelled) return;

          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(available / base.width, MAX_SCALE);
          const viewport = page.getViewport({ scale });

          const wrap = document.createElement('div');
          wrap.dataset.page = String(n);
          wrap.style.marginBottom = '14px';

          const label = document.createElement('div');
          label.className = 'muted-sm';
          label.style.fontWeight = '600';
          label.style.marginBottom = '4px';
          label.textContent = `— ${t('adminAi.result.page', { n })} —`;

          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.style.border = '1px solid var(--line, #e5e7eb)';
          canvas.style.borderRadius = '6px';
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', t('adminAi.result.page', { n }));

          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('canvas non disponibile');
          ctx.scale(dpr, dpr);

          wrap.appendChild(label);
          wrap.appendChild(canvas);
          containerRef.current?.appendChild(wrap);

          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          setRendered(n);
        }
      } catch {
        if (!cancelled) setError(t('errors.pdfPreviewUnavailable'));
      }
    })();

    return () => {
      cancelled = true;
      pdf?.destroy().catch(() => { /* già distrutto */ });
    };
  }, [storagePath]);

  // Porta alla pagina della citazione (§31).
  useEffect(() => {
    const n = highlight?.pageNumber;
    if (!n || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-page="${n}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [highlight, rendered]);

  return (
    <>
      {highlight && (
        <div className="hint-accent mb-2">
          <Icon name="fileSearch" className="ic-sm" />{' '}
          {highlight.pageNumber ? <><strong>{t('adminAi.result.quoteOnPage', { n: highlight.pageNumber })}</strong>{' '}</> : <>{t('adminAi.result.quoteCited')}{' '}</>}
          «{highlight.quote}»
          <div className="muted-sm mt-1">
            {t('adminAi.result.pdfPageNote')}
          </div>
        </div>
      )}

      {error && <div className="muted-sm mb-2">{error}</div>}

      {!error && pageCount > 0 && rendered < Math.min(pageCount, MAX_RENDERED_PAGES) && (
        <div className="muted-sm mb-2">
          <span className="spinner" aria-hidden="true" /> {t('adminAi.result.renderingPage', { n: rendered + 1, total: Math.min(pageCount, MAX_RENDERED_PAGES) })}
        </div>
      )}
      {!error && pageCount === 0 && (
        <div className="muted-sm mb-2"><span className="spinner" aria-hidden="true" /> {t('adminAi.result.loadingDocument')}</div>
      )}

      <div className="ax-doc-view" ref={containerRef} />

      {truncated && (
        <div className="muted-sm mt-2">
          {t('adminAi.result.previewLimited', { max: MAX_RENDERED_PAGES, total: pageCount })}
        </div>
      )}
    </>
  );
}
