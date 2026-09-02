// ============================================================================
// LA DECISIONE DELLE GUARDIE, come funzione PURA.
//
// ⚠️ IL DIFETTO CHE QUESTO FILE ESISTE PER CHIUDERE, riprodotto il 2026-07-30:
// aprendo una rotta profonda a freddo si finiva sulla Panoramica. Non
// era lo strumento — la nota in memoria che lo sosteneva era sbagliata, e la
// prova è che `performance.getEntriesByType('navigation')[0].name` diceva
// la rotta richiesta mentre `location.pathname` diceva `/`: il documento profondo era
// stato caricato davvero, ed è l'applicazione ad averlo abbandonato.
//
// LA CORSA, in tre battute:
//   1. `CompanyProvider` monta con `loading: true`, ma il suo effetto parte
//      SUBITO con `user` ancora `null` (la sessione non è risolta) e prende il
//      ramo «nessun utente», che chiama `setLoading(false)` con zero aziende.
//   2. Un istante dopo la sessione arriva: `RequireAuth` smette di mostrare il
//      caricamento e monta `RequireCompany`, che legge `loading: false` e
//      `hasCompany: false` — e conclude «questa persona non ha un'azienda».
//      Manda all'onboarding.
//   3. L'onboarding vede arrivare le aziende e rimbalza alla Panoramica.
//      Il percorso profondo, e la sua query, sono persi per strada.
//
// ⚠️ LA CAUSA VERA, ed è la stessa forma di difetto che questo progetto insegue
//    da mesi: `loading: false` NON significa «ho guardato», significa «non sto
//    guardando adesso». Sono due cose diverse, e confonderle produce una
//    risposta sicura basata su un dato che non è mai stato letto — come la coda
//    dell'Inbox che si sarebbe svuotata senza analizzare niente, e come i
//    permessi di colonna che sembravano restringere. Qui serve un terzo stato:
//    «abbiamo letto le aziende DI QUESTO utente», che è `ready`.
//
// Sta in un file suo, e puro, perché una guardia si può sbagliare in silenzio:
// non lancia, non colora niente di rosso, manda solo nel posto sbagliato. È
// esattamente il tipo di errore che si vede aprendo l'app e non rileggendola —
// e che un test offline può invece bloccare per sempre.
// ============================================================================

/** Dove la coppia di guardie manda chi arriva. */
export type GateState =
  /** Non lo sappiamo ancora: si aspetta, non si decide. */
  | 'loading'
  /** Nessuna sessione: all'accesso, conservando la rotta richiesta. */
  | 'login'
  /** Sessione valida, nessuna azienda: all'onboarding. */
  | 'onboarding'
  /** Le aziende non si sono potute leggere: si dichiara, non si indovina. */
  | 'error'
  /** Tutto a posto: la rotta richiesta. */
  | 'app';

export interface GateInput {
  /** `AuthContext` sta ancora risolvendo la sessione. */
  authLoading: boolean;
  hasSession: boolean;
  /**
   * ⚠️ IL CAMPO CHE MANCAVA. Vero solo quando le aziende sono state lette per
   * l'utente ATTUALE. Diverso da `!companyLoading`: prima che la sessione
   * arrivi non si sta caricando nulla, e non si sa nulla.
   */
  companyReady: boolean;
  /** C'è una lettura in corso adesso (un `refresh`, per esempio). */
  companyLoading: boolean;
  hasCompany: boolean;
  companyError: string | null;
}

export function routeGate(i: GateInput): GateState {
  if (i.authLoading) return 'loading';
  if (!i.hasSession) return 'login';

  // ⚠️ SI ASPETTA finché non abbiamo letto davvero, e non si manda
  //    all'onboarding «per intanto». Un reindirizzamento è irreversibile per
  //    l'indirizzo: la rotta profonda e la sua query non tornano più.
  //
  // ⚠️ Ma NON si aspetta quando un'azienda c'è già: su `companyLoading` e
  //    basta, ogni `refresh()` del contesto smontava l'intera app — sidebar
  //    compresa — e ogni schermata perdeva il proprio stato locale (visto nelle
  //    impostazioni azienda il 2026-07-28). Le due condizioni convivono.
  if (!i.companyReady && !i.hasCompany) return 'loading';

  if (i.companyError) return 'error';
  if (!i.hasCompany) return 'onboarding';
  return 'app';
}
