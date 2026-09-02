// ============================================================================
// Gli specificatori di modulo di Deno, spiegati a TypeScript.
//
// ⚠️ PERCHÉ ESISTE. I moduli delle Edge Function importano le loro dipendenze
// come `jsr:@supabase/supabase-js@2` e `npm:@anthropic-ai/sdk`, che è il modo di
// Deno. `tsc` non sa risolvere quegli schemi e si ferma con TS2307 — quindi
// finora, appena una suite Node importava uno di quei file, il typecheck
// diventava rosso e l'unica via d'uscita era non importarli.
//
// Il prezzo di quella via d'uscita era alto e invisibile: **i moduli
// dell'Edge Function restavano fuori dal typecheck**.
//
// Qui l'alias dice a TypeScript ciò che è vero anche a runtime — è lo stesso
// pacchetto, con la stessa API — e le suite possono importare il CODICE VERO
// invece di riscriverne un'imitazione. Deno non legge questo file: gli
// specificatori continuano a funzionare come prima nelle funzioni deployate.
//
// ⚠️ LA VERSIONE NELLO SPECIFICATORE NON È VERIFICATA DA NESSUNO. `npm:…@2`
// dice a Deno quale scaricare; qui l'alias punta a ciò che sta in
// `node_modules`, cioè alla versione di `package.json`. Se le due divergono, il
// typecheck descrive una libreria diversa da quella che gira in produzione e
// **non se ne accorge**. È il limite dichiarato di questo file.
//
// ⚠️ QUESTO FILE È INCLUSO DA ENTRAMBI I `tsconfig` — quello principale, perché
// `scripts/` importa i moduli condivisi, e `tsconfig.functions.json`. Una
// SECONDA copia di queste righe divergerebbe dalla prima senza che nulla
// diventi rosso: è la ragione per cui stanno qui, e in un posto solo.
// ============================================================================

declare module 'jsr:@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js';
}

declare module 'npm:@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js';
}

declare module 'npm:@anthropic-ai/sdk' {
  export * from '@anthropic-ai/sdk';
  // ⚠️ `export *` NON riesporta il default, e le sette funzioni che usano l'SDK
  // lo importano esattamente così (`import Anthropic from …`). Senza questa
  // riga il typecheck le boccerebbe tutte e sette.
  export { default } from '@anthropic-ai/sdk';
}

declare module 'npm:pdf-lib@1.17.1' {
  export * from 'pdf-lib';
}

declare module 'npm:qrcode@1.5.4' {
  export * from 'qrcode';
}
