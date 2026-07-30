// ============================================================================
// CRM — abbinamento e normalizzazione (logica PURA)
//
// Niente rete, niente Supabase, niente React: solo funzioni. È il modulo che
// `test:crm-unit` esercita senza database e senza credito.
//
// ⚠️⚠️ QUESTO FILE HA UN GEMELLO IN SQL, e la duplicazione è DELIBERATA.
// `supabase/migrations/0026_crm_light.sql` contiene `crm_norm_email`,
// `crm_norm_domain`, `crm_norm_phone`, `crm_norm_uid` e `crm_is_public_domain`
// perché l'SQL deve poter filtrare e indicizzare senza chiamare il browser.
// Due copie della stessa regola divergono, sempre — è già accaduto in questo
// repository con gli ancoraggi dei contratti e con l'elenco dei campi
// correggibili. Perciò `test:crm-unit` LEGGE LA MIGRAZIONE, estrae l'elenco dei
// domini pubblici e lo confronta con quello qui sotto: è l'unico controllo che
// può vedere la divergenza, perché il typecheck non guarda dentro l'SQL.
// Chi tocca un elenco qui deve toccare anche l'altro, e il test lo pretende.
// ============================================================================

import type { CrmMatchReason } from '@/types/database';

/**
 * ⚠️ ELENCO DUPLICATO IN `crm_is_public_domain` (migrazione 0026).
 *
 * §24 — un dominio di posta pubblico NON prova che due persone appartengano
 * alla stessa impresa. `laura@bluewin.ch` e `marco@bluewin.ch` non lavorano
 * insieme: usano lo stesso operatore telefonico. Trattare un dominio pubblico
 * come segnale di identità unirebbe estranei.
 *
 * L'ordine è alfabetico per rendere evidente un doppione e facile il confronto
 * con la copia SQL.
 */
export const PUBLIC_EMAIL_DOMAINS: readonly string[] = [
  'aol.com',
  'bluewin.ch',
  'gmail.com',
  'gmx.ch',
  'gmx.net',
  'googlemail.com',
  'hispeed.ch',
  'hotmail.ch',
  'hotmail.com',
  'icloud.com',
  'libero.it',
  'live.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'sunrise.ch',
  'tiscali.it',
  'yahoo.com',
  'yahoo.it',
];

const PUBLIC_SET = new Set(PUBLIC_EMAIL_DOMAINS);

/**
 * §15 — minuscolo e spazi tolti, e NIENT'ALTRO.
 *
 * ⚠️ Non si tolgono i punti di Gmail e non si taglia il `+tag`. Sono regole di
 * un singolo fornitore, non del protocollo, e applicarle significa DECIDERE che
 * due indirizzi diversi sono la stessa persona. Se la decisione è sbagliata,
 * sbaglia unendo due persone — che è il tipo di errore peggiore che un CRM
 * possa fare, perché nessuno lo va a cercare.
 */
export function normEmail(value: string | null | undefined): string | null {
  const v = (value ?? '').trim().toLowerCase();
  return v === '' ? null : v;
}

/**
 * Il dominio di un indirizzo o di un URL: minuscolo, senza schema, senza
 * «www.», senza percorso, porta o query.
 *
 * Accetta sia `laura@rossi.ch` sia `https://www.rossi.ch/chi-siamo`, perché il
 * confronto del §23 mette in relazione un mittente e il sito di
 * un'organizzazione, e i due dati arrivano in forme diverse.
 */
export function normDomain(value: string | null | undefined): string | null {
  let v = (value ?? '').trim().toLowerCase();
  if (v === '') return null;
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');   // via lo schema
  const at = v.indexOf('@');
  const slash = v.indexOf('/');
  // Solo se la chiocciola precede l'eventuale percorso: in
  // `rossi.ch/info@x` la parte prima della barra è già il dominio.
  if (at >= 0 && (slash < 0 || at < slash)) v = v.slice(at + 1);
  v = v.replace(/^www\./, '');
  v = v.split(/[/:?#]/)[0] ?? '';
  return v === '' ? null : v;
}

/**
 * §16 — solo cifre, con il `+` iniziale se c'era.
 *
 * ⚠️ Il prefisso internazionale mancante NON si indovina: aggiungere `+41` a un
 * numero che non lo dichiara significa attribuirgli un paese. Il valore
 * originale resta sempre in `value`; questo serve a cercare e a sospettare un
 * doppione, non a chiamare.
 */
export function normPhone(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (raw === '') return null;
  const digits = raw.replace(/\D/g, '');
  if (digits === '') return null;
  return raw.startsWith('+') ? `+${digits}` : digits;
}

/**
 * L'IDI in forma canonica `CHE` + 9 cifre, oppure `null` se la cifra di
 * controllo mod-11 non torna.
 *
 * ⚠️ Il `null` è il punto di questa funzione, non un dettaglio: §25 grado 1 dice
 * che un IDI valido AUTORIZZA UN COLLEGAMENTO AUTOMATICO. Un IDI non verificato
 * non identifica nessuno, quindi non deve poter collegare niente da solo.
 *
 * ⚠️ TERZA COPIA DICHIARATA dell'algoritmo: le altre sono `isValidUid` in
 * `src/lib/uid.ts` (che l'interfaccia usa per avvisare mentre si scrive) e
 * `checkUid` in `supabase/functions/_shared/finance/checksums.ts` (che valida
 * l'IDI letto su una fattura). Questa serve al CRM perché deve produrre la
 * CHIAVE, non solo un sì o un no. `test:crm-unit` la confronta con `isValidUid`
 * su una serie di IDI veri: se una delle due cambia, il test lo dice.
 */
export function normUid(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length !== 9) return null;

  const weights = [5, 4, 3, 2, 7, 6, 5, 4];
  let sum = 0;
  for (let i = 0; i < 8; i += 1) sum += Number(digits[i]) * weights[i];

  let check = 11 - (sum % 11);
  // 11 si riscrive 0, e 10 non è una cifra: sono i due casi che una lettura
  // distratta della norma perde, ed è esattamente da lì che passa un IDI
  // inventato.
  if (check === 11) check = 0;
  else if (check === 10) return null;

  if (check !== Number(digits[8])) return null;
  return `CHE${digits}`;
}

/** §24 — vero per i domini di posta pubblici. Rispecchia `crm_is_public_domain`. */
export function isPublicDomain(domain: string | null | undefined): boolean {
  const d = (domain ?? '').trim().toLowerCase();
  return d !== '' && PUBLIC_SET.has(d);
}

// ---------------------------------------------------------------------------
// Il filtro anti-rumore dell'Inbox
// ---------------------------------------------------------------------------

/**
 * Le parti locali che indicano una casella di SERVIZIO e non una persona.
 *
 * ⚠️ NON contiene `mail`, `info` né `news` da soli, e non è una dimenticanza:
 * `info@rossi.ch` è la casella generale di un'impresa vera, ed è esattamente il
 * tipo di indirizzo da cui vale la pena proporre una controparte (§127 — un
 * indirizzo generico appartiene all'organizzazione, non a una persona). Un
 * elenco troppo largo scarterebbe i mittenti che contano.
 */
const SERVICE_LOCAL_PARTS: readonly string[] = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'noresponse',
  'newsletter', 'newsletters',
  'mailer', 'mailer-daemon', 'mailing', 'mailings',
  'bounce', 'bounces', 'postmaster', 'listserv',
  'notification', 'notifications', 'notifica', 'notifiche',
  'automated', 'automatic', 'auto-reply', 'autoreply',
];

/**
 * ⚠️ IL TRATTINO È SIA UN SEPARATORE SIA PARTE DELLE PAROLE, e confonderli
 * costava il riconoscimento di `no-reply.marketing@…`: spezzando anche sui
 * trattini, `no-reply` diventava `no` + `reply`, e nessuno dei due è nell'elenco.
 * Perciò l'elenco si normalizza togliendo i trattini, e il confronto avviene su
 * due strade: i SEGMENTI separati da `.`/`_`/`+` (senza trattini), e la parte
 * locale intera ripulita da ogni separatore.
 */
const SERVICE_SET = new Set(SERVICE_LOCAL_PARTS.map((p) => p.replace(/-/g, '')));

/**
 * Vero se l'indirizzo appartiene a una casella di servizio e non a una persona.
 *
 * Riconosce `noreply@`, `no-reply@`, `no_reply@`, `no-reply.marketing@`,
 * `mailer-daemon@`. NON scarta `annalisa@`, `laura.bianchi@` né `info@`.
 */
export function isServiceAddress(email: string | null | undefined): boolean {
  const e = normEmail(email);
  if (!e) return false;
  const local = e.split('@')[0] ?? '';
  // `no_reply` → `noreply`: la parte locale intera, senza separatori.
  if (SERVICE_SET.has(local.replace(/[.\-_+]/g, ''))) return true;
  // `no-reply.marketing` → segmenti `no-reply` e `marketing`: basta che UNO sia
  // una parola di servizio.
  return local.split(/[._+]/).some((part) => SERVICE_SET.has(part.replace(/-/g, '')));
}

/** Quello che serve per decidere se un mittente merita un suggerimento. */
export interface SenderSignals {
  senderEmail: string | null;
  /** Lo calcola già l'Inbox: il CRM lo LEGGE, non lo ricalcola. */
  isBulk: boolean;
  /** Il giudizio del classificatore dell'Inbox. `null` = non ancora classificata. */
  relevance: string | null;
}

/**
 * §20 — DEVE questo mittente diventare un suggerimento?
 *
 * ⚠️ IL NUMERO CHE GIUSTIFICA QUESTA FUNZIONE, misurato sulle 117 email vere
 * della casella collegata il 2026-07-29: 54 mittenti distinti su 44 domini, di
 * cui 57 messaggi `is_bulk`, 40 mittenti di servizio e 55 messaggi
 * `clearly_irrelevant`. Creando un'organizzazione per mittente si otterrebbero
 * 44 anagrafiche fatte in maggioranza di `stripe.com`, `amazon.it`,
 * `mail.adobe.com` e newsletter — cioè un CRM inutilizzabile al primo giorno.
 * Con questo filtro i 54 mittenti scendono a SEI.
 *
 * ⚠️ E fra quei sei restano `amazon.it` e `info.interdiscount.ch`: la prova che
 * nemmeno il filtro migliore autorizza un'anagrafica automatica. Per questo la
 * funzione decide se PROPORRE, non se creare (§21).
 *
 * ⚠️ Nessun segnale nuovo: `isBulk` e `relevance` li calcola già l'Inbox. Un
 * secondo classificatore avrebbe potuto dare un giudizio diverso sulla stessa
 * email, e allora due schermate del prodotto ne avrebbero raccontate due.
 */
export function deservesSuggestion(s: SenderSignals): boolean {
  const email = normEmail(s.senderEmail);
  if (!email || !email.includes('@')) return false;
  if (s.isBulk) return false;
  // `null` compreso: una email non ancora classificata non ha un giudizio, e
  // dedurne uno sarebbe inventarlo.
  if (s.relevance !== 'likely_actionable' && s.relevance !== 'possibly_actionable') return false;
  if (isServiceAddress(email)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// La scala dell'abbinamento (§25)
// ---------------------------------------------------------------------------

/**
 * Quali motivi autorizzano un collegamento SENZA che una persona confermi.
 *
 * Solo i due che sono identità: un IDI con la cifra di controllo valida e un
 * indirizzo email identico a un recapito già registrato. `domain_match` e
 * `name_normalized` sono sospetti — «Swisscom» e «Swisscom SA» restano soggetti
 * diversi finché nessuno dice il contrario — e restano suggerimenti.
 */
export const AUTO_LINK_REASONS: readonly CrmMatchReason[] = ['uid_exact', 'email_exact'];

export function canAutoLink(reason: CrmMatchReason): boolean {
  return AUTO_LINK_REASONS.includes(reason);
}

/**
 * Quanto è forte un motivo, per ordinare i candidati. Numeri piccoli = più
 * forti. Serve a mettere l'identità prima del sospetto quando entrambi ci sono,
 * non a costruire un punteggio: §151 — un punteggio senza dati e senza
 * validazione è un numero decorativo.
 */
export function reasonRank(reason: CrmMatchReason): number {
  switch (reason) {
    case 'uid_exact': return 0;
    case 'email_exact': return 1;
    case 'domain_match': return 2;
    case 'name_normalized': return 3;
    case 'manual': return 4;
    // 0030 — il più debole di tutti, ed è giusto che lo sia: non dice «somiglia
    // a questa scheda», dice «questa scheda non c'è». Non collega niente.
    case 'extracted_name': return 5;
  }
}

/** Un candidato all'abbinamento, con il motivo che ne decide il trattamento. */
export interface MatchCandidate {
  organizationId: string | null;
  contactId: string | null;
  reason: CrmMatchReason;
  reasonDetail: string | null;
}

/**
 * Sceglie il candidato da collegare automaticamente, se ce n'è uno lecito.
 *
 * ⚠️ Restituisce `null` anche quando i candidati ci sono ma **sono più di uno**
 * con lo stesso motivo forte: due organizzazioni con lo stesso indirizzo email
 * sono un duplicato da risolvere, e sceglierne una a caso vorrebbe dire
 * attribuire una comunicazione all'impresa sbagliata in silenzio. In quel caso
 * la decisione torna a una persona, che è dove appartiene.
 */
export function pickAutoLink(candidates: readonly MatchCandidate[]): MatchCandidate | null {
  const strong = candidates.filter((c) => canAutoLink(c.reason));
  if (strong.length === 0) return null;

  strong.sort((a, b) => reasonRank(a.reason) - reasonRank(b.reason));
  const best = strong[0]!;
  const tied = strong.filter(
    (c) => c.reason === best.reason
      && (c.organizationId !== best.organizationId || c.contactId !== best.contactId),
  );
  if (tied.length > 0) return null;
  return best;
}

/**
 * §23 — il dominio del mittente coincide con il sito dell'organizzazione?
 *
 * Vero solo se entrambi i domini esistono, coincidono e NON sono pubblici. Il
 * risultato è un sospetto: chi lo usa deve produrre un suggerimento, non un
 * collegamento.
 */
export function domainSuggests(senderEmail: string | null, websiteDomain: string | null): boolean {
  const a = normDomain(senderEmail);
  const b = normDomain(websiteDomain);
  if (!a || !b || a !== b) return false;
  return !isPublicDomain(a);
}

/**
 * La chiave di idempotenza di un suggerimento. Deve essere STABILE: se cambia a
 * ogni passaggio del worker, la stessa proposta ricompare ogni cinque minuti e
 * l'elenco diventa illeggibile.
 *
 * ⚠️ Non contiene alcun timestamp, per la stessa ragione, e non contiene
 * l'indirizzo email: `crm_link_suggestions` ha già una colonna per quello, e
 * infilare un dato personale in una chiave lo renderebbe più difficile da
 * cancellare quando qualcuno lo chiede (§122).
 */
export function suggestionKey(
  entityType: string,
  entityId: string,
  reason: CrmMatchReason,
  target: string | null,
): string {
  return ['crm', entityType, entityId, reason, target ?? 'new'].join(':');
}
