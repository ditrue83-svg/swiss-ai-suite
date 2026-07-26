import type { IconName } from '@/components/ui/Icon';
import type { TKey } from '@/i18n';

// Le voci portano una CHIAVE di traduzione, non un'etichetta già scritta:
// l'etichetta si risolve al render, così il menu cambia lingua all'istante.
export interface NavItem { id: string; labelKey: TKey; icon: IconName; path: string }
export interface NavSection { sectionKey: TKey }
export type NavEntry = NavItem | NavSection;

export const NAV: NavEntry[] = [
  { sectionKey: 'nav.sectionPlatform' },
  { id: 'home', labelKey: 'nav.home', icon: 'home', path: '/' },
  // Inbox sta subito dopo la panoramica: è il punto d'ingresso di ciò che
  // arriva, e viene prima delle scadenze, che sono ciò che ne deriva.
  { id: 'inbox', labelKey: 'nav.inbox', icon: 'inbox', path: '/inbox' },
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: 'dashboard', path: '/dashboard' },
  { id: 'deadlines', labelKey: 'nav.tasks', icon: 'calendar', path: '/scadenziario' },
  { sectionKey: 'nav.sectionModules' },
  { id: 'admin', labelKey: 'nav.adminAi', icon: 'document', path: '/admin' },
  { id: 'subsidy', labelKey: 'nav.subsidyAi', icon: 'banknote', path: '/subsidy' },
  { id: 'archive', labelKey: 'nav.archive', icon: 'archive', path: '/archivio' },
  { sectionKey: 'nav.sectionAccount' },
  { id: 'pricing', labelKey: 'nav.pricing', icon: 'tag', path: '/prezzi' },
];

export function isSection(e: NavEntry): e is NavSection {
  return (e as NavSection).sectionKey !== undefined;
}
