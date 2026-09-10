// ============================================================================
// QuickNote — la nota rapida (Fase 3.1, 2026-09-10).
//
// Il gesto che mancava a chi non è alla scrivania: «ho appena parlato con il
// cliente, lo scrivo prima di dimenticarlo». Si apre dal ✚ della barra
// inferiore (/oggi?nota=1) e vive in una FINESTRA (Dialog), non in una pagina:
// la nota è un lampo, non un luogo in cui trasferirsi.
//
// LE REGOLE:
//   - il CLIENTE è obbligatorio: una nota salvata è una `crm_interactions`,
//     che sta attaccata a un'organizzazione. Una nota «generica» sarebbe un
//     ricordo senza scheda: non si trova più, e non si trovare è peggio che
//     non scrivere;
//   - la trattativa è FACOLTATIVA: se c'è, la nota si attacca anche a lei;
//   - la DETTATURA scrive nella casella di testo, che resta EDITABILE, e non
//     invia mai da sola: il testo resta davanti finché non si preme «Salva»;
//   - «Struttura con AI» RISCRIVE oggetto e testo nei campi (editabili), non
//     nel database: propone, la persona decide — il patto di sempre (§35);
//   - salvata la nota, la finestra si chiude e l'indirizzo si pulisce: il
//     gesto è un collegamento vero (?nota=1), come `?nuova=` delle Attività.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { crmService } from '@/services/crmService';
import { noteService } from '@/services/noteService';
import { linguaDettatura, speechRecognition, type SpeechRecognitionLike } from '@/lib/dettatura';
import { unisciDettatura } from './todayModel';
import { isOpen } from '../crm/crmModel';
import { toUserMessage } from '@/lib/errors';
import { useI18n, useT } from '@/i18n';
import type { CrmOpportunity, CrmOrganizationOption } from '@/types/models';

export function QuickNote({ open, dettatura, onClose, companyId }: {
  open: boolean;
  /** Vero se il gesto era «Detta una nota»: il microfono parte da solo. */
  dettatura: boolean;
  onClose: () => void;
  companyId: string;
}) {
  const t = useT();
  const { locale } = useI18n();
  const { showToast } = useToast();

  const [cerca, setCerca] = useState('');
  const [debounced, setDebounced] = useState('');
  const [risultati, setRisultati] = useState<CrmOrganizationOption[]>([]);
  const [cliente, setCliente] = useState<CrmOrganizationOption | null>(null);
  const [trattative, setTrattative] = useState<CrmOpportunity[]>([]);
  const [trattativaId, setTrattativaId] = useState('');
  const [oggetto, setOggetto] = useState('');
  const [testo, setTesto] = useState('');
  const [busy, setBusy] = useState<'salva' | 'ai' | null>(null);

  // ---- Dettatura -------------------------------------------------------------
  // Il costruttore si legge una volta: non cambia durante la sessione. NULL è
  // una risposta (Firefox): il microfono semplicemente non compare.
  const [Ctor] = useState(() => speechRecognition());
  const [ascolto, setAscolto] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  // Ciò che era scritto prima di premere il microfono + i frammenti FINALI di
  // questa sessione: i parziali si mostrano ma non si fissano finché il
  // browser non li dichiara definitivi.
  const baseRef = useRef('');
  const finaleRef = useRef('');

  function avviaDettatura() {
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = linguaDettatura(locale);
    rec.continuous = true;
    rec.interimResults = true;
    baseRef.current = testo;
    finaleRef.current = '';
    rec.onresult = (e) => {
      let parziale = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) finaleRef.current += r[0].transcript;
        else parziale += r[0].transcript;
      }
      setTesto(unisciDettatura(baseRef.current, finaleRef.current + parziale));
    };
    // Fine o errore: il testo dettato FINO A QUEL PUNTO resta nella casella.
    // Un dettato sparito per un errore di rete sarebbe lavoro perso.
    rec.onerror = () => { setAscolto(false); recRef.current = null; };
    rec.onend = () => { setAscolto(false); recRef.current = null; };
    recRef.current = rec;
    setAscolto(true);
    rec.start();
  }

  // Apertura: campi freschi a ogni gesto; se il gesto era «Detta», il
  // microfono parte da solo (il permesso lo chiede il browser, una volta).
  useEffect(() => {
    if (!open) {
      recRef.current?.stop();
      return;
    }
    setCerca(''); setDebounced(''); setRisultati([]);
    setCliente(null); setTrattative([]); setTrattativaId('');
    setOggetto(''); setTesto(''); setBusy(null);
    if (dettatura && Ctor) avviaDettatura();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ---- Cliente (obbligatorio): la stessa ricerca di «Chiama un cliente» -----
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(cerca.trim()), 350);
    return () => clearTimeout(timer);
  }, [cerca]);

  useEffect(() => {
    if (!debounced) { setRisultati([]); return; }
    let cancelled = false;
    void crmService.options(companyId, debounced).then((rows) => {
      if (!cancelled) setRisultati(rows);
    }).catch(() => {
      if (!cancelled) setRisultati([]);
    });
    return () => { cancelled = true; };
  }, [companyId, debounced]);

  // ---- Trattative del cliente scelto (facoltativa) ---------------------------
  useEffect(() => {
    if (!cliente) { setTrattative([]); return; }
    let cancelled = false;
    void crmService.opportunities(companyId, { organizationId: cliente.id, limit: 50 })
      // Solo le trattative in corso: vinte e perse non prendono più note di
      // lavoro (la regola è `isOpen` del modello CRM, UNA sola porta).
      .then((r) => { if (!cancelled) setTrattative(r.items.filter((o) => isOpen(o.stage))); })
      .catch(() => { if (!cancelled) setTrattative([]); });
    return () => { cancelled = true; };
  }, [companyId, cliente]);

  // ---- Azioni ----------------------------------------------------------------
  async function struttura() {
    if (!testo.trim()) return;
    setBusy('ai');
    try {
      const s = await noteService.structure({ text: testo.trim(), lang: locale, companyId });
      setOggetto(s.subject);
      setTesto(s.notes);
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function salva() {
    if (!cliente || !testo.trim()) return;
    setBusy('salva');
    try {
      await crmService.addInteraction(companyId, cliente.id, {
        type: 'note',
        subject: oggetto.trim() || null,
        notes: testo.trim(),
        opportunityId: trattativaId || null,
      });
      showToast(t('quicknote.saved'));
      onClose();
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('quicknote.title')}>
      {/* 1. IL CLIENTE — prima di tutto: senza, la nota non ha dove stare. */}
      {cliente ? (
        <div className="field">
          <label>{t('quicknote.client')}</label>
          <div className="row-wrap">
            <span className="list-title">{cliente.displayName}</span>
            <button type="button" className="btn btn-sm" onClick={() => { setCliente(null); setTrattativaId(''); }}>
              {t('quicknote.clientChange')}
            </button>
          </div>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="qn-cliente">{t('quicknote.client')}</label>
          <input
            id="qn-cliente"
            value={cerca}
            onChange={(e) => setCerca(e.target.value)}
            placeholder={t('quicknote.clientSearch')}
            autoComplete="off"
          />
          {risultati.length > 0 && (
            <ul className="crm-list mt-8">
              {risultati.map((o) => (
                <li className="list-row" key={o.id}>
                  <button type="button" className="list-title btn-link" onClick={() => setCliente(o)}>
                    {o.displayName}
                  </button>
                  {o.city && <span className="list-sub">{o.city}</span>}
                </li>
              ))}
            </ul>
          )}
          {debounced && risultati.length === 0 && (
            <p className="muted-sm mt-8 m-0">{t('quicknote.clientNoResults')}</p>
          )}
        </div>
      )}

      {/* 2. La trattativa, SOLO se il cliente ne ha di aperte: una tendina
             vuota insegna a ignorarla. */}
      {cliente && trattative.length > 0 && (
        <div className="field">
          <label htmlFor="qn-trattativa">{t('quicknote.opportunity')}</label>
          <select id="qn-trattativa" value={trattativaId} onChange={(e) => setTrattativaId(e.target.value)}>
            <option value="">{t('quicknote.opportunityNone')}</option>
            {trattative.map((o) => (
              <option key={o.id} value={o.id}>{o.title}</option>
            ))}
          </select>
        </div>
      )}

      {/* 3. Oggetto e testo — la nota. */}
      <div className="field">
        <label htmlFor="qn-oggetto">{t('quicknote.subject')}</label>
        <input
          id="qn-oggetto"
          value={oggetto}
          onChange={(e) => setOggetto(e.target.value)}
          placeholder={t('quicknote.subjectPlaceholder')}
          maxLength={200}
        />
      </div>
      <div className="field">
        <label htmlFor="qn-testo">{t('quicknote.text')}</label>
        <textarea
          id="qn-testo"
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
          placeholder={t('quicknote.textPlaceholder')}
          maxLength={5000}
          rows={5}
        />
      </div>

      {/* 4. La voce e l'AI: scorciatoie, mai l'unica via. Il microfono compare
             solo dove la Web Speech API esiste; «Struttura con AI» riscrive i
             campi, non il database. */}
      <div className="row-wrap">
        {Ctor && (
          <button
            type="button"
            // Interruttore, non azione: lo stato «in ascolto» è una superficie
            // (`btn-toggle`), il blu pieno è riservato alle azioni (sezione 6).
            className="btn btn-sm btn-toggle"
            aria-pressed={ascolto}
            onClick={() => (ascolto ? recRef.current?.stop() : avviaDettatura())}
          >
            <Icon name="mic" className="ic-sm" />
            {ascolto ? t('quicknote.dictating') : t('quicknote.dictate')}
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy !== null || !testo.trim()}
          aria-busy={busy === 'ai' || undefined}
          onClick={() => void struttura()}
        >
          {busy === 'ai' ? t('quicknote.structuring') : t('quicknote.structure')}
        </button>
      </div>

      {/* 5. Salva: solo con cliente E testo. Il dettato da solo non basta. */}
      <div className="row-wrap mt-16">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null || !cliente || !testo.trim()}
          aria-busy={busy === 'salva' || undefined}
          onClick={() => void salva()}
        >
          {t('common.save')}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </Dialog>
  );
}
