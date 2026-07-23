import { useToast } from '@/components/ui/Toast';

interface Plan { nome: string; prezzo: number | null; target: string; featured?: boolean; features: string[] }
const PLANS: Plan[] = [
  { nome: 'Basic', prezzo: 49, target: 'Microimprese', features: ['Fino a 20 analisi documenti / mese', 'Spiegazioni multilingue IT · DE · FR', 'Checklist e scadenziario personale', 'Ricerca incentivi (5 verifiche / mese)', '1 utente'] },
  { nome: 'Business', prezzo: 149, target: 'PMI in crescita', featured: true, features: ['Analisi documenti illimitate', 'Bozze di risposta formali', 'Scadenziario di team con assegnazioni', 'Verifiche di idoneità incentivi illimitate', 'Fino a 5 utenti'] },
  { nome: 'Pro', prezzo: 299, target: 'Aziende strutturate', features: ['Tutto di Business', 'Inbox amministrativa (analisi automatica email)', 'Workflow avanzati e integrazioni', 'Monitoraggio continuo nuovi incentivi', 'Utenti illimitati'] },
  { nome: 'Fiduciarie', prezzo: null, target: 'Studi fiduciari e consulenti', features: ['Gestione multi-cliente centralizzata', 'Vista aggregata scadenze di tutti i clienti', 'Report incentivi per portafoglio clienti', 'Onboarding e supporto dedicati', 'Prezzo su misura'] },
];

export function PricingPage() {
  const { showToast } = useToast();
  return (
    <>
      <div className="page-head">
        <div className="page-title">Piani e prezzi</div>
        <div className="page-desc">Prezzi indicativi per entrambi i moduli: Swiss Admin AI e Swiss Subsidy AI. Importi in CHF, IVA esclusa.</div>
      </div>

      <div className="grid-4">
        {PLANS.map((p) => (
          <div key={p.nome} className={`card price-card${p.featured ? ' featured' : ''}`}>
            {p.featured && <div className="featured-flag">Consigliato</div>}
            <div className="card-title">{p.nome}</div>
            <div className="price-target">{p.target}</div>
            <div className="price-tag">{p.prezzo ? <>CHF {p.prezzo}<small> /mese</small></> : <span className="price-custom">Su misura</span>}</div>
            <ul className="price-feats">{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
            <button className={`btn${p.featured ? ' btn-primary' : ''}`} onClick={() => showToast('Demo: la richiesta di accesso pilota non viene inviata in questo prototipo.')}>
              Richiedi accesso pilota
            </button>
          </div>
        ))}
      </div>

      <div className="footnote">L’output non costituisce consulenza legale, fiscale o fiduciaria; in caso di incertezza il sistema segnala di verificare e non inventa dati.</div>
    </>
  );
}
