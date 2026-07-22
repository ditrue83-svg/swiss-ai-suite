// Swiss Subsidy AI — motore di matching: regole strutturate + interpretazione
// della descrizione libera del progetto. L'AI generativa è sostituibile nel
// punto di integrazione interpretProjectDescription().

import { PROGRAMS, PROJECT_KEYWORDS, TIPI_PROGETTO } from './subsidyData.js'

// Interpreta la descrizione libera e suggerisce i tipi di progetto.
export function interpretProjectDescription(text) {
  if (!text) return []
  const t = text.toLowerCase()
  const matches = []
  for (const [tipo, keywords] of Object.entries(PROJECT_KEYWORDS)) {
    const hits = keywords.filter((k) => t.includes(k))
    if (hits.length > 0) matches.push({ tipo, hits: hits.length })
  }
  return matches.sort((a, b) => b.hits - a.hits).map((m) => m.tipo)
}

function labelTipo(id) {
  const t = TIPI_PROGETTO.find((x) => x.id === id)
  return t ? t.label : id
}

// Confronta il profilo con le regole di ogni programma.
// Ritorna [{program, score, confidence, reasons, missing, excluded}]
export function matchPrograms(profile) {
  const results = []
  const progetti = new Set(profile.progetti || [])

  for (const p of PROGRAMS) {
    const reasons = []
    const missing = []
    let score = 0
    let maxScore = 0

    // Area geografica (criterio di esclusione; i programmi cantonali mirati
    // pesano di più di quelli nazionali generici)
    maxScore += 20
    const geoOk = p.area.includes('ALL') || p.area.includes(profile.cantone)
    if (!geoOk) continue
    if (!p.area.includes('ALL')) {
      score += 20
      reasons.push(`Programma dedicato al Cantone ${profile.cantone}`)
    } else {
      score += 16
      reasons.push('Programma disponibile in tutta la Svizzera')
    }

    // Tipo di progetto (criterio principale; premia la copertura completa
    // degli ambiti del programma)
    maxScore += 40
    const tipiMatch = p.tipiProgetto.filter((t) => progetti.has(t))
    if (tipiMatch.length === 0) continue
    score += Math.round(28 + 12 * (tipiMatch.length / p.tipiProgetto.length))
    reasons.push('Progetto compatibile: ' + tipiMatch.map(labelTipo).join(', '))

    // Settore
    maxScore += 20
    if (profile.settore && p.settori.includes(profile.settore)) {
      score += 20
      reasons.push('Settore aziendale espressamente tra quelli ammessi')
    } else if (p.settori.includes('ALL')) {
      score += 16
    } else if (!profile.settore) {
      score += 10
      missing.push('Settore aziendale non indicato nel profilo')
    } else {
      score += 4
      missing.push('Il settore indicato non è tra quelli tipicamente ammessi')
    }

    // Dimensione
    maxScore += 20
    const dip = Number(profile.dipendenti)
    if (!Number.isFinite(dip) || profile.dipendenti === '' || profile.dipendenti == null) {
      score += 10
      missing.push('Numero di dipendenti non indicato')
    } else if (dip >= p.minDipendenti && dip <= p.maxDipendenti) {
      score += 20
      reasons.push('Dimensione aziendale nel target del programma')
    } else {
      missing.push(`Dimensione fuori target (richiesti ${p.minDipendenti}–${p.maxDipendenti === 100000 ? '∞' : p.maxDipendenti} dipendenti)`)
    }

    // Requisiti specifici non verificabili dal profilo → da verificare
    for (const r of p.requisiti) missing.push('Da verificare: ' + r)

    const pct = Math.round((score / maxScore) * 100)
    if (pct < 40) continue

    const knownFields = ['cantone', 'settore', 'dipendenti'].filter((f) => profile[f] !== '' && profile[f] != null).length
    const confidence = knownFields === 3 ? 'alta' : knownFields === 2 ? 'media' : 'bassa'

    results.push({ program: p, score: pct, confidence, reasons, missing })
  }

  return results.sort((a, b) => b.score - a.score)
}

// Valuta le risposte del questionario di idoneità.
export function evaluateEligibility(program, answers) {
  let totalWeight = 0
  let okWeight = 0
  let answered = 0
  const satisfied = []
  const failed = []
  const unknown = []

  for (const q of program.domande) {
    totalWeight += q.peso
    const a = answers[q.id]
    if (a === 'si') {
      okWeight += q.peso
      answered++
      satisfied.push(q.requisito)
    } else if (a === 'no') {
      answered++
      failed.push(q.requisito)
    } else {
      unknown.push(q.requisito)
    }
  }

  const ratio = totalWeight > 0 ? okWeight / totalWeight : 0
  const answeredRatio = program.domande.length > 0 ? answered / program.domande.length : 0

  let idoneita
  if (failed.length > 0 && ratio < 0.5) idoneita = 'bassa'
  else if (ratio >= 0.8 && failed.length === 0) idoneita = 'alta'
  else idoneita = 'media'

  const confidence = answeredRatio === 1 ? 'alta' : answeredRatio >= 0.5 ? 'media' : 'bassa'

  return {
    idoneita,
    confidence,
    satisfied,
    failed,
    unknown,
    nextSteps: [
      ...(failed.length > 0 ? ['Chiarire i requisiti non soddisfatti prima di procedere'] : []),
      ...(unknown.length > 0 ? ['Completare la verifica dei requisiti mancanti'] : []),
      'Consultare la fonte ufficiale per confermare condizioni e importi',
      ...(program.avvisoPrima ? ['NON avviare il progetto/acquisto prima della conferma dell\'ente'] : []),
      'Preparare i documenti richiesti per la candidatura',
    ],
  }
}
