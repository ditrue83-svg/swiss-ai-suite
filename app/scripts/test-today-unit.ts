// ============================================================================
// AI-Swisse — «Oggi» (home da mobilità, Fase 3.1): test OFFLINE del modello.
//   npm run test:today-unit
//
// Niente database, niente rete. Prova le regole pure dietro la pagina:
//
//   1. IL TELEFONO — «chiama un cliente» offre UN numero, non un elenco da
//      scartare: il referente primario viene prima, una persona archiviata
//      non si chiama, e «mobile» vale quanto «phone». Se la regola si rompe,
//      la pagina propone il numero di chi non lavora più lì. La regola è del
//      CRM, non di /oggi: vive in `features/crm/crmModel.ts` (`scegliTelefono`)
//      e serve anche la scheda cliente — qui si prova il suo contratto.
//
//   2. L'ORDINE DELLE TRATTATIVE — prima i passi SCADUTI (dalla data più
//      lontana), poi i senza-passo (dalla meno recente): è l'ordine in cui
//      una persona lavora la lista. E la fusione delle due risposte della
//      RPC non può mostrare la stessa trattativa due volte.
//
//   3. IL DETTATO — si unisce al testo già scritto con UNO spazio, mai due,
//      mai in testa: la Web Speech API taglia i frammenti alla cieca, e chi
//      detta non deve poi ripulire gli spazi a mano.
// ============================================================================
import { fondeInAttesa, passoInRitardo, unisciDettatura } from '../src/features/today/todayModel.ts';
import { scegliTelefono } from '../src/features/crm/crmModel.ts';
import type { CrmOpportunity, CrmPerson } from '../src/types/models.ts';

let pass = 0, fail = 0;
const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', DIM = '\x1b[2m', X = '\x1b[0m';
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ${G}✓${X} ${name}`); }
  else { fail++; console.log(`  ${R}✗ ${name}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);

// ---- fabbriche minime: solo i campi che il modello legge --------------------
function persona(
  nome: string,
  metodi: Array<{ type: 'email' | 'phone' | 'mobile'; value: string }>,
  { primaria = false, archiviata = false }: { primaria?: boolean; archiviata?: boolean } = {},
): CrmPerson {
  return {
    contact: { displayName: nome, archivedAt: archiviata ? '2026-01-01' : null },
    methods: metodi.map((m, i) => ({ id: `m${i}`, type: m.type, value: m.value })),
    organizations: [{ isPrimary: primaria }],
  } as unknown as CrmPerson;
}

function trattativa(id: string, patch: Partial<CrmOpportunity> = {}): CrmOpportunity {
  return {
    id,
    organizationId: `org-${id}`,
    organizationName: `Org ${id}`,
    title: `Trattativa ${id}`,
    nextStep: null,
    nextStepDueDate: null,
    updatedAt: '2026-09-01T08:00:00Z',
    ...patch,
  } as CrmOpportunity;
}

const isoTra = (giorni: number) => {
  const d = new Date();
  d.setDate(d.getDate() + giorni);
  return d.toISOString().slice(0, 10);
};

// ---- 1. Il telefono ---------------------------------------------------------
section('1. Il telefono — uno, giusto, e di chi lavora lì');

check('il referente primario vince anche se arriva per secondo',
  scegliTelefono([
    persona('B secondario', [{ type: 'phone', value: '+41 91 000 00 01' }]),
    persona('A primario', [{ type: 'phone', value: '+41 91 000 00 02' }], { primaria: true }),
  ])?.value === '+41 91 000 00 02');

check('«mobile» vale quanto «phone»',
  scegliTelefono([persona('A', [{ type: 'mobile', value: '+41 79 000 00 03' }])])?.value === '+41 79 000 00 03');

check('una persona archiviata non si chiama: si passa alla prossima',
  scegliTelefono([
    persona('Andata via', [{ type: 'phone', value: '+41 91 111 11 11' }], { archiviata: true }),
    persona('Rimasta', [{ type: 'phone', value: '+41 91 222 22 22' }]),
  ])?.personName === 'Rimasta');

check('solo email → nessun numero da offrire',
  scegliTelefono([persona('Solo posta', [{ type: 'email', value: 'a@b.ch' }])]) === null);

check('il risultato porta il NOME di chi risponde, non solo il numero',
  scegliTelefono([persona('Marta Bernasconi', [{ type: 'phone', value: '+41 91 333 33 33' }])])?.personName
    === 'Marta Bernasconi');

// ---- 2. Passo in ritardo -----------------------------------------------------
section('2. Il passo scaduto — serve la frase E la data');

check('senza passo non c\'è ritardo (è un altro problema)',
  passoInRitardo(trattativa('a')) === false);
check('un passo senza data non può essere in ritardo',
  passoInRitardo(trattativa('a', { nextStep: 'Richiamare' })) === false);
check('passo con data di ieri → in ritardo',
  passoInRitardo(trattativa('a', { nextStep: 'Richiamare', nextStepDueDate: isoTra(-1) })) === true);
check('passo con data di OGGI → NON in ritardo («oggi» non è «ieri»)',
  passoInRitardo(trattativa('a', { nextStep: 'Richiamare', nextStepDueDate: isoTra(0) })) === false);
check('passo con data futura → non in ritardo',
  passoInRitardo(trattativa('a', { nextStep: 'Richiamare', nextStepDueDate: isoTra(5) })) === false);

// ---- 3. La fusione e l'ordine ------------------------------------------------
section('3. La lista fusa — scadute prima, senza duplicati');

{
  const scadutaVecchia = trattativa('sv', { nextStep: 'x', nextStepDueDate: isoTra(-10), updatedAt: '2026-09-05T08:00:00Z' });
  const scadutaIeri = trattativa('si', { nextStep: 'x', nextStepDueDate: isoTra(-1), updatedAt: '2026-09-08T08:00:00Z' });
  const senzaRecente = trattativa('nr', { updatedAt: '2026-09-09T08:00:00Z' });
  const senzaFerma = trattativa('nf', { updatedAt: '2026-08-20T08:00:00Z' });

  const fuse = fondeInAttesa([scadutaIeri, scadutaVecchia], [senzaRecente, senzaFerma]);
  check('le scadute stanno davanti, dalla data più lontana',
    fuse[0]?.id === 'sv' && fuse[1]?.id === 'si', fuse.map((o) => o.id).join(','));
  check('le senza-passo seguono, e la più FERMA viene prima della recente',
    fuse[2]?.id === 'nf' && fuse[3]?.id === 'nr', fuse.map((o) => o.id).join(','));

  const doppia = fondeInAttesa([scadutaIeri], [scadutaIeri, senzaFerma]);
  check('la stessa trattativa non compare due volte',
    doppia.filter((o) => o.id === 'si').length === 1 && doppia.length === 2,
    doppia.map((o) => o.id).join(','));
}

// ---- 4. Il dettato si unisce al testo ----------------------------------------
section('4. Il dettato si unisce al testo — uno spazio, mai due, mai in testa');

check('il dettato si attacca al già scritto con UNO spazio',
  unisciDettatura('Ho parlato con Marta', 'e abbiamo deciso') === 'Ho parlato con Marta e abbiamo deciso');
check('gli spazi ai bordi dei frammenti non ne fanno due',
  unisciDettatura('Ho parlato ', ' e abbiamo') === 'Ho parlato e abbiamo');
check('su casella vuota il dettato non comincia con uno spazio',
  unisciDettatura('', ' il cliente ha detto') === 'il cliente ha detto');
check('un frammento vuoto non tocca ciò che è scritto',
  unisciDettatura('Resta così', '') === 'Resta così');
check('il frammento finale e il parziale possono passare nella stessa aggiunta',
  unisciDettatura('Base', 'finale e parziale ') === 'Base finale e parziale ');

console.log(`\n${B}ESITO${X}: ${fail === 0 ? `${G}verde${X}` : `${R}rosso${X}`} — ${pass}/${pass + fail} passi`);
process.exit(fail === 0 ? 0 : 1);
