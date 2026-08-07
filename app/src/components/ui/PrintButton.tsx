// ============================================================================
// «Stampa / Esporta PDF» — un pulsante, non un generatore.
//
// ⚠️ NESSUNA DIPENDENZA NUOVA, e la ragione è di merito prima che di peso: un
// generatore di PDF lato server sarebbe un SECONDO renderer dell'analisi, che
// diverge dal primo appena qualcuno tocca una schermata e non se ne accorge —
// e produrrebbe fogli che nessuno ha mai guardato. `window.print()` stampa
// quello che l'utente sta vedendo, con gli stili di stampa applicati: un
// renderer solo, e la finestra del browser offre già «Salva come PDF».
//
// Il pulsante porta `no-print`: su carta un pulsante «Stampa» è la cosa più
// inutile che si possa stampare.
// ============================================================================
import { Button } from './states';
import { useT } from '@/i18n';

export function PrintButton({ label }: { label?: string }) {
  const t = useT();
  return (
    <Button
      className="no-print"
      icon="document"
      onClick={() => window.print()}
      title={t('print.button.hint')}
    >
      {label ?? t('print.button.label')}
    </Button>
  );
}
