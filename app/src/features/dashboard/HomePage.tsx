// Panoramica (home operativa): saluto + Priorità di oggi.
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { ErrorState, SkeletonCard } from '@/components/ui/states';
import { useOverview } from './useOverview';
import { collectPriorities, type PriorityItem } from './overview';

function greetingText(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Buongiorno';
  if (h < 18) return 'Buon pomeriggio';
  return 'Buonasera';
}

function PriorityRow({ it }: { it: PriorityItem }) {
  return (
    <div className="action-row">
      <div className={`action-ico p-${it.priority}`}><Icon name={it.icon} className="ic-sm" /></div>
      <div className="action-main">
        <div className="action-title">{it.title}</div>
        <div className="action-sub">{it.sub}</div>
      </div>
      <div className="action-meta">
        <span className={`badge badge-${it.priority}`}>{it.priority}</span>
        <Link className="action-link" to={it.to} aria-label={it.cta}><Icon name="arrowRight" className="ic-sm" /></Link>
      </div>
    </div>
  );
}

export function HomePage() {
  const { loading, error, data, reload } = useOverview();

  const priorities = data ? collectPriorities(data).slice(0, 7) : [];
  const hasData = !!data && (data.documents.length > 0 || data.tasks.length > 0 || !!data.matches.length);

  return (
    <div id="home-body">
      <div className="page-head">
        <div className="greeting">{greetingText()}</div>
        <div className="greeting-sub">Ecco cosa richiede attenzione nella tua azienda.</div>
      </div>

      <div className="row-wrap">
        <Link className="btn btn-primary btn-block-mobile" to="/admin"><Icon name="document" className="ic-sm" /> Analizza un documento</Link>
        <Link className="btn" to="/subsidy"><Icon name="banknote" className="ic-sm" /> Trova incentivi</Link>
        <Link className="btn btn-ghost" to="/scadenziario"><Icon name="calendar" className="ic-sm" /> Scadenziario</Link>
      </div>

      <div className="mt-16">
        {loading && <SkeletonCard />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && (
          priorities.length === 0 ? (
            <div className="priority-empty">
              <Icon name="checkCircle" />
              <div>Nessuna priorità urgente al momento: sei in pari con scadenze e documenti.</div>
            </div>
          ) : (
            <div className="card">
              <div className="card-title">Priorità di oggi</div>
              {priorities.map((it, i) => <PriorityRow key={i} it={it} />)}
            </div>
          )
        )}
      </div>

      {!loading && !error && !hasData && (
        <div className="grid-2 mt-16">
          <div className="card module-card">
            <div className="module-kicker">Modulo 1</div>
            <div className="card-title mt-10">Swiss Admin AI</div>
            <p className="muted-sm">Carica una lettera, un PDF o un’email: il sistema identifica ente, lingua e scadenze, spiega il contenuto e prepara checklist e bozza di risposta nella lingua corretta.</p>
            <Link className="btn btn-sm mt-12" to="/admin">Apri Admin AI <Icon name="arrowRight" className="ic-sm" /></Link>
          </div>
          <div className="card module-card">
            <div className="module-kicker">Modulo 2</div>
            <div className="card-title mt-10">Swiss Subsidy AI</div>
            <p className="muted-sm">Descrivi il progetto: il motore lo confronta con i programmi federali e cantonali e mostra solo gli incentivi compatibili, con verifica di idoneità.</p>
            <Link className="btn btn-sm mt-12" to="/subsidy">Apri Subsidy AI <Icon name="arrowRight" className="ic-sm" /></Link>
          </div>
        </div>
      )}

      <div className="footnote">SwissAI Suite è uno strumento di supporto amministrativo. Le analisi sono generate automaticamente e non sostituiscono la consulenza legale, fiscale o fiduciaria. Quando il sistema non è sicuro, lo segnala e invita a una verifica manuale.</div>
    </div>
  );
}
