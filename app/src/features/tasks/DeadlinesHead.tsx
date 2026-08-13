// ============================================================================
// DeadlinesHead — la testata comune di «Scadenze e attività».
//
// Elenco (/attivita) e Calendario (/calendario) sono la STESSA area guardata
// in due modi: l'elenco dice che cosa, il calendario dice quando. Nella barra
// di navigazione c'è una voce sola, e questa testata — identica sulle due
// pagine — è ciò che tiene insieme l'area: stesso titolo (nav.tasks, la
// stessa chiave della voce di menu: se uno dei due nomi cambiasse da solo,
// barra e pagina si contraddirebbero), sottotitolo proprio di ciascun modo,
// e l'interruttore per passare dall'uno all'altro.
//
// L'interruttore NAVIGA (due Link, non due bottoni di stato): le rotte
// restano entrambe vive perché stanno nei segnalibri e nelle email di
// notifica delle persone, e ciascuna conserva i propri parametri profondi
// (`?vista=`, `?nuova=` di là; `?vista=`, `?ambito=` di qua).
// ============================================================================
import { Link } from 'react-router-dom';
import { useT, type TKey } from '@/i18n';

export function DeadlinesHead({ mode, subtitleKey }: { mode: 'list' | 'calendar'; subtitleKey: TKey }) {
  const t = useT();
  return (
    <div className="page-head">
      <div className="page-title">{t('nav.tasks')}</div>
      <div className="page-desc">{t(subtitleKey)}</div>
      <div className="filter-group mt-8">
        <Link
          className={`btn btn-sm${mode === 'list' ? ' btn-primary' : ''}`}
          to="/attivita"
          aria-current={mode === 'list' ? 'page' : undefined}
        >
          {t('tasks.modeList')}
        </Link>
        <Link
          className={`btn btn-sm${mode === 'calendar' ? ' btn-primary' : ''}`}
          to="/calendario"
          aria-current={mode === 'calendar' ? 'page' : undefined}
        >
          {t('tasks.modeCalendar')}
        </Link>
      </div>
    </div>
  );
}
