// ============================================================================
// LA RICERCA RAPIDA (⌘K) — le voci di menu, i documenti e le attività da un
// solo campo. Il campo nella barra in cima promette «⌘K» (riferimento
// «panoramica-ai-swisse.html», 2026-09-06); questa è la finestra che quel
// gesto — e il clic sul campo — apre davvero.
//
// ⚠️ È UN DIALOGO MODALE, e vale tutto ciò che `Dialog.tsx` spiega: il fuoco
// entra SUBITO (mai requestAnimationFrame: è sospeso quando il documento non è
// in primo piano, e il fuoco resterebbe sul corpo della pagina dietro il
// velo), torna da dove veniva alla chiusura, Esc chiude, il clic chiude solo
// se cade sul velo. NON riusa `<Dialog>` perché la superficie è un'altra:
// niente testata — il campo È la testata — e la tastiera pilota una lista,
// non un giro di fuoco.
//
// ⚠️ VA IN UN PORTALE: la barra in cui nasce ha `backdrop-filter`, e un
// antenato con filtro diventa il blocco di contenimento per `position: fixed`
// — il velo coprirebbe la barra e basta. Appeso al corpo del documento,
// `fixed` torna a significare «rispetto allo schermo».
//
// ⚠️ IL FUOCO È UNO SOLO: il campo. È il pattern combobox (APG): Tab non gira
// perché non c'è nient'altro da raggiungere — le frecce su/giù muovono
// l'opzione «corrente» (`aria-activedescendant`) e Invio la apre. Le opzioni
// restano cliccabili col puntatore ma fuori dall'ordine di tabulazione.
//
// ⚠️ LE RICERCHE PARTONO DOPO 200ms DI SILENZIO, non a ogni tasto: «con»,
// «cont», «contr» sarebbero tre interrogazioni per una sola intenzione. E un
// guasto di UN servizio spegne UN gruppo: se i documenti non rispondono, le
// pagine e le attività continuano a funzionare e il gruppo ferito dice perché
// è vuoto invece di fingersi senza risultati.
// ============================================================================
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useCompany } from '@/contexts/CompanyContext';
import { useT } from '@/i18n';
import { useDocumentLabel } from '@/i18n/documentLabel';
import { toUserMessage } from '@/lib/errors';
import { LEGACY_MODULES_ENABLED } from '@/lib/env';
import { documentHubService } from '@/services/documentHubService';
import { taskService } from '@/services/taskService';
import { NAV, isSection } from './nav';
import type { DocumentHubItem, TaskWithPeople } from '@/types/models';

/** Quante voci per gruppo: la finestra è un lanciatore, non un archivio —
 *  chi cerca di più apre la pagina del gruppo e raffina lì. */
const PER_GRUPPO = 5;

interface Opzione {
  id: string;
  icon: IconName;
  label: string;
  path: string;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const t = useT();
  const navigate = useNavigate();
  const { activeCompanyId, isAdmin } = useCompany();
  const documentLabel = useDocumentLabel();
  const uid = useId();
  const listId = `${uid}-list`;

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const [docs, setDocs] = useState<DocumentHubItem[] | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskWithPeople[] | null>(null);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  // Da dove veniva il fuoco: ci torna alla chiusura.
  const provenienza = useRef<HTMLElement | null>(null);

  // Ogni apertura riparte da campo e lista vuoti: una ricerca che mostra la
  // query di ieri sembra una risposta già data — e non lo è.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setDebounced('');
    setActive(0);
    setDocs(null); setDocsError(null);
    setTasks(null); setTasksError(null);
  }, [open]);

  // Il fuoco entra SUBITO (vedi la testata) e alla chiusura torna alla
  // provenienza: senza, la tabulazione ripartirebbe dal marchio.
  useEffect(() => {
    if (!open) return;
    provenienza.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => { provenienza.current?.focus?.(); };
  }, [open]);

  // Esc chiude (in cattura, con stopPropagation: sotto potrebbe esserci il
  // cassetto, che ha il suo Esc — un tasto chiude UNA cosa). Tab non esce dal
  // campo: in un combobox il punto di fuoco è uno, e le frecce fanno il suo
  // lavoro. La pagina sotto il velo non si raggiunge da tastiera finché la
  // ricerca è aperta.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key === 'Tab') e.preventDefault();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  // Lo scorrimento del corpo si ferma finché la finestra è aperta (salvando
  // il valore di prima: il cassetto potrebbe averlo già bloccato, e
  // ripristinare '' glielo riaprirebbe sotto il velo).
  useEffect(() => {
    if (!open) return;
    const prima = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prima; };
  }, [open]);

  // 200ms di silenzio prima di interrogare (vedi la testata).
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(id);
  }, [open, query]);

  // I DOCUMENTI. `attivo` è il cancello contro le risposte fuori ordine: una
  // risposta lenta della query precedente non deve scrivere sopra quella
  // nuova. Il guasto ferma QUESTO gruppo, non la finestra.
  useEffect(() => {
    if (!open || !debounced || !activeCompanyId) { setDocs(null); setDocsError(null); setDocsLoading(false); return; }
    let attivo = true;
    setDocsLoading(true);
    documentHubService.list(activeCompanyId, { query: debounced, limit: PER_GRUPPO })
      .then((page) => { if (attivo) { setDocs(page.items); setDocsError(null); } })
      .catch((e) => { if (attivo) { setDocs([]); setDocsError(toUserMessage(e)); } })
      .finally(() => { if (attivo) setDocsLoading(false); });
    return () => { attivo = false; };
  }, [open, debounced, activeCompanyId]);

  // LE ATTIVITÀ — stessa disciplina dei documenti.
  useEffect(() => {
    if (!open || !debounced || !activeCompanyId) { setTasks(null); setTasksError(null); setTasksLoading(false); return; }
    let attivo = true;
    setTasksLoading(true);
    taskService.list(activeCompanyId, { search: debounced, limit: PER_GRUPPO })
      .then((page) => { if (attivo) { setTasks(page.items); setTasksError(null); } })
      .catch((e) => { if (attivo) { setTasks([]); setTasksError(toUserMessage(e)); } })
      .finally(() => { if (attivo) setTasksLoading(false); });
    return () => { attivo = false; };
  }, [open, debounced, activeCompanyId]);

  // I TRE GRUPPI, con l'indice progressivo già assegnato: la navigazione da
  // tastiera scorre una lista piatta, il disegno li mostra a sezioni.
  // Le pagine si filtrano sul testo tradotto: chi cerca «Dokumente» in
  // tedesco trova la voce tedesca, e le voci che non può vedere (permessi,
  // moduli fuori perimetro) non ci sono, come nella colonna.
  const gruppi = useMemo(() => {
    const q = debounced.toLowerCase();
    const out: { titolo: string; nota: string | null; opzioni: (Opzione & { i: number })[] }[] = [];
    let i = 0;
    const pagine: Opzione[] = [];
    for (const entry of NAV) {
      if (isSection(entry)) continue;
      if ((entry.adminOnly && !isAdmin) || (entry.legacyOnly && !LEGACY_MODULES_ENABLED)) continue;
      const label = t(entry.labelKey);
      if (q && !label.toLowerCase().includes(q)) continue;
      pagine.push({ id: `p-${entry.id}`, icon: entry.icon, label, path: entry.path });
    }
    if (pagine.length) out.push({ titolo: t('palette.groupPages'), nota: null, opzioni: pagine.map((o) => ({ ...o, i: i++ })) });
    // Documenti e attività esistono solo a query scritta: a campo vuoto la
    // finestra è un lanciatore di pagine, non un elenco dell'azienda.
    if (debounced) {
      if (docsLoading || docsError || (docs?.length ?? 0) > 0) {
        out.push({
          titolo: t('nav.documents'),
          nota: docsLoading ? t('states.loading') : docsError,
          opzioni: (docs ?? []).map((d) => ({
            id: `d-${d.id}`, icon: 'document' as IconName, label: documentLabel(d.label), path: `/documenti/${d.id}`, i: i++,
          })),
        });
      }
      if (tasksLoading || tasksError || (tasks?.length ?? 0) > 0) {
        out.push({
          titolo: t('nav.tasks'),
          nota: tasksLoading ? t('states.loading') : tasksError,
          opzioni: (tasks ?? []).map((x) => ({
            id: `t-${x.id}`, icon: 'checkCircle' as IconName, label: x.title, path: `/attivita/${x.id}`, i: i++,
          })),
        });
      }
    }
    return out;
  }, [debounced, isAdmin, t, documentLabel, docs, docsLoading, docsError, tasks, tasksLoading, tasksError]);

  const opzioni = useMemo(() => gruppi.flatMap((g) => g.opzioni), [gruppi]);
  // La lista si accorcia mentre si scrive: l'indice non può puntare oltre.
  const activeSafe = opzioni.length ? Math.min(active, opzioni.length - 1) : 0;

  // L'opzione corrente resta dentro la vista quando la lista è lunga.
  useEffect(() => {
    if (!open || !opzioni.length) return;
    document.getElementById(`${uid}-opt-${activeSafe}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeSafe, opzioni.length, uid]);

  function apri(o: Opzione) {
    onClose();
    navigate(o.path);
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!opzioni.length) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setActive((activeSafe + delta + opzioni.length) % opzioni.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = opzioni[activeSafe];
      if (o) apri(o);
    }
  };

  if (!open) return null;

  // Il vuoto è DICHIARATO, con la query nel testo: «nessun risultato» senza
  // dire per che cosa obbliga a rileggere il campo. Non si mostra mentre un
  // gruppo sta ancora caricando o ha un guasto da dire — quello è già detto.
  const vuoto = debounced.length > 0 && opzioni.length === 0
    && !docsLoading && !tasksLoading && !docsError && !tasksError;

  return createPortal(
    <div className="palette-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette-panel" role="dialog" aria-modal="true" aria-label={t('palette.dialogAria')} tabIndex={-1}>
        <div className="palette-input-row">
          <Icon name="search" />
          <input
            ref={inputRef}
            className="palette-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={opzioni.length ? `${uid}-opt-${activeSafe}` : undefined}
            aria-autocomplete="list"
            aria-label={t('palette.inputAria')}
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onInputKeyDown}
          />
        </div>
        <div className="palette-list" role="listbox" id={listId} aria-label={t('palette.dialogAria')}>
          {gruppi.map((g) => (
            <div key={g.titolo}>
              <div className="palette-group">{g.titolo}</div>
              {g.nota && <div className="palette-note">{g.nota}</div>}
              {g.opzioni.map((o) => (
                <button
                  key={o.id}
                  id={`${uid}-opt-${o.i}`}
                  type="button"
                  role="option"
                  aria-selected={o.i === activeSafe}
                  tabIndex={-1}
                  className={`palette-option${o.i === activeSafe ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(o.i)}
                  onClick={() => apri(o)}
                >
                  <Icon name={o.icon} />
                  <span className="opt-label">{o.label}</span>
                </button>
              ))}
            </div>
          ))}
          {vuoto && <div className="palette-note">{t('palette.empty', { q: debounced })}</div>}
        </div>
        {/* I tasti si dicono in PAROLE («Frecce su e giù…»): i glifi ⌘↑↓ non
            stanno nei caratteri serviti, e il divieto è scritto nei dizionari. */}
        <div className="palette-foot">{t('palette.hint')}</div>
      </div>
    </div>,
    document.body,
  );
}
