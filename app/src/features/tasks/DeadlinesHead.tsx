// ============================================================================
// DeadlinesHead — la testata comune di «Scadenze e attività».
//
// Elenco (/attivita) e Calendario (/calendario) sono la STESSA area guardata
// in due modi: l'elenco dice che cosa, il calendario dice quando. Nella barra
// di navigazione c'è una voce sola, e questa testata — identica sulle due
// pagine — è ciò che tiene insieme l'area: stesso titolo (nav.tasks, la
// stessa chiave della voce di menu: se uno dei due nomi cambiasse da solo,
// barra e pagina si contraddirebbero) e UN SOLO sottotitolo.
//
// ⚠️ IL SOTTOTITOLO È FISSO, e non è un dettaglio. Fino al 2026-08-13 ne
// arrivava uno diverso da ciascuna pagina — «Il lavoro da completare, ordinato
// per priorità e scadenza» di là, «Quando le attività dell'azienda richiedono
// attenzione» di qua — e premendo l'interruttore cambiavano insieme titolo
// dell'area e descrizione: due nomi per una cosa sola, che è esattamente il
// difetto che l'unificazione doveva togliere. Il sottotitolo descrive l'AREA,
// e i due modi si distinguono dall'interruttore, che è lì per quello.
//
// L'interruttore NAVIGA (due Link, non due bottoni di stato): le rotte
// restano entrambe vive perché stanno nei segnalibri e nelle email di
// notifica delle persone, e ciascuna conserva i propri parametri profondi
// (`?vista=`, `?nuova=` di là; `?vista=`, `?ambito=` di qua).
//
// ⚠️ NON `btn-primary`. Scegliere COME guardare non è l'azione della
// schermata: il blu d'azione qui competeva con «Nuova attività», e in vista
// calendario faceva tre pulsanti blu in fila con «Mese» e «Le mie». Lo stato
// è una superficie (`btn-toggle`) — la stessa scelta già fatta per
// «Attivi/Archiviati» dei Documenti, e per la stessa ragione.
// ============================================================================
import { Link } from 'react-router-dom';
import { useT } from '@/i18n';

export function DeadlinesHead({ mode }: { mode: 'list' | 'calendar' }) {
  const t = useT();
  return (
    <div className="page-head">
      <div className="page-title">{t('nav.tasks')}</div>
      <div className="page-desc">{t('tasks.areaSubtitle')}</div>
      {/* `aria-current="page"` e non `aria-pressed`: questi sono collegamenti,
          e ciò che dichiarano è quale pagina si sta guardando. */}
      <span className="segmented mt-8">
        <Link
          className="btn btn-sm btn-toggle"
          to="/attivita"
          aria-current={mode === 'list' ? 'page' : undefined}
        >
          {t('tasks.modeList')}
        </Link>
        <Link
          className="btn btn-sm btn-toggle"
          to="/calendario"
          aria-current={mode === 'calendar' ? 'page' : undefined}
        >
          {t('tasks.modeCalendar')}
        </Link>
      </span>
    </div>
  );
}
