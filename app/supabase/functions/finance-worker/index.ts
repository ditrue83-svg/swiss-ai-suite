// ============================================================================
// Edge Function: finance-worker — il lettore della coda di Finance.
//
// Lo chiama uno SCHEDULER, non una persona. Autenticato con un segreto
// confrontato a tempo costante: non è un endpoint pubblico per definizione come
// un webhook, ma è raggiungibile, e un'esecuzione forzata da un estraneo
// consumerebbe la quota AI di un'azienda e riscriverebbe i verbali delle sue
// fatture.
//
// ⚠️ NON DIPENDE DAL BROWSER. Nessun `setInterval` da nessuna parte nel
// frontend: una fattura che viene letta solo mentre qualcuno tiene AI-Swisse
// aperto non è un'automazione, è una cosa che succede a chi stava già
// guardando.
//
// ⚠️ IL BUDGET DI TEMPO È LA LEZIONE PIÙ CARA DEL PROGETTO.
// Supabase chiude la richiesta a 150 secondi e uccide l'isolate: il `finally`
// NON gira. Il worker controlla il tempo PRIMA di prendere in carico ogni
// elemento, e ciò che resta è lavoro della prossima esecuzione — che arriva fra
// pochi minuti. Quello che è stato preso in carico e non finito lo recupera il
// meccanismo degli interrotti.
//
// ⚠️ QUESTA FUNZIONE NON MUOVE DENARO, E NON PUÒ FARLO.
// Legge documenti e scrive verbali. Non esiste qui — né altrove nel modulo — un
// percorso che trasformi un IBAN in un ordine di pagamento, che generi un file
// di pagamento o che chiami una banca. Un IBAN si mostra, non si esegue.
//
// COSA RESTITUISCE: numeri e codici, non testi. Nel rapporto non compaiono
// IBAN, riferimenti, nomi di fornitori né importi (§168).
// ============================================================================
import Anthropic from 'npm:@anthropic-ai/sdk';
import { timingSafeEqual } from '../_shared/email/crypto.ts';
import { EDGE_TIME_BUDGET_MS } from '../_shared/finance/contract.ts';
// ⚠️ Si riusano i mattoni di runtime del motore delle automazioni invece di
// scriverne una terza copia: `adminClient`, `json` e `failure` non hanno nulla
// di specifico di quel modulo, e il precedente è già nel progetto —
// `notifications-worker` usa il runtime del calendario per la stessa ragione.
// Il client che ne esce ha esattamente la forma dichiarata da
// `_shared/finance/store.ts`, quindi non serve alcuna conversione.
import { adminClient, CORS, env, failure, json, logEvent } from '../_shared/automation/runtime.ts';
import {
  emptyFinanceReport, runFinanceWorker,
  type FinanceCreateMessage, type FinanceModelMessage,
} from '../_shared/finance/process.ts';

/**
 * Il client AI. `null` quando la chiave non è configurata: in quel caso la
 * lettura deterministica gira lo stesso e ciò che manca resta dichiarato come
 * mancante — non si finge un'estrazione riuscita.
 */
function aiCreateMessage(): FinanceCreateMessage | null {
  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  const anthropic = new Anthropic({ apiKey });
  return ((request: unknown) =>
    anthropic.messages.create(request as never) as Promise<FinanceModelMessage>
  ) as FinanceCreateMessage;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);

  // Senza segreto configurato la funzione non è utilizzabile: 503, e non 403 —
  // «non sono pronto» e «non sei tu» sono due cose diverse, e chi mette in
  // esercizio il prodotto deve poterle distinguere.
  const expected = env('FINANCE_WORKER_SECRET');
  if (!expected) return failure('CONFIG_MISSING', 503);
  const provided = req.headers.get('x-finance-worker-secret') ?? '';
  if (!timingSafeEqual(provided, expected)) return failure('FORBIDDEN', 403);

  const deadline = Date.now() + EDGE_TIME_BUDGET_MS;
  let report = emptyFinanceReport();

  try {
    report = await runFinanceWorker({
      sb: adminClient(),
      createMessage: aiCreateMessage(),
      // §42 — i testi che il modello scrive seguono la lingua dell'applicazione.
      // Finché non esiste una preferenza per azienda, l'italiano è la lingua
      // dichiarata del prodotto, non un ripiego silenzioso.
      outputLanguage: 'it',
      deadlineMs: deadline,
    });
  } catch (error) {
    const code = codeOf(error);
    // ⚠️ Solo il codice: un messaggio del database può contenere il valore che
    // ha violato un vincolo, e in questo modulo quel valore è un IBAN.
    logEvent('finance-worker', { code, phase: 'drain' });
    return json({ status: 'failed', code, report }, 500);
  }

  // ⚠️ Solo conteggi e bandiere: nel rapporto non entra nulla che descriva un
  // documento, un fornitore o un pagamento.
  logEvent('finance-worker', { ...report });
  return json({ status: 'ok', report });
});

/** Il codice tecnico, mai il messaggio: un messaggio può contenere dati. */
function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('CONFIG_MISSING')) return 'CONFIG_MISSING';
  // Solo la prima parola, e solo se è un identificatore: basta a distinguere i
  // casi nei log senza rischiare che ci finisca dentro il contenuto di un campo.
  const first = message.split(':')[0]?.trim() ?? '';
  return /^[A-Z_a-z]{3,40}$/.test(first) ? first : 'unknown';
}
