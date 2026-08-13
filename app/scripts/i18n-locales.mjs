// ============================================================================
// L'ELENCO DEI DIZIONARI, in un posto solo — e non è questo file: è il disco,
// riconciliato con `LOCALES` in src/i18n/index.tsx.
//
// ⚠️ PERCHÉ ESISTE. Fino al 2026-08-13 «it, de, fr» era scritto a mano in
// fonts-check.mjs E in i18n-typography.mjs, oltre che in LOCALES: una QUARTA
// lingua aggiunta in src/i18n/locales/ non la guardava nessuno dei due — è
// stato provato con un rm.ts contenente mojibake e caratteri fuori gamma, che
// usciva verde da entrambi. Un dizionario che i guardiani non guardano è
// un'altra copia della stessa malattia: l'elenco scritto a mano che invecchia
// da solo.
//
// LA REGOLA. I dizionari sono i file .ts DENTRO src/i18n/locales/: chi ne
// aggiunge uno è coperto automaticamente. E l'elenco dal disco si riconcilia
// con LOCALES: un file senza dichiarazione (o una dichiarazione senza file) è
// un ERRORE esplicito, non una differenza silenziosa — la forma di FUORI_SUITE
// e delle eccezioni di design:lint.
// ============================================================================
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * I percorsi dei dizionari, relativi all'app (`src/i18n/locales/it.ts`, …).
 * Lancia — con il rimedio nel messaggio — se il disco e LOCALES divergono:
 * un guardiano che prosegue su un elenco conteso darebbe un verde conteso.
 */
export function dizionari() {
  const cartella = join(APP, 'src', 'i18n', 'locales');
  const suDisco = readdirSync(cartella)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => f.replace(/\.ts$/, ''))
    .sort();

  const index = readFileSync(join(APP, 'src', 'i18n', 'index.tsx'), 'utf8');
  const m = /export const LOCALES = \[([^\]]*)\]/.exec(index);
  if (!m) {
    throw new Error('LOCALES non trovato in src/i18n/index.tsx: la fonte ha cambiato forma, '
      + 'e questo lettore va aggiornato con lei.');
  }
  const dichiarate = [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]).sort();

  if (suDisco.join(',') !== dichiarate.join(',')) {
    throw new Error(`i dizionari sul disco (${suDisco.join(', ') || 'nessuno'}) e LOCALES in `
      + `src/i18n/index.tsx (${dichiarate.join(', ') || 'nessuno'}) divergono: `
      + 'o manca un file, o manca una dichiarazione — nessuna delle due si ignora.');
  }

  return suDisco.map((l) => `src/i18n/locales/${l}.ts`);
}
