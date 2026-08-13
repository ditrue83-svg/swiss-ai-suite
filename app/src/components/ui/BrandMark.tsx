// ============================================================================
// IL MARCHIO — un wordmark, non un'icona.
//
// PERCHÉ NON PIÙ UNA LETTERA IN UN QUADRATO. Il segno precedente era una «S»
// bianca dentro un quadrato accent di 32px (prima ancora era lo stesso path di
// `plus`, cioè un comando). Due difetti, entrambi visibili a schermo:
//   · un cerchio-o-quadrato pieno con una lettera dentro, in cima a una colonna,
//     è la forma dell'AVATAR: dice «ecco chi sei», non «ecco dove sei»;
//   · il contenitore aveva lo stesso peso della campanella accanto — due scatole
//     affiancate sono due pari grado, e il marchio non è un accessorio.
//
// PERCHÉ QUESTO. Non è un segno inventato: è il marchio che il titolare USA GIÀ
// sulla vetrina e sul dominio — blocco pieno con «AI», poi «Swisse» composto.
// Qui è ricomposto in Inter, il carattere del prodotto, invece che nei tracciati
// Poppins della vetrina. Chi arriva da ai-swisse.com e apre l'applicazione deve
// riconoscere lo stesso marchio, non crederne due.
//
// IL SEGNO MINIMO È IL BLOCCO, e non è un glifo: niente «+», «✓», «→» — quelli
// sono comandi. Niente gradienti, niente ombre, niente effetti.
//
// IL NOME NON SI TRADUCE, LA RIGA SOTTO SÌ. «AI-Swisse» è lo stesso nelle tre
// lingue e vive in un posto solo, `brand.name` dei dizionari: qui non è scritto
// a mano (`i18n:coverage` esce 1 se lo fosse) — si legge di lì e si divide sul
// trattino. Così il giorno in cui il nome cambia, il marchio lo segue.
// ============================================================================
import { useT } from '@/i18n';

/**
 * Divide il nome del marchio nelle sue due parti: la sigla che sta nel blocco
 * e la parola che le sta accanto. «AI-Swisse» → ['AI', 'Swisse'].
 *
 * Torna `null` quando il nome non ha la forma attesa, e NON inventa una
 * divisione plausibile: `test:shell-unit` pretende che tutti e tre i dizionari
 * si dividano, quindi un `null` non può arrivare in produzione — se ci
 * arrivasse, si vedrebbe il nome intero senza blocco, non un marchio storto.
 */
export function dividiMarchio(nome: string): [string, string] | null {
  const i = nome.indexOf('-');
  if (i <= 0 || i >= nome.length - 1) return null;
  return [nome.slice(0, i), nome.slice(i + 1)];
}

/**
 * `tagline` a false dove la riga sotto non serve: nella barra stretta del
 * telefono il marchio sta accanto all'hamburger e alla campanella, e una
 * seconda riga lo farebbe crescere in altezza dentro una barra di altezza fissa.
 */
export function BrandMark({ tagline = true }: { tagline?: boolean }) {
  const t = useT();
  const nome = t('brand.name');
  const parti = dividiMarchio(nome);
  return (
    <div className="brand-lockup">
      <div className="brand-word">
        {parti ? (
          <>
            <span className="brand-sigla">{parti[0]}</span>
            <span className="brand-name">{parti[1]}</span>
          </>
        ) : (
          <span className="brand-name">{nome}</span>
        )}
      </div>
      {tagline && <div className="brand-sub">{t('brand.tagline')}</div>}
    </div>
  );
}
