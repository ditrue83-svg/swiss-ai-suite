// ============================================================================
// CrmFieldsPanel — le DEFINIZIONI dei campi personalizzati (migrazione 0047).
//
// Che cosa si configura qui: il NOME (l'etichetta in scheda), il TIPO (testo,
// numero, data, lista a scelta), le VOCI della lista, l'obbligatorietà e
// l'ordine di comparsa. I valori si scrivono nella scheda, non qui.
//
// ⚠️ DUE PERMESSI DIVERSI, dichiarati invece che scoperti al salvataggio —
// la stessa disciplina dei dati anagrafici aziendali: le definizioni le
// cambiano solo titolare e amministratori (policy `crm_field_defs_*`, 0047),
// e chi non può le vede in sola lettura con la spiegazione del perché. I
// VALORI invece li scrive ogni membro: sono attributi della scheda.
//
// ⚠️ TIPO ED ENTITÀ SONO CONGELATI ALLA NASCITA. Cambiare «numero» in «testo»
// con i valori già scritti renderebbe quelle righe false: un campo diverso è
// un campo nuovo, e in modifica il tipo si mostra ma non si offre.
//
// ⚠️ SI ARCHIVIA, NON SI CANCELLA. I valori già scritti restano nel database
// e tornano visibili al ripristino: è la disciplina di `archived_at` (§123),
// e il pannello la dichiara a parole invece di lasciarla intuire.
// ============================================================================
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Tag } from '@/components/ui/Tag';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/forms';
import { ErrorState, SkeletonLine } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { useCompany } from '@/contexts/CompanyContext';
import { useT, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import type { Sede } from '@/components/layout/nav';
import type { CrmFieldEntity, CrmFieldType } from '@/types/database';
import type { CrmFieldDefinition } from '@/types/models';
import { crmService } from '@/services/crmService';
import {
  CRM_FIELD_ENTITIES, CRM_FIELD_OPTIONS_MAX, CRM_FIELD_TYPES, parseFieldOptions,
} from './crmFields';
import styles from './crm.module.css';

/** La rotta `/campi-personalizzati`: resta viva per i segnalibri, come ogni
 *  voce delle impostazioni, e mostra esattamente ciò che mostra il pannello. */
export function CrmFieldsPage() {
  return <CrmFieldsPanel sede="pagina" />;
}

/* Titolo di sezione per entità, per esteso: una chiave composta
 * (`section${entity}`) sfuggirebbe al controllo di copertura i18n. */
const SECTION_KEY: Record<CrmFieldEntity, TKey> = {
  organization: 'crmFields.sectionOrganizations',
  opportunity: 'crmFields.sectionOpportunities',
};

export function CrmFieldsPanel({ sede }: { sede: Sede }) {
  const t = useT();
  const { activeCompanyId, isAdmin } = useCompany();
  const [defs, setDefs] = useState<CrmFieldDefinition[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      // Le due entità si leggono insieme, archiviati compresi: il ripristino
      // è un gesto di questa schermata, non di un'altra.
      const perEntity = await Promise.all(
        CRM_FIELD_ENTITIES.map((entity) => crmService.fieldDefinitions(activeCompanyId, entity, true)),
      );
      setDefs(perEntity.flat());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [activeCompanyId]);

  useEffect(() => { void load(); }, [load]);

  if (!activeCompanyId) return null;

  return (
    <>
      <div className="page-head">
        {sede === 'pagina' && <div className="page-title">{t('crmFields.title')}</div>}
        <div className="page-desc">{t('crmFields.subtitle')}</div>
      </div>

      {/* Il permesso non è questo avviso: è la policy del database. Chi non è
          amministratore vede le definizioni perché ne scrive i valori in
          scheda, e la schermata dice perché non può cambiarle. */}
      {!isAdmin && (
        <div className="hint-accent mb-3" role="status">
          <Icon name="alert" className="ic-sm" /> {t('crmFields.readOnly')}
        </div>
      )}

      {loadError ? (
        <div className="card">
          <ErrorState message={t(loadError as TKey) || loadError} onRetry={() => void load()} />
        </div>
      ) : defs === null ? (
        <div className="card"><SkeletonLine width="60%" /><SkeletonLine width="80%" /></div>
      ) : (
        CRM_FIELD_ENTITIES.map((entity) => (
          <FieldSection
            key={entity}
            companyId={activeCompanyId}
            entity={entity}
            defs={defs.filter((d) => d.entity === entity)}
            isAdmin={isAdmin}
            onChanged={load}
          />
        ))
      )}

      {/* La regola dell'archiviazione, detta una volta per tutte in fondo:
          non c'è un pulsante «elimina» da nessuna parte, e chi lo cerca trova
          qui il perché. */}
      <p className="muted-sm mt-8">{t('crmFields.archiveRule')}</p>
    </>
  );
}

// ---------------------------------------------------------------------------
function FieldSection({ companyId, entity, defs, isAdmin, onChanged }: {
  companyId: string;
  entity: CrmFieldEntity;
  defs: CrmFieldDefinition[];
  isAdmin: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const L = useLabels();
  const { showToast } = useToast();
  const attivi = defs.filter((d) => d.archivedAt === null);
  const archiviati = defs.filter((d) => d.archivedAt !== null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [fieldType, setFieldType] = useState<CrmFieldType>('text');
  const [optionsRaw, setOptionsRaw] = useState('');
  const [required, setRequired] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function startEdit(d: CrmFieldDefinition) {
    setEditingId(d.id);
    setName(d.name);
    setFieldType(d.fieldType);
    setOptionsRaw(d.options.join('\n'));
    setRequired(d.isRequired);
    setFormError(null);
  }

  function resetForm() {
    setEditingId(null);
    setName('');
    setFieldType('text');
    setOptionsRaw('');
    setRequired(false);
    setFormError(null);
  }

  async function run(action: () => Promise<void>, successKey: TKey) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      showToast(t(successKey));
      await onChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t(msg as TKey) || msg);
    } finally {
      setBusy(false);
    }
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (busy) return;
    const cleanName = name.trim();
    if (!cleanName) { setFormError(t('crmFields.errorNameRequired')); return; }
    // Le opzioni si misurano PRIMA di partire: lo stesso controllo che il
    // guardiano del database rifarebbe al salvataggio, ma detto qui dentro.
    let options: string[] | undefined;
    if (fieldType === 'select') {
      const parsed = parseFieldOptions(optionsRaw);
      if (parsed.kind === 'empty') { setFormError(t('crmFields.errorOptionsEmpty')); return; }
      if (parsed.kind === 'tooMany') {
        setFormError(t('crmFields.errorOptionsTooMany', { max: CRM_FIELD_OPTIONS_MAX }));
        return;
      }
      if (parsed.kind === 'duplicate') {
        setFormError(t('crmFields.errorOptionsDuplicate', { value: parsed.value }));
        return;
      }
      options = parsed.options;
    }
    setBusy(true);
    setFormError(null);
    try {
      if (editingId) {
        await crmService.updateFieldDefinition(editingId, {
          name: cleanName,
          ...(options !== undefined ? { options } : {}),
          isRequired: required,
        });
        showToast(t('crmFields.updated'));
      } else {
        await crmService.createFieldDefinition(companyId, {
          entity, name: cleanName, fieldType, options, isRequired: required,
        });
        showToast(t('crmFields.created'));
      }
      resetForm();
      await onChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(t(msg as TKey) || msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title">{t(SECTION_KEY[entity])}</div>

      {defs.length === 0 && <p className="muted-sm">{t('crmFields.empty')}</p>}

      {/* Gli ATTIVI, nell'ordine di comparsa in scheda: su/giù li muove. */}
      {attivi.map((d, i) => (
        <div className={styles.crmAskRow} key={d.id}>
          <div className={styles.crmAskMain}>
            <strong>{d.name}</strong>{' '}
            <Tag>{L.crmFieldType(d.fieldType)}</Tag>{' '}
            {d.isRequired && <Tag>{t('common.required')}</Tag>}
            {d.fieldType === 'select' && (
              <div className="muted-sm">{d.options.join(' · ')}</div>
            )}
          </div>
          {isAdmin && (
            <div className="row-wrap">
              <button
                type="button" className="btn btn-sm" disabled={busy || i === 0}
                aria-label={t('crmFields.moveUp')}
                onClick={() => void run(
                  () => crmService.moveFieldDefinition(companyId, entity, d.id, 'up'), 'crmFields.moved')}
              >
                <Icon name="arrowUp" className="ic-sm" />
              </button>
              <button
                type="button" className="btn btn-sm" disabled={busy || i === attivi.length - 1}
                aria-label={t('crmFields.moveDown')}
                onClick={() => void run(
                  () => crmService.moveFieldDefinition(companyId, entity, d.id, 'down'), 'crmFields.moved')}
              >
                <Icon name="arrowDown" className="ic-sm" />
              </button>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => startEdit(d)}>
                {t('common.edit')}
              </button>
              <button
                type="button" className="btn btn-sm" disabled={busy}
                onClick={() => void run(() => crmService.archiveFieldDefinition(d.id), 'crmFields.archived')}
              >
                {t('crm.detail.archive')}
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Gli ARCHIVIATI, in fondo: nascosti dalle schede, ripristinabili da
          qui. Non si spostano e non si modificano — un campo archiviato è
          congelato, e l'unico gesto sensato è riaprirlo. */}
      {archiviati.map((d) => (
        <div className={styles.crmAskRow} key={d.id}>
          <div className={styles.crmAskMain}>
            <strong>{d.name}</strong>{' '}
            <Tag>{L.crmFieldType(d.fieldType)}</Tag>{' '}
            <Tag tone="attention">{t('crmFields.archivedTag')}</Tag>
          </div>
          {isAdmin && (
            <button
              type="button" className="btn btn-sm" disabled={busy}
              onClick={() => void run(() => crmService.restoreFieldDefinition(d.id), 'crmFields.restored')}
            >
              {t('crm.detail.restore')}
            </button>
          )}
        </div>
      ))}

      {/* Il modulo: uno per sezione, per creare E per modificare. In modifica
          il tipo si vede ma non si offre — è congelato dalla 0047. */}
      {isAdmin && (
        <>
          <div className={styles.divider} />
          <form noValidate onSubmit={submit}>
            <div className="card-title">
              {editingId ? t('crmFields.editTitle') : t('crmFields.addTitle')}
            </div>

            <Input
              id={`cf-${entity}-name`} label={t('crmFields.fieldName')}
              value={name} disabled={busy} maxLength={80}
              placeholder={t('crmFields.fieldNamePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
            <Select
              id={`cf-${entity}-type`} label={t('crmFields.fieldType')}
              value={fieldType} disabled={busy || editingId !== null}
              hint={editingId !== null ? t('crmFields.typeFrozen') : undefined}
              onChange={(e) => setFieldType(e.target.value as CrmFieldType)}
            >
              {CRM_FIELD_TYPES.map((ft) => (
                <option key={ft} value={ft}>{L.crmFieldType(ft)}</option>
              ))}
            </Select>
            {fieldType === 'select' && (
              <Textarea
                id={`cf-${entity}-options`} label={t('crmFields.fieldOptions')}
                value={optionsRaw} disabled={busy} rows={4}
                hint={t(editingId !== null ? 'crmFields.optionsShrinkHint' : 'crmFields.fieldOptionsHint')}
                onChange={(e) => setOptionsRaw(e.target.value)}
              />
            )}
            <Checkbox
              id={`cf-${entity}-required`} label={t('crmFields.fieldRequired')}
              checked={required} disabled={busy}
              onChange={(e) => setRequired(e.target.checked)}
            />

            {formError && (
              <div className="form-error"><Icon name="alert" className="ic-sm" /><span>{formError}</span></div>
            )}

            <div className="row-wrap mt-8">
              <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy || undefined}>
                {busy ? <span className="spinner" aria-hidden="true" /> : null}
                {' '}{editingId ? t('common.save') : t('crmFields.add')}
              </button>
              {editingId && (
                <button type="button" className="btn" disabled={busy} onClick={resetForm}>
                  {t('common.cancel')}
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
