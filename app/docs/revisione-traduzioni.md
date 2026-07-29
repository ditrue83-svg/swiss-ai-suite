# Revisione delle traduzioni — AI-Swisse

Testi dell’interfaccia in italiano, tedesco e francese, **ordinati per rischio**: in cima ciò che,
se tradotto male, causa il danno maggiore.

## Cosa è già stato verificato

Le traduzioni sono state redatte internamente e superano i controlli oggettivi:

- nessun «ß» nel tedesco (uso svizzero: si scrive «ss»);
- terminologia amministrativa federale — `Gesuch` e non `Antrag`, `AHV/MWST`, `UID` e non «IDI»;
- forma di cortesia coerente (`Sie`, `vous`);
- tipografia francese corretta su 532 stringhe (spazi fini, virgolette, separatori di migliaia);
- coerenza dei termini chiave: i casi con più varianti sono distinzioni volute
  (`Gesuch` domanda amministrativa / `Anfrage` richiesta generica; `subvention` il programma /
  `contribution` l’importo erogato).

## Cosa manca, e perché serve una persona

Nessuno dei controlli sopra dice se un imprenditore germanofono o romando **capisce al primo colpo
che cosa deve fare**. Registro, naturalezza e chiarezza non si misurano: si riconoscono.
Questi testi accompagnano scadenze fiscali e requisiti che decidono l’accesso a un contributo.

## Come usare questo documento

La riga IT è l’originale; DE e FR sono da verificare. Scrivere la correzione negli spazi predisposti.
Le chiavi fra apici servono a ritrovare il testo nel codice (`src/i18n/locales/`).

**486 testi in totale.** Con poco tempo, i livelli 1 e 2 (55 testi) sono quelli che contano.

> 🛑 **Questo documento non verrà consegnato a nessuno (deciso il 2026-07-26).**
> Il titolare ha scelto di non commissionare una revisione madrelingua. I testi sono stati rivisti
> internamente con i controlli verificabili elencati nel README, e le correzioni trovate sono state
> applicate. Il documento resta come materiale di confronto fra le tre lingue, utile se un giorno la
> revisione esterna si farà — per esempio perché un cliente germanofono o romando segnala che
> qualcosa «suona straniero», che è l'unico modo in cui questo limite può emergere.
>
> ⚠️ **Non è più completo (2026-07-26).** Circa cento etichette erano rimaste
> scritte a mano nei componenti — la dashboard, lo scadenziario, buona parte della schermata di
> analisi e le pratiche di Subsidy erano in italiano anche in tedesco e in francese — e sono state
> portate nei dizionari in quella data. **Le loro traduzioni DE e FR non sono ancora elencate qui
> sotto** e non sono passate da nessun controllo, nemmeno da quelli oggettivi della sezione
> precedente. Vanno aggiunte prima di consegnare il documento a un revisore, altrimenti la revisione
> coprirà l'interfaccia di ieri.
>
> Le chiavi interessate stanno in `dashboard.*` (da `kpiOpenActions` a `horizonBeyond`),
> `tasks.*` (da `titleField` a `deleteAria`), `adminAi.result.*` (da `correctionSaved` a
> `correctAria`, più `quoteOnPage`, `quoteCited`, `pdfPageNote`), `adminAi.introReading`,
> `adminAi.backToArchive`, `adminAi.fileImageOcr`, `adminAi.fileScanOcr`, `adminAi.progressGeneric`,
> `subsidy.cases.*` (da `caseDeleted` a `statuses.*`), `subsidy.detail.demoData*`,
> `archive.deleteAria`, `auth.passwordPlaceholder`, `auth.register.firstNamePlaceholder`,
> `auth.register.lastNamePlaceholder`, `labels.tones.*`.


---

## Livello 1 — Responsabilità legale  (4 testi)

_Definisce i limiti di responsabilità dello strumento: se dice meno di quanto deve, il problema non è linguistico._

**`adminAi.result.replyDisclaimer`**

| | |
|---|---|
| IT | Bozza generata dall’AI — rileggi e adatta prima dell’invio; non viene inviata automaticamente. |
| DE | Von der KI erstellter Entwurf — vor dem Versand lesen und anpassen; er wird nicht automatisch verschickt. |
| FR | Projet généré par l’IA — relisez et adaptez avant l’envoi ; il n’est pas envoyé automatiquement. |

Correzione DE:

Correzione FR:


**`legal.disclaimer`**

| | |
|---|---|
| IT | AI-Swisse è uno strumento di supporto amministrativo. Le analisi sono generate automaticamente e non sostituiscono la consulenza legale, fiscale o fiduciaria. Quando il sistema non è sicuro, lo segnala e invita a una verifica manuale. |
| DE | AI-Swisse ist ein Hilfsmittel für administrative Aufgaben. Die Analysen werden automatisch erstellt und ersetzen keine rechtliche, steuerliche oder treuhänderische Beratung. Wenn das System unsicher ist, weist es darauf hin und empfiehlt eine manuelle Prüfung. |
| FR | AI-Swisse est un outil d’assistance administrative. Les analyses sont générées automatiquement et ne remplacent pas un conseil juridique, fiscal ou fiduciaire. Lorsque le système n’est pas sûr, il le signale et invite à une vérification manuelle. |

Correzione DE:

Correzione FR:


**`pricing.disclaimer`**

| | |
|---|---|
| IT | L’output non costituisce consulenza legale, fiscale o fiduciaria; in caso di incertezza il sistema lo segnala e invita a una verifica professionale. |
| DE | Die Ergebnisse sind keine rechtliche, steuerliche oder treuhänderische Beratung; bei Unsicherheit weist das System darauf hin und empfiehlt eine fachliche Prüfung. |
| FR | Les résultats ne constituent pas un conseil juridique, fiscal ou fiduciaire ; en cas d’incertitude, le système le signale et invite à une vérification professionnelle. |

Correzione DE:

Correzione FR:


**`subsidy.interpretation.disclaimer`**

| | |
|---|---|
| IT | Interpretazione automatica del testo che hai scritto: serve a trovare programmi pertinenti, non dichiara l’idoneità — che va verificata requisito per requisito e confermata dall’ente. |
| DE | Automatische Interpretation Ihres Textes: sie dient dazu, relevante Programme zu finden, und stellt keine Anspruchsberechtigung fest — diese ist Anforderung für Anforderung zu prüfen und von der Stelle zu bestätigen. |
| FR | Interprétation automatique du texte que vous avez saisi : elle sert à trouver des programmes pertinents et ne déclare pas l’éligibilité — celle-ci doit être vérifiée condition par condition et confirmée par l’organisme. |

Correzione DE:

Correzione FR:



---

## Livello 2 — Errori, stati e avvisi  (51 testi)

_Letti quando qualcosa è già andato storto: devono dire cosa è successo e cosa fare, senza colpevolizzare._

**`errors.aiInvalidResponse`**

| | |
|---|---|
| IT | Risposta del servizio AI non valida. |
| DE | Ungültige Antwort des KI-Dienstes. |
| FR | Réponse du service IA invalide. |

Correzione DE:

Correzione FR:


**`errors.aiUnavailable`**

| | |
|---|---|
| IT | Analisi AI non disponibile. |
| DE | KI-Analyse nicht verfügbar. |
| FR | Analyse IA indisponible. |

Correzione DE:

Correzione FR:


**`errors.analysisFailed`**

| | |
|---|---|
| IT | Analisi non riuscita. Riprova. |
| DE | Analyse fehlgeschlagen. Bitte erneut versuchen. |
| FR | Analyse échouée. Veuillez réessayer. |

Correzione DE:

Correzione FR:


**`errors.analysisTooLong`**

| | |
|---|---|
| IT | L’analisi sta impiegando più del previsto. Riapri il documento dall’archivio tra poco. |
| DE | Die Analyse dauert länger als erwartet. Öffnen Sie das Dokument in Kürze erneut aus dem Archiv. |
| FR | L’analyse prend plus de temps que prévu. Rouvrez le document depuis les archives dans un moment. |

Correzione DE:

Correzione FR:


**`errors.analysisUnavailable`**

| | |
|---|---|
| IT | Analisi non disponibile dopo l’elaborazione. |
| DE | Nach der Verarbeitung ist keine Analyse verfügbar. |
| FR | Aucune analyse disponible après le traitement. |

Correzione DE:

Correzione FR:


**`errors.applyBeforeStartSub`**

| | |
|---|---|
| IT | Domanda da presentare PRIMA di avviare il progetto |
| DE | Gesuch VOR Beginn des Vorhabens einzureichen |
| FR | Demande à déposer AVANT de commencer le projet |

Correzione DE:

Correzione FR:


**`errors.badCredentials`**

| | |
|---|---|
| IT | Email o password non corretti. |
| DE | E-Mail oder Passwort sind nicht korrekt. |
| FR | E-mail ou mot de passe incorrect. |

Correzione DE:

Correzione FR:


**`errors.companyCreateFailed`**

| | |
|---|---|
| IT | Creazione azienda non riuscita. |
| DE | Das Unternehmen konnte nicht erstellt werden. |
| FR | La création de l’entreprise a échoué. |

Correzione DE:

Correzione FR:


**`errors.configMissing`**

| | |
|---|---|
| IT | Configurazione mancante: imposta VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nel file .env. |
| DE | Konfiguration fehlt: Setzen Sie VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY in der Datei .env. |
| FR | Configuration manquante : définissez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans le fichier .env. |

Correzione DE:

Correzione FR:


**`errors.configRejected`**

| | |
|---|---|
| IT | Il server ha rifiutato le credenziali dell’applicazione: l’accesso non può funzionare. |
| DE | Der Server hat die Zugangsdaten der Anwendung abgelehnt: Die Anmeldung kann nicht funktionieren. |
| FR | Le serveur a refusé les identifiants de l’application : la connexion ne peut pas fonctionner. |

Correzione DE:

Correzione FR:


**`errors.deterministicNoImages`**

| | |
|---|---|
| IT | Il motore locale non legge immagini o scansioni: incolla il testo oppure usa la modalità AI. |
| DE | Die lokale Engine liest keine Bilder oder Scans: fügen Sie den Text ein oder verwenden Sie den KI-Modus. |
| FR | Le moteur local ne lit pas les images ni les scans : collez le texte ou utilisez le mode IA. |

Correzione DE:

Correzione FR:


**`errors.duplicate`**

| | |
|---|---|
| IT | Elemento già presente (duplicato). |
| DE | Eintrag bereits vorhanden (Duplikat). |
| FR | Élément déjà présent (doublon). |

Correzione DE:

Correzione FR:


**`errors.emailNotConfirmed`**

| | |
|---|---|
| IT | Devi confermare la tua email prima di accedere. Controlla la posta. |
| DE | Bitte bestätigen Sie Ihre E-Mail-Adresse, bevor Sie sich anmelden. Prüfen Sie Ihren Posteingang. |
| FR | Vous devez confirmer votre e-mail avant de vous connecter. Vérifiez votre boîte de réception. |

Correzione DE:

Correzione FR:


**`errors.emailNotSent`**

| | |
|---|---|
| IT | Non è stato possibile inviare l’email. Non dipende da te: il servizio di posta dell’applicazione non ha accettato l’invio. Riprova più tardi e, se il problema resta, segnalalo a chi gestisce l’applicazione. |
| DE | Die E-Mail konnte nicht versendet werden. Es liegt nicht an Ihnen: Der Mailversand der Anwendung wurde abgelehnt. Versuchen Sie es später erneut und melden Sie es andernfalls der Betreiberin oder dem Betreiber. |
| FR | L’e-mail n’a pas pu être envoyé. Cela ne vient pas de vous : le service de messagerie de l’application a refusé l’envoi. Réessayez plus tard et, si le problème persiste, signalez-le à la personne qui gère l’application. |

Correzione DE:

Correzione FR:


**`errors.fileTooLarge`**

| | |
|---|---|
| IT | Il file supera la dimensione massima consentita. |
| DE | Die Datei überschreitet die zulässige Grösse. |
| FR | Le fichier dépasse la taille maximale autorisée. |

Correzione DE:

Correzione FR:


**`errors.forbidden`**

| | |
|---|---|
| IT | Non hai i permessi per accedere a questa risorsa. |
| DE | Sie haben keine Berechtigung für diese Ressource. |
| FR | Vous n’avez pas les droits d’accès à cette ressource. |

Correzione DE:

Correzione FR:


**`errors.generic`**

| | |
|---|---|
| IT | Si è verificato un errore. Riprova. |
| DE | Es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut. |
| FR | Une erreur est survenue. Veuillez réessayer. |

Correzione DE:

Correzione FR:


**`errors.interpretUnavailable`**

| | |
|---|---|
| IT | Interpretazione non disponibile. |
| DE | Interpretation nicht verfügbar. |
| FR | Interprétation indisponible. |

Correzione DE:

Correzione FR:


**`errors.invalidEmail`**

| | |
|---|---|
| IT | Indirizzo email non valido o non accettato dal provider. |
| DE | Ungültige oder vom Anbieter nicht akzeptierte E-Mail-Adresse. |
| FR | Adresse e-mail invalide ou refusée par le fournisseur. |

Correzione DE:

Correzione FR:


**`errors.lookupUnavailable`**

| | |
|---|---|
| IT | Ricerca nel Registro IDI non disponibile. |
| DE | Suche im UID-Register nicht verfügbar. |
| FR | Recherche dans le registre IDE indisponible. |

Correzione DE:

Correzione FR:


**`errors.network`**

| | |
|---|---|
| IT | Impossibile contattare il server. Controlla la connessione e riprova. |
| DE | Der Server ist nicht erreichbar. Prüfen Sie die Verbindung und versuchen Sie es erneut. |
| FR | Impossible de contacter le serveur. Vérifiez la connexion et réessayez. |

Correzione DE:

Correzione FR:


**`errors.notConnected`**

| | |
|---|---|
| IT | L’app non è ancora collegata a Supabase. |
| DE | Die App ist noch nicht mit Supabase verbunden. |
| FR | L’application n’est pas encore connectée à Supabase. |

Correzione DE:

Correzione FR:


**`errors.notDeterminable`**

| | |
|---|---|
| IT | Non determinabile dal documento. |
| DE | Aus dem Dokument nicht bestimmbar. |
| FR | Non déterminable à partir du document. |

Correzione DE:

Correzione FR:


**`errors.notFound`**

| | |
|---|---|
| IT | Elemento non trovato. |
| DE | Eintrag nicht gefunden. |
| FR | Élément introuvable. |

Correzione DE:

Correzione FR:


**`errors.pdfPreviewUnavailable`**

| | |
|---|---|
| IT | Anteprima PDF non disponibile: usa la vista testo. |
| DE | PDF-Vorschau nicht verfügbar: bitte die Textansicht verwenden. |
| FR | Aperçu PDF non disponible : utilisez la vue texte. |

Correzione DE:

Correzione FR:


**`errors.replyFailed`**

| | |
|---|---|
| IT | Generazione della bozza non riuscita. Riprova. |
| DE | Erstellung des Entwurfs fehlgeschlagen. Bitte erneut versuchen. |
| FR | La génération du projet a échoué. Veuillez réessayer. |

Correzione DE:

Correzione FR:


**`errors.replyNotGenerated`**

| | |
|---|---|
| IT | Bozza non generata. |
| DE | Es wurde kein Entwurf erstellt. |
| FR | Aucun projet généré. |

Correzione DE:

Correzione FR:


**`errors.sessionExpired`**

| | |
|---|---|
| IT | La sessione è scaduta. Effettua di nuovo l’accesso. |
| DE | Die Sitzung ist abgelaufen. Bitte melden Sie sich erneut an. |
| FR | La session a expiré. Veuillez vous reconnecter. |

Correzione DE:

Correzione FR:


**`errors.sessionInvalid`**

| | |
|---|---|
| IT | Sessione non valida o scaduta. Effettua di nuovo l’accesso. |
| DE | Sitzung ungültig oder abgelaufen. Bitte melden Sie sich erneut an. |
| FR | Session invalide ou expirée. Veuillez vous reconnecter. |

Correzione DE:

Correzione FR:


**`errors.signInFailed`**

| | |
|---|---|
| IT | Accesso non riuscito. Riprova. |
| DE | Anmeldung fehlgeschlagen. Bitte erneut versuchen. |
| FR | Échec de la connexion. Veuillez réessayer. |

Correzione DE:

Correzione FR:


**`errors.storageUnavailable`**

| | |
|---|---|
| IT | Archivio file non disponibile. Riprova più tardi. |
| DE | Dateiablage nicht verfügbar. Bitte später erneut versuchen. |
| FR | Stockage des fichiers indisponible. Réessayez plus tard. |

Correzione DE:

Correzione FR:


**`errors.tooManyAttempts`**

| | |
|---|---|
| IT | Troppi tentativi ravvicinati. Attendi qualche istante e riprova. |
| DE | Zu viele Versuche in kurzer Zeit. Bitte warten Sie einen Moment. |
| FR | Trop de tentatives rapprochées. Patientez un instant et réessayez. |

Correzione DE:

Correzione FR:


**`errors.userExists`**

| | |
|---|---|
| IT | Esiste già un account con questa email. Prova ad accedere. |
| DE | Mit dieser E-Mail-Adresse besteht bereits ein Konto. Versuchen Sie sich anzumelden. |
| FR | Un compte existe déjà avec cette adresse e-mail. Essayez de vous connecter. |

Correzione DE:

Correzione FR:


**`errors.weakPassword`**

| | |
|---|---|
| IT | La password è troppo debole: usa almeno 8 caratteri. |
| DE | Das Passwort ist zu schwach: verwenden Sie mindestens 8 Zeichen. |
| FR | Le mot de passe est trop faible : utilisez au moins 8 caractères. |

Correzione DE:

Correzione FR:


**`states.configHint`**

| | |
|---|---|
| IT | Imposta VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nel file .env. |
| DE | Setzen Sie VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY in der Datei .env. |
| FR | Définissez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans le fichier .env. |

Correzione DE:

Correzione FR:


**`states.configNoData`**

| | |
|---|---|
| IT | Nessun dato viene salvato finché la connessione non è configurata. |
| DE | Solange die Verbindung nicht konfiguriert ist, werden keine Daten gespeichert. |
| FR | Aucune donnée n’est enregistrée tant que la connexion n’est pas configurée. |

Correzione DE:

Correzione FR:


**`states.configRejected`**

| | |
|---|---|
| IT | Applicazione non configurata correttamente |
| DE | Anwendung nicht korrekt konfiguriert |
| FR | Application mal configurée |

Correzione DE:

Correzione FR:


**`states.configRejectedHint`**

| | |
|---|---|
| IT | Non è un problema del tuo account: la chiave di accesso impostata su questa installazione non è valida per il progetto collegato. Chi gestisce l’applicazione deve correggere VITE_SUPABASE_ANON_KEY nelle variabili d’ambiente e ripubblicare. Attenzione a incollare il valore della chiave, non il comando che la stampa. |
| DE | Es liegt nicht an Ihrem Konto: Der auf dieser Installation hinterlegte Zugriffsschlüssel ist für das verbundene Projekt ungültig. Die Betreiberin oder der Betreiber muss VITE_SUPABASE_ANON_KEY in den Umgebungsvariablen korrigieren und neu veröffentlichen. Achten Sie darauf, den Wert des Schlüssels einzufügen — nicht den Befehl, der ihn ausgibt. |
| FR | Le problème ne vient pas de votre compte : la clé d’accès configurée sur cette installation n’est pas valable pour le projet lié. La personne qui gère l’application doit corriger VITE_SUPABASE_ANON_KEY dans les variables d’environnement, puis republier. Veillez à coller la valeur de la clé, et non la commande qui l’affiche. |

Correzione DE:

Correzione FR:


**`states.configRequired`**

| | |
|---|---|
| IT | Configurazione richiesta |
| DE | Konfiguration erforderlich |
| FR | Configuration requise |

Correzione DE:

Correzione FR:


**`states.configRequiredHint`**

| | |
|---|---|
| IT | Copia .env.example in .env e imposta VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY con i valori del tuo progetto Supabase, poi riavvia il server di sviluppo. |
| DE | Kopieren Sie .env.example nach .env, tragen Sie VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY Ihres Supabase-Projekts ein und starten Sie den Entwicklungsserver neu. |
| FR | Copiez .env.example vers .env, renseignez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY de votre projet Supabase, puis redémarrez le serveur de développement. |

Correzione DE:

Correzione FR:


**`states.errorTitle`**

| | |
|---|---|
| IT | Qualcosa non ha funzionato |
| DE | Etwas hat nicht funktioniert |
| FR | Quelque chose n’a pas fonctionné |

Correzione DE:

Correzione FR:


**`states.loading`**

| | |
|---|---|
| IT | Caricamento… |
| DE | Wird geladen… |
| FR | Chargement… |

Correzione DE:

Correzione FR:


**`states.loadingCompany`**

| | |
|---|---|
| IT | Caricamento azienda… |
| DE | Unternehmen wird geladen… |
| FR | Chargement de l’entreprise… |

Correzione DE:

Correzione FR:


**`states.retry`**

| | |
|---|---|
| IT | Riprova |
| DE | Erneut versuchen |
| FR | Réessayer |

Correzione DE:

Correzione FR:


**`states.verifyingSession`**

| | |
|---|---|
| IT | Verifica sessione… |
| DE | Sitzung wird geprüft… |
| FR | Vérification de la session… |

Correzione DE:

Correzione FR:


**`subsidy.detail.notTranslated`**

| | |
|---|---|
| IT | I testi di questo programma non sono ancora disponibili nella tua lingua: quanto segue è in italiano, come pubblicato dall’ente. |
| DE | Die Texte dieses Programms liegen noch nicht in Ihrer Sprache vor: Das Folgende ist auf Italienisch, so wie von der Stelle veröffentlicht. |
| FR | Les textes de ce programme ne sont pas encore disponibles dans votre langue : ce qui suit est en italien, tel que publié par l’organisme. |

Correzione DE:

Correzione FR:


**`subsidy.detail.suspendedChecked`**

| | |
|---|---|
| IT | stato verificato il |
| DE | Status geprüft am |
| FR | statut vérifié le |

Correzione DE:

Correzione FR:


**`subsidy.detail.suspendedGeneric`**

| | |
|---|---|
| IT | Il programma esiste ma al momento non viene concesso. |
| DE | Das Programm besteht, wird aber derzeit nicht gewährt. |
| FR | Le programme existe mais n’est pas octroyé actuellement. |

Correzione DE:

Correzione FR:


**`subsidy.detail.suspendedSource`**

| | |
|---|---|
| IT | Verifica sulla fonte ufficiale |
| DE | Auf der offiziellen Quelle prüfen |
| FR | Vérifier sur la source officielle |

Correzione DE:

Correzione FR:


**`subsidy.detail.suspendedTitle`**

| | |
|---|---|
| IT | Incentivo attualmente sospeso. |
| DE | Förderung zurzeit ausgesetzt. |
| FR | Incitation actuellement suspendue. |

Correzione DE:

Correzione FR:


**`subsidy.results.suspended`**

| | |
|---|---|
| IT | Attualmente sospeso |
| DE | Zurzeit ausgesetzt |
| FR | Actuellement suspendu |

Correzione DE:

Correzione FR:



---

## Livello 3 — Etichette che qualificano una situazione  (45 testi)

_Qualificano urgenza e idoneità: una parola più forte o più debole cambia la decisione di chi legge._

**`labels.amountTypes.contribution`**

| | |
|---|---|
| IT | Contributo |
| DE | Beitrag |
| FR | Contribution |

Correzione DE:

Correzione FR:


**`labels.amountTypes.due`**

| | |
|---|---|
| IT | Da versare |
| DE | Zu bezahlen |
| FR | À verser |

Correzione DE:

Correzione FR:


**`labels.authorityTypes.cantonal`**

| | |
|---|---|
| IT | Autorità cantonale |
| DE | Kantonale Behörde |
| FR | Autorité cantonale |

Correzione DE:

Correzione FR:


**`labels.authorityTypes.federal`**

| | |
|---|---|
| IT | Autorità federale |
| DE | Bundesbehörde |
| FR | Autorité fédérale |

Correzione DE:

Correzione FR:


**`labels.authorityTypes.insurance`**

| | |
|---|---|
| IT | Assicurazione |
| DE | Versicherung |
| FR | Assurance |

Correzione DE:

Correzione FR:


**`labels.authorityTypes.municipal`**

| | |
|---|---|
| IT | Autorità comunale |
| DE | Gemeindebehörde |
| FR | Autorité communale |

Correzione DE:

Correzione FR:


**`labels.authorityTypes.pension`**

| | |
|---|---|
| IT | Cassa pensione |
| DE | Pensionskasse |
| FR | Caisse de pension |

Correzione DE:

Correzione FR:


**`labels.authorityTypes.private`**

| | |
|---|---|
| IT | Privato |
| DE | Privat |
| FR | Privé |

Correzione DE:

Correzione FR:


**`labels.authorityTypes.social_insurance`**

| | |
|---|---|
| IT | Assicurazione sociale |
| DE | Sozialversicherung |
| FR | Assurance sociale |

Correzione DE:

Correzione FR:


**`labels.authorityTypes.unknown`**

| | |
|---|---|
| IT | Ente non identificato |
| DE | Absender nicht identifiziert |
| FR | Expéditeur non identifié |

Correzione DE:

Correzione FR:


**`labels.confidence.alta`**

| | |
|---|---|
| IT | alta |
| DE | hoch |
| FR | haute |

Correzione DE:

Correzione FR:


**`labels.confidence.bassa`**

| | |
|---|---|
| IT | bassa |
| DE | niedrig |
| FR | basse |

Correzione DE:

Correzione FR:


**`labels.confidence.media`**

| | |
|---|---|
| IT | media |
| DE | mittel |
| FR | moyenne |

Correzione DE:

Correzione FR:


**`labels.deadlineLevels.nessuna`**

| | |
|---|---|
| IT | Nessuna urgenza |
| DE | Keine Dringlichkeit |
| FR | Aucune urgence |

Correzione DE:

Correzione FR:


**`labels.deadlineLevels.scaduta`**

| | |
|---|---|
| IT | Scaduta |
| DE | Abgelaufen |
| FR | Échue |

Correzione DE:

Correzione FR:


**`labels.docTypes.contract_related`**

| | |
|---|---|
| IT | Documento contrattuale |
| DE | Vertragsdokument |
| FR | Document contractuel |

Correzione DE:

Correzione FR:


**`labels.docTypes.declaration_request`**

| | |
|---|---|
| IT | Dichiarazione da presentare |
| DE | Einzureichende Deklaration |
| FR | Déclaration à déposer |

Correzione DE:

Correzione FR:


**`labels.docTypes.employment`**

| | |
|---|---|
| IT | Lavoro / personale |
| DE | Arbeit / Personal |
| FR | Travail / personnel |

Correzione DE:

Correzione FR:


**`labels.docTypes.information`**

| | |
|---|---|
| IT | Comunicazione informativa |
| DE | Informationsschreiben |
| FR | Communication d’information |

Correzione DE:

Correzione FR:


**`labels.docTypes.inspection_notice`**

| | |
|---|---|
| IT | Avviso di controllo |
| DE | Kontrollankündigung |
| FR | Avis de contrôle |

Correzione DE:

Correzione FR:


**`labels.docTypes.invoice`**

| | |
|---|---|
| IT | Fattura |
| DE | Rechnung |
| FR | Facture |

Correzione DE:

Correzione FR:


**`labels.docTypes.official_decision`**

| | |
|---|---|
| IT | Decisione ufficiale |
| DE | Verfügung |
| FR | Décision officielle |

Correzione DE:

Correzione FR:


**`labels.docTypes.other`**

| | |
|---|---|
| IT | Altro documento amministrativo |
| DE | Anderes behördliches Dokument |
| FR | Autre document administratif |

Correzione DE:

Correzione FR:


**`labels.docTypes.payment_request`**

| | |
|---|---|
| IT | Richiesta di pagamento |
| DE | Zahlungsaufforderung |
| FR | Demande de paiement |

Correzione DE:

Correzione FR:


**`labels.docTypes.permit`**

| | |
|---|---|
| IT | Permesso / autorizzazione |
| DE | Bewilligung |
| FR | Autorisation |

Correzione DE:

Correzione FR:


**`labels.docTypes.reminder`**

| | |
|---|---|
| IT | Sollecito |
| DE | Mahnung |
| FR | Rappel |

Correzione DE:

Correzione FR:


**`labels.docTypes.request_for_documents`**

| | |
|---|---|
| IT | Richiesta di documenti |
| DE | Anforderung von Unterlagen |
| FR | Demande de documents |

Correzione DE:

Correzione FR:


**`labels.docTypes.social_insurance`**

| | |
|---|---|
| IT | Assicurazioni sociali |
| DE | Sozialversicherungen |
| FR | Assurances sociales |

Correzione DE:

Correzione FR:


**`labels.docTypes.tax_document`**

| | |
|---|---|
| IT | Documento fiscale |
| DE | Steuerdokument |
| FR | Document fiscal |

Correzione DE:

Correzione FR:


**`labels.languages.de`**

| | |
|---|---|
| IT | Tedesco |
| DE | Deutsch |
| FR | Allemand |

Correzione DE:

Correzione FR:


**`labels.languages.fr`**

| | |
|---|---|
| IT | Francese |
| DE | Französisch |
| FR | Français |

Correzione DE:

Correzione FR:


**`labels.languages.it`**

| | |
|---|---|
| IT | Italiano |
| DE | Italienisch |
| FR | Italien |

Correzione DE:

Correzione FR:


**`labels.urgency.alta`**

| | |
|---|---|
| IT | alta |
| DE | hoch |
| FR | haute |

Correzione DE:

Correzione FR:


**`labels.urgency.bassa`**

| | |
|---|---|
| IT | bassa |
| DE | niedrig |
| FR | basse |

Correzione DE:

Correzione FR:


**`labels.urgency.media`**

| | |
|---|---|
| IT | media |
| DE | mittel |
| FR | moyenne |

Correzione DE:

Correzione FR:


**`subsidy.cases.eligibility`**

| | |
|---|---|
| IT | Idoneità: |
| DE | Anspruch: |
| FR | Éligibilité : |

Correzione DE:

Correzione FR:


**`subsidy.detail.eligibility`**

| | |
|---|---|
| IT | Verifica di idoneità |
| DE | Prüfung der Anspruchsberechtigung |
| FR | Vérification de l’éligibilité |

Correzione DE:

Correzione FR:


**`subsidy.detail.eligibilityHint`**

| | |
|---|---|
| IT | Rispondi alle domande: le hard rule (obbligatorie) determinano l’idoneità. La conferma finale spetta sempre all’ente. |
| DE | Beantworten Sie die Fragen: die obligatorischen Anforderungen entscheiden über den Anspruch. Die endgültige Bestätigung liegt immer bei der Stelle. |
| FR | Répondez aux questions : les conditions obligatoires déterminent l’éligibilité. La confirmation finale revient toujours à l’organisme. |

Correzione DE:

Correzione FR:


**`subsidy.labels.eligibility.unknown`**

| | |
|---|---|
| IT | Requisiti da verificare |
| DE | Anforderungen zu prüfen |
| FR | Conditions à vérifier |

Correzione DE:

Correzione FR:


**`subsidy.labels.eligibility.unlikely`**

| | |
|---|---|
| IT | Probabilmente non idoneo |
| DE | Voraussichtlich nicht anspruchsberechtigt |
| FR | Probablement non éligible |

Correzione DE:

Correzione FR:


**`subsidy.results.eligibilityToVerify`**

| | |
|---|---|
| IT | Idoneità: da verificare |
| DE | Anspruch: zu prüfen |
| FR | Éligibilité : à vérifier |

Correzione DE:

Correzione FR:


**`subsidy.results.priority`**

| | |
|---|---|
| IT | Priorità {level} |
| DE | Priorität {level} |
| FR | Priorité {level} |

Correzione DE:

Correzione FR:


**`tasks.priority.high`**

| | |
|---|---|
| IT | alta |
| DE | hoch |
| FR | haute |

Correzione DE:

Correzione FR:


**`tasks.priority.low`**

| | |
|---|---|
| IT | bassa |
| DE | niedrig |
| FR | basse |

Correzione DE:

Correzione FR:


**`tasks.priority.medium`**

| | |
|---|---|
| IT | media |
| DE | mittel |
| FR | moyenne |

Correzione DE:

Correzione FR:



---

## Livello 4 — Interfaccia corrente  (386 testi)

_Interfaccia corrente._

**`adminAi.alreadyAnalyzed`**

| | |
|---|---|
| IT | Documento già analizzato: mostro l’analisi esistente. |
| DE | Dokument bereits analysiert: die bestehende Analyse wird angezeigt. |
| FR | Document déjà analysé : l’analyse existante est affichée. |

Correzione DE:

Correzione FR:


**`adminAi.analysisDone`**

| | |
|---|---|
| IT | Analisi completata |
| DE | Analyse abgeschlossen |
| FR | Analyse terminée |

Correzione DE:

Correzione FR:


**`adminAi.analyzeAnother`**

| | |
|---|---|
| IT | Analizza un altro documento |
| DE | Weiteres Dokument analysieren |
| FR | Analyser un autre document |

Correzione DE:

Correzione FR:


**`adminAi.docNotFound`**

| | |
|---|---|
| IT | Documento non trovato. |
| DE | Dokument nicht gefunden. |
| FR | Document introuvable. |

Correzione DE:

Correzione FR:


**`adminAi.dropzone`**

| | |
|---|---|
| IT | Trascina qui un file o clicca per selezionarlo |
| DE | Datei hierher ziehen oder klicken zum Auswählen |
| FR | Glissez un fichier ici ou cliquez pour le sélectionner |

Correzione DE:

Correzione FR:


**`adminAi.dropzoneAria`**

| | |
|---|---|
| IT | Carica un PDF, un’email o un file di testo da analizzare |
| DE | PDF, E-Mail oder Textdatei zur Analyse hochladen |
| FR | Charger un PDF, un e-mail ou un fichier texte à analyser |

Correzione DE:

Correzione FR:


**`adminAi.extracting`**

| | |
|---|---|
| IT | Estrazione del testo in corso… |
| DE | Text wird extrahiert… |
| FR | Extraction du texte en cours… |

Correzione DE:

Correzione FR:


**`adminAi.fileUnreadable`**

| | |
|---|---|
| IT | Impossibile leggere il file. |
| DE | Die Datei kann nicht gelesen werden. |
| FR | Impossible de lire le fichier. |

Correzione DE:

Correzione FR:


**`adminAi.intro`**

| | |
|---|---|
| IT | Carica un PDF, una scansione, un’email o un file di testo: il sistema identifica ente, lingua, scadenze e prepara checklist e bozza di risposta. |
| DE | Laden Sie ein PDF, einen Scan, eine E-Mail oder eine Textdatei hoch: Das System erkennt Absender, Sprache und Fristen und bereitet Checkliste und Antwortentwurf vor. |
| FR | Chargez un PDF, un scan, un e-mail ou un fichier texte : le système identifie l’expéditeur, la langue et les délais, et prépare une checklist et un projet de réponse. |

Correzione DE:

Correzione FR:


**`adminAi.loadingAnalysis`**

| | |
|---|---|
| IT | Caricamento analisi… |
| DE | Analyse wird geladen… |
| FR | Chargement de l’analyse… |

Correzione DE:

Correzione FR:


**`adminAi.noAnalysisYet`**

| | |
|---|---|
| IT | Questo documento non ha ancora un’analisi. |
| DE | Für dieses Dokument liegt noch keine Analyse vor. |
| FR | Ce document n’a pas encore d’analyse. |

Correzione DE:

Correzione FR:


**`adminAi.ocrNote`**

| | |
|---|---|
| IT | Scansioni e foto — riconoscimento del testo (OCR) lato server |
| DE | Scans und Fotos — Texterkennung (OCR) auf dem Server |
| FR | Scans et photos — reconnaissance de texte (OCR) côté serveur |

Correzione DE:

Correzione FR:


**`adminAi.progressAnalyzing`**

| | |
|---|---|
| IT | Analisi AI in corso… può richiedere qualche istante. |
| DE | KI-Analyse läuft… das kann einen Moment dauern. |
| FR | Analyse IA en cours… cela peut prendre un moment. |

Correzione DE:

Correzione FR:


**`adminAi.progressOcr`**

| | |
|---|---|
| IT | Riconoscimento del testo (OCR) e analisi AI in corso… |
| DE | Texterkennung (OCR) und KI-Analyse laufen… |
| FR | Reconnaissance de texte (OCR) et analyse IA en cours… |

Correzione DE:

Correzione FR:


**`adminAi.progressPreparing`**

| | |
|---|---|
| IT | Preparazione del documento… |
| DE | Dokument wird vorbereitet… |
| FR | Préparation du document… |

Correzione DE:

Correzione FR:


**`adminAi.progressResuming`**

| | |
|---|---|
| IT | Ripresa dell’analisi… |
| DE | Analyse wird fortgesetzt… |
| FR | Reprise de l’analyse… |

Correzione DE:

Correzione FR:


**`adminAi.removeFile`**

| | |
|---|---|
| IT | Rimuovi il file |
| DE | Datei entfernen |
| FR | Retirer le fichier |

Correzione DE:

Correzione FR:


**`adminAi.result.addToTasks`**

| | |
|---|---|
| IT | Aggiungi allo scadenziario |
| DE | Zum Fristenkalender hinzufügen |
| FR | Ajouter aux échéances |

Correzione DE:

Correzione FR:


**`adminAi.result.amount`**

| | |
|---|---|
| IT | Importo |
| DE | Betrag |
| FR | Montant |

Correzione DE:

Correzione FR:


**`adminAi.result.amountsFound`**

| | |
|---|---|
| IT | Importi rilevati |
| DE | Erkannte Beträge |
| FR | Montants détectés |

Correzione DE:

Correzione FR:


**`adminAi.result.checklist`**

| | |
|---|---|
| IT | Cosa devi fare |
| DE | Was zu tun ist |
| FR | Ce que vous devez faire |

Correzione DE:

Correzione FR:


**`adminAi.result.correct`**

| | |
|---|---|
| IT | Correggi |
| DE | Korrigieren |
| FR | Corriger |

Correzione DE:

Correzione FR:


**`adminAi.result.corrections`**

| | |
|---|---|
| IT | Revisione manuale |
| DE | Manuelle Überprüfung |
| FR | Révision manuelle |

Correzione DE:

Correzione FR:


**`adminAi.result.correctionsHint`**

| | |
|---|---|
| IT | Se un dato è errato, correggilo: la correzione viene registrata e NON altera l’analisi AI originale. |
| DE | Falls eine Angabe falsch ist, korrigieren Sie sie: die Korrektur wird erfasst und verändert die ursprüngliche KI-Analyse NICHT. |
| FR | Si une donnée est erronée, corrigez-la : la correction est enregistrée et ne modifie PAS l’analyse IA d’origine. |

Correzione DE:

Correzione FR:


**`adminAi.result.createTask`**

| | |
|---|---|
| IT | Crea attività |
| DE | Aufgabe erstellen |
| FR | Créer une tâche |

Correzione DE:

Correzione FR:


**`adminAi.result.deadline`**

| | |
|---|---|
| IT | Scadenza |
| DE | Frist |
| FR | Délai |

Correzione DE:

Correzione FR:


**`adminAi.result.deadlineIndicative`**

| | |
|---|---|
| IT | Data indicativa: conferma la scadenza nel documento. |
| DE | Richtwert: Bitte die Frist im Dokument bestätigen. |
| FR | Date indicative : confirmez le délai dans le document. |

Correzione DE:

Correzione FR:


**`adminAi.result.deadlineNoneSub`**

| | |
|---|---|
| IT | Verifica manualmente il documento: il sistema non inventa una data. |
| DE | Bitte das Dokument manuell prüfen: das System erfindet kein Datum. |
| FR | Vérifiez le document manuellement : le système n’invente pas de date. |

Correzione DE:

Correzione FR:


**`adminAi.result.deadlineNoneTitle`**

| | |
|---|---|
| IT | Scadenza non individuata con sufficiente certezza. |
| DE | Keine Frist mit ausreichender Sicherheit erkannt. |
| FR | Aucun délai identifié avec une certitude suffisante. |

Correzione DE:

Correzione FR:


**`adminAi.result.deadlineRelative`**

| | |
|---|---|
| IT | Scadenza relativa: verifica la data esatta in base alla data di ricezione. |
| DE | Relative Frist: Bitte das genaue Datum anhand des Empfangsdatums prüfen. |
| FR | Délai relatif : vérifiez la date exacte selon la date de réception. |

Correzione DE:

Correzione FR:


**`adminAi.result.documentDate`**

| | |
|---|---|
| IT | Data del documento |
| DE | Dokumentdatum |
| FR | Date du document |

Correzione DE:

Correzione FR:


**`adminAi.result.documentType`**

| | |
|---|---|
| IT | Tipo di documento |
| DE | Dokumenttyp |
| FR | Type de document |

Correzione DE:

Correzione FR:


**`adminAi.result.failedGeneric`**

| | |
|---|---|
| IT | L’analisi di questo documento non è riuscita. |
| DE | Die Analyse dieses Dokuments ist fehlgeschlagen. |
| FR | L’analyse de ce document a échoué. |

Correzione DE:

Correzione FR:


**`adminAi.result.failedKept`**

| | |
|---|---|
| IT | Il documento e il file originale sono stati conservati: nessun dato è andato perso. Non viene mostrata alcuna informazione estratta perché non ne è stata prodotta nessuna. |
| DE | Das Dokument und die Originaldatei wurden aufbewahrt: es gingen keine Daten verloren. Es werden keine extrahierten Angaben gezeigt, weil keine erzeugt wurden. |
| FR | Le document et le fichier original ont été conservés : aucune donnée n’a été perdue. Aucune information extraite n’est affichée, car aucune n’a été produite. |

Correzione DE:

Correzione FR:


**`adminAi.result.failedTitle`**

| | |
|---|---|
| IT | Analisi non riuscita |
| DE | Analyse fehlgeschlagen |
| FR | Analyse échouée |

Correzione DE:

Correzione FR:


**`adminAi.result.fallbackAction`**

| | |
|---|---|
| IT | Leggere il documento e valutare le azioni |
| DE | Dokument lesen und die Massnahmen prüfen |
| FR | Lire le document et évaluer les mesures |

Correzione DE:

Correzione FR:


**`adminAi.result.generateFirst`**

| | |
|---|---|
| IT | Genera prima una bozza. |
| DE | Erstellen Sie zuerst einen Entwurf. |
| FR | Générez d’abord un projet. |

Correzione DE:

Correzione FR:


**`adminAi.result.generateReply`**

| | |
|---|---|
| IT | Genera bozza con l’AI |
| DE | Entwurf mit KI erstellen |
| FR | Générer un projet avec l’IA |

Correzione DE:

Correzione FR:


**`adminAi.result.generatingReply`**

| | |
|---|---|
| IT | Generazione della bozza in corso… |
| DE | Entwurf wird erstellt… |
| FR | Génération du projet en cours… |

Correzione DE:

Correzione FR:


**`adminAi.result.lastAttemptFailed`**

| | |
|---|---|
| IT | L’ultimo tentativo di rianalisi non è riuscito. Qui sotto trovi l’analisi precedente, che resta valida. |
| DE | Der letzte Versuch einer erneuten Analyse ist fehlgeschlagen. Unten finden Sie die vorherige Analyse, die weiterhin gültig ist. |
| FR | La dernière tentative de nouvelle analyse a échoué. Vous trouverez ci-dessous l’analyse précédente, qui reste valable. |

Correzione DE:

Correzione FR:


**`adminAi.result.legalReferences`**

| | |
|---|---|
| IT | Basi legali |
| DE | Rechtsgrundlagen |
| FR | Bases légales |

Correzione DE:

Correzione FR:


**`adminAi.result.loadingDocument`**

| | |
|---|---|
| IT | Caricamento del documento… |
| DE | Dokument wird geladen… |
| FR | Chargement du document… |

Correzione DE:

Correzione FR:


**`adminAi.result.noDeadlineFound`**

| | |
|---|---|
| IT | Nessuna scadenza individuata con certezza |
| DE | Keine Frist mit Sicherheit erkannt |
| FR | Aucun délai identifié avec certitude |

Correzione DE:

Correzione FR:


**`adminAi.result.noOriginalText`**

| | |
|---|---|
| IT | Testo originale non disponibile per l’evidenziazione. Le citazioni «…» restano visibili qui accanto. |
| DE | Originaltext für die Hervorhebung nicht verfügbar. Die Zitate «…» bleiben hier nebenan sichtbar. |
| FR | Texte original non disponible pour la mise en évidence. Les citations « … » restent visibles ici à côté. |

Correzione DE:

Correzione FR:


**`adminAi.result.noReplyYet`**

| | |
|---|---|
| IT | Nessuna bozza ancora. Scegli lingua e tono, poi premi «Genera bozza con l’AI»: potrai rileggerla e modificarla. |
| DE | Noch kein Entwurf. Wählen Sie Sprache und Ton und drücken Sie «Entwurf mit KI erstellen»: Sie können ihn danach lesen und anpassen. |
| FR | Aucun projet pour l’instant. Choisissez la langue et le ton, puis appuyez sur « Générer un projet avec l’IA » : vous pourrez le relire et le modifier. |

Correzione DE:

Correzione FR:


**`adminAi.result.noRequestedDocuments`**

| | |
|---|---|
| IT | Nessun documento specifico individuato nel testo. |
| DE | Im Text wurden keine bestimmten Unterlagen erkannt. |
| FR | Aucun document précis identifié dans le texte. |

Correzione DE:

Correzione FR:


**`adminAi.result.originBadgeExtracted`**

| | |
|---|---|
| IT | Dal documento |
| DE | Aus dem Dokument |
| FR | Du document |

Correzione DE:

Correzione FR:


**`adminAi.result.originBadgeExtractedCallout`**

| | |
|---|---|
| IT | Richiesto nel documento |
| DE | Im Dokument verlangt |
| FR | Demandé dans le document |

Correzione DE:

Correzione FR:


**`adminAi.result.originBadgeSuggested`**

| | |
|---|---|
| IT | Suggerimento SwissAI |
| DE | Vorschlag von SwissAI |
| FR | Suggestion SwissAI |

Correzione DE:

Correzione FR:


**`adminAi.result.originBadgeSuggestedCallout`**

| | |
|---|---|
| IT | Suggerito da SwissAI |
| DE | Von SwissAI vorgeschlagen |
| FR | Suggéré par SwissAI |

Correzione DE:

Correzione FR:


**`adminAi.result.originalDocument`**

| | |
|---|---|
| IT | Documento originale |
| DE | Originaldokument |
| FR | Document original |

Correzione DE:

Correzione FR:


**`adminAi.result.page`**

| | |
|---|---|
| IT | Pagina {n} |
| DE | Seite {n} |
| FR | Page {n} |

Correzione DE:

Correzione FR:


**`adminAi.result.pdfUnavailable`**

| | |
|---|---|
| IT | Anteprima PDF non disponibile: usa la vista testo. |
| DE | PDF-Vorschau nicht verfügbar: bitte die Textansicht verwenden. |
| FR | Aperçu PDF non disponible : utilisez la vue texte. |

Correzione DE:

Correzione FR:


**`adminAi.result.recipient`**

| | |
|---|---|
| IT | Destinatario |
| DE | Empfänger |
| FR | Destinataire |

Correzione DE:

Correzione FR:


**`adminAi.result.references`**

| | |
|---|---|
| IT | Riferimenti |
| DE | Referenzen |
| FR | Références |

Correzione DE:

Correzione FR:


**`adminAi.result.regenerateReply`**

| | |
|---|---|
| IT | Rigenera con l’AI |
| DE | Mit KI neu erstellen |
| FR | Régénérer avec l’IA |

Correzione DE:

Correzione FR:


**`adminAi.result.reply`**

| | |
|---|---|
| IT | Bozza di risposta |
| DE | Antwortentwurf |
| FR | Projet de réponse |

Correzione DE:

Correzione FR:


**`adminAi.result.replyLanguage`**

| | |
|---|---|
| IT | Lingua |
| DE | Sprache |
| FR | Langue |

Correzione DE:

Correzione FR:


**`adminAi.result.replyTone`**

| | |
|---|---|
| IT | Tono |
| DE | Ton |
| FR | Ton |

Correzione DE:

Correzione FR:


**`adminAi.result.requestedDocuments`**

| | |
|---|---|
| IT | Documenti richiesti |
| DE | Verlangte Unterlagen |
| FR | Documents demandés |

Correzione DE:

Correzione FR:


**`adminAi.result.retryAnalysis`**

| | |
|---|---|
| IT | Riprova analisi |
| DE | Analyse erneut versuchen |
| FR | Relancer l’analyse |

Correzione DE:

Correzione FR:


**`adminAi.result.risk`**

| | |
|---|---|
| IT | Rischio se non agisci |
| DE | Risiko bei Untätigkeit |
| FR | Risque en cas d’inaction |

Correzione DE:

Correzione FR:


**`adminAi.result.riskExplicit`**

| | |
|---|---|
| IT | Esplicitamente indicato nel documento |
| DE | Im Dokument ausdrücklich genannt |
| FR | Expressément indiqué dans le document |

Correzione DE:

Correzione FR:


**`adminAi.result.riskInferred`**

| | |
|---|---|
| IT | Possibile conseguenza — da verificare |
| DE | Mögliche Folge — zu prüfen |
| FR | Conséquence possible — à vérifier |

Correzione DE:

Correzione FR:


**`adminAi.result.riskUnknown`**

| | |
|---|---|
| IT | Non determinabile dal documento |
| DE | Aus dem Dokument nicht bestimmbar |
| FR | Non déterminable à partir du document |

Correzione DE:

Correzione FR:


**`adminAi.result.sender`**

| | |
|---|---|
| IT | Mittente |
| DE | Absender |
| FR | Expéditeur |

Correzione DE:

Correzione FR:


**`adminAi.result.senderShowInDocument`**

| | |
|---|---|
| IT | Mittente: mostra nel documento |
| DE | Absender: im Dokument anzeigen |
| FR | Expéditeur : afficher dans le document |

Correzione DE:

Correzione FR:


**`adminAi.result.showInDocument`**

| | |
|---|---|
| IT | Mostra nel documento |
| DE | Im Dokument anzeigen |
| FR | Afficher dans le document |

Correzione DE:

Correzione FR:


**`adminAi.result.subject`**

| | |
|---|---|
| IT | Oggetto |
| DE | Betreff |
| FR | Objet |

Correzione DE:

Correzione FR:


**`adminAi.result.taskAdded`**

| | |
|---|---|
| IT | Scadenza aggiunta allo scadenziario |
| DE | Frist zum Fristenkalender hinzugefügt |
| FR | Échéance ajoutée |

Correzione DE:

Correzione FR:


**`adminAi.result.uncertainties`**

| | |
|---|---|
| IT | Da verificare |
| DE | Zu prüfen |
| FR | À vérifier |

Correzione DE:

Correzione FR:


**`adminAi.result.whatToDoNow`**

| | |
|---|---|
| IT | Cosa devi fare adesso |
| DE | Was jetzt zu tun ist |
| FR | Ce que vous devez faire maintenant |

Correzione DE:

Correzione FR:


**`adminAi.savedNeedsReview`**

| | |
|---|---|
| IT | Analizzato — alcune informazioni sono da verificare |
| DE | Analysiert — einige Angaben sind zu prüfen |
| FR | Analysé — certaines informations sont à vérifier |

Correzione DE:

Correzione FR:


**`adminAi.savedOk`**

| | |
|---|---|
| IT | Documento analizzato e salvato in archivio |
| DE | Dokument analysiert und im Archiv gespeichert |
| FR | Document analysé et enregistré dans les archives |

Correzione DE:

Correzione FR:


**`adminAi.stepDoc`**

| | |
|---|---|
| IT | 1 · Documento da analizzare |
| DE | 1 · Zu analysierendes Dokument |
| FR | 1 · Document à analyser |

Correzione DE:

Correzione FR:


**`adminAi.title`**

| | |
|---|---|
| IT | Admin AI |
| DE | Admin AI |
| FR | Admin AI |

Correzione DE:

Correzione FR:


**`adminAi.titleField`**

| | |
|---|---|
| IT | Titolo (facoltativo) |
| DE | Titel (freiwillig) |
| FR | Titre (facultatif) |

Correzione DE:

Correzione FR:


**`adminAi.titlePlaceholder`**

| | |
|---|---|
| IT | Es. Lettera cassa AVS agosto |
| DE | z. B. Schreiben Ausgleichskasse August |
| FR | p. ex. Courrier caisse AVS août |

Correzione DE:

Correzione FR:


**`adminAi.trySample`**

| | |
|---|---|
| IT | Prova con un esempio: |
| DE | Mit einem Beispiel testen: |
| FR | Essayer avec un exemple : |

Correzione DE:

Correzione FR:


**`archive.actionsProgress`**

| | |
|---|---|
| IT | {done}/{total} azioni |
| DE | {done}/{total} Aufgaben |
| FR | {done}/{total} actions |

Correzione DE:

Correzione FR:


**`archive.analysisFailed`**

| | |
|---|---|
| IT | Analisi non riuscita |
| DE | Analyse fehlgeschlagen |
| FR | Analyse échouée |

Correzione DE:

Correzione FR:


**`archive.analysisFailedSub`**

| | |
|---|---|
| IT | Analisi non riuscita — il documento è conservato |
| DE | Analyse fehlgeschlagen — das Dokument bleibt gespeichert |
| FR | Analyse échouée — le document est conservé |

Correzione DE:

Correzione FR:


**`archive.confirmDelete`**

| | |
|---|---|
| IT | Eliminare questo documento? |
| DE | Dieses Dokument löschen? |
| FR | Supprimer ce document ? |

Correzione DE:

Correzione FR:


**`archive.count`**

| | |
|---|---|
| IT | Documenti ({n}) |
| DE | Dokumente ({n}) |
| FR | Documents ({n}) |

Correzione DE:

Correzione FR:


**`archive.deleted`**

| | |
|---|---|
| IT | Documento eliminato |
| DE | Dokument gelöscht |
| FR | Document supprimé |

Correzione DE:

Correzione FR:


**`archive.empty`**

| | |
|---|---|
| IT | Nessun documento ancora |
| DE | Noch keine Dokumente |
| FR | Aucun document pour l’instant |

Correzione DE:

Correzione FR:


**`archive.emptyCta`**

| | |
|---|---|
| IT | Analizza un documento |
| DE | Dokument analysieren |
| FR | Analyser un document |

Correzione DE:

Correzione FR:


**`archive.emptySub`**

| | |
|---|---|
| IT | Carica la tua prima comunicazione amministrativa e lascia che Admin AI la trasformi in azioni concrete. |
| DE | Laden Sie Ihr erstes behördliches Schreiben hoch und lassen Sie es von Admin AI in konkrete Schritte übersetzen. |
| FR | Chargez votre premier courrier administratif et laissez Admin AI le transformer en actions concrètes. |

Correzione DE:

Correzione FR:


**`archive.fileUnavailable`**

| | |
|---|---|
| IT | File non disponibile. |
| DE | Datei nicht verfügbar. |
| FR | Fichier non disponible. |

Correzione DE:

Correzione FR:


**`archive.filterAll`**

| | |
|---|---|
| IT | tutte |
| DE | alle |
| FR | tous |

Correzione DE:

Correzione FR:


**`archive.needsReview`**

| | |
|---|---|
| IT | Da verificare |
| DE | Zu prüfen |
| FR | À vérifier |

Correzione DE:

Correzione FR:


**`archive.noneWithFilter`**

| | |
|---|---|
| IT | Nessun documento con questo filtro. |
| DE | Keine Dokumente mit diesem Filter. |
| FR | Aucun document avec ce filtre. |

Correzione DE:

Correzione FR:


**`archive.openFileAria`**

| | |
|---|---|
| IT | Apri il file: {title} |
| DE | Datei öffnen: {title} |
| FR | Ouvrir le fichier : {title} |

Correzione DE:

Correzione FR:


**`archive.processing`**

| | |
|---|---|
| IT | In elaborazione |
| DE | In Bearbeitung |
| FR | En traitement |

Correzione DE:

Correzione FR:


**`archive.subtitle`**

| | |
|---|---|
| IT | Tutti i documenti caricati, con filtri per urgenza e stato della checklist. |
| DE | Alle hochgeladenen Dokumente, filterbar nach Dringlichkeit und Checklisten-Status. |
| FR | Tous les documents chargés, avec filtres par urgence et statut de la checklist. |

Correzione DE:

Correzione FR:


**`archive.title`**

| | |
|---|---|
| IT | Archivio documenti |
| DE | Dokumentenarchiv |
| FR | Archives des documents |

Correzione DE:

Correzione FR:


**`auth.confirmPassword`**

| | |
|---|---|
| IT | Conferma password |
| DE | Passwort bestätigen |
| FR | Confirmer le mot de passe |

Correzione DE:

Correzione FR:


**`auth.emailLabel`**

| | |
|---|---|
| IT | Email |
| DE | E-Mail |
| FR | E-mail |

Correzione DE:

Correzione FR:


**`auth.emailPlaceholder`**

| | |
|---|---|
| IT | nome@azienda.ch |
| DE | name@firma.ch |
| FR | nom@entreprise.ch |

Correzione DE:

Correzione FR:


**`auth.errors.emailRequired`**

| | |
|---|---|
| IT | Inserisci il tuo indirizzo email. |
| DE | Bitte geben Sie Ihre E-Mail-Adresse ein. |
| FR | Veuillez saisir votre adresse e-mail. |

Correzione DE:

Correzione FR:


**`auth.errors.nameRequired`**

| | |
|---|---|
| IT | Inserisci nome e cognome. |
| DE | Bitte geben Sie Vor- und Nachnamen ein. |
| FR | Veuillez saisir votre prénom et votre nom. |

Correzione DE:

Correzione FR:


**`auth.errors.passwordRequired`**

| | |
|---|---|
| IT | Inserisci la password. |
| DE | Bitte geben Sie das Passwort ein. |
| FR | Veuillez saisir le mot de passe. |

Correzione DE:

Correzione FR:


**`auth.errors.passwordShort`**

| | |
|---|---|
| IT | La password deve avere almeno 8 caratteri. |
| DE | Das Passwort muss mindestens 8 Zeichen haben. |
| FR | Le mot de passe doit contenir au moins 8 caractères. |

Correzione DE:

Correzione FR:


**`auth.forgot.backToLogin`**

| | |
|---|---|
| IT | Torna all’accesso |
| DE | Zurück zur Anmeldung |
| FR | Retour à la connexion |

Correzione DE:

Correzione FR:


**`auth.forgot.sent`**

| | |
|---|---|
| IT | Se l’indirizzo è registrato, riceverai un’email con il link per reimpostare la password. |
| DE | Falls die Adresse registriert ist, erhalten Sie eine E-Mail mit dem Link zum Zurücksetzen des Passworts. |
| FR | Si l’adresse est enregistrée, vous recevrez un e-mail avec le lien de réinitialisation. |

Correzione DE:

Correzione FR:


**`auth.forgot.submit`**

| | |
|---|---|
| IT | Invia il link |
| DE | Link senden |
| FR | Envoyer le lien |

Correzione DE:

Correzione FR:


**`auth.forgot.subtitle`**

| | |
|---|---|
| IT | Ti inviamo un link per impostarne una nuova. |
| DE | Wir senden Ihnen einen Link, um ein neues zu setzen. |
| FR | Nous vous envoyons un lien pour en définir un nouveau. |

Correzione DE:

Correzione FR:


**`auth.forgot.title`**

| | |
|---|---|
| IT | Password dimenticata |
| DE | Passwort vergessen |
| FR | Mot de passe oublié |

Correzione DE:

Correzione FR:


**`auth.login.createAccount`**

| | |
|---|---|
| IT | Crea account |
| DE | Konto erstellen |
| FR | Créer un compte |

Correzione DE:

Correzione FR:


**`auth.login.forgot`**

| | |
|---|---|
| IT | Password dimenticata? |
| DE | Passwort vergessen? |
| FR | Mot de passe oublié ? |

Correzione DE:

Correzione FR:


**`auth.login.noAccount`**

| | |
|---|---|
| IT | Non hai un account? |
| DE | Noch kein Konto? |
| FR | Vous n’avez pas de compte ? |

Correzione DE:

Correzione FR:


**`auth.login.submit`**

| | |
|---|---|
| IT | Accedi |
| DE | Anmelden |
| FR | Se connecter |

Correzione DE:

Correzione FR:


**`auth.login.subtitle`**

| | |
|---|---|
| IT | Entra nel tuo spazio di lavoro amministrativo. |
| DE | Zugang zu Ihrem administrativen Arbeitsbereich. |
| FR | Accédez à votre espace de travail administratif. |

Correzione DE:

Correzione FR:


**`auth.login.title`**

| | |
|---|---|
| IT | Accedi |
| DE | Anmelden |
| FR | Connexion |

Correzione DE:

Correzione FR:


**`auth.openFromLink`**

| | |
|---|---|
| IT | Apri questa pagina dal link ricevuto via email per reimpostare la password. |
| DE | Öffnen Sie diese Seite über den Link aus der E-Mail, um das Passwort zurückzusetzen. |
| FR | Ouvrez cette page depuis le lien reçu par e-mail pour réinitialiser le mot de passe. |

Correzione DE:

Correzione FR:


**`auth.passwordLabel`**

| | |
|---|---|
| IT | Password |
| DE | Passwort |
| FR | Mot de passe |

Correzione DE:

Correzione FR:


**`auth.passwordsDiffer`**

| | |
|---|---|
| IT | Le due password non coincidono. |
| DE | Die beiden Passwörter stimmen nicht überein. |
| FR | Les deux mots de passe ne correspondent pas. |

Correzione DE:

Correzione FR:


**`auth.redirecting`**

| | |
|---|---|
| IT | Password aggiornata. Ti stiamo reindirizzando… |
| DE | Passwort aktualisiert. Sie werden weitergeleitet… |
| FR | Mot de passe mis à jour. Redirection en cours… |

Correzione DE:

Correzione FR:


**`auth.register.checkEmail`**

| | |
|---|---|
| IT | Ti abbiamo inviato un’email di conferma: aprila per attivare l’account. |
| DE | Wir haben Ihnen eine Bestätigungs-E-Mail geschickt: Öffnen Sie diese, um das Konto zu aktivieren. |
| FR | Nous vous avons envoyé un e-mail de confirmation : ouvrez-le pour activer le compte. |

Correzione DE:

Correzione FR:


**`auth.register.firstName`**

| | |
|---|---|
| IT | Nome |
| DE | Vorname |
| FR | Prénom |

Correzione DE:

Correzione FR:


**`auth.register.goToLogin`**

| | |
|---|---|
| IT | Accedi |
| DE | Anmelden |
| FR | Se connecter |

Correzione DE:

Correzione FR:


**`auth.register.haveAccount`**

| | |
|---|---|
| IT | Hai già un account? |
| DE | Sie haben bereits ein Konto? |
| FR | Vous avez déjà un compte ? |

Correzione DE:

Correzione FR:


**`auth.register.lastName`**

| | |
|---|---|
| IT | Cognome |
| DE | Nachname |
| FR | Nom |

Correzione DE:

Correzione FR:


**`auth.register.passwordHint`**

| | |
|---|---|
| IT | Almeno 8 caratteri. |
| DE | Mindestens 8 Zeichen. |
| FR | Au moins 8 caractères. |

Correzione DE:

Correzione FR:


**`auth.register.submit`**

| | |
|---|---|
| IT | Crea account |
| DE | Konto erstellen |
| FR | Créer un compte |

Correzione DE:

Correzione FR:


**`auth.register.subtitle`**

| | |
|---|---|
| IT | Bastano pochi dati: l’impresa la configuri subito dopo. |
| DE | Nur wenige Angaben: Das Unternehmen richten Sie gleich danach ein. |
| FR | Quelques informations suffisent : l’entreprise se configure juste après. |

Correzione DE:

Correzione FR:


**`auth.register.title`**

| | |
|---|---|
| IT | Crea il tuo account |
| DE | Konto erstellen |
| FR | Créer votre compte |

Correzione DE:

Correzione FR:


**`auth.reset.done`**

| | |
|---|---|
| IT | Password aggiornata: ora puoi accedere. |
| DE | Passwort aktualisiert: Sie können sich jetzt anmelden. |
| FR | Mot de passe mis à jour : vous pouvez maintenant vous connecter. |

Correzione DE:

Correzione FR:


**`auth.reset.newPassword`**

| | |
|---|---|
| IT | Nuova password |
| DE | Neues Passwort |
| FR | Nouveau mot de passe |

Correzione DE:

Correzione FR:


**`auth.reset.submit`**

| | |
|---|---|
| IT | Aggiorna password |
| DE | Passwort aktualisieren |
| FR | Mettre à jour le mot de passe |

Correzione DE:

Correzione FR:


**`auth.reset.subtitle`**

| | |
|---|---|
| IT | Scegli una password che non usi altrove. |
| DE | Wählen Sie ein Passwort, das Sie nirgends sonst verwenden. |
| FR | Choisissez un mot de passe que vous n’utilisez pas ailleurs. |

Correzione DE:

Correzione FR:


**`auth.reset.title`**

| | |
|---|---|
| IT | Nuova password |
| DE | Neues Passwort |
| FR | Nouveau mot de passe |

Correzione DE:

Correzione FR:


**`brand.name`**

| | |
|---|---|
| IT | AI-Swisse |
| DE | AI-Swisse |
| FR | AI-Swisse |

Correzione DE:

Correzione FR:


**`brand.tagline`**

| | |
|---|---|
| IT | per le PMI svizzere |
| DE | für Schweizer KMU |
| FR | pour les PME suisses |

Correzione DE:

Correzione FR:


**`common.back`**

| | |
|---|---|
| IT | Indietro |
| DE | Zurück |
| FR | Retour |

Correzione DE:

Correzione FR:


**`common.cancel`**

| | |
|---|---|
| IT | Annulla |
| DE | Abbrechen |
| FR | Annuler |

Correzione DE:

Correzione FR:


**`common.close`**

| | |
|---|---|
| IT | Chiudi |
| DE | Schliessen |
| FR | Fermer |

Correzione DE:

Correzione FR:


**`common.confirm`**

| | |
|---|---|
| IT | Conferma |
| DE | Bestätigen |
| FR | Confirmer |

Correzione DE:

Correzione FR:


**`common.copy`**

| | |
|---|---|
| IT | Copia |
| DE | Kopieren |
| FR | Copier |

Correzione DE:

Correzione FR:


**`common.delete`**

| | |
|---|---|
| IT | Elimina |
| DE | Löschen |
| FR | Supprimer |

Correzione DE:

Correzione FR:


**`common.dontKnow`**

| | |
|---|---|
| IT | Non so |
| DE | Weiss ich nicht |
| FR | Je ne sais pas |

Correzione DE:

Correzione FR:


**`common.edit`**

| | |
|---|---|
| IT | Modifica |
| DE | Bearbeiten |
| FR | Modifier |

Correzione DE:

Correzione FR:


**`common.error`**

| | |
|---|---|
| IT | Si è verificato un errore. Riprova. |
| DE | Es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut. |
| FR | Une erreur est survenue. Veuillez réessayer. |

Correzione DE:

Correzione FR:


**`common.loading`**

| | |
|---|---|
| IT | Caricamento… |
| DE | Wird geladen… |
| FR | Chargement… |

Correzione DE:

Correzione FR:


**`common.next`**

| | |
|---|---|
| IT | Avanti |
| DE | Weiter |
| FR | Suivant |

Correzione DE:

Correzione FR:


**`common.no`**

| | |
|---|---|
| IT | No |
| DE | Nein |
| FR | Non |

Correzione DE:

Correzione FR:


**`common.open`**

| | |
|---|---|
| IT | Apri |
| DE | Öffnen |
| FR | Ouvrir |

Correzione DE:

Correzione FR:


**`common.optional`**

| | |
|---|---|
| IT | facoltativo |
| DE | freiwillig |
| FR | facultatif |

Correzione DE:

Correzione FR:


**`common.required`**

| | |
|---|---|
| IT | obbligatorio |
| DE | obligatorisch |
| FR | obligatoire |

Correzione DE:

Correzione FR:


**`common.retry`**

| | |
|---|---|
| IT | Riprova |
| DE | Erneut versuchen |
| FR | Réessayer |

Correzione DE:

Correzione FR:


**`common.save`**

| | |
|---|---|
| IT | Salva |
| DE | Speichern |
| FR | Enregistrer |

Correzione DE:

Correzione FR:


**`common.search`**

| | |
|---|---|
| IT | Cerca |
| DE | Suchen |
| FR | Rechercher |

Correzione DE:

Correzione FR:


**`common.verify`**

| | |
|---|---|
| IT | da verificare |
| DE | zu prüfen |
| FR | à vérifier |

Correzione DE:

Correzione FR:


**`common.yes`**

| | |
|---|---|
| IT | Sì |
| DE | Ja |
| FR | Oui |

Correzione DE:

Correzione FR:


**`dashboard.allSubsidies`**

| | |
|---|---|
| IT | Vedi tutti gli incentivi |
| DE | Alle Fördermittel ansehen |
| FR | Voir toutes les subventions |

Correzione DE:

Correzione FR:


**`dashboard.docLanguages`**

| | |
|---|---|
| IT | Lingue dei documenti |
| DE | Sprachen der Dokumente |
| FR | Langues des documents |

Correzione DE:

Correzione FR:


**`dashboard.docsByType`**

| | |
|---|---|
| IT | Documenti per tipo |
| DE | Dokumente nach Typ |
| FR | Documents par type |

Correzione DE:

Correzione FR:


**`dashboard.docsByUrgency`**

| | |
|---|---|
| IT | Documenti per urgenza |
| DE | Dokumente nach Dringlichkeit |
| FR | Documents par urgence |

Correzione DE:

Correzione FR:


**`dashboard.noChecklist`**

| | |
|---|---|
| IT | Nessuna checklist ancora. Analizza un documento. |
| DE | Noch keine Checkliste. Analysieren Sie ein Dokument. |
| FR | Aucune checklist pour l’instant. Analysez un document. |

Correzione DE:

Correzione FR:


**`dashboard.noDatedDeadlines`**

| | |
|---|---|
| IT | Nessuna scadenza con data. |
| DE | Keine Fristen mit Datum. |
| FR | Aucune échéance datée. |

Correzione DE:

Correzione FR:


**`dashboard.noDocsAnalyzed`**

| | |
|---|---|
| IT | Nessun documento analizzato. |
| DE | Noch kein Dokument analysiert. |
| FR | Aucun document analysé. |

Correzione DE:

Correzione FR:


**`dashboard.sortedByPriority`**

| | |
|---|---|
| IT | Ordinate per priorità e scadenza. |
| DE | Nach Priorität und Frist sortiert. |
| FR | Triées par priorité et échéance. |

Correzione DE:

Correzione FR:


**`dashboard.subtitle`**

| | |
|---|---|
| IT | Il quadro operativo della tua impresa: documenti, scadenze e incentivi in sintesi. |
| DE | Der operative Überblick Ihres Unternehmens: Dokumente, Fristen und Fördermittel in Kürze. |
| FR | La vue opérationnelle de votre entreprise : documents, échéances et subventions en résumé. |

Correzione DE:

Correzione FR:


**`home.adminAiDesc`**

| | |
|---|---|
| IT | Carica una lettera, un PDF o un’email: il sistema identifica ente, lingua e scadenze, spiega il contenuto e prepara checklist e bozza di risposta nella lingua corretta. |
| DE | Laden Sie einen Brief, ein PDF oder eine E-Mail hoch: das System erkennt Absender, Sprache und Fristen, erklärt den Inhalt und bereitet Checkliste und Antwortentwurf in der richtigen Sprache vor. |
| FR | Chargez un courrier, un PDF ou un e-mail : le système identifie l’expéditeur, la langue et les délais, explique le contenu et prépare une checklist et un projet de réponse dans la bonne langue. |

Correzione DE:

Correzione FR:


**`home.analyzeDoc`**

| | |
|---|---|
| IT | Analizza un documento |
| DE | Dokument analysieren |
| FR | Analyser un document |

Correzione DE:

Correzione FR:


**`home.ctaTasks`**

| | |
|---|---|
| IT | Vai allo scadenziario |
| DE | Zu den Fristen |
| FR | Voir les échéances |

Correzione DE:

Correzione FR:


**`home.findSubsidies`**

| | |
|---|---|
| IT | Trova incentivi |
| DE | Fördermittel finden |
| FR | Trouver des subventions |

Correzione DE:

Correzione FR:


**`home.greetingMorning`**

| | |
|---|---|
| IT | Buongiorno |
| DE | Guten Morgen |
| FR | Bonjour |

Correzione DE:

Correzione FR:


**`home.module`**

| | |
|---|---|
| IT | MODULO {n} |
| DE | MODUL {n} |
| FR | MODULE {n} |

Correzione DE:

Correzione FR:


**`home.noPriorities`**

| | |
|---|---|
| IT | Nessuna priorità urgente al momento: sei in pari con scadenze e documenti. |
| DE | Derzeit nichts Dringendes: Sie sind mit Fristen und Dokumenten auf dem Laufenden. |
| FR | Rien d’urgent pour l’instant : vous êtes à jour sur les échéances et les documents. |

Correzione DE:

Correzione FR:


**`home.openAdminAi`**

| | |
|---|---|
| IT | Apri Admin AI |
| DE | Admin AI öffnen |
| FR | Ouvrir Admin AI |

Correzione DE:

Correzione FR:


**`home.openSubsidyAi`**

| | |
|---|---|
| IT | Apri Subsidy AI |
| DE | Subsidy AI öffnen |
| FR | Ouvrir Subsidy AI |

Correzione DE:

Correzione FR:


**`home.prioActionsDone`**

| | |
|---|---|
| IT | azioni completate |
| DE | Aufgaben erledigt |
| FR | actions terminées |

Correzione DE:

Correzione FR:


**`home.prioActivity`**

| | |
|---|---|
| IT | Attività |
| DE | Aufgabe |
| FR | Tâche |

Correzione DE:

Correzione FR:


**`home.prioHighUrgency`**

| | |
|---|---|
| IT | urgenza alta |
| DE | hohe Dringlichkeit |
| FR | urgence haute |

Correzione DE:

Correzione FR:


**`home.prioOverdue`**

| | |
|---|---|
| IT | scaduta da {n} gg |
| DE | seit {n} Tagen überfällig |
| FR | en retard de {n} j |

Correzione DE:

Correzione FR:


**`home.priorities`**

| | |
|---|---|
| IT | Priorità di oggi |
| DE | Prioritäten von heute |
| FR | Priorités du jour |

Correzione DE:

Correzione FR:


**`home.subsidyAiDesc`**

| | |
|---|---|
| IT | Descrivi il progetto: il motore lo confronta con i programmi federali e cantonali e mostra solo gli incentivi compatibili, con verifica di idoneità. |
| DE | Beschreiben Sie das Vorhaben: die Engine gleicht es mit den Programmen von Bund und Kantonen ab und zeigt nur die passenden Fördermittel, mit Prüfung der Anspruchsberechtigung. |
| FR | Décrivez le projet : le moteur le compare aux programmes fédéraux et cantonaux et n’affiche que les subventions compatibles, avec vérification de l’éligibilité. |

Correzione DE:

Correzione FR:


**`home.subtitle`**

| | |
|---|---|
| IT | Ecco cosa richiede attenzione nella tua azienda. |
| DE | Das erfordert derzeit Ihre Aufmerksamkeit. |
| FR | Voici ce qui requiert votre attention. |

Correzione DE:

Correzione FR:


**`nav.activeCompany`**

| | |
|---|---|
| IT | Azienda attiva |
| DE | Aktives Unternehmen |
| FR | Entreprise active |

Correzione DE:

Correzione FR:


**`nav.adminAi`**

| | |
|---|---|
| IT | Admin AI — Documenti |
| DE | Admin AI — Dokumente |
| FR | Admin AI — Documents |

Correzione DE:

Correzione FR:


**`nav.archive`**

| | |
|---|---|
| IT | Archivio documenti |
| DE | Dokumentenarchiv |
| FR | Archives des documents |

Correzione DE:

Correzione FR:


**`nav.closeMenu`**

| | |
|---|---|
| IT | Chiudi il menu |
| DE | Menü schliessen |
| FR | Fermer le menu |

Correzione DE:

Correzione FR:


**`nav.dashboard`**

| | |
|---|---|
| IT | Dashboard |
| DE | Dashboard |
| FR | Tableau de bord |

Correzione DE:

Correzione FR:


**`nav.home`**

| | |
|---|---|
| IT | Panoramica |
| DE | Übersicht |
| FR | Aperçu |

Correzione DE:

Correzione FR:


**`nav.language`**

| | |
|---|---|
| IT | Lingua |
| DE | Sprache |
| FR | Langue |

Correzione DE:

Correzione FR:


**`nav.mainNav`**

| | |
|---|---|
| IT | Navigazione principale |
| DE | Hauptnavigation |
| FR | Navigation principale |

Correzione DE:

Correzione FR:


**`nav.menu`**

| | |
|---|---|
| IT | Menu |
| DE | Menü |
| FR | Menu |

Correzione DE:

Correzione FR:


**`nav.openMenu`**

| | |
|---|---|
| IT | Apri il menu di navigazione |
| DE | Navigationsmenü öffnen |
| FR | Ouvrir le menu de navigation |

Correzione DE:

Correzione FR:


**`nav.pricing`**

| | |
|---|---|
| IT | Piani e prezzi |
| DE | Abos und Preise |
| FR | Offres et tarifs |

Correzione DE:

Correzione FR:


**`nav.sectionAccount`**

| | |
|---|---|
| IT | Account |
| DE | Konto |
| FR | Compte |

Correzione DE:

Correzione FR:


**`nav.sectionModules`**

| | |
|---|---|
| IT | Moduli |
| DE | Module |
| FR | Modules |

Correzione DE:

Correzione FR:


**`nav.sectionPlatform`**

| | |
|---|---|
| IT | Piattaforma |
| DE | Plattform |
| FR | Plateforme |

Correzione DE:

Correzione FR:


**`nav.signOut`**

| | |
|---|---|
| IT | Esci |
| DE | Abmelden |
| FR | Se déconnecter |

Correzione DE:

Correzione FR:


**`nav.signOutAria`**

| | |
|---|---|
| IT | Esci dall’account |
| DE | Vom Konto abmelden |
| FR | Se déconnecter du compte |

Correzione DE:

Correzione FR:


**`nav.subsidyAi`**

| | |
|---|---|
| IT | Subsidy AI — Incentivi |
| DE | Subsidy AI — Fördermittel |
| FR | Subsidy AI — Subventions |

Correzione DE:

Correzione FR:


**`nav.switchCompany`**

| | |
|---|---|
| IT | Cambia azienda |
| DE | Unternehmen wechseln |
| FR | Changer d’entreprise |

Correzione DE:

Correzione FR:


**`nav.tasks`**

| | |
|---|---|
| IT | Scadenziario |
| DE | Fristen |
| FR | Échéances |

Correzione DE:

Correzione FR:


**`onboarding.canton`**

| | |
|---|---|
| IT | Cantone |
| DE | Kanton |
| FR | Canton |

Correzione DE:

Correzione FR:


**`onboarding.employees`**

| | |
|---|---|
| IT | Numero dipendenti |
| DE | Anzahl Mitarbeitende |
| FR | Nombre d’employés |

Correzione DE:

Correzione FR:


**`onboarding.employeesPlaceholder`**

| | |
|---|---|
| IT | Es. 12 |
| DE | z. B. 12 |
| FR | p. ex. 12 |

Correzione DE:

Correzione FR:


**`onboarding.errorName`**

| | |
|---|---|
| IT | Inserisci la ragione sociale. |
| DE | Bitte geben Sie den Firmennamen ein. |
| FR | Veuillez saisir la raison sociale. |

Correzione DE:

Correzione FR:


**`onboarding.legalForm`**

| | |
|---|---|
| IT | Forma giuridica |
| DE | Rechtsform |
| FR | Forme juridique |

Correzione DE:

Correzione FR:


**`onboarding.legalName`**

| | |
|---|---|
| IT | Ragione sociale |
| DE | Firmenname |
| FR | Raison sociale |

Correzione DE:

Correzione FR:


**`onboarding.legalNamePlaceholder`**

| | |
|---|---|
| IT | Es. Rossi Impianti Sagl |
| DE | z. B. Rossi Impianti GmbH |
| FR | p. ex. Rossi Impianti Sàrl |

Correzione DE:

Correzione FR:


**`onboarding.municipality`**

| | |
|---|---|
| IT | Comune |
| DE | Gemeinde |
| FR | Commune |

Correzione DE:

Correzione FR:


**`onboarding.municipalityPlaceholder`**

| | |
|---|---|
| IT | Es. Lugano |
| DE | z. B. Lugano |
| FR | p. ex. Lugano |

Correzione DE:

Correzione FR:


**`onboarding.noPreference`**

| | |
|---|---|
| IT | Preferisco non indicare |
| DE | Keine Angabe |
| FR | Je préfère ne pas indiquer |

Correzione DE:

Correzione FR:


**`onboarding.registryHint`**

| | |
|---|---|
| IT | Compila automaticamente i campi qui sotto; puoi sempre correggere a mano. |
| DE | Füllt die Felder unten automatisch aus; Sie können jederzeit von Hand korrigieren. |
| FR | Remplit automatiquement les champs ci-dessous ; vous pouvez toujours corriger à la main. |

Correzione DE:

Correzione FR:


**`onboarding.registryImported`**

| | |
|---|---|
| IT | Dati importati. Verifica e completa forma giuridica, settore e numero di dipendenti. |
| DE | Daten übernommen. Bitte prüfen und Rechtsform, Branche und Mitarbeiterzahl ergänzen. |
| FR | Données importées. Vérifiez et complétez la forme juridique, le secteur et le nombre d’employés. |

Correzione DE:

Correzione FR:


**`onboarding.registryImportedFrom`**

| | |
|---|---|
| IT | Dati importati da «{name}». Verifica e completa forma giuridica, settore e numero di dipendenti. |
| DE | Daten aus «{name}» übernommen. Bitte prüfen und Rechtsform, Branche und Mitarbeiterzahl ergänzen. |
| FR | Données importées de « {name} ». Vérifiez et complétez la forme juridique, le secteur et le nombre d’employés. |

Correzione DE:

Correzione FR:


**`onboarding.registryNoResults`**

| | |
|---|---|
| IT | Nessuna azienda trovata. Inserisci i dati manualmente qui sotto. |
| DE | Kein Unternehmen gefunden. Bitte erfassen Sie die Daten unten manuell. |
| FR | Aucune entreprise trouvée. Veuillez saisir les données manuellement ci-dessous. |

Correzione DE:

Correzione FR:


**`onboarding.registryPlaceholder`**

| | |
|---|---|
| IT | Ragione sociale o numero IDI (es. CHE-123.456.789) |
| DE | Firmenname oder UID (z. B. CHE-123.456.789) |
| FR | Raison sociale ou numéro IDE (p. ex. CHE-123.456.789) |

Correzione DE:

Correzione FR:


**`onboarding.registryResultsAria`**

| | |
|---|---|
| IT | Risultati del Registro IDI |
| DE | Ergebnisse aus dem UID-Register |
| FR | Résultats du registre IDE |

Correzione DE:

Correzione FR:


**`onboarding.registrySearch`**

| | |
|---|---|
| IT | Cerca nel Registro IDI (Zefix) |
| DE | Im UID-Register (Zefix) suchen |
| FR | Rechercher dans le registre IDE (Zefix) |

Correzione DE:

Correzione FR:


**`onboarding.registryUnavailable`**

| | |
|---|---|
| IT | La ricerca automatica nel Registro IDI non è al momento attiva. Inserisci i dati manualmente qui sotto. |
| DE | Die automatische Suche im UID-Register ist zurzeit nicht aktiv. Bitte erfassen Sie die Daten unten manuell. |
| FR | La recherche automatique dans le registre IDE n’est pas active actuellement. Veuillez saisir les données manuellement ci-dessous. |

Correzione DE:

Correzione FR:


**`onboarding.revenue`**

| | |
|---|---|
| IT | Fascia di fatturato (facoltativa) |
| DE | Umsatzklasse (freiwillig) |
| FR | Tranche de chiffre d’affaires (facultatif) |

Correzione DE:

Correzione FR:


**`onboarding.sector`**

| | |
|---|---|
| IT | Settore |
| DE | Branche |
| FR | Secteur |

Correzione DE:

Correzione FR:


**`onboarding.sectorPlaceholder`**

| | |
|---|---|
| IT | — Seleziona — |
| DE | — Auswählen — |
| FR | — Sélectionner — |

Correzione DE:

Correzione FR:


**`onboarding.submit`**

| | |
|---|---|
| IT | Crea impresa e continua |
| DE | Unternehmen erstellen und fortfahren |
| FR | Créer l’entreprise et continuer |

Correzione DE:

Correzione FR:


**`onboarding.subtitle`**

| | |
|---|---|
| IT | Questi dati alimentano l’analisi documenti e il matching incentivi. Potrai modificarli in seguito. |
| DE | Diese Angaben sind die Grundlage für die Dokumentenanalyse und das Fördermittel-Matching. Sie können sie später ändern. |
| FR | Ces données alimentent l’analyse des documents et la recherche de subventions. Vous pourrez les modifier plus tard. |

Correzione DE:

Correzione FR:


**`onboarding.title`**

| | |
|---|---|
| IT | Configura la tua impresa |
| DE | Richten Sie Ihr Unternehmen ein |
| FR | Configurez votre entreprise |

Correzione DE:

Correzione FR:


**`onboarding.uid`**

| | |
|---|---|
| IT | Numero IDI / CHE |
| DE | UID-Nummer (CHE) |
| FR | Numéro IDE (CHE) |

Correzione DE:

Correzione FR:


**`onboarding.uidInvalid`**

| | |
|---|---|
| IT | Questo numero IDI non supera la verifica della cifra di controllo: controlla di averlo digitato correttamente. Puoi comunque proseguire. |
| DE | Diese UID besteht die Prüfziffernkontrolle nicht: Bitte prüfen Sie die Eingabe. Sie können trotzdem fortfahren. |
| FR | Ce numéro IDE ne passe pas le contrôle du chiffre de vérification : vérifiez votre saisie. Vous pouvez néanmoins continuer. |

Correzione DE:

Correzione FR:


**`onboarding.uidPlaceholder`**

| | |
|---|---|
| IT | CHE-123.456.789 |
| DE | CHE-123.456.789 |
| FR | CHE-123.456.789 |

Correzione DE:

Correzione FR:


**`pricing.demoNote`**

| | |
|---|---|
| IT | Demo: la richiesta di accesso pilota non viene inviata in questo prototipo. |
| DE | Demo: Die Anfrage für den Pilotzugang wird in diesem Prototyp nicht versendet. |
| FR | Démo : la demande d’accès pilote n’est pas envoyée dans ce prototype. |

Correzione DE:

Correzione FR:


**`pricing.featInbox`**

| | |
|---|---|
| IT | Inbox amministrativa (analisi automatica email) |
| DE | Administrativer Posteingang (automatische E-Mail-Analyse) |
| FR | Boîte administrative (analyse automatique des e-mails) |

Correzione DE:

Correzione FR:


**`pricing.featLimitedDocs`**

| | |
|---|---|
| IT | Fino a 20 analisi documenti / mese |
| DE | Bis zu 20 Dokumentanalysen / Monat |
| FR | Jusqu’à 20 analyses de documents / mois |

Correzione DE:

Correzione FR:


**`pricing.featPortfolioReports`**

| | |
|---|---|
| IT | Report incentivi per portafoglio clienti |
| DE | Fördermittel-Reports für das Kundenportfolio |
| FR | Rapports de subventions par portefeuille clients |

Correzione DE:

Correzione FR:


**`pricing.featTeamTasks`**

| | |
|---|---|
| IT | Scadenziario di team con assegnazioni |
| DE | Team-Fristenkalender mit Zuweisungen |
| FR | Échéancier d’équipe avec attributions |

Correzione DE:

Correzione FR:


**`pricing.featUnlimitedDocs`**

| | |
|---|---|
| IT | Analisi documenti illimitate |
| DE | Unbegrenzte Dokumentanalysen |
| FR | Analyses de documents illimitées |

Correzione DE:

Correzione FR:


**`pricing.plans.basicTarget`**

| | |
|---|---|
| IT | Microimprese |
| DE | Kleinstunternehmen |
| FR | Microentreprises |

Correzione DE:

Correzione FR:


**`pricing.plans.f.aggregated`**

| | |
|---|---|
| IT | Vista aggregata scadenze di tutti i clienti |
| DE | Gesamtübersicht der Fristen aller Mandanten |
| FR | Vue agrégée des échéances de tous les clients |

Correzione DE:

Correzione FR:


**`pricing.plans.f.checklist`**

| | |
|---|---|
| IT | Checklist e scadenziario personale |
| DE | Checkliste und persönlicher Fristenkalender |
| FR | Checklist et échéancier personnel |

Correzione DE:

Correzione FR:


**`pricing.plans.f.dedicated`**

| | |
|---|---|
| IT | Onboarding e supporto dedicati |
| DE | Dediziertes Onboarding und Support |
| FR | Onboarding et support dédiés |

Correzione DE:

Correzione FR:


**`pricing.plans.f.docs20`**

| | |
|---|---|
| IT | Fino a 20 analisi documenti / mese |
| DE | Bis zu 20 Dokumentanalysen / Monat |
| FR | Jusqu’à 20 analyses de documents / mois |

Correzione DE:

Correzione FR:


**`pricing.plans.f.teamTasks`**

| | |
|---|---|
| IT | Scadenziario di team con assegnazioni |
| DE | Team-Fristenkalender mit Zuweisungen |
| FR | Échéancier d’équipe avec attributions |

Correzione DE:

Correzione FR:


**`pricing.plans.f.user1`**

| | |
|---|---|
| IT | 1 utente |
| DE | 1 Benutzer |
| FR | 1 utilisateur |

Correzione DE:

Correzione FR:


**`pricing.plans.f.users5`**

| | |
|---|---|
| IT | Fino a 5 utenti |
| DE | Bis zu 5 Benutzer |
| FR | Jusqu’à 5 utilisateurs |

Correzione DE:

Correzione FR:


**`pricing.plans.f.usersUnlimited`**

| | |
|---|---|
| IT | Utenti illimitati |
| DE | Unbegrenzte Benutzer |
| FR | Utilisateurs illimités |

Correzione DE:

Correzione FR:


**`pricing.plans.f.workflows`**

| | |
|---|---|
| IT | Workflow avanzati e integrazioni |
| DE | Erweiterte Workflows und Integrationen |
| FR | Workflows avancés et intégrations |

Correzione DE:

Correzione FR:


**`pricing.plans.perMonth`**

| | |
|---|---|
| IT | /mese |
| DE | /Monat |
| FR | /mois |

Correzione DE:

Correzione FR:


**`pricing.plans.proTarget`**

| | |
|---|---|
| IT | Aziende strutturate |
| DE | Strukturierte Unternehmen |
| FR | Entreprises structurées |

Correzione DE:

Correzione FR:


**`pricing.subtitle`**

| | |
|---|---|
| IT | Prezzi indicativi per entrambi i moduli: Admin AI e Subsidy AI. Importi in CHF, IVA esclusa. |
| DE | Richtpreise für beide Module: Admin AI und Subsidy AI. Beträge in CHF, exkl. MWST. |
| FR | Prix indicatifs pour les deux modules : Admin AI et Subsidy AI. Montants en CHF, TVA non comprise. |

Correzione DE:

Correzione FR:


**`roles.admin`**

| | |
|---|---|
| IT | Amministratore |
| DE | Administrator:in |
| FR | Administrateur·rice |

Correzione DE:

Correzione FR:


**`roles.member`**

| | |
|---|---|
| IT | Collaboratore |
| DE | Mitarbeiter:in |
| FR | Collaborateur·rice |

Correzione DE:

Correzione FR:


**`roles.owner`**

| | |
|---|---|
| IT | Titolare |
| DE | Inhaber:in |
| FR | Propriétaire |

Correzione DE:

Correzione FR:


**`subsidy.cases.casesEmptySub`**

| | |
|---|---|
| IT | Verifica l’idoneità di un incentivo e, con esito positivo, crea la relativa pratica per raccogliere documenti e checklist. |
| DE | Prüfen Sie den Anspruch auf ein Fördermittel und legen Sie bei positivem Ergebnis das zugehörige Dossier an, um Unterlagen und Checkliste zu sammeln. |
| FR | Vérifiez l’éligibilité à une subvention et, en cas de résultat positif, créez le dossier correspondant pour rassembler documents et checklist. |

Correzione DE:

Correzione FR:


**`subsidy.cases.deleteCase`**

| | |
|---|---|
| IT | Elimina pratica |
| DE | Dossier löschen |
| FR | Supprimer le dossier |

Correzione DE:

Correzione FR:


**`subsidy.cases.savedForReference`**

| | |
|---|---|
| IT | Salvata per riferimento |
| DE | Als Referenz gespeichert |
| FR | Enregistré pour référence |

Correzione DE:

Correzione FR:


**`subsidy.catalogEmpty`**

| | |
|---|---|
| IT | Il catalogo dei programmi è vuoto. |
| DE | Der Programmkatalog ist leer. |
| FR | Le catalogue des programmes est vide. |

Correzione DE:

Correzione FR:


**`subsidy.catalogEmptySub`**

| | |
|---|---|
| IT | Nessun incentivo è stato caricato nel sistema, quindi non è possibile dire se la tua impresa sia idonea a qualcosa. Contatta il supporto. |
| DE | Es wurden keine Fördermittel ins System geladen; daher lässt sich nicht sagen, ob Ihr Unternehmen anspruchsberechtigt ist. Bitte kontaktieren Sie den Support. |
| FR | Aucune subvention n’a été chargée dans le système ; il est donc impossible de dire si votre entreprise est éligible. Contactez le support. |

Correzione DE:

Correzione FR:


**`subsidy.catalogUnavailable`**

| | |
|---|---|
| IT | Catalogo incentivi non disponibile. |
| DE | Förderkatalog nicht verfügbar. |
| FR | Catalogue des subventions indisponible. |

Correzione DE:

Correzione FR:


**`subsidy.catalogUnavailableSub`**

| | |
|---|---|
| IT | Non viene mostrato alcun risultato: significa che i programmi non sono stati caricati, non che non ce ne siano di rilevanti per la tua impresa. |
| DE | Es wird kein Ergebnis angezeigt: das bedeutet, dass die Programme nicht geladen wurden — nicht, dass es keine relevanten für Ihr Unternehmen gibt. |
| FR | Aucun résultat n’est affiché : cela signifie que les programmes n’ont pas été chargés, et non qu’il n’y en a aucun de pertinent pour votre entreprise. |

Correzione DE:

Correzione FR:


**`subsidy.detail.addReminder`**

| | |
|---|---|
| IT | Aggiungi promemoria |
| DE | Erinnerung hinzufügen |
| FR | Ajouter un rappel |

Correzione DE:

Correzione FR:


**`subsidy.detail.applicationWindow`**

| | |
|---|---|
| IT | Finestra di candidatura |
| DE | Eingabefrist |
| FR | Fenêtre de dépôt |

Correzione DE:

Correzione FR:


**`subsidy.detail.authority`**

| | |
|---|---|
| IT | Ente |
| DE | Stelle |
| FR | Organisme |

Correzione DE:

Correzione FR:


**`subsidy.detail.back`**

| | |
|---|---|
| IT | Torna ai risultati |
| DE | Zurück zu den Ergebnissen |
| FR | Retour aux résultats |

Correzione DE:

Correzione FR:


**`subsidy.detail.blocksEligibility`**

| | |
|---|---|
| IT | blocca l’idoneità |
| DE | schliesst den Anspruch aus |
| FR | empêche l’éligibilité |

Correzione DE:

Correzione FR:


**`subsidy.detail.caseCreated`**

| | |
|---|---|
| IT | Pratica creata — la trovi in «Le mie pratiche» |
| DE | Dossier angelegt — Sie finden es unter «Meine Dossiers» |
| FR | Dossier créé — vous le trouverez dans « Mes dossiers » |

Correzione DE:

Correzione FR:


**`subsidy.detail.casePreliminary`**

| | |
|---|---|
| IT | Pratica preliminare salvata in «Le mie pratiche» |
| DE | Vorläufiges Dossier unter «Meine Dossiers» gespeichert |
| FR | Dossier préliminaire enregistré dans « Mes dossiers » |

Correzione DE:

Correzione FR:


**`subsidy.detail.caseReference`**

| | |
|---|---|
| IT | Salvata per riferimento in «Le mie pratiche» |
| DE | Als Referenz unter «Meine Dossiers» gespeichert |
| FR | Enregistré pour référence dans « Mes dossiers » |

Correzione DE:

Correzione FR:


**`subsidy.detail.completeChecks`**

| | |
|---|---|
| IT | Completa le verifiche |
| DE | Prüfungen abschliessen |
| FR | Terminer les vérifications |

Correzione DE:

Correzione FR:


**`subsidy.detail.createCase`**

| | |
|---|---|
| IT | Crea pratica |
| DE | Dossier anlegen |
| FR | Créer un dossier |

Correzione DE:

Correzione FR:


**`subsidy.detail.currentEligibility`**

| | |
|---|---|
| IT | Idoneità attuale: |
| DE | Aktueller Anspruch: |
| FR | Éligibilité actuelle : |

Correzione DE:

Correzione FR:


**`subsidy.detail.dataStatus`**

| | |
|---|---|
| IT | Stato dato |
| DE | Datenstatus |
| FR | État de la donnée |

Correzione DE:

Correzione FR:


**`subsidy.detail.documents`**

| | |
|---|---|
| IT | Documenti |
| DE | Unterlagen |
| FR | Documents |

Correzione DE:

Correzione FR:


**`subsidy.detail.exclCleared`**

| | |
|---|---|
| IT | non applicabile |
| DE | nicht anwendbar |
| FR | non applicable |

Correzione DE:

Correzione FR:


**`subsidy.detail.exclManual`**

| | |
|---|---|
| IT | verifica manuale |
| DE | manuelle Prüfung |
| FR | vérification manuelle |

Correzione DE:

Correzione FR:


**`subsidy.detail.exclToAnswer`**

| | |
|---|---|
| IT | da rispondere |
| DE | zu beantworten |
| FR | à répondre |

Correzione DE:

Correzione FR:


**`subsidy.detail.exclTriggered`**

| | |
|---|---|
| IT | attivata — esclude |
| DE | ausgelöst — schliesst aus |
| FR | déclenchée — exclut |

Correzione DE:

Correzione FR:


**`subsidy.detail.exclusionTriggered`**

| | |
|---|---|
| IT | Esclusione attivata |
| DE | Ausschluss ausgelöst |
| FR | Exclusion déclenchée |

Correzione DE:

Correzione FR:


**`subsidy.detail.exclusionsChecked`**

| | |
|---|---|
| IT | Esclusioni verificate |
| DE | Geprüfte Ausschlüsse |
| FR | Exclusions vérifiées |

Correzione DE:

Correzione FR:


**`subsidy.detail.exclusionsEvaluated`**

| | |
|---|---|
| IT | Esclusioni valutate nel questionario |
| DE | Im Fragebogen geprüfte Ausschlüsse |
| FR | Exclusions évaluées dans le questionnaire |

Correzione DE:

Correzione FR:


**`subsidy.detail.exclusionsManual`**

| | |
|---|---|
| IT | Esclusioni da verificare manualmente |
| DE | Manuell zu prüfende Ausschlüsse |
| FR | Exclusions à vérifier manuellement |

Correzione DE:

Correzione FR:


**`subsidy.detail.exclusionsManualHint`**

| | |
|---|---|
| IT | Non valutate automaticamente: verificale sulla fonte ufficiale. |
| DE | Nicht automatisch geprüft: bitte an der offiziellen Quelle kontrollieren. |
| FR | Non évaluées automatiquement : vérifiez-les à la source officielle. |

Correzione DE:

Correzione FR:


**`subsidy.detail.exclusionsToCheck`**

| | |
|---|---|
| IT | Esclusioni da verificare |
| DE | Zu prüfende Ausschlüsse |
| FR | Exclusions à vérifier |

Correzione DE:

Correzione FR:


**`subsidy.detail.hardRequirements`**

| | |
|---|---|
| IT | Requisiti obbligatori |
| DE | Obligatorische Anforderungen |
| FR | Conditions obligatoires |

Correzione DE:

Correzione FR:


**`subsidy.detail.lastChecked`**

| | |
|---|---|
| IT | Ultima verifica |
| DE | Letzte Prüfung |
| FR | Dernière vérification |

Correzione DE:

Correzione FR:


**`subsidy.detail.lastCheckedHint`**

| | |
|---|---|
| IT | revisione manuale, non un controllo automatico |
| DE | manuelle Überprüfung, keine automatische Kontrolle |
| FR | révision manuelle, pas un contrôle automatique |

Correzione DE:

Correzione FR:


**`subsidy.detail.mustApplyBeforeStart`**

| | |
|---|---|
| IT | La domanda va presentata prima di avviare il progetto/acquisto. |
| DE | Das Gesuch muss vor Beginn des Vorhabens bzw. vor dem Kauf eingereicht werden. |
| FR | La demande doit être déposée avant de commencer le projet ou l’achat. |

Correzione DE:

Correzione FR:


**`subsidy.detail.nextSteps`**

| | |
|---|---|
| IT | Prossimi passi |
| DE | Nächste Schritte |
| FR | Prochaines étapes |

Correzione DE:

Correzione FR:


**`subsidy.detail.noQuestions`**

| | |
|---|---|
| IT | Nessuna domanda di verifica per questo programma. |
| DE | Für dieses Programm sind keine Prüffragen hinterlegt. |
| FR | Aucune question de vérification pour ce programme. |

Correzione DE:

Correzione FR:


**`subsidy.detail.noRequirements`**

| | |
|---|---|
| IT | Nessun requisito indicato nella fonte. |
| DE | In der Quelle sind keine Anforderungen angegeben. |
| FR | Aucune condition indiquée dans la source. |

Correzione DE:

Correzione FR:


**`subsidy.detail.notAvailable`**

| | |
|---|---|
| IT | non disponibile |
| DE | nicht verfügbar |
| FR | non disponible |

Correzione DE:

Correzione FR:


**`subsidy.detail.prevails`**

| | |
|---|---|
| IT | Questo prevale su tutto il resto. |
| DE | Das hat Vorrang vor allem anderen. |
| FR | Cela prévaut sur tout le reste. |

Correzione DE:

Correzione FR:


**`subsidy.detail.profileGaps`**

| | |
|---|---|
| IT | Dati profilo da completare |
| DE | Zu ergänzende Profilangaben |
| FR | Données de profil à compléter |

Correzione DE:

Correzione FR:


**`subsidy.detail.questionOf`**

| | |
|---|---|
| IT | Domanda {i} di {n} |
| DE | Frage {i} von {n} |
| FR | Question {i} sur {n} |

Correzione DE:

Correzione FR:


**`subsidy.detail.reminderAdded`**

| | |
|---|---|
| IT | Promemoria aggiunto allo scadenziario |
| DE | Erinnerung zum Fristenkalender hinzugefügt |
| FR | Rappel ajouté aux échéances |

Correzione DE:

Correzione FR:


**`subsidy.detail.reminderTitle`**

| | |
|---|---|
| IT | Verificare finestra candidatura: {name} |
| DE | Eingabefrist prüfen: {name} |
| FR | Vérifier la fenêtre de dépôt : {name} |

Correzione DE:

Correzione FR:


**`subsidy.detail.requirementFailed`**

| | |
|---|---|
| IT | Requisito obbligatorio non soddisfatto |
| DE | Obligatorische Anforderung nicht erfüllt |
| FR | Condition obligatoire non remplie |

Correzione DE:

Correzione FR:


**`subsidy.detail.requirements`**

| | |
|---|---|
| IT | Requisiti |
| DE | Anforderungen |
| FR | Conditions |

Correzione DE:

Correzione FR:


**`subsidy.detail.restart`**

| | |
|---|---|
| IT | Ricomincia verifica |
| DE | Prüfung neu starten |
| FR | Recommencer la vérification |

Correzione DE:

Correzione FR:


**`subsidy.detail.savePreliminary`**

| | |
|---|---|
| IT | Salva come pratica preliminare |
| DE | Als vorläufiges Dossier speichern |
| FR | Enregistrer comme dossier préliminaire |

Correzione DE:

Correzione FR:


**`subsidy.detail.saveReference`**

| | |
|---|---|
| IT | Salva per riferimento |
| DE | Als Referenz speichern |
| FR | Enregistrer pour référence |

Correzione DE:

Correzione FR:


**`subsidy.detail.softRequirements`**

| | |
|---|---|
| IT | Requisiti preferenziali |
| DE | Bevorzugte Anforderungen |
| FR | Conditions préférentielles |

Correzione DE:

Correzione FR:


**`subsidy.detail.source`**

| | |
|---|---|
| IT | Fonte |
| DE | Quelle |
| FR | Source |

Correzione DE:

Correzione FR:


**`subsidy.detail.sourceTitle`**

| | |
|---|---|
| IT | Titolo fonte |
| DE | Titel der Quelle |
| FR | Titre de la source |

Correzione DE:

Correzione FR:


**`subsidy.detail.sourceUrl`**

| | |
|---|---|
| IT | URL ufficiale |
| DE | Offizielle URL |
| FR | URL officielle |

Correzione DE:

Correzione FR:


**`subsidy.detail.stateFailed`**

| | |
|---|---|
| IT | non soddisfatto |
| DE | nicht erfüllt |
| FR | non remplie |

Correzione DE:

Correzione FR:


**`subsidy.detail.stateSatisfied`**

| | |
|---|---|
| IT | soddisfatto |
| DE | erfüllt |
| FR | remplie |

Correzione DE:

Correzione FR:


**`subsidy.detail.stateToVerify`**

| | |
|---|---|
| IT | da verificare |
| DE | zu prüfen |
| FR | à vérifier |

Correzione DE:

Correzione FR:


**`subsidy.detail.supportType`**

| | |
|---|---|
| IT | Tipo di sostegno |
| DE | Art der Unterstützung |
| FR | Type de soutien |

Correzione DE:

Correzione FR:


**`subsidy.detail.tagExclusion`**

| | |
|---|---|
| IT | esclusione — blocca l’idoneità |
| DE | Ausschluss — verhindert den Anspruch |
| FR | exclusion — empêche l’éligibilité |

Correzione DE:

Correzione FR:


**`subsidy.detail.tagHard`**

| | |
|---|---|
| IT | requisito obbligatorio |
| DE | obligatorische Anforderung |
| FR | condition obligatoire |

Correzione DE:

Correzione FR:


**`subsidy.detail.tagSoft`**

| | |
|---|---|
| IT | preferenziale |
| DE | bevorzugt |
| FR | préférentielle |

Correzione DE:

Correzione FR:


**`subsidy.detail.verdict`**

| | |
|---|---|
| IT | Esito della verifica |
| DE | Ergebnis der Prüfung |
| FR | Résultat de la vérification |

Correzione DE:

Correzione FR:


**`subsidy.detail.whyRelevant`**

| | |
|---|---|
| IT | Perché è rilevante |
| DE | Warum relevant |
| FR | Pourquoi c’est pertinent |

Correzione DE:

Correzione FR:


**`subsidy.detail.windowHint`**

| | |
|---|---|
| IT | Descrizione della finestra, non una data certa: verifica sempre il termine sulla fonte ufficiale. |
| DE | Beschreibung des Zeitfensters, kein garantiertes Datum: prüfen Sie die Frist stets an der offiziellen Quelle. |
| FR | Description de la fenêtre, non une date certaine : vérifiez toujours le délai à la source officielle. |

Correzione DE:

Correzione FR:


**`subsidy.footnote`**

| | |
|---|---|
| IT | **Programmi verificati sulle fonti ufficiali** (con data di revisione). Un programma può risultare «attualmente sospeso»: esiste, ma per legge oggi non viene concesso. La «Rilevanza» misura la pertinenza al progetto, non la probabilità di ottenere il contributo; l’«Idoneità» è una stima basata sulle tue risposte e non sostituisce la valutazione dell’ente. Importi, requisiti e scadenze vanno sempre confermati sulla fonte ufficiale. |
| DE | Programme an den offiziellen Quellen geprüft (mit Datum der Überprüfung). Ein Programm kann als «zurzeit ausgesetzt» erscheinen: Es besteht, wird aber gesetzlich zurzeit nicht gewährt. Die «Relevanz» misst die Passung zum Vorhaben, nicht die Wahrscheinlichkeit, den Beitrag zu erhalten; die «Anspruchsberechtigung» ist eine Einschätzung auf Basis Ihrer Antworten und ersetzt die Beurteilung der Stelle nicht. Beträge, Anforderungen und Fristen sind stets an der offiziellen Quelle zu bestätigen. |
| FR | Programmes vérifiés aux sources officielles (avec date de révision). Un programme peut être « actuellement suspendu » : il existe, mais la loi ne permet pas de l’octroyer aujourd’hui. La « Pertinence » mesure l’adéquation au projet, non la probabilité d’obtenir la contribution ; l’« Éligibilité » est une estimation fondée sur vos réponses et ne remplace pas l’appréciation de l’organisme. Montants, conditions et délais doivent toujours être confirmés à la source officielle. |

Correzione DE:

Correzione FR:


**`subsidy.interpretation.alreadyStartedWarning`**

| | |
|---|---|
| IT | Dalla descrizione il progetto sembra già avviato: diversi programmi di incentivo richiedono la domanda prima di iniziare. Verifica sulla fonte ufficiale se sei ancora in tempo. |
| DE | Der Beschreibung nach scheint das Vorhaben bereits begonnen zu haben: mehrere Förderprogramme verlangen das Gesuch vor Beginn. Prüfen Sie an der offiziellen Quelle, ob Sie noch rechtzeitig sind. |
| FR | D’après la description, le projet semble déjà commencé : plusieurs programmes exigent que la demande soit déposée avant le début. Vérifiez à la source officielle si vous êtes encore dans les délais. |

Correzione DE:

Correzione FR:


**`subsidy.interpretation.title`**

| | |
|---|---|
| IT | Come l’AI ha interpretato il progetto |
| DE | So hat die KI das Vorhaben verstanden |
| FR | Comment l’IA a interprété le projet |

Correzione DE:

Correzione FR:


**`subsidy.interpretation.whyRelevant`**

| | |
|---|---|
| IT | Perché è pertinente |
| DE | Warum es relevant ist |
| FR | Pourquoi c’est pertinent |

Correzione DE:

Correzione FR:


**`subsidy.intro`**

| | |
|---|---|
| IT | Profilo aziendale → programmi rilevanti → verifica di idoneità → pratica. Rilevanza e idoneità sono due cose distinte. Copertura: Confederazione + Cantone Ticino. |
| DE | Unternehmensprofil → relevante Programme → Prüfung der Anspruchsberechtigung → Dossier. Relevanz und Anspruchsberechtigung sind zwei verschiedene Dinge. Abdeckung: Bund + Kanton Tessin. |
| FR | Profil de l’entreprise → programmes pertinents → vérification de l’éligibilité → dossier. Pertinence et éligibilité sont deux choses distinctes. Couverture : Confédération + canton du Tessin. |

Correzione DE:

Correzione FR:


**`subsidy.labels.dataStatus.demo`**

| | |
|---|---|
| IT | Dato demo |
| DE | Demodaten |
| FR | Donnée de démonstration |

Correzione DE:

Correzione FR:


**`subsidy.labels.dataStatus.recheck`**

| | |
|---|---|
| IT | Da ricontrollare |
| DE | Erneut zu prüfen |
| FR | À revérifier |

Correzione DE:

Correzione FR:


**`subsidy.labels.dataStatus.verified`**

| | |
|---|---|
| IT | Verificato |
| DE | Geprüft |
| FR | Vérifié |

Correzione DE:

Correzione FR:


**`subsidy.labels.projectTypes.digitalizzazione`**

| | |
|---|---|
| IT | Digitalizzazione |
| DE | Digitalisierung |
| FR | Numérisation |

Correzione DE:

Correzione FR:


**`subsidy.labels.projectTypes.export`**

| | |
|---|---|
| IT | Export / internazionalizzazione |
| DE | Export / Internationalisierung |
| FR | Export / internationalisation |

Correzione DE:

Correzione FR:


**`subsidy.labels.projectTypes.innovazione`**

| | |
|---|---|
| IT | Innovazione / R&S |
| DE | Innovation / F&E |
| FR | Innovation / R&D |

Correzione DE:

Correzione FR:


**`subsidy.labels.projectTypes.mobilita`**

| | |
|---|---|
| IT | Mobilità / veicoli |
| DE | Mobilität / Fahrzeuge |
| FR | Mobilité / véhicules |

Correzione DE:

Correzione FR:


**`subsidy.labels.sectors.commercio`**

| | |
|---|---|
| IT | Commercio |
| DE | Handel |
| FR | Commerce |

Correzione DE:

Correzione FR:


**`subsidy.labels.sectors.industria`**

| | |
|---|---|
| IT | Industria / manifattura |
| DE | Industrie / Fertigung |
| FR | Industrie / fabrication |

Correzione DE:

Correzione FR:


**`subsidy.labels.sectors.turismo`**

| | |
|---|---|
| IT | Turismo / ristorazione |
| DE | Tourismus / Gastronomie |
| FR | Tourisme / restauration |

Correzione DE:

Correzione FR:


**`subsidy.labels.supportTypes.grant`**

| | |
|---|---|
| IT | Contributo a fondo perso |
| DE | À-fonds-perdu-Beitrag |
| FR | Contribution à fonds perdu |

Correzione DE:

Correzione FR:


**`subsidy.labels.supportTypes.loan`**

| | |
|---|---|
| IT | Prestito agevolato |
| DE | Vergünstigtes Darlehen |
| FR | Prêt à taux préférentiel |

Correzione DE:

Correzione FR:


**`subsidy.loadingPrograms`**

| | |
|---|---|
| IT | Caricamento dei programmi… |
| DE | Programme werden geladen… |
| FR | Chargement des programmes… |

Correzione DE:

Correzione FR:


**`subsidy.profile.alreadyStarted`**

| | |
|---|---|
| IT | Il progetto sembra già avviato: attenzione ai programmi con «domanda prima di iniziare». |
| DE | Das Vorhaben scheint bereits begonnen zu haben: Achtung bei Programmen mit «Gesuch vor Beginn». |
| FR | Le projet semble déjà commencé : attention aux programmes exigeant la demande avant le début. |

Correzione DE:

Correzione FR:


**`subsidy.profile.company`**

| | |
|---|---|
| IT | Impresa: |
| DE | Unternehmen: |
| FR | Entreprise : |

Correzione DE:

Correzione FR:


**`subsidy.profile.description`**

| | |
|---|---|
| IT | Descrizione del progetto |
| DE | Beschreibung des Vorhabens |
| FR | Description du projet |

Correzione DE:

Correzione FR:


**`subsidy.profile.descriptionPlaceholder`**

| | |
|---|---|
| IT | Es. Vogliamo installare un impianto fotovoltaico sul tetto del capannone, sostituire due furgoni diesel con veicoli elettrici e digitalizzare la gestione degli ordini. |
| DE | z. B. Wir möchten eine Photovoltaikanlage auf dem Hallendach installieren, zwei Dieseltransporter durch Elektrofahrzeuge ersetzen und die Auftragsverwaltung digitalisieren. |
| FR | p. ex. Nous voulons installer une installation photovoltaïque sur le toit du hangar, remplacer deux fourgons diesel par des véhicules électriques et numériser la gestion des commandes. |

Correzione DE:

Correzione FR:


**`subsidy.profile.droppedEvidence`**

| | |
|---|---|
| IT | {n} citazione/i non ritrovate nel testo sono state scartate. |
| DE | {n} Zitat(e) wurden im Text nicht gefunden und verworfen. |
| FR | {n} citation(s) introuvable(s) dans le texte ont été écartées. |

Correzione DE:

Correzione FR:


**`subsidy.profile.hasVehicles`**

| | |
|---|---|
| IT | Ha veicoli aziendali |
| DE | Hat Firmenfahrzeuge |
| FR | Dispose de véhicules d’entreprise |

Correzione DE:

Correzione FR:


**`subsidy.profile.interpret`**

| | |
|---|---|
| IT | Interpreta il progetto con l’AI |
| DE | Vorhaben mit der KI interpretieren |
| FR | Interpréter le projet avec l’IA |

Correzione DE:

Correzione FR:


**`subsidy.profile.interpretHint`**

| | |
|---|---|
| IT | L’AI riconosce gli ambiti e spiega la pertinenza; l’idoneità resta da verificare. |
| DE | Die KI erkennt die Bereiche und erklärt die Relevanz; die Anspruchsberechtigung bleibt zu prüfen. |
| FR | L’IA reconnaît les domaines et explique la pertinence ; l’éligibilité reste à vérifier. |

Correzione DE:

Correzione FR:


**`subsidy.profile.intro`**

| | |
|---|---|
| IT | Descrivi il progetto: l’AI lo interpreta e propone gli ambiti pertinenti, che potrai approvare o correggere. |
| DE | Beschreiben Sie das Vorhaben: die KI interpretiert es und schlägt die passenden Bereiche vor, die Sie bestätigen oder korrigieren können. |
| FR | Décrivez le projet : l’IA l’interprète et propose les domaines pertinents, que vous pourrez valider ou corriger. |

Correzione DE:

Correzione FR:


**`subsidy.profile.noScope`**

| | |
|---|---|
| IT | Indica almeno un ambito di progetto (interpreta la descrizione o selezionalo qui sotto). |
| DE | Geben Sie mindestens einen Vorhabensbereich an (Beschreibung interpretieren lassen oder unten auswählen). |
| FR | Indiquez au moins un domaine de projet (faites interpréter la description ou sélectionnez-le ci-dessous). |

Correzione DE:

Correzione FR:


**`subsidy.profile.noneRecognized`**

| | |
|---|---|
| IT | L’AI non ha riconosciuto ambiti specifici: selezionali manualmente qui sotto. |
| DE | Die KI hat keine bestimmten Bereiche erkannt: bitte unten manuell auswählen. |
| FR | L’IA n’a reconnu aucun domaine précis : sélectionnez-les manuellement ci-dessous. |

Correzione DE:

Correzione FR:


**`subsidy.profile.ownsProperty`**

| | |
|---|---|
| IT | Possiede o utilizza immobili |
| DE | Besitzt oder nutzt Liegenschaften |
| FR | Possède ou utilise des immeubles |

Correzione DE:

Correzione FR:


**`subsidy.profile.recognized`**

| | |
|---|---|
| IT | Ambiti riconosciuti e aggiunti sotto (correggibili): |
| DE | Erkannte und unten hinzugefügte Bereiche (korrigierbar): |
| FR | Domaines reconnus et ajoutés ci-dessous (modifiables) : |

Correzione DE:

Correzione FR:


**`subsidy.profile.saved`**

| | |
|---|---|
| IT | Profilo incentivi salvato |
| DE | Förderprofil gespeichert |
| FR | Profil de subventions enregistré |

Correzione DE:

Correzione FR:


**`subsidy.profile.scopes`**

| | |
|---|---|
| IT | Ambiti del progetto (approva o correggi) |
| DE | Vorhabensbereiche (bestätigen oder korrigieren) |
| FR | Domaines du projet (validez ou corrigez) |

Correzione DE:

Correzione FR:


**`subsidy.profile.scopesAria`**

| | |
|---|---|
| IT | Ambiti del progetto |
| DE | Vorhabensbereiche |
| FR | Domaines du projet |

Correzione DE:

Correzione FR:


**`subsidy.profile.situation`**

| | |
|---|---|
| IT | Situazione |
| DE | Situation |
| FR | Situation |

Correzione DE:

Correzione FR:


**`subsidy.profile.submit`**

| | |
|---|---|
| IT | Trova incentivi rilevanti |
| DE | Relevante Fördermittel finden |
| FR | Trouver les subventions pertinentes |

Correzione DE:

Correzione FR:


**`subsidy.profile.title`**

| | |
|---|---|
| IT | Cosa vuole realizzare la tua azienda? |
| DE | Was möchte Ihr Unternehmen umsetzen? |
| FR | Que souhaite réaliser votre entreprise ? |

Correzione DE:

Correzione FR:


**`subsidy.profile.toVerify`**

| | |
|---|---|
| IT | Da verificare: |
| DE | Zu prüfen: |
| FR | À vérifier : |

Correzione DE:

Correzione FR:


**`subsidy.profile.tooShort`**

| | |
|---|---|
| IT | Descrivi il progetto con qualche frase in più prima di interpretarlo. |
| DE | Bitte beschreiben Sie das Vorhaben mit einigen Sätzen mehr, bevor Sie es interpretieren lassen. |
| FR | Décrivez le projet en quelques phrases de plus avant de l’interpréter. |

Correzione DE:

Correzione FR:


**`subsidy.profile.uncertainScopes`**

| | |
|---|---|
| IT | Ambiti incerti, non aggiunti automaticamente: |
| DE | Unsichere Bereiche, nicht automatisch hinzugefügt: |
| FR | Domaines incertains, non ajoutés automatiquement : |

Correzione DE:

Correzione FR:


**`subsidy.profile.uncertainScopesHint`**

| | |
|---|---|
| IT | Aggiungili solo se pertinenti. |
| DE | Fügen Sie sie nur hinzu, wenn sie zutreffen. |
| FR | Ne les ajoutez que s’ils sont pertinents. |

Correzione DE:

Correzione FR:


**`subsidy.results.applyBeforeStart`**

| | |
|---|---|
| IT | Domanda prima di iniziare |
| DE | Gesuch vor Beginn |
| FR | Demande avant le début |

Correzione DE:

Correzione FR:


**`subsidy.results.checkEligibility`**

| | |
|---|---|
| IT | Verifica idoneità |
| DE | Anspruch prüfen |
| FR | Vérifier l’éligibilité |

Correzione DE:

Correzione FR:


**`subsidy.results.editProfile`**

| | |
|---|---|
| IT | Modifica profilo |
| DE | Profil bearbeiten |
| FR | Modifier le profil |

Correzione DE:

Correzione FR:


**`subsidy.results.editProfileFull`**

| | |
|---|---|
| IT | Modifica profilo incentivi |
| DE | Förderprofil bearbeiten |
| FR | Modifier le profil de subventions |

Correzione DE:

Correzione FR:


**`subsidy.results.emptySub`**

| | |
|---|---|
| IT | Aggiungi ambiti di progetto o rivedi il settore nel profilo incentivi. |
| DE | Fügen Sie Vorhabensbereiche hinzu oder überprüfen Sie die Branche im Förderprofil. |
| FR | Ajoutez des domaines de projet ou revoyez le secteur dans le profil de subventions. |

Correzione DE:

Correzione FR:


**`subsidy.results.emptyTitle`**

| | |
|---|---|
| IT | Nessun programma rilevante con i criteri attuali |
| DE | Keine relevanten Programme mit den aktuellen Kriterien |
| FR | Aucun programme pertinent avec les critères actuels |

Correzione DE:

Correzione FR:


**`subsidy.results.relevance`**

| | |
|---|---|
| IT | Rilevanza |
| DE | Relevanz |
| FR | Pertinence |

Correzione DE:

Correzione FR:


**`subsidy.results.relevanceNote`**

| | |
|---|---|
| IT | La Rilevanza indica quanto il programma sembra pertinente al progetto, non la probabilità di ottenere il contributo: l’idoneità va verificata programma per programma. |
| DE | Die Relevanz gibt an, wie gut das Programm zum Vorhaben passt — nicht die Wahrscheinlichkeit, den Beitrag zu erhalten: Die Anspruchsberechtigung ist für jedes Programm einzeln zu prüfen. |
| FR | La pertinence indique dans quelle mesure le programme correspond au projet, et non la probabilité d’obtenir la contribution : l’éligibilité doit être vérifiée programme par programme. |

Correzione DE:

Correzione FR:


**`subsidy.results.requirementsToVerify`**

| | |
|---|---|
| IT | {n} requisiti da verificare |
| DE | {n} zu prüfende Anforderungen |
| FR | {n} conditions à vérifier |

Correzione DE:

Correzione FR:


**`subsidy.results.summary`**

| | |
|---|---|
| IT | {n} programmi rilevanti per {company} ({context}). |
| DE | {n} relevante Programme für {company} ({context}). |
| FR | {n} programmes pertinents pour {company} ({context}). |

Correzione DE:

Correzione FR:


**`subsidy.results.yourCompany`**

| | |
|---|---|
| IT | la tua impresa |
| DE | Ihr Unternehmen |
| FR | votre entreprise |

Correzione DE:

Correzione FR:


**`subsidy.tabCases`**

| | |
|---|---|
| IT | 3 · Le mie pratiche |
| DE | 3 · Meine Dossiers |
| FR | 3 · Mes dossiers |

Correzione DE:

Correzione FR:


**`subsidy.tabProfile`**

| | |
|---|---|
| IT | 1 · Profilo impresa |
| DE | 1 · Unternehmensprofil |
| FR | 1 · Profil de l’entreprise |

Correzione DE:

Correzione FR:


**`subsidy.tabResults`**

| | |
|---|---|
| IT | 2 · Incentivi rilevanti |
| DE | 2 · Relevante Fördermittel |
| FR | 2 · Subventions pertinentes |

Correzione DE:

Correzione FR:


**`subsidy.title`**

| | |
|---|---|
| IT | Subsidy AI |
| DE | Subsidy AI |
| FR | Subsidy AI |

Correzione DE:

Correzione FR:


**`tasks.addManual`**

| | |
|---|---|
| IT | Aggiungi scadenza manuale |
| DE | Frist manuell hinzufügen |
| FR | Ajouter une échéance manuelle |

Correzione DE:

Correzione FR:


**`tasks.added`**

| | |
|---|---|
| IT | Scadenza aggiunta allo scadenziario |
| DE | Frist zum Fristenkalender hinzugefügt |
| FR | Échéance ajoutée |

Correzione DE:

Correzione FR:


**`tasks.completed`**

| | |
|---|---|
| IT | Completata |
| DE | Erledigt |
| FR | Terminée |

Correzione DE:

Correzione FR:


**`tasks.deleted`**

| | |
|---|---|
| IT | Scadenza eliminata |
| DE | Frist gelöscht |
| FR | Échéance supprimée |

Correzione DE:

Correzione FR:


**`tasks.dueDate`**

| | |
|---|---|
| IT | Data di scadenza |
| DE | Fälligkeitsdatum |
| FR | Date d’échéance |

Correzione DE:

Correzione FR:


**`tasks.dueIn`**

| | |
|---|---|
| IT | Tra {days} giorni |
| DE | In {days} Tagen |
| FR | Dans {days} jours |

Correzione DE:

Correzione FR:


**`tasks.dueOn`**

| | |
|---|---|
| IT | Scade il {date} |
| DE | Fällig am {date} |
| FR | Échéance le {date} |

Correzione DE:

Correzione FR:


**`tasks.dueToday`**

| | |
|---|---|
| IT | Scade oggi |
| DE | Heute fällig |
| FR | Échéance aujourd’hui |

Correzione DE:

Correzione FR:


**`tasks.empty`**

| | |
|---|---|
| IT | Nessuna scadenza registrata |
| DE | Keine Fristen erfasst |
| FR | Aucune échéance enregistrée |

Correzione DE:

Correzione FR:


**`tasks.emptySub`**

| | |
|---|---|
| IT | Le attività create dai documenti analizzati e dagli incentivi compaiono qui. |
| DE | Aufgaben aus analysierten Dokumenten und Fördermitteln erscheinen hier. |
| FR | Les tâches issues des documents analysés et des subventions apparaissent ici. |

Correzione DE:

Correzione FR:


**`tasks.markDone`**

| | |
|---|---|
| IT | Completa |
| DE | Erledigen |
| FR | Terminer |

Correzione DE:

Correzione FR:


**`tasks.noDueDate`**

| | |
|---|---|
| IT | Senza data |
| DE | Ohne Datum |
| FR | Sans date |

Correzione DE:

Correzione FR:


**`tasks.noneInView`**

| | |
|---|---|
| IT | Nessuna scadenza in questa vista. |
| DE | Keine Fristen in dieser Ansicht. |
| FR | Aucune échéance dans cette vue. |

Correzione DE:

Correzione FR:


**`tasks.overdueBy`**

| | |
|---|---|
| IT | Scaduta da {days} giorni |
| DE | Seit {days} Tagen überfällig |
| FR | En retard de {days} jours |

Correzione DE:

Correzione FR:


**`tasks.reopen`**

| | |
|---|---|
| IT | Riapri |
| DE | Wieder öffnen |
| FR | Rouvrir |

Correzione DE:

Correzione FR:


**`tasks.subtitle`**

| | |
|---|---|
| IT | Tutte le scadenze e le attività, con priorità e stato. |
| DE | Alle Fristen und Aufgaben, mit Priorität und Status. |
| FR | Toutes les échéances et tâches, avec priorité et statut. |

Correzione DE:

Correzione FR:


**`tasks.title`**

| | |
|---|---|
| IT | Scadenziario |
| DE | Fristen |
| FR | Échéances |

Correzione DE:

Correzione FR:

