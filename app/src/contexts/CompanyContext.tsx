// ============================================================================
// CompanyContext — quale azienda è attiva. Un utente PMI ne ha una sola, ma il
// modello è già multi-azienda (per il futuro "Cambia azienda" delle fiduciarie):
// NON si assume mai una singola company hardcoded.
// ============================================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { companyService } from '@/services/companyService';
import { toUserMessage } from '@/lib/errors';
import { useAuth } from './AuthContext';
import type { Company, CompanyMembership, CompanyProfile, MemberRole } from '@/types/models';

const ACTIVE_KEY = 'swissai.activeCompanyId'; // preferenza UI non sensibile

interface CompanyContextValue {
  loading: boolean;
  error: string | null;
  memberships: CompanyMembership[];
  activeCompany: Company | null;
  activeCompanyId: string | null;
  role: MemberRole | null;
  companyProfile: CompanyProfile | null;
  hasCompany: boolean;
  isAdmin: boolean;
  setActiveCompany: (id: string) => void;
  refresh: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue | undefined>(undefined);

function readStored(): string | null {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}
function writeStored(id: string | null) {
  try { id ? localStorage.setItem(ACTIVE_KEY, id) : localStorage.removeItem(ACTIVE_KEY); } catch { /* no-op */ }
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<CompanyMembership[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(readStored());
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);

  const loadMemberships = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const list = await companyService.listMemberships(user.id);
      setMemberships(list);
      setActiveCompanyId((prev) => {
        if (prev && list.some((m) => m.company.id === prev)) return prev;
        return list[0]?.company.id ?? null;
      });
    } catch (e) {
      setError(toUserMessage(e));
      setMemberships([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Ricarica le membership al cambio utente.
  useEffect(() => {
    if (!user) {
      setMemberships([]);
      setActiveCompanyId(null);
      setCompanyProfile(null);
      setLoading(false);
      return;
    }
    void loadMemberships();
  }, [user, loadMemberships]);

  // Persisti la scelta dell'azienda attiva.
  useEffect(() => {
    writeStored(activeCompanyId);
  }, [activeCompanyId]);

  const active = useMemo(
    () => memberships.find((m) => m.company.id === activeCompanyId) ?? null,
    [memberships, activeCompanyId],
  );

  const loadProfile = useCallback(async () => {
    if (!activeCompanyId) { setCompanyProfile(null); return; }
    try {
      setCompanyProfile(await companyService.getCompanyProfile(activeCompanyId));
    } catch {
      setCompanyProfile(null);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const value = useMemo<CompanyContextValue>(
    () => ({
      loading,
      error,
      memberships,
      activeCompany: active?.company ?? null,
      activeCompanyId,
      role: active?.role ?? null,
      companyProfile,
      hasCompany: memberships.length > 0,
      isAdmin: active?.role === 'owner' || active?.role === 'admin',
      setActiveCompany: (id: string) => setActiveCompanyId(id),
      refresh: loadMemberships,
      refreshProfile: loadProfile,
    }),
    [loading, error, memberships, active, activeCompanyId, companyProfile, loadMemberships, loadProfile],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany(): CompanyContextValue {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany deve essere usato dentro <CompanyProvider>');
  return ctx;
}
