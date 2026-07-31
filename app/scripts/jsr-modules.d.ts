// ============================================================================
// Gli specificatori `jsr:` di Deno, spiegati a TypeScript.
//
// ⚠️ PERCHÉ ESISTE. I moduli delle Edge Function importano supabase-js come
// `jsr:@supabase/supabase-js@2`, che è il modo di Deno. `tsc` non sa risolvere
// quello schema e si ferma con TS2307 — quindi finora, appena una suite Node
// importava uno di quei file, il typecheck diventava rosso e l'unica via
// d'uscita era non importarli.
//
// Il prezzo di quella via d'uscita era alto e invisibile: **i moduli
// dell'Edge Function restavano fuori dal typecheck**. È la stessa lacuna già
// annotata per gli `index.ts` delle funzioni.
//
// Qui l'alias dice a TypeScript ciò che è vero anche a runtime — è lo stesso
// pacchetto, con la stessa API — e `test:subsidy` può importare il MOTORE VERO
// invece di riscriverne una imitazione. Deno non legge questo file: gli
// specificatori `jsr:` continuano a funzionare come prima nelle funzioni
// deployate.
// ============================================================================
declare module 'jsr:@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js';
}
