import { useToast } from '@/components/ui/Toast';
import { useT } from '@/i18n';
import { cx } from '@/lib/cx';
import type { Sede } from '@/features/companies/CompanySettingsPage';

import type { TKey } from '@/i18n';
import styles from './pricing.module.css';

// I piani portano CHIAVI, non testo: nomi dei piani e prezzi restano invariati
// (sono dati commerciali), ma target e caratteristiche si traducono al render.
interface Plan { nome: string; prezzo: number | null; targetKey: TKey; featured?: boolean; featureKeys: TKey[] }
const PLANS: Plan[] = [
  { nome: 'Basic', prezzo: 49, targetKey: 'pricing.plans.basicTarget', featureKeys: ['pricing.plans.f.docs20', 'pricing.plans.f.multilang', 'pricing.plans.f.checklist', 'pricing.plans.f.user1'] },
  { nome: 'Business', prezzo: 149, targetKey: 'pricing.plans.businessTarget', featured: true, featureKeys: ['pricing.plans.f.docsUnlimited', 'pricing.plans.f.replies', 'pricing.plans.f.teamTasks', 'pricing.plans.f.users5'] },
  { nome: 'Pro', prezzo: 299, targetKey: 'pricing.plans.proTarget', featureKeys: ['pricing.plans.f.allBusiness', 'pricing.plans.f.inbox', 'pricing.plans.f.workflows', 'pricing.plans.f.usersUnlimited'] },
  { nome: 'Fiduciarie', prezzo: null, targetKey: 'pricing.plans.fiduciaryTarget', featureKeys: ['pricing.plans.f.multiClient', 'pricing.plans.f.aggregated', 'pricing.plans.f.dedicated', 'pricing.plans.f.customPrice'] },
];

/** La rotta `/prezzi`: resta viva, e mostra ciò che mostra il pannello. */
export function PricingPage() {
  return <Pricing sede="pagina" />;
}

export function Pricing({ sede }: { sede: Sede }) {
  const t = useT();
  const { showToast } = useToast();
  return (
    <>
      <div className="page-head">
        {sede === 'pagina' && <div className="page-title">{t('nav.subscription')}</div>}
        <div className="page-desc">{t('pricing.subtitle')}</div>
      </div>

      {/* ⚠️ Quattro colonne stanno in una pagina larga 1160px, non nei 560 utili
          di una finestra: dentro il pannello i piani vanno a capo da soli. */}
      <div className={sede === 'pannello' ? 'grid-2' : styles.grid4}>
        {PLANS.map((p) => (
          <div key={p.nome} className={cx('card', styles.priceCard, p.featured && styles.featured)}>
            {p.featured && <div className={styles.featuredFlag}>{t('pricing.plans.recommended')}</div>}
            <div className="card-title">{p.nome}</div>
            <div className={styles.priceTarget}>{t(p.targetKey)}</div>
            <div className={styles.priceTag}>{p.prezzo ? <>CHF {p.prezzo}<small> {t('pricing.plans.perMonth')}</small></> : <span className={styles.priceCustom}>{t('pricing.plans.custom')}</span>}</div>
            <ul className={styles.priceFeats}>{p.featureKeys.map((k) => <li key={k}>{t(k)}</li>)}</ul>
            <button className={`btn${p.featured ? ' btn-primary' : ''}`} onClick={() => showToast(t('pricing.demoNote'))}>
              {t('pricing.plans.request')}
            </button>
          </div>
        ))}
      </div>

      <div className="footnote">{t('pricing.disclaimer')}</div>
    </>
  );
}
