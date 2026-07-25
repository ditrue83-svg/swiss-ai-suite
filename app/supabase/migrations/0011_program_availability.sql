-- ============================================================================
-- SwissAI Suite — 0011 DISPONIBILITÀ DEI PROGRAMMI
--
-- Il problema che chiude. Un programma di incentivo può esistere, essere
-- documentato e corretto in ogni suo dettaglio, e ciononostante NON essere
-- ottenibile: la legge lo subordina a una condizione che oggi non ricorre.
--
-- È il caso dell'incentivo ticinese all'assunzione di disoccupati (L-rilocc,
-- RL 857.100): l'art. 3 lo attiva solo se il tasso di disoccupazione medio
-- dell'anno civile precedente raggiunge il tasso di riferimento fissato dal
-- Consiglio di Stato, con massimale del 4%. Il tasso ticinese è oggi intorno al
-- 2,4–3%, e il Cantone dichiara la misura sospesa.
--
-- Finora il catalogo aveva solo `active` (booleano) e `data_status`
-- (verified/recheck/demo). Nessuno dei due esprime «esiste ma non è
-- concedibile»: spegnere `active` lo fa sparire — l'utente non sa che esiste e
-- che potrebbe tornare — mentre lasciarlo attivo lo presenta come disponibile,
-- che è un dato falso. Un requisito "soft" non è la sede giusta: la condizione
-- non riguarda l'azienda e l'imprenditore non può valutarla.
--
-- Da qui una terza informazione, separata dalle altre due: la DISPONIBILITÀ,
-- con il motivo e la fonte che lo attesta, così l'app può dire «questo esiste,
-- ecco cos'è, oggi non è ottenibile e questo è il perché» invece di tacere o
-- di promettere.
--
-- ORDINE: applicare PRIMA di deployare il codice che la accompagna, poi
-- rieseguire il seed del catalogo (`npm run subsidy:seed -- --write`).
--
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

alter table public.subsidy_programs
  add column if not exists availability text not null default 'available';

-- Il vincolo è ricreato ogni volta per restare idempotente senza dipendere
-- dall'esistenza pregressa (non esiste `add constraint if not exists`).
alter table public.subsidy_programs
  drop constraint if exists subsidy_programs_availability_check;
alter table public.subsidy_programs
  add constraint subsidy_programs_availability_check
  check (availability in ('available', 'suspended'));

-- Perché non è concedibile, in linguaggio comprensibile. In italiano come il
-- resto dei contenuti del catalogo (i testi dei programmi non sono tradotti:
-- lo sono le etichette dell'interfaccia).
alter table public.subsidy_programs
  add column if not exists availability_note text;

-- La fonte che attesta la sospensione. Senza questa, «sospeso» sarebbe
-- un'affermazione dell'app anziché un fatto verificabile: la stessa regola che
-- vale per le analisi documentali vale per il catalogo.
alter table public.subsidy_programs
  add column if not exists availability_source_url text;

-- Quando lo stato è stato verificato l'ultima volta. Distinto da
-- `last_checked_at`, che riguarda il CONTENUTO del programma: il contenuto può
-- restare valido per anni mentre la disponibilità cambia ogni anno, perché
-- dipende da una statistica annuale.
alter table public.subsidy_programs
  add column if not exists availability_checked_at date;

comment on column public.subsidy_programs.availability is
  'available = concedibile; suspended = esiste ed è documentato ma oggi non è ottenibile (condizione di legge non soddisfatta). Diverso da `active`, che nasconde del tutto il programma.';
comment on column public.subsidy_programs.availability_note is
  'Motivo della sospensione, in linguaggio comprensibile. Obbligatorio nei fatti quando availability = suspended: senza motivo, «sospeso» non è verificabile.';
comment on column public.subsidy_programs.availability_source_url is
  'Fonte che attesta lo stato di disponibilità (può differire da official_source_url).';
comment on column public.subsidy_programs.availability_checked_at is
  'Data dell''ultima verifica dello STATO. Distinta da last_checked_at, che riguarda il contenuto del programma.';
