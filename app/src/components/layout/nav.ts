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
  { id: 'deadlines', labelKey: 'nav.tasks', icon: 'checkCircle', path: '/attivita' },
  // Il Calendario viene DOPO le Attività, e l'ordine è il racconto del prodotto:
  // prima che cosa c'è da fare, poi quando. L'icona del calendario passa qui —
  // la teneva Attività, ed era il nome sbagliato per il posto giusto.
  { id: 'calendar', labelKey: 'nav.calendar', icon: 'calendar', path: '/calendario' },
  { sectionKey: 'nav.sectionModules' },
  { id: 'admin', labelKey: 'nav.adminAi', icon: 'document', path: '/admin' },
  { id: 'subsidy', labelKey: 'nav.subsidyAi', icon: 'banknote', path: '/subsidy' },
  // I Documenti non sono un modulo accanto agli altri: sono la memoria su cui
  // gli altri lavorano. Restano però qui, in fondo ai moduli, perché spostare
  // il menu è un'altra decisione e non va presa di straforo insieme a questa.
  { id: 'documents', labelKey: 'nav.documents', icon: 'archive', path: '/documenti' },
  // L'Automazione è una sezione a sé e non una voce fra i moduli: i moduli
  // sono i posti in cui il lavoro sta, questa è la regola che lo muove. Sta
  // dopo tutti, perché è l'ultimo strato — si automatizza ciò che si è già
  // capito, organizzato e assegnato.
  { sectionKey: 'nav.sectionAutomation' },
  { id: 'automations', labelKey: 'nav.automations', icon: 'settings', path: '/automazioni' },
  { sectionKey: 'nav.sectionAccount' },
  { id: 'pricing', labelKey: 'nav.pricing', icon: 'tag', path: '/prezzi' },
];

export function isSection(e: NavEntry): e is NavSection {
  return (e as NavSection).sectionKey !== undefined;
}
