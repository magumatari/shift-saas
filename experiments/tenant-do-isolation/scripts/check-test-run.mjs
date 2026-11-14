import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Baselines: the audited, flat Node test cases at PR #2 head 69f7d3d... .
// No CLI or environment override. Lowering a baseline requires owner approval
// and independent review; see README. These counts do not prove test semantics.
const suites = Object.freeze({
  unit: { file: "../test/gate.test.mjs", minimum: 14 },
  runtime: { file: "../test/runtime.test.mjs", minimum: 8 },
});
const countKeys = ["tests", "passed", "failed", "cancelled", "skipped", "todo", "suites", "topLevel"];

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

// Exported for isolated artificial-output checks; normal CLI always uses the
// fixed suite map above and runs the actual Node test process itself.
export function validateRun(result, minimum) {
  if (!Number.isSafeInteger(minimum) || minimum < 1) throw new Error("Invalid test baseline");
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(`Test process failed: ${result.error?.message ?? result.signal ?? result.status}`);
  }
  if (typeof result.stdout !== "string" || !result.stdout.endsWith("\n")) {
    throw new Error("Missing or incomplete machine summary");
  }
  const line = result.stdout.slice(0, -1);
  const summary = JSON.parse(line);
  // Exactly one canonical record: reject extra output, repeated summaries,
  // duplicate keys, unexpected shape, and unsupported format versions.
  if (JSON.stringify(summary) !== line
      || !exactKeys(summary, ["format", "success", "counts"])
      || summary.format !== "tenant-test-summary-v1"
      || summary.success !== true
      || !exactKeys(summary.counts, countKeys)) {
    throw new Error("Invalid machine summary");
  }
  const counts = summary.counts;
  if (!countKeys.every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0)
      || counts.tests < minimum || counts.passed !== counts.tests
      || ["failed", "cancelled", "skipped", "todo"].some(key => counts[key] !== 0)
      || counts.topLevel < 1 || counts.topLevel > counts.tests + counts.suites) {
    throw new Error(`Test counts rejected: minimum=${minimum}, actual=${JSON.stringify(counts)}`);
  }
  return counts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const name = process.argv[2];
    if (process.argv.length !== 3 || !Object.hasOwn(suites, name)) throw new Error("Use unit or runtime");
    const suite = suites[name];
    const result = spawnSync(process.execPath, [
      "--test",
      `--test-reporter=${fileURLToPath(new URL("./test-summary-reporter.mjs", import.meta.url))}`,
      fileURLToPath(new URL(suite.file, import.meta.url)),
    ], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const counts = validateRun(result, suite.minimum);
    console.log(`${name}: PASS minimum=${suite.minimum} counts=${JSON.stringify(counts)}`);
  } catch (error) {
    console.error(`Test guard failed: ${error.message}`);
    process.exitCode = 1;
  }
}
