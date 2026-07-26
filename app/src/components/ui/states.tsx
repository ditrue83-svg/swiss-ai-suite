// Stati riutilizzabili: loading / error / empty + skeleton + Button con loading.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
// Fuori da un componente serve translate(): questo default viene valutato al render.
import { translate as tr } from '@/i18n';

export function Spinner({ large }: { large?: boolean }) {
  return <span className={large ? 'spinner-lg' : 'spinner'} aria-hidden="true" />;
}

export function FullScreenLoader({ label }: { label?: string }) {
  const text = label ?? tr('states.loading');
  return (
    <div className="app-loading">
      <span className="spinner-lg" aria-hidden="true" />
      <div>{text}</div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-error" role="alert">
      <Icon name="alert" />
      <div>
        <div>{message}</div>
        {onRetry && (
          <button className="btn btn-sm mt-8" onClick={onRetry}>
            <Icon name="refresh" className="ic-sm" /> {tr('common.retry')}
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyCta({
  icon = 'document', title, subtitle, action,
}: { icon?: IconName; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="empty-cta">
      <div className="ec-ico"><Icon name={icon} /></div>
      <div className="ec-title">{title}</div>
      {subtitle && <div className="ec-sub">{subtitle}</div>}
      {action}
    </div>
  );
}

export function SkeletonLine({ width }: { width?: string }) {
  return <div className="skeleton skel-line" style={width ? { width } : undefined} />;
}

export function SkeletonKpiGrid() {
  return (
    <div className="kpi-grid">
      {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton skel-kpi" />)}
    </div>
  );
}

export function SkeletonCard() {
  return <div className="skeleton skel-card" />;
}

// Button che previene doppi click e mostra lo spinner durante l'azione (#22).
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: 'primary' | 'default' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: IconName;
  children: ReactNode;
}
export function Button({ loading, variant = 'default', size = 'md', icon, children, className, disabled, ...rest }: ButtonProps) {
  const cls = [
    'btn',
    variant === 'primary' ? 'btn-primary' : variant === 'ghost' ? 'btn-ghost' : variant === 'danger' ? 'btn-danger' : '',
    size === 'sm' ? 'btn-sm' : '',
    className ?? '',
  ].filter(Boolean).join(' ');
  return (
    <button className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} className="ic-sm" /> : null}
      {children}
    </button>
  );
}
