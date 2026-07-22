import { formatDate } from '../engine/adminEngine.js'

export default function Home({ setPage, docs, tasks }) {
  const openTasks = tasks
    .filter((t) => t.stato !== 'fatto' && t.scadenza)
    .sort((a, b) => new Date(a.scadenza) - new Date(b.scadenza))
    .slice(0, 5)
  const recentDocs = [...docs].reverse().slice(0, 5)

  return (
    <>
      <div className="hero">
        <h1>
          L'amministrazione svizzera è complessa.<br />
          <em>La tua giornata non deve esserlo.</em>
        </h1>
        <p>
          SwissAI Suite trasforma lettere, moduli e bandi di Confederazione, Cantoni e Comuni
          in azioni concrete: spiegazioni semplici, scadenze, checklist operative e incentivi
          realmente pertinenti alla tua impresa. In italiano, tedesco e francese.
        </p>
        <div className="hero-actions">
          <button className="btn btn-primary" onClick={() => setPage('admin')}>Analizza un documento</button>
          <button className="btn" onClick={() => setPage('subsidy')}>Trova incentivi</button>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 28 }}>
        <div className="card module-card">
          <div className="module-kicker">Modulo 1</div>
          <div className="card-title" style={{ marginTop: 6 }}>Swiss Admin AI</div>
          <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>
            Carica una lettera, un PDF o un'email: il sistema identifica ente, lingua e scadenze,
            spiega il contenuto in linguaggio semplice, genera la checklist delle azioni e una
            bozza di risposta formale nella lingua corretta.
          </p>
          <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setPage('admin')}>
            Apri Admin AI →
          </button>
        </div>
        <div className="card module-card">
          <div className="module-kicker">Modulo 2</div>
          <div className="card-title" style={{ marginTop: 6 }}>Swiss Subsidy AI</div>
          <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>
            Crea il profilo della tua impresa e descrivi il progetto: il motore lo confronta con
            un database di programmi federali e cantonali e mostra solo gli incentivi compatibili,
            con verifica di idoneità guidata.
          </p>
          <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setPage('subsidy')}>
            Apri Subsidy AI →
          </button>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-title">Prossime scadenze</div>
          {openTasks.length === 0 ? (
            <div className="empty">Nessuna scadenza in agenda. Analizza un documento per iniziare.</div>
          ) : (
            openTasks.map((t) => (
              <div className="list-row" key={t.id}>
                <div className="list-main">
                  <div className="list-title">{t.titolo}</div>
                  <div className="list-sub">{t.ente}</div>
                </div>
                <span className={'badge badge-' + (t.urgenza || 'neutral')}>{formatDate(new Date(t.scadenza))}</span>
              </div>
            ))
          )}
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setPage('deadlines')}>
            Vai allo scadenziario →
          </button>
        </div>
        <div className="card">
          <div className="card-title">Documenti analizzati di recente</div>
          {recentDocs.length === 0 ? (
            <div className="empty">Nessun documento analizzato finora.</div>
          ) : (
            recentDocs.map((d) => (
              <div className="list-row" key={d.id}>
                <div className="list-main">
                  <div className="list-title">{d.title}</div>
                  <div className="list-sub">{d.ente} · {d.linguaLabel}</div>
                </div>
                <span className={'badge badge-' + d.urgenza}>{d.urgenza}</span>
              </div>
            ))
          )}
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setPage('archive')}>
            Vai all'archivio →
          </button>
        </div>
      </div>

      <div className="footnote">
        SwissAI Suite è uno strumento di supporto amministrativo. Le analisi sono generate
        automaticamente e non sostituiscono la consulenza legale, fiscale o fiduciaria.
        Quando il sistema non è sicuro, lo segnala e invita a una verifica manuale.
      </div>
    </>
  )
}
