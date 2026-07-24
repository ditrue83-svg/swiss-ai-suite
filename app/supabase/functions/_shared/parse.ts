// Estrae e interpreta il JSON prodotto dal modello. Difensivo: tollera eventuali
// recinti markdown attorno all'oggetto, ma non "aggiusta" il contenuto.
export function parseModelJson(text: string): unknown {
  if (typeof text !== 'string') throw new Error('output non testuale');
  let s = text.trim();
  // rimuovi eventuali recinti ```json … ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // in caso di testo attorno, isola il primo oggetto { … } bilanciato
  if (!s.startsWith('{')) {
    const i = s.indexOf('{');
    if (i >= 0) s = s.slice(i);
  }
  return JSON.parse(s);
}
