import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateRun } from './check-test-run.mjs';

// Separate baseline; never add these synthetic tests to unit 14 / runtime 8.
// No CLI/environment override. Baseline changes require owner review.
export function validateRegressionRun(result) {
  return validateRun(result, 68);
}

if (process.argv[1] && process.argv[1] !== '-'
    && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.length !== 2) throw new Error('No arguments accepted');
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [
      '--test',
      `--test-reporter=${fileURLToPath(new URL('./test-summary-reporter.mjs', import.meta.url))}`,
      fileURLToPath(new URL('../test/guard-regression.test.mjs', import.meta.url)),
    ], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const counts = validateRegressionRun(result);
    console.log(`guard-regression: PASS minimum=68 counts=${JSON.stringify(counts)}`);
  } catch (error) {
    console.error(`Guard regression failed: ${error.message}`);
    process.exitCode = 1;
  }
}
