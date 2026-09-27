import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const issues = JSON.parse(readFileSync(resolve(root, 'docs/backlog.json'), 'utf8'));
const byId = new Map(issues.map(issue => [issue.key, issue]));
const errors = [];
if (byId.size !== issues.length) errors.push('Duplicate backlog key');
const visiting = new Set();
const visited = new Set();
function visit(key) {
  if (visiting.has(key)) { errors.push(`Dependency cycle at ${key}`); return; }
  if (visited.has(key)) return;
  const issue = byId.get(key);
  if (!issue) { errors.push(`Unknown dependency ${key}`); return; }
  visiting.add(key);
  for (const dependency of issue.dependsOn) visit(dependency);
  visiting.delete(key);
  visited.add(key);
}
for (const issue of issues) {
  if (!issue.title || !issue.acceptance) errors.push(`Incomplete issue ${issue.key}`);
  visit(issue.key);
}
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (['.git', 'node_modules', '.vesper', '.t3'].includes(name)) continue;
    const file = resolve(dir, name);
    if (statSync(file).isDirectory()) { walk(file); continue; }
    if (name.endsWith('.json')) {
      try { JSON.parse(readFileSync(file, 'utf8')); }
      catch (error) { errors.push(`${relative(root, file)}: ${error.message}`); }
    }
    if (!name.endsWith('.md')) continue;
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      if (!existsSync(resolve(dirname(file), target.split('#')[0]))) errors.push(`Broken link in ${relative(root, file)}: ${target}`);
    }
  }
}
walk(root);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Repository checks passed: ${issues.length} issues, valid dependency graph, JSON and local Markdown links. No application tests exist yet.`);
