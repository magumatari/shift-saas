import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateRegressionRun } from '../scripts/check-guard-regression.mjs';

const summary = (n = 68) => ({
  format: 'tenant-test-summary-v1', success: true,
  counts: { tests:n, passed:n, failed:0, cancelled:0, skipped:0, todo:0, suites:0, topLevel:n },
});
const result = () => ({ status:0, signal:null, stdout:JSON.stringify(summary())+'\n' });
for (const n of [68, 69]) test(`accepts ${n} completed regressions`, () => {
  assert.equal(validateRegressionRun({status:0, stdout:JSON.stringify(summary(n))+'\n'}).tests, n);
});
for (const [name, mutate] of [
  ['not started', r => { r.status=null; r.error=new Error('ENOENT'); }],
  ['nonzero with valid summary', r => { r.status=1; }],
  ['signal', r => { r.signal='SIGTERM'; }],
  ['synthetic timeout', r => { r.error=Object.assign(new Error('ETIMEDOUT'),{code:'ETIMEDOUT'}); }],
  ['empty output', r => { r.stdout=''; }],
  ['invalid JSON', r => { r.stdout='{bad}\n'; }],
  ['truncated output', r => { r.stdout=r.stdout.slice(0,-1); }],
  ['duplicate output', r => { r.stdout+=r.stdout; }],
  ['insufficient 67', r => { r.stdout=JSON.stringify(summary(67))+'\n'; }],
  ...['skipped','todo','failed','cancelled'].map(key => [key,r=>{
    const s=summary(); s.counts[key]=1; r.stdout=JSON.stringify(s)+'\n';
  }]),
]) test(`rejects ${name}`, () => {
  const r=result(); mutate(r); assert.throws(()=>validateRegressionRun(r));
});

// Copy the unchanged CLI and adopted parser/reporter into an isolated tree.
// Only the synthetic regression input is replaced; repository tests stay intact.
async function cli(t, source, {missingTest=false, missingReporter=false, args=[]}={}) {
  const dir=await mkdtemp(join(tmpdir(),'shift-guard-ci-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(join(dir,'scripts')); await mkdir(join(dir,'test'));
  for (const file of ['check-guard-regression.mjs','check-test-run.mjs','test-summary-reporter.mjs']) {
    if (missingReporter && file==='test-summary-reporter.mjs') continue;
    await copyFile(fileURLToPath(new URL(`../scripts/${file}`,import.meta.url)),join(dir,'scripts',file));
  }
  if (!missingTest) await writeFile(join(dir,'test/guard-regression.test.mjs'),source);
  const env={...process.env}; delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath,[join(dir,'scripts/check-guard-regression.mjs'),...args],{
    cwd:dir,env,encoding:'utf8',timeout:10_000,maxBuffer:1024*1024,
  });
}
const tests=n=>`import test from 'node:test';\nfor(let i=0;i<${n};i++) test('synthetic '+i,()=>{});\n`;
test('CLI starts and accepts 68 real synthetic completions',async t=>{
  const r=await cli(t,tests(68)); assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/guard-regression: PASS minimum=68/);
});
for (const [name, source, options] of [
  ['missing test','',{missingTest:true}],
  ['missing reporter',tests(68),{missingReporter:true}],
  ['undeclared tests','// no tests',{}],
  ['67 tests',tests(67),{}],
  ['skip',tests(67)+`test('skip',{skip:true},()=>{});`,{}],
  ['todo',tests(67)+`test('todo',{todo:true},()=>{});`,{}],
  ['failed test',tests(67)+`test('fail',()=>{throw new Error('synthetic');});`,{}],
  ['zero exit before completion',tests(68)+'process.exit(0);',{}],
  ['syntax error','! this is invalid !',{}],
  ['override argument',tests(68),{args:['--minimum','1']}],
]) test(`CLI rejects ${name}`,async t=>{
  const r=await cli(t,source,options);
  assert.equal(r.error,undefined,'Fixture must start and finish within harness timeout');
  assert.equal(r.signal,null);
  assert.equal(r.status,1,r.stderr); assert.doesNotMatch(r.stdout,/PASS/);
});
