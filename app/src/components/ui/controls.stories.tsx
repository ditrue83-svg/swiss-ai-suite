// ============================================================================
// Storie dei controlli d'ambiente: la lingua dell'interfaccia, il tema e il
// pulsante di stampa. Lingua e tema AGISCONO DAVVERO sull'ambiente delle
// storie: cambiare lingua qui ritraduce i segni delle altre storie.
//
// ⚠️ Il testo di esempio sta fra graffe per `i18n:coverage` — vedi la nota in
// testa a `forms.stories.tsx`.
// ============================================================================
import { LanguageSwitcher } from './LanguageSwitcher';
import { PrintButton } from './PrintButton';
import { ThemeSwitcher } from './ThemeSwitcher';
import { Card } from './forms';

export const Lingua = () => (
  <Card title={'Le opzioni sono scritte nella lingua che offrono'}>
    <div style={{ maxWidth: 280 }}>
      <LanguageSwitcher />
      <LanguageSwitcher compact />
    </div>
  </Card>
);

export const Tema = () => (
  <Card title={'Chiaro, scuro, o quello del sistema'}>
    <div style={{ maxWidth: 280 }}>
      <ThemeSwitcher />
      <ThemeSwitcher compact />
    </div>
  </Card>
);

export const Stampa = () => (
  <Card title={'Stampa ciò che si vede, con gli stili di stampa'}>
    <div className="row-wrap">
      <PrintButton />
      <PrintButton label={'Esporta il riepilogo'} />
    </div>
  </Card>
);
