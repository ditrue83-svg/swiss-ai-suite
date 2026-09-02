import type { IconName } from '@/components/ui/Icon';
import type { TKey } from '@/i18n';

// La barra racconta la STRUTTURA DEL LAVORO AMMINISTRATIVO, non l'architettura
// del software. Fino al 2026-08-13 i gruppi si chiamavano «Piattaforma»,
// «Moduli» e «Automazione»: nomi veri per chi ha scritto il codice, vuoti per
// chi la mattina deve decidere da dove cominciare. I gruppi di oggi sono la
// giornata di chi amministra: prima il colpo d'occhio (senza etichetta), poi
// il flusso in entrata (LAVORO), poi la memoria in cui si ritrova (ARCHIVIO),
// e in fondo — separato, perché non è lavoro quotidiano — le impostazioni.
//
// Le voci portano una CHIAVE di traduzione, non un'etichetta già scritta:
// l'etichetta si risolve al render, così il menu cambia lingua all'istante.
//
// ⚠️ `adminOnly` NASCONDE la voce, e nascondere non è proteggere: il cancello
// vero sta nella policy RLS della pagina (per il Registro attività è
// `audit_select_admin`, 0039). Serve a non mostrare a un membro una porta che
// gli si chiuderebbe in faccia — e infatti la pagina, aperta per indirizzo,
// spiega perché non può leggere invece di mostrare un elenco vuoto.
//
// ⚠️ NESSUN CONTATORE accanto alle voci. «Posta in arrivo» e «Scadenze e
// attività» ne meriterebbero uno (non letti, in scadenza), ma i conteggi che
// esistono oggi sono interrogazioni dedicate (`inboxService.counts`,
// `taskService.list`) eseguite DENTRO le rispettive pagine: la barra sta su
// ogni schermata, e un numero lì significherebbe una query in più per ogni
// cambio pagina. Il giorno in cui un conteggio arriverà già caricato nella
// shell, il numero si potrà mostrare; fino ad allora, un contatore comprato
// con query nuove è rumore pagato due volte.
export interface NavItem {
  id: string;
  labelKey: TKey;
  icon: IconName;
  path: string;
  adminOnly?: boolean;
  /** Modulo fuori perimetro (D-10, Blocco C): nascosto a meno che
   *  `VITE_LEGACY_MODULES=on` (vedi `lib/env.ts`). Nasconde la porta, non
   *  protegge la rotta: il cancello vero resta la RLS. */
  legacyOnly?: boolean;
  /** Altri prefissi di rotta su cui la voce risulta ATTIVA: «Scadenze e
   *  attività» resta evidenziata anche su `/calendario`, che è la stessa
   *  area guardata in un altro modo — senza questo, aprire il calendario
   *  spegnerebbe ogni evidenza nella barra. */
  alsoMatches?: string[];
}
export interface NavSection { sectionKey: TKey }
export type NavEntry = NavItem | NavSection;

export const NAV: NavEntry[] = [
  // Senza etichetta: il colpo d'occhio e il modo di chiederlo a parole.
  // La Panoramica è l'UNICA schermata d'insieme: fino al 2026-07-28 accanto
  // c'era anche «Dashboard», che mostrava gli stessi dati con qualche grafico
  // in più — due voci per due viste dello stesso fatto obbligano a scegliere
  // ogni volta quale aprire, e la risposta era «tutte e due».
  { id: 'home', labelKey: 'nav.home', icon: 'home', path: '/' },
  // «Chiedi ad AI-Swisse» sta SUBITO DOPO la Panoramica: la Panoramica dice
  // che cosa richiede attenzione, questa voce permette di chiederlo a parole.
  // Fra le voci di lavoro sembrerebbe un posto in cui il lavoro sta, mentre è
  // il modo di interrogarli tutti (§117).
  { id: 'assistant', labelKey: 'nav.assistant', icon: 'askAi', path: '/assistente' },

  // LAVORO — il flusso in entrata, nell'ordine in cui il lavoro arriva:
  // prima ciò che entra (posta), poi ciò che si porta ad analizzare, poi ciò
  // che ne deriva (scadenze).
  { sectionKey: 'nav.sectionWork' },
  { id: 'inbox', labelKey: 'nav.inbox', icon: 'inbox', path: '/inbox' },
  // «Analizza documento» è un'AZIONE, non un luogo: il nome del modulo
  // (Admin AI) resta nel codice e nella documentazione, ma la voce dice che
  // cosa si viene a fare qui — portare un documento e farselo spiegare.
  // Fino al 2026-08-13 si chiamava «Admin AI — Documenti», indistinguibile
  // per nome dall'archivio «Documenti» tre voci più sotto.
  { id: 'admin', labelKey: 'nav.analyzeDoc', icon: 'document', path: '/admin' },
  // Una voce sola per Attività e Calendario: sono lo STESSO lavoro guardato
  // in due modi — l'elenco dice che cosa, il calendario dice quando. La rotta
  // `/calendario` resta viva (segnalibri, email di notifica) e l'interruttore
  // in testa alle due pagine porta dall'una all'altra; `alsoMatches` tiene
  // accesa questa voce anche di là.
  { id: 'deadlines', labelKey: 'nav.tasks', icon: 'checkCircle', path: '/attivita', alsoMatches: ['/calendario'] },
  // ARCHIVIO — dove si RITROVA ciò che è stato capito. Oggi solo la memoria
  // intera (Documenti): le letture per genere — Contratti, Clienti, Finanze —
  // sono moduli fuori perimetro (D-10, Blocco C), nascosti da `legacyOnly`.
  { sectionKey: 'nav.sectionArchive' },
  { id: 'documents', labelKey: 'nav.documents', icon: 'archive', path: '/documenti' },
  { id: 'contracts', labelKey: 'nav.contracts', icon: 'fileSignature', path: '/contratti', legacyOnly: true },
  // ⚠️ L'icona dei Clienti è `user` e non `building`: `building` è già
  // «Azienda» sotto Impostazioni, e due voci con la stessa icona si
  // confondono a colpo d'occhio — la regola scritta in Icon.tsx.
  { id: 'clients', labelKey: 'nav.clients', icon: 'user', path: '/clienti', legacyOnly: true },
  { id: 'finance', labelKey: 'nav.finance', icon: 'receipt', path: '/finanze', legacyOnly: true },
];

// IMPOSTAZIONI — in fondo alla barra, e dal 2026-08-17 dietro una FINESTRA.
// Ciò che sta qui si configura una volta e poi si lascia stare: le preferenze
// di chi guarda (Preferenze), chi si è (Azienda), le regole che lavorano da
// sole (Automazioni), come l'azienda si guarda da fuori (Registro attività,
// riservato a titolari e amministratori), che cosa si paga (Abbonamento —
// dentro l'app non si vende, si gestisce: «Prezzi» era il nome della vetrina).
//
// ⚠️ FINO AL 2026-08-17 ERA UN GRUPPO CHE SI APRIVA DENTRO LA BARRA, e le
// quattro sottovoci allungavano una colonna che già non ci stava: 124px in più
// nel momento esatto in cui si va a cercare qualcosa. Una finestra non ruba
// spazio alla navigazione, e mette le impostazioni tutte insieme davanti agli
// occhi invece che una rotta alla volta.
//
// ⚠️ `apre` NON è cosmesi, è la differenza fra un'impostazione e un'AREA.
//   `pannello` il contenuto sta dentro la finestra: un modulo, delle tendine.
//   `pagina`   la finestra si chiude e si va alla rotta. Automazioni ha un
//              costruttore con cinque sotto-rotte e il Registro è una tabella
//              lunga: sono luoghi in cui si LAVORA, non pannelli da sfogliare,
//              e ficcarli in un riquadro da 560px sarebbe stato peggio del
//              gruppo che si apriva.
// La rotta resta in ogni caso: `/azienda` e `/prezzi` continuano a rispondere,
// per i segnalibri e per chi arriva da un collegamento.
export type ApreCome = 'pannello' | 'pagina';
export interface NavSubItem {
  id: string; labelKey: TKey; path: string; adminOnly?: boolean; apre: ApreCome;
  /** Come `NavItem.legacyOnly`: il CRM (D-10, Blocco C) si configura solo con
   *  `VITE_LEGACY_MODULES=on`. Nasconde la porta, non protegge la rotta. */
  legacyOnly?: boolean;
}
export const NAV_SETTINGS: NavSubItem[] = [
  { id: 'preferences', labelKey: 'nav.preferences', path: '/preferenze', apre: 'pannello' },
  { id: 'company', labelKey: 'nav.company', path: '/azienda', apre: 'pannello' },
  // I campi personalizzati (0047) stanno con «chi si è»: definiscono come
  // l'azienda descrive le proprie controparti, non una preferenza di chi guarda.
  { id: 'crmFields', labelKey: 'nav.crmFields', path: '/campi-personalizzati', apre: 'pannello', legacyOnly: true },
  { id: 'crmEmail', labelKey: 'nav.crmEmail', path: '/email-crm', apre: 'pannello', legacyOnly: true },
  { id: 'crmFollowUp', labelKey: 'nav.crmFollowUp', path: '/follow-up-crm', apre: 'pannello', legacyOnly: true },
  { id: 'pricing', labelKey: 'nav.subscription', path: '/prezzi', apre: 'pannello' },
  { id: 'automations', labelKey: 'nav.automations', path: '/automazioni', apre: 'pagina' },
  { id: 'audit', labelKey: 'nav.auditLog', path: '/registro', adminOnly: true, apre: 'pagina' },
];

/** Dove un modulo di impostazioni è montato. Cambia SOLO l'intestazione, mai i
 *  campi: nella finestra il titolo lo portano già la finestra e la voce scelta
 *  nella colonnina, e ripeterlo sarebbe la stessa parola tre volte. */
export type Sede = 'pagina' | 'pannello';

export function isSection(e: NavEntry): e is NavSection {
  return (e as NavSection).sectionKey !== undefined;
}

/** Vero se il percorso corrente appartiene alla voce: il suo `path` o uno dei
 *  prefissi in `alsoMatches` (con `/` o fine stringa dopo, perché `/inbox`
 *  non deve accendersi su un ipotetico `/inboxes`). Accetta anche le
 *  sottovoci di NAV_SETTINGS: ciò che serve è il percorso, non l'icona. */
export function navItemMatches(item: { path: string; alsoMatches?: string[] }, pathname: string): boolean {
  const prefixes = [item.path, ...(item.alsoMatches ?? [])];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
