import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkGolden, parseJson } from './check-golden.ts';

const failPath = 'golden/H10/H10-rest-1199min-fail.json';
const fail = JSON.parse(await readFile(failPath, 'utf8'));
type Fixture = typeof fail;
async function withCase(change: (c: Fixture) => void, run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'golden-test-'));
  try {
    await mkdir(join(dir, 'schema'));
    await copyFile('golden/schema/golden-case.schema.json', join(dir, 'schema/golden-case.schema.json'));
    const c = structuredClone(fail); change(c);
    await writeFile(join(dir, 'case.json'), JSON.stringify(c));
    await run(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
test('both draft examples pass format checks and FAIL matches the document', async () => {
  const result = await checkGolden('golden');
  assert.deepEqual(result, { count: 2, errors: [] });
  const doc = await readFile('docs/hard-rules.md', 'utf8');
  assert.deepEqual(fail, JSON.parse(doc.split('```json\n')[1].split('\n```')[0]));
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
      assert.deepEqual(result.errors,[`nested/${name}: unsupported golden case file; only .json is supported`]);
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
