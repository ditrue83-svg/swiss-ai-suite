// ============================================================================
// Il dettaglio di un'opportunità — CRITERIO PER CRITERIO.
//
// È la schermata che rende verificabile tutto il resto: per ogni criterio dice
// il testo, se è obbligatorio, come sta, quale valore aziendale è stato usato,
// DA DOVE viene quel valore e da quale punto della fonte viene il requisito.
//
// ⚠️ SENZA `valueSource` E SENZA L'EVIDENZA questa pagina sarebbe un elenco di
//    affermazioni dell'app. Con, è una catena che si risale fino al profilo,
//    alla risposta di una persona o alla citazione letterale della fonte. È il
//    motivo per cui le due colonne esistono nel database.
//
// ⚠️ NON SI RISPONDE PER CONTO DELL'UTENTE. I criteri `auto` li decide il
//    motore dai fatti; quelli `question` li chiede a una persona; quelli
//    `manual` dicono che vanno verificati sulla fonte e non offrono alcun
//    pulsante. Un criterio che non sappiamo valutare non è un criterio
//    superato, ed è `not_evaluable` — non «soddisfatto».
// ============================================================================
import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Button, ErrorState, SkeletonLine } from '@/components/ui/states';
import { useAuth } from '@/contexts/AuthContext';
import { useT, type TKey } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import { formatDate } from '@/lib/format';
import { incentivesService } from '@/services/incentivesService';
import type { IncentiveCriterion, IncentiveOpportunity } from '@/types/models';
import {
  CALL_STATUS_KEY, COMPLETENESS_KEY, CRITERION_MARK, CRITERION_STATE_KEY,
  ELIGIBILITY_KEY, HARDNESS_KEY, NEXT_STEP_KEY,
  READINESS_KEY, RELEVANCE_KEY, TIMING_KEY, deadlineNotice, nextStep, plural,
  subsidyErrorKey, todayISO,
} from './incentivesModel';
import { EligibilityMark } from '@/components/ui/EligibilityMark';
import { SourceStamp } from '@/components/ui/SourceStamp';
import { MarkGlyph } from '@/components/ui/MarkGlyph';
import { MarkLegend } from '@/components/ui/MarkLegend';
import { useCompany } from '@/contexts/CompanyContext';
import { PrintButton } from '@/components/ui/PrintButton';
import { PrintSheet } from '@/features/print/PrintSheet';
import { buildFooter } from '@/features/print/printModel';

interface Props {
  companyId: string;
  opportunity: IncentiveOpportunity;
  onBack: () => void;
  onChanged: () => void;
}

export function OpportunityDetail({ companyId, opportunity: o, onBack, onChanged }: Props) {
  const t = useT();
  const L = useLabels();
  const { user } = useAuth();
  const { activeCompany } = useCompany();
  const [criteria, setCriteria] = useState<IncentiveCriterion[]>([]);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /**
   * Le risposte date IN QUESTA SESSIONE, per rule_key.
   *
   * ⚠️ SERVE A DIRE CHE LA RISPOSTA È STATA REGISTRATA, non a cambiare lo stato
   * del criterio. Difetto trovato USANDO la schermata, non rileggendola:
   * premendo «No» la riga restava «Manca il dato» — che è la verità, perché il
   * motore non è ancora passato — e non compariva NIENTE. Una scrittura
   * riuscita che non lascia traccia si legge come un guasto, e chi la vede
   * preme di nuovo. Riscrivere il badge sarebbe stato il rimedio sbagliato:
   * racconterebbe un verdetto che nessuna valutazione ha prodotto.
   */
  const [answered, setAnswered] = useState<Record<string, 'yes' | 'no' | 'unknown'>>({});
  const [creating, setCreating] = useState(false);
  const [reload, setReload] = useState(0);

  const today = todayISO();
  const notice = deadlineNotice(o, today);
  const step = nextStep(o, today);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await incentivesService.criteria(o.id);
        if (cancelled) return;
        setAssessmentId(res.assessmentId);
        setCriteria(res.items);
      } catch (e) {
        if (!cancelled) setError(messageOf(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [o.id, reload]);

  function messageOf(e: unknown): string {
    const key = subsidyErrorKey(e);
    return key ? t(key) : (e instanceof Error ? e.message : String(e));
  }

  /**
   * ⚠️ Dopo una risposta la schermata NON riscrive lo stato del criterio da sé.
   * Le rivalutazioni le fa il motore, e indovinare qui che «adesso è
   * soddisfatto» racconterebbe una storia parallela a quella vera — la stessa
   * lezione dello storico delle Attività. Si rilegge, e finché il motore non è
   * passato la riga dice «valutazione da aggiornare», che è la verità.
   */
  async function answer(rule: IncentiveCriterion, value: 'yes' | 'no' | 'unknown') {
    setBusyKey(rule.ruleKey);
    try {
      await incentivesService.answer({
        companyId,
        projectId: o.projectId,
        programVersionId: o.programVersionId,
        ruleKey: rule.ruleKey,
        value,
      });
      setAnswered((cur) => ({ ...cur, [rule.ruleKey]: value }));
      setReload((n) => n + 1);
      onChanged();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusyKey(null);
    }
  }

  async function createCase() {
    if (!user) return;
    setCreating(true);
    try {
      await incentivesService.createCase({
        companyId, userId: user.id, opportunity: o, criteria,
      });
      onChanged();
      onBack();
    } catch (e) {
      setError(messageOf(e));
      setCreating(false);
    }
  }

  return (
    <>
      <div className="row-wrap mb-8">
        <button type="button" className="mini-btn" onClick={onBack}>
          <Icon name="arrowLeft" className="ic-sm" /> {t('incentives.backToList')}
        </button>
      </div>

      <div className="card">
        <div className="ct-head">
          <div>
            <div className="page-title">{o.programName}</div>
            <div className="page-desc">
              {o.authority} · {L.supportType(o.supportType)}
              {o.projectTitle && <> · {o.projectTitle}</>}
            </div>
          </div>
          {/* ⚠️ Nessun pulsante «candidati»: si apre una PRATICA, che è lavoro
              di preparazione. Il prodotto non invia domande. */}
          <div className="row-wrap">
            {o.caseId ? (
              <span className="badge badge-blue">{t('incentives.caseAlreadyOpen')}</span>
            ) : (
              <Button variant="primary" icon="fileSignature" loading={creating} onClick={() => void createCase()}>
                {t('incentives.openCase')}
              </Button>
            )}
            {/* Il verdetto di idoneità è la cosa che finisce nel fascicolo:
                dice se un'impresa può accedere, in base a quale versione del
                catalogo e a quale fonte. */}
            <PrintButton />
          </div>
        </div>

        <div className="inc-next mt-8">
          <Icon name="arrowRight" className="ic-sm" /> {t(NEXT_STEP_KEY[step])}
        </div>

        {error && <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />}

        {/* ---- Le sei misure, per esteso ---- */}
        <div className="crm-sec">
          <div className="section-title">{t('incentives.detail.measures')}</div>
          <p className="muted-sm">{t('incentives.detail.measuresHint')}</p>
          <dl className="crm-kv mt-8">
            <dt>{t('incentives.measures.relevance')}</dt>
            <dd>{t(RELEVANCE_KEY[o.relevanceLevel])}</dd>
            <dt>{t('incentives.measures.eligibility')}</dt>
            <dd><EligibilityMark status={o.eligibilityStatus} /></dd>
            <dt>{t('incentives.measures.completeness')}</dt>
            <dd>
              {t(COMPLETENESS_KEY[o.completeness])}
              {o.missingFactCount > 0 && <> · {t(plural(o.missingFactCount,
                'incentives.missingFactsOne', 'incentives.missingFacts'), { n: o.missingFactCount })}</>}
            </dd>
            <dt>{t('incentives.measures.timing')}</dt>
            <dd>{t(TIMING_KEY[o.timing])}</dd>
            {/* ⚠️ LA DATA DELLA VALUTAZIONE STA IN UNA RIGA SUA, e non accanto
                alla freschezza. Difetto trovato APRENDO LA PAGINA, non
                rileggendo il codice: sotto l'etichetta «Freschezza della
                fonte» si leggeva «Mai verificata · valutata il 30.07.2026»,
                cioè una data che sembrava dire quando avevamo controllato la
                fonte mentre diceva quando il motore aveva fatto i conti. Le
                due cose possono essere lontane mesi, ed è esattamente la
                distinzione che questo modulo esiste per non perdere. */}
            <dt>{t('incentives.measures.freshness')}</dt>
            <dd><SourceStamp state={o.sourceFreshness} /></dd>
            <dt>{t('incentives.measures.readiness')}</dt>
            <dd>{t(READINESS_KEY[o.readiness])}</dd>
            <dt>{t('incentives.detail.lastAssessment')}</dt>
            <dd>
              {o.lastAssessedAt
                ? formatDate(o.lastAssessedAt)
                : t('incentives.detail.neverAssessed')}
            </dd>
          </dl>
        </div>

        {/* ---- Perché è rilevante ----
            ⚠️ Le ragioni arrivano dal database come CHIAVI di traduzione con
            parametri, mai come frasi: una frase italiana scritta nel database
            comparirebbe identica nell'interfaccia tedesca. Una chiave che il
            dizionario non conosce NON si stampa grezza — si salta, perché una
            stringa tecnica accanto a un programma non spiega niente. */}
        {o.relevanceReasons.length > 0 && (
          <div className="crm-sec">
            <div className="section-title">{t('incentives.detail.whyRelevant')}</div>
            <ul className="detail-list ok">
              {o.relevanceReasons.map((r, i) => {
                const key = `incentives.reasons.${r.key}` as TKey;
                const text = t(key, r.params);
                if (text === key) return null;
                return <li key={`${r.key}-${i}`}>{text}</li>;
              })}
            </ul>
          </div>
        )}

        {/* ---- La finestra ---- */}
        <div className="crm-sec">
          <div className="section-title">{t('incentives.detail.window')}</div>
          {o.callId ? (
            <dl className="crm-kv">
              {o.callTitle && (<><dt>{t('incentives.detail.call')}</dt><dd>{o.callTitle}</dd></>)}
              <dt>{t('incentives.detail.callStatus')}</dt>
              <dd>{t(CALL_STATUS_KEY[o.callStatus ?? 'unknown'])}</dd>
              <dt>{t('incentives.detail.deadline')}</dt>
              <dd>
                {o.callDeadlineOn
                  ? <>
                    {formatDate(o.callDeadlineOn)}
                    {notice.hasExactTime && <> · {t('incentives.deadlineExactTime')}</>}
                    {notice.verifyOnSource && <> · {t('incentives.deadlineVerifyShort')}</>}
                  </>
                  // ⚠️ «Non dichiarata» e non una data di ripiego: nessun 23:59
                  // dedotto, nessuna scadenza inventata.
                  : t('incentives.detail.noDeadline')}
              </dd>
            </dl>
          ) : (
            <p className="muted-sm">{t('incentives.detail.noCall')}</p>
          )}
        </div>

        {/* ---- La fonte ---- */}
        <div className="crm-sec">
          <div className="section-title">{t('incentives.detail.source')}</div>
          <dl className="crm-kv">
            <dt>{t('incentives.detail.version')}</dt>
            <dd>
              {t('incentives.detail.versionN', { n: o.versionNumber })}
              {o.versionEffectiveFrom && <> · {t('incentives.detail.effectiveFrom', { date: formatDate(o.versionEffectiveFrom) })}</>}
            </dd>
            <dt>{t('incentives.detail.officialPage')}</dt>
            <dd>
              <a href={o.officialSourceUrl} target="_blank" rel="noreferrer noopener">
                {o.officialSourceUrl} <Icon name="external" className="ic-sm" />
              </a>
            </dd>
          </dl>
        </div>
      </div>

      {/* ---- I criteri ---- */}
      <div className="card mt-16">
        <div className="section-title">{t('incentives.detail.criteria')}</div>
        <p className="muted-sm">{t('incentives.detail.criteriaHint')}</p>

        {loading ? (
          <><SkeletonLine /><SkeletonLine width="70%" /></>
        ) : !assessmentId ? (
          // ⚠️ «Non ancora valutata» e non «nessun criterio»: un programma senza
          // valutazione non è un programma senza requisiti.
          <div className="empty">{t('incentives.detail.notAssessed')}</div>
        ) : criteria.length === 0 ? (
          <div className="empty">{t('incentives.detail.noCriteria')}</div>
        ) : (
          <div className="mt-8">
            {criteria.map((c) => (
              <CriterionRow
                key={c.ruleKey}
                c={c}
                busy={busyKey === c.ruleKey}
                answered={answered[c.ruleKey] ?? null}
                onAnswer={(v) => void answer(c, v)}
              />
            ))}
          </div>
        )}

        {/* La legenda dei segni: identica a quella del dettaglio documento —
            il sistema si impara una volta sola. */}
        <div className="mt-12"><MarkLegend /></div>
      </div>

      {/* ⚠️ LA VERSIONE PER LA CARTA. Qui il foglio non porta citazioni da un
          documento — non ce n'è uno — ma la cosa che rende verificabile un
          verdetto d'idoneità: la FONTE ufficiale con l'indirizzo per esteso, la
          VERSIONE del catalogo su cui il giudizio è stato dato e la data
          dell'ultima valutazione. Senza quelle tre, in un fascicolo resta
          un'opinione. */}
      <PrintSheet
        title={o.programName}
        facts={[
          { labelKey: 'print.facts.authority', value: o.authority },
          { labelKey: 'incentives.measures.relevance', value: t(RELEVANCE_KEY[o.relevanceLevel]) },
          { labelKey: 'incentives.measures.eligibility', value: t(ELIGIBILITY_KEY[o.eligibilityStatus]) },
          { labelKey: 'incentives.measures.completeness', value: t(COMPLETENESS_KEY[o.completeness]) },
          { labelKey: 'incentives.measures.timing', value: t(TIMING_KEY[o.timing]) },
          { labelKey: 'incentives.detail.version', value: t('incentives.detail.versionN', { n: o.versionNumber }) },
        ]}
        deadline={o.callDeadlineOn
          ? {
            value: formatDate(o.callDeadlineOn),
            // Il bando dichiara la data ma raccomanda di controllarla alla
            // fonte: su carta quel «verificare» deve restare attaccato alla data.
            kindKey: notice.verifyOnSource ? 'print.deadline.toVerify' : null,
          }
          : null}
        sources={[{ label: t('incentives.detail.officialPage'), url: o.officialSourceUrl }]}
        footer={buildFooter({
          companyName: activeCompany?.legalName,
          now: new Date(),
          engine: t('print.footer.catalogEngine'),
          analysisVersion: o.versionNumber,
        })}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Un criterio
// ---------------------------------------------------------------------------
function CriterionRow({
  c, busy, answered, onAnswer,
}: {
  c: IncentiveCriterion; busy: boolean;
  answered: 'yes' | 'no' | 'unknown' | null;
  onAnswer: (v: 'yes' | 'no' | 'unknown') => void;
}) {
  const t = useT();
  const evidence = c.sourceEvidence;

  return (
    <div className="inc-criterion">
      <div className="inc-crit-head">
        <div className="inc-crit-label">{c.label}</div>
        <span className={`mark mark-elig ${CRITERION_MARK[c.state].cls}`}>
          <MarkGlyph name={CRITERION_MARK[c.state].glyph} />
          {t(CRITERION_STATE_KEY[c.state])}
        </span>
      </div>

      <div className="inc-crit-meta">
        {t(HARDNESS_KEY[c.hardness])}
        {/* ⚠️ Il valore osservato e la SUA PROVENIENZA vanno insieme: senza la
            seconda il primo è un numero senza padre. */}
        {c.observedValue && (
          <> · {t('incentives.criteria.observed', { value: c.observedValue })}</>
        )}
        {c.valueSource && (
          <> · {t('incentives.criteria.from', { source: t(`incentives.factSources.${c.valueSource}` as TKey) })}</>
        )}
      </div>

      {/* L'evidenza sulla fonte: la citazione originale, nella lingua della
          fonte, che può non essere quella dell'interfaccia. §139 — si mostra
          l'evidenza originale e si spiega nella lingua dell'utente. */}
      {evidence?.quote && (
        <blockquote className="inc-quote">
          <mark className="ev-hl">{evidence.quote}</mark>
          <div className="inc-quote-src">
            {evidence.section && <>{evidence.section} · </>}
            {evidence.checkedAt && <>{t('incentives.criteria.checkedOn', { date: formatDate(evidence.checkedAt) })} · </>}
            {evidence.url && (
              <a href={evidence.url} target="_blank" rel="noreferrer noopener">
                {t('incentives.criteria.openSource')} <Icon name="external" className="ic-sm" />
              </a>
            )}
          </div>
        </blockquote>
      )}

      {/* ⚠️ TRE risposte e non due: «non lo so» è una risposta legittima e
          diversa dal non aver risposto (che è l'assenza di riga). Trattarla
          come «no» renderebbe non soddisfatto un criterio semplicemente
          ignoto. */}
      {c.evaluability === 'question' && (
        <div className="quiz-opts mt-8">
          <button type="button" className="quiz-opt sel-si" disabled={busy} onClick={() => onAnswer('yes')}>
            {t('common.yes')}
          </button>
          <button type="button" className="quiz-opt sel-no" disabled={busy} onClick={() => onAnswer('no')}>
            {t('common.no')}
          </button>
          <button type="button" className="quiz-opt sel-ns" disabled={busy} onClick={() => onAnswer('unknown')}>
            {t('common.dontKnow')}
          </button>
        </div>
      )}
      {c.evaluability === 'question' && c.question && (
        <div className="field-hint mt-8">{c.question}</div>
      )}

      {/* ⚠️ Conferma la SCRITTURA, non l'esito. Il badge del criterio resta
          quello che la valutazione dice, perché è il motore a decidere e
          l'ultima valutazione è quella che è: dire «adesso è soddisfatto»
          sarebbe raccontare un verdetto che nessuno ha prodotto. */}
      {answered && (
        <div className="inc-crit-answered">
          <Icon name="checkCircle" className="ic-sm" />
          {t('incentives.criteria.answerRecorded', {
            value: t(answered === 'yes' ? 'common.yes' : answered === 'no' ? 'common.no' : 'common.dontKnow'),
          })}
        </div>
      )}

      {/* ⚠️ `manual` NON offre pulsanti: nessuno dei dati che abbiamo basta, e
          fingere una risposta sarebbe la cosa peggiore. Si dice dove guardare. */}
      {c.evaluability === 'manual' && (
        <div className="field-hint mt-8">{t('incentives.criteria.manualHint')}</div>
      )}

      {/* Il perché dello stato, quando il motore lo dichiara. `unknown_fact_key`
          esiste apposta: una regola che nomina un fatto che il motore non
          conosce deve dirlo, non sparire. */}
      {c.reasonCode && (
        <div className="inc-crit-reason">
          {(() => {
            const key = `incentives.reasonCodes.${c.reasonCode}` as TKey;
            const text = t(key);
            // Un codice che il dizionario non conosce si mostra GREZZO: meglio
            // leggere `unknown_operator` e accorgersene, che una spiegazione
            // plausibile e sbagliata.
            return text === key ? c.reasonCode : text;
          })()}
          {/* ⚠️ La chiave del fatto si mostra GREZZA e non tradotta: è un nome
              tecnico (`company.canton`, `project.stage`) e inventargli
              un'etichetta amichevole farebbe sembrare un dato di prodotto ciò
              che è un riferimento interno. Serve a chi deve capire perché. */}
          {c.factKey && <> · <code>{c.factKey}</code></>}
        </div>
      )}
    </div>
  );
}
