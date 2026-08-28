import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Dev server su 5173 (l'anteprima statica del prototipo resta su 8744).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  // CSS Modules (issue #83): le regole di una sola feature vivono co-locate in
  // `*.module.css`. `localsConvention: 'camelCase'` esporta ENTRAMBE le forme
  // — `.doc-row` resta leggibile come styles['doc-row'] e come styles.docRow —
  // così il CSS migrato si sposta dai globali senza essere riscritto.
  css: {
    modules: { localsConvention: 'camelCase' },
  },
  server: { port: 5174 },
});
