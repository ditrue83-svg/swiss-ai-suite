// ============================================================================
// BottomBar — la navigazione inferiore del telefono (Fase 3.1, 2026-09-10).
//
// PERCHÉ ESISTE. Su mobile la navigazione era solo il cassetto dell'hamburger:
// due tocchi per qualunque destinazione. Chi amministra da un cantiere o da
// un cantiere diverso ogni giorno (la PMI a cui parla il prodotto) ha tre
// mete al giorno — Oggi, Attività, Clienti — e un'AZIONE (il ✚): queste
// stanno sotto il pollice. Tutto il resto resta nel cassetto, che la voce
// «Menu» apre.
//
// LE REGOLE:
//   - nessun CONTATORE: vale il divieto scritto in testa a `nav.ts` — un
//     numero in barra è una query in più per ogni cambio pagina;
//   - il ✚ apre un FOGLIO di azioni rapide, non una pagina: «Nuova nota» e
//     «Detta una nota» portano a /oggi con il modulo aperto (?nota=1),
//     «Carica documento» ad /admin (?carica=1) — le destinazioni sono rotte
//     vere, così il gesto sopravvive a un ricaricamento;
//   - «Detta una nota» compare SOLO dove la Web Speech API esiste: un'azione
//     che non può funzionare non si mostra (Firefox: tastiera e basta);
//   - le azioni CRM compaiono solo con i moduli attivi (D-10), come le voci
//     della colonna laterale.
// ============================================================================
import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { LEGACY_MODULES_ENABLED } from '@/lib/env';
import { speechRecognition } from '@/lib/dettatura';
import { useT, type TKey } from '@/i18n';
import { navItemMatches } from './nav';
import type { IconName } from '@/components/ui/Icon';

interface VoceBarra {
  path: string;
  icon: IconName;
  labelKey: TKey;
  alsoMatches?: string[];
}

export function BottomBar({ onMenu }: { onMenu: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [foglio, setFoglio] = useState(false);
  // La disponibilità si legge una volta: non cambia durante la sessione.
  const [dettatura] = useState(() => speechRecognition() !== null);

  const voci: VoceBarra[] = [
    { path: '/oggi', icon: 'sun', labelKey: 'nav.today' },
    { path: '/attivita', icon: 'checkCircle', labelKey: 'nav.tasks', alsoMatches: ['/calendario'] },
    ...(LEGACY_MODULES_ENABLED
      ? [{ path: '/clienti', icon: 'user' as const, labelKey: 'nav.clients' as const }]
      : []),
  ];

  // Esc chiude il foglio: la stessa cortesia del cassetto.
  useEffect(() => {
    if (!foglio) return;
    const chiudi = (e: KeyboardEvent) => { if (e.key === 'Escape') setFoglio(false); };
    document.addEventListener('keydown', chiudi);
    return () => document.removeEventListener('keydown', chiudi);
  }, [foglio]);

  function vai(url: string) {
    setFoglio(false);
    navigate(url);
  }

  return (
    <>
      <nav className="bottombar" aria-label={t('nav.bottomNav')}>
        {voci.map((v) => (
          <NavLink
            key={v.path}
            to={v.path}
            className={({ isActive }) =>
              `bb-item${isActive || navItemMatches(v, pathname) ? ' active' : ''}`
            }
          >
            <Icon name={v.icon} />
            <span>{t(v.labelKey)}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className="bb-fab"
          aria-label={t('quick.title')}
          aria-expanded={foglio}
          aria-haspopup="dialog"
          onClick={() => setFoglio((v) => !v)}
        >
          <Icon name="plus" />
        </button>
        <button type="button" className="bb-item" onClick={onMenu}>
          <Icon name="menu" />
          <span>{t('nav.menu')}</span>
        </button>
      </nav>

      {foglio && (
        <>
          <div className="qsheet-overlay" onClick={() => setFoglio(false)} />
          <div className="qsheet" role="dialog" aria-modal="true" aria-label={t('quick.title')}>
            <div className="qsheet-title">{t('quick.title')}</div>
            {LEGACY_MODULES_ENABLED && (
              <button type="button" className="qsheet-action" onClick={() => vai('/oggi?nota=1')}>
                <Icon name="plus" /> {t('quick.newNote')}
              </button>
            )}
            {LEGACY_MODULES_ENABLED && dettatura && (
              <button type="button" className="qsheet-action" onClick={() => vai('/oggi?nota=1&dettatura=1')}>
                <Icon name="mic" /> {t('quick.dictateNote')}
              </button>
            )}
            <button type="button" className="qsheet-action" onClick={() => vai('/admin?carica=1')}>
              <Icon name="upload" /> {t('documents.upload')}
            </button>
          </div>
        </>
      )}
    </>
  );
}
