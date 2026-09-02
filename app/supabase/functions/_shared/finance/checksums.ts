// ============================================================================
// Cifre di controllo dei dati di pagamento: IBAN, QR-IBAN, riferimento QR,
// riferimento creditore ISO 11649.
//
// ⚠️ PERCHÉ SERVONO QUI E NON «PIÙ AVANTI».
// Un IBAN o un riferimento letti male da una trascrizione hanno la stessa forma
// di uno giusto: ventuno caratteri, tutti plausibili. L'unica cosa che
// distingue un numero letto bene da uno letto male è la cifra di controllo, ed è
// una verifica ARITMETICA — deterministica, ripetibile, senza modelli di mezzo.
// Farla qui significa che il prodotto può dire «questo IBAN non torna» invece di
// mostrarlo accanto a un importo come se fosse un fatto.
//
// ⚠️ CHE COSA NON DIMOSTRANO. Una cifra di controllo valida dice che il numero è
// stato TRASCRITTO correttamente. NON dice che il conto esista, che appartenga
// al fornitore indicato, né che la fattura sia autentica (§119). Il prodotto non
// deve mai lasciar intendere il contrario.
//
// Modulo PORTABILE: funzioni pure, nessun import, nessuna dipendenza.
// ============================================================================

/** Toglie spazi e trattini: gli IBAN si scrivono a gruppi, i riferimenti pure. */
export function compact(input: string | null | undefined): string {
  return String(input ?? '').replace(/[\s\-.]/g, '').toUpperCase();
}

// ---------------------------------------------------------------------------
// IBAN — ISO 13616, cifra di controllo ISO 7064 MOD 97-10
// ---------------------------------------------------------------------------

/**
 * Resto modulo 97 di un numero lunghissimo, calcolato a pezzi.
 * Un IBAN convertito in cifre supera abbondantemente i numeri rappresentabili
 * esattamente da un `number`: si procede a blocchi, che è il metodo descritto
 * dallo standard stesso.
 *
 * Esportato per `qrbill.ts`: la stessa aritmetica serve sia a VERIFICARE un
 * IBAN o un riferimento SCOR sia a CALCOLARE le cifre di controllo ISO 11649
 * in generazione. Due implementazioni diverrebbero; una sola non può.
 */
export function mod97(digits: string): number {
  let remainder = 0;
  for (let i = 0; i < digits.length; i += 7) {
    remainder = Number(String(remainder) + digits.slice(i, i + 7)) % 97;
  }
  return remainder;
}

export interface IbanCheck {
  valid: boolean;
  /** Forma compatta e maiuscola, così come va salvata. */
  normalized: string;
  country: string | null;
  /** Perché non è valido. Codice, non frase: la frase la scrive l'interfaccia. */
  error?: 'too_short' | 'bad_format' | 'bad_length' | 'bad_checksum';
}

/** Lunghezze ufficiali per i paesi che una PMI svizzera incontra davvero. */
const IBAN_LENGTH: Record<string, number> = {
  CH: 21, LI: 21, DE: 22, AT: 20, FR: 27, IT: 27, ES: 24, NL: 18,
  BE: 16, LU: 20, GB: 22, PT: 25, DK: 18, SE: 24, NO: 15, FI: 18, PL: 28, CZ: 24,
};

export function checkIban(input: string | null | undefined): IbanCheck {
  const normalized = compact(input);
  if (normalized.length < 5) return { valid: false, normalized, country: null, error: 'too_short' };
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(normalized)) {
    return { valid: false, normalized, country: null, error: 'bad_format' };
  }
  const country = normalized.slice(0, 2);

  // La lunghezza si verifica SOLO per i paesi il cui valore ufficiale è noto
  // qui. Per gli altri si tace invece di inventare un limite: un IBAN estero
  // rifiutato per una lunghezza che nessuno ha verificato sarebbe un dato
  // buono scartato da una regola scritta a occhio.
  const expected = IBAN_LENGTH[country];
  if (expected && normalized.length !== expected) {
    return { valid: false, normalized, country, error: 'bad_length' };
  }

  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return mod97(digits) === 1
    ? { valid: true, normalized, country }
    : { valid: false, normalized, country, error: 'bad_checksum' };
}

/**
 * QR-IBAN: un IBAN svizzero o liechtensteinese il cui identificativo di
 * istituto (le cinque cifre subito dopo le cifre di controllo, cioè il numero
 * di clearing) cade nell'intervallo riservato QR-IID.
 *
 * ⚠️ NON è un formato diverso: è un IBAN normale con un istituto particolare.
 * La distinzione conta perché determina QUALE riferimento la fattura deve
 * portare, e confonderli è l'errore che §120 chiede espressamente di evitare.
 */
export const QR_IID_MIN = 30000;
export const QR_IID_MAX = 31999;

export function isQrIban(input: string | null | undefined): boolean {
  const iban = compact(input);
  if (!/^(CH|LI)[0-9]{2}[0-9]{5}/.test(iban)) return false;
  const iid = Number(iban.slice(4, 9));
  return Number.isFinite(iid) && iid >= QR_IID_MIN && iid <= QR_IID_MAX;
}

// ---------------------------------------------------------------------------
// Riferimento QR (QRR) — 27 cifre, controllo «modulo 10 ricorsivo»
//
// È l'algoritmo storico della polizza di versamento svizzera (ESR/BVR), ripreso
// dalla QR-fattura. Non è un modulo 10 «normale» a pesi alternati: usa una
// tabella di trasformazione e porta un riporto da una cifra alla successiva.
// ---------------------------------------------------------------------------

const MOD10_TABLE: readonly (readonly number[])[] = [
  [0, 9, 4, 6, 8, 2, 7, 1, 3, 5],
  [9, 4, 6, 8, 2, 7, 1, 3, 5, 0],
  [4, 6, 8, 2, 7, 1, 3, 5, 0, 9],
  [6, 8, 2, 7, 1, 3, 5, 0, 9, 4],
  [8, 2, 7, 1, 3, 5, 0, 9, 4, 6],
  [2, 7, 1, 3, 5, 0, 9, 4, 6, 8],
  [7, 1, 3, 5, 0, 9, 4, 6, 8, 2],
  [1, 3, 5, 0, 9, 4, 6, 8, 2, 7],
  [3, 5, 0, 9, 4, 6, 8, 2, 7, 1],
  [5, 0, 9, 4, 6, 8, 2, 7, 1, 3],
];

/** La cifra di controllo di una sequenza di cifre, modulo 10 ricorsivo. */
export function mod10Recursive(digits: string): number | null {
  if (!/^[0-9]*$/.test(digits)) return null;
  let carry = 0;
  for (const ch of digits) carry = MOD10_TABLE[carry][Number(ch)];
  return (10 - carry) % 10;
}

export interface ReferenceCheck {
  valid: boolean;
  normalized: string;
  error?: 'bad_length' | 'bad_format' | 'bad_checksum';
}

/** Riferimento QR: esattamente 27 cifre, l'ultima è di controllo. */
export function checkQrReference(input: string | null | undefined): ReferenceCheck {
  const normalized = compact(input);
  if (!/^[0-9]+$/.test(normalized)) return { valid: false, normalized, error: 'bad_format' };
  if (normalized.length !== 27) return { valid: false, normalized, error: 'bad_length' };
  const expected = mod10Recursive(normalized.slice(0, 26));
  return expected !== null && expected === Number(normalized[26])
    ? { valid: true, normalized }
    : { valid: false, normalized, error: 'bad_checksum' };
}

// ---------------------------------------------------------------------------
// Riferimento creditore ISO 11649 (SCOR) — «RF» + 2 cifre di controllo
// ---------------------------------------------------------------------------

export function checkCreditorReference(input: string | null | undefined): ReferenceCheck {
  const normalized = compact(input);
  if (!/^RF[0-9]{2}[A-Z0-9]{1,21}$/.test(normalized)) {
    return { valid: false, normalized, error: 'bad_format' };
  }
  // Stessa meccanica dell'IBAN: si sposta il prefisso in coda e si converte.
  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return mod97(digits) === 1
    ? { valid: true, normalized }
    : { valid: false, normalized, error: 'bad_checksum' };
}

/**
 * Riconosce di che tipo è un riferimento GUARDANDOLO, senza fidarsi di come è
 * dichiarato. Serve al confronto fra ciò che il codice QR dice di essere e ciò
 * che effettivamente contiene (§35).
 */
export function referenceShape(input: string | null | undefined): 'qrr' | 'scor' | 'unknown' {
  const s = compact(input);
  if (!s) return 'unknown';
  if (/^RF[0-9]{2}/.test(s)) return 'scor';
  if (/^[0-9]{27}$/.test(s)) return 'qrr';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Numero IDI svizzero (UID) del fornitore
//
// Il prodotto ha già `src/lib/uid.ts` per lo stesso calcolo lato browser, con i
// suoi 26 test. Qui serve in Deno, dove quel file non arriva. ⚠️ È un DOPPIONE
// DICHIARATO, come `urgencyFrom` per le automazioni, e come là il test lo
// confronta con l'originale su tutti i casi invece di lasciarlo alla buona fede.
// ---------------------------------------------------------------------------

const UID_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4] as const;

export function checkUid(input: string | null | undefined): { valid: boolean; normalized: string } {
  const raw = String(input ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const m = /^(CHE|CH)?([0-9]{9})(MWST|TVA|IVA|HR)?$/.exec(raw);
  if (!m) return { valid: false, normalized: raw };
  const digits = m[2];
  const sum = UID_WEIGHTS.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const rest = sum % 11;
  const check = rest === 0 ? 0 : 11 - rest;
  // Un resto che darebbe 10 non produce alcun IDI valido: il numero non esiste.
  if (check === 10) return { valid: false, normalized: `CHE${digits}` };
  return { valid: check === Number(digits[8]), normalized: `CHE${digits}` };
}
