import { useState } from 'react'
import { formatDate } from '../engine/adminEngine.js'

export default function Archive({ docs, setDocs }) {
  const [urgFilter, setUrgFilter] = useState('tutte')
  const [open, setOpen] = useState(null)

  const visible = [...docs]
    .reverse()
    .filter((d) => (urgFilter === 'tutte' ? true : d.urgenza === urgFilter))

  const remove = (id) => {
    setDocs((prev) => prev.filter((d) => d.id !== id))
    if (open?.id === id) setOpen(null)
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">Archivio documenti</div>
        <div className="page-desc">
          Tutti i documenti analizzati, con filtri per urgenza e stato della checklist.
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          Documenti ({visible.length})
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {['tutte', 'alta', 'media', 'bassa'].map((f) => (
              <button key={f} className={'btn btn-sm' + (urgFilter === f ? ' btn-primary' : '')} onClick={() => setUrgFilter(f)}>
                {f}
              </button>
            ))}
          </span>
        </div>
        {visible.length === 0 ? (
          <div className="empty">Nessun documento in archivio. Analizza una comunicazione in Admin AI.</div>
        ) : (
          visible.map((d) => {
            const doneCount = d.checklist.filter((c) => c.done).length
            return (
              <div className="list-row" key={d.id}>
                <div className="list-main">
                  <div className="list-title">{d.title}</div>
                  <div className="list-sub">
                    {d.ente} · {d.tipoLabel} · {d.linguaLabel}
                    {d.scadenza ? ' · scade il ' + formatDate(new Date(d.scadenza)) : ''}
                  </div>
                </div>
                <span className="badge badge-neutral">{doneCount}/{d.checklist.length} azioni</span>
                <span className={'badge badge-' + d.urgenza}>{d.urgenza}</span>
                <button className="btn btn-sm" onClick={() => setOpen(open?.id === d.id ? null : d)}>
                  {open?.id === d.id ? 'Chiudi' : 'Apri'}
                </button>
                <button className="btn btn-sm" onClick={() => remove(d.id)}>✕</button>
              </div>
            )
          })
        )}
      </div>

      {open && (
        <div className="card">
          <div className="card-title">{open.title}</div>
          <div className="result-row">
            <div className="result-label">In breve</div>
            <div>{open.inBreve}</div>
          </div>
          <div className="result-row">
            <div className="result-label">Checklist</div>
            <div>
              {open.checklist.map((c) => (
                <div className={'checklist-item' + (c.done ? ' done' : '')} key={c.id}>
                  <input type="checkbox" checked={c.done} readOnly />
                  <span>{c.text}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="result-row">
            <div className="result-label">Bozza di risposta</div>
            <div className="draft-box">{open.bozzaRisposta}</div>
          </div>
          <div className="result-row">
            <div className="result-label">Testo originale</div>
            <div className="draft-box" style={{ maxHeight: 220, overflow: 'auto' }}>{open.testoOriginale}</div>
          </div>
        </div>
      )}
    </>
  )
}
