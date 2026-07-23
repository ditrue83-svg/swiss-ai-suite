import type { IconName } from '@/components/ui/Icon';

export interface NavItem { id: string; label: string; icon: IconName; path: string }
export interface NavSection { section: string }
export type NavEntry = NavItem | NavSection;

export const NAV: NavEntry[] = [
  { section: 'Piattaforma' },
  { id: 'home', label: 'Panoramica', icon: 'home', path: '/' },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', path: '/dashboard' },
  { id: 'deadlines', label: 'Scadenziario', icon: 'calendar', path: '/scadenziario' },
  { section: 'Moduli' },
  { id: 'admin', label: 'Admin AI — Documenti', icon: 'document', path: '/admin' },
  { id: 'subsidy', label: 'Subsidy AI — Incentivi', icon: 'banknote', path: '/subsidy' },
  { id: 'archive', label: 'Archivio documenti', icon: 'archive', path: '/archivio' },
  { section: 'Account' },
  { id: 'pricing', label: 'Piani e prezzi', icon: 'tag', path: '/prezzi' },
];

export function isSection(e: NavEntry): e is NavSection {
  return (e as NavSection).section !== undefined;
}
