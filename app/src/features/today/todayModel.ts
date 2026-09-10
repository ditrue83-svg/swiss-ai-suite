// ============================================================================
// Oggi — il modello puro della home da mobilità (Fase 3.1, 2026-09-10).
//
// La pagina `/oggi` risponde a tre domande di chi è in giro: cosa scade oggi,
// quale trattativa aspetta un prossimo passo, che numero ha questo cliente.
// Qui sta la parte che si può provare SENZA lo schermo: quale telefono si
// offre, e in che ordine stanno le trattative. La resa a video sta in
// `TodayPage.tsx`; il confine fra i due file è la stessa regola di
// `overviewBlocks.ts` per la Panoramica.
// ============================================================================
import { calendarDaysUntil } from '@/lib/calendarDays';
import type { CrmOpportunity, CrmPerson } from '@/types/models';

export interface TelefonoScelto {
  /** Il numero com'è registrato: `tel:` lo compone così com'è scritto. */
  value: string;
  /** La persona a cui appartiene — sapere CHI si chiama conta quanto il numero. */
  personName: string;
}

/**
 * Il numero da offrire per «chiama un cliente»: il primo telefono (fisso o
 * mobile) trovato, con il referente PRIMARIO davanti agli altri. L'organizzazione
 * non ha un telefono proprio — il dato vive sulle persone (`crm_contact_methods`),
 * e inventare un campo a livello organizzazione per questa pagina sarebbe un
 * secondo posto in cui tenere lo stesso numero.
 */
export function scegliTelefono(people: CrmPerson[]): TelefonoScelto | null {
  const ordinate = [...people].sort((a, b) => {
    const ap = a.organizations[0]?.isPrimary ? 0 : 1;
    const bp = b.organizations[0]?.isPrimary ? 0 : 1;
    return ap - bp;
  });
  for (const p of ordinate) {
    if (p.contact.archivedAt) continue;
    const tel = p.methods.find((m) => m.type === 'phone' || m.type === 'mobile');
    if (tel) return { value: tel.value, personName: p.contact.displayName };
  }
  return null;
}

/** Vero se il prossimo passo è scritto e la sua data è già passata. */
export function passoInRitardo(opp: CrmOpportunity): boolean {
  if (!opp.nextStep || !opp.nextStepDueDate) return false;
  const giorni = calendarDaysUntil(opp.nextStepDueDate);
  return giorni !== null && giorni < 0;
}

/**
 * Le trattative che chiedono un prossimo passo, nell'ordine in cui una
 * persona le lavorerebbe: prima quelle con il passo SCADUTO (dalla data più
 * lontana), poi quelle senza passo affatto — a parità, la toccata meno di
 * recente, perché è quella che sta fermandosi.
 *
 * Le due liste del servizio (`onlyOverdueNextStep` e `onlyWithoutNextStep`
 * sono due bandiere separate della RPC) si fondono QUI: una trattativa non
 * può stare in entrambe — chi ha il passo scaduto il passo ce l'ha — ma la
 * fusione toglie il dubbio invece di appoggiarsi a una proprietà implicita.
 */
export function fondeInAttesa(
  scadute: CrmOpportunity[],
  senzaPasso: CrmOpportunity[],
): CrmOpportunity[] {
  const viste = new Set<string>();
  const tutte = [...scadute, ...senzaPasso].filter((o) => {
    if (viste.has(o.id)) return false;
    viste.add(o.id);
    return true;
  });
  return tutte.sort((a, b) => {
    const ra = passoInRitardo(a) ? 0 : 1;
    const rb = passoInRitardo(b) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    if (ra === 0) {
      // Fra le scadute conta la data del passo, non l'ultima modifica.
      const da = a.nextStepDueDate ?? '';
      const db = b.nextStepDueDate ?? '';
      if (da !== db) return da < db ? -1 : 1;
    }
    return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0;
  });
}

/**
 * Unisce ciò che era già scritto con ciò che arriva dalla dettatura: UNO
 * spazio fra le due parti, mai doppio, mai in testa. La Web Speech API
 * restituisce frammenti che cominciano e finiscono alla cieca (« la chiamata
 * », «ho parlato»): chi detta non deve poi ripulire gli spazi a mano, e chi
 * aveva già scritto non deve trovarsi le parole incollate.
 * Il testo dettato resta EDITABILE: questa funzione decide solo gli spazi.
 */
export function unisciDettatura(base: string, aggiunta: string): string {
  if (!aggiunta) return base;
  const a = base.replace(/\s+$/, '');
  const b = aggiunta.replace(/^\s+/, '');
  return a ? `${a} ${b}` : b;
}
