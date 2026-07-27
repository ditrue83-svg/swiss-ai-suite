// Panoramica (home operativa): saluto + {t('home.priorities')}.
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { useOverview } from './useOverview';
import { collectPriorities, type PriorityItem } from './overview';
import { useT } from '@/i18n';
import { useLabels } from '@/i18n/labels';

function greetingKey(): 'home.greetingMorning' | 'home.greetingAfternoon' | 'home.greetingEvening' {
  const h = new Date().getHours();
  if (h < 12) return 'home.greetingMorning';
  if (h < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

function PriorityRow({ it }: { it: PriorityItem }) {
  const L = useLabels();
  // Il collegamento è la riga, non la freccia: su un portatile con trackpad
  // centrare un bersaglio di 16 pixel è una prova di mira.
  return (
    <Link className="action-row is-link" to={it.to} aria-label={`${it.title} — ${it.cta}`}>
      <div className={`action-ico p-${it.priority}`}><Icon name={it.icon} className="ic-sm" /></div>
      <div className="action-main">
        <div className="action-title">{it.title}</div>
        <div className="action-sub">{it.sub}</div>
      </div>
      <div className="action-meta">
        <span className={`badge badge-${it.priority}`}>{L.urgency(it.priority)}</span>
        <span className="action-link" aria-hidden="true"><Icon name="arrowRight" className="ic-sm" /></span>
      </div>
    </Link>
  );
}

export function HomePage() {
  const t = useT();
  const { loading, error, data, reload } = useOverview();

  const priorities = data ? collectPriorities(data).slice(0, 7) : [];
  const hasData = !!data && (data.documents.length > 0 || data.tasks.length > 0 || !!data.matches.length);

  return (
    <div id="home-body">
      <div className="page-head">
        <div className="greeting">{t(greetingKey())}</div>
        <div className="greeting-sub">{t('home.subtitle')}</div>
      </div>

      <div className="row-wrap">
        <Link className="btn btn-primary btn-block-mobile" to="/admin"><Icon name="document" className="ic-sm" /> {t('home.analyzeDoc')}</Link>
        <Link className="btn" to="/subsidy"><Icon name="banknote" className="ic-sm" /> {t('home.findSubsidies')}</Link>
        <Link className="btn btn-ghost" to="/attivita"><Icon name="calendar" className="ic-sm" /> {t('nav.tasks')}</Link>
      </div>

      <div className="mt-16">
        {loading && <SkeletonCard />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (
          priorities.length === 0 ? (
            <div className="priority-empty">
              <Icon name="checkCircle" />
              <div>{t('home.noPriorities')}</div>
            </div>
          ) : (
            <div className="card">
              <div className="card-title">{t('home.priorities')}</div>
              {priorities.map((it, i) => <PriorityRow key={i} it={it} />)}
            </div>
          )
        )}
      </div>

      {!loading && !error && !hasData && (
        <div className="grid-2 mt-16">
          <div className="card module-card">
            <div className="module-kicker">{t('home.module', { n: 1 })}</div>
            <div className="card-title mt-10">{t('adminAi.title')}</div>
            <p className="muted-sm">{t('home.adminAiDesc')}</p>
            <Link className="btn btn-sm mt-12" to="/admin">{t('home.openAdminAi')} <Icon name="arrowRight" className="ic-sm" /></Link>
          </div>
          <div className="card module-card">
            <div className="module-kicker">{t('home.module', { n: 2 })}</div>
            <div className="card-title mt-10">{t('subsidy.title')}</div>
            <p className="muted-sm">{t('home.subsidyAiDesc')}</p>
            <Link className="btn btn-sm mt-12" to="/subsidy">{t('home.openSubsidyAi')} <Icon name="arrowRight" className="ic-sm" /></Link>
          </div>
        </div>
      )}

      <div className="footnote">{t('legal.disclaimer')}</div>
    </div>
  );
}
