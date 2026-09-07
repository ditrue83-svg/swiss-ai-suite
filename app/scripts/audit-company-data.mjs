// ============================================================================
// Inventario in SOLA LETTURA dei dati appartenenti a un'azienda.
//
//   npm run company:audit -- --id <uuid>
//   npm run company:audit -- --name "Rossi SA"
//   npm run company:audit -- --id <uuid> --include-identities
//   npm run company:audit -- --self-test
//
// Lo script non contiene insert, update, upsert, delete o RPC. Usa il service
// role soltanto perché l'inventario deve attraversare tutte le tabelle protette
// da RLS. Non legge corpi email, contenuti dei documenti o file nello storage.
// ============================================================================
import { readFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';

if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

/**
 * La definizione TypeScript è generata dallo schema ed evita un elenco manuale
 * destinato a invecchiare. Si contano solo le tabelle la cui Row dichiara
 * direttamente company_id.
 */
export function companyScopedTables(source) {
  const start = source.indexOf('    Tables: {');
  const end = source.indexOf('\n    Views:', start);
  if (start < 0 || end < 0) throw new Error('Sezione Database.public.Tables non trovata');

  const tables = source.slice(start, end + '\n    Views:'.length);
  const blocks = /^ {6}([a-z][a-z0-9_]+): \{([\s\S]*?)(?=^ {6}[a-z][a-z0-9_]+: \{|^ {4}Views:)/gm;
  const names = [];
  for (const match of tables.matchAll(blocks)) {
    if (/\bRow:\s*\{[\s\S]*?\bcompany_id:\s*string\b/.test(match[2])) names.push(match[1]);
  }
  return [...new Set(names)].sort();
}

function aggregate(rows, key) {
  return Object.fromEntries([...rows.reduce((counts, row) => {
    const value = row[key] ?? 'null';
    counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  }, new Map()).entries()].sort(([a], [b]) => String(a).localeCompare(String(b))));
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return null;
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

async function selfTest() {
  const sample = `    Tables: {
      companies: {
        Row: { id: string; legal_name: string };
      };
      documents: {
        Row: { id: string; company_id: string };
      };
      company_members: {
        Row: { id: string; company_id: string; user_id: string };
      };
    Views: {`;
  const actual = companyScopedTables(sample);
  const expected = ['company_members', 'documents'];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`parser tabelle: atteso ${expected}, ricevuto ${actual}`);
  }
  console.log('✓ company:audit self-test');
}

async function main() {
  if (args.includes('--self-test')) return selfTest();

  const id = valueAfter('--id');
  const name = valueAfter('--name');
  if ((id && name) || (!id && !name)) {
    throw new Error('Indicare esattamente uno fra --id <uuid> e --name <ragione sociale>');
  }
  if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('--id non è un UUID valido');
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Mancano SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let companyQuery = admin.from('companies')
    .select('id, legal_name, uid_che, created_at, updated_at');
  companyQuery = id ? companyQuery.eq('id', id) : companyQuery.eq('legal_name', name);
  const { data: companies, error: companyError } = await companyQuery.limit(2);
  if (companyError) throw new Error(`companies: ${companyError.message}`);
  if (companies.length !== 1) {
    throw new Error(companies.length ? 'La ragione sociale non è univoca; usare --id' : 'Azienda non trovata');
  }
  const company = companies[0];

  const typesUrl = new URL('../src/types/database.ts', import.meta.url);
  const tableNames = companyScopedTables(await readFile(typesUrl, 'utf8'));
  const counts = await Promise.all(tableNames.map(async (table) => {
    const { count, error } = await admin.from(table)
      .select('company_id', { count: 'exact', head: true })
      .eq('company_id', company.id);
    if (error) throw new Error(`${table}: ${error.message}`);
    return [table, count ?? 0];
  }));

  const { data: members, error: memberError } = await admin.from('company_members')
    .select('user_id, role, created_at').eq('company_id', company.id).order('created_at');
  if (memberError) throw new Error(`company_members: ${memberError.message}`);
  const userIds = members.map((member) => member.user_id);
  const { data: profiles, error: profileError } = userIds.length
    ? await admin.from('profiles').select('id, first_name, last_name, email').in('id', userIds)
    : { data: [], error: null };
  if (profileError) throw new Error(`profiles: ${profileError.message}`);
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const includeIdentities = args.includes('--include-identities');

  const { data: documents, error: documentsError } = await admin.from('documents')
    .select('source_type, uploaded_by, created_at').eq('company_id', company.id);
  if (documentsError) throw new Error(`documents: ${documentsError.message}`);

  const nonEmpty = Object.fromEntries(counts.filter(([, count]) => count > 0));
  const report = {
    generated_at: new Date().toISOString(),
    mode: 'read_only',
    company: {
      ...company,
      usage_kind: company.legal_name.startsWith('ZZ-USA-E-GETTA')
        ? 'technical_by_name_marker'
        : 'unclassified_schema_has_no_field',
    },
    members: members.map((member) => {
      const profile = profilesById.get(member.user_id);
      return {
        user_id: member.user_id,
        role: member.role,
        created_at: member.created_at,
        name: includeIdentities && profile
          ? `${profile.first_name} ${profile.last_name}`.trim()
          : undefined,
        email: includeIdentities ? profile?.email ?? null : maskEmail(profile?.email),
      };
    }),
    documents: {
      total: documents.length,
      by_source_type: aggregate(documents, 'source_type'),
      with_uploader: documents.filter((document) => document.uploaded_by).length,
      without_uploader: documents.filter((document) => !document.uploaded_by).length,
      first_created_at: documents.map((document) => document.created_at).sort()[0] ?? null,
      last_created_at: documents.map((document) => document.created_at).sort().at(-1) ?? null,
    },
    rows_by_table: nonEmpty,
    empty_company_scoped_tables: counts.filter(([, count]) => count === 0).map(([table]) => table),
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`company:audit: ${error.message}`);
  process.exitCode = 1;
});
