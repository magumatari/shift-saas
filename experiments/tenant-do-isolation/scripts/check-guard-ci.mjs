import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateRun } from './check-test-run.mjs';

// This baseline is separate from unit 14, runtime 8 and guard regressions 68.
// No CLI/environment override. Changes require owner review and independent audit.
export function validateGuardCiRun(result) {
  return validateRun(result, 30);
}

try {
  if (process.argv[1] && process.argv[1] !== '-'
      && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
    if (process.argv.length !== 2) throw new Error('No arguments accepted');
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_OPTIONS;
    const result = spawnSync(process.execPath, [
      '--test',
      `--test-reporter=${fileURLToPath(new URL('./test-summary-reporter.mjs', import.meta.url))}`,
      fileURLToPath(new URL('../test/guard-ci.test.mjs', import.meta.url)),
    ], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const counts = validateGuardCiRun(result);
    console.log(`guard-ci: PASS minimum=30 counts=${JSON.stringify(counts)}`);
  }
} catch (error) {
  console.error(`Guard CI tests failed: ${error.message}`);
  process.exitCode = 1;
}
