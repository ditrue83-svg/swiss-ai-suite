// Onboarding primo accesso: crea azienda + membership owner + profilo azienda.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { companyService } from '@/services/companyService';
import { RegistryLookup, type RegistryFields } from '@/features/companies/RegistryLookup';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { toUserMessage } from '@/lib/errors';
import { formatUid, isValidUid } from '@/lib/uid';
import { useT } from '@/i18n';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { CANTONI, FORME_GIURIDICHE, SETTORI, FASCE_FATTURATO, NO_REVENUE } from '@/features/subsidy-ai/programs';

export function OnboardingPage() {
  const navigate = useNavigate();
  const t = useT();
  const { hasCompany, loading, refresh, setActiveCompany } = useCompany();
  const { session, signOut } = useAuth();
  const recoveryTried = useRef(false);

  // Recupero: se c'è una sessione ma nessuna azienda risulta caricata, ritenta
  // UNA volta il fetch delle membership. Difende dal caso in cui il primo
  // caricamento sia tornato a vuoto (es. transiente): un utente che ha già
  // un'azienda non deve restare bloccato sull'onboarding. Un utente realmente
  // nuovo ottiene comunque lista vuota e resta qui (nessun effetto collaterale).
  useEffect(() => {
    if (session && !hasCompany && !loading && !recoveryTried.current) {
      recoveryTried.current = true;
      void refresh();
    }
  }, [session, hasCompany, loading, refresh]);

  const [legalName, setLegalName] = useState('');
  const [uidChe, setUidChe] = useState('');
  const [canton, setCanton] = useState('Ticino');
  const [municipality, setMunicipality] = useState('');
  const [legalForm, setLegalForm] = useState('Sagl');
  const [sector, setSector] = useState('');
  const [employeeCount, setEmployeeCount] = useState('');
  const [revenueBand, setRevenueBand] = useState(NO_REVENUE);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // La ricerca nel Registro IDI (Zefix) vive in `RegistryLookup`, condiviso con
  // le impostazioni azienda: le due schermate devono dire la stessa cosa sugli
  // stessi dati, comprese le condizioni d'uso dell'API.

  /** Applica al modulo ciò che il registro ha dato (vedi RegistryLookup). */
  function applyRegistryFields(f: RegistryFields) {
    setLegalName(f.legalName);
    setUidChe(f.uidChe);
    if (f.canton) setCanton(f.canton);
    setMunicipality(f.municipality);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (!legalName.trim()) { setError(t('onboarding.errorName')); return; }
    setSubmitting(true);
    try {
      const empParsed = employeeCount.trim() === '' ? null : Number(employeeCount);
      const companyId = await companyService.createCompanyWithOwner({
        legalName,
        uidChe: uidChe.trim() || null,
        canton,
        municipality: municipality.trim() || null,
        legalForm,
        sector: sector || null,
        employeeCount: empParsed != null && Number.isFinite(empParsed) ? empParsed : null,
        revenueBand: revenueBand === NO_REVENUE ? null : revenueBand,
      });
      await refresh();
      setActiveCompany(companyId);
      navigate('/', { replace: true });
    } catch (err) {
      setError(toUserMessage(err));
      setSubmitting(false);
    }
  }

  // Avviso IDI: solo quando ci sono abbastanza cifre (non a ogni tasto) e la
  // cifra di controllo non torna. Non blocca l'invio: segnala, non decide.
  const uidInvalid = uidChe.replace(/\D/g, '').length >= 9 && !isValidUid(uidChe);

  // L'onboarding non va mai mostrato a chi ha già un'azienda: torna all'app
  // (es. dopo che il recupero qui sopra ha ricaricato le membership).
  if (hasCompany) return <Navigate to="/" replace />;

  return (
    <div className="centered-screen">
      <div className="auth-card onboarding-card">
        <div className="auth-brand">
          <div className="brand-mark" aria-hidden="true"><Icon name="building" /></div>
          <div><div className="brand-name">{t('brand.name')}</div><div className="brand-sub">{t('brand.tagline')}</div></div>
        </div>
        <div className="auth-title">{t('onboarding.title')}</div>
        <div className="auth-sub">{t('onboarding.subtitle')}</div>

        <RegistryLookup
          idPrefix="ob"
          current={{ legalName, uidChe, canton, municipality }}
          onApply={applyRegistryFields}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <LanguageSwitcher compact />
        </div>

        {error && <div className="form-error"><Icon name="alert" className="ic-sm" /><span>{error}</span></div>}

        <form onSubmit={onSubmit} noValidate>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="ob-name">{t('onboarding.legalName')}</label>
              <input id="ob-name" required value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder={t('onboarding.legalNamePlaceholder')} />
            </div>
            <div className="field">
              <label htmlFor="ob-che">{t('onboarding.uid')}</label>
              <input id="ob-che" value={uidChe} onChange={(e) => setUidChe(e.target.value)}
                onBlur={() => { const f = formatUid(uidChe); if (f) setUidChe(f); }}
                aria-invalid={uidInvalid || undefined}
                aria-describedby={uidInvalid ? 'ob-che-hint' : undefined}
                placeholder={t('onboarding.uidPlaceholder')} />
              {uidInvalid && (
                <div id="ob-che-hint" className="hint-accent" style={{ marginTop: 4 }}>
                  <Icon name="alert" className="ic-sm" /> {t('onboarding.uidInvalid')}
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="ob-canton">{t('onboarding.canton')}</label>
              <select id="ob-canton" value={canton} onChange={(e) => setCanton(e.target.value)}>
                {CANTONI.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ob-mun">{t('onboarding.municipality')}</label>
              <input id="ob-mun" value={municipality} onChange={(e) => setMunicipality(e.target.value)} placeholder={t('onboarding.municipalityPlaceholder')} />
            </div>
            <div className="field">
              <label htmlFor="ob-form">{t('onboarding.legalForm')}</label>
              <select id="ob-form" value={legalForm} onChange={(e) => setLegalForm(e.target.value)}>
                {FORME_GIURIDICHE.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ob-sector">{t('onboarding.sector')}</label>
              <select id="ob-sector" value={sector} onChange={(e) => setSector(e.target.value)}>
                <option value="">{t('onboarding.sectorPlaceholder')}</option>
                {SETTORI.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ob-emp">{t('onboarding.employees')}</label>
              <input id="ob-emp" type="number" min={0} value={employeeCount} onChange={(e) => setEmployeeCount(e.target.value)} placeholder={t('onboarding.employeesPlaceholder')} />
            </div>
            <div className="field">
              <label htmlFor="ob-rev">{t('onboarding.revenue')}</label>
              <select id="ob-rev" value={revenueBand} onChange={(e) => setRevenueBand(e.target.value)}>
                {FASCE_FATTURATO.map((f) => <option key={f} value={f}>{f === NO_REVENUE ? t('onboarding.noPreference') : f}</option>)}
              </select>
            </div>
          </div>

          <div className="row-wrap mt-8">
            <button className="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting || undefined}>
              {submitting ? <span className="spinner" aria-hidden="true" /> : null} {t('onboarding.submit')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => signOut()}>{t('nav.signOut')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
