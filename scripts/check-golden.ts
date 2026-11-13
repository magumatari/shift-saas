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
type Case = {
  id: string;
  input: {
    employees: { id: string; employment: [string, string | null] }[];
    stores: { id: string }[];
    patterns: { id: string; version: number; duration_minutes: number; work: Interval[]; break: Interval[]; cover: Interval[] }[];
    existing_assignments: Assignment[];
    coverage: { verify_period: [string, string]; assignments_complete: [string, string]; records_complete: { employees: string[]; period: [string, string] }[] };
  };
  assignments: Assignment[];
  approved_at?: string | null;
  expected?: { violations: { from: string; to: string; measured?: number; limit?: number; diff?: number }[] };
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
  [...c.assignments, ...c.input.existing_assignments].forEach((a, i) => dates(a.start_date, `/assignments/${i}/start_date`));
  c.expected?.violations.forEach((v, i) => {
    dates(v.from, `/expected/violations/${i}/from`);
    dates(v.to, `/expected/violations/${i}/to`);
  });
  for (const [i, v] of (c.expected?.violations ?? []).entries()) {
    if (v.measured !== undefined && v.diff !== v.measured - v.limit!) errors.push(`expected/violations/${i}: diff must equal measured - limit`);
  }
  for (const p of c.input.patterns) {
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
  ids(assignments.map(a => a.id), 'assignment id');
  for (const a of assignments) {
    if (!employees.has(a.employee)) errors.push(`assignment ${a.id}: unknown employee ${a.employee}`);
    if (!stores.has(a.store)) errors.push(`assignment ${a.id}: unknown store ${a.store}`);
    if (!patterns.has(a.pattern)) errors.push(`assignment ${a.id}: unknown pattern ${a.pattern}`);
  }
  return errors;
}

export async function checkGolden(directory: string): Promise<{ count: number; errors: string[] }> {
  const root = resolve(directory);
  const schemaPath = resolve(root, 'schema/golden-case.schema.json');
  const schema = parseJson(await readFile(schemaPath, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  const validate = ajv.compile(schema as object);
  const errors: string[] = [];
  const ids = new Map<string, string>();
  let count = 0;
  async function walk(dir: string): Promise<void> {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = resolve(dir, entry.name);
      if (file === schemaPath) continue;
      if (entry.isDirectory()) { await walk(file); continue; }
      if (!entry.name.endsWith('.json')) continue;
      count++;
      const name = relative(root, file);
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
