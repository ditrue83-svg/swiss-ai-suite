// ============================================================================
// Nuovo cliente — §97: cerca nel registro, precompila, l'utente conferma.
//
// ⚠️ IL REGISTRO NON SI INTERROGA DA SOLO. §349 del vincolo UFRC: nessun
// debounce, nessuna ricerca a ogni tasto, nessun lotto su una lista. La ricerca
// parte da un gesto esplicito, e questa pagina riusa `RegistryLookup` — che quel
// vincolo lo rispetta già — invece di reimplementarlo.
//
// ⚠️ NESSUN ARRICCHIMENTO DAL WEB (§95): niente LinkedIn, niente ricerca del
// sito, niente fatturato, niente dipendenti. Il sito e i recapiti li scrive una
// persona, oppure arrivano da una comunicazione che l'azienda ha ricevuto.
//
// ⚠️ ZEFIX NON È UN ELENCO DI PERSONE (§98): da qui non nasce nessun contatto
// personale. Le persone si aggiungono dalla scheda, a mano.
// ============================================================================
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useCompany } from '@/contexts/CompanyContext';
import { ErrorState } from '@/components/ui/states';
import { RegistryLookup, type RegistryFields, type RegistryMessages } from '@/features/companies/RegistryLookup';
import { crmService } from '@/services/crmService';
import { isValidUid } from '@/lib/uid';
import { useT, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { useToast } from '@/components/ui/Toast';
import type { CrmOrganizationRole } from '@/types/database';
import { SWISS_CANTONS } from './crmModel';
import { cx } from '@/lib/cx';
import styles from './crm.module.css';

/**
 * ⚠️ I TESTI DEL REGISTRO SONO NOSTRI, i due DISCLAIMER restano di Zefix.
 * `RegistryLookup` cablava frasi che parlano dell'azienda dell'utente
 * («completa forma giuridica, settore e numero di dipendenti»): su una scheda
 * cliente non hanno senso. Si sovrascrivono solo quelle; `registrySource` e
 * `registryModified` non sono sovrascrivibili per costruzione, perché sono
 * condizioni d'uso dell'API.
 */
const REGISTRY_MESSAGES: RegistryMessages = {
  search: 'crm.registry.search',
  hint: 'crm.registry.hint',
  imported: 'onboarding.registryImported',
  importedFrom: 'onboarding.registryImportedFrom',
  importedNoCanton: 'onboarding.registryImportedNoCanton',
};

/**
 * ⚠️ IL CANTONE CHE ARRIVA DAL REGISTRO È UN'ETICHETTA, NON UNA SIGLA.
 * `lookup-company` può restituire «Altro». Un cliente di Lucerna
 * arriva quindi con un valore da confermare.
 *
 * ⚠️ E in quel caso il campo resta VUOTO invece di ricevere una sigla inventata.
 * Scrivere `TI` perché è il default del modulo è esattamente il difetto già
 * pagato nell'onboarding — «Comune Zug, Cantone Ticino» sotto un avviso che
 * diceva «dati importati dal registro» — e là non era cosmetico.
 */
const CANTON_CODE: Record<string, string> = {
  Ticino: 'TI', Zurigo: 'ZH', Berna: 'BE', Ginevra: 'GE', Vaud: 'VD', Grigioni: 'GR',
};

const ROLES: CrmOrganizationRole[] = [
  'lead', 'prospect', 'customer', 'supplier', 'partner', 'authority', 'other',
];

export function ClientCreatePage() {
  const { activeCompany: company } = useCompany();
  const t = useT();
  const L = useLabels();
  const navigate = useNavigate();
  const { showToast } = useToast();

  // Un suggerimento può portare qui il nome letto su un contratto o su una
  // fattura, insieme al proprio identificativo. Il nome è solo una PROPOSTA nel
  // campo — resta modificabile, e resta il nome che il documento dice.
  const [params] = useSearchParams();
  const fromSuggestion = params.get('da');
  const suggestedName = (params.get('nome') ?? '').slice(0, 200);

  const [displayName, setDisplayName] = useState(suggestedName);
  const [legalName, setLegalName] = useState('');
  const [uidChe, setUidChe] = useState('');
  const [website, setWebsite] = useState('');
  const [street, setStreet] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [canton, setCanton] = useState('');
  const [roles, setRoles] = useState<CrmOrganizationRole[]>(['prospect']);
  const [fromRegistry, setFromRegistry] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ⚠️ L'avviso SEGNALA, non blocca: un IDE estero o un numero in corso di
  // verifica devono poter essere salvati. È la stessa scelta dell'onboarding.
  const uidInvalid = uidChe.replace(/\D/g, '').length >= 9 && !isValidUid(uidChe);

  function applyRegistry(f: RegistryFields) {
    setLegalName(f.legalName);
    // Il nome d'uso si propone dalla ragione sociale solo se è ancora vuoto:
    // sovrascrivere quello che una persona ha già scritto sarebbe presuntuoso.
    setDisplayName((v) => v.trim() === '' ? f.legalName : v);
    setUidChe(f.uidChe);
    setCity(f.municipality);
    // `f.canton` è null quando il registro non l'ha dato, e 'Altro' quando
    // esiste ma sta fuori dai sei del catalogo: in entrambi i casi il campo
    // resta com'era, e chi guarda lo completa.
    const code = f.canton ? CANTON_CODE[f.canton] : undefined;
    if (code) setCanton(code);
    setFromRegistry(true);
  }

  function toggleRole(r: CrmOrganizationRole) {
    setRoles((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!company || busy) return;
    const name = displayName.trim();
    if (name === '') return;
    setBusy(true);
    setError(null);
    try {
      const id = await crmService.create(company.id, {
        displayName: name,
        legalName: legalName.trim() || null,
        uidChe: uidChe.trim() || null,
        website: website.trim() || null,
        street: street.trim() || null,
        postalCode: postalCode.trim() || null,
        city: city.trim() || null,
        canton: canton.trim() || null,
        countryCode: 'CH',
        roles,
        // §19 — la provenienza dice come è nata la riga, e «dal registro» è una
        // cosa diversa da «scritta a mano»: chi la leggerà domani ha diritto di
        // saperlo. Non significa che i dati siano verificati.
        source: fromRegistry ? 'registry' : 'manual',
      });
      // Il cerchio si chiude: la scheda esiste, quindi il documento che l'aveva
      // fatta proporre le si collega e il suggerimento diventa «accettato».
      // ⚠️ Se questa seconda metà fallisce, la scheda RESTA e lo si DICE — è la
      // stessa scelta dei ruoli qui sotto e della cancellazione di un documento:
      // far sparire il lavoro riuscito per colpa di quello secondario sarebbe
      // peggio, e tacerlo sarebbe una bugia.
      if (fromSuggestion) {
        try {
          await crmService.acceptSuggestionById(company.id, fromSuggestion, id);
        } catch {
          showToast(t('crm.errors.suggestionNotLinked'));
          navigate(`/clienti/${id}`, { replace: true });
          return;
        }
      }
      showToast(t('crm.form.created'));
      navigate(`/clienti/${id}`, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // ⚠️ Se i RUOLI non si salvano, l'organizzazione resta e lo si DICE: è la
      // lezione della conversione Admin AI → Attività, dove far sparire tutto
      // per un inserimento secondario sarebbe stato peggio.
      if (msg.startsWith('crm.errors.rolesNotSaved:')) {
        const id = msg.split(':')[1]!;
        showToast(t('crm.errors.rolesNotSaved'));
        navigate(`/clienti/${id}`, { replace: true });
        return;
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!company) return null;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">{t('crm.add')}</div>
          <div className="page-desc">{t('crm.subtitle')}</div>
        </div>
      </div>

      {error && <ErrorState message={t(error as TKey) || error} />}

      <form className={cx('card', styles.crmNarrow)} onSubmit={submit}>
        <RegistryLookup
          current={{ legalName, uidChe, canton, municipality: city }}
          onApply={applyRegistry}
          idPrefix="crm"
          disabled={busy}
          messages={REGISTRY_MESSAGES}
        />

        <div className={styles.divider} />

        {/* ⚠️ OGNI CAMPO DENTRO `.field`: lo stile di input e textarea è legato a
            quella classe, e un input scritto fuori mostra lo sfondo bianco del
            browser con sopra il testo chiaro del tema scuro. Difetto già pagato
            nel dettaglio delle Attività, trovato aprendo la schermata. */}
        <div className="field">
          <label htmlFor="c-name">{t('crm.form.displayName')}</label>
          <input
            id="c-name" value={displayName} required maxLength={200}
            aria-describedby="c-name-h"
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <div className="field-hint" id="c-name-h">{t('crm.form.displayNameHint')}</div>
        </div>

        <div className="field">
          <label htmlFor="c-legal">{t('crm.form.legalName')}</label>
          <input
            id="c-legal" value={legalName} maxLength={200} aria-describedby="c-legal-h"
            onChange={(e) => setLegalName(e.target.value)}
          />
          <div className="field-hint" id="c-legal-h">{t('crm.form.legalNameHint')}</div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="c-uid">{t('crm.form.uid')}</label>
            <input
              id="c-uid" value={uidChe} maxLength={32}
              aria-invalid={uidInvalid || undefined}
              aria-describedby={uidInvalid ? 'c-uid-e' : undefined}
              onChange={(e) => setUidChe(e.target.value)}
            />
            {uidInvalid && (
              <div className="field-hint" id="c-uid-e" role="status">
                {t('crm.form.uidInvalid')}
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor="c-web">{t('crm.form.website')}</label>
            <input
              id="c-web" value={website} maxLength={200} inputMode="url"
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="c-street">{t('crm.form.street')}</label>
          <input
            id="c-street" value={street} maxLength={200}
            onChange={(e) => setStreet(e.target.value)}
          />
        </div>

        <div className={styles.grid3}>
          <div className="field">
            <label htmlFor="c-zip">{t('crm.form.postalCode')}</label>
            <input
              id="c-zip" value={postalCode} maxLength={16}
              onChange={(e) => setPostalCode(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="c-city">{t('crm.form.city')}</label>
            <input
              id="c-city" value={city} maxLength={120}
              onChange={(e) => setCity(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="c-canton">{t('crm.form.canton')}</label>
            {/* ⚠️ Un ELENCO e non un campo libero: il database pretende due
                lettere (`check (length(canton) = 2)`), e un testo qualunque
                produrrebbe un 23514 che nessun messaggio traduce. Con
                ventisette voci il valore sbagliato è impossibile — e il cliente
                di Lucerna non diventa «Altro». */}
            <select
              id="c-canton" value={canton}
              onChange={(e) => setCanton(e.target.value)}
            >
              <option value="">—</option>
              {SWISS_CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* §3 — più ruoli insieme, ed è il caso normale in una PMI. */}
        <fieldset className="field">
          <legend>{t('crm.form.roles')}</legend>
          <div className="row-wrap">
            {ROLES.map((r) => (
              <label key={r} className="task-check" htmlFor={`c-role-${r}`}>
                <input
                  id={`c-role-${r}`} type="checkbox" checked={roles.includes(r)}
                  onChange={() => toggleRole(r)}
                />
                {L.crmRole(r)}
              </label>
            ))}
          </div>
          <div className="field-hint">{t('crm.form.rolesHint')}</div>
        </fieldset>

        <div className="row-wrap mt-8">
          <button
            className="btn btn-primary" type="submit"
            disabled={busy || displayName.trim() === ''} aria-busy={busy || undefined}
          >
            {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="plus" className="ic-sm" />}
            {' '}{t('crm.form.save')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/clienti')}>
            {t('crm.form.cancel')}
          </button>
        </div>
      </form>
    </>
  );
}
