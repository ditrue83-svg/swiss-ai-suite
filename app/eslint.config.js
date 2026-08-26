// ============================================================================
// ESLint flat config — TypeScript + React 18 + Vite.
//
// ⚠️ INTRODOTTO IN MODALITÀ NON BLOCCANTE. Questa configurazione entra con la
// PR di igiene del repository SENZA riformattare o riscrivere il codice
// esistente. Le regole che oggi segnalerebbero errori sul codice già scritto
// sono messe a "warn" qui sotto, ciascuna con il suo TODO: il cleanup è un
// lavoro a sé, da fare regola per regola, riportandole a "error" man mano.
// ============================================================================
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      // Le Edge Function girano su Deno, non su Node/Vite: il lint va
      // configurato a parte con i globals di Deno.
      // TODO: configurare deno-lint per supabase/functions.
      'supabase/**',
      'public/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Sorgente React (browser)
  {
    files: ['src/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // TODO(cleanup): a "warn" perché il codice esistente le viola e la
      // correzione richiede di toccare src/, fuori dal perimetro di questa PR.
      // Riportarle a "error" una correzione alla volta:
      //   - react-hooks/set-state-in-effect (59 casi): pattern di caricamento
      //     dati scritti prima delle regole React Compiler di
      //     eslint-plugin-react-hooks v7
      //   - react-hooks/rules-of-hooks (1 caso, AutomationsPage.tsx:188)
      //   - react-hooks/purity (1 caso, InboxPage.tsx:390 — Date.now() nel render)
      //   - react-hooks/preserve-manual-memoization (1 caso, CalendarSettingsPage.tsx:80)
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },

  // Script e strumenti (Node)
  {
    files: ['scripts/**/*.{ts,mjs}', '*.{ts,mjs,js}'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // TODO(cleanup): a "warn" perché il codice esistente le viola e la
  // correzione richiede di toccare sorgenti fuori dal perimetro di questa PR.
  // Riportarle a "error" una correzione alla volta:
  //   - no-useless-assignment (5 casi), no-useless-escape (3 casi),
  //     @typescript-eslint/no-unused-expressions (2 casi) — tutti in scripts/
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'no-empty': 'warn',
      'prefer-const': 'warn',
      'no-useless-assignment': 'warn',
      'no-useless-escape': 'warn',
      // NON è un "warn" tattico: la tipografia francese richiede lo spazio
      // indivisibile prima di « ; : ! ? » e dentro le virgolette. I dizionari
      // di src/i18n/locales/fr.ts lo contengono legittimamente, in stringhe E
      // in commenti, e test-finance-unit.ts lo usa in una regex per provare
      // proprio la gestione dello spazio indivisibile nei numeri. La regola
      // resta "error" sul codice (indentazione), ma ignora i contenuti.
      'no-irregular-whitespace': [
        'error',
        { skipStrings: true, skipTemplates: true, skipComments: true, skipRegExps: true },
      ],
    },
  },

  // Prettier resta l'unico arbitro della forma: eslint-config-prettier spegne
  // le regole di stile che gli farebbero concorrenza. Va per ultimo.
  prettier,
);
