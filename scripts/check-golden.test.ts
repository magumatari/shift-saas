import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, symlink, unlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkGolden, parseJson } from './check-golden.ts';

const failPath = 'golden/H10/H10-rest-1199min-fail.json';
const fail = JSON.parse(await readFile(failPath, 'utf8'));
type Fixture = typeof fail;
function documentExample(doc: string) {
  return JSON.parse(doc.replace(/\r\n/g, '\n').split('```json\n')[1].split('\n```')[0]);
}
async function clearWorkspace(workspace: string, links: string[], unlinkLink = unlink, removeTree = rm): Promise<void> {
  // Remove only links created by this fixture before any recursive deletion.
  // If inspection/unlink fails, throw and leave the workspace for inspection.
  for (const link of [...links].reverse()) {
    assert.equal(dirname(link),workspace);
    assert.ok((await lstat(link)).isSymbolicLink(),'Refuse cleanup of changed fixture link');
    await unlinkLink(link);
  }
  await removeTree(workspace, { recursive:true, force:true });
}
type MakeLink = (target: string, path: string) => Promise<void>;
async function withCase(change: (c: Fixture) => void, run: (dir: string, makeLink: MakeLink) => Promise<void>): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), 'golden-test-'));
  const dir = join(workspace,'golden');
  const links: string[]=[];
  const makeLink: MakeLink = async (target,path) => {
    assert.equal(dirname(path),workspace);
    await symlink(target,path,'junction');links.push(path);
  };
  try {
    await mkdir(dir);
    await mkdir(join(dir, 'schema'));
    await copyFile('golden/schema/golden-case.schema.json', join(dir, 'schema/golden-case.schema.json'));
    const c = structuredClone(fail); change(c);
    await writeFile(join(dir, 'case.json'), JSON.stringify(c));
    await run(dir,makeLink);
  } finally { await clearWorkspace(workspace,links); }
}
test('both draft examples pass format checks and FAIL matches the document', async () => {
  const result = await checkGolden('golden');
  assert.deepEqual(result, { count: 2, errors: [] });
  const doc = await readFile('docs/hard-rules.md', 'utf8');
  assert.deepEqual(fail, documentExample(doc));
  const pass = JSON.parse(await readFile('golden/H10/H10-rest-1200min-pass.json', 'utf8'));
  const changedInput = structuredClone(fail.input); changedInput.patterns[1].start = '02:00';
  assert.deepEqual(pass.input, changedInput);
  assert.deepEqual(pass.assignments, fail.assignments);
  for (const c of [fail, pass]) {
    assert.equal(c.status, 'draft'); assert.equal(c.approved_by, null); assert.equal(c.approved_at, null);
  }
  const assignmentTimes = (c: Fixture) => {
    type Pattern = { id: string; version: number; start: string; duration_minutes: number };
    type Assignment = { id: string; pattern: string; start_date: string };
    const patterns = new Map((c.input.patterns as Pattern[]).map(p => [`${p.id}@${p.version}`, p]));
    return (c.assignments as Assignment[]).map(a => {
      const p = patterns.get(a.pattern); assert.ok(p);
      const start = Date.parse(`${a.start_date}T${p.start}+09:00`);
      return { id: a.id, start, end: start + p.duration_minutes * 60000 };
    }).sort((a, b) => a.start - b.start);
  };
  const gaps = [fail, pass].map(c => {
    const times = assignmentTimes(c); assert.equal(times.length, 2);
    return (times[1].start - times[0].end) / 60000;
  });
  assert.equal(gaps[0], fail.input.company.min_rest_minutes - 1);
  assert.equal(gaps[1], pass.input.company.min_rest_minutes);
  assert.equal(fail.expected.result, 'FAIL');
  assert.deepEqual(fail.expected.rule_results, { H10: 'FAIL' });
  assert.equal(fail.expected.violations.length, 1);
  const v = fail.expected.violations[0];
  const times = assignmentTimes(fail);
  assert.equal(Date.parse(v.from + '+09:00'), times[0].end);
  assert.equal(Date.parse(v.to + '+09:00'), times[1].start);
  assert.deepEqual([...v.assignments].sort(), times.map(a => a.id).sort());
  assert.equal(v.measured, gaps[0]);
  assert.equal(v.limit, fail.input.company.min_rest_minutes);
  assert.equal(v.diff, gaps[0] - v.limit);
  assert.equal(v.comparison, '>=');
  assert.equal(pass.expected.result, 'PASS');
  assert.deepEqual(pass.expected.rule_results, { H10: 'PASS' });
  assert.deepEqual(pass.expected.violations, []);
});
for (const text of ['{"a":1,"a":2}', '{"nested":{"a":1,"\\u0061":2}}', '{"a":1,}', '{/*comment*/"a":1}', '{"a":NaN}']) {
  test(`strict JSON rejects ${text}`, () => assert.throws(() => parseJson(text)));
}
test('same key in separate objects is allowed', () => assert.equal(JSON.stringify(parseJson('[{"a":1},{"a":2}]')), '[{"a":1},{"a":2}]'));
const bad: [string, (c: Fixture) => void, RegExp][] = [
  ['unknown root key', c => { c.extra = 1; }, /additional properties/],
  ['unknown nested key', c => { c.input.patterns[0].extra = 1; }, /additional properties/],
  ['missing approval', c => { c.status = 'confirmed'; delete c.approved_by; }, /approved_by/],
  ['null approval', c => { c.status = 'provisional_legal'; }, /approved/],
  ['missing approved expected', c => { c.status='confirmed'; c.approved_by='test'; c.approved_at='2026-12-01T00:00'; delete c.expected; }, /expected/],
  ['undecided with expected', c => { c.status = 'undecided'; }, /NOT be valid/],
  ['PASS with violations', c => { c.expected.result = 'PASS'; }, /violations/],
  ['FAIL without violations', c => { c.expected.violations = []; }, /violations/],
  ['INDETERMINATE without reasons', c => { c.expected.result = 'INDETERMINATE'; c.expected.violations = []; }, /indeterminate/],
  ['partial quantities', c => { delete c.expected.violations[0].unit; }, /unit/],
  ['wrong diff', c => { c.expected.violations[0].diff = 1; }, /diff must equal/],
  ['REST_SHORTAGE limit above company setting', c => { c.expected.violations[0].limit=1201; c.expected.violations[0].diff=-2; }, /REST_SHORTAGE limit must match input\/company\/min_rest_minutes/],
  ['REST_SHORTAGE limit below company setting', c => { c.input.company.min_rest_minutes=1201; }, /REST_SHORTAGE limit must match input\/company\/min_rest_minutes/],
  ['REST_SHORTAGE limit with explicit zero company setting', c => { c.input.company.min_rest_minutes=0; }, /REST_SHORTAGE limit must match input\/company\/min_rest_minutes/],
  ['wrong rule', c => { c.expected.violations[0].rule = 'H11'; }, /constant/],
  ['wrong violation code', c => { c.expected.violations[0].code = 'OTHER'; }, /constant/],
  ['one violation assignment', c => { c.expected.violations[0].assignments.pop(); }, /assignments/],
  ['missing violation employee', c => { delete c.expected.violations[0].employee; }, /employee/],
  ['24:00', c => { c.input.patterns[0].start = '24:00'; }, /pattern/],
  ['timezone suffix', c => { c.expected.violations[0].from += '+09:00'; }, /pattern/],
  ['February 30', c => { c.assignments[0].start_date = '2026-02-30'; }, /nonexistent date/],
  ['non-leap century', c => { c.input.employees[0].employment[0] = '1900-02-29'; }, /nonexistent date/],
  ['bad date in datetime', c => { c.expected.violations[0].from='2026-04-31T06:00'; }, /nonexistent date/],
  ['zero interval', c => { c.input.patterns[0].work[0]=[0,0]; }, /invalid interval/],
  ['reversed interval', c => { c.input.patterns[0].work[0]=[240,0]; }, /invalid interval/],
  ['gap', c => { c.input.patterns[0].work[0][1]=239; }, /gap or overlap/],
  ['overlap', c => { c.input.patterns[0].work[0][1]=241; }, /gap or overlap/],
  ['short partition', c => { c.input.patterns[0].duration_minutes=481; }, /must cover/],
  ['cover crosses break', c => { c.input.patterns[0].cover=[[0,480]]; }, /outside work/],
  ['missing employee', c => { c.assignments[0].employee='missing'; }, /unknown employee/],
  ['missing store', c => { c.assignments[0].store='missing'; }, /unknown store/],
  ['missing pattern version', c => { c.assignments[0].pattern='NIGHT@2'; }, /unknown pattern/],
  ['existing assignment reference', c => { c.input.existing_assignments=[{...c.assignments[0],id:'A3',employee:'missing'}]; }, /unknown employee/],
  ['unknown violation employee', c => { c.expected.violations[0].employee='E9'; }, /expected\/violations\/0: unknown employee E9/],
  ['unknown first violation assignment', c => { c.expected.violations[0].assignments[0]='A9'; }, /expected\/violations\/0: unknown assignment A9/],
  ['unknown second violation assignment', c => { c.expected.violations[0].assignments[1]='A9'; }, /expected\/violations\/0: unknown assignment A9/],
  ['unknown complete-record employee', c => { c.input.coverage.records_complete[0].employees=['E9']; }, /records_complete\/0: unknown employee E9/],
  ['PASS with FAIL rule result and no violations', c => { c.expected.result='PASS'; c.expected.violations=[]; }, /expected\/result: must agree/],
  ['FAIL with PASS rule result', c => { c.expected.rule_results.H10='PASS'; }, /expected\/result: must agree/],
  ['empty rule results', c => { c.expected.rule_results={}; }, /keys must match evaluated_rules/],
  ['extra rule result', c => { c.expected.rule_results.H11='PASS'; }, /keys must match evaluated_rules/],
  ['missing evaluated rule result', c => { c.target_rules.push('H11'); c.expected.evaluated_rules.push('H11'); }, /keys must match evaluated_rules/],
  ['unit misses target rule', c => { c.target_rules.push('H11'); }, /must match target_rules/],
  ['unit evaluates extra rule', c => { c.expected.evaluated_rules.push('H11'); c.expected.rule_results.H11='PASS'; }, /must match target_rules/],
  ['violation outside evaluated rules', c => { c.target_rules=['H11']; c.expected.evaluated_rules=['H11']; c.expected.rule_results={H11:'FAIL'}; }, /rule must be in evaluated_rules/],
  ['violation with non-FAIL rule', c => { c.expected.rule_results.H10='INDETERMINATE'; }, /rule result must be FAIL/],
  ['additional FAIL rule without violation', c => { c.target_rules.push('H11'); c.expected.evaluated_rules.push('H11'); c.expected.rule_results.H11='FAIL'; }, /H11: FAIL requires a violation/],
  ['indeterminate rule without reasons alongside FAIL', c => { c.target_rules.push('H11'); c.expected.evaluated_rules.push('H11'); c.expected.rule_results.H11='INDETERMINATE'; }, /indeterminate rule requires reasons/],
  ['integrated misses rules', c => { c.kind='integrated'; }, /must match H01-H19/],
  ['lower-bound violation at equality', c => { const v=c.expected.violations[0]; v.measured=v.limit; v.diff=0; }, /lower-bound violation/],
  ['lower-bound violation has positive diff', c => { const v=c.expected.violations[0]; v.measured=v.limit+1; v.diff=1; }, /lower-bound violation/],
  ['upper-bound comparison has negative diff', c => { c.expected.violations[0].comparison='<='; }, /upper-bound violation/],
  ['REST_SHORTAGE cannot become upper-bound violation', c => { const v=c.expected.violations[0]; v.comparison='<='; v.measured=v.limit+1; v.diff=1; }, /REST_SHORTAGE comparison must be >=/],
  ['empty violation interval', c => { c.expected.violations[0].to=c.expected.violations[0].from; }, /from must be < to/],
  ['reversed violation interval', c => { const v=c.expected.violations[0]; [v.from,v.to]=[v.to,v.from]; }, /from must be < to/],
  ['reversed verify period', c => { c.input.coverage.verify_period.reverse(); }, /verify_period: start must be <= end/],
  ['reversed assignment coverage', c => { c.input.coverage.assignments_complete.reverse(); }, /assignments_complete: start must be <= end/],
  ['reversed record period', c => { c.input.coverage.records_complete[0].period.reverse(); }, /records_complete\/0\/period: start must be <= end/],
  ['reversed employment', c => { c.input.employees[0].employment=['2026-12-31','2026-01-01']; }, /employment: start must be <= end/],
  ['draft with approver', c => { c.approved_by='synthetic-reviewer'; }, /draft\/approved_by: unapproved value must be null/],
  ['draft with approval time', c => { c.approved_at='2026-12-01T00:00'; }, /draft\/approved_at: unapproved value must be null/],
  ['zero duration even with empty partition', c => { const p=c.input.patterns[1]; p.duration_minutes=0; p.work=[]; p.break=[]; p.cover=[]; }, /duration_minutes must be positive/],
];
for (const [name, change, error] of bad) test(name, async () => {
  await withCase(change, async dir => assert.match((await checkGolden(dir)).errors.join('\n'), error));
});
const assignmentDatePaths: [string, (c: Fixture) => void, string[]][] = [
  ['candidate keeps its own index', c => { c.assignments[1].start_date='2026-02-30'; }, ['/assignments/1/start_date']],
  ['first existing follows candidates', c => { c.input.existing_assignments=[{...c.assignments[0],id:'A3',start_date:'2026-02-30'}]; }, ['/input/existing_assignments/0/start_date']],
  ['second existing without candidates', c => { c.input.existing_assignments=c.assignments; c.assignments=[]; c.input.existing_assignments[1].start_date='2026-02-30'; }, ['/input/existing_assignments/1/start_date']],
  ['both sources retain order and local indexes', c => {
    c.input.existing_assignments=[{...c.assignments[0],id:'A3'},{...c.assignments[1],id:'A4',start_date:'2026-02-30'}];
    c.assignments[1].start_date='2026-02-30';
  }, ['/assignments/1/start_date','/input/existing_assignments/1/start_date']],
];
for (const [name, change, paths] of assignmentDatePaths) test(`assignment date diagnostics: ${name}`, async () => {
  await withCase(change, async dir => assert.deepEqual(await checkGolden(dir),{
    count:1,errors:paths.map(path=>`case.json: ${path}: nonexistent date 2026-02-30`),
  }));
});
test('assignment date diagnostics: valid candidate and existing dates stay accepted', async () => {
  await withCase(c => { c.input.existing_assignments=[c.assignments.shift()]; }, async dir => {
    assert.deepEqual(await checkGolden(dir),{count:1,errors:[]});
  });
});
test('quantity fields may all be absent, valid leap day and adjacent work are allowed', async () => {
  await withCase(c => {
    for (const k of ['measured','limit','comparison','diff','unit']) delete c.expected.violations[0][k];
    c.input.employees[0].employment[0]='2000-02-29';
    c.input.patterns[1].work=[[0,120],[120,240]];
    c.title='2026-02-30'; // Text, not a date field.
  }, async dir => assert.deepEqual((await checkGolden(dir)).errors, []));
});
test('undecided without expected is accepted', async () => {
  await withCase(c => {c.status='undecided'; delete c.expected;}, async dir => assert.deepEqual((await checkGolden(dir)).errors, []));
});
for (const field of ['approved_by', 'approved_at', 'both', 'omitted']) {
  test(`undecided approval fields follow the unchanged Schema: ${field}`, async () => {
    await withCase(c => {
      c.status='undecided'; delete c.expected;
      if (field==='approved_by' || field==='both') c.approved_by='synthetic-reviewer';
      if (field==='approved_at' || field==='both') c.approved_at='2026-12-01T00:00';
      if (field==='omitted') { delete c.approved_by; delete c.approved_at; }
    }, async dir => assert.deepEqual((await checkGolden(dir)).errors, []));
  });
}
for (const status of ['confirmed', 'provisional_legal']) {
  test(`${status} still requires both approval fields`, async () => {
    await withCase(c => {
      c.status=status; c.approved_by='synthetic-reviewer'; c.approved_at='2026-12-01T00:00';
    }, async dir => assert.deepEqual((await checkGolden(dir)).errors, []));
    for (const field of ['approved_by', 'approved_at']) {
      await withCase(c => {
        c.status=status; c.approved_by='synthetic-reviewer'; c.approved_at='2026-12-01T00:00';
        delete c[field];
      }, async dir => assert.match((await checkGolden(dir)).errors.join('\n'), new RegExp(field)));
      await withCase(c => {
        c.status=status; c.approved_by='synthetic-reviewer'; c.approved_at='2026-12-01T00:00';
        c[field]=null;
      }, async dir => assert.match((await checkGolden(dir)).errors.join('\n'), new RegExp(field)));
    }
  });
}
for (const extension of ['JSON', 'Json', 'json5', 'jsonc', 'json.bak', 'yaml', 'txt']) {
  test(`unsupported example extension is an error: ${extension}`, async () => {
    await withCase(() => {}, async dir => {
      await mkdir(join(dir,'nested'));
      const name=`extra.${extension}`;
      await copyFile(join(dir,'case.json'),join(dir,'nested',name));
      const result=await checkGolden(dir);
      assert.equal(result.count,1);
      assert.deepEqual(result.errors,[`${join('nested',name)}: unsupported golden case file; only .json is supported`]);
      if (extension==='JSON') {
        const cli=spawnSync(process.execPath,['--import','tsx','scripts/check-golden.ts',dir],{encoding:'utf8'});
        assert.equal(cli.status,1); assert.match(cli.stderr,/extra\.JSON: unsupported golden case file/);
      }
    });
  });
}
test('the existing root README and canonical Schema are not examples', async () => {
  await withCase(() => {}, async dir => {
    await copyFile('golden/README.md',join(dir,'README.md'));
    assert.deepEqual(await checkGolden(dir),{count:1,errors:[]});
  });
});
test('existing assignment IDs can be referenced by violations', async () => {
  await withCase(c => { c.input.existing_assignments=[c.assignments.shift()]; }, async dir => assert.deepEqual((await checkGolden(dir)).errors, []));
});
const employeeMismatch = (id: string, employee = 'E1') => `expected/violations/0: assignment ${id} employee must match violation employee ${employee}`;
const wrongEmployeeReferences: [string, (c: Fixture) => void, string[]][] = [
  ['violation employee', c => { c.expected.violations[0].employee='E2'; }, [employeeMismatch('A1','E2'),employeeMismatch('A2','E2')]],
  ['first candidate', c => { c.assignments[0].employee='E2'; }, [employeeMismatch('A1')]],
  ['second candidate', c => { c.assignments[1].employee='E2'; }, [employeeMismatch('A2')]],
  ['first existing', c => { c.assignments[0].employee='E2'; c.input.existing_assignments=[c.assignments.shift()]; }, [employeeMismatch('A1')]],
  ['second existing', c => { c.assignments[1].employee='E2'; c.input.existing_assignments=[c.assignments.pop()]; }, [employeeMismatch('A2')]],
  ['unknown ID alongside mismatch', c => { c.expected.violations[0].assignments[0]='A9'; c.assignments[1].employee='E2'; }, ['expected/violations/0: unknown assignment A9',employeeMismatch('A2')]],
  ['duplicate ID across sources', c => { c.input.existing_assignments=[{...c.assignments[0],employee:'E2'}]; }, ['duplicate assignment id',employeeMismatch('A1')]],
];
for (const [name, change, errors] of wrongEmployeeReferences) test(`REST_SHORTAGE employee reference: rejects ${name}`, async () => {
  await withCase(c => {
    c.input.employees.push({...c.input.employees[0],id:'E2'});
    c.input.coverage.records_complete[0].employees.push('E2');
    change(c);
  }, async dir => assert.deepEqual((await checkGolden(dir)).errors,errors.map(error => `case.json: ${error}`)));
});
const validEmployeeReferences: [string, (c: Fixture) => void][] = [
  ['second existing', c => { c.input.existing_assignments=[c.assignments.pop()]; }],
  ['both existing', c => { c.input.existing_assignments=c.assignments; c.assignments=[]; }],
  ['other store', c => { c.input.stores.push({id:'S2'}); c.assignments[1].store='S2'; }],
  ['reversed order without quantities', c => {
    c.assignments.reverse(); c.expected.violations[0].assignments.reverse();
    for (const key of ['measured','limit','comparison','diff','unit']) delete c.expected.violations[0][key];
    assert.equal(c.status,'draft'); assert.equal(c.approved_by,null); assert.equal(c.approved_at,null);
  }],
];
for (const [name, change] of validEmployeeReferences) test(`REST_SHORTAGE employee reference: accepts ${name}`, async () => {
  await withCase(change, async dir => assert.deepEqual((await checkGolden(dir)).errors,[]));
});
const validRestLimits: [string, (c: Fixture) => void][] = [
  ['matching non-default setting', () => {}],
  ['existing assignment', c => { c.input.existing_assignments=[c.assignments.shift()]; }],
  ['other store', c => { c.input.stores.push({id:'S2'}); c.assignments[1].store='S2'; }],
  ['reversed references', c => { c.assignments.reverse(); c.expected.violations[0].assignments.reverse(); }],
  ['all quantities omitted', c => { for (const key of ['measured','limit','comparison','diff','unit']) delete c.expected.violations[0][key]; }],
  ['undecided without expected', c => { c.status='undecided'; delete c.expected; }],
];
for (const [name, change] of validRestLimits) test(`REST_SHORTAGE company limit: accepts ${name}`, async () => {
  await withCase(c => {
    c.input.company.min_rest_minutes=1201;
    c.expected.violations[0].limit=1201;
    c.expected.violations[0].diff=-2;
    change(c);
    assert.equal(c.approved_by,null); assert.equal(c.approved_at,null);
  }, async dir => assert.deepEqual(await checkGolden(dir),{count:1,errors:[]}));
});
for (const unit of ['minutes','days','people','assignments']) {
  test(`REST_SHORTAGE unit: ${unit === 'minutes' ? 'accepts' : 'rejects'} ${unit}`, async () => {
    await withCase(c => {
      // All values, IDs, approval state and quantities are otherwise identical.
      c.expected.violations[0].unit=unit;
      assert.equal(c.status,'draft');assert.equal(c.approved_by,null);assert.equal(c.approved_at,null);
    },async dir=>assert.deepEqual(await checkGolden(dir),{
      count:1,
      errors:unit==='minutes' ? [] : ['case.json: expected/violations/0: REST_SHORTAGE unit must be minutes'],
    }));
  });
}
test('rule lists are sets and all integrated rules can be represented', async () => {
  await withCase(c => {
    c.target_rules=['H10','H11']; c.expected.evaluated_rules=['H11','H10']; c.expected.rule_results.H11='PASS';
  }, async dir => assert.deepEqual((await checkGolden(dir)).errors, []));
  await withCase(c => {
    c.kind='integrated';
    const rules=Array.from({length:19},(_,i)=>`H${String(i+1).padStart(2,'0')}`);
    c.expected.evaluated_rules=[...rules].reverse();
    c.expected.rule_results=Object.fromEntries(rules.map(rule=>[rule,rule==='H10'?'FAIL':'PASS']));
  }, async dir => assert.deepEqual((await checkGolden(dir)).errors, []));
});
test('equal date endpoints, open employment and positive one-minute patterns remain valid formats', async () => {
  await withCase(c => {
    for (const key of ['verify_period','assignments_complete']) c.input.coverage[key][1]=c.input.coverage[key][0];
    const record=c.input.coverage.records_complete[0]; record.period[1]=record.period[0];
    c.input.employees[0].employment[1]=c.input.employees[0].employment[0];
    const p=c.input.patterns[1]; p.duration_minutes=1; p.work=[[0,1]]; p.cover=[[0,1]];
  }, async dir => assert.deepEqual((await checkGolden(dir)).errors, []));
  assert.equal(fail.input.employees[0].employment[1], null);
});
test('duplicate case IDs across nested folders fail and CLI exits nonzero', async () => {
  await withCase(() => {}, async dir => {
    await mkdir(join(dir,'nested'));
    await copyFile(join(dir,'case.json'),join(dir,'nested/second.json'));
    assert.match((await checkGolden(dir)).errors.join('\n'), /duplicate case id/);
    const result=spawnSync(process.execPath,['--import','tsx','scripts/check-golden.ts',dir],{encoding:'utf8'});
    assert.equal(result.status,1); assert.match(result.stderr,/duplicate case id/);
  });
});
test('duplicate JSON keys fail through the file loader', async () => {
  await withCase(() => {}, async dir => {
    await writeFile(join(dir,'case.json'), '{"id":"first","id":"second"}');
    assert.match((await checkGolden(dir)).errors.join('\n'), /duplicate JSON key/);
  });
});

for (const eol of ['\n', '\r\n']) {
  test(`document JSON fence accepts ${JSON.stringify(eol)}`, () => {
    const doc = ['synthetic', '```json', '{"probe":"架空"}', '```', ''].join(eol);
    assert.deepEqual(documentExample(doc), { probe:'架空' });
  });
}

const checkerPath = fileURLToPath(new URL('./check-golden.ts', import.meta.url));
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
function runNode(args: string[]) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, ['--import', 'tsx', ...args], {
    cwd:projectRoot, env, encoding:'utf8', timeout:10_000, maxBuffer:1024*1024,
  });
  assert.equal(r.error, undefined, 'Harness launch/timeout is not a successful rejection');
  assert.equal(r.signal, null);
  return r;
}

for (const alias of [false, true]) for (const valid of [true, false]) {
  test(`CLI ${alias ? 'directory alias' : 'regular entry'} ${valid ? 'checks one valid case' : 'rejects one invalid case'}`, async () => {
    await withCase(c => { if (!valid) c.id=''; }, async (dir,makeLink) => {
      // OS-native diagnostic paths, including spaces/Unicode, stay unchanged.
      const name='架空 例.json';
      await copyFile(join(dir,'case.json'),join(dir,name));await rm(join(dir,'case.json'));
      let entry=checkerPath;
      if (alias) {
        const link=join(dirname(dir),'入口 空白');
        await makeLink(fileURLToPath(new URL('./',import.meta.url)),link);
        entry=join(link,'check-golden.ts');
      }
      const r=runNode([entry,dir]);
      assert.equal(r.status, valid ? 0 : 1, r.stderr);
      assert.equal(r.stdout, `Checked 1 golden cases; ${valid ? 0 : 1} error(s).\n`);
      if(valid)assert.equal(r.stderr,'');
      else assert.match(r.stderr,new RegExp(`${name}: .*minLength|${name}: .*fewer than 1`));
    });
  });
}

for (const context of ['no argv','unrelated entry','missing argv path','checker argv']) {
  test(`library import has no CLI output: ${context}`, async () => {
    await withCase(()=>{},async dir=>{
      const prelude=context==='no argv' ? 'process.argv=[process.execPath];'
        : context==='unrelated entry' ? `process.argv=[process.execPath,${JSON.stringify(fileURLToPath(import.meta.url))}];`
        : context==='missing argv path' ? `process.argv=[process.execPath,${JSON.stringify(join(dir,'missing.ts'))}];`
        : `process.argv=[process.execPath,${JSON.stringify(checkerPath)}];`;
      const code=`import assert from 'node:assert/strict';${prelude}
        process.argv[2]=${JSON.stringify(dir)};
        const m=await import(${JSON.stringify(pathToFileURL(checkerPath).href)});
        assert.equal(typeof m.checkGolden,'function');assert.equal(typeof m.parseJson,'function');`;
      const r=runNode(['--input-type=module','-e',code]);
      assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'');assert.equal(r.stderr,'');
    });
  });
}

for (const context of ['CLI alias','missing argv','unrelated argv']) {
  test(`older-minor entry fallback ${context}`, async () => {
    await withCase(()=>{},async (dir,makeLink)=>{
      // Simulate absence of the Node >=24.2 flag in this copy only; this is
      // not a claim that an older Node or native Windows was executed.
      const source=await readFile(checkerPath,'utf8');
      const copy=source.replace('import.meta.main ??','undefined ??');assert.notEqual(copy,source);
      const workspace=dirname(dir);
      const file=join(workspace,'fallback.ts');await writeFile(file,copy);
      await writeFile(join(workspace,'package.json'),'{"type":"module"}');
      await makeLink(join(projectRoot,'node_modules'),join(workspace,'node_modules'));
      let r;
      if(context==='CLI alias') {
        const link=join(workspace,'fallback alias');await makeLink(workspace,link);
        r=runNode([join(link,'fallback.ts'),dir]);
        assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'Checked 1 golden cases; 0 error(s).\n');assert.equal(r.stderr,'');
      } else {
        const argv=context==='missing argv' ? join(dir,'missing-entry.ts') : fileURLToPath(import.meta.url);
        const code=`process.argv=[process.execPath,${JSON.stringify(argv)}];await import(${JSON.stringify(pathToFileURL(file).href)});`;
        r=runNode(['--input-type=module','-e',code]);
        assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'');assert.equal(r.stderr,'');
      }
    });
  });
}

test('fallback missing argv import preserves existing exitCode',async()=>{
  await withCase(()=>{},async(dir,makeLink)=>{
    const workspace=dirname(dir);const file=join(workspace,'fallback.ts');
    const source=await readFile(checkerPath,'utf8');const copy=source.replace('import.meta.main ??','undefined ??');assert.notEqual(source,copy);
    await writeFile(file,copy);await writeFile(join(workspace,'package.json'),'{"type":"module"}');
    await makeLink(join(projectRoot,'node_modules'),join(workspace,'node_modules'));
    const code=`process.exitCode=7;process.argv=[process.execPath,${JSON.stringify(join(dir,'missing.ts'))}];await import(${JSON.stringify(pathToFileURL(file).href)});`;
    const r=runNode(['--input-type=module','-e',code]);assert.equal(r.status,7);assert.equal(r.stdout,'');assert.equal(r.stderr,'');
  });
});

test('fixture cleanup unlinks external directory before removing workspace',async()=>{
  const external=await mkdtemp(join(tmpdir(),'golden-external-'));
  try {
    await writeFile(join(external,'sentinel'),'external target unchanged');
    let workspace='';
    await withCase(()=>{},async(dir,makeLink)=>{
      workspace=dirname(dir);await makeLink(external,join(workspace,'external alias'));
    });
    await assert.rejects(lstat(workspace),{code:'ENOENT'});
    assert.equal(await readFile(join(external,'sentinel'),'utf8'),'external target unchanged');
  } finally { await rm(external,{recursive:true,force:true}); }
});

test('fixture cleanup stops before recursive removal on unlink failure',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'golden-cleanup-'));
  const target=await mkdtemp(join(tmpdir(),'golden-cleanup-target-'));const link=join(workspace,'alias');
  try {
    await writeFile(join(target,'sentinel'),'unchanged');await symlink(target,link,'junction');
    let recursiveRemoval=false;
    await assert.rejects(clearWorkspace(workspace,[link],async()=>{throw new Error('synthetic unlink failure');},async()=>{recursiveRemoval=true;}),/synthetic unlink failure/);
    assert.equal(recursiveRemoval,false);assert.ok((await lstat(workspace)).isDirectory());
    assert.equal(await readFile(join(target,'sentinel'),'utf8'),'unchanged');
  } finally {
    // If unlink fails, the following recursive operations are not reached.
    await unlink(link);await rm(workspace,{recursive:true,force:true});await rm(target,{recursive:true,force:true});
  }
});

test('fixture cleanup refuses a recorded path replaced by a directory',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'golden-cleanup-changed-'));const path=join(workspace,'alias');
  try {
    await mkdir(path);let recursiveRemoval=false;
    await assert.rejects(clearWorkspace(workspace,[path],unlink,async()=>{recursiveRemoval=true;}),/Refuse cleanup/);
    assert.equal(recursiveRemoval,false);assert.ok((await lstat(path)).isDirectory());
  } finally { await rm(workspace,{recursive:true,force:true}); }
});
