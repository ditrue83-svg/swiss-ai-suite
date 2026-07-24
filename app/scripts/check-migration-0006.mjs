// Verifica che la migrazione 0006 sia stata applicata al database reale.
//   node --env-file=.env.test scripts/check-migration-0006.mjs
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket; // Node < 22

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', X = '\x1b[0m';
let missing = 0;

/** Una select su colonne specifiche fallisce se tabella o colonna non esistono. */
async function probe(label, table, columns) {
  const { error } = await admin.from(table).select(columns).limit(0);
  if (error) { missing++; console.log(`${R}✗${X} ${label} ${DIM}${error.message}${X}`); }
  else console.log(`${G}✓${X} ${label}`);
}

console.log(`\n${DIM}Verifica migrazione 0006 (pipeline Admin AI)${X}\n`);

await probe('documents.file_hash / page_count', 'documents', 'id,file_hash,page_count');
await probe('document_extractions (testo per pagina)', 'document_extractions',
  'id,document_id,company_id,extraction_method,full_text,pages,page_count,ocr_confidence');
await probe('document_analyses — provenienza e versioning', 'document_analyses',
  'id,provider,model,prompt_version,schema_version,analysis_status,extraction_id');
await probe('document_analyses — esecuzione e diagnostica', 'document_analyses',
  'id,processing_started_at,processing_completed_at,error_code,error_message_safe,input_tokens,output_tokens');
await probe('document_analyses — schema ricco', 'document_analyses',
  'id,overall_confidence,sender_authority_type,recipient,subject,document_date,reply_needed,amounts,reference_numbers,legal_references');
await probe('document_analyses — scadenza strutturata', 'document_analyses',
  'id,deadline_type,deadline_source_text,deadline_confidence,deadline_requires_verification');
await probe('document_replies (bozze)', 'document_replies',
  'id,document_id,company_id,language,tone,content,provider,model,prompt_version,is_edited');
await probe('analysis_corrections (revisione umana)', 'analysis_corrections',
  'id,analysis_id,field,original_ai_value,corrected_value,corrected_by');
await probe('ai_request_log (osservabilità / rate limit)', 'ai_request_log',
  'id,company_id,kind,status,error_code,duration_ms,input_tokens,output_tokens');

console.log(missing
  ? `\n${R}${missing} elementi mancanti — esegui supabase/migrations/0006_admin_ai_pipeline.sql${X}\n`
  : `\n${G}Migrazione 0006 applicata correttamente.${X}\n`);
process.exit(missing ? 1 : 0);
