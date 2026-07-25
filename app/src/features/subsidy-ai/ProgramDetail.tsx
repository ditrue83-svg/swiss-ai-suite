// Scheda programma + fonte + questionario progressivo + esito idoneità.
// Persiste il match (idoneità valutata) e permette di creare la pratica.
import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { subsidyService, type CaseKind } from '@/services/subsidyService';
import { taskService } from '@/services/taskService';
import { toUserMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import type { ProgramModel, Requirement } from './programs';
import { useT } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import {
  subsidyQuestions, evaluateEligibility, ELIGIBILITY_BADGE,
  type EligibilityResult, type MatchResult,
} from './engine';
import { InterpretationPanel } from './Interpretation';
import type { ProjectInterpretation } from '@/types/models';

function relClass(s: number) { return s >= 75 ? 'hi' : s >= 55 ? 'mid' : ''; }

interface StateRow { text: string; cls: string; note: string }
function reqStateOf(v: EligibilityResult, r: Requirement, t: (k: never) => string): { cls: string; note: string } {
  if (v.satisfied.find((x) => x.id === r.id)) return { cls: 'ok', note: t('subsidy.detail.stateSatisfied' as never) };
  if (v.failed.find((x) => x.id === r.id)) return { cls: 'bad', note: t('subsidy.detail.stateFailed' as never) };
  return { cls: 'warn', note: t('subsidy.detail.stateToVerify' as never) };
}
function StateList({ rows }: { rows: StateRow[] }) {
  if (!rows.length) return <div className="muted-sm">—</div>;
  return (
    <ul className="state-list">
      {rows.map((r, i) => <li key={i} className={`st-${r.cls}`}>{r.text} <span className="st-note">{r.note}</span></li>)}
    </ul>
  );
}

function Quiz({ prog, answers, setAnswers, onVerdict }: {
  prog: ProgramModel;
  answers: Record<string, string>;
  setAnswers: (a: Record<string, string>) => void;
  onVerdict: (v: EligibilityResult) => void;
}) {
  const t = useT();
  const L = useLabels();
  const qs = subsidyQuestions(prog);
  const N = qs.length;
  const [index, setIndex] = useState(0);

  if (N === 0) return <div className="muted-sm">{t('subsidy.detail.noQuestions')}</div>;
  const i = Math.min(index, N - 1);
  const q = qs[i];
  const tag = t(q.kind === 'hard' ? 'subsidy.detail.tagHard' : q.kind === 'excl' ? 'subsidy.detail.tagExclusion' : 'subsidy.detail.tagSoft');
  const live = evaluateEligibility(prog, answers);

  function answer(val: string) {
    const next = { ...answers, [q.key]: val };
    setAnswers(next);
    if (i < N - 1) setIndex(i + 1);
    else onVerdict(evaluateEligibility(prog, next));
  }

  return (
    <div>
      <div className="quiz-progress">{t('subsidy.detail.questionOf', { i: i + 1, n: N })} · <span className={q.kind === 'soft' ? 'req-soft-tag' : 'req-hard-tag'}>{tag}</span></div>
      <div className="quiz-question">{q.question}</div>
      <div className="quiz-opts">
        {([['si', t('common.yes')], ['no', t('common.no')], ['ns', t('common.dontKnow')]] as const).map(([v, l]) => (
          <button key={v} className={`quiz-opt${answers[q.key] === v ? ' sel-' + v : ''}`} onClick={() => answer(v)}>{l}</button>
        ))}
      </div>
      <div className="quiz-foot">
        {i > 0 ? <button className="btn btn-sm" onClick={() => setIndex(Math.max(0, i - 1))}>← {t('common.back')}</button> : <span />}
        <span className="quiz-live">{t('subsidy.detail.currentEligibility')} <span className={`badge badge-${ELIGIBILITY_BADGE[live.status]}`}>{L.eligibility(live.status)}</span></span>
      </div>
    </div>
  );
}

export function ProgramDetail({ match, companyId, interpretation, onBack, onCreatedCase }: {
  match: MatchResult;
  companyId: string;
  interpretation: ProjectInterpretation | null;
  onBack: () => void;
  onCreatedCase: () => void;
}) {
  const p = match.program;
  const t = useT();
  const L = useLabels();
  const { user } = useAuth();
  const { showToast } = useToast();


  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [verdict, setVerdict] = useState<EligibilityResult | null>(null);
  const [savingCase, setSavingCase] = useState(false);

  // Persisti il match (idoneità valutata) quando c'è un verdetto.
  useEffect(() => {
    if (!verdict) return;
    subsidyService.upsertMatch({
      companyId, programId: p.id, relevanceScore: match.relevanceScore, eligibilityStatus: verdict.status, answers,
      satisfiedRequirements: verdict.satisfied.map((r) => r.text),
      unknownRequirements: verdict.unknown.map((r) => r.text),
      failedRequirements: verdict.failed.map((r) => r.text),
      sourceLastCheckedAt: p.lastCheckedAt,
    }).catch((e) => showToast(toUserMessage(e)));
  }, [verdict]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addReminder() {
    try {
      await taskService.create({
        companyId, userId: user!.id,
        title: t('subsidy.detail.reminderTitle', { name: p.name }), authority: p.authority,
        description: p.applicationWindow, dueDate: null, source: 'subsidy_ai',
        priority: p.mustApplyBeforeStart ? 'high' : 'medium',
      });
      showToast(t('subsidy.detail.reminderAdded'));
    } catch (e) { showToast(toUserMessage(e)); }
  }

  async function saveCase(kind: CaseKind) {
    if (!verdict || savingCase) return;
    setSavingCase(true);
    try {
      await subsidyService.createCase({ companyId, userId: user!.id, program: p, verdict, relevanceScore: match.relevanceScore, kind });
      const msg = t(kind === 'candidatura' ? 'subsidy.detail.caseCreated'
        : kind === 'preliminare' ? 'subsidy.detail.casePreliminary' : 'subsidy.detail.caseReference');
      showToast(msg);
      onCreatedCase();
    } catch (e) { showToast(toUserMessage(e)); }
    finally { setSavingCase(false); }
  }

  const reqItem = (r: Requirement) => (
    <li key={r.id}>{r.text} {r.hard ? <span className="req-hard-tag">{t('common.required')}</span> : <span className="req-soft-tag">{t('subsidy.detail.tagSoft')}</span>}</li>
  );

  return (
    <>
      <button className="btn btn-sm mb-14" onClick={onBack}>← {t('subsidy.detail.back')}</button>

      <div className="card">
        <div className="ax-head-top">
          <div className="ax-title">{p.name}</div>
          <div className="ax-badges"><span className={`rel-badge sm ${relClass(match.relevanceScore)}`}><div className="rb-num">{match.relevanceScore}%</div><div className="rb-lbl">{t('subsidy.results.relevance')}</div></span></div>
        </div>
        <div className="ax-meta mt-10">
          <span className="ax-chip"><Icon name="banknote" className="ic-sm" /> {L.supportType(p.supportType)}</span>
          <span className="ax-chip"><Icon name="banknote" className="ic-sm" /> <b>{p.authority}</b></span>
          <span className="ax-chip"><Icon name="calendar" className="ic-sm" /> {p.applicationWindow}</span>
          <span className={`badge badge-${match.priority.level}`}>{t('subsidy.results.priority', { level: match.priority.level })}</span>
        </div>
        {/* 0011 — la sospensione viene PRIMA di ogni altra informazione: il
            resto della scheda descrive un contributo che oggi non si ottiene, e
            l'utente deve saperlo prima di leggere requisiti e documenti.
            Il motivo e la fonte vengono dal catalogo: senza fonte, «sospeso»
            sarebbe un'affermazione dell'app invece di un fatto controllabile. */}
        {p.availability === 'suspended' && (
          <div className="warn-box mt-14">
            <Icon name="alert" />
            <span>
              <strong>{t('subsidy.detail.suspendedTitle')}</strong>{' '}
              {p.availabilityNote ?? t('subsidy.detail.suspendedGeneric')}
              {p.availabilitySourceUrl && (
                <>
                  {' '}
                  <a href={p.availabilitySourceUrl} target="_blank" rel="noopener noreferrer">
                    {t('subsidy.detail.suspendedSource')}
                  </a>
                </>
              )}
              {p.availabilityCheckedAt && (
                <span className="muted-sm"> ({t('subsidy.detail.suspendedChecked')} {formatDate(p.availabilityCheckedAt)})</span>
              )}
            </span>
          </div>
        )}
        {p.mustApplyBeforeStart && (
          <div className="warn-box mt-14"><Icon name="alert" /><span>{p.mustApplyBeforeStartText ?? t('subsidy.detail.mustApplyBeforeStart')}</span></div>
        )}
        <div className="result-row"><div className="result-label">{t('subsidy.detail.supportType')}</div><div>{L.supportType(p.supportType)} · {p.contributionDescription}</div></div>
        <div className="result-row"><div className="result-label">{t('subsidy.detail.whyRelevant')}</div><div><ul className="detail-list ok">{match.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div></div>
        {match.profileGaps.length > 0 && (
          <div className="result-row"><div className="result-label">{t('subsidy.detail.profileGaps')}</div><div><ul className="detail-list warn">{match.profileGaps.map((r, i) => <li key={i}>{r}</li>)}</ul></div></div>
        )}
        <div className="result-row"><div className="result-label">{t('subsidy.detail.requirements')}</div><div><ul className="detail-list">{[...p.hardRequirements, ...p.softRequirements].map(reqItem)}{p.requirements.length === 0 && <li className="text-muted">{t('subsidy.detail.noRequirements')}</li>}</ul></div></div>
        {p.evaluableExclusions.length > 0 && (
          <div className="result-row"><div className="result-label">{t('subsidy.detail.exclusionsEvaluated')}</div><div><ul className="detail-list bad">{p.evaluableExclusions.map((r) => <li key={r.id}>{r.text} <span className="req-hard-tag">{t('subsidy.detail.blocksEligibility')}</span></li>)}</ul></div></div>
        )}
        {p.informativeExclusions.length > 0 && (
          <div className="result-row"><div className="result-label">{t('subsidy.detail.exclusionsManual')}</div><div><ul className="detail-list warn">{p.informativeExclusions.map((r) => <li key={r.id}>{r.text}</li>)}</ul><div className="muted-sm">{t('subsidy.detail.exclusionsManualHint')}</div></div></div>
        )}
        <div className="result-row"><div className="result-label">{t('subsidy.detail.applicationWindow')}</div>
          <div>{p.applicationWindow} <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={addReminder}><Icon name="calendar" className="ic-sm" /> {t('subsidy.detail.addReminder')}</button>
            <div className="muted-sm" style={{ marginTop: 4 }}>{t('subsidy.detail.windowHint')}</div></div>
        </div>
        <div className="result-row"><div className="result-label">{t('subsidy.detail.documents')}</div><div><ul className="detail-list">{p.documentsRequired.map((d, i) => <li key={i}>{d}</li>)}</ul></div></div>
      </div>

      {interpretation && (
        <InterpretationPanel
          interpretation={interpretation}
          showTimingWarning={interpretation.timing.alreadyStarted === true && p.mustApplyBeforeStart} />
      )}

      <div className="card source-card">
        <div className="card-title"><Icon name="fileSearch" className="ic-sm" /> {t('subsidy.detail.source')}</div>
        <div className="source-grid">
          <div className="src-k">{t('subsidy.detail.authority')}</div><div className="src-v">{p.authority}</div>
          <div className="src-k">{t('subsidy.detail.sourceTitle')}</div><div className="src-v">{p.sourceTitle}</div>
          <div className="src-k">{t('subsidy.detail.sourceUrl')}</div><div className="src-v"><a href={p.officialSourceUrl} target="_blank" rel="noreferrer">{p.officialSourceUrl}</a></div>
          <div className="src-k">{t('subsidy.detail.lastChecked')}</div><div className="src-v">{p.lastCheckedAt ? <>{p.lastCheckedAt} <span className="muted-sm">({t('subsidy.detail.lastCheckedHint')})</span></> : <span className="muted-sm">{t('subsidy.detail.notAvailable')}</span>}</div>
          <div className="src-k">{t('subsidy.detail.dataStatus')}</div><div className="src-v"><span className={`ds-badge ds-${p.dataStatus === 'verified' ? 'ok' : p.dataStatus === 'recheck' ? 'warn' : 'demo'}`}>{L.dataStatus(p.dataStatus)}</span></div>
        </div>
        <div className="info-box mt-12"><Icon name="alert" className="ic-sm" /> <strong>Dati dimostrativi</strong> — verificare sempre condizioni, importi e scadenze sulla fonte ufficiale prima di procedere.</div>
      </div>

      <div className="card">
        <div className="card-title">{t('subsidy.detail.eligibility')}</div>
        <p className="muted-sm mb-14">{t('subsidy.detail.eligibilityHint')}</p>
        {verdict
          ? <Verdict prog={p} v={verdict} savingCase={savingCase}
              onCreate={() => saveCase('candidatura')} onPreliminare={() => saveCase('preliminare')} onRiferimento={() => saveCase('riferimento')}
              onComplete={() => setVerdict(null)} onRestart={() => { setAnswers({}); setVerdict(null); }} />
          : <Quiz prog={p} answers={answers} setAnswers={setAnswers} onVerdict={setVerdict} />}
      </div>
    </>
  );
}

function Verdict({ prog, v, savingCase, onCreate, onPreliminare, onRiferimento, onComplete, onRestart }: {
  prog: ProgramModel; v: EligibilityResult; savingCase: boolean;
  onCreate: () => void; onPreliminare: () => void; onRiferimento: () => void; onComplete: () => void; onRestart: () => void;
}) {
  const t = useT();
  const L = useLabels();
  const s = v.status;
  const tone = s === 'likely' ? 'ok' : s === 'unknown' ? 'warn' : 'bad';
  const hardRows: StateRow[] = prog.hardRequirements.map((r) => ({ text: r.text, ...reqStateOf(v, r, t) }));
  const softRows: StateRow[] = prog.softRequirements.map((r) => ({ text: r.text, ...reqStateOf(v, r, t) }));
  const exVerified: StateRow[] = [
    ...v.exclusions.triggered.map((x) => ({ text: x.text, cls: 'bad', note: t('subsidy.detail.exclTriggered') })),
    ...v.exclusions.cleared.map((x) => ({ text: x.text, cls: 'ok', note: t('subsidy.detail.exclCleared') })),
  ];
  const exToVerify: StateRow[] = [
    ...v.exclusions.unknown.map((x) => ({ text: x.text, cls: 'warn', note: t('subsidy.detail.exclToAnswer') })),
    ...v.exclusions.informative.map((x) => ({ text: x.text, cls: 'warn', note: t('subsidy.detail.exclManual') })),
  ];

  return (
    <div className="verdict">
      <div className={`verdict-head vh-${tone}`}>
        <div className="vh-ico"><Icon name={s === 'likely' ? 'checkCircle' : 'alert'} /></div>
        <div><div className="vh-kicker">{t('subsidy.detail.verdict')}</div><div className="vh-title">{L.eligibility(s)}</div></div>
      </div>
      {s === 'ineligible' && v.cause && (
        <div className="warn-box mb-14"><Icon name="alert" /><span>{t(v.cause.type === 'exclusion' ? 'subsidy.detail.exclusionTriggered' : 'subsidy.detail.requirementFailed')}: <strong>{v.cause.item.text}</strong>. {t('subsidy.detail.prevails')}</span></div>
      )}
      <div className="result-row"><div className="result-label">{t('subsidy.detail.hardRequirements')}</div><div><StateList rows={hardRows} /></div></div>
      {softRows.length > 0 && <div className="result-row"><div className="result-label">{t('subsidy.detail.softRequirements')}</div><div><StateList rows={softRows} /></div></div>}
      {exVerified.length > 0 && <div className="result-row"><div className="result-label">{t('subsidy.detail.exclusionsChecked')}</div><div><StateList rows={exVerified} /></div></div>}
      {exToVerify.length > 0 && <div className="result-row"><div className="result-label">{t('subsidy.detail.exclusionsToCheck')}</div><div><StateList rows={exToVerify} /></div></div>}
      <div className="result-row"><div className="result-label">{t('subsidy.detail.nextSteps')}</div><div><ul className="detail-list">{v.nextSteps.map((x, i) => <li key={i}>{x}</li>)}</ul></div></div>
      <div className="draft-actions">
        {s === 'likely' && <button className="btn btn-primary btn-sm" onClick={onCreate} disabled={savingCase} aria-busy={savingCase || undefined}>{savingCase ? <span className="spinner" /> : <Icon name="document" className="ic-sm" />} {t('subsidy.detail.createCase')}</button>}
        {s === 'unknown' && <>
          <button className="btn btn-primary btn-sm" onClick={onComplete}>{t('subsidy.detail.completeChecks')}</button>
          <button className="btn btn-sm" onClick={onPreliminare} disabled={savingCase}>{t('subsidy.detail.savePreliminary')}</button>
        </>}
        {s === 'unlikely' && <button className="btn btn-sm" onClick={onRiferimento} disabled={savingCase}>{t('subsidy.detail.saveReference')}</button>}
        <button className="btn btn-sm" onClick={onRestart}>{t('subsidy.detail.restart')}</button>
      </div>
    </div>
  );
}
