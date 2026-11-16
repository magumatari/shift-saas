import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, copyFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateGuardCiRun } from '../scripts/check-guard-ci.mjs';

const summary = (n = 30) => ({
  format:'tenant-test-summary-v1', success:true,
  counts:{tests:n, passed:n, failed:0, cancelled:0, skipped:0, todo:0, suites:0, topLevel:n},
});
const encoded = s => JSON.stringify(s)+'\n';
const result = () => ({status:0, signal:null, stdout:encoded(summary())});
for (const n of [30,31]) test(`accepts ${n} completed helper tests`, () => {
  assert.equal(validateGuardCiRun({status:0,stdout:encoded(summary(n))}).tests,n);
});
for (const [name, mutate, reason] of [
  ['29 tests',r=>r.stdout=encoded(summary(29)),/Test counts rejected: minimum=30/],
  ['zero tests',r=>r.stdout=encoded(summary(0)),/Test counts rejected: minimum=30/],
  ['not started',r=>{r.status=null;r.error=new Error('ENOENT');},/Test process failed: ENOENT/],
  ['nonzero despite summary',r=>r.status=1,/Test process failed: 1/],
  ['signal',r=>r.signal='SIGTERM',/Test process failed: SIGTERM/],
  ['artificial timeout',r=>r.error=new Error('synthetic ETIMEDOUT'),/Test process failed: synthetic ETIMEDOUT/],
  ['missing summary',r=>r.stdout='',/Missing or incomplete machine summary/],
  ['invalid JSON',r=>r.stdout='{bad}\n',SyntaxError],
  ['partial JSON',r=>r.stdout=r.stdout.slice(0,25)+'\n',SyntaxError],
  ['missing final newline',r=>r.stdout=r.stdout.slice(0,-1),/Missing or incomplete machine summary/],
  ['duplicate summaries',r=>r.stdout+=r.stdout,SyntaxError],
  ['wrong format',r=>{const s=summary();s.format='other';r.stdout=encoded(s);},/Invalid machine summary/],
  ['success false',r=>{const s=summary();s.success=false;r.stdout=encoded(s);},/Invalid machine summary/],
  ['passed mismatch',r=>{const s=summary();s.counts.passed=29;r.stdout=encoded(s);},/Test counts rejected/],
  ['noninteger counter',r=>{const s=summary();s.counts.suites=0.5;r.stdout=encoded(s);},/Test counts rejected/],
  ...['skipped','todo','failed','cancelled'].map(key=>[key,r=>{
    // Keep passed=tests to isolate the nonzero counter check.
    const s=summary();s.counts[key]=1;r.stdout=encoded(s);
  },/Test counts rejected/]),
]) test(`artificial result rejects ${name}`, () => {
  const r=result();mutate(r);assert.throws(()=>validateGuardCiRun(r),reason);
});

const tests = n => `import test from 'node:test';\nfor(let i=0;i<${n};i++) test('synthetic '+i,()=>{});\n`;
const processFailure=/Guard CI tests failed: Test process failed: 1(?:\r?\n|$)/;
const countsFailure=/Guard CI tests failed: Test counts rejected: minimum=30/;
function completed(r) {
  assert.equal(r.error,undefined,'A harness timeout/launch error is not a successful rejection');
  assert.equal(r.signal,null);return r;
}

// Only copies are replaced. Adopted helper/parser/reporter files remain unchanged.
async function fixture(t, source, options={}) {
  const dir=await mkdtemp(join(tmpdir(),'shift-helper-count-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(join(dir,'scripts'));await mkdir(join(dir,'test'));
  for(const name of ['check-guard-ci.mjs','check-test-run.mjs','test-summary-reporter.mjs']) {
    if(options.missingReporter&&name==='test-summary-reporter.mjs')continue;
    await copyFile(fileURLToPath(new URL(`../scripts/${name}`,import.meta.url)),join(dir,'scripts',name));
  }
  if(options.reporter!==undefined)await writeFile(join(dir,'scripts/test-summary-reporter.mjs'),options.reporter);
  if(!options.missingTest)await writeFile(join(dir,'test/guard-ci.test.mjs'),source);
  const env={...process.env,...options.env};delete env.NODE_TEST_CONTEXT;
  let entry=join(dir,'scripts/check-guard-ci.mjs');
  if(options.link==='file'){const link=join(dir,'entry.mjs');await symlink(entry,link);entry=link;}
  if(options.link==='directory'){const link=join(dir,'linked-scripts');await symlink(join(dir,'scripts'),link);entry=join(link,'check-guard-ci.mjs');}
  if(options.childNodeOptions) {
    const preload=join(dir,'harmless-preload.cjs');
    await writeFile(preload,"process.env.SHIFT_HELPER_PRELOAD='loaded';\n");
    const nodeOptions=`--require ${preload}`;
    delete env.NODE_OPTIONS;delete env.SHIFT_HELPER_PRELOAD;
    // The isolated launcher starts without NODE_OPTIONS. Set it only after
    // startup so this probes the runner's child boundary, not launcher startup.
    const launcher=`import assert from 'node:assert/strict';
      assert.equal(process.env.SHIFT_HELPER_PRELOAD,undefined);
      process.env.NODE_OPTIONS=${JSON.stringify(nodeOptions)};
      process.argv=[process.execPath,${JSON.stringify(entry)}];
      await import(${JSON.stringify(pathToFileURL(entry).href)});
      assert.equal(process.env.NODE_OPTIONS,${JSON.stringify(nodeOptions)});
      assert.equal(process.env.SHIFT_HELPER_PRELOAD,undefined);`;
    return completed(spawnSync(process.execPath,['--input-type=module','-e',launcher],{
      cwd:dir,env,encoding:'utf8',timeout:10_000,maxBuffer:1024*1024,
    }));
  }
  const args=options.bare?['--test',join(dir,'test/guard-ci.test.mjs')]:[entry,...(options.args??[])];
  return completed(spawnSync(process.execPath,args,{cwd:dir,env,encoding:'utf8',timeout:10_000,maxBuffer:1024*1024}));
}
test('CLI actually accepts 30 synthetic completions',async t=>{
  const r=await fixture(t,tests(30));assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/guard-ci: PASS minimum=30 counts=/);
});
const reporter = output => `export default async function* report(events){for await(const e of events){}yield ${JSON.stringify(output)};}`;
for(const [name,source,options,reason,detail] of [
  ['missing test','',{missingTest:true},processFailure,/Could not find.*guard-ci\.test\.mjs/],
  ['missing reporter',tests(30),{missingReporter:true},/Guard CI tests failed: Test process failed: 7(?:\r?\n|$)/,/ERR_MODULE_NOT_FOUND/],
  ['undeclared tests','// no tests',{},countsFailure],
  ['29 tests',tests(29),{},countsFailure],
  ['skip',tests(29)+`test('skip',{skip:true},()=>{});`,{},countsFailure,/"skipped":1/],
  ['todo',tests(29)+`test('todo',{todo:true},()=>{});`,{},countsFailure,/"todo":1/],
  ['failed test',tests(29)+`test('fail',()=>{throw new Error('synthetic failure');});`,{},processFailure,/synthetic failure/],
  ['early exit0',tests(30)+'process.exit(0);',{},countsFailure],
  ['syntax error','! invalid syntax !',{},processFailure,/SyntaxError/],
  ['CLI override',tests(30),{args:['--minimum','1']},/Guard CI tests failed: No arguments accepted/],
  ['unrecognized runner-specific variables',tests(29),{env:{GUARD_CI_MINIMUM:'1',GUARD_CI_FILE:'other.test.mjs'}},countsFailure],
  ['no reporter summary',tests(30),{reporter:reporter('')},/Guard CI tests failed: Missing or incomplete machine summary/],
  ['duplicate reporter summaries',tests(30),{reporter:reporter(encoded(summary())+encoded(summary()))},/Guard CI tests failed: Unexpected.*JSON/],
  ['incomplete reporter summary',tests(30),{reporter:reporter(encoded(summary()).slice(0,-1))},/Guard CI tests failed: Missing or incomplete machine summary/],
]) test(`CLI rejects ${name} for the expected reason`,async t=>{
  const r=await fixture(t,source,options);assert.equal(r.status,1,r.stderr);
  assert.doesNotMatch(r.stdout,/PASS/);assert.match(r.stderr,reason);
  if(detail)assert.match(r.stderr,detail);
});
test('Node v24.22.1 accepts the harmless NODE_OPTIONS preload',async t=>{
  assert.equal(process.version,'v24.22.1');
  const dir=await mkdtemp(join(tmpdir(),'shift-node-options-control-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const preload=join(dir,'harmless-preload.cjs');
  await writeFile(preload,"process.env.SHIFT_HELPER_PRELOAD='loaded';\n");
  const env={...process.env,NODE_OPTIONS:`--require ${preload}`};
  delete env.NODE_TEST_CONTEXT;delete env.SHIFT_HELPER_PRELOAD;
  const r=completed(spawnSync(process.execPath,['-e',"process.stdout.write(process.env.SHIFT_HELPER_PRELOAD??'missing')"],{env,encoding:'utf8',timeout:10_000}));
  assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'loaded');
});
test('child boundary strips NODE_OPTIONS set after parent startup',async t=>{
  const source=`import test from 'node:test';import assert from 'node:assert/strict';
    for(let i=0;i<30;i++)test('synthetic '+i,()=>assert.equal(process.env.SHIFT_HELPER_PRELOAD,undefined,'synthetic child inherited NODE_OPTIONS'));`;
  const r=await fixture(t,source,{childNodeOptions:true});
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/guard-ci: PASS minimum=30/);
});
for(const link of ['file','directory']) {
  test(`symlink ${link} starts 30 completions`,async t=>{
    const r=await fixture(t,tests(30),{link});assert.equal(r.status,0,r.stderr);
    assert.match(r.stdout,/guard-ci: PASS minimum=30/);
  });
  test(`symlink ${link} rejects 29 completions`,async t=>{
    const r=await fixture(t,tests(29),{link});assert.equal(r.status,1,r.stderr);
    assert.match(r.stderr,countsFailure);assert.doesNotMatch(r.stdout,/PASS/);
  });
}
test('nonexistent argv path fails inside entry guard',()=>{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const module=new URL('../scripts/check-guard-ci.mjs',import.meta.url).href;
  const r=completed(spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(module)})`,fileURLToPath(new URL('./missing-entry-path',import.meta.url))],{env,encoding:'utf8',timeout:10_000}));
  assert.equal(r.status,1);assert.match(r.stderr,/Guard CI tests failed: ENOENT/);assert.doesNotMatch(r.stdout,/PASS/);
});
for(const [name,source,detail] of [
  ['no declarations','// no tests'],
  ['29 tests',tests(29)],
  ['skip',`import test from 'node:test';test('skip',{skip:true},()=>{});`,/skipped\s+1/],
  ['todo',`import test from 'node:test';test('todo',{todo:true},()=>{});`,/todo\s+1/],
  ['early exit0',tests(30)+'process.exit(0);'],
]) test(`bare node --test succeeds despite ${name}`,async t=>{
  const r=await fixture(t,source,{bare:true});assert.equal(r.status,0,r.stderr);
  if(detail)assert.match(r.stdout,detail);
});
