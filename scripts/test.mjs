import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runner = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);

// Each suite gets an isolated process and cannot accidentally query live APIs.
if (args[0] === '--suite') {
  globalThis.fetch = async () => { throw new Error('Live network access is disabled in tests. Inject a fixture provider.'); };
  await import(pathToFileURL(resolve(root, args[1])).href);
} else {
  const backendSuites = [
    'tests/action-contracts.mjs', 'tests/payment-boundaries.mjs',
    ...readdirSync(resolve(root, 'tests')).filter(name => /^backend-.*\.mjs$/.test(name)).sort().map(name => `tests/${name}`),
  ];
  const allSuites = readdirSync(resolve(root, 'tests')).filter(name => name.endsWith('.mjs')).sort().map(name => `tests/${name}`);
  const selected = args.includes('--backend') ? backendSuites : allSuites;
  const extraFiles = args.filter(arg => !arg.startsWith('--')).map(name => name.includes('/') || name.includes('\\') ? name : `tests/${name.replace(/\.mjs$/, '')}.mjs`);
  const suites = extraFiles.length ? extraFiles : selected;
  if (!suites.length) throw new Error('No backend test suites were found.');
  let failures = 0;
  for (const suite of suites) {
    if (!existsSync(resolve(root, suite))) {
      console.error(`Missing test suite: ${suite}`);
      failures += 1;
      continue;
    }
    console.log(`Running ${suite}`);
    const result = spawnSync(process.execPath, ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', runner, '--suite', suite], {
      cwd: root,
      stdio: 'inherit',
      timeout: 60_000,
      env: process.env,
    });
    if (result.error) console.error(result.error.message);
    if (result.error || result.status !== 0) failures += 1;
  }
  if (failures) console.error(`${failures} test suite(s) failed.`);
  else console.log(`${suites.length} test suite(s) passed.`);
  process.exitCode = failures ? 1 : 0;
}
