// ============================================================================
// L'ETICHETTA — la pastiglia che CLASSIFICA, e non è una marcatura.
//
// CHE COSA È, E CHE COSA NON È. Il vocabolario della fiducia ha nove famiglie
// di segni, e ognuna risponde a una domanda: a che punto è · quanto conta ·
// entro quando · da dove viene · quanto ne siamo sicuri. Un'etichetta non
// risponde a nessuna di quelle: dice a QUALE INSIEME appartiene una cosa —
// il ruolo di una persona, il tipo di un contratto, la valuta, la fase di
// un'opportunità. È una parola, non un giudizio.
//
// ⚠️ PERCHÉ UN COMPONENTE, VISTO CHE `.badge` ESISTEVA GIÀ. Perché la classe
// da sola non impediva niente: ogni modulo scriveva il proprio
// `<span className="badge badge-…">` e sceglieva il TONO a occhio. Da lì
// venivano due difetti veri, misurati leggendo il codice e non immaginati:
//   · lo stato di un'opportunità portava `badge-media`, cioè il colore
//     dell'AMBRA — il tono che in tutto il resto del prodotto significa
//     «attenzione». Uno stato normale vestito da allarme;
//   · lo stesso identico stato compariva `badge-neutral` in una schermata e
//     `badge-media` in un'altra: due toni per la stessa cosa.
// Con un componente il tono non si sceglie più a occhio riga per riga: si
// sceglie una volta, dove si decide che cosa quella parola significa.
//
// I TONI, e quando usarli. Sono pochi di proposito: un'etichetta che avesse
// bisogno di un tono suo probabilmente non è un'etichetta, è una marcatura, e
// la sua casa è una delle nove famiglie.
//   neutral   il caso normale — la stragrande maggioranza, e il default
//   info      appartenenza rilevante per chi legge (in evidenza, non in allarme)
//   attention ⚠️ SOLO per ciò che chiede un'azione: qui il colore È un giudizio
//   ok        un esito positivo dichiarato
//   alert     ⚠️ SOLO un guasto vero — un'analisi fallita, una connessione rotta
//
// ⚠️ IL DEFAULT È `neutral` DI PROPOSITO, ed è metà del valore di questo file.
// Il tono non si sceglie: si omette, a meno di saper dire perché. Prima di
// questo componente ogni chiamante lo scriveva a mano, e il risultato era che
// lo STESSO fatto aveva toni diversi in schermate diverse.
//
// ⚠️ IL TESTO NON SI SCRIVE QUI E NON SI SCRIVE NEL CHIAMANTE: arriva dai
// dizionari, come ovunque (`i18n:coverage` esce 1 se non è così). Questo
// componente non traduce niente — riceve già la parola.
// ============================================================================
import type { ReactNode } from 'react';

export type TagTone = 'neutral' | 'info' | 'attention' | 'ok' | 'alert';

const TONE_CLASS: Record<TagTone, string> = {
  neutral: 'badge-neutral',
  info: 'badge-blue',
  attention: 'badge-media',
  ok: 'badge-bassa',
  alert: 'badge-alta',
};

export function Tag({ tone = 'neutral', children }: { tone?: TagTone; children: ReactNode }) {
  return <span className={`badge ${TONE_CLASS[tone]}`}>{children}</span>;
}
