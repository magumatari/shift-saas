// Experiment-only projection of one company's supplied records, not a Validator API.
export type Assignment = Readonly<{
  id: string; employee: string; store: string; pattern: string; start_date: string;
}>;
export type Projection = Readonly<{
  company: Readonly<{ min_rest_minutes: number }>;
  employees: readonly Readonly<{ id: string }>[];
  stores: readonly Readonly<{ id: string }>[];
  patterns: readonly Readonly<{ id: string; version: number; start: string; duration_minutes: number }>[];
  assignments: readonly Assignment[];
  existing_assignments: readonly Assignment[];
}>;
type ShiftEvidence = Readonly<{
  id: string; source: 'candidate' | 'existing'; store: string; pattern: string;
  startJst: string; endJst: string;
}>;
export type PairEvidence = Readonly<{
  employee: string; previous: ShiftEvidence; next: ShiftEvidence; elapsedMinutes: number;
}>;
export type Analysis =
  | Readonly<{ kind: 'not-analyzed'; category: 'precondition' | 'unsupported'; explanation: string }>
  | Readonly<{ kind: 'no-pairs'; minimumMinutes: number; unit: 'minutes'; unpairedEmployees: readonly string[]; explanation: string }>
  | Readonly<{ kind: 'evidence-only'; minimumMinutes: number; unit: 'minutes'; pairs: readonly PairEvidence[]; unpairedEmployees: readonly string[] }>;

const rejected = (explanation: string, category: 'precondition' | 'unsupported' = 'precondition'): Analysis =>
  ({ kind: 'not-analyzed', category, explanation });
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  record(v) && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const time = (v: unknown): v is string => typeof v === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function jst(minutes: number): string | undefined {
  const date = new Date((minutes + 540) * 60_000);
  if (!Number.isFinite(date.getTime())) return undefined;
  const text = date.toISOString();
  return /^[0-9]{4}-/.test(text) ? text.slice(0, 16) : undefined;
}
function startMinute(date: unknown, start: string): number | undefined {
  if (typeof date !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return undefined;
  const value = Date.parse(`${date}T${start}:00+09:00`) / 60_000;
  return Number.isSafeInteger(value) && jst(value) === `${date}T${start}` ? value : undefined;
}

// JSON-like value input. Checks only this closed projection and the supported
// arithmetic/order prerequisites. No ownership, completeness or Hard verdict.
export function analyzeRest(value: unknown): Analysis {
  if (!exact(value, ['company','employees','stores','patterns','assignments','existing_assignments'])
      || !exact(value.company, ['min_rest_minutes'])
      || !integer(value.company.min_rest_minutes) || value.company.min_rest_minutes < 0) {
    return rejected('explicit nonnegative safe-integer company setting and exact projection required');
  }
  const minimumMinutes = value.company.min_rest_minutes;
  for (const key of ['employees','stores','patterns','assignments','existing_assignments']) {
    if (!Array.isArray(value[key])) return rejected(`${key}: explicit array required`);
  }
  const employees = new Set<string>(), stores = new Set<string>();
  for (const [key, target] of [['employees', employees], ['stores', stores]] as const) {
    for (const entry of value[key] as unknown[]) {
      if (!exact(entry, ['id']) || !id(entry.id) || target.has(entry.id)) return rejected(`${key}: invalid or duplicate id`);
      target.add(entry.id);
    }
  }
  const patterns = new Map<string, { start: string; duration: number }>();
  for (const p of value.patterns as unknown[]) {
    if (!exact(p, ['id','version','start','duration_minutes']) || !id(p.id)
        || !integer(p.version) || p.version < 1 || !time(p.start)
        || !integer(p.duration_minutes) || p.duration_minutes <= 0) return rejected('patterns: invalid timing or version projection');
    const key = `${p.id}@${p.version}`;
    if (patterns.has(key)) return rejected(`patterns: duplicate reference ${key}`);
    patterns.set(key, { start: p.start, duration: p.duration_minutes });
  }
  type Resolved = { evidence: ShiftEvidence; employee: string; startDate: string; start: number; end: number };
  const groups = new Map([...employees].map(employee => [employee, [] as Resolved[]]));
  const assignmentIds = new Set<string>();
  for (const [key, source] of [['assignments','candidate'], ['existing_assignments','existing']] as const) {
    for (const a of value[key] as unknown[]) {
      if (!exact(a, ['id','employee','store','pattern','start_date']) || !id(a.id)
          || !id(a.employee) || !id(a.store) || !id(a.pattern)) return rejected(`${key}: invalid assignment projection`);
      if (assignmentIds.has(a.id)) return rejected(`assignments: duplicate id ${a.id}`);
      assignmentIds.add(a.id);
      if (!employees.has(a.employee)) return rejected(`assignment ${a.id}: unknown employee`);
      if (!stores.has(a.store)) return rejected(`assignment ${a.id}: unknown store`);
      const p = patterns.get(a.pattern);
      if (!p) return rejected(`assignment ${a.id}: unknown pattern reference`);
      const start = startMinute(a.start_date, p.start);
      if (start === undefined) return rejected(`assignment ${a.id}: invalid local date`);
      const end = start + p.duration;
      const startJst = jst(start), endJst = Number.isSafeInteger(end) ? jst(end) : undefined;
      if (startJst === undefined || endJst === undefined) return rejected(`assignment ${a.id}: date arithmetic outside four-digit-year range`, 'unsupported');
      groups.get(a.employee)!.push({
        employee: a.employee, startDate: a.start_date as string, start, end,
        evidence: { id:a.id, source, store:a.store, pattern:a.pattern, startJst, endJst },
      });
    }
  }
  const pairs: PairEvidence[] = [], unpairedEmployees: string[] = [];
  for (const employee of [...employees].sort(compareIds)) {
    const shifts = groups.get(employee)!.sort((a, b) => a.start - b.start);
    if (shifts.length < 2) unpairedEmployees.push(employee);
    for (let i = 1; i < shifts.length; i++) {
      const previous = shifts[i-1], next = shifts[i];
      if (previous.start === next.start) return rejected(`employee ${employee}: simultaneous starts are unsupported`, 'unsupported');
      if (next.start < previous.end) return rejected(`employee ${employee}: overlapping shifts / negative rest are unsupported`, 'unsupported');
      if (previous.startDate === next.startDate) return rejected(`employee ${employee}: multiple starts on one date are outside this subset`, 'unsupported');
      pairs.push({ employee, previous:previous.evidence, next:next.evidence, elapsedMinutes:next.start-previous.end });
    }
  }
  if (!pairs.length) return { kind:'no-pairs', minimumMinutes, unit:'minutes', unpairedEmployees, explanation:'no adjacent pair supplied; completeness and compliance not determined' };
  return { kind:'evidence-only', minimumMinutes, unit:'minutes', pairs, unpairedEmployees };
}
