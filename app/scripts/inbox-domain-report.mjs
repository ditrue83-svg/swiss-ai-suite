// ============================================================================
// «Che cosa fa il filtro dei domini, sui dati veri?»
//   npm run inbox:domains
//
// Risponde a una domanda sola e la risponde con i numeri: quanti messaggi
// entrerebbero, quanti no, e da quale dominio. È il rapporto che accompagna la
// PARTE A del 2026-08-23 (D-13, migrazione 0043), ed esiste perché la stessa
// misura vada rifatta DOPO il deploy invece di essere ereditata da un
// messaggio di commit.
//
// ⚠️ NON SCRIVE NIENTE. Sola lettura: nessuna riga toccata, nessun messaggio
// escluso davvero, nessuna chiamata al provider e nessun credito AI speso.
// Dice che cosa SUCCEDEREBBE, o che cosa è successo se il filtro è già attivo.
//
// ⚠️⚠️ USA LA FUNZIONE VERA (`ammetti` di `adminDomains.ts`), non una sua
// imitazione. Un rapporto che riscrivesse la regola misurerebbe sé stesso: è
// il difetto che questo progetto chiama «il banco che tiene in vita ciò che
// dovrebbe segnalare». Se la regola cambia, questo numero cambia con lei.
//
// ⚠️ IL CATALOGO SI LEGGE DALLA TABELLA, e solo se la tabella non esiste
// ancora si ricava dalla migrazione — dicendolo a voce alta. Non è un ripiego
// silenzioso: la riga «FONTE DEL CATALOGO» sta in cima al rapporto, perché un
// numero non dice niente finché non si sa da quale elenco è uscito.
//
// ⚠️ MAI UN CONTENUTO. Domini e conteggi, come `email_sync_runs` e
// `inbox:diagnose`: la parte locale degli indirizzi non viene letta, l'oggetto
// dei messaggi nemmeno.
// ============================================================================
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
import { ammetti, dominioUtilizzabile } from '../supabase/functions/_shared/email/adminDomains.ts';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

const B = '\x1b[1m', X = '\x1b[0m', D = '\x1b[2m', G = '\x1b[32m', R = '\x1b[31m';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---- 1. Il catalogo, e da dove viene ---------------------------------------

async function leggiCatalogo(companyId) {
  const vive = await sb.from('email_admin_domains')
    .select('domain, company_id').is('archived_at', null);
  if (!vive.error) {
    const righe = (vive.data ?? []).filter((r) => r.company_id === null || r.company_id === companyId);
    return { fonte: 'tabella email_admin_domains (0043 applicata)', domini: righe.map((r) => r.domain) };
  }
  // La tabella non c'è: la migrazione non è stata applicata. Si ricava
  // l'elenco dal file, DICHIARANDOLO — così il rapporto resta leggibile prima
  // del deploy senza far credere che il filtro sia già in esercizio.
  const sql = readFileSync(new URL('../supabase/migrations/0043_inbox_admin_domains.sql', import.meta.url), 'utf8');
  const domini = [...sql.matchAll(/\(null,\s*'([a-z0-9.-]+)',/g)].map((m) => m[1]);
  return {
    fonte: `migrazione 0043, NON ANCORA APPLICATA (${vive.error.message.slice(0, 60)})`,
    domini,
    nonApplicata: true,
  };
}

// ---- 2. I numeri ------------------------------------------------------------

const { data: aziende } = await sb.from('companies').select('id, legal_name');

for (const azienda of aziende ?? []) {
  const { data: msgs, error } = await sb.from('email_messages')
    .select('id, sender_email, attention_status, relevance, received_at')
    .eq('company_id', azienda.id);
  if (error) { console.log(`${R}errore di lettura: ${error.message}${X}`); process.exit(1); }
  if (!msgs?.length) continue;

  const catalogo = await leggiCatalogo(azienda.id);
  console.log(`\n${B}${azienda.legal_name}${X}   ${msgs.length} messaggi`);
  console.log(`  ${D}FONTE DEL CATALOGO: ${catalogo.fonte}${X}`);
  console.log(`  ${D}domini in elenco: ${catalogo.domini.join(', ') || '— nessuno'}${X}`);

  const inerti = catalogo.domini.filter((d) => !dominioUtilizzabile(d));
  if (inerti.length) console.log(`  ${R}⚠ righe inerti nel catalogo: ${inerti.join(', ')}${X}`);

  const ammessi = [], esclusi = [];
  for (const m of msgs) {
    const esito = ammetti(m.sender_email, catalogo.domini);
    (esito.ammesso ? ammessi : esclusi).push({ ...m, ...esito });
  }

  console.log(`\n  ${B}DOPO IL FILTRO${X}`);
  console.log(`    ${G}entrano${X}   ${String(ammessi.length).padStart(4)}   ${((ammessi.length / msgs.length) * 100).toFixed(1)} %`);
  console.log(`    ${R}esclusi${X}   ${String(esclusi.length).padStart(4)}   ${((esclusi.length / msgs.length) * 100).toFixed(1)} %`);

  if (ammessi.length) {
    console.log(`\n  ${B}CHI ENTRA — e per quale riga del catalogo${X}`);
    const perRegola = {};
    for (const a of ammessi) {
      const k = `${a.dominio} → ${a.regola}`;
      perRegola[k] = (perRegola[k] ?? 0) + 1;
    }
    Object.entries(perRegola).sort((x, y) => y[1] - x[1])
      .forEach(([k, n]) => console.log(`    ${String(n).padStart(4)}  ${k}`));
  }

  console.log(`\n  ${B}CHI RESTA FUORI — per dominio${X}`);
  const perDominio = {};
  for (const e of esclusi) {
    const k = e.dominio ?? '(mittente illeggibile)';
    perDominio[k] = (perDominio[k] ?? 0) + 1;
  }
  Object.entries(perDominio).sort((x, y) => y[1] - x[1])
    .forEach(([k, n]) => console.log(`    ${String(n).padStart(4)}  ${k}`));

  // ---- 3. «Da gestire»: prima e dopo ---------------------------------------
  //
  // ⚠️ DUE NUMERI DIVERSI E DUE CAUSE DIVERSE, e tenerli separati è il punto.
  // A1 toglie messaggi dalla casella; A2 toglie a una macchina il diritto di
  // dire «da gestire». Sommarli farebbe credere che una sola delle due
  // correzioni basti.
  const daGestire = msgs.filter((m) => m.attention_status === 'needs_attention');
  const daGestireAmmessi = ammessi.filter((m) => m.attention_status === 'needs_attention');
  console.log(`\n  ${B}«DA GESTIRE» — prima e dopo${X}`);
  console.log(`    prima (nel database, oggi) ................. ${daGestire.length}`);
  console.log(`    dopo A1 (filtro sui domini) ................ ${daGestireAmmessi.length}`);
  console.log(`    dopo A2 (nessuna macchina lo assegna) ...... 0   ${D}— per costruzione: la 0043 lo toglie dalla funzione${X}`);
  if (daGestire.length) {
    const perDom = {};
    for (const m of daGestire) {
      const k = (m.sender_email ?? '').split('@')[1] ?? '(illeggibile)';
      perDom[k] = (perDom[k] ?? 0) + 1;
    }
    console.log(`    ${D}domini che oggi occupano «Da gestire»: ${Object.entries(perDom).map(([k, n]) => `${k} ${n}`).join(' · ')}${X}`);
  }

  if (catalogo.nonApplicata) {
    console.log(`\n  ${D}⚠ La 0043 non è applicata: i 148 messaggi già acquisiti restano dove sono.`);
    console.log(`    Il filtro agisce sulle ACQUISIZIONI FUTURE — questo rapporto dice`);
    console.log(`    che cosa avrebbe fatto sulla posta già arrivata.${X}`);
  }
}
console.log('');
