-- ===========================================================================
-- 0036 — UN INSIEME VUOTO SI PUÒ CITARE
--
-- PERCHÉ. `eval:assistant` era instabile sul caso «Quali automazioni stanno
-- fallendo?», e la causa non era il modello: era che quella domanda è l'unica
-- la cui risposta corretta è «nessuna».
--
-- I riferimenti `f1, f2…` che il modello può scrivere li conia `allocRef()`,
-- un contatore che avanza SOLO quando uno strumento produce una fonte. Ma
-- `emptyResult()` restituiva `sources: []`: un esito legittimamente vuoto non
-- coniava niente, e il registro poteva restare del tutto vuoto. Intanto il
-- prompt dichiara che `f1, f2…` sono «gli UNICI identificativi che puoi
-- scrivere» e chiede di citare il riferimento dell'ELENCO per le affermazioni
-- aggregate. Il modello doveva dire «non c'è nulla» senza avere nulla da
-- citare: a volte scriveva `f1`, il primo nome plausibile, e la guardia delle
-- citazioni lo scartava — correttamente. Il buco era a monte.
--
-- ⚠️ L'ASIMMETRIA È LA PROVA: un elenco NON vuoto alloca sempre un riferimento
-- di gruppo; uno vuoto non allocava niente. Perciò «non c'è nulla» era l'unica
-- risposta che il prodotto strutturalmente non sapeva ancorare, ed è la
-- risposta più importante che un assistente amministrativo debba saper dare.
--
-- CHE COSA CAMBIA QUI. Solo il vincolo. La 0027 ammetteva due forme di
-- citazione — una fonte singola, oppure un gruppo con `group_size > 0` — e la
-- ragione scritta là resta valida: «confonderle produrrebbe pastiglie che non
-- si sa se aprono un record o un elenco». Un insieme vuoto NON è una terza
-- forma ambigua: è un gruppo, apre un elenco, e la sua dimensione è zero.
-- L'unica cosa che il vincolo vietava era proprio dire zero.
--
-- ⚠️ `source_ids` resta OBBLIGATORIO anche a zero, e deve valere `'{}'` e non
-- `null`: la differenza fra «ho guardato e non c'era niente» e «non so che cosa
-- ci fosse» è esattamente ciò che questa citazione esiste per registrare.
--
-- ⚠️ NESSUN valore enum nuovo, nessuna colonna nuova, nessun indice nuovo:
-- niente 55P04, e il file è ripetibile per costruzione (`drop … if exists`).
-- ===========================================================================

alter table public.assistant_citations
  drop constraint if exists assistant_citations_single_or_group;

alter table public.assistant_citations
  add constraint assistant_citations_single_or_group check (
    (source_id is not null and group_size is null)
    or (source_id is null and group_size is not null and group_size >= 0 and source_ids is not null)
  );

comment on column public.assistant_citations.group_size is
  '§57 — citazione aggregata: quanti elementi, con la rotta che apre l''elenco già filtrato. ZERO è ammesso e significa «ho consultato questo insieme ed era vuoto»: è ciò che ancora una risposta negativa. Un insieme non consultato non produce alcuna citazione.';

-- ---------------------------------------------------------------------------
-- Autoverifica.
--
-- ⚠️ Verifica il vincolo REALMENTE INSTALLATO leggendo `pg_constraint`, non la
-- copia dell'espressione scritta qui sopra: un blocco che rileggesse il proprio
-- testo guarderebbe sé stesso e sarebbe verde per costruzione. È la trappola
-- già pagata dal test del registro delle automazioni, che confrontava due
-- costanti dello stesso file TypeScript credendo di confrontarsi con l'enum del
-- database.
--
-- ⚠️ La prova di COMPORTAMENTO — che una riga a zero entri davvero e che le
-- forme vietate restino vietate — non sta qui ma in `npm run test:assistant`,
-- sezione «citazione di un insieme vuoto», dove c'è un'azienda usa-e-getta su
-- cui inserire per davvero. Una `insert` di prova qui dentro avrebbe avuto
-- bisogno di un messaggio e di un'azienda veri, cioè di lasciare residui in
-- produzione per verificare un `check`.
-- ---------------------------------------------------------------------------
do $$
declare
  def text;
begin
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'assistant_citations'
    and c.conname = 'assistant_citations_single_or_group'
    and c.contype = 'c';

  if def is null then
    raise exception '0036: il vincolo assistant_citations_single_or_group non risulta installato';
  end if;

  -- La soglia nuova c'è…
  if position('>= 0' in def) = 0 then
    raise exception '0036: il vincolo non ammette group_size = 0 (definizione: %)', def;
  end if;

  -- …e la vecchia non è rimasta accanto. `> 0` compare come sottostringa anche
  -- dentro `>= 0`, quindi si cerca la forma con lo spazio che solo la vecchia
  -- soglia produce.
  if position('group_size > 0' in def) > 0 then
    raise exception '0036: la vecchia soglia group_size > 0 è ancora nel vincolo (definizione: %)', def;
  end if;

  -- La garanzia che NON si sta allentando: una fonte singola non può portare
  -- una dimensione di gruppo, e un gruppo deve avere i propri identificativi.
  --
  -- ⚠️ I LETTERALI VANNO IN MAIUSCOLO perché il confronto è contro `upper(def)`.
  -- La prima stesura cercava `'source_ids IS NOT NULL'` — minuscolo — dentro una
  -- stringa già alzata a maiuscolo: non poteva combaciare, e la migrazione
  -- falliva su sé stessa. L'ha trovata la CI applicandola da zero, che è l'unico
  -- posto dove questo blocco viene ESEGUITO: in locale non c'è Postgres, quindi
  -- l'autoverifica era scritta e mai provata. `test:assistant-unit` ora sorveglia
  -- che ogni letterale confrontato con `upper()` sia maiuscolo.
  if position('SOURCE_IDS IS NOT NULL' in upper(def)) = 0 then
    raise exception '0036: il vincolo non richiede più source_ids sui gruppi (definizione: %)', def;
  end if;
  if position('SOURCE_ID IS NOT NULL' in upper(def)) = 0 then
    raise exception '0036: il vincolo non distingue più la fonte singola (definizione: %)', def;
  end if;
end $$;
