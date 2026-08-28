// ============================================================================
// Storie degli stati riutilizzabili (`states.tsx`): Button, indicatori di
// attesa, errore, vuoto e scheletri.
//
// ⚠️ Il testo di esempio sta fra graffe per `i18n:coverage` — vedi la nota in
// testa a `forms.stories.tsx`.
// ============================================================================
import {
  Button, EmptyCta, ErrorState, FullScreenLoader,
  SkeletonCard, SkeletonKpiGrid, SkeletonLine, Spinner,
} from './states';
import { Card } from './forms';

export const Pulsanti = () => (
  <Card title={'Le quattro varianti, nei due stati che contano'}>
    <div className="row-wrap">
      <Button variant="primary">{'Analizza documento'}</Button>
      <Button>{'Apri'}</Button>
      <Button variant="ghost">{'Annulla'}</Button>
      <Button variant="danger">{'Elimina'}</Button>
    </div>
    <div className="row-wrap mt-8">
      <Button variant="primary" loading>{'Analisi in corso…'}</Button>
      <Button disabled>{'Non disponibile'}</Button>
      <Button size="sm" icon="download">{'Scarica'}</Button>
      <Button size="sm" icon="refresh" loading>{'Aggiorno'}</Button>
    </div>
  </Card>
);

export const Attesa = () => (
  <Card title={'Spinner'}>
    <div className="row-wrap">
      <Spinner />
      <Spinner large />
    </div>
  </Card>
);

/* Il caricatore a schermo intero copre la sua area con `.app-loading`: nella
   storia sta dentro una scheda per non invadere l'intera finestra di Ladle. */
export const AttesaSchermoIntero = () => (
  <FullScreenLoader label={'Apertura dello spazio di lavoro…'} />
);

export const Errore = () => (
  <>
    <ErrorState
      message={'L’analisi non è andata a buon fine. Nessun dato è stato modificato.'}
      onRetry={() => undefined}
    />
    <div className="mt-8">
      <ErrorState message={'Il documento non è raggiungibile.'} />
    </div>
  </>
);

export const Vuoto = () => (
  <>
    <Card title={'Con icona'}>
      <EmptyCta
        icon="document"
        title={'Nessun documento analizzato'}
        subtitle={'Carica il primo documento per vedere qui i risultati.'}
        action={<Button variant="primary" icon="upload">{'Carica un documento'}</Button>}
      />
    </Card>
    <Card title={'Con scena (`art`)'}>
      <EmptyCta
        art="inbox"
        title={'La inbox è vuota'}
        subtitle={'Le lettere in arrivo dall’amministrazione compariranno qui.'}
      />
    </Card>
  </>
);

export const Scheletri = () => (
  <>
    <Card title={'Righe'}>
      <SkeletonLine />
      <SkeletonLine width="60%" />
      <SkeletonLine width="35%" />
    </Card>
    <Card title={'Griglia KPI (forma Panoramica, `lead`)'}>
      <SkeletonKpiGrid lead />
    </Card>
    <Card title={'Griglia KPI standard'}>
      <SkeletonKpiGrid />
    </Card>
    <SkeletonCard />
  </>
);
