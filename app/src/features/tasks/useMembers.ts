// ============================================================================
// useMembers — i membri dell'azienda attiva, una volta sola.
//
// Esiste perché il nome di una persona serve in quattro punti (dropdown del
// responsabile, riga della lista, autore dei commenti, storico) e ripetere la
// query in ogni componente significherebbe quattro chiamate per schermata e
// quattro modi diversi di gestire l'assenza del nome.
//
// Segue `activeCompanyId`: al cambio di azienda la rubrica si ricarica, e i
// nomi della company precedente spariscono invece di restare appesi.
// ============================================================================
import { useMemo } from 'react';
import { useAsync } from '@/hooks/useAsync';
import { useCompany } from '@/contexts/CompanyContext';
import { memberService } from '@/services/memberService';
import type { AssignableMember } from '@/types/models';

export function useMembers() {
  const { activeCompanyId } = useCompany();
  const companyId = activeCompanyId as string;

  const state = useAsync<AssignableMember[]>(
    () => memberService.listAssignable(companyId),
    [companyId],
  );

  const byId = useMemo(() => {
    const map = new Map<string, AssignableMember>();
    for (const m of state.data ?? []) map.set(m.userId, m);
    return map;
  }, [state.data]);

  return { ...state, members: state.data ?? [], byId };
}
