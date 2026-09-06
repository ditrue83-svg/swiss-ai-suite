# Verifica visiva — riallineamento Panoramica (2026-09-06)

Confronto Playwright a dimensione identica fra l'app locale costruita dal
branch `design/mockup-pixel-align` e `panoramica-ai-swisse.html`. Le acquisizioni
dell'app usano l'utente demo reale; `prefers-reduced-motion: reduce` rende il
fotogramma deterministico e verifica anche il ramo senza animazioni.
Prima del salvataggio, nome del profilo, azienda, iniziali e titolo dell'attività
sono sostituiti nel DOM con etichette fittizie: le immagini non pubblicano dati
della sessione autenticata.

| Misura | App chiara | App scura | Riferimento |
|---|---|---|---|
| 1440 × 900 | [panoramica-1440-light.png](panoramica-1440-light.png) | [panoramica-1440-dark.png](panoramica-1440-dark.png) | [riferimento-1440.png](riferimento-1440.png) |
| 375 × 800 | [panoramica-375-light.png](panoramica-375-light.png) | [panoramica-375-dark.png](panoramica-375-dark.png) | [riferimento-375.png](riferimento-375.png) |

Esito del confronto:

- a 1440 px la topbar porta `Operativo › Panoramica`, il titolo di pagina e
  l'unica CTA; la vecchia testata duplicata nel contenuto non compare più;
- le etichette KPI non hanno icone, i valori usano Sora 600 a 36 px e la
  sparkline resta soltanto sulla serie storica realmente disponibile;
- a 375 px la striscia passa a 2 × 2 senza overflow, in entrambi i temi;
- azzurro `#37AEEF`, inchiostro scuro `--on-accent` e geometrie della shell
  restano invariati rispetto alle decisioni del restyle.

Il tenant demo fotografato non contiene documenti `to_verify`; perciò il
segnale in topbar non è presente in queste immagini. La regressione reale è
stata riprodotta separatamente sulla produzione con lettura di sola testata:
`0` attivi + `16` archiviati. Il banco `test:shell-unit` impedisce di tornare a
leggere la sola popolazione attiva o a sostituire un errore di lettura con zero.
