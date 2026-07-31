# Incentivi — Subsidy AI 2.0 (migrazioni 0032 + 0033 + 0034)

> **Stato al 2026-07-31.** Migrazioni **applicate** e verificate contro il
> database reale; catalogo seminato (7 fonti, 7 programmi, 7 versioni, 39
> criteri, 9 call); `subsidy-worker` **deployata** e su scheduler; schermata
> `/incentivi` **pubblicata** e provata a mano end-to-end sul database vero.
>
> ✅ **Dal 2026-07-31 esiste una suite d'integrazione su database**:
> `npm run test:subsidy`, 91 asserzioni in 12 sezioni contro un database reale.
> Copre le garanzie che vivono nel DATABASE — isolamento, cross-tenant,
> catalogo in sola lettura, append-only delle risposte, la cascata della
> 0033/0034, le guardie di validazione, i timbri, lo storico, le viste — **e il
> MOTORE**: la sezione 11 esegue `runMatching`, la stessa funzione che
> `subsidy-worker` chiama in produzione, e verifica che da un progetto nascano
> le opportunità giuste, che la seconda passata non riscriva niente, che
> l'azienda accanto non venga toccata e che un progetto archiviato esca dalla
> coda.
>
> ⚠️ **Ciò che NON esercita, e va detto:** l'involucro HTTP della Edge Function
> (segreto, budget di 150 secondi, rapporto) e `runSourceChecks`, che esce in
> rete verso sette siti ufficiali. L'end-to-end completo dall'interfaccia
> (progetto → opportunità → pratica → checklist → stato) resta quello eseguito
> **a mano**, una volta, e poi ripulito.

⚠️ **Questo documento è nato il 2026-07-31 e colma un buco: il modulo più
grande del repository — 3885 righe di SQL, 17 tabelle, 26 enum, 37 funzioni,
34 trigger — era l'unico senza documento autorevole.** `docs:check` non poteva
accorgersene, perché verifica che ogni file di `docs/` sia raggiungibile, non
che ogni modulo abbia un file.

---

## 1. Che cosa è, e perché convive con Subsidy AI 1.0

Il **1.0** (`/subsidy`, migrazioni 0003/0007/0011/0012) fa una cosa: dato un
profilo, propone programmi da un catalogo statico. Il **2.0** (`/incentivi`)
parte dal **progetto** e produce **sei misure separate** — rilevanza, idoneità,
completezza dei dati, tempistica, freschezza della fonte, prontezza — che non si
riducono a un punteggio, perché un punteggio unico nasconde quale delle sei
manca.

⚠️ **Le due schermate coesistono di proposito, e `/subsidy` NON reindirizza.**
Il 2.0 non copre ancora il profilo incentivi né l'interpretazione AI della
descrizione del progetto: togliere il 1.0 prima di aver dato l'equivalente
farebbe sparire lavoro senza che nessuno se ne accorga. La voce di menu punta
a `/incentivi`.

## 2. Le quattro schede

| Scheda | `?scheda=` | Risponde a |
|---|---|---|
| Opportunità | `opportunita` | la risposta: che cosa potrebbe valere la pena |
| Progetti | `progetti` | la domanda: che cosa l'impresa vuole fare |
| Pratiche | `pratiche` | il lavoro: che cosa è aperto e a che punto è |
| Catalogo | `catalogo` | la provenienza: da dove viene ciò che si legge |

La scheda viaggia in `?scheda=`, non nel percorso: `/incentivi/pratiche`
colliderebbe con un futuro `/incentivi/:id`. I nomi nell'indirizzo sono in
italiano come in Documenti, Finanze, Contratti e Clienti — un collegamento
incollato in una email deve leggersi allo stesso modo in tutti i moduli.

## 3. Le decisioni da non rimettere in discussione senza motivo

- **Non esiste lo stato `eligible`.** Il massimo è `potentially_eligible`:
  l'idoneità la decide l'ente, non noi.
- **Le sei misure sono sei colonne, non un punteggio.**
- **La freschezza ha soglie per TIPO di dato**, non una sola.
- **Nessun crawler generico**: allowlist, guardia SSRF, host validato a ogni
  redirect.
- **Nessun cambiamento critico entra da solo**: finisce in
  `subsidy_catalog_reviews` e aspetta una persona.
- **`subsidy_matches` resta legacy in sola lettura**: quelle righe non hanno né
  progetto né versione, e inventarli produrrebbe un dato falso.

## 4. Messa in opera

1. applicare `0032_subsidy_ai_2.sql`, poi `0033` e `0034`
   (⚠️ le ultime due chiudono un difetto della 0032 che rendeva
   **incancellabile** un'azienda con anche una sola riga in `subsidy_answers`);
2. secret `SUBSIDY_WORKER_SECRET`;
3. `npx supabase functions deploy subsidy-worker --project-ref <ref> --no-verify-jwt`
   (prima: `export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w)`);
4. seminare il catalogo: `npm run subsidy:seed-catalog -- --write`;
5. il job pg_cron. ⚠️ **Fino al 2026-07-31 non era scritto in nessun file del
   repository**: esisteva solo nel progetto Supabase, quindi rifacendo il
   database non sarebbe tornato. Il blocco qui sotto è quello **in esercizio**,
   riletto da `cron.job`:

```sql
select vault.create_secret('<SUBSIDY_WORKER_SECRET>', 'subsidy_worker_secret');

select cron.schedule(
  'subsidy-worker',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://<ref>.supabase.co/functions/v1/subsidy-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-subsidy-worker-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'subsidy_worker_secret')
    ),
    body    := '{}'::jsonb,
    -- La trappola dei 5 secondi di pg_net: senza, ogni esecuzione fallisce.
    timeout_milliseconds := 150000
  );
  $$
);
```

⚠️ **La schermata può chiamare `subsidy-worker` anche a mano**
(`src/services/incentivesService.ts`): lo scheduler serve a rivalutare i
progetti attivi e a rileggere le fonti, non a far funzionare il modulo.

## 5. Test

```bash
npm run test:subsidy-unit    # 277 asserzioni offline, 16 sezioni
npm run test:subsidy         # 91 asserzioni su DATABASE REALE, 12 sezioni (il MOTORE compreso)
npm run subsidy:health       # integrità e freschezza del catalogo 1.0
```

`test:subsidy-unit` non è un test di funzioni pure soltanto: **legge l'SQL**
e verifica che gli elenchi scritti due volte coincidano (sezione 1), che le
sette viste di `list_subsidy_opportunities` esistano davvero (sezione 14), che
i trigger sopravvivano alla cascata (sezione 15) e che la **Panoramica legga lo
stesso motore** del modulo invece di ricontare per conto suo (sezione 16).

`test:subsidy` prova le stesse garanzie **in vigore**, che è una cosa diversa
da «scritte nel file»: la sezione 5 cancella un progetto che ha una risposta
collegata e verifica che la cascata passi (0034) *mentre* la cancellazione
diretta resta vietata, e la sezione 12 fa lo stesso con l'azienda (0033) —
cioè riproduce, dal lato giusto, il difetto che rendeva un'azienda
**indistruttibile** e che nessun test poteva vedere prima, perché nessun test
cancellava un'azienda che avesse risposto a un criterio.
⚠️ L'elenco delle tabelle su cui la cascata viene verificata **si legge dalle
migrazioni**, non è scritto a mano: una tabella aggiunta domani entra da sé.
Una lista a mano non fallisce quando l'insieme cresce — smette di guardare e
resta verde.

## 6. Limiti dichiarati

- **L'involucro della Edge Function non è coperto**: `test:subsidy` esegue
  `runMatching`, cioè il motore vero, ma non il `Deno.serve` che lo avvolge —
  il controllo del segreto, il budget di 150 secondi, il rapporto. Nemmeno
  `runSourceChecks` è coperto: esce in rete verso sette siti ufficiali, e una
  suite che dipende da loro sarebbe rossa il giorno in cui uno cambia pagina.
- **I contenuti del catalogo sono in italiano** anche con interfaccia tedesca o
  francese: vivono nel database, non nei dizionari.
- **Divergenza nota e NON corretta di proposito**: il catalogo dice che la RUE
  di Pronovo riguarda impianti ≥150 kW senza consumo proprio; la pagina
  ufficiale letta il 2026-07-30 indica 2–149,99 kW. Correggerla su una lettura
  automatica sarebbe esattamente ciò che questo modulo vieta: resta un criterio
  `informative`/`manual` con la divergenza nelle note, **da verificare a mano**.
- **Le scadenze delle call Innosuisse sono DERIVATE** dalla regola delle sei
  settimane pubblicata, non lette come date esplicite. La nota lo dice.
- **Sette revisioni del catalogo sono in attesa di una persona**
  (`subsidy_catalog_reviews`): è lavoro in coda, non un residuo.
- **Non ancora fatti**: strumenti dell'assistente sugli incentivi, health-check
  2.0, valutazioni (`eval`) del modulo.
