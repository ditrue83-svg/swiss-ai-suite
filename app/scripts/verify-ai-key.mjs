// Verifica che la chiave Anthropic funzioni e che le capacità che ci servono
// siano disponibili: chiamata base, adaptive thinking, structured outputs.
//   node --env-file=.env.test scripts/verify-ai-key.mjs
import Anthropic from '@anthropic-ai/sdk';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error('ANTHROPIC_API_KEY mancante in .env.test'); process.exit(2); }

const MODEL = 'claude-opus-4-8';
const client = new Anthropic({ apiKey: key });
const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', X = '\x1b[0m';
let fail = 0;
const ok = (n, cond, extra = '') => {
  if (cond) console.log(`${G}✓${X} ${n}${extra ? ` ${DIM}${extra}${X}` : ''}`);
  else { fail++; console.log(`${R}✗ ${n}${X} ${extra}`); }
};

console.log(`\n${DIM}Verifica chiave Anthropic · modello ${MODEL}${X}\n`);

// 1) Chiamata base
try {
  const r = await client.messages.create({
    model: MODEL, max_tokens: 32,
    messages: [{ role: 'user', content: 'Rispondi con la sola parola: OK' }],
  });
  const text = r.content.find((b) => b.type === 'text')?.text ?? '';
  ok('Chiave valida e modello raggiungibile', text.toUpperCase().includes('OK'),
    `(in ${r.usage.input_tokens} / out ${r.usage.output_tokens} token)`);
} catch (e) {
  ok('Chiave valida e modello raggiungibile', false, `${e.status ?? ''} ${e.message}`);
  console.log(`\n${R}Interrompo: senza una chiave valida il resto non ha senso.${X}\n`);
  process.exit(1);
}

// 2) Structured outputs + adaptive thinking — le due capacità su cui si regge la pipeline
try {
  const r = await client.messages.create({
    model: MODEL, max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object', additionalProperties: false,
          required: ['language', 'hasDeadline'],
          properties: {
            language: { type: 'string', enum: ['it', 'de', 'fr'] },
            hasDeadline: { type: 'boolean' },
          },
        },
      },
    },
    messages: [{ role: 'user', content: 'Documento: "Sehr geehrte Damen und Herren, bitte senden Sie die Unterlagen." Analizzalo.' }],
  });
  const text = r.content.find((b) => b.type === 'text')?.text ?? '';
  const parsed = JSON.parse(text);
  ok('Structured outputs (JSON schema forzato)', parsed.language === 'de' && typeof parsed.hasDeadline === 'boolean',
    `→ ${JSON.stringify(parsed)}`);
  ok('Adaptive thinking accettato', true);
} catch (e) {
  ok('Structured outputs + adaptive thinking', false, `${e.status ?? ''} ${e.message}`);
}

console.log(fail ? `\n${R}${fail} verifiche fallite${X}\n` : `\n${G}Tutto pronto per costruire la pipeline.${X}\n`);
process.exit(fail ? 1 : 0);
