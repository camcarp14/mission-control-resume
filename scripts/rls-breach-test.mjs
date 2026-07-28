// RLS breach test — proves the policies DENY, by attempting the breach.
//
// Reading a policy file proves nothing. Neither does a query that returns no
// rows: `select ... limit 1` under RLS with the WRONG key returns an empty
// SUCCESS, so a naive "no rows came back, we're secure" test passes for exactly
// the wrong reason. This script therefore:
//
//   1. Decodes each key's JWT `role` claim FIRST and refuses to run if a key is
//      not what the slot claims it is (the anon-key-in-the-service-slot trap).
//   2. Seeds a row as the owner, so there is something real to steal.
//   3. Attempts to read it as anon and as a DIFFERENT authenticated user, and
//      fails loudly if either can see it.
//
// Usage: SUPABASE_TEST_* env vars set, then `node scripts/rls-breach-test.mjs`.
import { createClient } from '@supabase/supabase-js';

const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OWNER_EMAIL = process.env.SUPABASE_TEST_OWNER_EMAIL;
const OWNER_PASSWORD = process.env.SUPABASE_TEST_OWNER_PASSWORD;
const INTRUDER_EMAIL = process.env.SUPABASE_TEST_INTRUDER_EMAIL;
const INTRUDER_PASSWORD = process.env.SUPABASE_TEST_INTRUDER_PASSWORD;

const TABLES = [
  'capabilities', 'utilization_events', 'capability_affinity', 'capacity_ledger',
  'workloads', 'artifacts', 'allocations', 'benchmarks', 'incidents',
  'thesis_log', 'settings',
];

const failures = [];
const must = (cond, label) =>
  cond ? console.log('  ok:', label) : (failures.push(label), console.error('  FAIL:', label));

const jwtRole = (k) => {
  try {
    return JSON.parse(Buffer.from(String(k).split('.')[1], 'base64url').toString('utf8')).role ?? null;
  } catch {
    return null;
  }
};

if (!URL || !ANON) {
  console.log('SKIP: no Supabase credentials in env — RLS breach test not run.');
  console.log('      This is NOT a pass. Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.');
  process.exit(0);
}

// --- Step 1: prove which keys we are actually holding -----------------------
console.log('\n[keys] decoding role claims before trusting any result');
const anonRole = jwtRole(ANON);
must(anonRole === 'anon', `anon key role claim is "anon" (got ${anonRole})`);
if (SERVICE) {
  const svcRole = jwtRole(SERVICE);
  must(svcRole === 'service_role', `service key role claim is "service_role" (got ${svcRole})`);
  if (svcRole === 'anon') {
    console.error('\nABORT: the service slot holds an ANON key. Every RLS result below');
    console.error('       would be a false negative. Fix the env var first.');
    process.exit(1);
  }
}

// --- Step 2: anonymous read must be denied on every table -------------------
console.log('\n[anon] attempting unauthenticated reads on every table');
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
for (const t of TABLES) {
  const { data, error } = await anon.from(t).select('*').limit(1);
  // Either an explicit RLS error, or zero rows. Zero rows alone is weak evidence,
  // which is why step 3 seeds a real row and tries to read THAT.
  must(!!error || (data?.length ?? 0) === 0, `anon cannot read ${t}`);
}

// --- Step 3: cross-user read must be denied, with a real row planted --------
if (!OWNER_EMAIL || !OWNER_PASSWORD || !INTRUDER_EMAIL || !INTRUDER_PASSWORD) {
  console.log('\n[cross-user] SKIPPED — set SUPABASE_TEST_OWNER_* and SUPABASE_TEST_INTRUDER_*');
  console.log('             to run the real breach attempt. Anon-only coverage is NOT sufficient:');
  console.log('             a policy of `using (true)` passes step 2 and fails step 3.');
} else {
  console.log('\n[cross-user] planting a row as owner, then attempting to steal it');
  const ownerClient = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: ownerAuth, error: ownerErr } = await ownerClient.auth.signInWithPassword({
    email: OWNER_EMAIL, password: OWNER_PASSWORD,
  });
  must(!ownerErr && !!ownerAuth?.user, 'owner signs in');

  const marker = `rls-probe-${Date.now()}`;
  const { data: planted, error: plantErr } = await ownerClient
    .from('capabilities')
    .insert({ name: marker, domain: 'rls-test', peak_level: 1 })
    .select()
    .single();
  must(!plantErr && !!planted, `owner can write their own row (${plantErr?.message ?? 'ok'})`);

  const intruder = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: intruderAuth, error: intErr } = await intruder.auth.signInWithPassword({
    email: INTRUDER_EMAIL, password: INTRUDER_PASSWORD,
  });
  must(!intErr && !!intruderAuth?.user, 'intruder signs in (a real, distinct session)');
  must(
    intruderAuth?.user?.id !== ownerAuth?.user?.id,
    'intruder is genuinely a different user id',
  );

  // THE test: a different authenticated user, a row that definitely exists.
  const { data: stolen } = await intruder
    .from('capabilities')
    .select('*')
    .eq('name', marker);
  must((stolen?.length ?? 0) === 0, 'intruder CANNOT read the owner\'s planted row');

  // And must not be able to write into the owner's namespace either.
  const { error: writeErr } = await intruder
    .from('capabilities')
    .update({ notes: 'owned' })
    .eq('name', marker);
  const { data: afterWrite } = await ownerClient
    .from('capabilities').select('notes').eq('name', marker).single();
  must(
    !!writeErr || afterWrite?.notes !== 'owned',
    'intruder CANNOT write to the owner\'s row',
  );

  if (planted) await ownerClient.from('capabilities').delete().eq('id', planted.id);
}

console.log('');
if (failures.length) {
  console.error('RLS BREACH TEST: FAILURES ABOVE — do not ship');
  process.exit(1);
}
console.log('RLS BREACH TEST: ALL GREEN — breach attempts were denied');
