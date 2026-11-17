import { spawnSync } from 'node:child_process';
import { readFileSync, appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const shaPattern = /^[0-9a-f]{40}$/;
function sha(value) {
  if (typeof value !== 'string' || !shaPattern.test(value) || /^0+$/.test(value)) {
    throw new Error('Missing or unsupported commit SHA');
  }
  return value;
}

export function comparison(eventName, event) {
  if (eventName === 'pull_request' && event?.pull_request?.base?.ref === 'main') {
    return { event:eventName, base:sha(event.pull_request.base.sha), head:sha(event.pull_request.head?.sha) };
  }
  if (eventName === 'push' && event?.ref === 'refs/heads/main') {
    return { event:eventName, base:sha(event.before), head:sha(event.after) };
  }
  throw new Error('Unsupported or incomplete event; no comparison performed');
}

function git(cwd, args) {
  const r=spawnSync('git',['--no-pager','--no-replace-objects',...args],{
    cwd,timeout:30_000,maxBuffer:4*1024*1024,encoding:null,
    stdio:['ignore','pipe','pipe'],shell:false,
  });
  if (r.error || r.signal || r.status !== 0) {
    throw new Error(`Git read failed: ${JSON.stringify({status:r.status,signal:r.signal,error:r.error?.message,stderr:r.stderr?.toString('utf8')})}`);
  }
  return r.stdout;
}

function validPath(path) {
  if (!path || path.startsWith('/') || path.split('/').some(s=>s==='' || s==='.' || s==='..')) {
    throw new Error('Invalid repository-relative path');
  }
  return path;
}

// Renames are deliberately disabled: a move is D + A and both paths are tested.
export function parseDiff(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error('Missing diff bytes');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if (text==='') return [];
  if (!text.endsWith('\0')) throw new Error('Truncated NUL-delimited diff');
  const fields=text.slice(0,-1).split('\0');
  if (fields.length%2!==0) throw new Error('Incomplete diff record');
  const seen=new Set(), changes=[];
  for(let i=0;i<fields.length;i+=2) {
    const status=fields[i], path=validPath(fields[i+1]);
    if (!['A','D','M','T'].includes(status) || seen.has(path)) throw new Error('Unknown or duplicate diff record');
    seen.add(path); changes.push({status,path});
  }
  return changes;
}

export function reasonsFor(path) {
  validPath(path);
  const reasons=[];
  if (path.startsWith('golden/')) reasons.push('golden-examples-and-schema');
  if (/^scripts\/check-golden(?:[.-]|$)/.test(path) || path.startsWith('scripts/golden/')) reasons.push('golden-loader-comparer-and-tests');
  if (/^\.github\/workflows\/(?:golden-.+|protected-.+|tenant-isolation)\.ya?ml$/.test(path)) reasons.push('validation-and-detection-workflow');
  if (path.startsWith('.claude/commands/')) reasons.push('audit-command-and-templates');
  if (path==='.claude/settings.json') reasons.push('audit-permissions');
  if (path.startsWith('scripts/protected-changes/')) reasons.push('change-detector-and-policy');
  if (['package.json','package-lock.json'].includes(path)) reasons.push('golden-command-and-dependencies');
  if (/^tsconfig[^/]*\.json$/.test(path) || path==='.npmrc') reasons.push('golden-runtime-configuration');
  return reasons;
}

export function collectReport(cwd, eventName, event) {
  const range=comparison(eventName,event);
  for(const id of [range.base,range.head]) {
    if (git(cwd,['cat-file','-t',id]).toString('ascii')!=='commit\n') throw new Error('Comparison object is not a commit');
  }
  let comparisonBase=range.base;
  if (range.event==='pull_request') {
    const bases=git(cwd,['merge-base','--all',range.base,range.head]).toString('ascii').trim().split('\n');
    if (bases.length!==1) throw new Error('Ambiguous merge base');
    comparisonBase=sha(bases[0]);
  }
  const changes=parseDiff(git(cwd,[
    'diff','--no-ext-diff','--no-textconv','--no-renames','--name-status','-z',comparisonBase,range.head,'--',
  ]));
  return {
    format:'protected-change-report-v1',...range,comparisonBase,
    approval:'not-evaluated',changedFiles:changes.length,
    protectedChanges:changes.flatMap(change=>{
      const reasons=reasonsFor(change.path); return reasons.length?[{...change,reasons}]:[];
    }),
  };
}

export function summaryMarkdown(report) {
  const escaped=JSON.stringify(report,null,2).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  return `## Protected change detection\n\nDetection is not owner approval. Review the fixed SHA and diff before adoption.\n\n<pre>${escaped}</pre>\n`;
}

if (process.argv[1] && process.argv[1]!=='-'
    && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.length!==2 || !process.env.GITHUB_EVENT_PATH) throw new Error('Use GitHub event file; no CLI arguments');
    if (!process.env.GITHUB_STEP_SUMMARY) throw new Error('GITHUB_STEP_SUMMARY is required');
    const report=collectReport(process.cwd(),process.env.GITHUB_EVENT_NAME,JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')));
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,summaryMarkdown(report));
    // JSON escapes control characters in untrusted file names; never shell-evaluate paths.
    console.log(JSON.stringify(report));
  } catch(error) {
    console.error(`Protected change detection failed: ${JSON.stringify(error.message)}`);
    process.exitCode=1;
  }
}
