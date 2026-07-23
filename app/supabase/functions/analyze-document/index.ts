// ============================================================================
// SwissAI Suite — Edge Function: analyze-document (Fase 2)
//
// Esegue l'analisi del documento con Claude LATO SERVER: la chiave API Anthropic
// vive solo qui (secret di Supabase) e non tocca mai il browser.
//
// Sicurezza:
//  - richiede un JWT valido (verify_jwt attivo di default sulle Edge Functions);
//  - l'autorizzazione riusa la RLS: il documento viene letto con il client
//    Supabase autenticato COME L'UTENTE. Se non è membro della company del
//    documento, la select non restituisce nulla → 403. Nessuna logica di
//    permessi duplicata.
//
// Principio di prodotto: il modello NON deve inventare. Restituisce citazioni
// VERBATIM; il client le verifica contro il testo e scarta quelle non trovate.
// ============================================================================
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Modello e sforzo: l'analisi guida scadenze amministrative → privilegiamo la
// correttezza. Abbassa a "medium" se vuoi ridurre latenza/costo.
const MODEL = 'claude-opus-4-8';
const EFFORT = 'high';

// ---- Schema di output forzato (structured outputs) -------------------------
// Vincoli dello schema: additionalProperties:false ovunque; nullable via anyOf.
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] };

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'language', 'documentType', 'sender', 'senderEvidence', 'deadline', 'deadlineEvidence',
    'amount', 'amountCurrency', 'amountEvidence', 'summary', 'actions', 'requestedDocuments',
    'risk', 'uncertainties', 'confidence', 'replyDraft',
  ],
  properties: {
    language: { type: 'string', enum: ['it', 'de', 'fr'] },
    documentType: {
      type: 'string',
      enum: ['sollecito', 'richiesta_documenti', 'pagamento', 'dichiarazione', 'controllo', 'decisione', 'informativa'],
    },
    sender: nullableString,
    senderEvidence: nullableString,
    deadline: nullableString,       // "YYYY-MM-DD" oppure null
    deadlineEvidence: nullableString,
    amount: nullableNumber,
    amountCurrency: nullableString,
    amountEvidence: nullableString,
    summary: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'sourceType', 'evidence'],
        properties: {
          text: { type: 'string' },
          sourceType: { type: 'string', enum: ['extracted', 'suggested'] },
          evidence: nullableString,
        },
      },
    },
    requestedDocuments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'evidence'],
        properties: { label: { type: 'string' }, evidence: nullableString },
      },
    },
    risk: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'level', 'evidence'],
      properties: {
        text: { type: 'string' },
        level: { type: 'string', enum: ['explicit', 'possible', 'unknown'] },
        evidence: nullableString,
      },
    },
    uncertainties: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['alta', 'media', 'bassa'] },
    replyDraft: { type: 'string' },
  },
};

const SYSTEM_PROMPT = `Sei l'analista amministrativo di SwissAI Suite, uno strumento per le PMI svizzere.
Analizzi lettere, email e moduli di enti svizzeri (Confederazione, Cantoni, Comuni, casse, assicurazioni)
scritti in italiano, tedesco o francese, e li trasformi in azioni concrete per un imprenditore.

REGOLA FONDAMENTALE — NON INVENTARE MAI.
Se un'informazione non è nel documento, restituisci null e aggiungila a "uncertainties".
Non dedurre una scadenza, un importo o un mittente che non siano scritti. È molto meglio
dichiarare l'incertezza che fornire un dato plausibile ma non verificabile.

CITAZIONI (campi "evidence") — devono essere sottostringhe COPIATE ALLA LETTERA dal documento,
carattere per carattere, senza correggere refusi, senza tradurre, senza abbreviare. Ogni citazione
viene verificata automaticamente contro il testo originale: se non corrisponde esattamente viene
scartata. Cita una frase breve e significativa (non l'intero paragrafo). Se non hai una citazione
letterale a supporto, usa null.

AZIONI ("actions"):
- sourceType "extracted" SOLO se l'azione è richiesta esplicitamente da una frase del documento,
  e in tal caso allega la citazione letterale in "evidence".
- sourceType "suggested" per le buone pratiche amministrative che aggiungi tu (evidence: null).
Ordina le azioni per priorità operativa, dalla più urgente. Massimo 6 azioni.

ALTRI CAMPI:
- "language": la lingua del DOCUMENTO (non della tua risposta).
- "documentType": scegli il tipo prevalente.
- "deadline": solo se una data di scadenza è esplicita; formato YYYY-MM-DD.
- "amount": solo l'importo dovuto/indicato, come numero (es. 8450.00), con "amountCurrency" (es. "CHF").
- "summary": 2-3 frasi IN ITALIANO che spiegano a un imprenditore di cosa si tratta e cosa comporta,
  anche se il documento è in tedesco o francese.
- "risk": cosa rischia concretamente se non agisce. level "explicit" solo se il documento indica
  esplicitamente le conseguenze (con citazione); "possible" se è una conseguenza tipica ma non scritta;
  "unknown" se non determinabile.
- "uncertainties": elenco esplicito, in italiano, di ciò che NON hai potuto stabilire con certezza.
- "confidence": la tua fiducia complessiva sull'analisi.
- "replyDraft": bozza di risposta formale NELLA LINGUA DEL DOCUMENTO, pronta da rileggere e adattare,
  firmata con il nome dell'azienda fornito. Non promettere pagamenti o date che l'utente non ha confermato:
  usa formule prudenti.

Non sei un consulente legale o fiscale: non dare pareri legali, segnala quando serve una verifica umana.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito' }, 405);

  try {
    // ---- 1. Autenticazione ----
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Autenticazione richiesta.' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'Sessione non valida.' }, 401);

    // ---- 2. Input ----
    const body = await req.json().catch(() => null);
    const documentId = body?.documentId;
    const text = body?.text;
    if (typeof documentId !== 'string' || typeof text !== 'string' || text.trim().length < 40) {
      return json({ error: 'Richiesta non valida: servono documentId e il testo del documento.' }, 400);
    }
    // Limite prudenziale sulla dimensione del testo inviato al modello.
    const MAX_CHARS = 120_000;
    const docText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

    // ---- 3. Autorizzazione VIA RLS (il client è autenticato come l'utente) ----
    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id, company_id')
      .eq('id', documentId)
      .maybeSingle();
    if (docErr) return json({ error: 'Errore di accesso al documento.' }, 500);
    if (!doc) return json({ error: 'Documento non trovato o accesso negato.' }, 403);

    const { data: company } = await supabase
      .from('companies').select('legal_name').eq('id', doc.company_id).maybeSingle();
    const companyName = company?.legal_name ?? null;

    // ---- 4. Chiamata a Claude ----
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'Analisi AI non configurata sul server.', code: 'ai_not_configured' }, 503);

    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' }, // su Opus 4.8 va richiesto esplicitamente
      output_config: {
        effort: EFFORT,
        format: { type: 'json_schema', schema: ANALYSIS_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content:
          `Nome dell'azienda destinataria (per la firma della bozza): ${companyName ?? '[non fornito]'}\n` +
          `Data odierna (per valutare le scadenze): ${new Date().toISOString().slice(0, 10)}\n\n` +
          `Documento da analizzare, delimitato da <documento>:\n<documento>\n${docText}\n</documento>`,
      }],
    });

    // Rifiuto per policy: gestirlo prima di leggere il contenuto.
    if (message.stop_reason === 'refusal') {
      return json({ error: "L'analisi è stata rifiutata dal modello per motivi di sicurezza.", code: 'refusal' }, 422);
    }
    if (message.stop_reason === 'max_tokens') {
      return json({ error: 'Analisi troppo lunga per essere completata. Riprova con un documento più corto.', code: 'max_tokens' }, 422);
    }

    // Con il thinking attivo i blocchi thinking precedono il testo: cerca il blocco text.
    const textBlock = message.content.find((b: { type: string }) => b.type === 'text') as
      | { type: 'text'; text: string } | undefined;
    if (!textBlock) return json({ error: 'Risposta del modello non interpretabile.' }, 502);

    let analysis: unknown;
    try {
      analysis = JSON.parse(textBlock.text);
    } catch {
      return json({ error: 'Risposta del modello non in formato atteso.' }, 502);
    }

    return json({
      analysis,
      engine: MODEL,
      usage: {
        input_tokens: message.usage?.input_tokens ?? null,
        output_tokens: message.usage?.output_tokens ?? null,
      },
    });
  } catch (err) {
    // Nessun contenuto del documento nei log (privacy).
    console.error('analyze-document error:', (err as Error)?.name, (err as Error)?.message);
    return json({ error: "Analisi non riuscita. Riprova tra poco." }, 500);
  }
});
