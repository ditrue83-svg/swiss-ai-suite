// ============================================================================
// «Collega a cliente» — il selettore condiviso di Inbox, Documenti, Contratti
// e Finanze (§71, §75, §80).
//
// Perché UN componente e non quattro: le quattro schermate devono dire la stessa
// cosa sullo stesso gesto, e soprattutto devono dire la stessa cosa su ciò che
// il gesto NON fa — scollegare non cancella il nome letto sul documento. Quattro
// copie di quella frase divergono; su questo progetto è già successo con la
// documentazione, e la correzione è stata togliere la duplicazione.
//
// ⚠️ IL SUGGERIMENTO NON È UN COLLEGAMENTO. Quando il chiamante passa
// `senderEmail`, il componente chiede al database chi è quell'indirizzo
// (`crm_match_email`) e mostra il risultato con il MOTIVO: `email_exact` è
// un'identità e la riga lo dice, `domain_match` è un sospetto e la riga dice
// «da confermare». In nessun caso il collegamento avviene da solo: qui c'è
// sempre un clic di una persona (§22, §23).
//
// ⚠️ NON esiste ricerca a ogni tasto: la ricerca parte da un gesto. Non è una
// scelta di gusto — `crm_organization_options` è server-side e una chiamata per
// tastiera premuta su mille clienti è traffico inutile.
// ============================================================================
import { useEffect, useState } from 'react';
import { Tag } from '@/components/ui/Tag';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useCompany } from '@/contexts/CompanyContext';
import { crmService } from '@/services/crmService';
import { useT, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import type { CrmEmailMatch, CrmOrganizationOption } from '@/types/models';
import { cx } from '@/lib/cx';
import styles from './crm.module.css';

interface Props {
  /** L'organizzazione già collegata, se c'è. */
  linkedId: string | null;
  /** Il nome da mostrare accanto, quando è noto senza una seconda interrogazione. */
  linkedName?: string | null;
  /**
   * Il nome che il modulo d'origine ha LETTO (controparte del contratto,
   * fornitore della fattura, mittente della email). Si mostra accanto
   * all'identità CRM, non al suo posto: la differenza fra i due è la cosa più
   * utile di questo riquadro.
   */
  extractedName?: string | null;
  /** Se passato, il componente propone chi è quell'indirizzo (§22, §23). */
  senderEmail?: string | null;
  onLink: (organizationId: string) => Promise<void>;
  onUnlink: () => Promise<void>;
  disabled?: boolean;
  /**
   * Il LIVELLO di superficie su cui il selettore si appoggia, deciso da chi lo
   * ospita. Il default resta `crm-ask` — il riquadro pieno che le altre tre
   * schermate usano da sempre — e il dettaglio di un documento passa
   * `surface-2`, perché là il CRM è uno dei blocchi che si consultano e non
   * deve pesare quanto l'analisi. ⚠️ Non è una scorciatoia per stili arbitrari:
   * i valori ammessi sono i livelli dichiarati in `:root`.
   */
  className?: string;
}

export function CrmLinkPicker(props: Props) {
  const { activeCompany: company } = useCompany();
  const t = useT();
  const L = useLabels();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<CrmOrganizationOption[]>([]);
  const [matches, setMatches] = useState<CrmEmailMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // I suggerimenti si chiedono UNA volta, all'apertura del riquadro: non a ogni
  // render, e non se l'elemento è già collegato — non c'è niente da proporre.
  useEffect(() => {
    if (!company || props.linkedId || !props.senderEmail) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await crmService.matchEmail(company.id, props.senderEmail!);
        if (!cancelled) setMatches(r);
      } catch {
        // Un suggerimento che non arriva non è un guasto da mostrare: il
        // collegamento a mano resta possibile, ed è quello che conta.
        if (!cancelled) setMatches([]);
      }
    })();
    return () => { cancelled = true; };
  }, [company, props.linkedId, props.senderEmail]);

  async function search() {
    if (!company) return;
    setBusy(true);
    setError(null);
    try {
      setOptions(await crmService.options(company.id, query.trim() || null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setOpen(false);
      setOptions([]);
      setQuery('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!company) return null;

  return (
    <div className={props.className ?? styles.crmAsk}>
      <div className="crm-sec-head">
        <strong>{t('crm.link.toOrganization')}</strong>
        {props.linkedId && (
          <Link to={`/clienti/${props.linkedId}`}>{t('crm.link.openOrganization')}</Link>
        )}
      </div>

      {/* ⚠️ IL NOME ESTRATTO SI MOSTRA SEMPRE, anche quando c'è un collegamento:
          «il documento dice X, e noi la chiamiamo Y» è una verifica, e farli
          coincidere a forza sarebbe una riscrittura (§27). */}
      {props.extractedName && (
        <p className="muted-sm">
          {t('crm.link.extracted')}: <strong>{props.extractedName}</strong>
        </p>
      )}

      {props.linkedId ? (
        <div className="row-wrap">
          <Tag tone="info">{props.linkedName ?? props.linkedId.slice(0, 8)}</Tag>
          <button
            type="button" className="btn btn-sm btn-ghost"
            disabled={props.disabled || busy}
            onClick={() => void run(props.onUnlink)}
          >
            {t('crm.link.unlink')}
          </button>
          {/* La frase che vale per tutte e quattro le schermate, scritta una volta. */}
          <span className="muted-sm">{t('crm.link.unlinkHint')}</span>
        </div>
      ) : (
        <>
          <p className="muted-sm">{t('crm.link.notLinked')}</p>

          {/* §22 e §23 — i suggerimenti, con il MOTIVO in chiaro. Il motivo non
              è decorativo: dice a chi legge se quella riga è un'identità o un
              sospetto, e quindi se fidarsi. */}
          {matches.length > 0 && (
            <>
              {matches.map((m) => (
                <div className={styles.crmAskRow} key={`${m.organizationId ?? ''}-${m.reason}`}>
                  <div className={styles.crmAskMain}>
                    <strong>{m.organizationName ?? m.contactName ?? '—'}</strong>
                    <div className="muted-sm">
                      {m.reason === 'email_exact'
                        ? t('crm.link.matchExact')
                        : t('crm.link.matchDomain')}
                      {m.reasonDetail ? ` · ${m.reasonDetail}` : ''}
                    </div>
                  </div>
                  {m.organizationId && (
                    <button
                      type="button" className="btn btn-sm btn-primary"
                      disabled={props.disabled || busy}
                      onClick={() => void run(() => props.onLink(m.organizationId!))}
                    >
                      {t('crm.suggestions.accept')}
                    </button>
                  )}
                </div>
              ))}
            </>
          )}

          {!open ? (
            <button
              type="button" className="btn btn-sm" disabled={props.disabled}
              onClick={() => { setOpen(true); void search(); }}
            >
              <Icon name="user" className="ic-sm" /> {t('crm.link.chooseOrganization')}
            </button>
          ) : (
            <>
              <div className={cx('field', styles.crmSearch)}>
                <label className="sr-only" htmlFor="crm-pick">
                  {t('crm.link.searchOrganization')}
                </label>
                <input
                  id="crm-pick" type="search" value={query} maxLength={120}
                  placeholder={t('crm.link.searchOrganization')}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }}
                />
                <button
                  type="button" className="btn btn-sm" disabled={busy}
                  aria-busy={busy || undefined} onClick={() => void search()}
                >
                  {t('common.search')}
                </button>
              </div>

              {options.length === 0 && !busy ? (
                <div className="row-wrap">
                  <span className="muted-sm">{t('crm.link.noMatch')}</span>
                  <Link className="btn btn-sm" to="/clienti/nuovo">
                    {t('crm.link.createInstead')}
                  </Link>
                </div>
              ) : (
                <ul className="crm-list">
                  {options.map((o) => (
                    <li className={styles.crmAskRow} key={o.id}>
                      <div className={styles.crmAskMain}>
                        <strong>{o.displayName}</strong>
                        <div className="muted-sm">
                          {o.city ?? ''}
                          {o.roles.length > 0 && ` · ${o.roles.map((r) => L.crmRole(r)).join(', ')}`}
                        </div>
                      </div>
                      <button
                        type="button" className="btn btn-sm btn-primary"
                        disabled={props.disabled || busy}
                        onClick={() => void run(() => props.onLink(o.id))}
                      >
                        {t('crm.suggestions.accept')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}

      {error && <p className="form-error">{t(error as TKey) || error}</p>}
    </div>
  );
}
