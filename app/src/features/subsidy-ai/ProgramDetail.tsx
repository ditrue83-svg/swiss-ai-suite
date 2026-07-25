// Scheda programma + fonte + questionario progressivo + esito idoneità.
// Persiste il match (idoneità valutata) e permette di creare la pratica.
import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { subsidyService, type CaseKind } from '@/services/subsidyService';
import { taskService } from '@/services/taskService';
import { toUserMessage } from '@/lib/errors';
import { SUPPORT_TYPE_LABEL, DATA_STATUS_LABEL, type ProgramModel, type Requirement } from './programs';
import {
  subsidyQuestions, evaluateEligibility, ELIGIBILITY_LABEL, ELIGIBILITY_BADGE,
  type EligibilityResult, type MatchResult,
} from './engine';
import { InterpretationPanel } from './Interpretation';
import type { ProjectInterpretation } from '@/types/models';

function relClass(s: number) { return s >= 75 ? 'hi' : s >= 55 ? 'mid' : ''; }

interface StateRow { text: string; cls: string; note: string }
function reqStateOf(v: EligibilityResult, r: Requirement): { cls: string; note: string } {
  if (v.satisfied.find((x) => x.id === r.id)) return { cls: 'ok', note: 'soddisfatto' };
  if (v.failed.find((x) => x.id === r.id)) return { cls: 'bad', note: 'non soddisfatto' };
  return { cls: 'warn', note: 'da verificare' };
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
  const qs = subsidyQuestions(prog);
  const N = qs.length;
  const [index, setIndex] = useState(0);

  if (N === 0) return <div className="muted-sm">Nessuna domanda di verifica nel dato demo.</div>;
  const i = Math.min(index, N - 1);
  const q = qs[i];
  const tag = q.kind === 'hard' ? 'requisito obbligatorio' : q.kind === 'excl' ? 'esclusione — blocca l’idoneità' : 'preferenziale';
  const live = evaluateEligibility(prog, answers);

  function answer(val: string) {
    const next = { ...answers, [q.key]: val };
    setAnswers(next);
    if (i < N - 1) setIndex(i + 1);
    else onVerdict(evaluateEligibility(prog, next));
  }

  return (
    <div>
      <div className="quiz-progress">Domanda {i + 1} di {N} · <span className={q.kind === 'soft' ? 'req-soft-tag' : 'req-hard-tag'}>{tag}</span></div>
      <div className="quiz-question">{q.question}</div>
      <div className="quiz-opts">
        {([['si', 'Sì'], ['no', 'No'], ['ns', 'Non so']] as const).map(([v, l]) => (
          <button key={v} className={`quiz-opt${answers[q.key] === v ? ' sel-' + v : ''}`} onClick={() => answer(v)}>{l}</button>
        ))}
      </div>
      <div className="quiz-foot">
        {i > 0 ? <button className="btn btn-sm" onClick={() => setIndex(Math.max(0, i - 1))}>← Indietro</button> : <span />}
        <span className="quiz-live">Idoneità attuale: <span className={`badge badge-${ELIGIBILITY_BADGE[live.status]}`}>{ELIGIBILITY_LABEL[live.status]}</span></span>
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
  const { user } = useAuth();
  const { showToast } = useToast();
  const ds = DATA_STATUS_LABEL[p.dataStatus];

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
        title: 'Verificare finestra candidatura: ' + p.name, authority: p.authority,
        description: p.applicationWindow, dueDate: null, source: 'subsidy_ai',
        priority: p.mustApplyBeforeStart ? 'high' : 'medium',
      });
      showToast('Promemoria aggiunto allo scadenziario');
    } catch (e) { showToast(toUserMessage(e)); }
  }

  async function saveCase(kind: CaseKind) {
    if (!verdict || savingCase) return;
    setSavingCase(true);
    try {
      await subsidyService.createCase({ companyId, userId: user!.id, program: p, verdict, relevanceScore: match.relevanceScore, kind });
      const msg = kind === 'candidatura' ? 'Pratica creata — la trovi in «Le mie pratiche»'
        : kind === 'preliminare' ? 'Pratica preliminare salvata in «Le mie pratiche»' : 'Salvata per riferimento in «Le mie pratiche»';
      showToast(msg);
      onCreatedCase();
    } catch (e) { showToast(toUserMessage(e)); }
    finally { setSavingCase(false); }
  }

  const reqItem = (r: Requirement) => (
    <li key={r.id}>{r.text} {r.hard ? <span className="req-hard-tag">obbligatorio</span> : <span className="req-soft-tag">preferenziale</span>}</li>
  );

  return (
    <>
      <button className="btn btn-sm mb-14" onClick={onBack}>← Torna ai risultati</button>

      <div className="card">
        <div className="ax-head-top">
          <div className="ax-title">{p.name}</div>
          <div className="ax-badges"><span className={`rel-badge sm ${relClass(match.relevanceScore)}`}><div className="rb-num">{match.relevanceScore}%</div><div className="rb-lbl">Rilevanza</div></span></div>
        </div>
        <div className="ax-meta mt-10">
          <span className="ax-chip"><Icon name="banknote" className="ic-sm" /> {SUPPORT_TYPE_LABEL[p.supportType]}</span>
          <span className="ax-chip"><Icon name="banknote" className="ic-sm" /> <b>{p.authority}</b></span>
          <span className="ax-chip"><Icon name="calendar" className="ic-sm" /> {p.applicationWindow}</span>
          <span className={`badge badge-${match.priority.level}`}>Priorità {match.priority.level}</span>
        </div>
        {p.mustApplyBeforeStart && (
          <div className="warn-box mt-14"><Icon name="alert" /><span>{p.mustApplyBeforeStartText ?? 'La domanda va presentata prima di avviare il progetto/acquisto.'}</span></div>
        )}
        <div className="result-row"><div className="result-label">Tipo di sostegno</div><div>{SUPPORT_TYPE_LABEL[p.supportType]} · {p.contributionDescription}</div></div>
        <div className="result-row"><div className="result-label">Perché è rilevante</div><div><ul className="detail-list ok">{match.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div></div>
        {match.profileGaps.length > 0 && (
          <div className="result-row"><div className="result-label">Dati profilo da completare</div><div><ul className="detail-list warn">{match.profileGaps.map((r, i) => <li key={i}>{r}</li>)}</ul></div></div>
        )}
        <div className="result-row"><div className="result-label">Requisiti</div><div><ul className="detail-list">{[...p.hardRequirements, ...p.softRequirements].map(reqItem)}{p.requirements.length === 0 && <li className="text-muted">Nessun requisito nel dato demo.</li>}</ul></div></div>
        {p.evaluableExclusions.length > 0 && (
          <div className="result-row"><div className="result-label">Esclusioni valutate nel questionario</div><div><ul className="detail-list bad">{p.evaluableExclusions.map((r) => <li key={r.id}>{r.text} <span className="req-hard-tag">blocca l’idoneità</span></li>)}</ul></div></div>
        )}
        {p.informativeExclusions.length > 0 && (
          <div className="result-row"><div className="result-label">Esclusioni da verificare manualmente</div><div><ul className="detail-list warn">{p.informativeExclusions.map((r) => <li key={r.id}>{r.text}</li>)}</ul><div className="muted-sm">Non valutate automaticamente: verificale sulla fonte ufficiale.</div></div></div>
        )}
        <div className="result-row"><div className="result-label">Finestra di candidatura</div>
          <div>{p.applicationWindow} <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={addReminder}><Icon name="calendar" className="ic-sm" /> Aggiungi promemoria</button>
            <div className="muted-sm" style={{ marginTop: 4 }}>Descrizione della finestra, non una data certa: verifica sempre il termine sulla fonte ufficiale.</div></div>
        </div>
        <div className="result-row"><div className="result-label">Documenti</div><div><ul className="detail-list">{p.documentsRequired.map((d, i) => <li key={i}>{d}</li>)}</ul></div></div>
      </div>

      {interpretation && (
        <InterpretationPanel
          interpretation={interpretation}
          showTimingWarning={interpretation.timing.alreadyStarted === true && p.mustApplyBeforeStart} />
      )}

      <div className="card source-card">
        <div className="card-title"><Icon name="fileSearch" className="ic-sm" /> Fonte</div>
        <div className="source-grid">
          <div className="src-k">Ente</div><div className="src-v">{p.authority}</div>
          <div className="src-k">Titolo fonte</div><div className="src-v">{p.sourceTitle}</div>
          <div className="src-k">URL ufficiale</div><div className="src-v"><a href={p.officialSourceUrl} target="_blank" rel="noreferrer">{p.officialSourceUrl}</a></div>
          <div className="src-k">Ultima verifica</div><div className="src-v">{p.lastCheckedAt ? <>{p.lastCheckedAt} <span className="muted-sm">(revisione manuale demo, non un controllo automatico)</span></> : <span className="muted-sm">non disponibile</span>}</div>
          <div className="src-k">Stato dato</div><div className="src-v"><span className={`ds-badge ${ds.cls}`}>{ds.label}</span></div>
        </div>
        <div className="info-box mt-12"><Icon name="alert" className="ic-sm" /> <strong>Dati dimostrativi</strong> — verificare sempre condizioni, importi e scadenze sulla fonte ufficiale prima di procedere.</div>
      </div>

      <div className="card">
        <div className="card-title">Verifica di idoneità</div>
        <p className="muted-sm mb-14">Rispondi alle domande: le hard rule (obbligatorie) determinano l’idoneità. La conferma finale spetta sempre all’ente.</p>
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
  const s = v.status;
  const tone = s === 'likely' ? 'ok' : s === 'unknown' ? 'warn' : 'bad';
  const hardRows: StateRow[] = prog.hardRequirements.map((r) => ({ text: r.text, ...reqStateOf(v, r) }));
  const softRows: StateRow[] = prog.softRequirements.map((r) => ({ text: r.text, ...reqStateOf(v, r) }));
  const exVerified: StateRow[] = [
    ...v.exclusions.triggered.map((x) => ({ text: x.text, cls: 'bad', note: 'attivata — esclude' })),
    ...v.exclusions.cleared.map((x) => ({ text: x.text, cls: 'ok', note: 'non applicabile' })),
  ];
  const exToVerify: StateRow[] = [
    ...v.exclusions.unknown.map((x) => ({ text: x.text, cls: 'warn', note: 'da rispondere' })),
    ...v.exclusions.informative.map((x) => ({ text: x.text, cls: 'warn', note: 'verifica manuale' })),
  ];

  return (
    <div className="verdict">
      <div className={`verdict-head vh-${tone}`}>
        <div className="vh-ico"><Icon name={s === 'likely' ? 'checkCircle' : 'alert'} /></div>
        <div><div className="vh-kicker">Esito della verifica</div><div className="vh-title">{ELIGIBILITY_LABEL[s]}</div></div>
      </div>
      {s === 'ineligible' && v.cause && (
        <div className="warn-box mb-14"><Icon name="alert" /><span>{v.cause.type === 'exclusion' ? 'Esclusione attivata' : 'Requisito obbligatorio non soddisfatto'}: <strong>{v.cause.item.text}</strong>. Questo prevale su tutto il resto.</span></div>
      )}
      <div className="result-row"><div className="result-label">Requisiti obbligatori</div><div><StateList rows={hardRows} /></div></div>
      {softRows.length > 0 && <div className="result-row"><div className="result-label">Requisiti preferenziali</div><div><StateList rows={softRows} /></div></div>}
      {exVerified.length > 0 && <div className="result-row"><div className="result-label">Esclusioni verificate</div><div><StateList rows={exVerified} /></div></div>}
      {exToVerify.length > 0 && <div className="result-row"><div className="result-label">Esclusioni da verificare</div><div><StateList rows={exToVerify} /></div></div>}
      <div className="result-row"><div className="result-label">Prossimi passi</div><div><ul className="detail-list">{v.nextSteps.map((x, i) => <li key={i}>{x}</li>)}</ul></div></div>
      <div className="draft-actions">
        {s === 'likely' && <button className="btn btn-primary btn-sm" onClick={onCreate} disabled={savingCase} aria-busy={savingCase || undefined}>{savingCase ? <span className="spinner" /> : <Icon name="document" className="ic-sm" />} Crea pratica</button>}
        {s === 'unknown' && <>
          <button className="btn btn-primary btn-sm" onClick={onComplete}>Completa le verifiche</button>
          <button className="btn btn-sm" onClick={onPreliminare} disabled={savingCase}>Salva come pratica preliminare</button>
        </>}
        {s === 'unlikely' && <button className="btn btn-sm" onClick={onRiferimento} disabled={savingCase}>Salva per riferimento</button>}
        <button className="btn btn-sm" onClick={onRestart}>Ricomincia verifica</button>
      </div>
    </div>
  );
}
