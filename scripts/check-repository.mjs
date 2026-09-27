import { readFileSync, existsSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, relative } from 'node:path';
import { renderBacklog } from './backlog-document.mjs';

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
  if (!/^IMR-\d+$/.test(issue.linearId ?? '')) errors.push(`Invalid Linear ID ${issue.key}`);
  if (!/^https:\/\/linear\.app\/imraghavojha\/issue\//.test(issue.linearUrl ?? '')) errors.push(`Invalid Linear link ${issue.key}`);
  visit(issue.key);
}
if (!errors.length && readFileSync(resolve(root, 'docs/backlog.md'), 'utf8') !== renderBacklog(issues)) {
  errors.push('Backlog Markdown differs from its JSON source. Regenerate with scripts/backlog-document.mjs.');
}
const files = new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean));
for (const name of files) {
    const file = resolve(root, name);
    if (!existsSync(file) || lstatSync(file).isSymbolicLink()) continue;
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
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Repository checks passed: ${issues.length} issues, valid dependency graph, JSON and local Markdown links. No application tests exist yet.`);
