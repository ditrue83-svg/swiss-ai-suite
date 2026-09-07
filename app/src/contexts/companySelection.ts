/**
 * Possiamo modificare o persistere la scelta dell'azienda solo quando sappiamo
 * a chi appartiene. Durante il ripristino iniziale `user` è ancora null, ma
 * non è un logout e la preferenza letta da localStorage va lasciata intatta.
 */
export function canCommitCompanySelection(authLoading: boolean, hasUser: boolean): boolean {
  return hasUser || !authLoading;
}
