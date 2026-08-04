// ============================================================================
// I globali di Deno, per il solo typecheck delle Edge Function.
//
// ⚠️⚠️ QUESTO FILE È INCLUSO SOLO DA `tsconfig.functions.json`, MAI DA QUELLO
// PRINCIPALE, e la ragione è tutta la differenza fra un controllo e una finta.
// `src/` gira nel browser e `scripts/` gira sotto Node: là dentro `Deno` NON
// esiste. Se questa dichiarazione fosse visibile anche a loro, scrivere
// `Deno.env.get(…)` in uno script Node passerebbe il typecheck e fallirebbe a
// runtime — il compilatore direbbe di sì a una cosa falsa.
//
// ⚠️ LA SUPERFICIE È MINIMA DI PROPOSITO: c'è dentro solo ciò che le funzioni
// usano davvero, misurato — `Deno.env.get` (19 punti) e `Deno.serve` (19).
// Dichiarare l'intera API di Deno sarebbe più comodo e peggiore: renderebbe
// verde l'uso di qualcosa che nessuno ha verificato esistere nella versione del
// runtime su cui giriamo. Quando servirà un'altra funzione, si aggiunge quella.
//
// ⚠️ CHE COSA QUESTO CONTROLLO NON PUÒ VEDERE, dichiarato perché non se ne
// deduca più di quel che c'è: `tsconfig.functions.json` non ha i tipi di Node
// (`"types": []`), quindi un globale di Node usato per sbaglio diventa rosso —
// ma il runtime resta quello di Supabase, e la sola prova che una funzione GIRA
// è eseguirla. Questo file rende visibili gli errori di FORMA, non quelli di
// ambiente.
// ============================================================================

declare namespace Deno {
  /** Le variabili d'ambiente. `get` torna `undefined` se la variabile non c'è. */
  export const env: {
    get(key: string): string | undefined;
  };

  /**
   * Il server HTTP di Deno.
   *
   * ⚠️ Il valore di ritorno è dichiarato `void` perché nessuna delle 19
   * funzioni lo usa. Dichiararlo come il server vero inviterebbe a usarlo
   * senza che nessuno abbia verificato quale sia la sua forma.
   */
  export function serve(
    handler: (req: Request) => Response | Promise<Response>,
  ): void;
}
