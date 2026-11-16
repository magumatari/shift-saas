import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const entry = fileURLToPath(new URL('./check-rest-tests.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const finalPass = /h10-rest: PASS timezones=2/;
const summary = (n = 77) => ({
  format: 'tenant-test-summary-v1', success: true,
  counts: { tests:n, passed:n, failed:0, cancelled:0, skipped:0, todo:0, suites:0, topLevel:n },
});
const encode = s => JSON.stringify(s)+'\n';
const result = () => ({ status:0, signal:null, stdout:encode(summary()) });
function launch(args, options = {}) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, args, {
    cwd:root, env, encoding:'utf8', timeout:20_000, maxBuffer:2*1024*1024, ...options,
  });
  assert.equal(r.error, undefined, 'Harness startup/timeout is not the expected rejection');
  assert.equal(r.signal, null);
  return r;
}

// Stub only the child boundary in an isolated launcher. The actual CLI still
// chooses the target, baseline, both TZs, parser, timeout and child environment.
function artificial(r, setup = '', after = '') {
  const source = `import cp from 'node:child_process';
    import {syncBuiltinESMExports} from 'node:module';
    import assert from 'node:assert/strict';
    ${setup}
    let calls=0;
    cp.spawnSync=(exe,args,options)=>{
      calls++;
      assert.equal(exe,process.execPath);
      assert.deepEqual(args.slice(0,3),['--import','tsx','--test']);
      assert.equal(args[3],${JSON.stringify('--test-reporter='+fileURLToPath(new URL('../tenant-do-isolation/scripts/test-summary-reporter.mjs', import.meta.url)))});
      assert.equal(args[4],${JSON.stringify(fileURLToPath(new URL('./rest-analysis.test.ts', import.meta.url)))});
      assert.equal(options.cwd,${JSON.stringify(root)});
      assert.equal(options.timeout,120000);assert.equal(options.maxBuffer,4194304);
      assert.equal(options.env.TZ,['UTC','America/Los_Angeles'][calls-1]);
      assert.equal(Object.hasOwn(options.env,'NODE_OPTIONS'),false);
      assert.equal(Object.hasOwn(options.env,'NODE_TEST_CONTEXT'),false);
      return ${JSON.stringify(r)};
    };
    syncBuiltinESMExports();
    process.argv=[process.execPath,${JSON.stringify(entry)}];
    await import(${JSON.stringify(pathToFileURL(entry).href)});
    ${after}`;
  return launch(['--input-type=module','-e',source]);
}
for (const n of [77,78]) test(`artificial complete ${n} is accepted in both TZs`, () => {
  const r = artificial({status:0,stdout:encode(summary(n))}, '', 'assert.equal(calls,2);');
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,finalPass);
  assert.match(r.stdout,/h10-rest UTC: PASS minimum=77/);
  assert.match(r.stdout,/h10-rest America\/Los_Angeles: PASS minimum=77/);
});
for (const [name, mutate, reason] of [
  ['76 tests',r=>r.stdout=encode(summary(76)),/Test counts rejected: minimum=77/],
  ['zero tests',r=>r.stdout=encode(summary(0)),/Test counts rejected/],
  ['nonzero',r=>r.status=1,/Test process failed: 1/],
  ['not started',r=>{r.status=null;r.error={message:'synthetic ENOENT'};},/Test process failed: synthetic ENOENT/],
  ['timeout result',r=>{r.status=null;r.error={message:'synthetic ETIMEDOUT'};},/Test process failed: synthetic ETIMEDOUT/],
  ['output overflow',r=>{r.status=null;r.error={message:'synthetic ENOBUFS'};},/Test process failed: synthetic ENOBUFS/],
  ['signal',r=>r.signal='SIGTERM',/Test process failed: SIGTERM/],
  ['missing summary',r=>r.stdout='',/Missing or incomplete machine summary/],
  ['invalid JSON',r=>r.stdout='{bad}\n',/JSON/],
  ['no newline',r=>r.stdout=r.stdout.slice(0,-1),/Missing or incomplete machine summary/],
  ['partial summary',r=>r.stdout=r.stdout.slice(0,20)+'\n',/JSON/],
  ['two summaries',r=>r.stdout+=r.stdout,/JSON/],
  ['duplicate key',r=>r.stdout=r.stdout.replace('"success":true','"success":true,"success":true'),/Invalid machine summary/],
  ['wrong format',r=>{const s=summary();s.format='other';r.stdout=encode(s);},/Invalid machine summary/],
  ['success false',r=>{const s=summary();s.success=false;r.stdout=encode(s);},/Invalid machine summary/],
  ['passed mismatch',r=>{const s=summary();s.counts.passed=76;r.stdout=encode(s);},/Test counts rejected/],
  ['fractional counter',r=>{const s=summary();s.counts.suites=0.5;r.stdout=encode(s);},/Test counts rejected/],
  ...['failed','cancelled','skipped','todo'].map(key=>[key,r=>{
    // Keep passed=tests so each counter is tested independently.
    const s=summary();s.counts[key]=1;r.stdout=encode(s);
  },/Test counts rejected/]),
]) test(`artificial result rejects ${name} for the expected reason`, () => {
  const r=result();mutate(r);const p=artificial(r);
  assert.equal(p.status,1,p.stderr);assert.doesNotMatch(p.stdout,finalPass);
  assert.match(p.stderr,reason);
});
test('runner environment overrides cannot change target, threshold or TZ', () => {
  const r=artificial(result(), `process.env.H10_MINIMUM='1';process.env.H10_FILE='other';
    process.env.TZ='other';process.env.NODE_OPTIONS='--not-a-real-option';process.env.NODE_TEST_CONTEXT='wrong';`,
    `assert.equal(calls,2);assert.equal(process.env.NODE_OPTIONS,'--not-a-real-option');
     assert.equal(process.env.NODE_TEST_CONTEXT,'wrong');assert.equal(process.env.TZ,'other');`);
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,finalPass);
});

const tests = n => `import test from 'node:test';import assert from 'node:assert/strict';
  for(let i=0;i<${n};i++)test('synthetic '+i,()=>{
    assert.ok(['UTC','America/Los_Angeles'].includes(process.env.TZ));
  });\n`;
async function fixture(t, source, options={}) {
  const dir=await mkdtemp(join(tmpdir(),'shift h10 guard '));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const h10=join(dir,'experiments/h10-rest-analysis');
  const scripts=join(dir,'experiments/tenant-do-isolation/scripts');
  await mkdir(h10,{recursive:true});await mkdir(scripts,{recursive:true});
  await copyFile(entry,join(h10,'check-rest-tests.mjs'));
  for(const name of ['check-test-run.mjs','test-summary-reporter.mjs']) {
    if(options.missingReporter&&name==='test-summary-reporter.mjs')continue;
    await copyFile(join(root,'experiments/tenant-do-isolation/scripts',name),join(scripts,name));
  }
  await copyFile(join(root,'package.json'),join(dir,'package.json'));
  await symlink(join(root,'node_modules'),join(dir,'node_modules'), 'dir');
  if(!options.missingTest)await writeFile(join(h10,'rest-analysis.test.ts'),source);
  let target=join(h10,'check-rest-tests.mjs');
  if(options.link){const link=join(dir,'linked entry.mjs');await symlink(target,link);target=link;}
  if(options.boundary) {
    const preload=join(dir,'harmless-preload.cjs');
    await writeFile(preload,"process.env.SHIFT_H10_PRELOAD='loaded';\n");
    // Set options after launcher startup. Quoting is required for the space path.
    const option='--require '+JSON.stringify(preload);
    const launcher=`import assert from 'node:assert/strict';
      assert.equal(process.env.SHIFT_H10_PRELOAD,undefined);
      process.env.NODE_OPTIONS=${JSON.stringify(option)};process.env.NODE_TEST_CONTEXT='wrong';
      process.argv=[process.execPath,${JSON.stringify(target)}];
      await import(${JSON.stringify(pathToFileURL(target).href)});
      assert.equal(process.env.NODE_OPTIONS,${JSON.stringify(option)});
      assert.equal(process.env.NODE_TEST_CONTEXT,'wrong');
      assert.equal(process.env.SHIFT_H10_PRELOAD,undefined);`;
    return launch(['--input-type=module','-e',launcher],{cwd:dir});
  }
  return launch([target,...(options.args??[])],{cwd:dir});
}
test('CLI completes 77 real synthetic tests in both TZs from a space path', async t=>{
  const r=await fixture(t,tests(77));assert.equal(r.status,0,r.stderr);assert.match(r.stdout,finalPass);
});
for(const [name,source,options,reason,detail] of [
  ['76 tests',tests(76),{},/Test counts rejected: minimum=77/],
  ['zero declarations','// empty',{},/Test counts rejected/],
  ['skip',tests(76)+"test('skip',{skip:true},()=>{});",{},/Test counts rejected/,/"skipped":1/],
  ['todo',tests(76)+"test('todo',{todo:true},()=>{});",{},/Test counts rejected/,/"todo":1/],
  ['failed assertion',tests(76)+"test('fail',()=>assert.equal(1,2,'synthetic assertion'));",{},/Test process failed: 1/,/synthetic assertion/],
  ['early exit0',tests(77)+'process.exit(0);',{},/Test counts rejected/],
  ['missing file','',{missingTest:true},/Test process failed: 1/,/Could not find.*rest-analysis\.test\.ts/],
  ['missing reporter',tests(77),{missingReporter:true},/Test process failed: 7/,/ERR_MODULE_NOT_FOUND/],
  ['syntax error','! syntax error !',{},/Test process failed: 1/],
  ['CLI override',tests(77),{args:['--minimum','1']},/No arguments accepted/],
  ['Los Angeles failure only',tests(77)+"test('TZ assertion',()=>assert.notEqual(process.env.TZ,'America/Los_Angeles','synthetic LA failure'));",{},/Test process failed: 1/,/synthetic LA failure/],
]) test(`CLI rejects ${name} for the expected reason`,async t=>{
  const r=await fixture(t,source,options);assert.equal(r.status,1,r.stderr);
  assert.doesNotMatch(r.stdout,finalPass);assert.match(r.stderr,reason);
  if(detail)assert.match(r.stderr,detail);
  if(name==='Los Angeles failure only')assert.match(r.stdout,/h10-rest UTC: PASS/);
});
test('child boundary removes options set only after launcher startup',async t=>{
  const source=tests(76)+`test('child assertion',()=>assert.equal(process.env.SHIFT_H10_PRELOAD,undefined,'synthetic child inherited NODE_OPTIONS'));`;
  const r=await fixture(t,source,{boundary:true});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,finalPass);
});
test('symlink CLI actually runs both TZs',async t=>{
  const r=await fixture(t,tests(77),{link:true});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,finalPass);
});
test('symlink CLI actually rejects 76 tests',async t=>{
  const r=await fixture(t,tests(76),{link:true});assert.equal(r.status,1,r.stderr);assert.match(r.stderr,/Test counts rejected/);
});
