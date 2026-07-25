// Profilo incentivi: descrive "cosa vuole realizzare l'azienda" e salva gli ambiti
// di progetto nel company_profile. La descrizione libera è interpretata dall'AI reale
// (Edge Function interpret-project); i tipi riconosciuti alimentano il matching
// deterministico a valle. L'idoneità NON è mai dichiarata qui.
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { companyService } from '@/services/companyService';
import { interpretService } from '@/services/interpretService';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { toUserMessage } from '@/lib/errors';
import { useI18n } from '@/i18n';
import type { ProjectInterpretation } from '@/types/models';
import { SETTORI, TIPI_PROGETTO, labelTipo } from './programs';

const MIN_DESC = 15; // allineato al minimo della Edge Function interpret-project
/** Sotto questa sicurezza l'ambito NON viene selezionato d'ufficio: lo propone soltanto. */
const MIN_TYPE_CONFIDENCE = 0.5;

export function ProfileForm({ onSaved }: { onSaved: (interpretation: ProjectInterpretation | null) => void }) {
  const { activeCompanyId, activeCompany, companyProfile, refreshProfile } = useCompany();
  const { showToast } = useToast();
  const { locale } = useI18n();   // §42

  const [sector, setSector] = useState(companyProfile?.sector ?? '');
  const [projects, setProjects] = useState<string[]>(companyProfile?.currentProjects ?? []);
  const [description, setDescription] = useState('');
  const [ownsProperty, setOwnsProperty] = useState(companyProfile?.ownsProperty ?? false);
  const [hasVehicles, setHasVehicles] = useState((companyProfile?.vehicleCount ?? 0) > 0);
  const [interpreting, setInterpreting] = useState(false);
  const [interpretation, setInterpretation] = useState<ProjectInterpretation | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleProject(id: string) {
    setProjects((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function onDescriptionChange(value: string) {
    setDescription(value);
    // L'interpretazione non corrisponde più al testo modificato: azzerala.
    if (interpretation) setInterpretation(null);
  }

  async function interpret() {
    if (interpreting) return;
    if (description.trim().length < MIN_DESC) {
      showToast('Descrivi il progetto con qualche frase in più prima di interpretarlo.');
      return;
    }
    setInterpreting(true);
    try {
      const result = await interpretService.interpret(activeCompanyId as string, description.trim(), locale);
      setInterpretation(result);
      // Sono le chip a decidere quali programmi verranno proposti: un ambito
      // riconosciuto con poca sicurezza non deve entrarci di nascosto. Si
      // aggiungono solo quelli sopra soglia (la stessa usata per il settore);
      // gli altri restano come proposta da confermare a mano.
      const confident = result.projectTypes.filter((p) => p.confidence >= MIN_TYPE_CONFIDENCE).map((p) => p.type);
      setProjects((prev) => {
        const merged = [...prev];
        for (const t of confident) if (!merged.includes(t)) merged.push(t);
        return merged;
      });
      // Prefill del settore se non indicato e l'AI è ragionevolmente sicura.
      const sv = result.sector.value;
      if (!sector && sv && result.sector.confidence >= 0.5 && SETTORI.some((s) => s.id === sv)) setSector(sv);
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setInterpreting(false);
    }
  }

  async function save() {
    if (saving) return;
    if (projects.length === 0) {
      showToast('Indica almeno un ambito di progetto (interpreta la descrizione o selezionalo qui sotto).');
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
        currentProjects: projects,
      });
      await refreshProfile();
      showToast('Profilo incentivi salvato');
      onSaved(interpretation);
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const recognized = interpretation
    ? interpretation.projectTypes.filter((p) => p.confidence >= MIN_TYPE_CONFIDENCE).map((p) => p.type)
    : [];
  // Ambiti riconosciuti con poca sicurezza: proposti, non applicati.
  const uncertainTypes = interpretation
    ? interpretation.projectTypes.filter((p) => p.confidence < MIN_TYPE_CONFIDENCE && !projects.includes(p.type))
    : [];
  const canInterpret = description.trim().length >= MIN_DESC && !interpreting;

  return (
    <div className="card">
      <div className="section-title">Cosa vuole realizzare la tua azienda?</div>
      <p className="muted-sm mb-14">
        Impresa: <strong>{activeCompany?.legalName}</strong>{activeCompany?.canton ? ` · ${activeCompany.canton}` : ''}.
        Descrivi il progetto: l’AI lo interpreta e propone gli ambiti pertinenti, che potrai approvare o correggere.
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
        <textarea id="sf-desc" style={{ minHeight: 120 }} value={description} onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Es. Vogliamo installare un impianto fotovoltaico sul tetto del capannone, sostituire due furgoni diesel con veicoli elettrici e digitalizzare la gestione degli ordini." />
        <div className="row-wrap" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-sm" onClick={interpret} disabled={!canInterpret} aria-busy={interpreting || undefined}>
            {interpreting ? <span className="spinner" aria-hidden="true" /> : <Icon name="fileSearch" className="ic-sm" />} Interpreta il progetto con l’AI
          </button>
          <span className="muted-sm">L’AI riconosce gli ambiti e spiega la pertinenza; l’idoneità resta da verificare.</span>
        </div>

        {interpretation && (
          <div className="hint-accent" role="status" style={{ marginTop: 10 }}>
            {interpretation.summary && <div style={{ marginBottom: 6 }}>{interpretation.summary}</div>}
            {recognized.length > 0
              ? <>Ambiti riconosciuti e aggiunti sotto (correggibili): <strong>{recognized.map(labelTipo).join(', ')}</strong>.</>
              : <>L’AI non ha riconosciuto ambiti specifici: selezionali manualmente qui sotto.</>}
            {interpretation.timing.alreadyStarted === true && (
              <div style={{ marginTop: 6 }}><Icon name="alert" className="ic-sm" /> Il progetto sembra già avviato: attenzione ai programmi con «domanda prima di iniziare».</div>
            )}

            {/* Ambiti riconosciuti con poca sicurezza: decide l'utente, non l'AI. */}
            {uncertainTypes.length > 0 && (
              <div style={{ marginTop: 8 }}>
                Ambiti <strong>incerti</strong>, non aggiunti automaticamente:{' '}
                {uncertainTypes.map((p, i) => (
                  <span key={p.type}>
                    {i > 0 ? ', ' : ''}
                    <button type="button" className="btn-link" onClick={() => toggleProject(p.type)}>
                      {labelTipo(p.type)}
                    </button>
                  </span>
                ))}
                . Aggiungili solo se pertinenti.
              </div>
            )}

            {/* §17 — ciò che l'AI non ha potuto stabilire va detto, non nascosto. */}
            {interpretation.uncertainties.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <strong>Da verificare:</strong>
                <ul className="detail-list warn" style={{ marginTop: 4 }}>
                  {interpretation.uncertainties.map((u, i) => <li key={i}>{u.description}</li>)}
                </ul>
              </div>
            )}
            {interpretation.meta.droppedEvidence > 0 && (
              <div className="muted-sm" style={{ marginTop: 4 }}>
                {interpretation.meta.droppedEvidence} citazione/i non ritrovate nel testo sono state scartate.
              </div>
            )}
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
