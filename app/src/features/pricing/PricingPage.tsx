import { useToast } from '@/components/ui/Toast';
import { useT } from '@/i18n';

import type { TKey } from '@/i18n';

// I piani portano CHIAVI, non testo: nomi dei piani e prezzi restano invariati
// (sono dati commerciali), ma target e caratteristiche si traducono al render.
interface Plan { nome: string; prezzo: number | null; targetKey: TKey; featured?: boolean; featureKeys: TKey[] }
const PLANS: Plan[] = [
  { nome: 'Basic', prezzo: 49, targetKey: 'pricing.plans.basicTarget', featureKeys: ['pricing.plans.f.docs20', 'pricing.plans.f.multilang', 'pricing.plans.f.checklist', 'pricing.plans.f.subsidy5', 'pricing.plans.f.user1'] },
  { nome: 'Business', prezzo: 149, targetKey: 'pricing.plans.businessTarget', featured: true, featureKeys: ['pricing.plans.f.docsUnlimited', 'pricing.plans.f.replies', 'pricing.plans.f.teamTasks', 'pricing.plans.f.subsidyUnlimited', 'pricing.plans.f.users5'] },
  { nome: 'Pro', prezzo: 299, targetKey: 'pricing.plans.proTarget', featureKeys: ['pricing.plans.f.allBusiness', 'pricing.plans.f.inbox', 'pricing.plans.f.workflows', 'pricing.plans.f.monitoring', 'pricing.plans.f.usersUnlimited'] },
  { nome: 'Fiduciarie', prezzo: null, targetKey: 'pricing.plans.fiduciaryTarget', featureKeys: ['pricing.plans.f.multiClient', 'pricing.plans.f.aggregated', 'pricing.plans.f.portfolioReports', 'pricing.plans.f.dedicated', 'pricing.plans.f.customPrice'] },
];

export function PricingPage() {
  const t = useT();
  const { showToast } = useToast();
  return (
    <>
      <div className="page-head">
        <div className="page-title">Piani e prezzi</div>
        <div className="page-desc">{t('pricing.subtitle')}</div>
      </div>

      <div className="grid-4">
        {PLANS.map((p) => (
          <div key={p.nome} className={`card price-card${p.featured ? ' featured' : ''}`}>
            {p.featured && <div className="featured-flag">Consigliato</div>}
            <div className="card-title">{p.nome}</div>
            <div className="price-target">{t(p.targetKey)}</div>
            <div className="price-tag">{p.prezzo ? <>CHF {p.prezzo}<small> {t('pricing.plans.perMonth')}</small></> : <span className="price-custom">{t('pricing.plans.custom')}</span>}</div>
            <ul className="price-feats">{p.featureKeys.map((k) => <li key={k}>{t(k)}</li>)}</ul>
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
