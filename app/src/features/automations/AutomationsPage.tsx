// ============================================================================
// Automazioni — l'elenco. Risponde a una domanda sola: che cosa fa AI-Swisse
// al posto nostro, e sta funzionando?
//
// ⚠️ OGNI REGOLA ATTIVA È VISIBILE QUI (§82). Non esistono automazioni
// nascoste, non ce ne sono di preinstallate e nessuna si accende da sola: i
// modelli creano BOZZE, che una persona rilegge e attiva.
//
// La riga dice sei cose e non di più: come si chiama, quando scatta, cosa fa,
// se è accesa, quando ha lavorato l'ultima volta, se c'è qualcosa che non va.
// ============================================================================
import { useMemo, useState } from 'react';
import { Tag, type TagTone } from '@/components/ui/Tag';
import { Link, useNavigate } from 'react-router-dom';
import { automationService } from '@/services/automationService';
import { documentHubService } from '@/services/documentHubService';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { useAsync } from '@/hooks/useAsync';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonLine } from '@/components/ui/states';
import { toUserMessage } from '@/lib/errors';
import { useI18n, useT, type TKey } from '@/i18n';
import { relativeTime } from '@/features/notifications/notificationFormat';
import { useMembers } from '@/features/tasks/useMembers';
import {
  AUTOMATION_TEMPLATES, attentionKey, describeAction, findTrigger, statusLabelKey,
  type AutomationTemplate, type NameResolver,
} from './automationModel';
import type { Workflow } from '@/types/models';

export function AutomationsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { activeCompanyId, isAdmin } = useCompany();
  const { showToast } = useToast();
  const companyId = activeCompanyId as string;
  const { byId } = useMembers();

  const [showArchived, setShowArchived] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  const { loading, error, data, reload } = useAsync(
    () => automationService.list(companyId, showArchived),
    [companyId, showArchived],
  );

  // Lo stato della coda: serve solo a chi può intervenire, e si mostra SOLO
  // quando dice qualcosa (§170). Un contatore a zero in cima alla pagina è
  // rumore che insegna a non guardare più quella zona.
  const { data: backlog } = useAsync(
    () => (isAdmin ? automationService.backlog(companyId) : Promise.resolve(null)),
    [companyId, isAdmin],
  );

  const names: NameResolver = useMemo(() => ({
    member: (id) => {
      if (!id) return t('tasks.unassigned');
      const m = byId.get(id);
      return m ? (m.name || t('tasks.unnamedMember')) : t('tasks.unknownMember');
    },
    // Nell'elenco non si caricano le etichette documentali: la riga mostra
    // «Aggiungi etichetta» senza il nome, e il nome si legge nel dettaglio.
    // Caricare venti etichette per scrivere una parola non vale la richiesta.
    tag: () => '',
  }), [byId, t]);

  const items = data ?? [];
  const needAttention = items.filter((w) => w.attentionCode && w.status !== 'archived');

  /**
   * «Usa modello» crea una BOZZA e porta a modificarla (§81). Non attiva
   * niente: l'attivazione resta un gesto esplicito, con la frase riassuntiva
   * davanti.
   */
  async function useTemplate(tpl: AutomationTemplate) {
    if (installing) return;
    setInstalling(tpl.id);
    try {
      const actions = [...tpl.actions];

      // Il modello del contratto ha bisogno di un'etichetta. Si riusa quella
      // che esiste già, altrimenti la si crea: due etichette «Da verificare»
      // nella stessa azienda sarebbero due modi di dire la stessa cosa.
      if (tpl.needsTag) {
        const existing = await documentHubService.listTags(companyId);
        const wanted = t('automations.templates.reviewTag').trim();
        const found = existing.find((g) => g.name.trim().toLowerCase() === wanted.toLowerCase());
        const tag = found ?? await documentHubService.createTag(companyId, wanted);
        actions[0] = { key: 'add_document_tag', config: { tagId: tag.id } };
      }

      const saved = await automationService.save(companyId, {
        name: t(tpl.nameKey),
        description: t(tpl.descriptionKey),
        triggerType: tpl.triggerType,
        conditionMatch: tpl.conditionMatch,
        conditions: tpl.conditions,
        actions,
      });
      showToast(t('automations.templateInstalled'));
      navigate(`/automazioni/${saved.id}/modifica`);
    } catch (e) {
      showToast(toUserMessage(e));
    } finally {
      setInstalling(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('automations.title')}</div>
        <div className="page-desc">{t('automations.subtitle')}</div>
      </div>

      {isAdmin && (
        <div className="row-wrap">
          <Link className="btn btn-primary btn-block-mobile" to="/automazioni/nuova">
            <Icon name="plus" className="ic-sm" /> {t('automations.newAutomation')}
          </Link>
          <button className="btn btn-sm" onClick={() => setShowArchived((v) => !v)}
            aria-pressed={showArchived}>
            {showArchived ? t('automations.hideArchived') : t('automations.showArchived')}
          </button>
        </div>
      )}

      {!isAdmin && (
        <div className="info-box mt-14">
          <Icon name="alert" className="ic-sm" /> {t('automations.memberNotice')}
        </div>
      )}

      {/* §170 — l'arretrato si mostra solo quando è un problema vero, non a
          ogni caricamento. Un evento in coda da qualche minuto è il
          funzionamento normale; uno da mezz'ora vuol dire che qualcosa è fermo. */}
      {isAdmin && backlog && (backlog.deadLetter > 0 || backlog.oldestSeconds > 1800) && (
        <div className="warn-box mt-14">
          <Icon name="alert" className="ic-sm" />
          {backlog.deadLetter > 0
            ? t('automations.backlogDead', { n: backlog.deadLetter })
            : t('automations.backlogStale', { minutes: Math.round(backlog.oldestSeconds / 60) })}
        </div>
      )}

      {needAttention.length > 0 && (
        <div className="warn-box mt-14">
          <Icon name="alert" className="ic-sm" />
          {t('automations.needAttention', { n: needAttention.length })}
        </div>
      )}

      <div className="card mt-16">
        <div className="card-title">{t('automations.listTitle')}</div>

        {loading && <><SkeletonLine width="70%" /><SkeletonLine width="55%" /><SkeletonLine width="60%" /></>}
        {error && <ErrorState message={error} onRetry={reload} />}

        {!loading && !error && items.length === 0 && (
          <div className="empty">
            <div>{t('automations.empty')}</div>
            <div className="muted-sm mt-10">{t('automations.emptySub')}</div>
          </div>
        )}

        {!loading && !error && items.map((w) => (
          <AutomationRow key={w.id} workflow={w} names={names} />
        ))}
      </div>

      {/* ⚠️ I modelli NON si mostrano quando l'elenco non si è potuto leggere.
          Trovato aprendo la pagina con la 0020 non ancora applicata: la
          schermata dichiarava correttamente «manca un aggiornamento» e SOTTO
          offriva cinque pulsanti «Usa modello» che non potevano funzionare. È
          la stessa forma del pulsante «Collega calendario» che portava a un
          rifiuto: offrire un'azione che sappiamo già non riuscire. */}
      {isAdmin && !error && (
        <div className="card mt-16">
          <div className="card-title">{t('automations.templatesTitle')}</div>
          <p className="muted-sm">{t('automations.templatesIntro')}</p>
          {AUTOMATION_TEMPLATES.map((tpl) => (
            <div className="list-row" key={tpl.id}>
              <div className="list-main">
                <div className="list-title">{t(tpl.nameKey)}</div>
                <div className="list-sub">{t(tpl.descriptionKey)}</div>
              </div>
              <button className="btn btn-sm" onClick={() => void useTemplate(tpl)}
                disabled={installing !== null} aria-busy={installing === tpl.id || undefined}>
                {installing === tpl.id ? <span className="spinner" aria-hidden="true" /> : null}
                {t('automations.useTemplate')}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Una riga. Lo stato è TESTO oltre che colore (§156): un pallino verde non dice
 * niente a chi non distingue i colori, e «Attiva» sì.
 */
function AutomationRow({ workflow, names }: { workflow: Workflow; names: NameResolver }) {
  const t = useT();
  const { localeTag } = useI18n();
  const trigger = findTrigger(workflow.triggerType);
  const attention = attentionKey(workflow.attentionCode);
  const badgeClass = workflow.status === 'active' ? 'ok'
    : workflow.status === 'paused' ? 'attention' : 'neutral';

  return (
    <Link className="list-row is-link" to={`/automazioni/${workflow.id}`} aria-label={workflow.name}>
      <div className="list-main">
        <div className="list-title">{workflow.name}</div>
        <div className="list-sub">
          {trigger ? t(trigger.labelKey as TKey) : workflow.triggerType}
          {workflow.actions.length > 0 && (
            <> · {workflow.actions.map((a) => describeAction(t, a, names)).join(' · ')}</>
          )}
        </div>
        {attention && <div className="list-sub"><Tag tone="alert">{t(attention)}</Tag></div>}
      </div>
      <Tag tone={badgeClass}>{t(statusLabelKey(workflow.status))}</Tag>
      <Tag>
        {workflow.lastRunAt
          ? t('automations.lastRunAt', { when: relativeTime(workflow.lastRunAt, localeTag) })
          : t('automations.neverRun')}
      </Tag>
    </Link>
  );
}
