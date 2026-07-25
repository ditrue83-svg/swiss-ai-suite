// ============================================================================
// Test della validazione del numero IDI/UID (cifra di controllo mod-11).
//   npm run test:uid
// Funzione pura: nessuna rete, nessuna credenziale.
// ============================================================================
import { uidDigits, expectedCheckDigit, isValidUid, formatUid } from '../src/lib/uid.ts';

let pass = 0, fail = 0;
const ok = (cond: boolean, label: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
};

console.log('\nTest IDI/UID — cifra di controllo e formattazione\n');

// 1) UID reale noto: CHE-116.281.710 (cifra di controllo 0).
console.log('1) UID reale noto');
ok(isValidUid('CHE-116.281.710'), 'CHE-116.281.710 è valido');
ok(expectedCheckDigit('11628171') === 0, 'cifra di controllo attesa = 0');

// 2) Round-trip: da 8 cifre qualsiasi costruisco un UID valido e lo verifico.
console.log('\n2) Round-trip su UID generati');
let built = 0, builtOk = 0, notAttributable = 0;
for (let n = 0; n < 500; n++) {
  const first8 = String(10_000_000 + ((n * 7919) % 89_999_999)).slice(0, 8);
  const c = expectedCheckDigit(first8);
  if (c == null) { notAttributable++; continue; }
  built++;
  if (isValidUid(`CHE${first8}${c}`)) builtOk++;
}
ok(built > 400, `generati ${built} UID validi (scartati ${notAttributable} non attribuibili)`);
ok(builtOk === built, `tutti i generati passano la verifica (${builtOk}/${built})`);

// 3) Errori di battitura: una cifra sbagliata deve essere respinta.
console.log('\n3) Rilevamento errori di battitura');
ok(!isValidUid('CHE-116.281.711'), 'cifra di controllo errata → respinto');
ok(!isValidUid('CHE-116.281.720'), 'penultima cifra alterata → respinto');
ok(!isValidUid('CHE-115.281.710'), 'terza cifra alterata → respinto');

let typosCaught = 0, typosTotal = 0;
const base = '116281710';
for (let pos = 0; pos < 9; pos++) {
  for (let d = 0; d <= 9; d++) {
    if (Number(base[pos]) === d) continue;
    typosTotal++;
    const mutated = base.slice(0, pos) + d + base.slice(pos + 1);
    if (!isValidUid(`CHE${mutated}`)) typosCaught++;
  }
}
ok(typosCaught === typosTotal, `tutti gli errori di 1 cifra rilevati (${typosCaught}/${typosTotal})`);

// 4) Trasposizioni di cifre adiacenti (errore comune di digitazione).
console.log('\n4) Trasposizioni adiacenti');
let trCaught = 0, trTotal = 0;
for (let i = 0; i < 8; i++) {
  if (base[i] === base[i + 1]) continue;
  trTotal++;
  const arr = base.split('');
  [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
  if (!isValidUid(`CHE${arr.join('')}`)) trCaught++;
}
ok(trCaught === trTotal, `tutte le trasposizioni rilevate (${trCaught}/${trTotal})`);

// 5) Formati d'ingresso accettati (l'utente scrive come vuole).
console.log('\n5) Formati accettati');
for (const v of ['CHE-116.281.710', 'CHE116281710', 'che 116 281 710', '116281710', 'CHE-116281710', 'CH-116.281.710'])
  ok(isValidUid(v), `«${v}» riconosciuto`);
ok(formatUid('che116281710') === 'CHE-116.281.710', 'normalizzazione → CHE-116.281.710');
ok(formatUid('116281710') === 'CHE-116.281.710', 'normalizzazione da sole cifre');

// 6) Input non validi.
console.log('\n6) Input non validi');
for (const v of ['', '12345', 'CHE-116.281.71', 'CHE-116.281.7100', 'ABC-116.281.710', 'non un numero'])
  ok(!isValidUid(v), `«${v}» respinto`);
ok(uidDigits('12345') === null, 'uidDigits su input corto → null');
ok(formatUid('non un numero') === null, 'formatUid su testo → null');

// 7) La cifra di controllo 10 non è attribuibile → nessun UID valido.
console.log('\n7) Combinazioni non attribuibili');
let unattributable = 0;
for (let n = 0; n < 300; n++) {
  const first8 = String(10_000_000 + n * 137).slice(0, 8);
  if (expectedCheckDigit(first8) == null) unattributable++;
}
ok(unattributable > 0, `rilevate ${unattributable} combinazioni con check=10 (correttamente escluse)`);

console.log(`\n${pass} passati, ${fail} falliti\n`);
process.exit(fail ? 1 : 0);
