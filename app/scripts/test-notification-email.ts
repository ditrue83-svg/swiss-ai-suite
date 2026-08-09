// ============================================================================
// L'INVIO VERO di un'email di notifica, contro il provider vivo.
//   npm run test:notification-email                      ← destinatario tecnico
//   npm run test:notification-email -- tu@dominio.ch     ← un indirizzo indicato
//   npm run test:notification-email -- --self-test       ← prova il controllo, offline
//
// PERCHÉ ESISTE. `test:calendar-unit` §12 esegue `deliverEmails` per davvero,
// ma contro una `fetch` finta: prova la NOSTRA logica, non che un'email esca da
// questa macchina e arrivi da qualche parte. Le due cose si rompono in modi
// diversi — una chiave revocata, un dominio non verificato, un mittente
// rifiutato — e nessuna di quelle si vede con un provider simulato.
//
// ⚠️ NON È UN TEST OFFLINE E NON FINGE DI ESSERLO. Spende una email vera.
// Il destinatario predefinito è `delivered@resend.dev`, l'indirizzo tecnico che
// Resend accetta sempre e che non recapita a una persona: si prova il percorso
// senza scrivere a nessuno.
//
// ⚠️⚠️ SENZA I DUE SECRET ESCE 3, NON 0. Un controllo che non può essere
// eseguito non è verde: è saltato, e va detto con un codice di uscita che
// nessuno possa leggere come «a posto». È la stessa regola di `check:auth` e
// del runner delle suite.
//
// COSA NON STAMPA MAI: il valore della chiave. Si dichiara che il nome esiste e
// che il mittente è quello configurato, mai il segreto.
// ============================================================================
import {
  buildReminderEmail, createResendProvider, type NotificationEmailProvider,
} from '../supabase/functions/_shared/calendar/email.ts';
import { CalendarProviderError } from '../supabase/functions/_shared/calendar/types.ts';
import { st, formatDay } from '../supabase/functions/_shared/calendar/i18n.ts';

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[1m', DIM = '\x1b[2m', X = '\x1b[0m';

/** L'indirizzo tecnico di Resend: accettato sempre, non recapitato a nessuno. */
const DESTINATARIO_TECNICO = 'delivered@resend.dev';

let pass = 0, fail = 0;
const ok = (cond: boolean, label: string, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${label}`); }
  else { fail++; console.log(`  ${R}✗ ${label}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};

// ---------------------------------------------------------------------------
// La parte PURA: che cosa si sta per fare, e con quali dati. È la parte che può
// mentire in silenzio — mandare a un indirizzo diverso da quello inteso, o
// dichiarare configurato ciò che non lo è — quindi si prova senza rete.
// ---------------------------------------------------------------------------
export interface Piano {
  eseguibile: boolean;
  /** Perché non si può eseguire. Vuoto quando `eseguibile`. */
  motivo?: string;
  destinatario?: string;
  mittente?: string;
}

export function pianifica(argv: string[], env: Record<string, string | undefined>): Piano {
  const mancanti = (['NOTIFICATION_EMAIL_API_KEY', 'NOTIFICATION_EMAIL_FROM'] as const)
    .filter((n) => !(env[n] ?? '').trim());
  if (mancanti.length) {
    return { eseguibile: false, motivo: `non configurato: ${mancanti.join(', ')}` };
  }

  const indicato = argv.find((a) => !a.startsWith('--'));
  // Un argomento che non somiglia a un indirizzo NON diventa il destinatario
  // tecnico per ripiego: chi ha scritto qualcosa voleva mandare a quel
  // qualcosa, e sostituirglielo in silenzio è il fallback che questo progetto
  // non ammette. Meglio dire che non si è capito.
  if (indicato !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(indicato)) {
    return { eseguibile: false, motivo: `«${indicato}» non è un indirizzo email` };
  }

  return {
    eseguibile: true,
    destinatario: indicato ?? DESTINATARIO_TECNICO,
    mittente: (env.NOTIFICATION_EMAIL_FROM ?? '').trim(),
  };
}

// ---------------------------------------------------------------------------
// --self-test: il controllo messo alla prova su casi che DEVONO farlo fallire.
// ---------------------------------------------------------------------------
if (process.argv.slice(2).includes('--self-test')) {
  console.log(`${B}test:notification-email — prova del controllo stesso${X}\n`);
  const CHIAVE = { NOTIFICATION_EMAIL_API_KEY: 're_x', NOTIFICATION_EMAIL_FROM: 'A <a@b.ch>' };

  ok(pianifica([], {}).eseguibile === false, 'senza nessuno dei due valori NON è eseguibile');
  ok(pianifica([], { NOTIFICATION_EMAIL_API_KEY: 're_x' }).eseguibile === false,
    'con la sola chiave NON è eseguibile: servono entrambi');
  ok(pianifica([], { ...CHIAVE, NOTIFICATION_EMAIL_API_KEY: '   ' }).eseguibile === false,
    'una variabile presente ma VUOTA non conta come configurata');
  ok((pianifica([], {}).motivo ?? '').includes('NOTIFICATION_EMAIL_API_KEY'),
    'e il motivo NOMINA le variabili mancanti, invece di dire «non configurato»');

  const nominale = pianifica([], CHIAVE);
  ok(nominale.eseguibile && nominale.destinatario === DESTINATARIO_TECNICO,
    'senza argomenti il destinatario è quello tecnico, non una casella di una persona');
  ok(pianifica(['qualcuno@esempio.ch'], CHIAVE).destinatario === 'qualcuno@esempio.ch',
    'un indirizzo indicato vince sul predefinito');
  ok(pianifica(['--self-test'], CHIAVE).destinatario === DESTINATARIO_TECNICO,
    'un’opzione non viene scambiata per un indirizzo');
  ok(pianifica(['non-un-indirizzo'], CHIAVE).eseguibile === false,
    '⚠️ un argomento che non è un indirizzo FERMA il comando invece di sostituirgli il destinatario tecnico');

  // La controprova del contenuto: il corpo che si spedisce è quello del
  // prodotto, e non deve contenere markup né dati che non devono uscire.
  const corpo = buildReminderEmail({
    subject: st('it', 'subjectDueToday'), companyName: 'Tecnica Sagl',
    taskTitle: 'Prova tecnica di consegna', deadlineLine: st('it', 'bodyDeadline', { date: formatDay('2026-08-03', 'it') }),
    actionLabel: st('it', 'bodyOpen'), url: 'https://app.ai-swisse.com/attivita/x',
    footer: st('it', 'footerWhy', { company: 'Tecnica Sagl' }),
  });
  ok(!/[<>]/.test(corpo.text), 'il corpo resta testo semplice, senza markup');
  ok(corpo.text.includes('Ricevi questo messaggio perché'), 'e dice perché arriva');

  console.log(`\n${B}Riepilogo${X}  ${G}${pass} superati${X}${fail ? `  ${R}${fail} falliti${X}` : ''}\n`);
  process.exit(fail ? 1 : 0);
}

// ---------------------------------------------------------------------------
// L'invio vero.
// ---------------------------------------------------------------------------
console.log(`${B}AI-Swisse — invio di una notifica contro il provider VIVO${X}\n`);

const piano = pianifica(process.argv.slice(2), process.env);

if (!piano.eseguibile) {
  console.log(`  ${Y}⚠ NON ESEGUITO${X} — ${piano.motivo}`);
  console.log(`${DIM}
  I due valori si impostano come secret delle Edge Function e, per far girare
  QUESTO comando dalla propria macchina, anche in .env.test:

    NOTIFICATION_EMAIL_API_KEY   la chiave API del provider (Resend: 're_…')
    NOTIFICATION_EMAIL_FROM      il mittente, nella forma 'Nome <indirizzo@dominio>'
                                 su un dominio VERIFICATO presso il provider

  Vedi docs/calendar-notifications.md § «Accendere le email».

  ⚠️ Questo comando esce 3 e non 0: un controllo che non si può eseguire non è
  verde. Se leggessi «verde» qui, penseresti che le email funzionano.${X}\n`);
  process.exit(3);
}

console.log(`  ${DIM}mittente     ${X}${piano.mittente}`);
console.log(`  ${DIM}destinatario ${X}${piano.destinatario}`);
console.log(`  ${DIM}chiave       ${X}presente (il valore non si stampa)\n`);

const provider: NotificationEmailProvider = createResendProvider({
  apiKey: (process.env.NOTIFICATION_EMAIL_API_KEY ?? '').trim(),
  from: piano.mittente!,
});

// Il messaggio è composto dalle STESSE funzioni del prodotto: se l'oggetto o il
// corpo cambiano, cambia anche ciò che questa prova spedisce. Un test che
// spedisce un testo suo prova il provider e non il prodotto.
const marcatore = `prova-${Date.now().toString(36)}`;
const messaggio = buildReminderEmail({
  subject: `${st('it', 'subjectDueToday')} · ${marcatore}`,
  companyName: 'AI-Swisse — prova tecnica',
  taskTitle: 'Verifica del percorso di consegna delle notifiche',
  deadlineLine: st('it', 'bodyDeadline', { date: formatDay(new Date().toISOString().slice(0, 10), 'it') }),
  actionLabel: st('it', 'bodyOpen'),
  url: 'https://app.ai-swisse.com/attivita',
  footer: st('it', 'footerWhy', { company: 'AI-Swisse — prova tecnica' }),
});

try {
  const esito = await provider.send({
    to: piano.destinatario!,
    subject: messaggio.subject,
    text: messaggio.text,
    idempotencyKey: `test:${marcatore}`,
  });
  ok(!!esito.providerMessageId,
    'il provider ha accettato il messaggio e ha restituito un identificativo',
    `id: ${esito.providerMessageId}`);
  console.log(`  ${DIM}marcatore nell’oggetto: ${marcatore}${X}`);
} catch (error) {
  const e = error as CalendarProviderError;
  ok(false, 'invio verso il provider vivo', `${e.code ?? 'SENZA_CODICE'} — ${e.message ?? String(error)}`);
}

// ---------------------------------------------------------------------------
// ⚠️ LA CONTROPROVA, e non è un di più: senza, un verde qui sopra proverebbe
// solo che il codice non solleva. Con una chiave sbagliata il provider DEVE
// rifiutare, e il rifiuto deve essere classificato come DEFINITIVO — perché è
// su quella classificazione che `deliverEmails` decide di smettere invece di
// ritentare per giorni una chiave che non tornerà valida.
// ---------------------------------------------------------------------------
console.log(`\n${B}Controprova: una chiave sbagliata deve fallire, e in modo definitivo${X}`);
const sbagliato = createResendProvider({ apiKey: 're_chiave_inesistente_0000', from: piano.mittente! });
try {
  await sbagliato.send({
    to: piano.destinatario!, subject: 'non deve partire', text: 'non deve partire',
    idempotencyKey: `test-negativo:${marcatore}`,
  });
  ok(false, 'una chiave inesistente NON deve essere accettata', 'il provider ha accettato il messaggio');
} catch (error) {
  const e = error as CalendarProviderError;
  ok(e instanceof CalendarProviderError, 'l’errore risale tipizzato', String(e?.constructor?.name));
  ok(e.retryable === false,
    '⚠️ ed è dichiarato NON ritentabile: è ciò che fa chiudere la consegna invece di occupare la coda per giorni',
    `retryable: ${e.retryable}`);
}

console.log(`\n${B}Riepilogo${X}  ${G}${pass} superati${X}${fail ? `  ${R}${fail} falliti${X}` : ''}\n`);
process.exit(fail ? 1 : 0);
