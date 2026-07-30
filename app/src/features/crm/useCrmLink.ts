// ============================================================================
// useCrmLink — «questo elemento è collegato a una controparte?»
//
// Un hook e non quattro copie dello stesso useEffect. Inbox, Documenti,
// Contratti e Finanze fanno lo stesso gesto su quattro tabelle diverse, e la
// parte che si può sbagliare è sempre la stessa: rileggere dopo aver scritto.
//
// ⚠️ RILEGGE SEMPRE dopo un collegamento. Non aggiorna lo stato a mano con l'id
// che ha appena mandato: i guardiani della 0026 possono rifiutare (azienda
// diversa, opportunità di un'altra controparte) e in quel caso lo stato locale
// racconterebbe un collegamento che il database non ha. È la stessa disciplina
// dello storico delle Attività, che va riletto perché lo scrivono i trigger.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { crmService } from '@/services/crmService';

/** Su quale entità del prodotto si sta lavorando. */
export type CrmLinkKind = 'email' | 'document' | 'contract' | 'finance';

interface Linked { id: string; displayName: string }

export interface CrmLinkState {
  linked: Linked | null;
  loading: boolean;
  error: string | null;
  link: (organizationId: string) => Promise<void>;
  unlink: () => Promise<void>;
}

export function useCrmLink(
  kind: CrmLinkKind,
  companyId: string | null | undefined,
  entityId: string | null | undefined,
): CrmLinkState {
  const [linked, setLinked] = useState<Linked | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    if (!companyId || !entityId) { setLinked(null); return; }
    setLoading(true);
    setError(null);
    try {
      const found = kind === 'email'
        ? await crmService.emailOrganization(companyId, entityId)
        : kind === 'document'
          ? await crmService.documentOrganization(companyId, entityId)
          : kind === 'contract'
            ? await crmService.contractOrganization(companyId, entityId)
            : await crmService.financeOrganization(companyId, entityId);
      setLinked(found);
    } catch (e) {
      // ⚠️ Un collegamento che non si riesce a LEGGERE non diventa «non
      // collegato»: sarebbe un guasto travestito da stato legittimo, e il
      // riquadro offrirebbe di collegare qualcosa che è già collegato. Si
      // dichiara l'errore e si lascia `linked` com'era.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [kind, companyId, entityId]);

  useEffect(() => { void read(); }, [read]);

  const link = useCallback(async (organizationId: string) => {
    if (!companyId || !entityId) return;
    if (kind === 'email') await crmService.linkEmail(companyId, organizationId, entityId);
    else if (kind === 'document') await crmService.linkDocument(companyId, organizationId, entityId);
    else if (kind === 'contract') await crmService.linkContract(entityId, organizationId);
    else await crmService.linkFinanceItem(entityId, organizationId);
    await read();
  }, [kind, companyId, entityId, read]);

  const unlink = useCallback(async () => {
    if (!companyId || !entityId || !linked) return;
    // ⚠️ Scollegare azzera UNA colonna e cancella UNA riga di collegamento.
    // Non tocca `contracts.counterparty_name`, non tocca
    // `finance_items.eff_supplier_name`, non tocca `email_messages`: il nome che
    // il documento dice resta quello che il documento dice (§26, §188, §189).
    if (kind === 'email') await crmService.unlinkEmail(linked.id, entityId);
    else if (kind === 'document') await crmService.unlinkDocument(linked.id, entityId);
    else if (kind === 'contract') await crmService.linkContract(entityId, null);
    else await crmService.linkFinanceItem(entityId, null);
    await read();
  }, [kind, companyId, entityId, linked, read]);

  return { linked, loading, error, link, unlink };
}
