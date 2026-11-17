type Interval = readonly [number, number];

export type PatternMinutes = Readonly<{
  durationMinutes: number;
  workMinutes: number;
  breakMinutes: number;
  coverMinutes: number;
}>;

function intervals(value: unknown, label: string, duration: number): Interval[] {
  if (!Array.isArray(value)) throw new TypeError(`${label}: explicit interval array required`);
  const result: Interval[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new TypeError(`${label}: two endpoints required`);
    }
    const [start, end] = entry;
    if (typeof start !== 'number' || typeof end !== 'number'
        || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start < 0 || start >= end || end > duration) {
      throw new TypeError(`${label}: expected integer 0 <= start < end <= duration_minutes`);
    }
    result.push([start, end]);
  }
  return result;
}

function measureUnion(spans: readonly Interval[]): number {
  let end = 0, minutes = 0;
  for (const [start, finish] of [...spans].sort((a, b) => a[0] - b[0])) {
    minutes += Math.max(0, finish - Math.max(start, end));
    end = Math.max(end, finish);
  }
  return minutes;
}

// Internal arithmetic over one supplied pattern, not an HTTP/Validator contract.
// Metadata, date/version resolution, completeness and legal verdicts are callers' work.
export function calculatePatternMinutes(value: unknown): PatternMinutes {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('pattern: object required');
  }
  for (const key of ['duration_minutes', 'work', 'break', 'cover']) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`pattern: missing ${key}`);
  }
  const raw = value as Record<string, unknown>;
  const durationMinutes = raw.duration_minutes;
  if (typeof durationMinutes !== 'number' || !Number.isSafeInteger(durationMinutes) || durationMinutes <= 0) {
    throw new TypeError('duration_minutes: positive safe integer required');
  }
  const work = intervals(raw.work, 'work', durationMinutes);
  const breaks = intervals(raw.break, 'break', durationMinutes);
  const cover = intervals(raw.cover, 'cover', durationMinutes);

  // Same precondition as the adopted format checker: work/break partition the shift.
  let partitionEnd = 0;
  for (const [start, end] of [...work, ...breaks].sort((a, b) => a[0] - b[0])) {
    if (start !== partitionEnd) throw new TypeError('work/break: gap or overlap');
    partitionEnd = end;
  }
  if (partitionEnd !== durationMinutes) throw new TypeError('work/break: incomplete duration');

  // Work intervals are disjoint now. Coverage must lie entirely inside their union.
  for (const [start, end] of cover) {
    const working = work.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(end, b) - Math.max(start, a)), 0);
    if (working !== end - start) throw new TypeError('cover: outside work');
  }
  const workMinutes = work.reduce((sum, [start, end]) => sum + (end - start), 0);
  const breakMinutes = breaks.reduce((sum, [start, end]) => sum + (end - start), 0);
  // One pattern belongs to one person: repeated/overlapping cover never adds time twice.
  const coverMinutes = measureUnion(cover);
  return { durationMinutes, workMinutes, breakMinutes, coverMinutes };
}
