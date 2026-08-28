// ============================================================================
// cx — compone classi CSS. Nato con la migrazione a CSS Modules (issue #83):
// prima una classe condizionale era un template literal
// (`doc-row${selected ? ' is-selected' : ''}`), con i moduli le classi sono
// valori (`styles.docRow`) e la concatenazione a mano lascia spazi doppi e
// stringhe vuote. `cx` tiene i veri e butta il resto:
//
//   cx(styles.docRow, selected && styles.isSelected)
//
// Cinque righe invece di una dipendenza (clsx/classnames): il progetto ne ha
// sei in tutto e non ne aggiunge una per filtrare i falsy.
// ============================================================================
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
