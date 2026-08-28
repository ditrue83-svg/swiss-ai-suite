// ============================================================================
// Storie delle primitive di modulo e della Card (`forms.tsx`).
//
// ⚠️ IL TESTO DI ESEMPIO STA SEMPRE FRA GRAFFE. `npm run i18n:coverage`
// scansiona `src/` e segnala il testo libero fra i tag JSX e gli attributi
// letterali (`label="…"`, `placeholder="…"`): fra graffe è codice e non viene
// raccolto. Le storie sono materiale da banco, non interfaccia, e non hanno
// bisogno dei dizionari — ma non devono nemmeno rompere il controllo che
// difende le schermate vere. Stessa regola in tutte le storie di questa
// cartella.
// ============================================================================
import { Card, Checkbox, Input, Select, Textarea } from './forms';

export const CampiDiTesto = () => (
  <Card title={'Dati dell’azienda'}>
    <Input
      id="ragione-sociale"
      label={'Ragione sociale'}
      placeholder={'Es. Officina Meccanica Bianchi Sagl'}
    />
    <Input
      id="uid"
      label={'Numero UID'}
      hint={'La trovi sul registro di commercio, nel formato CHE-000.000.000.'}
      placeholder={'CHE-123.456.789'}
    />
    <Input
      id="email"
      label={'Email amministrativa'}
      type="email"
      error={'Questo indirizzo non sembra valido: controlla il formato.'}
      defaultValue={'info@officina-bianchi'}
    />
    <Input
      id="telefono"
      label={'Telefono'}
      disabled
      defaultValue={'+41 91 000 00 00'}
    />
  </Card>
);

export const Tendine = () => (
  <Card title={'Classificazione'}>
    <Select id="cantone" label={'Cantone'} hint={'Il cantone della sede principale.'}>
      <option value="">{'—'}</option>
      <option value="TI">{'Ticino'}</option>
      <option value="ZH">{'Zurigo'}</option>
      <option value="GE">{'Ginevra'}</option>
    </Select>
    <Select
      id="forma-giuridica"
      label={'Forma giuridica'}
      error={'Scegli una forma giuridica per continuare.'}
    >
      <option value="">{'—'}</option>
      <option value="sagl">{'Sagl'}</option>
      <option value="sa">{'SA'}</option>
      <option value="ditta">{'Ditta individuale'}</option>
    </Select>
  </Card>
);

export const AreeDiTesto = () => (
  <Card title={'Note'}>
    <Textarea
      id="note-interne"
      label={'Note interne'}
      rows={4}
      hint={'Visibili solo al tuo spazio di lavoro.'}
      placeholder={'Es. La fattura di giugno va inviata al nuovo indirizzo…'}
    />
    <Textarea
      id="osservazioni"
      label={'Osservazioni'}
      rows={3}
      error={'Il testo supera i 500 caratteri consentiti.'}
      defaultValue={'Promemoria per la revisione dei contratti in scadenza…'}
    />
  </Card>
);

export const Caselle = () => (
  <Card title={'Preferenze di notifica'}>
    <Checkbox
      id="notifica-scadenze"
      label={'Avvisami una settimana prima di ogni scadenza'}
      defaultChecked
    />
    <Checkbox
      id="notifica-inbox"
      label={'Segnala i nuovi documenti in inbox'}
      hint={'Una email al giorno, non una per documento.'}
    />
    <Checkbox
      id="consenso"
      label={'Ho letto l’informativa privacy'}
      error={'Senza il consenso non possiamo attivare l’analisi automatica.'}
    />
    <Checkbox
      id="legacy"
      label={'Mantieni le notifiche del vecchio sistema'}
      disabled
    />
  </Card>
);

export const Schede = () => (
  <>
    <Card title={'Con titolo'}>
      <p>{'Il titolo porta il markup `.card-title` già previsto dagli stili.'}</p>
    </Card>
    <Card>
      <p>{'Senza titolo resta solo il contenuto: molte schede sono fatte così.'}</p>
    </Card>
  </>
);
