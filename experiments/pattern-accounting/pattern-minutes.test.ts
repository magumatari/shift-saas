import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePatternMinutes } from './pattern-minutes.ts';

// Fictional intervals; expectations are hand arithmetic, never implementation output.
function night() {
  return { duration_minutes: 480, work: [[0, 240], [300, 480]], break: [[240, 300]], cover: [[0, 240], [300, 480]] };
}
const nightMinutes = { durationMinutes: 480, workMinutes: 420, breakMinutes: 60, coverMinutes: 420 };

test('night pattern separates 480 elapsed, 420 working and 60 break minutes', () => {
  assert.deepEqual(calculatePatternMinutes(night()), nightMinutes);
});
test('explicit no breaks keeps the 240-minute control unchanged', () => {
  assert.deepEqual(calculatePatternMinutes({ duration_minutes: 240, work: [[0, 240]], break: [], cover: [[0, 240]] }),
    { durationMinutes: 240, workMinutes: 240, breakMinutes: 0, coverMinutes: 240 });
});
test('training work remains work even when not counted for staffing', () => {
  const c = night(); c.cover = [[60, 240], [300, 420]];
  assert.deepEqual(calculatePatternMinutes(c), { ...nightMinutes, coverMinutes: 300 });
});
test('explicit empty cover is zero without losing working time', () => {
  const c = night(); c.cover = [];
  assert.deepEqual(calculatePatternMinutes(c), { ...nightMinutes, coverMinutes: 0 });
});
test('overlapping cover counts each minute once for one pattern', () => {
  const c = night(); c.cover = [[0, 120], [60, 240], [300, 480]];
  assert.deepEqual(calculatePatternMinutes(c), nightMinutes);
});
test('duplicate and nested cover intervals do not add staffing time', () => {
  const c = night(); c.cover = [[0, 240], [0, 240], [20, 30], [300, 480]];
  assert.deepEqual(calculatePatternMinutes(c), nightMinutes);
});
test('adjacent work and cover endpoints do not count as overlap', () => {
  assert.deepEqual(calculatePatternMinutes({ duration_minutes: 60, work: [[0, 20], [20, 60]], break: [], cover: [[10, 20], [20, 40]] }),
    { durationMinutes: 60, workMinutes: 60, breakMinutes: 0, coverMinutes: 30 });
});
test('one cover interval may span adjacent work intervals', () => {
  assert.deepEqual(calculatePatternMinutes({ duration_minutes: 60, work: [[0, 20], [20, 60]], break: [], cover: [[10, 40]] }),
    { durationMinutes: 60, workMinutes: 60, breakMinutes: 0, coverMinutes: 30 });
});
test('one-minute boundaries are not rounded to a demand slot', () => {
  assert.deepEqual(calculatePatternMinutes({ duration_minutes: 3, work: [[0, 1], [2, 3]], break: [[1, 2]], cover: [[2, 3]] }),
    { durationMinutes: 3, workMinutes: 2, breakMinutes: 1, coverMinutes: 1 });
});
test('all-break input has no work or cover, without a legal verdict', () => {
  assert.deepEqual(calculatePatternMinutes({ duration_minutes: 60, work: [], break: [[0, 60]], cover: [] }),
    { durationMinutes: 60, workMinutes: 0, breakMinutes: 60, coverMinutes: 0 });
});
test('relative offsets beyond midnight are not reduced modulo 1440', () => {
  assert.deepEqual(calculatePatternMinutes({ duration_minutes: 1500, work: [[0, 1410]], break: [[1410, 1500]], cover: [[1380, 1410]] }),
    { durationMinutes: 1500, workMinutes: 1410, breakMinutes: 90, coverMinutes: 30 });
});
test('safe-integer endpoint limit is measured without a per-minute loop', () => {
  const n = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(calculatePatternMinutes({ duration_minutes: n, work: [[0, n]], break: [], cover: [[n - 1, n]] }),
    { durationMinutes: n, workMinutes: n, breakMinutes: 0, coverMinutes: 1 });
});
test('adding interval lengths avoids an unsafe sum of large endpoints', () => {
  const n = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(calculatePatternMinutes({ duration_minutes: n, work: [[0, n - 2], [n - 1, n]], break: [[n - 2, n - 1]], cover: [[n - 1, n]] }),
    { durationMinutes: n, workMinutes: n - 1, breakMinutes: 1, coverMinutes: 1 });
});
test('input order and unrelated metadata do not change hand-calculated totals', () => {
  const c = night(); c.work.reverse(); c.cover.reverse();
  assert.deepEqual(calculatePatternMinutes({ ...c, id: 'FICTIONAL', version: 2, start: '22:00', name: 'Renamed' }), nightMinutes);
});
test('deeply frozen caller arrays remain unchanged', () => {
  const c = night();
  for (const list of [c.work, c.break, c.cover]) { for (const span of list) Object.freeze(span); Object.freeze(list); }
  Object.freeze(c);
  assert.deepEqual(calculatePatternMinutes(c), nightMinutes);
  assert.deepEqual(c, night());
});

for (const [name, value] of [['null', null], ['undefined', undefined], ['array', []], ['number', 480]] as const) {
  test(`reject non-object input: ${name}`, () => assert.throws(() => calculatePatternMinutes(value), { name: 'TypeError', message: 'pattern: object required' }));
}
for (const key of ['duration_minutes', 'work', 'break', 'cover']) {
  test(`reject missing field without defaults: ${key}`, () => {
    const c: Record<string, unknown> = night(); delete c[key];
    assert.throws(() => calculatePatternMinutes(c), { name: 'TypeError', message: `pattern: missing ${key}` });
  });
}
test('inherited fields do not replace explicit input', () => {
  assert.throws(() => calculatePatternMinutes(Object.create(night())), /missing duration_minutes/);
});
for (const [name, duration] of [['zero', 0], ['negative', -1], ['fraction', 0.5], ['infinity', Infinity], ['NaN', NaN], ['unsafe', Number.MAX_SAFE_INTEGER + 1], ['string', '480'], ['null', null]] as const) {
  test(`reject invalid duration: ${name}`, () => assert.throws(() => calculatePatternMinutes({ ...night(), duration_minutes: duration }),
    { name: 'TypeError', message: 'duration_minutes: positive safe integer required' }));
}
for (const key of ['work', 'break', 'cover']) {
  test(`reject null interval list: ${key}`, () => assert.throws(() => calculatePatternMinutes({ ...night(), [key]: null }),
    { name: 'TypeError', message: `${key}: explicit interval array required` }));
}
for (const [name, span] of [
  ['non-array', {}], ['short tuple', [0]], ['long tuple', [0, 1, 2]], ['zero interval', [1, 1]],
  ['reversed', [2, 1]], ['negative', [-1, 1]], ['outside shift', [0, 481]], ['fractional', [0, 1.5]],
  ['string endpoint', ['0', 1]], ['infinite endpoint', [0, Infinity]], ['unsafe endpoint', [0, Number.MAX_SAFE_INTEGER + 1]],
] as const) {
  test(`reject malformed cover: ${name}`, () => assert.throws(() => calculatePatternMinutes({ ...night(), cover: [span] }), TypeError));
}
test('sparse interval list is rejected rather than skipped', () => {
  assert.throws(() => calculatePatternMinutes({ ...night(), cover: new Array(1) }), /two endpoints required/);
});
for (const [name, work, breaks] of [
  ['leading gap', [[1, 240], [300, 480]], [[240, 300]]],
  ['internal gap', [[0, 239], [300, 480]], [[240, 300]]],
  ['work overlaps break', [[0, 241], [300, 480]], [[240, 300]]],
  ['work overlaps itself', [[0, 240], [100, 240], [300, 480]], [[240, 300]]],
  ['trailing gap', [[0, 240], [300, 479]], [[240, 300]]],
  ['no partition', [], []],
] as const) {
  test(`reject work/break partition: ${name}`, () => assert.throws(() => calculatePatternMinutes({ duration_minutes: 480, work, break: breaks, cover: [] }), /work\/break:/));
}
for (const cover of [[[240, 300]], [[239, 301]], [[0, 480]]]) {
  test(`reject cover extending into break: ${JSON.stringify(cover)}`, () => assert.throws(() => calculatePatternMinutes({ ...night(), cover }),
    { name: 'TypeError', message: 'cover: outside work' }));
}
