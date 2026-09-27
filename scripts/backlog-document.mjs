export function renderBacklog(issues) {
  const intro = '# Product backlog\n\nThe [Linear project](https://linear.app/imraghavojha/project/vesper-d4bae716cdc0/overview) tracks what Vesper must do. Issues describe outcomes and acceptance, not code structure or implementation. Architecture decisions live separately in the research documents.\n\nThis page is generated from [backlog.json](backlog.json). Dependencies below express product prerequisites; native Linear blocking relationships are not configured.\n';
  return intro + issues.map(issue => {
    const dependencies = issue.dependsOn.map(key => {
      const target = issues.find(other => other.key === key);
      return `[${target.linearId}](${target.linearUrl})`;
    }).join(', ') || 'none';
    return `\n## ${issue.key} ${issue.title}\n\n[${issue.linearId}](${issue.linearUrl}) · Area: ${issue.area}. Prerequisites: ${dependencies}.\n\n${issue.acceptance}\n`;
  }).join('');
}
