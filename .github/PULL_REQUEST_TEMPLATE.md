## Descrizione

<!-- Che cosa cambia e perché. Se chiude una issue, citarla: «Chiude #123». -->

## Tipo di modifica

- [ ] Correzione di un difetto
- [ ] Nuova funzionalità
- [ ] Refactoring (nessun cambiamento di comportamento)
- [ ] Documentazione
- [ ] Manutenzione / tooling / dipendenze

## Checklist

- [ ] `npm run ci` passa in `app/` (e `npm run test:all` se è disponibile `.env.test`)
- [ ] `npm run lint` e `npm run format:check` passano in `app/`
- [ ] Documentazione aggiornata dove il comportamento cambia (README, `app/docs/`, CLAUDE.md)
- [ ] Nessun test nascosto o disattivato: un rosso spiegato è informazione, un rosso nascosto è un difetto in più
- [ ] Nessuna migrazione già applicata è stata modificata (se ne scrive una nuova)
