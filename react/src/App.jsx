import { useState } from 'react'
import { usePersistentState } from './lib/store.js'
import Home from './pages/Home.jsx'
import AdminAI from './pages/AdminAI.jsx'
import SubsidyAI from './pages/SubsidyAI.jsx'
import Deadlines from './pages/Deadlines.jsx'
import Archive from './pages/Archive.jsx'
import Pricing from './pages/Pricing.jsx'

const NAV = [
  { section: 'Piattaforma' },
  { id: 'home', label: 'Panoramica', icon: '⌂' },
  { id: 'deadlines', label: 'Scadenziario', icon: '🗓' },
  { section: 'Moduli' },
  { id: 'admin', label: 'Admin AI — Documenti', icon: '📄' },
  { id: 'subsidy', label: 'Subsidy AI — Incentivi', icon: '💰' },
  { id: 'archive', label: 'Archivio documenti', icon: '🗂' },
  { section: 'Account' },
  { id: 'pricing', label: 'Piani e prezzi', icon: '🏷' },
]

export default function App() {
  const [page, setPage] = useState('home')
  const [docs, setDocs] = usePersistentState('docs', [])
  const [tasks, setTasks] = usePersistentState('tasks', [])
  const [profile, setProfile] = usePersistentState('profile', null)
  const [toast, setToast] = useState(null)

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const addTask = (task) => {
    setTasks((prev) => [...prev, { id: 'task-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), stato: 'da_fare', ...task }])
    showToast('Scadenza aggiunta allo scadenziario')
  }

  const pageProps = { setPage, docs, setDocs, tasks, setTasks, addTask, profile, setProfile, showToast }

  return (
    <>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">+</div>
          <div>
            <div className="brand-name">SwissAI Suite</div>
            <div className="brand-sub">per le PMI svizzere</div>
          </div>
        </div>
        {NAV.map((item, i) =>
          item.section ? (
            <div key={i} className="nav-section">{item.section}</div>
          ) : (
            <button
              key={item.id}
              className={'nav-btn' + (page === item.id ? ' active' : '')}
              onClick={() => setPage(item.id)}
            >
              <span className="nav-icon">{item.icon}</span> {item.label}
            </button>
          )
        )}
        <div className="sidebar-footer">
          Demo MVP · Dati salvati solo in locale.<br />
          Non costituisce consulenza legale o fiscale.
        </div>
      </aside>

      <main className="main">
        {page === 'home' && <Home {...pageProps} />}
        {page === 'admin' && <AdminAI {...pageProps} />}
        {page === 'subsidy' && <SubsidyAI {...pageProps} />}
        {page === 'deadlines' && <Deadlines {...pageProps} />}
        {page === 'archive' && <Archive {...pageProps} />}
        {page === 'pricing' && <Pricing {...pageProps} />}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
