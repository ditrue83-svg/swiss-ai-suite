// Logica condivisa del profilo di matching (subsidy-ai 1.0, usato da
// SubsidyPage).
//
// ⚠️ QUI VIVEVA ANCHE `collectPriorities`, la «Priorità di oggi» della
// Panoramica. La pagina disegnata dai numeri (censimento 2026-08-19) non ha
// un elenco misto di priorità: ha blocchi con conteggio, esempio e
// collegamento, e l'ordine dentro un blocco è quello di `list_tasks`. Le
// regole di non-duplicazione documento/attività/opportunità/pratica sono
// morte con lei — un elenco che non esiste non può duplicare niente — e i
// loro casi di prova sono stati rimossi con il codice che provavano.
import type { Company, CompanyProfile } from '@/types/models';
import type { MatchProfile } from '@/features/subsidy-ai/engine';

export function buildMatchProfile(company: Company | null, profile: CompanyProfile | null): MatchProfile {
  return {
    canton: company?.canton ?? null,
    sector: profile?.sector ?? null,
    employeeCount: profile?.employeeCount ?? null,
    projects: profile?.currentProjects ?? [],
  };
}
