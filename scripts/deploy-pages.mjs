/**
 * Build and publish dist/ to the gh-pages branch (GitHub Pages source).
 *
 * Used instead of a GitHub Actions workflow because pushing workflow files
 * needs the gh CLI's `workflow` OAuth scope. If that scope is granted later
 * (`gh auth refresh -h github.com -s workflow`), a CI deploy can replace
 * this — until then: `npm run deploy`.
 */
import { execSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

const root = out('git rev-parse --show-toplevel');
const origin = out('git remote get-url origin');
const head = out('git rev-parse --short HEAD');
const dist = join(root, 'dist');

run('npm run build', { cwd: root });

// dist/ becomes a throwaway single-commit repo force-pushed as gh-pages.
const gitDir = join(dist, '.git');
if (existsSync(gitDir)) rmSync(gitDir, { recursive: true, force: true });
writeFileSync(join(dist, '.nojekyll'), ''); // assets/ starts with no underscore, but be explicit
run('git init -b gh-pages', { cwd: dist });
run('git add -A', { cwd: dist });
run(`git commit -q -m "Deploy ${head}"`, { cwd: dist });
run(`git push -f "${origin}" gh-pages`, { cwd: dist });
rmSync(gitDir, { recursive: true, force: true });

console.log('\nDeployed. Pages serves from the gh-pages branch.');
