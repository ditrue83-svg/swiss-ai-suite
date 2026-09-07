// ============================================================================
// useAttentionCount — il numero dei documenti «da verificare», per la
// pastiglia della topbar (riferimento 2026-09-06).
//
// Qui il numero è UNO e vive nella shell. Copre attivi e archiviati come il
// censimento della Panoramica; la pagina Documenti separa invece le due
// popolazioni in viste distinte, quindi le righe operative restano nei loro
// due collegamenti dentro «Limiti del sistema». Il conteggio arriva dalle due
// funzioni finestra di `list_documents` (limit 1: servono i totali, non le
// righe), con la stessa cadenza della campanella: al cambio azienda e al cambio
// pagina, perché è lì che qualcosa può essere successo.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { documentHubService } from '@/services/documentHubService';

export function useAttentionCount(activeCompanyId: string | null): number | null {
  const [count, setCount] = useState<number | null>(null);
  const location = useLocation();

  const refresh = useCallback(async () => {
    if (!activeCompanyId) { setCount(null); return; }
    try {
      const { attivi, archiviati } = await documentHubService.stateTotals(activeCompanyId, 'to_verify');
      // La Panoramica conta entrambe le popolazioni: in produzione i sedici
      // documenti da verificare erano tutti archiviati, quindi leggere i soli
      // attivi trasformava un dato reale in zero e nascondeva la pastiglia.
      setCount(attivi + archiviati);
    } catch {
      // Un conteggio che non si riesce a leggere resta ignoto: zero sarebbe
      // un'affermazione e nasconderebbe di nuovo il segnale.
      setCount(null);
    }
  }, [activeCompanyId]);

  // Azzeramento immediato al cambio azienda, poi ricarica: un badge non
  // azzerato mostrerebbe il numero dell'azienda precedente sotto il nome
  // della nuova — non un ritardo, un'informazione falsa.
  useEffect(() => {
    setCount(null);
    void refresh();
  }, [activeCompanyId, refresh]);

  // Cambiando pagina è probabile che qualcosa sia stato verificato: si
  // ricontrolla, come fa la campanella.
  useEffect(() => { void refresh(); }, [location.pathname, refresh]);

  return count;
}
