// ============================================================================
// IL DOMINIO AMMINISTRATIVO — la regola, PURA.
//
// A COSA SERVE. Dal 2026-08-23 un messaggio entra in `email_messages` soltanto
// se il suo mittente appartiene a un dominio dichiarato amministrativo. Non è
// un filtro di comodo: è la differenza fra una Inbox in cui scegliere e una in
// cui scartare. Misurato sulla casella vera il 2026-08-23: su 148 messaggi, i
// 22 in «Da gestire» venivano tutti da `stripe.com` e `mail.anthropic.com` —
// 22 su 22 da domini fornitore, zero da un dominio amministrativo.
//
// ⚠️⚠️ È UNA TABELLA CHIUSA, NON UN'INFERENZA. Nessuna parola cercata nel
// testo, nessun punteggio, nessuna euristica sulla forma del dominio: o il
// dominio è nell'elenco, o non entra. La ragione è la stessa delle
// `FORMULE_DI_CORTESIA` in `analysisTrust.ts`: una regola che indovina non si
// può né verificare né correggere, e sbaglia in silenzio. Questa si interroga
// (`select * from email_admin_domains`) e si corregge aggiungendo una riga.
//
// ⚠️ E L'ESCLUSIONE LASCIA TRACCIA. Un messaggio scartato non sparisce senza
// dire niente: il dominio finisce in `email_excluded_senders` con un contatore.
// Senza quel registro, «la lettera del nuovo assicuratore non è mai arrivata»
// sarebbe indistinguibile da «non l'hanno mandata» — che è il guasto silenzioso
// che questo progetto non ammette.
//
// ⚠️ PERCHÉ QUESTO FILE NON IMPORTA NIENTE. `sync.ts` tira dentro il client
// Supabase, gli adapter dei due provider e la pipeline di analisi: un banco
// offline non lo monta. La regola che decide chi entra deve poter diventare
// ROSSA senza rete, senza credenziali e senza credito, quindi vive qui da sola
// e `sync.ts` la chiama. È la stessa scelta di `ownershipReason.ts`.
// ============================================================================

/**
 * Il dominio di un indirizzo, normalizzato.
 *
 * ⚠️ SI PRENDE L'ULTIMA `@`, non la prima: `"a@b"@esempio.ch` è un indirizzo
 * legale, e spezzare sulla prima darebbe `b"@esempio.ch` — cioè un dominio che
 * non esiste, e quindi un'esclusione per il motivo sbagliato.
 *
 * Restituisce `null` quando non c'è un dominio da leggere: assente, vuoto,
 * senza `@`, o con la parte dopo l'ultima `@` vuota. `null` NON significa
 * «ammesso»: significa «non si sa», e chi chiama deve trattarlo come tale.
 */
export function dominioDi(email: string | null | undefined): string | null {
  const grezzo = String(email ?? '').trim();
  if (!grezzo) return null;
  const at = grezzo.lastIndexOf('@');
  if (at < 0) return null;
  const dominio = normalizzaDominio(grezzo.slice(at + 1));
  return dominio || null;
}

/**
 * La forma canonica di un dominio: minuscolo, senza spazi, senza il punto
 * finale della forma pienamente qualificata (`admin.ch.` e `admin.ch` sono lo
 * stesso dominio), senza parentesi angolari lasciate da un `From:` grezzo.
 *
 * ⚠️ Serve nei DUE versi — su ciò che arriva e su ciò che si scrive in
 * tabella — o l'elenco conterrebbe `Admin.CH` e il confronto fallirebbe su un
 * dominio che qualcuno crede di aver dichiarato.
 */
export function normalizzaDominio(valore: string | null | undefined): string {
  return String(valore ?? '')
    .trim()
    .replace(/^[<[]+|[>\]]+$/g, '')
    .replace(/\.+$/, '')
    .toLowerCase();
}

/**
 * Una riga dell'elenco è utilizzabile?
 *
 * ⚠️⚠️ ALMENO DUE ETICHETTE, E NON È PEDANTERIA: una riga `ch` farebbe passare
 * l'intera Svizzera, cioè trasformerebbe la tabella chiusa in nessun filtro,
 * e lo farebbe in silenzio. Un elenco che può contenere la propria negazione
 * non è un elenco chiuso. Vale anche per il vincolo SQL della 0043: qui e là,
 * la stessa regola.
 */
export function dominioUtilizzabile(valore: string | null | undefined): boolean {
  const d = normalizzaDominio(valore);
  if (!d) return false;
  if (d.includes('@') || /\s/.test(d)) return false;
  const etichette = d.split('.');
  if (etichette.length < 2) return false;
  return etichette.every((e) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(e));
}

export interface EsitoAmmissione {
  /** il messaggio entra in `email_messages` */
  ammesso: boolean;
  /** il dominio letto dal mittente, normalizzato. `null` = non leggibile. */
  dominio: string | null;
  /**
   * La riga dell'elenco che ha ammesso il messaggio — non il dominio del
   * mittente. ⚠️ Sono cose diverse e la differenza è tutto il valore del
   * registro: `bj.admin.ch` entra PER `admin.ch`, e chi legge deve poter
   * risalire alla riga da togliere se un giorno quella regola fosse sbagliata.
   */
  regola: string | null;
}

/**
 * Il messaggio entra?
 *
 * LA REGOLA DI CORRISPONDENZA, e le due trappole che evita:
 *   · corrispondenza ESATTA (`admin.ch` ammette `admin.ch`);
 *   · oppure SOTTODOMINIO, cioè il dominio finisce con `.` + la riga
 *     (`admin.ch` ammette `bj.admin.ch`, `estv.admin.ch`).
 *
 * ⚠️ NON basta `endsWith`: `notadmin.ch` finisce per `admin.ch` e NON deve
 * entrare. Il punto separatore è la regola, non un dettaglio.
 * ⚠️ E non basta `includes`: `admin.ch.esempio.com` contiene `admin.ch` ed è
 * un dominio di tutt'altro proprietario — è il modo classico di farsi passare
 * per qualcun altro.
 *
 * ⚠️ ELENCO VUOTO ⇒ NIENTE PASSA, ed è deliberato: è la definizione di elenco
 * chiuso. Ma un elenco vuoto è quasi sempre una CONFIGURAZIONE MANCANTE, non
 * una decisione, e chi chiama deve distinguerla — vedi `elencoConfigurato()`.
 * Qui non si indovina: si risponde alla domanda che è stata posta.
 */
export function ammetti(
  senderEmail: string | null | undefined,
  elenco: readonly string[],
): EsitoAmmissione {
  const dominio = dominioDi(senderEmail);
  if (!dominio) return { ammesso: false, dominio: null, regola: null };

  for (const grezza of elenco) {
    const riga = normalizzaDominio(grezza);
    // ⚠️ Una riga inutilizzabile viene SALTATA, non fatta valere: se `ch`
    // finisse in tabella per errore, deve restare inerte invece di aprire
    // tutto. Il vincolo SQL dovrebbe impedirlo; questa è la seconda serratura.
    if (!dominioUtilizzabile(riga)) continue;
    if (dominio === riga || dominio.endsWith(`.${riga}`)) {
      return { ammesso: true, dominio, regola: riga };
    }
  }
  return { ammesso: false, dominio, regola: null };
}

/**
 * L'elenco è stato configurato?
 *
 * ⚠️ SERVE A NON CONFONDERE DUE COSE OPPOSTE. «Nessun dominio dichiarato» e
 * «nessun dominio corrisponde» portano entrambi a zero messaggi acquisiti, ma
 * il primo è un guasto di configurazione — la migrazione non applicata, il
 * catalogo svuotato — e il secondo è il filtro che lavora. Trattarli allo
 * stesso modo significherebbe far sparire una casella intera senza che nessuno
 * abbia un errore da leggere: il fallback silenzioso, esattamente.
 */
export function elencoConfigurato(elenco: readonly string[]): boolean {
  return elenco.some((d) => dominioUtilizzabile(d));
}
