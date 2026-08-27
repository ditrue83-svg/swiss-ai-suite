// ============================================================================
// Importa contatti da CSV — carica → mappa le colonne → anteprima e conferma.
//
// Le regole del modulo valgono anche qui, e una vale doppio perché il file
// porta MOLTE righe in un colpo solo:
//
// ⚠️ SUGGERIRE, NON INVENTARE. La mappatura si PROPONE dalle intestazioni e la
// persona la conferma; una colonna non riconosciuta resta fuori invece di
// essere indovinata.
//
// ⚠️ VERIFICARE, NON FONDERE. I duplicati si MOSTRANO riga per riga con il
// motivo, e l'unica eccezione è quella che il database impone: un IDI valido
// già presente non si può inserire (vincolo unico), quindi là la scelta non
// esiste e la schermata dice perché. MAI fusione, MAI aggiornamento
// dell'esistente.
//
// ⚠️ NESSUNA TRANSAZIONE FINTA. L'import va riga per riga: una che fallisce
// viene registrata col motivo e le altre continuano. Se l'organizzazione è
// creata ma la persona no, il riepilogo lo DICHIARA — far sparire il lavoro
// riuscito per colpa di quello secondario sarebbe peggio, e tacerlo una bugia.
// ============================================================================
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Tag, type TagTone } from '@/components/ui/Tag';
import { Select } from '@/components/ui/forms';
import { useCompany } from '@/contexts/CompanyContext';
import { EmptyCta, ErrorState } from '@/components/ui/states';
import { crmService } from '@/services/crmService';
import { useT, type TKey } from '@/i18n';
import {
  IMPORT_MAX_FILE_BYTES, IMPORT_MAX_ROWS,
  buildDrafts, contactRoute, decodeCsvBytes, effectiveName, flagDuplicates,
  mappingHasName, parseCsv, parseRoles, suggestMapping, validateDraft,
  type CsvEncoding, type DuplicateFlag, type DuplicateKind, type ExistingIndex,
  type ImportDraft, type ImportField, type ImportRowErrorCode, type ParsedCsv,
} from './csvImport';

/** Le chiavi stanno nel modulo, le TRADUZIONI no: `t()` solo dentro i componenti. */
const FIELD_KEY: Record<ImportField, TKey> = {
  'org.display_name': 'crm.import.fields.orgDisplayName',
  'org.legal_name': 'crm.import.fields.orgLegalName',
  'org.uid_che': 'crm.import.fields.orgUid',
  'org.vat_number': 'crm.import.fields.orgVat',
  'org.website': 'crm.import.fields.orgWebsite',
  'org.street': 'crm.import.fields.orgStreet',
  'org.postal_code': 'crm.import.fields.orgPostalCode',
  'org.city': 'crm.import.fields.orgCity',
  'org.canton': 'crm.import.fields.orgCanton',
  'org.country_code': 'crm.import.fields.orgCountry',
  'org.notes': 'crm.import.fields.orgNotes',
  'org.role': 'crm.import.fields.orgRole',
  'person.first_name': 'crm.import.fields.personFirstName',
  'person.last_name': 'crm.import.fields.personLastName',
  'person.job_title': 'crm.import.fields.personJobTitle',
  'contact.email': 'crm.import.fields.contactEmail',
  'contact.phone': 'crm.import.fields.contactPhone',
  'contact.mobile': 'crm.import.fields.contactMobile',
};

const FIELD_GROUPS: ReadonlyArray<{ labelKey: TKey; fields: readonly ImportField[] }> = [
  {
    labelKey: 'crm.import.groups.organization',
    fields: [
      'org.display_name', 'org.legal_name', 'org.uid_che', 'org.vat_number',
      'org.website', 'org.street', 'org.postal_code', 'org.city', 'org.canton',
      'org.country_code', 'org.notes', 'org.role',
    ],
  },
  {
    labelKey: 'crm.import.groups.person',
    fields: ['person.first_name', 'person.last_name', 'person.job_title'],
  },
  {
    labelKey: 'crm.import.groups.contact',
    fields: ['contact.email', 'contact.phone', 'contact.mobile'],
  },
];

const ERROR_KEY: Record<ImportRowErrorCode, TKey> = {
  missingName: 'crm.import.errMissingName',
  invalidEmail: 'crm.import.errInvalidEmail',
  invalidCanton: 'crm.import.errInvalidCanton',
  invalidUid: 'crm.import.errInvalidUid',
  unknownRole: 'crm.import.errUnknownRole',
  invalidCountry: 'crm.import.errInvalidCountry',
  invalidWebsite: 'crm.import.errInvalidWebsite',
};

const DUP_KEY: Record<DuplicateKind, TKey> = {
  hardUid: 'crm.import.dupHardUid',
  internalUid: 'crm.import.dupInternalUid',
  email: 'crm.import.dupEmail',
  internalEmail: 'crm.import.dupInternalEmail',
  domain: 'crm.import.dupDomain',
  name: 'crm.import.dupName',
};

const STEP_KEY: readonly TKey[] = [
  'crm.import.stepFile', 'crm.import.stepMapping', 'crm.import.stepPreview',
];

/** Che cosa è successo a una riga importata. */
interface RowOutcome {
  fileRow: number;
  name: string;
  status: 'created' | 'partial' | 'failed';
  /** Frasi già tradotte al momento dell'esecuzione: il riepilogo è effimero. */
  notes: string[];
}

type RowDecision = 'skip' | 'import';

export function ClientImportPage() {
  const { activeCompany: company } = useCompany();
  const t = useT();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState('');
  const [encoding, setEncoding] = useState<CsvEncoding>('utf-8');
  const [uploadError, setUploadError] = useState<TKey | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Array<ImportField | null>>([]);

  const [existing, setExisting] = useState<ExistingIndex | null>(null);
  const [indexError, setIndexError] = useState(false);
  const [indexLoading, setIndexLoading] = useState(false);

  const [decisions, setDecisions] = useState<Record<number, RowDecision>>({});

  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<RowOutcome[] | null>(null);

  const drafts = useMemo(
    () => (parsed ? buildDrafts(parsed, mapping) : []),
    [parsed, mapping],
  );
  const rowErrors = useMemo(() => drafts.map(validateDraft), [drafts]);
  const flags = useMemo(
    () => (existing ? flagDuplicates(drafts, existing) : drafts.map(() => null)),
    [drafts, existing],
  );

  /** Una riga è importabile se non ha errori e non è un duplicato duro. */
  const importable = (i: number): boolean => {
    if (rowErrors[i]!.length > 0) return false;
    const f = flags[i];
    if (!f) return true;
    if (f.kind === 'hardUid' || f.kind === 'internalUid') return false;
    return decisions[i] === 'import';
  };

  const counts = useMemo(() => {
    let valid = 0;
    let errors = 0;
    let duplicates = 0;
    drafts.forEach((_, i) => {
      if (rowErrors[i]!.length > 0) errors += 1;
      else if (flags[i]) duplicates += 1;
      else valid += 1;
    });
    return { valid, errors, duplicates };
  }, [drafts, rowErrors, flags]);

  const toImport = drafts.reduce(
    (n, _, i) => n + (importable(i) ? 1 : 0),
    0,
  );

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    if (file.size > IMPORT_MAX_FILE_BYTES) {
      setUploadError('crm.import.fileTooBig');
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { text, encoding: enc } = decodeCsvBytes(bytes);
      const p = parseCsv(text);
      if (p.headers.length === 0 || p.totalDataRows === 0) {
        setUploadError('crm.import.fileEmpty');
        return;
      }
      setParsed(p);
      setEncoding(enc);
      setFileName(file.name);
      setMapping(suggestMapping(p.headers));
      setExisting(null);
      setIndexError(false);
      setDecisions({});
      setOutcomes(null);
      setStep(2);
    } catch {
      setUploadError('crm.import.fileReadError');
    }
  }

  function setColumn(col: number, field: ImportField | null) {
    setMapping((prev) => prev.map((f, i) => {
      if (i === col) return field;
      // Un campo sta su UNA colonna: sceglierlo qui lo toglie di là, e la
      // colonna di là torna «non importata» invece di puntare in due allo
      // stesso dato.
      if (field && f === field) return null;
      return f;
    }));
  }

  async function toPreview() {
    if (!company || !parsed) return;
    setStep(3);
    if (existing || indexLoading) return;
    setIndexLoading(true);
    try {
      const idx = await crmService.importDedupIndex(company.id);
      setExisting({
        uids: new Set(idx.uids),
        emails: new Set(idx.emails),
        domains: new Set(idx.domains),
        names: new Set(idx.names),
      });
    } catch {
      // ⚠️ Un guasto in lettura si DICHIARA: «nessun duplicato» su una
      // richiesta fallita è il difetto dell'Inbox con la 0013 non applicata.
      setIndexError(true);
    } finally {
      setIndexLoading(false);
    }
  }

  function setAllDuplicates(decision: RowDecision) {
    const next: Record<number, RowDecision> = {};
    flags.forEach((f, i) => {
      if (f && f.kind !== 'hardUid' && f.kind !== 'internalUid') next[i] = decision;
    });
    setDecisions(next);
  }

  async function importRow(d: ImportDraft, flag: DuplicateFlag | null): Promise<RowOutcome> {
    const name = effectiveName(d);
    const notes: string[] = [];
    // ⚠️ L'email duplicata NON la tentiamo nemmeno: `uq_crm_method_email`
    // risponderebbe 23505, e un fallimento atteso non è un errore da mostrare —
    // è una cosa da dichiarare in anticipo.
    const skipEmail = flag !== null && (flag.kind === 'email' || flag.kind === 'internalEmail');

    let orgId: string;
    try {
      orgId = await crmService.create(company!.id, {
        displayName: name,
        legalName: d.legalName || null,
        uidChe: d.uidChe || null,
        vatNumber: d.vatNumber || null,
        website: d.website || null,
        street: d.street || null,
        postalCode: d.postalCode || null,
        city: d.city || null,
        canton: d.canton || null,
        countryCode: d.countryCode || null,
        notes: d.notes || null,
        source: 'import',
        sourceDetail: fileName,
        roles: parseRoles(d.roleRaw).roles,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // La stessa scelta di «Nuovo cliente»: se i ruoli non si salvano,
      // l'organizzazione RESTA e il riepilogo lo dice.
      if (msg.startsWith('crm.errors.rolesNotSaved:')) {
        orgId = msg.split(':')[1]!;
        notes.push(t('crm.import.noteRolesNotSaved'));
      } else {
        return { fileRow: d.fileRow, name, status: 'failed', notes: [t(msg as TKey) || msg] };
      }
    }

    if (contactRoute(d) === 'person') {
      try {
        const contactId = await crmService.addPerson(company!.id, orgId, {
          displayName: name,
          firstName: d.firstName,
          lastName: d.lastName,
          jobTitle: d.jobTitle || null,
          email: skipEmail ? null : d.email || null,
          phone: d.phone || null,
          isPrimary: true,
        });
        if (skipEmail && d.email !== '') notes.push(t('crm.import.noteEmailSkipped'));
        if (d.mobile !== '') {
          await crmService.addMethod(company!.id, { contactId }, {
            type: 'mobile', value: d.mobile, isPrimary: true,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        notes.push(t('crm.import.notePersonFailed'));
        return { fileRow: d.fileRow, name, status: 'partial', notes: [...notes, t(msg as TKey) || msg] };
      }
    } else {
      try {
        if (d.email !== '' && !skipEmail) {
          await crmService.addMethod(company!.id, { organizationId: orgId }, {
            type: 'email', value: d.email, isPrimary: true,
          });
        }
        if (skipEmail && d.email !== '') notes.push(t('crm.import.noteEmailSkipped'));
        if (d.phone !== '') {
          await crmService.addMethod(company!.id, { organizationId: orgId }, {
            type: 'phone', value: d.phone, isPrimary: true,
          });
        }
        if (d.mobile !== '') {
          await crmService.addMethod(company!.id, { organizationId: orgId }, {
            type: 'mobile', value: d.mobile, isPrimary: true,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        notes.push(t('crm.import.noteMethodsFailed'));
        return { fileRow: d.fileRow, name, status: 'partial', notes: [...notes, t(msg as TKey) || msg] };
      }
    }

    return { fileRow: d.fileRow, name, status: notes.length ? 'partial' : 'created', notes };
  }

  async function runImport() {
    if (!company || running) return;
    const todo = drafts.filter((_, i) => importable(i));
    setRunning({ done: 0, total: todo.length });
    const results: RowOutcome[] = [];
    for (let k = 0; k < todo.length; k += 1) {
      const d = todo[k]!;
      const i = drafts.indexOf(d);
      // Una riga alla volta: il progresso si vede, e una riga che fallisce non
      // ne trascina altre — è il contratto dichiarato nell'anteprima.
      results.push(await importRow(d, flags[i]!));
      setRunning({ done: k + 1, total: todo.length });
    }
    setOutcomes(results);
    setRunning(null);
  }

  if (!company) return null;

  const done = outcomes !== null;
  const created = (outcomes ?? []).filter((o) => o.status === 'created').length;
  const partial = (outcomes ?? []).filter((o) => o.status === 'partial').length;
  const failed = (outcomes ?? []).filter((o) => o.status === 'failed').length;
  const skipped = drafts.length - (outcomes?.length ?? 0);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">{t('crm.import.title')}</div>
          <div className="page-desc">{t(STEP_KEY[step - 1]!)}</div>
        </div>
      </div>

      <div className="stepper" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`step-dot ${step === n ? 'active' : step > n ? 'done' : ''}`}
          >
            {n}
          </span>
        ))}
      </div>

      {step === 1 && (
        <>
          {uploadError && <ErrorState message={t(uploadError)} />}
          <EmptyCta
            art="document"
            title={t('crm.import.uploadTitle')}
            subtitle={t('crm.import.uploadHint', { rows: IMPORT_MAX_ROWS })}
            action={(
              <button
                type="button" className="btn btn-primary"
                onClick={() => fileInput.current?.click()}
              >
                <Icon name="upload" className="ic-sm" /> {t('crm.import.chooseFile')}
              </button>
            )}
          />
          <input
            ref={fileInput} type="file" hidden
            accept=".csv,text/csv,text/plain"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </>
      )}

      {step === 2 && parsed && (
        <div className="card">
          <div className="card-title">{fileName}</div>
          {parsed.rowLimitHit && (
            <p className="verify-note">
              {t('crm.import.rowLimit', { total: parsed.totalDataRows, max: IMPORT_MAX_ROWS })}
            </p>
          )}
          {encoding === 'windows-1252' && (
            <p className="muted-sm">{t('crm.import.encodingLegacy')}</p>
          )}
          <p className="muted-sm">{t('crm.import.mappingHint')}</p>

          {!mappingHasName(mapping) && (
            <ErrorState message={t('crm.import.mappingNoName')} />
          )}

          <ul className="crm-list mt-8">
            {parsed.headers.map((h, col) => (
              <li className="list-row" key={`${col}-${h}`}>
                <div className="list-main">
                  <span className="list-title">{h}</span>
                </div>
                {parsed.rows[0]?.[col] !== undefined && parsed.rows[0]?.[col] !== '' && (
                  <div className="list-sub">{parsed.rows[0][col]}</div>
                )}
                <Select
                  id={`imp-col-${col}`} label={t('crm.import.columnTarget')}
                  value={mapping[col] ?? ''}
                  onChange={(e) => setColumn(col, (e.target.value || null) as ImportField | null)}
                >
                  <option value="">{t('crm.import.columnNotMapped')}</option>
                  {FIELD_GROUPS.map((g) => (
                    <optgroup key={g.labelKey} label={t(g.labelKey)}>
                      {g.fields.map((f) => (
                        <option key={f} value={f}>{t(FIELD_KEY[f])}</option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </li>
            ))}
          </ul>

          <div className="row-wrap mt-8">
            <button
              type="button" className="btn btn-primary"
              disabled={!mappingHasName(mapping)} onClick={() => void toPreview()}
            >
              {t('common.next')} <Icon name="arrowRight" className="ic-sm" />
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
              {t('common.back')}
            </button>
          </div>
        </div>
      )}

      {step === 3 && parsed && (
        <>
          {indexError && <ErrorState message={t('crm.import.indexError')} />}

          {!done && (
            <>
              <div className="row-wrap">
                <Tag>{t(counts.valid === 1 ? 'crm.import.validOne' : 'crm.import.validMany', { n: counts.valid })}</Tag>
                {counts.errors > 0 && (
                  <Tag tone="alert">{t(counts.errors === 1 ? 'crm.import.errOne' : 'crm.import.errMany', { n: counts.errors })}</Tag>
                )}
                {counts.duplicates > 0 && (
                  <Tag tone="attention">{t(counts.duplicates === 1 ? 'crm.import.dupOne' : 'crm.import.dupMany', { n: counts.duplicates })}</Tag>
                )}
              </div>
              <p className="muted-sm mt-8">{t('crm.import.previewHint')}</p>

              {counts.duplicates > 0 && (
                <div className="row-wrap mt-8">
                  <button type="button" className="btn btn-sm" onClick={() => setAllDuplicates('skip')}>
                    {t('crm.import.skipAllDuplicates')}
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAllDuplicates('import')}>
                    {t('crm.import.importAllDuplicates')}
                  </button>
                </div>
              )}

              <ul className="crm-list mt-8">
                {drafts.map((d, i) => (
                  <PreviewRow
                    key={d.fileRow}
                    draft={d}
                    errors={rowErrors[i]!}
                    flag={flags[i] ?? null}
                    decision={decisions[i] ?? 'skip'}
                    onDecision={(v) => setDecisions((prev) => ({ ...prev, [i]: v }))}
                  />
                ))}
              </ul>

              <div className="row-wrap mt-8">
                <button
                  type="button" className="btn btn-primary"
                  disabled={toImport === 0 || running !== null || indexLoading || !existing}
                  aria-busy={running !== null || undefined}
                  onClick={() => void runImport()}
                >
                  {running !== null && <span className="spinner" aria-hidden="true" />}
                  {' '}{t(toImport === 1 ? 'crm.import.runOne' : 'crm.import.runMany', { n: toImport })}
                </button>
                <button
                  type="button" className="btn btn-ghost"
                  disabled={running !== null} onClick={() => setStep(2)}
                >
                  {t('common.back')}
                </button>
              </div>
              {running !== null && (
                <p className="muted-sm mt-8" role="status">
                  {t('crm.import.running', { done: running.done, total: running.total })}
                </p>
              )}
            </>
          )}

          {done && (
            <div className="card">
              <div className="card-title">{t('crm.import.doneTitle')}</div>
              <div className="row-wrap">
                <Tag tone="ok">{t(created === 1 ? 'crm.import.createdOne' : 'crm.import.createdMany', { n: created })}</Tag>
                {partial > 0 && (
                  <Tag tone="attention">{t(partial === 1 ? 'crm.import.partialOne' : 'crm.import.partialMany', { n: partial })}</Tag>
                )}
                {skipped > 0 && (
                  <Tag>{t(skipped === 1 ? 'crm.import.skippedOne' : 'crm.import.skippedMany', { n: skipped })}</Tag>
                )}
                {failed > 0 && (
                  <Tag tone="alert">{t(failed === 1 ? 'crm.import.failedOne' : 'crm.import.failedMany', { n: failed })}</Tag>
                )}
              </div>
              {(partial > 0 || failed > 0) && (
                <details className="mt-8">
                  <summary>{t('crm.import.failureDetails')}</summary>
                  <ul className="crm-list mt-8">
                    {outcomes
                      .filter((o) => o.status !== 'created')
                      .map((o) => (
                        <li className="list-row" key={o.fileRow}>
                          <div className="list-main">
                            <span className="list-title">{o.name}</span>
                            <Tag tone={o.status === 'failed' ? 'alert' : 'attention'}>
                              {t(o.status === 'failed' ? 'crm.import.rowFailed' : 'crm.import.rowPartial')}
                            </Tag>
                          </div>
                          <div className="list-sub">
                            {t('crm.import.fileRow', { row: o.fileRow })}
                          </div>
                          {o.notes.map((note, k) => (
                            <div className="list-sub" key={k}>{note}</div>
                          ))}
                        </li>
                      ))}
                  </ul>
                </details>
              )}
              <div className="row-wrap mt-8">
                <Link className="btn btn-primary" to="/clienti">{t('crm.import.finish')}</Link>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Una riga dell'anteprima: valida, con errori, o duplicata — e perché. */
function PreviewRow(props: {
  draft: ImportDraft;
  errors: ImportRowErrorCode[];
  flag: DuplicateFlag | null;
  decision: RowDecision;
  onDecision: (v: RowDecision) => void;
}) {
  const t = useT();
  const { draft: d, errors, flag } = props;
  const name = effectiveName(d);

  let tone: TagTone = 'neutral';
  let stateKey: TKey = 'crm.import.rowValid';
  if (errors.length > 0) {
    tone = 'alert';
    stateKey = 'crm.import.rowErrors';
  } else if (flag) {
    tone = 'attention';
    stateKey = 'crm.import.rowDuplicate';
  }

  const hard = flag !== null && (flag.kind === 'hardUid' || flag.kind === 'internalUid');
  const facts = [d.city, d.email, d.uidChe].filter((v) => v !== '');

  return (
    <li className="list-row">
      <div className="list-main">
        <span className="list-title">{name !== '' ? name : t('crm.import.unnamed')}</span>
        <Tag tone={tone}>{t(stateKey)}</Tag>
      </div>
      <div className="list-sub">
        <span>{t('crm.import.fileRow', { row: d.fileRow })}</span>
        {facts.map((f) => <span key={f}>{f}</span>)}
      </div>
      {errors.map((code) => (
        <div className="list-sub" key={code}>{t(ERROR_KEY[code])}</div>
      ))}
      {flag && errors.length === 0 && (
        <div className="list-sub">{t(DUP_KEY[flag.kind])}</div>
      )}
      {flag && !hard && errors.length === 0 && (
        <Select
          id={`imp-dup-${d.fileRow}`} label={t('crm.import.dupDecision')}
          value={props.decision}
          onChange={(e) => props.onDecision(e.target.value as RowDecision)}
        >
          <option value="skip">{t('crm.import.skipRow')}</option>
          <option value="import">{t('crm.import.importAnyway')}</option>
        </Select>
      )}
    </li>
  );
}
