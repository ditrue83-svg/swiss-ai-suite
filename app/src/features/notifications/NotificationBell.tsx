// ============================================================================
// La campanella: il badge nell'intestazione e il pannello che si apre.
//
// ⚠️ SEGUE L'AZIENDA ATTIVA (§81)
// Cambiando azienda, elenco e conteggio si azzerano PRIMA di ricaricare. Senza
// quell'azzeramento, per la frazione di secondo della nuova richiesta si
// vedrebbero le notifiche dell'azienda precedente sotto il nome di quella
// nuova — che non è un ritardo di caricamento, è un'informazione falsa.
//
// ⚠️ NIENTE `setInterval` (§39)
// Il conteggio si aggiorna all'apertura del pannello, al cambio di pagina e al
// cambio di azienda. I promemoria li genera il server: non dipendono dal fatto
// che qualcuno tenga la scheda aperta, quindi la campanella non ha bisogno di
// interrogare il database ogni trenta secondi per essere corretta.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { ErrorState } from '@/components/ui/states';
import { toUserMessage } from '@/lib/errors';
import { useCompany } from '@/contexts/CompanyContext';
import { useI18n, useT } from '@/i18n';
import { notificationService } from '@/services/notificationService';
import { badgeLabel, isProblem, notificationLink, notificationTitleKey, relativeTime } from './notificationFormat';
import { formatDate } from '@/lib/format';
import { cx } from '@/lib/cx';
import styles from './notifications.module.css';
import type { AppNotification } from '@/types/models';

/**
 * Il conteggio non lo tiene la campanella.
 *
 * ⚠️ Nell'AppShell la campanella è montata DUE volte — nella barra superiore
 * per il telefono e nella colonna laterale per il desktop — e il CSS ne nasconde
 * una delle due. Se ognuna tenesse il proprio conteggio, ogni caricamento di
 * pagina interrogherebbe il database due volte per la stessa risposta, e una
 * delle due richieste sarebbe per un pulsante che nessuno può premere.
 * Lo stato vive quindi nell'AppShell, che è l'unico posto in cui c'è UNA sola
 * copia di tutto.
 */
export function useUnreadCount(activeCompanyId: string | null) {
  const [count, setCount] = useState(0);
  const location = useLocation();

  const refresh = useCallback(async () => {
    if (!activeCompanyId) { setCount(0); return; }
    try {
      setCount(await notificationService.unreadCount(activeCompanyId));
    } catch {
      // Un conteggio che non si riesce a leggere resta com'era. Non si mostra
      // uno zero: «nessuna notifica» è un'affermazione, e non la sappiamo.
    }
  }, [activeCompanyId]);

  // Azzeramento IMMEDIATO al cambio azienda, poi ricarica. L'ordine conta: per
  // la frazione di secondo della nuova richiesta, un badge non azzerato
  // mostrerebbe il numero dell'azienda precedente sotto il nome di quella nuova
  // — che non è un ritardo di caricamento, è un'informazione falsa (§81).
  useEffect(() => {
    setCount(0);
    void refresh();
  }, [activeCompanyId, refresh]);

  // Cambiando pagina è probabile che qualcosa sia successo: si ricontrolla.
  useEffect(() => { void refresh(); }, [location.pathname, refresh]);

  return { count, setCount, refresh };
}

export interface NotificationBellProps {
  count: number;
  setCount: (updater: (n: number) => number) => void;
}

export function NotificationBell({ count, setCount }: NotificationBellProps) {
  const t = useT();
  const { localeTag } = useI18n();
  const { activeCompanyId } = useCompany();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  /**
   * ⚠️ «Non ho notifiche» e «non riesco a leggere le notifiche» sono due cose
   * diverse, e confonderle è il difetto già pagato con l'Inbox: con la 0013 non
   * applicata, la schermata mostrava serenamente «collega la posta aziendale»
   * invece dell'errore — un guasto travestito da stato legittimo.
   * Trovato di nuovo qui aprendo il pannello con la 0018 non ancora applicata:
   * diceva «Nessuna notifica». Ora il guasto viene PRIMA di qualunque
   * interpretazione.
   */
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setItems([]);
    setOpen(false);
  }, [activeCompanyId]);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const [list, fresh] = await Promise.all([
        notificationService.list(activeCompanyId, 20),
        notificationService.unreadCount(activeCompanyId),
      ]);
      setItems(list);
      setCount(() => fresh);
      setError(null);
    } catch (e) {
      setItems([]);
      setError(toUserMessage(e));
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, setCount]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void load();
  }

  // Chiusura con Esc e con un clic fuori: un pannello che si chiude solo
  // ripremendo il pulsante che lo ha aperto è una trappola su mobile.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  async function openNotification(n: AppNotification) {
    setOpen(false);
    if (!n.readAt) {
      try {
        await notificationService.markRead([n.id]);
        setCount((c: number) => Math.max(0, c - 1));
      } catch { /* la navigazione non dipende dalla marcatura */ }
    }
    navigate(notificationLink(n));
  }

  async function markAll() {
    if (!activeCompanyId) return;
    try {
      await notificationService.markAllRead(activeCompanyId);
      setItems((list) => list.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
      setCount(() => 0);
    } catch { /* niente cambia: il pannello resta com'è */ }
  }

  const badge = badgeLabel(count);

  return (
    <div className={styles.bellWrap}>
      <button
        ref={buttonRef}
        className={styles.bellBtn}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        // Il numero ESATTO sta qui: nell'etichetta lo spazio non è un problema,
        // e chi usa uno screen reader non deve accontentarsi di «9 più».
        aria-label={count > 0 ? t('notifications.bellAriaUnread', { n: count }) : t('notifications.bellAria')}
      >
        <Icon name="bell" />
        {badge && <span className={styles.bellBadge} aria-hidden="true">{badge}</span>}
      </button>

      {open && (
        <div className={styles.bellPanel} ref={panelRef} role="dialog" aria-label={t('notifications.title')}>
          <div className={styles.bellHead}>
            <span className={styles.bellTitle}>{t('notifications.title')}</span>
            {count > 0 && (
              <button className="btn btn-sm btn-link" onClick={() => void markAll()}>
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>

          {loading && <div className={styles.bellEmpty}>{t('states.loading')}</div>}

          {/* Il guasto viene PRIMA di qualunque interpretazione: finché non si
              sa cosa c'è, non si dice che non c'è niente. */}
          {!loading && error && <ErrorState message={error} onRetry={() => void load()} />}

          {!loading && !error && items.length === 0 && (
            <div className={styles.bellEmpty}>
              <div>{t('notifications.empty')}</div>
              <div className="muted-sm mt-10">{t('notifications.emptyHint')}</div>
            </div>
          )}

          {!loading && !error && items.map((n) => (
            <button
              key={n.id}
              className={cx(styles.bellRow, !n.readAt && styles.isUnread)}
              onClick={() => void openNotification(n)}
            >
              <span className={cx(styles.bellDot, isProblem(n.type) && styles.isProblem)} aria-hidden="true" />
              <span className={styles.bellMain}>
                <span className={styles.bellRowTitle}>{t(notificationTitleKey(n))}</span>
                {/* Il testo di un avviso prodotto da una regola lo ha scritto
                    l'azienda, e si mostra com'è: non passa dai dizionari perché
                    non è testo del prodotto, e tradurlo lo falserebbe. */}
                {n.payload?.text && <span className={styles.bellRowSub}>{n.payload.text}</span>}
                {n.payload?.title && <span className={styles.bellRowSub}>{n.payload.title}</span>}
                <span className={styles.bellRowMeta}>
                  {n.payload?.dueDate
                    ? t('notifications.deadline', { date: formatDate(n.payload.dueDate) })
                    : null}
                  {n.payload?.dueDate ? ' · ' : ''}
                  {relativeTime(n.createdAt, localeTag)}
                </span>
              </span>
            </button>
          ))}

          <div className={styles.bellFoot}>
            <Link className="btn btn-sm" to="/calendario/impostazioni" onClick={() => setOpen(false)}>
              <Icon name="settings" className="ic-sm" /> {t('calendar.settingsTitle')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
