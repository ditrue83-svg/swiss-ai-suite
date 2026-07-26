-- ============================================================================
-- AI-Swisse — 0015 INBOX: lo stato «analisi in coda»
--
-- COSA HA MOSTRATO IL PRIMO COLLEGAMENTO REALE (2026-07-26)
-- L'import iniziale di una casella vera ha promosso 14 messaggi a
-- `likely_actionable` in pochi secondi e ha lanciato per ciascuno l'analisi
-- documentale completa. Il limite di quota AI — 12 al minuto per azienda — è
-- stato superato al quarto, e i restanti 14 sono finiti in `failed` con
-- `PROVIDER_RATE_LIMITED`.
--
-- Il risultato era che «Da gestire», la lista più importante del prodotto, si
-- presentava piena di «Esame non riuscito». Non un guasto: una taratura
-- sbagliata. Quel limite protegge dall'utente che carica documenti a mano, ma
-- l'import iniziale non è un utente — è un processo che promuove decine di
-- messaggi tutti insieme. Il limite pensato per proteggere è diventato la causa.
--
-- PERCHÉ SERVE UNO STATO NUOVO E NON BASTA RITENTARE
-- La correzione è scaglionare: durante l'import iniziale si classifica (costa
-- poco) e si RINVIA l'analisi documentale, che verrà smaltita a lotti dalla
-- manutenzione periodica. Ma un messaggio classificato e in attesa di analisi
-- non è né `pending` (non ancora esaminato) né `done` (esaminato) né `failed`
-- (qualcosa è andato storto). È uno stato suo, e senza un nome proprio
-- finirebbe per essere rappresentato da uno degli altri tre — cioè da una
-- descrizione falsa. È la stessa ragione per cui la 0013 tiene separati lo
-- stato della macchina e quello della persona.
--
-- ⚠️ IL VINCOLO CHE HA ROTTO LA PRIMA STESURA DI QUESTA MIGRAZIONE
-- `alter type … add value` si può eseguire dentro una transazione, ma
-- l'etichetta aggiunta NON è utilizzabile finché quella transazione non è
-- chiusa (Postgres, 55P04 «unsafe use of new value»). Il SQL editor di Supabase
-- esegue l'intero script in un'unica transazione, quindi qualunque riga più
-- sotto che nomini 'awaiting_analysis' fa fallire tutto.
--
-- La prima stesura creava un indice parziale con
--   where processing_status = 'awaiting_analysis'
-- e falliva esattamente lì. Spezzare in due migrazioni NON avrebbe risolto:
-- `supabase/full-setup.sql` concatena tutte le migrazioni in un solo script, e
-- un'installazione da zero sarebbe fallita allo stesso punto — un guasto che si
-- sarebbe visto solo al primo cliente nuovo.
--
-- Quindi: in questo file l'etichetta nuova NON compare più da nessuna parte
-- oltre alla riga che la crea. L'indice qui sotto usa `relevance`, il cui
-- valore esiste dalla 0013, e tiene `processing_status` come COLONNA indicizzata
-- invece che come confronto con l'etichetta. Copre la stessa interrogazione —
-- «i messaggi azionabili di questa connessione, in ordine di data» — che è ciò
-- che lo smaltimento della coda esegue.
--
-- Regola generale: in una migrazione che aggiunge un valore a un enum, quel
-- valore non può comparire in nessun'altra istruzione dello stesso file.
--
-- Idempotente.
-- ============================================================================

alter type public.email_processing_status add value if not exists 'awaiting_analysis';

comment on type public.email_processing_status is
  'Stato della pipeline su un messaggio. «awaiting_analysis» = classificato come azionabile, analisi documentale rinviata a un lotto successivo: non è un errore e non è un lavoro concluso.';

-- Selezione dei lotti da smaltire. Il predicato usa solo valori enum esistenti
-- dalla 0013; `processing_status` è una colonna dell'indice, non un confronto.
create index if not exists idx_email_msg_actionable
  on public.email_messages (connection_id, processing_status, received_at desc)
  where relevance = 'likely_actionable';
