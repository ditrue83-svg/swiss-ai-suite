// ============================================================================
// Storie del vocabolario dei segni: le nove famiglie di marcature, l'evidenza,
// la legenda, i glifi e le etichette (`Tag`).
//
// ⚠️ Il testo di esempio sta fra graffe per `i18n:coverage` — vedi la nota in
// testa a `forms.stories.tsx`. Le etichette dei segni arrivano invece dai
// dizionari, perché sono i componenti stessi a tradurle: qui si vedono nella
// lingua scelta con il selettore in `controls.stories.tsx`.
// ============================================================================
import type { ReactNode } from 'react';
import { AppointmentMark } from './AppointmentMark';
import { ConfidenceBadge, CONFIDENCE_LEVELS } from './ConfidenceBadge';
import { DeadlineMark } from './DeadlineMark';
import { EligibilityMark, ELIGIBILITY_STATES, type EligibilityValue } from './EligibilityMark';
import { EvidenceLink } from './EvidenceLink';
import { MarkGlyph, GLYPH_NAMES } from './MarkGlyph';
import { MarkLegend } from './MarkLegend';
import { PriorityMark, PRIORITY_LEVELS, type PriorityValue } from './PriorityMark';
import { ActionOriginMark, ProvenanceMark, PROVENANCE_KINDS, type ProvenanceKind } from './ProvenanceMark';
import { SourceStamp, SOURCE_STATES, type SourceState } from './SourceStamp';
import { StatusMark, TASK_STATES } from './StatusMark';
import { Tag, type TagTone } from './Tag';
import { WindowMark, WINDOW_STATES } from './WindowMark';
import type { Confidence, TaskStatus } from '@/types/models';
import type { SubsidyCallStatus } from '@/types/database';

/* Ogni famiglia viene iterata sulla STESSA mappa che il componente esporta:
   uno stato aggiunto al componente compare da solo nella storia, come già
   avviene nella legenda — la storia non può invecchiare. */
const Famiglia = ({ titolo, children }: { titolo: string; children: ReactNode }) => (
  <section className="card">
    <div className="card-title">{titolo}</div>
    <div className="row-wrap">{children}</div>
  </section>
);

/* Date relative a oggi: una data fissa cambierebbe stato col passare dei
   giorni, e la storia finirebbe per mostrare uno stato diverso da quello che
   il suo nome promette. */
const iso = (giorniDaOggi: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + giorniDaOggi);
  return d.toISOString().slice(0, 10);
};

export const Confidenza = () => (
  <Famiglia titolo={'Confidenza — la triade di punti'}>
    {(Object.keys(CONFIDENCE_LEVELS) as Confidence[]).map((k) => <ConfidenceBadge key={k} level={k} />)}
  </Famiglia>
);

export const StatoDelLavoro = () => (
  <Famiglia titolo={'Stato del lavoro — la casella che si riempie'}>
    {(Object.keys(TASK_STATES) as TaskStatus[]).map((k) => <StatusMark key={k} status={k} />)}
  </Famiglia>
);

export const Priorita = () => (
  <Famiglia titolo={'Priorità — la direzione è il segno (entrambe le scale di dominio)'}>
    {(Object.keys(PRIORITY_LEVELS) as PriorityValue[]).map((k) => <PriorityMark key={k} level={k} />)}
  </Famiglia>
);

export const Idoneita = () => (
  <Famiglia titolo={'Idoneità — glifo di giudizio + parola'}>
    {(Object.keys(ELIGIBILITY_STATES) as EligibilityValue[]).map((k) => <EligibilityMark key={k} status={k} />)}
  </Famiglia>
);

export const Fonte = () => (
  <Famiglia titolo={'Fonte — il timbro d’archivio'}>
    {(Object.keys(SOURCE_STATES) as SourceState[]).map((k) => (
      <SourceStamp key={k} state={k} date={k === 'demo' ? null : '12.08.2026'} />
    ))}
  </Famiglia>
);

export const FinestraDiCandidatura = () => (
  <Famiglia titolo={'Finestra di candidatura — la parentesi'}>
    {(Object.keys(WINDOW_STATES) as SubsidyCallStatus[]).map((k) => <WindowMark key={k} status={k} />)}
  </Famiglia>
);

export const Termine = () => (
  <Famiglia titolo={'Termine — le cifre sono il segno'}>
    <DeadlineMark date={iso(45)} display={'12.10.2026'} />
    <DeadlineMark date={iso(3)} display={'31.08.2026'} />
    <DeadlineMark date={iso(0)} display={'28.08.2026'} />
    <DeadlineMark date={iso(-5)} display={'23.08.2026'} />
    <DeadlineMark date={null} />
    <DeadlineMark date={iso(20)} toVerify display={'17.09.2026'} />
  </Famiglia>
);

export const Appuntamento = () => (
  <Famiglia titolo={'Appuntamento — il giorno in cui qualcosa accade'}>
    <AppointmentMark date={iso(30)} display={'27.09.2026'} />
    <AppointmentMark date={iso(2)} display={'30.08.2026'} />
    <AppointmentMark date={iso(0)} display={'28.08.2026'} />
    <AppointmentMark date={iso(-4)} display={'24.08.2026'} />
  </Famiglia>
);

export const Provenienza = () => (
  <Famiglia titolo={'Provenienza — il filetto verticale, e l’origine di un’azione'}>
    {(Object.keys(PROVENANCE_KINDS) as ProvenanceKind[]).map((k) => <ProvenanceMark key={k} kind={k} />)}
    <ActionOriginMark source="extracted" />
    <ActionOriginMark source="suggested" />
  </Famiglia>
);

export const Evidenza = () => (
  <Famiglia titolo={'Evidenza — la citazione in linea'}>
    <EvidenceLink
      quote={'La presente fattura deve essere saldata entro il 30 settembre 2026.'}
      page={2}
    />
    <EvidenceLink quote={'Citazione non ritrovata nel testo estratto.'} verified={false} />
    <EvidenceLink quote={null} />
  </Famiglia>
);

export const Glifi = () => (
  <Famiglia titolo={'I glifi delle marcature, uno per nome'}>
    {GLYPH_NAMES.map((nome) => (
      <span key={nome} className="row-wrap" style={{ gap: 4 }}>
        <MarkGlyph name={nome} />
        <code>{nome}</code>
      </span>
    ))}
  </Famiglia>
);

const TONI: TagTone[] = ['neutral', 'info', 'attention', 'ok', 'alert'];

export const Etichette = () => (
  <Famiglia titolo={'Tag — la parola che classifica, nei cinque toni'}>
    <Tag>{'Contratto di locazione'}</Tag>
    <Tag tone="info">{'Fase pilota'}</Tag>
    <Tag tone="attention">{'Firma richiesta'}</Tag>
    <Tag tone="ok">{'Pagata'}</Tag>
    <Tag tone="alert">{'Analisi fallita'}</Tag>
    {TONI.map((tono) => <Tag key={tono} tone={tono}>{tono}</Tag>)}
  </Famiglia>
);

/* La legenda compare SOLO se nella pagina c'è almeno un segno da spiegare (lo
   decide lei, contando i `.mark` nel DOM): la storia le mette accanto qualche
   segno proprio perché questo meccanismo si veda in funzione. */
export const Legenda = () => (
  <>
    <div className="row-wrap">
      <StatusMark status="in_progress" />
      <PriorityMark level="high" />
      <DeadlineMark date={iso(6)} display={'03.09.2026'} />
    </div>
    <MarkLegend />
  </>
);
