// ============================================================================
// Storie dei due grafici del prodotto: le barre orizzontali (`Bars.tsx`) e la
// serie storica in miniatura (`Sparkline.tsx`).
//
// ⚠️ Il testo di esempio sta fra graffe per `i18n:coverage` — vedi la nota in
// testa a `forms.stories.tsx`.
// ============================================================================
import { Bars } from './Bars';
import { Sparkline } from './Sparkline';
import { Card } from './forms';

export const Barre = () => (
  <Card title={'Documenti per urgenza (la forma dell’archivio)'}>
    <Bars
      rows={[
        { cat: 'Urgenti', val: 4, cls: 's-alta', dotCls: 'dot-alta' },
        { cat: 'Di media urgenza', val: 7, cls: 's-media', dotCls: 'dot-media' },
        { cat: 'Non urgenti', val: 3, cls: 's-bassa', dotCls: 'dot-bassa' },
        { cat: 'In attesa di analisi', val: 12 },
        { cat: 'Categoria vuota', val: 0 },
      ]}
    />
  </Card>
);

export const SerieStorica = () => (
  <Card title={'Analisi per settimana, ultime otto'}>
    <div className="row-wrap">
      <Sparkline data={[2, 5, 3, 8, 6, 9, 4, 7]} />
      <Sparkline data={[0, 0, 0, 0, 0, 0, 0, 0]} width={120} height={32} />
    </div>
    <p className="field-hint">
      {'La serie piatta resta visibile: una settimana vuota è un dato, non l’assenza del grafico.'}
    </p>
  </Card>
);
