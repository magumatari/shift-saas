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
  const minutes = (end: string) => (Date.parse(end + '+09:00') - Date.parse('2026-12-08T06:00+09:00')) / 60000;
  assert.equal(minutes('2026-12-09T01:59'), 1199);
  assert.equal(minutes('2026-12-09T02:00'), 1200);
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
