// ============================================================================
// Impostazioni azienda — i dati anagrafici e il profilo operativo.
//
// Perché esiste: fino al 2026-07-28 i dati dell'azienda si potevano inserire
// SOLO all'onboarding, una volta sola. Un trasloco, un cambio di ragione
// sociale o una correzione non avevano dove andare, e la ricerca nel Registro
// IDI — appena accesa — sarebbe stata una funzione utilizzabile una volta e mai
// più.
//
// Due permessi diversi, dichiarati invece che scoperti al salvataggio:
//   · i DATI ANAGRAFICI (companies) li modificano solo titolare e
//     amministratori — è la policy `companies_update_admin` della 0001. Chi non
//     può, li vede in sola lettura e la schermata dice perché: offrire campi
//     che al salvataggio verranno rifiutati è la stessa trappola del pulsante
//     «Collega calendario» senza credenziali;
//   · il PROFILO OPERATIVO (company_profiles) lo modifica ogni membro: sono i
//     dati che alimentano il matching incentivi, non l'identità dell'impresa.
//
// ⚠️ Il profilo si salva LEGGENDO PRIMA quello esistente: `upsertCompanyProfile`
// scrive la riga intera, quindi mandare solo i tre campi di questa schermata
// azzererebbe immobili, veicoli e progetti — che nessuno ha toccato e che
// servono a Subsidy AI.
// ============================================================================
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonLine } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { useCompany } from '@/contexts/CompanyContext';
import { useT } from '@/i18n';
import { toUserMessage } from '@/lib/errors';
import { formatUid, isValidUid } from '@/lib/uid';
import { companyService } from '@/services/companyService';
import { RegistryLookup, type RegistryFields } from '@/features/companies/RegistryLookup';
import {
  CANTONI, FASCE_FATTURATO, FORME_GIURIDICHE, NO_REVENUE, SETTORI,
} from '@/features/subsidy-ai/programs';

export function CompanySettingsPage() {
  const t = useT();
  const { showToast } = useToast();
  const {
    activeCompany, activeCompanyId, companyProfile, isAdmin, loading, error,
    refresh, refreshProfile,
  } = useCompany();

  const [legalName, setLegalName] = useState('');
  const [uidChe, setUidChe] = useState('');
  const [canton, setCanton] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [legalForm, setLegalForm] = useState('');
  const [sector, setSector] = useState('');
  const [employeeCount, setEmployeeCount] = useState('');
  const [revenueBand, setRevenueBand] = useState(NO_REVENUE);

  const [savingCompany, setSavingCompany] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

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
  }, [activeCompany]);

  const syncedProfile = useRef<string | null>(null);
  useEffect(() => {
    if (!activeCompanyId || syncedProfile.current === activeCompanyId) return;
    if (loading) return; // il profilo può arrivare dopo l'azienda: non fissare un vuoto
    syncedProfile.current = activeCompanyId;
    setSector(companyProfile?.sector ?? '');
    setEmployeeCount(companyProfile?.employeeCount != null ? String(companyProfile.employeeCount) : '');
    setRevenueBand(companyProfile?.revenueBand ?? NO_REVENUE);
  }, [companyProfile, activeCompanyId, loading]);

  function applyRegistryFields(f: RegistryFields) {
    setLegalName(f.legalName);
    setUidChe(f.uidChe);
    if (f.canton) setCanton(f.canton);
    setMunicipality(f.municipality);
  }

  const uidInvalid = uidChe.replace(/\D/g, '').length >= 9 && !isValidUid(uidChe);

  async function saveCompany(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId || savingCompany) return;
    if (!legalName.trim()) { setCompanyError(t('onboarding.errorName')); return; }
    setSavingCompany(true); setCompanyError(null);
    try {
      await companyService.updateCompany(activeCompanyId, {
        legalName: legalName.trim(),
        uidChe: uidChe.trim() || null,
        canton,
        municipality: municipality.trim() || null,
        legalForm,
      });
      await refresh();
      showToast(t('companySettings.savedCompany'));
    } catch (err) {
      setCompanyError(toUserMessage(err));
    } finally {
      setSavingCompany(false);
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId || savingProfile) return;
    setSavingProfile(true); setProfileError(null);
    try {
      const employees = employeeCount.trim() === '' ? null : Number(employeeCount);
      await companyService.upsertCompanyProfile(activeCompanyId, {
        sector: sector || null,
        employeeCount: Number.isFinite(employees) ? employees : null,
        // ⚠️ `NO_REVENUE` è l'etichetta della SCELTA «non indico», non un dato:
        // nel database «non indicato» si scrive `null`, come fa l'onboarding.
        // Salvarlo alla lettera metteva la stringa italiana in una colonna che
        // le altre schermate leggono — trovato confrontando il DB dopo un
        // salvataggio, non guardando lo schermo, dove sembrava tutto giusto.
        revenueBand: revenueBand === NO_REVENUE ? null : revenueBand,
        // ⚠️ Non sono campi di questa schermata: si riportano com'erano, perché
        // l'upsert riscrive la riga intera e ometterli li azzererebbe.
        ownsProperty: companyProfile?.ownsProperty ?? false,
        vehicleCount: companyProfile?.vehicleCount ?? 0,
        currentProjects: companyProfile?.currentProjects ?? [],
      });
      await refreshProfile();
      showToast(t('companySettings.savedProfile'));
    } catch (err) {
      setProfileError(toUserMessage(err));
    } finally {
      setSavingProfile(false);
    }
  }

  // ⚠️ Lo scheletro solo quando non c'è ANCORA niente da mostrare. Su `loading`
  // e basta, ogni `refresh()` — cioè ogni salvataggio — smontava la schermata:
  // il campo di ricerca si svuotava e gli avvisi sull'origine dei dati
  // sparivano, proprio mentre si guardava che cosa era stato importato.
  if (loading && !activeCompany) {
    return (
      <>
        <div className="page-head">
          <div className="page-title">{t('companySettings.title')}</div>
        </div>
        <div className="card"><SkeletonLine width="60%" /><SkeletonLine width="80%" /></div>
      </>
    );
  }

  // Un guasto viene PRIMA di qualunque interpretazione: senza i dati
  // dell'azienda un modulo vuoto direbbe che i campi sono vuoti, che è falso.
  if (error) {
    return (
      <>
        <div className="page-head">
          <div className="page-title">{t('companySettings.title')}</div>
        </div>
        <div className="card"><ErrorState message={error} onRetry={() => void refresh()} /></div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('companySettings.title')}</div>
        <div className="page-desc">{t('companySettings.subtitle')}</div>
      </div>

      <form className="card" onSubmit={saveCompany}>
        <div className="card-title">{t('companySettings.identityTitle')}</div>
        <div className="muted-sm" style={{ marginBottom: 12 }}>{t('companySettings.identityDesc')}</div>

        {!isAdmin && (
          <div className="hint-accent" role="status" style={{ marginBottom: 12 }}>
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
          <div className="field">
            <label htmlFor="cs-name">{t('onboarding.legalName')}</label>
            <input id="cs-name" required disabled={!isAdmin} value={legalName}
              onChange={(e) => setLegalName(e.target.value)} placeholder={t('onboarding.legalNamePlaceholder')} />
          </div>
          <div className="field">
            <label htmlFor="cs-che">{t('onboarding.uid')}</label>
            <input id="cs-che" disabled={!isAdmin} value={uidChe}
              onChange={(e) => setUidChe(e.target.value)}
              onBlur={() => { const f = formatUid(uidChe); if (f) setUidChe(f); }}
              aria-invalid={uidInvalid || undefined}
              aria-describedby={uidInvalid ? 'cs-che-hint' : undefined}
              placeholder={t('onboarding.uidPlaceholder')} />
            {uidInvalid && (
              <div id="cs-che-hint" className="hint-accent" style={{ marginTop: 4 }}>
                <Icon name="alert" className="ic-sm" /> {t('onboarding.uidInvalid')}
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor="cs-canton">{t('onboarding.canton')}</label>
            <select id="cs-canton" disabled={!isAdmin} value={canton} onChange={(e) => setCanton(e.target.value)}>
              {CANTONI.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cs-mun">{t('onboarding.municipality')}</label>
            <input id="cs-mun" disabled={!isAdmin} value={municipality}
              onChange={(e) => setMunicipality(e.target.value)} placeholder={t('onboarding.municipalityPlaceholder')} />
          </div>
          <div className="field">
            <label htmlFor="cs-form">{t('onboarding.legalForm')}</label>
            <select id="cs-form" disabled={!isAdmin} value={legalForm} onChange={(e) => setLegalForm(e.target.value)}>
              {FORME_GIURIDICHE.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
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

      <form className="card" onSubmit={saveProfile}>
        <div className="card-title">{t('companySettings.profileTitle')}</div>
        <div className="muted-sm" style={{ marginBottom: 12 }}>{t('companySettings.profileDesc')}</div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="cs-sector">{t('onboarding.sector')}</label>
            <select id="cs-sector" value={sector} onChange={(e) => setSector(e.target.value)}>
              <option value="">{t('onboarding.sectorPlaceholder')}</option>
              {SETTORI.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cs-emp">{t('onboarding.employees')}</label>
            <input id="cs-emp" type="number" min={0} value={employeeCount}
              onChange={(e) => setEmployeeCount(e.target.value)} placeholder={t('onboarding.employeesPlaceholder')} />
          </div>
          <div className="field">
            <label htmlFor="cs-rev">{t('onboarding.revenue')}</label>
            <select id="cs-rev" value={revenueBand} onChange={(e) => setRevenueBand(e.target.value)}>
              {FASCE_FATTURATO.map((f) => (
                <option key={f} value={f}>{f === NO_REVENUE ? t('onboarding.noPreference') : f}</option>
              ))}
            </select>
          </div>
        </div>

        {profileError && <div className="form-error"><Icon name="alert" className="ic-sm" /><span>{profileError}</span></div>}

        <div className="row-wrap mt-8">
          <button className="btn btn-primary" type="submit" disabled={savingProfile} aria-busy={savingProfile || undefined}>
            {savingProfile ? <span className="spinner" aria-hidden="true" /> : null} {t('common.save')}
          </button>
        </div>
      </form>
    </>
  );
}
