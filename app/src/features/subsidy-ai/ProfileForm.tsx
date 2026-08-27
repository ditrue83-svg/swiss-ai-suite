// Profilo incentivi: descrive "cosa vuole realizzare l'azienda" e salva gli ambiti
// di progetto nel company_profile. La descrizione libera è interpretata dall'AI reale
// (Edge Function interpret-project); i tipi riconosciuti alimentano il matching
// deterministico a valle. L'idoneità NON è mai dichiarata qui.
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { MarkGlyph } from '@/components/ui/MarkGlyph';
import { Select, Textarea } from '@/components/ui/forms';
import { companyService } from '@/services/companyService';
import { interpretService } from '@/services/interpretService';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { toUserMessage } from '@/lib/errors';
import { useI18n, useT } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import type { ProjectInterpretation } from '@/types/models';
import { SETTORI, TIPI_PROGETTO } from './programs';

const MIN_DESC = 15; // allineato al minimo della Edge Function interpret-project
/** Sotto questa sicurezza l'ambito NON viene selezionato d'ufficio: lo propone soltanto. */
const MIN_TYPE_CONFIDENCE = 0.5;

export function ProfileForm({ onSaved }: { onSaved: (interpretation: ProjectInterpretation | null) => void }) {
  const { activeCompanyId, activeCompany, companyProfile, refreshProfile } = useCompany();
  const { showToast } = useToast();
  const { locale } = useI18n();   // §42
  const t = useT();
  const L = useLabels();

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
      showToast(t('subsidy.profile.tooShort'));
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
      showToast(t('subsidy.profile.noScope'));
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
      showToast(t('subsidy.profile.saved'));
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
      <div className="section-title">{t('subsidy.profile.title')}</div>
      <p className="muted-sm mb-14">
        {t('subsidy.profile.company')} <strong>{activeCompany?.legalName}</strong>{activeCompany?.canton ? ` · ${activeCompany.canton}` : ''}.{' '}
        {t('subsidy.profile.intro')}
      </p>

      <div className="grid-2">
        <Select id="sf-sector" label={t('onboarding.sector')} value={sector} onChange={(e) => setSector(e.target.value)}>
          <option value="">{t('onboarding.sectorPlaceholder')}</option>
          {SETTORI.map((s) => <option key={s.id} value={s.id}>{L.sector(s.id)}</option>)}
        </Select>
      </div>

      <Textarea id="sf-desc" label={t('subsidy.profile.description')}
        style={{ minHeight: 120 }} value={description} onChange={(e) => onDescriptionChange(e.target.value)}
        placeholder={t('subsidy.profile.descriptionPlaceholder')} />
      <div className="row-wrap mt-2">
        <button type="button" className="btn btn-sm" onClick={interpret} disabled={!canInterpret} aria-busy={interpreting || undefined}>
          {interpreting ? <span className="spinner" aria-hidden="true" /> : <Icon name="fileSearch" className="ic-sm" />} {t('subsidy.profile.interpret')}
        </button>
        <span className="muted-sm">{t('subsidy.profile.interpretHint')}</span>
      </div>

      {interpretation && (
        <div className="hint-accent mt-3" role="status">
          {interpretation.summary && <div className="mb-2">{interpretation.summary}</div>}
          {recognized.length > 0
            ? <>{t('subsidy.profile.recognized')} <strong>{recognized.map(L.projectType).join(', ')}</strong></>
            : <>{t('subsidy.profile.noneRecognized')}</>}
          {interpretation.timing.alreadyStarted === true && (
            <div className="mt-2"><Icon name="alert" className="ic-sm" /> {t('subsidy.profile.alreadyStarted')}</div>
          )}

          {/* Ambiti riconosciuti con poca sicurezza: decide l'utente, non l'AI. */}
          {uncertainTypes.length > 0 && (
            <div className="mt-2">
              {t('subsidy.profile.uncertainScopes')}{' '}
              {uncertainTypes.map((p, i) => (
                <span key={p.type}>
                  {i > 0 ? ', ' : ''}
                  <button type="button" className="btn-link" onClick={() => toggleProject(p.type)}>
                    {L.projectType(p.type)}
                  </button>
                </span>
              ))}
               {t('subsidy.profile.uncertainScopesHint')}
            </div>
          )}

          {/* §17 — ciò che l'AI non ha potuto stabilire va detto, non nascosto.
              Stessa grammatica del blocco incertezze dei documenti: superficie
              neutra e segno «da verificare» — dichiarare non è fallire. */}
          {interpretation.uncertainties.length > 0 && (
            <div className="verify-note mt-2" role="note">
              <span className="vn-title"><MarkGlyph name="question" />{t('subsidy.profile.toVerify')}</span>
              <ul>
                {interpretation.uncertainties.map((u, i) => <li key={i}>{u.description}</li>)}
              </ul>
            </div>
          )}
          {interpretation.meta.droppedEvidence > 0 && (
            <div className="muted-sm mt-1">
              {t('subsidy.profile.droppedEvidence', { n: interpretation.meta.droppedEvidence })}
            </div>
          )}
        </div>
      )}

      <div className="field">
        <span className="group-label">{t('subsidy.profile.scopes')}</span>
        <div className="checks" role="group" aria-label={t('subsidy.profile.scopesAria')}>
          {TIPI_PROGETTO.map((tp) => (
            <button key={tp.id} type="button" className={`check-pill${projects.includes(tp.id) ? ' on' : ''}`} aria-pressed={projects.includes(tp.id)} onClick={() => toggleProject(tp.id)}>{L.projectType(tp.id)}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="group-label">{t('subsidy.profile.situation')}</span>
        <div className="checks" role="group" aria-label={t('subsidy.profile.situation')}>
          <button type="button" className={`check-pill${ownsProperty ? ' on' : ''}`} aria-pressed={ownsProperty} onClick={() => setOwnsProperty((v) => !v)}>{t('subsidy.profile.ownsProperty')}</button>
          <button type="button" className={`check-pill${hasVehicles ? ' on' : ''}`} aria-pressed={hasVehicles} onClick={() => setHasVehicles((v) => !v)}>{t('subsidy.profile.hasVehicles')}</button>
        </div>
      </div>

      <div className="row-wrap">
        <button className="btn btn-primary btn-block-mobile" onClick={save} disabled={saving} aria-busy={saving || undefined}>
          {saving ? <span className="spinner" aria-hidden="true" /> : <Icon name="banknote" className="ic-sm" />} {t('subsidy.profile.submit')}
        </button>
      </div>
    </div>
  );
}
