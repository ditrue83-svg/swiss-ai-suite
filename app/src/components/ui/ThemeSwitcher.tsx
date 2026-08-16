// Scelta dell'aspetto: chiaro, scuro, o quello del sistema.
//
// Sta accanto al selettore della lingua, e non sotto «Impostazioni», per la
// ragione che quel commento dichiara già: è lì che l'utente si aspetta le
// impostazioni PERSONALI. Lingua e aspetto sono la stessa cosa — preferenze di
// chi guarda, su questo computer, che non riguardano l'azienda — e metterle in
// due posti diversi vorrebbe dire cercarle in due posti diversi. Stessa forma
// del selettore di lingua, di proposito: due controlli gemelli si imparano una
// volta sola.
//
// ⚠️ Con «Segui il sistema» il tema può cambiare mentre l'app è aperta — il
// portatile passa a scuro al tramonto. L'ascolto serve a quello, e si spegne
// quando la preferenza non è più «sistema»: un listener che resta acceso
// riscriverebbe il tema di chi ha appena scelto «chiaro».
import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { applicaTema, leggiTema, scegliTema, TEMI, type Tema } from '@/lib/theme';

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const [tema, setTema] = useState<Tema>(() => leggiTema());

  useEffect(() => {
    if (tema !== 'sistema') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applicaTema('sistema');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [tema]);

  return (
    <div className="field m-0">
      {!compact && <label htmlFor="theme-select" className="group-label">{t('nav.theme')}</label>}
      <select
        id="theme-select"
        aria-label={t('nav.theme')}
        value={tema}
        onChange={(e) => {
          const v = e.target.value as Tema;
          setTema(v);
          scegliTema(v);
        }}
        style={compact ? { padding: '4px 8px', fontSize: '0.85rem' } : undefined}
      >
        {TEMI.map((v) => <option key={v} value={v}>{t(`nav.themeOption.${v}` as const)}</option>)}
      </select>
    </div>
  );
}
