// ============================================================================
// LA FINESTRA DELLE IMPOSTAZIONI — una colonnina di voci a sinistra, il
// pannello scelto a destra.
//
// PERCHÉ UNA FINESTRA E NON PIÙ UN GRUPPO NELLA BARRA. Fino al 2026-08-17
// «Impostazioni» era una voce che si apriva dentro la colonna e ne aggiungeva
// quattro: 124px in più in una colonna che aveva 3,42px di margine (vedi la
// sezione 13 di `test:shell-unit`). Il momento in cui si va a cercare
// un'impostazione era esattamente il momento in cui la navigazione cominciava a
// scorrere. E le impostazioni si vedevano una rotta alla volta: per sapere che
// cosa si può configurare bisognava aprirle tutte.
//
// ⚠️ NON TUTTO ENTRA IN UNA FINESTRA, e `nav.ts` lo dichiara con `apre`.
// Automazioni ha un costruttore con cinque sotto-rotte, il Registro attività è
// una tabella lunga: sono luoghi in cui si LAVORA. Le loro voci ci sono — è da
// lì che le si è sempre raggiunte — ma aprono la pagina e chiudono la finestra,
// e lo dicono con il segno della freccia invece di fingere un pannello.
//
// ⚠️ LE ROTTE RESTANO TUTTE VIVE. `/preferenze`, `/azienda`, `/prezzi`
// rispondono come prima: un'impostazione raggiungibile solo aprendo una
// finestra non si può mandare a qualcuno in un collegamento, e chi arriva da un
// segnalibro non deve trovare un 404.
// ============================================================================
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { NAV_SETTINGS } from '@/components/layout/nav';
import { useCompany } from '@/contexts/CompanyContext';
import { useT } from '@/i18n';
import { LEGACY_MODULES_ENABLED } from '@/lib/env';
import { cx } from '@/lib/cx';
import { PreferencesPanel } from '@/features/settings/PreferencesPanel';
import { CompanySettings } from '@/features/companies/CompanySettingsPage';
import { CrmFieldsPanel } from '@/features/crm/CrmFieldsPanel';
import { CrmEmailSettingsPanel } from '@/features/crm/CrmEmailSettingsPanel';
import { Pricing } from '@/features/pricing/PricingPage';
import styles from './settings.module.css';

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const t = useT();
  const navigate = useNavigate();
  const { isAdmin } = useCompany();

  // Le voci riservate spariscono per chi non è titolare o amministratore, e
  // quelle dei moduli fuori perimetro se il flag è spento. Il permesso però
  // NON è questo: è la RLS della pagina (vedi nav.ts).
  const voci = NAV_SETTINGS.filter((v) =>
    (!v.adminOnly || isAdmin) && (!v.legacyOnly || LEGACY_MODULES_ENABLED));
  const pannelli = voci.filter((v) => v.apre === 'pannello');
  const [attivo, setAttivo] = useState(pannelli[0]?.id ?? '');

  // Riaprendo la finestra si torna alla prima voce: chi la riapre di solito sta
  // cercando un'altra cosa, e ritrovare il pannello di ieri è disorientante.
  // ⚠️ Si azzera alla CHIUSURA, non all'apertura: azzerare all'apertura farebbe
  // lampeggiare il pannello vecchio per un fotogramma.
  useEffect(() => { if (!open) setAttivo(pannelli[0]?.id ?? ''); }, [open, pannelli]);

  function scegli(id: string, apre: string, path: string) {
    if (apre === 'pannello') { setAttivo(id); return; }
    onClose();
    navigate(path);
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('nav.settings')} className="dialog-settings">
      <div className={styles.settingsLayout}>
        <nav className={styles.settingsRail} aria-label={t('settings.railAria')}>
          {voci.map((v) => (
            <button
              key={v.id}
              type="button"
              className={cx(styles.settingsRailBtn, v.apre === 'pannello' && attivo === v.id && styles.active)}
              // ⚠️ `aria-current` solo per i pannelli: dice «sei qui», e una
              // voce che porta altrove non è un posto in cui si è.
              aria-current={v.apre === 'pannello' && attivo === v.id ? 'true' : undefined}
              onClick={() => scegli(v.id, v.apre, v.path)}
            >
              <span>{t(v.labelKey)}</span>
              {v.apre === 'pagina' && (
                <Icon name="arrowRight" className={cx('ic-sm', styles.settingsRailOut)} aria-hidden="true" />
              )}
            </button>
          ))}
        </nav>

        <div className={styles.settingsPane}>
          {attivo === 'preferences' && <PreferencesPanel sede="pannello" />}
          {attivo === 'company' && <CompanySettings sede="pannello" />}
          {attivo === 'crmFields' && <CrmFieldsPanel sede="pannello" />}
          {attivo === 'crmEmail' && <CrmEmailSettingsPanel />}
          {attivo === 'pricing' && <Pricing sede="pannello" />}
        </div>
      </div>
    </Dialog>
  );
}
