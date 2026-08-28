// ============================================================================
// Ladle — l'ambiente di prova dei componenti (issue #85).
//
// PERCHÉ LADLE E NON STORYBOOK. Il progetto tiene le dipendenze al minimo e
// ognuna si paga due volte (installazione e aggiornamenti): Storybook ne
// porta dietro decine, Ladle è un plugin sopra Vite — e Vite qui c'è già.
//
// PERCHÉ SOLO `components/ui`. Una storia isolata ha senso dove il componente
// non ha logica di business né dipendenze di ambiente: le primitive. Le
// schermate di `features/` chiedono router, auth e Supabase, e provarle qui
// vorrebbe dire ricostruire l'app dentro l'ambiente di prova.
// ============================================================================
export default {
  stories: 'src/components/ui/*.stories.tsx',
  // L'alias `@` → `src` sta nella config Vite dell'app: Ladle ne fonde le
  // opzioni che capisce (resolve), ignorando dev server e porta. Senza questa
  // riga gli import `@/i18n` dei componenti non risolverebbero.
  viteConfig: './vite.config.ts',
  // Il risultato del build resta dentro `dist/`, già ignorata da git: la
  // stessa regola del bundle dell'app, e nessuna voce nuova in .gitignore.
  outDir: 'dist/ladle',
};
