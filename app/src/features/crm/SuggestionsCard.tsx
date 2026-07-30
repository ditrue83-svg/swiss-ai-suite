// ============================================================================
// «Da verificare» — ciò che il sistema sospetta e una persona conferma (§21).
//
// ⚠️⚠️ PERCHÉ QUESTO FILE ESISTE. Fino al 2026-07-30 `crm_link_suggestions`
// aveva la tabella, i permessi, il servizio (`crmService.suggestions`) e le
// etichette nei tre dizionari — e NESSUNA SCHERMATA LA LEGGEVA. È la stessa
// trappola già annotata per `home.module`, `amountsFound` e
// `errorCreditExhausted`: la parte scritta c'è, il collegamento no. Riempire
// quella tabella con il candidato automatico senza questa scheda avrebbe
// prodotto suggerimenti invisibili, cioè lavoro che nessuno vede.
//
// ⚠️ NESSUN COLLEGAMENTO AUTOMATICO PARTE DA QUI. I tre pulsanti sono tre gesti
// di una persona: «Collega» scrive, «Non è questa» chiude, «Non ora» rimanda.
// «Non ora» e «no» restano risposte diverse anche nel database.
//
// ⚠️ UN GUASTO SI DICHIARA. Se l'elenco non si è potuto leggere, la scheda lo
// dice: mostrare «Niente da verificare» su una richiesta fallita è il difetto
// trovato nell'Inbox con la 0013 non applicata e nelle Automazioni con la 0020
// — un guasto travestito da stato legittimo.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonLine } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { crmService } from '@/services/crmService';
import { toUserMessage } from '@/lib/errors';
import { useT, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import type { CrmLinkSuggestion } from '@/types/models';

/** Quanti se ne mostrano insieme: oltre, la scheda smette di essere leggibile. */
const VISIBLE = 6;

/**
 * Dove sta l'origine di un suggerimento. `null` per le entità che questa
 * versione non produce: meglio nessun collegamento che un percorso composto a
 * indovinare, che porterebbe a una pagina vuota.
 */
function sourceLink(s: CrmLinkSuggestion): { to: string; key: TKey } | null {
  if (s.sourceEntityType === 'contract') {
    return { to: `/contratti/${s.sourceEntityId}`, key: 'crm.suggestions.fromContract' };
  }
  if (s.sourceEntityType === 'finance_item') {
    return { to: `/finanze/${s.sourceEntityId}`, key: 'crm.suggestions.fromFinance' };
  }
  return null;
}

export function SuggestionsCard({ companyId }: { companyId: string }) {
  const t = useT();
  const L = useLabels();
  const { showToast } = useToast();

  const [items, setItems] = useState<CrmLinkSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await crmService.suggestions(companyId));
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  /**
   * ⚠️ La riga si toglie SOLO DOPO che la scrittura è riuscita. Toglierla prima
   * — «tanto poi si aggiorna» — farebbe sparire dallo schermo un suggerimento
   * ancora in sospeso nel database, e ricomparire al prossimo caricamento senza
   * che nessuno capisca perché.
   */
  async function resolve(s: CrmLinkSuggestion, status: 'accepted' | 'rejected' | 'ignored') {
    if (busy) return;
    setBusy(s.id);
    try {
      if (status === 'accepted') {
        if (!s.suggestedOrganizationId) throw new Error('crm.errors.suggestionSourceUnsupported');
        await crmService.acceptSuggestion(s, s.suggestedOrganizationId);
        showToast(t('crm.form.linkedOk'));
      } else {
        await crmService.resolveSuggestion(s.id, status);
      }
      setItems((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setBusy(null);
    }
  }

  // Niente scheda quando non c'è niente da dire: uno stato vuoto permanente in
  // cima all'elenco dei clienti sarebbe rumore. Il guasto invece si mostra.
  if (!loading && !error && items.length === 0) return null;

  return (
    <div className="card mt-16">
      <div className="card-title">
        <Icon name="alert" className="ic-sm" /> {t('crm.suggestions.title')}
      </div>
      <p className="muted-sm">{t('crm.suggestions.hint')}</p>

      {loading && <><SkeletonLine width="70%" /><SkeletonLine width="55%" /></>}
      {error && <ErrorState message={error} onRetry={() => void load()} />}

      {!loading && !error && items.slice(0, VISIBLE).map((s) => {
        const origin = sourceLink(s);
        return (
          <div className="list-row" key={s.id}>
            <div className="list-main">
              <div className="list-title">{s.suggestedName ?? t('crm.suggestions.unnamed')}</div>
              {/* ⚠️ I DUE PUNTI STANNO NELLA CHIAVE, non nel JSX. In francese
                  vogliono uno spazio unificatore stretto davanti (U+202F), e
                  scritti qui darebbero «Pourquoi: …» — lo stesso difetto già
                  pagato con «Priorité: toutes» nel Calendario. Trovato aprendo
                  QUESTA schermata in francese, non rileggendo il codice: il
                  controllo `i18n:typography` guarda i dizionari, e un segno di
                  punteggiatura scritto nel JSX gli è invisibile. */}
              <div className="list-sub">
                {t('crm.suggestions.reasonWith', { reason: L.crmReason(s.reason) })}
                {origin && <> · <Link to={origin.to}>{t(origin.key)}</Link></>}
              </div>
            </div>
            <div className="row-wrap">
              {s.suggestedOrganizationId ? (
                <button
                  type="button" className="btn btn-sm btn-primary"
                  disabled={busy !== null} aria-busy={busy === s.id || undefined}
                  onClick={() => void resolve(s, 'accepted')}
                >
                  {t('crm.suggestions.accept')}
                </button>
              ) : (
                /* Nessuna scheda a cui collegare: l'unica azione onesta è
                   CREARLA, e la crea una persona. Il nome viaggia nell'indirizzo
                   perché il modulo lo precompili; il suggerimento si chiude solo
                   quando la scheda esiste davvero. */
                <Link
                  className="btn btn-sm btn-primary"
                  to={`/clienti/nuovo?nome=${encodeURIComponent(s.suggestedName ?? '')}&da=${s.id}`}
                >
                  {t('crm.suggestions.createFrom')}
                </Link>
              )}
              <button
                type="button" className="btn btn-sm" disabled={busy !== null}
                onClick={() => void resolve(s, 'rejected')}
              >
                {t('crm.suggestions.reject')}
              </button>
              <button
                type="button" className="btn btn-sm btn-ghost" disabled={busy !== null}
                onClick={() => void resolve(s, 'ignored')}
              >
                {t('crm.suggestions.ignore')}
              </button>
            </div>
          </div>
        );
      })}

      {/* Il resto NON si nasconde in silenzio: si dice quanti sono. Un elenco
          tagliato senza dirlo si legge come «è tutto qui». */}
      {!loading && !error && items.length > VISIBLE && (
        <p className="muted-sm mt-10">
          {t('crm.suggestions.more', { n: items.length - VISIBLE })}
        </p>
      )}
    </div>
  );
}
