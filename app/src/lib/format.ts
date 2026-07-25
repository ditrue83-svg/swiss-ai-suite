// Utility di formattazione condivise. Il locale segue la LINGUA SCELTA
// dall'utente (it-CH · de-CH · fr-CH): le date svizzere si scrivono comunque
// gg.mm.aaaa, ma separatori e nomi dei mesi cambiano, e gli importi seguono la
// convenzione della lingua. Prima era fissato a it-CH per tutti.
import { getCurrentLocaleTag } from '@/i18n';

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(getCurrentLocaleTag(), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatCurrency(amount: number | null | undefined, currency: string | null | undefined): string | null {
  if (amount == null) return null;
  const cur = currency || 'CHF';
  try {
    return new Intl.NumberFormat(getCurrentLocaleTag(), { style: 'currency', currency: cur }).format(amount);
  } catch {
    return `${cur} ${amount}`;
  }
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}
