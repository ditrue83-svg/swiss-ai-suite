export type CompanyUsageKind = 'unclassified' | 'live' | 'demo' | 'technical';

/**
 * Un invio esterno è permesso solo dopo una scelta esplicita del titolare.
 * `unclassified` non è un sinonimo prudente di `live`: è una domanda ancora
 * senza risposta, quindi non autorizza un effetto fuori da AI-Swisse.
 */
export function canContactExternal(kind: unknown): kind is 'live' {
  return kind === 'live';
}

