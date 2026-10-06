// Syntax-checks every .js module under the given directories (default: web/).
// Usage: node tests/check-syntax.mjs web/procureos web/assets
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const roots = process.argv.slice(2);
if (!roots.length) roots.push('web');

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.js')) files.push(p);
  }
};
roots.forEach((r) => walk(resolve(r)));

const tmp = mkdtempSync(join(tmpdir(), 'syntax-'));
let failed = 0;
files.forEach((file, i) => {
  const copy = join(tmp, `${i}.mjs`);
  copyFileSync(file, copy);
  try {
    execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error(`SYNTAX ERROR in ${file}\n${e.stderr}`);
  }
});
console.log(`${files.length - failed}/${files.length} modules OK`);
process.exit(failed ? 1 : 0);
