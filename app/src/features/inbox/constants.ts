// Costanti dell'Inbox condivise con il server.
//
// I valori vivono in `supabase/functions/_shared/email/contract.ts`, che è la
// fonte: là governano il comportamento reale della sincronizzazione. Qui sono
// ripetuti perché il bundle del frontend non può importare da `supabase/`
// (fuori dal `include` di tsconfig, e con estensioni `.ts` esplicite che Vite
// non risolve), e servono a UNA cosa sola: dire all'utente quanta posta verrà
// importata.
//
// La ripetizione è dichiarata invece che nascosta, e `npm run test:inbox-unit`
// verifica che i due file concordino: se qualcuno cambia il limite sul server
// senza aggiornare qui, il test fallisce invece di lasciare in pagina una frase
// che promette una cosa diversa da quella che accade.
export const INITIAL_SYNC_DAYS = 30;
export const INITIAL_SYNC_MAX_MESSAGES = 80;
