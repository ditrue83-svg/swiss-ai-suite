// Selettore della lingua dell'interfaccia. Le opzioni sono scritte NELLA lingua
// che offrono (Deutsch, non «Tedesco»): chi non capisce l'italiano deve poterla
// riconoscere. La scelta è persistita e non richiede un nuovo accesso.
import { useId } from 'react';
import { useI18n, LOCALES, LOCALE_LABEL, type Locale } from '@/i18n';

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  // ⚠️ L'id viene da useId e non è scritto a mano: nell'albero autenticato
  // questo componente è montato DUE volte — colonna laterale e drawer — e il
  // CSS ne nasconde una. Un `id="lang-select"` scritto a mano era quindi
  // duplicato nel documento, e un `htmlFor` che lo cerca trova sempre il primo,
  // cioè può etichettare la tendina che nessuno vede. È la stessa ragione (e
  // la stessa cura) del gruppo Impostazioni in `AppShell.tsx`.
  const id = useId();

  return (
    <div className="field m-0">
      {!compact && <label htmlFor={id} className="group-label">{t('nav.language')}</label>}
      <select
        id={id}
        aria-label={t('nav.language')}
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        style={compact ? { padding: '4px 8px', fontSize: '0.85rem' } : undefined}
      >
        {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_LABEL[l]}</option>)}
      </select>
    </div>
  );
}
