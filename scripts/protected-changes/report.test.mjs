import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, rename, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comparison, parseDiff, reasonsFor, collectReport, summaryMarkdown } from './report.mjs';

const id='a'.repeat(40);
const pr=(base,head)=>({pull_request:{base:{ref:'main',sha:base},head:{sha:head}}});
const push=(base,head)=>({ref:'refs/heads/main',before:base,after:head});
const git=(cwd,...args)=>{
  const r=spawnSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd,encoding:'utf8',timeout:10_000});
  assert.equal(r.status,0,r.stderr); return r.stdout.trim();
};
async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'shift-protected-fixture-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  git(dir,'init','-q'); git(dir,'config','user.email','fictional@example.invalid'); git(dir,'config','user.name','Fictional Fixture');
  return dir;
}
async function put(dir,path,content='fictional\n') {
  await mkdir(dirname(join(dir,path)),{recursive:true}); await writeFile(join(dir,path),content);
}
function commit(dir) { git(dir,'add','--all'); git(dir,'commit','-q','--allow-empty','-m','synthetic'); return git(dir,'rev-parse','HEAD'); }

for (const path of [
  'golden/H10/example.JSON','golden/schema/new.schema.json','scripts/check-golden.ts','scripts/check-golden.test.ts',
  'scripts/golden/new-loader.mjs','.github/workflows/golden-check.yml','.github/workflows/golden-future.yaml',
  '.github/workflows/tenant-isolation.yml','.github/workflows/protected-changes.yml',
  '.claude/settings.json','.claude/commands/audit-pr.md','.claude/commands/templates/future.md',
  'scripts/protected-changes/report.test.mjs','package.json','package-lock.json',
]) test(`maps protected category: ${path}`,()=>assert.ok(reasonsFor(path).length>0));
test('unrelated files are not swept into the protected table',()=>{
  for(const path of ['README_2.md','src/ui.ts','docs/decisions.md','scripts/unrelated.mjs','.github/workflows/unrelated.yml','.claude/unrelated.txt']) {
    assert.deepEqual(reasonsFor(path),[]);
  }
});

test('actual Git modify/add/delete/type change and both sides of moves',async t=>{
  const dir=await fixture(t);
  for(const path of ['golden/modify.json','golden/delete.json','golden/move-out.json','golden/old.json','outside/move-in.json','golden/type.json']) await put(dir,path);
  const base=commit(dir);
  await put(dir,'golden/modify.json','changed\n'); await put(dir,'golden/add.json'); await rm(join(dir,'golden/delete.json'));
  await rename(join(dir,'golden/move-out.json'),join(dir,'outside/moved-out.json'));
  await rename(join(dir,'outside/move-in.json'),join(dir,'golden/moved-in.json'));
  await rename(join(dir,'golden/old.json'),join(dir,'golden/new.json'));
  await rm(join(dir,'golden/type.json')); await symlink('nonexistent',join(dir,'golden/type.json'));
  const head=commit(dir);
  const r=collectReport(dir,'push',push(base,head));
  assert.deepEqual(Object.fromEntries(r.protectedChanges.map(x=>[x.path,x.status])),{
    'golden/add.json':'A','golden/delete.json':'D','golden/modify.json':'M','golden/move-out.json':'D',
    'golden/moved-in.json':'A','golden/new.json':'A','golden/old.json':'D','golden/type.json':'T',
  });
  assert.equal(r.changedFiles,10); assert.equal(r.approval,'not-evaluated');
});
test('spaces, tabs, newlines, Unicode, quotes and shell-like names are data',async t=>{
  const dir=await fixture(t), base=commit(dir);
  const paths=['golden/space name.json','golden/tab\tname.json','golden/line\n::error::name.json','golden/日本語.json',
    'golden/$(touch SHOULD-NOT-EXIST).json','golden/`touch ALSO-NOT`.json','golden/<script>&".json','golden/back\\slash.json'];
  for(const path of paths) await put(dir,path);
  const r=collectReport(dir,'push',push(base,commit(dir)));
  assert.deepEqual(new Set(r.protectedChanges.map(x=>x.path)),new Set(paths));
  assert.equal(existsSync(join(dir,'SHOULD-NOT-EXIST')),false);
  assert.equal(existsSync(join(dir,'ALSO-NOT')),false);
  assert.doesNotMatch(summaryMarkdown(r),/<script>/);
  assert.ok(summaryMarkdown(r).includes('&lt;script&gt;&amp;'));
  assert.equal(JSON.stringify(r).split('\n').length,1);
});
test('empty diff is valid, but still never owner approval',async t=>{
  const dir=await fixture(t), base=commit(dir), r=collectReport(dir,'push',push(base,base));
  assert.equal(r.changedFiles,0); assert.deepEqual(r.protectedChanges,[]); assert.equal(r.approval,'not-evaluated');
});
test('unrelated-only changes produce no recognized protected paths',async t=>{
  const dir=await fixture(t),base=commit(dir); await put(dir,'src/unrelated.js');
  const r=collectReport(dir,'push',push(base,commit(dir)));
  assert.equal(r.changedFiles,1); assert.deepEqual(r.protectedChanges,[]);
});
test('PR uses merge base, not new changes on the target branch',async t=>{
  const dir=await fixture(t),common=commit(dir);
  git(dir,'checkout','-q','-b','target'); await put(dir,'golden/target-only.json'); const base=commit(dir);
  git(dir,'checkout','-q','-b','proposal',common); await put(dir,'golden/proposal-only.json'); const head=commit(dir);
  const r=collectReport(dir,'pull_request',pr(base,head));
  assert.equal(r.base,base); assert.equal(r.comparisonBase,common);
  assert.deepEqual(r.protectedChanges.map(x=>x.path),['golden/proposal-only.json']);
});
test('unavailable commit and non-commit object fail instead of empty diff',async t=>{
  const dir=await fixture(t),base=commit(dir);
  assert.throws(()=>collectReport(dir,'push',push(base,id)),/Git read failed/);
  const tree=git(dir,'rev-parse','HEAD^{tree}');
  assert.throws(()=>collectReport(dir,'push',push(base,tree)),/not a commit/);
});
test('no shared history fails instead of reporting no protected changes',async t=>{
  const dir=await fixture(t),base=commit(dir);
  git(dir,'checkout','-q','--orphan','unrelated'); await put(dir,'unrelated-root.txt'); const head=commit(dir);
  assert.notEqual(head,base,'The orphan fixture must not recreate the identical root commit');
  assert.throws(()=>collectReport(dir,'pull_request',pr(base,head)),/Git read failed/);
});
test('Git acquisition failure is not an empty diff',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'shift-no-repository-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  assert.throws(()=>collectReport(dir,'push',push(id,id)),/Git read failed/);
});
test('ambiguous PR merge bases fail instead of choosing one silently',async t=>{
  const dir=await fixture(t),root=commit(dir),tree=git(dir,'rev-parse','HEAD^{tree}');
  const make=parents=>git(dir,'commit-tree',tree,...parents.flatMap(p=>['-p',p]),'-m',parents.join(' '));
  const a=make([root]), b=git(dir,'commit-tree',tree,'-p',root,'-m','different');
  const one=make([a,b]), two=make([b,a]);
  assert.throws(()=>collectReport(dir,'pull_request',pr(one,two)),/Ambiguous merge base/);
});
for(const [name,eventName,event] of [
  ['missing payload','pull_request',null],['missing head','pull_request',{pull_request:{base:{ref:'main',sha:id}}}],
  ['wrong target','pull_request',{pull_request:{base:{ref:'other',sha:id},head:{sha:id}}}],
  ['missing before','push',{ref:'refs/heads/main',after:id}],['zero before','push',push('0'.repeat(40),id)],
  ['option-like SHA','push',push('--help',id)],['revision syntax','push',push('HEAD~1',id)],
  ['wrong push ref','push',{...push(id,id),ref:'refs/heads/other'}],['unsupported event','pull_request_target',pr(id,id)],
]) test(`rejects event ${name}`,()=>assert.throws(()=>comparison(eventName,event)));
for(const [name,bytes] of [
  ['missing',undefined],['string',''],['truncated',Buffer.from('M\0golden/a')],
  ['missing path',Buffer.from('M\0')],['unknown status',Buffer.from('R100\0golden/a\0')],
  ['empty path',Buffer.from('M\0\0')],['duplicate',Buffer.from('M\0golden/a\0A\0golden/a\0')],
  ['traversal',Buffer.from('M\0../golden/a\0')],['absolute',Buffer.from('M\0/golden/a\0')],
  ['invalid UTF8',Buffer.from([77,0,255,0])],
]) test(`rejects malformed diff ${name}`,()=>assert.throws(()=>parseDiff(bytes)));

async function cli(t, eventText, {eventName='push',missingFile=false,unwritableSummary=false,args=[]}={}) {
  const dir=await fixture(t),base=commit(dir); await put(dir,'golden/fixture.json'); const head=commit(dir);
  const eventPath=join(dir,'event.json'),summaryPath=join(dir,'summary.md');
  if(!missingFile) await writeFile(eventPath,eventText??JSON.stringify(push(base,head)));
  return spawnSync(process.execPath,[fileURLToPath(new URL('./report.mjs',import.meta.url)),...args],{
    cwd:dir,env:{...process.env,GITHUB_EVENT_NAME:eventName,GITHUB_EVENT_PATH:eventPath,GITHUB_STEP_SUMMARY:unwritableSummary?dir:summaryPath},
    encoding:'utf8',timeout:10_000,
  });
}
test('CLI reads event JSON and emits report, not approval',async t=>{
  const r=await cli(t); assert.equal(r.status,0,r.stderr);
  const report=JSON.parse(r.stdout); assert.equal(report.approval,'not-evaluated'); assert.equal(report.protectedChanges.length,1);
});
test('summary write failure also exits nonzero',async t=>{
  const r=await cli(t,null,{unwritableSummary:true}); assert.equal(r.status,1);
  assert.match(r.stderr,/Protected change detection failed/);
});
for(const [name,text,options] of [
  ['invalid JSON','{bad}',{}],['missing event file',null,{missingFile:true}],
  ['empty event','',{}],['incomplete event','{}',{}],['unsupported event',null,{eventName:'workflow_dispatch'}],
  ['extra argument',null,{args:['--approve']}],
]) test(`CLI fails on ${name}`,async t=>{
  const r=await cli(t,text,options); assert.equal(r.status,1,r.stderr); assert.equal(r.stdout,'');
});
