import { useEffect, useState } from 'react'

// Persistenza locale (MVP demo). In produzione: backend con separazione dei
// dati per azienda e controllo degli accessi.
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem('swissai.' + key)
      return raw ? JSON.parse(raw) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('swissai.' + key, JSON.stringify(value))
    } catch {
      // quota piena o storage non disponibile: si continua in memoria
    }
  }, [key, value])
  return [value, setValue]
}
