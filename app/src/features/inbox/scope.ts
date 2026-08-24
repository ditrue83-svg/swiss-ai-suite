// ============================================================================
// L'AMBITO di una query di Inbox: che cosa significa ciascun filtro.
//
// PERCHÉ STA FUORI DAL SERVIZIO. Qui non si parla con nessuno: si dice soltanto
// che cosa vuol dire «Da gestire» o «Con scadenza vicina», e lo si dice UNA
// volta sola — per l'elenco, per il conteggio sul bottone e per la riga
// compressa. `inboxService` importa da qui e aggiunge l'unica cosa che questo
// file non sa fare: parlare col database.
//
// ⚠️ LA SEPARAZIONE HA UN MOTIVO OPERATIVO, non estetico. Il servizio importa
// `lib/supabase`, che legge `import.meta.env` e quindi esiste solo dentro Vite:
// finché la regola dei filtri viveva là, `test:inbox-unit` non poteva nemmeno
// caricarla — si fermava con «Cannot read properties of undefined (reading
// \'VITE_SUPABASE_URL\')». Una regola che nessun test può importare è una
// regola senza guardiano.
// ============================================================================
import { QUERY_COMPRESSI, QUERY_IN_EVIDENZA } from './emphasis';
// ⚠️ IL GIORNO LO DICE IL CALENDARIO, non questo file. `todayISO` legge il
// giorno di chi guarda lo schermo e `addDays` somma i giorni in UTC, dove
// durano tutti 86 400 secondi: comporre la data a mano qui significherebbe una
// seconda aritmetica del calendario accanto a quella che il prodotto ha già.
import { addDays, todayISO } from '@/features/calendar/calendarModel';
import type { InboxFilter } from '@/types/models';

/**
 * I cinque filtri, nell'ordine in cui la barra li mostra.
 *
 * Sta QUI e non nella schermata perché non è più solo un elenco da disegnare:
 * `counts()` ci itera sopra per contare ogni vista, e una barra che mostrasse
 * un filtro senza conteggio — o un conteggio senza filtro — sarebbe il modo in
 * cui i due si disallineano.
 */
export const INBOX_FILTERS: InboxFilter[] =
  ['all', 'to_handle', 'urgent', 'to_verify', 'handled', 'dismissed'];

/** «Urgenti»: scadenza già passata o entro questo numero di giorni. */
export const URGENT_WITHIN_DAYS = 30;

export interface InboxQuery {
  companyId: string;
  filter: InboxFilter;
  /**
   * Quale metà di «Tutte» si vuole: ciò che sta in evidenza o ciò che è
   * compresso in fondo. Assente = le due insieme, com'era prima della
   * divisione — ed è ancora la risposta giusta per gli altri filtri, che sono
   * una domanda esplicita dell'utente e non vanno riscritte da una regola di
   * presentazione.
   *
   * ⚠️ Le due metà sono un COMPLEMENTO, non due filtri indipendenti: insieme
   * danno esattamente l'elenco intero. Le espressioni stanno in
   * `features/inbox/emphasis.ts`, non qui, perché la stessa regola serve anche
   * al browser per decidere il peso di una riga.
   */
  emphasis?: 'in_evidence' | 'collapsed';
  /** Testo cercato su oggetto, mittente e anteprima. */
  search?: string | null;
  connectionId?: string | null;
  withAttachments?: boolean;
  /** Data ISO minima di ricezione. */
  since?: string | null;
  cursor?: string | null;
  pageSize?: number;
}

/** Le sole operazioni che servono a comporre l'ambito di una query di Inbox. */
interface AmbitoQuery {
  eq(column: string, value: unknown): AmbitoQuery;
  neq(column: string, value: unknown): AmbitoQuery;
  not(column: string, operator: string, value: unknown): AmbitoQuery;
  lte(column: string, value: unknown): AmbitoQuery;
  gte(column: string, value: unknown): AmbitoQuery;
  ilike(column: string, pattern: string): AmbitoQuery;
  or(filters: string): AmbitoQuery;
}

/**
 * Restringe una query all'ambito chiesto: filtro, metà di «Tutte», casella,
 * ricerca.
 *
 * Esiste perché lista e conteggio devono restringere ESATTAMENTE allo stesso
 * modo: se la riga compressa dicesse «72» e l'elenco che si apre ne mostrasse
 * 68, il numero non descriverebbe più l'insieme che promette. Un solo posto che
 * decide — e dal 2026-08-16 lo usano anche i cinque conteggi sui bottoni.
 *
 * ⚠️ IL DIFETTO CHE IL GUARDIANO ASPETTA. Lo switch qui sotto ha un ramo
 * `default`, quindi **non è mai esaustivo per TypeScript**: un filtro nuovo
 * aggiunto a `INBOX_FILTERS` — e perciò mostrato nella barra — cadrebbe lì e
 * prenderebbe l'ambito di «Tutte». Il bottone direbbe 148, il compilatore
 * resterebbe verde, e l'elenco che si apre sarebbe un altro.
 * `test:inbox-unit` esegue questa funzione con un costruttore FINTO e pretende
 * che i cinque filtri restringano in cinque modi diversi.
 */
export function applicaAmbito<Q>(builder: Q, query: InboxQuery): Q {
  let q = builder as unknown as AmbitoQuery;

  switch (query.filter) {
    case 'to_handle':
      q = q.eq('attention_status', 'needs_attention');
      break;
    case 'to_verify':
      q = q.eq('attention_status', 'to_verify');
      break;
    case 'urgent': {
      // «Urgente» qui significa una cosa sola e verificabile: l'analisi ha
      // trovato una scadenza, ed è passata o è vicina. Non è un punteggio.
      //
      // ⚠️ IL GIORNO È QUELLO LOCALE, come in tutto il resto del prodotto.
      // Prima la finestra si componeva con `toISOString().slice(0,10)`, che dà
      // il giorno UTC: a Zurigo fra mezzanotte e le 02:00 il conto era ancora
      // al giorno prima, e la finestra si spostava di un giorno intero — un
      // messaggio in scadenza spariva da «Urgenti» proprio nelle ore in cui
      // qualcuno apre la posta per controllare che non sia rimasto niente.
      const limit = addDays(todayISO(), URGENT_WITHIN_DAYS);
      q = q.not('analysis_deadline', 'is', null).lte('analysis_deadline', limit).neq('attention_status', 'handled');
      break;
    }
    case 'handled':
      q = q.eq('attention_status', 'handled');
      break;
    // ⚠️ FILTRO SUO, E NON INSIEME A «Messe via» (D-13, B4). «L'ho gestita» e
    // «non ci riguarda» sono due decisioni diverse, e un conteggio che le somma
    // risponde a una domanda che nessuno ha fatto. Serve anche a misurare
    // quanto il filtro dei domini (0043) sia tarato bene: molte ignorate a mano
    // vogliono dire che entra ancora rumore.
    case 'dismissed':
      q = q.eq('attention_status', 'dismissed');
      break;
    case 'all':
    default:
      // «Tutti» è la vista operativa: contiene tutto ciò che non è stato
      // messo via, comprese le comunicazioni giudicate non amministrative —
      // che restano visibili, perché un errore di classificazione non deve
      // essere irreversibile.
      //
      // ⚠️ Da D-13 esclude anche le IGNORATE, e la differenza con la riga
      // precedente è chi lo ha deciso: `ignored` è il giudizio della macchina e
      // resta in vista proprio perché può sbagliare; `dismissed` è la decisione
      // di una persona, e rimetterle sotto gli occhi ogni giorno significa non
      // averla presa sul serio. Restano in «Ignorate», e ne escono con un clic:
      // marcate, mai cancellate.
      q = q.not('attention_status', 'in', '(handled,dismissed)');
      if (query.emphasis === 'collapsed') {
        q = q.eq('attention_status', QUERY_COMPRESSI.eq.attention_status).or(QUERY_COMPRESSI.or);
      } else if (query.emphasis === 'in_evidence') {
        q = q.or(QUERY_IN_EVIDENZA.or);
      }
      break;
  }

  if (query.connectionId) q = q.eq('connection_id', query.connectionId);
  if (query.withAttachments) q = q.eq('has_attachments', true);
  if (query.since) q = q.gte('received_at', query.since);

  const search = (query.search ?? '').trim();
  if (search) {
    // `search_text` è la colonna generata dalla 0013, con indice trigram.
    // I caratteri jolly di LIKE vengono neutralizzati: `%` digitato da un
    // utente deve cercare un per cento, non «qualsiasi cosa».
    //
    // ⚠️⚠️ PRIMA SI TAGLIA, POI SI NEUTRALIZZA — e l'ordine è la correzione del
    // 2026-08-19. Al contrario, il taglio cadeva su una barra rovesciata appena
    // inserita e la lasciava spaiata: quella barra si mangiava il `%` di
    // CHIUSURA del pattern, cioè il jolly che rende la ricerca una ricerca.
    // Non usciva un errore — uscivano zero risultati su una ricerca che ne
    // aveva, che è il modo peggiore di sbagliare.
    //
    // ⚠️ E i 100 sono il limite di ciò che una persona ha DIGITATO, non della
    // stringa dopo l'escape: tagliare dopo faceva dipendere quanto testo si
    // cerca da quanti caratteri speciali contiene.
    const escaped = search.slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`);
    q = q.ilike('search_text', `%${escaped.toLowerCase()}%`);
  }

  return q as unknown as Q;
}
