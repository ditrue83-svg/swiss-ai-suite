// ============================================================================
// CrmFieldsCard — i campi personalizzati nella scheda (migrazione 0047).
//
// IN FONDO AI CAMPI NATIVI, CON LO STESSO ASPETTO. Niente riquadro di serie B:
// la vista è la stessa `.crm-kv` dei dati anagrafici, il modulo è fatto delle
// stesse primitive di `forms.tsx`. Chi guarda la scheda non deve poter dire
// dove finisce il CRM e dove cominciano i campi decisi dall'azienda.
//
// ⚠️ LA VALIDAZIONE È DUE VOLTE, e non per difetto. Qui si SPIEGA mentre si
// scrive («non è un numero» sotto il campo); il database RIFIUTA al
// salvataggio (il guardiano della 0047), perché ciò che controlla solo la
// schermata non è controllato. Le regole sono le stesse e stanno in
// `crmFields.ts`, provate contro la migrazione da `test:crm-unit`.
//
// ⚠️ NESSUNA DEFINIZIONE, NESSUNA SCHEDA. Se l'azienda non ha configurato
// campi per questa entità il componente non rende nulla: la configurazione
// sta nelle Impostazioni, e una scheda che pubblicizza un'impostazione vuota
// è rumore.
// ============================================================================
import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Input, Select } from '@/components/ui/forms';
import { ErrorState, SkeletonLine } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { useT, type TKey } from '@/i18n';
import type { CrmFieldEntity } from '@/types/database';
import type { CrmFieldDefinition, CrmFieldEntry } from '@/types/models';
import { crmService } from '@/services/crmService';
import { formatFieldValue, parseFieldValue } from './crmFields';

/* Il codice del controllo puro → la chiave del messaggio, scritta PER ESTESO
   e non composta (`error${code}`): le chiavi devono restare visibili al
   controllo di copertura i18n, che una stringa costruita non vedrebbe. */
const PARSE_ERROR_KEY = {
  number: 'crm.fields.errorNumber',
  date: 'crm.fields.errorDate',
  option: 'crm.fields.errorOption',
} as const satisfies Record<'number' | 'date' | 'option', TKey>;

/* Il valore come STRINGA DA MODIFICARE, non come testo mostrato:
   `formatFieldValue` raggruppa le migliaia («18'000»), e quella forma non si
   rilegge — in modifica il campo porta il valore puro. */
function rawOf(entry: CrmFieldEntry): string {
  const v = entry.value?.value;
  return v === null || v === undefined ? '' : String(v);
}

export function CrmFieldsCard({ companyId, entity, entityId }: {
  companyId: string;
  entity: CrmFieldEntity;
  entityId: string;
}) {
  const t = useT();
  const { showToast } = useToast();
  const [entries, setEntries] = useState<CrmFieldEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [raws, setRaws] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setEntries(await crmService.fieldEntries(companyId, entity, entityId));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [companyId, entity, entityId]);

  useEffect(() => { void load(); }, [load]);

  function startEdit() {
    const next: Record<string, string> = {};
    for (const e of entries ?? []) next[e.definition.id] = rawOf(e);
    setRaws(next);
    setFieldErrors({});
    setFormError(null);
    setEditing(true);
  }

  async function save(ev: FormEvent) {
    ev.preventDefault();
    if (saving || !entries) return;
    // Prima si SPIEGA, campo per campo: niente va al database se c'è già
    // qualcosa da correggere a schermo. L'obbligatorietà vive solo qui —
    // è una promessa della schermata, non un vincolo del database (0047).
    const errors: Record<string, string> = {};
    const changes: Array<{ definition: CrmFieldDefinition; value: string | number | null }> = [];
    for (const e of entries) {
      const raw = raws[e.definition.id] ?? '';
      const parsed = parseFieldValue(e.definition, raw);
      if (parsed.kind === 'error') {
        errors[e.definition.id] = t(PARSE_ERROR_KEY[parsed.code]);
        continue;
      }
      if (parsed.kind === 'empty') {
        if (e.definition.isRequired) {
          errors[e.definition.id] = t('crm.fields.errorRequired');
        } else if (e.value !== null) {
          // Svuotare CANCELLA la riga: la riga esiste solo se porta un valore.
          changes.push({ definition: e.definition, value: null });
        }
        continue;
      }
      if (raw !== rawOf(e)) changes.push({ definition: e.definition, value: parsed.value });
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (changes.length === 0) { setEditing(false); return; }
    setSaving(true);
    setFormError(null);
    try {
      await crmService.saveFieldValues(companyId, entity, entityId, changes);
      showToast(t('crm.fields.saved'));
      setEditing(false);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(t(msg as TKey) || msg);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="card mt-8">
        <div className="card-title">{t('crm.fields.title')}</div>
        <ErrorState message={t(loadError as TKey) || loadError} onRetry={() => void load()} />
      </div>
    );
  }
  if (entries === null) {
    return (
      <div className="card mt-8">
        <div className="card-title">{t('crm.fields.title')}</div>
        <SkeletonLine width="70%" />
        <SkeletonLine width="50%" />
      </div>
    );
  }
  // Nessuna definizione attiva → la scheda resta com'era, senza riquadri vuoti.
  if (entries.length === 0) return null;

  return (
    <div className="card mt-8">
      <div className="crm-sec-head">
        <div className="card-title">{t('crm.fields.title')}</div>
        {!editing && (
          <button type="button" className="btn btn-sm" onClick={startEdit}>
            {t('crm.fields.edit')}
          </button>
        )}
      </div>

      {!editing ? (
        <dl className="crm-kv">
          {entries.map((e) => (
            <Fragment key={e.definition.id}>
              <dt>{e.definition.name}</dt>
              <dd>{formatFieldValue(e.definition, e.value?.value ?? null)}</dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        // `noValidate`: gli errori li mostra il modulo, campo per campo —
        // il fumetto nativo del browser coprirebbe il messaggio giusto con
        // uno generico, in una lingua che non è detto sia quella dell'app.
        <form noValidate onSubmit={save}>
          {entries.map((e) => {
            const d = e.definition;
            const err = fieldErrors[d.id];
            const common = {
              id: `cf-${d.id}`,
              label: d.name,
              error: err,
              disabled: saving,
              value: raws[d.id] ?? '',
              onChange: (ev: { target: { value: string } }) =>
                setRaws((prev) => ({ ...prev, [d.id]: ev.target.value })),
            };
            if (d.fieldType === 'select') {
              return (
                <Select key={d.id} {...common}>
                  <option value="">{t('crm.fields.noValue')}</option>
                  {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              );
            }
            if (d.fieldType === 'date') {
              return <Input key={d.id} type="date" {...common} />;
            }
            if (d.fieldType === 'number') {
              // Testo con tastierino decimale, come l'importo della trattativa:
              // `type="number"` rifiuterebbe la virgola che in tutte e tre le
              // lingue dell'app è il separatore.
              return <Input key={d.id} inputMode="decimal" maxLength={40} {...common} />;
            }
            return <Input key={d.id} maxLength={500} {...common} />;
          })}

          {formError && (
            <div className="form-error"><Icon name="alert" className="ic-sm" /><span>{formError}</span></div>
          )}

          <div className="row-wrap mt-8">
            <button className="btn btn-primary" type="submit" disabled={saving} aria-busy={saving || undefined}>
              {saving ? <span className="spinner" aria-hidden="true" /> : null} {t('common.save')}
            </button>
            <button type="button" className="btn" disabled={saving} onClick={() => setEditing(false)}>
              {t('crm.form.cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
