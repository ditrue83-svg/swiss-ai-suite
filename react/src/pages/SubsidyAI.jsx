import { useMemo, useState } from 'react'
import { CANTONI, FASCE_FATTURATO, FORME_GIURIDICHE, SETTORI, TIPI_PROGETTO } from '../engine/subsidyData.js'
import { evaluateEligibility, interpretProjectDescription, matchPrograms } from '../engine/subsidyEngine.js'

const EMPTY_PROFILE = {
  ragioneSociale: '', idi: '', cantone: 'Ticino', comune: '', formaGiuridica: 'Sagl',
  settore: '', dipendenti: '', fatturato: 'Preferisco non indicare',
  immobili: false, veicoli: false, progetti: [], descrizione: '',
}

export default function SubsidyAI({ profile, setProfile, addTask, showToast }) {
  const [form, setForm] = useState(profile || EMPTY_PROFILE)
  const [step, setStep] = useState(profile ? 'results' : 'profile')
  const [selected, setSelected] = useState(null)
  const [answers, setAnswers] = useState({})
  const [verdict, setVerdict] = useState(null)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const toggleProgetto = (id) =>
    set('progetti', form.progetti.includes(id) ? form.progetti.filter((p) => p !== id) : [...form.progetti, id])

  const suggested = useMemo(() => interpretProjectDescription(form.descrizione), [form.descrizione])
  const newSuggestions = suggested.filter((s) => !form.progetti.includes(s))

  const onSearch = () => {
    const finalForm = { ...form }
    // L'interpretazione della descrizione integra le categorie selezionate.
    for (const s of suggested) if (!finalForm.progetti.includes(s)) finalForm.progetti = [...finalForm.progetti, s]
    if (finalForm.progetti.length === 0) {
      showToast('Indica almeno un tipo di progetto o descrivi il progetto previsto')
      return
    }
    setForm(finalForm)
    setProfile(finalForm)
    setStep('results')
    setSelected(null)
    setVerdict(null)
  }

  const matches = useMemo(() => (step === 'results' ? matchPrograms(form) : []), [step, form])

  const openProgram = (m) => {
    setSelected(m)
    setAnswers({})
    setVerdict(null)
  }

  const answer = (qid, val) => setAnswers((a) => ({ ...a, [qid]: val }))

  const runEligibility = () => {
    setVerdict(evaluateEligibility(selected.program, answers))
  }

  const addProgramDeadline = (p) => {
    addTask({
      titolo: 'Candidatura: ' + p.programma,
      ente: p.ente,
      scadenza: null,
      nota: p.scadenza,
      urgenza: p.avvisoPrima ? 'alta' : 'media',
    })
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">Swiss Subsidy AI</div>
        <div className="page-desc">
          Profilo aziendale → matching con programmi federali e cantonali → verifica di idoneità
          guidata. Copertura demo: Confederazione + Cantone Ticino.
        </div>
      </div>

      <div className="tabs">
        <button className={'tab' + (step === 'profile' ? ' active' : '')} onClick={() => setStep('profile')}>
          1 · Profilo impresa
        </button>
        <button className={'tab' + (step === 'results' ? ' active' : '')} onClick={() => form.progetti.length > 0 || suggested.length > 0 ? onSearch() : showToast('Completa prima il profilo')}>
          2 · Incentivi compatibili
        </button>
      </div>

      {step === 'profile' && (
        <div className="card">
          <div className="card-title">Profilo aziendale</div>
          <div className="grid-2">
            <div className="field">
              <label>Ragione sociale</label>
              <input value={form.ragioneSociale} onChange={(e) => set('ragioneSociale', e.target.value)} placeholder="Es. Rossi Impianti Sagl" />
            </div>
            <div className="field">
              <label>Numero IDI / CHE</label>
              <input value={form.idi} onChange={(e) => set('idi', e.target.value)} placeholder="CHE-123.456.789" />
            </div>
            <div className="field">
              <label>Cantone</label>
              <select value={form.cantone} onChange={(e) => set('cantone', e.target.value)}>
                {CANTONI.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Comune</label>
              <input value={form.comune} onChange={(e) => set('comune', e.target.value)} placeholder="Es. Lugano" />
            </div>
            <div className="field">
              <label>Forma giuridica</label>
              <select value={form.formaGiuridica} onChange={(e) => set('formaGiuridica', e.target.value)}>
                {FORME_GIURIDICHE.map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Settore (NOGA semplificato)</label>
              <select value={form.settore} onChange={(e) => set('settore', e.target.value)}>
                <option value="">— Seleziona —</option>
                {SETTORI.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Numero di dipendenti</label>
              <input type="number" min="0" value={form.dipendenti} onChange={(e) => set('dipendenti', e.target.value)} placeholder="Es. 12" />
            </div>
            <div className="field">
              <label>Fascia di fatturato</label>
              <select value={form.fatturato} onChange={(e) => set('fatturato', e.target.value)}>
                {FASCE_FATTURATO.map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
          </div>

          <div className="field">
            <label>Situazione</label>
            <div className="checks">
              <span className={'check-pill' + (form.immobili ? ' on' : '')} onClick={() => set('immobili', !form.immobili)}>
                Possiede o utilizza immobili
              </span>
              <span className={'check-pill' + (form.veicoli ? ' on' : '')} onClick={() => set('veicoli', !form.veicoli)}>
                Ha veicoli aziendali
              </span>
            </div>
          </div>

          <div className="field">
            <label>Progetti e investimenti previsti</label>
            <div className="checks">
              {TIPI_PROGETTO.map((t) => (
                <span
                  key={t.id}
                  className={'check-pill' + (form.progetti.includes(t.id) ? ' on' : '')}
                  onClick={() => toggleProgetto(t.id)}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Descrivi il progetto con parole tue (l'AI lo interpreta)</label>
            <textarea
              value={form.descrizione}
              onChange={(e) => set('descrizione', e.target.value)}
              placeholder="Es. Vogliamo installare un impianto fotovoltaico sul tetto del capannone e sostituire due furgoni diesel con veicoli elettrici…"
              style={{ minHeight: 90 }}
            />
            {newSuggestions.length > 0 && (
              <div style={{ fontSize: 13, color: 'var(--blue)' }}>
                Dalla descrizione il sistema riconosce anche:{' '}
                {newSuggestions.map((s) => TIPI_PROGETTO.find((t) => t.id === s)?.label || s).join(', ')} — verranno inclusi nella ricerca.
              </div>
            )}
          </div>

          <button className="btn btn-primary" onClick={onSearch}>Trova incentivi compatibili</button>
        </div>
      )}

      {step === 'results' && !selected && (
        <>
          <div className="demo-banner">
            {matches.length} programmi potenzialmente compatibili per{' '}
            <strong>{form.ragioneSociale || 'la tua impresa'}</strong> ({form.cantone}
            {form.settore ? ', ' + (SETTORI.find((s) => s.id === form.settore)?.label || form.settore) : ''}).
            Ordinati per compatibilità stimata.{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); setStep('profile') }}>Modifica profilo</a>
          </div>
          {matches.length === 0 && (
            <div className="card"><div className="empty">Nessun programma compatibile trovato con i criteri attuali. Prova ad ampliare i tipi di progetto nel profilo.</div></div>
          )}
          {matches.map((m) => (
            <div className="card" key={m.program.id}>
              <div className="match-head">
                <div className={'match-score ' + (m.score >= 75 ? 'hi' : m.score >= 55 ? 'mid' : '')}>{m.score}%</div>
                <div style={{ flex: 1 }}>
                  <div className="list-title" style={{ fontSize: 16 }}>{m.program.programma}</div>
                  <div className="list-sub">
                    {m.program.ente} · {m.program.contributo}
                  </div>
                  <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span className="badge badge-neutral">confidenza {m.confidence}</span>
                    {m.program.avvisoPrima && <span className="badge badge-alta">⚠ domanda prima di agire</span>}
                    <span className="badge badge-blue">{m.program.scadenza}</span>
                  </div>
                </div>
                <button className="btn btn-sm" onClick={() => openProgram(m)}>Apri scheda →</button>
              </div>
            </div>
          ))}
        </>
      )}

      {step === 'results' && selected && (
        <>
          <button className="btn btn-sm" style={{ marginBottom: 14 }} onClick={() => setSelected(null)}>← Torna ai risultati</button>

          <div className="card">
            <div className="card-title" style={{ fontSize: 18 }}>{selected.program.programma}</div>
            {selected.program.avvisoPrima && (
              <div className="warn-box" style={{ marginBottom: 14 }}>
                <span>⚠️</span>
                <span>{selected.program.avvisoTesto}</span>
              </div>
            )}
            <div className="result-row">
              <div className="result-label">Ente</div>
              <div>{selected.program.ente}</div>
            </div>
            <div className="result-row">
              <div className="result-label">Compatibilità</div>
              <div>
                <strong>{selected.score}%</strong>
                <span className="badge badge-neutral" style={{ marginLeft: 8 }}>confidenza {selected.confidence}</span>
              </div>
            </div>
            <div className="result-row">
              <div className="result-label">Contributo</div>
              <div>{selected.program.contributo}</div>
            </div>
            <div className="result-row">
              <div className="result-label">Perché è pertinente</div>
              <div><ul className="detail-list ok">{selected.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
            </div>
            <div className="result-row">
              <div className="result-label">Requisiti da verificare</div>
              <div><ul className="detail-list warn">{selected.missing.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
            </div>
            <div className="result-row">
              <div className="result-label">Esclusioni</div>
              <div>
                {selected.program.esclusioni.length > 0
                  ? <ul className="detail-list bad">{selected.program.esclusioni.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  : <span style={{ color: 'var(--muted)' }}>Nessuna esclusione specifica indicata.</span>}
              </div>
            </div>
            <div className="result-row">
              <div className="result-label">Scadenza</div>
              <div>
                {selected.program.scadenza}
                <button className="btn btn-sm" style={{ marginLeft: 10 }} onClick={() => addProgramDeadline(selected.program)}>
                  + Aggiungi allo scadenziario
                </button>
              </div>
            </div>
            <div className="result-row">
              <div className="result-label">Documenti per la candidatura</div>
              <div><ul className="detail-list">{selected.program.documenti.map((d, i) => <li key={i}>{d}</li>)}</ul></div>
            </div>
            <div className="result-row">
              <div className="result-label">Fonte ufficiale</div>
              <div>
                <a href={selected.program.fonte} target="_blank" rel="noreferrer">{selected.program.fonte}</a>
                <span className="badge badge-neutral" style={{ marginLeft: 8 }}>
                  ultima verifica: {selected.program.dataVerifica}
                </span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Verifica di idoneità guidata</div>
            <p style={{ fontSize: 14, color: 'var(--ink-soft)', marginBottom: 6 }}>
              Rispondi a queste domande per passare da «potrebbe essere interessante» a una
              valutazione operativa. La conferma finale spetta sempre all'ente.
            </p>
            {selected.program.domande.map((q) => (
              <div className="quiz-q" key={q.id}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{q.testo}</div>
                <div className="quiz-opts">
                  {[['si', 'Sì'], ['no', 'No'], ['ns', 'Non so']].map(([val, label]) => (
                    <button
                      key={val}
                      className={'quiz-opt' + (answers[q.id] === val ? ' sel-' + val : '')}
                      onClick={() => answer(q.id, val)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={runEligibility}>
              Calcola idoneità
            </button>

            {verdict && (
              <div style={{ marginTop: 18 }}>
                <div className="card-title">
                  Esito:
                  <span className={'badge badge-' + (verdict.idoneita === 'alta' ? 'bassa' : verdict.idoneita === 'media' ? 'media' : 'alta')}>
                    idoneità {verdict.idoneita}
                  </span>
                  <span className="badge badge-neutral">confidenza {verdict.confidence}</span>
                </div>
                {verdict.satisfied.length > 0 && (
                  <div className="result-row">
                    <div className="result-label">Requisiti soddisfatti</div>
                    <div><ul className="detail-list ok">{verdict.satisfied.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                  </div>
                )}
                {verdict.failed.length > 0 && (
                  <div className="result-row">
                    <div className="result-label">Requisiti non soddisfatti</div>
                    <div><ul className="detail-list bad">{verdict.failed.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                  </div>
                )}
                {verdict.unknown.length > 0 && (
                  <div className="result-row">
                    <div className="result-label">Ancora da verificare</div>
                    <div><ul className="detail-list warn">{verdict.unknown.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                  </div>
                )}
                <div className="result-row">
                  <div className="result-label">Prossimi passi</div>
                  <div><ul className="detail-list">{verdict.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <div className="footnote">
        Database dimostrativo di programmi (Confederazione + Ticino), con fonte e data di ultima
        verifica per ogni voce. La compatibilità è una stima, non un'idoneità ufficiale:
        importi, requisiti e scadenze vanno confermati sulla fonte ufficiale indicata.
      </div>
    </>
  )
}
