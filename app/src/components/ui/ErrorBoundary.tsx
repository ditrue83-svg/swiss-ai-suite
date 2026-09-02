// ============================================================================
// LA RETE SOTTO LE SCHERMATE — l'unica cosa che stava fra un valore inatteso e
// una pagina bianca, e fino al 2026-08-14 non c'era.
//
// ⚠️ PERCHÉ ESISTE, e non è un'ipotesi. Il 2026-08-14, montando le pagine vere
// con dati di prova, è bastato un `relevance_level` fuori elenco perché
// `t()` chiamasse `.split()` su `undefined`: React ha smontato l'ALBERO INTERO
// e la finestra è rimasta BIANCA — niente barra laterale, niente messaggio,
// niente da cliccare. La console diceva «Consider adding an error boundary».
//
// ⚠️ E NON È UN CASO DI LABORATORIO. Gli elenchi di valori arrivano dal
// database, e alcuni vengono da dati condivisi, che sono GLOBALI e il
// scrivono gli operatori del catalogo (0032/0037) — non l'azienda che guarda la
// schermata. Il giorno in cui una riga di catalogo porta un valore che questo
// bundle non conosce, senza questa rete la pagina diventa bianca per
// ogni cliente, tutti insieme, e l'unico segno del guasto è in una console che
// nessun imprenditore apre.
//
// CHE COSA FA E CHE COSA NON FA
//   · NON assorbe il guasto: lo lascia in console (`console.error`) con la
//     pila, perché è lì che si diagnostica. La regola di casa vieta i fallback
//     silenziosi, e una rete che TACE sarebbe esattamente quello.
//   · NON promette che tutto sia a posto: dice che QUESTA schermata non si è
//     aperta e che nulla è stato modificato — che è vero, perché un guasto di
//     render avviene dopo la lettura e prima di qualunque scrittura.
//   · NON mostra il messaggio dell'errore come testo principale: quello parla
//     di codice, non all'utente. Sta in un `<details>` chiuso, per chi lo deve
//     riferire a chi ripara.
//   · SI RIARMA quando cambia la pagina (`chiave`): senza, tornare indietro
//     dalla schermata rotta lascerebbe il guasto sullo schermo per sempre.
//
// ⚠️ È UN COMPONENTE A CLASSE, ed è obbligatorio: `componentDidCatch` non ha
// un equivalente fra gli hook. Non è codice vecchio, è l'unica forma che React
// offre.
// ============================================================================
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './Icon';
// Fuori da un componente a funzione non c'è `useT`: `translate()` è valutata al
// render, quindi segue comunque la lingua corrente e non la congela.
import { translate as tr } from '@/i18n';

interface Props {
  children: ReactNode;
  /**
   * Cambiando questo valore la rete si riarma. Chi la monta attorno alle pagine
   * ci passa il percorso corrente: cambiata pagina, il guasto precedente non
   * riguarda più ciò che si sta guardando.
   */
  chiave?: string;
  /** Mostrato al posto della schermata rotta. Assente: la scheda qui sotto. */
  fallback?: ReactNode;
}

interface State {
  guasto: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { guasto: null };

  static getDerivedStateFromError(error: Error): State {
    return { guasto: error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // ⚠️ Si stampa, non si inghiotte: senza questa riga il guasto sparirebbe
    // dalla console insieme alla pagina bianca, e resterebbe solo il sintomo.
    console.error('[AI-Swisse] schermata interrotta:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.guasto && prev.chiave !== this.props.chiave) {
      this.setState({ guasto: null });
    }
  }

  render() {
    const { guasto } = this.state;
    if (!guasto) return this.props.children;
    if (this.props.fallback) return <>{this.props.fallback}</>;

    return (
      <div className="crash-box" role="alert">
        <div className="crash-ico"><Icon name="alert" /></div>
        <div className="crash-title">{tr('states.crashTitle')}</div>
        <p className="crash-body">{tr('states.crashBody')}</p>
        <div className="row-wrap">
          <button className="btn btn-primary" onClick={() => this.setState({ guasto: null })}>
            <Icon name="refresh" className="ic-sm" /> {tr('states.crashRetry')}
          </button>
          {/* Un <a> e non un <Link>: se il guasto sta nel router, navigare
              dentro l'applicazione rifarebbe lo stesso passo. Qui si ricarica
              davvero, e si riparte da una schermata che si sa aprire. */}
          <a className="btn" href="/">{tr('states.crashHome')}</a>
        </div>
        <details className="crash-details">
          <summary>{tr('states.crashDetails')}</summary>
          {/* Il messaggio, non la pila: la pila sta in console. Un messaggio di
              errore può contenere dati, quindi non finisce mai in un report né
              in un log inviato altrove — resta qui, sullo schermo di chi lo
              vede già. */}
          <code>{guasto.message}</code>
        </details>
      </div>
    );
  }
}
