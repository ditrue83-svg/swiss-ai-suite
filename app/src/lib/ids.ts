// ============================================================================
// La FORMA di un identificativo. Non la sua esistenza: quella la sa il database.
//
// PERCHÉ VIVE QUI E NON DENTRO UN MODULO
// Era scritta in `features/incentives/incentivesModel.ts`, dove è nata per
// chiudere un difetto preciso: `/incentivi?progetto=abc` faceva arrivare a
// schermo «invalid input syntax for type uuid: "abc"» — una stringa tecnica,
// in inglese, dentro un'interfaccia che può essere tedesca. Lo stesso indirizzo
// malformato è possibile ovunque un identificativo viaggi nella query, e
// l'Inbox (`/inbox?msg=…`) aveva la stessa apertura. Scrivere una seconda
// espressione regolare sarebbe stata la solita coppia destinata a divergere.
//
// LA REGOLA, che vale per ogni parametro futuro: un identificativo MALFORMATO
// non è una selezione e si ignora; uno BEN FORMATO che non esiste RESTA una
// selezione, perché «non trovato» è la risposta vera e va detta.
// ============================================================================
export function isUuid(v: string | null | undefined): boolean {
  return typeof v === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
