const PLANS = [
  {
    nome: 'Basic',
    prezzo: 49,
    target: 'Microimprese',
    features: [
      'Fino a 20 analisi documenti / mese',
      'Spiegazioni multilingue IT · DE · FR',
      'Checklist e scadenziario personale',
      'Ricerca incentivi (5 verifiche / mese)',
      '1 utente',
    ],
  },
  {
    nome: 'Business',
    prezzo: 149,
    target: 'PMI in crescita',
    featured: true,
    features: [
      'Analisi documenti illimitate',
      'Bozze di risposta formali',
      'Scadenziario di team con assegnazioni',
      'Verifiche di idoneità incentivi illimitate',
      'Fino a 5 utenti',
    ],
  },
  {
    nome: 'Pro',
    prezzo: 299,
    target: 'Aziende strutturate',
    features: [
      'Tutto di Business',
      'Inbox amministrativa (analisi automatica email)',
      'Workflow avanzati e integrazioni',
      'Monitoraggio continuo nuovi incentivi',
      'Utenti illimitati',
    ],
  },
  {
    nome: 'Fiduciarie',
    prezzo: null,
    target: 'Studi fiduciari e consulenti',
    features: [
      'Gestione multi-cliente centralizzata',
      'Vista aggregata scadenze di tutti i clienti',
      'Report incentivi per portafoglio clienti',
      'Onboarding e supporto dedicati',
      'Prezzo su misura',
    ],
  },
]

export default function Pricing() {
  return (
    <>
      <div className="page-head">
        <div className="page-title">Piani e prezzi</div>
        <div className="page-desc">
          Un abbonamento unico per entrambi i moduli: Swiss Admin AI e Swiss Subsidy AI.
          Prezzi in CHF, IVA esclusa.
        </div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {PLANS.map((p) => (
          <div key={p.nome} className={'card price-card' + (p.featured ? ' featured' : '')}>
            {p.featured && <div className="featured-flag">Più scelto</div>}
            <div className="card-title" style={{ marginBottom: 2 }}>{p.nome}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>{p.target}</div>
            <div className="price-tag">
              {p.prezzo ? <>CHF {p.prezzo}<small> /mese</small></> : <span style={{ fontSize: 20 }}>Su misura</span>}
            </div>
            <ul className="price-feats">
              {p.features.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
            <button className={'btn' + (p.featured ? ' btn-primary' : '')}>
              {p.prezzo ? 'Inizia la prova gratuita' : 'Contattaci'}
            </button>
          </div>
        ))}
      </div>

      <div className="footnote">
        Aspetti garantiti su tutti i piani: dati ospitati in Svizzera, separazione dei dati tra
        aziende, controllo degli accessi, trasparenza sui limiti dell'analisi automatica.
        L'output non costituisce consulenza legale, fiscale o fiduciaria; in caso di incertezza
        il sistema chiede una verifica, non inventa.
      </div>
    </>
  )
}
