// Scelta dell'aspetto: chiaro, scuro, o quello del sistema.
//
// Sta in DUE posti, e non è un doppione: nel piede della colonna, dove si
// raggiunge con un clic, e nel pannello «Preferenze» della finestra delle
// impostazioni, dove si va a cercarlo insieme alla lingua. Sono lo stesso
// controllo sullo stesso stato — vedi `sottoscriviTema` in `lib/theme.ts`, che
// è ciò che tiene d'accordo tutte le copie.
//
// ⚠️ Con «Segui il sistema» il tema può cambiare mentre l'app è aperta — il
// portatile passa a scuro al tramonto. L'ascolto serve a quello, e si spegne
// quando la preferenza non è più «sistema»: un listener che resta acceso
// riscriverebbe il tema di chi ha appena scelto «chiaro».
import { useEffect, useId, useSyncExternalStore } from 'react';
import { useT } from '@/i18n';
import { applicaTema, scegliTema, sottoscriviTema, temaCorrente, TEMI, type Tema } from '@/lib/theme';

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const t = useT();
  // ⚠️ NON `useState`: la preferenza è uno stato del DOCUMENTO, non di questo
  // componente, e le copie devono concordare. Il perché per esteso sta accanto
  // a `sottoscriviTema`.
  const tema = useSyncExternalStore(sottoscriviTema, temaCorrente, () => temaCorrente());
  // Stessa ragione del selettore di lingua: più copie nell'albero, e un id
  // scritto a mano sarebbe duplicato nel documento.
  const id = useId();

  useEffect(() => {
    if (tema !== 'sistema') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applicaTema('sistema');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [tema]);

  return (
    <div className="field m-0">
      {!compact && <label htmlFor={id} className="group-label">{t('nav.theme')}</label>}
      <select
        id={id}
        aria-label={t('nav.theme')}
        value={tema}
        onChange={(e) => scegliTema(e.target.value as Tema)}
        style={compact ? { padding: '4px 8px', fontSize: '0.85rem' } : undefined}
      >
        {TEMI.map((v) => <option key={v} value={v}>{t(`nav.themeOption.${v}` as const)}</option>)}
      </select>
    </div>
  );
}
