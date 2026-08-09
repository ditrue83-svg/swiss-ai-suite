// ============================================================================
// La scheda che esiste SOLO su carta.
//
// A schermo non compare mai (`.print-only` è `display:none` fuori da
// `@media print`): serve a mettere sul foglio ciò che a video è un comando o un
// dettaglio che si apre. Il caso d'uso è il fascicolo del cliente di una
// fiduciaria, e ogni sezione qui sotto esiste perché in un fascicolo serve.
//
// ⚠️ NON DUPLICA LA PAGINA. Ciò che a schermo è già testo — il riassunto, la
// categoria, le note — resta dov'è e viene stampato dalla pagina stessa. Qui
// c'è solo ciò che altrimenti la carta PERDEREBBE: le citazioni per esteso, il
// tipo della scadenza, il tipo degli importi, la provenienza delle azioni, gli
// URL scritti a mano e il piè di pagina d'archivio.
// ============================================================================
import { useT } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import type { ChecklistAction } from '@/types/models';
import type { PrintCitation, PrintFooter } from './printModel';
import type { TKey } from '@/i18n';

export interface PrintSheetProps {
  /** Titolo del foglio: che cosa si sta archiviando. */
  title: string;
  /** Identificazione: ente, tipo, data, riferimenti. Le voci vuote non entrano. */
  facts?: { labelKey: TKey; value: string | null | undefined }[];
  /** Scadenza già formattata, con la chiave del suo tipo. */
  deadline?: { value: string; kindKey: TKey | null } | null;
  /** Importi già formattati, con la chiave del loro tipo. */
  amounts?: { display: string; typeKey: TKey | null; description?: string | null }[];
  /** Azioni divise per provenienza (vedi `splitActions`). */
  actions?: { requested: ChecklistAction[]; suggested: ChecklistAction[] } | null;
  /** Le citazioni, per esteso. È la ragione per cui questa scheda esiste. */
  citations?: PrintCitation[];
  /** Elementi che l'analisi dichiara da verificare. */
  toVerify?: string[];
  /** Fonti ufficiali: l'URL si stampa per esteso accanto al collegamento. */
  sources?: { label: string; url: string }[];
  footer: PrintFooter;
}

export function PrintSheet({
  title, facts = [], deadline = null, amounts = [], actions = null,
  citations = [], toVerify = [], sources = [], footer,
}: PrintSheetProps) {
  const t = useT();
  const shownFacts = facts.filter((f) => (f.value ?? '').toString().trim() !== '');

  return (
    <section className="print-only print-sheet" aria-hidden="true">
      <h2>{title}</h2>

      {shownFacts.length > 0 && (
        <>
          <h3>{t('print.section.identification')}</h3>
          {shownFacts.map((f) => (
            <dl className="print-kv" key={f.labelKey}>
              <dt>{t(f.labelKey)}</dt>
              <dd>{f.value}</dd>
            </dl>
          ))}
        </>
      )}

      {(deadline || amounts.length > 0) && (
        <>
          <h3>{t('print.section.deadlineAndAmounts')}</h3>
          {deadline && (
            <dl className="print-kv">
              <dt>{t('print.deadline.label')}</dt>
              {/* ⚠️ Il TIPO accanto alla data, sempre. Una scadenza «da
                  verificare» stampata come una data qualunque diventa un
                  termine accertato dentro un fascicolo. */}
              <dd>{deadline.value}{deadline.kindKey ? ` — ${t(deadline.kindKey)}` : ''}</dd>
            </dl>
          )}
          {amounts.map((a, i) => (
            <dl className="print-kv" key={`${a.display}-${i}`}>
              <dt>{t('print.amount.label')}</dt>
              <dd>
                {a.display}
                {a.typeKey ? ` — ${t(a.typeKey)}` : ''}
                {a.description ? ` · ${a.description}` : ''}
              </dd>
            </dl>
          ))}
        </>
      )}

      {actions && (actions.requested.length > 0 || actions.suggested.length > 0) && (
        <>
          <h3>{t('print.section.actions')}</h3>
          {/* ⚠️ DUE ELENCHI SEPARATI, non uno con un'etichetta accanto: davanti
              a un cliente «lo chiede l'autorità» e «lo suggeriamo noi» non
              hanno lo stesso peso, e in un elenco unico la distinzione si perde
              alla prima lettura veloce. */}
          {actions.requested.length > 0 && (
            <>
              <dl className="print-kv"><dt>{t('print.actions.requested')}</dt></dl>
              <ul className="print-list">
                {actions.requested.map((a) => <li key={a.id}>{a.text}</li>)}
              </ul>
            </>
          )}
          {actions.suggested.length > 0 && (
            <>
              <dl className="print-kv"><dt>{t('print.actions.suggested')}</dt></dl>
              <ul className="print-list">
                {actions.suggested.map((a) => <li key={a.id}>{a.text}</li>)}
              </ul>
            </>
          )}
        </>
      )}

      {citations.length > 0 && (
        <>
          <h3>{t('print.section.citations')}</h3>
          <p className="print-url">{t('print.citations.intro')}</p>
          {citations.map((c, i) => (
            <div key={`${c.labelKey}-${i}`}>
              <dl className="print-kv">
                <dt>{t(c.labelKey)}</dt>
                {c.subject && <dd>{c.subject}</dd>}
              </dl>
              {/* Le virgolette le mette il CSS (`.print-quote::before/::after`):
                  scritte qui sarebbero testo dentro il JSX, cioè la cosa che
                  `i18n:coverage` vieta — e in Svizzera i caporali valgono per
                  tutte e tre le lingue, quindi non hanno bisogno del dizionario. */}
              <blockquote className="print-quote">
                {c.quote}
                {c.page !== null && (
                  <span className="print-quote-src"> — {t('print.citations.page', { n: String(c.page) })}</span>
                )}
              </blockquote>
            </div>
          ))}
        </>
      )}

      {toVerify.length > 0 && (
        <>
          <h3>{t('print.section.toVerify')}</h3>
          <ul className="print-list">
            {toVerify.map((v, i) => <li key={i}>{v}</li>)}
          </ul>
        </>
      )}

      {sources.length > 0 && (
        <>
          <h3>{t('print.section.sources')}</h3>
          {sources.map((s, i) => (
            <dl className="print-kv" key={`${s.url}-${i}`}>
              <dt>{s.label}</dt>
              {/* L'indirizzo per esteso: un collegamento stampato senza URL è un
                  vicolo cieco, e questo foglio vive dove non si può cliccare. */}
              <dd className="print-url">{s.url}</dd>
            </dl>
          ))}
        </>
      )}

      <div className="print-foot">
        <p>{t('print.footer.company', { name: footer.companyName || t('print.footer.companyUnknown') })}</p>
        <p>{t('print.footer.printedAt', { when: formatDateTime(footer.printedAt) })}</p>
        <p>
          {t('print.footer.model', { model: footer.model ?? t('print.footer.modelUnknown') })}
          {footer.version ? ` · ${t('print.footer.version', { version: footer.version })}` : ''}
        </p>
        {/* ⚠️ La riga che dichiara il limite non è un formalismo: questo foglio
            finisce in un fascicolo e sarà riletto da qualcuno che non c'era
            quando è stato prodotto. */}
        <p className="print-disclaimer">{t('print.footer.disclaimer')}</p>
      </div>
    </section>
  );
}
