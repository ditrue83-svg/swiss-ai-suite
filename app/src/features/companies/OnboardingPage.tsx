// Onboarding primo accesso: crea azienda + membership owner + profilo azienda.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { companyService } from '@/services/companyService';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { toUserMessage } from '@/lib/errors';
import { CANTONI, FORME_GIURIDICHE, SETTORI, FASCE_FATTURATO } from '@/features/subsidy-ai/programs';

export function OnboardingPage() {
  const navigate = useNavigate();
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
  const [revenueBand, setRevenueBand] = useState('Preferisco non indicare');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (!legalName.trim()) { setError('Inserisci la ragione sociale.'); return; }
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
        revenueBand: revenueBand === 'Preferisco non indicare' ? null : revenueBand,
      });
      await refresh();
      setActiveCompany(companyId);
      navigate('/', { replace: true });
    } catch (err) {
      setError(toUserMessage(err));
      setSubmitting(false);
    }
  }

  // L'onboarding non va mai mostrato a chi ha già un'azienda: torna all'app
  // (es. dopo che il recupero qui sopra ha ricaricato le membership).
  if (hasCompany) return <Navigate to="/" replace />;

  return (
    <div className="centered-screen">
      <div className="auth-card onboarding-card">
        <div className="auth-brand">
          <div className="brand-mark" aria-hidden="true"><Icon name="building" /></div>
          <div><div className="brand-name">SwissAI Suite</div><div className="brand-sub">per le PMI svizzere</div></div>
        </div>
        <div className="auth-title">Configura la tua impresa</div>
        <div className="auth-sub">Questi dati alimentano l’analisi documenti e il matching incentivi. Potrai modificarli in seguito.</div>

        <div className="info-box mb-18">
          <Icon name="alert" className="ic-sm" /> Ricerca automatica nel Registro IDI prevista in una fase successiva. Per ora inserisci il numero CHE manualmente.
        </div>

        {error && <div className="form-error"><Icon name="alert" className="ic-sm" /><span>{error}</span></div>}

        <form onSubmit={onSubmit} noValidate>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="ob-name">Ragione sociale</label>
              <input id="ob-name" required value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Es. Rossi Impianti Sagl" />
            </div>
            <div className="field">
              <label htmlFor="ob-che">Numero IDI / CHE</label>
              <input id="ob-che" value={uidChe} onChange={(e) => setUidChe(e.target.value)} placeholder="CHE-123.456.789" />
            </div>
            <div className="field">
              <label htmlFor="ob-canton">Cantone</label>
              <select id="ob-canton" value={canton} onChange={(e) => setCanton(e.target.value)}>
                {CANTONI.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ob-mun">Comune</label>
              <input id="ob-mun" value={municipality} onChange={(e) => setMunicipality(e.target.value)} placeholder="Es. Lugano" />
            </div>
            <div className="field">
              <label htmlFor="ob-form">Forma giuridica</label>
              <select id="ob-form" value={legalForm} onChange={(e) => setLegalForm(e.target.value)}>
                {FORME_GIURIDICHE.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ob-sector">Settore</label>
              <select id="ob-sector" value={sector} onChange={(e) => setSector(e.target.value)}>
                <option value="">— Seleziona —</option>
                {SETTORI.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ob-emp">Numero dipendenti</label>
              <input id="ob-emp" type="number" min={0} value={employeeCount} onChange={(e) => setEmployeeCount(e.target.value)} placeholder="Es. 12" />
            </div>
            <div className="field">
              <label htmlFor="ob-rev">Fascia di fatturato (facoltativa)</label>
              <select id="ob-rev" value={revenueBand} onChange={(e) => setRevenueBand(e.target.value)}>
                {FASCE_FATTURATO.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>

          <div className="row-wrap mt-8">
            <button className="btn btn-primary" type="submit" disabled={submitting} aria-busy={submitting || undefined}>
              {submitting ? <span className="spinner" aria-hidden="true" /> : null} Crea impresa e continua
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => signOut()}>Esci</button>
          </div>
        </form>
      </div>
    </div>
  );
}
