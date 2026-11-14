import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parseTree, getNodeValue, printParseErrorCode, type Node, type ParseError } from 'jsonc-parser';

// Inspect the syntax tree before conversion: JSON.parse would discard duplicate keys.
export function parseJson(text: string): unknown {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true });
  if (!tree || errors.length) throw new Error(`invalid JSON: ${errors.map(e => `${printParseErrorCode(e.error)} at ${e.offset}`).join(', ')}`);
  function visit(node: Node): void {
    if (node.type === 'object') {
      const keys = new Set<string>();
      for (const property of node.children ?? []) {
        const key = property.children![0].value as string;
        if (keys.has(key)) throw new Error(`duplicate JSON key ${JSON.stringify(key)} at ${property.offset}`);
        keys.add(key);
      }
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
  return getNodeValue(tree);
}

type Interval = [number, number];
type Assignment = { id: string; employee: string; store: string; pattern: string; start_date: string };
type Result = 'PASS' | 'FAIL' | 'INDETERMINATE';
type Case = {
  id: string;
  status: 'draft' | 'confirmed' | 'provisional_legal' | 'undecided';
  kind: 'unit' | 'integrated';
  target_rules: string[];
  input: {
    employees: { id: string; employment: [string, string | null] }[];
    stores: { id: string }[];
    patterns: { id: string; version: number; duration_minutes: number; work: Interval[]; break: Interval[]; cover: Interval[] }[];
    existing_assignments: Assignment[];
    coverage: { verify_period: [string, string]; assignments_complete: [string, string]; records_complete: { employees: string[]; period: [string, string] }[] };
  };
  assignments: Assignment[];
  approved_by?: string | null;
  approved_at?: string | null;
  expected?: {
    result: Result;
    evaluated_rules: string[];
    rule_results: Record<string, Result>;
    violations: {
      rule: string; code: string; employee: string; assignments: string[];
      from: string; to: string; measured?: number; limit?: number; diff?: number; comparison?: '<=' | '>=';
    }[];
    indeterminate: unknown[];
  };
};

export function semanticErrors(c: Case): string[] {
  const errors: string[] = [];
  // Schema identifies all date fields; inspect only date-shaped strings, independently of host TZ.
  function dates(value: unknown, path = ''): void {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(value)) {
      const [year, month, day] = value.slice(0, 10).split('-').map(Number);
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) errors.push(`${path}: nonexistent date ${value}`);
    } else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) dates(child, `${path}/${key}`);
    }
  }
  dates(c.approved_at, '/approved_at');
  c.input.employees.forEach((e, i) => dates(e.employment, `/input/employees/${i}/employment`));
  dates(c.input.coverage.verify_period, '/input/coverage/verify_period');
  dates(c.input.coverage.assignments_complete, '/input/coverage/assignments_complete');
  c.input.coverage.records_complete.forEach((r, i) => dates(r.period, `/input/coverage/records_complete/${i}/period`));
  // Dates are fixed-width local dates, so ordering needs no host timezone.
  function period([start, end]: [string, string | null], label: string): void {
    if (end !== null && start > end) errors.push(`${label}: start must be <= end`);
  }
  period(c.input.coverage.verify_period, 'input/coverage/verify_period');
  period(c.input.coverage.assignments_complete, 'input/coverage/assignments_complete');
  c.input.coverage.records_complete.forEach((r, i) => period(r.period, `input/coverage/records_complete/${i}/period`));
  c.input.employees.forEach((e, i) => period(e.employment, `input/employees/${i}/employment`));
  if (c.status === 'draft') {
    for (const key of ['approved_by', 'approved_at'] as const) {
      // Do not invent a meaning for omitted optional keys or make them required.
      if (c[key] !== undefined && c[key] !== null) errors.push(`${c.status}/${key}: unapproved value must be null`);
    }
  }
  [...c.assignments, ...c.input.existing_assignments].forEach((a, i) => dates(a.start_date, `/assignments/${i}/start_date`));
  c.expected?.violations.forEach((v, i) => {
    dates(v.from, `/expected/violations/${i}/from`);
    dates(v.to, `/expected/violations/${i}/to`);
  });
  for (const [i, v] of (c.expected?.violations ?? []).entries()) {
    if (!(v.from < v.to)) errors.push(`expected/violations/${i}: from must be < to`);
    if (v.measured !== undefined) {
      if (v.diff !== v.measured - v.limit!) errors.push(`expected/violations/${i}: diff must equal measured - limit`);
      if (v.comparison === '>=' && !(v.measured < v.limit!)) errors.push(`expected/violations/${i}: lower-bound violation requires measured < limit (negative diff)`);
      if (v.comparison === '<=' && !(v.measured > v.limit!)) errors.push(`expected/violations/${i}: upper-bound violation requires measured > limit (positive diff)`);
      if (v.code === 'REST_SHORTAGE' && v.comparison !== '>=') errors.push(`expected/violations/${i}: REST_SHORTAGE comparison must be >=`);
    }
  }
  if (c.expected) {
    const expected = c.expected;
    const evaluated = new Set(expected.evaluated_rules);
    const sameRules = (rules: string[]) => rules.length === evaluated.size && rules.every(rule => evaluated.has(rule));
    if (!sameRules(Object.keys(expected.rule_results))) errors.push('expected/rule_results: keys must match evaluated_rules');
    const required = c.kind === 'unit' ? c.target_rules : Array.from({ length: 19 }, (_, i) => `H${String(i + 1).padStart(2, '0')}`);
    if (!sameRules(required)) errors.push(`expected/evaluated_rules: must match ${c.kind === 'unit' ? 'target_rules' : 'H01-H19'}`);
    const values = Object.values(expected.rule_results);
    const overall = values.includes('FAIL') ? 'FAIL' : values.includes('INDETERMINATE') ? 'INDETERMINATE' : 'PASS';
    if (expected.result !== overall) errors.push('expected/result: must agree with rule_results');
    for (const [i, violation] of expected.violations.entries()) {
      if (!evaluated.has(violation.rule)) errors.push(`expected/violations/${i}: rule must be in evaluated_rules`);
      if (expected.rule_results[violation.rule] !== 'FAIL') errors.push(`expected/violations/${i}: rule result must be FAIL`);
    }
    for (const rule of expected.evaluated_rules) {
      if (expected.rule_results[rule] === 'FAIL' && !expected.violations.some(v => v.rule === rule)) errors.push(`expected/rule_results/${rule}: FAIL requires a violation`);
    }
    // Reason element syntax remains undecided; only check the defined necessity.
    if (values.includes('INDETERMINATE') && !expected.indeterminate.length) errors.push('expected/indeterminate: an indeterminate rule requires reasons');
  }
  for (const p of c.input.patterns) {
    if (!(p.duration_minutes > 0)) errors.push(`pattern ${p.id}: duration_minutes must be positive (start < end)`);
    for (const name of ['work', 'break', 'cover'] as const) {
      for (const [start, end] of p[name]) {
        if (!(start < end) || start < 0 || end > p.duration_minutes) errors.push(`pattern ${p.id}/${name}: invalid interval [${start}, ${end})`);
      }
    }
    const partition = [...p.work, ...p.break].sort((a, b) => a[0] - b[0]);
    let end = 0;
    for (const [a, b] of partition) {
      if (a !== end) errors.push(`pattern ${p.id}: work/break gap or overlap at ${end}`);
      end = b;
    }
    if (end !== p.duration_minutes) errors.push(`pattern ${p.id}: work/break must cover duration_minutes`);
    const work = [...p.work].sort((a, b) => a[0] - b[0]);
    for (const [a, b] of p.cover) {
      let covered = a;
      for (const [start, finish] of work) {
        if (start <= covered && finish > covered) covered = finish;
      }
      if (covered < b) errors.push(`pattern ${p.id}: cover is outside work`);
    }
  }
  function ids(values: string[], label: string): Set<string> {
    const set = new Set(values);
    if (set.size !== values.length) errors.push(`duplicate ${label}`);
    return set;
  }
  const employees = ids(c.input.employees.map(e => e.id), 'employee id');
  const stores = ids(c.input.stores.map(s => s.id), 'store id');
  const patterns = ids(c.input.patterns.map(p => `${p.id}@${p.version}`), 'pattern ID@version');
  const assignments = [...c.assignments, ...c.input.existing_assignments];
  const assignmentIds = ids(assignments.map(a => a.id), 'assignment id');
  for (const a of assignments) {
    if (!employees.has(a.employee)) errors.push(`assignment ${a.id}: unknown employee ${a.employee}`);
    if (!stores.has(a.store)) errors.push(`assignment ${a.id}: unknown store ${a.store}`);
    if (!patterns.has(a.pattern)) errors.push(`assignment ${a.id}: unknown pattern ${a.pattern}`);
  }
  for (const [i, record] of c.input.coverage.records_complete.entries()) {
    for (const employee of record.employees) {
      if (!employees.has(employee)) errors.push(`input/coverage/records_complete/${i}: unknown employee ${employee}`);
    }
  }
  for (const [i, violation] of (c.expected?.violations ?? []).entries()) {
    if (!employees.has(violation.employee)) errors.push(`expected/violations/${i}: unknown employee ${violation.employee}`);
    for (const id of violation.assignments) {
      if (!assignmentIds.has(id)) errors.push(`expected/violations/${i}: unknown assignment ${id}`);
    }
  }
  return errors;
}

export async function checkGolden(directory: string): Promise<{ count: number; errors: string[] }> {
  const root = resolve(directory);
  const schemaPath = resolve(root, 'schema/golden-case.schema.json');
  const readmePath = resolve(root, 'README.md');
  const schema = parseJson(await readFile(schemaPath, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  const validate = ajv.compile(schema as object);
  const errors: string[] = [];
  const ids = new Map<string, string>();
  let count = 0;
  async function walk(dir: string): Promise<void> {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = resolve(dir, entry.name);
      if (entry.isDirectory()) { await walk(file); continue; }
      if (file === schemaPath || file === readmePath) continue;
      const name = relative(root, file);
      if (!entry.name.endsWith('.json')) {
        errors.push(`${name}: unsupported golden case file; only .json is supported`);
        continue;
      }
      count++;
      try {
        const c = parseJson(await readFile(file, 'utf8'));
        if (!validate(c)) {
          errors.push(`${name}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
          continue;
        }
        const typed = c as Case;
        if (ids.has(typed.id)) errors.push(`${name}: duplicate case id ${typed.id} (also ${ids.get(typed.id)})`);
        ids.set(typed.id, name);
        errors.push(...semanticErrors(typed).map(e => `${name}: ${e}`));
      } catch (error) { errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  await walk(root);
  if (!count) errors.push('no golden cases found');
  return { count, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await checkGolden(process.argv[2] ?? 'golden');
    for (const error of result.errors) console.error(error);
    console.log(`Checked ${result.count} golden cases; ${result.errors.length} error(s).`);
    process.exitCode = result.errors.length ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
