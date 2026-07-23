// Profilo incentivi: descrive "cosa vuole realizzare l'azienda" e salva gli ambiti
// di progetto nel company_profile (i dati anagrafici stanno già nell'onboarding).
import { useMemo, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { companyService } from '@/services/companyService';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { toUserMessage } from '@/lib/errors';
import { SETTORI, TIPI_PROGETTO, interpretProjectDescription, labelTipo } from './programs';

export function ProfileForm({ onSaved }: { onSaved: () => void }) {
  const { activeCompanyId, activeCompany, companyProfile, refreshProfile } = useCompany();
  const { showToast } = useToast();

  const [sector, setSector] = useState(companyProfile?.sector ?? '');
  const [projects, setProjects] = useState<string[]>(companyProfile?.currentProjects ?? []);
  const [description, setDescription] = useState('');
  const [ownsProperty, setOwnsProperty] = useState(companyProfile?.ownsProperty ?? false);
  const [hasVehicles, setHasVehicles] = useState((companyProfile?.vehicleCount ?? 0) > 0);
  const [saving, setSaving] = useState(false);

  const suggestions = useMemo(() => interpretProjectDescription(description), [description]);

  function toggleProject(id: string) {
    setProjects((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function applySuggestions() {
    setProjects((prev) => {
      const merged = [...prev];
      for (const s of suggestions) if (!merged.includes(s)) merged.push(s);
      return merged;
    });
  }

  async function save() {
    if (saving) return;
    // integra i suggerimenti non ancora aggiunti
    const finalProjects = [...projects];
    for (const s of suggestions) if (!finalProjects.includes(s)) finalProjects.push(s);
    if (finalProjects.length === 0) {
      showToast('Indica almeno un ambito di progetto o descrivi cosa vuole realizzare l’azienda');
      return;
    }
    setSaving(true);
    try {
      await companyService.upsertCompanyProfile(activeCompanyId as string, {
        sector: sector || null,
        employeeCount: companyProfile?.employeeCount ?? null,
        revenueBand: companyProfile?.revenueBand ?? null,
        ownsProperty,
        vehicleCount: hasVehicles ? Math.max(1, companyProfile?.vehicleCount ?? 1) : 0,
        currentProjects: finalProjects,
      });
      await refreshProfile();
      showToast('Profilo incentivi salvato');
      onSaved();
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="section-title">Cosa vuole realizzare la tua azienda?</div>
      <p className="muted-sm mb-14">
        Impresa: <strong>{activeCompany?.legalName}</strong>{activeCompany?.canton ? ` · ${activeCompany.canton}` : ''}.
        Descrivi il progetto: il sistema suggerisce gli ambiti pertinenti, che potrai approvare o correggere.
      </p>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="sf-sector">Settore</label>
          <select id="sf-sector" value={sector} onChange={(e) => setSector(e.target.value)}>
            <option value="">— Seleziona —</option>
            {SETTORI.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="sf-desc">Descrizione del progetto</label>
        <textarea id="sf-desc" style={{ minHeight: 120 }} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Es. Vogliamo installare un impianto fotovoltaico sul tetto del capannone, sostituire due furgoni diesel con veicoli elettrici e digitalizzare la gestione degli ordini." />
        {suggestions.length > 0 && (
          <div className="hint-accent">
            Ambiti riconosciuti: {suggestions.map(labelTipo).join(', ')}.{' '}
            <button type="button" className="btn-link" onClick={applySuggestions}>Aggiungili tutti</button>
          </div>
        )}
      </div>

      <div className="field">
        <span className="group-label">Ambiti del progetto (approva o correggi)</span>
        <div className="checks" role="group" aria-label="Ambiti del progetto">
          {TIPI_PROGETTO.map((t) => (
            <button key={t.id} type="button" className={`check-pill${projects.includes(t.id) ? ' on' : ''}`} aria-pressed={projects.includes(t.id)} onClick={() => toggleProject(t.id)}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="group-label">Situazione</span>
        <div className="checks" role="group" aria-label="Situazione aziendale">
          <button type="button" className={`check-pill${ownsProperty ? ' on' : ''}`} aria-pressed={ownsProperty} onClick={() => setOwnsProperty((v) => !v)}>Possiede o utilizza immobili</button>
          <button type="button" className={`check-pill${hasVehicles ? ' on' : ''}`} aria-pressed={hasVehicles} onClick={() => setHasVehicles((v) => !v)}>Ha veicoli aziendali</button>
        </div>
      </div>

      <div className="row-wrap">
        <button className="btn btn-primary btn-block-mobile" onClick={save} disabled={saving} aria-busy={saving || undefined}>
          {saving ? <span className="spinner" aria-hidden="true" /> : <Icon name="banknote" className="ic-sm" />} Trova incentivi rilevanti
        </button>
      </div>
    </div>
  );
}
