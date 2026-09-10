// ============================================================================
// Registrazione del service worker (Fase 3.1, 2026-09-10).
//
// DUE GUARDIE, entrambe necessarie:
//   - solo in PRODUZIONE: in sviluppo un worker che mette in cache la shell
//     renderebbe ogni ricarica una sorpresa (e Vite serve moduli, non bundle);
//   - solo dove l'API esiste: un browser senza service worker non deve
//     accorgersi di niente.
//
// L'AGGIORNAMENTO. Il worker nuovo fa `skipWaiting` + `clients.claim`
// (public/sw.js): quando prende il controllo, la pagina aperta sta girando
// ancora coi file della versione precedente — mezze versioni non si mescolano,
// quindi si ricarica UNA VOLTA. Il trucco è installare l'ascoltatore SOLO se
// un worker controllava già la pagina all'avvio: alla primissima installazione
// `controller` è null, e senza questa distinzione ogni primo avvio farebbe un
// giro di ricarica in più, pagato da chi installa l'app.
// ============================================================================
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  const controllataAllAvvio = navigator.serviceWorker.controller !== null;
  if (controllataAllAvvio) {
    let ricaricato = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (ricaricato) return;
      ricaricato = true;
      window.location.reload();
    });
  }

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
