// ============================================================================
// Impostazioni azienda — i dati anagrafici e il profilo operativo.
//
// Perché esiste: fino al 2026-07-28 i dati dell'azienda si potevano inserire
// SOLO all'onboarding, una volta sola. Un trasloco, un cambio di ragione
// sociale o una correzione non avevano dove andare, e la ricerca nel Registro
// IDI — appena accesa — sarebbe stata una funzione utilizzabile una volta e mai
// più.
//
// I DATI ANAGRAFICI (companies) li modificano solo titolare e
//     amministratori — è la policy `companies_update_admin` della 0001. Chi non
//     può, li vede in sola lettura e la schermata dice perché: offrire campi
//     che al salvataggio verranno rifiutati è la stessa trappola del pulsante
//     «Collega calendario» senza credenziali.
// ============================================================================
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonLine } from '@/components/ui/states';
import { Input, Select } from '@/components/ui/forms';
import { useToast } from '@/components/ui/Toast';
import { useCompany } from '@/contexts/CompanyContext';
import { useT } from '@/i18n';
import { toUserMessage } from '@/lib/errors';
import { formatUid, isValidUid } from '@/lib/uid';
import { checkIban } from '../../../supabase/functions/_shared/finance/checksums.ts';
import { companyService } from '@/services/companyService';
import { RegistryLookup, type RegistryFields } from '@/features/companies/RegistryLookup';
import { CANTONI, FORME_GIURIDICHE } from './companyOptions';

/** Dove sta questo modulo. Cambia SOLO l'intestazione, mai i campi.
 *  · `pagina`   la rotta `/azienda`: titolo e sottotitolo, come ogni schermata.
 *  · `pannello` dentro la finestra delle impostazioni, dove il titolo lo porta
 *    già la finestra e la voce scelta nella colonnina: ripeterlo sarebbe la
 *    stessa parola tre volte in dieci centimetri. Resta il sottotitolo, che
 *    dice a che cosa servono i campi. */
export type Sede = 'pagina' | 'pannello';

function Intestazione({ sede }: { sede: Sede }) {
  const t = useT();
  return (
    <div className="page-head">
      {sede === 'pagina' && <div className="page-title">{t('companySettings.title')}</div>}
      <div className="page-desc">{t('companySettings.subtitle')}</div>
    </div>
  );
}

/** La rotta `/azienda`: resta viva per i segnalibri e per chi arriva da un
 *  indirizzo profondo, e mostra esattamente ciò che mostra il pannello. */
export function CompanySettingsPage() {
  return <CompanySettings sede="pagina" />;
}

export function CompanySettings({ sede }: { sede: Sede }) {
  const t = useT();
  const { showToast } = useToast();
  const {
    activeCompany, activeCompanyId, isAdmin, loading, error, refresh,
  } = useCompany();

  const [legalName, setLegalName] = useState('');
  const [uidChe, setUidChe] = useState('');
  const [canton, setCanton] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [legalForm, setLegalForm] = useState('');
  const [street, setStreet] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [countryCode, setCountryCode] = useState('CH');
  // 0053 — l'IBAN che le fatture emesse fotografano sulla polizza QR.
  const [bankIban, setBankIban] = useState('');

  const [savingCompany, setSavingCompany] = useState(false);
  const [savingLogo, setSavingLogo] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);

  // ⚠️ I campi si riempiono UNA VOLTA per azienda, non a ogni cambio dell'oggetto.
  // `refresh()` del contesto costruisce un `activeCompany` nuovo a ogni giro:
  // risincronizzare qui avrebbe sovrascritto — in silenzio — ciò che una persona
  // sta scrivendo e non ha ancora salvato. Cambiare azienda invece deve
  // ricaricare, altrimenti si guarderebbero i dati di un'impresa col nome di
  // un'altra.
  const syncedCompany = useRef<string | null>(null);
  useEffect(() => {
    if (!activeCompany || syncedCompany.current === activeCompany.id) return;
    syncedCompany.current = activeCompany.id;
    setLegalName(activeCompany.legalName ?? '');
    setUidChe(activeCompany.uidChe ?? '');
    setCanton(activeCompany.canton ?? CANTONI[0]);
    setMunicipality(activeCompany.municipality ?? '');
    setLegalForm(activeCompany.legalForm ?? FORME_GIURIDICHE[0]);
    setStreet(activeCompany.street ?? '');
    setPostalCode(activeCompany.postalCode ?? '');
    setCity(activeCompany.city ?? activeCompany.municipality ?? '');
    setCountryCode(activeCompany.countryCode ?? 'CH');
    setBankIban(activeCompany.bankIban ?? '');
  }, [activeCompany]);

  function applyRegistryFields(f: RegistryFields) {
    setLegalName(f.legalName);
    setUidChe(f.uidChe);
    if (f.canton) setCanton(f.canton);
    setMunicipality(f.municipality);
  }

  const uidInvalid = uidChe.replace(/\D/g, '').length >= 9 && !isValidUid(uidChe);
  // Un IBAN vuoto è lecito (la polizza QR semplicemente non si genera); un IBAN
  // scritto male NO: la cifra di controllo è l'unica cosa che distingue una
  // trascrizione giusta da una sbagliata, e un dato sbagliato non si salva.
  const ibanCheck = bankIban.trim() ? checkIban(bankIban) : null;
  const ibanInvalid = ibanCheck !== null && !ibanCheck.valid;

  async function saveCompany(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId || savingCompany) return;
    if (!legalName.trim()) { setCompanyError(t('onboarding.errorName')); return; }
    if (ibanInvalid) { setCompanyError(t('companySettings.ibanInvalid')); return; }
    setSavingCompany(true); setCompanyError(null);
    try {
      await companyService.updateCompany(activeCompanyId, {
        legalName: legalName.trim(),
        uidChe: uidChe.trim() || null,
        canton,
        municipality: municipality.trim() || null,
        legalForm,
        street: street.trim() || null,
        postalCode: postalCode.trim() || null,
        city: city.trim() || null,
        countryCode: countryCode.trim().toUpperCase() || null,
        // Si salva la forma compatta e maiuscola: quella che va sulla polizza.
        bankIban: ibanCheck?.valid ? ibanCheck.normalized : null,
      });
      await refresh();
      showToast(t('companySettings.savedCompany'));
    } catch (err) {
      setCompanyError(toUserMessage(err));
    } finally {
      setSavingCompany(false);
    }
  }

  // ⚠️ Lo scheletro solo quando non c'è ANCORA niente da mostrare. Su `loading`
  // e basta, ogni `refresh()` — cioè ogni salvataggio — smontava la schermata:
  // il campo di ricerca si svuotava e gli avvisi sull'origine dei dati
  // sparivano, proprio mentre si guardava che cosa era stato importato.
  if (loading && !activeCompany) {
    return (
      <>
        <Intestazione sede={sede} />
        <div className="card"><SkeletonLine width="60%" /><SkeletonLine width="80%" /></div>
      </>
    );
  }

  // Un guasto viene PRIMA di qualunque interpretazione: senza i dati
  // dell'azienda un modulo vuoto direbbe che i campi sono vuoti, che è falso.
  if (error) {
    return (
      <>
        <Intestazione sede={sede} />
        <div className="card"><ErrorState message={error} onRetry={() => void refresh()} /></div>
      </>
    );
  }

  return (
    <>
      <Intestazione sede={sede} />

      <form className="card" onSubmit={saveCompany}>
        <div className="card-title">{t('companySettings.identityTitle')}</div>
        <div className="muted-sm mb-3">{t('companySettings.identityDesc')}</div>

        {!isAdmin && (
          <div className="hint-accent mb-3" role="status">
            <Icon name="alert" className="ic-sm" /> {t('companySettings.readOnly')}
          </div>
        )}

        {isAdmin && (
          <RegistryLookup
            idPrefix="cs"
            current={{ legalName, uidChe, canton, municipality }}
            onApply={applyRegistryFields}
          />
        )}

        <div className="grid-2">
          <Input id="cs-name" label={t('onboarding.legalName')} required disabled={!isAdmin} value={legalName}
            onChange={(e) => setLegalName(e.target.value)} placeholder={t('onboarding.legalNamePlaceholder')} />
          <div className="field">
            <label htmlFor="cs-che">{t('onboarding.uid')}</label>
            <input id="cs-che" disabled={!isAdmin} value={uidChe}
              onChange={(e) => setUidChe(e.target.value)}
              onBlur={() => { const f = formatUid(uidChe); if (f) setUidChe(f); }}
              aria-invalid={uidInvalid || undefined}
              aria-describedby={uidInvalid ? 'cs-che-hint' : undefined}
              placeholder={t('onboarding.uidPlaceholder')} />
            {uidInvalid && (
              <div id="cs-che-hint" className="hint-accent mt-1">
                <Icon name="alert" className="ic-sm" /> {t('onboarding.uidInvalid')}
              </div>
            )}
          </div>
          <Select id="cs-canton" label={t('onboarding.canton')} disabled={!isAdmin} value={canton} onChange={(e) => setCanton(e.target.value)}>
            {CANTONI.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Input id="cs-mun" label={t('onboarding.municipality')} disabled={!isAdmin} value={municipality}
            onChange={(e) => setMunicipality(e.target.value)} placeholder={t('onboarding.municipalityPlaceholder')} />
          <Select id="cs-form" label={t('onboarding.legalForm')} disabled={!isAdmin} value={legalForm} onChange={(e) => setLegalForm(e.target.value)}>
            {FORME_GIURIDICHE.map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
          <Input id="cs-street" label={t('companySettings.street')} disabled={!isAdmin} value={street}
            onChange={(e) => setStreet(e.target.value)} />
          <Input id="cs-postal" label={t('companySettings.postalCode')} disabled={!isAdmin} value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)} />
          <Input id="cs-city" label={t('companySettings.city')} disabled={!isAdmin} value={city}
            onChange={(e) => setCity(e.target.value)} />
          <Input id="cs-country" label={t('companySettings.countryCode')} disabled={!isAdmin} value={countryCode}
            maxLength={2} onChange={(e) => setCountryCode(e.target.value.toUpperCase())} />
          <div className="field">
            <label htmlFor="cs-iban">{t('companySettings.iban')}</label>
            <input id="cs-iban" disabled={!isAdmin} value={bankIban}
              onChange={(e) => setBankIban(e.target.value)}
              // A campo lasciato, un IBAN che torna si riscrive a gruppi di
              // quattro: è la forma in cui le persone lo leggono davvero.
              onBlur={() => {
                if (ibanCheck?.valid) setBankIban(ibanCheck.normalized.replace(/(.{4})/g, '$1 ').trim());
              }}
              aria-invalid={ibanInvalid || undefined}
              aria-describedby={ibanInvalid ? 'cs-iban-hint' : 'cs-iban-desc'} />
            {ibanInvalid && (
              <div id="cs-iban-hint" className="hint-accent mt-1">
                <Icon name="alert" className="ic-sm" /> {t('companySettings.ibanInvalid')}
              </div>
            )}
            {!ibanInvalid && (
              <div id="cs-iban-desc" className="muted-sm mt-1">{t('companySettings.ibanHint')}</div>
            )}
          </div>
        </div>

        <div className="card-title mt-8">{t('companySettings.logoTitle')}</div>
        <div className="muted-sm mb-3">{t('companySettings.logoHint')}</div>
        <div className="row-wrap">
          {activeCompany?.logoStoragePath && <span className="muted-sm">{t('companySettings.logoConfigured')}</span>}
          {isAdmin && (
            <>
              <label className="btn btn-sm" htmlFor="cs-logo">{t('companySettings.logoChoose')}</label>
              <input id="cs-logo" className="sr-only" type="file" accept="image/png,image/jpeg"
                disabled={savingLogo} onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = '';
                  if (!file || !activeCompanyId) return;
                  setSavingLogo(true);
                  void companyService.uploadQuoteLogo(activeCompanyId, file)
                    .then(async () => { await refresh(); showToast(t('companySettings.logoSaved')); })
                    .catch((err) => setCompanyError(toUserMessage(err)))
                    .finally(() => setSavingLogo(false));
                }} />
              {activeCompany?.logoStoragePath && (
                <button type="button" className="btn btn-sm btn-ghost" disabled={savingLogo}
                  onClick={() => {
                    if (!activeCompanyId) return;
                    setSavingLogo(true);
                    void companyService.removeQuoteLogo(activeCompanyId)
                      .then(async () => { await refresh(); showToast(t('companySettings.logoRemoved')); })
                      .catch((err) => setCompanyError(toUserMessage(err)))
                      .finally(() => setSavingLogo(false));
                  }}>
                  {t('companySettings.logoRemove')}
                </button>
              )}
            </>
          )}
        </div>

        {companyError && <div className="form-error"><Icon name="alert" className="ic-sm" /><span>{companyError}</span></div>}

        {isAdmin && (
          <div className="row-wrap mt-8">
            <button className="btn btn-primary" type="submit" disabled={savingCompany} aria-busy={savingCompany || undefined}>
              {savingCompany ? <span className="spinner" aria-hidden="true" /> : null} {t('common.save')}
            </button>
          </div>
        )}
      </form>

    </>
  );
}
