// ============================================================================
// Calendario — la proiezione temporale delle Attività.
//
// NON È UN SECONDO GESTORE DI ATTIVITÀ. Qui non si crea, non si modifica e non
// si completa niente: la fonte di verità resta `tasks`, e questa schermata
// risponde a una domanda sola — quando il lavoro richiede attenzione.
// Il pulsante «nuova attività» di un giorno non apre un modulo suo: porta ad
// Attività con la data già compilata, cioè allo STESSO modulo che si usa da
// lì (§17). Due moduli di creazione avrebbero significato due posti in cui
// ricordarsi della priorità proposta e dei passaggi derivati da un'analisi.
//
// TRE COSE CHE QUESTA PAGINA NON PUÒ PERMETTERSI DI NASCONDERE
//   1. LE SCADUTE. Restano in un pannello proprio, sempre visibile, anche
//      quando appartengono a un mese che non si sta guardando. Una griglia
//      mensile che le fa sparire girando pagina è il modo più elegante di
//      perdere un problema (§20).
//   2. LE ATTIVITÀ SENZA SCADENZA. Non entrano nella griglia — non si inventa
//      una data — ma il loro numero si dichiara, con il collegamento per
//      andarle a vedere (§21).
//   3. IL FILTRO ATTIVO. «Le mie» è il valore predefinito, ed è scritto sul
//      pulsante premuto: un calendario che sembra vuoto perché un filtro è
//      attivo e invisibile è la trappola già trovata con le categorie dei
//      documenti nella 0017.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonLine } from '@/components/ui/states';
import { useAsync } from '@/hooks/useAsync';
import { useCompany } from '@/contexts/CompanyContext';
import { useI18n, useT } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { calendarService } from '@/services/calendarService';
import { useMembers } from '@/features/tasks/useMembers';
import { dueLabel, statusLabelKey } from '@/features/tasks/taskFormat';
import {
  MAX_PER_DAY, addDays, agendaGroups, buildMonthGrid, currentItems, gridRange,
  groupByDay, overdueByDays, overdueItems, shiftMonth, shortTitle, todayISO,
} from './calendarModel';
import type { CalendarTaskItem, TaskPriority, TaskStatus } from '@/types/models';

type CalView = 'mese' | 'agenda';

/** Quanto avanti guarda l'agenda. Tre mesi: oltre, si sfoglia il mese. */
const AGENDA_DAYS = 90;

/**
 * Dalla priorità del database alla parola con cui il prodotto la chiama.
 * È la stessa mappa che usano Attività e Panoramica, e serve sia per la classe
 * CSS sia per l'etichetta tradotta: tenerle allineate a mano in tre schermate
 * significherebbe che prima o poi un badge verde dirà «Alta».
 */
const PRIORITY_WORD: Record<TaskPriority, 'alta' | 'media' | 'bassa'> = {
  high: 'alta', medium: 'media', low: 'bassa',
};

/**
 * La vista iniziale dipende dalla larghezza dello schermo.
 *
 * Su un telefono una griglia a sette colonne resta leggibile ma non è il modo
 * naturale di guardare le proprie scadenze: l'agenda lo è (§97). È un DEFAULT,
 * non un vincolo — i due pulsanti restano lì, e la scelta finisce nell'URL.
 */
const NARROW = '(max-width: 720px)';

function defaultView(): CalView {
  try {
    return window.matchMedia(NARROW).matches ? 'agenda' : 'mese';
  } catch {
    return 'mese';
  }
}

/**
 * Vero su schermo stretto. Serve alla griglia, non al valore predefinito della
 * vista: quello si decide una volta all'apertura e non deve cambiare sotto le
 * mani di chi sta ruotando il telefono.
 */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => {
    try { return window.matchMedia(NARROW).matches; } catch { return false; }
  });
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia(NARROW); } catch { return; }
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export function CalendarPage() {
  const t = useT();
  const L = useLabels();
  const { localeTag } = useI18n();
  const { activeCompanyId } = useCompany();
  const navigate = useNavigate();
  const companyId = activeCompanyId as string;
  const { members } = useMembers();

  const [params, setParams] = useSearchParams();
  const [fallbackView] = useState<CalView>(defaultView);
  const view = (params.get('vista') as CalView) || fallbackView;
  const mine = params.get('ambito') !== 'tutte';
  const narrow = useNarrow();

  const today = todayISO();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });

  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [assignee, setAssignee] = useState('');
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // L'intervallo da chiedere al database dipende dalla vista: la griglia vuole
  // le settimane che disegna, l'agenda i prossimi tre mesi. Mai «tutto» (§23).
  const range = useMemo(() => (
    view === 'mese'
      ? gridRange(cursor.year, cursor.month)
      : { from: today, to: addDays(today, AGENDA_DAYS) }
  ), [view, cursor.year, cursor.month, today]);

  const { loading, error, data, reload } = useAsync(
    () => Promise.all([
      calendarService.range(companyId, range.from, range.to, {
        mine,
        priority: priority || null,
        status: status || null,
        assigneeUserId: assignee || null,
      }),
      calendarService.undatedCount(companyId, mine),
    ]).then(([items, undated]) => ({ items, undated })),
    [companyId, range.from, range.to, mine, priority, status, assignee],
  );

  const items = data?.items ?? [];
  const undated = data?.undated ?? 0;
  const overdue = useMemo(() => overdueItems(items), [items]);
  const current = useMemo(() => currentItems(items), [items]);

  useEffect(() => { setExpandedDay(null); }, [view, cursor.year, cursor.month, mine]);

  function setView(next: CalView) {
    const p = new URLSearchParams(params);
    p.set('vista', next);
    setParams(p);
  }

  function setScope(nextMine: boolean) {
    const p = new URLSearchParams(params);
    if (nextMine) p.delete('ambito'); else p.set('ambito', 'tutte');
    setParams(p);
  }

  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month - 1, 1))
    .toLocaleDateString(localeTag, { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('calendar.title')}</div>
        <div className="page-desc">{t('calendar.subtitle')}</div>
      </div>

      <div className="row-wrap">
        <span className="filter-group">
          <button className={`btn btn-sm${view === 'mese' ? ' btn-primary' : ''}`}
            onClick={() => setView('mese')} aria-pressed={view === 'mese'}>
            {t('calendar.viewMonth')}
          </button>
          <button className={`btn btn-sm${view === 'agenda' ? ' btn-primary' : ''}`}
            onClick={() => setView('agenda')} aria-pressed={view === 'agenda'}>
            {t('calendar.viewAgenda')}
          </button>
        </span>
        <span className="filter-group">
          <button className={`btn btn-sm${mine ? ' btn-primary' : ''}`}
            onClick={() => setScope(true)} aria-pressed={mine}>
            {t('calendar.scopeMine')}
          </button>
          <button className={`btn btn-sm${!mine ? ' btn-primary' : ''}`}
            onClick={() => setScope(false)} aria-pressed={!mine}>
            {t('calendar.scopeAll')}
          </button>
        </span>
        <Link className="btn btn-sm push-right" to="/calendario/impostazioni">
          <Icon name="settings" className="ic-sm" /> {t('calendar.settings')}
        </Link>
      </div>

      {/* ⚠️ Le scadute stanno FUORI dalla griglia e prima di essa. Dentro
          sarebbero legate al mese che si sta guardando, e sparirebbero
          voltando pagina — che è esattamente il contrario di ciò che serve. */}
      {overdue.length > 0 && (
        <div className="card cal-overdue mt-16">
          <div className="card-title">
            <span>{t('calendar.overdueTitle')}</span>
            <span className="badge badge-alta">
              {overdue.length === 1 ? t('calendar.overdueOne') : t('calendar.overdueMany', { n: overdue.length })}
            </span>
          </div>
          {overdue.slice(0, 6).map((task) => (
            <Link key={task.id} className="list-row is-link" to={`/attivita/${task.id}`}>
              <div className="list-main">
                <div className="list-title">{task.title}</div>
                <div className="list-sub">
                  {task.assigneeName ?? t('tasks.unassigned')} · {t(statusLabelKey(task.status))}
                </div>
              </div>
              <span className="badge badge-alta">
                {overdueByDays(task) === 1
                  ? t('calendar.overdueByOne')
                  : t('calendar.overdueByDays', { n: overdueByDays(task) })}
              </span>
            </Link>
          ))}
          {overdue.length > 6 && (
            <Link className="btn btn-sm mt-10" to="/attivita?vista=overdue">{t('calendar.openTasks')}</Link>
          )}
        </div>
      )}

      <div className="card mt-16">
        <div className="cal-toolbar">
          {view === 'mese' ? (
            <>
              <div className="cal-nav">
                <button className="btn btn-sm btn-icon" aria-label={t('calendar.prevMonth')}
                  onClick={() => setCursor((c) => shiftMonth(c.year, c.month, -1))}>
                  <Icon name="arrowLeft" className="ic-sm" />
                </button>
                <button className="btn btn-sm" onClick={() => {
                  const now = new Date();
                  setCursor({ year: now.getFullYear(), month: now.getMonth() + 1 });
                }}>{t('calendar.today')}</button>
                <button className="btn btn-sm btn-icon" aria-label={t('calendar.nextMonth')}
                  onClick={() => setCursor((c) => shiftMonth(c.year, c.month, 1))}>
                  <Icon name="arrowRight" className="ic-sm" />
                </button>
              </div>
              {/* `aria-live` perché il titolo cambia senza che la pagina cambi:
                  chi non vede la griglia deve sapere dove è finito. */}
              <div className="cal-title" aria-live="polite">{monthLabel}</div>
            </>
          ) : (
            <div className="cal-title">{t('calendar.viewAgenda')}</div>
          )}

          <div className="cal-filters">
            <div className="field m-0">
              <select className="select-inline" value={priority} aria-label={t('calendar.filterPriority')}
                onChange={(e) => setPriority(e.target.value as TaskPriority | '')}>
                {/* ⚠️ I due punti stanno DENTRO la traduzione e non nel JSX: in
                    francese vogliono uno spazio davanti, quindi non sono un
                    segno «uguale in tutte le lingue». Il controllo i18n li
                    lascia passare proprio perché sembrano innocui. */}
                <option value="">{t('calendar.filterPriorityAny')}</option>
                <option value="high">{L.urgency('alta')}</option>
                <option value="medium">{L.urgency('media')}</option>
                <option value="low">{L.urgency('bassa')}</option>
              </select>
            </div>
            <div className="field m-0">
              <select className="select-inline" value={status} aria-label={t('calendar.filterStatus')}
                onChange={(e) => setStatus(e.target.value as TaskStatus | '')}>
                <option value="">{t('calendar.filterStatusAny')}</option>
                <option value="open">{t('tasks.statusOpen')}</option>
                <option value="in_progress">{t('tasks.statusInProgress')}</option>
                <option value="waiting">{t('tasks.statusWaiting')}</option>
                <option value="completed">{t('tasks.statusCompleted')}</option>
              </select>
            </div>
            {!mine && (
              <div className="field m-0">
                <select className="select-inline" value={assignee} aria-label={t('calendar.filterAssignee')}
                  onChange={(e) => setAssignee(e.target.value)}>
                  <option value="">{t('calendar.filterAssigneeAny')}</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>{m.name || t('tasks.unnamedMember')}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {loading && <><SkeletonLine width="100%" /><SkeletonLine width="100%" /><SkeletonLine width="80%" /></>}
        {error && <ErrorState message={error} onRetry={reload} />}

        {!loading && !error && view === 'mese' && (
          <MonthGrid
            year={cursor.year} month={cursor.month} items={current} today={today}
            expandedDay={expandedDay} onToggleDay={setExpandedDay} narrow={narrow}
            onCreate={(date) => navigate(`/attivita?nuova=${date}`)}
          />
        )}

        {!loading && !error && view === 'agenda' && (
          <AgendaList items={current} today={today}
            onCreate={(date) => navigate(`/attivita?nuova=${date}`)} />
        )}
      </div>

      {/* §21 — le attività senza scadenza si DICHIARANO. Non entrano nel
          calendario perché non hanno una data, e nessuno gliene inventa una. */}
      {!loading && !error && undated > 0 && (
        <div className="info-box mt-16">
          <Icon name="clock" className="ic-sm" />
          <div>
            <div>{undated === 1 ? t('calendar.undatedOne') : t('calendar.undatedMany', { n: undated })}</div>
            {/* Un pulsante e non un collegamento in linea: misurato a 375
                pixel, il link inline era alto 18 — sotto i 24 di WCAG 2.2. */}
            <Link className="btn btn-sm mt-8" to="/attivita">{t('calendar.openTasks')}</Link>
          </div>
        </div>
      )}
    </>
  );
}

// ---- Vista mese --------------------------------------------------------------

/**
 * ⚠️ SU SCHERMO STRETTO LE ATTIVITÀ NON SONO COLLEGAMENTI.
 *
 * Trovato misurando la schermata a 375 pixel, non leggendo il codice: le righe
 * delle attività diventavano barre alte SEI pixel — e restavano collegamenti.
 * WCAG 2.2 chiede bersagli da 24, ed è la stessa classe di difetto già corretta
 * nella 0016 su `.mini-btn` e sulle caselle della checklist.
 *
 * Ingrandirle non era una strada: tre bersagli da 24 pixel non stanno in una
 * casella alta 62. La soluzione è cambiare COSA fa la griglia su un telefono:
 * diventa una panoramica — dove si concentra il lavoro — e le barre sono
 * indicatori, non controlli. L'unico controllo della casella è il numero del
 * giorno, che è già grande abbastanza. Le attività si aprono dall'AGENDA, che
 * su telefono è la vista predefinita proprio per questo (§97).
 *
 * Le barre escono anche dall'albero di accessibilità: un collegamento che non
 * si può premere ma che uno screen reader annuncia sarebbe un vicolo cieco. Il
 * conteggio vero resta nell'etichetta della casella.
 */
function MonthGrid({
  year, month, items, today, expandedDay, onToggleDay, onCreate, narrow,
}: {
  year: number; month: number; items: CalendarTaskItem[]; today: string;
  expandedDay: string | null; onToggleDay: (d: string | null) => void;
  onCreate: (date: string) => void; narrow: boolean;
}) {
  const t = useT();
  const { localeTag } = useI18n();
  const weeks = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const byDay = useMemo(() => groupByDay(items), [items]);

  // Le intestazioni dei giorni nella lingua di chi guarda. Si prendono da una
  // settimana vera: il 5 gennaio 2026 è un lunedì, quindi la sequenza è giusta
  // per costruzione invece che per un elenco scritto a mano tre volte.
  const weekdays = useMemo(() => (
    Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 0, 5 + i))
      .toLocaleDateString(localeTag, { weekday: 'short', timeZone: 'UTC' }))
  ), [localeTag]);

  const longDate = (day: string) => new Date(`${day}T12:00:00Z`)
    .toLocaleDateString(localeTag, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  if (items.length === 0) {
    return (
      <div className="empty">
        <div>{t('calendar.emptyMonth')}</div>
        <div className="muted-sm mt-10">{t('calendar.emptyHint')}</div>
      </div>
    );
  }

  return (
    <table className="cal-grid">
      <caption className="cal-caption">
        {new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(localeTag, { month: 'long', year: 'numeric', timeZone: 'UTC' })}
      </caption>
      <thead>
        <tr>{weekdays.map((w) => <th key={w} scope="col">{w}</th>)}</tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0].date}>
            {week.map((day) => {
              const dayItems = byDay.get(day.date) ?? [];
              const expanded = expandedDay === day.date;
              const shown = expanded ? dayItems : dayItems.slice(0, MAX_PER_DAY);
              const hidden = dayItems.length - shown.length;
              const isToday = day.date === today;
              return (
                <td
                  key={day.date}
                  className={`cal-cell${day.inMonth ? '' : ' out'}${isToday ? ' today' : ''}`}
                  aria-label={
                    (dayItems.length
                      ? t('calendar.dayAria', { date: longDate(day.date), n: dayItems.length })
                      : t('calendar.dayAriaEmpty', { date: longDate(day.date) }))
                    // Oggi non è indicato solo dal colore: lo dice anche
                    // l'etichetta, e visivamente è un cerchio pieno (§98).
                    + (isToday ? ` — ${t('calendar.dayAriaToday')}` : '')
                  }
                >
                  <button
                    className="cal-daynum"
                    onClick={() => onCreate(day.date)}
                    aria-label={t('calendar.newTaskOn', { date: longDate(day.date) })}
                  >
                    {Number(day.date.slice(8, 10))}
                  </button>
                  {shown.map((task) => (narrow ? (
                    <span
                      key={task.id}
                      className={`cal-item p-${task.priority}${task.status === 'completed' ? ' is-done' : ''}`}
                      aria-hidden="true"
                    />
                  ) : (
                    <Link
                      key={task.id}
                      className={`cal-item p-${task.priority}${task.status === 'completed' ? ' is-done' : ''}`}
                      to={`/attivita/${task.id}`}
                      title={task.title}
                    >
                      {shortTitle(task.title)}
                    </Link>
                  )))}
                  {/* «+N» esiste solo dove le attività si possono davvero
                      aprire. Su telefono il numero vero sta nell'etichetta
                      della casella, e un pulsante che espande righe non
                      cliccabili non servirebbe a niente. */}
                  {!narrow && hidden > 0 && (
                    <button className="cal-more" onClick={() => onToggleDay(day.date)}
                      aria-label={t('calendar.moreAria', { n: hidden, date: longDate(day.date) })}>
                      {t('calendar.more', { n: hidden })}
                    </button>
                  )}
                  {!narrow && expanded && dayItems.length > MAX_PER_DAY && (
                    <button className="cal-more" onClick={() => onToggleDay(null)}>
                      {t('common.close')}
                    </button>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---- Vista agenda ------------------------------------------------------------

function AgendaList({
  items, today, onCreate,
}: { items: CalendarTaskItem[]; today: string; onCreate: (date: string) => void }) {
  const t = useT();
  const L = useLabels();
  const { localeTag } = useI18n();
  const groups = useMemo(() => agendaGroups(items), [items]);

  if (groups.length === 0) {
    return (
      <div className="empty">
        <div>{t('calendar.emptyAgenda')}</div>
        <div className="muted-sm mt-10">{t('calendar.emptyHint')}</div>
        <button className="btn btn-sm mt-10" onClick={() => onCreate(today)}>
          <Icon name="plus" className="ic-sm" /> {t('calendar.createCta')}
        </button>
      </div>
    );
  }

  return (
    <div className="cal-agenda">
      {groups.map((group) => {
        const label = new Date(`${group.date}T12:00:00Z`).toLocaleDateString(localeTag, {
          weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
        });
        const due = dueLabel(group.date);
        return (
          <div key={group.date} className="cal-agenda-day">
            <div className="cal-agenda-head">
              <span className={group.date === today ? 'cal-agenda-date is-today' : 'cal-agenda-date'}>{label}</span>
              <span className="badge badge-neutral">{t(due.key, due.params)}</span>
            </div>
            {group.items.map((task) => (
              <Link key={task.id} className="list-row is-link" to={`/attivita/${task.id}`}>
                <div className="list-main">
                  <div className="list-title">{task.title}</div>
                  <div className="list-sub">
                    {task.assigneeName ?? t('tasks.unassigned')} · {t(statusLabelKey(task.status))}
                    {task.documentId ? <> · <Icon name="document" className="ic-sm" /></> : null}
                  </div>
                </div>
                {/* La priorità passa dalle etichette di dominio, come in
                    Attività e in Panoramica: una quarta traduzione scritta a
                    mano qui sarebbe la prima a restare indietro. */}
                <span className={`badge badge-${PRIORITY_WORD[task.priority]}`}>
                  {L.urgency(PRIORITY_WORD[task.priority])}
                </span>
              </Link>
            ))}
          </div>
        );
      })}
    </div>
  );
}
