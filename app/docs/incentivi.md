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
- ✅ **La coda di revisione è VUOTA dal 2026-08-05** — e non perché qualcuno
  abbia approvato sette schede, ma perché quelle sette **non erano un
  cambiamento**: vedi § 7. `subsidy:health` esce 0.
  ⚠️ **`last_checked_at` è rimasto al 2026-07-25 per tutti e sette i programmi**:
  chiuderle non è stata una verifica, e la data lo dice. Dal 2026-08-28 la data
  ha però un percorso per ripartire — la scheda `recheck_due` della 0046, § 7 —
  che fino a quel giorno **non esisteva**: a coda vuota la verifica umana
  invecchiava senza rimedio, e `subsidy:health` è uscito 1 per questo.
- **Non ancora fatti**: strumenti dell'assistente sugli incentivi, health-check
  2.0, valutazioni (`eval`) del modulo.

## 7. La revisione del catalogo (0037) — `/incentivi/revisioni`

Il rilevatore di cambiamenti produce una scheda in `subsidy_catalog_reviews`
ogni volta che una fonte ufficiale si muove. Fino al 2026-08-05 quelle schede
non erano guardabili da nessuna parte: **sette erano ferme dal 2026-07-30**.

**Chi può decidere, e perché non è un ruolo.** Il catalogo è **globale** — non ha
`company_id` — e ciò che dice vale per tutti i tenant insieme. `member_role`
(owner/admin/member) è per AZIENDA, quindi non può esprimere «può modificare il
catalogo condiviso»: concedere la lettura a `authenticated` avrebbe significato
che il cliente di un'impresa approva ciò che il prodotto racconta a tutte le
altre. L'autorità è quindi un elenco esplicito, `subsidy_catalog_editors`, e il
cancello sta **dentro** le tre RPC `security definer`. Le due tabelle restano
con `revoke all` e senza policy: dal client non si leggono e non si scrivono.

⚠️ **Chi non è operatore riceve un errore (42501), non un elenco vuoto.** Un
vuoto direbbe «non c'è niente da revisionare» — un'altra affermazione, e falsa.

**Che cosa contengono davvero queste schede**, perché il disegno dipende da qui.
I `proposed_values` **non sono campi di catalogo**: le sette reali portano
`textLength`, `contentHash`, `declaredUpdatedAt`, `deadlineCandidateCount`,
`unsupported`, `title`. Sono impronte della PAGINA sorgente: dicono «la fonte si
è mossa», non «il nome del programma adesso è X». Non c'è nulla da applicare.

**I tre gesti**, di conseguenza:

| Gesto | Significa | Effetto |
|---|---|---|
| **Approva** | ho aperto la fonte, ciò che diciamo resta vero | `subsidy_programs.last_checked_at = oggi` |
| **Irrilevante** | il cambiamento non tocca ciò che pubblichiamo | chiude la scheda, **non** tocca la freschezza |
| **Respingi** | il catalogo è sbagliato — **richiede una nota** | chiude la scheda; la correzione si fa **nel seed** |

Ogni decisione scrive `reviewed_by` e `reviewed_at`. Una scheda già decisa non
si ridecide: la RPC solleva `REVIEW_ALREADY_RESOLVED`, perché due persone sulla
stessa coda devono accorgersi di essersi pestate i piedi, non sovrascriversi.

⚠️ **Non è un sistema di redazione, ed è una scelta.** Non esiste un editor di
catalogo dentro l'app: i contenuti si scrivono nel seed, che è versionato e
rileggibile. Questa schermata serve a smaltire una coda, non a redigere.

**Provato**: 22 asserzioni nella sezione 17 di `test:subsidy-unit` (confronto,
campi comparsi e spariti, impronte marcate e non nascoste, nota obbligatoria nel
rifiuto, «non lo so» diverso da «zero giorni»), con **tre controprove eseguite**
— nascondere le impronte, rendere la nota facoltativa e trasformare `null` in
`0` producono tre rossi distinti. La 0037 porta la propria autoverifica, che
prova che il cancello sia **chiuso**: senza `auth.uid()` la lettura deve
sollevare, non tornare vuota.

✅ **APPLICATA E PROVATA CONTRO LA PRODUZIONE il 2026-08-05** (0037 + 0038),
con un JWT vero e non con il service role, che aggirerebbe il cancello:
- account non operatore → `subsidy_is_catalog_editor` **false**, e
  `list_subsidy_catalog_reviews` **403 / 42501 NOT_CATALOG_EDITOR** — un errore
  esplicito, non un elenco vuoto;
- account operatore → **7 schede, tutte con la fonte ufficiale**;
- i quattro percorsi d'errore di `resolve` provati su un id inesistente, quindi
  senza toccare nulla: `INVALID_DECISION`, `NOTE_REQUIRED` (anche con una nota
  di soli spazi), `REVIEW_NOT_FOUND`;
- la prova è stata fatta aggiungendo **temporaneamente** l'account dimostrativo
  agli operatori e **rimuovendolo**, con la riesclusione verificata dopo.

⚠️⚠️ **LA 0038 ESISTE PERCHÉ LA 0037 ERA ROTTA, E IL MODO IN CUI LO ERA VALE PIÙ
DEL DIFETTO.** `list_subsidy_catalog_reviews` interrogava `subsidy_sources.url`,
colonna che non esiste — si chiama `canonical_url` — e alla prima chiamata vera
rispondeva `42703`. L'autoverifica della 0037 **non poteva vederlo**: provava che
il cancello fosse chiuso, quindi chiamava la funzione senza `auth.uid()`, la
funzione sollevava in cima al corpo e **l'esecuzione non arrivava mai alla
query**; e un corpo plpgsql non viene pianificato alla creazione. Un controllo
che si ferma prima del codice che verifica è un verde falso.
La 0038 toglie il problema invece di correggere la riga: la query diventa una
**vista**, e una vista PostgreSQL è validata alla creazione — una colonna
sbagliata fa fallire la migrazione, subito. La funzione resta il cancello e
legge dalla vista, così la query sta in un posto solo.

### Le sette schede non erano un cambiamento — misurato il 2026-08-05

⚠️⚠️ **Erano la PRIMA LETTURA riuscita di ciascuna fonte, non il segno che la
fonte si fosse mossa.** In tutte e sette `previousHash` è **null** e
`unsupported` era `true` — l'adapter non sapeva ancora leggere quella pagina.
`textLength`, `declaredUpdatedAt` e `deadlineCandidateCount` sono **identici**
prima e dopo. L'unico campo normalizzato «diverso» era `unsupported` stesso.
La nota diceva «il contenuto della fonte è cambiato»: falsa. **Non si è mossa la
pagina, ha cominciato a funzionare il nostro lettore.**

Il difetto stava in `diff.ts`, dove la proposta `program_metadata` era «sempre
registrata» — anche senza un termine di paragone. Chiedere a una persona di
confrontare «prima» e «adesso» quando il «prima» non esiste produce una coda che
non si può smaltire, e una coda che non si smaltisce insegna a non guardarla:
la fine di ogni controllo utile. ✅ Corretto: senza impronta precedente non si
apre più una revisione di contenuto. ⚠️ Le altre proposte **non** sono toccate —
una candidata di scadenza o una struttura non interpretabile meritano una
persona anche alla prima lettura, perché non sono confronti, sono cose da
leggere. Tre casi nella sezione 11 di `test:subsidy-unit`, con controprova.

**Le sette sono state chiuse come `ignored`, non `accepted`**, e la differenza è
tutto: `accepted` avrebbe scritto `last_checked_at = oggi`, cioè «una persona ha
confrontato il catalogo con la fonte». Nessuno lo ha fatto. `reviewed_by` è
**null** perché nessuna persona ha deciso: le ha chiuse il sistema, e la nota su
ogni riga lo dice per esteso.
⚠️ **Resta vero che nessuno ha ancora verificato i contenuti contro le fonti**:
le date di `last_checked_at` sono ferme al 2026-07-25. La coda vuota dice che non
c'è nulla *in sospeso*, non che il catalogo sia stato ricontrollato.

### La riverifica ha un percorso (0046) — `recheck_due`

Fino al 2026-08-28 una revisione nasceva solo se una **fonte** si muoveva: a
coda vuota `last_checked_at` invecchiava oltre la soglia dei 30 giorni e
`subsidy:health` usciva 1 **senza che esistesse un gesto per chiuderlo** — un
rosso senza rimedio, che è il modo in cui si insegna a ignorare un controllo.

La 0046 aggiunge il tipo di cambiamento `recheck_due` (rischio `low`): quando
`runSourceChecks` trova un programma la cui verifica umana è più vecchia di
`VERIFY_STALE_DAYS` (30, in `contract.ts` — tenuto uguale alla soglia della
health da un controllo dedicato di `test:subsidy-unit`), apre una scheda con
`proposed_values` **vuoto**: non c'è nulla da applicare al catalogo, c'è una
fonte ufficiale da riaprire. I tre gesti restano quelli della 0037, e solo
**Approva** sposta `last_checked_at` — «Irrilevante» chiude la scheda senza
fingere una verifica, e la chiave di deduplicazione porta la data della
verifica proprio perché una scheda ignorata non ne riapra un'altra identica:
il promemoria che resta è il rosso della health, nel posto giusto.

Un programma **mai verificato** apre la stessa scheda, con la nota che lo dichiara
invece di un'età inventata.

Coperto dalla sezione 18 di `test:subsidy-unit` (14 asserzioni, con le tre
controprove eseguite: regola spenta, chiave costante, soglia divergente fra
worker e health). ⚠️ **Non ancora in produzione**: serve applicare la 0046 e
rideployare `subsidy-worker`.
