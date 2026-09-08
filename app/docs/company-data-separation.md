# Separazione fra dati reali, demo e tecnici

Stato della decisione: **implementata, integrata e applicata in produzione** il
08.09.2026 con la PR #110. La produzione è allineata alle migrazioni
`0001–0056`; nessuna riga aziendale è stata cancellata.

## Problema osservato

`companies` non dichiara lo scopo del tenant. Un'azienda creata da una persona,
un ambiente dimostrativo e un tenant tecnico hanno oggi la stessa forma. Il
solo meccanismo esplicito è il prefisso `ZZ-USA-E-GETTA` usato dallo script di
QA; non copre aziende persistenti usate durante lo sviluppo.

La provenienza del singolo documento (`email`, `upload`, `pasted_text`) descrive
come il dato è entrato, non se sia reale o dimostrativo. Non è quindi corretto
dedurre che tutti i dati di un tenant siano falsi, né cancellarli in base al
nome dell'azienda.

## Inventario sicuro

Il comando seguente legge metadati e conteggi senza leggere contenuti o file e
senza eseguire scritture:

```sh
npm run company:audit -- --id <uuid>
```

Per mostrare nome ed email completi dei membri serve il gesto esplicito
`--include-identities`; altrimenti l'email è mascherata. L'elenco delle tabelle
deriva da `src/types/database.ts`, così una nuova tabella con `company_id` non
viene dimenticata dall'inventario.

### Rossi SA: fotografia del 08.09.2026

Audit in sola lettura eseguito sull'azienda
`e0eb21d8-80cd-407e-92db-ba58f2cf7cf1`:

- un solo membro, Andrea Cavalieri, con ruolo `owner`;
- al momento dell'audit `usage_kind` non esisteva ancora nello schema, quindi
  lo scopo non era classificato;
- 20 documenti: 17 da email, 2 upload e 1 testo incollato;
- 148 email, 27 allegati e una connessione email;
- 4 attività, 6 eventi finanziari e 2 conversazioni con l'assistente;
- nessuna controparte CRM, opportunità, preventivo, fattura emessa o contratto.

La ragione sociale ha `uid_che = "CHE"`, che non è un IDI completo. Insieme
alla quantità di esecuzioni tecniche, questo prova che il tenant è stato usato
durante lo sviluppo; non prova che i documenti o le email siano inventati. La
combinazione di 17 documenti derivati da messaggi e 3 inseriti da una persona
impone di trattare i dati come **misti e potenzialmente reali**.

## Soluzione proposta

1. Aggiungere a `companies` un campo controllato `usage_kind` con valori
   `unclassified`, `live`, `demo`, `technical`. Gli esistenti partono da
   `unclassified`: nessuna euristica li promuove o li elimina.
2. Consentire la classificazione solo a owner/admin e registrare ogni cambio
   nel registro attività.
3. Impedire ai tenant `demo` e `technical` invii verso destinatari esterni non
   autorizzati. Le funzioni che comunicano all'esterno devono controllare il
   tipo nel database, non un'etichetta nel frontend.
4. Conservare per i tenant `technical` il marcatore, la scadenza e la pulizia
   verificata. Un tenant scaduto genera un avviso: non viene cancellato da un
   job cieco.
5. Portare successivamente QA ed evaluation in un progetto Supabase separato.
   La classificazione riduce il rischio, ma non sostituisce la separazione
   infrastrutturale.

## Implementazione e rilascio 0056

La migrazione `0056_company_usage_kind.sql` realizza i primi tre confini:

- `usage_kind` parte da `unclassified`, senza riclassificazioni implicite;
- owner e admin possono scegliere `live` o `demo`; `technical` è riservato al
  service role;
- ogni transizione è registrata in `company_usage_kind_events`, append-only per
  i ruoli applicativi;
- `send-crm-email` consente effetti esterni solo a `live`, con un controllo
  server-side eseguito prima di creare il provider o registrare il messaggio;
- le Impostazioni azienda mostrano e spiegano la classificazione in italiano,
  tedesco e francese;
- lo script usa-e-getta crea da ora tenant marcati `technical`.

Verifica di produzione del 08.09.2026:

- storico Supabase allineato da `0001` a `0056`;
- `send-crm-email` ACTIVE v8 con `verify_jwt=true`;
- frontend di `main` pubblicato da Cloudflare Pages;
- CI della PR e di `main` verde, inclusa la ricostruzione del database
  effimero.

Le notifiche calendario restano non configurate in produzione e non sono un
canale disponibile. Prima di attivarle dovranno applicare lo stesso gate.

## Trattamento di Rossi SA

Il proprietario ha deciso l'08.09.2026 che Rossi SA è una **demo persistente**.
La classificazione `demo` è stata applicata in produzione allo stesso tenant
inventariato. Il registro append-only contiene la transizione
`unclassified → demo`. I record già presenti restano al loro posto: quelli
dubbi non sono automaticamente “fasulli” e non vengono cancellati in blocco.

## Criterio di completamento

- ogni azienda ha un campo di scopo esplicito, anche quando resta
  `unclassified` in attesa della decisione del proprietario;
- demo e tenant tecnici non possono contattare persone reali per errore;
- i test non lasciano tenant orfani;
- Rossi SA è classificata con una decisione del proprietario e i suoi dati
  misti sono stati revisionati senza perdita involontaria.
