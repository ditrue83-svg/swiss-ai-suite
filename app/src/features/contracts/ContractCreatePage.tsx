// ============================================================================
// Nuovo contratto.
//
// ⚠️ §132 — SI CREA IN UN ISTANTE, L'ESTRAZIONE ARRIVA DOPO. Un contratto può
// nascere senza alcun documento: il PDF si collega quando c'è, e nel frattempo
// i termini si possono scrivere a mano. Obbligare a caricare un documento per
// creare un contratto significherebbe non poter registrare un accordo che
// esiste ma il cui file non è ancora arrivato.
//
// ⚠️ Il contratto nasce SEMPRE «da verificare»: nessun percorso lo fa nascere
// verificato, perché la verifica è un gesto umano su dati letti (§82).
// ============================================================================
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCompany } from '@/contexts/CompanyContext';
import { useToast } from '@/components/ui/Toast';
import { ErrorState } from '@/components/ui/states';
import { contractService } from '@/services/contractService';
import { documentService } from '@/services/documentService';
import { memberService } from '@/services/memberService';
import { toUserMessage } from '@/lib/errors';
import { useT } from '@/i18n';
import { useLabels } from '@/i18n/labels';
import type { AssignableMember, ContractType } from '@/types/models';

const CONTRACT_TYPES: ContractType[] = [
  'insurance', 'leasing', 'rent', 'telecom', 'software_subscription',
  'supplier', 'maintenance', 'service', 'licensing', 'nda', 'other',
];

export function ContractCreatePage() {
  const { activeCompany: company } = useCompany();
  const t = useT();
  const L = useLabels();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // §79 — si arriva anche dal Document Hub, con il documento già scelto.
  const fromDocument = params.get('documento');

  const [name, setName] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [type, setType] = useState<ContractType>('other');
  const [owner, setOwner] = useState('');
  const [members, setMembers] = useState<AssignableMember[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!company) return;
    memberService.listAssignable(company.id)
      .then(setMembers)
      .catch(() => setMembers([]));
    // Il titolo del documento è un buon punto di partenza per il nome, e resta
    // modificabile: è metadato organizzativo, non un dato del contratto (§31).
    if (fromDocument) {
      documentService.get(fromDocument)
        .then((d) => { if (d?.title) setName((n) => n || d.title); })
        .catch(() => undefined);
    }
  }, [company, fromDocument]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!company || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const id = await contractService.create({
        companyId: company.id,
        displayName: name,
        contractType: type,
        counterpartyName: counterparty || null,
        ownerUserId: owner || null,
      });
      // Se si arriva da un documento, lo si collega subito come accordo
      // principale: è la ragione per cui si è premuto quel pulsante.
      if (fromDocument) {
        await contractService.addDocument({
          companyId: company.id, contractId: id,
          documentId: fromDocument, relation: 'main_agreement',
        });
      }
      showToast(t('contracts.create.created'));
      navigate(`/contratti/${id}`);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ct-narrow">
      <div className="page-title">{t('contracts.create.title')}</div>

      {error && <ErrorState message={error} />}

      <form onSubmit={submit} className="stack-sm">
        {/* ⚠️ Ogni campo dentro `.field`: senza quel contenitore l'input mostra
            lo sfondo bianco del browser con sopra il testo chiaro del tema
            scuro. È la regola nata dal dettaglio delle Attività. */}
        <div className="field">
          <label htmlFor="c-name">{t('contracts.create.name')}</label>
          <input
            id="c-name" type="text" required value={name}
            placeholder={t('contracts.create.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="muted-sm">{t('contracts.create.nameHint')}</p>
        </div>

        <div className="field">
          <label htmlFor="c-counterparty">{t('contracts.create.counterparty')}</label>
          <input
            id="c-counterparty" type="text" value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="c-type">{t('contracts.create.type')}</label>
          <select id="c-type" value={type} onChange={(e) => setType(e.target.value as ContractType)}>
            {CONTRACT_TYPES.map((v) => (
              <option key={v} value={v}>{L.contractType(v)}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="c-owner">{t('contracts.create.owner')}</label>
          <select id="c-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{t('contracts.row.noOwner')}</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.name || m.userId.slice(0, 8)}</option>
            ))}
          </select>
          {/* §8 — la distinzione che il prodotto non deve lasciare implicita. */}
          <p className="muted-sm">{t('contracts.create.ownerHint')}</p>
        </div>

        <div className="row-wrap">
          <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
            {t('contracts.create.submit')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/contratti')}>
            {t('common.cancel')}
          </button>
        </div>
      </form>

      <p className="legal-note">{t('contracts.disclaimer')}</p>
    </div>
  );
}
