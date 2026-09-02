// ============================================================================
// AI-Swisse — LE GUARDIE DI ROTTA: test OFFLINE.
//   npm run test:routing
//
// Nessuna rete, nessuna credenziale, nessun credito. Prova la funzione PURA che
// decide dove finisce chi apre un indirizzo.
//
// PERCHÉ ESISTE QUESTO FILE
// Una guardia di rotta si sbaglia IN SILENZIO: non lancia un'eccezione, non
// colora niente di rosso, non registra niente. Manda soltanto nel posto
// sbagliato — e chi la usa pensa di aver cliccato male. È il tipo di difetto
// che nessun typecheck vede e che si nota solo aprendo l'applicazione, cioè la
// lezione ricorrente di questo progetto.
//
// IL DIFETTO CHE QUESTE ASSERZIONI BLOCCANO, riprodotto il 2026-07-30 su
// una rotta profonda: aprendo un indirizzo a freddo si
// finiva sulla Panoramica. Non era lo strumento — la nota in memoria che lo
// sosteneva era sbagliata, e la prova sta in due numeri che non si possono
// interpretare in due modi:
//     performance.getEntriesByType('navigation')[0].name → ".../attivita"
//     location.pathname                                  → "/"
// Il documento profondo era stato caricato davvero, ed è l'applicazione ad
// averlo abbandonato. La catena era `/attivita` → `/onboarding` → `/`.
//
// LA CAUSA, che è la forma di difetto più cara di questo repository:
// `loading: false` NON significa «ho guardato», significa «non sto guardando
// adesso». `CompanyProvider` lo metteva a `false` quando l'utente non c'era
// ANCORA, e la guardia leggeva quel `false` come una risposta.
// ============================================================================
import { routeGate, type GateInput } from '../src/components/layout/routeGate.ts';

const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${name}`); }
  else { fail++; console.log(`  ${R}✗ ${name}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);

/** Lo stato a regime: sessione valida, aziende lette, un'azienda c'è. */
const base: GateInput = {
  authLoading: false, hasSession: true,
  companyReady: true, companyLoading: false,
  hasCompany: true, companyError: null,
};
const gate = (o: Partial<GateInput> = {}) => routeGate({ ...base, ...o });

// ===========================================================================
section('1. Il caso normale');

check('a regime si entra nell\'applicazione', gate() === 'app');
check('senza sessione si va all\'accesso', gate({ hasSession: false }) === 'login');
check('mentre la sessione si risolve si ASPETTA, non si decide',
  gate({ authLoading: true, hasSession: false }) === 'loading');
check('sessione valida e nessuna azienda: onboarding',
  gate({ hasCompany: false }) === 'onboarding');
check('un guasto nella lettura si dichiara',
  gate({ companyError: 'boom', hasCompany: false }) === 'error');

// ===========================================================================
section('2. LA CORSA — un indirizzo profondo aperto a freddo');
// ⚠️ È L'ISTANTE ESATTO in cui l'applicazione sbagliava. La sessione è appena
//    arrivata, quindi `authLoading` è già falso; le aziende NON sono ancora
//    state lette, e `companyLoading` è falso perché il caricamento non è
//    nemmeno cominciato — l'effetto era partito prima, con l'utente a `null`.

const istanteDellaCorsa: GateInput = {
  authLoading: false, hasSession: true,
  companyReady: false, companyLoading: false,
  hasCompany: false, companyError: null,
};
check('in quell\'istante si ASPETTA', routeGate(istanteDellaCorsa) === 'loading');
// ⚠️ Il controllo che vale per tutti: NON si manda all'onboarding «per
//    intanto». Un reindirizzamento è irreversibile per l'indirizzo — la rotta
//    profonda e la sua query non tornano più — e mandare all'onboarding chi
//    un'azienda ce l'ha è anche una diagnosi falsa.
check('e NON si manda all\'onboarding', routeGate(istanteDellaCorsa) !== 'onboarding');
check('nemmeno quando una lettura è in corso',
  gate({ companyReady: false, companyLoading: true, hasCompany: false }) === 'loading');
// Appena le aziende sono lette, la decisione diventa vera in entrambi i sensi.
check('letto e nessuna azienda: allora sì, onboarding',
  gate({ companyReady: true, hasCompany: false }) === 'onboarding');
check('letto e un\'azienda c\'è: si entra',
  gate({ companyReady: true, hasCompany: true }) === 'app');

// ===========================================================================
section('3. `ready` non è `!loading` — e la differenza è tutto il difetto');
// ⚠️ Se qualcuno tornasse a decidere su `loading`, questi due casi
//    collasserebbero in uno: entrambi hanno `companyLoading: false`, ma il
//    primo significa «non ho ancora guardato» e il secondo «ho guardato e non
//    c'è niente». Portano a due schermate diverse.
check('non ho ancora guardato → si aspetta',
  gate({ companyReady: false, companyLoading: false, hasCompany: false }) === 'loading');
check('ho guardato e non c\'è niente → onboarding',
  gate({ companyReady: true, companyLoading: false, hasCompany: false }) === 'onboarding');
check('i due casi NON danno la stessa risposta',
  gate({ companyReady: false, companyLoading: false, hasCompany: false })
  !== gate({ companyReady: true, companyLoading: false, hasCompany: false }));

// ===========================================================================
section('4. Il caricamento a pagina intera non torna a ogni `refresh`');
// ⚠️ La garanzia del 2026-07-28, che questa riscrittura NON deve rompere: su
//    `loading` e basta, ogni `refresh()` del contesto smontava l'intera app —
//    sidebar compresa — e ogni schermata perdeva il proprio stato locale.
//    Visto nelle impostazioni azienda, dove dopo un salvataggio il campo di
//    ricerca si svuotava e sparivano gli avvisi sull'origine dei dati: cioè
//    esattamente le due cose che si stavano guardando.
check('con un\'azienda già presente, un refresh NON mostra il caricamento',
  gate({ companyLoading: true, hasCompany: true }) === 'app');
check('e nemmeno se `ready` è ancora vero durante la rilettura',
  gate({ companyReady: true, companyLoading: true, hasCompany: true }) === 'app');

// ===========================================================================
section('5. L\'ordine delle domande');
// ⚠️ L'accesso viene PRIMA di tutto ciò che riguarda le aziende: chiedere le
//    aziende di una sessione che non esiste non ha senso, e mostrarne l'errore
//    sarebbe un guasto raccontato a chi deve solo accedere.
check('senza sessione non si parla di aziende',
  gate({ hasSession: false, companyError: 'boom', hasCompany: false }) === 'login');
check('e nemmeno mentre la sessione si risolve',
  gate({ authLoading: true, hasSession: false, companyError: 'boom' }) === 'loading');
// ⚠️ L'attesa viene prima dell'errore: un errore vecchio non deve lampeggiare
//    mentre una nuova lettura è in corso su un'app che non ha ancora niente.
check('l\'attesa precede un errore quando non c\'è ancora un\'azienda',
  gate({ companyReady: false, companyError: 'boom', hasCompany: false }) === 'loading');
// ⚠️ Ma con un'azienda già in mano l'errore si vede subito: è successo qualcosa
//    a una lettura di aggiornamento, e tacerlo lascerebbe dati vecchi a schermo
//    senza dirlo.
check('con un\'azienda in mano, l\'errore si mostra',
  gate({ companyReady: true, companyError: 'boom', hasCompany: true }) === 'error');

// ===========================================================================
section('6. Nessuno stato porta MAI alla Panoramica');
// ⚠️ È il controllo che descrive il difetto per intero: la coppia di guardie
//    non ha alcun ramo che rimandi alla radice. Il rimbalzo nasceva DAL
//    COMBINATO — guardia → onboarding, onboarding → radice — e nessuna delle
//    due, presa da sola, sembrava sbagliata. Finché la guardia non manda
//    all'onboarding chi non deve andarci, la catena non può cominciare.
const stati = new Set<string>();
for (const authLoading of [true, false]) {
  for (const hasSession of [true, false]) {
    for (const companyReady of [true, false]) {
      for (const companyLoading of [true, false]) {
        for (const hasCompany of [true, false]) {
          for (const companyError of [null, 'boom']) {
            stati.add(routeGate({
              authLoading, hasSession, companyReady, companyLoading, hasCompany, companyError,
            }));
          }
        }
      }
    }
  }
}
check('le 64 combinazioni producono solo i cinque esiti previsti',
  [...stati].every((s) => ['loading', 'login', 'onboarding', 'error', 'app'].includes(s)),
  [...stati].join(', '));
// ⚠️ E il caso che non deve esistere: onboarding con un'azienda in mano.
let bugia = false;
for (const companyReady of [true, false]) {
  for (const companyLoading of [true, false]) {
    for (const companyError of [null, 'boom']) {
      if (routeGate({
        authLoading: false, hasSession: true, companyReady, companyLoading,
        hasCompany: true, companyError,
      }) === 'onboarding') bugia = true;
    }
  }
}
check('chi HA un\'azienda non finisce mai all\'onboarding', !bugia);

// ===========================================================================
console.log(`\n${B}Risultato:${X} ${G}${pass} passati${X}${fail ? `, ${R}${fail} falliti${X}` : ''}\n`);
process.exit(fail ? 1 : 0);
