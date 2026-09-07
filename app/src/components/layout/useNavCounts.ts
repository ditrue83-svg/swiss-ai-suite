// ============================================================================
// useNavCounts — i soli conteggi che hanno già una fonte reale e una pagina
// corrispondente: Inbox operativa, documenti attivi, attività da svolgere.
// Un guasto lascia `null`, mai zero: il badge sparisce invece di inventare un
// dato. Incentivi non compare perché il modulo è stato ritirato e non esiste
// più un servizio autorevole da interrogare.
// ============================================================================
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { documentHubService } from '@/services/documentHubService';
import { inboxService } from '@/services/inboxService';
import { taskService } from '@/services/taskService';

export interface NavCounts {
  inbox: number | null;
  documents: number | null;
  deadlines: number | null;
}

const UNKNOWN: NavCounts = { inbox: null, documents: null, deadlines: null };

export function useNavCounts(activeCompanyId: string | null): NavCounts {
  const [counts, setCounts] = useState<NavCounts>(UNKNOWN);
  const { pathname } = useLocation();

  useEffect(() => {
    let current = true;
    if (!activeCompanyId) {
      setCounts(UNKNOWN);
      return () => { current = false; };
    }

    void Promise.allSettled([
      // La Inbox segnala il lavoro che richiede un gesto, non tutta la posta
      // conservata: è lo stesso insieme reale che apre il filtro omonimo.
      inboxService.count({ companyId: activeCompanyId, filter: 'to_handle' }),
      documentHubService.counts(activeCompanyId, false),
      taskService.list(activeCompanyId, { view: 'todo', limit: 1 }),
    ]).then(([inbox, documents, deadlines]) => {
      if (!current) return;
      setCounts({
        inbox: inbox.status === 'fulfilled' ? inbox.value : null,
        documents: documents.status === 'fulfilled'
          ? [...documents.value.values()].reduce((sum, n) => sum + n, 0)
          : null,
        deadlines: deadlines.status === 'fulfilled' ? deadlines.value.total : null,
      });
    });

    return () => { current = false; };
  }, [activeCompanyId, pathname]);

  return counts;
}
