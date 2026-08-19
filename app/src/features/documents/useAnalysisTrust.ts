// ============================================================================
// useAnalysisTrust — il verdetto di attendibilità per le schermate che hanno
// SOLO l'oggetto analisi (Admin AI appena analizzato, dettaglio di una
// comunicazione): l'ingresso si completa da qui — rubrica dei membri per i
// cognomi, registro delle correzioni per la conferma di appartenenza.
//
// ⚠️ FINCHÉ NON SI SA, NON SI DICE: il verdetto è `null` mentre le letture
// sono in corso E quando falliscono, e la schermata non mostra niente — mai il
// campo grezzo al suo posto, mai un livello provvisorio. Un valore falso che
// vive mezzo secondo è peggio di uno che vive per sempre: sembra autorevole,
// l'occhio lo registra, e poi cambia sotto lo sguardo.
//
// Il dettaglio del documento NON passa da qui: ha già le correzioni in pagina
// (`detail.corrections`) e calcola in linea con gli stessi ingredienti.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { useCompany } from '@/contexts/CompanyContext';
import { useMembers } from '@/features/tasks/useMembers';
import { documentHubService } from '@/services/documentHubService';
import type { DocumentAnalysis } from '@/types/models';
import {
  analysisTrust, cognomiDaRubrica, ownershipConfirmation, trustInputFromAnalysis,
  type TrustVerdict,
} from './analysisTrust';

export function useAnalysisTrust(analysis: DocumentAnalysis | null): TrustVerdict | null {
  const { activeCompany } = useCompany();
  const { members } = useMembers();
  const [verdict, setVerdict] = useState<TrustVerdict | null>(null);
  const legalName = activeCompany?.legalName ?? '';
  const surnames = useMemo(() => cognomiDaRubrica(members.map((m) => m.name)), [members]);

  useEffect(() => {
    let active = true;
    setVerdict(null);
    if (!analysis || analysis.analysisStatus === 'failed' || !legalName) return;
    documentHubService.corrections(analysis.documentId)
      .then((corr) => {
        if (!active) return;
        setVerdict(analysisTrust(trustInputFromAnalysis(
          analysis,
          { legalName, memberSurnames: surnames },
          ownershipConfirmation(corr) !== null,
        )));
      })
      // Il fallimento è assenza d'informazione, non un valore: silenzio.
      .catch(() => {});
    return () => { active = false; };
    // L'identità dell'analisi, non l'oggetto: un oggetto nuovo a ogni render
    // rifarebbe la lettura senza che sia cambiato niente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis?.id, analysis?.analysisStatus, legalName, surnames]);

  return verdict;
}
