// ============================================================================
// useAttentionCount — il numero dei documenti «da verificare» ATTIVI, per la
// pastiglia della topbar e il badge su «Documenti» (riferimento 2026-09-06).
//
// ⚠️ UNA SOLA INTERROGAZIONE CONDIVISA, e il perché sta nel commento di
// `nav.ts`: un badge per voce costerebbe una richiesta per voce per cambio
// pagina. Qui il numero è UNO, vive nella shell, e la sua definizione è la
// stessa della colonna «Richiede attenzione» della Panoramica e della pagina
// d'arrivo del suo collegamento (`/documenti?stato=to_verify`) — il numero
// della shell e il numero della destinazione non possono divergere.
// Il conteggio arriva dalla funzione finestra di `list_documents` (limit 1:
// le righe non servono, serve il totale), con la stessa cadenza della
// campanella: al cambio azienda e al cambio pagina, perché è lì che qualcosa
// può essere successo.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { documentHubService } from '@/services/documentHubService';

export function useAttentionCount(activeCompanyId: string | null): number {
  const [count, setCount] = useState(0);
  const location = useLocation();

  const refresh = useCallback(async () => {
    if (!activeCompanyId) { setCount(0); return; }
    try {
      const { attivi } = await documentHubService.stateTotals(activeCompanyId, 'to_verify');
      setCount(attivi);
    } catch {
      // Un conteggio che non si riesce a leggere resta com'era: «zero
      // documenti da verificare» è un'affermazione, e non la sappiamo.
    }
  }, [activeCompanyId]);

  // Azzeramento immediato al cambio azienda, poi ricarica: un badge non
  // azzerato mostrerebbe il numero dell'azienda precedente sotto il nome
  // della nuova — non un ritardo, un'informazione falsa.
  useEffect(() => {
    setCount(0);
    void refresh();
  }, [activeCompanyId, refresh]);

  // Cambiando pagina è probabile che qualcosa sia stato verificato: si
  // ricontrolla, come fa la campanella.
  useEffect(() => { void refresh(); }, [location.pathname, refresh]);

  return count;
}
