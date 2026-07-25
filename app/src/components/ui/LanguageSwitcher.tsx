// Selettore della lingua dell'interfaccia. Le opzioni sono scritte NELLA lingua
// che offrono (Deutsch, non «Tedesco»): chi non capisce l'italiano deve poterla
// riconoscere. La scelta è persistita e non richiede un nuovo accesso.
import { useI18n, LOCALES, LOCALE_LABEL, type Locale } from '@/i18n';

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="field" style={{ margin: 0 }}>
      {!compact && <label htmlFor="lang-select" className="group-label">{t('nav.language')}</label>}
      <select
        id="lang-select"
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
