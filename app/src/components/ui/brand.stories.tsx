// ============================================================================
// Storie del marchio e dei segni grafici: BrandMark/BrandBlock (i contorni
// stanno in `brandArt.ts`, coperto attraverso di essi), le scene degli stati
// vuoti (`emptyArt.tsx`) e la famiglia delle icone (`Icon.tsx`).
//
// ⚠️ Il testo di esempio sta fra graffe per `i18n:coverage` — vedi la nota in
// testa a `forms.stories.tsx`.
// ============================================================================
import { BrandBlock, BrandMark } from './BrandMark';
import { EmptyArt, type EmptyArtName } from './emptyArt';
import { Icon, ICONS, type IconName } from './Icon';
import { Card } from './forms';

export const Marchio = () => (
  <>
    <Card title={'Il lockup completo, con il motto'}>
      <div style={{ maxWidth: 320 }}><BrandMark /></div>
    </Card>
    <Card title={'Riga di contesto in maiuscoletto (la forma della shell)'}>
      <div style={{ maxWidth: 320 }}><BrandMark taglineKey="nav.workspace" caps /></div>
    </Card>
    <Card title={'Senza la riga sotto (barra stretta del telefono)'}>
      <div style={{ maxWidth: 320 }}><BrandMark tagline={false} /></div>
    </Card>
    <Card title={'Il solo blocco, per gli spazi quadrati'}>
      <div style={{ maxWidth: 64 }}><BrandBlock /></div>
    </Card>
  </>
);

const SCENE: EmptyArtName[] = ['document', 'inbox', 'calendar', 'opportunity'];

export const SceneDegliStatiVuoti = () => (
  <Card title={'Le quattro scene, una per modulo'}>
    <div className="row-wrap">
      {SCENE.map((nome) => (
        <figure key={nome} style={{ margin: 0, textAlign: 'center' }}>
          <EmptyArt name={nome} />
          <figcaption><code>{nome}</code></figcaption>
        </figure>
      ))}
    </div>
  </Card>
);

/* La famiglia intera, iterata su ICONS: un'icona aggiunta al componente
   compare da sola nella storia. */
export const Icone = () => (
  <Card title={'Tutte le icone, col loro nome'}>
    <div className="row-wrap">
      {(Object.keys(ICONS) as IconName[]).map((nome) => (
        <span key={nome} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name={nome} />
          <code>{nome}</code>
        </span>
      ))}
    </div>
  </Card>
);
