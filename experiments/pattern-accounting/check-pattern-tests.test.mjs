import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, rm, symlink, lstat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const entry = fileURLToPath(new URL('./check-pattern-tests.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const finalPass = /pattern-minutes: PASS timezones=2/;
const summary = (n = 56) => ({
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
      assert.equal(args[4],${JSON.stringify(fileURLToPath(new URL('./pattern-minutes.test.ts', import.meta.url)))});
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
for (const n of [56,57]) test(`artificial complete ${n} is accepted in both TZs`, () => {
  const r = artificial({status:0,stdout:encode(summary(n))}, '', 'assert.equal(calls,2);');
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,finalPass);
  assert.match(r.stdout,/pattern-minutes UTC: PASS minimum=56/);
  assert.match(r.stdout,/pattern-minutes America\/Los_Angeles: PASS minimum=56/);
});
for (const [name, mutate, reason] of [
  ['55 tests',r=>r.stdout=encode(summary(55)),/Test counts rejected: minimum=56/],
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
  ['nested count',r=>{const s=summary();s.counts.topLevel=55;r.stdout=encode(s);},/Flat test count mismatch/],
  ['suite count',r=>{const s=summary();s.counts.suites=1;r.stdout=encode(s);},/Flat test count mismatch/],
  ['success false',r=>{const s=summary();s.success=false;r.stdout=encode(s);},/Invalid machine summary/],
  ['passed mismatch',r=>{const s=summary();s.counts.passed=55;r.stdout=encode(s);},/Test counts rejected/],
  ['missing counter',r=>{const s=summary();delete s.counts.skipped;r.stdout=encode(s);},/Invalid machine summary/],
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
  const r=artificial(result(), `process.env.PATTERN_MINIMUM='1';process.env.PATTERN_FILE='other';
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
  const dir=await mkdtemp(join(tmpdir(),'shift pattern guard '));
  const links=[];
  t.after(async()=>{
    for(const link of links) {
      assert.equal((await lstat(link)).isSymbolicLink(),true,'Preserve fixture if link was replaced');
      await unlink(link);
    }
    await rm(dir,{recursive:true,force:true});
  });
  const pattern=join(dir,'experiments/pattern-accounting');
  const scripts=join(dir,'experiments/tenant-do-isolation/scripts');
  await mkdir(pattern,{recursive:true});await mkdir(scripts,{recursive:true});
  await copyFile(entry,join(pattern,'check-pattern-tests.mjs'));
  for(const name of ['check-test-run.mjs','test-summary-reporter.mjs']) {
    if(options.missingReporter&&name==='test-summary-reporter.mjs')continue;
    await copyFile(join(root,'experiments/tenant-do-isolation/scripts',name),join(scripts,name));
  }
  if(options.reporter!==undefined)await writeFile(join(scripts,'test-summary-reporter.mjs'),options.reporter);
  await copyFile(join(root,'package.json'),join(dir,'package.json'));
  await symlink(join(root,'node_modules'),join(dir,'node_modules'), 'dir');
  links.push(join(dir,'node_modules'));
  if(!options.missingTest)await writeFile(join(pattern,'pattern-minutes.test.ts'),source);
  let target=join(pattern,'check-pattern-tests.mjs');
  if(options.link){const link=join(dir,'linked entry.mjs');await symlink(target,link);links.push(link);target=link;}
  if(options.boundary) {
    const preload=join(dir,'harmless-preload.cjs');
    await writeFile(preload,"process.env.SHIFT_PATTERN_PRELOAD='loaded';\n");
    // Set options after launcher startup. Quoting is required for the space path.
    const option='--require '+JSON.stringify(preload);
    const launcher=`import assert from 'node:assert/strict';
      assert.equal(process.env.SHIFT_PATTERN_PRELOAD,undefined);
      process.env.NODE_OPTIONS=${JSON.stringify(option)};process.env.NODE_TEST_CONTEXT='wrong';
      process.argv=[process.execPath,${JSON.stringify(target)}];
      await import(${JSON.stringify(pathToFileURL(target).href)});
      assert.equal(process.env.NODE_OPTIONS,${JSON.stringify(option)});
      assert.equal(process.env.NODE_TEST_CONTEXT,'wrong');
      assert.equal(process.env.SHIFT_PATTERN_PRELOAD,undefined);`;
    return launch(['--input-type=module','-e',launcher],{cwd:dir});
  }
  return launch([target,...(options.args??[])],{cwd:dir});
}
test('CLI completes 56 real synthetic tests in both TZs from a space path', async t=>{
  const r=await fixture(t,tests(56));assert.equal(r.status,0,r.stderr);assert.match(r.stdout,finalPass);
});
for(const [name,source,options,reason,detail] of [
  ['55 tests',tests(55),{},/Test counts rejected: minimum=56/],
  ['zero declarations','// empty',{},/Test counts rejected/],
  ['skip',tests(55)+"test('skip',{skip:true},()=>{});",{},/Test counts rejected/,/"skipped":1/],
  ['todo',tests(55)+"test('todo',{todo:true},()=>{});",{},/Test counts rejected/,/"todo":1/],
  ['failed assertion',tests(55)+"test('fail',()=>assert.equal(1,2,'synthetic assertion'));",{},/Test process failed: 1/,/synthetic assertion/],
  ['early exit0',tests(56)+'process.exit(0);',{},/Test counts rejected/],
  ['missing file','',{missingTest:true},/Test process failed: 1/,/Could not find.*pattern-minutes\.test\.ts/],
  ['missing reporter',tests(56),{missingReporter:true},/Test process failed: 7/,/ERR_MODULE_NOT_FOUND/],
  ['explicit nonzero',tests(56)+'process.exitCode=2;',{},/Test process failed: 1/],
  ['syntax error','! syntax error !',{},/Test process failed: 1/],
  ['CLI override',tests(56),{args:['--minimum','1']},/No arguments accepted/],
  ['Los Angeles failure only',tests(56)+"test('TZ assertion',()=>assert.notEqual(process.env.TZ,'America/Los_Angeles','synthetic LA failure'));",{},/Test process failed: 1/,/synthetic LA failure/],
]) test(`CLI rejects ${name} for the expected reason`,async t=>{
  const r=await fixture(t,source,options);assert.equal(r.status,1,r.stderr);
  assert.doesNotMatch(r.stdout,finalPass);assert.match(r.stderr,reason);
  if(detail)assert.match(r.stderr,detail);
  if(name==='Los Angeles failure only')assert.match(r.stdout,/pattern-minutes UTC: PASS/);
});
test('child boundary removes options set only after launcher startup',async t=>{
  const source=tests(55)+`test('child assertion',()=>assert.equal(process.env.SHIFT_PATTERN_PRELOAD,undefined,'synthetic child inherited NODE_OPTIONS'));`;
  const r=await fixture(t,source,{boundary:true});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,finalPass);
});
test('symlink CLI actually runs both TZs',async t=>{
  const r=await fixture(t,tests(56),{link:true});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,finalPass);
});
test('symlink CLI actually rejects 55 tests',async t=>{
  const r=await fixture(t,tests(55),{link:true});assert.equal(r.status,1,r.stderr);assert.match(r.stderr,/Test counts rejected/);
});

const fakeReporter = output => `export default async function* report(events){for await(const e of events){}yield ${JSON.stringify(output)};}`;
for(const [name,output,reason] of [
  ['missing','',/Missing or incomplete machine summary/],
  ['repeated',encode(summary())+encode(summary()),/JSON/],
  ['partial',encode(summary()).slice(0,-1),/Missing or incomplete machine summary/],
  ['malformed','{bad}\n',/JSON/],
]) test(`real child reporter rejects ${name} summary`,async t=>{
  const r=await fixture(t,tests(56),{reporter:fakeReporter(output)});
  assert.equal(r.status,1,r.stderr);assert.match(r.stderr,reason);assert.doesNotMatch(r.stdout,finalPass);
});
test('Node supports the harmless NODE_OPTIONS control independently',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'shift pattern preload '));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const preload=join(dir,'mark.cjs');await writeFile(preload,"process.env.SHIFT_PATTERN_PRELOAD='loaded';");
  const env={...process.env,NODE_OPTIONS:'--require '+JSON.stringify(preload)};
  delete env.NODE_TEST_CONTEXT;delete env.SHIFT_PATTERN_PRELOAD;
  const r=launch(['-e',"process.stdout.write(process.env.SHIFT_PATTERN_PRELOAD??'missing')"],{env});
  assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'loaded');
});
for(const [name,source] of [
  ['no declarations','// empty'],['55 tests',tests(55)],
  ['skip',tests(55)+"test('skip',{skip:true},()=>{});"],
  ['todo',tests(55)+"test('todo',{todo:true},()=>{});"],
  ['early exit0',tests(56)+'process.exit(0);'],
]) test(`bare Node control can succeed with ${name}`,async t=>{
  const dir=await mkdtemp(join(tmpdir(),'shift pattern bare '));
  t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'test.mjs');await writeFile(file,source);
  const env={...process.env,TZ:'UTC'};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
  const r=launch(['--test',file],{env});
  assert.equal(r.status,0,r.stderr);
});
