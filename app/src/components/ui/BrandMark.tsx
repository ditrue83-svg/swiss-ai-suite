// ============================================================================
// IL MARCHIO — quello del titolare, non una sua imitazione.
//
// ⚠️ FINO AL 2026-08-14 QUESTO COMPONENTE RICOMPONEVA IL SEGNO IN INTER: un
// blocco pieno con la sigla «AI» e la parola «Swisse» composte come TESTO,
// leggendo il nome da `brand.name` e dividendolo sul trattino. La motivazione
// scritta allora era che il prodotto parla in Inter. Il difetto lo si vedeva
// nella stessa scheda del browser: la FAVICON portava già i contorni veri del
// marchio (index.html), la barra laterale ne mostrava una ricostruzione — due
// disegni dello stesso segno a due centimetri di distanza, e nessuno dei due
// uguale a ciò che il titolare serve su ai-swisse.com.
//
// Un marchio ricomposto è un marchio somigliante, e un marchio somigliante è
// un secondo marchio. Ora il segno è UNO: i contorni stanno in `brandArt.ts`,
// copiati dall'artefatto della vetrina e sorvegliati da `npm run brand:check`.
//
// ⚠️ IL BLU DEL MARCHIO NON È IL BLU D'AZIONE, e la distinzione è deliberata.
// `--brand` (#00AEEF) è il colore del titolare; `--accent` resta il blu più
// fondo che serve ai pulsanti e ai link, dove il testo deve raggiungere il
// contrasto AA. Un marchio non è testo corrente e non ha quella soglia da
// rispettare — imporgliela significherebbe cambiare il colore dell'azienda per
// una regola che non lo riguarda. Prima del 2026-08-14 i due blu divergevano e
// la divergenza era dichiarata: adesso il marchio ha il suo, e l'azione il suo.
//
// ⚠️ IL NOME NON SI SCRIVE A MANO. Non compare più come testo — è un disegno —
// ma resta il NOME ACCESSIBILE dell'immagine, e viene da `brand.name` dei
// dizionari: chi usa un lettore di schermo sente «AI-Swisse», non «immagine».
// ============================================================================
import { useT } from '@/i18n';
import { BLOCCO, BLOCCO_VIEWBOX, MARCHIO_VIEWBOX, TRACCIATO_PAROLA, TRACCIATO_SIGLA } from './brandArt';

/**
 * Divide il nome del marchio nelle sue due parti: la sigla che sta nel blocco
 * e la parola che le sta accanto. «AI-Swisse» → ['AI', 'Swisse'].
 *
 * ⚠️ NON SERVE PIÙ A COMPORRE IL SEGNO — il segno è in contorni — ma resta la
 * prova che il nome nei dizionari ha ancora la forma che il marchio DISEGNA:
 * `test:shell-unit` pretende che tutti e tre si dividano, e un dizionario che
 * un giorno scrivesse «AISwisse» o «AI Swisse» starebbe nominando un prodotto
 * diverso da quello che il blocco e la parola raccontano.
 */
export function dividiMarchio(nome: string): [string, string] | null {
  const i = nome.indexOf('-');
  if (i <= 0 || i >= nome.length - 1) return null;
  return [nome.slice(0, i), nome.slice(i + 1)];
}

/**
 * Il marchio completo: blocco + parola, più la riga di sottotitolo.
 *
 * `tagline` a false dove la riga sotto non serve: nella barra stretta del
 * telefono il marchio sta accanto all'hamburger e alla campanella, e una
 * seconda riga lo farebbe crescere in altezza dentro una barra di altezza fissa.
 */
export function BrandMark({ tagline = true }: { tagline?: boolean }) {
  const t = useT();
  return (
    <div className="brand-lockup">
      <svg className="brand-logo" viewBox={MARCHIO_VIEWBOX} role="img" aria-label={t('brand.name')}>
        <rect className="bm-block" x={BLOCCO.x} y={BLOCCO.y} width={BLOCCO.w} height={BLOCCO.h} />
        <path className="bm-sigla" d={TRACCIATO_SIGLA} />
        <path className="bm-word" d={TRACCIATO_PAROLA} />
      </svg>
      {tagline && <div className="brand-sub">{t('brand.tagline')}</div>}
    </div>
  );
}

/**
 * Il solo blocco con la sigla, per gli spazi quadrati dove la parola non
 * starebbe: è la stessa forma della favicon e della schermata iniziale del
 * telefono, così il segno resta uno anche quando è piccolo.
 */
export function BrandBlock({ className }: { className?: string }) {
  const t = useT();
  return (
    <svg
      className={`brand-block${className ? ` ${className}` : ''}`}
      viewBox={BLOCCO_VIEWBOX}
      role="img"
      aria-label={t('brand.name')}
    >
      <rect className="bm-block" x={BLOCCO.x} y={BLOCCO.y} width={BLOCCO.w} height={BLOCCO.h} />
      <path className="bm-sigla" d={TRACCIATO_SIGLA} />
    </svg>
  );
}
