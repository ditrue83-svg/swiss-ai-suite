import { useRef, useState } from 'react'
import { analyzeDocument, formatDate, SAMPLE_DOCUMENTS } from '../engine/adminEngine.js'

async function extractPdfText(file) {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const buf = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: buf }).promise
  let text = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    text += content.items.map((it) => it.str).join(' ') + '\n'
  }
  return text
}

export default function AdminAI({ docs, setDocs, addTask, showToast }) {
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const runAnalysis = (inputText, inputTitle) => {
    const analysis = analyzeDocument(inputText, { title: inputTitle || undefined })
    setResult(analysis)
    setDocs((prev) => [...prev, analysis])
    showToast('Documento analizzato e salvato in archivio')
  }

  const onAnalyze = () => {
    setError(null)
    if (text.trim().length < 40) {
      setError('Inserisci il testo completo della comunicazione (almeno qualche riga).')
      return
    }
    runAnalysis(text, title)
  }

  const onFile = async (file) => {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      let content = ''
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        content = await extractPdfText(file)
        if (content.trim().length < 40) {
          throw new Error('Il PDF non contiene testo estraibile (probabile scansione). Nel MVP demo incolla il testo manualmente; l\'OCR è in roadmap.')
        }
      } else if (file.type.startsWith('image/')) {
        throw new Error('OCR delle immagini in roadmap: nel MVP demo incolla il testo della lettera.')
      } else {
        content = await file.text()
      }
      setText(content)
      setTitle(file.name.replace(/\.[^.]+$/, ''))
      runAnalysis(content, file.name.replace(/\.[^.]+$/, ''))
    } catch (e) {
      setError(e.message || 'Impossibile leggere il file.')
    } finally {
      setBusy(false)
    }
  }

  const loadSample = (s) => {
    setText(s.text)
    setTitle(s.title)
    setError(null)
    runAnalysis(s.text, s.title)
  }

  const toggleCheck = (itemId) => {
    setResult((prev) => {
      const next = {
        ...prev,
        checklist: prev.checklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c)),
      }
      setDocs((docsPrev) => docsPrev.map((d) => (d.id === next.id ? next : d)))
      return next
    })
  }

  const createDeadline = () => {
    addTask({
      titolo: result.title,
      ente: result.ente,
      scadenza: result.scadenza,
      urgenza: result.urgenza,
      docId: result.id,
    })
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">Swiss Admin AI</div>
        <div className="page-desc">
          Carica un PDF, incolla un'email o una lettera: il sistema identifica ente, lingua,
          scadenze e genera checklist e bozza di risposta.
        </div>
      </div>

      <div className="card">
        <div className="card-title">1 · Documento da analizzare</div>
        <div
          className="upload-zone"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]) }}
        >
          {busy ? 'Estrazione del testo in corso…' : 'Trascina qui un PDF o un file di testo, oppure clicca per selezionarlo'}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md,.eml,text/plain,application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => onFile(e.target.files[0])}
          />
        </div>

        <div className="field" style={{ marginTop: 16 }}>
          <label>Oppure incolla il testo della comunicazione</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Incolla qui il contenuto della lettera o dell'email…"
          />
        </div>
        <div className="field">
          <label>Titolo (facoltativo)</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Es. Lettera cassa AVS agosto" />
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={onAnalyze} disabled={busy}>Analizza documento</button>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>Prova con un esempio:</span>
          {SAMPLE_DOCUMENTS.map((s) => (
            <button key={s.id} className="btn btn-sm" onClick={() => loadSample(s)}>{s.label}</button>
          ))}
        </div>
        {error && <div className="info-box" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {result && (
        <div className="card" id="analysis-result">
          <div className="card-title">
            2 · Risultato dell'analisi
            <span className={'badge badge-' + result.urgenza}>urgenza {result.urgenza}</span>
            <span className="badge badge-neutral">confidenza {result.confidenza}</span>
          </div>

          {result.confidenza === 'bassa' && (
            <div className="info-box" style={{ marginBottom: 12 }}>
              L'analisi automatica ha una confidenza bassa: verifica manualmente il documento
              prima di agire.
            </div>
          )}

          <div className="result-row">
            <div className="result-label">In breve</div>
            <div>{result.inBreve}</div>
          </div>
          <div className="result-row">
            <div className="result-label">Ente mittente</div>
            <div>
              {result.ente}
              <span className="badge badge-neutral" style={{ marginLeft: 8 }}>{result.enteCategoria}</span>
              {result.enteIncerto && <span className="badge badge-media" style={{ marginLeft: 6 }}>da verificare</span>}
            </div>
          </div>
          <div className="result-row">
            <div className="result-label">Lingua</div>
            <div>{result.linguaLabel}</div>
          </div>
          <div className="result-row">
            <div className="result-label">Tipo di documento</div>
            <div>{result.tipoLabel}</div>
          </div>
          {result.importo && (
            <div className="result-row">
              <div className="result-label">Importo</div>
              <div>{result.importo}</div>
            </div>
          )}
          <div className="result-row">
            <div className="result-label">Scadenza</div>
            <div>
              {result.scadenza ? (
                <>
                  <strong>{formatDate(new Date(result.scadenza))}</strong>
                  {result.giorniAllaScadenza != null && result.giorniAllaScadenza >= 0 && (
                    <span style={{ color: 'var(--muted)' }}> · tra {result.giorniAllaScadenza} giorni</span>
                  )}
                  <button className="btn btn-sm" style={{ marginLeft: 12 }} onClick={createDeadline}>
                    + Crea scadenza
                  </button>
                </>
              ) : (
                'Nessuna scadenza esplicita individuata — verifica manuale consigliata.'
              )}
            </div>
          </div>
          <div className="result-row">
            <div className="result-label">Cosa devi fare</div>
            <div>
              {result.checklist.map((c) => (
                <label className={'checklist-item' + (c.done ? ' done' : '')} key={c.id}>
                  <input type="checkbox" checked={c.done} onChange={() => toggleCheck(c.id)} />
                  <span>{c.text}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="result-row">
            <div className="result-label">Documenti richiesti</div>
            <div>
              {result.documentiRichiesti.length > 0 ? (
                <ul className="detail-list">
                  {result.documentiRichiesti.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              ) : (
                <span style={{ color: 'var(--muted)' }}>Nessun documento specifico individuato nel testo.</span>
              )}
            </div>
          </div>
          <div className="result-row">
            <div className="result-label">Rischio se non agisci</div>
            <div>
              {result.rischio || (
                <span style={{ color: 'var(--muted)' }}>
                  Non determinabile con sufficiente certezza — da verificare con l'ente.
                </span>
              )}
            </div>
          </div>
          <div className="result-row">
            <div className="result-label">Bozza di risposta ({result.linguaLabel})</div>
            <div>
              <div className="draft-box">{result.bozzaRisposta}</div>
              <button
                className="btn btn-sm"
                style={{ marginTop: 8 }}
                onClick={() => { navigator.clipboard?.writeText(result.bozzaRisposta); showToast('Bozza copiata negli appunti') }}
              >
                Copia bozza
              </button>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 10 }}>
                Bozza generata automaticamente: rileggi e adatta prima dell'invio.
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
