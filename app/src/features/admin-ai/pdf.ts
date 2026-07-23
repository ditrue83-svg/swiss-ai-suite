// Estrazione testo da PDF lato client (pdf.js). L'OCR (scansioni/foto) è previsto
// per una fase successiva: qui gestiamo solo PDF con testo.
import * as pdfjsLib from 'pdfjs-dist';
// Worker servito da Vite come URL (bundle self-contained).
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items
      .map((it) => {
        const maybe = it as { str?: string };
        return typeof maybe.str === 'string' ? maybe.str : '';
      })
      .join(' ') + '\n';
  }
  return text;
}

/** Legge un File dell'utente e ne estrae il testo (PDF o testo semplice). */
export async function readFileText(file: File): Promise<string> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    const buf = await file.arrayBuffer();
    const text = await extractPdfText(buf);
    if (text.trim().length < 40) {
      throw new Error("Il PDF sembra una scansione senza testo. L'OCR è previsto: per ora incolla il testo manualmente.");
    }
    return text;
  }
  if (file.type.startsWith('image/')) {
    throw new Error("Immagine ricevuta: l'OCR è previsto ma non ancora disponibile. Incolla il testo della lettera.");
  }
  return await file.text();
}

/** Ricostruisce il testo originale scaricando il file da Storage (per il viewer). */
export async function reconstructText(blob: Blob, mimeType: string | null): Promise<string> {
  const isPdf = (mimeType ?? '').includes('pdf');
  if (isPdf) {
    try {
      return await extractPdfText(await blob.arrayBuffer());
    } catch {
      return '';
    }
  }
  return await blob.text();
}
