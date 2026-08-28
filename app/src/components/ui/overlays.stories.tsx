// ============================================================================
// Storie dei componenti che stanno SOPRA la pagina: la finestra modale, il
// toast, il menu di trabocco e la rete degli errori.
//
// ⚠️ Il testo di esempio sta fra graffe per `i18n:coverage` — vedi la nota in
// testa a `forms.stories.tsx`. Il messaggio del toast passa da una costante
// per la stessa ragione: il controllo segnala i letterali dentro showToast().
// ============================================================================
import { useState } from 'react';
import { ActionMenu } from './ActionMenu';
import { Dialog } from './Dialog';
import { ErrorBoundary } from './ErrorBoundary';
import { Button } from './states';
import { useToast } from './Toast';
import { Card } from './forms';

const MESSAGGIO_TOAST = 'Documento archiviato. Lo trovi nella sezione Archivio.';

export const FinestraModale = () => {
  const [aperta, setAperta] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setAperta(true)}>{'Apri la finestra'}</Button>
      <Dialog open={aperta} onClose={() => setAperta(false)} title={'Conferma l’archiviazione'}>
        <p>{'Il documento sarà spostato nell’archivio e non comparirà più fra quelli attivi.'}</p>
        <div className="row-wrap mt-8">
          <Button variant="primary" onClick={() => setAperta(false)}>{'Archivia'}</Button>
          <Button variant="ghost" onClick={() => setAperta(false)}>{'Annulla'}</Button>
        </div>
      </Dialog>
    </>
  );
};

export const Avviso = () => {
  const { showToast } = useToast();
  return (
    <Card title={'Il toast arriva dal contesto globale delle storie'}>
      <Button onClick={() => showToast(MESSAGGIO_TOAST)}>{'Mostra il toast'}</Button>
    </Card>
  );
};

export const MenuDiTrabocco = () => (
  <Card title={'Le azioni rare, con il pulsante che le raccoglie'}>
    <div className="row-wrap">
      <span>{'Fattura 2026-041 — Officina Bianchi Sagl'}</span>
      <ActionMenu
        label={'Altre azioni'}
        items={[
          { key: 'stampa', label: 'Stampa', icon: 'document', onSelect: () => undefined },
          { key: 'archivia', label: 'Archivia', icon: 'archive', onSelect: () => undefined },
          {
            key: 'scarica',
            label: 'Scarica il PDF',
            icon: 'download',
            onSelect: () => undefined,
            disabled: true,
            hint: 'Disponibile al termine dell’analisi.',
          },
          { key: 'elimina', label: 'Elimina', icon: 'trash', danger: true, onSelect: () => undefined },
        ]}
      />
    </div>
  </Card>
);

/* Figlio che fallisce di proposito: serve a mostrare la scheda che la rete
   mette al posto della schermata rotta. L'errore resta in console — è la
   regola del componente, che stampa e non inghiotte. */
const FiglioRotto = (): never => {
  throw new Error('relevance_level fuori elenco (guasto di esempio)');
};

export const ReteDegliErrori = () => (
  <>
    <Card title={'Contenuto sano: la rete non si vede'}>
      <ErrorBoundary chiave="sano">
        <p>{'Quando il contenuto funziona, l’ErrorBoundary è trasparente.'}</p>
      </ErrorBoundary>
    </Card>
    <Card title={'Contenuto rotto: la rete mostra la sua scheda'}>
      <ErrorBoundary chiave="rotto">
        <FiglioRotto />
      </ErrorBoundary>
    </Card>
  </>
);
