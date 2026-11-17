import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateRun } from '../tenant-do-isolation/scripts/check-test-run.mjs';

// CLI only. Fixed target/baseline, separate from root, H10 and tenant counts.
// A baseline change requires owner adoption and independent review.
try {
  if (process.argv.length !== 2) throw new Error('No arguments accepted');
  if (process.version !== 'v24.22.1') throw new Error('Use Node v24.22.1');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  for (const timezone of ['UTC', 'America/Los_Angeles']) {
    const result = spawnSync(process.execPath, [
      '--import', 'tsx', '--test',
      `--test-reporter=${fileURLToPath(new URL('../tenant-do-isolation/scripts/test-summary-reporter.mjs', import.meta.url))}`,
      fileURLToPath(new URL('./pattern-minutes.test.ts', import.meta.url)),
    ], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: { ...env, TZ: timezone },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const counts = validateRun(result, 56);
    // The adopted 56 cases are flat tests: suites/nesting must not inflate them.
    if (counts.suites !== 0 || counts.topLevel !== counts.tests) {
      throw new Error('Flat test count mismatch');
    }
    console.log(`pattern-minutes ${timezone}: PASS minimum=56 counts=${JSON.stringify(counts)}`);
  }
  console.log('pattern-minutes: PASS timezones=2');
} catch (error) {
  console.error(`Pattern tests failed: ${error.message}`);
  process.exitCode = 1;
}
