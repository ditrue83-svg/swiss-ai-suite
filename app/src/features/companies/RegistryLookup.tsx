// ============================================================================
// RegistryLookup — ricerca nel Registro IDI (Zefix) e precompilazione dei dati
// anagrafici. Usato DALL'ONBOARDING e dalle IMPOSTAZIONI AZIENDA.
//
// Perché è un componente condiviso e non due copie: le due schermate devono
// dire la stessa cosa sugli stessi dati, e le condizioni d'uso dell'API Zefix
// (indicare l'origine e le eventuali modifiche) vanno rispettate in entrambe.
// Due copie divergono — su questo progetto è già successo con la
// documentazione, e la correzione è stata togliere la duplicazione, non
// riallinearla.
//
// ⚠️ Il cantone: la ricerca per NOME non lo restituisce (l'API lo espone solo
// nel dettaglio per IDI). Non si deduce dal comune e non si lascia il default
// del modulo spacciandolo per importato: si CHIEDE al registro, e se non si
// ottiene lo si dichiara.
//
// ⚠️ DAL 2026-07-30 LO USA ANCHE IL CRM («Nuovo cliente»), e questo ha reso
// necessaria la prop `messages`. Il motivo non è cosmetico: i testi cablati
// parlano dell'azienda DELL'UTENTE — «Verifica e completa forma giuridica,
// settore e numero di dipendenti» — e su una scheda cliente quelle frasi non
// hanno senso. Si sovrascrivono SOLO le tre frasi che descrivono il modulo che
// sta intorno; i DUE DISCLAIMER (`registrySource` e `registryModified`) NON
// sono sovrascrivibili, perché sono condizioni d'uso dell'API Zefix e devono
// dire la stessa cosa in ogni schermata.
// ============================================================================
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useT, type TKey } from '@/i18n';
import { toUserMessage } from '@/lib/errors';
import { companyLookupService, LookupError, type CompanyCandidate } from '@/services/companyLookupService';
import { CANTONI } from './companyOptions';
import { formatUid } from '@/lib/uid';
import styles from './companies.module.css';

/** Ciò che il registro ha davvero dato. `canton: null` = non l'ha dato. */
export interface RegistryFields {
  legalName: string;
  uidChe: string;
  canton: string | null;
  municipality: string;
}

/**
 * Le frasi che descrivono il modulo intorno alla ricerca, e che cambiano da
 * schermata a schermata. NON comprendono i due disclaimer di Zefix: quelli sono
 * condizioni d'uso e restano uguali per tutti.
 */
export interface RegistryMessages {
  search: TKey;
  hint: TKey;
  imported: TKey;
  importedFrom: TKey;
  importedNoCanton: TKey;
}

const ONBOARDING_MESSAGES: RegistryMessages = {
  search: 'onboarding.registrySearch',
  hint: 'onboarding.registryHint',
  imported: 'onboarding.registryImported',
  importedFrom: 'onboarding.registryImportedFrom',
  importedNoCanton: 'onboarding.registryImportedNoCanton',
};

interface Props {
  /** Valori mostrati adesso nel modulo, per riconoscere le modifiche a mano. */
  current: { legalName: string; uidChe: string; canton: string; municipality: string };
  /** Chiamata quando si sceglie un candidato: i campi da applicare al modulo. */
  onApply: (fields: RegistryFields) => void;
  /** Identificativo per gli attributi `id`/`htmlFor` (tre schermate, un componente). */
  idPrefix: string;
  disabled?: boolean;
  /** Le frasi del modulo intorno. Senza, valgono quelle dell'onboarding. */
  messages?: RegistryMessages;
}

export function RegistryLookup({ current, onApply, idPrefix, disabled, messages }: Props) {
  const M = messages ?? ONBOARDING_MESSAGES;
  const t = useT();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<CompanyCandidate[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [imported, setImported] = useState<RegistryFields | null>(null);

  async function search() {
    const q = query.trim();
    if (q.length < 2 || searching) return;
    setSearching(true); setMessage(null); setCandidates([]);
    try {
      const list = await companyLookupService.search(q);
      setCandidates(list);
      if (list.length === 0) setMessage(t('onboarding.registryNoResults'));
    } catch (e) {
      // "Non configurata" e "credenziali non valide" sono problemi di setup del
      // servizio, non dell'utente: si dice solo che l'inserimento è manuale.
      const setupIssue = e instanceof LookupError
        && (e.code === 'LOOKUP_NOT_CONFIGURED' || e.code === 'LOOKUP_AUTH_FAILED');
      setMessage(setupIssue ? t('onboarding.registryUnavailable') : toUserMessage(e));
    } finally {
      setSearching(false);
    }
  }

  async function applyCandidate(c: CompanyCandidate) {
    // Il cantone manca nella ricerca per nome: lo si chiede col dettaglio per
    // IDI invece di lasciare il default del modulo in mezzo ai dati importati.
    let registryCanton = c.canton;
    if (!registryCanton && c.uid) {
      try {
        const [detail] = await companyLookupService.search(c.uid);
        registryCanton = detail?.canton ?? null;
      } catch {
        // Non è un fallback silenzioso: l'esito è dichiarato nel messaggio qui
        // sotto, dove il cantone entra fra i campi da verificare.
        registryCanton = null;
      }
    }

    const fields: RegistryFields = {
      legalName: c.name ?? current.legalName,
      uidChe: c.uid ? (formatUid(c.uid) ?? c.uid) : current.uidChe,
      canton: registryCanton ? (CANTONI.some((c) => c === registryCanton) ? registryCanton : 'Altro') : null,
      municipality: c.municipality ?? current.municipality,
    };
    setImported(fields);
    onApply(fields);
    setCandidates([]);
    setMessage(
      c.name
        ? t(fields.canton ? M.importedFrom : M.importedNoCanton, { name: c.name })
        : t(M.imported),
    );
  }

  // ⚠️ Il cantone si confronta SOLO se il registro l'ha davvero dato: altrimenti
  // sceglierlo a mano — cioè fare quel che l'avviso chiede — farebbe comparire
  // «hai modificato i dati importati» su un dato che nessuno ha importato.
  const modified = imported !== null && (
    current.legalName !== imported.legalName
    || current.uidChe !== imported.uidChe
    || (imported.canton !== null && current.canton !== imported.canton)
    || current.municipality !== imported.municipality
  );

  return (
    <div className="field">
      <label htmlFor={`${idPrefix}-lookup`}>{t(M.search)}</label>
      <div className="row-wrap">
        <input id={`${idPrefix}-lookup`} value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }}
          placeholder={t('onboarding.registryPlaceholder')} disabled={disabled}
          style={{ flex: 1, minWidth: 220 }} />
        <button type="button" className="btn btn-sm" onClick={() => void search()}
          disabled={disabled || searching || query.trim().length < 2} aria-busy={searching || undefined}>
          {searching ? <span className="spinner" aria-hidden="true" /> : <Icon name="fileSearch" className="ic-sm" />} {t('common.search')}
        </button>
      </div>
      <div className="muted-sm mt-1">{t(M.hint)}</div>

      {message && <div className="hint-accent mt-2" role="status">{message}</div>}

      {/* Condizioni d'uso dell'API Zefix: l'origine dei dati va indicata, e va
          detto che non sono vincolanti — chi legge una ragione sociale
          precompilata non deve crederla certificata. */}
      {imported && <div className="muted-sm mt-2">{t('onboarding.registrySource')}</div>}
      {modified && (
        <div className="hint-accent mt-2" role="status">{t('onboarding.registryModified')}</div>
      )}

      {candidates.length > 0 && (
        <ul role="listbox" aria-label={t('onboarding.registryResultsAria')} className={styles.registryCandidates}>
          {candidates.map((c, i) => (
            <li key={c.uid ?? i}>
              <button type="button" className="btn btn-sm mb-2" onClick={() => void applyCandidate(c)}
                style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left' }}>
                <span>
                  <strong>{c.name}</strong>
                  {c.municipality ? ` · ${c.municipality}` : ''}{c.canton ? ` (${c.canton})` : ''}
                  {c.uid ? ` · ${c.uid}` : ''}{c.status && c.status !== 'ACTIVE' ? ` · ${c.status}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
