// ============================================================================
// AI-Swisse — service worker (Fase 3.1 della roadmap CRM, 2026-09-10).
//
// PERCHÉ ESISTE: rendere l'app installabile e avviabile anche senza rete.
// COSA NON FA, dichiarato: NON tiene i dati offline. Le attività, i clienti,
// i documenti arrivano sempre da Supabase online — una copia locale dei dati
// di un'amministrazione è un altro progetto, con domande di sicurezza sue.
// Senza rete l'app APRE (la shell c'è) e DICHIARA lo stato, invece di
// mostrare il dinosauro del browser.
//
// LE REGOLE, in una frase ciascuna:
//   - navigazioni: NETWORK-FIRST. index.html è il file che indica quale
//     bundle caricare (`public/_headers` lo serve no-cache apposta): servirlo
//     dalla cache a utente ONLINE significherebbe tenerlo fermo alla versione
//     di quando è passato il worker. La copia in cache è solo il paracadute
//     per l'apertura senza rete.
//   - /assets, /fonts, /icons: CACHE-FIRST. I nomi hanno hash o disciplina di
//     rinomina (`_headers`): a parità di nome il contenuto non cambia mai.
//   - TUTTO IL RESTO — Supabase, Edge Function, qualunque origine esterna:
//     MAI intercettato. Il worker non tocca ciò che non capisce.
//
// ⚠️ VERSIONE: a ogni modifica di QUESTO file si incrementa VERSIONE_CACHE.
// È ciò che fa scartare le cache vecchie in `activate`. I byte del file sono
// già il segnale di aggiornamento per il browser, ma la costante è ciò che
// svuota — dimenticarla lascia le copie vecchie affiancate per sempre.
// ============================================================================

const VERSIONE_CACHE = 'ai-swisse-v1';

// Ciò che serve ad APRIRE l'app senza rete: il documento (paracadute della
// navigazione), il manifest e le icone. I bundle JS/CSS di /assets non si
// precaricano: entrano in cache al primo passaggio online, grazie alla
// regola cache-first qui sotto.
const SHELL = ['/', '/manifest.webmanifest', '/icons/any-192.png', '/icons/any-512.png'];

const PERCORSI_IMMODIFICABILI = /^\/(assets|fonts|icons)\//;

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(VERSIONE_CACHE)
      .then((cache) => cache.addAll(SHELL))
      // Un worker nuovo prende il posto subito: aspettare la chiusura di
      // tutte le schede significherebbe «mai» su un telefono. La pagina
      // vecchia viene ricaricata una volta sola, da chi registra il worker.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomi) =>
        Promise.all(nomi.filter((n) => n !== VERSIONE_CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const { request } = evento;

  // Solo GET, solo la propria origine: tutto il resto (POST verso Supabase,
  // chiamate alle funzioni, qualunque origine esterna) passa senza che il
  // worker lo sfiori.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigazioni: rete prima, cache come paracadute. La copia fresca entra in
  // cache a ogni apertura online, così il paracadute non invecchia.
  if (request.mode === 'navigate') {
    evento.respondWith(
      fetch(request)
        .then((risposta) => {
          if (risposta.ok) {
            const copia = risposta.clone();
            caches.open(VERSIONE_CACHE).then((cache) => cache.put('/', copia));
          }
          return risposta;
        })
        .catch(() =>
          caches.match('/').then((shell) => shell || Response.error()),
        ),
    );
    return;
  }

  // Asset immutabili: cache prima, rete come fonte e riempimento.
  if (PERCORSI_IMMODIFICABILI.test(url.pathname)) {
    evento.respondWith(
      caches.match(request).then(
        (trovato) =>
          trovato ||
          fetch(request).then((risposta) => {
            if (risposta.ok) {
              const copia = risposta.clone();
              caches.open(VERSIONE_CACHE).then((cache) => cache.put(request, copia));
            }
            return risposta;
          }),
      ),
    );
    return;
  }

  // Il manifest cambia con le versioni dell'app (lo serve no-cache anche
  // `_headers`): rete prima, cache come paracadute — come le navigazioni.
  if (url.pathname === '/manifest.webmanifest') {
    evento.respondWith(
      fetch(request)
        .then((risposta) => {
          if (risposta.ok) {
            const copia = risposta.clone();
            caches.open(VERSIONE_CACHE).then((cache) => cache.put(request, copia));
          }
          return risposta;
        })
        .catch(() => caches.match(request).then((t) => t || Response.error())),
    );
  }
});
