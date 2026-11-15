// Synthetic guard regression tests. No production connections or tenant data.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = resolve(fileURLToPath(new URL('../scripts/', import.meta.url)));
const pins = {
  'check-test-run.mjs': '55579408b43214cdfdbbdb3a221593054b763786a32bf68ce04fd8605d41bcd9',
  'test-summary-reporter.mjs': 'ebf85f51cbbbeccfede1babff9bec54cf129d3d4a2621fa81c3876281370fa5a',
};
// Verify both input bytes before importing or executing either file.
for (const [name, expected] of Object.entries(pins)) {
  assert.equal(createHash('sha256').update(await readFile(join(source, name))).digest('hex'), expected, `Input pin mismatch: ${name}`);
}
assert.equal(process.version, 'v24.22.1', 'Use the workflow-pinned Node version for this candidate');
const { validateRun } = await import(pathToFileURL(join(source, 'check-test-run.mjs')).href);
const { default: report } = await import(pathToFileURL(join(source, 'test-summary-reporter.mjs')).href);
// A separately launched test runner must not inherit the outer runner's child
// context, which would suppress execution as a recursive node:test invocation.
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;

const summary = (n = 14) => ({
  format: 'tenant-test-summary-v1', success: true,
  counts: { tests:n, passed:n, failed:0, cancelled:0, skipped:0, todo:0, suites:0, topLevel:n },
});
const encoded = s => JSON.stringify(s) + '\n';
const run = (s = summary()) => ({ status:0, signal:null, error:undefined, stdout:encoded(s) });
const rejectSummary = (name, mutate, minimum = 14) => test(`summary rejects ${name}`, () => {
  const s = summary(); mutate(s); assert.throws(() => validateRun(run(s), minimum));
});
const rejectResult = (name, mutate, minimum = 14) => test(`process rejects ${name}`, () => {
  const r = run(); mutate(r); assert.throws(() => validateRun(r, minimum));
});

for (const [name,n,minimum] of [['unit baseline',14,14],['runtime baseline',8,8],['additional test',15,14]]) {
  test(`accepts ${name}`, () => assert.deepEqual(validateRun(run(summary(n)), minimum), summary(n).counts));
}
for (const minimum of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'14']) {
  test(`rejects invalid minimum ${String(minimum)}`, () => assert.throws(() => validateRun(run(),minimum)));
}
rejectResult('nonzero exit despite successful record',r=>r.status=1);
rejectResult('null exit',r=>r.status=null);
rejectResult('signal',r=>r.signal='SIGTERM');
rejectResult('launch error',r=>r.error=Object.assign(new Error('synthetic ENOENT'),{code:'ENOENT'}));
rejectResult('synthetic timeout result',r=>r.error=Object.assign(new Error('synthetic ETIMEDOUT'),{code:'ETIMEDOUT'}));
rejectResult('non-string stdout',r=>r.stdout=Buffer.from(r.stdout));
rejectResult('empty stdout',r=>r.stdout='');
rejectResult('missing final newline',r=>r.stdout=r.stdout.slice(0,-1));
rejectResult('malformed JSON',r=>r.stdout='{oops}\n');
rejectResult('truncated JSON',r=>r.stdout=r.stdout.slice(0,25)+'\n');
rejectResult('additional line',r=>r.stdout+='unexpected\n');
rejectResult('duplicate records',r=>r.stdout+=r.stdout);
rejectResult('duplicate JSON keys',r=>r.stdout=r.stdout.replace('"success":true','"success":true,"success":true'));
rejectResult('noncanonical whitespace',r=>r.stdout=' '+r.stdout);
rejectSummary('wrong format',s=>s.format='tenant-test-summary-v2');
rejectSummary('success false',s=>s.success=false);
rejectSummary('success string',s=>s.success='true');
rejectSummary('missing root field',s=>delete s.success);
rejectSummary('extra root field',s=>s.extra=true);
rejectSummary('counts array',s=>s.counts=[]);
rejectSummary('null counts',s=>s.counts=null);
rejectSummary('missing counter',s=>delete s.counts.todo);
rejectSummary('extra counter',s=>s.counts.extra=0);
rejectSummary('insufficient unit count',s=>{s.counts.tests=13;s.counts.passed=13;s.counts.topLevel=13;});
test('summary rejects insufficient runtime count',()=>assert.throws(()=>validateRun(run(summary(7)),8)));
for (const key of ['failed','cancelled','skipped','todo']) rejectSummary(`nonzero ${key}`,s=>s.counts[key]=1);
for (const value of [-1,1.5,Number.MAX_SAFE_INTEGER+1,'14']) {
  rejectSummary(`invalid counter ${String(value)}`,s=>s.counts.tests=value);
}
// Isolate numeric validation from the minimum/passed/topLevel comparisons.
// topLevel=1 keeps suites=-1 within the remaining relational bounds.
for (const value of [-1,1.5,Number.MAX_SAFE_INTEGER+1,'0']) {
  test(`numeric guard rejects isolated suites ${typeof value}:${String(value)}`,()=>{
    const s=summary(); s.counts.suites=value; s.counts.topLevel=1;
    assert.throws(()=>validateRun(run(s),14),/Test counts rejected/);
  });
}
rejectSummary('passed mismatch',s=>s.counts.passed=13);
rejectSummary('zero topLevel',s=>s.counts.topLevel=0);
rejectSummary('excessive topLevel',s=>s.counts.topLevel=15);

test('reporter excludes per-file summaries and emits one cumulative record', async()=>{
  async function* events() {
    yield {type:'test:summary',data:{file:'fake-file.mjs',success:true,counts:summary(9).counts}};
    yield {type:'test:summary',data:{file:undefined,success:true,counts:summary(14).counts}};
  }
  let output=''; for await (const chunk of report(events())) output+=chunk;
  assert.equal(output,encoded(summary()));
  assert.equal(validateRun({status:0,stdout:output},14).tests,14);
});

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(),'shift-guard-candidate-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  return dir;
}
const tests = n => `import test from 'node:test';\nfor(let i=0;i<${n};i++) test('synthetic '+i,()=>{});\n`;
async function actualRun(t, text) {
  const dir=await fixture(t), file=join(dir,'synthetic.test.mjs');
  await writeFile(file,text);
  return spawnSync(process.execPath,['--test',`--test-reporter=${join(source,'test-summary-reporter.mjs')}`,file],{
    cwd:dir,env:childEnv,encoding:'utf8',timeout:10000,maxBuffer:1024*1024,
  });
}
for(const n of [8,14,15]) test(`real reporter accepts ${n} synthetic tests`,async t=>{
  const r=await actualRun(t,tests(n)); assert.equal(validateRun(r,n===8?8:14).tests,n);
});
for(const [name,body] of [
  ['skip',tests(13)+`test('skipped',{skip:true},()=>{});\n`],
  ['todo',tests(13)+`test('todo',{todo:true},()=>{});\n`],
  ['failed assertion',tests(13)+`test('failure',()=>{throw new Error('synthetic failure');});\n`],
  ['no declared tests','// no declarations\n'],
  ['syntax error','this is not valid JavaScript !\n'],
  ['early zero exit after declaring 14 tests',tests(14)+'process.exit(0);\n'],
]) test(`real reporter rejects ${name}`,async t=>{
  const r=await actualRun(t,body);
  assert.equal(r.error,undefined,'Fixture must actually start');
  assert.equal(r.signal,null,'Fixture must finish before the harness timeout');
  assert.equal(r.stderr.includes('recursively'),false,'Nested runner must not suppress tests');
  assert.ok(r.stdout.endsWith('\n'),'Reporter must produce a completed record');
  if(name==='skip'||name==='todo') {
    assert.equal(JSON.parse(r.stdout).counts[name==='skip'?'skipped':'todo'],1);
  }
  if(name==='early zero exit after declaring 14 tests') {
    assert.equal(r.status,0,'The fixture must exercise zero exit, not a crash');
    assert.ok(JSON.parse(r.stdout).counts.tests<14,'Declared tests must not count as completed');
    assert.throws(()=>validateRun(r,14),/Test counts rejected/);
    return;
  }
  assert.throws(()=>validateRun(r,14));
});
test('real reporter keeps test stdout out of the summary control channel',async t=>{
  const r=await actualRun(t,tests(14)+`console.log('pretend-summary-control-data');\n`);
  assert.equal(validateRun(r,14).tests,14);
  assert.equal(r.stdout.includes('pretend-summary-control-data'),false);
  assert.match(r.stderr,/pretend-summary-control-data/);
});

async function cliFixture(t,{omitReporter=false,omitTest=false}={}) {
  const dir=await fixture(t);
  await mkdir(join(dir,'scripts')); await mkdir(join(dir,'test'));
  await copyFile(join(source,'check-test-run.mjs'),join(dir,'scripts/check-test-run.mjs'));
  if(!omitReporter) await copyFile(join(source,'test-summary-reporter.mjs'),join(dir,'scripts/test-summary-reporter.mjs'));
  if(!omitTest) {
    await writeFile(join(dir,'test/gate.test.mjs'),tests(14));
    await writeFile(join(dir,'test/runtime.test.mjs'),tests(8));
  }
  return args=>spawnSync(process.execPath,[join(dir,'scripts/check-test-run.mjs'),...args],{
    cwd:dir,env:childEnv,encoding:'utf8',timeout:10000,maxBuffer:1024*1024,
  });
}
for(const name of ['unit','runtime']) test(`CLI executes unchanged ${name} guard`,async t=>{
  const cli=await cliFixture(t),r=cli([name]);
  assert.equal(r.status,0,r.stderr); assert.match(r.stdout,new RegExp(`${name}: PASS minimum=${name==='unit'?14:8}`));
});
for(const args of [[],['unknown'],['unit','--minimum','1']]) test(`CLI rejects arguments ${JSON.stringify(args)}`,async t=>{
  const cli=await cliFixture(t),r=cli(args);
  assert.equal(r.status,1); assert.match(r.stderr,/Use unit or runtime/);
});
for(const missing of ['omitReporter','omitTest']) test(`CLI rejects ${missing}`,async t=>{
  const cli=await cliFixture(t,{[missing]:true}),r=cli(['unit']);
  assert.equal(r.status,1); assert.match(r.stderr,/Test guard failed/);
});
