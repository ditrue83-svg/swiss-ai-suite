// ============================================================================
// Edge Function: contract-worker — il lettore della coda dei contratti.
//
// Lo chiama uno SCHEDULER, non una persona. Autenticato con un segreto
// confrontato a tempo costante: non è un endpoint pubblico per definizione come
// un webhook, ma è raggiungibile, e un'esecuzione forzata da un estraneo
// consumerebbe la quota AI di un'azienda.
//
// ⚠️ NON DIPENDE DAL BROWSER. Un contratto che viene letto solo mentre qualcuno
// tiene AI-Swisse aperto non è un'automazione.
//
// ⚠️ QUESTA FUNZIONE NON PRENDE DECISIONI CONTRATTUALI, E NON PUÒ FARLO.
// Legge documenti e scrive verbali. Non modifica i termini in vigore (li cambia
// una persona verificando una versione), non crea attività, non invia disdette,
// non accetta né rifiuta rinnovi, non scrive alla controparte. Nel modulo non
// esiste alcun percorso che lo consenta, e questa funzione è il posto in cui uno
// sarebbe più facile da aggiungere per sbaglio: non aggiungetelo.
//
// COSA RESTITUISCE: numeri e codici, non testi. Nel rapporto non compaiono nomi
// di controparte, importi, clausole o titoli di documento (§110).
// ============================================================================
import Anthropic from 'npm:@anthropic-ai/sdk';
import { timingSafeEqual } from '../_shared/email/crypto.ts';
import { EDGE_TIME_BUDGET_MS } from '../_shared/contracts/contract.ts';
// Si riusano i mattoni di runtime del motore delle automazioni invece di
// scriverne una quarta copia: `adminClient`, `json` e `failure` non hanno nulla
// di specifico di quel modulo. È la stessa scelta di `finance-worker`.
import { adminClient, CORS, env, failure, json, logEvent } from '../_shared/automation/runtime.ts';
import {
  emptyContractReport, runContractWorker,
  type ContractCreateMessage, type ContractModelMessage,
} from '../_shared/contracts/process.ts';

/**
 * Il client AI. `null` quando la chiave non è configurata.
 * ⚠️ A differenza di Finance, qui senza modello NON si legge nulla: un contratto
 * non ha una lettura deterministica di ripiego, e fingerne una produrrebbe un
 * contratto «letto» che nessuno ha letto.
 */
function aiCreateMessage(): ContractCreateMessage | null {
  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  const anthropic = new Anthropic({ apiKey });
  return ((request: unknown) =>
    anthropic.messages.create(request as never) as Promise<ContractModelMessage>
  ) as ContractCreateMessage;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);

  // Senza segreto configurato la funzione non è utilizzabile: 503, e non 403 —
  // «non sono pronto» e «non sei tu» sono due cose diverse, e chi mette in
  // esercizio il prodotto deve poterle distinguere.
  const expected = env('CONTRACT_WORKER_SECRET');
  if (!expected) return failure('CONFIG_MISSING', 503);
  const provided = req.headers.get('x-contract-worker-secret') ?? '';
  if (!timingSafeEqual(provided, expected)) return failure('FORBIDDEN', 403);

  const deadline = Date.now() + EDGE_TIME_BUDGET_MS;
  let report = emptyContractReport();

  try {
    report = await runContractWorker({
      sb: adminClient(),
      createMessage: aiCreateMessage(),
      // I testi che il modello scrive seguono la lingua dell'applicazione.
      // Finché non esiste una preferenza per azienda, l'italiano è la lingua
      // dichiarata del prodotto, non un ripiego silenzioso.
      outputLanguage: 'it',
      deadlineMs: deadline,
    });
  } catch (error) {
    const code = codeOf(error);
    // ⚠️ Solo il codice: un messaggio del database può contenere il valore che ha
    // violato un vincolo, e in questo modulo quel valore è una clausola.
    logEvent('contract-worker', { code, phase: 'drain' });
    return json({ status: 'failed', code, report }, 500);
  }

  logEvent('contract-worker', { ...report, codes: report.codes.join(',') });
  return json({ status: 'ok', report });
});

/** Il codice tecnico, mai il messaggio: un messaggio può contenere dati. */
function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('CONFIG_MISSING')) return 'CONFIG_MISSING';
  const first = message.split(':')[0]?.trim() ?? '';
  return /^[A-Z_a-z]{3,40}$/.test(first) ? first : 'unknown';
}
