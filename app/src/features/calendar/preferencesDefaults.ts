// ============================================================================
// I valori predefiniti delle preferenze di notifica, senza dipendenze.
//
// Stanno in un modulo PROPRIO e non dentro `notificationService` per una
// ragione pratica: il service importa il client Supabase, che a sua volta legge
// le variabili d'ambiente di Vite e non esiste fuori dal browser. I test
// offline devono poter verificare che questi default coincidano con quelli
// dichiarati dalla migrazione 0018 — ed è proprio il genere di divergenza che
// non produce alcun sintomo finché qualcuno non si accorge di ricevere email
// che non aveva chiesto.
//
// La duplicazione con il database è deliberata: la riga delle preferenze può
// legittimamente non esistere — nessuno è obbligato ad aprire le impostazioni
// prima di ricevere il primo promemoria — e la schermata deve poter mostrare
// uno stato vero senza prima scrivere. Un test verifica che le copie
// coincidano.
// ============================================================================
import type { NotificationPreferences } from '@/types/models';

/** Il fuso predefinito. Un DEFAULT, non una costante di dominio (§35). */
export const DEFAULT_TIMEZONE = 'Europe/Zurich';

/**
 * I fusi offerti nell'elenco.
 *
 * Non tutti quelli del mondo: quelli che un'azienda svizzera usa davvero. Sono
 * identificativi IANA e non scostamenti: `Europe/Zurich` sa dell'ora legale,
 * `UTC+1` no.
 */
export const TIMEZONE_CHOICES = [
  'Europe/Zurich', 'Europe/Rome', 'Europe/Berlin', 'Europe/Paris', 'Europe/London', 'UTC',
];

export function defaultPreferences(
  companyId: string, userId: string, locale: string,
): NotificationPreferences {
  return {
    companyId, userId,
    // In-app acceso, email SPENTA. L'email esce dal prodotto e richiede una
    // scelta esplicita: accenderla per impostazione predefinita significherebbe
    // decidere al posto di qualcuno.
    inAppEnabled: true, emailEnabled: false,
    remind7Days: true, remind1Day: true, remindDueDay: true, remindOverdue: true,
    timezone: DEFAULT_TIMEZONE, locale, showTaskTitle: true,
  };
}
