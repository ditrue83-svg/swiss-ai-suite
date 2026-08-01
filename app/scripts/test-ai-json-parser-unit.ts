// ============================================================================
// Test del parser condiviso dell'output dei modelli — `_shared/parse.ts`.
//   npm run test:ai-json-parser-unit
// Funzione pura: nessuna rete, nessuna credenziale, nessun credito speso.
//
// ⚠️ Questo file esiste per un difetto che ha attraversato tutti i moduli AI:
// il commento di `parse.ts` dichiarava «isola il primo oggetto bilanciato» e il
// codice non bilanciava — prendeva la prima graffa e teneva tutto fino alla
// fine. Una risposta valida con una frase DOPO l'oggetto falliva.
//
// ⚠️ Le CONTROPROVE sono nella sezione 12 e girano a ogni esecuzione: tre
// parser volutamente degradati (senza bilanciamento, senza stato di stringa,
// senza escape) devono FALLIRE dove quello vero riesce. Un controllo che nessuno
// ha messo alla prova su un caso che deve romperlo vale meno di nessun
// controllo: in questo repository è già successo due volte con `i18n:coverage`.
// ============================================================================
import {
  parseModelJson,
  isModelJsonError,
  describeModelJsonFailure,
  type ModelJsonFailure,
} from '../supabase/functions/_shared/parse.ts';

let pass = 0, fail = 0;
const ok = (cond: boolean, label: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
};

/** Il parser riesce e l'oggetto è quello atteso. */
function vale(input: string, atteso: unknown, label: string) {
  let got: unknown;
  let errore: string | null = null;
  try { got = parseModelJson(input); } catch (e) { errore = describeModelJsonFailure(e); }
  if (errore) { ok(false, `${label} — invece: ${errore}`); return; }
  ok(JSON.stringify(got) === JSON.stringify(atteso), label);
}

/** Il parser fallisce, e fallisce per la ragione attesa. */
function rifiuta(input: unknown, atteso: ModelJsonFailure, label: string) {
  try {
    parseModelJson(input as string);
    ok(false, `${label} — invece ha ACCETTATO`);
  } catch (e) {
    if (!isModelJsonError(e)) { ok(false, `${label} — errore di tipo inatteso`); return; }
    ok(e.failure === atteso, `${label} (${e.failure})`);
  }
}

console.log('\nParser condiviso dell\'output dei modelli — estrazione sintattica\n');

// ---------------------------------------------------------------------------
console.log('1. La forma nuda');
vale('{"status":"ok"}', { status: 'ok' }, '1 · oggetto semplice');
vale('   \n\t {"status":"ok"} \n  ', { status: 'ok' }, '2 · spazi e a capo esterni');

// ---------------------------------------------------------------------------
console.log('\n2. Testo attorno all\'oggetto — il difetto');
vale('Ecco il risultato: {"status":"ok"}', { status: 'ok' }, '3 · testo PRIMA');
vale(
  'Ecco il risultato:\n\n{"status":"ok","items":[]}\n\nHo mantenuto i dati separati.',
  { status: 'ok', items: [] },
  '4 · testo DOPO — il caso che falliva',
);
vale(
  'Premessa.\n{"a":1}\nSpiegazione finale.',
  { a: 1 },
  '5 · testo prima E dopo',
);

// ---------------------------------------------------------------------------
console.log('\n3. Recinti markdown');
vale('```json\n{"a":1}\n```', { a: 1 }, '6 · recinto con linguaggio `json`');
vale('```\n{"a":1}\n```', { a: 1 }, '7 · recinto senza linguaggio');
vale(
  'Ho analizzato il documento.\n\n```json\n{"a":1}\n```\n\nSe serve altro, chiedi.',
  { a: 1 },
  '8 · testo esterno al recinto, prima e dopo',
);
vale('```JSON\n  Ecco:\n  {"a":1}\n```', { a: 1 }, '8-bis · recinto che non comincia con la graffa');

// ---------------------------------------------------------------------------
console.log('\n4. Struttura');
vale(
  '{"a":{"b":{"c":1}},"d":2}',
  { a: { b: { c: 1 } }, d: 2 },
  '9 · oggetti annidati',
);
vale(
  '{"items":[{"id":1},{"id":2}],"n":2}',
  { items: [{ id: 1 }, { id: 2 }], n: 2 },
  '10 · array di oggetti DENTRO l\'oggetto',
);

// ---------------------------------------------------------------------------
console.log('\n5. Stringhe: graffe, virgolette, escape');
vale('{"t":"un { dentro"}', { t: 'un { dentro' }, '11 · graffa APERTA dentro una stringa');
vale('{"t":"chiudo qui }"}', { t: 'chiudo qui }' }, '12 · graffa CHIUSA dentro una stringa');
vale('{"t":"lui ha detto \\"sì\\""}', { t: 'lui ha detto "sì"' }, '13 · virgolette escaped');
vale('{"t":"C:\\\\Users\\\\test"}', { t: 'C:\\Users\\test' }, '14 · backslash escaped');
vale('{"t":"riga1\\nriga2"}', { t: 'riga1\nriga2' }, '15 · newline escaped');
vale('{"t":"Grüezi · Ticino · 日本"}', { t: 'Grüezi · Ticino · 日本' }, '16 · Unicode');
vale('{"t":"\\u00e8 vero"}', { t: 'è vero' }, '16-bis · escape \\uXXXX');
// ⚠️ Il caso che smonta uno scanner senza stato di escape: il backslash
// raddoppiato NON fa da escape alla virgoletta successiva, quindi la stringa
// finisce lì e la graffa dopo è vera.
vale('{"t":"finisce con backslash \\\\"}', { t: 'finisce con backslash \\' }, '14-bis · backslash doppio a fine stringa');
vale('{"a":"\\\\","b":"}"}', { a: '\\', b: '}' }, '14-ter · backslash e graffa in due campi');

// ---------------------------------------------------------------------------
console.log('\n6. Più oggetti — si prende il PRIMO, non si fondono');
vale('{"a":1}{"b":2}', { a: 1 }, '17 · due oggetti consecutivi → il primo');
vale('{"a":1}\n\nNota: il campo {b} non è stato usato.', { a: 1 }, '18 · oggetto + spiegazione con altre graffe');
vale(
  '{"a":1}\n\n## Nota\n\nHo usato **solo** i campi presenti. Vedi `documenti[0]`.',
  { a: 1 },
  '28 · oggetto valido seguito da markdown (titoli, grassetto, backtick)',
);
vale('- primo punto\n- secondo punto\n{"a":1}', { a: 1 }, '29 · oggetto preceduto da un elenco');
// ⚠️ Precedenza DICHIARATA: quando esiste un recinto completo, vince lui anche
// se un oggetto nudo lo precede. Un oggetto prima del recinto è quasi sempre
// l'eco della domanda; il recinto è l'unico posto in cui il modello DICHIARA
// dove sia la risposta.
vale('L\'ingresso era {"a":1}.\n\n```json\n{"b":2}\n```', { b: 2 }, '28-bis · il recinto batte l\'oggetto nudo che lo precede');

// ---------------------------------------------------------------------------
console.log('\n7. Rifiuti — e la ragione è distinta');
rifiuta(42, 'NOT_TEXT', '19 · input non stringa (numero)');
rifiuta(null, 'NOT_TEXT', '19-bis · input null');
rifiuta(undefined, 'NOT_TEXT', '19-ter · input undefined');
rifiuta({ a: 1 }, 'NOT_TEXT', '19-quater · input già oggetto');
rifiuta('', 'NO_OBJECT', '20 · stringa vuota');
rifiuta('   \n  ', 'NO_OBJECT', '20-bis · solo spazi');
rifiuta('nessun json qui', 'NO_OBJECT', '21 · nessuna parentesi');
rifiuta('[1,2,3]', 'NO_OBJECT', '22 · solo array');
rifiuta('{"a":1', 'INCOMPLETE_OBJECT', '23 · oggetto incompleto');
rifiuta('{"a":"mai chiusa}', 'INCOMPLETE_OBJECT', '24 · stringa JSON non chiusa');
rifiuta('```json\n{"status":"ok"\n', 'INCOMPLETE_OBJECT', '25 · recinto incompleto su risposta troncata');
rifiuta('{"a":1,}', 'INVALID_JSON', '26 · virgola finale');
rifiuta('{a:1}', 'INVALID_JSON', '27 · chiave non quotata');
rifiuta('{"a":\u201cvirgolette tipografiche\u201d}', 'INVALID_JSON', '27-bis · virgolette tipografiche');

// ---------------------------------------------------------------------------
console.log('\n8. Le politiche dichiarate (comportamento scelto, non incidentale)');
// Un array in cima resta un array: non si restituisce il suo primo elemento.
rifiuta('[{"a":1}]', 'NO_OBJECT', '31 · array DI oggetti → non si spaccia per oggetto');
rifiuta('```json\n[{"a":1}]\n```', 'NO_OBJECT', '31-bis · lo stesso dentro un recinto');
// Un primo oggetto bilanciato ma rotto NON viene saltato per prendere il secondo.
rifiuta('{"a":1,} {"b":2}', 'INVALID_JSON', '34 · primo oggetto rotto → NON si prova il secondo');
// Un recinto senza candidati non blocca la lettura del testo grezzo…
vale('```\nnessun oggetto qui\n```\n{"a":1}', { a: 1 }, '32 · recinto senza candidato → si riparte dal grezzo');
// …ma un candidato ROTTO dentro il recinto è l'esito, non un motivo per cercare altrove.
rifiuta('```json\n{"a":1,}\n```\n{"b":2}', 'INVALID_JSON', '33 · candidato rotto nel recinto → è quello l\'errore');
// Un recinto aperto e mai chiuso: si ignora il delimitatore e si legge il grezzo.
vale('```json\n{"a":1}', { a: 1 }, '35 · recinto aperto ma oggetto intero → riesce, e il recinto si ignora');
// Nessun ripiego su oggetto vuoto, mai.
rifiuta('', 'NO_OBJECT', '36 · l\'assenza di output NON diventa {}');

// ---------------------------------------------------------------------------
console.log('\n9. Risposte realistiche (fixture tecniche, nessun dato cliente)');
// 30 · la forma osservata nell'Inbox: recinto + frase di cortesia dopo.
const rispostaInbox = [
  'Ho esaminato il messaggio.',
  '',
  '```json',
  '{"relevance":"informational","confidence":0.82,"reason":"Comunicazione di servizio del fornitore","manipulationAttempt":false}',
  '```',
  '',
  'Non ho trovato scadenze o importi da segnalare.',
].join('\n');
vale(
  rispostaInbox,
  { relevance: 'informational', confidence: 0.82, reason: 'Comunicazione di servizio del fornitore', manipulationAttempt: false },
  '30 · risposta realistica dell\'Inbox (recinto + coda di testo)',
);
// La stessa forma senza recinto, con la coda che faceva fallire il parser.
vale(
  'Ecco la classificazione:\n{"relevance":"clearly_irrelevant","confidence":0.95,"reason":"Newsletter commerciale","manipulationAttempt":false}\nSpero sia utile.',
  { relevance: 'clearly_irrelevant', confidence: 0.95, reason: 'Newsletter commerciale', manipulationAttempt: false },
  '30-bis · stessa forma senza recinto, con coda di testo',
);
// Un output realmente inutilizzabile resta inutilizzabile.
rifiuta('Mi dispiace, non sono in grado di classificare questo messaggio.', 'NO_OBJECT', '30-ter · un rifiuto in prosa resta un guasto');

// ---------------------------------------------------------------------------
console.log('\n10. §45 — l\'errore non trasporta l\'output');
{
  const segreto = '{"iban":"CH9300762011623852957","importo":4820.50,"nome":"Mario Rossi",}';
  let msg = '', descr = '';
  try { parseModelJson(segreto); } catch (e) {
    msg = (e as Error).message;
    descr = describeModelJsonFailure(e);
  }
  ok(msg.length > 0, 'l\'errore ha un messaggio');
  ok(!msg.includes('CH9300762011623852957') && !msg.includes('Mario Rossi') && !msg.includes('4820'),
    'il messaggio NON contiene IBAN, nome né importo');
  ok(!descr.includes('CH9300762011623852957') && !descr.includes('Mario Rossi'),
    'nemmeno la descrizione registrabile li contiene');
  ok(/len=\d+/.test(descr), 'porta la LUNGHEZZA dell\'output, non l\'output');
  ok(/fenced=(true|false)/.test(descr), 'e dichiara se c\'era un recinto');
}

// ---------------------------------------------------------------------------
console.log('\n11. Le quattro categorie sono distinguibili');
{
  const casi: Array<[string, ModelJsonFailure]> = [
    ['nessun json', 'NO_OBJECT'],
    ['{"a":1', 'INCOMPLETE_OBJECT'],
    ['{"a":1,}', 'INVALID_JSON'],
  ];
  const viste = new Set<string>();
  for (const [input, atteso] of casi) {
    try { parseModelJson(input); } catch (e) {
      if (isModelJsonError(e)) { viste.add(e.failure); ok(e.failure === atteso, `«${input.slice(0, 12)}…» → ${e.failure}`); }
    }
  }
  try { parseModelJson(1 as unknown as string); } catch (e) { if (isModelJsonError(e)) viste.add(e.failure); }
  ok(viste.size === 4, `quattro cause distinte, non una sola opaca (${[...viste].sort().join(', ')})`);
}

// ---------------------------------------------------------------------------
// ⚠️⚠️ CONTROPROVE. Tre parser degradati che riproducono, uno per volta, le
// tre garanzie dello scanner. Se un giorno qualcuno le toglie dal parser vero,
// questi casi restano verdi qui e ROSSI là: è il modo in cui il controllo si
// accorge di essere diventato inutile.
console.log('\n12. Controprove — le versioni degradate DEVONO fallire');

/** Com'era prima: recinto, prima graffa, tutto il resto dentro JSON.parse. */
function parserVecchio(text: string): unknown {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (!s.startsWith('{')) { const i = s.indexOf('{'); if (i >= 0) s = s.slice(i); }
  return JSON.parse(s);
}

/** Bilancia le graffe ma IGNORA le stringhe. */
function parserSenzaStringhe(text: string): unknown {
  const s = text.trim();
  const start = s.indexOf('{');
  if (start < 0) throw new Error('no object');
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return JSON.parse(s.slice(start, i + 1)); }
  }
  throw new Error('incomplete');
}

/** Bilancia e conosce le stringhe, ma NON gli escape. */
function parserSenzaEscape(text: string): unknown {
  const s = text.trim();
  const start = s.indexOf('{');
  if (start < 0) throw new Error('no object');
  let depth = 0, inString = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return JSON.parse(s.slice(start, i + 1)); }
  }
  throw new Error('incomplete');
}

function rompe(fn: (t: string) => unknown, input: string, label: string) {
  let rotto = false;
  try { fn(input); } catch { rotto = true; }
  ok(rotto, label);
}
function regge(fn: (t: string) => unknown, input: string, label: string) {
  let rotto = false;
  try { fn(input); } catch { rotto = true; }
  ok(!rotto, label);
}

// (a) Senza bilanciamento, il testo DOPO l'oggetto entra in JSON.parse.
rompe(parserVecchio, 'Ecco:\n{"status":"ok"}\nHo mantenuto i dati separati.',
  'a · il parser VECCHIO fallisce sul testo dopo l\'oggetto');
regge(parseModelJson, 'Ecco:\n{"status":"ok"}\nHo mantenuto i dati separati.',
  'a · quello nuovo lo legge');
rompe(parserVecchio, '{"a":1}{"b":2}', 'a-bis · il vecchio fallisce su due oggetti consecutivi');
regge(parseModelJson, '{"a":1}{"b":2}', 'a-bis · il nuovo prende il primo');

// (b) Senza stato di stringa, una graffa dentro una stringa chiude l'oggetto.
rompe(parserSenzaStringhe, '{"t":"chiudo qui }","u":2}',
  'b · senza stato di STRINGA, una graffa dentro le virgolette rompe');
regge(parseModelJson, '{"t":"chiudo qui }","u":2}',
  'b · quello nuovo la ignora, com\'è giusto');

// (c) Senza stato di escape, una virgoletta escaped ribalta dentro/fuori stringa.
rompe(parserSenzaEscape, '{"t":"ha detto \\"} fine\\"","u":2}',
  'c · senza ESCAPE, una virgoletta escaped rompe');
regge(parseModelJson, '{"t":"ha detto \\"} fine\\"","u":2}',
  'c · quello nuovo la gestisce');
// ⚠️ IL CASO DISCRIMINANTE È LA VIRGOLETTA ESCAPED, NON IL BACKSLASH DOPPIO.
// La prima stesura asseriva qui che `{"t":"backslash \\\\","u":"}"}` rompesse
// il parser senza escape: NON lo rompe, e la misura ha avuto ragione contro
// l'intuizione. I backslash pari si annullano e l'alternanza delle virgolette
// resta in fase; a sfasarla è un numero DISPARI di backslash prima di una
// virgoletta. Un'asserzione sbagliata in una controprova è peggio di
// un'asserzione mancante: dichiara provata una garanzia che non ha provato.
rompe(parserSenzaEscape, '{"t":"chiude \\" e poi } prosegue","u":2}',
  'c-bis · una virgoletta escaped a metà stringa sfasa il parser senza escape');
regge(parseModelJson, '{"t":"chiude \\" e poi } prosegue","u":2}',
  'c-bis · quello nuovo resta in fase');
// E il backslash PARI, dove il degradato sopravvive per caso, il parser vero
// deve comunque leggerlo con il valore giusto — che è un'asserzione sul
// RISULTATO, non sul fatto che qualcosa esploda.
vale('{"t":"backslash \\\\","u":"}"}', { t: 'backslash \\', u: '}' },
  'c-ter · backslash pari: il degradato regge per caso, il vero legge il valore giusto');

// (d) La controprova della controprova: i tre degradati NON devono essere
// verdi su tutto, altrimenti sarebbero inerti — su un caso semplice reggono.
regge(parserVecchio, '{"a":1}', 'd · i degradati NON sono rotti a prescindere: sul caso semplice reggono');
regge(parserSenzaStringhe, '{"a":1}', 'd · idem senza-stringhe');
regge(parserSenzaEscape, '{"a":1}', 'd · idem senza-escape');

console.log(`\n${pass} passati, ${fail} falliti\n`);
process.exit(fail ? 1 : 0);
