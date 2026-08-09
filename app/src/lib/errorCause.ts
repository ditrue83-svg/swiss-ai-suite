// ============================================================================
// La causa di un guasto di lettura, portata a schermo.
//
// PERCHÉ ESISTE. `SCANNED_NO_TEXT` era vero nel database, nei log e nel
// rapporto del worker, ma la schermata diceva solo «Lettura non riuscita»:
// la causa moriva a un passo dall'unica persona che può agire di conseguenza
// (rileggere con l'OCR, aspettare il credito, segnalare il file). I servizi
// portano già `errorCode` fino al client — mancava solo il collegamento.
//
// ⚠️ SI TRADUCONO SOLO I CODICI CHE QUESTA MAPPA CONOSCE, come già fa
// `ERROR_KEY` in analysisService: per tutti gli altri si mostra il CODICE
// GREZZO, mai una categoria inventata — è la regola di governance (nessun
// fallback silenzioso). Un codice nuovo nei worker resta quindi visibile
// com'è finché qualcuno non lo traduce, e i test unitari diventano rossi
// finché l'elenco dei worker e questa mappa non dicono lo stesso.
//
// ⚠️ IL TRADUTTORE ARRIVA DA FUORI (`t`), non da un import di modulo: `tr()`
// catturato a livello di modulo congela la lingua del primo render — è la
// trappola già annotata nel CLAUDE.md — e la funzione resta pura, provabile
// nei test senza il runtime i18n.
//
// I codici coprono l'UNIONE dei due elenchi autorevoli:
// `ContractErrorCode` (supabase/functions/_shared/contracts/contract.ts) e
// `FINANCE_ERROR_CODES` (supabase/functions/_shared/finance/contract.ts).
// La causa compare sia sulle righe `failed` sia su quelle `pending` che
// portano il codice dell'ultimo rilascio (credito, limite di richieste…):
// è lo stato a dire se si ritenta, il codice dice soltanto PERCHÉ.
// ============================================================================
import type { TKey } from '@/i18n';

export const CAUSA_KEY: Record<string, TKey> = {
  NO_TEXT: 'errors.cause.NO_TEXT',
  SCANNED_NO_TEXT: 'errors.cause.SCANNED_NO_TEXT',
  NOT_A_CONTRACT: 'errors.cause.NOT_A_CONTRACT',
  NOT_FINANCIAL: 'errors.cause.NOT_FINANCIAL',
  AI_REFUSED: 'errors.cause.AI_REFUSED',
  AI_INVALID_OUTPUT: 'errors.cause.AI_INVALID_OUTPUT',
  AI_OUTPUT_TRUNCATED: 'errors.cause.AI_OUTPUT_TRUNCATED',
  AI_UNAVAILABLE: 'errors.cause.AI_UNAVAILABLE',
  AI_NOT_CONFIGURED: 'errors.cause.AI_NOT_CONFIGURED',
  QUOTA_EXCEEDED: 'errors.cause.QUOTA_EXCEEDED',
  PROVIDER_RATE_LIMITED: 'errors.cause.PROVIDER_RATE_LIMITED',
  RATE_LIMITED: 'errors.cause.RATE_LIMITED',
  PROVIDER_ERROR: 'errors.cause.PROVIDER_ERROR',
  TIME_BUDGET: 'errors.cause.TIME_BUDGET',
  INTERRUPTED: 'errors.cause.INTERRUPTED',
  STORAGE_MISSING: 'errors.cause.STORAGE_MISSING',
  SCHEMA_INVALID: 'errors.cause.SCHEMA_INVALID',
  UNKNOWN: 'errors.cause.UNKNOWN',
  UNKNOWN_ERROR: 'errors.cause.UNKNOWN_ERROR',
};

/** La causa tradotta se il codice è noto, il codice grezzo se non lo è, null se non c'è. */
export function causaDelGuasto(
  code: string | null | undefined,
  t: (key: TKey) => string,
): string | null {
  if (!code) return null;
  const key = CAUSA_KEY[code];
  return key ? t(key) : code;
}
