// Utility di formattazione condivise. Il locale segue la LINGUA SCELTA
// dall'utente (it-CH · de-CH · fr-CH): le date svizzere si scrivono comunque
// gg.mm.aaaa, ma separatori e nomi dei mesi cambiano, e gli importi seguono la
// convenzione della lingua. Prima era fissato a it-CH per tutti.
import { getCurrentLocaleTag } from '@/i18n';
// ⚠️ IL RICONOSCITORE STA IN `calendarDays`, NON QUI: è il modulo nato per
// questo difetto, e scriverne una seconda copia sarebbe la quinta regex della
// data pura nel frontend. Il conto dei giorni e la formattazione sono due
// mestieri diversi sopra LA STESSA regola.
import { giornoLocale, sembraDataPura } from './calendarDays';

/**
 * La data, nella lingua scelta.
 *
 * ⚠️⚠️ UNA DATA PURA SI COSTRUISCE IN LOCALE. `new Date('2026-08-20')` è
 * mezzanotte UTC — è la norma per una data senza ora — e `toLocaleDateString`
 * la rilegge nel fuso di chi guarda: a ovest di Greenwich stampava il 19. In
 * Svizzera non si vede, ed è per questo che è rimasto qui mentre la stessa
 * famiglia veniva chiusa altrove il 2026-08-19. Le colonne `date` arrivano
 * proprio così, e la Panoramica ne formatta due (`dueDate`, `appointmentDate`).
 *
 * Un ISTANTE completo continua a passare da `new Date`: convertirlo al giorno
 * locale è ciò che si vuole, e `giornoLocale` non lo tocca.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  // ⚠️⚠️ E UNA DATA PURA CHE NON ESISTE NON DIVENTA UNA DATA PLAUSIBILE. Su
  // `'2026-02-31'` il parser di V8 rinuncia all'ISO, ripiega su quello
  // permissivo e restituisce il 3 MARZO: fin qui la funzione stampava
  // «03.03.2026», una data inventata dove il suo stesso commento promette «mai
  // una data di ripiego». Riconosciuta la forma, il verdetto è del calendario.
  const d = sembraDataPura(value) ? giornoLocale(value) : new Date(value);
  if (d === null || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(getCurrentLocaleTag(), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Data E ora, nella lingua scelta.
 *
 * Serve al Registro attività (0039), dove la sola data non basta: due
 * correzioni dello stesso pomeriggio sullo stesso campo sono due fatti
 * distinti, e un registro che non li distingue non è un registro. Stessa
 * disciplina di `formatDate`: valore assente o illeggibile dà «—», mai una data
 * di ripiego.
 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  // ⚠️ UNA DATA PURA NON HA UN'ORA, e qui non se ne inventa una. Oggi nessuno
  // gliene passa una — i quattro chiamanti hanno tutti un `timestamptz` — ma la
  // firma accetta `string` e il prossimo non ha modo di saperlo: `'2026-08-20'`
  // usciva «20.08.2026, 02:00» a Zurigo e «19.08.2026, 20:00» a New York, cioè
  // un orario inventato e per giunta il giorno sbagliato. Si mostra il giorno,
  // che è tutto ciò che il dato dice.
  if (sembraDataPura(value)) return formatDate(value);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(getCurrentLocaleTag(), {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * ⚠️⚠️ QUANDO LA VALUTA NON È NOTA NON SI SCRIVE «CHF»: si scrive il numero.
 *
 * Fino al 2026-07-29 questa funzione faceva `currency || 'CHF'`, e la scelta era
 * difendibile perché il validatore garantiva una valuta sempre presente —
 * mettendoci CHF d'ufficio. Tolta quella finzione a monte (`validate.ts`, dove
 * una valuta assente ora resta `null`), lasciarla qui la ricostruirebbe
 * nell'ultimo punto utile: a schermo, dove l'utente la legge come un fatto.
 *
 * È la stessa ragione per cui Finanze ha `formatDecimal` (`financeModel.ts`):
 * «1'240.00 CHF» su un documento in euro è credibile, sembra verificato, e
 * nessuno lo ricontrolla. §49 vieta di presumere i franchi perché il prodotto è
 * svizzero. La mancanza si mostra; è l'interfaccia a dire che manca.
 */
export function formatCurrency(amount: number | null | undefined, currency: string | null | undefined): string | null {
  if (amount == null) return null;
  const cur = String(currency ?? '').trim().toUpperCase();
  // ⚠️⚠️ `useGrouping: 'always'`, E IL DIFETTO SI VEDEVA SOLO IN ITALIANO.
  // Il default di Intl per l'italiano è il raggruppamento «min2»: il separatore
  // delle migliaia compare da CINQUE cifre in su. In una colonna di importi
  // usciva così, misurato il 2026-08-14 nelle Finanze:
  //
  //     CHF 23'450.80
  //     CHF 6712.40      ← stessa colonna, stessa valuta, altra forma
  //     CHF 3120.00
  //
  // Due modi di scrivere un franco a due righe di distanza, proprio dove i
  // numeri servono a essere confrontati. In de-CH e fr-CH il difetto NON
  // esiste — quelle lingue raggruppano da mille — quindi chi provava l'app in
  // tedesco non poteva vederlo, ed è la lingua di riferimento del prodotto ad
  // averlo. `'always'` allinea le tre lingue senza toccarne nessun'altra
  // regola: in de e fr il risultato è identico a prima.
  //
  // ⚠️ `true` e non la stringa `'always'` di Intl v3, benché siano la stessa
  // cosa (lo standard fa cadere il booleano su «always»): i tipi di TypeScript
  // in questo progetto dichiarano `useGrouping?: boolean`, e la stringa non
  // compila. Il booleano dice esattamente la stessa cosa, e per giunta lo dice
  // anche ai motori che precedono Intl v3.
  const raggruppa = { useGrouping: true } as const;
  if (!/^[A-Z]{3}$/.test(cur)) {
    return new Intl.NumberFormat(getCurrentLocaleTag(), {
      minimumFractionDigits: 2, maximumFractionDigits: 2, ...raggruppa,
    }).format(amount);
  }
  try {
    return new Intl.NumberFormat(getCurrentLocaleTag(), { style: 'currency', currency: cur, ...raggruppa }).format(amount);
  } catch {
    return `${cur} ${amount}`;
  }
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

// ⚠️⚠️ QUI C'ERA `daysUntil`, ED È STATA TOLTA IL 2026-08-24.
//
// Diceva `Math.ceil((d.getTime() - Date.now()) / 86400000)`, cioè confrontava
// due ISTANTI per rispondere a una domanda di CALENDARIO. Su una colonna
// `date` — e tutte quelle che la alimentavano lo erano — la sera a ovest di
// Greenwich ogni scadenza risultava un giorno in anticipo: `2026-08-25`
// rispondeva «0», «scade oggi», mentre mancava un giorno intero.
//
// La usavano `inboxService` (due volte) e `analysisService`, cioè il segno di
// urgenza della Posta e il filtro «Con scadenza vicina».
//
// Non è stata corretta: è stata TOLTA. Correggerla avrebbe lasciato il vero
// difetto in piedi — sei funzioni per la stessa domanda, tre sbagliate, e
// nessuna che sapesse delle altre. La risposta è una sola e sta in
// `_shared/calendarDays.ts` (`calendarDaysUntil`), dove ha il suo `today` come
// parametro e quindi si può provare su un fuso scelto.
//
// ⚠️ La guardia della sezione «UNA SOLA ARITMETICA DEI GIORNI» in
// `test:shell-unit` impedisce che ne rinasca una settima.
