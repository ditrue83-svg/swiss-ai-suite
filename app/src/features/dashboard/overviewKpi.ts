// ============================================================================
// I KPI DELLA PANORAMICA — il modulo PURO dietro la striscia di testata
// (restyling 2026-08-26, modello Lovable). Stessa disciplina di
// `overviewBlocks.ts`: nessun client, nessuna data «di sistema» — tutto entra
// per argomento, così uno script di prova può rompere ogni regola.
//
// LA REGOLA CHE VALE PER OGNI NUMERO QUI DENTRO: un KPI che non ha il dato
// non mostra un numero inventato — restituisce `null` e la schermata dice
// perché. È il principio 6 del prodotto («mai inventare importi, date,
// requisiti») applicato alla striscia più in vista della pagina.
// ============================================================================

/** Ciò che serve di una riga-data per sommare gli importi: mai l'oggetto intero. */
export interface RigaImporto {
  kind: string | null;
  deadline: string | null;
  amount: number | null;
  amountCurrency: string | null;
}

export interface ImportiInScadenza {
  /** Quante scadenze (termini) cadono nella finestra, con o senza importo. */
  nScadenze: number;
  /** Su quante di queste un importo è stato estratto. */
  nConImporto: number;
  /**
   * La somma, o `null` quando non è onesta: nessun importo estratto, valute
   * miste, o un importo senza valuta dichiarata. Una somma CHF+EUR scritta
   * «CHF» è la bugia esatta che questa pagina combatte — meglio la didascalia
   * che dice perché il numero non c'è.
   */
  totale: number | null;
  /** La valuta della somma (uguale per tutte le righe sommate), altrove null. */
  valuta: string | null;
  /** true se fra gli importi c'è una valuta mancante o diversa dalle altre. */
  valuteMiste: boolean;
}

/**
 * GLI IMPORTI IN SCADENZA — la somma dei SOLI termini (`kind === 'term'`):
 * un appuntamento o una data di riferimento non chiedono soldi, e sommarli
 * gonfierebbe il numero più grande della pagina.
 *
 * ⚠️ LA FINESTRA INCLUDE LE SCADUTE: un termine passato e non evaso resta
 * dovuto — escluderlo farebbe SCENDERE il totale proprio quando il rischio
 * sale. La didascalia dice «entro N giorni, scadute incluse».
 *
 * ⚠️ IL CONFRONTO È LESSICALE su `YYYY-MM-DD`, come in `splitOpenTasks`: è il
 * confronto di date di calendario, senza fusi né istanti.
 */
export function importiInScadenza(
  righe: readonly RigaImporto[],
  oggi: string,
  giorni = 30,
): ImportiInScadenza {
  const limite = new Date(`${oggi}T12:00:00`);
  limite.setDate(limite.getDate() + giorni);
  const entro = limite.toISOString().slice(0, 10);

  const termini = righe.filter((r) => r.kind === 'term' && r.deadline !== null && r.deadline <= entro);
  const conImporto = termini.filter((r) => r.amount !== null);

  const valute = new Set(conImporto.map((r) => r.amountCurrency));
  const valuteMiste = valute.size > 1 || valute.has(null);
  const sommabile = conImporto.length > 0 && !valuteMiste;

  return {
    nScadenze: termini.length,
    nConImporto: conImporto.length,
    totale: sommabile ? conImporto.reduce((a, r) => a + (r.amount as number), 0) : null,
    valuta: sommabile ? (conImporto[0]!.amountCurrency as string) : null,
    valuteMiste,
  };
}

/**
 * LA SERIE SETTIMANALE delle analisi, per la sparkline: `settimane` contenitori
 * da sette giorni, dal più vecchio al più recente (l'ultimo è la settimana in
 * corso). Il riferimento entra da fuori: una funzione che chiama `Date.now()`
 * da sé non si può provare su una serie nota.
 */
export function serieSettimanale(
  timestamps: readonly string[],
  settimane: number,
  riferimento: Date,
): number[] {
  const contenitori = new Array<number>(settimane).fill(0);
  const ref = riferimento.getTime();
  for (const ts of timestamps) {
    const t = new Date(ts).getTime();
    if (Number.isNaN(t) || t > ref) continue;
    const indietro = Math.floor((ref - t) / (7 * 86_400_000));
    if (indietro >= settimane) continue;
    contenitori[settimane - 1 - indietro]!++;
  }
  return contenitori;
}

/**
 * IL TREND «vs settimana scorsa», in percentuale INTERA. `null` quando non è
 * onesto: settimana scorsa a zero (la percentuale non esiste — «+∞%» non si
 * scrive), o serie troppo corta. La schermata mostra il segno solo col numero.
 */
export function trendPercentuale(serie: readonly number[]): number | null {
  if (serie.length < 2) return null;
  const prima = serie[serie.length - 2]!;
  const dopo = serie[serie.length - 1]!;
  if (prima === 0) return null;
  return Math.round(((dopo - prima) / prima) * 100);
}
