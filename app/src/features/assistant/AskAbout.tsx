// ============================================================================
// «Chiedi ad AI-Swisse» dalle schede di dettaglio (§120)
//
// Un collegamento, non un pannello: apre l'assistente con la scheda già in
// contesto. Il contesto viaggia nell'indirizzo (`?su=tipo:id&nome=…`) e il
// SERVER lo rilegge dal database prima di usarlo (§122) — l'etichetta qui
// serve solo a mostrare la pastiglia mentre la pagina si apre, e se fosse
// manomessa non cambierebbe di una virgola ciò che l'assistente legge.
//
// ⚠️ NON si copia il record nel collegamento. Andrebbe a finire nella cronologia
// del browser e in ogni indirizzo condiviso: l'assistente ha già i permessi per
// leggerlo, e passarglielo sarebbe copiare un dato aziendale dove non serve.
// ============================================================================
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { useT, type TKey } from '@/i18n';
import { askAboutHref, type EntityContextType } from './assistantModel';

const LABEL: Record<EntityContextType, TKey> = {
  contract: 'assistant.context.askContract',
  crm_organization: 'assistant.context.askClient',
  finance_item: 'assistant.context.askFinance',
  document: 'assistant.context.askDocument',
  task: 'assistant.context.ask',
};

export function AskAbout({
  type, id, label, className,
}: { type: EntityContextType; id: string; label: string; className?: string }) {
  const t = useT();
  return (
    <Link className={className ?? 'btn btn-sm'} to={askAboutHref(type, id, label)}>
      <Icon name="askAi" className="ic-sm" /> {t(LABEL[type])}
    </Link>
  );
}
