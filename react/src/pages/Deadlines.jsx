import { useState } from 'react'
import { formatDate } from '../engine/adminEngine.js'

const STATI = { da_fare: 'Da fare', in_corso: 'In corso', fatto: 'Fatto' }

export default function Deadlines({ tasks, setTasks, addTask }) {
  const [filter, setFilter] = useState('aperte')
  const [titolo, setTitolo] = useState('')
  const [ente, setEnte] = useState('')
  const [data, setData] = useState('')

  const visible = tasks
    .filter((t) => (filter === 'aperte' ? t.stato !== 'fatto' : filter === 'tutte' ? true : t.stato === 'fatto'))
    .sort((a, b) => new Date(a.scadenza || '2100-01-01') - new Date(b.scadenza || '2100-01-01'))

  const setStato = (id, stato) => setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, stato } : t)))
  const remove = (id) => setTasks((prev) => prev.filter((t) => t.id !== id))

  const daysTo = (t) => (t.scadenza ? Math.ceil((new Date(t.scadenza) - new Date()) / 86400000) : null)

  const onAdd = () => {
    if (!titolo.trim()) return
    const days = data ? Math.ceil((new Date(data) - new Date()) / 86400000) : null
    addTask({
      titolo: titolo.trim(),
      ente: ente.trim() || 'Inserimento manuale',
      scadenza: data ? new Date(data).toISOString() : null,
      urgenza: days != null && days <= 10 ? 'alta' : days != null && days <= 30 ? 'media' : 'bassa',
    })
    setTitolo(''); setEnte(''); setData('')
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">Scadenziario</div>
        <div className="page-desc">
          Tutte le scadenze create dalle analisi dei documenti e dagli incentivi, con promemoria
          di urgenza.
        </div>
      </div>

      <div className="card">
        <div className="card-title">Aggiungi scadenza manuale</div>
        <div className="grid-3">
          <div className="field">
            <label>Titolo</label>
            <input value={titolo} onChange={(e) => setTitolo(e.target.value)} placeholder="Es. Inviare conteggio AVS" />
          </div>
          <div className="field">
            <label>Ente / riferimento</label>
            <input value={ente} onChange={(e) => setEnte(e.target.value)} placeholder="Es. Cassa di compensazione" />
          </div>
          <div className="field">
            <label>Data di scadenza</label>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={onAdd}>Aggiungi</button>
      </div>

      <div className="card">
        <div className="card-title">
          Scadenze
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {['aperte', 'fatte', 'tutte'].map((f) => (
              <button key={f} className={'btn btn-sm' + (filter === f ? ' btn-primary' : '')} onClick={() => setFilter(f)}>
                {f}
              </button>
            ))}
          </span>
        </div>
        {visible.length === 0 ? (
          <div className="empty">Nessuna scadenza in questa vista.</div>
        ) : (
          visible.map((t) => {
            const d = daysTo(t)
            return (
              <div className="list-row" key={t.id}>
                <div className="list-main">
                  <div className="list-title">{t.titolo}</div>
                  <div className="list-sub">
                    {t.ente}
                    {t.nota ? ' · ' + t.nota : ''}
                  </div>
                </div>
                {t.scadenza ? (
                  <span className={'badge badge-' + t.urgenza}>
                    {formatDate(new Date(t.scadenza))}
                    {d != null && d >= 0 ? ` · ${d} gg` : d != null ? ' · scaduta' : ''}
                  </span>
                ) : (
                  <span className="badge badge-neutral">senza data</span>
                )}
                <select value={t.stato} onChange={(e) => setStato(t.id, e.target.value)} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '4px 8px', fontSize: 13 }}>
                  {Object.entries(STATI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button className="btn btn-sm" onClick={() => remove(t.id)}>✕</button>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
