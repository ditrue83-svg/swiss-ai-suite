-- ============================================================================
-- SwissAI Suite — 0012 TRADUZIONI DEL CATALOGO INCENTIVI
--
-- L'interfaccia è trilingue dal 2026-07, ma i CONTENUTI dei programmi no: nomi,
-- requisiti, descrizione del contributo e finestra di domanda vivono in questa
-- tabella e venivano mostrati in italiano anche in tedesco e francese. Per una
-- PMI germanofona o romanda è il testo che conta davvero — i requisiti da
-- soddisfare — a restare in una lingua che non è la sua.
--
-- Perché QUI e non nei dizionari `src/i18n/`: il catalogo è un DATO, aggiornabile
-- senza un deploy. Spostare i suoi testi nel codice avrebbe legato ogni
-- correzione di un requisito a una nuova pubblicazione dell'applicazione.
--
-- Struttura: una sola colonna JSONB, niente tabella separata né una colonna per
-- lingua. Le join non servono (si legge sempre l'intero programma) e aggiungere
-- una lingua non richiede una migrazione.
--
--   {
--     "de": {
--       "name": "...", "authority": "...", "contribution_description": "...",
--       "application_window": "...", "must_apply_before_start_text": "...",
--       "source_title": "...", "availability_note": "...",
--       "documents_required": ["...", "..."],
--       "requirements": { "<id>": { "text": "...", "question": "..." } },
--       "exclusions":   { "<id>": { "text": "...", "question": "..." } }
--     },
--     "fr": { ... }
--   }
--
-- Requisiti ed esclusioni sono indicizzati per ID, non per posizione: se un
-- domani se ne aggiunge uno o cambia l'ordine, le traduzioni restano agganciate
-- a ciò che traducono invece di scivolare sulla voce sbagliata.
--
-- Cosa NON viene tradotto, di proposito: le sigle e le denominazioni ufficiali
-- (LInn, FER, L-Rilocc, ProKilowatt, Innosuisse, Pronovo) e gli URL delle fonti.
-- Dove una denominazione ufficiale esiste già nelle tre lingue si usa quella —
-- "Il Programma Edifici" è "Das Gebäudeprogramm", non una traduzione letterale.
--
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

alter table public.subsidy_programs
  add column if not exists translations jsonb not null default '{}'::jsonb;

comment on column public.subsidy_programs.translations is
  'Traduzioni dei contenuti per lingua ("de", "fr"); l''italiano resta nelle colonne base. Requisiti ed esclusioni sono indicizzati per id, non per posizione. Una lingua assente o un campo mancante ricadono sull''italiano, e l''app lo DICHIARA invece di far passare il testo per tradotto.';
