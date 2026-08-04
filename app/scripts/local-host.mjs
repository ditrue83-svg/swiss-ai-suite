// ============================================================================
// «Questo host è la macchina di sviluppo?» — la regola, in un posto solo.
//
// ⚠️⚠️ PERCHÉ ESISTE QUESTO FILE. La stessa espressione stava scritta due volte,
// in `check-auth-config.mjs` e in `run-test-suite.mjs`, e le due copie ERANO
// GIÀ DIVERSE: una aveva l'ancora finale e il flag `i`, l'altra nessuno dei due.
// Nella pratica non cambiava l'esito — `new URL(…).hostname` restituisce l'host
// già in minuscolo, quindi la `i` non serviva, e l'ancora mancante sbagliava
// dalla parte prudente — ma è esattamente la forma di difetto che questo
// repository sorveglia altrove (`test:crm-unit` esiste per confrontare l'elenco
// dei domini pubblici fra SQL e TypeScript, perché due copie divergono e nessuno
// se ne accorge). Due copie di una regola non sono una regola: sono due.
//
// Chi cambia la regola la cambia qui, e cambia per tutti.
// ============================================================================

/**
 * Gli host che sono «la mia macchina», scritti per intero e ancorati.
 *
 * ⚠️ L'ancora `$` c'è di proposito: senza, `localhost.esempio.ch` — un dominio
 * vero, di qualcun altro — verrebbe scambiato per la macchina locale.
 * ⚠️ Il flag `i` c'è per chi la usa su una stringa che NON è passata da `new
 * URL()`: là dentro l'host è già normalizzato in minuscolo, ma questa costante
 * non può sapere da dove le arriva ciò che le viene dato.
 */
export const LOCALE_RE = /^(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)$/i;

/**
 * `true` se l'URL punta alla macchina di sviluppo; `null` se non è un URL.
 *
 * ⚠️ Torna `null` e non `false` su un URL malformato, e la distinzione conta:
 * «non è locale» e «non riesco a leggerlo» sono due risposte diverse, e chi
 * chiama deve poterle trattare diversamente invece di ricevere un `false`
 * rassicurante da una stringa che non si è nemmeno riusciti a interpretare.
 */
export function isLocale(url) {
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  return LOCALE_RE.test(host);
}
